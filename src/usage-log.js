'use strict';
// Append-only metadata audit log. Revisions replace a request in the latest view;
// adding every JSONL line as spend would double-count revisions.
const fs=require('node:fs/promises');
const fss=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {text}=require('./util');
const SCHEMA='token-meter.usage-log.v1', MAX_LINE=256*1024;
const EVENT_KEYS=['retired','retiredReason','identityVersion','requestIdentityKeys','sourceRowKeys','sourcePosition','resetEpochId','resetDelta','sourceTimestamp','id','provider','modelProvider','model','rawModel','numericModelId','effort','role','agentId','parentSessionId','sessionId','projectId','project',
  'timestamp','firstObservedAt','lastObservedAt','serviceTier','modality','local','input','output','normalInput','cacheRead','cacheWrite','cacheWrite5m','cacheWrite1h','cacheWriteUnknown',
  ...require('./output-breakdown').SPLIT_KEYS,'reasoning','reasoningKnown','tool','total','modelEvidence','sourceKind','sourceIndex','costScope','parserVersion','reportedOutput','outputEvidence','contextInput','contextInputKnown','cacheReadKnown','cacheWriteKnown','inputEvidence'];
const RATE_KEYS=['provider','modelProvider','models','tier','source','asOf','verifiedAt','origin','effectiveFrom','effectiveTo','input','output','cacheRead','cacheWrite','cacheWrite5m','cacheWrite1h','fastMultiplier','selectedMultiplier','referenceOnly','referenceContext','community','exactOnly','resolvedModel','matchedModel','resolvedProvider','resolvedTool','resolvedTier','longContextApplied','contextInputUnknown','conditionSource','id'];
const pick=(obj,keys)=>Object.fromEntries(keys.filter(k=>obj?.[k]!==undefined).map(k=>[k,structuredClone(obj[k])]));
function rateOf(r,depth=0){
  if(!r)return null;
  const out=pick(r,RATE_KEYS);
  if(r.longContext)out.longContext=pick(r.longContext,['above','inputMultiplier','outputMultiplier']);
  if(r.contextTiers)out.contextTiers=r.contextTiers.map(t=>pick(t,['minInput','input','output','cacheRead','cacheWrite','cacheWrite5m','cacheWrite1h']));
  if(r.baseRule&&depth===0)out.baseRule=rateOf(r.baseRule,1);
  return out;
}
function safeBinding(b,depth=0){
  if(!b)return null;
  const out=pick(b,['version','status','eventModel','modelProvider','tariffModel','tariffModels','tariffProvider','tool','tariffScope','tier','tariffTier','matchKind']);
  out.reasonCodes=(b.reasonCodes||[]).map(x=>text(x,80));out.reasons=(b.reasons||[]).map(r=>pick(r,['code','message']));
  if(depth===0)out.rejected=b.rejected?safeBinding(b.rejected,1):null;
  return out;
}
function safeEvent(e){
  const out=pick(e,EVENT_KEYS);
  out.warnings=(e.warnings||[]).filter(x=>typeof x==='string').map(x=>text(x,150));
  if(e.identityKeys)out.identityKeys=e.identityKeys.filter(x=>typeof x==='string').map(x=>text(x,600));
  if(e.modelResolution)out.modelResolution=pick(e.modelResolution,['kind','source','asOf','conflict']);
  if(e.rawOutputDetails)out.rawOutputDetails=pick(e.rawOutputDetails,['field9','field10']);
  const p=e.price||{};
  out.price={binding:safeBinding(p.binding),...pick(p,['engineVersion','inputPico','outputPico','knownInputPico','knownOutputPico','knownPico','totalPico','status']),rate:rateOf(p.rate),
    missing:(p.missing||[]).map(x=>text(x,100)),referenceReasons:(p.referenceReasons||[]).map(x=>text(x,100)),
    reasons:(p.reasons||[]).map(r=>pick(r,['code','side','message'])),
    components:(p.components||[]).map(c=>pick(c,['key','label','side','tokens','usdPerMillion','costPico','costUsd','reason']))};
  return out;
}
function fingerprint(e){return crypto.createHash('sha256').update(JSON.stringify(e)).digest('hex');}
function validRecord(r){
  if(r?.schema!==SCHEMA||!Number.isSafeInteger(r.seq)||r.seq<1||!Number.isSafeInteger(r.revision)||r.revision<1||
    typeof r.id!=='string'||r.event?.id!==r.id||typeof r.event?.provider!=='string'||!r.event.price||
    !['input','output','normalInput','cacheRead','cacheWrite','cacheWrite5m','cacheWrite1h','cacheWriteUnknown','reasoning','tool','total'].every(k=>Number.isSafeInteger(r.event[k])&&r.event[k]>=0))throw new Error('사용량 보존 로그 형식 오류');
  if(r.fingerprint!==fingerprint(r.event))throw new Error('사용량 보존 로그 내용 해시 불일치');
}
class UsageLog{
  constructor(dataDir){this.directory=path.join(dataDir,'usage-log');this.latest=new Map();this.sequence=0;this.fileCount=0;this.bytes=0;this.records=0;this.lastSavedAt=null;this.lastError=null;this.repairs=0;this.needsReload=false;}
  async init(){
    await fs.mkdir(this.directory,{recursive:true,mode:0o700});
    if((await fs.lstat(this.directory)).isSymbolicLink())throw new Error('사용량 보존 로그 폴더는 심볼릭 링크를 허용하지 않습니다.');
    this.latest=new Map();this.sequence=0;this.fileCount=0;this.bytes=0;this.records=0;
    const names=(await fs.readdir(this.directory)).filter(n=>/^\d{4}-\d{2}\.jsonl$/.test(n)).sort();
    for(const name of names){
      const file=path.join(this.directory,name),st=await fs.lstat(file);
      if(!st.isFile()||st.isSymbolicLink())throw new Error('보존 로그 파일 형식/링크 오류');
      this.fileCount++;let pending=Buffer.alloc(0),completeBytes=0;
      for await(const chunk of fss.createReadStream(file)){
        pending=Buffer.concat([pending,chunk]);let nl;
        while((nl=pending.indexOf(10))>=0){
          if(nl>MAX_LINE)throw new Error('보존 로그 행 크기 초과');
          const row=pending.subarray(0,nl);completeBytes+=nl+1;pending=pending.subarray(nl+1);
          let r;try{r=JSON.parse(row.toString('utf8'));validRecord(r);}catch(e){throw new Error(`${name} 보존 로그 손상: ${e.message}. 원본을 보관하고 복구하세요.`);}
          const old=this.latest.get(r.id);
          if(!old||r.seq>old.seq)this.latest.set(r.id,r);
          else if(r.seq===old.seq&&r.fingerprint!==old.fingerprint)throw new Error('보존 로그 순번 충돌');
          this.sequence=Math.max(this.sequence,r.seq);this.records++;if(!this.lastSavedAt||r.observedAt>this.lastSavedAt)this.lastSavedAt=r.observedAt;
        }
        if(pending.length>MAX_LINE)throw new Error('보존 로그 행 크기 초과');
      }
      if(pending.length){
        // A crash may leave a final incomplete append. Preserve that exact fragment
        // before truncating OUR OWN journal to its last durable line boundary.
        await fs.writeFile(file+'.torn-'+Date.now()+'-'+crypto.randomBytes(3).toString('hex'),pending,{flag:'wx',mode:0o600});
        await fs.truncate(file,completeBytes);this.repairs++;
      }
      this.bytes+=completeBytes;
    }
    this.needsReload=false;return this;
  }
  async sync(events,{importExisting=false}={}){
    if(this.needsReload)await this.init();
    const now=new Date().toISOString(),file=path.join(this.directory,now.slice(0,7)+'.jsonl');
    let pending=[];
    const flush=async()=>{
      if(!pending.length)return;
      let handle;const start=this.sequence;
      try{
        const st=await fs.lstat(this.directory);if(st.isSymbolicLink()||!st.isDirectory())throw new Error('보존 로그 폴더 변경 감지');
        // lstat also rejects pre-existing links on runtimes without O_NOFOLLOW.
        // The shared same-user threat boundary is unchanged (not an OS sandbox).
        try { const target=await fs.lstat(file);if(!target.isFile()||target.isSymbolicLink())throw new Error('보존 로그 파일 형식/링크 오류'); }
        catch(e){if(e.code!=='ENOENT')throw e;}
        handle=await fs.open(file,fss.constants.O_APPEND|fss.constants.O_CREAT|fss.constants.O_WRONLY|(fss.constants.O_NOFOLLOW||0),0o600);
        if(!(await handle.stat()).isFile())throw new Error('보존 로그는 일반 파일이어야 합니다.');
        const rows=pending.map(({event,fp,old})=>({schema:SCHEMA,seq:++this.sequence,revision:(old?.revision||0)+1,id:event.id,
          change:old?'revision':importExisting?'import':'observed',observedAt:now,fingerprint:fp,event}));
        const lines=rows.map(r=>JSON.stringify(r)+'\n');if(lines.some(s=>Buffer.byteLength(s)>MAX_LINE))throw new Error('보존 로그 행 크기 초과');
        const data=lines.join('');await handle.writeFile(data,'utf8');await handle.sync();
        for(const r of rows)this.latest.set(r.id,r);
        this.bytes+=Buffer.byteLength(data);this.records+=rows.length;this.lastSavedAt=now;this.lastError=null;
        this.fileCount=(await fs.readdir(this.directory)).filter(n=>/^\d{4}-\d{2}\.jsonl$/.test(n)).length;
        pending=[];
      }catch(e){this.sequence=start;this.lastError=text(e.message,200);this.needsReload=true;throw e;}finally{await handle?.close();}
    };
    for(const raw of events){const event=safeEvent(raw),fp=fingerprint(event),old=this.latest.get(event.id);if(old?.fingerprint===fp)continue;pending.push({event,fp,old});if(pending.length>=100)await flush();}
    await flush();return this.sequence;
  }
  status(){return {enabled:true,directory:this.directory,files:this.fileCount,lines:this.records,uniqueRequests:[...this.latest.values()].filter(r=>!r.event.retired).length,retiredRequests:[...this.latest.values()].filter(r=>r.event.retired).length,bytes:this.bytes,sequence:this.sequence,lastSavedAt:this.lastSavedAt,error:this.lastError,recoveredTails:this.repairs,
    policy:'자동 삭제 없음 · 월별 JSONL · 수정은 새 revision · 합산은 요청별 최신값만',contents:'모델·시각·토큰·단가·요청/세션 메타데이터. 프롬프트·응답·코드 본문·인증키 제외'};}
}
module.exports={UsageLog,safeEvent,rateOf,fingerprint,validRecord,SCHEMA};
