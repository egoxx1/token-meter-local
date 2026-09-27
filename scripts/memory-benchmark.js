'use strict';
// ONLY synthetic data in a fresh temp folder. Never opens real provider roots.
// Run identical workloads on two source trees. Separate processes for cold,
// restart and view phases avoid retaining an old collector during construction.
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {performance}=require('node:perf_hooks');
const arg=process.argv.slice(2),opt=k=>arg[arg.indexOf(k)+1],root=path.resolve(arg.includes('--source')?opt('--source'):path.join(__dirname,'..'));
const phase=arg.includes('--phase')?opt('--phase'):'prepare';const n=Number(arg.includes('--count')?opt('--count'):20000);
const polls=Number(arg.includes('--polls')?opt('--polls'):12);
if(!Number.isInteger(n)||n<1||n>25000||!Number.isInteger(polls)||polls<1||polls>2000)throw new Error('count 1..25000 / polls 1..2000 required');
const load=file=>require(path.join(root,file));
async function main(){
 if(phase==='prepare'){
  const base=await fs.mkdtemp(path.join(os.tmpdir(),'token-meter-memory-synthetic-')),logs=path.join(base,'logs'),data=path.join(base,'data');await fs.mkdir(logs);
  const {DatabaseSync}=require('node:sqlite'),{generation,step}=load('test/antigravity-fixtures');
  const db=new DatabaseSync(path.join(logs,'memory.db'));db.exec('CREATE TABLE gen_metadata(idx INTEGER PRIMARY KEY,data BLOB);CREATE TABLE steps(idx INTEGER PRIMARY KEY,metadata BLOB);BEGIN');
  const g=db.prepare('INSERT INTO gen_metadata VALUES(?,?)'),s=db.prepare('INSERT INTO steps VALUES(?,?)');let input=0,output=0;
  for(let i=0;i<n;i++){const o={normal:1000+i,cache:100000,output:500,thinking:200,visible:300,response:'r'+i,message:'m'+i,genId:'shared-group',time:new Date(Date.UTC(2026,8,26)+i*1000).toISOString()};g.run(i,generation(o));s.run(i,step(o));input+=o.normal+o.cache;output+=o.output;}
  db.exec('COMMIT');db.close();await load('src/util').atomicJson(path.join(data,'config.json'),{...load('src/config').defaults(),roots:{codex:[],claude:[],gemini:[],antigravity:[logs],generic:[]}});
  await fs.writeFile(path.join(base,'synthetic.json'),JSON.stringify({schema:'token-meter.memory-fixture.v1',n,input,output}));console.log(JSON.stringify({base,data,n,input,output}));return;
 }
 const base=path.resolve(opt('--fixture'));assert.ok(path.basename(base).startsWith('token-meter-memory-synthetic-'));
 let expect=JSON.parse(await fs.readFile(path.join(base,'synthetic.json'),'utf8'));assert.equal(expect.schema,'token-meter.memory-fixture.v1');const data=path.join(base,'data');let c,server;
 const started=performance.now();const points=[],mark=name=>points.push({name,ms:Math.round(performance.now()-started),...process.memoryUsage()});
 if(phase==='views'||phase==='export'){
  server=await load('src/server').startServer({dataDir:data});c=server.collector;
 }else{c=await new (load('src/collector').Collector)(data).init();mark('initialized');await c.scan();}
 mark('ready');const check=()=>{assert.equal(c.events.size,expect.n);let input=0,output=0;for(const e of c.events.values()){input+=e.input;output+=e.output;assert.equal(e.total,e.input+e.output);}assert.equal(input,expect.input);assert.equal(output,expect.output);};check();
 const timings=[];let bytes=0;
 if(phase==='steady'){const seq=c.journal.sequence;for(let i=0;i<5;i++){const t=performance.now();await c.scan();timings.push(Math.round(performance.now()-t));mark('idle-'+i);}assert.equal(c.journal.sequence,seq);}
 if(phase==='views'){
  for(let i=0;i<polls;i++){const t=performance.now(),r=await fetch(server.runtime.origin+'/api/status?scope=all&view=statusbar',{headers:{Authorization:'Bearer '+server.runtime.token}});assert.equal(r.status,200);const text=await r.text();bytes+=Buffer.byteLength(text);const d=JSON.parse(text);assert.equal(d.summary.input,expect.input);assert.equal(d.summary.output,expect.output);timings.push(Math.round(performance.now()-t));mark('status-'+i);}
 }
 if(phase==='export'){
  const r=await fetch(server.runtime.origin+'/api/history/export.jsonl',{headers:{Authorization:'Bearer '+server.runtime.token}});assert.equal(r.status,200);let lines=0;for await(const b of r.body){bytes+=b.length;for(const n of b)if(n===10)lines++;}assert.equal(lines,expect.n);mark('exported');
 }
 if(phase==='reset'){
  await new (load('src/measurements').Measurements)(c).init();
  await c.resetAll({confirmation:'전체 초기화',requestKey:require('node:crypto').randomUUID(),expectedEpochId:c.resetBoundary?.id||'legacy'});mark('reset-empty');
  for(let i=0;i<5;i++){await c.scan();assert.equal(c.events.size,0);assert.equal(c.sourceEvents.size,expect.n);}
  await c.ingest({schema:'token-meter.usage.v1',format:'normalized',modelProvider:'openai',model:'gpt-6-sol',requestId:'after-reset-memory',timestamp:new Date().toISOString(),modality:'text',usage:{input:1000,cacheRead:0,cacheWriteUnknown:0,output:100,thinkingOutput:30}});
  mark('reset-new-request');expect={...expect,n:1,input:1000,output:100};
 }
 check();if(server)await server.close();
 console.log(JSON.stringify({sourceVersion:load('package.json').version,phase,synthetic:true,node:process.version,platform:process.platform,calls:expect.n,input:expect.input,output:expect.output,elapsedMs:Math.round(performance.now()-started),maxRssKiB:process.resourceUsage().maxRSS,points,timings,responseBytes:bytes,journalRecords:c.journal.records,health:c.health.antigravity,metadataPool:c.metadataPool?.stats?.(),sourceCalls:c.sourceEvents?.size||c.events.size,ledgerBytes:(await fs.stat(path.join(c.storageDir||data,'ledger.json'))).size}));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
