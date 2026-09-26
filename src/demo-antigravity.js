'use strict';
// Synthetic-only database creation, called exclusively by the isolated demo command.
const path=require('node:path');
const {spawnSync}=require('node:child_process');
function vint(value){let n=BigInt(value);const a=[];do{const b=Number(n&127n);n>>=7n;a.push(b|(n?128:0));}while(n);return Buffer.from(a);}
const integer=(n,v)=>Buffer.concat([vint(n*8),vint(v)]);
function bytes(n,v){const b=Buffer.isBuffer(v)?v:Buffer.from(v);return Buffer.concat([vint(n*8+2),vint(b.length),b]);}
function syntheticRows(now=Date.now()){
 return Array.from({length:8},(_,i)=>{
  const t=now-(8-i)*90000,thinking=1700+i*210,visible=800+i*60;
  const usage=Buffer.concat([integer(2,9000+i*1200),integer(3,thinking+visible),integer(5,48000+i*6000),integer(9,thinking),integer(10,visible),bytes(11,`synthetic-ag-response-${i}`)]);
  const timestamp=Buffer.concat([integer(1,Math.floor(t/1000)),integer(2,t%1000*1000000)]);
  return bytes(1,Buffer.concat([bytes(4,usage),bytes(9,bytes(4,timestamp)),bytes(21,i<6?'Gemini 3.8 Flash (High)':'Claude Opus 4.6'),bytes(30,'SYNTHETIC_DEMO_PROMPT_MUST_NOT_PERSIST')]));
 });
}
function seedAntigravityDemo(dir,now){
 const file=path.join(dir,'synthetic-antigravity-demo.db'),rows=syntheticRows(now);
 let sqlite;try{sqlite=require('node:sqlite');}catch{}
 if(sqlite?.DatabaseSync){const db=new sqlite.DatabaseSync(file);try{db.exec('CREATE TABLE gen_metadata(idx INTEGER PRIMARY KEY,data BLOB);');for(const[i,b]of rows.entries())db.prepare('INSERT INTO gen_metadata VALUES(?,?)').run(i,b);}finally{db.close();}return true;}
 const script='import sqlite3,sys,json; db=sqlite3.connect(sys.argv[1]); db.execute("CREATE TABLE gen_metadata(idx INTEGER PRIMARY KEY,data BLOB)"); db.executemany("INSERT INTO gen_metadata VALUES(?,?)",[(i,bytes.fromhex(v)) for i,v in enumerate(json.loads(sys.argv[2]))]); db.commit(); db.close()';
 for(const cmd of process.platform==='win32'?[['py','-3'],['python3'],['python']]:[['python3'],['python']]){const r=spawnSync(cmd[0],[...cmd.slice(1),'-I','-c',script,file,JSON.stringify(rows.map(b=>b.toString('hex')))],{timeout:10000,windowsHide:true,stdio:'ignore'});if(r.status===0)return true;}
 return false;
}
module.exports={seedAntigravityDemo,syntheticRows};
