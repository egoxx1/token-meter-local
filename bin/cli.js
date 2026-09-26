#!/usr/bin/env node
'use strict';
const path=require('node:path');
const os=require('node:os');
const {spawn}=require('node:child_process');
const {parseArgs}=require('node:util');
const {startServer}=require('../src/server');
const {runtime,request,dashboardUrl}=require('../src/client');
const {statusLine}=require('../src/summary');
const {expand}=require('../src/util');
function openBrowser(url){
  const command=process.platform==='darwin'?'open':process.platform==='win32'?'rundll32.exe':'xdg-open';
  const args=process.platform==='win32'?['url.dll,FileProtocolHandler',url]:[url];
  const child=spawn(command,args,{stdio:'ignore',detached:true,windowsHide:true});
  child.on('error',()=>console.error('브라우저를 자동으로 열지 못했습니다. 위 주소를 직접 여세요.'));child.unref();
}
async function main(){
  const {values,positionals}=parseArgs({allowPositionals:true,options:{'data-dir':{type:'string'},file:{type:'string'},session:{type:'string'},dataset:{type:'string'},name:{type:'string'},id:{type:'string'},measurement:{type:'string'},model:{type:'string'},effort:{type:'string'},role:{type:'string'},project:{type:'string'},'model-provider':{type:'string'},port:{type:'string'},open:{type:'boolean'},scope:{type:'string',default:'today'},provider:{type:'string',default:'all'},exact:{type:'boolean',default:false},json:{type:'boolean'},help:{type:'boolean'}}});
  const command=positionals[0]||'serve';
  let dataDir=expand(values['data-dir']||process.env.TOKEN_METER_HOME||path.join(os.homedir(),'.token-meter'));
  if(values.help||command==='help'){
    console.log(`Token Meter Local ${require('../package.json').version} — Node.js 20+\n\nnode bin/cli.js serve --open       로컬 수집기 + 대시보드\nnode bin/cli.js demo --open        실제 기록과 분리된 합성 데모\nnode bin/cli.js dashboard          실행 중인 대시보드 열기\nnode bin/cli.js status             누적 사용량 한 줄\nnode bin/cli.js watch              별도 터미널에서 계속 표시\nnode bin/cli.js stop               실행 중인 수집기 종료\nnode bin/cli.js record --file usage.json  명시적 사용량 등록\nnode bin/cli.js diagnose-antigravity  DB 수집 상태 진단\nnode bin/cli.js history            최근 50건 + 다음 조회 위치 (JSON)\nnode bin/cli.js reanalyse-antigravity 원본 DB 재분석\nnode bin/cli.js doctor             수집 상태·복구 결과\nnode bin/cli.js sessions           세션별 원본/활성 카운터\nnode bin/cli.js verify --session antigravity:<ID>  원본 DB 대조\nnode bin/cli.js diagnostics        공유용 경로 제외 진단 JSON\nnode bin/cli.js catalog            모델/가격표 갱신 상태\nnode bin/cli.js refresh-prices     가격표 수동 갱신 (외부 HTTPS 요청)\nnode bin/cli.js check-update       서명된 프로그램 업데이트 확인\nnode bin/cli.js download-update    검증 후 VSIX 준비 (실행하지 않음)\n\n재측정: measurements / measure-start --name <이름> / measure-reset / measure-stop --id <ID> / measure-pin [--id <ID>] / measure-undo\n재측정 필터: --provider <도구> --model <모델> --model-provider <공급자> --effort <강도> --role <역할> --project <ID> --session <세션ID>\n측정 조회: status --measurement <ID> --exact\n\n옵션: --data-dir <경로> --scope today|month|all|session --provider all|codex|claude|antigravity|gemini|generic --json --exact (토큰 원 단위) --session <ID> --dataset active|source (source는 세션 범위만)\n실제 청구액이 아닌 모델 토큰 환산/추정 비용입니다.`);return;
  }
  if(command==='demo')dataDir=await require('../src/demo').seedDemo();
  if(command==='serve'||command==='demo'){
    const port=values.port===undefined?0:Number(values.port);
    if(!Number.isInteger(port)||port<0||port>65535)throw new Error('port는 0~65535 정수');
    const app=await startServer({dataDir,port,onError:e=>console.error(e.message)});
    console.log(`${command==='demo'?'[합성 데모 — 실제 사용량 아님]\n':''}Token Meter Local\n데이터: ${dataDir}\n대시보드: ${app.url}\n종료: Ctrl+C\n이 주소의 #key는 로컬 접근키입니다. 공유하지 마세요.`);
    if(values.open)openBrowser(app.url);
    let stopping=false;
    const stop=async()=>{if(stopping)return;stopping=true;await app.close();};
    process.on('SIGINT',()=>stop().catch(e=>{console.error(e.message);process.exitCode=1;}));
    process.on('SIGTERM',()=>stop().catch(e=>{console.error(e.message);process.exitCode=1;}));return;
  }
  if(command==='dashboard'){const r=await runtime(dataDir);await request(dataDir);console.log(dashboardUrl(r));openBrowser(dashboardUrl(r));return;}
  if(command==='stop'){await request(dataDir,'/api/shutdown',{});console.log('수집기를 종료했습니다.');return;}
  if(command==='measurements'){console.log(JSON.stringify(await request(dataDir,'/api/measurements'),null,2));return;}
  if(['measure-start','measure-reset'].includes(command)){
    const filter={provider:values.provider};for(const [k,arg] of [['sessionId','session'],['model','model'],['effort','effort'],['role','role'],['projectId','project'],['modelProvider','model-provider']])if(values[arg]!==undefined)filter[k]=values[arg];
    const result=await request(dataDir,'/api/measurements/'+(command==='measure-start'?'start':'reset'),{name:values.name,filter,requestKey:require('node:crypto').randomUUID()});console.log(JSON.stringify(result,null,2));return;
  }
  if(['measure-stop','measure-pin','measure-undo'].includes(command)){
    if(command==='measure-stop'&&!values.id)throw new Error('--id <측정 ID> 필요');
    console.log(JSON.stringify(await request(dataDir,'/api/measurements/'+({'measure-stop':'stop','measure-pin':'pin','measure-undo':'undo'}[command]),{id:values.id||null}),null,2));return;
  }
  if(command==='doctor'||command==='sessions'){
    const r=await request(dataDir,'/api/reliability');console.log(JSON.stringify(command==='sessions'?r.sessions:{version:require('../package.json').version,lastScan:r.lastScan,records:r.records,counterInvariantFailures:r.counterInvariantFailures,legacyAntigravityRecords:r.legacyAntigravityRecords,health:r.health,repairs:r.repairs},null,2));return;
  }
  if(command==='verify'){
    if(!values.session)throw new Error('--session antigravity:<세션ID> 필요. sessions 명령으로 확인하세요.');
    console.log(JSON.stringify(await request(dataDir,'/api/reliability/verify',{sessionId:values.session}),null,2));return;
  }
  if(command==='diagnostics'){console.log(JSON.stringify(await request(dataDir,'/api/reliability/export'),null,2));return;}
  if(command==='history'){console.log(JSON.stringify(await request(dataDir,'/api/history?'+new URLSearchParams({scope:'all',provider:values.provider,...(values.model?{model:values.model}:{})})),null,2));return;}
  if(command==='reanalyse-antigravity'){console.log(JSON.stringify(await request(dataDir,'/api/antigravity/reanalyse',{}),null,2));return;}
  const endpoints={'catalog':'/api/catalog','refresh-prices':'/api/catalog/refresh','check-update':'/api/updates/check','download-update':'/api/updates/download'};
  if(endpoints[command]){console.log(JSON.stringify(await request(dataDir,endpoints[command],command==='catalog'?undefined:{}),null,2));return;}
  if(command==='diagnose-antigravity'){const d=await request(dataDir,'/api/status?scope=all&provider=antigravity');console.log(JSON.stringify({version:d.version,antigravity:d.antigravity,warnings:d.warnings},null,2));return;}
  if(command==='record'){
    if(!values.file)throw new Error('--file <usage.json> 필요');
    const fs=require('node:fs/promises'),file=path.resolve(values.file),stat=await fs.stat(file);
    if(stat.size>16384)throw new Error('usage.json은 16KiB 이하여야 합니다. 응답 본문이 아니라 사용량만 전달하세요.');
    console.log(JSON.stringify(await request(dataDir,'/api/usage',JSON.parse(await fs.readFile(file,'utf8'))),null,2));return;
  }
  const endpoint='/api/status?'+new URLSearchParams({scope:values.measurement?'measurement':values.scope,provider:values.provider,...(values.session?{session:values.session}:{}),...(values.dataset?{dataset:values.dataset}:{}),...(values.measurement?{measurement:values.measurement}:{})});
  if(command==='status'){const d=await request(dataDir,endpoint);console.log(values.json?JSON.stringify(d,null,2):statusLine(d,{tokenDisplay:values.exact?'exact':'compact'}));return;}
  if(command==='watch'){
    let ended=false;
    process.on('SIGINT',()=>{ended=true;});
    while(!ended){try{const d=await request(dataDir,endpoint);if(process.stdout.isTTY)process.stdout.write('\x1b[2J\x1b[H');console.log(statusLine(d,{tokenDisplay:values.exact?'exact':'compact'}));console.log(`최근 수집: ${d.updatedAt||'없음'} | 로그 기반 · 실제 청구액/계정 한도 아님 | 종료 Ctrl+C`);}catch(e){console.error(e.message);}
      if(!ended)await new Promise(r=>setTimeout(r,5000));}return;
  }
  throw new Error(`알 수 없는 명령: ${command}. --help를 확인하세요.`);
}
if(require.main===module)main().catch(e=>{console.error(`Token Meter: ${e.message}`);process.exitCode=1;});
module.exports={main,openBrowser};
