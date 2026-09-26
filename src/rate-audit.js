'use strict';
// Read-only local comparison. Matching an identity does not verify private log semantics
// or a subscription invoice; a different current tariff does not rewrite historical spend.
const {checkRateBinding,selectRate,serviceOf,RATE_KEYS}=require('./pricing');
const {filtered}=require('./summary');
function auditRates(c,q={}) {
  const events=filtered(c,{...q,scope:q.scope||'all'}).events;
  const counts={matched:0,mismatch:0,unavailable:0,previouslyCorrected:0,userOverrides:0,differentFromCatalog:0};
  const rows=[],maxScan=50000,maxRows=1000;
  for(const e of events.slice(0,maxScan)) {
    const binding=checkRateBinding(e,e.price?.rate),rate=e.price?.rate,base=rate?.baseRule||rate;
    counts[binding.status]++;
    const fresh=selectRate(e,c.activeRules||[]),diff=!!rate&&!!fresh&&RATE_KEYS.some(k=>(rate[k]??null)!==(fresh[k]??null));
    const custom=base?.origin==='user'||base?.source==='user-supplied';
    if(e.price?.binding?.rejected)counts.previouslyCorrected++;
    if(custom)counts.userOverrides++;
    if(diff)counts.differentFromCatalog++;
    rows.push({id:e.id,timestamp:e.timestamp,tool:e.provider,modelProvider:serviceOf(e),model:e.model,
      tariffModel:binding.tariffModel,tariffModels:binding.tariffModels,tariffProvider:binding.tariffProvider,
      tier:binding.tier,status:binding.status,matchKind:binding.matchKind,reasons:binding.reasons,
      rejected:e.price?.binding?.rejected||null,source:rate?.source||null,asOf:rate?.asOf||null,
      userOverride:custom,differentFromCatalog:diff,unitTokens:1000000,currency:'USD',
      applied:rate?Object.fromEntries(RATE_KEYS.map(k=>[k,rate[k]??null])):null,
      catalog:fresh?Object.fromEntries(RATE_KEYS.map(k=>[k,fresh[k]??null])):null});
  }
  const rank=r=>r.status==='mismatch'?0:r.rejected?1:r.status==='unavailable'?2:r.differentFromCatalog?3:4;
  rows.sort((a,b)=>rank(a)-rank(b)||(b.timestamp||'').localeCompare(a.timestamp||''));
  return {schema:'token-meter.rate-audit.v1',appVersion:require('../package.json').version,generatedAt:new Date().toISOString(),
    total:events.length,examined:Math.min(events.length,maxScan),complete:events.length<=maxScan,counts,
    returned:Math.min(rows.length,maxRows),records:rows.slice(0,maxRows),repairs:c.repairs?.rateBindingV1||null,
    note:'읽기 전용 매칭 검사. 관측 모델·공급자·모드·날짜와 실제 저장된 가격 규칙을 대조합니다. 현재 카탈로그와의 숫자 차이는 과거 스냅샷/사용자 지정일 수 있어 자동 오류로 판정하지 않습니다. 금액은 API 환산액이며 실제 청구 검증이 아닙니다. 원본 프롬프트·응답·코드·인증키는 포함하지 않습니다.'};
}
module.exports={auditRates};
