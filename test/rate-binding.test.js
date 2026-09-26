'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path');
const {initial,parse}=require('../src/parsers');
const {priceEvent,selectRate,validateRules}=require('../src/pricing');
const {codexRows,fixture}=require('./helpers');
function event(model='gpt-6-sol',changes={}){const state=initial('codex','x');return {...codexRows({model}).flatMap(r=>parse('codex',r,state))[0],...changes};}
test('Wrong-model frozen tariff is rejected, not relabeled to the detected model',()=>{
 const a=event('gpt-6-sol'),b=event('gpt-6-luna');const p=priceEvent(b,[],priceEvent(a).rate);
 assert.equal(p.rate.input,.1);assert.equal(p.rate.output,.5);assert.equal(p.binding.rejected.reasonCodes.includes('model-mismatch'),true);
 assert.equal(p.binding.tariffModel,'gpt-6-luna');
});
test('Saved tariff cannot cross billing provider even for the identical model name',()=>{
 const a=event(),b={...a,provider:'generic',modelProvider:'openrouter',modality:'text'};const p=priceEvent(b,[],priceEvent(a).rate);
 assert.equal(p.rate,null);assert.ok(p.binding.rejected.reasonCodes.includes('provider-mismatch'));
});
test('Frozen Fast tariff is not silently reused as Standard',()=>{
 const a=event('gpt-6-sol',{serviceTier:'fast'}),b=event();const p=priceEvent(b,[],priceEvent(a).rate);
 assert.equal(p.rate.input,2);assert.equal(p.rate.output,10);
});
test('Frozen tariff validity dates are checked after a timestamp is corrected',()=>{
 const a=event('gemini-3.8-flash',{provider:'antigravity',modelProvider:'google',timestamp:'2026-09-25T10:00:00Z'});
 const b={...a,timestamp:'2027-01-01T01:00:00Z'};const p=priceEvent(b,[],priceEvent(a).rate);
 assert.equal(p.rate.input,1.5);assert.equal(p.rate.output,7.5);
});
test('Tool-scoped custom prices do not leak to another tool via a matching billing provider',()=>{
 const rules=validateRules({rules:[{provider:'codex',modelProvider:'openai',models:['gpt-6-sol'],input:99,output:999,cacheRead:9}]});
 assert.equal(selectRate(event(),rules).input,99);
 assert.equal(selectRate(event('gpt-6-sol',{provider:'generic',modality:'text'}),rules).input,2);
});
test('Explicit wildcard user tariff remains applicable across tools for its billing provider',()=>{
 const rules=validateRules({rules:[{provider:'*',modelProvider:'openai',models:['gpt-6-sol'],input:99,output:999,cacheRead:9}]});
 assert.equal(selectRate(event('gpt-6-sol',{provider:'generic',modality:'text'}),rules).input,99);
});
test('Forged resolvedModel cannot conceal a different base tariff identity',()=>{
 const a=priceEvent(event('gpt-6-sol')).rate;a.resolvedModel='gpt-6-luna';const p=priceEvent(event('gpt-6-luna'),[],a);
 assert.equal(p.rate.input,.1);assert.ok(p.binding.rejected);
});
test('A saved local-free tariff is refused for an unconfirmed remote invocation',()=>{
 const a=event('example-local',{provider:'generic',modelProvider:'ollama',modality:'text',local:true});const p=priceEvent({...a,local:false},[],priceEvent(a).rate);
 assert.equal(p.rate,null);assert.equal(p.totalPico,null);
});
test('Unrecognized models do not get the previously selected model tariff',()=>{
 const p=priceEvent(event('unknown-model'),[],priceEvent(event()).rate);assert.equal(p.rate,null);assert.equal(p.totalPico,null);
});
test('Valid historical same-model custom rate remains frozen when today catalog changes',()=>{
 const a=event(),r=validateRules({rules:[{provider:'codex',models:[a.model],input:4,output:21,cacheRead:.1,cacheWrite:5}]});const saved=priceEvent(a,r).rate;
 const p=priceEvent(a,[],saved);assert.equal(p.rate.input,4);assert.equal(p.binding.status,'matched');assert.equal(p.binding.rejected,null);
});
test('Matched date alias exposes actual tariff model rather than overwriting it with request label',()=>{
 const e=event('gpt-6-sol-2026-09-24');const p=priceEvent(e);
 assert.equal(p.binding.eventModel,e.model);assert.equal(p.binding.tariffModel,'gpt-6-sol');assert.equal(p.binding.matchKind,'date-alias');
});
test('Collector upgrades inconsistent v3 tariffs with backup and revision, preserving usage totals',async t=>{
 const fx=await fixture(t),e=event('gpt-6-luna');e.price=priceEvent(event('gpt-6-sol'));e.price.engineVersion=3;
 fx.c.events.set(e.id,e);await fx.c.save();
 const file=path.join(fx.data,'ledger.json'),data=JSON.parse(await fs.readFile(file));delete data.repairs.rateBindingV1;await fs.writeFile(file,JSON.stringify(data));
 const {Collector}=require('../src/collector');const c=await new Collector(fx.data).init();const fixed=c.events.get(e.id);
 assert.equal(fixed.price.rate.input,.1);assert.equal(fixed.input,e.input);assert.equal(fixed.output,e.output);
 assert.equal(fixed.price.binding.status,'matched');assert.ok(await fs.stat(path.join(fx.data,'ledger.pre-0.7.1.json')));
 const seq=c.journal.sequence;const again=await new Collector(fx.data).init();assert.equal(again.journal.sequence,seq);
});
test('Price detail and rate view identify the tariff rule, not only the copied display name',()=>{
 const e=event('gpt-6-sol-2026-09-24');e.price=priceEvent(e);
 const {priceDetails}=require('../src/pricing'),{rateView}=require('../src/input-breakdown');
 assert.equal(priceDetails(e).rateModel,'gpt-6-sol');assert.equal(rateView(e).model,e.model);assert.equal(rateView(e).tariffModel,'gpt-6-sol');
});
test('Rate view refuses to present inconsistent saved tariff as a verified model price',()=>{
 const e=event('gpt-6-luna');e.price=priceEvent(event('gpt-6-sol'));
 const v=require('../src/input-breakdown').rateView(e);assert.equal(v.available,false);assert.equal(v.binding.status,'mismatch');
});
test('Updated request context at equal token totals recalculates the appropriate context band',async t=>{
 const {c}=await fixture(t);c.scanStats={upserts:0,invalidUsage:0};const e=event('gpt-6-sol');c.insert({...e,contextInput:100000});
 c.insert({...e,contextInput:300000});assert.equal(c.events.get(e.id).price.rate.input,4);assert.equal(c.events.get(e.id).price.rate.output,15);
});
test('Read-only audit flags identity mismatch without modifying ledger or exposing bodies',async t=>{
 const {c}=await fixture(t),e=event('gpt-6-luna');e.price=priceEvent(event('gpt-6-sol'));e.prompt='NEVER_EXPORT_BODY';c.events.set(e.id,e);
 const before=JSON.stringify(e),audit=require('../src/rate-audit').auditRates(c);assert.equal(audit.counts.mismatch,1);assert.equal(audit.complete,true);
 assert.equal(JSON.stringify(e),before);assert.equal(JSON.stringify(audit).includes('NEVER_EXPORT_BODY'),false);
});
test('Audit distinguishes explicit historical/custom prices from identity errors',async t=>{
 const {c}=await fixture(t),e=event(),rules=validateRules({rules:[{provider:'codex',models:[e.model],input:4,output:20}]});e.price=priceEvent(e,rules);c.events.set(e.id,e);
 const report=require('../src/rate-audit').auditRates(c);assert.equal(report.counts.matched,1);assert.equal(report.counts.mismatch,0);assert.equal(report.counts.userOverrides,1);assert.equal(report.counts.differentFromCatalog,1);
});
test('Authenticated audit API is read-only and rejects unauthenticated requests',async t=>{
 const {data}=await fixture(t),{startServer}=require('../src/server'),{request,runtime}=require('../src/client');
 const server=await startServer({dataDir:data});t.after(()=>server.close());const r=await runtime(data);
 assert.equal((await fetch(r.origin+'/api/pricing/audit')).status,401);
 const report=await request(data,'/api/pricing/audit');assert.equal(report.schema,'token-meter.rate-audit.v1');assert.equal(report.counts.mismatch,0);
 assert.equal((await fetch(r.origin+'/api/pricing/audit',{method:'POST',headers:{Authorization:'Bearer '+r.token}})).status,404);
});
test('A timestamp-only correction crosses an explicit price validity boundary',async t=>{
 const {c}=await fixture(t);c.scanStats={upserts:0,invalidUsage:0};
 const e=event('gemini-3.8-flash',{provider:'generic',modelProvider:'google',modality:'text',timestamp:'2026-09-25T00:00:00Z'});
 c.insert(e);assert.equal(c.events.get(e.id).price.rate.input,.75);
 c.insert({...e,timestamp:'2027-01-02T00:00:00Z'});assert.equal(c.events.get(e.id).price.rate.input,1.5);
});
test('Audit evidence survives usage journal serialization and restart',async t=>{
 const fx=await fixture(t),e=event('gpt-6-luna');e.price=priceEvent(e,[],priceEvent(event()).rate);fx.c.events.set(e.id,e);await fx.c.save();
 const {UsageLog}=require('../src/usage-log');const log=await new UsageLog(fx.data).init(),p=log.latest.get(e.id).event.price;
 assert.equal(p.rate.matchedModel,'gpt-6-luna');assert.equal(p.binding.rejected.tariffModels[0],'gpt-6-sol');
});
