'use strict';
const {priceDetails,serviceOf}=require('./pricing');
const {hash,csvCell,text}=require('./util');
const {splitOf}=require('./output-breakdown');
function recordView(e){
  const p=e.price,split=require('./output-breakdown').pricedSplit(e);
  const rateFields={priceUnitTokens:1000000,priceCurrency:'USD',rateInput:p.rate?.input??null,rateCachedInput:p.rate?.cacheRead??null,rateCacheWrite:p.rate?.cacheWrite??null,rateCacheWrite5m:p.rate?.cacheWrite5m??null,rateCacheWrite1h:p.rate?.cacheWrite1h??null,rateOutput:p.rate?.output??null};
  for(const [field,key] of [['normalInputUsd','input'],['cacheReadUsd','cacheRead'],['cacheWrite5mUsd','cacheWrite5m'],['cacheWrite1hUsd','cacheWrite1h'],['cacheWriteUnknownUsd','cacheWrite']])rateFields[field]=p.components?.find(c=>c.key===key)?.costUsd??null;
  const result={...rateFields,resetEpochId:e.resetEpochId||null,resetDelta:!!e.resetDelta,sourceTimestamp:e.sourceTimestamp||null,id:e.id,timestamp:e.timestamp,firstObservedAt:e.firstObservedAt||null,lastObservedAt:e.lastObservedAt||null,
    provider:e.provider,modelProvider:serviceOf(e),model:e.model,rawModel:e.rawModel||null,numericModelId:e.numericModelId||null,
    modelResolution:e.modelResolution||null,modelEvidence:e.modelEvidence,effort:e.effort,role:e.role,sessionId:e.sessionId,project:e.project,
    inputBreakdown:require('./input-breakdown').inputBreakdown(e),apiRate:require('./input-breakdown').rateView(e),outputBreakdown:split,responseOutput:split.responseOutput,thinkingOutput:split.thinkingOutput,billableOutput:split.billableOutput,unclassifiedOutput:split.unclassifiedOutput,responseUsd:split.responseUsd,thinkingUsd:split.thinkingUsd,outputSplitStatus:split.status,outputTotalKnown:split.totalKnown,
    cacheWrite5m:e.cacheWrite5m,cacheWrite1h:e.cacheWrite1h,cacheWriteUnknown:e.cacheWriteUnknown,cacheReadKnown:e.cacheReadKnown??null,cacheWriteKnown:e.cacheWriteKnown??null,input:e.input,normalInput:e.normalInput,cacheRead:e.cacheRead,cacheWrite:e.cacheWrite,output:e.output,reasoning:e.reasoning,reasoningKnown:split.thinkingOutput!==null,total:e.total,
    reportedOutput:e.reportedOutput??null,outputEvidence:e.outputEvidence||null,rawOutputDetails:e.rawOutputDetails||null,
    inputUsd:p.inputPico===null?null:Number(p.inputPico)/1e12,outputUsd:p.outputPico===null?null:Number(p.outputPico)/1e12,totalUsd:p.totalPico===null?null:Number(p.totalPico)/1e12,
    knownInputUsd:Number(p.knownInputPico)/1e12,knownOutputUsd:Number(p.knownOutputPico)/1e12,knownTotalUsd:Number(p.knownPico)/1e12,
    priceAsOf:p.rate?.asOf||null,priceSource:p.rate?.source||null,warnings:e.warnings,missing:p.missing,pricing:priceDetails(e)};
  result.billingView=require('./billing-view').build(result);
  result.cacheWriteUsd=result.billingView.components.find(c=>c.key==='cacheWrite').costUsd;
  result.inputFieldMeaning='inclusive-of-cache';result.displayINField='normalInput';return result;
}
function dateFilter(v){
  if(!v)return '';
  if(!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v)throw new Error('날짜는 유효한 YYYY-MM-DD 형식이어야 합니다.');
  return v;
}
function selection(c,q){
  const {dateKey,filtered}=require('./summary');
  const from=dateFilter(q.from),to=dateFilter(q.to);
  if(from&&to&&from>to)throw new Error('시작일이 종료일보다 늦습니다.');
  const search=text(q.search||'',200).toLowerCase().trim(),state=q.priceStatus||'all';
  if(!['all','calculated','reference','partial','unavailable','incomplete'].includes(state))throw new Error('지원하지 않는 가격 상태');
  const outputState=q.outputStatus||'all';
  if(!['all','complete','reference','unavailable','mismatch','unresolved'].includes(outputState))throw new Error('지원하지 않는 출력 분해 상태');
  let events=filtered(c,{...q,scope:q.scope||'all'}).events;
  events=events.filter(e=>{
    if(from||to){if(!e.timestamp)return false;const date=dateKey(e.timestamp,c.config.timeZone);if(from&&date<from||to&&date>to)return false;}
    if(state==='incomplete'){if(e.price.totalPico!==null)return false;}else if(state!=='all'&&e.price.status!==state)return false;
    if(outputState!=='all'){const state=splitOf(e).status;if(outputState==='unresolved'?!['unavailable','mismatch'].includes(state):state!==outputState)return false;}
    return !search||[e.model,e.rawModel,e.numericModelId,e.provider,e.modelProvider,e.sessionId,e.id,e.project,...(e.price.reasons||[]).map(r=>r.message)].join(' ').toLowerCase().includes(search);
  });
  return events;
}
const key=e=>[e.timestamp||e.firstObservedAt||'',e.id];
const compare=(a,b)=>b[0].localeCompare(a[0])||b[1].localeCompare(a[1]);
function history(c,q={}){
  const limit=q.limit==null?50:Number(q.limit);
  if(!Number.isInteger(limit)||limit<1||limit>200)throw new Error('페이지 크기는 1~200입니다.');
  const events=selection(c,q).sort((a,b)=>compare(key(a),key(b))),total=events.length;
  const filterHash=hash((c.resetBoundary?.id||'legacy')+'\0'+JSON.stringify(Object.entries(q).filter(([k])=>!['cursor','limit'].includes(k)).sort(([a],[b])=>a.localeCompare(b))));
  let cursor=null;
  if(q.cursor){
    try{if(q.cursor.length>2000)throw new Error();cursor=JSON.parse(Buffer.from(q.cursor,'base64url').toString('utf8'));if(cursor.v!==1||cursor.filter!==filterHash||!Array.isArray(cursor.key)||cursor.key.length!==2||cursor.key.some(v=>typeof v!=='string'))throw new Error();}
    catch{throw new Error('조회 위치가 잘못되었거나 필터가 바뀌었습니다. 첫 페이지부터 조회하세요.');}
  }
  const remaining=cursor?events.filter(e=>compare(key(e),cursor.key)>0):events;
  const slice=remaining.slice(0,limit),hasMore=remaining.length>limit;
  return {schema:'token-meter.history.v1',generatedAt:new Date().toISOString(),timeZone:c.config.timeZone,totalMatching:total,totalStored:c.events.size,
    limit,returned:slice.length,records:slice.map(e=>({...recordView(e),revision:c.journal.latest.get(e.id)?.revision||null})),
    nextCursor:hasMore?Buffer.from(JSON.stringify({v:1,filter:filterHash,key:key(slice.at(-1))})).toString('base64url'):null,
    storage:c.journal.status(),scope:'요청별 최신 관측값. 수정 이력 JSONL을 합산하지 않습니다.'};
}
function exportHistory(c,q={},format='jsonl'){
  const rows=selection(c,q).sort((a,b)=>compare(key(a),key(b))).map(recordView);
  if(format==='jsonl')return rows.map(e=>JSON.stringify({schema:'token-meter.usage.latest.v1',...e})+'\n').join('');
  const cols=['resetEpochId','resetDelta','sourceTimestamp','timestamp','firstObservedAt','provider','modelProvider','model','numericModelId','effort','sessionId','input','normalInput','cacheRead','cacheWrite','cacheWrite5m','cacheWrite1h','cacheWriteUnknown','cacheReadKnown','cacheWriteKnown','normalInputUsd','cacheReadUsd','cacheWriteUsd','inputFieldMeaning','displayINField','cacheWrite5mUsd','cacheWrite1hUsd','cacheWriteUnknownUsd','priceUnitTokens','priceCurrency','rateInput','rateCachedInput','rateCacheWrite','rateCacheWrite5m','rateCacheWrite1h','rateOutput','responseOutput','thinkingOutput','unclassifiedOutput','outputSplitStatus','outputTotalKnown','output','billableOutput','total','responseUsd','thinkingUsd','inputUsd','outputUsd','totalUsd','knownInputUsd','knownOutputUsd','knownTotalUsd','priceStatus','priceReasons','priceSource','priceAsOf'];
  return '\uFEFF'+cols.join(',')+'\r\n'+rows.map(r=>{r.priceStatus=r.pricing.status;r.priceReasons=r.pricing.reasons.map(x=>x.message).join('; ');return cols.map(k=>csvCell(r[k])).join(',');}).join('\r\n')+'\r\n';
}
module.exports={recordView,history,selection,exportHistory};
