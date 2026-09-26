'use strict';
// Synthetic protobuf builders for the independently documented private field layout.
// These fixtures are not production account captures.
const {DatabaseSync}=require('node:sqlite');
const SENTINEL='PRIVATE_ANTIGRAVITY_PROMPT_CODE_SECRET_MUST_NOT_PERSIST';
function vi(value){let n=BigInt(value),a=[];do{let b=Number(n&127n);n>>=7n;a.push(b|(n?128:0));}while(n);return Buffer.from(a);}
function v(n,value){return Buffer.concat([vi(n*8),vi(value)]);}
function b(n,value){const buf=Buffer.isBuffer(value)?value:Buffer.from(value);return Buffer.concat([vi(n*8+2),vi(buf.length),buf]);}
const join=(...parts)=>Buffer.concat(parts.filter(Boolean));
function time(value='2026-09-25T08:00:00Z'){const ms=Date.parse(value);return join(v(1,Math.floor(ms/1000)),v(2,ms%1000*1000000));}
function usage(o={}){const d={normal:10000,output:2000,cache:5000,write:0,thinking:1500,visible:500,response:'response-1',message:'message-1',...o};return join(v(2,d.normal),v(3,d.output),v(4,d.write),v(5,d.cache),d.thinking===null?null:v(9,d.thinking),d.visible===null?null:v(10,d.visible),d.response?b(11,d.response):null,d.message?b(7,d.message):null,d.enum?v(1,d.enum):null);}
function generation(o={}){const u=o.noUsage?null:usage(o);return join(b(1,join(o.model===null?null:b(21,o.model||'gemini-3.8-flash'),o.enum?v(3,o.enum):null,u?b(4,u):null,o.time===null?null:b(9,b(4,time(o.time))),...(o.retries||[]).map(r=>b(17,b(2,usage(r)))),b(30,SENTINEL))),o.genId?b(4,o.genId):null);}
function step(o={}){return join(b(9,usage(o)),o.model===null?null:b(24,b(12,o.model||'gemini-3.8-flash')),o.time===null?null:b(8,time(o.time)),...(o.retries||[]).map(r=>b(28,b(2,usage(r)))),b(4,b(3,SENTINEL)));}
function database(file,gens=[generation()],steps=[]){const db=new DatabaseSync(file);db.exec('CREATE TABLE gen_metadata(idx INTEGER PRIMARY KEY,data BLOB); CREATE TABLE steps(idx INTEGER PRIMARY KEY,metadata BLOB);');for(const [idx,data]of gens.entries())db.prepare('INSERT INTO gen_metadata VALUES(?,?)').run(idx,data);for(const [idx,data]of steps.entries())db.prepare('INSERT INTO steps VALUES(?,?)').run(idx,data);db.close();return file;}
module.exports={vi,v,b,join,time,usage,generation,step,database,SENTINEL};
