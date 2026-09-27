'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),Module=require('node:module'),path=require('node:path');
const {fixture}=require('./helpers'),{setup,NEXT_VERSION}=require('./update-fixtures'),{atomicJson}=require('../src/util'),{startServer}=require('../src/server');
test('VS Code auto-install submits only the verified local VSIX to the built-in installer (mock)',async t=>{
  const f=await fixture(t),release=setup();await atomicJson(path.join(f.data,'config.json'),{...f.c.config,appUpdates:{...release.config,autoDownload:true}});
  const server=await startServer({dataDir:f.data,updateTransport:{json:async()=>({data:release.sign()}),bytes:async()=>({bytes:release.bytes})}});
  await server.updates.check({...release.config,autoDownload:true},true);
  const installs=[],errors=[],settings={dataDirectory:f.data,enabled:true,autoInstallUpdates:true};
  const status={show(){},hide(){},dispose(){}};
  const mock={StatusBarAlignment:{Left:1},ConfigurationTarget:{Global:1},ThemeColor:class{},MarkdownString:class{appendText(){}},Uri:{file:x=>x,parse:x=>x},env:{openExternal:async()=>{}},commands:{registerCommand:()=>({dispose(){}}),executeCommand:async(...args)=>installs.push(args)},workspace:{isTrusted:true,getConfiguration:()=>({get:(k,d)=>settings[k]??d}),onDidChangeConfiguration:()=>({dispose(){}})},window:{createStatusBarItem:()=>status,showInformationMessage(){},showWarningMessage:async()=>{},showErrorMessage:e=>errors.push(e)}};
  const original=Module._load;let extension;try{Module._load=function(id,...rest){return id==='vscode'?mock:original.call(this,id,...rest);};extension=require('../src/extension');}finally{Module._load=original;}
  const context={extensionPath:path.resolve(__dirname,'..'),subscriptions:[]};
  try{await extension.activate(context);for(let i=0;i<50&&!installs.length;i++)await new Promise(r=>setTimeout(r,10));assert.equal(errors.length,0);assert.equal(installs.length,1);assert.equal(installs[0][0],'workbench.extensions.installExtension');assert.ok(installs[0][1].endsWith(`token-meter-local-${NEXT_VERSION}.vsix`));}finally{extension.deactivate();for(const d of context.subscriptions)d.dispose();await server.close();}
});
