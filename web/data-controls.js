'use strict';
/* Destructive actions require an explicit in-app dialog. No source-file deletion. */
(()=>{
  let pending=null,busy=false,opening=false,lastEpoch=null;
  const dialog=$('delete-data-dialog'),form=$('delete-data-form');
  function requestKey(){if(crypto.randomUUID)return crypto.randomUUID();const b=crypto.getRandomValues(new Uint8Array(16));b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;const h=Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');return [h.slice(0,8),h.slice(8,12),h.slice(12,16),h.slice(16,20),h.slice(20)].join('-');}

  function updateConfirm(){
    const typed=!pending?.phrase||$('delete-data-phrase').value===pending.phrase;
    $('delete-data-submit').disabled=!pending||busy||!typed||!$('delete-data-ack').checked;
  }
  async function open(kind,ids=[]){
    if(busy||opening)return;opening=true;
    try{
      const state=await api('/api/data/state');
      const runs=(await api('/api/measurements')).runs;
      const selected=kind==='selected'?runs.filter(r=>ids.includes(r.id)):runs;
      if(kind==='selected'&&!selected.length){flash('삭제할 측정이 없습니다.');await load();return;}
      if(kind==='measurements'&&!selected.length){flash('삭제할 측정 기록이 없습니다.');return;}
      pending={kind,ids:selected.map(r=>r.id),state,phrase:kind==='all'?'전체 초기화':kind==='measurements'?'측정 전체 삭제':null,
        requestKey:requestKey()};
      form.reset();set('delete-data-error','');
      set('delete-data-title',kind==='all'?'누적 사용량까지 전체 초기화':kind==='measurements'?'측정 기록 전체 삭제':'선택한 측정 삭제');
      const info=clear('delete-data-description');
      if(kind==='all'){
        info.append(node('p','',`사용 기록 ${int(state.requestCount)}개 · 측정 ${int(state.measurementCount)}개 (진행 중 ${int(state.runningMeasurements)}개) · 작업 ${int(state.taskCount)}개를 활성 데이터에서 비웁니다.`));
        info.append(node('p','','IN · CACHE READ · CACHE WRITE · OUT · TOTAL과 비용을 0부터 시작합니다. 과거 원본 로그를 다시 읽어도 초기화 이전 사용량은 합산하지 않습니다.'));
        info.append(node('p','muted small','이전 Token Meter 데이터는 로컬 백업으로 남습니다. 설정·사용자 단가·수집 경로는 유지합니다. Codex·Claude·Antigravity 원본 파일과 계정 사용량은 변경하지 않습니다.'));
        info.append(node('p','meter-warning','진행 중 요청은 초기화 이후 관측한 증가분만 셉니다. 아직 기록되지 않은 사용량의 실제 발생 시점은 알 수 없으므로 작업을 마친 뒤 초기화하는 것이 안전합니다.'));
      }else{
        info.append(node('p','',`${selected.length}개 측정을 삭제합니다. 누적 사용량과 사용 이력 로그는 유지됩니다.`));
        const list=node('ul','delete-targets');for(const r of selected.slice(0,12))list.append(node('li','',r.name+(r.status==='running'?' · 진행 중 — 종료 없이 제거':'' )+(r.pinned?' · 상태바 고정 해제':'')));info.append(list);
        if(selected.length>12)info.append(node('p','small',`외 ${selected.length-12}개 (숨긴 기록·취소 기록 포함)`));
        info.append(node('p','muted small','숨기기와 달리 활성 측정 파일에서도 제거하며 기록 한도가 비워집니다. 삭제 취소 버튼은 없습니다. 직전 변경 전 파일은 로컬 백업에 남을 수 있습니다.'));
      }
      $('delete-data-phrase-label').hidden=!pending.phrase;
      set('delete-data-phrase-hint',pending.phrase?`확인 문구: ${pending.phrase}`:'');
      $('delete-data-phrase').placeholder=pending.phrase||'';
      set('delete-data-submit',kind==='all'?'전체 초기화 실행':'삭제');
      set('delete-data-ack-label',kind==='all'?'초기화 범위와 이전 데이터 백업 보존을 확인했습니다.':'선택한 측정 결과를 삭제하는 데 동의합니다.');
      updateConfirm();dialog.showModal();$('delete-data-cancel').focus();
    }catch(e){flash(e.message,true);}finally{opening=false;}
  }
  function clearLocal(){
    ++requestSeq;scope='all';$('provider').value='all';$('project').value='';$('measurement-select').value='';
    window.TMMeasurements?.resetLocal();window.TMHistory?.resetView();
    for(const id of ['comparison-dialog','price-detail-dialog','rate-detail-dialog','input-detail-dialog','rate-audit-dialog','measurement-edit-dialog'])if($(id)?.open)$(id).close();
  }
  function onStatus(d){
    const epoch=d.dataState?.epochId||'legacy';
    if(lastEpoch!==null&&epoch!==lastEpoch){clearLocal();lastEpoch=epoch;load();return false;}
    lastEpoch=epoch;
    const banner=$('data-reset-banner');banner.hidden=!d.dataState?.startedAt;
    if(!banner.hidden)banner.textContent='전체 초기화 기준: '+clock(d.dataState.startedAt,true)+' · 이전 기록은 백업 보존 · 이 기준 이후 관측 증가분만 표시';
  }
  form.addEventListener('submit',async e=>{
    e.preventDefault();if(busy||!pending||$('delete-data-submit').disabled)return;
    const p=pending;busy=true;updateConfirm();$('delete-data-cancel').disabled=true;set('delete-data-error','처리 중입니다. 창을 닫지 마세요.');
    try{
      ++requestSeq;
      const result=p.kind==='all'?await api('/api/data/reset',{confirmation:$('delete-data-phrase').value,expectedEpochId:p.state.epochId,requestKey:p.requestKey}):
        await api('/api/measurements/delete',{...(p.kind==='measurements'?{all:true}:{ids:p.ids}),confirmation:p.kind==='measurements'?'측정 전체 삭제':'삭제'});
      if(p.kind==='all')clearLocal();
      else {
        window.TMMeasurements?.forget(result.deletedIds||[]);
        if(scope==='measurement'&&(result.deletedIds||[]).includes($('measurement-select').value)){scope='all';$('measurement-select').value='';}
      }
      dialog.close();pending=null;
      flash(p.kind==='all'?'전체 초기화 완료. 새 사용량부터 기록합니다. 이전 데이터는 '+result.previousDirectory+'에 보존됩니다.':`${result.deleted}개 측정을 삭제했습니다. 누적 사용량과 사용 이력은 유지됩니다.`);
      await load();
    }catch(err){set('delete-data-error',err.message);}
    finally{busy=false;$('delete-data-cancel').disabled=false;updateConfirm();}
  });
  dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();});
  $('delete-data-cancel').addEventListener('click',()=>{if(!busy){pending=null;dialog.close();}});
  for(const id of ['delete-data-phrase','delete-data-ack'])$(id).addEventListener('input',updateConfirm);
  $('clear-all-measurements').addEventListener('click',()=>open('measurements'));
  $('reset-all-data').addEventListener('click',()=>open('all'));
  window.TMDataControls={confirmDelete:ids=>open('selected',ids),onStatus};
})();
