'use strict';
/** Read-only accounting reconciliation. Matching our supported local schema is
 * not a certificate of provider billing or private protobuf field semantics. */
const path=require('node:path');
const {hash}=require('./util');
const {publicRepairs,isLegacy}=require('./identity-repair');
const COUNTERS=['input','normalInput','cacheRead','cacheWrite','output','total'];
function sum(events){const s={records:events.length};for(const k of COUNTERS)s[k]=events.reduce((n,e)=>n+e[k],0);return s;}
function sourceEvents(c){return [...(c.sourceEvents||c.events).values()].filter(e=>!e.retired);}
function sessions(c){
  const map=new Map();
  const add=(e,active)=>{
    if(!map.has(e.sessionId))map.set(e.sessionId,{id:e.sessionId,provider:e.provider,models:new Set(),firstTime:null,lastTime:null,raw:[],active:[],legacyRecords:0});
    const s=map.get(e.sessionId);s.models.add(e.model);s[active?'active':'raw'].push(e);
    if(e.timestamp){if(!s.firstTime||e.timestamp<s.firstTime)s.firstTime=e.timestamp;if(!s.lastTime||e.timestamp>s.lastTime)s.lastTime=e.timestamp;}
    if(!active&&isLegacy(e))s.legacyRecords++;
  };
  for(const e of sourceEvents(c))add(e,false);
  for(const e of c.events.values())add(e,true);
  return [...map.values()].map(({raw,active,models,...s})=>({...s,models:[...models],source:sum(raw),active:sum(active)})).sort((a,b)=>(b.lastTime||'').localeCompare(a.lastTime||''));
}
function scopeInfo(c,q,events){
  return {dataset:q.dataset==='source'?'source':'active',epochId:c.resetBoundary?.id||null,epochStartedAt:c.resetBoundary?.startedAt||null,
    legacyAntigravityRecords:events.filter(isLegacy).length,providers:[...new Set(events.map(e=>e.provider))],sessions:[...new Set(events.map(e=>e.sessionId))].length,
    inputTotal:events.reduce((n,e)=>n+e.input,0),inputDefinition:'일반 입력 + 캐시 읽기 + 캐시 쓰기',
    outputDefinition:'THINKING을 한 번 포함한 전체 출력',sessionComparison:q.scope==='session',
    basis:'지원 형식의 로컬 관측값. CLI 상태바와 같은 세션·시점·필드 의미로 비교해야 합니다.'};
}
function invariants(c){
  const rows=[...c.events.values()];let invalid=0,legacy=0,partial=0;
  for(const e of rows){
    if(COUNTERS.some(k=>!Number.isSafeInteger(e[k])||e[k]<0)||e.input!==e.normalInput+e.cacheRead+e.cacheWrite||e.total!==e.input+e.output)invalid++;
    if(isLegacy(e))legacy++;
    if(e.outputTotalKnown===false||e.warnings?.some(w=>w==='invalid-input-usage'||w==='measurement-input-breakdown-ambiguous'))partial++;
  }
  return {records:rows.length,counterInvariantFailures:invalid,legacyAntigravityRecords:legacy,partialTokenRecords:partial,
    journal:c.journal.status(),pendingDiskWrite:!!c.dirty||c.pendingSaves>0,
    lastScan:c.updatedAt,scanDurationMs:c.scanStats.durationMs??null,
    repairs:publicRepairs(c),health:c.health,warnings:c.warnings,
    warning:'카운터 일관성 검사는 로그 누락이나 비공개 스키마 의미의 정확성을 보증하지 않습니다.'};
}
async function verifySession(c,{sessionId}={}){
  if(typeof sessionId!=='string'||!sessionId.startsWith('antigravity:')||sessionId.length>240)throw new Error('Antigravity 세션을 선택하세요.');
  const id=sessionId.slice('antigravity:'.length);
  // Never accept arbitrary paths from an HTTP caller. Only files discovered by
  // the configured read-only collector can be verified.
  const discovered=Object.keys(c.files).filter(k=>k.startsWith('antigravity:')&&path.basename(k.slice(12),'.db')===id),files=discovered.slice(0,4);
  if(!files.length)throw new Error('현재 발견된 원본 DB가 없습니다. 원본 경로와 수집 상태를 확인하세요.');
  const {readDatabase}=require('./antigravity-db');
  const reads=[];
  for(const key of files){try{const r=await readDatabase(key.slice(12));reads.push({key,result:r});}catch(e){reads.push({key,error:require('./antigravity-db').safeError(e)});}}
  const expected=new Map();
  for(const x of reads)if(x.result)for(const e of x.result.events){const old=expected.get(e.id);if(!old||e.total>old.total)expected.set(e.id,e);}
  const stored=new Map(sourceEvents(c).filter(e=>e.sessionId===sessionId).map(e=>[e.id,e]));
  const missing=[],different=[],retained=[],visited=new Set();
  const aliases=new Map();for(const e of stored.values())for(const key of e.identityKeys||[]){if(!aliases.has(key))aliases.set(key,new Set());aliases.get(key).add(e.id);}
  for(const [id,e]of expected){
    let old=stored.get(id);
    if(!old){const matches=new Set();for(const key of e.identityKeys||[])for(const match of aliases.get(key)||[])matches.add(match);if(matches.size===1)old=stored.get([...matches][0]);}
    if(!old)missing.push(id);else {if(visited.has(old.id)||COUNTERS.some(k=>old[k]!==e[k]))different.push(id);visited.add(old.id);}
  }
  for(const id of stored.keys())if(!visited.has(id))retained.push(id);
  const stable=reads.every(x=>x.result?.signature),complete=discovered.length<=4&&reads.every(x=>x.result&&!x.result.partial);
  const status=!stable||!complete?'qualified-snapshot':missing.length||different.length?'mismatch':retained.length?'retained-history':'matched-local-snapshot';
  const sourceTotals=sum([...expected.values()]),storedTotals=sum([...stored.values()]);
  return {schema:'token-meter.session-reconciliation.v1',generatedAt:new Date().toISOString(),status,sessionId,
    independentSemanticValidation:false,discoveredFiles:discovered.length,verifiedFiles:reads.length,limited:discovered.length>4,files:reads.map(x=>({fileId:hash(x.key).slice(0,12),error:x.error||null,stable:!!x.result?.signature,stats:x.result?.stats||null})),
    source:sourceTotals,stored:storedTotals,active:sum([...c.events.values()].filter(e=>e.sessionId===sessionId)),
    missingRecords:missing.length,differentRecords:different.length,retainedOnlyRecords:retained.length,
    diff:COUNTERS.map(k=>({field:k,source:sourceTotals[k],stored:storedTotals[k],delta:storedTotals[k]-sourceTotals[k]})),
    sample:{missing:missing.slice(0,20).map(x=>hash(x)),different:different.slice(0,20).map(x=>hash(x))},
    epochStartedAt:c.resetBoundary?.startedAt||null,
    note:'원본 DB를 새로 읽어 장부와 비교했습니다. 같은 지원 파서의 구조 대조이며 Google 공식 필드 의미나 실제 청구액의 독립 검증이 아닙니다. 원본에서 사라진 과거 기록은 유지합니다.'};
}
function diagnostics(c){
  const i=invariants(c);
  return {schema:'token-meter.diagnostics.v1',version:require('../package.json').version,generatedAt:new Date().toISOString(),
    counters:{records:i.records,failures:i.counterInvariantFailures,legacyAntigravity:i.legacyAntigravityRecords},
    epochStartedAt:c.resetBoundary?.startedAt||null,lastScan:c.updatedAt,
    sessions:sessions(c).map(({id,models,...s})=>({...s,sessionHash:hash(id),models})),
    repairs:i.repairs.map(({sessionId,...r})=>({...r,sessionHash:hash(sessionId)})),
    privacy:'경로·대화 본문·접근키 제외. 모델·시각·사용량 메타데이터 포함.',
    limits:'진단은 현재 로컬 관측값입니다. 실제 계정 청구액·완전 수집 증명은 아닙니다.'};
}
module.exports={sum,sourceEvents,sessions,scopeInfo,invariants,verifySession,diagnostics};
