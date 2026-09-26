'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {fixture,claudeRow,codexRows,totals,TIME}=require('./helpers');
const {Collector}=require('../src/collector'),{Measurements}=require('../src/measurements');
const {summarize}=require('../src/summary');
const {resetAll,durableJson,resolveStorage}=require('../src/data-reset');
const RESET='2026-09-25T14:00:00.000Z',AFTER='2026-09-25T14:00:01.000Z';
const total=c=>summarize(c,{scope:'all'}).summary.total;
const args=c=>({confirmation:'전체 초기화',expectedEpochId:c.resetBoundary?.id||'legacy',requestKey:crypto.randomUUID()});
async function setup(t){const f=await fixture(t);await f.write('claude','one.jsonl',[claudeRow()]);await f.c.scan();await new Measurements(f.c).init();return f;}
async function reset(c,extra={}){return resetAll(c,args(c),{clock:()=>RESET,...extra});}
async function reload(f){const c=await new Collector(f.data).init();await new Measurements(c).init();await c.scan();return c;}
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function usage(id,time=AFTER,input=50,output=20){return{schema:'token-meter.usage.v1',format:'openai',modelProvider:'openai',model:'gpt-6-sol',requestId:id,timestamp:time,modality:'text',usage:{input_tokens:input,output_tokens:output,input_tokens_details:{cached_tokens:10,cache_write_tokens:0},output_tokens_details:{reasoning_tokens:5}}};}

test('Deleting a running pinned measurement removes it, clears pin/undo and preserves raw usage',async t=>{
 const f=await setup(t),m=f.c.measurements,r=await m.start({filter:{provider:'claude'}},true);await m.pin(r.id);const raw=total(f.c),lines=f.c.journal.records;
 const d=await m.remove({ids:[r.id],confirmation:'삭제'});assert.equal(d.deleted,1);assert.equal(d.stopped,1);assert.equal(m.state.pinnedId,null);assert.equal(m.state.undo,null);assert.equal(m.state.runs.length,0);assert.equal(total(f.c),raw);assert.equal(f.c.journal.records,lines);
 await assert.rejects(()=>m.undo());assert.equal((await reload(f)).measurements.state.runs.length,0);
});
test('Delete handles ended, archived and cancelled runs; duplicates are idempotent',async t=>{
 const f=await setup(t),m=f.c.measurements,r=await m.start({name:'ended'});await m.stop(r.id);await m.update(r.id,{archived:true});const d=await m.remove({ids:[r.id,r.id],confirmation:'삭제'});assert.equal(d.deleted,1);assert.equal((await m.remove({ids:[r.id],confirmation:'삭제'})).deleted,0);
 const x=await m.start({filter:{}},true);await m.undo();assert.equal(m.get(x.id).status,'cancelled');assert.equal((await m.remove({ids:[x.id],confirmation:'삭제'})).deleted,1);
});
test('Bulk deletion removes only selected measurements and leaves other active runs',async t=>{
 const f=await setup(t),m=f.c.measurements,a=await m.start({name:'a'}),b=await m.start({name:'b'}),c=await m.start({name:'c'});await m.remove({ids:[a.id,c.id],confirmation:'삭제'});assert.deepEqual(m.state.runs.map(r=>r.id),[b.id]);assert.equal(total(f.c),165);
});
test('Delete-all measurements clears hidden/active records but not usage or task history',async t=>{
 const f=await setup(t),m=f.c.measurements;await m.start({name:'one'});const r=await m.start({name:'two'});await m.stop(r.id);await m.update(r.id,{archived:true});await f.c.startTask('task');
 assert.equal((await m.remove({all:true,confirmation:'측정 전체 삭제'})).deleted,2);assert.equal(f.c.tasks.length,1);assert.equal(total(f.c),165);assert.equal(m.state.runs.length,0);
});
test('Measurement delete requires explicit confirmation; invalid lists never change state',async t=>{
 const f=await setup(t),m=f.c.measurements;await m.start({name:'keep'});const before=JSON.stringify(m.state);
 for(const raw of [{all:true},{ids:[]},{ids:['x'],confirmation:'wrong'},{all:true,confirmation:'삭제'},{ids:[{}],confirmation:'삭제'}])await assert.rejects(()=>m.remove(raw));assert.equal(JSON.stringify(m.state),before);
});
test('Delete write failure rolls back in-memory measurement state',async t=>{
 const f=await setup(t),m=f.c.measurements,r=await m.start({name:'keep'});m.write=async(file,value)=>{if(file===m.file)throw Error('test disk full');return durableJson(file,value);};await assert.rejects(()=>m.remove({ids:[r.id],confirmation:'삭제'}),/disk full/);assert.equal(m.get(r.id).name,'keep');assert.equal((await reload(f)).measurements.state.runs.length,1);
});
test('Full reset clears active usage, logs, tasks and measurements and keeps configuration and originals byte-identical',async t=>{
 const f=await setup(t);await f.c.measurements.start({name:'remove'});await f.c.startTask('remove task');
 const cfg=await fs.readFile(path.join(f.data,'config.json')),source=await fs.readFile(f.file('claude','one.jsonl'));
 const result=await reset(f.c);assert.equal(total(f.c),0);assert.equal(f.c.events.size,0);assert.equal(f.c.tasks.length,0);assert.equal(f.c.measurements.state.runs.length,0);assert.equal(f.c.journal.records,0);
 assert.deepEqual(await fs.readFile(path.join(f.data,'config.json')),cfg);assert.deepEqual(await fs.readFile(f.file('claude','one.jsonl')),source);assert.equal(result.previousDirectory,f.data);
 assert.equal(JSON.parse(await fs.readFile(path.join(f.data,'ledger.json'))).events.length,1);assert.equal(summarize(f.c,{scope:'all'}).summary.measured,true);
});
test('Repeated scans and a restart do not reimport old logs after full reset',async t=>{
 const f=await setup(t);await reset(f.c);await f.c.scan();await f.c.scan();const c=await reload(f);assert.equal(total(c),0);assert.equal(c.journal.records,0);assert.equal(c.storageDir,f.c.storageDir);
});
test('New requests after reset are counted and journaled once',async t=>{
 const f=await setup(t);await reset(f.c);await f.write('claude','two.jsonl',[claudeRow({id:'r2',time:AFTER})]);await f.c.scan();assert.equal(total(f.c),165);assert.equal(f.c.journal.records,1);const c=await reload(f);assert.equal(total(c),165);assert.equal(c.journal.records,1);
});
test('Late old files and timestamp-less new records are excluded, not treated as fresh spend',async t=>{
 const f=await setup(t);await reset(f.c);await f.write('claude','late.jsonl',[claudeRow({id:'late'}),claudeRow({id:'no-time',time:null})]);await f.c.scan();assert.equal(total(f.c),0);assert.ok(f.c.resetDiagnostics.lateOld>=1);assert.ok(f.c.resetDiagnostics.undated>=1);assert.equal(total(await reload(f)),0);
});
test('Streaming request crossing reset contributes only positive new tokens; repeated reset uses raw counters',async t=>{
 const f=await setup(t);await reset(f.c);
 await f.write('claude','one.jsonl',[claudeRow(),claudeRow({input:140,output:35})]);await f.c.scan();assert.equal(total(f.c),55);const e=[...f.c.events.values()][0];assert.equal(e.input,40);assert.equal(e.output,15);assert.equal(e.timestamp,RESET);assert.equal(e.sourceTimestamp,TIME);
 await resetAll(f.c,args(f.c),{clock:()=>AFTER});assert.equal(total(f.c),0);
 await f.write('claude','one.jsonl',[claudeRow({input:150,output:40})]);await f.c.scan();assert.equal(total(f.c),15);assert.equal(total(await reload(f)),15);
});
test('Input cache and THINKING splits remain non-overlapping after reset',async t=>{
 const f=await setup(t);await f.c.ingest(usage('stream',TIME,100,20));await reset(f.c);const v=usage('stream',TIME,150,40);v.usage.input_tokens_details.cached_tokens=30;v.usage.output_tokens_details.reasoning_tokens=15;await f.c.ingest(v);
 const e=[...f.c.events.values()][0];assert.equal(e.input,50);assert.equal(e.normalInput,30);assert.equal(e.cacheRead,20);assert.equal(e.output,20);assert.equal(e.thinkingOutput,10);assert.equal(e.responseOutput,10);assert.equal(e.total,70);
});
test('Repricing or model/counter metadata changes alone after reset create no usage',async t=>{
 const f=await setup(t);await reset(f.c);await f.write('claude','one.jsonl',[claudeRow({model:'claude-opus-4-6'})]);await f.c.scan();assert.equal(total(f.c),0);assert.equal(f.c.journal.records,0);
});
test('Codex cumulative snapshots preserve their checkpoint and count only later deltas',async t=>{
 const f=await setup(t);await f.write('codex','c.jsonl',codexRows());await f.c.scan();await reset(f.c);
 const next={type:'event_msg',timestamp:AFTER,payload:{type:'token_count',info:{total_token_usage:totals(180,40,50,20,15),last_token_usage:totals(80,20,20,10,10)}}};
 await fs.appendFile(f.file('codex','c.jsonl'),JSON.stringify(next)+'\n');await f.c.scan();assert.equal(total(f.c),100);assert.equal(total(await reload(f)),100);
});
test('Copied files and forced source replay cannot resurrect baseline requests',async t=>{
 const f=await setup(t);await reset(f.c);await fs.copyFile(f.file('claude','one.jsonl'),f.file('claude','copy.jsonl'));f.c.files={};await f.c.scan();assert.equal(total(f.c),0);assert.equal(f.c.journal.records,0);
});
test('Antigravity reset and manual reanalysis preserve DB hashes and old IDs; new generation counts once',async t=>{
 const f=await setup(t),{database,generation}=require('./antigravity-fixtures'),{DatabaseSync}=require('node:sqlite');const file=f.file('antigravity','ag.db');database(file);await f.c.scan();const before=sha(await fs.readFile(file));await reset(f.c);await f.c.reanalyseAntigravity();assert.equal(total(f.c),0);assert.equal(sha(await fs.readFile(file)),before);
 const db=new DatabaseSync(file);db.prepare('INSERT INTO gen_metadata VALUES (?,?)').run(1,generation({response:'new-response',message:'new-message',time:AFTER}));db.close();await f.c.scan();assert.equal(total(f.c),17000);await f.c.reanalyseAntigravity();assert.equal(total(f.c),17000);assert.equal(total(await reload(f)),17000);
});
test('Reset key is idempotent and a stale epoch confirmation cannot reset a newer dataset',async t=>{
 const f=await setup(t),a=args(f.c);await resetAll(f.c,a,{clock:()=>RESET});await f.c.ingest(usage('new'));assert.equal(total(f.c),70);
 assert.equal((await resetAll(f.c,a)).reused,true);assert.equal(total(f.c),70);await assert.rejects(()=>resetAll(f.c,{...a,requestKey:crypto.randomUUID()}),/다른 창/);
});
test('Full reset rejects absent confirmation, stale IDs and invalid keys without mutation',async t=>{
 const f=await setup(t);for(const a of [{},{...args(f.c),confirmation:'yes'},{...args(f.c),requestKey:'../x'},{...args(f.c),expectedEpochId:'x'}])await assert.rejects(()=>resetAll(f.c,a));assert.equal(total(f.c),165);await assert.rejects(()=>fs.stat(path.join(f.data,'active-data.json')));
});
test('Preparation failure leaves old pointer/data active and old measurement intact',async t=>{
 const f=await setup(t);await f.c.measurements.start({name:'keep'});await assert.rejects(()=>reset(f.c,{write:async(file,value)=>{if(file.endsWith('measurements.json'))throw Error('injected write failure');return durableJson(file,value);}}),/injected/);assert.equal(total(f.c),165);assert.equal(f.c.measurements.state.runs.length,1);assert.equal(total(await reload(f)),165);
});
test('Pointer commit failure after preparation leaves old active dataset unchanged',async t=>{
 const f=await setup(t);await assert.rejects(()=>reset(f.c,{write:async(file,value)=>{if(file.endsWith('active-data.json'))throw Error('commit failed');return durableJson(file,value);}}),/commit failed/);assert.equal(total(f.c),165);assert.equal(total(await reload(f)),165);
});
test('Corrupt reset pointer or missing active ledger fails closed instead of replaying old history',async t=>{
 const f=await setup(t);await reset(f.c);await fs.rename(path.join(f.c.storageDir,'ledger.json'),path.join(f.c.storageDir,'ledger.keep.json'));await assert.rejects(()=>new Collector(f.data).init());await fs.writeFile(path.join(f.data,'active-data.json'),'{}');await assert.rejects(()=>new Collector(f.data).init(),/손상/);
});
test('Missing committed pointer fails closed and symlink epoch directory is rejected',async t=>{
 const f=await setup(t);await reset(f.c);await fs.unlink(path.join(f.data,'active-data.json'));await assert.rejects(()=>resolveStorage(f.data),/없습니다/);
 const g=await setup(t);await fs.symlink(g.roots.claude[0],path.join(g.data,'data-epochs'),'dir');await assert.rejects(()=>reset(g.c),/일반 파일/);assert.equal(total(g.c),165);
});
test('New measurements after full reset work against post-reset usage rather than historical raw counters',async t=>{
 const f=await setup(t);await reset(f.c);const m=f.c.measurements;const r=await m.start({name:'fresh'});await f.c.ingest(usage('future',new Date(Date.now()+5000).toISOString()));assert.equal(m.view(m.get(r.id)).summary.total,70);await m.stop(r.id);await m.remove({ids:[r.id],confirmation:'삭제'});assert.equal(total(f.c),70);
});
test('Usage log and backups contain only safe metadata, no original prompt sentinel',async t=>{
 const f=await setup(t);await reset(f.c);await f.write('claude','future.jsonl',[claudeRow({id:'new',time:AFTER})]);await f.c.scan();
 for(const file of ['ledger.json','measurements.json'])assert.ok(!(await fs.readFile(path.join(f.c.storageDir,file),'utf8')).includes('PRIVATE_SENTINEL_DO_NOT_STORE'));
 for(const name of await fs.readdir(f.c.journal.directory))assert.ok(!(await fs.readFile(path.join(f.c.journal.directory,name),'utf8')).includes('PRIVATE_SENTINEL_DO_NOT_STORE'));
});
test('History cursor is scoped to the active epoch; old pages are rejected after reset',async t=>{
 const f=await setup(t);await f.write('claude','two.jsonl',[claudeRow({id:'two'})]);await f.c.scan();const {history}=require('../src/history');const cursor=history(f.c,{limit:1}).nextCursor;assert.ok(cursor);await reset(f.c);assert.throws(()=>history(f.c,{limit:1,cursor}),/조회 위치/);
});
test('Deleting a record frees the measurement storage quota instead of merely hiding it',async t=>{
 const f=await setup(t),m=f.c.measurements,r=await m.start({name:'sample'});await m.stop(r.id);const sample=structuredClone(m.state.runs[0]);m.state.runs=Array.from({length:500},(_,i)=>({...structuredClone(sample),id:'record-'+i}));
 await assert.rejects(()=>m.start({name:'full'}),/500/);await m.remove({ids:['record-0'],confirmation:'삭제'});await m.start({name:'space freed'});assert.equal(m.state.runs.length,500);
});
