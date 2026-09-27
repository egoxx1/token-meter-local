'use strict';
// Test-only demo. Always creates a private temporary directory, never user data.
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {defaults}=require('../src/config'),{atomicJson}=require('../src/util');
const {generation,step,database}=require('../test/antigravity-fixtures');
const {options,legacy}=require('../test/identity-v4-fixtures');
const {buckets,deltaEvent}=require('../src/measurements');
const {codexRows}=require('../test/helpers');
const {startServer}=require('../src/server');
(async()=>{
 const data=await fs.mkdtemp(path.join(os.tmpdir(),'token-meter-demo-reliability-'));
 const root=path.join(data,'synthetic-sources');await fs.mkdir(root);
 const start=Date.now()-12*60*1000;
 const opts=Array.from({length:559},(_,i)=>({...options(i),time:new Date(start+i*1000).toISOString()}));
 database(path.join(root,'reliability-session.db'),opts.map(generation),opts.map(step));
 const old=legacy('reliability-session',opts),prior=legacy('reliability-session',opts.slice(0,200)),baseline=prior.map(e=>[e.id,buckets(e)]);
 const id=crypto.randomUUID(),storage=path.join(data,'data-epochs',id),startedAt=opts[200].time;
 await fs.mkdir(storage,{recursive:true});
 const config=defaults();config.roots={codex:[path.join(data,'codex')],claude:[],antigravity:[root],gemini:[],generic:[]};config.pollMs=60000;
 await atomicJson(path.join(data,'config.json'),config);await fs.mkdir(config.roots.codex[0]);
 await fs.writeFile(path.join(config.roots.codex[0],'example.jsonl'),codexRows({id:'codex-other-session',time:new Date().toISOString(),input:10000,output:1000,cache:8000,write:0,reason:300}).map(x=>JSON.stringify(x)).join('\n')+'\n');
 await atomicJson(path.join(storage,'ledger.json'),{version:2,files:{},events:old.map(e=>deltaEvent(e,new Map(baseline).get(e.id))).filter(Boolean),sourceEvents:old,tasks:[],resetBoundary:{version:1,id,startedAt,baseline,previousDirectory:data}});
 await atomicJson(path.join(storage,'measurements.json'),{version:1,runs:[],pinnedId:null,undo:null});
 await atomicJson(path.join(data,'active-data.json'),{version:1,id,startedAt});
 const server=await startServer({dataDir:data,onError:e=>console.error(e.message)});
 console.log(JSON.stringify({dataDir:data,synthetic:true,version:'0.10.2'}));
 process.on('SIGTERM',()=>server.close().then(()=>process.exit(0)));process.on('SIGINT',()=>server.close().then(()=>process.exit(0)));
})().catch(e=>{console.error(e);process.exit(1);});
