'use strict';
// Disjoint input buckets. These are partitions of IN, never charges added to IN twice.
const {hash}=require('./util');
const DEFINITIONS=[
  ['normalInput','input','Input · 일반 입력'],
  ['cacheRead','cacheRead','Cached input · 캐시 읽기'],
  ['cacheWrite5m','cacheWrite5m','Cache writes · 5분'],
  ['cacheWrite1h','cacheWrite1h','Cache writes · 1시간'],
  ['cacheWriteUnknown','cacheWrite','Cache writes · 일반 / TTL 미기록']
];
const count=n=>Number.isSafeInteger(n)&&n>=0?n:0;
const usd=p=>Number(p)/1e12;
function blankInput(){return {records:0,total:0,invalidRecords:0,writeUnreported:0,readUnreported:0,referenceRecords:0,rows:DEFINITIONS.map(([key,priceKey,label])=>({key,priceKey,label,tokens:0,knownPico:0n,unknownRecords:0,rates:new Map()}))};}
function addInput(a,e){
  a.records++;a.total+=count(e.input);
  if(e.input&&e.cacheWriteKnown===false)a.writeUnreported++;
  if(e.input&&e.cacheReadKnown===false)a.readUnreported++;
  if(e.provider==='antigravity')a.referenceRecords++;
  const consistent=DEFINITIONS.reduce((sum,[key])=>sum+count(e[key]),0)===e.input && count(e.cacheWrite)===count(e.cacheWrite5m)+count(e.cacheWrite1h)+count(e.cacheWriteUnknown);
  if(!consistent)a.invalidRecords++;
  const parts=e.price?.components||[];
  for(const r of a.rows){
    const n=count(e[r.key]);r.tokens+=n;
    const part=parts.find(p=>p.key===r.priceKey), rate=part?.usdPerMillion??e.price?.rate?.[r.priceKey]??null;
    // Zero usage is zero cost even with an unknown unit price; nonzero is never guessed.
    const amount=!consistent?null:part?part.costPico:n?null:'0';
    if(amount===null||amount===undefined){r.unknownRecords++;}else r.knownPico+=BigInt(amount);
    const k=rate===null?'unknown':String(rate);
    if(!r.rates.has(k))r.rates.set(k,{usdPerMillion:rate,tokens:0,records:0});
    const v=r.rates.get(k);v.tokens+=n;v.records++;
  }
}
function finishInput(a){
  const rows=a.rows.map(r=>({key:r.key,priceKey:r.priceKey,label:r.label,tokens:r.tokens,knownPico:String(r.knownPico),costPico:r.unknownRecords?null:String(r.knownPico),knownUsd:usd(r.knownPico),costUsd:r.unknownRecords?null:usd(r.knownPico),unpricedRecords:r.unknownRecords,rates:[...r.rates.values()]}));
  const writes=rows.filter(r=>r.key.startsWith('cacheWrite'));
  const writePico=writes.reduce((s,r)=>s+BigInt(r.knownPico),0n);
  return {version:1,records:a.records,rows,inputTokens:a.total,classifiedInputTokens:rows.reduce((s,r)=>s+r.tokens,0),invalidRecords:a.invalidRecords,
    cacheWriteTokens:writes.reduce((s,r)=>s+r.tokens,0),cacheWritePico:writes.some(r=>r.costPico===null)?null:String(writePico),knownCacheWriteUsd:usd(writePico),
    cacheWriteUnreportedRecords:a.writeUnreported,cacheReadUnreportedRecords:a.readUnreported,referenceRecords:a.referenceRecords,
    note:'입력 합계(캐시 포함) = 일반 입력 + 캐시 읽기 + 캐시 쓰기. 화면의 IN은 일반 입력입니다. 캐시 비용은 입력 비용의 일부이며 입력 총액에 다시 더하지 않습니다.'};
}
function inputBreakdown(e){const a=blankInput();addInput(a,e);return finishInput(a);}
function rateView(e){
  const r=e.price?.rate;
  const identity=require('./pricing').checkRateBinding(e,r);
  const auditFields={binding:identity,eventModel:e.model,tariffModel:identity.tariffModel,tariffModels:identity.tariffModels,tariffProvider:identity.tariffProvider};
  if(!r||identity.status!=='matched')return {...auditFields,available:false,model:e.model,modelProvider:require('./pricing').serviceOf(e),unitTokens:1000000,currency:'USD',status:r?'모델·단가 연결 불일치':'단가 미확인'};
  const base=r.baseRule||r;
  const values=Object.fromEntries(['input','cacheRead','cacheWrite','cacheWrite5m','cacheWrite1h','output'].map(k=>[k,r[k]??null]));
  return {...auditFields,available:true,model:e.model,modelProvider:require('./pricing').serviceOf(e),unitTokens:1000000,currency:'USD',
    rates:values,baseRates:Object.fromEntries(Object.keys(values).map(k=>[k,base[k]??null])),tier:r.resolvedTier||e.serviceTier||r.tier||'standard',
    source:r.source||null,asOf:r.asOf||null,verifiedAt:r.verifiedAt||base.verifiedAt||null,effectiveFrom:r.effectiveFrom||null,effectiveTo:r.effectiveTo||null,
    origin:r.origin||base.origin||(r.community?'community':'stored-reference'),referenceReasons:(e.price?.referenceReasons||[]).map(code=>({code,message:require('./pricing').REASON_LABELS[code]||code})),
    longContext:base.longContext||null,contextTiers:base.contextTiers||null,longContextApplied:!!r.longContextApplied,contextInputUnknown:!!r.contextInputUnknown,
    contextInput:e.contextInputKnown===false?null:e.contextInput??e.input,conditionSource:r.conditionSource||base.conditionSource||null,
    selectedMultiplier:base.selectedMultiplier||1,referenceContext:r.referenceContext||null,
    thinking:'THINKING은 전체 출력 단가를 적용한 출력 비용의 분해값입니다. 추가 비용으로 다시 합산하지 않습니다.',
    cacheWriteNote:(r.modelProvider||e.modelProvider)==='google'?'Google 캐시 시간당 저장료는 이 토큰 계산에 포함하지 않습니다.':values.cacheWrite===null&&values.cacheWrite5m===null&&values.cacheWrite1h===null?'캐시 쓰기 단가 없음: 무료라는 뜻이 아닙니다.':'캐시 쓰기 토큰은 일반 입력과 중복 과금하지 않습니다.'};
}
// A rate group repeats across thousands of requests. Its identity is not the
// request context length. Weak keys avoid retaining discarded event/price graphs.
const groupCache=new WeakMap();
function rateIdentity(e){
  const rate=e.price?.rate;
  if(!rate||!Object.isFrozen(rate)){const {contextInput,...view}=rateView(e);return {view,key:hash(JSON.stringify(view))};}
  let cache=groupCache.get(rate);if(!cache){cache=new Map();groupCache.set(rate,cache);}
  const base=rate.baseRule||rate,at=Date.parse(e.timestamp);
  const dateMatches=(!base.effectiveFrom||(Number.isFinite(at)&&at>=Date.parse(base.effectiveFrom)))&&(!base.effectiveTo||(Number.isFinite(at)&&at<Date.parse(base.effectiveTo)));
  const k=JSON.stringify([e.provider,e.modelProvider,e.model,e.serviceTier,e.local===true,dateMatches,e.price?.referenceReasons||[]]);
  if(cache.has(k))return cache.get(k);
  const {contextInput,...view}=rateView(e),result={view,key:hash(JSON.stringify(view))};
  if(cache.size>=32)cache.delete(cache.keys().next().value);cache.set(k,result);return result;
}
function blankRates(){return new Map();}
function addRate(map,e){
  const {view:identity,key}=rateIdentity(e);
  if(!map.has(key))map.set(key,{...identity,id:key,records:0,firstTimestamp:null,lastTimestamp:null,input:blankInput(),outputTokens:0,knownOutputPico:0n,outputUnpricedRecords:0});
  const r=map.get(key);r.records++;addInput(r.input,e);r.outputTokens+=count(e.output);r.knownOutputPico+=BigInt(e.price?.knownOutputPico||'0');if(e.price?.outputPico==null)r.outputUnpricedRecords++;
  if(e.timestamp){if(!r.firstTimestamp||e.timestamp<r.firstTimestamp)r.firstTimestamp=e.timestamp;if(!r.lastTimestamp||e.timestamp>r.lastTimestamp)r.lastTimestamp=e.timestamp;}
}
function finishRates(map){return [...map.values()].map(r=>{const {input,knownOutputPico,...rest}=r;return {...rest,inputBreakdown:finishInput(input),knownOutputPico:String(knownOutputPico),knownOutputUsd:usd(knownOutputPico),outputUsd:r.outputUnpricedRecords?null:usd(knownOutputPico)};});}
module.exports={DEFINITIONS,blankInput,addInput,finishInput,inputBreakdown,rateView,blankRates,addRate,finishRates};
