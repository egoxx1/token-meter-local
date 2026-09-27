'use strict';
const http=require('node:http');
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const {Collector}=require('./collector');
const {acquire}=require('./lock');
const {atomicJson,readJson,text}=require('./util');
const {validate}=require('./config');
const {BUILTIN,validateRules}=require('./pricing');
const {summarize,exportCsv,filtered,statusLine}=require('./summary');
const WEB=path.join(__dirname,'..','web');
const STATIC={'/reliability.js':['reliability.js','text/javascript; charset=utf-8'],'/billing-view.js':['../src/billing-view.js','text/javascript; charset=utf-8'],'/data-controls.js':['data-controls.js','text/javascript; charset=utf-8'],'/rates.js':['rates.js','text/javascript; charset=utf-8'],'/':['index.html','text/html; charset=utf-8'],'/app.js':['app.js','text/javascript; charset=utf-8'],'/history.js':['history.js','text/javascript; charset=utf-8'],'/measurements.js':['measurements.js','text/javascript; charset=utf-8'],'/style.css':['style.css','text/css; charset=utf-8']};
async function body(req, limit=16384) {
  const chunks=[];let n=0;
  for await(const c of req){n+=c.length;if(n>limit)throw new Error(`요청 본문은 ${limit/1024}KiB 이하만 허용`);chunks.push(c);}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new Error('올바른 JSON 필요');}
}
function equal(a,b){const x=Buffer.from(a||''),y=Buffer.from(b||'');return x.length===y.length&&crypto.timingSafeEqual(x,y);}
async function startServer({dataDir,port=0,onError=()=>{},catalogDownload,updateTransport}) {
  const release=await acquire(dataDir);
  let collector;
  try{collector=await new Collector(dataDir,{catalogDownload}).init();await new (require('./measurements').Measurements)(collector).init();}catch(e){await release();throw e;}
  const updates=await new (require('./updates').Updates)(dataDir,updateTransport).init();
  const token=crypto.randomBytes(32).toString('hex');
  let origin='',runtime,timer,updateTimer,updateJob,closing=false,server;
  const viewCache=new (require('./view-cache').ViewCache)();
  let lastViewRevision='';
  const memoryStatus=()=>({pid:process.pid,node:process.version,rssBytes:process.memoryUsage().rss,heapUsedBytes:process.memoryUsage().heapUsed,externalBytes:process.memoryUsage().external,eventCount:collector.events.size,sourceEventCount:(collector.sourceEvents||collector.events).size,separateSourceMapCount:collector.sourceEvents?.size||0,journalIndex:collector.journal.latest.size,metadataPool:collector.metadataPool.stats(),viewCache:viewCache.stats(),pendingSaves:collector.pendingSaves,scanning:collector.scanning});
  function cachedSummary(q){
    const now=new Date(),revision=JSON.stringify([collector.dataVersion,collector.measurements.revision,collector.measurements.state.pinnedId,collector.resetBoundary?.id,collector.events.size,collector.config]);
    if(lastViewRevision!==revision){viewCache.clear();lastViewRevision=revision;}
    const stamp=Math.floor(now.getTime()/(q.scope==='measurement'?1000:60000));
    const k=JSON.stringify([Object.entries(q).sort(([a],[b])=>a.localeCompare(b)),stamp]);
    const d=viewCache.get(k,()=>summarize(collector,q,now));
    return {...d,generatedAt:now.toISOString(),updatedAt:collector.updatedAt,scanning:collector.scanning,health:collector.health,warnings:collector.warnings,scanStats:collector.scanStats,storage:collector.journal.status(),antigravity:{...d.antigravity,health:collector.health.antigravity||{}},catalog:collector.catalog.status(collector.config.catalogUpdates),performance:memoryStatus()};
  }
  let writeQueue=Promise.resolve();
  const serializeWrite=fn=>{const job=writeQueue.catch(()=>{}).then(fn);writeQueue=job;return job;};
  const respond=(res,code,data,type='application/json; charset=utf-8')=>{res.writeHead(code,{'Content-Type':type});res.end(typeof data==='string'?data:JSON.stringify(data));};
  async function close(){
    if(closing)return;closing=true;clearTimeout(timer);clearTimeout(updateTimer);
    if(updateJob)await updateJob.catch(()=>{});
    if(updates.downloading)await updates.downloading.catch(()=>{});
    if(updates.inFlight)await updates.inFlight.catch(()=>{});
    if(collector.catalog.inFlight)await collector.catalog.inFlight.catch(()=>{});
    await writeQueue.catch(()=>{});
    await collector.measurements.queue.catch(()=>{});
    if(collector.inFlight)await collector.inFlight.catch(()=>{});
    if(collector.dirty)await collector.save();
    await collector.saveQueue.catch(()=>{});
    server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
    const record=await readJson(path.join(dataDir,'runtime.json'),null);
    if(record?.token===token)await fs.unlink(path.join(dataDir,'runtime.json')).catch(()=>{});
    await release();
  }
  server=http.createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
    try{
      // Loopback + exact Host + same-origin + bearer token prevent DNS rebinding and cross-site local reads/writes.
      if(req.headers.host!==new URL(origin).host)return respond(res,403,{error:'Host 차단'});
      if(req.headers.origin&&req.headers.origin!==origin)return respond(res,403,{error:'Origin 차단'});
      const url=new URL(req.url,origin);
      if(!['GET','POST'].includes(req.method))return respond(res,405,{error:'허용되지 않은 method'});
      if(STATIC[url.pathname]&&req.method==='GET'){
        const [name,mime]=STATIC[url.pathname];return respond(res,200,await fs.readFile(path.join(WEB,name),'utf8'),mime);
      }
      if(!equal(req.headers.authorization,`Bearer ${token}`))return respond(res,401,{error:'인증이 필요합니다. 실행 시 표시된 대시보드 주소를 다시 여세요.'});
      if(collector.resetting)return respond(res,503,{error:'전체 초기화 처리 중입니다. 잠시 후 다시 확인하세요.'});
      const q=Object.fromEntries(url.searchParams);
      if(q.followPinned==='1'&&collector.measurements.state.pinnedId){q.scope='measurement';q.measurement=collector.measurements.state.pinnedId;}
      if(req.method==='GET'&&url.pathname==='/api/ping')return respond(res,200,{version:require('../package.json').version,scanning:collector.scanning,pid:process.pid});
      if(req.method==='GET'&&url.pathname==='/api/performance')return respond(res,200,memoryStatus());
      if(req.method==='GET'&&url.pathname==='/api/measurements')return respond(res,200,collector.measurements.list());
      if(req.method==='GET'&&['/api/measurements/export.csv','/api/measurements/export.json'].includes(url.pathname)){
        const ids=(q.ids||'').split(',').filter(Boolean);
        if(url.pathname.endsWith('.csv')){res.setHeader('Content-Disposition','attachment; filename="token-meter-measurements.csv"');return respond(res,200,collector.measurements.csv(ids),'text/csv; charset=utf-8');}
        return respond(res,200,collector.measurements.export(ids));
      }
      if(req.method==='POST'&&url.pathname.startsWith('/api/measurements/')){
        const action=url.pathname.slice('/api/measurements/'.length),b=await body(req,action==='delete'?65536:16384);
        if(!['start','reset','stop','undo','update','pin','delete'].includes(action))return respond(res,404,{error:'지원하지 않는 측정 명령'});
        const result=await serializeWrite(()=>{
          const m=collector.measurements;
          if(action==='start'||action==='reset')return m.start(b,action==='reset');
          if(action==='stop')return m.stop(b.id);
          if(action==='undo')return m.undo();
          if(action==='update')return m.update(b.id,b);
          if(action==='pin')return m.pin(b.id);
          return m.remove(b);
        });return respond(res,200,result);
      }
      if(req.method==='GET'&&url.pathname==='/api/data/state')return respond(res,200,require('./data-reset').dataState(collector));
      if(req.method==='POST'&&url.pathname==='/api/data/reset'){const b=await body(req);return respond(res,200,await serializeWrite(()=>collector.resetAll(b)));}
      if(req.method==='POST'&&url.pathname==='/api/scan'){await body(req);await serializeWrite(()=>collector.scan());return respond(res,200,{ok:true,updatedAt:collector.updatedAt});}
      if(req.method==='GET'&&['/api/status','/api/line'].includes(url.pathname)&&q.scope==='measurement'&&!collector.measurements.state.runs.some(r=>r.id===(q.measurement||collector.measurements.state.pinnedId))){q.scope='all';delete q.measurement;q.selectionNotice='선택했던 측정이 삭제되어 전체 누적으로 전환했습니다.';}
      if(req.method==='GET'&&url.pathname==='/api/status')return respond(res,200,{...cachedSummary(q),...(q.includeMeasurements==='1'?{measurements:collector.measurements.list()}:{}),updates:updates.status(collector.config.appUpdates),demo:!!runtime.demo});
      if(req.method==='GET'&&url.pathname==='/api/reliability')return respond(res,200,{...require('./reliability').invariants(collector),sessions:require('./reliability').sessions(collector)});
      if(req.method==='GET'&&url.pathname==='/api/reliability/export')return respond(res,200,require('./reliability').diagnostics(collector));
      if(req.method==='POST'&&url.pathname==='/api/reliability/compare'){
        const b=await body(req);const selection=b.selection||{};
        if(selection.scope!=='session'||typeof selection.session!=='string'||!selection.session)throw new Error('대조할 세션을 먼저 선택하세요.');
        const data=summarize(collector,selection);return respond(res,200,{scopeInfo:data.scopeInfo,...require('./reference-compare').compareReference(data.summary,b.reference||{})});
      }
      if(req.method==='POST'&&url.pathname==='/api/reliability/verify'){
        const b=await body(req);return respond(res,200,await serializeWrite(async()=>{await collector.scan();return require('./reliability').verifySession(collector,b);}));
      }
      if(req.method==='GET'&&url.pathname==='/api/pricing/audit')return respond(res,200,require('./rate-audit').auditRates(collector,q));
      if(req.method==='GET'&&url.pathname==='/api/history')return respond(res,200,require('./history').history(collector,q));
      if(req.method==='GET'&&url.pathname==='/api/history/detail'){
        const e=collector.events.get(q.id);if(!e)return respond(res,404,{error:'해당 사용 기록을 찾을 수 없습니다.'});
        return respond(res,200,{...require('./history').recordView(e),revision:collector.journal.latest.get(e.id)?.revision||null});
      }
      if(req.method==='GET'&&['/api/history/export.jsonl','/api/history/export.csv'].includes(url.pathname)){
        const format=url.pathname.endsWith('.csv')?'csv':'jsonl';res.setHeader('Content-Disposition',`attachment; filename="token-meter-usage-history.${format}"`);
        const chunks=require('./history').historyChunks(collector,q,format),first=chunks.next();
        function* output(){if(!first.done)yield first.value;yield* chunks;}
        res.writeHead(200,{'Content-Type':format==='csv'?'text/csv; charset=utf-8':'application/x-ndjson; charset=utf-8'});
        await require('node:stream/promises').pipeline(require('node:stream').Readable.from(output(),{objectMode:false,highWaterMark:64*1024}),res);return;
      }
      if(req.method==='POST'&&url.pathname==='/api/antigravity/reanalyse'){await body(req);return respond(res,200,await serializeWrite(()=>collector.reanalyseAntigravity()));}
      if(req.method==='GET'&&url.pathname==='/api/line')return respond(res,200,statusLine(cachedSummary({...q,view:'statusbar'})),'text/plain; charset=utf-8');
      if(req.method==='GET'&&url.pathname==='/api/prices')return respond(res,200,{builtin:[...BUILTIN,...require('../data/prices.extra.json').rules],remote:collector.catalog.rules(collector.config.catalogUpdates),custom:collector.customRules});
      if(req.method==='GET'&&url.pathname==='/api/catalog')return respond(res,200,collector.catalog.status(collector.config.catalogUpdates));
      if(req.method==='POST'&&url.pathname==='/api/catalog/refresh'){await body(req);await collector.catalog.refresh(collector.config.catalogUpdates,true);await serializeWrite(()=>collector.scan());return respond(res,200,collector.catalog.status(collector.config.catalogUpdates));}
      if(req.method==='POST'&&url.pathname==='/api/usage'){const b=await body(req);return respond(res,200,await serializeWrite(()=>collector.ingest(b)));}
      if(req.method==='GET'&&url.pathname==='/api/updates')return respond(res,200,updates.status(collector.config.appUpdates));
      if(req.method==='POST'&&url.pathname==='/api/updates/check'){await body(req);return respond(res,200,await updates.check(collector.config.appUpdates,true));}
      if(req.method==='POST'&&url.pathname==='/api/updates/download'){await body(req);return respond(res,200,await updates.download(collector.config.appUpdates));}
      if(req.method==='POST'&&url.pathname==='/api/updates/verified-path'){await body(req);return respond(res,200,await updates.verifiedPath(collector.config.appUpdates));}
      if(req.method==='GET'&&url.pathname==='/api/config')return respond(res,200,{...collector.config,dataDir});
      if(req.method==='GET'&&['/api/export.csv','/api/export.json'].includes(url.pathname)){
        const csv=url.pathname.endsWith('.csv'),generator=csv?require('./summary').exportCsvChunks:require('./summary').exportJsonChunks;
        const chunks=generator(collector,q),first=chunks.next(); // Validate before sending HTTP headers.
        res.writeHead(200,{'Content-Type':csv?'text/csv; charset=utf-8':'application/json; charset=utf-8','Content-Disposition':`attachment; filename="token-meter.${csv?'csv':'json'}"`});
        function* output(){if(!first.done)yield first.value;yield* chunks;}
        await require('node:stream/promises').pipeline(require('node:stream').Readable.from(output(),{objectMode:false,highWaterMark:65536}),res);return;
      }
      if(req.method==='POST'&&url.pathname==='/api/task/start'){const b=await body(req);return respond(res,200,await serializeWrite(()=>collector.startTask(b.name,b.projectId)));}
      if(req.method==='POST'&&url.pathname==='/api/task/stop'){await body(req);return respond(res,200,await serializeWrite(()=>collector.stopTask()));}
      if(req.method==='POST'&&url.pathname==='/api/settings'){
        const b=await body(req);await serializeWrite(async()=>{const raw=await readJson(path.join(dataDir,'config.json'),{});
        for(const k of Object.keys(b))if(!['billingMode','dailyBudgetUsd','usdToKrw','fxAsOf','timeZone','catalogUpdates'].includes(k))throw new Error('이 설정은 로컬 config.json에서 변경하세요.');
        const next=validate({...raw,...b});await atomicJson(path.join(dataDir,'config.json'),next);collector.config=next;});return respond(res,200,{ok:true});
      }
      if(req.method==='POST'&&url.pathname==='/api/prices'){
        const b=await body(req);const [r]=validateRules({rules:[b]});await serializeWrite(async()=>{
        const old=await readJson(path.join(dataDir,'prices.user.json'),{version:1,rules:[]});
        validateRules({rules:[...old.rules,r]});await atomicJson(path.join(dataDir,'prices.user.json'),{version:1,rules:[...old.rules,r]});
        await collector.scan();});return respond(res,200,{ok:true});
      }
      if(req.method==='POST'&&url.pathname==='/api/shutdown'){await body(req);respond(res,200,{ok:true});setTimeout(()=>close().catch(onError),50);return;}
      return respond(res,404,{error:'찾을 수 없음'});
    }catch(e){if(res.headersSent||res.destroyed){res.destroy();return;}respond(res,400,{error:text(e.message,400)});}
  });
  server.requestTimeout=15000;server.headersTimeout=10000;
  try{
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
    origin=`http://127.0.0.1:${server.address().port}`;
    runtime={version:1,appVersion:require('../package.json').version,pid:process.pid,origin,token,startedAt:new Date().toISOString(),demo:path.basename(dataDir).startsWith('token-meter-demo-')};
    await atomicJson(path.join(dataDir,'runtime.json'),runtime);
  }catch(e){server.close();await release();throw e;}
  async function loop(){if(closing)return;const started=Date.now();try{await serializeWrite(()=>collector.scan());}catch(e){collector.warnings=[text(e.message)];onError(e);}const cycleMs=Date.now()-started;collector.scanStats.nextPollMs=require('./polling').nextDelay(collector.config.pollMs,cycleMs);collector.scanStats.cycleMs=cycleMs;if(!closing){timer=setTimeout(loop,collector.scanStats.nextPollMs);timer.unref();}}
  await loop();
  function updatesLoop(){
    if(closing)return;
    updateJob=(async()=>{await collector.catalog.refresh(collector.config.catalogUpdates);await updates.check(collector.config.appUpdates);})().catch(onError).finally(()=>{if(!closing){updateTimer=setTimeout(updatesLoop,60000);updateTimer.unref();}});
  }
  updatesLoop();
  return {collector,updates,server,runtime,url:origin+'/#key='+token,close};
}
module.exports={startServer};
