'use strict';
// Bounded derived views only: no raw event snapshots retained. The collector
// revision invalidates prices, counters, recovery and reset changes together.
class ViewCache {
  constructor({limit=4,maxBytes=8*1024*1024,ttl=60000}={}){this.entries=new Map();this.limit=limit;this.maxBytes=maxBytes;this.ttl=ttl;this.bytes=0;this.hits=0;this.misses=0;}
  get(key,make,now=Date.now()){
    const found=this.entries.get(key);
    if(found&&now-found.at<this.ttl){this.hits++;return found.value;}
    this.misses++;if(found){this.bytes-=found.size;this.entries.delete(key);}
    const value=make(),size=Buffer.byteLength(JSON.stringify(value));
    if(size<=this.maxBytes){while(this.entries.size&&(this.entries.size>=this.limit||this.bytes+size>this.maxBytes)){const k=this.entries.keys().next().value;this.bytes-=this.entries.get(k).size;this.entries.delete(k);}this.entries.set(key,{value,size,at:now});this.bytes+=size;}
    return value;
  }
  clear(){this.entries.clear();this.bytes=0;}
  stats(){return {entries:this.entries.size,bytes:this.bytes,maxBytes:this.maxBytes,hits:this.hits,misses:this.misses};}
}
module.exports={ViewCache};
