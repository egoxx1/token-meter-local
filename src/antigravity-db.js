'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const {Worker,isMainThread,parentPort,workerData}=require('node:worker_threads');
const {spawn}=require('node:child_process');
const {Snapshot,MAX_BLOB}=require('./antigravity-proto');
const MAX_ROWS=50000,MAX_BYTES=128*1024*1024;
function nativeRead(file,DatabaseSync) {
  let db;
  const s=new Snapshot(path.basename(file,'.db'));
  try{
    db=new DatabaseSync(file,{readOnly:true,enableLoadExtension:false});
    db.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; PRAGMA busy_timeout=1000; BEGIN;');
    const tables=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name));
    if(!tables.has('gen_metadata'))throw new Error('unsupported-database-schema');
    let rows=0,bytes=0;
    for(const [table,col,kind] of [['gen_metadata','data','generation'],['steps','metadata','step']]){
      if(!tables.has(table))continue;
      const cols=new Set(db.prepare(`PRAGMA table_info("${table}")`).all().map(r=>r.name));
      if(!cols.has('idx')||!cols.has(col))throw new Error('unsupported-database-schema');
      for(const row of db.prepare(`SELECT idx,length("${col}") AS len,CASE WHEN length("${col}")<=${MAX_BLOB} THEN "${col}" ELSE NULL END AS data FROM "${table}" WHERE "${col}" IS NOT NULL ORDER BY idx`).iterate()){
        if(++rows>MAX_ROWS||!(row.data instanceof Uint8Array)||row.len>MAX_BLOB||(bytes+=row.len)>MAX_BYTES)throw new Error('database-read-limit');
        s.feed(kind,row.idx,row.data);
      }
    }
    return s.finish('node:sqlite');
  }finally{if(db)db.close();}
}
async function pythonRead(file,commands) {
  commands=commands|| (process.platform==='win32'?[['py','-3'],['python3'],['python']]:[['python3'],['python']]);
  for(const command of commands){
    const s=new Snapshot(path.basename(file,'.db'));
    try{
      await new Promise((resolve,reject)=>{
        const cp=spawn(command[0],[...command.slice(1),'-I',path.join(__dirname,'antigravity-sqlite.py'),file],{stdio:['ignore','pipe','ignore'],windowsHide:true});
        let buffer=Buffer.alloc(0),done=false,error=null,total=0;
        const fail=e=>{if(!error){error=e;cp.kill();}};
        cp.on('error',e=>{error=e;});
        cp.stdout.on('data',chunk=>{
          if(error)return;
          total+=chunk.length;
          if(total>MAX_BYTES*1.5+MAX_ROWS*256){fail(new Error('database-read-limit'));return;}
          buffer=Buffer.concat([buffer,chunk]);let nl;
          try{
            while((nl=buffer.indexOf(10))>=0){
              if(nl>MAX_BLOB*1.4+1024)throw new Error('database-read-limit');
              const r=JSON.parse(buffer.subarray(0,nl).toString('utf8'));buffer=buffer.subarray(nl+1);
              if(r.error)throw new Error(r.error);
              if(r.done){done=true;continue;}
              if(done||!['generation','step'].includes(r.kind)||typeof r.data!=='string')throw new Error('sqlite-bridge-protocol');
              s.feed(r.kind,r.idx,Buffer.from(r.data,'base64'));
            }
            if(buffer.length>MAX_BLOB*1.4+1024)throw new Error('database-read-limit');
          }catch(e){fail(e);}
        });
        const timer=setTimeout(()=>fail(new Error('database-timeout')),18000);
        cp.on('close',code=>{clearTimeout(timer);if(error)reject(error);else if(code!==0||!done||buffer.length)reject(new Error('sqlite-bridge-failed'));else resolve();});
      });
      return s.finish('python-sqlite3');
    }catch(e){if(e.code==='ENOENT'||e.message==='sqlite-bridge-failed')continue;throw e;}
  }
  throw new Error('sqlite-runtime-unavailable');
}
async function scanInWorker(file,options={}){
  if(options.backend!=='python'){
    let sqlite;try{sqlite=require('node:sqlite');}catch{}
    if(sqlite?.DatabaseSync)return nativeRead(file,sqlite.DatabaseSync);
    if(options.backend==='native')throw new Error('sqlite-runtime-unavailable');
  }
  return pythonRead(file,options.pythonCommands);
}
async function signature(file) {
  const values=[];
  for(const p of [file,file+'-wal',file+'-shm']){
    try{
      const s=await fs.lstat(p);
      if(s.isSymbolicLink()||!s.isFile())throw new Error('database-symlink-or-type');
      // SHM mtime can change due to readers; validate it but use main + WAL to detect new commits.
      if(!p.endsWith('-shm'))values.push([s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs].join(':'));
    }catch(e){if(e.code==='ENOENT'&&p!==file){if(!p.endsWith('-shm'))values.push('absent');}else throw e;}
  }
  return values.join('|');
}
async function readDatabase(file,options={}){
  const before=await signature(file);
  const result=await new Promise((resolve,reject)=>{
    const w=new Worker(__filename,{workerData:{file,options}});
    const timer=setTimeout(()=>{w.terminate();reject(new Error('database-timeout'));},20000);
    let finished=false;
    w.once('message',r=>{finished=true;clearTimeout(timer);if(r.error)reject(new Error(r.error));else resolve(r);});
    w.once('error',e=>{clearTimeout(timer);reject(e);});
    w.once('exit',code=>{clearTimeout(timer);if(!finished)reject(new Error(code?'sqlite-worker-error':'sqlite-worker-incomplete'));});
  });
  const after=await signature(file);
  return {...result,signature:before===after?after:null};
}
function safeError(e){
  const allowed=['identity-repair-incomplete-source','unsupported-database-schema','database-read-limit','database-busy','database-open-or-schema-error','database-read-error','database-timeout','sqlite-runtime-unavailable','database-symlink-or-type','sqlite-bridge-protocol','sqlite-bridge-failed'];
  if(allowed.includes(e.message))return e.message;
  if(/busy|locked/i.test(e.message))return 'database-busy';
  return 'database-read-error';
}
if(!isMainThread){scanInWorker(workerData.file,workerData.options).then(r=>parentPort.postMessage(r),e=>parentPort.postMessage({error:safeError(e)}));}
module.exports={readDatabase,signature,scanInWorker,nativeRead,pythonRead,safeError};
