'use strict';
const {Snapshot}=require('../src/antigravity-proto');
const {generation,step}=require('./antigravity-fixtures');
const {hash}=require('../src/util');
const {priceEvent}=require('../src/pricing');
function options(i,count=559){
  const input=Math.floor(74740000/count)+(i<74740000%count?1:0),output=Math.floor(304000/count)+(i<304000%count?1:0);
  return {normal:input-Math.min(input,120000),cache:Math.min(input,120000),output,thinking:Math.min(200,output),visible:Math.max(0,output-200),response:'response-'+i,message:'message-'+i,
    genId:i<535?'shared-parent-batch':'batch-'+i,time:new Date(Date.UTC(2026,8,26,0)+i*1000).toISOString()};
}
function fixtureRows(count=559){return Array.from({length:count},(_,i)=>generation(options(i,count)));}
function snapshot(id,rows,steps=[]){const s=new Snapshot(id);rows.forEach((b,i)=>s.feed('generation',i,b));steps.forEach((b,i)=>s.feed('step',i,b));return s.finish('synthetic');}
// Reproduce the precise legacy root-field-4 alias error without shipping an
// executable old collector. Actual pre-patch results are in verification/bug-before.json.
function legacy(id,opts){
  const out=[],aliases=new Map();
  for(let i=0;i<opts.length;i++){
    const o=opts[i],r=snapshot(id,[generation(o)]).events[0];r.sourceIndex=i;r.sourcePosition=0;delete r.identityVersion;delete r.sourceRowKeys;delete r.requestIdentityKeys;r.parserVersion=3;
    r.identityKeys=[o.response?id+':response:'+o.response:null,o.message?id+':message:'+o.message:null,o.genId?id+':generation:'+o.genId:null].filter(Boolean);
    r.id='antigravity:'+hash(r.identityKeys[0]||`${id}:generation:${i}:0`);
    const old=r.identityKeys.map(k=>aliases.get(k)).find(Boolean);
    if(old){
      if(r.total>old.total)for(const k of ['input','output','normalInput','cacheRead','cacheWrite','cacheWrite5m','cacheWrite1h','cacheWriteUnknown','reasoning','total'])old[k]=r[k];
      old.identityKeys=[...new Set([...old.identityKeys,...r.identityKeys])];for(const k of old.identityKeys)aliases.set(k,old);
    }else{out.push(r);for(const k of r.identityKeys)aliases.set(k,r);}
  }
  for(const e of out)e.price=priceEvent(e);return out;
}
module.exports={options,fixtureRows,snapshot,legacy,generation,step};
