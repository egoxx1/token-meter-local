'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fixture,claudeRow}=require('./helpers'),{startServer}=require('../src/server');
async function setup(t){const f=await fixture(t);await f.write('claude','c.jsonl',[claudeRow()]);const s=await startServer({dataDir:f.data});t.after(()=>s.close());const call=(url,body,headers={})=>fetch(s.runtime.origin+url,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+s.runtime.token,...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});return {...f,...s,call,post:async(u,b)=>(await call(u,b)).json()};}
test('Measurement endpoints require auth and same-origin for reads and writes',async t=>{
 const a=await setup(t);for(const path of ['/api/measurements','/api/measurements/export.json?ids=x'])assert.equal((await fetch(a.runtime.origin+path)).status,401);
 assert.equal((await a.call('/api/measurements/reset',{filter:{}},{Origin:'https://attacker.test'})).status,403);assert.equal(a.collector.measurements.state.runs.length,0);
});
test('HTTP reset exposes zero measurement, leaves raw summary unchanged, supports pinned status and undo',async t=>{
 const a=await setup(t),r=await a.post('/api/measurements/reset',{filter:{provider:'claude'}});assert.ok(r.id);assert.equal(r.summary.total,0);
 let d=await(await a.call('/api/status?scope=all')).json();assert.equal(d.summary.total,165);
 await a.post('/api/measurements/pin',{id:r.id});d=await(await a.call('/api/status?scope=all&followPinned=1')).json();assert.equal(d.scope,'measurement');assert.equal(d.summary.total,0);assert.equal(d.measurement.id,r.id);
 d=await(await a.call('/api/status?scope=all&includeMeasurements=1')).json();assert.equal(d.measurements.runs.length,1);assert.equal(d.summary.total,165);assert.ok(d.measurements.runs.every(r=>!Object.hasOwn(r,'baseline')));
 await a.post('/api/measurements/undo',{});assert.equal(a.collector.measurements.state.pinnedId,null);
});
test('HTTP measurement scope exports delta events not whole cumulative events',async t=>{
 const a=await setup(t),r=await a.post('/api/measurements/start',{name:'test'});await a.write('claude','next.jsonl',[claudeRow({id:'new',time:new Date(Date.now()+2).toISOString()})]);await a.post('/api/scan',{});
 const d=await(await a.call('/api/export.json?scope=measurement&measurement='+r.id)).json();assert.equal(d.events.length,1);assert.equal(d.events[0].input,145);assert.equal(d.events[0].measurementDelta,true);
 const raw=await(await a.call('/api/status?scope=all')).json();assert.equal(raw.summary.records,2);
});
test('HTTP compare/export retains separate input/output/total values with safe CSV names',async t=>{
 const a=await setup(t),r=await a.post('/api/measurements/start',{name:'=unsafe name',notes:'<script>text</script>'});
 const v=await(await a.call('/api/measurements/export.json?ids='+r.id)).json();assert.equal(v.runs.length,1);assert.equal(v.runs[0].notes,'<script>text</script>');assert.equal(v.runs[0].summary.measured,true);
 const csv=await(await a.call('/api/measurements/export.csv?ids='+r.id)).text();assert.match(csv,/'=unsafe/);assert.ok(csv.includes('inputUsd'));
});
test('HTTP invalid IDs and immutable filter edits fail without resetting other records',async t=>{
 const a=await setup(t),r=await a.post('/api/measurements/start',{name:'original'});assert.equal((await a.call('/api/measurements/update',{id:r.id,filter:{}})).status,400);assert.equal((await a.call('/api/measurements/stop',{id:'bad'})).status,400);assert.equal((await a.call('/api/measurements/export.json?ids=bad')).status,400);assert.equal((await a.call('/api/measurements/pin',{id:'bad'})).status,400);assert.equal(a.collector.events.size,1);
});
test('Static measurement script is served with CSP but contains no local access secret',async t=>{
 const a=await setup(t),res=await fetch(a.runtime.origin+'/measurements.js');assert.equal(res.status,200);assert.match(res.headers.get('content-type'),/javascript/);assert.ok(!(await res.text()).includes(a.runtime.token));assert.ok(res.headers.get('content-security-policy').includes("script-src 'self'"));
});
test('End API is idempotent and only metadata can be edited afterward',async t=>{
 const a=await setup(t),r=await a.post('/api/measurements/start',{name:'test'}),end=await a.post('/api/measurements/stop',{id:r.id});assert.equal(end.status,'ended');assert.equal((await a.post('/api/measurements/stop',{id:r.id})).end,end.end);
 const u=await a.post('/api/measurements/update',{id:r.id,name:'changed',outcome:'pass',notes:'user judgement'});assert.equal(u.outcome,'pass');assert.equal(u.summary.total,0);
});
