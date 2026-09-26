'use strict';
/** Output is ALWAYS the normalized total, including thinking once.
 * This module only partitions that total; it never inflates consumption.
 * `responseOutput` is non-thinking output (may include tool/formatting tokens),
 * not a promise of exactly the text visible in the UI.
 */
const { count, text } = require('./util');
const VERSION = 1;
const SPLIT_KEYS = ['outputBreakdownVersion','responseOutput','thinkingOutput','outputSplitStatus',
  'outputSplitSource','outputSplitNote','outputTotalKnown','rawThinkingTokens','rawResponseTokens','reasoningKnown'];
function attachSplit(e, options = {}) {
  const total = count(e.output);
  const thinking = count(options.thinking), response = count(options.response);
  const totalKnown = options.totalKnown !== false && total !== null;
  let status = options.status || 'unavailable';
  let t = null, r = null;
  let note = options.note || '원본 usage에 THINKING 세부 카운터가 없어 분리할 수 없습니다.';
  if (totalKnown && total === 0 && (thinking === null || thinking === 0) && (response === null || response === 0)) {
    t = 0; r = 0; status = options.reference ? 'reference' : 'complete'; note = options.note || '관측된 전체 출력이 0입니다.';
  } else if (totalKnown && options.status !== 'mismatch' && (thinking !== null || response !== null)) {
    const ct = thinking ?? total - response, cr = response ?? total - thinking;
    if (count(ct) !== null && count(cr) !== null && ct + cr === total) {
      t = ct; r = cr; status = options.reference ? 'reference' : 'complete';
      note = options.note || '전체 출력 = 비추론 출력 + THINKING. THINKING 비용은 전체 출력 비용의 일부입니다.';
    } else {
      status = 'mismatch'; note = options.note || '원본 전체 출력과 THINKING/응답 세부값이 일치하지 않습니다. 전체 출력은 변경하지 않습니다.';
    }
  } else if (!totalKnown) {
    status = 'unavailable'; note = options.note || '전체 출력 카운터 확인 불가. 관측된 부분값만 보존하며 출력 요금은 확정하지 않습니다.';
  }
  Object.assign(e, { outputBreakdownVersion: VERSION, responseOutput:r, thinkingOutput:t,
    outputSplitStatus:status, outputSplitSource:text(options.source||'unreported',240), outputSplitNote:text(note,600),
    outputTotalKnown:totalKnown, rawThinkingTokens:thinking, rawResponseTokens:response,
    reasoning:t??0, reasoningKnown:t!==null });
  return e;
}
/** Upgrade only metadata. Zero in an old ledger may mean 'not provided', not zero thinking. */
function ensureSplit(e) {
  if (e.outputBreakdownVersion === VERSION) return e;
  if (e.provider === 'antigravity') {
    const raw=e.rawOutputDetails;
    const hasRaw=raw && (count(raw.field9)!==null || count(raw.field10)!==null);
    return attachSplit(e,{thinking:hasRaw?raw.field9:null,response:hasRaw?raw.field10:null,
      reference:true,source:'antigravity-private-f9-thinking-reference',
      status:e.reasoningKnown===false?'mismatch':undefined,
      note:'기존 비공개 DB 참고 해석: field9=THINKING, field10=비추론. 원본 DB 재분석 권장; 실제 앱 버전과 미대조.',
      totalKnown:e.outputEvidence==='reported-total'||e.outputEvidence==='explicit-breakdown'});
  }
  return attachSplit(e,{thinking:e.reasoningKnown!==false && e.reasoning>0 ? e.reasoning : null,
    reference:true,source:'legacy-record',note:'이전 버전 관측값. 원본 재수집 시 필드 존재 여부를 확인합니다.'});
}
function splitOf(e) {
  const v=e.outputBreakdownVersion===VERSION?e:ensureSplit({...e});
  const t=count(v.thinkingOutput), r=count(v.responseOutput), total=count(e.output)??0;
  const known=v.outputTotalKnown!==false && t!==null && r!==null && t+r===total && ['complete','reference'].includes(v.outputSplitStatus);
  return { version:VERSION, billableOutput:total, totalKnown:v.outputTotalKnown!==false,
    responseOutput:known?r:null, thinkingOutput:known?t:null, unclassifiedOutput:known?0:total,
    status:known?v.outputSplitStatus:(v.outputSplitStatus==='mismatch'?'mismatch':'unavailable'),
    source:v.outputSplitSource||'unreported',note:v.outputSplitNote||'분해 정보 미기록',
    rawThinkingTokens:count(v.rawThinkingTokens),rawResponseTokens:count(v.rawResponseTokens) };
}
function pricedSplit(e) {
  const s=splitOf(e);
  let responsePico=null, thinkingPico=null;
  if(s.responseOutput!==null && s.thinkingOutput!==null) {
    // Use the exact already-priced output component, including context/fast mode.
    const raw=e.price?.outputPico;
    if(s.billableOutput===0) {responsePico='0';thinkingPico='0';}
    else if(raw!=null && BigInt(raw)%BigInt(s.billableOutput)===0n) {
      const perToken=BigInt(raw)/BigInt(s.billableOutput);
      responsePico=String(BigInt(s.responseOutput)*perToken);
      thinkingPico=String(BigInt(s.thinkingOutput)*perToken);
    }
  }
  return {...s,responsePico,thinkingPico,
    responseUsd:responsePico===null?null:Number(responsePico)/1e12,
    thinkingUsd:thinkingPico===null?null:Number(thinkingPico)/1e12,
    billableOutputUsd:e.price?.outputPico==null?null:Number(e.price.outputPico)/1e12,
    additive:false,formula:'BILLABLE OUT = OUT(비추론) + THINKING; TOTAL = IN + BILLABLE OUT. 분해 미확인 출력은 별도 표시.'};
}
function blankSplit(){return {knownResponseOutput:0,knownThinkingOutput:0,unclassifiedOutput:0,
  splitKnownRecords:0,splitUnknownRecords:0,splitReferenceRecords:0,outputTotalUnknownRecords:0,
  responseCostUnknown:0,thinkingCostUnknown:0,responsePico:0n,thinkingPico:0n,reasons:new Map()};}
function addSplit(a,e){
  const s=pricedSplit(e);
  if(s.responseOutput===null){a.splitUnknownRecords++;a.unclassifiedOutput+=s.billableOutput;}
  else {a.splitKnownRecords++;a.knownResponseOutput+=s.responseOutput;a.knownThinkingOutput+=s.thinkingOutput;}
  if(s.status==='reference')a.splitReferenceRecords++;
  if(!s.totalKnown)a.outputTotalUnknownRecords++;
  if(s.responsePico===null)a.responseCostUnknown++;else a.responsePico+=BigInt(s.responsePico);
  if(s.thinkingPico===null)a.thinkingCostUnknown++;else a.thinkingPico+=BigInt(s.thinkingPico);
  if(s.status!=='complete'){
    const key=s.status+'\0'+s.source+'\0'+s.note;
    const item=a.reasons.get(key)||{status:s.status,source:s.source,note:s.note,records:0};item.records++;a.reasons.set(key,item);
  }
}
function finishSplit(a,output){return {
  outputBreakdownVersion:VERSION,billableOutput:output,
  responseOutput:a.splitUnknownRecords?null:a.knownResponseOutput,
  thinkingOutput:a.splitUnknownRecords?null:a.knownThinkingOutput,
  knownResponseOutput:a.knownResponseOutput,knownThinkingOutput:a.knownThinkingOutput,
  unclassifiedOutput:a.unclassifiedOutput,splitKnownRecords:a.splitKnownRecords,splitUnknownRecords:a.splitUnknownRecords,
  splitReferenceRecords:a.splitReferenceRecords,outputTotalUnknownRecords:a.outputTotalUnknownRecords,
  outputSplitStatus:a.splitUnknownRecords?(a.splitKnownRecords?'partial':'unavailable'):a.splitReferenceRecords?'reference':'complete',
  outputSplitReasons:[...a.reasons.values()],
  responseUsd:a.responseCostUnknown?null:Number(a.responsePico)/1e12,thinkingUsd:a.thinkingCostUnknown?null:Number(a.thinkingPico)/1e12,
  knownResponseUsd:Number(a.responsePico)/1e12,knownThinkingUsd:Number(a.thinkingPico)/1e12,
  knownResponsePico:String(a.responsePico),knownThinkingPico:String(a.thinkingPico),
  responseUnpricedRecords:a.responseCostUnknown,thinkingUnpricedRecords:a.thinkingCostUnknown,
  thinkingShare:!a.splitUnknownRecords&&output>0?a.knownThinkingOutput/output:null
};}
module.exports={VERSION,SPLIT_KEYS,attachSplit,ensureSplit,splitOf,pricedSplit,blankSplit,addSplit,finishSplit};
