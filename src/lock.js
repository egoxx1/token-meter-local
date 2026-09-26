'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const {readJson}=require('./util');
async function acquire(dir) {
  await fs.mkdir(dir,{recursive:true,mode:0o700});
  const file=path.join(dir,'collector.lock');
  const nonce=crypto.randomBytes(16).toString('hex');
  for(let attempt=0;attempt<2;attempt++) {
    try {
      const handle=await fs.open(file,'wx',0o600);
      try{await handle.writeFile(JSON.stringify({pid:process.pid,nonce}));}finally{await handle.close();}
      return async()=>{const now=await readJson(file,null);if(now?.nonce===nonce)await fs.unlink(file).catch(()=>{});};
    } catch(e) {
      if(e.code!=='EEXIST')throw e;
      let lock;
      try { lock=await readJson(file,null); } catch { throw new Error('수집기 잠금 파일이 불완전합니다. 실행 중인 수집기가 없는지 확인한 뒤 collector.lock을 확인하세요.'); }
      if(!lock || !Number.isSafeInteger(lock.pid) || lock.pid<=0)throw new Error('잘못된 수집기 잠금 파일');
      try{process.kill(lock.pid,0);throw new Error('이미 실행 중인 수집기가 있습니다. dashboard 명령으로 연결하세요.');}
      catch(err){if(err.code!=='ESRCH')throw err;}
      await fs.unlink(file).catch(()=>{});
    }
  }
  throw new Error('수집기 잠금 확보 실패');
}
module.exports={acquire};
