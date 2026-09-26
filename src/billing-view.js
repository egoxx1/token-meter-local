'use strict';
/** Non-overlapping presentation contract. No tariffs are selected and no usage is
 * repriced here. Legacy input remains cache-inclusive; UI IN is normalInput.
 * The same projection is used by the browser, status line and JSON views. */
(function(factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else globalThis.TokenMeterBilling = api;
})(function() {
  const DEFINITIONS = [
    ['normalInput', 'IN', '일반 입력', '캐시 읽기·쓰기를 제외한 입력'],
    ['cacheRead', 'CACHE READ', '캐시 읽기', '캐시에서 재사용한 입력'],
    ['cacheWrite', 'CACHE WRITE', '캐시 쓰기', '서버 프롬프트 캐시 생성 · 코드 파일 쓰기 아님'],
    ['output', 'OUT', '출력', 'THINKING 포함 · 한 번만 합산']
  ];
  const validCount = n => Number.isSafeInteger(n) && n >= 0;
  const num = n => validCount(n) ? n : null;
  const money = n => typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
  const known = n => money(n) ?? 0;
  const WRITES = ['cacheWrite5m', 'cacheWrite1h', 'cacheWriteUnknown'];
  const LABELS = {cacheWrite5m:'5분',cacheWrite1h:'1시간',cacheWriteUnknown:'일반 / TTL 미기록',cacheWrite:'일반'};
  const USD = p => Number(p) / 1e12;

  function groupRates(s) { return s.apiRates || (s.apiRate ? [s.apiRate] : []); }
  function rateOptions(s, key, parts) {
    let rates = [];
    // With consumption, use only the components that were actually consumed.
    const used = parts.filter(p => p.tokens > 0);
    if (key !== 'output' && used.length) {
      for (const p of used) for (const r of p.rates || []) if (r.tokens > 0) rates.push({
        usdPerMillion:money(r.usdPerMillion), kind:p.key, label:LABELS[p.key] || '', tokens:r.tokens
      });
    } else {
      for (const g of groupRates(s)) {
        const rs = g.available ? g.rates || {} : {};
        const keys = key === 'normalInput' ? ['input'] : key === 'cacheWrite'
          ? ['cacheWrite','cacheWrite5m','cacheWrite1h'].filter(k => rs[k] != null)
          : [key];
        for (const k of keys.length ? keys : ['cacheWrite']) rates.push({
          usdPerMillion:money(rs[k]),kind:k,label:LABELS[k]||'',tokens:0
        });
      }
      // Legacy summary with breakdown rates but no saved group metadata.
      if (!rates.length) for (const p of parts) for (const r of p.rates || []) rates.push({
        usdPerMillion:money(r.usdPerMillion),kind:p.key,label:LABELS[p.key]||'',tokens:r.tokens || 0
      });
    }
    const map = new Map();
    for (const r of rates) {
      const id = JSON.stringify([r.usdPerMillion,key==='cacheWrite'?r.kind:'']);
      if (!map.has(id)) map.set(id,{...r}); else map.get(id).tokens += r.tokens;
    }
    return [...map.values()];
  }
  function combineAmounts(parts) {
    if (!parts.length) return {costUsd:null,knownUsd:0,costPico:null,knownPico:'0'};
    let p = 0n, complete = true;
    for (const part of parts) {
      if (part.costPico == null) complete = false;
      // Actual engine amounts are integer pico-USD; never recalc from a displayed rounded rate.
      p += BigInt(part.knownPico ?? (part.costPico ?? '0'));
    }
    return {costUsd:complete?USD(p):null,knownUsd:USD(p),costPico:complete?String(p):null,knownPico:String(p)};
  }
  function build(s = {}) {
    const b = s.inputBreakdown, parts = b?.rows || [];
    const has = !!(s.measured || s.records > 0 || s.id);
    const missing = !b;
    const components = DEFINITIONS.map(([key,short,label,note]) => {
      const pp = key === 'cacheWrite' ? parts.filter(p => WRITES.includes(p.key)) : parts.filter(p => p.key === key);
      let tokens, costUsd, knownUsd, costPico, knownPico, partial = false;
      if (key === 'output') {
        tokens = num(s.output ?? s.billableOutput);
        costUsd = money(s.outputUsd); knownUsd = known(s.knownOutputUsd ?? costUsd);
        knownPico = s.knownOutputPico ?? null; costPico = costUsd == null ? null : knownPico;
        partial = s.outputTotalKnown === false || s.outputTotalUnknownRecords > 0;
      } else {
        tokens = missing || !pp.length ? null : pp.reduce((t,p)=>t+(num(p.tokens)??0),0);
        ({costUsd,knownUsd,costPico,knownPico} = combineAmounts(pp));
        partial = !!(b?.invalidRecords || (key === 'cacheWrite' ? b?.cacheWriteUnreportedRecords : key === 'cacheRead' ? b?.cacheReadUnreportedRecords : b?.cacheWriteUnreportedRecords || b?.cacheReadUnreportedRecords));
      }
      const reference = key !== 'output' && !!b?.referenceRecords;
      const notes = [];
      if (missing && key !== 'output') notes.push('이 저장 결과에는 입력 분류 내역이 없습니다. 총 사용량은 유지합니다.');
      if (b?.invalidRecords && key !== 'output') notes.push('입력 분류 합계 불일치 · 해당 비용 확인 필요');
      if (b?.cacheWriteUnreportedRecords && key === 'cacheWrite') notes.push('쓰기 카운터 '+b.cacheWriteUnreportedRecords+'건 미기록 · 0으로 확인한 것이 아님');
      if (b?.cacheReadUnreportedRecords && key === 'cacheRead') notes.push('읽기 카운터 '+b.cacheReadUnreportedRecords+'건 미기록');
      if (partial && key === 'normalInput' && !b?.invalidRecords) notes.push('캐시 미보고분을 포함한 참고 분류');
      if (partial && key === 'output') notes.push('전체 출력 미확인 요청 포함 · 관측분');
      if (reference) notes.push('비공개 DB 참고 해석');
      // Preserve observed accounting counters for compatibility. Display evidence
      // separately: an absent counter is never a measured zero.
      const unreportedRecords = key === 'cacheWrite' ? b?.cacheWriteUnreportedRecords || 0
        : key === 'cacheRead' ? b?.cacheReadUnreportedRecords || 0 : 0;
      const usageUnreported = unreportedRecords > 0 && tokens === 0;
      const usageState = !has ? 'no-observations' : tokens == null ? 'legacy-unknown'
        : b?.invalidRecords && key !== 'output' ? 'invalid'
        : usageUnreported ? 'unreported' : unreportedRecords > 0 ? 'partial'
        : partial ? 'reference' : reference ? 'reference' : tokens === 0 ? 'reported-zero' : 'reported';
      const statusLabel = {'no-observations':'관측 대기','legacy-unknown':'분류 미기록','invalid':'분류 불일치',
        'unreported':'원본 카운터 미기록','partial':'일부 요청 관측','reference':'참고 분류',
        'reported-zero':'원본 보고 · 0','reported':'원본 기록 기준'}[usageState];
      return {key,short,label,note,tokens,costUsd,knownUsd,costPico,knownPico,partial,reference,notes,
        usageUnreported,unreportedRecords,usageState,statusLabel,
        rates:rateOptions(s,key,pp),details:key==='cacheWrite'?pp:[]};
    });
    const inputTotal = num(s.input), totalTokens = num(s.total);
    const classified = components.slice(0,3).every(c => c.tokens != null)
      ? components.slice(0,3).reduce((t,c)=>t+c.tokens,0) : null;
    const reconciled = classified != null && classified === inputTotal &&
      components[3].tokens != null && classified + components[3].tokens === totalTokens && !b?.invalidRecords;
    return {version:1,hasObservations:has,unitTokens:1000000,currency:'USD',inputMeaning:'normal-excluding-cache',
      outputMeaning:'includes-thinking-once',components,inputTotalTokens:inputTotal,reconciled,
      classificationMissing:missing,reference:components.some(c=>c.partial||c.reference),
      total:{key:'total',short:'TOTAL',label:'합계',tokens:totalTokens,costUsd:money(s.totalUsd),knownUsd:known(s.knownTotalUsd ?? s.totalUsd),
        partial:s.outputTotalKnown===false||s.outputTotalUnknownRecords>0,rates:[],notes:[]},
      formula:'TOTAL = IN(일반 입력) + CACHE READ + CACHE WRITE + OUT(THINKING 포함)',
      note:'네 과금 항목을 한 번씩 합산합니다. 원본 input 필드는 캐시 포함 입력 합계로 유지됩니다.'};
  }
  // Measurement rows can cover multiple model groups. Merge the saved component
  // evidence instead of losing cache prices when a reset is displayed per tool.
  function combine(groups = []) {
    const out={records:0,input:0,output:0,total:0,normalInput:0,cacheRead:0,cacheWrite:0,reasoning:0,
      pricedRecords:0,unpricedRecords:0,inputKnownRecords:0,outputKnownRecords:0,
      inputUnpricedRecords:0,outputUnpricedRecords:0,measured:true,apiRates:[],warnings:[]};
    const numeric=Object.keys(out).filter(k=>typeof out[k]==='number');
    const b={version:1,records:0,inputTokens:0,classifiedInputTokens:0,cacheWriteTokens:0,invalidRecords:0,
      cacheWriteUnreportedRecords:0,cacheReadUnreportedRecords:0,referenceRecords:0,rows:[]};
    const map=new Map();let ip=0n,op=0n,iu=false,ou=false,missing=false;
    for (const g of groups) {
      for (const k of numeric) out[k]+=g[k]||0;
      ip+=BigInt(g.knownInputPico ?? Math.round(known(g.knownInputUsd)*1e12));
      op+=BigInt(g.knownOutputPico ?? Math.round(known(g.knownOutputUsd)*1e12));
      iu ||= g.inputUsd == null; ou ||= g.outputUsd == null;
      out.apiRates.push(...(g.apiRates||[]));out.warnings.push(...(g.warnings||[]));
      if(!g.inputBreakdown){missing=true;continue;}
      for (const k of Object.keys(b)) if (typeof b[k]==='number' && k!=='version') b[k]+=g.inputBreakdown[k]||0;
      for (const row of g.inputBreakdown.rows) {
        if(!map.has(row.key)) map.set(row.key,{...row,tokens:0,knownPico:0n,unpricedRecords:0,rates:[]});
        const r=map.get(row.key);r.tokens+=row.tokens;r.knownPico+=BigInt(row.knownPico||'0');
        r.unpricedRecords+=row.unpricedRecords|| (row.costPico==null?1:0);r.rates.push(...(row.rates||[]));
      }
    }
    if (!groups.length) {
      for (const [key,pk,label] of [['normalInput','input','일반 입력'],['cacheRead','cacheRead','캐시 읽기'],['cacheWrite5m','cacheWrite5m','쓰기 5분'],['cacheWrite1h','cacheWrite1h','쓰기 1시간'],['cacheWriteUnknown','cacheWrite','쓰기 일반']])
        map.set(key,{key,priceKey:pk,label,tokens:0,knownPico:0n,unpricedRecords:0,rates:[]});
    }
    b.rows=[...map.values()].map(r=>({...r,costPico:r.unpricedRecords?null:String(r.knownPico),knownPico:String(r.knownPico),knownUsd:USD(r.knownPico),costUsd:r.unpricedRecords?null:USD(r.knownPico)}));
    const writes=b.rows.filter(r=>WRITES.includes(r.key)),wa=combineAmounts(writes);b.cacheWritePico=wa.costPico;b.knownCacheWriteUsd=wa.knownUsd;
    Object.assign(out,{inputBreakdown:missing?null:b,knownInputPico:String(ip),knownOutputPico:String(op),knownTotalPico:String(ip+op),
      inputUsd:iu?null:USD(ip),outputUsd:ou?null:USD(op),totalUsd:iu||ou?null:USD(ip+op),
      knownInputUsd:USD(ip),knownOutputUsd:USD(op),knownTotalUsd:USD(ip+op),
      outputTotalUnknownRecords:groups.reduce((n,g)=>n+(g.outputTotalUnknownRecords||0),0)});
    out.warnings=[...new Set(out.warnings)];return out;
  }
  return {DEFINITIONS,build,combine};
});
