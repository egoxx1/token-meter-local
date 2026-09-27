'use strict';
// Each byte is copied at most once, not repeatedly concatenated as a 16MiB
// partial line arrives in 64KiB chunks. Only bounded line fragments are retained.
async function* byteLines(stream,{maxBytes=24*1024*1024}={}){
  let parts=[],size=0;
  for await(const chunk of stream){let pos=0;while(pos<chunk.length){const nl=chunk.indexOf(10,pos),end=nl<0?chunk.length:nl;
    const piece=chunk.subarray(pos,end);size+=piece.length;if(size>maxBytes)throw new Error('database-read-limit');if(piece.length)parts.push(piece);
    if(nl<0)break;
    yield {line:parts.length===1?parts[0]:Buffer.concat(parts,size),complete:true};parts=[];size=0;pos=nl+1;
  }}
  if(size)yield {line:parts.length===1?parts[0]:Buffer.concat(parts,size),complete:false};
}
module.exports={byteLines};
