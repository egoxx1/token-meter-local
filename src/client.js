'use strict';
const path=require('node:path');
const {readJson}=require('./util');
async function runtime(dir){const r=await readJson(path.join(dir,'runtime.json'),null);if(!r||!/^http:\/\/127\.0\.0\.1:\d+$/.test(r.origin)||!/^\w{64}$/.test(r.token))throw new Error('실행 중인 수집기 정보가 없습니다. 먼저 serve를 실행하세요.');return r;}
async function request(dir,endpoint='/api/status',body){
  const r=await runtime(dir),res=await fetch(r.origin+endpoint,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${r.token}`,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(endpoint.startsWith('/api/reliability/')?180000:endpoint.startsWith('/api/data/')||endpoint.startsWith('/api/antigravity/')||endpoint.startsWith('/api/measurements/')||endpoint.startsWith('/api/scan')||endpoint.startsWith('/api/catalog/refresh')||endpoint.startsWith('/api/updates/')?65000:8000)});
  const data=(res.headers.get('content-type')||'').includes('application/json')?await res.json():await res.text();
  if(!res.ok)throw new Error(data.error||`HTTP ${res.status}`);return data;
}
function dashboardUrl(r){return r.origin+'/#key='+r.token;}
module.exports={runtime,request,dashboardUrl};
