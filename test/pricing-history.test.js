'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {Collector}=require('../src/collector');
const {UsageLog,safeEvent}=require('../src/usage-log');
const {history,exportHistory}=require('../src/history');
const {priceEvent,priceDetails,selectRate}=require('../src/pricing');
const {modelInfo,Snapshot,fields,decodeGeneration}=require('../src/antigravity-proto');
const {fixture,claudeRow}=require('./helpers');
const {generation,step,database,b,v,join,time,usage,SENTINEL}=require('./antigravity-fixtures');
const {startServer}=require('../src/server');
function event(o={}){const s=new Snapshot('regression');s.feed('generation',0,generation(o));return s.events[0];}
async function prepared(t,options={}){const f=await fixture(t);database(f.file('antigravity','regression.db'),[generation(options)]);await f.c.scan();return f;}
const rate={provider:'antigravity',modelProvider:'google',models:['gemini-3.8-flash'],tier:'standard',input:.75,cacheRead:.075,output:3.75};
test('ID 1319 and placeholder m319 resolve to Gemini 3.8 Flash Medium with a source, not an anonymous official claim',()=>{
 for(const m of [modelInfo('',1319),modelInfo('model_placeholder_m319'),modelInfo('antigravity-model-id-1319'),modelInfo('unknown',1319)]){
 assert.equal(m.model,'gemini-3.8-flash');assert.equal(m.effort,'medium');assert.equal(m.numericModelId,1319);assert.equal(m.modelResolution.kind,'reference-map');assert.match(m.modelResolution.source,/ccusage\/ccusage/);}
 assert.equal(modelInfo('',98765).model,'antigravity-model-id-98765');
});
test('Matching numeric and named observations of one invocation do not create false model conflict',()=>{
 const s=new Snapshot('pair');s.feed('generation',0,generation({model:null,enum:1319}));s.feed('step',0,step());assert.equal(s.events.length,1);
 const e=s.events[0];assert.equal(e.effort,'medium');assert.ok(!e.warnings.includes('antigravity-model-conflict'));assert.equal(priceEvent(e).totalPico,'15375000000');
});
test('A real different-model conflict remains unpriced rather than silently assigning a cheap model',()=>{
 const s=new Snapshot('conflict');s.feed('generation',0,generation());s.feed('step',0,step({model:'claude-opus-4-6'}));const e=s.events[0];const p=priceEvent(e);
 assert.equal(p.totalPico,null);assert.equal(p.knownPico,'0');assert.ok(p.reasons.some(r=>r.code==='model-conflict'));
});
test('Only whitelisted model_enum metadata is used; unknown payload metadata does not escape',()=>{
 const raw=b(1,join(b(20,join(b(1,'model_enum'),b(2,'model_placeholder_m319'))),b(20,join(b(1,'private_secret'),b(2,SENTINEL))),b(4,usage()),b(9,b(4,time()))));
 const d=decodeGeneration(raw);assert.equal(d.modelInfo.model,'gemini-3.8-flash');assert.ok(!JSON.stringify(d).includes(SENTINEL));
});
test('An explicit total is charged once and raw conflicting split is preserved as diagnostic only',()=>{
 const e=event({output:2000,thinking:1500,visible:1000});e.price=priceEvent(e);assert.equal(e.output,2000);assert.equal(e.price.outputPico,'7500000000');assert.equal(e.reasoningKnown,false);assert.deepEqual(e.rawOutputDetails,{field9:1500,field10:1000});assert.equal(e.price.missing.length,0);
});
test('Legacy output-only uncertainty never invalidates known input or includes disputed output as known cost',()=>{
 const e=event();e.warnings.push('antigravity-output-breakdown-conflict');const p=priceEvent(e);assert.equal(p.inputPico,'7875000000');assert.equal(p.outputPico,null);assert.equal(p.knownOutputPico,'0');assert.equal(p.status,'partial');assert.ok(p.reasons.some(r=>r.side==='output'));
});
test('Unknown cache TTL excludes only that bucket and preserves independently priced output',()=>{
 const e=event({model:'claude-opus-4-6',write:1000}),p=priceEvent(e);assert.equal(p.inputPico,null);assert.notEqual(p.outputPico,null);assert.ok(p.reasons.some(r=>r.code==='cache-ttl-missing'));assert.equal(p.components.find(c=>c.key==='cacheWrite').costPico,null);
});
test('Official checked rate outranks a remote community match while explicit custom prices remain explicit overrides',()=>{
 const e=event(),remote={...rate,community:true,input:999,output:999,source:'https://models.dev/api.json'};
 assert.equal(selectRate(e,[remote]).input,.75);const custom={...rate,input:1,source:'user-supplied'};e.price=priceEvent(e,[remote,custom]);assert.equal(e.price.rate.input,1);assert.equal(e.price.status,'reference');assert.ok(priceDetails(e).referenceReasons.some(r=>r.code==='user-price'));
});
test('Unknown numeric model is not priced from nearby IDs or prior session model',()=>{
 const s=new Snapshot('different');s.feed('generation',0,generation());s.feed('generation',1,generation({enum:98765,model:null,response:'new',message:'newm'}));const e=s.events[1];assert.equal(e.model,'antigravity-model-id-98765');e.price=priceEvent(e);assert.equal(e.price.totalPico,null);assert.ok(priceDetails(e).reasons.some(r=>r.code==='model-unresolved'));
});
test('Full official API cost details independently reproduce input + output = total',()=>{
 const e=event();e.price=priceEvent(e);const p=priceDetails(e);assert.equal(p.verifiedAt,'2026-09-25');assert.match(p.rateSource,/ai.google.dev/);assert.equal(p.components.filter(c=>c.side==='input').reduce((a,c)=>a+BigInt(c.costPico),0n),BigInt(e.price.inputPico));assert.equal(BigInt(e.price.inputPico)+BigInt(e.price.outputPico),BigInt(e.price.totalPico));
});
test('Journal appends once for an observation, once for a revision and not for repeated scans',async t=>{
 const f=await prepared(t);assert.equal(f.c.journal.status().lines,1);await f.c.scan();assert.equal(f.c.journal.status().lines,1);const e=[...f.c.events.values()][0];e.output+=1;e.total+=1;e.price=priceEvent(e);f.c.dirty=true;await f.c.save();assert.equal(f.c.journal.status().lines,2);assert.equal(f.c.journal.latest.get(e.id).revision,2);
 const c=await new Collector(f.data).init();assert.equal(c.events.size,1);assert.equal(c.journal.status().lines,2);
});
test('Journal whitelists privacy fields, survives source deletion, and can rebuild a lost ledger latest view',async t=>{
 const f=await prepared(t);const e=[...f.c.events.values()][0];e.prompt=SENTINEL;e.apiKey=SENTINEL;await f.c.save();const journal=await fs.readFile(path.join(f.c.journal.directory,new Date().toISOString().slice(0,7)+'.jsonl'),'utf8');assert.ok(!journal.includes(SENTINEL));await fs.unlink(path.join(f.data,'ledger.json'));await fs.rm(f.roots.antigravity[0],{recursive:true});const c=await new Collector(f.data).init();await c.scan();assert.equal(c.events.size,1);assert.equal([...c.events.values()][0].total,17000);assert.equal(c.health.antigravity.status,'partial');assert.equal(c.health.antigravity.unrepairedAccountingRecords,1);
});
test('A torn final journal append is backed up and the last complete record remains readable',async t=>{
 const f=await prepared(t),file=path.join(f.c.journal.directory,new Date().toISOString().slice(0,7)+'.jsonl');const before=await fs.readFile(file);await fs.appendFile(file,'{"schema":"interrupted');const j=await new UsageLog(f.data).init();assert.equal(j.latest.size,1);assert.equal(j.repairs,1);assert.deepEqual(await fs.readFile(file),before);assert.ok((await fs.readdir(j.directory)).some(n=>n.includes('.torn-')));
});
test('Complete corrupted journal lines are rejected instead of quietly erased',async t=>{
 const f=await prepared(t),file=path.join(f.c.journal.directory,new Date().toISOString().slice(0,7)+'.jsonl');await fs.appendFile(file,'{"wrong":true}\n');await assert.rejects(()=>new UsageLog(f.data).init(),/보존 로그 손상/);assert.ok((await fs.readFile(file,'utf8')).endsWith('{"wrong":true}\n'));
});
test('Journal folder and file symlinks are refused',async t=>{
 const f=await fixture(t);await fs.rm(f.c.journal.directory,{recursive:true});await fs.symlink(f.roots.codex[0],f.c.journal.directory);await assert.rejects(()=>new UsageLog(f.data).init(),/심볼릭/);await fs.unlink(f.c.journal.directory);await fs.mkdir(f.c.journal.directory);const dest=path.join(f.dir,'outside');await fs.writeFile(dest,'untouched');await fs.symlink(dest,path.join(f.c.journal.directory,'2026-09.jsonl'));await assert.rejects(()=>new UsageLog(f.data).init(),/링크/);assert.equal(await fs.readFile(dest,'utf8'),'untouched');
});
test('A log write failure surfaces instead of reporting a successfully saved ledger',async t=>{
 const f=await prepared(t);await fs.rm(f.c.journal.directory,{recursive:true});await fs.writeFile(f.c.journal.directory,'not a directory');const e=[...f.c.events.values()][0];e.output++;e.total++;e.price=priceEvent(e);await assert.rejects(()=>f.c.save());assert.ok(f.c.dirty);assert.ok(f.c.journal.status().error);
});
test('Upgrade preserves old bytes then reparses output/model conflicts into a new audited revision',async t=>{
 const f=await prepared(t,{model:null,enum:1319,output:2000,thinking:1500,visible:1000}),ledger=path.join(f.data,'ledger.json');let saved=JSON.parse(await fs.readFile(ledger));
 // Simulate a 0.3-era ledger as provided by the user's screenshot, not a real user DB.
 saved.events[0].model='antigravity-model-id-1319';saved.events[0].rawModel='';saved.events[0].parserVersion=1;saved.events[0].numericModelId=1319;saved.events[0].output=2500;saved.events[0].total=17500;saved.events[0].warnings=['antigravity-output-breakdown-conflict','antigravity-model-conflict'];saved.events[0].price=priceEvent(saved.events[0]);delete saved.events[0].price.engineVersion;delete saved.repairs;delete saved.journalSequence;Object.values(saved.files).forEach(c=>{delete c.parserVersion;});
 await fs.rm(f.c.journal.directory,{recursive:true});const bytes=JSON.stringify(saved);await fs.writeFile(ledger,bytes);const c=await new Collector(f.data).init();await c.scan();const e=[...c.events.values()][0];assert.equal(e.model,'gemini-3.8-flash');assert.equal(e.output,2000);assert.equal(e.price.totalPico,'15375000000');assert.ok(!e.warnings.includes('antigravity-model-conflict'));assert.equal(await fs.readFile(path.join(f.data,'ledger.pre-0.5.0.json'),'utf8'),bytes);assert.ok(c.journal.latest.get(e.id).revision>=2);
 const again=await new Collector(f.data).init();await again.scan();assert.equal(again.events.size,1);assert.equal(again.journal.status().lines,c.journal.status().lines);
});
test('Health is not published half-empty during a slow scan',async t=>{
 const f=await prepared(t),prior=f.c.health;const walk=f.c.walk.bind(f.c);let unlock;const wait=new Promise(r=>unlock=r);f.c.walk=async(...args)=>{await wait;return walk(...args);};const promise=f.c.scan();await new Promise(r=>setTimeout(r,10));assert.equal(f.c.health,prior);assert.equal(f.c.health.antigravity.status,'observed');unlock();await promise;
});
test('History pages traverse more than 100 retained requests without dropping or repeating IDs',async t=>{
 const f=await fixture(t);await f.write('claude','many.jsonl',Array.from({length:137},(_,i)=>claudeRow({id:'p'+String(i).padStart(3,'0'),time:'2026-09-25T08:00:00Z'})));await f.c.scan();let cursor,ids=[];do{const result=history(f.c,{scope:'all',limit:25,...(cursor?{cursor}:{})});ids.push(...result.records.map(e=>e.id));cursor=result.nextCursor;}while(cursor);assert.equal(ids.length,137);assert.equal(new Set(ids).size,137);assert.equal(f.c.journal.latest.size,137);
});
test('History filters are independent of the dashboard range and reject mismatched cursor filters',async t=>{
 const f=await fixture(t);await f.write('claude','history.jsonl',[claudeRow({id:'a',time:'2026-09-24T00:00:00Z'}),claudeRow({id:'b',time:'2026-09-25T00:00:00Z'}),claudeRow({id:'c',time:'2026-09-25T01:00:00Z',model:'unpriced-new-model'})]);await f.c.scan();assert.equal(history(f.c).totalMatching,3);assert.equal(history(f.c,{from:'2026-09-25',to:'2026-09-25'}).totalMatching,2);assert.equal(history(f.c,{priceStatus:'incomplete'}).totalMatching,1);assert.equal(history(f.c,{search:'unpriced-new-model'}).totalMatching,1);const first=history(f.c,{limit:1});assert.throws(()=>history(f.c,{limit:1,provider:'claude',cursor:first.nextCursor}),/필터/);assert.throws(()=>history(f.c,{from:'2026-02-30'}),/날짜/);assert.throws(()=>history(f.c,{limit:0}),/크기/);
});
test('History keyset cursor does not repeat requests when newer observations arrive',async t=>{
 const f=await fixture(t);await f.write('claude','a.jsonl',Array.from({length:3},(_,i)=>claudeRow({id:'same'+i})));await f.c.scan();const one=history(f.c,{limit:1});await f.write('claude','b.jsonl',[claudeRow({id:'newer',time:'2026-09-25T10:00:00Z'})]);await f.c.scan();const next=history(f.c,{limit:10,cursor:one.nextCursor});assert.ok(!next.records.some(r=>r.id===one.records[0].id));assert.equal(next.returned,2);
});
test('Latest-only history exports include all matching requests, price reasons and no prompts',async t=>{
 const f=await prepared(t,{model:null,enum:98765});const jsonl=exportHistory(f.c,{},'jsonl'),csv=exportHistory(f.c,{},'csv');assert.ok(!jsonl.includes(SENTINEL));assert.equal(jsonl.trim().split('\n').length,1);const row=JSON.parse(jsonl.trim());assert.equal(row.schema,'token-meter.usage.latest.v1');assert.equal(row.totalUsd,null);assert.ok(csv.includes('priceReasons'));assert.ok(csv.includes('모델 ID'));
});
test('History endpoints require local auth and expose pricing evidence, storage and stable queries',async t=>{
 const f=await fixture(t);await f.write('claude','api.jsonl',[claudeRow()]);const app=await startServer({dataDir:f.data});t.after(()=>app.close());const base=app.runtime.origin,headers={Authorization:'Bearer '+app.runtime.token};
 assert.equal((await fetch(base+'/api/history')).status,401);assert.equal((await fetch(base+'/api/history',{headers:{...headers,Origin:'https://evil.test'}})).status,403);
 const result=await(await fetch(base+'/api/history',{headers})).json();assert.equal(result.totalStored,1);assert.equal(result.storage.uniqueRequests,1);const detail=await(await fetch(base+'/api/history/detail?id='+encodeURIComponent(result.records[0].id),{headers})).json();assert.ok(detail.pricing.components.length);assert.ok(!JSON.stringify(detail).includes(SENTINEL));assert.equal((await fetch(base+'/api/history?from=invalid',{headers})).status,400);
 const csv=await(await fetch(base+'/api/history/export.csv',{headers})).text();assert.ok(csv.includes('priceStatus'));assert.equal((await fetch(base+'/api/antigravity/reanalyse',{headers,method:'POST',body:'{}'})).status,200);
});
