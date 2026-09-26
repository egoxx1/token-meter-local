'use strict';
/** Independent, non-destructive observation meters. No source log is ever reset. */
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { atomicJson, readJson, text, csvCell } = require('./util');
const { priceEvent, serviceOf } = require('./pricing');
const {SPLIT_KEYS,ensureSplit,splitOf,attachSplit}=require('./output-breakdown');
const FILTER_KEYS = ['sessionId','provider','modelProvider','model','effort','role','projectId'];
const BUCKETS = ['input','output','normalInput','cacheRead','cacheWrite','cacheWrite5m','cacheWrite1h','cacheWriteUnknown','reasoning','tool','total'];
const ATOMS = ['normalInput','cacheRead','cacheWrite5m','cacheWrite1h','cacheWriteUnknown'];
const LIMITS = Object.freeze({ active: 12, history: 500, baseline: 100000 });
const OUTCOMES = ['unrated','pass','fail','partial'];
const nowISO = () => new Date().toISOString();
function filterOf(raw = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('측정 필터는 객체여야 합니다.');
  const f = {};
  for (const k of Object.keys(raw)) if (!FILTER_KEYS.includes(k)) throw new Error('지원하지 않는 측정 필터: '+k);
  for (const k of FILTER_KEYS) {
    if (raw[k] == null || (k === 'provider' && raw[k] === 'all')) continue;
    if (typeof raw[k] !== 'string' || raw[k].length > 240 || text(raw[k],240) !== raw[k]) throw new Error('잘못된 측정 필터: '+k);
    f[k] = raw[k]; // Empty effort / role is exact, not a wildcard.
  }
  if (f.provider && !['codex','claude','antigravity','gemini','generic'].includes(f.provider)) throw new Error('지원하지 않는 도구');
  return f;
}
function matches(e,f) { return FILTER_KEYS.every(k => !(k in f) || (k==='modelProvider' ? serviceOf(e) : e[k] ?? '') === f[k]); }
function filterKey(f) { return JSON.stringify(filterOf(f)); }
function buckets(e) { return {...Object.fromEntries(BUCKETS.map(k=>[k,e[k] || 0])),...Object.fromEntries(['cacheWriteKnown','cacheReadKnown','contextInputKnown','inputEvidence'].filter(k=>e[k]!==undefined).map(k=>[k,e[k]])),...Object.fromEntries(SPLIT_KEYS.filter(k=>e[k]!==undefined).map(k=>[k,e[k]]))}; }
function label(f) { return [f.provider||'전체 도구',f.model,f.effort, f.role,f.sessionId?'세션 '+f.sessionId.slice(-12):'', f.projectId?'선택 프로젝트':''].filter(Boolean).join(' · '); }
function diagnostics(c) {
  const issues = [...(c.warnings||[])];
  for (const [p,h] of Object.entries(c.health||{})) if (h.errors || h.limited || h.partial || h.oversizedFiles) issues.push(p+': 일부 수집');
  return [...new Set(issues)];
}
function unknownInput(price) {
  return {...price, inputPico:null, knownInputPico:'0', knownPico:price.knownOutputPico,
    totalPico:null, missing:[...new Set([...price.missing,'measurement-input-breakdown'])]};
}
/** Delta buckets are priced at the *full request's* context tier, never the smaller delta's tier. */
function deltaEvent(e,b) {
  const input = b ? Math.max(0,e.input-b.input) : e.input;
  const output = b ? Math.max(0,e.output-b.output) : e.output;
  if (!input && !output) return null; // Repricing / cache corrections alone are not fresh use.
  const d = {...e, ...buckets(e), input, output, total:input+output, warnings:[...(e.warnings||[])]};
  let ambiguous = false;
  if (b) {
    for (const k of ATOMS) {
      d[k] = Math.max(0,(e[k]||0)-(b[k]||0));
      if ((e[k]||0)<(b[k]||0)) ambiguous = true;
    }
    if (ATOMS.reduce((a,k)=>a+d[k],0) !== input) ambiguous=true;
    if (!input) for(const k of ATOMS)d[k]=0;
    if (ambiguous && input) {
      d.normalInput=input; d.cacheRead=0; d.cacheWrite5m=0; d.cacheWrite1h=0; d.cacheWriteUnknown=0;
      d.warnings.push('measurement-cache-reclassification','measurement-input-breakdown-ambiguous');
    }
    d.cacheWrite=d.cacheWrite5m+d.cacheWrite1h+d.cacheWriteUnknown;
    d.reasoning=Math.min(output,Math.max(0,(e.reasoning||0)-(b.reasoning||0)));
    d.tool=Math.max(0,(e.tool||0)-(b.tool||0));
    d.warnings.push('measurement-observed-delta');
  }
  if(b){
    const end=splitOf(e),start=splitOf(b);
    let thinking=null,response=null;
    if(end.thinkingOutput!==null&&start.thinkingOutput!==null){
      const t=end.thinkingOutput-start.thinkingOutput,r=end.responseOutput-start.responseOutput;
      if(t>=0&&r>=0&&t+r===output){thinking=t;response=r;}
    }
    attachSplit(d,{thinking,response,reference:end.status==='reference'||start.status==='reference',
      totalKnown:end.totalKnown&&start.totalKnown,source:'measurement-output-delta',
      note:thinking===null&&output>0?'출력 증가분의 분해 미확인: 기준점/종료 세부값 누락 또는 재분류. 전체 출력 증가분은 유지합니다.':'기준점 이후 비추론/THINKING 증가분. 기존 THINKING 보완만으로 소비량을 추가하지 않습니다.'});
    d.reportedOutput=null;d.rawOutputDetails=null;d.outputEvidence='measurement-output-delta';
  } else ensureSplit(d);
  d.contextInput=e.contextInput??e.input;
  if(b&&input){if(b.cacheWriteKnown!==true)d.cacheWriteKnown=false;if(b.cacheReadKnown!==true)d.cacheReadKnown=false;}
  // An absent rate stays absent unless the collector itself has resolved it. Never guess a route.
  d.price=e.price?.rate ? priceEvent(d,[],e.price.rate) : {
    rate:null,inputPico:input?null:'0',outputPico:output?null:'0',totalPico:null,
    knownInputPico:'0',knownOutputPico:'0',knownPico:'0',missing:['model']
  };
  if (ambiguous && input) d.price=unknownInput(d.price);
  d.measurementDelta=true;
  return d;
}
function checkedState(s) {
  if(!s || s.version!==1 || !Array.isArray(s.runs) || s.runs.length>LIMITS.history) throw new Error('measurements.json 형식 오류. 원본을 보존하고 백업을 확인하세요.');
  const ids=new Set();
  for(const r of s.runs) {
    if(!r || typeof r.id!=='string' || ids.has(r.id) || !['running','ended','cancelled'].includes(r.status) || !['baseline','named'].includes(r.kind) || typeof r.name!=='string' || !Number.isFinite(Date.parse(r.start))) throw new Error('측정 기록 형식 오류');
    ids.add(r.id); r.filter=filterOf(r.filter);
    if(r.end!=null&&!Number.isFinite(Date.parse(r.end)))throw new Error('측정 종료 시각 오류');
    if(!OUTCOMES.includes(r.outcome)||typeof r.notes!=='string')throw new Error('측정 메타데이터 오류');
    if(r.status==='running') {
      if(!Array.isArray(r.baseline)||r.baseline.length>LIMITS.baseline)throw new Error('측정 기준점 오류');
      const seen=new Set();
      for(const pair of r.baseline) {
        if(!Array.isArray(pair)||pair.length!==2||typeof pair[0]!=='string'||seen.has(pair[0])||BUCKETS.some(k=>!Number.isSafeInteger(pair[1]?.[k])||pair[1][k]<0))throw new Error('측정 기준점 카운터 오류');
        seen.add(pair[0]);
      }
    } else if(!Array.isArray(r.result?.events)||r.result.events.some(e=>!e.price||BUCKETS.some(k=>!Number.isSafeInteger(e[k])||e[k]<0))) throw new Error('종료된 측정 스냅샷 오류');
  }
  if(s.pinnedId&&!ids.has(s.pinnedId))throw new Error('고정된 측정 ID 오류');
  return s;
}
class Measurements {
  constructor(c, {clock=nowISO,write=atomicJson}={}) {
    this.c=c; this.clock=clock;this.write=write;this.queue=Promise.resolve();
    this.file=path.join(c.storageDir||c.dataDir,'measurements.json');this.backup=path.join(c.storageDir||c.dataDir,'measurements.backup.json');
    this.state={version:1,runs:[],pinnedId:null,undo:null};
  }
  async init(){this.state=checkedState(await readJson(this.file,this.state));this.c.measurements=this;return this;}
  get(id){const r=this.state.runs.find(x=>x.id===id);if(!r)throw new Error('측정 기록을 찾을 수 없습니다.');return r;}
  async mutate(fn) {
    const job=this.queue.catch(()=>{}).then(async()=>{
      const before=structuredClone(this.state);
      try { const result=await fn(); await this.write(this.backup,before);await this.write(this.file,this.state);return result; }
      catch(e){this.state=before;throw e;}
    });this.queue=job;return job;
  }
  snapshot() {
    if(this.c.events.size>LIMITS.baseline)throw new Error('기준점 최대 100,000개 기록을 초과했습니다. 누적 기록은 삭제하지 않았습니다.');
    // Snapshot all identities so later model attribution cannot turn old use into new use.
    return [...this.c.events].map(([id,e])=>[id,buckets(e)]);
  }
  calculate(r) {
    if(r.status!=='running')return r.result;
    const repairedBase=require('./identity-repair').measurementBaseline(this.c,r,new Map(r.baseline));
    const base=repairedBase.baseline,events=[];
    const detail={lateOld:0,undated:0,partialRequests:0,inputBreakdownUnknown:0,regressed:0,identityBaselineRepaired:repairedBase.affected};
    for(const e of this.c.events.values()) {
      if(!matches(e,r.filter))continue;
      const b=base.get(e.id);
      if(!b) {
        if(!e.timestamp){detail.undated++;continue;}
        if(e.timestamp<r.start){detail.lateOld++;continue;}
      }
      if(b&&(e.input<b.input||e.output<b.output))detail.regressed++;
      const d=deltaEvent(e,b); if(!d)continue;
      if(b)detail.partialRequests++;
      if(d.warnings.includes('measurement-cache-reclassification'))detail.inputBreakdownUnknown++;
      events.push(d);
    }
    return {events,detail,sourceWarnings:[...new Set([...(r.startWarnings||[]),...(repairedBase.affected?['Antigravity 호출 ID 교정 후 재구성한 측정. 과거 경계의 세부 사용량은 복원 제한이 있습니다.']:[]),...(repairedBase.uncertain?['Antigravity 측정 시작 전 step 사용량 시각 미확인 '+repairedBase.uncertain+'건: 증가분을 확정할 수 없습니다.']:[]),...diagnostics(this.c)])],evaluatedAt:this.clock()};
  }
  finish(r,status='ended') {
    if(r.status!=='running')throw new Error('이미 종료된 측정입니다.');
    r.result=structuredClone(this.calculate(r));r.end=this.clock();r.status=status;delete r.baseline;
  }
  view(r,now=this.clock()) {
    const result=this.calculate(r),a=require('./summary').aggregate(result.events);
    const elapsedMs=Math.max(0,Date.parse(r.end||now)-Date.parse(r.start));
    const legacyFrozen=r.status!=='running'&&result.events.some(require('./identity-repair').isLegacy);
    const sourceWarnings=[...(result.sourceWarnings||[]),...(legacyFrozen?['구버전 Antigravity 병합 결과가 포함된 고정 측정입니다. 값은 보관했지만 정확한 토큰 총량으로 사용하지 마세요. 최신 원본 세션 대조를 확인하세요.']:[])];
    return {id:r.id,name:r.name,kind:r.kind,filter:r.filter,label:label(r.filter),start:r.start,end:r.end,status:r.status,
      archived:!!r.archived,notes:r.notes,outcome:r.outcome,budgetUsd:r.budgetUsd,
      pinned:this.state.pinnedId===r.id,summary:{...a,measured:true},elapsedMs,
      tokensPerMinute:elapsedMs>=1000?a.total/(elapsedMs/60000):null,
      knownUsdPerHour:elapsedMs>=1000?a.knownTotalUsd/(elapsedMs/3600000):null,
      budgetExceeded:r.budgetUsd!=null&&a.knownTotalUsd>=r.budgetUsd,
      detail:{...result.detail,legacyFrozen},sourceWarnings,
      groups:require('./summary').grouped(result.events,e=>JSON.stringify(FILTER_KEYS.map(k=>k==='modelProvider'?serviceOf(e):e[k]??'')),e=>Object.fromEntries(FILTER_KEYS.map(k=>[k,k==='modelProvider'?serviceOf(e):e[k]??''])))};
  }
  list(){return {version:1,pinnedId:this.state.pinnedId,canUndo:!!this.state.undo,limits:LIMITS,runs:this.state.runs.slice().reverse().map(r=>this.view(r))};}
  async start(raw={},reset=false) {
    return this.mutate(async()=>{
      if(raw.requestKey!=null && (typeof raw.requestKey!=='string'||!raw.requestKey||raw.requestKey.length>100))throw new Error('요청 키 오류');
      if(raw.requestKey){const existing=this.state.runs.find(r=>r.clientKey===raw.requestKey);if(existing)return this.view(existing);}
      const f=filterOf(raw.filter),name=text(raw.name,120).trim()||(reset?label(f)+' 재측정':'');
      if(!name)throw new Error('측정 이름을 입력하세요.');
      const budget=raw.budgetUsd??null;
      if(budget!==null&&(!Number.isFinite(budget)||budget<=0||budget>1000000))throw new Error('측정 예산은 0 초과 1,000,000 USD 이하여야 합니다.');
      if(this.state.runs.length>=LIMITS.history)throw new Error('측정 기록 한도 500개에 도달했습니다. 필요한 결과를 내보내고 불필요한 측정 기록을 삭제하세요.');
      const old=reset?this.state.runs.find(r=>r.kind==='baseline'&&r.status==='running'&&filterKey(r.filter)===filterKey(f)):null;
      if(this.state.runs.filter(r=>r.status==='running').length-(old?1:0)>=LIMITS.active)throw new Error('동시 측정은 최대 12개입니다. 먼저 측정을 종료하세요.');
      await this.c.scan();
      const baseline=this.snapshot();const previous=old?structuredClone(old):null;
      if(old)this.finish(old);
      const r={id:randomUUID(),clientKey:raw.requestKey||null,name,kind:reset?'baseline':'named',filter:f,start:this.clock(),end:null,status:'running',
        baseline,notes:text(raw.notes,2000),outcome:'unrated',budgetUsd:budget,startWarnings:diagnostics(this.c),archived:false};
      this.state.runs.push(r);
      this.state.undo=reset?{newId:r.id,previous,pinnedId:this.state.pinnedId}:null;
      if(old&&this.state.pinnedId===old.id)this.state.pinnedId=r.id;
      return this.view(r);
    });
  }
  async stop(id) {return this.mutate(async()=>{const r=this.get(id);if(r.status!=='running')return this.view(r);await this.c.scan();this.finish(r);this.state.undo=null;return this.view(r);});}
  async undo() {return this.mutate(async()=>{
    const u=this.state.undo;if(!u)throw new Error('취소할 초기화가 없습니다.');
    const r=this.get(u.newId);if(r.status!=='running')throw new Error('측정 상태가 바뀌어 초기화를 취소할 수 없습니다.');
    await this.c.scan();this.finish(r,'cancelled');
    if(u.previous){const at=this.state.runs.findIndex(x=>x.id===u.previous.id);this.state.runs[at]=u.previous;}
    this.state.pinnedId=u.pinnedId;this.state.undo=null;return {restoredId:u.previous?.id||null};
  });}
  async update(id,raw) {return this.mutate(async()=>{
    const r=this.get(id);for(const k of Object.keys(raw))if(!['id','name','notes','outcome','archived'].includes(k))throw new Error('수정할 수 없는 측정 필드: '+k);
    if(raw.name!==undefined){const name=text(raw.name,120).trim();if(!name)throw new Error('이름을 입력하세요.');r.name=name;}
    if(raw.notes!==undefined){if(typeof raw.notes!=='string')throw new Error('메모는 문자열이어야 합니다.');r.notes=text(raw.notes,2000);}
    if(raw.outcome!==undefined){if(!OUTCOMES.includes(raw.outcome))throw new Error('결과 값 오류');r.outcome=raw.outcome;}
    if(raw.archived!==undefined){if(typeof raw.archived!=='boolean')throw new Error('숨김 값 오류');if(raw.archived&&r.status==='running')throw new Error('진행 중인 측정은 종료 후 숨기세요.');r.archived=raw.archived;if(r.archived&&this.state.pinnedId===r.id)this.state.pinnedId=null;}
    this.state.undo=null;return this.view(r);
  });}
  async pin(id){return this.mutate(async()=>{if(id){const r=this.get(id);if(r.archived)throw new Error('숨긴 측정은 먼저 복원하세요.');}this.state.pinnedId=id||null;return {pinnedId:this.state.pinnedId};});}
  async remove(raw={}) {
    return this.mutate(async()=>{
      const all=raw.all===true;
      if(raw.confirmation!==(all?'측정 전체 삭제':'삭제')) throw new Error('측정 삭제 확인이 필요합니다.');
      if(!all&&(!Array.isArray(raw.ids)||!raw.ids.length||raw.ids.length>LIMITS.history||raw.ids.some(id=>typeof id!=='string'||!id||id.length>100))) throw new Error('삭제할 측정 ID를 선택하세요.');
      const ids=new Set(all?this.state.runs.map(r=>r.id):raw.ids);
      const removed=this.state.runs.filter(r=>ids.has(r.id));
      this.state.runs=this.state.runs.filter(r=>!ids.has(r.id));
      if(ids.has(this.state.pinnedId))this.state.pinnedId=null;
      // A previous reset undo must never resurrect a deleted measurement.
      this.state.undo=null;
      return {ok:true,deleted:removed.length,deletedIds:removed.map(r=>r.id),stopped:removed.filter(r=>r.status==='running').length,
        pinnedId:this.state.pinnedId,usagePreserved:true,backup:this.backup};
    });
  }
  export(ids) {
    if(!Array.isArray(ids)||!ids.length||ids.length>20)throw new Error('내보낼 측정은 1~20개 선택하세요.');
    const runs=[...new Set(ids)].map(id=>this.view(this.get(id)));
    return {schema:'token-meter.measurements.v1',exportedAt:this.clock(),costLabel:'API 환산/추정액 · 실제 청구액 아님',
      note:'측정은 서로 겹칠 수 있습니다. 표의 합계를 전체 사용량으로 더하지 마세요. 경과시간은 관측 구간이며 모델 실행 속도가 아닙니다.',runs};
  }
  csv(ids) {
    const fields=['name','provider','modelProvider','model','effort','role','projectId','status','outcome','start','end','elapsedSeconds','normalInput','normalInputUsd','cacheRead','cacheReadUsd','cacheWrite','cacheWriteUsd','input','inputUsd','responseOutput','responseUsd','thinkingOutput','thinkingUsd','unclassifiedOutput','outputSplitStatus','output','outputUsd','total','totalUsd','knownTotalUsd','unpricedRecords','notes'];
    return '\uFEFF'+fields.join(',')+'\r\n'+this.export(ids).runs.map(r=>{const row={...r,...r.filter,...r.summary,elapsedSeconds:Math.round(r.elapsedMs/1000)};for(const b of require('./billing-view').build(r.summary).components){row[b.key]=b.tokens;row[b.key+'Usd']=b.costUsd;}return fields.map(k=>csvCell(row[k])).join(',');}).join('\r\n')+'\r\n';
  }
}
module.exports={Measurements,filterOf,filterKey,matches,deltaEvent,buckets,LIMITS};
