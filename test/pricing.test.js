'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {initial,parse}=require('../src/parsers');
const {priceEvent,validateRules,selectRate}=require('../src/pricing');
const {codexRows,claudeRow,geminiRow}=require('./helpers');
const event=(p,rows)=>rows.flatMap(r=>parse(p,r,state))[0];let state;
function ce(args){state=initial('codex','x');return event('codex',codexRows(args));}
function ae(args){state=initial('claude','x');return event('claude',[claudeRow(args)]);}
function ge(args){state=initial('gemini','x');return event('gemini',[geminiRow(args)]);}
test('Exact integer cost: GPT-6 Luna cache and output buckets',()=>{const p=priceEvent(ce());assert.equal(p.inputPico,'7550000');assert.equal(p.outputPico,'10000000');assert.equal(p.totalPico,'17550000');assert.equal(p.rate.longContext.above,272000);});
test('Exact integer cost: Claude cache TTL prices',()=>{const p=priceEvent(ae());assert.equal(p.inputPico,'251000000');assert.equal(p.outputPico,'200000000');assert.equal(p.totalPico,'451000000');});
test('Unknown model is not shown as free',()=>{const p=priceEvent(ce({model:'not-in-catalog'}));assert.equal(p.rate,null);assert.equal(p.totalPico,null);assert.ok(p.missing.includes('input'));});
test('Unknown Claude cache TTL leaves output priced and total incomplete',()=>{const e=ae();e.cacheWriteUnknown=e.cacheWrite;e.cacheWrite5m=e.cacheWrite1h=0;const p=priceEvent(e);assert.equal(p.inputPico,null);assert.equal(p.outputPico,'200000000');assert.equal(p.totalPico,null);});
test('Reasoning effort is metadata, not a price multiplier',()=>{const e=ce();const low=priceEvent(e).totalPico;e.effort='max';assert.equal(priceEvent(e).totalPico,low);});
test('Fast mode applies only where a rate exists',()=>{const e=ce();e.serviceTier='fast';assert.equal(priceEvent(e).totalPico,'35100000');const c=ae();c.serviceTier='fast';assert.equal(priceEvent(c).totalPico,null);});
test('Only exact models and date-version suffixes match',()=>{assert.ok(selectRate(ce({model:'gpt-6-luna-2026-09-24'})));assert.equal(selectRate(ce({model:'gpt-6-luna-special'})),null);});
test('External provider does not silently inherit a first-party rate',()=>{const e=ce();e.modelProvider='private-gateway';assert.equal(selectRate(e),null);const rules=validateRules({rules:[{provider:'codex',models:['gpt-6-luna'],input:3,output:9,cacheRead:1,cacheWrite:2}]});assert.equal(selectRate(e,rules).input,3);});
test('Custom zero price is permitted but missing price is not zero',()=>{const e=ce({cache:0,write:0});const rules=validateRules({rules:[{provider:'codex',models:[e.model],input:0,output:0}]});assert.equal(priceEvent(e,rules).totalPico,'0');});
test('Custom effective date prevents applying future prices to older records',()=>{const e=ce();const rules=validateRules({rules:[{provider:'codex',models:[e.model],input:999,output:999,effectiveFrom:'2027-01-01'}]});assert.equal(selectRate(e,rules).input,.1);});
test('Final streaming snapshot reevaluates long-context tier against frozen base rule',()=>{const e=ge({model:'gemini-2.5-pro'});const first=priceEvent(e);e.input=250000;e.normalInput=250000;e.cacheRead=0;e.contextInput=250000;e.total=e.input+e.output;const final=priceEvent(e,[],first.rate);assert.equal(final.rate.input,2.5);assert.equal(final.rate.output,15);assert.equal(final.rate.longContextApplied,true);});
test('Stored rate is immutable when a price file changes',()=>{const e=ce(),first=priceEvent(e);const custom=validateRules({rules:[{provider:'codex',models:[e.model],input:999,output:999,cacheRead:999,cacheWrite:999}]});assert.equal(priceEvent(e,custom,first.rate).totalPico,first.totalPico);});
test('Invalid custom rate schemas are rejected',()=>{for(const rules of [null,{rules:[]},{rules:[{provider:'x',models:['x'],input:1,output:2}]},{rules:[{provider:'codex',models:['x'],input:-1,output:2}]}]){if(rules?.rules?.length===0)assert.deepEqual(validateRules(rules),[]);else assert.throws(()=>validateRules(rules));}});
test('Contradictory totals cause incomplete pricing',()=>{const e=ge({total:999});assert.equal(priceEvent(e).totalPico,null);});
