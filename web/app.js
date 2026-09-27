'use strict';
const $=id=>document.getElementById(id);
const LABELS={today:'오늘',month:'이번 달',all:'전체',session:'세션',task:'작업',measurement:'재측정'};
const NAMES={codex:'Codex',claude:'Claude Code',gemini:'Gemini CLI (이전 기록)',antigravity:'Antigravity',generic:'사용량 연동'};
let key=new URLSearchParams(location.hash.slice(1)).get('key')||'';
try{if(key)sessionStorage.setItem('token-meter-key',key);else key=sessionStorage.getItem('token-meter-key')||'';}catch{}
if(location.hash)history.replaceState(null,'',location.pathname);
let scope='today',lastData=null,requestSeq=0,pipWindow=null,connected=false;
let currentConfig=null,catalogRows=[];
const int=n=>Number(n||0).toLocaleString('ko-KR');
const compact=n=>n>=1e9?(n/1e9).toFixed(2)+'B':n>=1e6?(n/1e6).toFixed(2)+'M':n>=1000?(n/1000).toFixed(1)+'K':String(n||0);
const METRICS=[['normalInput','IN'],['cacheRead','CACHE READ'],['cacheWrite','CACHE WRITE'],['output','OUT'],['total','TOTAL']];
const billingCache=new WeakMap();
function billingView(s){if(!billingCache.has(s))billingCache.set(s,TokenMeterBilling.build(s));return billingCache.get(s);}
function billingItem(s,kind){const v=billingView(s);return kind==='total'?v.total:v.components.find(x=>x.key===kind);}
function splitToken(s,kind,short=false){
  const fmt=short?compact:int,value=s[kind+'Output'];
  const reference=(s.splitReferenceRecords||0)>0||s.outputSplitStatus==='reference';
  if(value!=null)return fmt(value)+(reference?' (참고)':'');
  const known=s['known'+kind[0].toUpperCase()+kind.slice(1)+'Output'];
  return s.splitKnownRecords>0?fmt(known||0)+' (관측분)':'분해 미확인';
}
function metricToken(s,kind,short=false){
  if(kind==='response'||kind==='thinking')return splitToken(s,kind,short);
  const item=billingItem(s,kind);
  if(!item||item.tokens==null||item.usageUnreported)return '미기록';
  return (short?compact:int)(item.tokens)+(item.usageState==='partial'?' (관측분)':item.partial?' (참고)':'');
}
function metricCost(s,kind){
  if(kind==='response'||kind==='thinking'){
    if(s[kind+'Output']==null&&!s.splitKnownRecords)return '분해 미확인';
    return cost(s,kind);
  }
  const item=billingItem(s,kind);if(!item)return '계산 불가';
  if(item.usageUnreported)return '분리 불가';
  return item.costUsd!=null?dollars(item.costUsd)+(item.usageState==='partial'?' (관측분)':''):item.knownUsd>0?dollars(item.knownUsd)+' (계산분)':'계산 불가';
}
const dollars=n=>n==null||!Number.isFinite(n)?'단가 없음':'$'+Number(n).toLocaleString('en-US',{minimumFractionDigits:3,maximumFractionDigits:n>0&&n<.01?12:6});
function cost(s,kind='total'){const value=s[kind+'Usd'],known=s['known'+kind[0].toUpperCase()+kind.slice(1)+'Usd'];return value!=null?dollars(value):known>0?dollars(known)+' (계산분)':'계산 불가';}
function node(tag,cls,content){const el=document.createElement(tag);if(cls)el.className=cls;if(content!==undefined)el.textContent=String(content);return el;}
function append(parent,...children){for(const c of children)parent.append(c);return parent;}
function set(id,value){$(id).textContent=value;}
function clear(id){$(id).replaceChildren();return $(id);}
function flash(message,error=false){const el=$('message');el.textContent=message;el.className='message'+(error?' error-message':'');el.hidden=false;for(const dialog of document.querySelectorAll('dialog[open]')){let local=dialog.querySelector('.form-error');if(!local){local=node('p','form-error');dialog.append(local);}local.textContent=message;}}
function q(){const params=new URLSearchParams({scope,provider:$('provider').value,includeMeasurements:'1'});if($('project').value)params.set('project',$('project').value);if(scope==='session'){if($('session').value)params.set('session',$('session').value);params.set('dataset',$('dataset-select').value);}if(scope==='task'&&$('task-select').value)params.set('task',$('task-select').value);if(scope==='measurement'&&$('measurement-select').value)params.set('measurement',$('measurement-select').value);return params.toString();}
async function api(endpoint,body){const res=await fetch(endpoint,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+key,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(endpoint.includes('/api/reliability/')?180000:endpoint.includes('/api/antigravity/')||endpoint.includes('/api/data/')||endpoint.includes('/api/measurements/')||endpoint.includes('/api/scan')||endpoint.includes('/api/catalog/refresh')||endpoint.includes('/api/updates/')?65000:10000)});const data=await res.json();if(!res.ok)throw new Error(data.error||'서버 오류');return data;}
function populate(select,items,placeholder){const old=select.value;const options=[];if(placeholder!==undefined)options.push(Object.assign(node('option','',placeholder),{value:''}));for(const item of items)options.push(Object.assign(node('option','',item.label),{value:item.id}));select.replaceChildren(...options);if(options.some(o=>o.value===old))select.value=old;}
function clock(timestamp,full=false){if(!timestamp)return '시각 미기록';return new Date(timestamp).toLocaleString('ko-KR',{timeZone:lastData?.timeZone||'Asia/Seoul',...(full?{}:{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false})});}
function antigravityState(d) {
  const h=d.health?.antigravity||{};
  if(h.errorCodes?.includes('sqlite-runtime-unavailable'))return 'SQLite 런타임 없음 · Node 22.13+ 또는 Python 3 필요';
  if(h.status==='partial')return '일부 수집 · '+[...(h.errorCodes||[]),...(h.invalidRows?['잘못된 행 '+int(h.invalidRows)+'개']:[]),...(h.ambiguousStepRows?['모호한 step '+int(h.ambiguousStepRows)+'개']:[]),...(h.unrepairedAccountingRecords?['중복 가능 기록 '+int(h.unrepairedAccountingRecords)+'개']:[]),...(h.recoveryPending?['복구 저장 대기']:[]),...(h.boundaryUncertain?['초기화 경계 시각 미확인 '+int(h.boundaryUncertain)+'건']:[])].join(', ');
  if(h.status==='observed')return int(h.readableDatabases||0)+'개 DB · '+int(h.observedRecords||0)+'개 관측 · '+(h.backend||'SQLite');
  if(h.status==='history-only')return '과거 기록만 있음 · 원본 DB 없음';if(h.status==='legacy-only')return '구형 PB 기록만 발견 · SQLite 수집 불가';
  if(h.status==='reset-waiting')return 'DB 연결됨 · 전체 초기화 이후 새 사용량 대기';
  if(h.status==='no-usage')return 'DB 발견 · 사용량 필드 미확인';
  if(!h.status)return d.scanning?'DB 확인 중 · 직전 관측값 유지':'수집 상태 확인 중';
  return 'DB 경로 없음 · 설정된 경로/실행 환경 확인';
}
function renderSources(d) {
  const root=clear('sources');
  for(const p of ['codex','claude','antigravity','gemini']) {
    const h=d.health[p];
    if(p==='gemini'&&!h?.files) continue;
    const item=node('div','source-item'),good=h?.files>0&&!h.errors&&!h.partial&&!h.limited&&!h.oversizedFiles;
    const state=p==='antigravity'?antigravityState(d):!h?'확인 중':!h.rootsFound?'경로 없음':h.errors?'읽기 오류 '+h.errors+'건':h.limited?'검색 제한 · 일부 집계':h.oversizedFiles?'대형 파일 제외 '+h.oversizedFiles+'개':h.files?int(h.files)+'개 기록 파일':'사용 기록 없음';
    append(item,node('span','dot '+(good?'ok':h?.errors||h?.partial||h?.limited?'warn':'')),node('span','source-name',NAMES[p]),node('span','muted',state));root.append(item);
  }

}
function usageCells(row,s){
  const has=s&&(s.records!==0||s.measured||s.id);
  for(const [kind] of METRICS){
    const td=node('td','num usage-pair'+(kind==='total'?' cost-strong':''));td.dataset.metric=kind;
    const tokens=node('span','usage-token',has?metricToken(s,kind):'—');tokens.dataset.tokens=kind;
    const amount=node('strong','usage-amount',has?metricCost(s,kind):'—');amount.dataset.cost=kind;
    append(td,tokens,amount);if(has)td.title=(billingItem(s,kind)?.notes||[]).join(' · ');row.append(td);
  }
}
function renderProviders(d) {
  const root=clear('provider-table');
  const providers=['codex','claude','antigravity',...['gemini','generic'].filter(p=>d.byProvider.some(x=>x.provider===p))];
  for(const p of providers) {
    let s=d.byProvider.find(x=>x.provider===p);const tr=node('tr'),name=node('td');const meter=window.TMMeasurements?.rowMeter({provider:p,...($('project').value?{projectId:$('project').value}:{})});if(meter)s=meter.summary;
    tr.dataset.provider=p;
    const filtered=d.provider!=='all'&&d.provider!==p;
    const state=meter?'재측정 · '+clock(meter.start)+' · '+(meter.status==='running'?'진행':'종료'):filtered?'현재 도구 필터에서 제외':s?int(s.records)+'개 관측 기록':'이 범위의 관측 기록 없음';
    append(name,node('div','model-name',NAMES[p]),node('div','model-meta',state));tr.append(name);usageCells(tr,s);window.TMMeasurements?.rowControls(tr,{provider:p,...($('project').value?{projectId:$('project').value}:{})},meter);root.append(tr);
  }
}
function renderModels(d) {
  const tbody=clear('model-table');
  if(!d.byModel.length){const td=node('td','empty','이 범위에 수집된 사용 기록이 없습니다.');td.colSpan=9;tbody.append(append(node('tr'),td));return;}
  for(const m of d.byModel){
    const target={provider:m.provider,modelProvider:m.modelProvider,model:m.model,effort:m.effort||'',role:m.role||'',...($('project').value?{projectId:$('project').value}:{})},meter=window.TMMeasurements?.rowMeter(target);
    const tr=node('tr'),name=node('td');append(name,node('div','model-name',m.model),node('div','model-meta',NAMES[m.provider]+' / '+(m.modelProvider||'기본 공급자')+' · '+(m.effort||'추론 강도 미기록')));
    append(tr,name,append(node('td'),node('span','role-badge'+(m.role==='subagent'?' sub':''),m.role==='subagent'?'하위':m.role==='unknown'?'미분류':'메인')));
    if(meter)name.append(node('div','model-meta meter-tag','재측정 · '+clock(meter.start)));usageCells(tr,meter?.summary||m);window.TMRates?.modelCell(tr,meter?.summary||m,m.model,m.apiRates);window.TMMeasurements?.rowControls(tr,target,meter);tr.title='입력 합계(캐시 포함) '+int(m.input)+' / OUT(추론 포함) '+int(m.output)+' / TOTAL '+int(m.total)+' · 가격 미정 '+m.unpricedRecords+'개';tbody.append(tr);
  }
}
function usageLines(s) {
  return METRICS.map(([kind,label])=>node('div','usage-line',label+' '+metricToken(s,kind,true)+' tok / '+metricCost(s,kind)));
}
function renderProjects(d) {
  const root=clear('project-list');if(!d.byProject.length)root.append(node('div','empty','수집된 프로젝트가 없습니다.'));
  for(const p of d.byProject){const item=node('div','project-item');append(item,node('div','project-name',p.project),...usageLines(p),node('div','project-meta',int(p.records)+'개 관측 기록'));root.append(item);}
  const role=clear('role-summary');for(const r of d.byRole)role.append(append(node('div','role-usage'),node('div','',r.role==='subagent'?'하위 에이전트':r.role==='unknown'?'역할 미분류':'메인 에이전트'),...usageLines(r)));
}
function renderTasks(d){const root=clear('task-list');const running=d.tasks.find(t=>!t.end);$('task-start').disabled=!!running;$('task-stop').hidden=!running;$('task-name').disabled=!!running;if(!d.tasks.length)root.append(node('div','empty','측정을 시작하면 시작·종료 사이의 로그 시각에 해당하는 사용량을 별도로 볼 수 있습니다.'));for(const t of d.tasks.slice().reverse().slice(0,30)){const btn=node('button','task-item'+(!t.end?' running':''),(!t.end?'측정 중 · ':'완료 · ')+t.name);btn.addEventListener('click',()=>{scope='task';$('task-select').value=t.id;load();});root.append(btn);}}
const warningLabels={'antigravity-private-schema':'Antigravity 비공개 DB 스키마 관측값','antigravity-api-equivalent':'API 환산액; 실제 결제액 아님','antigravity-row-id-fallback':'요청 ID 없음; DB 행으로 중복 제거','antigravity-output-breakdown-conflict':'출력/추론 세부값 충돌','antigravity-model-conflict':'모델 관측 충돌','antigravity-retry-record':'관측된 재시도 토큰','community-reference-price':'커뮤니티 가격표 참고값','local-compute-cost-excluded':'로컬 API 요금만 0; 전기/장비 제외','non-text-price-unsupported':'텍스트 이외 비용 미지원','short-context-reference-rate':'GPT-6 short-context 참고 단가','transcript-not-final':'최종값 미확인','usage-fields-missing':'일부 토큰 미기록','history-gap-model-unknown':'과거 사용분 모델 미상','cache-breakdown-inconsistent':'캐시 세부값 불일치','inconsistent-token-breakdown':'토큰 세부값 불일치','tool-token-accounting-unknown':'도구 토큰 분류 미확인','reported-total-mismatch':'원본 합계 불일치','timestamp-missing':'시각 미기록'};
function renderRecent(d) { window.TMHistory?.onStatus(d); }

function annotated(id,value){
  const el=$(id);el.replaceChildren();const m=String(value).match(/^(.*?) \((관측분|계산분|참고)\)$/);
  if(m)append(el,node('span','metric-number',m[1]),node('small','metric-annotation',m[2]));else el.textContent=value;
}
function renderOutputSplit(d){
  const s=d.summary,has=s.records||s.measured;
  for(const kind of ['response','thinking']){
    annotated(kind+'-tokens',has?metricToken(s,kind):'—');annotated(kind+'-cost',has?metricCost(s,kind):'—');
    set(kind+'-info',!has?'관측 기록 없음':s.splitUnknownRecords?int(s.splitUnknownRecords)+'건 분해 미확인 · 알려진 부분만 표시':s.splitReferenceRecords?'비공개/기존 기록의 참고 분해 포함':'원본 사용량 카운터 기준 · 중복 합산 없음');
  }
  let message=!has?'이 범위의 관측 기록이 없습니다.':
    'OUT 전체 '+int(s.output)+' = 비추론 '+int(s.knownResponseOutput||0)+' + 분해된 THINKING '+int(s.knownThinkingOutput||0)+' + 분해 미확인 출력 '+int(s.unclassifiedOutput||0)+'.';
  if(s.splitUnknownRecords)message+=' '+int(s.splitUnknownRecords)+'건은 세부값이 없거나 충돌합니다. THINKING 0으로 간주하지 않습니다.';
  if(s.splitReferenceRecords)message+=' '+int(s.splitReferenceRecords)+'건은 참고 해석입니다. 합계 일치만으로 비공개 필드 의미를 확정할 수 없습니다.';
  if(s.outputTotalUnknownRecords)message+=' 전체 출력 자체가 불명확한 '+int(s.outputTotalUnknownRecords)+'건이 있어 총 토큰도 관측분입니다.';
  set('output-accounting-note',message);
}
function render(d){
  if(d.performance){let el=$('runtime-resources');if(!el){el=node('p','muted small');el.id='runtime-resources';$('reliability-panel').append(el);}const p=d.performance;el.textContent=`수집기 RAM ${(p.rssBytes/1048576).toFixed(1)} MiB · 활성 ${int(p.eventCount)}건 · 원본 ${int(p.sourceEventCount)}건 · 저장 대기 ${p.pendingSaves} · 백그라운드 탭 자동 조회 절약`;el.title='RSS는 수집기 프로세스의 실제 메모리이며 VS Code·브라우저 메모리는 별도입니다. SQLite worker를 포함하며 Python fallback 자식은 별도입니다.';}
if(d.selectionNotice){scope=d.scope;flash(d.selectionNotice);}if(window.TMDataControls?.onStatus(d)===false)return;lastData=d;connected=true;document.body.classList.remove('offline');$('connection').textContent='로컬 수집 중';$('connection').className='badge';$('connection').title='';$('demo-badge').hidden=!d.demo;
  const attention=Object.values(d.health||{}).some(h=>h.errors||h.partial)||d.scopeInfo?.legacyAntigravityRecords;
  if(attention){$('connection').textContent='수집 점검 필요';$('connection').className='badge warning';$('connection').title=Object.entries(d.health||{}).filter(([,h])=>h.errors||h.partial).map(([p,h])=>p+': '+(p==='antigravity'?antigravityState(d):'읽기 오류 '+int(h.errors||0)+'건')).concat(d.scopeInfo?.legacyAntigravityRecords?['Antigravity 구버전 기록 '+int(d.scopeInfo.legacyAntigravityRecords)+'건']:[]).join(' · ');}
  else if(d.scanning)$('connection').textContent='수집 중 · 갱신 대기';
  const s=d.summary;renderOutputSplit(d);set('record-count',int(s.records)+'개 기록');set('timezone',d.timeZone);
  for(const btn of document.querySelectorAll('[data-scope]'))btn.classList.toggle('selected',btn.dataset.scope===scope);
  populate($('project'),d.projects.map(p=>({id:p.id,label:p.name})),'전체 프로젝트');
  populate($('session'),d.sessions.filter(s=>$('provider').value==='all'||s.provider===$('provider').value).map(s=>({id:s.id,label:NAMES[s.provider]+' · '+s.model+' · '+s.id.slice(-8)})));
  if(scope==='session'&&d.selectedSession)$('session').value=d.selectedSession;
  populate($('task-select'),d.tasks.slice().reverse().map(t=>({id:t.id,label:t.name+(t.end?'':' · 측정 중')})),'진행 중인 작업');
  $('session').hidden=scope!=='session';$('dataset-select').hidden=scope!=='session';window.TMReliability?.render(d);$('task-select').hidden=scope!=='task';
  window.TMRates?.renderInput(d);renderCatalogStatus(d);window.TMHistory?.renderPricing(d);
  window.TMMeasurements?.render(d);renderSources(d);renderProviders(d);renderModels(d);renderProjects(d);renderTasks(d);renderRecent(d);
  $('bottom-bar').title=d.priceBasis;
  const diagnostic=clear('diagnostics');diagnostic.append(node('p','',d.priceBasis));const list=[...d.warnings];if(d.unknownTimeRecords)list.push('시각이 없는 기록 '+d.unknownTimeRecords+'개는 오늘/월 집계에서 제외됩니다.');if(s.unpricedRecords)list.push('계산 불가 항목이 있는 기록 '+s.unpricedRecords+'개. 가격 계산 상태와 요청별 계산 근거를 확인하세요. 제외된 금액을 0원으로 처리하지 않습니다.');if(s.warnings.includes('transcript-not-final'))list.push('Claude transcript 중 최종 여부를 확인할 수 없는 값이 있습니다. 관측값과 공급자 청구 토큰은 다를 수 있습니다.');for(const w of list)diagnostic.append(node('p','',w));diagnostic.append(node('p','',`최근 스캔: ${d.scanStats.durationMs??'—'}ms / 새로 읽은 크기: ${int(d.scanStats.bytesRead)} bytes / 갱신 기록: ${d.scanStats.upserts??0}개 / 자동 수집 대기 ${Math.round((d.scanStats.nextPollMs||5000)/1000)}초(작업량에 따라 조절)`));
  const budget=d.budget;$('budget-banner').hidden=!budget.exceeded;if(budget.exceeded)set('budget-banner','하루 알림 기준 '+dollars(budget.dailyUsd)+' 초과 · 오늘 확인된 '+d.costLabel+' '+dollars(budget.knownTodayUsd)+(budget.unpricedRecords?' · 미계산 항목 별도':'')+' · 요청을 자동 중단하지 않습니다.');
  const latest=d.latest;
  set('bar-scope',d.measurement?'재측정 · '+d.measurement.name+' · '+(d.measurement.status==='running'?'진행':'종료'):LABELS[scope]+' · '+(d.provider==='all'?'전체 도구':NAMES[d.provider]||d.provider));
  set('bar-model',latest?'최근 '+NAMES[latest.provider]+' · '+latest.model+(latest.effort?' · '+latest.effort:''):'모델 기록 대기');
  $('bar-model').title=$('bar-model').textContent;
  set('bar-cost',d.costLabel+' · 실제 청구액 아님');
  for(const [kind,id] of [['normalInput','in'],['cacheRead','read'],['cacheWrite','write'],['output','out'],['total','total']]) {
    set('bar-'+id+'-tokens',(s.records||s.measured)?metricToken(s,kind,true)+' tok':'— tok');
    set('bar-'+id+'-cost',(s.records||s.measured)?metricCost(s,kind):'—');
    $('bar-'+id).title=(s.records||s.measured)?metricToken(s,kind)+' 토큰 / '+metricCost(s,kind):'관측 기록 없음 · 0으로 확인한 것이 아님';
  }
  set('bar-time','확인 '+clock(d.updatedAt));renderPip();
}
function renderPip() {
  if(!pipWindow||pipWindow.closed)return;
  const root=pipWindow.document.body;root.replaceChildren();root.className='pip-body';if(!lastData)return;
  const d=lastData,s=d.summary;
  append(root,append(node('div','pip-title'),node('span','','TOKEN METER · '+$('bar-scope').textContent),node('span',connected?'':'pip-offline',d.demo?'합성 데모':connected?'LOCAL':'연결 끊김 · 마지막 값')),node('div','pip-model',$('bar-model').textContent));
  const grid=node('div','pip-metrics');
  for(const [kind,label] of METRICS){
    const cell=node('div','pip-metric'+(kind==='total'?' pip-total':''));cell.dataset.kind=kind;
    append(cell,node('b','pip-metric-label',label),node('div','pip-tokens',(s.records||s.measured)?metricToken(s,kind)+' tok':'— tok'),node('div','pip-cost',(s.records||s.measured)?metricCost(s,kind):'—'));if(kind!=='total')cell.append(node('small','pip-rate',window.TMRates?.billingRate(billingItem(s,kind))||'단가 미확인'));grid.append(cell);
  }
  append(root,grid,node('div','pip-time',d.costLabel+' · OUT에 추론 포함 · 단가 / '+(window.TMRates?.unitName()||'100만 토큰')+' · '+((s.records||s.measured)?'마지막 확인 '+clock(d.updatedAt):'관측 기록 없음')));
}
let loadPromise=null,needsReload=false;
async function load(options={}){
  if(loadPromise){if(!options?.auto)needsReload=true;return loadPromise;}
  loadPromise=(async()=>{do{
    needsReload=false;const seq=++requestSeq,query=q();
    try{const data=await api('/api/status?'+query);if(seq===requestSeq&&query===q())render(data);else needsReload=true;}
    catch(e){if(seq!==requestSeq)continue;connected=false;document.body.classList.add('offline');set('connection','연결 끊김');$('connection').className='badge warning';set('bar-time','연결 끊김 · 마지막 값');if(!lastData)flash(e.message,true);renderPip();}
  }while(needsReload);})().finally(()=>{loadPromise=null;});return loadPromise;
}

let exportBusy=false;
async function saveExport(endpoint,filename){
  if(exportBusy)throw new Error('다른 내보내기가 진행 중입니다. 완료 후 다시 시도하세요.');
  exportBusy=true;
  try{
    // Request permission in the original click gesture, before network work.
    let handle=null;
    if(window.isSecureContext&&typeof window.showSaveFilePicker==='function'){
      try{handle=await window.showSaveFilePicker({suggestedName:filename});}
      catch(e){if(e.name==='AbortError')return false;throw e;}
    }
    const response=await fetch(endpoint,{headers:{Authorization:'Bearer '+key},signal:AbortSignal.timeout(120000)});
    if(!response.ok)throw new Error('내보내기 실패: HTTP '+response.status);
    if(handle){
      const writable=await handle.createWritable();
      try{await response.body.pipeTo(writable);}catch(e){try{await writable.abort();}catch{}throw e;}
    }else{
      // Compatibility path: unlike direct streaming, Blob may require memory
      // proportional to the export in this browser. Never pretend it is bounded.
      const blob=await response.blob(),url=URL.createObjectURL(blob),a=node('a');
      a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);
    }
    return true;
  }finally{exportBusy=false;}
}
async function download(format){try{await saveExport('/api/export.'+format+'?'+q(),'token-meter-'+scope+'.'+format);}catch(e){flash(e.message,true);}}

for(const b of document.querySelectorAll('[data-scope]'))b.addEventListener('click',()=>{scope=b.dataset.scope;load();});
for(const id of ['provider','project','session','dataset-select','task-select','measurement-select'])$(id).addEventListener('change',load);
$('pin-button').addEventListener('click',async()=>{if(!('documentPictureInPicture'in window)){flash('이 브라우저는 항상 위 미니바를 지원하지 않습니다. 지원되는 데스크톱 Chrome에서 열거나 VS Code 상태바를 사용하세요.');return;}try{pipWindow=await documentPictureInPicture.requestWindow({width:940,height:300});const link=pipWindow.document.createElement('link');link.rel='stylesheet';link.href=location.origin+'/style.css';pipWindow.document.head.append(link);pipWindow.document.title='Token Meter';renderPip();}catch(e){flash('미니바를 열지 못했습니다: '+e.message,true);}});
$('task-start').addEventListener('click',async()=>{try{await api('/api/task/start',{name:$('task-name').value,projectId:$('project').value});$('task-name').value='';await load();}catch(e){flash(e.message,true);}});
$('task-stop').addEventListener('click',async()=>{try{await api('/api/task/stop',{});await load();}catch(e){flash(e.message,true);}});
$('export-button').addEventListener('click',()=>download('csv'));$('json-button').addEventListener('click',()=>download('json'));
for(const b of document.querySelectorAll('[data-close]'))b.addEventListener('click',()=>$(b.dataset.close).close());
$('settings-button').addEventListener('click',async()=>{try{const c=await api('/api/config');currentConfig=c;$('auto-prices').checked=c.catalogUpdates.enabled;$('billing-mode').value=c.billingMode;$('daily-budget').value=c.dailyBudgetUsd??'';$('fx-rate').value=c.usdToKrw??'';$('fx-date').value=c.fxAsOf??'';set('config-paths','데이터 폴더: '+c.dataDir+'\n\n'+JSON.stringify(c.roots,null,2)+'\n\n경로 변경: 데이터 폴더의 config.json\n상세 단가: prices.user.json');$('settings-dialog').showModal();}catch(e){flash(e.message,true);}});
$('settings-form').addEventListener('submit',async e=>{e.preventDefault();try{await api('/api/settings',{billingMode:$('billing-mode').value,dailyBudgetUsd:$('daily-budget').value?Number($('daily-budget').value):null,usdToKrw:$('fx-rate').value?Number($('fx-rate').value):null,fxAsOf:$('fx-date').value||null,catalogUpdates:{...currentConfig.catalogUpdates,enabled:$('auto-prices').checked}});$('settings-dialog').close();await load();}catch(err){flash(err.message,true);}});
$('price-button').addEventListener('click',()=>$('price-dialog').showModal());
$('price-form').addEventListener('submit',async e=>{e.preventDefault();const val=id=>$(id).value===''?null:Number($(id).value);try{await api('/api/prices',{provider:$('price-provider').value,...($('price-service').value.trim()?{modelProvider:$('price-service').value.trim()}:{}),models:[$('price-model').value.trim()],tier:$('price-tier').value,input:val('price-input'),output:val('price-output'),cacheRead:val('price-read'),cacheWrite:val('price-write'),cacheWrite5m:val('price-write5'),cacheWrite1h:val('price-write1'),source:'user-supplied',asOf:new Date().toISOString().slice(0,10)});$('price-dialog').close();flash('단가를 저장했습니다. 단가가 전혀 없던 기록과 이후 기록에 적용됩니다.');await load();}catch(err){flash(err.message,true);}});
function renderCatalogStatus(d){
  const c=d.catalog;if(!c)return;
  set('catalog-summary',`${int(c.modelCount)}개 공급자·모델 조합 · 가격표 자동 갱신 ${c.enabled?'켜짐':'꺼짐'} · 주기 ${c.intervalHours}시간`);
  const root=clear('catalog-sources');
  for(const s of c.sources)root.append(node('p',s.error?'catalog-error':'muted small',`${s.id}${s.community?' (커뮤니티 참고)':''}: ${s.count}개 · ${s.lastSuccess?'마지막 성공 '+clock(s.lastSuccess,true):'아직 내려받지 않음'}${s.error?' · 실패: '+s.error:''}${!s.enabled?' · 소스 제외':''}`));
  const u=d.updates;set('app-update-status',!u?.configured?'프로그램 자동 업데이트: 배포 URL·신뢰 공개키 설정 필요':u.error?'프로그램 업데이트 확인 실패: '+u.error:u.available?`새 버전 ${u.available}${u.staged?' · 검증·다운로드 완료':''} · VS Code 설치 명령 사용`:`프로그램 ${u.currentVersion} · 자동 확인 ${u.enabled?'켜짐':'꺼짐'}`);
}
function renderCatalogModels(){
  const search=$('catalog-search').value.toLowerCase().trim(),rows=catalogRows.filter(r=>(r.modelProvider+' '+r.model+' '+r.tier).toLowerCase().includes(search));
  set('catalog-count',`${int(rows.length)}개 검색 결과 · 최대 150개 표시 · 중복 시 사용자 규칙이 우선합니다.`);
  const root=clear('catalog-models');
  // Catalog is ALWAYS per million, independently of the applied-rate panel's unit selector.
  const catalogRate=n=>window.TMRates?TMRates.rate(n,1000000):dollars(n);
  for(const r of rows.slice(0,150)){
    const tr=node('tr');append(tr,append(node('td'),node('div','model-name',r.model),node('div','model-meta',r.modelProvider||r.provider)),
      node('td','num',catalogRate(r.input)),node('td','num',catalogRate(r.cacheRead)),node('td','',window.TMRates?.writePrice({rates:r},1000000)||'단가 미확인'),node('td','num',catalogRate(r.output)),
      node('td','catalog-tier',(r.tier||'standard')+(r.longContext?' · 기본 구간; 장문 별도':r.contextTiers?.length?' · 입력 길이 구간별':'')),
      node('td','muted small',(r.community?'커뮤니티 · ':'')+(r.origin||r.catalogGroup)+' · '+r.asOf+(r.effectiveFrom?' · 시작 '+r.effectiveFrom.slice(0,10):'')+(r.effectiveTo?' · 종료 '+r.effectiveTo.slice(0,10)+' 미만':'')));
    tr.title=(r.source||'')+' · '+(r.provider==='*'?'동일 공급자 모든 도구':(NAMES[r.provider]||r.provider));root.append(tr);
  }
}
$('catalog-search').addEventListener('input',renderCatalogModels);
$('catalog-button').addEventListener('click',async()=>{try{const p=await api('/api/prices');catalogRows=['custom','remote','builtin'].flatMap(origin=>(p[origin]||[]).flatMap(r=>r.models.map(model=>({...r,model,catalogGroup:origin}))));renderCatalogModels();$('catalog-dialog').showModal();}catch(e){flash(e.message,true);}});
$('refresh-prices').addEventListener('click',async()=>{const b=$('refresh-prices');b.disabled=true;b.textContent='가격표 확인 중';try{const c=await api('/api/catalog/refresh',{});flash(c.sources.some(s=>s.error)?'일부 갱신 실패. 직전 정상 가격표를 유지합니다. 출처별 오류를 확인하세요.':'가격표 갱신 완료. 기존에 저장된 단가는 유지됩니다.');await load();}catch(e){flash(e.message,true);}finally{b.disabled=false;b.textContent='가격표 지금 갱신';}});
$('check-updates').addEventListener('click',async()=>{const b=$('check-updates');b.disabled=true;try{const u=await api('/api/updates/check',{});if(u.error)throw new Error(u.error);flash(u.available?'새 버전 '+u.available+' 확인. VS Code에서 Token Meter: Install Verified Update 명령을 사용하세요.':'사용 가능한 새 버전이 없습니다.');await load();}catch(e){flash(e.message,true);}finally{b.disabled=false;}});
if(!key)flash('로컬 접근키가 없습니다. 실행 시 출력된 대시보드 주소 또는 VS Code 상태바를 통해 다시 여세요.',true);
let refreshTimer;
async function refreshLoop(){try{if(!document.hidden||(pipWindow&&!pipWindow.closed))await load({auto:true});}finally{refreshTimer=setTimeout(refreshLoop,document.hidden&&(!pipWindow||pipWindow.closed)?30000:5000);}}
document.addEventListener('visibilitychange',()=>{if(!document.hidden)load({auto:true});});
window.addEventListener('pagehide',()=>clearTimeout(refreshTimer));
setTimeout(()=>{load().finally(()=>{refreshTimer=setTimeout(refreshLoop,5000);});},0);
