'use strict';
/** Repair ONLY Antigravity identity v3 records. Never reset other providers or
 * roll an epoch back. Each original ledger is preserved before any replacement.
 * Frozen measurements are not repriced/recomputed. */
const fs = require('node:fs/promises');
const fss = require('node:fs');
const path = require('node:path');
const { buckets } = require('./measurements');
const { priceEvent } = require('./pricing');
const { attachSplit } = require('./output-breakdown');
const COUNTERS=['input','output','normalInput','cacheRead','cacheWrite','cacheWrite5m','cacheWrite1h','cacheWriteUnknown','reasoning','tool','total'];
const total = list => ({records:list.length,input:list.reduce((n,e)=>n+e.input,0),output:list.reduce((n,e)=>n+e.output,0)});
const isLegacy = e => e.provider==='antigravity' && e.identityVersion!==4;
async function backup(c,kind='identityV4') {
  const file=path.join(c.storageDir,'ledger.json');
  try { await fs.copyFile(file,path.join(c.storageDir,kind==='accountingV2'?'ledger.pre-0.10.1.json':'ledger.pre-0.10.0.json'),fss.constants.COPYFILE_EXCL); }
  catch(e) { if(!['EEXIST','ENOENT'].includes(e.code))throw e; }
}
async function loadPlans(c) {
  for(const [kind,file,property,version] of [['identityV4','identity-repair-plans.json','identityRepairPlans',4],['accountingV2','accounting-repair-plans.json','accountingRepairPlans',2]]){
    const data=await require('./util').readJson(path.join(c.storageDir,file),null);
    if(!data)continue;
    if(data.version!==1||!data.sessions||typeof data.sessions!=='object')throw new Error('Antigravity 복구 계획 파일 손상: 원본을 보관하세요.');
    c[property]=data;
    c.repairs[kind]=c.repairs[kind]||{version,sessions:{}};
    for(const [id,plan]of Object.entries(data.sessions))if(!c.repairs[kind].sessions[id]){
      if(!Array.isArray(plan.legacyIds)||!plan.baselineTransfers||!plan.source)throw new Error('Antigravity 복구 계획 내용 오류');
      c.repairs[kind].sessions[id]=plan;
    }
  }
}
function retired(e) {
  const r=structuredClone(e);
  for(const k of COUNTERS)r[k]=0;
  attachSplit(r,{total:0,thinking:0,source:'identity-repair-retired'});
  r.retired=true;r.retiredReason='antigravity-identity-v4-replaced';
  r.warnings=['antigravity-identity-v3-retired'];r.identityKeys=[];
  r.price=priceEvent(r,[],e.price?.rate);return r;
}
function indexTargets(events) {
  const m=new Map();
  for(const e of events)for(const k of e.requestIdentityKeys||[]) {
    if(!m.has(k))m.set(k,new Set());m.get(k).add(e.id);
  }
  return m;
}
function rowTargets(events) {
  const m=new Map();
  for(const e of events)for(const k of e.sourceRowKeys||[]) {
    if(!m.has(k))m.set(k,new Set());m.get(k).add(e.id);
  }
  return m;
}
function bestBaseline(ids,base) {
  return ids.filter(id=>base.has(id)).sort((a,b)=>base.get(b).total-base.get(a).total||base.get(b).cacheRead-base.get(a).cacheRead)[0]||null;
}
async function repairSession(c, snapshot, sessionId, kind='identityV4') {
  const store=c.sourceEvents||c.events;
  const old=[...store.values()].filter(e=>e.sessionId===sessionId&&(kind==='accountingV2'?e.provider==='antigravity'&&e.identityVersion===4&&e.accountingVersion!==2:isLegacy(e)));
  if(!old.length)return null;
  // A parse failure is not permission to delete previously collected history.
  if(snapshot.stats.invalidRows||!snapshot.events.length)throw new Error('identity-repair-incomplete-source');
  await backup(c,kind);
  const fresh=snapshot.events;
  const byId=new Map(fresh.map(e=>[e.id,e])),targets=indexTargets(fresh),rows=kind==='accountingV2'?rowTargets(fresh):null,transfers={},oldTargets={},baselineCandidates={};
  let collapsed=0;
  for(const e of old) {
    const matches=new Set(byId.has(e.id)?[e.id]:[]);
    for(const k of e.identityKeys||[]) {
      // The root field-4 group identity is NEVER considered here either.
      if(k.includes(':generation:'))continue;
      for(const id of targets.get(k)||[])matches.add(id);
      if(rows)for(const id of rows.get(k)||[])matches.add(id);
    }
    if(!matches.size&&!(e.identityKeys||[]).length&&Number.isSafeInteger(e.sourceIndex))
      for(const f of fresh)if(f.sourceIndex===e.sourceIndex&&f.sourceKind===e.sourceKind&&f.sourcePosition===0)matches.add(f.id);
    oldTargets[e.id]=[...matches];
    if(matches.size===1){const id=[...matches][0];transfers[id]=e.id;(baselineCandidates[id]||=[]).push(e.id);}
    else if(matches.size>1)collapsed++;
  }
  // Many old rows mapping to a new row is not a reversible baseline mapping.
  const targetCounts=new Map();for(const ids of Object.values(oldTargets))for(const id of ids)targetCounts.set(id,(targetCounts.get(id)||0)+1);
  for(const id of Object.keys(transfers))if(targetCounts.get(id)>1&&kind!=='accountingV2')delete transfers[id];
  let preBoundary=0,undated=0,reconstructed=0,transferred=0,preResetObservationPromotions=0,unknownObservationBoundary=0;
  const newBase=c.resetBoundary?new Map(c.resetBaseline):null;
  if(newBase){
    for(const e of old)newBase.delete(e.id);
    for(const e of fresh){
      const selected=kind==='accountingV2'?bestBaseline(baselineCandidates[e.id]||[],c.resetBaseline):transfers[e.id];
      const b=c.resetBaseline.get(selected);
      if(b){
        transfers[e.id]=selected;
        const stepCorrection=kind==='accountingV2'&&e.usageSourceKind==='step'&&e.total>b.total;
        if(stepCorrection&&e.usageObservedAt&&e.usageObservedAt<c.resetBoundary.startedAt){newBase.set(e.id,buckets(e));preResetObservationPromotions++;}
        else{newBase.set(e.id,structuredClone(b));transferred++;if(stepCorrection&&!e.usageObservedAt)unknownObservationBoundary++;}
      }
      else if(!e.timestamp){undated++;}
      else if(e.timestamp<c.resetBoundary.startedAt){
        // Historical per-call snapshots were irreversibly merged. Do not guess
        // how much of an in-flight pre-boundary call was generated after reset.
        newBase.set(e.id,buckets(e));preBoundary++;reconstructed++;
        e.warnings.push('identity-v4-boundary-time-reconstructed');
      }
    }
  }
  // A durable plan precedes retirement revisions. If the process dies between
  // journal chunks, replay can still remap a running measurement's old baseline.
  const plan={at:new Date().toISOString(),sessionId,version:kind==='accountingV2'?2:4,old:total(old),source:total(fresh),active:{records:0,input:0,output:0},
    collapsedLegacyEvents:collapsed,excludedByBoundary:preBoundary,undated,transferredBaselines:transferred,
    timeReconstructedBaselines:reconstructed,preResetObservationPromotions,unknownObservationBoundary,baselineTransfers:transfers,baselineCandidates,legacyIds:old.map(e=>e.id),status:'pending-durable-rebuild',
    notice:'복구 계획이 저장되었습니다. DB 재수집과 장부 저장을 완료해야 합니다.'};
  const property=kind==='accountingV2'?'accountingRepairPlans':'identityRepairPlans',file=kind==='accountingV2'?'accounting-repair-plans.json':'identity-repair-plans.json';
  const plans=structuredClone(c[property]||{version:1,sessions:{}});plans.sessions[sessionId]=plan;
  await require('./data-reset').durableJson(path.join(c.storageDir,file),plans);
  c[property]=plans;
  // Commit the in-memory session replacement without awaiting midway. The
  // serialized collector save journals tombstones before its ledger checkpoint.
  for(const e of old){
    c.events.delete(e.id);if(c.sourceEvents)c.sourceEvents.delete(e.id);
    if(!byId.has(e.id))c.pendingRetirements.set(e.id,retired(e));
  }
  c.antigravityAliases=new Map();
  for(const e of store.values())if(e.provider==='antigravity'&&e.accountingVersion===2)for(const k of e.identityKeys||[])c.antigravityAliases.set(k,e.id);
  if(newBase){c.resetBaseline=newBase;c.resetBoundary.baseline=[...newBase];}
  for(const e of fresh)c.insert(e);
  const active=[...c.events.values()].filter(e=>e.sessionId===sessionId);
  const report={at:new Date().toISOString(),sessionId,version:kind==='accountingV2'?2:4,old:total(old),source:total(fresh),active:total(active),
    collapsedLegacyEvents:collapsed,excludedByBoundary:preBoundary,undated,transferredBaselines:transferred,
    timeReconstructedBaselines:reconstructed,preResetObservationPromotions,unknownObservationBoundary,baselineTransfers:transfers,baselineCandidates,legacyIds:old.map(e=>e.id),
    status:snapshot.partial?'repaired-partial-source':reconstructed||unknownObservationBoundary?'repaired-boundary-qualified':'repaired',
    notice:reconstructed||unknownObservationBoundary?'초기화 경계의 일부 사용량 시점은 정확히 복원할 수 없습니다. 원본 DB와 기준 시각을 확인하세요.':
      '원본에서 호출별 ID를 다시 구성했습니다. 이 결과는 지원 스키마 내 대조이며 실제 청구액 검증이 아닙니다.'};
  c.repairs[kind]=c.repairs[kind]||{version:kind==='accountingV2'?2:4,sessions:{}};
  c.repairs[kind].sessions[sessionId]=report;c.dirty=true;
  return report;
}
function measurementBaseline(c,r,base) {
  const out=new Map(base);let affected=false,uncertain=0;
  for(const kind of ['identityV4','accountingV2'])for(const repair of Object.values(c.repairs[kind]?.sessions||{})) {
    if(!repair.legacyIds.some(id=>base.has(id)))continue;
    affected=true;
    for(const [newId,oldId]of Object.entries(repair.baselineTransfers)){
      const selected=kind==='accountingV2'?bestBaseline(repair.baselineCandidates?.[newId]||[oldId],base):oldId;
      if(!base.has(selected))continue;
      if(kind!=='accountingV2'){if(!out.has(newId))out.set(newId,base.get(selected));continue;}
      const prior=base.get(selected),current=c.events.get(newId),stepCorrection=current?.usageSourceKind==='step'&&current.total>prior.total;
      if(stepCorrection&&current.usageObservedAt&&current.usageObservedAt<r.start)out.set(newId,buckets(current));
      else{out.set(newId,prior);if(stepCorrection&&!current.usageObservedAt)uncertain++;}
    }
  }
  return {baseline:out,affected,uncertain};
}
function publicRepairs(c) {
  return ['identityV4','accountingV2'].flatMap(kind=>Object.values(c.repairs[kind]?.sessions||{}).map(({baselineTransfers,baselineCandidates,legacyIds,...r})=>({...r,kind})));
}
module.exports={repairSession,backup,loadPlans,isLegacy,measurementBaseline,publicRepairs};
