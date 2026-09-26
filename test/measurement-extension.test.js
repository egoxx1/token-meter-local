'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),Module=require('node:module'),path=require('node:path');
const {fixture}=require('./helpers'),{startServer}=require('../src/server');
test('VS Code measurement commands start, show zero, pin, stop and unpin through actual local API (mock host)',async t=>{
 const f=await fixture(t),server=await startServer({dataDir:f.data}),commands=new Map(),errors=[],warnings=[];
 const settings={dataDirectory:f.data,enabled:true,scope:'all',provider:'all'},status={show(){},hide(){},dispose(){}};
 const mock={StatusBarAlignment:{Left:1},ConfigurationTarget:{Global:1},ThemeColor:class{},MarkdownString:class{constructor(){this.value='';}appendText(x){this.value+=x;}},Uri:{parse:x=>x,file:x=>x},env:{openExternal:async()=>{}},commands:{registerCommand:(key,fn)=>{commands.set(key,fn);return{dispose(){}};},executeCommand:async k=>commands.get(k)?.()},workspace:{isTrusted:true,getConfiguration:()=>({get:(k,d)=>settings[k]??d,update:async(k,v)=>settings[k]=v}),onDidChangeConfiguration:()=>({dispose(){}})},window:{createStatusBarItem:()=>status,showWarningMessage:async(message,...args)=>{warnings.push(message);return args.at(-1);},showErrorMessage:e=>errors.push(e),showInformationMessage(){},showInputBox:async()=> 'IDE 측정 테스트',showQuickPick:async items=>items[0]}};
 const old=Module._load;let ext;try{Module._load=function(id,...rest){return id==='vscode'?mock:old.call(this,id,...rest);};ext=require('../src/extension');}finally{Module._load=old;}
 const context={extensionPath:path.resolve(__dirname,'..'),subscriptions:[]};
 try{
  await ext.activate(context);assert.match(status.text,/사용 기록 없음/);
  await commands.get('tokenMeter.startMeasurement')();assert.equal(errors.length,0);assert.match(status.text,/IDE 측정 테스트.*진행/);assert.match(status.text,/IN 0 tok \/ \$0\.000/);assert.match(status.tooltip.value,/고정 측정/);
  await commands.get('tokenMeter.stopMeasurement')();assert.match(status.text,/종료/);
  await commands.get('tokenMeter.pinMeasurement')();assert.match(status.text,/사용 기록 없음/);
  await commands.get('tokenMeter.resetMeasurement')();assert.match(status.text,/재측정.*진행/);assert.ok(warnings.some(s=>s.includes('전체 도구')));
  await commands.get('tokenMeter.undoReset')();assert.equal(errors.length,0);assert.match(status.text,/사용 기록 없음/);
 }finally{ext.deactivate();for(const d of context.subscriptions)d.dispose();await server.close();}
});
