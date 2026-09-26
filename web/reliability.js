'use strict';
window.TMReliability=(()=>{
  let sessionRows=[],lastRefresh=0,pending=false;
  const statusNames={'matched-local-snapshot':'원본 스냅샷 ↔ 장부 일치','qualified-snapshot':'부분 검증 · 원본 변경/미지원 관측 있음',mismatch:'불일치 확인 · 아래 차이를 점검하세요','retained-history':'현재 원본에 없는 과거 관측도 장부에 보존 중'};
  function table(rows,heads){const t=node('table','reconciliation-table'),thead=node('thead'),tr=node('tr');for(const [i,h] of heads.entries())tr.append(node('th',i?'num':'',h));thead.append(tr);t.append(thead);const b=node('tbody');for(const row of rows){const tr=node('tr');for(const [i,v] of row.entries())tr.append(node('td',i?'num':'',v));b.append(tr);}t.append(b);return append(node('div','table-scroll'),t);}
  function render(d){
    const b=clear('scope-explanation'),s=d.scopeInfo;if(!s)return;
    if(s.legacyAntigravityRecords)b.append(node('strong','',`주의: 구버전 병합 기록 ${int(s.legacyAntigravityRecords)}건은 원본 DB 복구 전 총량을 신뢰할 수 없습니다.`));
    b.append(node('strong','',s.dataset==='source'?'관측 원본 세션 전체 · 초기화 전 포함':s.epochStartedAt?'활성 기록 · 전체 초기화 이후':'활성 기록 · 수집된 누적'));
    b.append(node('span','',`${d.provider==='all'?'여러 도구 합산':NAMES[d.provider]||d.provider} / ${LABELS[d.scope]||d.scope} / ${s.sessions}개 세션`));
    if(s.epochStartedAt)b.append(node('span','',`전체 초기화 기준: ${clock(s.epochStartedAt,true)}`));
    b.append(node('span','scope-total',`비교용 입력 전체 ${int(s.inputTotal)} = 일반 + 캐시 읽기 + 캐시 쓰기`));
    if(d.provider==='all'&&s.providers.length>1)b.append(node('small','',`포함 도구: ${s.providers.map(x=>NAMES[x]||x).join(', ')}. 한 CLI 세션과 직접 비교하지 마세요.`));
    if(!pending&&Date.now()-lastRefresh>15000)refresh().catch(()=>{});
  }
  async function refresh(){
    pending=true;try{
      const r=await api('/api/reliability');lastRefresh=Date.now();sessionRows=r.sessions;
      populate($('verify-session'),sessionRows.map(s=>({id:s.id,label:`${NAMES[s.provider]||s.provider} · ${s.id.slice(-12)} · 원본 ${int(s.source.records)} / 활성 ${int(s.active.records)}건`})), '세션 선택');
      set('reliability-summary',`활성 ${int(r.records)}건 · 카운터 불일치 ${int(r.counterInvariantFailures)}건 · 구버전 Antigravity 복구 대기 ${int(r.legacyAntigravityRecords)}건 · 마지막 수집 ${clock(r.lastScan,true)}${r.pendingDiskWrite?' · 디스크 저장 대기':''}`);
      const area=clear('repair-results');
      for(const repair of r.repairs){const box=node('div','repair-result');box.append(node('strong','',`Antigravity ${repair.sessionId.slice(-12)}: ${int(repair.old.records)} → ${int(repair.source.records)}개 호출`),node('p','',`복구 후 활성 ${int(repair.active.records)}건 · 초기화 전 제외 ${int(repair.excludedByBoundary)}건`),node('p','muted small',repair.notice));area.append(box);}
    }catch(e){set('reliability-summary',e.message);throw e;}finally{pending=false;}
  }
  async function openSession(dataset){
    const row=sessionRows.find(r=>r.id===$('verify-session').value);if(!row)throw new Error('먼저 세션을 선택하세요.');
    scope='session';$('provider').value=row.provider;$('project').value='';$('dataset-select').value=dataset;
    // Populate from the catalogue so reset-excluded sessions remain selectable.
    populate($('session'),sessionRows.filter(r=>r.provider===row.provider).map(r=>({id:r.id,label:r.id})));$('session').value=row.id;
    await load();window.scrollTo({top:0,behavior:'smooth'});
  }
  for(const [id,dataset] of [['open-active-session','active'],['open-source-session','source']])$(id).addEventListener('click',()=>openSession(dataset).catch(e=>flash(e.message,true)));
  $('measure-session').addEventListener('click',async()=>{
    try{const row=sessionRows.find(r=>r.id===$('verify-session').value);if(!row)throw new Error('세션을 먼저 선택하세요.');
      const r=await api('/api/measurements/start',{name:(NAMES[row.provider]||row.provider)+' '+row.id.slice(-8)+' 세션 측정',filter:{provider:row.provider,sessionId:row.id},requestKey:typeof crypto.randomUUID==='function'?crypto.randomUUID():Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('')});
      await api('/api/measurements/pin',{id:r.id});await window.TMMeasurements.view(r.id);flash('선택한 세션만 0부터 측정하고 상태바에 고정했습니다.');
    }catch(e){flash(e.message,true);}
  });
  $('reliability-refresh').addEventListener('click',()=>refresh().catch(e=>flash(e.message,true)));
  $('reliability-export').addEventListener('click',async()=>{try{const d=await api('/api/reliability/export');const blob=new Blob([JSON.stringify(d,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=node('a');a.href=url;a.download='token-meter-diagnostics.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){flash(e.message,true);}});
  $('verify-db').addEventListener('click',async()=>{
    const btn=$('verify-db');btn.disabled=true;
    try{const id=$('verify-session').value;if(!id.startsWith('antigravity:'))throw new Error('DB 대조는 Antigravity 세션을 선택하세요. Codex는 동일 범위 수동 비교와 회귀 검증을 사용합니다.');
      set('verification-result','원본을 다시 수집하고 읽기 전용으로 대조 중…');
      const r=await api('/api/reliability/verify',{sessionId:id}),el=clear('verification-result');
      el.append(node('h3','',statusNames[r.status]||r.status),table([['호출 수',int(r.source.records),int(r.stored.records),int(r.stored.records-r.source.records)],...r.diff.map(x=>[{input:'입력 전체',normalInput:'일반 입력',cacheRead:'캐시 읽기',cacheWrite:'캐시 쓰기',output:'전체 출력',total:'총 토큰'}[x.field],int(x.source),int(x.stored),int(x.delta)])],['항목','원본 DB','보존 장부','차이']));
      if(r.limited)el.append(node('p','meter-warning',`검증 한도: 발견한 ${r.discoveredFiles}개 파일 중 ${r.verifiedFiles}개만 비교했습니다.`));
      el.append(node('p','muted small',`현재 활성 ${int(r.active.records)}건은 초기화 경계를 적용한 별도 값입니다. ${r.note}`));
      await refresh();await load();
    }catch(e){set('verification-result',e.message);}finally{btn.disabled=false;}
  });
  $('reference-compare-form').addEventListener('submit',async e=>{
    e.preventDefault();try{
      const id=$('verify-session').value;if(!id)throw new Error('대조할 세션을 먼저 선택하세요.');
      const r=await api('/api/reliability/compare',{selection:{scope:'session',session:id,provider:id.split(':')[0],dataset:$('reference-dataset').value},reference:{input:$('reference-input').value,output:$('reference-output').value,thinking:$('reference-thinking').value,inputMeaning:$('reference-input-meaning').value,outputMeaning:$('reference-output-meaning').value}});
      const labels={equal:'일치','within-display-rounding':'축약 표시 반올림 범위 내',different:'차이 있음',unavailable:'분해 미확인'},el=clear('reference-result');
      el.append(table(r.checks.map(c=>[c.label,c.actual==null?'미확인':int(c.actual),int(c.reference),labels[c.status]]),['항목','미터기','입력한 CLI 값','비교']),node('p','muted small',r.note));
      if(r.referenceOnly)el.append(node('p','muted small','THINKING은 비공개 필드 참고 해석입니다. 일치만으로 필드 의미를 인증하지 않습니다.'));
    }catch(e){set('reference-result',e.message);}
  });
  return {render,refresh};
})();
