'use strict';
// Read/write the EXISTING ledger JSON format without materializing a second
// full-file string. Each event is parsed independently; malformed input fails
// closed. No raw provider records are written by this module.
const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
class Reader {
  constructor(stream,maxValue=64*1024*1024){this.stream=stream;this.it=stream[Symbol.asyncIterator]();this.buf='';this.p=0;this.eof=false;this.maxValue=maxValue;}
  async fill(){while(this.p>=this.buf.length&&!this.eof){const n=await this.it.next();this.eof=n.done;this.buf=n.value||'';this.p=0;}return !this.eof;}
  async peek(){await this.fill();return this.eof?'':this.buf[this.p];}
  async ws(){while(await this.fill()){while(this.p<this.buf.length&&/[\t\n\r ]/.test(this.buf[this.p]))this.p++;if(this.p<this.buf.length)return;}}
  async expect(c){await this.ws();if(await this.peek()!==c)throw new Error('JSON delimiter');this.p++;}
  async raw(){
    await this.ws();const first=await this.peek();if(!first)throw new Error('truncated JSON');
    const compound=first==='{'||first==='[',quoted=first==='"';let depth=0,inString=false,escape=false,size=0,parts=[];
    while(await this.fill()){
      const start=this.p;let done=false;
      while(this.p<this.buf.length){
        const c=this.buf[this.p];
        if(!compound&&!quoted&&/[\t\n\r ,}\]]/.test(c)){done=true;break;}
        this.p++;
        if(inString){if(escape)escape=false;else if(c==='\\')escape=true;else if(c==='"'){inString=false;if(quoted)done=true;}}
        else if(c==='"')inString=true;
        else if(compound){if(c==='{'||c==='[')depth++;else if(c==='}'||c===']'){depth--;if(!depth)done=true;}}
        if(done)break;
      }
      const part=this.buf.slice(start,this.p);parts.push(part);size+=part.length;
      if(size>this.maxValue)throw new Error('JSON value too large');
      if(done)return parts.join('');
    }
    if(!compound&&!quoted&&size)return parts.join('');
    throw new Error('truncated JSON');
  }
}
async function readLedger(file,normalize=x=>x,{highWaterMark=64*1024}={}){
  const stream=fs.createReadStream(file,{encoding:'utf8',highWaterMark});
  const r=new Reader(stream);const out={},keys=new Set();
  try{
    await r.expect('{');await r.ws();if(await r.peek()==='}'){r.p++;}else while(true){
      const k=JSON.parse(await r.raw());if(typeof k!=='string'||keys.has(k))throw new Error('duplicate/invalid JSON key');keys.add(k);await r.expect(':');
      let value;
      if(k==='events'||k==='sourceEvents'){
        await r.expect('[');value=[];await r.ws();
        if(await r.peek()===']')r.p++;else while(true){value.push(normalize(JSON.parse(await r.raw())));await r.ws();const c=await r.peek();r.p++;if(c===']')break;if(c!==',')throw new Error('JSON array delimiter');}
      }else value=JSON.parse(await r.raw());
      Object.defineProperty(out,k,{value,enumerable:true,writable:true,configurable:true});
      await r.ws();const c=await r.peek();r.p++;if(c==='}')break;if(c!==',')throw new Error('JSON object delimiter');
    }
    await r.ws();if(await r.peek())throw new Error('trailing JSON');return out;
  }catch(e){if(e.code==='ENOENT')return null;throw new Error(`${path.basename(file)} 읽기 실패 (${e.code||e.message})`);}finally{stream.destroy();}
}
function* fragments(value,level=0){
  // Container objects (including reset baseline) are traversed; array entries
  // such as individual events remain ordinary JSON.stringify values.
  if(Array.isArray(value)){yield '[';for(let i=0;i<value.length;i++){if(i)yield ',';yield JSON.stringify(value[i])??'null';}yield ']';}
  else if(value&&typeof value==='object'&&level<3){yield '{';let first=true;for(const k of Object.keys(value)){if(value[k]===undefined)continue;if(!first)yield ',';first=false;yield JSON.stringify(k)+':';yield* fragments(value[k],level+1);}yield '}';}
  else yield JSON.stringify(value)??'null';
}
async function atomicLedger(file,value){
  await fsp.mkdir(path.dirname(file),{recursive:true,mode:0o700});
  const tmp=`${file}.${process.pid}.${crypto.randomBytes(5).toString('hex')}.tmp`;let h;
  try{h=await fsp.open(tmp,'wx',0o600);let batch=[],size=0;
    for(const s of fragments(value)){batch.push(s);size+=s.length;if(size>=128*1024){await h.writeFile(batch.join(''),'utf8');batch=[];size=0;}}
    if(batch.length)await h.writeFile(batch.join(''),'utf8');await h.sync();await h.close();h=null;await fsp.rename(tmp,file);
  }finally{await h?.close();await fsp.unlink(tmp).catch(()=>{});}
}
module.exports={readLedger,atomicLedger,fragments};
