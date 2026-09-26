'use strict';
// These panels show stored APPLIED rates, never an averaged price disguised as an API tariff.
(()=>{
  let current=null,unit=1000000,opened=null;
  const unitName=()=>unit===1000000?'100만 토큰 (1M = 1,000,000)':'1,000 토큰';
  const rate=(n,basis=unit)=>n==null?'단가 미확인':'$'+(n*basis/1000000).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:9});
  const amount=r=>r.costUsd!==null?dollars(r.costUsd):r.knownUsd>0?dollars(r.knownUsd)+' (계산분)':'계산 불가';
  function rateText(rates){const active=rates.filter(r=>r.tokens>0),unique=[...new Set((active.length?active:rates).map(r=>r.usdPerMillion))];return !unique.length?'단가 미확인':unique.length===1?rate(unique[0])+' / '+unitName():unique.length+'개 단가 적용 · 상세 확인';}
  function safeLink(parent,label,url){try{const u=new URL(url);if(u.protocol!=='https:'&&u.protocol!=='http:')return;const a=node('a','',label);a.href=u.href;a.target='_blank';a.rel='noopener noreferrer';parent.append(a);}catch{}}
  function rowNote(parent,b){
    if(b?.cacheWriteUnreportedRecords)parent.append(node('p','price-warning',int(b.cacheWriteUnreportedRecords)+'건에 캐시 쓰기 카운터가 없습니다. 표의 쓰기는 관측분이며, 미보고분은 일반 입력으로 처리한 참고 환산입니다.'));
    if(b?.cacheReadUnreportedRecords)parent.append(node('p','price-warning',int(b.cacheReadUnreportedRecords)+'건에 캐시 읽기 카운터가 없습니다. 0으로 확인한 것이 아닙니다.'));
    if(b?.invalidRecords)parent.append(node('p','price-warning',int(b.invalidRecords)+'건의 입력 합계/세부값이 일치하지 않습니다. 충돌 항목의 비용은 확정하지 않습니다.'));
    if(b?.referenceRecords)parent.append(node('p','muted small','Antigravity 입력 구성은 비공개 DB의 참고 해석입니다. 공식 청구서와 대조한 수치가 아닙니다.'));
  }
  function inputDetail(b,root){
    if(!b){root.append(node('p','muted','이 저장 결과에는 입력 세부 내역이 없습니다. 전체 사용 이력에서 확인하세요.'));return;}
    const table=node('table'),head=node('tr');for(const t of ['입력 구분','토큰','적용 단가 / '+unitName(),'항목 비용'])head.append(node('th','',t));table.append(append(node('thead'),head));const body=node('tbody');
    for(const r of b.rows){
      const missing=r.key.startsWith('cacheWrite')?b.cacheWriteUnreportedRecords:r.key==='cacheRead'?b.cacheReadUnreportedRecords:0;
      const absent=missing>0&&r.tokens===0;
      append(body,append(node('tr'),node('td','',r.label),node('td','num',absent?'미기록':int(r.tokens)+(missing?' (관측분)':'')),node('td','num',rateText(r.rates)),node('td','num',absent?'분리 불가':amount(r)+(missing?' (관측분)':''))));
    }
    table.append(body);root.append(append(node('div','table-scroll input-detail-table'),table));rowNote(root,b);
  }
  function writePrice(r,basis=unit){const v=r?.rates||{};const xs=[];if(v.cacheWrite!==null&&v.cacheWrite!==undefined)xs.push(rate(v.cacheWrite,basis));if(v.cacheWrite5m!==null&&v.cacheWrite5m!==undefined)xs.push('5분 '+rate(v.cacheWrite5m,basis));if(v.cacheWrite1h!==null&&v.cacheWrite1h!==undefined)xs.push('1시간 '+rate(v.cacheWrite1h,basis));return xs.length?xs.join(' · '):'단가 없음 (무료 아님)';}
  function preview(r){if(!r?.available)return 'API 단가 미확인';return 'IN '+rate(r.rates.input)+' · READ '+rate(r.rates.cacheRead)+' · WRITE '+writePrice(r)+' · OUT '+rate(r.rates.output)+' (추론 포함)';}
  function rateCard(r,root){
    const card=node('section','applied-rate-card');append(card,node('h3','',r.model||'모델 식별 미확인'),node('p','muted small',(r.modelProvider||'공급자 미기록')+' · '+(r.tier||'모드 미기록')+' · '+(r.records?int(r.records)+'건의 저장된 적용 단가':'이 요청에 저장된 적용 단가')));
    const binding=r.binding;
    if(binding){const proof=node('div','rate-binding-proof');append(proof,
      node('p','','관측 모델: '+(binding.eventModel||r.model)),
      node('p','','가격표 모델: '+(binding.tariffModel||(binding.tariffModels||[]).join(' / ')||'미확인')),
      node('p','','공급자: '+(binding.modelProvider||'미기록')+' → '+(binding.tariffProvider||'도구 범위 사용자 규칙')+' · 모드 '+binding.tier),
      node('p',binding.status==='mismatch'?'price-warning':'',binding.status==='matched'?'모델·단가 연결 일치 · '+({'exact':'정확한 모델 ID','date-alias':'날짜 버전 → 기본 모델 단가','google-prefix':'models/ 접두어 정규화'}[binding.matchKind]||binding.matchKind):binding.status==='mismatch'?'모델·단가 불일치 — 이 요금표로 계산하지 않습니다.':'연결할 단가 없음'));
      for(const reason of binding.reasons||[])proof.append(node('p','price-warning',reason.message));card.append(proof);}
    if(!r.available){card.append(node('p','price-warning','모델 또는 가격표를 확인할 수 없습니다. 다른 모델의 단가를 추정 적용하지 않습니다.'));root.append(card);return;}
    const grid=node('div','tariff-grid');for(const [label,key] of [['IN · 일반 입력','input'],['CACHE READ · 읽기','cacheRead'],['CACHE WRITE · 쓰기','cacheWrite'],['OUT · THINKING 포함','output']])append(grid,append(node('div','tariff-box'),node('small','',label),node('strong','',key==='cacheWrite'?writePrice(r):rate(r.rates[key]))));
    append(card,node('p','rate-unit','USD / '+unitName()),grid);
    const conditions=node('div','rate-conditions');
    if(r.longContext){conditions.append(node('p','',`장문 규칙: 요청 1회의 입력이 ${int(r.longContext.above)}토큰을 초과하면 입력·캐시 ×${r.longContext.inputMultiplier}, 출력 ×${r.longContext.outputMultiplier}. 기간/세션 누적량으로 판정하지 않습니다.`));conditions.append(node('p',r.contextInputUnknown?'price-warning':'',r.contextInputUnknown?'요청 단위 길이 미기록: 장문 여부 미확인 · 단문 참고 단가':r.longContextApplied?'이 단가 그룹은 장문 할증이 적용된 가격입니다.':'이 단가 그룹에는 장문 할증이 적용되지 않았습니다.'));}
    if(r.contextTiers?.length)conditions.append(node('p','muted small','입력 길이별 조건: '+JSON.stringify(r.contextTiers)));
    if(r.selectedMultiplier!==1)conditions.append(node('p','','요금 모드 배수 ×'+r.selectedMultiplier+'가 위 적용 단가에 반영돼 있습니다.'));
    append(conditions,node('p','','THINKING은 전체 출력의 일부입니다. OUT에 THINKING을 다시 더하지 않습니다.'),node('p','muted small',r.cacheWriteNote||''));
    if(r.referenceReasons?.length)conditions.append(node('p','price-warning','참고 조건: '+r.referenceReasons.map(x=>typeof x==='string'?x:x.message||x.code).join(' · ')));
    card.append(conditions);
    if(r.inputBreakdown){
      const ip=r.inputBreakdown.rows.reduce((n,p)=>n+BigInt(p.knownPico||'0'),0n),op=BigInt(r.knownOutputPico||'0');
      const complete=r.inputBreakdown.rows.every(p=>p.costPico!=null)&&r.outputUsd!=null;
      const source={id:r.id||'tariff-detail',records:r.records||1,input:r.inputBreakdown.inputTokens,output:r.outputTokens||0,total:r.inputBreakdown.inputTokens+(r.outputTokens||0),inputBreakdown:r.inputBreakdown,apiRates:[r],outputUsd:r.outputUsd,knownOutputUsd:r.knownOutputUsd,totalUsd:complete?Number(ip+op)/1e12:null,knownTotalUsd:Number(ip+op)/1e12};
      card.append(billingTable(source));
      const more=node('details','billing-details');more.append(node('summary','','캐시 유지시간별 계산식'));const inner=node('div','billing-detail-inner');inputDetail(r.inputBreakdown,inner);more.append(inner);card.append(more);
    }
    const meta=node('div','rate-provenance');append(meta,node('p','',`단가 기준일 ${r.asOf||'미기록'} · 재확인 ${r.verifiedAt||'미기록'} · 출처 유형 ${r.origin||'저장 단가'}`),node('p','',`유효기간: ${r.effectiveFrom||'시작 미지정'} ~ ${r.effectiveTo||'종료 미지정'} (종료 시각 미만)`));safeLink(meta,'가격 원문',r.source);safeLink(meta,'요금 조건 원문',r.conditionSource);if(r.source)meta.append(node('p','muted small',r.source));card.append(meta);root.append(card);
  }
  function showRates(title,rates){opened={title,rates};set('rate-dialog-title',title);const root=clear('rate-detail-content');root.append(node('p','rate-unit','기준: '+unitName()+'당 USD. 실제 청구액이 아니라 기록된 토큰의 API 환산 단가입니다.'));
    if(!rates?.length)root.append(node('p','muted','이 측정에는 아직 단가가 연결된 요청이 없습니다. 일반 가격표는 ‘지원 모델 검색’에서 확인하세요.'));
    else{if(rates.length>1)root.append(node('p','price-warning',rates.length+'개 모델·공급자·시점·조건의 단가 그룹입니다. 하나의 단가로 평균내지 않습니다.'));for(const r of rates)rateCard(r,root);}
    if(!$('rate-detail-dialog').open)$('rate-detail-dialog').showModal();
  }
  function button(label,title,rates){const b=node('button','quiet api-rate-button',label);b.type='button';b.addEventListener('click',()=>showRates(title,rates));return b;}
  function modelCell(row,s,model,fallback){const td=node('td','model-api-rates'),rs=s.apiRates?.length?s.apiRates:(s.measured&&fallback?.length?fallback:[]);td.append(node('small','rate-unit','API 단가 / '+unitName()));if(s.measured&&!s.apiRates?.length&&rs.length)td.append(node('small','price-note muted','새 측정 미사용 · 누적 기록 단가 참고'));td.append(node('div','rate-preview',rs.length===1?preview(rs[0]):rs.length?rs.length+'개 적용 단가 · 혼합 조건':'아직 관측된 적용 단가 없음'));td.append(button('단가 · 계산식',model+' · 저장된 API 단가',rs));row.append(td);}
  function inputCell(td,s){const b=s.inputBreakdown;if(!b)return;const normal=b.rows.find(r=>r.key==='normalInput')?.tokens||0,read=b.rows.find(r=>r.key==='cacheRead')?.tokens||0;td.append(node('small','input-cell-note',`일반 ${int(normal)}\n캐시 읽기 ${int(read)}\n쓰기 ${int(b.cacheWriteTokens)}${b.cacheWriteUnreportedRecords?' (관측분)':''}`));}
  function recordPreview(parent,e){const line=node('small','rate-preview',preview(e.apiRate)+' / '+unitName());line.title='이 요청에 저장된 적용 단가. 단가와 사용금액은 다릅니다.';parent.append(line);}
  function billingRate(item){
    const rs=item?.rates||[];if(!rs.length)return '관측 단가 없음';
    const values=[...new Set(rs.map(x=>x.usdPerMillion))];
    if(values.length===1)return rate(values[0]);
    if(item.key==='cacheWrite' && rs.length<=3 && rs.every(x=>x.usdPerMillion!=null))return rs.map(x=>(x.label?x.label+' ':'')+rate(x.usdPerMillion)).join(' · ');
    return values.length+'개 단가 · 혼합'+(values.includes(null)?' / 미확인 포함':'');
  }
  function billingRow(item,s){
    const tr=node('tr');tr.dataset.bucket=item.key;tr.dataset.evidence=item.usageState;
    const label=append(node('th','billing-name'),node('strong','',item.short),node('span','',item.label),node('small','',item.note));label.scope='row';
    const count=node('td','num billing-count'),tariff=node('td','num billing-tariff'),amount=node('td','num billing-amount');
    count.dataset.label='사용 토큰';tariff.dataset.label='API 단가';amount.dataset.label='사용금액';
    const has=s.records||s.measured||s.id;
    append(count,node('strong','',has?metricToken(s,item.key):'—'));
    if(has)count.append(node('small','evidence-badge '+item.usageState,item.statusLabel));
    if(item.partial||item.reference)count.title=(item.notes||[]).join(' · ');
    append(tariff,node('strong','',has?billingRate(item):'관측 단가 없음'),node('small','rate-unit row-unit','USD / '+unitName()));
    append(amount,node('strong','',has?metricCost(s,item.key):'—'));
    if(has&&item.costUsd==null)amount.append(node('small','price-warning','미계산 항목은 0원 아님'));
    tr.append(label,count,tariff,amount);return tr;
  }
  function billingTable(s){
    const v=billingView(s),wrap=node('div','billing-table-wrap'),table=node('table','billing-table'),head=node('tr');
    for(const t of ['과금 항목','사용 토큰','API 단가 · USD / '+unitName(),'사용금액 · USD'])head.append(node('th','',t));
    table.append(append(node('thead'),head));const body=node('tbody');for(const item of v.components)body.append(billingRow(item,s));table.append(body);
    const total=node('tr');append(total,node('th','','TOTAL'),node('td','num',metricToken(s,'total')),node('td','num','네 항목 합계'),node('td','num',metricCost(s,'total')));table.append(append(node('tfoot'),total));wrap.append(table);return wrap;
  }
  function renderInput(d){
    current=d;const s=d.summary,b=s.inputBreakdown,has=s.records||s.measured,v=billingView(s),root=clear('billing-rows'),notes=clear('input-bucket-notes');
    const range=d.measurement?'재측정 · '+d.measurement.name:(LABELS[d.scope||scope]||'전체')+' · '+(NAMES[d.provider]||'전체 도구');
    set('input-scope',range+' · '+int(s.records||0)+'개 관측 기록');set('range-label',d.measurement?'재측정':LABELS[d.scope||scope]);
    set('billing-rate-heading','API 단가 · USD / '+unitName());
    const tariffGroups=s.apiRates||[];set('billing-model-context',tariffGroups.length===1?'단가 대상: '+(tariffGroups[0].model||'모델 미확인')+' · '+(tariffGroups[0].modelProvider||'공급자 미확인')+' · '+(tariffGroups[0].tier||'모드 미기록')+(tariffGroups[0].longContextApplied?' · 장문':''):tariffGroups.length>1?tariffGroups.length+'개 모델·공급자·조건 혼합 · 개별 단가는 근거에서 확인':'단가 대상: 아직 관측 기록 없음');
    for(const item of v.components)root.append(billingRow(item,s));
    set('total-tokens',has?metricToken(s,'total'):'—');set('total-cost',has?metricCost(s,'total'):'—');
    set('cost-label',d.costLabel+(s.totalUsd==null?' · 계산분 소계':''));
    set('cost-equation',!has?'관측 기록 없음 · 사용금액 0으로 확인한 것이 아닙니다.':v.reconciled
      ?v.components.map(x=>metricCost(s,x.key)).join(' + ')+' = '+metricCost(s,'total')+(s.totalUsd==null?' · 미계산 항목 제외':'')
      :'입력 분류 내역 미확인 또는 합계 불일치 · 보존된 총액만 표시합니다. 상세 확인 필요');
    set('token-split',!has?'TOTAL = IN + CACHE READ + CACHE WRITE + OUT':v.reconciled
      ?v.components.map(x=>int(x.tokens)).join(' + ')+' = '+int(s.total)+' 토큰 · THINKING은 OUT에 포함'
      :'네 항목 합산 검증 불가 · 미기록을 0으로 바꾸지 않았습니다.');
    set('cost-coverage',!has?'기록이 저장되면 토큰·단가·금액이 함께 표시됩니다.':s.unpricedRecords?int(s.unpricedRecords)+'건에 미계산 항목 있음 · 계산분만 표시':'저장된 API 단가 기준 환산액 · 실제 청구액 아님');
    set('fx-note',d.fx&&has?(s.totalUsd==null?'계산분 기준 약 ':'약 ')+Math.round(s.knownTotalUsd*d.fx.rate).toLocaleString('ko-KR')+'원 · '+(d.fx.asOf||'환율 기준일 미기록'):'');
    set('input-equation',b?'입력 합계(캐시 포함) '+int(s.input)+' = 일반 '+int(s.normalInput??b.rows[0]?.tokens)+' + 읽기 '+int(s.cacheRead)+' + 쓰기 '+int(s.cacheWrite):'이 고정 결과는 입력 상세 미기록 · 전체 사용 이력을 확인하세요.');
    // Header figures derive from this same response and filter, never a demo constant.
    set('overview-cost',has?metricCost(s,'total'):'—');set('overview-tokens',has?metricToken(s,'total'):'—');
    set('overview-records',int(s.records||0)+'개 관측 기록 · '+range);
    set('overview-basis',!has?'기록 대기':s.totalUsd==null?'일부 계산':v.reference||(s.priceStatuses?.reference||0)>0?'참고 환산':'기록 기준 환산');
    const readUnknown=(b?.cacheReadUnreportedRecords||0)>0||!b||b.invalidRecords>0;
    set('overview-reuse',has&&s.input>0&&!readUnknown?(s.cacheRead/s.input*100).toLocaleString('ko-KR',{minimumFractionDigits:2,maximumFractionDigits:2})+'%':has&&readUnknown?'미확인':'—');
    if(has&&v.components.some(x=>x.usageUnreported)){
      set('cost-equation','캐시 세부 카운터 미기록 · 분류 가능한 관측값으로 계산한 참고 환산입니다. 미기록 쓰기를 0으로 확정하지 않습니다.');
      set('token-split','전체 '+int(s.total)+' 토큰은 보존됩니다. 일반 입력에는 구분하지 못한 캐시 미보고분이 포함될 수 있습니다.');
      set('cost-coverage','부분 입력 분류 · 실제 사용 요금 확인에는 원본의 캐시 쓰기 카운터가 필요합니다.');
    }
    rowNote(notes,b);if(!b&&has)notes.append(node('p','price-warning','이전 고정 측정에는 입력 분류가 없습니다. 입력 합계를 일반 입력으로 바꾸어 표시하지 않습니다.'));
    if(b&&has&&b.inputTokens)notes.append(node('p','muted small','입력 중 캐시 재사용 '+(s.cacheRead/b.inputTokens*100).toLocaleString('ko-KR',{maximumFractionDigits:2})+'% · 가격표 단가와 실제 사용금액은 다른 값입니다.'));
    const rates=s.apiRates||[],table=clear('applied-rates-table');
    if(rates.length>1)notes.append(node('p','muted small',rates.length+'개 모델·공급자·조건의 저장 단가를 적용했습니다. 혼합 단가는 평균으로 표시하지 않습니다.'));
    for(const r of rates.slice(0,30)){const tr=node('tr');append(tr,append(node('td'),node('strong','',r.model||'모델 식별 미확인'),node('small','price-note muted',(r.modelProvider||'공급자 미기록')+' · '+(r.tier||'standard')+(r.longContextApplied?' · 장문':'')+(r.records?' · '+int(r.records)+'건':''))),node('td','num',r.available?rate(r.rates.input):'단가 미확인'),node('td','num',r.available?rate(r.rates.cacheRead):'단가 미확인'),node('td','rate-write-cell',r.available?writePrice(r):'단가 미확인'),node('td','num',r.available?rate(r.rates.output):'단가 미확인'),append(node('td'),button('근거',r.model+' · API 단가 / 계산식',[r])));table.append(tr);}
    if(!rates.length){const td=node('td','empty',has?'이 범위에는 적용 단가 그룹이 없습니다. 전체 사용 이력에서 확인하세요.':'아직 관측된 적용 단가 없음');td.colSpan=6;table.append(append(node('tr'),td));}
    set('applied-unit','USD / '+unitName());set('applied-rates-note',rates.length>30?rates.length+'개 그룹 중 30개 표시. 「모델 · 단가 근거」에서 전체 확인.':'선택 범위의 요청에 저장된 적용 단가입니다. 최신 공개 가격표가 아니라 실제 이 계산에 쓴 단가입니다.');
  }
  $('cache-help-button').addEventListener('click',()=>$('cache-help-dialog').showModal());
  $('rate-unit-select').addEventListener('change',()=>{unit=Number($('rate-unit-select').value);if(current){renderInput(current);renderModels(current);renderPip();window.TMHistory?.refresh(true);}if(opened&&$('rate-detail-dialog').open)showRates(opened.title,opened.rates);});
  $('show-all-rates').addEventListener('click',()=>showRates('선택 범위 · 모든 API 단가 / 계산식',current?.summary.apiRates||[]));
  $('input-details-toggle').addEventListener('click',()=>{const root=clear('input-detail-content');inputDetail(current?.summary.inputBreakdown,root);$('input-detail-dialog').showModal();});
  let auditReport=null;
  $('rate-audit-button').addEventListener('click',async()=>{
    const b=$('rate-audit-button');b.disabled=true;
    try{auditReport=await api('/api/pricing/audit');const c=auditReport.counts;
      set('rate-audit-summary',`검사 ${int(auditReport.examined)} / ${int(auditReport.total)}건 · 일치 ${int(c.matched)} · 불일치 ${int(c.mismatch)} · 단가 미확인 ${int(c.unavailable)} · 이전 불일치 교정 ${int(c.previouslyCorrected)}`);
      const body=clear('rate-audit-table');for(const r of auditReport.records){const tr=node('tr'),status=r.status==='matched'?'일치':r.status==='mismatch'?'불일치':'단가 미확인';
        append(tr,append(node('td'),node('strong','',r.model),node('small','price-note muted',NAMES[r.tool]||r.tool)),node('td','',r.tariffModel||r.tariffModels.join(' / ')||'—'),node('td','',(r.modelProvider||'미기록')+' / '+r.tier),
          append(node('td'),node('strong',r.status==='mismatch'?'price-warning':'',status),node('small','price-note muted',r.status==='mismatch'?r.reasons.map(x=>x.message).join(' · '):r.rejected?'이전 불일치 교정':r.userOverride?'사용자 지정 단가':r.differentFromCatalog?'저장 당시 단가: 현재 카탈로그와 차이 있음':r.matchKind==='date-alias'?'날짜 별칭 → 기본 단가':'저장된 적용 단가')),node('td','num',r.applied?[rate(r.applied.input,1000000),rate(r.applied.cacheRead,1000000),rate(r.applied.cacheWrite,1000000),rate(r.applied.output,1000000)].join(' / '):'—'));body.append(tr);}
      set('rate-audit-note',auditReport.note+(auditReport.complete?'':' 최대 50,000건까지만 검사했습니다. 전체 검사 완료가 아닙니다.')+(auditReport.returned<auditReport.examined?' 상세는 문제 우선 최대 1,000건 표시합니다.':''));
      $('rate-audit-dialog').showModal();
    }catch(e){flash(e.message,true);}finally{b.disabled=false;}
  });
  $('rate-audit-export').addEventListener('click',()=>{if(!auditReport)return;const blob=new Blob([JSON.stringify(auditReport,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=node('a');a.href=url;a.download='token-meter-rate-audit.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);});
  window.TMRates={billingRate,billingTable,renderInput,modelCell,inputCell,recordPreview,rateCard,inputDetail,rate,writePrice,unitName,preview};
})();
