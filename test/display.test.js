'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {statusLine,costText,summarize}=require('../src/summary');
const {money}=require('../src/util');
const {fixture,claudeRow}=require('./helpers');
const sample=(summary={})=>{
  const s={records:1,input:1200000,normalInput:1200000,cacheRead:0,cacheWrite:0,output:80000,total:1280000,inputUsd:3,outputUsd:1.6,totalUsd:4.6,knownInputUsd:3,knownOutputUsd:1.6,knownTotalUsd:4.6,...summary};
  s.inputBreakdown={inputTokens:s.input,cacheWriteTokens:0,rows:[['normalInput',s.input,s.inputUsd,3],['cacheRead',0,0,0],['cacheWrite5m',0,0,0],['cacheWrite1h',0,0,0],['cacheWriteUnknown',0,0,0]].map(([key,tokens,amount,known])=>({key,tokens,costPico:amount==null?null:String(Math.round(amount*1e12)),knownPico:String(Math.round(known*1e12)),costUsd:amount,knownUsd:known,rates:[]}))};
  return {scope:'today',provider:'all',costLabel:'API 환산',latest:{provider:'codex',model:'test-model',effort:'high'},summary:s};
};
test('Status line pairs disjoint IN, READ, WRITE, OUT and TOTAL counts with their individual costs',()=>{
  const text=statusLine(sample());
  assert.match(text,/IN 1\.20M tok \/ \$3\.000/);
  assert.match(text,/OUT 80\.0K tok \/ \$1\.600/);
  assert.match(text,/TOTAL 1\.28M tok \/ \$4\.600/);
  assert.match(text,/전체 도구.*최근 Codex/);
  assert.match(text,/API 환산/);
});
test('Exact status mode does not round token counts',()=>{
  const text=statusLine(sample(),{tokenDisplay:'exact'});
  assert.match(text,/IN 1,200,000 tok/);assert.match(text,/OUT 80,000 tok/);assert.match(text,/TOTAL 1,280,000 tok/);
});
test('Partly unknown input does not hide the known output or present a confirmed total',()=>{
  const d=sample({inputUsd:null,totalUsd:null});const text=statusLine(d);
  assert.match(text,/IN .*\$3\.000 \(계산분\)/);assert.match(text,/OUT .*\$1\.600/);assert.match(text,/TOTAL .*\$4\.600 \(계산분\)/);
});
test('No observations keep all three placeholders but do not display a zero bill',()=>{
  const text=statusLine(sample({records:0,input:0,output:0,total:0}));
  assert.match(text,/IN — \/ —/);assert.match(text,/OUT — \/ —/);assert.match(text,/TOTAL — \/ —/);assert.match(text,/기록 없음/);assert.ok(!text.includes('$'));
});
test('Explicit zero cost is distinct from an unpriced model',()=>{
  assert.equal(costText({inputUsd:0,knownInputUsd:0},'input'),'$0.000');
  assert.equal(costText({inputUsd:null,knownInputUsd:0},'input'),'계산 불가');
  assert.equal(costText({knownInputUsd:0},'input'),'계산 불가');
});
test('Tiny positive costs remain positive at the ledger precision',()=>{
  for(const amount of [1e-12,5e-10,.0000001,.00001,.00999]){
    const rendered=money(amount);assert.equal(Number(rendered.slice(1)),amount);
  }
  assert.equal(money(undefined),'미정');assert.equal(money(NaN),'미정');
});
test('Recent API records include all six values from the same stored price snapshot',async t=>{
  const f=await fixture(t);await f.write('claude','a.jsonl',[claudeRow()]);await f.c.scan();
  const d=summarize(f.c,{scope:'all'}),e=d.recent[0];
  assert.equal(e.total,e.input+e.output);assert.equal(e.inputUsd,d.summary.inputUsd);assert.equal(e.outputUsd,d.summary.outputUsd);
  assert.ok(Math.abs(e.totalUsd-e.inputUsd-e.outputUsd)<1e-12);
  assert.equal(e.knownInputUsd,e.inputUsd);assert.equal(e.knownOutputUsd,e.outputUsd);
  assert.equal(d.antigravity.supported,true);
});
test('Legacy Gemini identity is not misrepresented as Antigravity support',()=>{
  const d=sample();d.provider='gemini';d.latest.provider='gemini';
  assert.match(statusLine(d),/Gemini CLI \(이전 기록\)/);assert.ok(!statusLine(d).includes('Antigravity'));
});
