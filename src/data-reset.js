'use strict';
/** A whole-data reset starts a new local epoch. Previous files remain a backup;
 * original provider logs are never removed, truncated, or edited. */
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { readJson } = require('./util');
const { UsageLog, safeEvent } = require('./usage-log');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_BASELINE = 100000;
const COUNTERS = ['input','output','normalInput','cacheRead','cacheWrite','cacheWrite5m','cacheWrite1h','cacheWriteUnknown','reasoning','tool','total'];
async function regular(file, directory = false) {
  const s = await fs.lstat(file);
  if (s.isSymbolicLink() || (directory ? !s.isDirectory() : !s.isFile())) throw new Error('초기화 저장 경로는 일반 파일/폴더여야 합니다.');
}
// The new ledger and pointer are flushed before reporting success. Directory
// fsync is best-effort on platforms which do not allow directory handles.
async function durableJson(file, value) {
  const tmp = `${file}.${randomUUID()}.tmp`;
  let h;
  try {
    h = await fs.open(tmp, 'wx', 0o600);
    await h.writeFile(JSON.stringify(value)); await h.sync(); await h.close(); h = null;
    await fs.rename(tmp, file);
    try { const dir = await fs.open(path.dirname(file), 'r'); try { await dir.sync(); } finally { await dir.close(); } } catch { /* Windows can deny directory handles. */ }
  } finally { await h?.close(); await fs.unlink(tmp).catch(()=>{}); }
}
async function resolveStorage(dataDir) {
  const pointerFile = path.join(dataDir, 'active-data.json');
  const root = path.join(dataDir, 'data-epochs');
  let p;
  try { await regular(pointerFile); p = await readJson(pointerFile, null); }
  catch(e) {
    if(e.code !== 'ENOENT') throw e;
    // Never silently load the old root if a successfully committed epoch exists.
    // Incomplete preparation has no active marker and may be safely ignored.
    try {
      await regular(root, true);
      for(const id of await fs.readdir(root)) if(UUID.test(id)) {
        await regular(path.join(root,id),true);
        const marker = await readJson(path.join(root,id,'epoch.json'),null);
        if(marker?.committed) throw new Error('active-data.json이 없습니다. 초기화 백업을 임의 복원하지 않습니다. 데이터 폴더를 보존하고 복구하세요.');
      }
    } catch(err) { if(err.code !== 'ENOENT') throw err; }
    return { directory:dataDir, pointer:null };
  }
  if(p?.version !== 1 || !UUID.test(p.id) || !Number.isFinite(Date.parse(p.startedAt))) throw new Error('active-data.json 손상: 이전 누적값을 자동 복원하지 않습니다.');
  await regular(root,true);
  const directory = path.join(root,p.id); await regular(directory,true);
  await regular(path.join(directory,'ledger.json'));
  await regular(path.join(directory,'measurements.json'));
  return { directory, pointer:p };
}
function validateBoundary(boundary, sourceEvents) {
  if(!boundary || boundary.version!==1 || !UUID.test(boundary.id) || !Number.isFinite(Date.parse(boundary.startedAt)) || !Array.isArray(boundary.baseline) || boundary.baseline.length>MAX_BASELINE || !Array.isArray(sourceEvents)) throw new Error('초기화 기준점 손상: 과거 사용량을 다시 합산하지 않도록 시작을 중단합니다.');
  const ids=new Set();
  for(const pair of boundary.baseline) {
    if(!Array.isArray(pair)||pair.length!==2||typeof pair[0]!=='string'||ids.has(pair[0])||COUNTERS.some(k=>!Number.isSafeInteger(pair[1]?.[k])||pair[1][k]<0)) throw new Error('초기화 기준점 카운터 오류');
    ids.add(pair[0]);
  }
  const sources=new Map();
  for(const e of sourceEvents) {
    if(!e || typeof e.id!=='string' || sources.has(e.id) || !e.price || COUNTERS.some(k=>!Number.isSafeInteger(e[k])||e[k]<0)) throw new Error('초기화 원본 카운터 오류');
    sources.set(e.id,e);
  }
  for(const id of ids) if(!sources.has(id)) throw new Error('초기화 중복 방지 카운터가 없습니다.');
  return { baseline:new Map(boundary.baseline), sources };
}
function dataState(c) {
  return { epochId:c.resetBoundary?.id||'legacy', startedAt:c.resetBoundary?.startedAt||null,
    requestCount:c.events.size, measurementCount:c.measurements?.state.runs.length||0,
    runningMeasurements:c.measurements?.state.runs.filter(r=>r.status==='running').length||0,
    taskCount:c.tasks.length, storageDirectory:c.storageDir||c.dataDir,
    previousDirectory:c.resetBoundary?.previousDirectory||null,
    preservedSettings:true, originalsUntouched:true,excludedLateOld:c.resetDiagnostics?.lateOld||0,excludedUndated:c.resetDiagnostics?.undated||0,
    message:'전체 초기화는 활성 사용량·사용 이력·작업·측정을 비웁니다. 설정·단가는 유지하며 이전 데이터는 백업으로 남습니다.' };
}
async function resetAll(c, raw, {write=durableJson, clock=()=>new Date().toISOString()}={}) {
  if(raw?.confirmation!=='전체 초기화') throw new Error('전체 초기화를 실행하려면 확인 문구 「전체 초기화」를 입력하세요.');
  if(typeof raw.requestKey!=='string'||!UUID.test(raw.requestKey)) throw new Error('전체 초기화 요청 키 오류');
  if(c.resetBoundary?.requestKey===raw.requestKey) return {ok:true,reused:true,...dataState(c)};
  if(raw.expectedEpochId!==(c.resetBoundary?.id||'legacy')) throw new Error('다른 창에서 이미 초기화했습니다. 화면을 새로 확인하세요.');
  if(c.resetting) throw new Error('이미 전체 초기화 중입니다.');
  c.resetting=true;
  try {
    // Server write serialization prevents API writes/racing timers here.
    await c.measurements.queue; await c.scan(); await c.saveQueue;
    const source = c.resetBoundary ? c.sourceEvents : c.events;
    if(source.size>MAX_BASELINE) throw new Error('초기화 중복 방지 기준점은 최대 100,000개 요청입니다. 데이터는 지우지 않았습니다.');
    const startedAt=clock(), id=randomUUID(), root=path.join(c.dataDir,'data-epochs');
    await fs.mkdir(root,{recursive:true,mode:0o700}); await regular(root,true);
    const directory=path.join(root,id); await fs.mkdir(directory,{mode:0o700});
    const boundary={version:1,id,requestKey:raw.requestKey,startedAt,previousDirectory:c.storageDir||c.dataDir,
      baseline:[...source].map(([key,e])=>[key,require('./measurements').buckets(e)])};
    const sources=[...source.values()].map(e=>c.metadataPool.event(safeEvent(e)));
    const ledger={version:2,repairs:structuredClone(c.repairs),events:[],files:structuredClone(c.files),tasks:[],journalSequence:0,
      resetBoundary:boundary,sourceEvents:sources};
    const state={version:1,runs:[],pinnedId:null,undo:null};
    const journal=await new UsageLog(directory,{compact:true}).init();
    await (write===durableJson?require('./json-store').atomicLedger:write)(path.join(directory,'ledger.json'),ledger);
    await write(path.join(directory,'measurements.json'),state);
    await write(path.join(directory,'epoch.json'),{version:1,id,startedAt,committed:false,previousDirectory:boundary.previousDirectory});
    const pointer={version:1,id,startedAt,requestKey:raw.requestKey,minimumAppVersion:'0.8.0'};
    // Commit point. Preparation failures leave the old dataset active.
    await write(path.join(c.dataDir,'active-data.json'),pointer);
    c.dataVersion++;c.storageDir=directory;c.resetBoundary=boundary;c.resetBaseline=new Map(boundary.baseline);
    c.sourceEvents=new Map(sources.map(e=>[e.id,e]));c.events=new Map();c.tasks=[];c.journal=journal;
    c.antigravityAliases=new Map();for(const e of sources)if(e.provider==='antigravity')for(const key of e.identityKeys||[])c.antigravityAliases.set(key,e.id);
    c.files=ledger.files;c.updatedAt=startedAt;c.dirty=false;
    const {Measurements}=require('./measurements');c.measurements=new Measurements(c);c.measurements.state=state;
    c.resetDiagnostics={lateOld:0,undated:0};
    if(c.health.antigravity)c.health.antigravity.observedRecords=0;
    // Losing a committed pointer must not fall back to old records. This marker
    // is advisory; a failed marker write does not undo an already committed reset.
    try {await write(path.join(directory,'epoch.json'),{version:1,id,startedAt,committed:true,previousDirectory:boundary.previousDirectory});}
    catch {c.warnings.push('초기화는 완료됐지만 백업 표시 파일 저장에 실패했습니다. active-data.json을 보존하세요.');}
    return {ok:true,...dataState(c)};
  } finally {c.resetting=false;}
}
module.exports={resolveStorage,validateBoundary,resetAll,dataState,durableJson,MAX_BASELINE};
