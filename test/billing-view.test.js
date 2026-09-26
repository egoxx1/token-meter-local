'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),vm=require('node:vm');
const {build,combine}=require('../src/billing-view');
const {aggregate,statusLine,exportCsv}=require('../src/summary');
const {priceEvent}=require('../src/pricing');
const {attachSplit}=require('../src/output-breakdown');
const {recordView,exportHistory}=require('../src/history');
const {fixture,codexRows,TIME}=require('./helpers');
const {Measurements}=require('../src/measurements');
const {startServer}=require('../src/server');
function event(p={}){
  const e={id:'synthetic-billing',provider:'codex',modelProvider:'openai',model:'gpt-6-sol',timestamp:TIME,
    sessionId:'codex:billing',projectId:'billing-test',project:'test',effort:'high',role:'main',serviceTier:'standard',warnings:[],
    normalInput:10000,cacheRead:5000,cacheWrite:2000,cacheWrite5m:0,cacheWrite1h:0,cacheWriteUnknown:2000,output:2000,
    cacheReadKnown:true,cacheWriteKnown:true,contextInputKnown:true,...p};
  e.input=e.normalInput+e.cacheRead+e.cacheWrite;e.total=e.input+e.output;e.contextInput=p.contextInput??e.input;
  attachSplit(e,{thinking:p.thinking??1500,source:'synthetic-accounting-test'});e.price=priceEvent(e);return e;
}
const item=(v,k)=>v.components.find(x=>x.key===k);
const sumPico=v=>v.components.reduce((n,c)=>n+BigInt(c.costPico??Math.round(c.costUsd*1e12)),0n);
test('Exactly four disjoint items: general, read, write, output; thinking is not a fifth charge',()=>{
  const s=aggregate([event()]),v=build(s);
  assert.deepEqual(v.components.map(x=>x.short),['IN','CACHE READ','CACHE WRITE','OUT']);
  assert.equal(v.components.reduce((n,x)=>n+x.tokens,0),s.total);assert.equal(v.reconciled,true);
  assert.equal(item(v,'normalInput').tokens,10000);assert.equal(s.input,17000);assert.equal(item(v,'output').tokens,2000);
  assert.equal(sumPico(v),BigInt(s.knownTotalPico));
});
test('Known zero write has zero spend but still shows its actual 100万-token tariff',()=>{
  const v=build(aggregate([event({cacheWrite:0,cacheWriteUnknown:0})])),w=item(v,'cacheWrite');
  assert.equal(w.tokens,0);assert.equal(w.costUsd,0);assert.equal(w.rates[0].usdPerMillion,2.5);assert.equal(w.partial,false);
});
test('Missing write counter is a reference zero, not evidence no writes occurred',()=>{
  const v=build(aggregate([event({cacheWrite:0,cacheWriteUnknown:0,cacheWriteKnown:false})]));
  assert.equal(item(v,'cacheWrite').tokens,0);assert.equal(item(v,'cacheWrite').partial,true);
  assert.match(item(v,'cacheWrite').notes.join(' '),/미기록.*0으로 확인한 것이 아님/);assert.equal(item(v,'normalInput').partial,true);
});
test('THINKING redistribution cannot alter OUT or overall price',()=>{
  const v1=build(aggregate([event({thinking:100})])),v2=build(aggregate([event({thinking:1900})]));
  assert.deepEqual(v1,v2);
});
test('Missing THINKING breakdown still keeps known OUT total and money',()=>{
  const e=event();attachSplit(e,{});e.price=priceEvent(e);const s=aggregate([e]),v=build(s);
  assert.equal(s.thinkingOutput,null);assert.equal(item(v,'output').tokens,2000);assert.equal(item(v,'output').costUsd,.02);
});
test('Model and period averages are never substituted for distinct tariffs',()=>{
  const v=build(aggregate([event(),event({id:'luna',model:'gpt-6-luna'})]));
  assert.deepEqual(item(v,'normalInput').rates.map(x=>x.usdPerMillion).sort((a,b)=>a-b),[.1,2]);
  assert.equal(v.components.reduce((n,x)=>n+x.tokens,0),v.total.tokens);
});
test('Claude TTL write buckets are one top-level item with separate detail rates',()=>{
  const e=event({provider:'claude',modelProvider:'anthropic',model:'claude-opus-5-5',cacheWrite:300,cacheWrite5m:100,cacheWrite1h:200,cacheWriteUnknown:0});
  const s=aggregate([e]),v=build(s),w=item(v,'cacheWrite');
  assert.equal(w.tokens,300);assert.equal(w.details.length,3);assert.deepEqual(w.rates.map(x=>x.label),['5분','1시간']);
  assert.equal(sumPico(v),BigInt(s.knownTotalPico));
});
test('Unknown-TTL write cost remains null without hiding known input/read/output amounts',()=>{
  const e=event({provider:'claude',modelProvider:'anthropic',model:'claude-opus-5-5'}),v=build(aggregate([e]));
  assert.equal(item(v,'cacheWrite').costUsd,null);assert.equal(v.total.costUsd,null);assert.equal(item(v,'normalInput').costUsd,.04);assert.equal(item(v,'output').costUsd,.04);
});
test('Unknown tariff with positive usage is not manufactured as free',()=>{
  const v=build(aggregate([event({model:'not-a-real-model'})]));
  assert.equal(item(v,'normalInput').costUsd,null);assert.equal(item(v,'output').costUsd,null);assert.equal(v.total.costUsd,null);
  assert.equal(item(v,'normalInput').rates[0].usdPerMillion,null);
});
test('Empty collector is absent observations; a measured baseline is verified display zero only',()=>{
  const s=aggregate([]);assert.equal(build(s).hasObservations,false);assert.equal(build({...s,measured:true}).hasObservations,true);
  const v=build({...s,measured:true});assert.equal(v.total.tokens,0);assert.equal(v.total.costUsd,0);assert.ok(v.components.every(x=>x.costUsd===0&&x.tokens===0));
});
test('Frozen pre-breakdown result keeps total but does not relabel inclusive input as regular input',()=>{
  const s={records:1,input:300,output:20,total:320,inputUsd:1,outputUsd:2,totalUsd:3};const v=build(s);
  assert.equal(v.classificationMissing,true);assert.equal(item(v,'normalInput').tokens,null);assert.equal(item(v,'cacheRead').tokens,null);
  assert.equal(v.total.costUsd,3);assert.equal(item(v,'output').tokens,20);assert.equal(v.reconciled,false);
});
test('Inconsistent input components fail reconciliation rather than changing the stored total',()=>{
  const e=event();e.normalInput++;e.price=priceEvent(e);const s=aggregate([e]),v=build(s);
  assert.equal(v.reconciled,false);assert.equal(v.total.tokens,e.total);assert.equal(item(v,'normalInput').costUsd,null);
});
test('Independent billing view does not mutate events, summaries, price snapshots or unknown flags',()=>{
  const e=event(),s=aggregate([e]),before=JSON.stringify({e,s});build(s);build(recordView(e));
  assert.equal(JSON.stringify({e,s}),before);
});
test('A record projection and an aggregated one-request projection agree on tokens and money',()=>{
  const e=event(),a=build(recordView(e)),b=build(aggregate([e]));
  for(const k of ['normalInput','cacheRead','cacheWrite','output']){
    assert.equal(item(a,k).tokens,item(b,k).tokens);assert.equal(item(a,k).costUsd,item(b,k).costUsd);
  }
});
test('Combine used by per-tool reset rows retains each component price and its model rates',()=>{
  const events=[event(),event({id:'b',model:'gpt-6-luna'})],s=aggregate(events);
  const a=build(combine(events.map(e=>aggregate([e])))),b=build(s);
  for(const k of ['normalInput','cacheRead','cacheWrite','output'])assert.deepEqual([item(a,k).tokens,item(a,k).costUsd],[item(b,k).tokens,item(b,k).costUsd]);
  assert.equal(a.total.costUsd,b.total.costUsd);assert.equal(a.reconciled,true);
});
test('Zero model-reset row has four zero components after combination',()=>{
  const v=build(combine([]));assert.equal(v.hasObservations,true);assert.equal(v.reconciled,true);assert.ok(v.components.every(x=>x.tokens===0&&x.costUsd===0));
});
test('A combination with incomplete input metadata remains incomplete, not a fabricated general-input sum',()=>{
  const known=aggregate([event()]),old={records:1,input:100,output:10,total:110,inputUsd:.2,outputUsd:.1,totalUsd:.3,knownInputPico:'200000000000',knownOutputPico:'100000000000'};
  const v=build(combine([known,old]));assert.equal(v.classificationMissing,true);assert.equal(item(v,'normalInput').tokens,null);assert.equal(v.total.tokens,known.total+110);
});
test('Status bar IN excludes cache, OUT includes reasoning once, each has its own cost',()=>{
  const text=statusLine({scope:'all',provider:'codex',costLabel:'API 환산',summary:aggregate([event()])},{tokenDisplay:'exact'});
  for(const fragment of ['IN 10,000 tok / $0.020','CACHE READ 5,000 tok / $0.001','CACHE WRITE 2,000 tok / $0.005','OUT 2,000 tok / $0.020','TOTAL 19,000 tok / $0.046'])assert.ok(text.includes(fragment),text);
  assert.ok(!text.includes('BILLABLE'));assert.ok(!text.includes('| THINK'));
});
test('Screenshot-like exact decimal arithmetic: normal/read/write/output reproduce total without changing spend',()=>{
  let normal=100692,cache=2149888,output=10619;const events=[];
  for(let i=0;i<10;i++){const n=Math.floor(normal/(10-i)),c=Math.floor(cache/(10-i)),o=Math.floor(output/(10-i));normal-=n;cache-=c;output-=o;events.push(event({id:'screen-'+i,normalInput:n,cacheRead:c,cacheWrite:0,cacheWriteUnknown:0,output:o,thinking:Math.floor(o/2)}));}
  const s=aggregate(events),v=build(s);
  assert.equal(item(v,'normalInput').tokens,100692);assert.equal(item(v,'normalInput').costUsd,.201384);
  assert.equal(item(v,'cacheRead').tokens,2149888);assert.equal(item(v,'cacheRead').costUsd,.4299776);
  assert.equal(item(v,'output').costUsd,.10619);assert.equal(v.total.costUsd,.7375516);assert.equal(v.total.tokens,2261199);
});
test('Pricing modes and context bands keep their stored applied rates; no unit/view repricing',()=>{
  const s=aggregate([event({contextInput:300000})]),v=build(s);
  assert.equal(item(v,'normalInput').rates[0].usdPerMillion,4);assert.equal(item(v,'output').rates[0].usdPerMillion,15);
  assert.equal(sumPico(v),BigInt(s.knownTotalPico));
});
test('Input JSON and CSV retain inclusive field semantics and include aggregate write dollars',async t=>{
  const f=await fixture(t);await f.write('codex','view.jsonl',codexRows());await f.c.scan();const e=[...f.c.events.values()][0],v=recordView(e);
  assert.equal(v.input,e.input);assert.equal(v.displayINField,'normalInput');assert.equal(v.inputFieldMeaning,'inclusive-of-cache');assert.equal(v.billingView.components.length,4);
  for(const text of [exportCsv(f.c,{scope:'all'}),exportHistory(f.c,{scope:'all'},'csv')])assert.ok(text.split('\n')[0].includes('cacheWriteUsd'));
});
test('Measurement CSV carries disjoint inputs and write dollars without erasing saved output',async t=>{
  const f=await fixture(t),m=await new Measurements(f.c).init();const run=await m.start({name:'billing export'});
  await f.write('codex','new.jsonl',codexRows({time:new Date(Date.now()+1).toISOString()}));await f.c.scan();const csv=m.csv([run.id]);
  for(const k of ['normalInput','normalInputUsd','cacheRead','cacheReadUsd','cacheWrite','cacheWriteUsd'])assert.ok(csv.split('\n')[0].includes(k));
});
test('Browser UMD and Node module produce identical projections without eval or external dependencies',async()=>{
  const code=await fs.readFile(path.join(__dirname,'../src/billing-view.js'),'utf8'),context=vm.createContext({});vm.runInContext(code,context);
  const s=aggregate([event()]);assert.equal(JSON.stringify(context.TokenMeterBilling.build(s)),JSON.stringify(build(s)));
});
test('Billing script is served as a same-origin static asset; data still needs authentication',async t=>{
  const f=await fixture(t),s=await startServer({dataDir:f.data});t.after(()=>s.close());
  const script=await fetch(s.runtime.origin+'/billing-view.js');assert.equal(script.status,200);assert.match(script.headers.get('content-type'),/javascript/);assert.match(await script.text(),/TokenMeterBilling/);
  assert.equal((await fetch(s.runtime.origin+'/api/status')).status,401);assert.match(script.headers.get('content-security-policy'),/script-src 'self'/);
});
test('Primary HTML presents just IN / CACHE READ / CACHE WRITE / OUT, details are collapsed by default',async()=>{
  const html=await fs.readFile(path.join(__dirname,'../web/index.html'),'utf8');
  assert.ok(html.includes('id="billing-rows"'));assert.ok(!html.includes('id="bar-thinking"'));assert.ok(!html.includes('id="bar-response"'));assert.ok(!html.includes('BILLABLE OUT'));
  assert.match(html,/<details class="billing-details" id="billing-advanced">/);
});
