'use strict';
const vscode=require('vscode');
const path=require('node:path');
const os=require('node:os');
const {spawn}=require('node:child_process');
const {request,runtime,dashboardUrl}=require('./client');
const {statusLine,costText}=require('./summary');
const {short,money}=require('./util');
const {compareVersions}=require('./updates');
const VERSION=require('../package.json').version;
let timer,status,paused=false,launching=null;
function settings(){return vscode.workspace.getConfiguration('tokenMeter');}
function dir(){const configured=settings().get('dataDirectory','');return configured?path.resolve(configured):process.env.TOKEN_METER_HOME?path.resolve(process.env.TOKEN_METER_HOME):path.join(os.homedir(),'.token-meter');}
async function ensureServer(context){
  let running;try{running=await request(dir());}catch{}
  if(running){
    const comparison=compareVersions(running.version,VERSION);
    if(comparison===0)return;
    if(comparison>0)throw new Error('더 새로운 수집기가 실행 중입니다. 이 확장을 업데이트하세요.');
    await request(dir(),'/api/shutdown',{});
    for(let i=0;i<900;i++){try{await runtime(dir());}catch{break;}await new Promise(r=>setTimeout(r,100));}
  }
  if(launching)return launching;
  launching=(async()=>{
    const child=spawn(process.execPath,[path.join(context.extensionPath,'bin','cli.js'),'serve','--data-dir',dir()],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stdio:'ignore',detached:true,windowsHide:true});
    let failure;child.on('error',e=>{failure=e;});child.unref();
    for(let i=0;i<240;i++){if(failure)throw failure;await new Promise(r=>setTimeout(r,250));try{await request(dir());return;}catch{}}
    throw new Error('수집기 시작 실패. 패키지 폴더에서 node bin/cli.js serve를 실행해 오류를 확인하세요.');
  })().finally(()=>{launching=null;});return launching;
}
async function activate(context){
  status=vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left,90);status.name='Token Meter';status.command='tokenMeter.dashboard';context.subscriptions.push(status);
  let warnedBudget='',installing=false,lastInstalled='';const warnedMeasurements=new Set();
  async function installUpdate(automatic=false){
    if(installing||vscode.workspace.isTrusted===false)return;
    installing=true;
    try{
      const info=await request(dir(),'/api/updates');
      if(automatic&&!info.enabled)return;
      if(!info.available){if(!automatic)vscode.window.showInformationMessage('사용 가능한 새 버전이 없습니다. 먼저 업데이트를 확인하세요.');return;}
      if(automatic&&lastInstalled===info.available)return;
      if(!automatic&&await vscode.window.showWarningMessage(`검증된 Token Meter ${info.available} 업데이트를 설치할까요?`,{modal:true},'설치')!=='설치')return;
      if(!info.staged)await request(dir(),'/api/updates/download',{});
      const verified=await request(dir(),'/api/updates/verified-path',{});
      await vscode.commands.executeCommand('workbench.extensions.installExtension',vscode.Uri.file(verified.path));
      lastInstalled=verified.version;
      vscode.window.showInformationMessage(`Token Meter ${verified.version} 설치 요청 완료. 작업을 저장한 뒤 창을 다시 로드하세요.`);
    }finally{installing=false;}
  }
  async function poll(){
    if(!settings().get('enabled',true)){status.hide();return;}
    status.show();
    if(paused){status.text='TM 수집기 중지';return;}
    try{
      const q=new URLSearchParams({scope:settings().get('scope','today'),provider:settings().get('provider','all'),followPinned:settings().get('followPinnedMeasurement',true)?'1':'0'});
      const d=await request(dir(),'/api/status?'+q);
      status.text=statusLine(d,{tokenDisplay:settings().get('tokenDisplay','compact')}).replace(/\$\(/g,'＄(');
      const tip=new vscode.MarkdownString();tip.isTrusted=false;
      tip.appendText(`모델: 최근 로그 관측값. 선택 직후에는 다음 기록까지 지연될 수 있습니다.
최근 수집: ${d.updatedAt||'대기'}
집계 범위: ${d.scope} · ${d.provider}
초기화 기준: ${d.scopeInfo?.epochStartedAt||'초기화 없음'}
비교용 입력 전체: ${(d.summary.input||0).toLocaleString()} = 일반 + 캐시 읽기 + 쓰기
${statusLine(d,{tokenDisplay:'exact'})}
비용 기준: ${d.costLabel} · 실제 청구액 아님
TOTAL = IN(일반 입력) + CACHE READ + CACHE WRITE + OUT(THINKING 포함)
THINKING은 OUT의 상세 내역이며 따로 더하지 않습니다.
분해 미확인 ${d.summary.splitUnknownRecords||0}건 · 참고 해석 ${d.summary.splitReferenceRecords||0}건 · 분해 미확인 출력 ${(d.summary.unclassifiedOutput||0).toLocaleString()} 토큰
캐시 읽기 ${d.summary.cacheRead===0&&d.summary.inputBreakdown?.cacheReadUnreportedRecords?'미기록':short(d.summary.cacheRead)} · 쓰기 ${d.summary.cacheWrite===0&&d.summary.inputBreakdown?.cacheWriteUnreportedRecords?'미기록':short(d.summary.cacheWrite)}
가격 미확정 기록: ${d.summary.unpricedRecords}개
${d.priceBasis}

클릭: 상세 대시보드
Antigravity: ${d.antigravity?.health?.status||'확인 중'} · SQLite 읽기 전용 · ${d.antigravity?.health?.backend||'런타임 미확인'}`);
      if(d.measurement)tip.appendText(`\n고정 측정: ${d.measurement.name} · ${d.measurement.status} · 시작 ${d.measurement.start}\n초기화/종료/해제: Token Meter: Measurement Actions\n원본 누적량은 삭제하지 않음. 관측 증가분 0은 계정 사용량 0을 뜻하지 않습니다.`);
      for(const w of d.warnings)tip.appendText('\n주의: '+w);
      if(d.updates?.available)tip.appendText(`\n프로그램 업데이트: ${d.updates.available} (${d.updates.staged?'검증 후 다운로드됨':'다운로드 대기'})`);
      const ib=d.summary.inputBreakdown;
      if(ib){tip.appendText('\n입력 합계의 세부 내역 (IN은 일반 입력만):');for(const r of ib.rows){const absent=r.tokens===0&&(r.key.startsWith('cacheWrite')?ib.cacheWriteUnreportedRecords:r.key==='cacheRead'?ib.cacheReadUnreportedRecords:0);tip.appendText(`\n${r.label}: ${absent?'미기록 / 분리 불가':r.tokens.toLocaleString()+' 토큰 / '+(r.costUsd==null?'계산분 '+money(r.knownUsd):money(r.costUsd))}`);}if(ib.cacheWriteUnreportedRecords)tip.appendText(`\n캐시 쓰기 카운터 ${ib.cacheWriteUnreportedRecords}건 미기록 · 참고 환산`);}
      const tariffs=d.summary.apiRates||[];tip.appendText('\nAPI 단가: USD / 100만 토큰 (1M = 1,000,000)');
      for(const r of tariffs.slice(0,8))tip.appendText(r.available?`\n${r.model} / ${r.tier}: Input ${r.rates.input??'미확인'} · Cached ${r.rates.cacheRead??'미확인'} · Write ${r.rates.cacheWrite??'5m '+(r.rates.cacheWrite5m??'미확인')+' / 1h '+(r.rates.cacheWrite1h??'미확인')} · Output/THINK ${r.rates.output??'미확인'}${r.longContextApplied?' (장문)':''}`:`\n${r.model}: 단가 미확인`);
      if(tariffs.length>8)tip.appendText('\n나머지 단가 그룹은 대시보드에서 확인하세요.');
      status.tooltip=tip;
      if(settings().get('autoInstallUpdates',false)&&d.updates?.enabled&&d.updates?.configured&&d.updates?.staged&&d.updates.available!==lastInstalled)installUpdate(true).catch(e=>vscode.window.showErrorMessage(`Token Meter 자동 업데이트: ${e.message}`));
      status.backgroundColor=d.summary.unpricedRecords||d.warnings.length?new vscode.ThemeColor('statusBarItem.warningBackground'):undefined;
      if(d.measurement?.budgetExceeded&&!warnedMeasurements.has(d.measurement.id)){warnedMeasurements.add(d.measurement.id);vscode.window.showWarningMessage(`Token Meter: 측정 「${d.measurement.name}」의 확인된 ${d.costLabel} ${money(d.summary.knownTotalUsd)}이 알림 기준을 넘었습니다. 실제 청구액 아님. 요청을 중단하지 않습니다.`);}
      if(d.budget.exceeded&&warnedBudget!==d.budget.day){warnedBudget=d.budget.day;vscode.window.showWarningMessage(`Token Meter: 오늘 관측한 토큰 비용 ${money(d.budget.knownTodayUsd)}이 설정한 기준을 넘었습니다. 실제 청구액이 아닌 ${d.costLabel}입니다.`);}
    }catch{status.text='TM 오프라인 · 클릭하여 다시 연결';status.tooltip='수집기에 연결하지 못했습니다. 마지막 값은 최신 사용량이 아닙니다.';}
  }
  const register=(name,fn)=>context.subscriptions.push(vscode.commands.registerCommand(name,async()=>{try{await fn();}catch(e){vscode.window.showErrorMessage(`Token Meter: ${e.message}`);}}));
  register('tokenMeter.dashboard',async()=>{paused=false;await ensureServer(context);const r=await runtime(dir());await vscode.env.openExternal(vscode.Uri.parse(dashboardUrl(r)));await poll();});
  register('tokenMeter.scope',async()=>{const options=[['today','오늘'],['month','이번 달'],['all','전체'],['session','최근 세션']].map(([value,label])=>({label,value}));const choice=await vscode.window.showQuickPick(options);if(choice){await settings().update('scope',choice.value,vscode.ConfigurationTarget.Global);await poll();}});
  register('tokenMeter.provider',async()=>{const choice=await vscode.window.showQuickPick(['all','codex','claude','antigravity','gemini','generic']);if(choice){await settings().update('provider',choice,vscode.ConfigurationTarget.Global);await poll();}});
  for(const [cmd,file] of [['tokenMeter.config','config.json'],['tokenMeter.prices','prices.user.json']])register(cmd,async()=>{await ensureServer(context);await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(dir(),file))));});
  register('tokenMeter.stop',async()=>{paused=true;await request(dir(),'/api/shutdown',{});await poll();});
  register('tokenMeter.restart',async()=>{try{await request(dir(),'/api/shutdown',{});}catch{}await new Promise(r=>setTimeout(r,400));paused=false;await ensureServer(context);await poll();});
  register('tokenMeter.openUsageLogFolder',async()=>{await ensureServer(context);const d=await request(dir(),'/api/status?scope=all');await vscode.commands.executeCommand('revealFileInOS',vscode.Uri.file(d.storage?.directory||path.join(dir(),'usage-log')));});
  register('tokenMeter.reanalyseAntigravity',async()=>{await ensureServer(context);await request(dir(),'/api/antigravity/reanalyse',{});await poll();vscode.window.showInformationMessage('Antigravity 재분석 완료. 경로/오류는 Diagnostics에서 확인하세요.');});
  register('tokenMeter.collectionDiagnostics',async()=>{await ensureServer(context);const d=await request(dir(),'/api/reliability/export');await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({content:JSON.stringify(d,null,2),language:'json'}));});
  register('tokenMeter.antigravityDiagnostics',async()=>{await ensureServer(context);const d=await request(dir(),'/api/status?scope=all&provider=antigravity');await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({content:JSON.stringify({version:d.version,antigravity:d.antigravity,warnings:d.warnings},null,2),language:'json'}));});
  register('tokenMeter.refreshPrices',async()=>{await ensureServer(context);const c=await request(dir(),'/api/catalog/refresh',{});vscode.window.showInformationMessage(`가격표 확인: ${c.modelCount}개 공급자·모델 조합. 실패/출처 정보는 대시보드에서 확인하세요.`);await poll();});
  register('tokenMeter.checkUpdates',async()=>{await ensureServer(context);const u=await request(dir(),'/api/updates/check',{});if(u.error)throw new Error(u.error);vscode.window.showInformationMessage(u.available?`Token Meter ${u.available} 사용 가능. Install Verified Update 명령으로 설치하세요.`:'사용 가능한 새 버전이 없습니다.');});
  register('tokenMeter.installUpdate',async()=>{await ensureServer(context);await installUpdate();});
  async function selectTarget(){
    await ensureServer(context);const d=await request(dir(),'/api/status?scope=all');
    const options=[{label:'전체 도구',filter:{}},...['codex','claude','antigravity','generic'].map(provider=>({label:provider+' · 모든 모델',filter:{provider}})),...d.byModel.map(m=>({label:m.model+' · '+(m.effort||'미기록')+' · '+m.role,description:m.provider+' / '+m.modelProvider,filter:{provider:m.provider,modelProvider:m.modelProvider,model:m.model,effort:m.effort||'',role:m.role||''}}))];
    return vscode.window.showQuickPick(options,{placeHolder:'0부터 측정할 도구 또는 모델·강도·역할을 선택하세요.'});
  }
  async function chooseRun(onlyRunning=false){
    await ensureServer(context);const d=await request(dir(),'/api/measurements');
    return vscode.window.showQuickPick(d.runs.filter(r=>!r.archived&&r.status!=='cancelled'&&(!onlyRunning||r.status==='running')).map(r=>({label:r.name,description:r.label+' · '+r.status+' · '+costText(r.summary),id:r.id})),{placeHolder:'측정을 선택하세요.'});
  }
  register('tokenMeter.startMeasurement',async()=>{const t=await selectTarget();if(!t)return;const name=await vscode.window.showInputBox({prompt:'측정 이름',value:t.label,validateInput:s=>s.trim()?null:'이름을 입력하세요.'});if(!name)return;const r=await request(dir(),'/api/measurements/start',{name,filter:t.filter,requestKey:require('node:crypto').randomUUID()});await request(dir(),'/api/measurements/pin',{id:r.id});await poll();});
  register('tokenMeter.resetMeasurement',async()=>{const t=await selectTarget();if(!t)return;if(!Object.keys(t.filter).length&&await vscode.window.showWarningMessage('전체 도구의 새 측정을 시작할까요? 원본 기록은 보존합니다.',{modal:true},'재측정')!=='재측정')return;const r=await request(dir(),'/api/measurements/reset',{filter:t.filter,requestKey:require('node:crypto').randomUUID()});await request(dir(),'/api/measurements/pin',{id:r.id});await poll();});
  register('tokenMeter.stopMeasurement',async()=>{const r=await chooseRun(true);if(r){await request(dir(),'/api/measurements/stop',{id:r.id});await poll();}});
  register('tokenMeter.pinMeasurement',async()=>{await ensureServer(context);const d=await request(dir(),'/api/measurements');const r=await vscode.window.showQuickPick([{label:'고정 해제 · 일반 누적량 보기',id:null},...d.runs.filter(r=>!r.archived&&r.status!=='cancelled').map(r=>({label:r.name,description:r.label+' · '+r.status,id:r.id}))]);if(r){await request(dir(),'/api/measurements/pin',{id:r.id});await poll();}});
  register('tokenMeter.undoReset',async()=>{await ensureServer(context);await request(dir(),'/api/measurements/undo',{});await poll();});
  register('tokenMeter.deleteMeasurement',async()=>{
    await ensureServer(context);const d=await request(dir(),'/api/measurements');
    const r=await vscode.window.showQuickPick(d.runs.map(r=>({label:r.name,description:r.status+(r.pinned?' · 고정 해제됨':''),id:r.id})),{placeHolder:'삭제할 측정을 선택하세요. 누적 사용량은 유지됩니다.'});
    if(!r)return;
    if(await vscode.window.showWarningMessage(`「${r.label}」 측정을 삭제할까요? 진행 중인 측정도 제거됩니다.`,{modal:true,detail:'누적 사용량과 원본 로그는 보존합니다. 삭제 취소는 제공하지 않습니다.'},'삭제')!=='삭제')return;
    await request(dir(),'/api/measurements/delete',{ids:[r.id],confirmation:'삭제'});await poll();
  });
  register('tokenMeter.clearMeasurements',async()=>{
    await ensureServer(context);const d=await request(dir(),'/api/measurements');
    if(!d.runs.length){vscode.window.showInformationMessage('삭제할 측정 기록이 없습니다.');return;}
    const answer=await vscode.window.showInputBox({prompt:`측정 ${d.runs.length}개 전체 삭제. 누적 사용량은 유지됩니다. 「측정 전체 삭제」를 입력하세요.`,validateInput:s=>s==='측정 전체 삭제'?null:'측정 전체 삭제를 정확히 입력하세요.'});
    if(answer!=='측정 전체 삭제')return;
    await request(dir(),'/api/measurements/delete',{all:true,confirmation:answer});await poll();
  });
  register('tokenMeter.resetAllData',async()=>{
    await ensureServer(context);const d=await request(dir(),'/api/data/state');
    const answer=await vscode.window.showInputBox({prompt:`사용 기록 ${d.requestCount}개와 측정 ${d.measurementCount}개를 초기화합니다. 설정·원본 유지, 이전 데이터 백업 보존. 「전체 초기화」를 입력하세요.`,validateInput:s=>s==='전체 초기화'?null:'전체 초기화를 정확히 입력하세요.'});
    if(answer!=='전체 초기화')return;
    const r=await request(dir(),'/api/data/reset',{confirmation:answer,expectedEpochId:d.epochId,requestKey:require('node:crypto').randomUUID()});
    warnedBudget=null;warnedMeasurements.clear();await poll();vscode.window.showInformationMessage(`전체 초기화 완료. 이전 데이터 보관: ${r.previousDirectory}`);
  });
  register('tokenMeter.measurements',async()=>{const r=await vscode.window.showQuickPick([{label:'측정 삭제',command:'tokenMeter.deleteMeasurement'},{label:'측정 기록 전체 삭제',command:'tokenMeter.clearMeasurements'},{label:'누적 사용량까지 전체 초기화',command:'tokenMeter.resetAllData'},{label:'새 이름으로 측정',command:'tokenMeter.startMeasurement'},{label:'도구·모델 0부터 재측정',command:'tokenMeter.resetMeasurement'},{label:'측정 종료·저장',command:'tokenMeter.stopMeasurement'},{label:'상태바 고정·해제',command:'tokenMeter.pinMeasurement'},{label:'마지막 초기화 취소',command:'tokenMeter.undoReset'},{label:'기록·비교 대시보드',command:'tokenMeter.dashboard'}]);if(r)await vscode.commands.executeCommand(r.command);});
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(async e=>{if(e.affectsConfiguration('tokenMeter')){if(settings().get('enabled',true)&&!paused)try{await ensureServer(context);}catch{}await poll();}}));
  if(settings().get('enabled',true)){status.text='TM 기록 수집 중';status.show();try{await ensureServer(context);}catch(e){vscode.window.showErrorMessage(`Token Meter: ${e.message}`);}await poll();}
  timer=setInterval(()=>poll().catch(()=>{}),5000);context.subscriptions.push({dispose:()=>clearInterval(timer)});
}
function deactivate(){clearInterval(timer);}
module.exports={activate,deactivate};
