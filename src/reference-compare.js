'use strict';
// Presentation-only CLI comparison. Never changes collection, prices or history.
function parseCounter(value) {
  if(typeof value==='number')value=String(value);
  if(typeof value!=='string'||value.length>60)throw new Error('숫자 또는 K/M/B 축약값을 입력하세요.');
  const m=value.trim().replace(/,/g,'').match(/^(\d+)(?:\.(\d+))?\s*([kmb])?$/i);
  if(!m)throw new Error('예: 1,360,000 또는 1.36M');
  const factor={k:1000,m:1000000,b:1000000000}[(m[3]||'').toLowerCase()]||1;
  const center=Number(m[1]+(m[2]?'.'+m[2]:''))*factor;
  if(!Number.isSafeInteger(Math.round(center))||center<0||(!m[3]&&!Number.isInteger(center)))throw new Error('토큰은 0 이상의 안전한 정수여야 합니다.');
  const tolerance=m[3]?factor*Math.pow(10,-(m[2]?.length||0))/2:0;
  return {center:Math.round(center),tolerance,rounded:!!m[3]};
}
function compareReference(summary,raw) {
  if(!['inclusive','normal'].includes(raw.inputMeaning)||!['inclusive','nonthinking'].includes(raw.outputMeaning))throw new Error('CLI 입력·출력의 포함 관계를 선택하세요.');
  const checks=[];
  for(const [label,value,actual] of [['입력',raw.input,raw.inputMeaning==='inclusive'?summary.input:summary.normalInput],['출력',raw.output,raw.outputMeaning==='inclusive'?summary.output:summary.responseOutput],['THINKING',raw.thinking,summary.thinkingOutput]]) {
    if(value==null||value==='')continue;
    const ref=parseCounter(value),known=actual!=null;
    checks.push({label,actual:known?actual:null,reference:ref.center,tolerance:ref.tolerance,delta:known?actual-ref.center:null,
      status:!known?'unavailable':Math.abs(actual-ref.center)<=ref.tolerance?(ref.rounded?'within-display-rounding':'equal'):'different'});
  }
  return {checks,referenceOnly:!!summary.splitReferenceRecords,note:'같은 세션·기간·입출력 의미를 사용자가 선택한 수동 대조입니다. K/M/B 값은 마지막 표시 자릿수의 반올림 범위 내에서 비교하며, CLI가 절삭한다면 별도 확인이 필요합니다.'};
}
if(typeof module!=='undefined')module.exports={parseCounter,compareReference};
