'use strict';
const { hash, text } = require('./util');
const AS_OF = '2026-09-25';
const SOURCES = {
  codex: 'https://developers.openai.com/api/docs/pricing',
  claude: 'https://platform.claude.com/docs/en/about-claude/pricing',
  gemini: 'https://ai.google.dev/gemini-api/docs/pricing'
};
function rule(provider, models, input, output, cacheRead, extra = {}) {
  return { provider, modelProvider: {codex:'openai',claude:'anthropic',gemini:'google'}[provider], models, input, output, cacheRead, tier: 'standard', source: SOURCES[provider], asOf: AS_OF, effectiveFrom: null, ...extra };
}
const BUILTIN = [
  rule('codex', ['gpt-6-astra'], 10, 50, 1, { cacheWrite: 12.5, longContext:{above:272000,inputMultiplier:2,outputMultiplier:1.5}, fastMultiplier: 2 }),
  rule('codex', ['gpt-6-sol'], 2, 10, .2, { cacheWrite: 2.5, longContext:{above:272000,inputMultiplier:2,outputMultiplier:1.5}, fastMultiplier: 2 }),
  rule('codex', ['gpt-6-luna'], .1, .5, .01, { cacheWrite: .125, longContext:{above:272000,inputMultiplier:2,outputMultiplier:1.5}, fastMultiplier: 2 }),
  rule('codex', ['gpt-5.3-codex'], 1.75, 14, .175, { fastMultiplier: 2 }),
  rule('claude', ['claude-opus-5-5'], 4, 20, .2, { cacheWrite5m: 5, cacheWrite1h: 8, fastMultiplier: 2 }),
  rule('claude', ['claude-sonnet-5'], 2, 10, .2, { cacheWrite5m: 2.5, cacheWrite1h: 4 }),
  rule('claude', ['claude-fable-5-1'], 10, 50, .25, { cacheWrite5m: 12.5, cacheWrite1h: 20 }),
  rule('claude', ['claude-opus-5', 'claude-opus-4-8'], 5, 25, .5, { cacheWrite5m: 6.25, cacheWrite1h: 10, fastMultiplier: 2 }),
  rule('claude', ['claude-opus-4-7', 'claude-opus-4-6', 'claude-opus-4-5'], 5, 25, .5, { cacheWrite5m: 6.25, cacheWrite1h: 10 }),
  rule('claude', ['claude-sonnet-4-6'], 3, 15, .3, { cacheWrite5m: 3.75, cacheWrite1h: 6 }),
  rule('claude', ['claude-sonnet-4-5', 'claude-sonnet-4'], 3, 15, .3, { cacheWrite5m: 3.75, cacheWrite1h: 6, longContext: { above: 200000, inputMultiplier: 2, outputMultiplier: 1.5 } }),
  rule('claude', ['claude-haiku-4-5'], 1, 5, .1, { cacheWrite5m: 1.25, cacheWrite1h: 2 }),
  rule('gemini', ['gemini-3.8-flash','gemini-3.7-flash','gemini-3.6-flash'], .75, 3.75, .075, { effectiveTo:'2027-01-01T00:00:00Z', referenceOnly:true }),
  rule('gemini', ['gemini-3.8-flash','gemini-3.7-flash','gemini-3.6-flash'], 1.5, 7.5, .15, { effectiveFrom:'2027-01-01T00:00:00Z', referenceOnly:true }),
  rule('gemini', ['gemini-3.5-flash'], 1.5, 9, .15),
  rule('gemini', ['gemini-3.5-flash-lite'], .3, 2.5, .03),
  rule('gemini', ['gemini-3.1-flash-lite'], .25, 1.5, .025),
  rule('gemini', ['gemini-2.5-pro'], 1.25, 10, .125, { longContext: { above: 200000, inputMultiplier: 2, outputMultiplier: 1.5 } })
];
// Only this release's rechecked standard text prices receive this provenance.
for (const r of BUILTIN) {
  if (r.provider === 'claude' || r.models.some(m => /^gpt-6-|^gemini-3\.[5678]-flash(?:$|-lite)/.test(m))) {
    r.verifiedAt = AS_OF; r.origin = 'official-snapshot';
  }
}
for(const r of BUILTIN.filter(r=>r.models.some(m=>/^gpt-6-/.test(m)))) {r.conditionSource='https://developers.openai.com/api/docs/models/'+r.models[0];}
// Explicit Batch/Flex records only; reasoning effort never selects a price multiplier.
for(const r of BUILTIN.filter(r=>r.models.some(m=>/^gpt-6-/.test(m))).slice())for(const tier of ['batch','flex']) {const v=structuredClone(r);v.tier=tier;for(const k of ['input','output','cacheRead','cacheWrite'])if(v[k]!=null)v[k]*=.5;delete v.fastMultiplier;BUILTIN.push(v);}
const RATE_KEYS = ['input', 'output', 'cacheRead', 'cacheWrite', 'cacheWrite5m', 'cacheWrite1h'];
function validateRules(raw) {
  if (!raw || !Array.isArray(raw.rules) || raw.rules.length > 20000) throw new Error('prices.user.json: rules 배열 필요 (최대 20000)');
  return raw.rules.map(r => {
    if (!r || !['codex','claude','antigravity','gemini','generic','*'].includes(r.provider) || !Array.isArray(r.models) || !r.models.length || r.models.length > 50 || r.models.some(m => typeof m !== 'string' || !m || m.length > 200)) throw new Error('사용자 단가의 provider/models 오류');
    const out = { provider: r.provider, models: r.models.map(m => text(m)), tier: text(r.tier || 'standard', 40), source: text(r.source || 'user-supplied', 500), asOf: text(r.asOf || AS_OF, 30), effectiveFrom: r.effectiveFrom || null, effectiveTo: r.effectiveTo || null };
    if (r.modelProvider !== undefined) {
      if (typeof r.modelProvider !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,79}$/.test(r.modelProvider)) throw new Error('modelProvider 오류');
      out.modelProvider = r.modelProvider;
    }
    if (['*','generic'].includes(r.provider) && !out.modelProvider) throw new Error('* 규칙에는 modelProvider가 필요합니다.');
    for (const k of ['exactOnly','community','referenceOnly']) if (r[k] !== undefined) { if (typeof r[k] !== 'boolean') throw new Error(k+' 오류'); out[k] = r[k]; }
    if (r.referenceContext) out.referenceContext = text(r.referenceContext,60);
    if (r.contextTiers !== undefined) {
      if (!Array.isArray(r.contextTiers) || r.contextTiers.length > 10) throw new Error('contextTiers 오류');
      let last = -1;
      out.contextTiers = r.contextTiers.map(t => {
        if (!Number.isSafeInteger(t.minInput) || t.minInput < 0 || t.minInput <= last) throw new Error('contextTiers 경계 오류');
        last = t.minInput;
        const clean = {minInput:t.minInput};
        for (const k of RATE_KEYS) { if (t[k] == null) {clean[k]=null;continue;} if (typeof t[k] !== 'number' || !Number.isFinite(t[k]) || t[k]<0 || t[k]>100000) throw new Error('contextTiers 단가 오류'); clean[k]=t[k]; }
        return clean;
      });
    }
    if (out.effectiveTo && !Number.isFinite(Date.parse(out.effectiveTo))) throw new Error('effectiveTo 날짜 오류');
    if (out.effectiveFrom && out.effectiveTo && Date.parse(out.effectiveFrom)>=Date.parse(out.effectiveTo)) throw new Error('단가 유효기간 오류');
    if (out.effectiveFrom && !Number.isFinite(Date.parse(out.effectiveFrom))) throw new Error('effectiveFrom 날짜 오류');
    for (const k of RATE_KEYS) {
      if (r[k] == null) { out[k] = null; continue; }
      if (typeof r[k] !== 'number' || !Number.isFinite(r[k]) || r[k] < 0 || r[k] > 100000 || Math.abs(r[k] * 1e6 - Math.round(r[k] * 1e6)) > .0001) throw new Error(`${k}: 0~100000, 소수점 6자리까지`);
      out[k] = r[k];
    }
    if (out.input === null || out.output === null) throw new Error('input/output 단가는 필수');
    if (r.longContext) {
      const c = r.longContext;
      if (!Number.isSafeInteger(c.above) || c.above < 1 || ![c.inputMultiplier, c.outputMultiplier].every(v => Number.isFinite(v) && v > 0 && v <= 100)) throw new Error('longContext 설정 오류');
      out.longContext = { above: c.above, inputMultiplier: c.inputMultiplier, outputMultiplier: c.outputMultiplier };
    }
    if (r.fastMultiplier !== undefined) {
      if (!Number.isFinite(r.fastMultiplier) || r.fastMultiplier <= 0 || r.fastMultiplier > 100) throw new Error('fastMultiplier 오류');
      out.fastMultiplier = r.fastMultiplier;
    }
    return out;
  });
}
function modelMatches(model, expected) {
  return typeof model === 'string' && typeof expected === 'string' &&
    (model === expected || (model.startsWith(expected + '-') && /^(\d{8}|\d{4}-\d{2}-\d{2})$/.test(model.slice(expected.length + 1))));
}
function serviceOf(e) { return e.modelProvider || {codex:'openai',claude:'anthropic',gemini:'google'}[e.provider] || ''; }
function canonicalModel(e, model = e.model) { return serviceOf(e) === 'google' ? String(model || '').replace(/^models\//, '') : String(model || ''); }
function canonicalTier(tier) { return ['auto','default','standard',''].includes(tier || '') ? 'standard' : tier === 'priority' ? 'fast' : tier; }
function matchedModel(e,r) {
  const model=canonicalModel(e),models=Array.isArray(r?.models)?r.models:[];
  return models.find(m=>m===model) || (!r?.exactOnly ? models.find(m=>modelMatches(model,m)) : null) || null;
}
function scopeMatches(e,r) {
  // Explicit per-tool user overrides are NOT cross-tool API catalog rules.
  if (r.origin==='user' || r.source==='user-supplied') return r.provider===e.provider || r.provider==='*';
  return r.provider===e.provider || r.provider==='*' ||
    (['generic','antigravity'].includes(e.provider) && !!r.modelProvider && r.modelProvider===serviceOf(e));
}
const BINDING_REASONS = {
  'model-mismatch':'관측 모델과 저장된 가격표 모델이 다름',
  'provider-mismatch':'사용 공급자와 저장된 단가의 공급자가 다름',
  'tool-scope-mismatch':'이 도구에 적용할 수 없는 도구 전용 단가',
  'tier-mismatch':'요청 모드와 저장된 단가의 Standard/Fast/Batch/Flex 조건이 다름',
  'date-mismatch':'요청 시각이 저장된 단가 유효기간 밖이거나 시각 미확인',
  'local-not-confirmed':'로컬 실행이 확인되지 않아 로컬 무료 단가를 적용할 수 없음',
  'invalid-tariff':'저장된 가격표의 모델/숫자 형식이 잘못됨'
};
/** Compare the actual rule identity, never just resolvedModel (an old display label). */
function checkRateBinding(e,snapshot) {
  const service=serviceOf(e),base=snapshot?.baseRule||snapshot,tariffModel=matchedModel(e,base),codes=[];
  const result={version:1,status:snapshot?'matched':'unavailable',eventModel:e.model||'unknown',modelProvider:service,
    tariffModel:tariffModel||null,tariffModels:Array.isArray(base?.models)?base.models.slice(0,50):[],
    tariffProvider:base?.modelProvider||snapshot?.resolvedProvider||'',tool:e.provider,tariffScope:base?.provider||'',
    tier:canonicalTier(e.serviceTier),tariffTier:base?.tier||'',matchKind:null,reasonCodes:codes,reasons:[]};
  if(!snapshot)return result;
  if(!Array.isArray(base?.models)||!base.models.length||RATE_KEYS.some(k=>base[k]!=null&&(!Number.isFinite(base[k])||base[k]<0)))codes.push('invalid-tariff');
  if(!tariffModel || (snapshot.resolvedModel && canonicalModel(e,snapshot.resolvedModel)!==canonicalModel(e)))codes.push('model-mismatch');
  if((base?.modelProvider && base.modelProvider!==service)||(snapshot.resolvedProvider && snapshot.resolvedProvider!==service))codes.push('provider-mismatch');
  if(base && !scopeMatches(e,base))codes.push('tool-scope-mismatch');
  const tier=canonicalTier(e.serviceTier),baseTier=canonicalTier(base?.tier),mult=base?.selectedMultiplier||1;
  const modeOK=tier===baseTier?mult===1:tier==='fast'&&baseTier==='standard'&&!!base?.fastMultiplier&&mult===base.fastMultiplier;
  if(!modeOK || (snapshot.resolvedTier && canonicalTier(snapshot.resolvedTier)!==tier))codes.push('tier-mismatch');
  const at=Date.parse(e.timestamp);
  if((base?.effectiveFrom && (!Number.isFinite(at)||!(at>=Date.parse(base.effectiveFrom)))) ||
     (base?.effectiveTo && (!Number.isFinite(at)||!(at<Date.parse(base.effectiveTo)))))codes.push('date-mismatch');
  if(String(base?.source).startsWith('explicit-local-ollama') && (service!=='ollama'||e.local!==true))codes.push('local-not-confirmed');
  result.status=codes.length?'mismatch':'matched';
  result.matchKind=!tariffModel?null:tariffModel===canonicalModel(e)?(canonicalModel(e)!==e.model?'google-prefix':'exact'):'date-alias';
  result.reasons=codes.map(code=>({code,message:BINDING_REASONS[code]}));
  return result;
}
function selectRate(e, custom = []) {
  const service = serviceOf(e);
  if(service === 'ollama' && e.local === true) return resolveRate(e,{provider:'generic',modelProvider:'ollama',models:[e.model],tier:'standard',input:0,output:0,cacheRead:0,cacheWrite:0,cacheWrite5m:0,cacheWrite1h:0,source:'explicit-local-ollama; hardware/electricity excluded',asOf:AS_OF});
  const model = canonicalModel(e);
  const tier = canonicalTier(e.serviceTier);
  const supplied = custom.filter(r => !r.community && !['https://models.dev/api.json','https://openrouter.ai/api/v1/models'].includes(r.source));
  const remote = custom.filter(r => !supplied.includes(r));
  // User overrides remain explicit. A broad community catalog must not outrank
  // a standard rate verified against the first-party pricing page in this release.
  const all = [...supplied.slice().reverse().map(r=>({...r,origin:'user'})),
    ...BUILTIN.filter(r=>r.verifiedAt), ...remote.slice().reverse(),
    ...BUILTIN.filter(r=>!r.verifiedAt), ...require('../data/prices.extra.json').rules];
  let candidates = all.filter(r => scopeMatches(e,r) &&
    (!r.modelProvider || r.modelProvider === service) && r.models.some(m => r.exactOnly ? model === m : modelMatches(model,m)) &&
    (!r.effectiveFrom || (e.timestamp && Date.parse(e.timestamp) >= Date.parse(r.effectiveFrom))) &&
    (!r.effectiveTo || (e.timestamp && Date.parse(e.timestamp) < Date.parse(r.effectiveTo))));
  // A catalog with fewer pricing dimensions cannot silently remove a known long-context rule.
  const baseline=[...BUILTIN,...require('../data/prices.extra.json').rules].find(r=>r.modelProvider===service&&r.models.some(m=>r.exactOnly?model===m:modelMatches(model,m)));
  if(baseline&&(baseline.longContext||baseline.contextTiers||baseline.effectiveTo))candidates=candidates.filter(r=>!r.community||(baseline.effectiveTo ? !!r.effectiveTo : !!(r.longContext||r.contextTiers)));
  let r = candidates.find(r => r.tier === tier), multiplier = 1;
  if (!r && tier === 'fast') { r = candidates.find(r => r.tier === 'standard' && r.fastMultiplier); multiplier = r?.fastMultiplier || 1; }
  if (!r) return null;
  return resolveRate(e, { ...r, ...(r.community&&baseline?.referenceContext&&!r.contextTiers&&!r.longContext?{referenceContext:baseline.referenceContext}:{}),selectedMultiplier: multiplier });
}
function resolveRate(e, baseRule) {
  const multiplier = baseRule.selectedMultiplier || 1;
  const snapshot = { ...baseRule, models: [...baseRule.models], baseRule: structuredClone(baseRule), resolvedModel: e.model, matchedModel: matchedModel(e,baseRule), resolvedProvider:serviceOf(e), resolvedTool:e.provider, resolvedTier: canonicalTier(e.serviceTier), referenceOnly: baseRule.referenceOnly || !baseRule.effectiveFrom };
  for (const k of RATE_KEYS) snapshot[k] = baseRule[k] == null ? null : baseRule[k] * multiplier;
  snapshot.contextInputUnknown=!!baseRule.longContext&&e.contextInputKnown===false;
  if (baseRule.longContext && !snapshot.contextInputUnknown && (e.contextInput ?? e.input) > baseRule.longContext.above) {
    snapshot.longContextApplied = true;
    for (const k of RATE_KEYS) if (snapshot[k] !== null) snapshot[k] *= k === 'output' ? baseRule.longContext.outputMultiplier : baseRule.longContext.inputMultiplier;
  }
  if (baseRule.contextTiers && e.contextInputKnown!==false) {
    const matched = baseRule.contextTiers.filter(t => (e.contextInput ?? e.input) >= t.minInput).at(-1);
    if (matched) { for (const k of RATE_KEYS) snapshot[k] = matched[k] == null ? null : matched[k] * multiplier; snapshot.longContextApplied = true; }
  }
  snapshot.id = hash(JSON.stringify(snapshot));
  return snapshot;
}
function pico(tokens, rate) { return BigInt(tokens) * BigInt(Math.round(rate * 1e6)); }
const REASON_LABELS = {
  'model-unresolved':'모델 ID를 공개 모델명과 연결하지 못함',
  'price-not-found':'해당 공급자·모델·요금 모드·날짜에 맞는 단가 없음',
  'cache-ttl-missing':'캐시 쓰기 유지시간(5분/1시간) 미기록',
  'cache-rate-missing':'해당 캐시 항목 단가 없음',
  'input-usage-invalid':'입력 토큰 구성 불일치 또는 누락',
  'output-usage-invalid':'출력 토큰 합계 검증 불가',
  'usage-invalid':'토큰 합계/형식 검증 불가',
  'model-conflict':'동일 요청의 모델 관측값 충돌',
  'non-text-unsupported':'텍스트 외 모달리티의 요금 미지원',
  'short-context-reference':'장문 적용 경계 미확인: 단문 단가로만 환산',
  'user-price':'사용자가 직접 지정한 단가',
  'community-price':'커뮤니티 카탈로그 참고 단가',
  'cache-write-unreported':'캐시 쓰기 카운터 미기록: 미보고분을 일반 입력으로 처리한 참고 환산',
  'cache-read-unreported':'캐시 읽기 카운터 미기록: 미보고분을 일반 입력으로 처리한 참고 환산',
  'context-input-unreported':'요청 단위 입력 길이 미확인: 장문 여부를 확정하지 못한 단문 참고 환산'
};
const isUnresolved = model => !model || model === 'unknown' || /^antigravity-model-id-|^model_placeholder_/.test(model);
function priceEvent(e, custom = [], existingRate = null) {
  const checkedExisting=existingRate?checkRateBinding(e,existingRate):null;
  const rejected=checkedExisting?.status==='mismatch'?checkedExisting:null;
  const usable=rejected?null:existingRate;
  const rate = usable?.baseRule ? resolveRate(e, usable.baseRule) : usable || selectRate(e, custom);
  const binding={...checkRateBinding(e,rate),rejected};
  e.warnings ||= [];
  if (rate?.referenceContext === 'short-context' && !e.warnings.includes('short-context-reference-rate')) e.warnings.push('short-context-reference-rate');
  if (rate?.community && !e.warnings.includes('community-reference-price')) e.warnings.push('community-reference-price');
  if (e.provider === 'generic' && e.modality !== 'text' && !e.warnings.includes('non-text-price-unsupported')) e.warnings.push('non-text-price-unsupported');
  const warnings = new Set(e.warnings), reasons = [], missing = [], components = [];
  const addReason = (code, side='both') => {
    if (!reasons.some(r=>r.code===code&&r.side===side)) reasons.push({code,side,message:REASON_LABELS[code]||code});
  };
  const bothBad = ['usage-fields-missing','reported-total-mismatch','non-text-price-unsupported','unsupported-price-tier','antigravity-model-conflict'].some(w=>warnings.has(w));
  const inputBad = bothBad || (e.cacheRead+e.cacheWrite>e.input) || e.normalInput+e.cacheRead+e.cacheWrite!==e.input || e.cacheWrite5m+e.cacheWrite1h+e.cacheWriteUnknown!==e.cacheWrite || ['tool-token-accounting-unknown','cache-breakdown-inconsistent','measurement-input-breakdown-ambiguous'].some(w=>warnings.has(w));
  const outputBad = bothBad || e.outputTotalKnown===false || warnings.has('antigravity-output-breakdown-conflict');
  if(warnings.has('antigravity-model-conflict'))addReason('model-conflict');
  else if(warnings.has('non-text-price-unsupported'))addReason('non-text-unsupported');
  else if(bothBad)addReason('usage-invalid');
  else {if(inputBad)addReason('input-usage-invalid','input');if(outputBad)addReason('output-usage-invalid','output');}
  if(!rate)addReason(isUnresolved(e.model)?'model-unresolved':'price-not-found');
  let input=0n,output=0n;
  for(const [key,field,label,side] of [
    ['input','normalInput','일반 입력','input'], ['cacheRead','cacheRead','캐시 읽기','input'],
    ['cacheWrite5m','cacheWrite5m','캐시 쓰기 · 5분','input'], ['cacheWrite1h','cacheWrite1h','캐시 쓰기 · 1시간','input'],
    ['cacheWrite','cacheWriteUnknown','캐시 쓰기 · 유지시간 미기록','input'], ['output','output','출력 합계 (추론 중복 가산 없음)','output']
  ]) {
    const tokens=e[field]||0, bad=side==='input'?inputBad:outputBad;
    let amount=0n,problem=null;
    if(tokens && bad)problem=side==='input'?'input-usage-invalid':'output-usage-invalid';
    else if(tokens && rate?.[key]==null) {
      missing.push(key);
      problem=!rate?(isUnresolved(e.model)?'model-unresolved':'price-not-found'):
        key==='cacheWrite'&&((rate.cacheWrite5m!=null)||(rate.cacheWrite1h!=null))?'cache-ttl-missing':'cache-rate-missing';
      addReason(problem,side);
    } else if(tokens)amount=pico(tokens,rate[key]);
    const costPico=problem?null:String(amount);
    if(side==='input')input+=amount;else output+=amount;
    components.push({key,label,side,tokens,usdPerMillion:rate?.[key]??null,costPico,costUsd:costPico===null?null:Number(amount)/1e12,reason:problem});
  }
  if(!rate&&!missing.length)missing.push('model');
  // Preserve the machine-readable legacy marker, but never let an output-only
  // conflict invalidate valid input pricing or include invalid counts as known cost.
  if(inputBad||outputBad)missing.push('usage');
  const inputMissing=inputBad||components.some(x=>x.side==='input'&&x.costPico===null)||(!rate&&!e.input&&!e.output);
  const outputMissing=outputBad||components.some(x=>x.side==='output'&&x.costPico===null)||(!rate&&!e.input&&!e.output);
  const referenceReasons=[];
  if(rate?.contextInputUnknown)referenceReasons.push('context-input-unreported');
  if(e.input&&e.cacheWriteKnown===false&&(rate?.cacheWrite!=null||rate?.cacheWrite5m!=null||rate?.cacheWrite1h!=null))referenceReasons.push('cache-write-unreported');
  if(e.input&&e.cacheReadKnown===false&&rate?.cacheRead!=null)referenceReasons.push('cache-read-unreported');
  if(rate?.referenceContext==='short-context'&&!rate.longContext&&!rate.contextTiers)referenceReasons.push('short-context-reference');
  if(rate?.community)referenceReasons.push('community-price');
  if(rate?.origin==='user'||rate?.source==='user-supplied')referenceReasons.push('user-price');
  const result={engineVersion:4,rate,binding,inputPico:inputMissing?null:String(input),outputPico:outputMissing?null:String(output),
    knownInputPico:String(input),knownOutputPico:String(output),knownPico:String(input+output),
    totalPico:inputMissing||outputMissing?null:String(input+output),missing:[...new Set(missing)],components,reasons,referenceReasons};
  result.status=result.totalPico===null?(components.some(c=>c.tokens&&c.costPico!==null)?'partial':'unavailable'):referenceReasons.length?'reference':'calculated';
  return result;
}
function priceDetails(e) {
  const p=e.price,rate=p?.rate;
  return {status:p?.status||(p?.totalPico==null?'unavailable':'calculated'),
    statusLabel:{calculated:'단가 적용 완료',reference:'참고 조건으로 환산',partial:'일부 항목 계산 불가',unavailable:'계산 불가'}[p?.status||(p?.totalPico==null?'unavailable':'calculated')],
    reasons:p?.reasons||[],referenceReasons:(p?.referenceReasons||[]).map(code=>({code,message:REASON_LABELS[code]||code})),components:p?.components||[],
    outputBreakdown:require('./output-breakdown').pricedSplit(e),inputBreakdown:require('./input-breakdown').inputBreakdown(e),apiRate:require('./input-breakdown').rateView(e),
    rateSource:rate?.source||null,verifiedAt:rate?.verifiedAt||rate?.baseRule?.verifiedAt||null,asOf:rate?.asOf||null,
    provenance:rate?.origin||rate?.baseRule?.origin||(rate?.community?'community':rate?.source==='https://openrouter.ai/api/v1/models'?'provider-catalog':rate?'stored-reference':null),
    effectiveFrom:rate?.effectiveFrom||null,effectiveTo:rate?.effectiveTo||null,tier:rate?.resolvedTier||e.serviceTier||'standard',
    binding:p?.binding||checkRateBinding(e,rate),rateModel:matchedModel(e,rate?.baseRule||rate),observedModel:e.model,formula:'입력 = 일반 입력 + 캐시 읽기 + 캐시 쓰기. 총액 = 입력 비용 + 출력 비용. 단위 USD / 1,000,000 토큰.',
    billing:'공개 API 텍스트 토큰 환산/추정액. 실제 구독료·크레딧·세금·기타 도구 요금 아님.'};
}
function upgradeStoredRate(e,old,custom=[]){
  if(!old)return null;
  const base=old.baseRule||old;
  if(base.referenceContext!=='short-context'||base.source!==SOURCES.codex||base.origin==='user'||base.community)return old;
  const fresh=selectRate(e,custom);if(!fresh||!fresh.conditionSource)return old;
  const candidate=fresh.baseRule||fresh;
  if(!['input','output','cacheRead','cacheWrite'].every(k=>(base[k]??null)===(candidate[k]??null)))return old;
  return fresh;
}
module.exports = { checkRateBinding, BINDING_REASONS, canonicalTier, canonicalModel, matchedModel, upgradeStoredRate, RATE_KEYS, serviceOf, resolveRate, BUILTIN, AS_OF, SOURCES, validateRules, selectRate, priceEvent, priceDetails, REASON_LABELS, isUnresolved };
