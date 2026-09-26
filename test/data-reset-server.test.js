'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs/promises'),path=require('node:path');
const {fixture,claudeRow}=require('./helpers'),{startServer}=require('../src/server');
async function setup(t){const f=await fixture(t);await f.write('claude','r.jsonl',[claudeRow()]);const app=await startServer({dataDir:f.data});t.after(()=>app.close());const call=(u,b,h={})=>fetch(app.runtime.origin+u,{method:b===undefined?'GET':'POST',headers:{Authorization:'Bearer '+app.runtime.token,'Content-Type':'application/json',...h},...(b===undefined?{}:{body:JSON.stringify(b)})});const api=async(u,b)=>{const r=await call(u,b);const data=await r.json();assert.equal(r.status,200,JSON.stringify(data));return data;};return{...f,...app,call,api};}
const resetBody=epoch=>({confirmation:'전체 초기화',expectedEpochId:epoch,requestKey:crypto.randomUUID()});
test('Destructive HTTP APIs require bearer auth and allowed Origin/Host',async t=>{
 const a=await setup(t);for(const u of ['/api/data/state','/api/data/reset','/api/measurements/delete'])assert.equal((await fetch(a.runtime.origin+u,{method:u.endsWith('state')?'GET':'POST',body:u.endsWith('state')?undefined:'{}'})).status,401);
 assert.equal((await a.call('/api/data/reset',resetBody('legacy'),{Origin:'https://attacker.test'})).status,403);const status=await new Promise((resolve,reject)=>{const u=new URL(a.runtime.origin);const req=require('node:http').request({hostname:u.hostname,port:u.port,path:'/api/measurements/delete',method:'POST',headers:{Host:'example.com',Authorization:'Bearer '+a.runtime.token}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.end(JSON.stringify({all:true,confirmation:'측정 전체 삭제'}));});assert.equal(status,403);assert.equal(a.collector.events.size,1);
});
test('HTTP delete removes active/pinned card, frees pin and stale selected view falls back to cumulative',async t=>{
 const a=await setup(t),m=await a.api('/api/measurements/start',{name:'delete me'});await a.api('/api/measurements/pin',{id:m.id});
 const d=await a.api('/api/measurements/delete',{ids:[m.id],confirmation:'삭제'});assert.equal(d.deleted,1);
 const s=await a.api('/api/status?scope=measurement&measurement='+m.id+'&includeMeasurements=1');assert.equal(s.scope,'all');assert.match(s.selectionNotice,/삭제/);assert.equal(s.summary.total,165);assert.equal(s.measurements.pinnedId,null);assert.equal(s.measurements.runs.length,0);
});
test('HTTP reset rejects weak confirmation and returns new active storage and empty usage/history',async t=>{
 const a=await setup(t);await a.api('/api/measurements/start',{name:'a'});assert.equal((await a.call('/api/data/reset',{})).status,400);
 const result=await a.api('/api/data/reset',resetBody('legacy'));assert.notEqual(result.epochId,'legacy');assert.equal(result.requestCount,0);assert.equal(result.measurementCount,0);
 const d=await a.api('/api/status?scope=all');assert.equal(d.summary.total,0);assert.equal(d.summary.measured,true);assert.equal(d.storage.uniqueRequests,0);assert.equal(d.dataState.epochId,result.epochId);
 const history=await a.api('/api/history');assert.equal(history.records.length,0);
 const config=await a.api('/api/config');assert.equal(config.dataDir,a.data);
});
test('Concurrent reset retry with the same key is idempotent and does not create two epochs',async t=>{
 const a=await setup(t),body=resetBody('legacy');const results=await Promise.all([a.call('/api/data/reset',body),a.call('/api/data/reset',body)]);
 // A racing request may be explicitly told to retry while the first reset runs.
 for(const r of results)assert.ok([200,503].includes(r.status));const d=await a.api('/api/data/reset',body);assert.equal(d.reused,true);assert.equal((await fs.readdir(path.join(a.data,'data-epochs'))).length,1);
});
test('Full reset followed by usage submission persists a new journal, not old backup history',async t=>{
 const a=await setup(t);const d=await a.api('/api/data/reset',resetBody('legacy'));
 await a.write('claude','new.jsonl',[claudeRow({id:'new',time:new Date(Date.now()+5).toISOString()})]);await a.api('/api/scan',{});
 assert.equal((await a.api('/api/status?scope=all')).summary.total,165);assert.equal(a.collector.journal.latest.size,1);assert.ok(a.collector.journal.directory.startsWith(d.storageDirectory));assert.equal(JSON.parse(await fs.readFile(path.join(a.data,'ledger.json'))).events.length,1);
});
test('Deleting measurements from another client while pinned leaves status and exports coherent',async t=>{
 const a=await setup(t);const x=await a.api('/api/measurements/start',{name:'x'});await a.api('/api/measurements/pin',{id:x.id});await a.api('/api/measurements/delete',{all:true,confirmation:'측정 전체 삭제'});
 const d=await a.api('/api/status?scope=all&followPinned=1');assert.equal(d.scope,'all');assert.equal(d.summary.total,165);assert.equal((await a.call('/api/measurements/export.json?ids='+x.id)).status,400);
});
test('Delete and reset handlers do not accept GET side effects or unsupported DELETE methods',async t=>{
 const a=await setup(t);assert.equal((await a.call('/api/data/reset')).status,404);assert.equal((await a.call('/api/measurements/delete')).status,404);assert.equal((await fetch(a.runtime.origin+'/api/data/reset',{method:'DELETE',headers:{Authorization:'Bearer '+a.runtime.token}})).status,405);assert.equal(a.collector.events.size,1);
});
test('New data control script is served locally, without inline secrets or external scripts',async t=>{
 const a=await setup(t);const r=await fetch(a.runtime.origin+'/data-controls.js');assert.equal(r.status,200);const content=await r.text();assert.ok(!content.includes(a.runtime.token));assert.match(content,/전체 초기화/);assert.match(r.headers.get('content-security-policy'),/script-src 'self'/);
});

test('Deleted measurement export must fail rather than silently export unrelated cumulative usage',async t=>{
 const a=await setup(t);const m=await a.api('/api/measurements/start',{name:'restricted scope'});await a.api('/api/measurements/delete',{ids:[m.id],confirmation:'삭제'});
 for(const suffix of ['csv','json'])assert.equal((await a.call('/api/export.'+suffix+'?scope=measurement&measurement='+m.id)).status,400);
 const line=await a.call('/api/line?scope=measurement&measurement='+m.id);assert.equal(line.status,200);
});

test('Deleting 500 selected measurements fits the bounded deletion HTTP payload',async t=>{
 const a=await setup(t),m=await a.api('/api/measurements/start',{name:'clone fixture'});
 const source=a.collector.measurements.get(m.id);a.collector.measurements.state.runs=Array.from({length:500},()=>({...structuredClone(source),id:crypto.randomUUID(),status:'ended',end:source.start,result:{events:[],diagnostics:[]}}));
 const ids=a.collector.measurements.state.runs.map(r=>r.id);const result=await a.api('/api/measurements/delete',{ids,confirmation:'삭제'});assert.equal(result.deleted,500);assert.equal(a.collector.events.size,1);
});
