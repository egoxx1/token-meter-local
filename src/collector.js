'use strict';
const fs = require('node:fs/promises');
const fss = require('node:fs');
const path = require('node:path');
const { initial, parse } = require('./parsers');
const { initConfig, validate, PROVIDERS } = require('./config');
const { readJson, atomicJson, hash } = require('./util');
const { validateRules, priceEvent, serviceOf, selectRate } = require('./pricing');
const { Catalog } = require('./catalog');
const {UsageLog}=require('./usage-log');
const {ensureSplit,SPLIT_KEYS}=require('./output-breakdown');
const MAX_LINE = 16 * 1024 * 1024;
class Collector {
  constructor(dataDir, options = {}) {
    this.metadataPool=new (require('./metadata-pool').MetadataPool)();this.dataVersion=0;
    this.catalog = new Catalog(dataDir, options.catalogDownload); this.journal=new UsageLog(dataDir,{compact:true});this.repairs={};
    this.dataDir = path.resolve(dataDir); this.storageDir=this.dataDir;this.resetBoundary=null;this.sourceEvents=null;this.resetBaseline=null;this.resetDiagnostics={lateOld:0,undated:0}; this.events = new Map(); this.files = {};
    this.tasks = []; this.warnings = []; this.health = {}; this.inFlight = null;
    this.pendingSaves=0;this.pendingRetirements=new Map(); this.antigravityAliases = new Map(); this.updatedAt = null; this.scanning = false; this.scanStats = {}; this.dirty = false; this.saveQueue = Promise.resolve();
  }
  async init() {
    this.config = await initConfig(this.dataDir);
    const storage=await require('./data-reset').resolveStorage(this.dataDir);this.storageDir=storage.directory;this.journal=new UsageLog(this.storageDir,{compact:true});
    const saved = await require('./json-store').readLedger(path.join(this.storageDir,'ledger.json'),e=>this.metadataPool.event(e));
    if(storage.pointer){const checked=require('./data-reset').validateBoundary(saved?.resetBoundary,saved?.sourceEvents);if(saved.resetBoundary.id!==storage.pointer.id)throw new Error('초기화 활성 ID 불일치');this.resetBoundary=saved.resetBoundary;this.resetBaseline=checked.baseline;this.sourceEvents=checked.sources;}
    if (saved) {
      if (![1,2].includes(saved.version) || !Array.isArray(saved.events) || !saved.files) throw new Error('지원하지 않는 ledger.json. 원본을 보존하고 데이터 폴더를 확인하세요.');
      if (saved.version === 1) {
        // Keep the pre-migration bytes; replay Gemini files to recover former cross-session collisions.
        await fs.copyFile(path.join(this.storageDir,'ledger.json'), path.join(this.storageDir,'ledger.pre-0.2.0.json'), fss.constants.COPYFILE_EXCL).catch(e=>{if(e.code!=='EEXIST')throw e;});
        for (const e of saved.events) if(e.provider === 'gemini') e.id = e.sessionId + ':' + e.id.slice('gemini:'.length);
        for (const key of Object.keys(saved.files)) if(key.startsWith('gemini:')) delete saved.files[key];
        this.dirty = true;
      }
      this.events = new Map(saved.events.map(e => [e.id, e])); for(const e of this.events.values())if(e.provider==='antigravity')for(const id of e.identityKeys||[])this.antigravityAliases.set(id,e.id); this.files = saved.files; this.tasks = saved.tasks || [];
    }
    if(this.sourceEvents)for(const e of this.sourceEvents.values())if(e.provider==='antigravity')for(const id of e.identityKeys||[])this.antigravityAliases.set(id,e.id);
    // Keep only journal revision/fingerprint metadata, replaying records directly
    // into the existing ledger map instead of retaining a second full history.
    await this.journal.init({afterSequence:saved?.journalSequence||0,onRecord:r=>{
      if(r.event.retired)this.events.delete(r.id);else this.events.set(r.id,this.metadataPool.event(r.event));this.dirty=true;
    }});
    this.repairs=saved?.repairs||{};await require('./identity-repair').loadPlans(this);
    if([...(this.sourceEvents||this.events).values()].some(require('./identity-repair').isLegacy))await require('./identity-repair').backup(this);
    if(saved&&!this.repairs.rateBindingV1){
      await fs.copyFile(path.join(this.storageDir,'ledger.json'),path.join(this.storageDir,'ledger.pre-0.7.1.json'),fss.constants.COPYFILE_EXCL).catch(e=>{if(e.code!=='EEXIST')throw e;});
    }
    if(saved&&!this.repairs.pricingV2){
      await fs.copyFile(path.join(this.storageDir,'ledger.json'),path.join(this.storageDir,'ledger.pre-0.5.0.json'),fss.constants.COPYFILE_EXCL).catch(e=>{if(e.code!=='EEXIST')throw e;});
    }
    if(saved&&!this.repairs.inputRatesV1){
      await fs.copyFile(path.join(this.storageDir,'ledger.json'),path.join(this.storageDir,'ledger.pre-0.7.0.json'),fss.constants.COPYFILE_EXCL).catch(e=>{if(e.code!=='EEXIST')throw e;});
    }
    if(saved&&!this.repairs.outputV1){
      await fs.copyFile(path.join(this.storageDir,'ledger.json'),path.join(this.storageDir,'ledger.pre-0.6.0.json'),fss.constants.COPYFILE_EXCL).catch(e=>{if(e.code!=='EEXIST')throw e;});
    }
    // First journal import preserves what earlier versions actually had, including
    // unresolved prices, before this version repairs model metadata/calculations.
    await this.journal.sync([...this.events.values()],{importExisting:true});
    this.customRules = validateRules(await readJson(path.join(this.dataDir, 'prices.user.json'), {rules:[]}));
    await this.catalog.init();
    this.activeRules = this.pricingRules();
    this.rulesHash = hash(JSON.stringify(this.activeRules));
    let mapped=0,bindingRepairs=0;
    for(const e of this.events.values()) {
      const splitChanged=e.outputBreakdownVersion!==1;
      if(splitChanged){ensureSplit(e);this.dirty=true;}
      let mappedThis=false;
      if(e.provider==='antigravity'){
        const {modelInfo,unresolved}=require('./antigravity-proto');
        const info=modelInfo(e.rawModel||e.model,e.numericModelId||0);
        if(unresolved(e.model)&&!unresolved(info.model)){Object.assign(e,info);mapped++;mappedThis=true;this.dirty=true;}
        for(const id of e.identityKeys||[])this.antigravityAliases.set(id,e.id);
      }
      const invalidBinding=e.price?.rate&&require('./pricing').checkRateBinding(e,e.price.rate).status!=='matched';
      if(e.price?.engineVersion!==4||invalidBinding||!e.price?.rate||mappedThis||(splitChanged&&e.outputTotalKnown===false)) {
        const priorBinding=e.price?.binding;
        if(e.provider==='codex'&&e.contextInputKnown===undefined)e.contextInputKnown=false;
        let oldRate=invalidBinding?e.price.rate:require('./pricing').upgradeStoredRate(e,e.price?.rate,this.activeRules);
        // Keep historical snapshots except a same-date official correction to a
        // remote community rate. User prices and earlier dates stay explicit.
        const checked=selectRate(e,this.activeRules);
        // Reconfirm identical stored official numbers without rewriting historic rates.
        if(checked?.verifiedAt&&oldRate?.source===checked.source&&['input','output','cacheRead','cacheWrite','cacheWrite5m','cacheWrite1h'].every(k=>(oldRate[k]??null)===(checked[k]??null))&&oldRate.referenceContext===checked.referenceContext){
          oldRate={...oldRate,verifiedAt:checked.verifiedAt,origin:'official-snapshot',...(oldRate.baseRule?{baseRule:{...oldRate.baseRule,verifiedAt:checked.verifiedAt,origin:'official-snapshot'}}:{})};
        }
        const replace=checked?.verifiedAt&&e.timestamp?.slice(0,10)===checked.verifiedAt&&oldRate?.community;
        e.warnings=(e.warnings||[]).filter(w=>!['community-reference-price','short-context-reference-rate'].includes(w));
        e.price=priceEvent(e,this.activeRules,invalidBinding?oldRate:replace?checked:(mappedThis&&oldRate?.resolvedModel!==e.model?null:oldRate));
        if(e.price.binding.rejected)bindingRepairs++;
        else if(priorBinding?.rejected)e.price.binding.rejected=priorBinding.rejected;
        this.dirty=true;
      }
    }
    for(const [k,f] of Object.entries(this.files)){
      if(k.startsWith('antigravity:')){if(f.parserVersion!==5){f.dbSignature=null;this.dirty=true;}}
      else if(f.outputBreakdownVersion!==1||!this.repairs.inputRatesV1){delete this.files[k];this.dirty=true;}
    }
    if(!this.repairs.rateBindingV1){this.repairs.rateBindingV1={at:new Date().toISOString(),checked:this.events.size,repaired:bindingRepairs};this.dirty=true;}
    else if(bindingRepairs){this.repairs.rateBindingV1={...this.repairs.rateBindingV1,lastCheck:new Date().toISOString(),repaired:this.repairs.rateBindingV1.repaired+bindingRepairs};this.dirty=true;}
    if(!this.repairs.inputRatesV1){this.repairs.inputRatesV1=new Date().toISOString();this.dirty=true;}
    if(!this.repairs.outputV1){this.repairs.outputV1=new Date().toISOString();this.dirty=true;}
    if(!this.repairs.pricingV2){this.repairs={...this.repairs,pricingV2:new Date().toISOString(),mappedModels:mapped};this.dirty=true;}

    for(const e of this.events.values())this.metadataPool.event(e);
    if(this.dirty) await this.save();
    return this;
  }
  pricingRules() { return [...this.catalog.rules(this.config.catalogUpdates), ...this.customRules]; }
  async save() {
    this.pendingSaves++;
    const writing=this.saveQueue.catch(()=>{}).then(async()=>{
      for(const e of this.events.values())this.metadataPool.event(e);
      if(this.sourceEvents)for(const e of this.sourceEvents.values())this.metadataPool.event(e);
      // Capture counters/arrays at queue execution. Immutable price metadata may be
      // shared safely instead of deep-copying the full ledger graph for every save.
      const copyEvent=e=>Object.fromEntries(Object.entries(e).map(([k,v])=>[k,Array.isArray(v)?v.slice():v&&typeof v==='object'&&!Object.isFrozen(v)?structuredClone(v):v]));
      const snapshot={version:2,...structuredClone({repairs:this.repairs,files:this.files,tasks:this.tasks}),events:[...this.events.values()].map(copyEvent),
        ...(this.resetBoundary?{resetBoundary:structuredClone(this.resetBoundary),sourceEvents:[...this.sourceEvents.values()].map(copyEvent)}:{})};
      const retirements=[...this.pendingRetirements.values()];this.dirty=false;this.dataVersion++;
      try{
        snapshot.journalSequence=await this.journal.sync((function*(){yield* retirements;yield* snapshot.events;})());
        await require('./json-store').atomicLedger(path.join(this.storageDir,'ledger.json'),snapshot);
        for(const e of retirements)if(this.pendingRetirements.get(e.id)===e)this.pendingRetirements.delete(e.id);
      }catch(e){this.dirty=true;throw e;}
    });
    this.saveQueue=writing;
    try{await writing;}finally{this.pendingSaves--;}
  }
  insert(e) {
    if(!this.resetBoundary)return this._insertRaw(e,this.events);
    const changed=this._insertRaw(e,this.sourceEvents);
    if(!changed)return;
    const raw=this.sourceEvents.get(e.id);if(!raw)return;
    const b=this.resetBaseline.get(raw.id);
    if(!b&&(!raw.timestamp||raw.timestamp<this.resetBoundary.startedAt)) {
      if(!raw.timestamp)this.resetDiagnostics.undated++;else this.resetDiagnostics.lateOld++;
      return;
    }
    const {deltaEvent}=require('./measurements');
    let d=deltaEvent(raw,b);
    if(!d){
      if(!this.events.has(raw.id))return;
      d={...raw};for(const k of ['input','output','normalInput','cacheRead','cacheWrite','cacheWrite5m','cacheWrite1h','cacheWriteUnknown','reasoning','tool','total'])d[k]=0;
      require('./output-breakdown').attachSplit(d,{total:0,thinking:0,source:'reset-zero-correction'});d.price=priceEvent(d,this.activeRules,raw.price?.rate);
    }
    d.resetEpochId=this.resetBoundary.id;d.resetDelta=!!b;
    if(b&&raw.timestamp<this.resetBoundary.startedAt){d.sourceTimestamp=raw.timestamp;d.timestamp=this.resetBoundary.startedAt;d.warnings=[...new Set([...d.warnings,'reset-boundary-observed-delta'])];}
    const old=this.events.get(d.id);d.firstObservedAt=old?.firstObservedAt||new Date().toISOString();
    this.events.set(d.id,this.metadataPool.event(d));this.dirty=true;
  }
  _insertRaw(e, store) {
    ensureSplit(e);
    const fields = ['input','output','normalInput','cacheRead','cacheWrite','cacheWrite5m','cacheWrite1h','cacheWriteUnknown','reasoning','tool','total'];
    if (fields.some(k => !Number.isSafeInteger(e[k]) || e[k] < 0)) { this.scanStats.invalidUsage++; return; }
    if(e.provider==='antigravity'){
      const matches=[...new Set((e.identityKeys||[]).map(k=>this.antigravityAliases.get(k)).filter(Boolean))];
      if(matches.length>1){this.scanStats.invalidUsage++;return;}
      if(matches.length)e.id=matches[0];
    }
    const old = store.get(e.id);
    const parserCorrection=e.provider==='antigravity'&&((e.parserVersion||0)>(old?.parserVersion||0)||this.reanalysingAntigravity);
    if(old&&e.provider==='antigravity'){
      e.identityKeys=[...new Set([...(old.identityKeys||[]),...(e.identityKeys||[])])];
      if(!e.timestamp&&old.timestamp){e.timestamp=old.timestamp;e.warnings=e.warnings.filter(w=>w!=='timestamp-missing');}
      if((e.model==='unknown'||e.model.startsWith('antigravity-model-id-'))&&old.model!=='unknown'&&!old.model.startsWith('antigravity-model-id-')){
        e.model=old.model;e.modelProvider=old.modelProvider;e.effort=old.effort;e.modelResolution=old.modelResolution;e.rawModel=old.rawModel;e.numericModelId=old.numericModelId;
      }
      for(const id of e.identityKeys)this.antigravityAliases.set(id,e.id);
    }
    // Streaming and copied records replace one request. Zeroed or smaller snapshots cannot erase usage.
    const invalidBinding=old?.price?.rate&&require('./pricing').checkRateBinding(old,old.price.rate).status!=='matched';
    const sameIdentity = old && old.model === e.model && old.serviceTier === e.serviceTier && serviceOf(old) === serviceOf(e);
    const sameBuckets = old && fields.every(k => old[k] === e[k]);
    if(old&&sameBuckets&&old.reasoningKnown&&e.outputSplitStatus==='unavailable'&&!String(old.outputSplitSource).startsWith('legacy')){
      for(const k of SPLIT_KEYS)e[k]=old[k];
    }
    const sameSplit=old&&SPLIT_KEYS.every(k=>old[k]===e[k])&&['cacheReadKnown','cacheWriteKnown','contextInputKnown','contextInput','inputEvidence'].every(k=>old[k]===e[k]);
    const ignore = new Set(['short-context-reference-rate','community-reference-price']);
    if (e.provider === 'antigravity' && old) {
      // Stable observations may acquire better IDs/timestamps after another table commits.
      if (old.total > e.total && !parserCorrection) {
        for (const k of [...fields,'reportedOutput','outputEvidence','rawOutputDetails',...SPLIT_KEYS]) if(old[k]!==undefined)e[k] = old[k];
      }
      e.warnings=[...new Set([...(parserCorrection?[]:old.warnings.filter(w=>!ignore.has(w)&&!(w==='timestamp-missing'&&e.timestamp))),...e.warnings])];
      if(!parserCorrection && old.model!=='unknown' && e.model!=='unknown' && !old.model.startsWith('antigravity-model-id-') && !e.model.startsWith('antigravity-model-id-') && old.model!==e.model)e.warnings.push('antigravity-model-conflict');
      const unchanged = sameIdentity && sameSplit && fields.every(k=>old[k]===e[k]) && old.timestamp===e.timestamp &&
        JSON.stringify(old.identityKeys||[])===JSON.stringify(e.identityKeys||[]) &&
        JSON.stringify(old.warnings.filter(w=>!ignore.has(w)))===JSON.stringify(e.warnings.filter(w=>!ignore.has(w)));
      if(unchanged&&!parserCorrection&&!invalidBinding)return;
    } else if (old && !invalidBinding && (old.total > e.total || (sameIdentity && old.timestamp===e.timestamp && sameBuckets && sameSplit && old.warnings.filter(w=>!ignore.has(w)).length <= e.warnings.filter(w=>!ignore.has(w)).length))) return;
    const existingRate = sameIdentity ? require('./pricing').upgradeStoredRate(e,old?.price?.rate,this.activeRules) : null;
    e.price = priceEvent(e, this.activeRules, existingRate);
    if(!e.price.binding.rejected&&old?.price?.binding?.rejected)e.price.binding.rejected=old.price.binding.rejected;
    e.firstObservedAt = old?.firstObservedAt || new Date().toISOString();e.lastObservedAt=new Date().toISOString();
    this.metadataPool.event(e);store.set(e.id, e); if(e.provider==='antigravity')for(const id of e.identityKeys||[])this.antigravityAliases.set(id,e.id); this.scanStats.upserts++; this.dataVersion++; this.dirty = true;return true;
  }
  async walk(root, provider, out, depth = 0) {
    if (depth > this.config.maxDepth) { (this.scanHealth||this.health)[provider].limited = true; return; }
    let entries;
    try { entries = await fs.readdir(root, { withFileTypes: true }); }
    catch (e) { if (e.code !== 'ENOENT') (this.scanHealth||this.health)[provider].errors++; return; }
    if (depth === 0) (this.scanHealth||this.health)[provider].rootsFound++;
    for (const d of entries) {
      if (out.length >= this.config.maxFiles) { (this.scanHealth||this.health)[provider].limited = true; return; }
      if (d.isSymbolicLink()) continue;
      const full = path.join(root, d.name);
      if (d.isDirectory() && !['node_modules','.git','checkpoints','bin'].includes(d.name)) await this.walk(full, provider, out, depth + 1);
      else if (d.isFile() && provider === 'antigravity') { if(d.name.endsWith('.db'))out.push({file:full,provider}); else if(d.name.endsWith('.pb'))(this.scanHealth||this.health)[provider].legacyFiles=((this.scanHealth||this.health)[provider].legacyFiles||0)+1; }
      else if (d.isFile() && (provider === 'gemini' ? (/^session-.*\.(json|jsonl)$/.test(d.name) || (d.name.endsWith('.jsonl') && path.basename(path.dirname(root)) === 'chats')) : d.name.endsWith('.jsonl'))) out.push({ file: full, provider });
    }
  }
  processRow(row, state) {
    try { for (const e of parse(state.provider, row, state)) this.insert(e); }
    catch { this.scanStats.invalidUsage++; state.invalidUsage = (state.invalidUsage || 0) + 1; }
  }
  async readLines(file, checkpoint, size) {
    if (size <= checkpoint.offset) return;
    const stream = fss.createReadStream(file, { start: checkpoint.offset, end: size - 1, highWaterMark: 64*1024 });
    let buffer = Buffer.alloc(0), consumed = checkpoint.offset, skipping = false;
    for await (const chunk of stream) {
      this.scanStats.bytesRead += chunk.length;
      buffer = buffer.length ? Buffer.concat([buffer, chunk]) : chunk;
      let nl;
      while ((nl = buffer.indexOf(10)) >= 0) {
        const line = buffer.subarray(0,nl); consumed += nl + 1; buffer = buffer.subarray(nl + 1);
        if (skipping) { skipping = false; checkpoint.offset = consumed; continue; }
        if (line.length > MAX_LINE) { this.scanStats.oversizedLines++; checkpoint.offset = consumed; continue; }
        if (line.length) {
          try { this.processRow(JSON.parse(line.toString('utf8')), checkpoint.state); }
          catch { this.scanStats.invalidJson++; checkpoint.state.invalidJson = (checkpoint.state.invalidJson || 0) + 1; }
        }
        checkpoint.offset = consumed;
      }
      if (buffer.length > MAX_LINE) { consumed += buffer.length; buffer = Buffer.alloc(0); skipping = true; this.scanStats.oversizedLines++; }
    }
    // Do not persist an incomplete line, which may include prompt text. Reread it on the next scan.
    // A huge unfinished line is retried; the memory cap remains bounded by MAX_LINE + one chunk.
    checkpoint.pendingBytes = size - checkpoint.offset;
  }
  async readAntigravity(file) {
    const {readDatabase,signature,safeError}=require('./antigravity-db');
    const key='antigravity:'+file, old=this.files[key], h=(this.scanHealth||this.health).antigravity;
    const apply=(c)=>{
      h.backend=c.backend; h.readableDatabases=(h.readableDatabases||0)+1;
      for(const k of ['generationRows','stepRows','usageRows','invalidRows','ambiguousStepRows','unknownTime','uniqueGenerations','matchedStepObservations','standaloneSteps','reusedRequestKeys','reusedGroupIds','emittedEvents'])h[k]=(h[k]||0)+(c.dbStats?.[k]||0);
      if(c.partial)h.partial=true;
    };
    try{
      const sig=await signature(file);
      if(old?.dbSignature===sig&&old.parserVersion===5&&!this.repairSessions?.has('antigravity:'+path.basename(file,'.db'))){apply(old);return;}
      const r=await readDatabase(file);
      const repaired=await require('./identity-repair').repairSession(this,r,'antigravity:'+path.basename(file,'.db'));
      const accountingRepaired=await require('./identity-repair').repairSession(this,r,'antigravity:'+path.basename(file,'.db'),'accountingV2');
      if(!repaired&&!accountingRepaired){
        for(const e of r.events)this.insert(e);
      }
      for(const kind of ['identityV4','accountingV2']){
        const plan=this.repairs[kind]?.sessions?.['antigravity:'+path.basename(file,'.db')];
        if(plan?.status==='pending-durable-rebuild'&&!r.partial){
          plan.status=plan.timeReconstructedBaselines?'repaired-boundary-qualified':'repaired';
          plan.active=require('./reliability').sum([...this.events.values()].filter(e=>e.sessionId===plan.sessionId));
          plan.notice='중단된 복구를 원본 DB에서 재수집해 완료했습니다. 과거 경계 재구성 한계는 유지됩니다.';this.dirty=true;
        }
      }
      const state={provider:'antigravity',sessionId:path.basename(file,'.db'),model:r.latest?.model||'',modelProvider:r.latest?.modelProvider||'',effort:r.latest?.effort||'',role:'unknown',lastTime:r.latest?.timestamp||null};
      const checkpoint={parserVersion:5,state,dbSignature:r.signature,dbStats:r.stats,partial:r.partial,backend:r.backend,lastReadAt:new Date().toISOString()};
      this.files[key]=checkpoint;this.dirty=true;apply(checkpoint);
    }catch(e){
      h.errors++;h.partial=true;
      const code=safeError(e);h.errorCodes=[...new Set([...(h.errorCodes||[]),code])];
      // Preserve past observations and retry a locked/unknown schema next scan; never convert it to zero.
    }
  }
  async readFile(file, provider) {
    if(provider==='antigravity')return this.readAntigravity(file);
    let st;
    try { st = await fs.lstat(file); } catch { (this.scanHealth||this.health)[provider].errors++; return; }
    if (!st.isFile() || st.isSymbolicLink()) return;
    const key = `${provider}:${file}`;
    let c = this.files[key];
    if (c && c.size === st.size && c.mtime === st.mtimeMs && !c.pendingBytes) return;
    if (!c || c.inode !== `${st.dev}:${st.ino}` || st.size < c.offset || (st.size === c.size && st.mtimeMs !== c.mtime)) {
      c = { outputBreakdownVersion:1, offset: 0, state: initial(provider,file), inode: `${st.dev}:${st.ino}`, size: 0, mtime: 0 };
    }
    try {
      if (file.endsWith('.json')) {
        if (st.size > 64*1024*1024) { (this.scanHealth||this.health)[provider].oversizedFiles++; return; }
        const content = await fs.readFile(file,'utf8'); this.scanStats.bytesRead += Buffer.byteLength(content);
        this.processRow(JSON.parse(content), c.state); c.offset = st.size; c.pendingBytes = 0;
      } else await this.readLines(file,c,st.size);
      c.size = st.size; c.mtime = st.mtimeMs; this.files[key] = c; this.dirty = true;
    } catch { (this.scanHealth||this.health)[provider].errors++; }
  }
  async scan() {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this._scan().finally(() => { this.inFlight = null; this.scanning = false; });
    return this.inFlight;
  }
  async _scan() {
    this.scanning = true;
    const start = Date.now(); this.warnings = [];
    this.resetDiagnostics={lateOld:0,undated:0};
    this.scanStats = { bytesRead: 0, upserts: 0, invalidJson: 0, invalidUsage: 0, oversizedLines: 0 };
    try { this.config = validate(await readJson(path.join(this.dataDir,'config.json'), {})); }
    catch (e) { this.warnings.push(e.message + ' · 직전 정상 설정 유지'); }
    try {
      const next = validateRules(await readJson(path.join(this.dataDir,'prices.user.json'), {rules:[]}));
      this.customRules = next;
      const active = this.pricingRules();
      const nextHash = hash(JSON.stringify(active));
      if (nextHash !== this.rulesHash) {
        this.activeRules = active; this.rulesHash = nextHash;
        // Only requests without any rate are repriced. Even partially known historic rates stay frozen.
        for (const e of this.events.values()) if (!e.price.rate) { e.price = priceEvent(e, active); this.dirty = true; }
      }
    } catch (e) { this.warnings.push(e.message + ' · 직전 정상 단가 유지'); }
    this.scanHealth = Object.fromEntries(PROVIDERS.map(p => [p, { rootsFound: 0, files: 0, errors: 0, oversizedFiles: 0, limited: false }]));
    // A stable file signature must never suppress a required identity/accounting repair.
    this.repairSessions=new Set();
    for(const e of (this.sourceEvents||this.events).values())if(e.provider==='antigravity'&&(e.identityVersion!==4||e.accountingVersion!==2))this.repairSessions.add(e.sessionId);
    for(const kind of ['identityV4','accountingV2'])for(const [id,r] of Object.entries(this.repairs[kind]?.sessions||{}))if(r.status==='pending-durable-rebuild')this.repairSessions.add(id);
    const found = [];
    for (const p of PROVIDERS) for (const root of this.config.roots[p]) {
      // Refuse root symlinks too, so a configured tree does not escape through symlink traversal.
      try { if ((await fs.lstat(root)).isSymbolicLink()) { this.scanHealth[p].errors++; continue; } } catch (e) { if (e.code !== 'ENOENT') this.scanHealth[p].errors++; continue; }
      await this.walk(root,p,found);
    }
    const unique = new Map(found.map(x => [`${x.provider}:${x.file}`,x]));
    for (const {file,provider} of unique.values()) { (this.scanHealth||this.health)[provider].files++; await this.readFile(file,provider); }
    const ah=(this.scanHealth||this.health).antigravity;
    ah.observedRecords=[...this.events.values()].filter(e=>e.provider==='antigravity').length;
    ah.unrepairedAccountingRecords=[...(this.sourceEvents||this.events).values()].filter(e=>e.provider==='antigravity'&&e.identityVersion===4&&e.accountingVersion!==2).length;
    ah.recoveryPending=['identityV4','accountingV2'].some(k=>Object.values(this.repairs[k]?.sessions||{}).some(r=>r.status==='pending-durable-rebuild'));
    ah.boundaryUncertain=['identityV4','accountingV2'].reduce((n,k)=>n+Object.values(this.repairs[k]?.sessions||{}).reduce((m,r)=>m+(r.unknownObservationBoundary||0),0),0);
    if(ah.unrepairedAccountingRecords||ah.recoveryPending||ah.boundaryUncertain)ah.partial=true;
    ah.status=ah.errors||ah.partial?'partial':ah.observedRecords?(ah.files?'observed':'history-only'):ah.files?(this.resetBoundary?'reset-waiting':'no-usage'):ah.legacyFiles?'legacy-only':'not-found';
    ah.readOnly=true;
    if(ah.errors)this.warnings.push('Antigravity DB 일부 읽기 실패: '+(ah.errorCodes||[]).join(', ')+' · 이전 관측값 유지');
    if(ah.reusedRequestKeys)this.warnings.push(`Antigravity 요청 식별자 재사용 ${ah.reusedRequestKeys}개: 서로 다른 generation은 보존하고 모호한 step은 제외`);
    if((this.sourceEvents||this.events).size>=10000)this.warnings.push('대형 장부: 전체 JSON 저장소는 메모리와 재시작 비용이 큽니다. 수집 상태·디스크 공간을 확인하세요.');
    const legacyCount=[...(this.sourceEvents||this.events).values()].filter(require('./identity-repair').isLegacy).length;
    if(legacyCount)this.warnings.push(`Antigravity 구버전 병합 기록 ${legacyCount}개 복구 대기: 원본 DB를 읽기 전에는 정확한 총량이 아닙니다.`);
    if(ah.unrepairedAccountingRecords)this.warnings.push(`Antigravity 0.10.0 중복 가능 기록 ${ah.unrepairedAccountingRecords}개 재분석 대기: 원본 DB와 장부를 대조하세요.`);
    if(ah.boundaryUncertain)this.warnings.push(`Antigravity 초기화 경계 사용량 시각 미확인 ${ah.boundaryUncertain}건: 원본 관측 시점이 없어 정확한 증가분을 확정할 수 없습니다.`);
    if(['identityV4','accountingV2'].some(k=>Object.values(this.repairs[k]?.sessions||{}).some(r=>r.status==='pending-durable-rebuild')))this.warnings.push('Antigravity 복구 저장이 중단된 기록이 있습니다. 원본 재분석과 장부 대조가 필요합니다.');
    if(['identityV4','accountingV2'].some(k=>Object.values(this.repairs[k]?.sessions||{}).some(r=>r.timeReconstructedBaselines)))this.warnings.push('Antigravity 과거 초기화 경계 일부는 요청 시각으로 재구성됨: 당시 진행 중 사용량은 완전 복원 불가');
    if(ah.invalidRows||ah.ambiguousStepRows)this.warnings.push(`Antigravity 스키마/중복 판정 미확정: 잘못된 행 ${ah.invalidRows||0}, 식별자 없는 step ${ah.ambiguousStepRows||0} · 일부 집계`);
    if(ah.legacyFiles)this.warnings.push(`Antigravity 구형 .pb ${ah.legacyFiles}개: 이 버전의 SQLite 수집 범위 밖`);
    if(!this.resetBoundary&&ah.files&&!ah.observedRecords&&!ah.errors)this.warnings.push('Antigravity DB는 발견했으나 지원되는 토큰 사용량이 없습니다. 사용량 0으로 확인된 것이 아닙니다.');
    if (this.scanStats.invalidJson) this.warnings.push(`읽을 수 없는 완료 JSONL 행 ${this.scanStats.invalidJson}개 (내용 저장 안 함)`);
    if (this.scanStats.invalidUsage) this.warnings.push(`지원되지 않거나 잘못된 사용량 ${this.scanStats.invalidUsage}개`);
    if (this.scanStats.oversizedLines) this.warnings.push(`16MiB 초과 로그 행 ${this.scanStats.oversizedLines}개 제외`);
    const resets = Object.values(this.files).reduce((sum,c) => sum+(c.state.counterResets||0),0);
    if (resets) this.warnings.push(`누적 카운터 감소 ${resets}회 감지: 재기준화 경계의 사용량은 누락될 수 있음`);
    const missingIds = Object.values(this.files).reduce((n,c) => n+(c.state.missingIds||0),0);
    const pastInvalid = Object.values(this.files).reduce((n,c) => n+(c.state.invalidJson||0)+(c.state.invalidUsage||0),0);
    if (missingIds) this.warnings.push(`요청 ID 없는 기록 ${missingIds}개 제외`);
    if (pastInvalid) this.warnings.push(`누적 파싱 오류 ${pastInvalid}개: 일부 기록이 집계되지 않음`);
    if(this.resetBoundary&&this.resetDiagnostics.undated)this.warnings.push('전체 초기화 이후 시각 없는 '+this.resetDiagnostics.undated+'개 원본 요청 제외: 발생 시점 확인 불가');
    this.health=this.scanHealth;this.scanHealth=null;
    this.updatedAt = new Date().toISOString(); this.scanStats.durationMs = Date.now()-start;
    if (this.dirty) await this.save();
    return this;
  }
  async resetAll(raw,options){return require('./data-reset').resetAll(this,raw,options);}
  async reanalyseAntigravity(){
    if(this.inFlight)await this.inFlight;
    for(const [key,c] of Object.entries(this.files))if(key.startsWith('antigravity:')){c.dbSignature=null;c.parserVersion=0;}
    this.reanalysingAntigravity=true;try{await this.scan();}finally{this.reanalysingAntigravity=false;}return {ok:true,health:this.health.antigravity,repairs:this.repairs};
  }
  async ingest(row) {
    const e = require('./generic').normalize(row);
    this.insert(e); this.updatedAt = new Date().toISOString();
    if(this.dirty) await this.save();
    return {id:e.id, stored:!!this.events.get(e.id), total:this.events.get(e.id)?.total};
  }
  async startTask(name, projectId = '') {
    if (this.tasks.some(t => !t.end)) throw new Error('진행 중인 작업을 먼저 종료하세요.');
    const { text } = require('./util');
    const clean = text(name,120).trim(); if (!clean) throw new Error('작업 이름이 필요합니다.');
    const task = { id: require('node:crypto').randomUUID(), name: clean, projectId: text(projectId,200), start: new Date().toISOString(), end: null };
    this.tasks.push(task); this.dirty = true; await this.save(); return task;
  }
  async stopTask() { const t = this.tasks.find(t => !t.end); if (!t) throw new Error('진행 중인 작업이 없습니다.'); t.end = new Date().toISOString(); this.dirty = true; await this.save(); return t; }
}
module.exports = { Collector, MAX_LINE };
