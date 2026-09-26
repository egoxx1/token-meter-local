'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {fixture,claudeRow,codexRows}=require('./helpers');
const {Measurements,filterOf,matches,LIMITS}=require('../src/measurements');
const {Collector}=require('../src/collector');
const {atomicJson}=require('../src/util');
const {summarize,statusLine}=require('../src/summary');
const {normalize}=require('../src/generic');
const RULE={provider:'generic',modelProvider:'openai',models:['meter-model'],tier:'standard',input:1,output:2,cacheRead:.1,cacheWrite:1.25,source:'synthetic-test-rate',asOf:'2026-09-25'};
const T0='2026-09-25T10:00:00.000Z',OLD='2026-09-25T09:00:00.000Z',NEW='2026-09-25T10:00:01.000Z';
function usage(id='a',input=100,output=20,options={}){return {schema:'token-meter.usage.v1',format:'normalized',modelProvider:'openai',model:'meter-model',modality:'text',requestId:id,project:'/projects/site',timestamp:NEW,usage:{input,output},...options};}
async function setup(t){const f=await fixture(t);await atomicJson(path.join(f.data,'prices.user.json'),{rules:[RULE]});await f.c.scan();let time=T0;const m=await new Measurements(f.c,{clock:()=>time}).init();return {...f,m,clock:x=>time=x,add:r=>f.c.ingest(r),run:id=>m.view(m.get(id))};}
test('Meter filters are strict, route-specific and distinguish empty effort from wildcard',()=>{
 assert.deepEqual(filterOf({provider:'all'}),{});assert.throws(()=>filterOf({provider:'bogus'}));assert.throws(()=>filterOf({path:'/'}));assert.throws(()=>filterOf({model:3}));
 const e={provider:'codex',model:'m',effort:'high'};assert.equal(matches(e,{effort:''}),false);assert.equal(matches(e,{}),true);assert.equal(matches(e,{modelProvider:'openai'}),true);
});
test('Reset stores a baseline without deleting cumulative usage; explicit meter begins at zero',async t=>{
 const f=await setup(t);await f.add(usage('a',100,20,{timestamp:OLD}));const raw=summarize(f.c,{scope:'all'}).summary;
 const r=await f.m.start({filter:{provider:'generic'}},true);assert.equal(r.summary.total,0);assert.equal(r.summary.measured,true);assert.deepEqual(summarize(f.c,{scope:'all'}).summary,raw);
 const d=summarize(f.c,{scope:'measurement',measurement:r.id});assert.match(statusLine(d),/IN 0 tok \/ \$0.000/);assert.match(statusLine(d),/TOTAL 0 tok/);
});
test('New requests carry separate input/output prices and exact total tokens',async t=>{
 const f=await setup(t),r=await f.m.start({name:'task'});await f.add(usage());const s=f.run(r.id).summary;
 assert.equal(s.input,100);assert.equal(s.output,20);assert.equal(s.total,120);assert.equal(s.inputUsd,.0001);assert.equal(s.outputUsd,.00004);assert.equal(s.knownTotalPico,'140000000');
});
test('Streaming request existing at the boundary contributes only subsequent deltas',async t=>{
 const f=await setup(t);await f.add(usage('a',100,20,{timestamp:OLD}));const r=await f.m.start({name:'stream'});await f.add(usage('a',150,50,{timestamp:OLD}));const v=f.run(r.id);
 assert.equal(v.summary.input,50);assert.equal(v.summary.output,30);assert.equal(v.summary.total,80);assert.equal(v.detail.partialRequests,1);assert.equal(v.summary.totalUsd,.00011);
});
test('Late-discovered old requests are excluded, not charged to the new measurement',async t=>{
 const f=await setup(t),r=await f.m.start({name:'late'});await f.add(usage('late',100,20,{timestamp:OLD}));assert.equal(f.run(r.id).summary.total,0);assert.equal(f.run(r.id).detail.lateOld,1);
});
test('New undated records are excluded explicitly rather than assigned file modification time',async t=>{
 const f=await setup(t),r=await f.m.start({name:'undated'});const e=normalize(usage());e.timestamp=null;f.c.insert(e);const v=f.run(r.id);assert.equal(v.summary.total,0);assert.equal(v.detail.undated,1);
});
test('Repricing an existing request without new tokens never creates measured spend',async t=>{
 const f=await setup(t);await f.add(usage('a',100,20,{timestamp:OLD,model:'new-unpriced'}));const r=await f.m.start({name:'price'});
 const rule={...RULE,models:['new-unpriced']};await atomicJson(path.join(f.data,'prices.user.json'),{rules:[RULE,rule]});await f.c.scan();assert.ok([...f.c.events.values()][0].price.rate);
 assert.equal(f.run(r.id).summary.total,0);assert.equal(f.run(r.id).summary.totalUsd,0);
});
test('Cache reclassification without new tokens is ignored',async t=>{
 const f=await setup(t);await f.add(usage('a',100,20,{timestamp:OLD}));const r=await f.m.start({name:'cache'});
 await f.add(usage('a',100,20,{timestamp:OLD,usage:{input:100,output:20,cacheRead:40}}));assert.equal(f.run(r.id).summary.total,0);
});
test('Ambiguous cache delta preserves input counts but makes input price unknown, output stays priced',async t=>{
 const f=await setup(t);await f.add(usage('a',100,20,{timestamp:OLD}));const r=await f.m.start({name:'cache correction'});
 await f.add(usage('a',150,50,{timestamp:OLD,usage:{input:150,output:50,cacheRead:80}}));const v=f.run(r.id);assert.equal(v.summary.input,50);assert.equal(v.summary.output,30);assert.equal(v.summary.inputUsd,null);assert.equal(v.summary.outputUsd,.00006);assert.equal(v.detail.inputBreakdownUnknown,1);
});
test('Delta costs use full request context tier rather than the small delta context',async t=>{
 const f=await setup(t);await atomicJson(path.join(f.data,'prices.user.json'),{rules:[{...RULE,longContext:{above:100,inputMultiplier:2,outputMultiplier:2}}]});await f.c.scan();
 await f.add(usage('a',150,20,{timestamp:OLD}));const r=await f.m.start({name:'long'});await f.add(usage('a',160,30,{timestamp:OLD}));const v=f.run(r.id);assert.equal(v.summary.inputUsd,.00002);assert.equal(v.summary.outputUsd,.00004);
});
test('Unpriced models stay unpriced instead of becoming free',async t=>{
 const f=await setup(t),r=await f.m.start({name:'unknown'});await f.add(usage('a',100,20,{model:'unsupported'}));const v=f.run(r.id);assert.equal(v.summary.inputUsd,null);assert.equal(v.summary.outputUsd,null);assert.equal(v.summary.totalUsd,null);
});
test('End freezes counts, prices and groups; later collection cannot change result',async t=>{
 const f=await setup(t),r=await f.m.start({name:'frozen'});await f.add(usage());f.clock('2026-09-25T10:01:00.000Z');const ended=await f.m.stop(r.id);await f.add(usage('a',300,80));await f.add(usage('b',500,20));
 assert.deepEqual(f.run(r.id),ended);assert.equal(f.run(r.id).summary.total,120);assert.equal(ended.elapsedMs,60000);assert.equal((await f.m.stop(r.id)).end,ended.end);
});
test('Exact model, effort, provider and role filters isolate parallel measurements',async t=>{
 const f=await setup(t),a=await f.m.start({name:'high main',filter:{provider:'generic',modelProvider:'openai',model:'meter-model',effort:'high',role:'main'}}),b=await f.m.start({name:'other',filter:{effort:'low'}});
 await f.add(usage('a',100,20,{effort:'high'}));await f.add(usage('b',200,20,{effort:'low'}));await f.add(usage('c',300,20,{effort:'high',role:'subagent'}));await f.add(usage('d',400,20,{effort:'high',modelProvider:'other'}));
 assert.equal(f.run(a.id).summary.total,120);assert.equal(f.run(b.id).summary.total,220);
});
test('Reset archives previous baseline; undo restores the previous active baseline with intervening deltas',async t=>{
 const f=await setup(t),a=await f.m.start({filter:{provider:'generic'}},true);await f.m.pin(a.id);await f.add(usage());
 f.clock('2026-09-25T10:02:00.000Z');const b=await f.m.start({filter:{provider:'generic'}},true);assert.equal(f.run(a.id).status,'ended');assert.equal(f.m.state.pinnedId,b.id);assert.equal(f.run(b.id).summary.total,0);
 await f.add(usage('b',200,30,{timestamp:'2026-09-25T10:02:01.000Z'}));await f.m.undo();assert.equal(f.run(a.id).status,'running');assert.equal(f.run(a.id).summary.total,350);assert.equal(f.run(b.id).status,'cancelled');assert.equal(f.m.state.pinnedId,a.id);await assert.rejects(()=>f.m.undo(),/취소할/);
});
test('Undo initial reset leaves a cancelled result, never deletes raw events',async t=>{
 const f=await setup(t),r=await f.m.start({filter:{}},true);await f.add(usage());await f.m.undo();assert.equal(f.run(r.id).status,'cancelled');assert.equal(f.c.events.size,1);
});
test('Reset and named measurement baselines persist through restart',async t=>{
 const f=await setup(t);await f.add(usage('a',100,20,{timestamp:OLD}));const r=await f.m.start({name:'persist'});await f.m.pin(r.id);await f.add(usage('a',200,50,{timestamp:OLD}));
 const c=await new Collector(f.data).init(),m=await new Measurements(c,{clock:()=>T0}).init();assert.equal(m.state.pinnedId,r.id);assert.equal(m.view(m.get(r.id)).summary.total,130);
});
test('Repeated request key is idempotent even with concurrent requests',async t=>{
 const f=await setup(t),[a,b]=await Promise.all([f.m.start({name:'same',requestKey:'same-key'}),f.m.start({name:'same',requestKey:'same-key'})]);assert.equal(a.id,b.id);assert.equal(f.m.state.runs.length,1);
});
test('Simultaneous reset writes are serialized and preserve all measurement history',async t=>{
 const f=await setup(t);await Promise.all([f.m.start({filter:{provider:'codex'}},true),f.m.start({filter:{provider:'claude'}},true),f.m.start({filter:{provider:'antigravity'}},true)]);
 const saved=JSON.parse(await fs.readFile(path.join(f.data,'measurements.json'),'utf8'));assert.equal(saved.runs.length,3);assert.equal(f.m.state.runs.length,3);
});
test('Failed persistence rolls in-memory mutations back and leaves original measurements file intact',async t=>{
 const f=await setup(t);await f.m.start({name:'before'});const bytes=await fs.readFile(f.m.file);f.m.write=async()=>{throw new Error('disk-full-test');};
 await assert.rejects(()=>f.m.start({name:'after'}),/disk-full/);assert.equal(f.m.state.runs.length,1);assert.deepEqual(await fs.readFile(f.m.file),bytes);
});
test('Corrupt measurement data fails closed without overwriting file or ledger',async t=>{
 const f=await setup(t);await f.add(usage());await fs.writeFile(f.m.file,'{"version":999}');const bytes=await fs.readFile(path.join(f.data,'ledger.json'));
 await assert.rejects(()=>new Measurements(f.c).init(),/형식/);assert.equal(await fs.readFile(f.m.file,'utf8'),'{"version":999}');assert.deepEqual(await fs.readFile(path.join(f.data,'ledger.json')),bytes);
});
test('History edit, archive, restore and pin leave raw usage intact',async t=>{
 const f=await setup(t),r=await f.m.start({name:'history'});await f.add(usage());await assert.rejects(()=>f.m.update(r.id,{archived:true}),/종료/);await f.m.stop(r.id);await f.m.pin(r.id);
 await f.m.update(r.id,{name:'renamed',notes:'manual test pass',outcome:'pass',archived:true});assert.equal(f.m.state.pinnedId,null);await assert.rejects(()=>f.m.pin(r.id),/복원/);await f.m.update(r.id,{archived:false});assert.equal(f.run(r.id).outcome,'pass');assert.equal(f.c.events.size,1);
});
test('Budget alerts use known amounts and do not stop a running measurement',async t=>{
 const f=await setup(t),r=await f.m.start({name:'budget',budgetUsd:.0001});await f.add(usage());assert.equal(f.run(r.id).budgetExceeded,true);assert.equal(f.run(r.id).status,'running');
});
test('CSV/JSON exports include all six values, escape formulas, and omit baselines',async t=>{
 const f=await setup(t),r=await f.m.start({name:'=BAD()',notes:'@NOTE'});await f.add(usage());const json=f.m.export([r.id]);assert.equal(json.runs[0].summary.total,120);assert.ok(!JSON.stringify(json).includes('baseline'));assert.ok(f.m.csv([r.id]).includes("'=BAD()"));assert.ok(f.m.csv([r.id]).includes("'@NOTE"));for(const k of ['input','inputUsd','output','outputUsd','total','totalUsd'])assert.ok(f.m.csv([r.id]).split('\r\n')[0].includes(k));
});
test('Measurement API options reject invalid budgets, filters, edits and unknown IDs',async t=>{
 const f=await setup(t);for(const budgetUsd of [-1,0,Infinity,NaN,'1'])await assert.rejects(()=>f.m.start({name:'bad',budgetUsd}));await assert.rejects(()=>f.m.start({name:'bad',filter:{model:5}}));assert.throws(()=>f.m.export([]));assert.throws(()=>f.m.get('missing'));
 const r=await f.m.start({name:'x'});await assert.rejects(()=>f.m.update(r.id,{outcome:'auto-perfect'}));await assert.rejects(()=>f.m.update(r.id,{start:OLD}));assert.equal(f.run(r.id).start,T0);
});
test('All baseline identities prevent retroactive model reattribution from becoming new usage',async t=>{
 const f=await setup(t);await f.add(usage('a',100,20,{timestamp:OLD,model:'unknown-model'}));const r=await f.m.start({name:'attribute',filter:{model:'meter-model'}});await f.add(usage('a',100,20,{timestamp:OLD}));assert.equal(f.run(r.id).summary.total,0);
});
test('Counter regression is flagged, not subtracted from measured total',async t=>{
 const f=await setup(t);await f.add(usage('a',100,20,{timestamp:OLD}));const r=await f.m.start({name:'regress'}),e=[...f.c.events.values()][0];e.input=50;e.normalInput=50;e.output=10;e.total=60;const v=f.run(r.id);assert.equal(v.summary.total,0);assert.equal(v.detail.regressed,1);
});
test('Active meter cap refuses excess work without erasing anything',async t=>{
 const f=await setup(t);for(let i=0;i<LIMITS.active;i++)await f.m.start({name:'slot '+i});await assert.rejects(()=>f.m.start({name:'overflow'}),/12개/);assert.equal(f.m.state.runs.length,LIMITS.active);
});
test('Codex and Claude actual log parsers feed independent new measurements',async t=>{
 const f=await setup(t);const c=await f.m.start({name:'codex',filter:{provider:'codex'}}),a=await f.m.start({name:'claude',filter:{provider:'claude'}});
 await f.write('codex','c.jsonl',codexRows({time:NEW,input:500,output:50}));await f.write('claude','a.jsonl',[claudeRow({time:NEW,input:100,output:20})]);await f.c.scan();assert.equal(f.run(c.id).summary.total,550);assert.equal(f.run(a.id).summary.total,165);
});
test('Antigravity actual SQLite synthetic data can be reset without altering source DB',async t=>{
 const f=await setup(t),{database,generation}=require('./antigravity-fixtures');const r=await f.m.start({name:'antigravity',filter:{provider:'antigravity'}}),file=f.file('antigravity','conversation.db');database(file,[generation({time:NEW})]);const before=await fs.readFile(file);await f.c.scan();assert.equal(f.run(r.id).summary.input,15000);assert.equal(f.run(r.id).summary.output,2000);await f.m.start({filter:{provider:'antigravity'}},true);assert.deepEqual(await fs.readFile(file),before);assert.ok(!JSON.stringify(f.m.state).includes('PRIVATE_ANTIGRAVITY_PROMPT'));
});
test('Output-only streaming plus input-cache correction cannot introduce an input charge',async t=>{
 const f=await setup(t);await f.add(usage('a',100,20,{timestamp:OLD}));const r=await f.m.start({name:'output only'});
 await f.add(usage('a',100,30,{timestamp:OLD,usage:{input:100,output:30,cacheRead:40}}));const v=f.run(r.id);
 assert.equal(v.summary.input,0);assert.equal(v.summary.cacheRead,0);assert.equal(v.summary.inputUsd,0);assert.equal(v.summary.outputUsd,.00002);
});
