'use strict';
const path = require('node:path');
const {getJson} = require('./network');
const {atomicJson, readJson, text, hash} = require('./util');
const {validateRules, BUILTIN, RATE_KEYS} = require('./pricing');
const EXTRA = require('../data/prices.extra.json').rules;
const SOURCES = {
  'models-dev': {url:'https://models.dev/api.json', hosts:['models.dev'], community:true},
  openrouter: {url:'https://openrouter.ai/api/v1/models', hosts:['openrouter.ai'], community:false}
};
function numeric(value, scale = 1) {
  if (value === undefined || value === null || value === '' || (typeof value !== 'string' && typeof value !== 'number')) return null;
  const n = Number(value) * scale;
  if (!Number.isFinite(n) || n < 0 || n > 100000) throw new Error('음수/범위 밖 단가');
  const rounded = Math.round(n * 1e6) / 1e6;
  if(n > 0 && rounded === 0) throw new Error('단가 정밀도 한계');
  return rounded;
}
function rates(cost, router = false) {
  const keys = router ? {input:'prompt',output:'completion',cacheRead:'input_cache_read',cacheWrite:'input_cache_write',cacheWrite1h:'input_cache_write_1h'} :
    {input:'input',output:'output',cacheRead:'cache_read',cacheWrite:'cache_write',cacheWrite5m:'cache_write_5m',cacheWrite1h:'cache_write_1h'};
  return Object.fromEntries(Object.entries(keys).map(([k,v]) => [k,numeric(cost[v],router?1e6:1)]));
}
function convertCatalog(id, payload, asOf) {
  const out = []; let skipped = 0, seen = 0;
  const emit = r => { seen++; try { out.push(...validateRules({rules:[r]})); } catch { skipped++; } };
  if (id === 'models-dev') {
    if (!payload || Array.isArray(payload) || typeof payload !== 'object') throw new Error('models.dev 스키마 오류');
    for (const [provider, group] of Object.entries(payload)) {
      if (!/^[a-z0-9][a-z0-9._-]{0,79}$/.test(provider) || provider === 'openrouter' || !group?.models || typeof group.models !== 'object') continue;
      for (const [model, m] of Object.entries(group.models)) {
        if (++seen > 30000) throw new Error('모델 목록 크기 제한 초과');
        const outputs = m.modalities?.output;
        if (!Array.isArray(outputs) || outputs.length !== 1 || outputs[0] !== 'text' || !m.cost) {skipped++;continue;}
        try {
          const r = {provider:'*',modelProvider:provider,models:[model],tier:'standard',exactOnly:true,community:true,source:SOURCES[id].url,asOf,...rates(m.cost)};
          if (provider === 'anthropic') { r.cacheWrite5m = r.cacheWrite5m ?? r.cacheWrite; r.cacheWrite = null; }
          // Recognized input-size tiers only. Unknown regional/batch/unit tiers are not guessed.
          if (m.cost.tiers) {
            if (!Array.isArray(m.cost.tiers) || m.cost.tiers.some(t => !t.tier || Object.keys(t.tier).some(k => k !== 'size') || !Number.isSafeInteger(t.tier.size))) throw new Error('지원되지 않는 tiers');
            r.contextTiers = m.cost.tiers.map(t => ({minInput:t.tier.size+1,...rates({...m.cost,...t})})).sort((a,b)=>a.minInput-b.minInput);
          }
          if (m.cost.context_over_200k) r.contextTiers = [{minInput:200001,...rates({...m.cost,...m.cost.context_over_200k})}];
          emit(r);
        } catch {skipped++;}
      }
    }
  } else if (id === 'openrouter') {
    if (!Array.isArray(payload?.data) || payload.data.length > 20000) throw new Error('OpenRouter 스키마/목록 크기 오류');
    // Refuse silently truncated paginated catalogs.
    if (payload.total_count > payload.data.length || payload.links?.next) throw new Error('전체 모델 목록이 아닙니다. 페이지 처리 변경이 필요합니다.');
    for (const m of payload.data) {
      const outputs = m.architecture?.output_modalities;
      if (!Array.isArray(outputs) || outputs.length !== 1 || outputs[0] !== 'text' || !m.pricing) {skipped++;continue;}
      try {
        const r = {provider:'*',modelProvider:'openrouter',models:[m.id],tier:'standard',exactOnly:true,community:false,source:SOURCES[id].url,asOf,...rates(m.pricing,true)};
        if (m.id.startsWith('anthropic/')) {r.cacheWrite5m=r.cacheWrite; r.cacheWrite=null;}
        if (m.pricing.overrides) {
          if (!Array.isArray(m.pricing.overrides) || m.pricing.overrides.some(t => !Number.isSafeInteger(t.min_prompt_tokens) || Object.keys(t).some(k => !['min_prompt_tokens','prompt','completion','input_cache_read','input_cache_write','input_cache_write_1h'].includes(k)))) throw new Error('미지원 가격 override');
          r.contextTiers = m.pricing.overrides.map(t => ({minInput:t.min_prompt_tokens,...rates({...m.pricing,...t},true)})).sort((a,b)=>a.minInput-b.minInput);
        }
        emit(r);
      } catch {skipped++;}
    }
  } else throw new Error('알 수 없는 카탈로그');
  if (!out.length) throw new Error('사용 가능한 텍스트 단가가 없습니다. 직전 가격표를 유지합니다.');
  return {rules:out, skipped};
}
class Catalog {
  constructor(dataDir, download = getJson) {this.file=path.join(dataDir,'catalog.cache.json');this.download=download;this.state={version:1,sources:{}};this.inFlight=null;}
  async init() {
    try {
      const s=await readJson(this.file,null);
      if(s) {if(s.version!==1||!s.sources)throw new Error('캐시 버전 오류');for(const [id,source] of Object.entries(s.sources)){if(!SOURCES[id])continue;source.rules=validateRules({rules:source.rules||[]});this.state.sources[id]=source;}}
    } catch(e){this.loadError=text(e.message);}
    return this;
  }
  rules(settings) {return (settings?.sources||Object.keys(SOURCES)).flatMap(id=>this.state.sources[id]?.rules||[]);}
  status(settings) {
    const sources=Object.keys(SOURCES).map(id=>{const s=this.state.sources[id]||{};return{id,url:SOURCES[id].url,community:SOURCES[id].community,enabled:settings.sources.includes(id),count:s.rules?.length||0,lastAttempt:s.lastAttempt||null,lastSuccess:s.lastSuccess||null,error:s.error||null,skipped:s.skipped||0,stale:!s.lastSuccess||Date.now()-Date.parse(s.lastSuccess)>7*86400000};});
    const rules=[...BUILTIN,...EXTRA,...this.rules(settings)];
    return {enabled:settings.enabled,intervalHours:settings.intervalHours,modelCount:new Set(rules.flatMap(r=>r.models.map(m=>(r.modelProvider||r.provider)+':'+m))).size,sources,loadError:this.loadError||null};
  }
  async refresh(settings, force=false) {
    if(this.inFlight)return this.inFlight;
    this.inFlight=this._refresh(settings,force).finally(()=>{this.inFlight=null;});return this.inFlight;
  }
  async _refresh(settings,force) {
    if(!settings.enabled&&!force)return false;
    let changed=false;
    for(const id of settings.sources){
      const source=SOURCES[id],old=this.state.sources[id]||{rules:[]};
      if(!force&&old.lastAttempt&&Date.now()-Date.parse(old.lastAttempt)<settings.intervalHours*3600000)continue;
      const now=new Date().toISOString();
      try{
        const response=await this.download(source.url,{hosts:source.hosts,maxBytes:24*1024*1024,etag:old.etag});
        if(response.notModified){if(!old.rules.length)throw new Error('캐시 없는 304 응답');this.state.sources[id]={...old,lastAttempt:now,lastSuccess:now,error:null};}
        else{
          const next=convertCatalog(id,response.data,now.slice(0,10));
          // A major deletion is more likely to be an incomplete/schema-changed feed. Keep last good data.
          if(old.rules.length>=20&&next.rules.length<old.rules.length/2)throw new Error('모델 수가 절반 미만으로 감소하여 적용을 보류했습니다.');
          changed=changed||hash(JSON.stringify(old.rules))!==hash(JSON.stringify(next.rules));
          this.state.sources[id]={...next,etag:response.etag||null,lastAttempt:now,lastSuccess:now,error:null};
        }
      }catch(e){this.state.sources[id]={...old,lastAttempt:now,error:text(e.message,250)};}
    }
    await atomicJson(this.file,this.state);return changed;
  }
}
module.exports={Catalog,convertCatalog,SOURCES,numeric};
