'use strict';
const path=require('node:path');
const {readJson}=require('./util');
async function runtime(dir){const r=await readJson(path.join(dir,'runtime.json'),null);if(!r||!/^http:\/\/127\.0\.0\.1:\d+$/.test(r.origin)||!/^\w{64}$/.test(r.token))throw new Error('실행 중인 수집기 정보가 없습니다. 먼저 serve를 실행하세요.');return r;}
async function request(dir,endpoint='/api/status',body){
  const r=await runtime(dir),res=await fetch(r.origin+endpoint,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${r.token}`,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(endpoint.startsWith('/api/reliability/')?180000:endpoint.startsWith('/api/data/')||endpoint.startsWith('/api/antigravity/')||endpoint.startsWith('/api/measurements/')||endpoint.startsWith('/api/scan')||endpoint.startsWith('/api/catalog/refresh')||endpoint.startsWith('/api/updates/')?65000:8000)});
  const data=(res.headers.get('content-type')||'').includes('application/json')?await res.json():await res.text();
  if(!res.ok){const error=new Error(data.error||`HTTP ${res.status}`);error.status=res.status;throw error;}return data;
}
function dashboardUrl(r){return r.origin+'/#key='+r.token;}
async function probe(dir,send=request,readRuntime=runtime){
  try{return await send(dir,'/api/ping');}catch(e){
    // Older collectors have no lightweight endpoint. Probe their legacy API only
    // once during version detection so a VSIX upgrade can stop them normally.
    if(e.status===404){
      let info;try{info=await readRuntime(dir);}catch{}
      if(info&&/^\d+\.\d+\.\d+$/.test(info.appVersion||'')){await send(dir,'/api/config');return {version:info.appVersion};}
      return send(dir,'/api/status?scope=all&view=statusbar');
    }
    throw e;
  }
}
module.exports={runtime,request,dashboardUrl,probe};
