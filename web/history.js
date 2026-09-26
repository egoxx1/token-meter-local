'use strict';
// All dynamic content is rendered with textContent, never HTML from local logs.
(() => {
  let query={scope:'all',provider:'all',priceStatus:'all',limit:'50'},cursors=[''],pageIndex=0,nextCursor=null,serial=0,inFlight=false,lastRefresh='',loaded=false;
  const reasonText={
    'reset-boundary-observed-delta':'전체 초기화 이전에 시작된 요청입니다. 여기 표시된 토큰은 초기화 이후 관측 증가분이며 원요청 시각은 내보내기의 sourceTimestamp에 보존됩니다.',
    'antigravity-private-schema':'Antigravity 비공개 SQLite 구조를 해석한 관측값입니다. Google의 안정 API 보장이 아닙니다.',
    'antigravity-api-equivalent':'Antigravity 구독 청구액이 아닌 공개 API 텍스트 단가 환산입니다.',
    'antigravity-model-reference':'내부 모델 번호를 출처가 명시된 공개 수집기 매핑으로 변환했습니다.',
    'antigravity-output-detail-mismatch':'출력 세부 카운터가 합계와 맞지 않습니다. 별도로 기록된 출력 합계로 계산하며 추론 세부값은 확인 불가입니다.',
    'antigravity-output-breakdown-conflict':'이전 버전의 출력 충돌 기록입니다. 원본 DB 재분석 전에는 출력 비용을 계산하지 않습니다.',
    'antigravity-model-conflict':'동일 요청에서 서로 다른 모델이 관측됐습니다. 재분석 후에도 해소되지 않으면 임의 단가를 적용하지 않습니다.',
    'antigravity-row-id-fallback':'공급자 요청 ID가 없어 세션과 행 번호를 사용합니다.',
    'timestamp-missing':'요청 시각이 없습니다. 날짜 필터에서는 제외하며 전체 기록에서 조회할 수 있습니다.',
    'short-context-reference-rate':'단문 참고 단가입니다. 이 모델의 장문 경계는 자동 판정하지 않습니다.',
    'community-reference-price':'커뮤니티가 관리하는 단가입니다. 공식 청구 단가로 보증하지 않습니다.',
    'transcript-not-final':'로그에서 최종 여부를 확인하지 못한 관측값입니다.',
    'antigravity-retry-record':'로그에서 확인한 재시도 요청입니다.'
  };
  function error(message){$('history-error').hidden=!message;$('history-error').textContent=message||'';}
  function shortReason(e){return e.pricing?.reasons?.map(r=>r.message).filter((x,i,a)=>a.indexOf(x)===i).join(' · ')||e.pricing?.referenceReasons?.map(r=>r.message).join(' · ')||'';}
  function modelLabel(e){return e.model==='unknown'?'모델 미식별':/^antigravity-model-id-/.test(e.model)?'모델 미식별 · 내부 ID '+e.model.replace('antigravity-model-id-',''):e.model;}
  function showStorage(s){if(!s)return;set('history-storage-status',s.error?'로그 보존 오류: '+s.error:`로컬 자동 보존 · 요청 ${int(s.uniqueRequests)}개 · 수정 포함 ${int(s.lines)}행 · 마지막 저장 ${clock(s.lastSavedAt,true)}`);set('history-storage-path',(s.directory||'')+' · 월별 JSONL / 자동 삭제 없음');}
  function renderRows(data){
    const body=clear('recent-table');nextCursor=data.nextCursor;
    for(const e of data.records){
      const tr=node('tr');tr.dataset.requestId=e.id;
      const when=node('td','muted small',clock(e.timestamp,true));when.title='최초 관측: '+clock(e.firstObservedAt,true)+' / 최근 보정: '+clock(e.lastObservedAt,true);
      const name=append(node('td'),node('div','model-name',modelLabel(e)),node('div','model-meta',(NAMES[e.provider]||e.provider)+(e.effort?' · '+e.effort:'')));
      if(e.modelResolution?.kind==='reference-map')name.append(node('small','price-note','내부 ID '+e.numericModelId+' · 공개 매핑'));
      append(tr,when,name);usageCells(tr,e);
      const status=append(node('td','history-table-state'),node('span','pricing-status'+(e.totalUsd===null?' price-warning':''),e.pricing?.statusLabel||'계산 근거 확인'),node('small','price-note muted',shortReason(e)));
      const b=node('button','quiet history-detail-btn','계산 근거');b.type='button';b.addEventListener('click',()=>detail(e.id));window.TMRates?.recordPreview(status,e);status.append(b);tr.append(status);body.append(tr);
    }
    if(!data.records.length){const td=node('td','empty','조건에 맞는 기록 없음 · 날짜/상태 필터를 해제하거나 수집 상태를 확인하세요.');td.colSpan=8;body.append(append(node('tr'),td));}
    $('history-prev').disabled=pageIndex===0;$('history-next').disabled=!nextCursor;$('history-first').disabled=pageIndex===0;
    set('history-page',(pageIndex+1)+' 페이지');set('history-count',`저장 요청 ${int(data.totalStored)}개 · 검색 ${int(data.totalMatching)}개 · 이번 페이지 ${data.returned}개`);showStorage(data.storage);
  }
  async function refresh(force=false){
    if(inFlight&&!force)return;
    const id=++serial;inFlight=true;const params=new URLSearchParams(query);if(cursors[pageIndex])params.set('cursor',cursors[pageIndex]);
    try{const data=await api('/api/history?'+params);if(id!==serial)return;error('');renderRows(data);loaded=true;}
    catch(e){if(id===serial)error(e.message+' · 기존 조회값은 유지합니다.');}
    finally{if(id===serial)inFlight=false;}
  }
  function apply(){
    query={scope:'all',provider:$('history-provider').value,priceStatus:$('history-status').value,outputStatus:$('history-output').value,limit:$('history-limit').value};
    for(const [id,key] of [['history-from','from'],['history-to','to'],['history-search','search']])if($(id).value.trim())query[key]=$(id).value.trim();
    cursors=[''];pageIndex=0;refresh(true);
  }
  function onStatus(d){
    showStorage(d.storage);
    const marker=d.updatedAt+'|'+d.storage?.lastSavedAt;
    if(!loaded||($('history-follow').checked&&pageIndex===0&&marker!==lastRefresh)){lastRefresh=marker;refresh();}
  }
  function renderPricing(d){
    const s=d.summary,p=s.priceStatuses||{},root=clear('pricing-health'),r=clear('pricing-reasons');
    for(const [name,val] of [['단가 적용 완료',p.calculated||0],['참고 조건 환산',p.reference||0],['일부 계산 불가',p.partial||0],['전액 계산 불가',p.unavailable||0]])root.append(append(node('div','pricing-stat'),node('span','muted small',name),node('b','',int(val)+'건')));
    if(s.unpricedRecords)r.append(node('p','price-warning',`총액은 아직 계산할 수 없습니다. 표시된 ${dollars(s.knownTotalUsd)}는 계산 가능한 항목의 소계입니다. 입력 ${int(s.unpricedInputTokens)}토큰 / 출력 ${int(s.unpricedOutputTokens)}토큰의 금액을 제외했습니다.`));
    else r.append(node('p','',s.records||s.measured?'선택 범위의 토큰 비용은 적용한 단가로 계산됐습니다. 단가 적용 완료는 실제 청구 일치나 전체 수집을 보증하는 뜻이 아닙니다.':'이 범위의 관측 기록이 없습니다.'));
    for(const reason of s.priceReasons||[])r.append(node('p','',`${reason.message} · ${int(reason.records)}건`));
    if(p.reference)r.append(node('p','','참고 조건 환산에는 장문 경계 미확인·사용자 단가·커뮤니티 단가 등이 포함됩니다. 요청별 근거에서 조건을 확인하세요.'));
    if(s.referenceMappedRecords)r.append(node('p','',`내부 모델 번호를 공개 구현으로 연결한 기록 ${int(s.referenceMappedRecords)}건. 공식 모델 ID 규약은 아니며 출처를 기록합니다.`));
    if(s.warnings?.includes('antigravity-output-detail-mismatch'))r.append(node('p','','Antigravity 출력 세부값 충돌: 별도로 기록된 출력 합계로 환산했습니다. 추론 토큰 세부 합계는 확인된 항목만 표시합니다.'));
    if(d.measurement?.status!=='running'&&d.measurement)r.append(node('p','','종료 측정은 당시 결과가 고정돼 있습니다. 최신 재분석 결과는 전체 사용 기록에서 확인하세요.'));
    const uiVersion=document.documentElement.dataset.uiVersion;const stale=d.version!==uiVersion;$('version-warning').hidden=!stale;
    if(stale)set('version-warning',`화면 버전 ${uiVersion} / 수집기 ${d.version}. 기존 탭을 닫고 VS Code에서 Token Meter: Restart Collector 실행 후 TM으로 다시 여세요.`);
    set('app-version','LOCAL / '+d.version);
    if(s.records||s.measured){
      set('cost-label',d.costLabel+(s.totalUsd===null?' · 계산분 소계':''));
      set('cost-coverage',s.unpricedRecords?`총액 중 일부 계산 불가 · ${int(s.unpricedRecords)}건에 제외 항목 있음`:`${int(s.pricedRecords)}건의 토큰 단가 적용 · 실제 청구액 아님`);
    }
  }

  function external(parent,label,url){if(!url)return;try{const u=new URL(url);if(!['https:','http:'].includes(u.protocol))return;const a=node('a','',label);a.href=u.href;a.target='_blank';a.rel='noopener noreferrer';parent.append(a);}catch{}}
  async function detail(id){
    try{
      const e=await api('/api/history/detail?id='+encodeURIComponent(id)),p=e.pricing,root=clear('price-detail-content');
      append(root,node('h3','',modelLabel(e)+(e.effort?' · '+e.effort:'')),node('p','muted small',`${NAMES[e.provider]||e.provider} · ${clock(e.timestamp,true)} · 수정본 ${e.revision||'—'}`),node('span','pricing-status',p.statusLabel));
      root.append(window.TMRates.billingTable(e));
      for(const reason of [...p.reasons,...p.referenceReasons])root.append(node('p','price-warning',reason.message));
      const advanced=node('details','billing-details'),inner=node('div','billing-detail-inner');advanced.append(node('summary','','캐시 유지시간 · THINKING 상세 (총합에 포함)'));
      const split=e.outputBreakdown;
      if(split)append(inner,node('p','output-split-proof','OUT 전체 '+int(split.billableOutput)+' = 비추론 '+(split.responseOutput==null?'미기록':int(split.responseOutput))+' + THINKING '+(split.thinkingOutput==null?'미기록':int(split.thinkingOutput))),node('p','muted small','분해 상태: '+split.status+' · '+split.source),node('p','muted small',split.note));
      window.TMRates.inputDetail(e.inputBreakdown,inner);advanced.append(inner);root.append(advanced);
      if(e.apiRate){const detail=node('details','billing-details');detail.append(node('summary','','단가·모델 연결 · 출처'));window.TMRates.rateCard(e.apiRate,detail);root.append(detail);}
      const evidence=node('div','evidence-block');
      append(evidence,node('p','',p.formula),node('p','',`요금 모드: ${p.tier} · 적용 모델: ${p.rateModel}`),node('p','',`단가 기준일: ${p.asOf||'미기록'} · 공식 표준 단가 재확인: ${p.verifiedAt||'이 단가 스냅샷은 재확인 표기 없음'}`));
      if(p.effectiveFrom||p.effectiveTo)evidence.append(node('p','',`가격 유효구간: ${p.effectiveFrom||'시작 미지정'} ~ ${p.effectiveTo||'종료 미지정'} (종료 미만)`));
      if(p.rateSource){external(evidence,'단가 원문 열기',p.rateSource);evidence.append(node('p','muted small',p.rateSource));}
      if(e.modelResolution?.kind==='reference-map'){evidence.append(node('p','',`모델 연결: 내부 ID ${e.numericModelId} → ${e.model} · ${e.effort||'강도 미기록'} (공개 수집기 참고 매핑; Google 안정 규약 아님)`));external(evidence,'모델 매핑 구현 출처',e.modelResolution.source);}
      if(e.rawModel)evidence.append(node('p','',`원본 모델 표기: ${e.rawModel}`));
      if(e.outputEvidence)evidence.append(node('p','',`출력 근거: ${e.outputEvidence==='reported-total'?'DB에 별도 기록된 출력 합계':'기록된 출력 세부값 합계'} · raw total ${e.reportedOutput===null?'미기록':int(e.reportedOutput)} · 세부9 ${e.rawOutputDetails?.field9==null?'미기록':int(e.rawOutputDetails.field9)} / 세부10 ${e.rawOutputDetails?.field10==null?'미기록':int(e.rawOutputDetails.field10)}`));
      const unique=[...new Set(e.warnings||[])];for(const w of unique)if(reasonText[w])evidence.append(node('p','muted small',reasonText[w]));
      const technical=node('details');technical.append(node('summary','','기술 메타데이터'));technical.append(node('pre','',JSON.stringify({id:e.id,session:e.sessionId,numericModelId:e.numericModelId,modelEvidence:e.modelEvidence,firstObservedAt:e.firstObservedAt,lastObservedAt:e.lastObservedAt,warnings:unique},null,2)));evidence.append(technical);evidence.append(node('p','',p.billing));root.append(evidence);
      if(!$('price-detail-dialog').open)$('price-detail-dialog').showModal();
    }catch(e){flash(e.message,true);}
  }
  async function exportRows(format){try{const response=await fetch('/api/history/export.'+format+'?'+new URLSearchParams(query),{headers:{Authorization:'Bearer '+key},signal:AbortSignal.timeout(60000)});if(!response.ok)throw new Error('기록 내보내기 실패');const blob=await response.blob(),url=URL.createObjectURL(blob),a=node('a');a.href=url;a.download='token-meter-usage-history.'+format;a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);}catch(e){error(e.message);}}
  $('history-form').addEventListener('submit',e=>{e.preventDefault();apply();});
  $('history-clear').addEventListener('click',()=>{$('history-form').reset();apply();});
  $('history-next').addEventListener('click',()=>{if(nextCursor){cursors=cursors.slice(0,pageIndex+1);cursors.push(nextCursor);pageIndex++;refresh(true);}});
  $('history-prev').addEventListener('click',()=>{if(pageIndex){pageIndex--;refresh(true);}});
  $('history-first').addEventListener('click',()=>{cursors=[''];pageIndex=0;refresh(true);});
  $('history-follow').addEventListener('change',()=>{if($('history-follow').checked&&pageIndex===0)refresh(true);});
  $('history-csv').addEventListener('click',()=>exportRows('csv'));$('history-jsonl').addEventListener('click',()=>exportRows('jsonl'));
  $('reanalyse-antigravity').addEventListener('click',async()=>{const b=$('reanalyse-antigravity');b.disabled=true;b.textContent='원본 DB 다시 읽는 중';try{const r=await api('/api/antigravity/reanalyse',{});flash(r.health?.files?'원본 DB 재분석 완료. 변경된 관측값은 보존 로그에 수정본으로 남았습니다.':'원본 DB를 찾지 못했습니다. 기존 기록을 보존하며 수집 경로를 확인하세요.');await load();await refresh(true);}catch(e){flash(e.message,true);}finally{b.disabled=false;b.textContent='Antigravity 기록 재분석';}});
  window.TMHistory={onStatus,renderPricing,refresh,detail,resetView:()=>{$('history-form').reset();cursors=[''];pageIndex=0;apply();}};
})();
