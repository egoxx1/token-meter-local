'use strict';
const { short, money, csvCell } = require('./util');
const {blankSplit,addSplit,finishSplit}=require('./output-breakdown');
const {blankInput,addInput,finishInput,blankRates,addRate,finishRates}=require('./input-breakdown');
const formatters=new Map();
function dateKey(time, zone) { if(!formatters.has(zone)){if(formatters.size>20)formatters.clear();formatters.set(zone,new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}));} return formatters.get(zone).format(new Date(time)); }
function blank() { return { inputBreakdown:blankInput(),apiRates:blankRates(),split:blankSplit(),records:0, input:0, output:0, total:0, cacheRead:0, cacheWrite:0, reasoning:0, pricedRecords:0, unpricedRecords:0, inputUnknown:0, outputUnknown:0, inputKnownRecords:0, outputKnownRecords:0, inputPico:0n, outputPico:0n, warnings:new Set(), priceStatuses:{calculated:0,reference:0,partial:0,unavailable:0}, reasonCounts:new Map(),unpricedInputTokens:0,unpricedOutputTokens:0,referenceMappedRecords:0 }; }
function add(a,e) {
  a.records++;addSplit(a.split,e);addInput(a.inputBreakdown,e);addRate(a.apiRates,e);
  for (const k of ['input','output','total','cacheRead','cacheWrite','reasoning']) a[k] += e[k];
  a.inputPico += BigInt(e.price.knownInputPico); a.outputPico += BigInt(e.price.knownOutputPico);
  if (e.price.totalPico === null) a.unpricedRecords++; else a.pricedRecords++;
  if (e.price.inputPico === null) a.inputUnknown++; else a.inputKnownRecords++;
  if (e.price.outputPico === null) a.outputUnknown++; else a.outputKnownRecords++;
  a.priceStatuses[e.price.status||(e.price.totalPico==null?'unavailable':'calculated')]++;
  if(e.modelResolution?.kind==='reference-map')a.referenceMappedRecords++;
  const codes=new Set();for(const r of e.price.reasons||[]){if(codes.has(r.code))continue;codes.add(r.code);const prev=a.reasonCounts.get(r.code)||{...r,records:0};prev.records++;a.reasonCounts.set(r.code,prev);}
  for(const part of e.price.components||[])if(part.costPico===null){if(part.side==='input')a.unpricedInputTokens+=part.tokens;else a.unpricedOutputTokens+=part.tokens;}
  for (const w of e.warnings) a.warnings.add(w);
  for (const m of e.price.missing) a.warnings.add('unpriced:' + m);
}
function finish(a) {
  return { inputBreakdown:finishInput(a.inputBreakdown),apiRates:finishRates(a.apiRates),normalInput:a.inputBreakdown.rows[0].tokens,...finishSplit(a.split,a.output),records:a.records, input:a.input, output:a.output, total:a.total, cacheRead:a.cacheRead, cacheWrite:a.cacheWrite, reasoning:a.reasoning, pricedRecords:a.pricedRecords, unpricedRecords:a.unpricedRecords,
    priceStatuses:a.priceStatuses,priceReasons:[...a.reasonCounts.values()],unpricedInputTokens:a.unpricedInputTokens,unpricedOutputTokens:a.unpricedOutputTokens,referenceMappedRecords:a.referenceMappedRecords,inputUnpricedRecords:a.inputUnknown,outputUnpricedRecords:a.outputUnknown,
    inputKnownRecords:a.inputKnownRecords, outputKnownRecords:a.outputKnownRecords,
    inputUsd:a.inputUnknown ? null : Number(a.inputPico)/1e12,
    outputUsd:a.outputUnknown ? null : Number(a.outputPico)/1e12,
    totalUsd:a.unpricedRecords ? null : Number(a.inputPico+a.outputPico)/1e12,
    knownInputUsd:Number(a.inputPico)/1e12, knownOutputUsd:Number(a.outputPico)/1e12, knownTotalUsd:Number(a.inputPico+a.outputPico)/1e12,
    knownInputPico:String(a.inputPico), knownOutputPico:String(a.outputPico), knownTotalPico:String(a.inputPico+a.outputPico), warnings:[...a.warnings], cacheHitRate:a.input ? a.cacheRead/a.input : 0
  };
}
function grouped(events, keyFn, metaFn) {
  const map = new Map();
  for (const e of events) { const k=keyFn(e); if(!map.has(k)) map.set(k,{meta:metaFn(e), a:blank()}); add(map.get(k).a,e); }
  return [...map.entries()].map(([id,{meta,a}]) => ({id,...meta,...finish(a)})).sort((a,b)=>b.knownTotalUsd-a.knownTotalUsd || b.total-a.total);
}
function filtered(c, query = {}, now = new Date()) {
  if(query.dataset && !['active','source'].includes(query.dataset))throw new Error('지원하지 않는 데이터 범위');
  if(query.dataset==='source'&&query.scope!=='session')throw new Error('원본 누적은 세션 범위에서만 조회하세요.');
  let events=query.dataset==='source'?require('./reliability').sourceEvents(c):[...c.events.values()];
  if (query.provider && query.provider !== 'all') events=events.filter(e=>e.provider===query.provider);
  if (query.project) events=events.filter(e=>e.projectId===query.project);
  if (query.model) events=events.filter(e=>e.model===query.model);
  const scope=query.scope || 'today';
  if(scope==='measurement'){const m=c.measurements?.get(query.measurement||c.measurements?.state.pinnedId);if(!m)throw new Error('측정을 선택하세요.');return {events:c.measurements.calculate(m).events,scope,sessionId:'',measurement:c.measurements.view(m)};}
  let sessionId=query.session || '';
  if(scope==='session' && !sessionId) sessionId=events.filter(e=>e.timestamp).sort((a,b)=>b.timestamp.localeCompare(a.timestamp))[0]?.sessionId || '';
  const today=dateKey(now,c.config.timeZone);
  if(scope==='today' || scope==='month') events=events.filter(e=>e.timestamp && (scope==='today' ? dateKey(e.timestamp,c.config.timeZone)===today : dateKey(e.timestamp,c.config.timeZone).slice(0,7)===today.slice(0,7)));
  else if(scope==='session') events=events.filter(e=>e.sessionId===sessionId);
  else if(scope==='task') {
    const task=c.tasks.find(t=>t.id===query.task) || c.tasks.find(t=>!t.end);
    events=task ? events.filter(e=>e.timestamp && e.timestamp>=task.start && (!task.end || e.timestamp<task.end) && (!task.projectId || e.projectId===task.projectId)) : [];
  } else if(scope!=='all') throw new Error('지원하지 않는 scope');
  return {events,scope,sessionId};
}
function summarize(c, query={}, now=new Date()) {
  const {events,scope,sessionId,measurement}=filtered(c,query,now), a=blank(); for(const e of events)add(a,e);
  const all=[...c.events.values()];
  const sessions=new Map();
  for(const e of require('./reliability').sourceEvents(c)) {
    if(!sessions.has(e.sessionId) || (e.timestamp||'')>sessions.get(e.sessionId).lastTime) sessions.set(e.sessionId,{id:e.sessionId,provider:e.provider,model:e.model,project:e.project,lastTime:e.timestamp||'',effort:e.effort});
  }
  const observed=Object.values(c.files).map(x=>x.state).filter(s=>s.model && (!measurement || (measurement.status==='running' && require('./measurements').matches({...s,modelProvider:s.modelProvider||require('./pricing').serviceOf(s)},measurement.filter))) && (!query.provider||query.provider==='all'||s.provider===query.provider) && (!query.project||s.projectId===query.project) && (scope!=='session'||`${s.provider}:${s.sessionId}`===sessionId)).sort((a,b)=>(b.lastTime||'').localeCompare(a.lastTime||''));
  let s=observed[0];
  const last=events.filter(e=>e.timestamp).sort((a,b)=>b.timestamp.localeCompare(a.timestamp))[0];
  if(last&&(!s||last.timestamp>(s.lastTime||'')))s={...last,sessionId:last.sessionId.slice(last.provider.length+1),lastTime:last.timestamp};
  const latest=s?{provider:s.provider,modelProvider:s.modelProvider,model:s.model,effort:s.effort,role:s.role,sessionId:`${s.provider}:${s.sessionId}`,timestamp:s.lastTime,contextWindow:s.contextWindow??null,lastContextTokens:s.lastContextTokens??null}:null;
  const day=blank(); for(const e of all)if(e.timestamp&&dateKey(e.timestamp,c.config.timeZone)===dateKey(now,c.config.timeZone))add(day,e);
  const dayFinished=finish(day);
  return {version:require('../package.json').version, generatedAt:now.toISOString(), updatedAt:c.updatedAt, scanning:c.scanning,
    scope,scopeInfo:require('./reliability').scopeInfo(c,query,events), selectionNotice:query.selectionNotice||null,dataState:require('./data-reset').dataState(c), measurement:measurement||null, selectedSession:sessionId, provider:measurement?(measurement.filter.provider||'all'):query.provider||'all', timeZone:c.config.timeZone,
    billingMode:c.config.billingMode, costLabel:events.some(e=>e.provider==='antigravity')?'API 환산':c.config.billingMode==='api-estimate'?'API 추정':'API 환산',
    summary:{...finish(a),...(measurement||(c.resetBoundary&&query.dataset!=='source')?{measured:true}:{})}, latest,
    byProvider:grouped(events,e=>e.provider,e=>({provider:e.provider})),
    byModel:grouped(events,e=>JSON.stringify([e.provider,require('./pricing').serviceOf(e),e.model,e.effort,e.role]),e=>({provider:e.provider,modelProvider:require('./pricing').serviceOf(e),model:e.model,effort:e.effort,role:e.role})),
    byProject:grouped(events,e=>e.projectId,e=>({project:e.project})),
    byRole:grouped(events,e=>e.role,e=>({role:e.role})),
    sessions:[...sessions.values()].sort((a,b)=>b.lastTime.localeCompare(a.lastTime)).filter((s,i)=>i<500||s.id===sessionId),sessionListLimited:sessions.size>500,
    projects:[...new Map(all.map(e=>[e.projectId,{id:e.projectId,name:e.project}])).values()],
    recent:events.slice().sort((a,b)=>(b.timestamp||b.firstObservedAt||'').localeCompare(a.timestamp||a.firstObservedAt||'')).slice(0,100).map(require('./history').recordView),
    storage:c.journal?.status(),repairs:c.repairs,
    catalog:c.catalog?.status(c.config.catalogUpdates),
    tasks:c.tasks, health:c.health, warnings:c.warnings, scanStats:c.scanStats,
    unknownTimeRecords:all.filter(e=>!e.timestamp).length,
    budget:{day:dateKey(now,c.config.timeZone),dailyUsd:c.config.dailyBudgetUsd,knownTodayUsd:dayFinished.knownTotalUsd,unpricedRecords:dayFinished.unpricedRecords,exceeded:c.config.dailyBudgetUsd!==null&&dayFinished.knownTotalUsd>=c.config.dailyBudgetUsd},
    fx:c.config.usdToKrw?{rate:c.config.usdToKrw,asOf:c.config.fxAsOf}:null,
    priceBasis:'금액은 항목별 표시 반올림으로 합계와 마지막 자릿수가 다를 수 있습니다. 각 기록의 단가 출처·기준일·항목별 계산근거를 확인할 수 있습니다. 표시 비용은 저장된 API 텍스트 단가 기준이며 실제 청구액이 아닙니다. GPT-6는 확인된 요청 입력 272,000토큰 초과 시 전체 요청의 입력·캐시 단가 2배, 출력 1.5배를 적용합니다. 요청 길이 미확인 또는 과거 고정 스냅샷은 참고 조건을 명시합니다. 과거 청구단가·세금·구독료·도구요금·캐시 저장료·무료 크레딧·지역 할증은 포함하지 않습니다.',
    antigravity:{supported:true,source:'read-only-sqlite',health:c.health.antigravity||{},message:'Antigravity Desktop/CLI/IDE의 SQLite 메타데이터 관측값. 비공개 스키마 기반이며 실제 청구액이나 계정 한도가 아닙니다. 구형 PB 기록은 미지원.'}
  };
}
function costText(s,kind='total') {
  const full=s[`${kind}Usd`], known=s[`known${kind[0].toUpperCase()+kind.slice(1)}Usd`];
  return full!=null?money(full):known>0?`${money(known)} (계산분)`:'계산 불가';
}
function statusLine(d, { tokenDisplay = 'compact' } = {}) {
  const label = {today:'오늘',month:'이번 달',all:'전체',session:'세션',task:'작업',measurement:'재측정'}[d.scope] || d.scope;
  const tools = {all:'전체 도구',codex:'Codex',claude:'Claude Code',antigravity:'Antigravity',gemini:'Gemini CLI (이전 기록)',generic:'사용량 연동'};
  const s = d.summary;
  const tokens = tokenDisplay === 'exact' ? n => Number(n).toLocaleString('en-US') : short;
  const model = d.latest ? `최근 ${tools[d.latest.provider] || d.latest.provider} ${d.latest.model}${d.latest.effort ? ' '+d.latest.effort : ''}` : '모델 기록 대기';
  const prefix = `TM ${d.measurement ? label+' '+d.measurement.name+(d.measurement.status==='running'?' [진행]':' [종료]') : label} · ${tools[d.provider] || d.provider || '전체 도구'} | ${model}`;
  const v=require('./billing-view').build(s);
  const amounts=[...v.components,v.total].map(item=>{
    if(!s.records&&!s.measured)return `${item.short} — / —`;
    const n=item.tokens==null||item.usageUnreported?'미기록':tokens(item.tokens)+(item.usageState==='partial'?'(관측분)':item.partial?'(참고)':'');
    const c=item.usageUnreported?'분리 불가':item.costUsd!=null?money(item.costUsd)+(item.usageState==='partial'?'(관측분)':''):item.knownUsd>0?money(item.knownUsd)+' (계산분)':'계산 불가';
    return `${item.short} ${n} tok / ${c}`;
  });
  return `${prefix} | ${amounts.join(' | ')} | ${!s.records&&!s.measured?'사용 기록 없음':d.costLabel+' · IN 일반 / OUT 추론 포함'}`;

}
function exportCsv(c,q) {
  const fields=['timestamp','provider','modelProvider','model','effort','role','sessionId','project','input','normalInput','output','cacheRead','cacheWrite','cacheWrite5m','cacheWrite1h','cacheWriteUnknown','cacheReadKnown','cacheWriteKnown','normalInputUsd','cacheReadUsd','cacheWriteUsd','inputFieldMeaning','displayINField','cacheWrite5mUsd','cacheWrite1hUsd','cacheWriteUnknownUsd','priceUnitTokens','priceCurrency','rateInput','rateCachedInput','rateCacheWrite','rateCacheWrite5m','rateCacheWrite1h','rateOutput','reasoning','responseOutput','thinkingOutput','billableOutput','unclassifiedOutput','outputSplitStatus','responseUsd','thinkingUsd','total','inputUsd','outputUsd','totalUsd','knownTotalUsd','priceAsOf','priceSource','warnings'];
  const rows=filtered(c,q).events.map(e=>({...e,...require('./history').recordView(e),inputUsd:e.price.inputPico===null?'':Number(e.price.inputPico)/1e12,outputUsd:e.price.outputPico===null?'':Number(e.price.outputPico)/1e12,totalUsd:e.price.totalPico===null?'':Number(e.price.totalPico)/1e12,knownTotalUsd:Number(e.price.knownPico)/1e12,priceAsOf:e.price.rate?.asOf,priceSource:e.price.rate?.source,warnings:[...e.warnings,...e.price.missing.map(m=>'unpriced:'+m)].join(';')}));
  return '\uFEFF'+fields.join(',')+'\r\n'+rows.map(e=>fields.map(f=>csvCell(e[f])).join(',')).join('\r\n')+'\r\n';
}
function aggregate(events){const a=blank();for(const e of events)add(a,e);return finish(a);}
module.exports={aggregate,grouped,dateKey,filtered,summarize,statusLine,costText,exportCsv};
