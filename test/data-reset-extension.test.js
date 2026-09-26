'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),Module=require('node:module'),path=require('node:path');
const {fixture,claudeRow}=require('./helpers'),{startServer}=require('../src/server');
test('VS Code delete and full reset commands require confirmation and clear pinned state (mock host)',async t=>{
 const f=await fixture(t);await f.write('claude','source.jsonl',[claudeRow()]);const server=await startServer({dataDir:f.data}),commands=new Map(),errors=[];
 let answer,warningAnswer;const calls=[];const settings={dataDirectory:f.data,enabled:true,scope:'all',provider:'all'},status={show(){},hide(){},dispose(){}};
 const mock={StatusBarAlignment:{Left:1},ConfigurationTarget:{Global:1},ThemeColor:class{},MarkdownString:class{constructor(){this.value='';}appendText(s){this.value+=s;}},Uri:{parse:x=>x,file:x=>x},env:{openExternal:async()=>{}},commands:{registerCommand:(k,fn)=>{commands.set(k,fn);return{dispose(){}};},executeCommand:async(k,...args)=>calls.push([k,...args])},workspace:{isTrusted:true,getConfiguration:()=>({get:(k,d)=>settings[k]??d}),onDidChangeConfiguration:()=>({dispose(){}})},window:{createStatusBarItem:()=>status,showWarningMessage:async()=>warningAnswer,showErrorMessage:e=>errors.push(e),showInformationMessage(){},showInputBox:async()=>answer,showQuickPick:async items=>items[0]}};
 const old=Module._load;let ext;try{Module._load=function(id,...rest){return id==='vscode'?mock:old.call(this,id,...rest);};ext=require('../src/extension');}finally{Module._load=old;}
 const context={extensionPath:path.resolve(__dirname,'..'),subscriptions:[]};
 try{
  await ext.activate(context);let m=server.collector.measurements;const r=await m.start({name:'delete'});await m.pin(r.id);
  await commands.get('tokenMeter.deleteMeasurement')();assert.equal(m.state.runs.length,1);
  warningAnswer='삭제';await commands.get('tokenMeter.deleteMeasurement')();assert.equal(m.state.runs.length,0);assert.equal(m.state.pinnedId,null);assert.equal(server.collector.events.size,1);
  await m.start({name:'one'});answer='잘못 입력';await commands.get('tokenMeter.clearMeasurements')();assert.equal(m.state.runs.length,1);
  answer='측정 전체 삭제';await commands.get('tokenMeter.clearMeasurements')();assert.equal(m.state.runs.length,0);assert.equal(server.collector.events.size,1);
  answer=undefined;await commands.get('tokenMeter.resetAllData')();assert.equal(server.collector.events.size,1);
  answer='전체 초기화';await commands.get('tokenMeter.resetAllData')();assert.equal(server.collector.events.size,0);assert.match(status.text,/IN 0 tok/);
  await commands.get('tokenMeter.openUsageLogFolder')();assert.equal(calls.at(-1)[1],server.collector.journal.directory);assert.ok(calls.at(-1)[1].includes('data-epochs'));
  assert.deepEqual(errors,[]);
 }finally{ext.deactivate();for(const d of context.subscriptions)d.dispose();await server.close();}
});
