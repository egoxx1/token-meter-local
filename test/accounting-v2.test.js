'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {fixture,codexRows}=require('./helpers');
const {generation,step,database,b,vi,join}=require('./antigravity-fixtures');
const {options,fixtureRows,legacy}=require('./identity-v4-fixtures');
const {Snapshot}=require('../src/antigravity-proto');
const {Collector}=require('../src/collector');
const {atomicJson,hash}=require('../src/util');
const {sum,verifySession}=require('../src/reliability');
const {buckets}=require('../src/measurements');
const {readDatabase}=require('../src/antigravity-db');
const {priceEvent}=require('../src/pricing');
const {measurementBaseline}=require('../src/identity-repair');

function mirror(o){return generation({...o,retries:[o]});}
function oldPair(id,i,o){
  const s=new Snapshot(id);s.feed('generation',i,generation(o));
  const primary=s.events[0],retry=structuredClone(primary),key=`${id}:row-v4:generation:${i}:1`;
  delete primary.accountingVersion;delete retry.accountingVersion;
  retry.id='antigravity:'+hash(key);retry.identityKeys=[key];retry.sourceRowKeys=[key];retry.sourcePosition=1;
  retry.warnings=[...retry.warnings,'antigravity-retry-record'];
  primary.price=priceEvent(primary);retry.price=priceEvent(retry);
  return [primary,retry];
}
function parsed(id,gens,steps=[]){const s=new Snapshot(id);gens.forEach((g,i)=>s.feed('generation',i,g));steps.forEach((g,i)=>s.feed('step',i,g));return s.finish('test');}

test('559 shared-parent generation rows with mirrored retry and step retain 559 calls',()=>{
  const opts=Array.from({length:559},(_,i)=>options(i));
  const r=parsed('mirrors',opts.map(mirror),opts.map(step));
  assert.equal(r.events.length,559);assert.equal(r.mirroredRetryKeys.length,559);
  assert.equal(r.stats.matchedStepObservations,559);assert.equal(r.stats.reusedRequestKeys,0);assert.equal(r.partial,false);
  assert.deepEqual(sum(r.events),{records:559,input:74740000,normalInput:7660000,cacheRead:67080000,cacheWrite:0,output:304000,total:75044000});
  assert.equal(legacy('mirrors',opts).length,25);
});
test('response ID reused by different generation rows stays distinct when steps have explicit indices',()=>{
  const opts=[0,1].map(i=>({...options(i,2),response:'shared-response',message:'shared-message'}));
  const rows=opts.map((o,i)=>join(mirror(o),b(2,vi(i))));
  const r=parsed('reuse',rows,opts.map(step));
  assert.equal(r.events.length,2);assert.equal(r.stats.matchedStepObservations,2);
  assert.ok(r.stats.reusedRequestKeys>0);assert.equal(r.stats.ambiguousStepRows,0);assert.equal(r.partial,false);
});
test('a different retry remains a separate invocation, while an identical retry is one observation',()=>{
  const o={...options(0),retries:[{response:'retry-response',message:'retry-message',normal:500,cache:0,output:40,thinking:20,visible:20}]};
  const different=parsed('different',[generation(o)]);assert.equal(different.events.length,2);
  const same=parsed('same',[mirror(options(0))]);assert.equal(same.events.length,1);
});
test('SQLite metadata over the former 8 MiB limit reads on both native and Python backends',async t=>{
  const f=await fixture(t),file=database(f.file('antigravity','large.db'),[join(generation(),b(30,Buffer.alloc(9*1024*1024,65)))]);
  const native=await readDatabase(file),python=await readDatabase(file,{backend:'python'});
  assert.equal(native.events.length,1);assert.deepEqual(native.events,python.events);
});
test('v4 mirrored records recover without double counting and remain stable after restart',async t=>{
  const f=await fixture(t),opts=Array.from({length:559},(_,i)=>options(i));
  database(f.file('antigravity','mirrored.db'),opts.map(mirror),opts.map(step));
  const old=opts.flatMap((o,i)=>oldPair('mirrored',i,o));
  await atomicJson(path.join(f.data,'ledger.json'),{version:2,events:old,files:{},tasks:[]});
  let c=await new Collector(f.data).init();await c.scan();
  assert.equal(c.events.size,559);assert.equal(c.journal.status().retiredRequests,559);
  assert.equal((await verifySession(c,{sessionId:'antigravity:mirrored'})).status,'matched-local-snapshot');
  assert.equal(c.repairs.accountingV2.sessions['antigravity:mirrored'].status,'repaired');
  assert.ok((await fs.stat(path.join(f.data,'ledger.pre-0.10.1.json'))).isFile());
  const seq=c.journal.sequence;c=await new Collector(f.data).init();await c.scan();
  assert.equal(c.events.size,559);assert.equal(c.journal.sequence,seq);
});
test('v4 recovery keeps pre-reset calls in source and only post-reset calls active',async t=>{
  const f=await fixture(t),opts=Array.from({length:3},(_,i)=>options(i,3));
  database(f.file('antigravity','epoch.db'),opts.map(mirror),opts.map(step));
  const old=opts.flatMap((o,i)=>oldPair('epoch',i,o)),id=crypto.randomUUID(),startedAt=opts[2].time;
  const directory=path.join(f.data,'data-epochs',id);
  await atomicJson(path.join(directory,'ledger.json'),{version:2,events:old.slice(4),sourceEvents:old,files:{},tasks:[],resetBoundary:{version:1,id,startedAt,baseline:old.slice(0,4).map(e=>[e.id,buckets(e)])}});
  await atomicJson(path.join(directory,'measurements.json'),{version:1,runs:[],pinnedId:null,undo:null});
  await atomicJson(path.join(f.data,'active-data.json'),{version:1,id,startedAt});
  let c=await new Collector(f.data).init();await c.scan();assert.equal(c.sourceEvents.size,3);assert.equal(c.events.size,1);
  assert.equal((await verifySession(c,{sessionId:'antigravity:epoch'})).status,'matched-local-snapshot');
  c=await new Collector(f.data).init();await c.scan();assert.equal(c.sourceEvents.size,3);assert.equal(c.events.size,1);
});
test('WAL adds only a new invocation after accounting recovery, and Codex stays unchanged',async t=>{
  const f=await fixture(t),file=database(f.file('antigravity','wal.db'),[mirror(options(0,2))]);
  await f.write('codex','unchanged.jsonl',codexRows());await f.c.scan();
  const codex=[...f.c.events.values()].filter(e=>e.provider==='codex').map(e=>[e.id,e.input,e.cacheRead,e.output,e.reasoning]);
  const db=new DatabaseSync(file);t.after(()=>db.close());db.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;');
  db.prepare('INSERT INTO gen_metadata VALUES(?,?)').run(1,mirror(options(1,2)));
  await f.c.scan();assert.equal([...f.c.events.values()].filter(e=>e.provider==='antigravity').length,2);
  assert.deepEqual([...f.c.events.values()].filter(e=>e.provider==='codex').map(e=>[e.id,e.input,e.cacheRead,e.output,e.reasoning]),codex);
  assert.equal(f.c.health.antigravity.errors,0);assert.equal(f.c.health.antigravity.partial,undefined);
});
test('a step observed before reset transfers its baseline when a later generation absorbs it',async t=>{
  const f=await fixture(t),before={...options(0),normal:100,cache:0,output:20,thinking:10,visible:10,time:'2026-09-26T00:00:00Z'},after={...before,normal:150,output:30,thinking:15,visible:15,time:'2026-09-26T00:02:00Z'};
  database(f.file('antigravity','late.db'),[generation(after)],[step(before)]);
  const s=new Snapshot('late');s.feed('step',0,step(before));const old=s.events[0];delete old.accountingVersion;old.price=priceEvent(old);
  const id=crypto.randomUUID(),startedAt='2026-09-26T00:01:00Z',directory=path.join(f.data,'data-epochs',id);
  await atomicJson(path.join(directory,'ledger.json'),{version:2,events:[],sourceEvents:[old],files:{},tasks:[],resetBoundary:{version:1,id,startedAt,baseline:[[old.id,buckets(old)]]}});
  await atomicJson(path.join(directory,'measurements.json'),{version:1,runs:[],pinnedId:null,undo:null});
  await atomicJson(path.join(f.data,'active-data.json'),{version:1,id,startedAt});
  const c=await new Collector(f.data).init();await c.scan();
  assert.equal(sum([...c.events.values()]).input,50);assert.equal(sum([...c.events.values()]).output,10);
});
test('pre-reset steps previously ambiguous from a reused response ID do not become new active usage',async t=>{
  const f=await fixture(t),before=[0,1].map(i=>({...options(i,2),normal:100,cache:0,output:20,thinking:10,visible:10,response:'shared',message:'shared',time:'2026-09-26T00:00:00Z'})),later=before.map(o=>({...o,normal:150,output:30,thinking:15,visible:15}));
  database(f.file('antigravity','ambiguous.db'),before.map((o,i)=>join(mirror(o),b(2,vi(i)))),later.map(step));
  const old=before.flatMap((o,i)=>oldPair('ambiguous',i,o)),id=crypto.randomUUID(),startedAt='2026-09-26T00:01:00Z',directory=path.join(f.data,'data-epochs',id);
  await atomicJson(path.join(directory,'ledger.json'),{version:2,events:[],sourceEvents:old,files:{},tasks:[],resetBoundary:{version:1,id,startedAt,baseline:old.map(e=>[e.id,buckets(e)])}});
  await atomicJson(path.join(directory,'measurements.json'),{version:1,runs:[],pinnedId:null,undo:null});
  await atomicJson(path.join(f.data,'active-data.json'),{version:1,id,startedAt});
  const c=await new Collector(f.data).init();await c.scan();assert.equal(c.sourceEvents.size,2);assert.equal(c.events.size,0);
  assert.equal(c.repairs.accountingV2.sessions['antigravity:ambiguous'].preResetObservationPromotions,2);
});
test('running measurement uses the larger old step baseline and excludes pre-start step corrections',()=>{
  const o={...options(0),normal:100,cache:0,output:20,thinking:10,visible:10,time:'2026-09-26T00:00:00Z'};
  const newer={...o,normal:150,output:30,thinking:15,visible:15,time:'2026-09-26T00:01:00Z'};
  const fresh=parsed('measurement',[generation(o)],[step(newer)]).events[0];
  const original=parsed('measurement',[generation(o)]).events[0];
  const priorStep=parsed('measurement',[],[step(newer)]).events[0];
  const plan={legacyIds:[original.id,priorStep.id],baselineTransfers:{[fresh.id]:original.id},baselineCandidates:{[fresh.id]:[original.id,priorStep.id]}};
  const c={events:new Map([[fresh.id,fresh]]),repairs:{accountingV2:{sessions:{'antigravity:measurement':plan}}}};
  const run={start:'2026-09-26T00:02:00Z'};
  let result=measurementBaseline(c,run,new Map([[original.id,buckets(original)],[priorStep.id,buckets(priorStep)]]));
  assert.equal(result.baseline.get(fresh.id).input,150);
  result=measurementBaseline(c,run,new Map([[original.id,buckets(original)]]));
  assert.equal(result.baseline.get(fresh.id).input,150);
  result=measurementBaseline(c,{start:'2026-09-26T00:00:30Z'},new Map([[original.id,buckets(original)]]));
  assert.equal(result.baseline.get(fresh.id).input,100);
});
