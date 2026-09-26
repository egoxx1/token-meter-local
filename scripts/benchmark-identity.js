'use strict';
// Bounded single-host test, not a long-running production capacity claim.
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {performance}=require('node:perf_hooks'),{DatabaseSync}=require('node:sqlite');
const {generation,step}=require('../test/antigravity-fixtures');
const {Collector}=require('../src/collector'),{defaults}=require('../src/config'),{atomicJson}=require('../src/util');
const {sum}=require('../src/reliability');
(async()=>{
 const N=20000,base=await fs.mkdtemp(path.join(os.tmpdir(),'tm-bounded-benchmark-')),logs=path.join(base,'synthetic-logs'),data=path.join(base,'data');await fs.mkdir(logs);
 const file=path.join(logs,'large.db'),db=new DatabaseSync(file);db.exec('PRAGMA journal_mode=WAL;CREATE TABLE gen_metadata(idx INTEGER PRIMARY KEY,data BLOB);CREATE TABLE steps(idx INTEGER PRIMARY KEY,metadata BLOB);BEGIN');
 const gen=db.prepare('INSERT INTO gen_metadata VALUES(?,?)'),st=db.prepare('INSERT INTO steps VALUES(?,?)');
 let expectedIn=0,expectedOut=0;
 function insert(i){const o={normal:1000+i,cache:100000,output:500,thinking:200,visible:300,response:'r'+i,message:'m'+i,genId:'shared-group',time:new Date(Date.UTC(2026,8,26)+i*1000).toISOString()};gen.run(i,generation(o));st.run(i,step(o));expectedIn+=o.normal+o.cache;expectedOut+=o.output;}
 for(let i=0;i<N;i++)insert(i);db.exec('COMMIT');
 await atomicJson(path.join(data,'config.json'),{...defaults(),roots:{codex:[],claude:[],antigravity:[logs],gemini:[],generic:[]}});
 const start=performance.now();let c=await new Collector(data).init();await c.scan();const coldMs=performance.now()-start;
 assert.equal(c.events.size,N);assert.equal(sum([...c.events.values()]).input,expectedIn);assert.equal(sum([...c.events.values()]).output,expectedOut);
 const seq=c.journal.sequence,t1=performance.now();await c.scan();const unchangedMs=performance.now()-t1;assert.equal(c.journal.sequence,seq);
 db.exec('BEGIN');for(let i=N;i<N+5;i++)insert(i);db.exec('COMMIT');const t2=performance.now();await c.scan();const walMs=performance.now()-t2;assert.equal(c.events.size,N+5);
 db.close();const t3=performance.now();c=await new Collector(data).init();await c.scan();const restartMs=performance.now()-t3;assert.equal(c.events.size,N+5);assert.equal(sum([...c.events.values()]).input,expectedIn);assert.equal(sum([...c.events.values()]).output,expectedOut);
 const stats=process.resourceUsage();const result={synthetic:true,platform:process.platform,node:process.version,primaryCalls:N,duplicateSteps:N,afterWalCalls:N+5,sourceInput:expectedIn,storedInput:sum([...c.events.values()]).input,sourceOutput:expectedOut,storedOutput:sum([...c.events.values()]).output,coldScanAndSaveMs:Math.round(coldMs),unchangedScanMs:Math.round(unchangedMs),walRescanAndSaveMs:Math.round(walMs),restartAndScanMs:Math.round(restartMs),maxRssKiB:stats.maxRSS,ledgerBytes:(await fs.stat(path.join(data,'ledger.json'))).size,journalBytes:c.journal.bytes,note:'단일 Linux 실행. JSON 저장소·전체 세션 재파싱 한계가 있으며 장기 내구성/실사용 최고 용량 보증 아님.'};
 console.log(JSON.stringify(result,null,2));await fs.rm(base,{recursive:true,force:true});
})().catch(e=>{console.error(e);process.exit(1);});
