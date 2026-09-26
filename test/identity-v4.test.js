'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {fixture,codexRows,totals}=require('./helpers');
const {Collector}=require('../src/collector');
const {Measurements,buckets,deltaEvent}=require('../src/measurements');
const {summarize}=require('../src/summary');
const {snapshot,legacy,options,fixtureRows,generation,step}=require('./identity-v4-fixtures');
const {database,b,v,vi,join}=require('./antigravity-fixtures');
const {atomicJson}=require('../src/util');
const {sum,verifySession,diagnostics}=require('../src/reliability');
const {readDatabase}=require('../src/antigravity-db');
const {parseCounter,compareReference}=require('../src/reference-compare');
const N=559;
async function saveLegacy(f,events,extra={},directory=f.data){await atomicJson(path.join(directory,'ledger.json'),{version:2,events,files:{},tasks:[],...extra});}

test('v4 report regression: 559 generations sharing root-4 group retain 559 calls and 74,740,000 input',()=>{
 const r=snapshot('shared',fixtureRows());assert.equal(r.events.length,N);assert.deepEqual(sum(r.events),{records:N,input:74740000,normalInput:7660000,cacheRead:67080000,cacheWrite:0,output:304000,total:75044000});
 assert.equal(r.stats.largestGroup,535);assert.equal(r.stats.groupIdUsedForDedup,false);assert.equal(r.stats.primaryUsageRecords,N);
 const old=legacy('shared',Array.from({length:N},(_,i)=>options(i)));assert.equal(old.length,25);assert.equal(N-old.length,534);
});
test('v4 matching steps enrich their own generation without double-counting',()=>{
 const r=snapshot('both',fixtureRows(),Array.from({length:N},(_,i)=>step(options(i))));assert.equal(r.events.length,N);assert.equal(r.stats.matchedStepObservations,N);assert.equal(sum(r.events).input,74740000);
});
test('v4 repeated message/response identifiers never collapse distinct generation rows',()=>{
 const r=snapshot('bad-ids',Array.from({length:50},(_,i)=>generation({...options(i),response:'shared-response',message:'shared-message',normal:i+10})),[step({response:'shared-response',message:'shared-message'})]);
 assert.equal(r.events.length,50);assert.equal(r.stats.reusedRequestKeys,2);assert.equal(r.stats.ambiguousIdentitySteps,1);assert.equal(r.partial,true);
});
test('v4 no-response records sharing a group have independent row keys',()=>{
 const r=snapshot('none',[generation({response:null,message:null,genId:'parent'}),generation({response:null,message:null,genId:'parent'})]);assert.equal(r.events.length,2);assert.notEqual(r.events[0].id,r.events[1].id);
});
test('v4 explicit step index links identity-less steps but unrelated steps are not guessed',()=>{
 const row=join(generation({response:null,message:null}),b(2,vi(7))),s=new(require('../src/antigravity-proto').Snapshot)('links');s.feed('step',7,step({response:null,message:null}));s.feed('step',8,step({response:null,message:null}));s.feed('generation',0,row);
 const r=s.finish();assert.equal(r.events.length,1);assert.equal(r.stats.matchedStepObservations,1);assert.equal(r.stats.ambiguousStepRows,1);
});
test('v4 late response metadata does not change canonical generation IDs',()=>{
 const a=snapshot('late',[generation({response:null,message:null})]).events[0],b=snapshot('late',[generation()]).events[0];assert.equal(a.id,b.id);
});
test('v4 iteration order between generations and steps cannot cause group-wide collapse',()=>{
 const {Snapshot}=require('../src/antigravity-proto'),s=new Snapshot('order');for(let i=9;i>=0;i--)s.feed('step',i,step(options(i)));for(let i=0;i<10;i++)s.feed('generation',i,generation(options(i)));
 const r=s.finish();assert.equal(r.events.length,10);assert.equal(r.stats.matchedStepObservations,10);
});
test('v4 new retry sharing root ID is another invocation; matching retry step is not another bill',()=>{
 const opts={...options(0),retries:[{response:'retry',message:'retry-msg',normal:500,cache:0}]};const r=snapshot('retry',[generation(opts)],[step(opts)]);assert.equal(r.events.length,2);assert.equal(r.stats.matchedStepObservations,2);
});
test('v4 bounded packed indices reject truncated varints instead of accepting a partial linkage',()=>{
 const r=snapshot('truncated',[join(generation(),b(2,Buffer.from([128])))]);assert.equal(r.events.length,0);assert.equal(r.stats.invalidRows,1);assert.equal(r.partial,true);
});
test('v4 native/Python parity: actual SQLite 559 calls, no source mutation',async t=>{
 const f=await fixture(t),file=database(f.file('antigravity','shared.db'),fixtureRows(),Array.from({length:N},(_,i)=>step(options(i))));const before=crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
 const a=await readDatabase(file),p=await readDatabase(file,{backend:'python'});assert.deepEqual(a.events,p.events);assert.equal(a.events.length,N);assert.equal(crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex'),before);
});
test('v4 upgrades 25 corrupt records to 559, retires old revisions, survives rescans/restart/ledger replay',async t=>{
 const f=await fixture(t);database(f.file('antigravity','shared.db'),fixtureRows());const old=legacy('shared',Array.from({length:N},(_,i)=>options(i)));await saveLegacy(f,old);
 let c=await new Collector(f.data).init();await c.scan();assert.equal(c.events.size,N);assert.equal(sum([...c.events.values()]).input,74740000);assert.equal(c.journal.status().uniqueRequests,N);assert.equal(c.journal.status().retiredRequests,25);
 assert.equal((await fs.stat(path.join(f.data,'ledger.pre-0.10.0.json'))).isFile(),true);const seq=c.journal.sequence;
 await c.scan();assert.equal(c.journal.sequence,seq);c=await new Collector(f.data).init();await c.scan();assert.equal(c.events.size,N);assert.equal(c.journal.sequence,seq);
 await fs.unlink(path.join(f.data,'ledger.json'));c=await new Collector(f.data).init();assert.equal(c.events.size,N);await c.scan();assert.equal(c.events.size,N);
 const exported=JSON.stringify(diagnostics(c));assert.ok(!exported.includes(f.data));assert.ok(!exported.includes('PRIVATE_ANTIGRAVITY'));
});
test('v4 repair never changes independently collected Codex values',async t=>{
 const f=await fixture(t);await f.write('codex','independent.jsonl',codexRows());await f.c.scan();const codex=structuredClone([...f.c.events.values()]);database(f.file('antigravity','shared.db'),fixtureRows());await saveLegacy(f,[...codex,...legacy('shared',Array.from({length:N},(_,i)=>options(i)))]);
 const c=await new Collector(f.data).init();await c.scan();assert.deepEqual([...c.events.values()].filter(e=>e.provider==='codex').map(e=>[e.id,e.input,e.output,e.cacheRead,e.reasoning]),codex.map(e=>[e.id,e.input,e.output,e.cacheRead,e.reasoning]));
});
test('v4 reset repair preserves boundary: pre-reset 200 calls excluded, 359 recovered after reset',async t=>{
 const f=await fixture(t);database(f.file('antigravity','shared.db'),fixtureRows());const final=legacy('shared',Array.from({length:N},(_,i)=>options(i))),prior=legacy('shared',Array.from({length:200},(_,i)=>options(i)));
 const id=crypto.randomUUID(),dir=path.join(f.data,'data-epochs',id),startedAt=options(200).time,base=prior.map(e=>[e.id,buckets(e)]);
 const events=final.map(e=>deltaEvent(e,new Map(base).get(e.id))).filter(Boolean);const boundary={version:1,id,requestKey:crypto.randomUUID(),startedAt,previousDirectory:f.data,baseline:base};
 await saveLegacy(f,events,{resetBoundary:boundary,sourceEvents:final},dir);await atomicJson(path.join(dir,'measurements.json'),{version:1,runs:[],pinnedId:null,undo:null});await atomicJson(path.join(f.data,'active-data.json'),{version:1,id,startedAt});
 let c=await new Collector(f.data).init();await c.scan();assert.equal(c.events.size,359);assert.equal(c.sourceEvents.size,N);assert.equal(c.resetBoundary.startedAt,startedAt);
 const expected=snapshot('shared',fixtureRows()).events.slice(200);assert.equal(sum([...c.events.values()]).input,sum(expected).input);assert.equal(c.repairs.identityV4.sessions['antigravity:shared'].timeReconstructedBaselines,200);
 c=await new Collector(f.data).init();await c.scan();assert.equal(c.events.size,359);assert.equal(c.sourceEvents.size,N);
 assert.equal(summarize(c,{scope:'session',session:'antigravity:shared',provider:'antigravity',dataset:'source'}).summary.records,N);
 assert.equal(summarize(c,{scope:'session',session:'antigravity:shared',provider:'antigravity'}).summary.records,359);
});
test('v4 a uniquely recoverable in-flight epoch baseline transfers, rather than dropping its delta',async t=>{
 const f=await fixture(t);const initial={normal:10000,output:2000,cache:0,time:'2026-09-26T00:00:00Z'},later={...initial,normal:14000,output:2600,thinking:1600,visible:1000};database(f.file('antigravity','single.db'),[generation(later)]);
 const old=legacy('single',[later]),prior=legacy('single',[initial]),id=crypto.randomUUID(),dir=path.join(f.data,'data-epochs',id),startedAt='2026-09-26T00:01:00Z';
 await saveLegacy(f,[],{sourceEvents:old,resetBoundary:{version:1,id,startedAt,baseline:prior.map(e=>[e.id,buckets(e)])}},dir);await atomicJson(path.join(dir,'measurements.json'),{version:1,runs:[],pinnedId:null,undo:null});await atomicJson(path.join(f.data,'active-data.json'),{version:1,id,startedAt});
 const c=await new Collector(f.data).init();await c.scan();assert.equal(sum([...c.events.values()]).input,4000);assert.equal(sum([...c.events.values()]).output,600);assert.equal(c.repairs.identityV4.sessions['antigravity:single'].transferredBaselines,1);
});
test('v4 missing originals retain legacy records with a recovery warning instead of fabricating zeros',async t=>{
 const f=await fixture(t);await saveLegacy(f,legacy('missing',[options(0)]));const c=await new Collector(f.data).init();await c.scan();assert.equal(c.events.size,1);assert.ok(c.warnings.some(w=>w.includes('복구 대기')));
});
test('v4 malformed source refuses destructive session replacement',async t=>{
 const f=await fixture(t);database(f.file('antigravity','broken.db'),[generation(),Buffer.from([10,255])]);const old=legacy('broken',[options(0),options(1)]);await saveLegacy(f,old);const c=await new Collector(f.data).init();await c.scan();assert.deepEqual([...c.events.keys()],old.map(e=>e.id));assert.ok(c.health.antigravity.errorCodes.includes('identity-repair-incomplete-source'));
});
test('v4 old running measurement baseline maps a safe singleton; frozen results stay byte-equivalent',async t=>{
 const f=await fixture(t),before={normal:10000,cache:0,output:2000,time:'2026-09-26T00:00:00Z'},later={...before,normal:12000,output:2500,thinking:1700,visible:800};const old=legacy('m',[before]);await saveLegacy(f,old);const c=await new Collector(f.data).init();const m=await new Measurements(c,{clock:()=> '2026-09-26T00:00:00Z'}).init();
 const run=await m.start({name:'prior',filter:{provider:'antigravity'}});database(f.file('antigravity','m.db'),[generation(later)]);await c.scan();const v=m.view(m.get(run.id));assert.equal(v.summary.input,2000);assert.equal(v.summary.output,500);assert.equal(v.detail.identityBaselineRepaired,true);
 await m.stop(run.id);const frozen=JSON.stringify(m.get(run.id).result);await c.reanalyseAntigravity();assert.equal(JSON.stringify(m.get(run.id).result),frozen);
});
test('v4 independent re-read reports missing events instead of silently declaring a match',async t=>{
 const f=await fixture(t);database(f.file('antigravity','verify.db'),fixtureRows(10));await f.c.scan();let r=await verifySession(f.c,{sessionId:'antigravity:verify'});assert.equal(r.status,'matched-local-snapshot');assert.equal(r.source.records,10);
 f.c.events.delete([...f.c.events.keys()][0]);r=await verifySession(f.c,{sessionId:'antigravity:verify'});assert.equal(r.status,'mismatch');assert.equal(r.missingRecords,1);
 await assert.rejects(()=>verifySession(f.c,{sessionId:'antigravity:../../etc/passwd'}),/DB/);
});
test('v4 source dataset cannot masquerade as an all-provider daily view',async t=>{
 const f=await fixture(t);assert.throws(()=>summarize(f.c,{scope:'today',dataset:'source'}),/세션/);assert.throws(()=>summarize(f.c,{scope:'session',dataset:'invented'}),/범위/);
});
test('v4 Codex report regression: 95 post-reset calls retain all five exact counters',async t=>{
 const f=await fixture(t),time='2026-09-26T00:57:00Z';const rows=codexRows({id:'codex-verified',time,input:53878990,output:225903,cache:52000000,write:0,reason:100000});const file=await f.write('codex','report.jsonl',rows);await f.c.scan();await new Measurements(f.c).init();
 await f.c.resetAll({confirmation:'전체 초기화',requestKey:crypto.randomUUID(),expectedEpochId:'legacy'},{clock:()=> '2026-09-26T00:58:31.191Z'});
 let input=53878990,output=225903,cache=52000000,reason=100000;const after=[];
 for(let i=0;i<95;i++){const inc=n=>Math.floor(n/95)+(i<n%95?1:0),di=inc(10502334),do_=inc(46913),dc=inc(10254592),dr=inc(17584);input+=di;output+=do_;cache+=dc;reason+=dr;
 after.push({timestamp:new Date(Date.UTC(2026,8,26,1)+i*1000).toISOString(),type:'event_msg',payload:{type:'token_count',info:{total_token_usage:totals(input,output,cache,0,reason),last_token_usage:totals(di,do_,dc,0,dr),model_context_window:400000}}});}
 await fs.appendFile(file,after.map(r=>JSON.stringify(r)).join('\n')+'\n');await f.c.scan();const d=summarize(f.c,{scope:'all',provider:'codex'}).summary;
 assert.equal(d.records,95);assert.equal(d.input,10502334);assert.equal(d.cacheRead,10254592);assert.equal(d.normalInput,247742);assert.equal(d.output,46913);assert.equal(d.reasoning,17584);
 const c=await new Collector(f.data).init();await c.scan();assert.deepEqual(summarize(c,{scope:'all',provider:'codex'}).summary,d);
});
test('v4 CLI rounded token displays are compared within their displayed precision, not exact equality',()=>{
 assert.deepEqual(parseCounter('1.36M'),{center:1360000,tolerance:5000,rounded:true});assert.equal(parseCounter('41.2k').tolerance,50);assert.equal(parseCounter('1,000').tolerance,0);
 const r=compareReference({input:1360123,normalInput:3000,output:41220,thinkingOutput:24200},{input:'1.36M',output:'41.2k',thinking:'24.2k',inputMeaning:'inclusive',outputMeaning:'inclusive'});assert.ok(r.checks.every(c=>c.status==='within-display-rounding'));
 for(const v of ['-1','1.5','infinite','<script>','100000000000000000'])assert.throws(()=>parseCounter(v));
});
test('v4 randomized shared batch keys preserve arithmetic conservation',()=>{
 let seed=998812;const rng=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
 for(let pass=0;pass<20;pass++){let inp=0,out=0;const rows=[];for(let i=0;i<80;i++){const n=rng()%50000,c=rng()%100000,o=rng()%10000,t=rng()%(o+1);inp+=n+c;out+=o;rows.push(generation({normal:n,cache:c,output:o,thinking:t,visible:o-t,response:'r'+i,message:'m'+i,genId:'parent'+(rng()%3)}));}const s=snapshot('fuzz'+pass,rows);assert.equal(s.events.length,80);assert.equal(sum(s.events).input,inp);assert.equal(sum(s.events).output,out);}
});

test('v4 post-upgrade full reset still excludes historical repaired calls across restart',async t=>{
 const f=await fixture(t);database(f.file('antigravity','fresh.db'),fixtureRows(20));await f.c.scan();await new Measurements(f.c).init();await f.c.resetAll({confirmation:'전체 초기화',requestKey:crypto.randomUUID(),expectedEpochId:'legacy'},{clock:()=> '2026-09-26T01:00:00Z'});assert.equal(f.c.events.size,0);
 const db=new DatabaseSync(f.file('antigravity','fresh.db'));db.prepare('INSERT INTO gen_metadata VALUES(?,?)').run(20,generation({normal:1000,cache:0,output:100,thinking:50,visible:50,response:'post-reset',message:'post-reset',genId:'shared-parent-batch',time:'2026-09-26T01:01:00Z'}));db.close();await f.c.scan();assert.equal(sum([...f.c.events.values()]).total,1100);
 const c=await new Collector(f.data).init();await c.scan();assert.equal(c.events.size,1);assert.equal(sum([...c.events.values()]).total,1100);
});
test('v4 durable retirement plan survives interrupted journal commit without resurrecting lost merges',async t=>{
 const f=await fixture(t);database(f.file('antigravity','crash.db'),fixtureRows(30));const old=legacy('crash',Array.from({length:30},(_,i)=>options(i,30)));await saveLegacy(f,old);
 const c=await new Collector(f.data).init(),original=c.journal.sync.bind(c.journal);let failed=false;
 c.journal.sync=async(rows,opts)=>{if(!failed&&rows.some(e=>e.retired)){failed=true;await original(rows.filter(e=>e.retired),opts);throw new Error('simulated-after-tombstones');}return original(rows,opts);};
 await assert.rejects(()=>c.scan(),/simulated/);assert.equal(failed,true);
 const next=await new Collector(f.data).init();await next.scan();assert.equal(next.events.size,30);assert.equal(sum([...next.events.values()]).input,74740000);assert.equal(next.repairs.identityV4.sessions['antigravity:crash'].status,'repaired');
});
test('v4 independent Python primary oracle agrees with fresh DB without using JS identities',async t=>{
 const f=await fixture(t),file=database(f.file('antigravity','oracle.db'),fixtureRows());const result=await require('node:util').promisify(require('node:child_process').execFile)('python3',[path.join(__dirname,'../scripts/verify-antigravity.py'),file]);const audit=JSON.parse(result.stdout);
 assert.equal(audit.primary.records,559);assert.equal(audit.primary.input,74740000);assert.equal(audit.primary.output,304000);assert.equal(audit.largestGroup,535);assert.equal(audit.repeatedGroupIds,1);
});
test('v4 session-only measurements do not include another session on the same tool',async t=>{
 const f=await fixture(t);await new Measurements(f.c,{clock:()=> '2026-09-25T00:00:00Z'}).init();const r=await f.c.measurements.start({name:'just one',filter:{provider:'antigravity',sessionId:'antigravity:one'}});
 database(f.file('antigravity','one.db'));database(f.file('antigravity','two.db'));await f.c.scan();const view=f.c.measurements.view(f.c.measurements.get(r.id));assert.equal(view.summary.records,1);assert.equal(view.summary.input,15000);
});
test('v4 duplicated row indexes are diagnosed as malformed rather than silently trusted',()=>{
 const s=new(require('../src/antigravity-proto').Snapshot)('duplicate-idx');s.feed('generation',1,generation(options(0)));s.feed('generation',1,generation(options(1)));const r=s.finish();assert.equal(r.partial,true);assert.equal(r.stats.invalidRows,1);
});
test('v4 HTTP verification and safe diagnostics require auth and do not expose file paths',async t=>{
 const f=await fixture(t);database(f.file('antigravity','api.db'),fixtureRows(10));const app=await require('../src/server').startServer({dataDir:f.data});t.after(()=>app.close());
 for(const endpoint of ['/api/reliability','/api/reliability/export'])assert.equal((await fetch(app.runtime.origin+endpoint)).status,401);
 const headers={Authorization:'Bearer '+app.runtime.token,'Content-Type':'application/json'};
 let r=await fetch(app.runtime.origin+'/api/reliability/verify',{method:'POST',headers,body:JSON.stringify({sessionId:'antigravity:api'})});assert.equal(r.status,200);assert.equal((await r.json()).status,'matched-local-snapshot');
 r=await fetch(app.runtime.origin+'/api/reliability/export',{headers});const text=await r.text();assert.ok(!text.includes(f.dir));assert.ok(!text.includes(app.runtime.token));assert.ok(!text.includes('PRIVATE_ANTIGRAVITY'));
 r=await fetch(app.runtime.origin+'/api/reliability/compare',{method:'POST',headers,body:JSON.stringify({selection:{scope:'all'},reference:{input:'1M'}})});assert.equal(r.status,400);
 r=await fetch(app.runtime.origin+'/api/reliability/verify',{method:'POST',headers:{...headers,Origin:'https://attacker.invalid'},body:'{}'});assert.equal(r.status,403);
});

test('v4 late generation linkage preserves a prior standalone step without false reconciliation failure',async t=>{
 const f=await fixture(t),file=database(f.file('antigravity','late-step.db'),[],[step(options(0))]);await f.c.scan();const oldId=[...f.c.events.keys()][0];
 const db=new DatabaseSync(file);db.prepare('INSERT INTO gen_metadata VALUES(?,?)').run(0,generation(options(0)));db.close();await f.c.scan();assert.equal(f.c.events.size,1);assert.equal([...f.c.events.keys()][0],oldId);
 const r=await verifySession(f.c,{sessionId:'antigravity:late-step'});assert.equal(r.status,'matched-local-snapshot');assert.equal(r.missingRecords,0);assert.equal(r.retainedOnlyRecords,0);
});
test('v4 more than four DB copies are explicitly a limited reconciliation',async t=>{
 const f=await fixture(t);for(let i=0;i<5;i++){const dir=path.join(f.roots.antigravity[0],String(i));await fs.mkdir(dir,{recursive:true});database(path.join(dir,'copies.db'),[generation(options(0))]);}
 await f.c.scan();assert.equal(f.c.events.size,1);const r=await verifySession(f.c,{sessionId:'antigravity:copies'});assert.equal(r.limited,true);assert.equal(r.discoveredFiles,5);assert.equal(r.verifiedFiles,4);assert.equal(r.status,'qualified-snapshot');
});
test('v4 interrupted epoch repair preserves reset boundary and reconstructs only post-reset events',async t=>{
 const f=await fixture(t),opts=Array.from({length:30},(_,i)=>options(i,30));database(f.file('antigravity','epoch-crash.db'),opts.map(generation));const all=legacy('epoch-crash',opts),prior=legacy('epoch-crash',opts.slice(0,10)),id=crypto.randomUUID(),dir=path.join(f.data,'data-epochs',id),startedAt=opts[10].time;
 await saveLegacy(f,all,{sourceEvents:all,resetBoundary:{version:1,id,startedAt,baseline:prior.map(e=>[e.id,buckets(e)])}},dir);await atomicJson(path.join(dir,'measurements.json'),{version:1,runs:[],pinnedId:null,undo:null});await atomicJson(path.join(f.data,'active-data.json'),{version:1,id,startedAt});
 const c=await new Collector(f.data).init(),original=c.journal.sync.bind(c.journal);let failed=false;c.journal.sync=async(rows,opts)=>{if(!failed&&rows.some(e=>e.retired)){failed=true;await original(rows.filter(e=>e.retired),opts);throw new Error('epoch-crash-after-retire');}return original(rows,opts);};
 await assert.rejects(()=>c.scan(),/epoch-crash/);const next=await new Collector(f.data).init();await next.scan();assert.equal(next.events.size,20);assert.equal(next.sourceEvents.size,30);assert.equal(next.resetBoundary.startedAt,startedAt);await next.scan();assert.equal(next.events.size,20);
});

test('v4 frozen legacy Antigravity result is visibly qualified but never overwritten',async t=>{
 const f=await fixture(t),m=await new Measurements(f.c).init();const result={events:legacy('frozen',[options(0)]),detail:{},sourceWarnings:[]};
 const before=JSON.stringify(result),r={id:'frozen',name:'old',status:'ended',kind:'named',start:'2026-09-26T00:00:00Z',end:'2026-09-26T00:10:00Z',filter:{provider:'antigravity'},result};
 const view=m.view(r);assert.equal(view.detail.legacyFrozen,true);assert.ok(view.sourceWarnings.some(w=>w.includes('정확한 토큰 총량')));assert.equal(JSON.stringify(result),before);
});

test('v4 adaptive polling preserves requested minimum and bounds heavy-scan idle delay',()=>{
 const {nextDelay}=require('../src/polling');assert.equal(nextDelay(5000,10),5000);assert.equal(nextDelay(5000,12000),24000);assert.equal(nextDelay(5000,120000),60000);assert.equal(nextDelay(60000,5),60000);assert.equal(nextDelay(undefined,NaN),5000);
});

test('v4 bounded retry candidates refuse a runaway usage list before allocating more events',()=>{
 const {Snapshot}=require('../src/antigravity-proto');const s=new Snapshot('bounded');s.candidates={length:50000,push(){throw new Error('must-not-allocate');}};assert.throws(()=>s.feed('generation',0,generation()),/database-read-limit/);
});
