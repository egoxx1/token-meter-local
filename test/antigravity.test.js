'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {fixture}=require('./helpers');
const {Collector}=require('../src/collector');
const {summarize,statusLine,exportCsv}=require('../src/summary');
const {priceEvent,validateRules}=require('../src/pricing');
const {readDatabase,scanInWorker,signature}=require('../src/antigravity-db');
const {fields,decodeUsage,modelInfo,Snapshot}=require('../src/antigravity-proto');
const {generation,step,database,usage,vi,v,b,join,SENTINEL}=require('./antigravity-fixtures');
const sum=c=>summarize(c,{scope:'all',provider:'antigravity'});
function event(o={}){const s=new Snapshot('demo');s.feed('generation',0,generation(o));return s.events[0];}
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
test('Antigravity native SQLite: IN includes cache once and OUT includes reasoning once',async t=>{
 const f=await fixture(t);database(f.file('antigravity','s1.db'));await f.c.scan();const d=sum(f.c);
 assert.equal(d.summary.records,1);assert.equal(d.summary.input,15000);assert.equal(d.summary.output,2000);assert.equal(d.summary.total,17000);
 assert.equal(d.summary.inputUsd,.007875);assert.equal(d.summary.outputUsd,.0075);assert.equal(d.summary.totalUsd,.015375);
 assert.equal(d.latest.model,'gemini-3.8-flash');assert.equal(d.antigravity.health.backend,'node:sqlite');assert.equal(d.antigravity.health.status,'observed');
 const line=statusLine(d,{tokenDisplay:'exact'});for(const s of ['IN 10,000 tok / $0.0075','CACHE READ 5,000 tok / $0.000375','OUT 2,000 tok / $0.0075','TOTAL 17,000 tok / $0.015375'])assert.ok(line.includes(s),line);
});
test('Antigravity Python fallback and native reader agree on real SQLite bytes',async t=>{
 const f=await fixture(t);const file=database(f.file('antigravity','parity.db'),[generation({retries:[{response:'retry-1',message:'rm1'}]})],[step()]);
 const a=await readDatabase(file),c=await readDatabase(file,{backend:'python'});assert.equal(c.backend,'python-sqlite3');assert.deepEqual(a.events,c.events);assert.equal(a.events.length,2);
});
test('Antigravity source database is not modified and bodies never persist to ledger or CSV',async t=>{
 const f=await fixture(t);const file=database(f.file('antigravity','private.db'),[generation()],[step()]);const before=sha(await fs.readFile(file));
 await f.c.scan();assert.equal(sha(await fs.readFile(file)),before);assert.equal(f.c.events.size,1);
 const ledger=await fs.readFile(path.join(f.data,'ledger.json'),'utf8');assert.ok(!ledger.includes(SENTINEL));assert.ok(!ledger.includes(Buffer.from(SENTINEL).toString('base64')));assert.ok(!exportCsv(f.c,{scope:'all'}).includes(SENTINEL));
 assert.equal(JSON.parse(ledger).files['antigravity:'+file].state.role,'unknown');
});
test('Antigravity repeated scan, restart and copied DB deduplicate the same session',async t=>{
 const f=await fixture(t);const file=database(f.file('antigravity','stable.db'));await f.c.scan();await f.c.scan();assert.equal(f.c.scanStats.upserts,0);
 await fs.mkdir(path.join(f.roots.antigravity[0],'backup'));await fs.copyFile(file,path.join(f.roots.antigravity[0],'backup','stable.db'));
 const c=await new Collector(f.data).init();await c.scan();assert.equal(c.events.size,1);assert.equal(sum(c).summary.total,17000);
});
test('Antigravity WAL-only commits are discovered without a main DB modification',async t=>{
 const f=await fixture(t);const file=database(f.file('antigravity','wal.db'));const db=new DatabaseSync(file);t.after(()=>db.close());db.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;');
 await f.c.scan();const main=sha(await fs.readFile(file));const sig=await signature(file);
 db.prepare('INSERT INTO gen_metadata VALUES(?,?)').run(1,generation({response:'wal-2',message:'wal-msg-2'}));
 assert.equal(sha(await fs.readFile(file)),main);assert.notEqual(await signature(file),sig);await f.c.scan();assert.equal(f.c.events.size,2);
});
test('Antigravity completed generation, matching step and retry are counted by invocation IDs',()=>{
 const s=new Snapshot('dedup');s.feed('generation',0,generation({retries:[{response:'retry',message:'retry-m',normal:500,cache:0}]}));s.feed('step',3,step());
 assert.equal(s.events.length,2);assert.equal(s.events.reduce((n,e)=>n+e.total,0),19500);assert.ok(s.events.some(e=>e.warnings.includes('antigravity-retry-record')));
});
test('Antigravity late identity aliases and timestamp survive restart without duplicate spending',async t=>{
 const f=await fixture(t);const file=database(f.file('antigravity','aliases.db'),[generation({response:null,time:null})]);await f.c.scan();const first=[...f.c.events.values()][0].id;
 let db=new DatabaseSync(file);db.prepare('UPDATE gen_metadata SET data=? WHERE idx=0').run(generation());db.close();await f.c.scan();
 const c=await new Collector(f.data).init();db=new DatabaseSync(file);db.prepare('UPDATE gen_metadata SET data=? WHERE idx=0').run(generation({message:null}));db.close();await c.scan();
 assert.equal(c.events.size,1);assert.ok(c.events.has(first));assert.equal([...c.events.values()][0].timestamp,'2026-09-25T08:00:00.000Z');
});
test('Antigravity missing timestamp is excluded from calendar buckets, not assigned file mtime',async t=>{
 const f=await fixture(t);database(f.file('antigravity','undated.db'),[generation({time:null})]);await f.c.scan();assert.equal(sum(f.c).summary.records,1);assert.equal(summarize(f.c,{scope:'today'}).summary.records,0);assert.equal(sum(f.c).unknownTimeRecords,1);assert.equal(sum(f.c).summary.totalUsd,null);
});
test('Antigravity exact model spellings and efforts are mapped without inventing numeric enum names',()=>{
 assert.equal(modelInfo('Gemini 3.8 Flash (High)').model,'gemini-3.8-flash');assert.equal(modelInfo('Gemini 3.8 Flash (High)').effort,'high');
 assert.equal(modelInfo('Claude Opus 4.6').model,'claude-opus-4-6');const e=event({model:null,enum:98765});assert.equal(e.model,'antigravity-model-id-98765');assert.equal(priceEvent(e).rate,null);
});
test('Antigravity model switches apply each generation price instead of the final model price',()=>{
 const s=new Snapshot('switch');s.feed('generation',0,generation());s.feed('generation',1,generation({model:'claude-opus-4-6',response:'r2',message:'m2'}));
 assert.deepEqual(s.events.map(e=>e.model),['gemini-3.8-flash','claude-opus-4-6']);assert.notEqual(priceEvent(s.events[0]).rate.input,priceEvent(s.events[1]).rate.input);
});
test('Antigravity explicit output total is authoritative while inconsistent details stay marked',()=>{
 let e=event({output:2000,visible:1000,thinking:1500});assert.equal(e.output,2000);assert.ok(e.warnings.includes('antigravity-output-detail-mismatch'));assert.equal(e.reasoningKnown,false);assert.notEqual(priceEvent(e).totalPico,null);
 e=event({output:2000,visible:null,thinking:null});assert.equal(e.output,2000);assert.notEqual(priceEvent(e).totalPico,null);
});
test('Antigravity unknown cache-write TTL retains input count but marks input price incomplete',()=>{
 const e=event({model:'claude-opus-4-6',write:1000});assert.equal(e.input,16000);const p=priceEvent(e);assert.equal(p.inputPico,null);assert.notEqual(p.outputPico,null);assert.ok(p.missing.includes('cacheWrite'));
});
test('Antigravity malformed row and identity-less step expose partial coverage',async t=>{
 const f=await fixture(t);database(f.file('antigravity','partial.db'),[generation(),Buffer.from([10,255])],[step({response:null,message:null})]);await f.c.scan();const d=sum(f.c);assert.equal(d.summary.records,1);assert.equal(d.antigravity.health.status,'partial');assert.equal(d.antigravity.health.invalidRows,1);assert.equal(d.antigravity.health.ambiguousStepRows,1);
});
test('Antigravity no-identity generation uses stable per-row ID rather than discarding usage',()=>{
 const s=new Snapshot('rows');s.feed('generation',0,generation({response:null,message:null}));s.feed('generation',1,generation({response:null,message:null}));assert.equal(s.events.length,2);assert.notEqual(s.events[0].id,s.events[1].id);assert.ok(s.events[0].warnings.includes('antigravity-row-id-fallback'));
});
test('Antigravity unsupported legacy PB is visible, never displayed as zero-cost support',async t=>{
 const f=await fixture(t);await fs.writeFile(f.file('antigravity','legacy.pb'),'not-a-supported-db');await f.c.scan();assert.equal(sum(f.c).antigravity.health.status,'legacy-only');assert.equal(sum(f.c).summary.records,0);assert.ok(!statusLine(sum(f.c)).includes('$0'));
});
test('Antigravity unknown DB schema is a diagnostic, not fabricated usage',async t=>{
 const f=await fixture(t);const db=new DatabaseSync(f.file('antigravity','unsupported.db'));db.exec('CREATE TABLE metadata(text TEXT)');db.close();await f.c.scan();assert.equal(sum(f.c).summary.records,0);assert.ok(sum(f.c).antigravity.health.errorCodes.includes('unsupported-database-schema'));
});
test('Antigravity deleted original database retains historical spend with history-only health',async t=>{
 const f=await fixture(t);const file=database(f.file('antigravity','history.db'));await f.c.scan();await fs.unlink(file);await f.c.scan();assert.equal(sum(f.c).summary.records,1);assert.equal(sum(f.c).antigravity.health.status,'history-only');
});
test('Antigravity database and WAL symlinks are refused',async t=>{
 const f=await fixture(t);const file=database(f.file('antigravity','origin.db'));const link=f.file('antigravity','linked.db');await fs.symlink(file,link);await assert.rejects(()=>readDatabase(link),/symlink/);
 await fs.symlink(file,file+'-wal');await assert.rejects(()=>readDatabase(file),/symlink/);
});
test('Antigravity missing Python fallback runtime returns explicit availability error',async t=>{
 const f=await fixture(t);const file=database(f.file('antigravity','runtime.db'));await assert.rejects(()=>scanInWorker(file,{backend:'python',pythonCommands:[['/tm/nonexistent/python']]}),/sqlite-runtime-unavailable/);
});
test('Antigravity protobuf rejects truncated, oversized, ambiguous and overflow values',()=>{
 for(const data of [Buffer.from([0]),Buffer.from([10,255]),Buffer.from([15]),Buffer.from([0x10,...Array(11).fill(255)])])assert.throws(()=>fields(data));
 assert.throws(()=>decodeUsage(join(v(2,100),v(2,200))));assert.throws(()=>decodeUsage(v(2,1000000001)));assert.throws(()=>fields(Buffer.alloc(8*1024*1024+1)));
});
test('Antigravity API equivalent label cannot be presented as subscription charge',async t=>{
 const f=await fixture(t);database(f.file('antigravity','label.db'));await f.c.scan();f.c.config.billingMode='api-estimate';assert.equal(sum(f.c).costLabel,'API 환산');
});
test('Dated Gemini reference pricing stops at its cutoff and rejects malformed validity ranges',()=>{
 assert.equal(priceEvent(event()).rate.input,.75);assert.equal(priceEvent(event({time:'2027-01-01T00:00:00Z'})).rate.input,1.5);assert.equal(priceEvent(event({time:null})).rate,null);
 assert.throws(()=>validateRules({rules:[{provider:'antigravity',models:['x'],input:1,output:1,effectiveTo:'invalid'}]}),/effectiveTo/);
 assert.throws(()=>validateRules({rules:[{provider:'antigravity',models:['x'],input:1,output:1,effectiveFrom:'2027-01-02',effectiveTo:'2027-01-01'}]}),/유효기간/);
});
