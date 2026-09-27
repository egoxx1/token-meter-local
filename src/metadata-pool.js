'use strict';
// Exact-value interning: never merges different model/rate/condition snapshots.
// Only immutable metadata is shared; request counters and IDs remain separate.
function freeze(x){if(x&&typeof x==='object'&&!Object.isFrozen(x)){Object.freeze(x);for(const v of Object.values(x))freeze(v);}return x;}
class MetadataPool {
  constructor(limit=4096){this.limit=limit;this.values=new Map();this.hits=0;}
  intern(value){if(value==null)return value;const key=typeof value==='string'?'s:'+value:'j:'+JSON.stringify(value);const old=this.values.get(key);if(old!==undefined){this.hits++;return old;}if(this.values.size>=this.limit)this.values.delete(this.values.keys().next().value);this.values.set(key,freeze(value));return value;}
  event(e){if(!e||typeof e!=='object')return e;
    if(e.price&&!Object.isFrozen(e.price)){e.price.rate=this.intern(e.price.rate);e.price.binding=this.intern(e.price.binding);for(const k of ['reasons','referenceReasons','missing'])if(e.price[k])e.price[k]=this.intern(e.price[k]);freeze(e.price);}
    for(const k of ['modelResolution','outputSplitNote','outputSplitSource','inputEvidence','project','projectId','sessionId','model'])if(e[k])e[k]=this.intern(e[k]);
    return e;
  }
  stats(){return {entries:this.values.size,limit:this.limit,hits:this.hits};}
}
module.exports={MetadataPool};
