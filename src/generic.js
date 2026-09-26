'use strict';
// Explicit usage import, not traffic interception. Only whitelisted metadata leaves this module.
const {text, number, count, hash, iso, project} = require('./util');
const {attachSplit}=require('./output-breakdown');
function normalize(row) {
  if (!row || row.schema !== 'token-meter.usage.v1') throw new Error('schema: token-meter.usage.v1 필요');
  const format=row.format,service=text(row.modelProvider,80),model=text(row.model,200),id=text(row.requestId,180);
  if (!['openai','anthropic','gemini','gemini-interactions','ollama','normalized'].includes(format)||!id||!model||!/^[a-z0-9][a-z0-9._-]{0,79}$/.test(service))throw new Error('format/modelProvider/model/requestId 오류');
  const timestamp=iso(row.timestamp);if(!timestamp)throw new Error('유효한 요청 timestamp가 필요합니다.');
  const u=row.usage;if(!u||typeof u!=='object'||Array.isArray(u))throw new Error('usage 객체 필요');
  const required=(value,key)=>{if(count(value)===null)throw new Error('유효한 토큰 정수 필요: '+key);return value;};
  // Present-but-invalid optional numbers are rejected, never silently turned into zero.
  const optional=(value,key)=>value==null?0:required(value,key);
  const e={provider:'generic',sessionId:'generic:'+text(row.sessionId||service+':imports',180),id:'generic:'+hash(service+'\0'+id),modelProvider:service,model,effort:text(row.effort,40),role:row.role==='subagent'?'subagent':'main',agentId:text(row.agentId,180),parentSessionId:null,...project(row.project),timestamp,modelEvidence:'usage-import',serviceTier:text(row.serviceTier||'standard',40),modality:row.modality==='text'?'text':'unknown',warnings:[],input:0,output:0,normalInput:0,cacheRead:0,cacheWrite:0,cacheWrite5m:0,cacheWrite1h:0,cacheWriteUnknown:0,reasoning:0,tool:0,total:0};
  if(format==='openai'){
    e.input=required(u.input_tokens??u.prompt_tokens,'input_tokens');e.output=required(u.output_tokens??u.completion_tokens,'output_tokens');
    e.cacheRead=optional(u.input_tokens_details?.cached_tokens??u.prompt_tokens_details?.cached_tokens??u.prompt_cache_hit_tokens,'cached_tokens');
    e.cacheWrite=optional(u.input_tokens_details?.cache_write_tokens??u.prompt_tokens_details?.cache_write_tokens,'cache_write_tokens');e.cacheWriteUnknown=e.cacheWrite;
    e.reasoning=optional(u.output_tokens_details?.reasoning_tokens??u.completion_tokens_details?.reasoning_tokens,'reasoning_tokens');
  }else if(format==='anthropic'){
    e.normalInput=required(u.input_tokens,'input_tokens');e.output=required(u.output_tokens,'output_tokens');e.cacheRead=optional(u.cache_read_input_tokens,'cache_read_input_tokens');
    e.cacheWrite5m=optional(u.cache_creation?.ephemeral_5m_input_tokens,'ephemeral_5m_input_tokens');e.cacheWrite1h=optional(u.cache_creation?.ephemeral_1h_input_tokens,'ephemeral_1h_input_tokens');
    e.cacheWrite=optional(u.cache_creation_input_tokens??e.cacheWrite5m+e.cacheWrite1h,'cache_creation_input_tokens');e.cacheWriteUnknown=e.cacheWrite-e.cacheWrite5m-e.cacheWrite1h;e.input=e.normalInput+e.cacheRead+e.cacheWrite;
    e.reasoning=optional(u.output_tokens_details?.thinking_tokens??u.output_tokens_details?.reasoning_tokens,'thinking_tokens');
  }else if(format==='gemini'){
    e.input=required(u.promptTokenCount,'promptTokenCount');e.output=required(u.candidatesTokenCount,'candidatesTokenCount');e.reasoning=optional(u.thoughtsTokenCount,'thoughtsTokenCount');e.output+=e.reasoning;e.cacheRead=optional(u.cachedContentTokenCount,'cachedContentTokenCount');
    e.tool=optional(u.toolUsePromptTokenCount,'toolUsePromptTokenCount');if(e.tool&&u.totalTokenCount===e.input+e.output+e.tool)e.input+=e.tool;else if(e.tool&&u.totalTokenCount!==e.input+e.output)e.warnings.push('tool-token-accounting-unknown');
  }else if(format==='gemini-interactions'){
    e.input=required(u.total_input_tokens,'total_input_tokens');e.output=required(u.total_output_tokens,'total_output_tokens');
    e.reasoning=required(u.total_thought_tokens,'total_thought_tokens');e.output+=e.reasoning;
    e.cacheRead=optional(u.total_cached_tokens,'total_cached_tokens');
    e.tool=optional(u.total_tool_use_tokens,'total_tool_use_tokens');
    if(e.tool&&u.total_tokens!==e.input+e.output)e.warnings.push('tool-token-accounting-unknown');
  }else if(format==='ollama'){
    if(row.local!==true)throw new Error('Ollama는 local:true를 명시한 로컬 사용량만 지원합니다. 클라우드 요금은 별도 설정하세요.');
    e.input=required(u.prompt_eval_count,'prompt_eval_count');e.output=required(u.eval_count,'eval_count');e.warnings.push('local-compute-cost-excluded');
  }else{
    e.input=required(u.input,'input');e.output=required(u.output,'output');e.cacheRead=optional(u.cacheRead,'cacheRead');e.cacheWrite5m=optional(u.cacheWrite5m,'cacheWrite5m');e.cacheWrite1h=optional(u.cacheWrite1h,'cacheWrite1h');e.cacheWriteUnknown=optional(u.cacheWriteUnknown,'cacheWriteUnknown');e.cacheWrite=e.cacheWrite5m+e.cacheWrite1h+e.cacheWriteUnknown;e.reasoning=optional(u.thinkingOutput??u.reasoning,'thinkingOutput');
    if(u.thinkingOutput!=null&&u.reasoning!=null&&u.thinkingOutput!==u.reasoning)throw new Error('thinkingOutput/reasoning 모순');
  }
  e.normalInput=e.input-e.cacheRead-e.cacheWrite;e.total=e.input+e.output;e.contextInput=e.input;e.contextInputKnown=true;e.inputEvidence='usage-import:'+format;
  if(format==='openai'){e.cacheReadKnown=(u.input_tokens_details?.cached_tokens??u.prompt_tokens_details?.cached_tokens??u.prompt_cache_hit_tokens)!=null;e.cacheWriteKnown=(u.input_tokens_details?.cache_write_tokens??u.prompt_tokens_details?.cache_write_tokens)!=null;}
  else if(format==='anthropic'){e.cacheReadKnown=u.cache_read_input_tokens!=null;e.cacheWriteKnown=u.cache_creation_input_tokens!=null||u.cache_creation!=null;}
  else if(format==='normalized'){e.cacheReadKnown=u.cacheRead!=null;e.cacheWriteKnown=u.cacheWrite5m!=null||u.cacheWrite1h!=null||u.cacheWriteUnknown!=null;}
  const reported=u.total_tokens??u.totalTokenCount??u.total;
  if(reported!=null&&required(reported,'total')!==e.total)e.warnings.push('reported-total-mismatch');
  for(const k of ['input','output','normalInput','cacheRead','cacheWrite','cacheWrite5m','cacheWrite1h','cacheWriteUnknown','reasoning','total'])if(count(e[k])===null)throw new Error('모순되거나 너무 큰 토큰 값: '+k);
  if(e.reasoning>e.output)e.warnings.push('inconsistent-token-breakdown');
  if(format==='ollama')e.local=true;
  let thinking=null,response=null,source='usage-import:'+format,totalKnown=true;
  if(format==='openai')thinking=count(u.output_tokens_details?.reasoning_tokens??u.completion_tokens_details?.reasoning_tokens);
  else if(format==='anthropic')thinking=count(u.output_tokens_details?.thinking_tokens??u.output_tokens_details?.reasoning_tokens);
  else if(format==='gemini'){
    thinking=count(u.thoughtsTokenCount);if(thinking!==null)response=u.candidatesTokenCount;
    totalKnown=thinking!==null||(count(u.totalTokenCount)!==null&&u.totalTokenCount===e.total);
  } else if(format==='gemini-interactions'){thinking=u.total_thought_tokens;response=u.total_output_tokens;}
  else if(format==='normalized')thinking=count(u.thinkingOutput??u.reasoning);
  attachSplit(e,{thinking,response,source,totalKnown});
  return e;
}
function generic(row,state){const e=normalize(row);state.sessionId=e.sessionId.slice(8);state.model=e.model;state.modelProvider=e.modelProvider;state.lastTime=e.timestamp;state.effort=e.effort;state.project=e.project;state.projectId=e.projectId;return[e];}
module.exports={normalize,generic};
