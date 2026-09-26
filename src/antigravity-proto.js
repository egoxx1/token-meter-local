'use strict';
// Read-only interpretation of Antigravity's private SQLite protobuf metadata.
// Field references and compatibility limits are documented in docs/ANTIGRAVITY.md.
// Unknown layouts are not text-tokenized or inferred from the context window.
const { text, hash, project } = require('./util');
const {attachSplit,SPLIT_KEYS}=require('./output-breakdown');
const MAX_BLOB = 16 * 1024 * 1024;
const MAX_TOKENS = 1_000_000_000;
function fields(value) {
  const b = Buffer.isBuffer(value) ? value : Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (b.length > MAX_BLOB) throw new Error('protobuf-size-limit');
  let p = 0, seen = 0;
  const out = new Map();
  function v() {
    let n = 0n;
    for (let i = 0; i < 10; i++) {
      if (p >= b.length) throw new Error('truncated-varint');
      const x = b[p++];
      if (i === 9 && x > 1) throw new Error('varint-overflow');
      n |= BigInt(x & 127) << BigInt(7 * i);
      if (!(x & 128)) return n;
    }
    throw new Error('varint-overflow');
  }
  while (p < b.length) {
    if (++seen > 100000) throw new Error('protobuf-field-limit');
    const tag = v(), num = Number(tag >> 3n), wire = Number(tag & 7n);
    if (!num || num > 536870911) throw new Error('protobuf-tag');
    let val;
    if (wire === 0) val = v();
    else if ([1,2,5].includes(wire)) {
      const len = wire === 1 ? 8 : wire === 5 ? 4 : Number(v());
      if (!Number.isSafeInteger(len) || len < 0 || len > b.length - p) throw new Error('truncated-protobuf');
      val = b.subarray(p,p+len); p += len;
    } else throw new Error('unsupported-wire');
    if (!out.has(num)) out.set(num,[]);
    out.get(num).push({wire,value:val});
  }
  return out;
}
function one(f,n,w) {
  const a=f.get(n)||[];
  if (a.length>1) throw new Error('duplicate-singular-field');
  if (!a.length) return undefined;
  if (a[0].wire!==w) throw new Error('wrong-wire');
  return a[0].value;
}
function integer(f,n,fallback=0,max=MAX_TOKENS) {
  const v=one(f,n,0); if(v===undefined) return fallback;
  if(v>BigInt(max))throw new Error('integer-out-of-range');
  return Number(v);
}
function str(f,n,max=200) {
  const b=one(f,n,2); if(!b)return '';
  if(b.length>max*4)throw new Error('metadata-string-limit');
  const raw=b.toString('utf8');
  if(raw.includes('\uFFFD')||/[\u0000-\u001f\u007f]/.test(raw))throw new Error('metadata-string-invalid');
  return text(raw,max);
}
function nested(f,n) {const b=one(f,n,2);return b?fields(b):new Map();}
function timestamp(b) {
  if(!b)return null;
  const f=fields(b),seconds=integer(f,1,0,4102444800),ns=integer(f,2,0,999999999);
  if(seconds<1577836800)return null;
  return new Date(seconds*1000+Math.floor(ns/1e6)).toISOString();
}
const MODEL_MAP_SOURCE='https://github.com/ccusage/ccusage/blob/7e3a180c075192e49053b4ce9de52b3299c6abe2/rust/adapters/antigravity/src/parser.rs';
// Observed, versioned community reverse-engineering, NOT a Google stable enum API.
const MODEL_IDS={
  1318:['gemini-3.8-flash','high'],1319:['gemini-3.8-flash','medium'],1320:['gemini-3.8-flash','low'],
  1298:['gemini-3.7-flash','high'],1299:['gemini-3.7-flash','medium'],1300:['gemini-3.7-flash','low'],
  1071:['gemini-3.6-flash','high'],1072:['gemini-3.6-flash','medium'],1073:['gemini-3.6-flash','low']
};
const unresolved=model=>!model||model==='unknown'||/^antigravity-model-id-|^model_placeholder_/.test(model);
function modelInfo(raw='',numeric=0) {
  let model=text(raw,200).trim(),effort='';if(model==='unknown')model='';
  const match=model.match(/^antigravity-model-id-(\d+)$/)||model.match(/^model_placeholder_m(\d+)$/i);
  if(match){numeric=Number(match[1])+(model.toLowerCase().startsWith('model_placeholder_')?1000:0);model='';}
  const mapped=MODEL_IDS[numeric];
  let resolution={kind: model?'recorded-name':mapped?'reference-map':'unresolved',source:mapped?MODEL_MAP_SOURCE:null,asOf:mapped?'2026-09-25':null};
  if(!model&&mapped){model=mapped[0];effort=mapped[1];}
  const suffix=model.match(/(?:\s*\((high|medium|low|minimal|max|xhigh)\)|-(high|medium|low|minimal|max|xhigh))$/i);
  if(suffix){effort=(suffix[1]||suffix[2]).toLowerCase();model=model.slice(0,suffix.index).trim();}
  // Convert only unambiguous family/version display spellings, never fuzzy-match new names.
  const gem=model.match(/^Gemini\s+(\d+(?:\.\d+)?)\s+(Flash(?:\s+Lite)?|Pro)$/i);
  if(gem)model=`gemini-${gem[1]}-${gem[2].toLowerCase().replace(/\s+/g,'-')}`;
  const claude=model.match(/^(?:Claude\s+)?(Opus|Sonnet|Haiku)\s+(\d+(?:[.-]\d+)?)$/i);
  if(claude)model=`claude-${claude[1].toLowerCase()}-${claude[2].replace(/\./g,'-')}`;
  model=model.replace(/^models\//,'');
  if(!model)model=numeric?`antigravity-model-id-${numeric}`:'unknown';
  const modelProvider=/^gemini-/.test(model)?'google':/^claude-/.test(model)?'anthropic':/^gpt-|^o[1-9](?:-|$)/.test(model)?'openai':'';
  if(mapped&&model===mapped[0]&&!effort)effort=mapped[1];
  if(mapped&&!unresolved(model)&&model!==mapped[0])resolution={...resolution,conflict:true};
  return {model,modelProvider,effort,rawModel:text(raw,200),numericModelId:numeric||null,modelResolution:resolution};
}
function decodeUsage(b) {
  const f=fields(b);
  if(![2,3,4,5,9,10].some(k=>f.has(k)))return null;
  const normalInput=integer(f,2),reportedOutput=integer(f,3),cacheWrite=integer(f,4),cacheRead=integer(f,5);
  const reasoning=integer(f,9),visible=integer(f,10);
  // Within the supported private layout, field 3 is the output total.
  // The 9=thinking / 10=non-thinking split is a REFERENCE interpretation, not an official API contract.
  // Some records omit the total, in which case only the explicit breakdown is used.
  const output=f.has(3)?reportedOutput:reasoning+visible,input=normalInput+cacheRead+cacheWrite;
  const warnings=[];
  const detailMismatch=f.has(3)&&f.has(9)&&f.has(10)&&reportedOutput!==reasoning+visible;
  if(detailMismatch)warnings.push('antigravity-output-detail-mismatch');
  // Field 3 is the independently reported TOTAL output in the supported layout.
  // An inconsistent detail split does not invalidate input pricing, nor justify
  // inflating the total by max()/double adding reasoning. Keep the raw evidence.
  const reasoningKnown=!detailMismatch&&reasoning<=output;
  const identities=[['response',11],['provider',12],['message',7]].map(([kind,n])=>{const id=str(f,n,300);return id?kind+':'+id:null;}).filter(Boolean);
  const result={input,output,normalInput,cacheRead,cacheWrite,cacheWrite5m:0,cacheWrite1h:0,cacheWriteUnknown:cacheWrite,
    cacheReadKnown:f.has(5),cacheWriteKnown:f.has(4),contextInputKnown:true,contextInput:input,inputEvidence:'antigravity-private-counter-presence',
    reasoning:reasoningKnown?reasoning:0,reasoningKnown,reportedOutput:f.has(3)?reportedOutput:null,
    outputEvidence:f.has(3)?'reported-total':'explicit-breakdown',rawOutputDetails:{field9:f.has(9)?reasoning:null,field10:f.has(10)?visible:null},
    tool:0,total:input+output,identities,modelId:integer(f,1,0,10000000),apiProvider:integer(f,6,0,10000),warnings};
  return attachSplit(result,{thinking:f.has(9)?reasoning:null,response:f.has(10)?visible:null,
    reference:true,source:'antigravity-private-f9-thinking-reference',status:detailMismatch?'mismatch':undefined,
    totalKnown:f.has(3)||(f.has(9)&&f.has(10)),
    note:detailMismatch?'DB 출력 합계와 세부값 불일치. 전체 출력은 보존하고 THINKING을 추가하지 않습니다.':
      '비공개 DB 참고 해석(9=THINKING,10=비추론). 공개 구현 간 필드 해석 차이 존재; 실제 앱 버전과 미대조. 합계 일치는 필드 의미를 증명하지 않습니다.'});
}
function retries(f,n) {
  return (f.get(n)||[]).map(v=>{if(v.wire!==2)throw new Error('retry-wire');const inner=nested(fields(v.value),2);return inner.size?decodeUsage(one(fields(v.value),2,2)):null;}).filter(Boolean);
}
function sameObservation(a,b) {
  if(!a||!b)return false;
  const strong=a.identities.filter(id=>id.startsWith('response:')||id.startsWith('provider:'));
  return strong.length>0&&JSON.stringify([...a.identities].sort())===JSON.stringify([...b.identities].sort())&&
    ['input','output','normalInput','cacheRead','cacheWrite','reasoning','modelId'].every(k=>a[k]===b[k]);
}
// root field 2 links a generation to step indices. Only bounded integer wire forms
// are accepted. Field 4 is a GROUP ID and is never an invocation identity.
function packedIndices(f,n) {
  const out=[];
  for(const item of f.get(n)||[]) {
    if(item.wire===0) {
      if(item.value>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('step-index-range');
      out.push(Number(item.value));
    } else if(item.wire===2) {
      let p=0;const bytes=item.value;
      while(p<bytes.length) {
        let value=0n,shift=0n,done=false;
        for(let i=0;i<10;i++){
          if(p>=bytes.length)throw new Error('step-index-truncated');
          const b=bytes[p++];if(i===9&&b>1)throw new Error('step-index-overflow');
          value|=BigInt(b&127)<<shift;
          if(!(b&128)){done=true;break;}shift+=7n;
        }
        if(!done||value>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('step-index-range');
        out.push(Number(value));if(out.length>50000)throw new Error('step-index-limit');
      }
    }else throw new Error('step-index-wire');
  }
  return [...new Set(out)];
}
function decodeGeneration(b) {
  const root=fields(b),chat=nested(root,1);
  if(!chat.size)return null;
  const start=nested(chat,9);let rawModel=str(chat,19),display=str(chat,21),enumAttribute='';
  for(const f of chat.get(20)||[]){if(f.wire!==2)continue;const pair=fields(f.value);if(str(pair,1,80)==='model_enum')enumAttribute=str(pair,2);}
  // Only model metadata is retained; unrelated attribute values are never stored.
  const candidate=rawModel||enumAttribute;
  rawModel=(!candidate||unresolved(modelInfo(candidate).model))&&display?display:candidate||display;
  const usage=one(chat,4,2);
  return {modelInfo:modelInfo(rawModel,integer(chat,3,0,10000000)),usage:usage?decodeUsage(usage):null,retries:retries(chat,17),
    timestamp:timestamp(one(start,4,2)),generationId:str(root,4,300),stepIndices:packedIndices(root,2)};
}
function decodeStep(b) {
  const f=fields(b),mi=nested(f,24),u=one(f,9,2);
  return {modelInfo:modelInfo(str(mi,12)||str(mi,8),integer(mi,1,0,10000000)),usage:u?decodeUsage(u):null,retries:retries(f,28),
    timestamp:timestamp(one(f,8,2)||one(f,1,2))};
}
/**
 * Invocation identity v4. Generation row + retry position is the canonical key.
 * Provider/message identities only join a step to ONE unambiguous generation.
 * All generations are indexed before steps: iteration order cannot turn a
 * repeated message/group key into a destructive many-to-one merge.
 */
class Snapshot {
  constructor(sessionId) {
    this.sessionId=sessionId;this.candidates=[];this.currentModel=modelInfo();this.latest=null;this.resolved=null;
    this.stats={generationRows:0,stepRows:0,usageRows:0,invalidRows:0,ambiguousStepRows:0,unidentifiedRecords:0,unknownTime:0,modelConflicts:0};
    this.groups=new Map();this.mirroredRetryKeys=[];
  }
  get events(){return this.resolve().events;}
  feed(kind,idx,b) {
    if(!['generation','step'].includes(kind)||!Number.isSafeInteger(idx)||idx<0)throw new Error('invalid-row-index');
    this.resolved=null;
    if(kind==='generation')this.stats.generationRows++;else this.stats.stepRows++;
    let row;
    try{row=kind==='generation'?decodeGeneration(b):decodeStep(b);}catch{this.stats.invalidRows++;return;}
    if(!row)return;
    if(kind==='generation'&&row.generationId){const k=hash(row.generationId);this.groups.set(k,(this.groups.get(k)||0)+1);}
    if(kind==='generation'&&row.modelInfo.model!=='unknown')this.currentModel=row.modelInfo;
    const model=kind==='generation'?this.currentModel:row.modelInfo;
    if(model.model!=='unknown'&&(!this.latest||(row.timestamp&&(!this.latest.timestamp||row.timestamp>=this.latest.timestamp))))this.latest={...model,timestamp:row.timestamp};
    for(const [position,u] of [row.usage,...row.retries].entries()) {
      if(!u||!u.total)continue;
      if(kind==='generation'&&position>0&&sameObservation(row.usage,u)){
        this.mirroredRetryKeys.push(`${this.sessionId}:row-v4:${kind}:${idx}:${position}`);
        continue;
      }
      if(this.candidates.length>=50000)throw new Error('database-read-limit');
      this.stats.usageRows++;
      const fallback=`${this.sessionId}:row-v4:${kind}:${idx}:${position}`;
      const ids=u.identities.map(id=>this.sessionId+':'+id);
      if(!ids.length)this.stats.unidentifiedRecords++;
      const timestamp=row.timestamp;
      const warnings=['antigravity-private-schema','antigravity-api-equivalent',...u.warnings];
      if(!timestamp)warnings.push('timestamp-missing');
      if(!ids.length)warnings.push('antigravity-row-id-fallback');
      if(position>0)warnings.push('antigravity-retry-record');
      let ownModel=model;
      if(u.modelId){
        const current=row.modelInfo;
        if(!unresolved(current.model)&&current.modelResolution?.kind==='recorded-name'&&(!current.numericModelId||current.numericModelId===u.modelId))ownModel=modelInfo(current.rawModel||current.model,u.modelId);
        else ownModel=modelInfo('',u.modelId);
      }
      if(ownModel.model!=='unknown'&&(!this.latest||(timestamp&&(!this.latest.timestamp||timestamp>=this.latest.timestamp))))this.latest={...ownModel,timestamp};
      if(ownModel.modelResolution?.conflict)warnings.push('antigravity-model-conflict');
      if(ownModel.modelResolution?.kind==='reference-map')warnings.push('antigravity-model-reference');
      const e={provider:'antigravity',sessionId:'antigravity:'+this.sessionId,role:'unknown',agentId:'',parentSessionId:'',
        ...project('', 'Antigravity · 프로젝트 미기록'),...ownModel,...u,id:'antigravity:'+hash(fallback),identityKeys:[fallback],requestIdentityKeys:ids,
        sourceRowKeys:[fallback],sourcePosition:position,identityVersion:4,accountingVersion:2,
        timestamp,serviceTier:'standard',modality:'text',modelEvidence:`antigravity-sqlite:${kind}:${idx}`,sourceKind:kind,
        sourceIndex:idx,usageSourceKind:kind,usageObservedAt:timestamp,costScope:'api-equivalent',parserVersion:5,warnings};
      delete e.identities;delete e.modelId;
      this.candidates.push({event:e,steps:position===0?(row.stepIndices||[]):[]});
    }
  }
  resolve() {
    if(this.resolved)return this.resolved;
    const stats={...this.stats,uniqueGenerations:0,matchedStepObservations:0,standaloneSteps:0,reusedRequestKeys:0,ambiguousIdentitySteps:0,
      reusedGroupIds:[...this.groups.values()].filter(n=>n>1).length,largestGroup:Math.max(0,...this.groups.values()),groupIdUsedForDedup:false};
    const primary=this.candidates.filter(c=>c.event.sourceKind==='generation').map(c=>c.event);
    stats.primaryUsageRecords=primary.length;
    for(const k of ['input','normalInput','cacheRead','cacheWrite','output','total'])stats['primary'+k[0].toUpperCase()+k.slice(1)]=primary.reduce((n,e)=>n+e[k],0);
    const events=[],bySlot=new Map(),byRequest=new Map(),byStep=new Map();
    const index=(map,key,event)=>{if(!map.has(key))map.set(key,new Set());map.get(key).add(event);};
    const merge=(old,e)=>{
      if(!unresolved(e.model)&&!unresolved(old.model)&&old.model!==e.model){old.warnings.push('antigravity-model-conflict');stats.modelConflicts++;}
      if(unresolved(old.model)&&!unresolved(e.model))for(const k of ['model','modelProvider','effort','rawModel','numericModelId','modelResolution'])old[k]=e[k];
      else if(old.model===e.model&&!old.effort&&e.effort)old.effort=e.effort;
      if(!old.timestamp&&e.timestamp)old.timestamp=e.timestamp;
      const splitConflict=old.output===e.output&&old.reasoningKnown&&e.reasoningKnown&&(old.thinkingOutput!==e.thinkingOutput||old.responseOutput!==e.responseOutput);
      // Keep the more complete observation of the SAME invocation, not the sum.
      if(e.total>old.total||(e.total===old.total&&(e.cacheRead+e.cacheWrite>old.cacheRead+old.cacheWrite||(!old.reasoningKnown&&e.reasoningKnown))))
        for(const k of ['input','output','normalInput','cacheRead','cacheWrite','cacheWriteUnknown','cacheReadKnown','cacheWriteKnown','contextInput','contextInputKnown','inputEvidence','reasoning','total','reportedOutput','outputEvidence','rawOutputDetails','usageSourceKind','usageObservedAt',...SPLIT_KEYS])old[k]=e[k];
      if(splitConflict){attachSplit(old,{status:'mismatch',source:'antigravity-conflicting-split-observations',note:'같은 호출의 출력 세부 관측이 충돌합니다. 전체 출력만 보존합니다.',totalKnown:old.outputTotalKnown});old.warnings.push('antigravity-split-observation-conflict');}
      old.warnings=[...new Set([...old.warnings,...e.warnings])].filter(w=>w!=='timestamp-missing'||!old.timestamp);
      old.requestIdentityKeys=[...new Set([...old.requestIdentityKeys,...e.requestIdentityKeys])];
      // Only canonical row keys may become collector aliases. Group/request keys
      // never leak back into the collector's cross-file identity map.
      for(const k of e.sourceRowKeys)if(!old.sourceRowKeys.includes(k))old.sourceRowKeys.push(k);
      old.identityKeys=[...old.sourceRowKeys];
    };
    for(const c of this.candidates.filter(c=>c.event.sourceKind==='generation')) {
      const e=structuredClone(c.event),old=bySlot.get(e.id);
      if(old){stats.invalidRows++;merge(old,e);continue;}
      events.push(e);bySlot.set(e.id,e);stats.uniqueGenerations++;
      for(const k of e.requestIdentityKeys)index(byRequest,k,e);
      for(const idx of c.steps)index(byStep,idx,e);
    }
    for(const [key,targets]of byRequest)if(targets.size>1){stats.reusedRequestKeys++;for(const e of targets)e.warnings.push('antigravity-reused-request-id');}
    const standalone=new Map();
    for(const c of this.candidates.filter(c=>c.event.sourceKind==='step')){
      const e=structuredClone(c.event);
      const targets=new Set();let ambiguous=false;
      // A generation's explicit step index is stronger than a response ID that
      // another invocation reused. It also links identity-less observations.
      if(e.sourcePosition===0){const refs=byStep.get(e.sourceIndex);if(refs?.size===1)targets.add([...refs][0]);else if(refs?.size>1)ambiguous=true;}
      // Prefer response IDs, then provider IDs, then message IDs. A weak shared
      // message must not override an independently recorded response identity.
      for(const kind of targets.size||ambiguous?[]:['response','provider','message']){
        const keys=e.requestIdentityKeys.filter(k=>k.startsWith(this.sessionId+':'+kind+':'));
        if(!keys.length)continue;
        for(const k of keys){const matches=byRequest.get(k);if(matches?.size>1)ambiguous=true;else if(matches?.size===1)targets.add([...matches][0]);}
        if(targets.size||ambiguous)break;
        // A new strong response may be a retry absent from gen_metadata. Do not
        // merge it just because a weaker message/group ID was reused.
        if(kind==='response'&&keys.length)break;
      }
      if(ambiguous||targets.size>1){stats.ambiguousIdentitySteps++;stats.ambiguousStepRows++;continue;}
      if(targets.size===1){merge([...targets][0],e);stats.matchedStepObservations++;continue;}
      if(!e.requestIdentityKeys.length){stats.ambiguousStepRows++;continue;}
      // Stable standalone step rows: dedup repeated observations within this
      // table using the strongest request ID, without joining any generations.
      const primary=e.requestIdentityKeys[0],old=standalone.get(primary);
      if(old){merge(old,e);stats.matchedStepObservations++;}
      else{events.push(e);standalone.set(primary,e);stats.standaloneSteps++;}
    }
    stats.unknownTime=events.filter(e=>!e.timestamp).length;
    stats.emittedEvents=events.length;
    stats.reconciledUsageRows=events.length+stats.matchedStepObservations+stats.ambiguousStepRows;
    for(const e of events)e.warnings=[...new Set(e.warnings)];
    this.resolved={events,stats};return this.resolved;
  }
  finish(backend) {
    const r=this.resolve();
    return {...r,latest:this.latest,mirroredRetryKeys:this.mirroredRetryKeys,backend,schema:'antigravity-gen-metadata-v4',
      partial:!!(r.stats.invalidRows||r.stats.ambiguousStepRows||r.stats.modelConflicts)};
  }
}
module.exports={fields,one,integer,str,nested,timestamp,modelInfo,decodeUsage,decodeGeneration,decodeStep,packedIndices,Snapshot,MAX_BLOB,MODEL_IDS,MODEL_MAP_SOURCE,unresolved};
