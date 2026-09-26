'use strict';
/* UI extension for non-destructive meters. Uses app.js's authenticated local API. */
(()=>{
  let data={runs:[],canUndo:false,pinnedId:null},rowMode=false,selection=new Set(),compareIds=[],copiedText='',busy=false;
  const outcomes={unrated:'미평가',pass:'PASS',fail:'FAIL',partial:'부분 성공'};
  const FK=['provider','modelProvider','model','effort','role','projectId'];
  const stored=(k)=>{try{return JSON.parse(localStorage.getItem('tm-v4-'+k)||'null');}catch{return null;}};
  const persist=(k,v)=>{try{localStorage.setItem('tm-v4-'+k,JSON.stringify(v));}catch{}};
  rowMode=stored('rowMode')===true;
  const preferences=stored('filters');
  if(preferences&&['today','month','all','session','task'].includes(preferences.scope)){
    scope=preferences.scope;if([...$('provider').options].some(o=>o.value===preferences.provider))$('provider').value=preferences.provider;
  }
  function duration(ms){const s=Math.floor(ms/1000);return s>=3600?Math.floor(s/3600)+'시간 '+Math.floor(s%3600/60)+'분':s>=60?Math.floor(s/60)+'분 '+s%60+'초':s+'초';}
  function saveFilters(){persist('filters',{scope,provider:$('provider').value});}
  async function action(fn){if(busy)return;busy=true;document.body.classList.add('measurement-busy');try{await fn();await load();}catch(e){flash(e.message,true);}finally{busy=false;document.body.classList.remove('measurement-busy');}}
  function button(title,fn,cls='quiet'){const b=node('button',cls,title);b.type='button';b.addEventListener('click',()=>action(fn));return b;}
  function view(id){const opts=$('measurement-select');if(![...opts.options].some(o=>o.value===id))opts.append(Object.assign(node('option','',id),{value:id}));opts.value=id;scope='measurement';return load();}
  function combined(groups){return TokenMeterBilling.combine(groups);}
  function rowMeter(target){
    if(!rowMode)return null;
    const r=data.runs.find(r=>r.kind==='baseline'&&!r.archived&&r.status!=='cancelled'&&Object.keys(r.filter).every(k=>target[k]===r.filter[k]));
    if(!r)return null;
    return {...r,summary:combined((r.groups||[]).filter(g=>FK.every(k=>!(k in target)||g[k]===target[k])))};
  }
  function newOptions(){return {requestKey:typeof crypto.randomUUID==='function'?crypto.randomUUID():Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('')};}
  async function reset(target){
    const r=await api('/api/measurements/reset',{filter:target,...newOptions()});rowMode=true;persist('rowMode',true);
    flash('0부터 재측정을 시작했습니다. 원본 누적량은 그대로입니다. 이전 측정은 기록에 보관되며 「초기화 취소」로 되돌릴 수 있습니다.');
    return r;
  }
  function rowControls(tr,target,meter){
    const td=node('td','row-actions');td.append(button('0부터 재측정',()=>reset(target),'quiet reset-row'));
    td.firstChild.title='이 조합만 초기화: '+Object.entries(target).map(([k,v])=>k+'='+v).join(', ');
    if(meter)td.append(button('보기',()=>view(meter.id),'quiet small-button'));
    tr.append(td);
  }
  function openForm(target={}){
    $('measurement-form').reset();$('measurement-provider').value=target.provider||$('provider').value;
    $('measurement-model').value=target.model||'';$('measurement-service').value=target.modelProvider||'';
    if(target.effort!==undefined){if(![...$('measurement-effort').options].some(o=>o.value===target.effort))$('measurement-effort').append(Object.assign(node('option','',target.effort),{value:target.effort}));$('measurement-effort').value=target.effort;}
    if(target.role!==undefined)$('measurement-role').value=target.role;
    populate($('measurement-project'),(lastData?.projects||[]).map(p=>({id:p.id,label:p.name})),'전체 프로젝트');$('measurement-project').value=target.projectId||$('project').value;
    const list=clear('measurement-model-options');for(const model of new Set((lastData?.byModel||[]).map(m=>m.model)))list.append(Object.assign(node('option'),{value:model}));
    $('measurement-dialog').querySelectorAll('.form-error').forEach(e=>e.remove());$('measurement-dialog').showModal();$('measurement-name').focus();
  }
  function setSelection(){set('compare-measurements','선택 비교 ('+selection.size+')');$('compare-measurements').disabled=selection.size<1||selection.size>4;$('export-measurements').disabled=!selection.size||selection.size>20;set('delete-selected-measurements','선택 삭제 ('+selection.size+')');$('delete-selected-measurements').disabled=!selection.size;}
  function infoText(r){
    const d=r.detail||{},parts=[];if(d.legacyFrozen)parts.push('구버전 병합 결과 · 정확한 총량 아님 / 원본 세션을 다시 대조하세요');if(d.identityBaselineRepaired)parts.push('ID 교정 측정 · 과거 경계 복원 제한');
    if(d.partialRequests)parts.push('진행 중 요청 증가분 '+d.partialRequests+'개');
    if(d.lateOld)parts.push('뒤늦은 과거 기록 '+d.lateOld+'개 제외');if(d.undated)parts.push('시각 없는 새 기록 '+d.undated+'개 제외');
    if(d.inputBreakdownUnknown)parts.push('캐시 재분류 '+d.inputBreakdownUnknown+'개: 입력 비용 미정');if(d.regressed)parts.push('카운터 감소 '+d.regressed+'개');
    if(r.sourceWarnings?.length)parts.push('수집 주의사항 '+r.sourceWarnings.length+'개');return parts.join(' · ');
  }
  function render(d){
    if(d.measurements)data=d.measurements;
    if(compareIds.some(id=>!data.runs.some(r=>r.id===id))){compareIds=[];copiedText='';if($('comparison-dialog').open)$('comparison-dialog').close();}
    if($('measurement-edit-dialog').open&&!data.runs.some(r=>r.id===$('measurement-edit-id').value))$('measurement-edit-dialog').close();
    selection=new Set([...selection].filter(id=>data.runs.some(r=>r.id===id)));
    const selected=$('measurement-select').value;populate($('measurement-select'),data.runs.filter(r=>!r.archived&&r.status!=='cancelled').map(r=>({id:r.id,label:r.name+' · '+(r.status==='running'?'진행':'종료')})));
    if(selected&&data.runs.some(r=>r.id===selected))$('measurement-select').value=selected;
    if(d.measurement)$('measurement-select').value=d.measurement.id;
    $('measurement-select').hidden=scope!=='measurement';$('provider').disabled=scope==='measurement';$('project').disabled=scope==='measurement';
    $('undo-reset').disabled=!data.canUndo;set('table-mode',rowMode?'재측정 표시 중':'누적 표시 중');$('table-mode').classList.toggle('selected',rowMode);
    const banner=$('measurement-banner');banner.hidden=!d.measurement;
    if(d.measurement){const r=d.measurement;banner.replaceChildren(node('strong','',r.name+' · '+(r.status==='running'?'측정 중':'종료된 고정 결과')),node('div','small',r.label+' · 시작 '+clock(r.start,true)+' · 경과 '+duration(r.elapsedMs)),node('div','small',infoText(r)||'원본 누적량 보존 · 새로 관측한 사용량 기준 · '+(r.summary.records?'':'아직 증가분 없음; 계정 사용량 0을 의미하지 않음')));}
    const search=$('measurement-search').value.toLowerCase(),visible=data.runs.filter(r=>($('show-archived').checked||!r.archived)&&[r.name,r.label,r.notes].join(' ').toLowerCase().includes(search));
    const root=clear('measurement-list');
    if(!visible.length)root.append(node('div','empty','도구·모델 행의 「0부터 재측정」 또는 「+ 새 측정」을 누르세요. 기존 누적 기록은 삭제하지 않습니다.'));
    for(const r of visible){
      const card=node('article','meter-card'+(r.status==='running'?' running':'')+(r.archived?' archived':''));card.dataset.id=r.id;
      const head=node('div','meter-head'),label=node('label','meter-select'),checkbox=node('input');checkbox.type='checkbox';checkbox.checked=selection.has(r.id);checkbox.setAttribute('aria-label',r.name+' 비교 선택');
      checkbox.addEventListener('change',()=>{if(checkbox.checked)selection.add(r.id);else selection.delete(r.id);setSelection();});
      append(label,checkbox,node('strong','',r.name));append(head,label,node('span','badge '+(r.status==='running'?'':'subtle'),r.status==='running'?'측정 중':r.status==='cancelled'?'초기화 취소됨':'종료 · 고정'));
      append(card,head,node('p','muted small',r.label+' · '+duration(r.elapsedMs)+' · '+outcomes[r.outcome]+(r.pinned?' · 상태바 고정':'')));
      const metrics=node('div','meter-values');for(const [k,t] of METRICS)append(metrics,append(node('div'),node('b','muted small',t),node('div','meter-token',metricToken(r.summary,k)+' tok'),node('strong','meter-money',metricCost(r.summary,k))));card.append(metrics);
      if(r.notes)card.append(node('p','meter-note',r.notes));
      const detail=infoText(r);if(detail)card.append(node('p','meter-warning',detail));
      if(r.budgetUsd!=null)card.append(node('p',r.budgetExceeded?'meter-warning':'muted small','측정 비용 기준 '+dollars(r.budgetUsd)+(r.budgetExceeded?' 초과 · 요청 자동 중단 안 함':' · 알려진 금액 기준')+(r.summary.unpricedRecords?' · 가격 미정분 있음':'')));
      const controls=node('div','meter-actions');append(controls,button('보기',()=>view(r.id)),button(r.pinned?'고정 해제':'상태바 고정',async()=>{await api('/api/measurements/pin',{id:r.pinned?null:r.id});flash(r.pinned?'상태바 고정을 해제했습니다.':'VS Code 상태바에 이 측정을 고정했습니다. 브라우저/미니바는 「보기」로 선택하세요.');}));
      if(r.status==='running')controls.append(button('종료·저장',async()=>{await api('/api/measurements/stop',{id:r.id});flash('측정 결과를 고정 저장했습니다. 이후 기록은 이 결과를 바꾸지 않습니다.');}));
      append(controls,button('같은 조건 새 측정',()=>openForm(r.filter)),button('이름·결과·메모',()=>{ $('measurement-edit-id').value=r.id;$('measurement-edit-name').value=r.name;$('measurement-edit-notes').value=r.notes;$('measurement-outcome').value=r.outcome;$('measurement-edit-dialog').querySelectorAll('.form-error').forEach(e=>e.remove());$('measurement-edit-dialog').showModal();}));
      if(r.status!=='running')controls.append(button(r.archived?'목록 복원':'목록 숨기기',async()=>{await api('/api/measurements/update',{id:r.id,archived:!r.archived});if(!r.archived&&scope==='measurement'&&$('measurement-select').value===r.id)scope='all';}));
      controls.append(button('삭제',()=>window.TMDataControls?.confirmDelete([r.id]),'quiet danger delete-measurement'));
      append(card,controls,node('div','muted small','시작 '+clock(r.start,true)+(r.end?' · 종료 '+clock(r.end,true):'')));root.append(card);
    }
    setSelection();saveFilters();
  }
  function compare(runs){
    compareIds=runs.map(r=>r.id);const rows=[['조건',r=>r.label],['상태',r=>r.status==='running'?'진행 중':'종료 고정'],...METRICS.flatMap(([key,label])=>[[label+' 토큰',r=>metricToken(r.summary,key)],[label+' 비용',r=>metricCost(r.summary,key)]]),['관측 경과',r=>duration(r.elapsedMs)],['관측 토큰/분',r=>r.tokensPerMinute==null?'—':int(Math.round(r.tokensPerMinute))],['검수 결과 (직접 기록)',r=>outcomes[r.outcome]],['메모',r=>r.notes||'—'],['주의',r=>infoText(r)||'—']];
    const table=node('table'),thead=node('thead'),head=node('tr');head.append(node('th','','항목'));for(const r of runs)head.append(node('th','',r.name));thead.append(head);table.append(thead);
    const body=node('tbody');for(const [label,fn] of rows){const row=node('tr');row.append(node('th','',label));for(const r of runs)row.append(node('td','comparison-cell',fn(r)));body.append(row);}table.append(body);clear('comparison-table').append(table);
    const escape=s=>String(s).replaceAll('|','\\|').replace(/[\r\n]+/g,' ');
    copiedText='금액: API 환산/추정액. IN=일반 입력, OUT=THINKING 포함. 네 항목을 한 번씩 합산. 측정 구간은 겹칠 수 있음.\n\n| 항목 | '+runs.map(r=>escape(r.name)).join(' | ')+' |\n| --- | '+runs.map(()=>'---').join(' | ')+' |\n'+rows.map(([l,fn])=>'| '+l+' | '+runs.map(r=>escape(fn(r))).join(' | ')+' |').join('\n');
    $('comparison-text').value=copiedText;$('comparison-text').hidden=true;$('comparison-dialog').showModal();
  }
  async function exportRuns(format,ids=[...selection]){
    if(!ids.length){flash('내보낼 측정을 선택하세요.');return;}
    const res=await fetch('/api/measurements/export.'+format+'?'+new URLSearchParams({ids:ids.join(',')}),{headers:{Authorization:'Bearer '+key},signal:AbortSignal.timeout(15000)});
    if(!res.ok)throw new Error('측정 내보내기 실패');const url=URL.createObjectURL(await res.blob()),a=node('a');a.href=url;a.download='token-meter-measurements.'+format;a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);
  }
  $('new-measurement').addEventListener('click',()=>openForm());
  $('measurement-form').addEventListener('submit',e=>{e.preventDefault();action(async()=>{
    const filter={provider:$('measurement-provider').value};
    for(const [field,id] of [['model','measurement-model'],['modelProvider','measurement-service'],['projectId','measurement-project']])if($(id).value.trim())filter[field]=$(id).value.trim();
    for(const [field,id] of [['effort','measurement-effort'],['role','measurement-role']])if($(id).value!=='*')filter[field]=$(id).value;
    const r=await api('/api/measurements/start',{filter,name:$('measurement-name').value,notes:$('measurement-notes').value,budgetUsd:$('measurement-budget').value?Number($('measurement-budget').value):null,...newOptions()});
    $('measurement-dialog').close();await view(r.id);flash('새 측정을 시작했습니다. 종료·저장 전에 마지막 응답이 기록될 때까지 확인하세요.');
  });});
  $('measurement-edit-form').addEventListener('submit',e=>{e.preventDefault();action(async()=>{await api('/api/measurements/update',{id:$('measurement-edit-id').value,name:$('measurement-edit-name').value,notes:$('measurement-edit-notes').value,outcome:$('measurement-outcome').value});$('measurement-edit-dialog').close();});});
  $('undo-reset').addEventListener('click',()=>action(async()=>{await api('/api/measurements/undo',{});flash('마지막 초기화를 취소했습니다. 원래 측정 기준점을 복원했습니다.');}));
  $('reset-all').addEventListener('click',()=>{if(confirm('전체 도구를 0부터 새로 측정할까요? 원본 누적량과 개별 측정은 삭제하지 않습니다.'))action(async()=>{const r=await reset({});await view(r.id);});});
  $('table-mode').addEventListener('click',()=>{rowMode=!rowMode;persist('rowMode',rowMode);if(lastData){renderProviders(lastData);renderModels(lastData);render(lastData);}});
  for(const id of ['measurement-search','show-archived'])$(id).addEventListener(id==='measurement-search'?'input':'change',()=>{if(lastData)render(lastData);});
  $('compare-measurements').addEventListener('click',()=>action(async()=>{const result=await api('/api/measurements/export.json?'+new URLSearchParams({ids:[...selection].join(',')}));if(result.runs.length>4)throw new Error('비교는 최대 4개입니다.');compare(result.runs);}));
  $('export-measurements').addEventListener('click',()=>action(()=>exportRuns('csv')));
  $('comparison-json').addEventListener('click',()=>action(()=>exportRuns('json',compareIds)));
  $('copy-comparison').addEventListener('click',async()=>{try{if(!navigator.clipboard?.writeText)throw new Error();await navigator.clipboard.writeText(copiedText);$('copy-comparison').textContent='복사됨';setTimeout(()=>set('copy-comparison','표 복사'),1800);}catch{$('comparison-text').hidden=false;$('comparison-text').focus();$('comparison-text').select();set('copy-comparison','아래 텍스트를 직접 복사');}});
  $('scan-button').addEventListener('click',()=>action(async()=>{await api('/api/scan',{});flash('지금 저장된 사용 기록을 다시 수집했습니다.');}));
  const measurementScope=document.querySelector('[data-scope="measurement"]');
  measurementScope.addEventListener('click',e=>{if(!data.runs.some(r=>!r.archived&&r.status!=='cancelled')){e.stopImmediatePropagation();openForm();}},true);
  $('delete-selected-measurements').addEventListener('click',()=>window.TMDataControls?.confirmDelete([...selection]));
  function forget(ids){for(const id of ids)selection.delete(id);if(compareIds.some(id=>ids.includes(id))){compareIds=[];copiedText='';if($('comparison-dialog').open)$('comparison-dialog').close();}setSelection();}
  function resetLocal(){data={runs:[],canUndo:false,pinnedId:null};rowMode=false;selection.clear();compareIds=[];persist('rowMode',false);$('measurement-search').value='';$('show-archived').checked=false;}
  window.TMMeasurements={render,rowMeter,rowControls,openForm,view,forget,resetLocal};load();
})();
