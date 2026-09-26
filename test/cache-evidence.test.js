'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {build,combine}=require('../src/billing-view');
const {aggregate,statusLine}=require('../src/summary');
const {priceEvent}=require('../src/pricing');
const {normalize}=require('../src/generic');
const {parse,initial}=require('../src/parsers');
const {codexRows}=require('./helpers');
const fs=require('node:fs');
function event({id='counter',write,read=600,input=1000}={}){
 const usage={input_tokens:input,output_tokens:100,input_tokens_details:{cached_tokens:read},output_tokens_details:{reasoning_tokens:40}};
 if(write!==undefined)usage.input_tokens_details.cache_write_tokens=write;
 const e=normalize({schema:'token-meter.usage.v1',format:'openai',modelProvider:'openai',model:'gpt-6-sol',modality:'text',timestamp:'2026-09-25T14:00:00.000Z',requestId:id,usage});e.price=priceEvent(e);return e;
}
const writeOf=s=>build(s).components.find(x=>x.key==='cacheWrite');
test('Missing cache-write counter retains observed totals but is not displayed as a measured zero',()=>{
 const e=event(),s=aggregate([e]),w=writeOf(s);
 assert.equal(e.cacheWriteKnown,false);assert.equal(w.tokens,0);assert.equal(w.usageUnreported,true);assert.equal(w.usageState,'unreported');assert.equal(w.statusLabel,'원본 카운터 미기록');assert.equal(s.total,1100);assert.equal(w.rates[0].usdPerMillion,2.5);
});
test('Explicit cache-write zero is reported-zero, with known unit rate and zero component charge',()=>{
 const w=writeOf(aggregate([event({write:0})]));assert.equal(w.usageState,'reported-zero');assert.equal(w.usageUnreported,false);assert.equal(w.costUsd,0);assert.equal(w.rates[0].usdPerMillion,2.5);
});
test('Real named cache-write count is read and charged once, not inferred from edits',()=>{
 const e=event({write:200}),s=aggregate([e]),v=build(s),w=writeOf(s);
 assert.equal(e.normalInput,200);assert.equal(w.tokens,200);assert.equal(w.usageState,'reported');assert.equal(w.costUsd,.0005);assert.equal(v.reconciled,true);assert.equal(v.components.reduce((n,x)=>n+x.tokens,0),s.total);
});
test('Some requests missing writes report partial coverage, preserving known nonzero writes',()=>{
 const s=aggregate([event({id:'a',write:200}),event({id:'b'})]),w=writeOf(s);
 assert.equal(w.usageState,'partial');assert.equal(w.tokens,200);assert.equal(w.usageUnreported,false);assert.equal(w.unreportedRecords,1);assert.equal(w.costUsd,.0005);
});
test('Same API price table can coexist with an unreported write counter',()=>{
 const e=event();assert.ok(e.price.rate.cacheWrite>0);assert.equal(writeOf(aggregate([e])).usageState,'unreported');assert.ok(e.price.referenceReasons.includes('cache-write-unreported'));
});
test('Status line shows missing writes as unreported / cannot split, never zero dollars',()=>{
 const s=aggregate([event()]),str=statusLine({scope:'all',provider:'all',summary:s,costLabel:'API 환산'});
 assert.match(str,/CACHE WRITE 미기록 tok \/ 분리 불가/);assert.doesNotMatch(str,/CACHE WRITE 0/);
});
test('Combined model or tool measurement keeps missing-counter evidence',()=>{
 const s=combine([aggregate([event({id:'a'})]),aggregate([event({id:'b'})])]);const w=writeOf(s);assert.equal(w.usageUnreported,true);assert.equal(w.unreportedRecords,2);
});
test('Codex log without cache-write counter does not infer writes from cached reads or disk patch events',()=>{
 const rows=codexRows({input:1000,cache:800,write:0});delete rows[2].payload.info.total_token_usage.cache_write_input_tokens;
 // helper intentionally shares total and last usage; absence in both is preserved.
 const s=initial('codex','/synthetic/codex/log.jsonl');const out=rows.flatMap(x=>parse('codex',x,s));assert.equal(out.length,1);assert.equal(out[0].cacheWriteKnown,false);assert.equal(out[0].cacheWrite,0);
 const edit={type:'response_item',payload:{type:'function_call',name:'apply_patch',arguments:'*** Update File: newsanalyze/export_public_site.py\n+new code'}};
 assert.deepEqual(parse('codex',edit,s),[]);assert.equal(out[0].cacheRead,800);
});
test('Rendering evidence never mutates stored amounts or creates cache-write usage',()=>{
 const e=event(),s=aggregate([e]),before=JSON.stringify({e,s});build(s);assert.equal(JSON.stringify({e,s}),before);
});
test('Cache help explains file I/O and source metadata with official references',()=>{
 const html=fs.readFileSync(require('node:path').join(__dirname,'../web/index.html'),'utf8');
 assert.match(html,/캐시 쓰기 ≠ 코드 파일 쓰기/);assert.match(html,/cache-help-button/);assert.match(html,/https:\/\/developers.openai.com\/api\/docs\/guides\/prompt-caching/);assert.match(html,/원본 로그에 쓰기 카운터가 없습니다/);
});
