'use strict';
// Release data and executable updates are intentionally separate from the price catalog.
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib');
const {getJson,getBytes,checkedUrl}=require('./network');
const {readJson,atomicJson,text}=require('./util');
const PKG=require('../package.json'),IDENTITY=PKG.publisher+'.'+PKG.name;
function compareVersions(a,b){
  const parse=v=>{if(typeof v!=='string'||!/^\d{1,6}\.\d{1,6}\.\d{1,6}$/.test(v))throw new Error('정식 x.y.z 버전만 지원합니다.');return v.split('.').map(Number);};
  const x=parse(a),y=parse(b);for(let i=0;i<3;i++)if(x[i]!==y[i])return x[i]>y[i]?1:-1;return 0;
}
function fingerprint(key){return crypto.createHash('sha256').update(crypto.createPublicKey(key).export({type:'spki',format:'der'})).digest('hex');}
function verifyManifest(envelope,config,current=PKG.version,highest=current,now=Date.now()){
  if(!envelope||typeof envelope.payload!=='string'||envelope.payload.length>180000||typeof envelope.signature!=='string'||!/^[A-Za-z0-9+/]+={0,2}$/.test(envelope.payload)||!/^[A-Za-z0-9+/]+={0,2}$/.test(envelope.signature))throw new Error('서명된 업데이트 봉투 형식 오류');
  const bytes=Buffer.from(envelope.payload,'base64'),signature=Buffer.from(envelope.signature,'base64'),key=crypto.createPublicKey(config.publicKey);
  if(key.asymmetricKeyType!=='ed25519'||signature.length!==64||!crypto.verify(null,bytes,key,signature))throw new Error('업데이트 Ed25519 서명 검증 실패');
  const m=JSON.parse(bytes.toString('utf8'));
  if(m.schema!==1||m.extensionId!==IDENTITY)throw new Error('다른 확장 또는 지원하지 않는 manifest');
  if(compareVersions(m.version,current)<0||compareVersions(m.version,highest)<0)throw new Error('다운그레이드/오래된 manifest 거부');
  const published=Date.parse(m.publishedAt),expires=Date.parse(m.expiresAt);
  if(!Number.isFinite(published)||!Number.isFinite(expires)||published>now+300000||expires<=now||expires<=published||expires-published>90*86400000)throw new Error('업데이트 유효기간 오류 또는 만료');
  const a=m.assets?.vsix;
  if(!a||!Number.isSafeInteger(a.size)||a.size<100||a.size>32*1024*1024||typeof a.sha256!=='string'||!/^[a-f0-9]{64}$/.test(a.sha256))throw new Error('VSIX 크기/해시 오류');
  checkedUrl(a.url,config.allowedHosts);
  return {schema:1,extensionId:IDENTITY,version:m.version,publishedAt:m.publishedAt,expiresAt:m.expiresAt,assets:{vsix:{url:a.url,size:a.size,sha256:a.sha256}}};
}
function inspectVsix(bytes,version){
  // Read only the bounded package manifest; never extract an untrusted archive.
  let end=-1;for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(bytes.readUInt32LE(i)===0x06054b50){end=i;break;}
  if(end<0||bytes.readUInt16LE(end+4)||bytes.readUInt16LE(end+6))throw new Error('지원하지 않는 ZIP');
  const entries=bytes.readUInt16LE(end+10),centralSize=bytes.readUInt32LE(end+12),offset=bytes.readUInt32LE(end+16);
  if(!entries||entries>20000||offset+centralSize>end)throw new Error('ZIP 중앙 디렉터리 오류');
  let pos=offset,manifest=null;const names=new Set();
  for(let i=0;i<entries;i++){
    if(pos+46>offset+centralSize||bytes.readUInt32LE(pos)!==0x02014b50)throw new Error('ZIP 항목 오류');
    const flags=bytes.readUInt16LE(pos+8),method=bytes.readUInt16LE(pos+10),compressed=bytes.readUInt32LE(pos+20),size=bytes.readUInt32LE(pos+24),nl=bytes.readUInt16LE(pos+28),el=bytes.readUInt16LE(pos+30),cl=bytes.readUInt16LE(pos+32),local=bytes.readUInt32LE(pos+42);
    if(pos+46+nl+el+cl>offset+centralSize)throw new Error('ZIP 범위 오류');
    const name=bytes.subarray(pos+46,pos+46+nl).toString('utf8');
    if(names.has(name)||name.includes('\\')||name.startsWith('/')||name.split('/').includes('..'))throw new Error('위험하거나 중복된 ZIP 경로');names.add(name);
    if(name==='extension/package.json'){
      if(flags&1||![0,8].includes(method)||size>65536||compressed>65536||local+30>offset||bytes.readUInt32LE(local)!==0x04034b50)throw new Error('패키지 manifest 압축 오류');
      const start=local+30+bytes.readUInt16LE(local+26)+bytes.readUInt16LE(local+28);
      if(start+compressed>offset)throw new Error('패키지 범위 오류');
      const raw=bytes.subarray(start,start+compressed),data=method===8?zlib.inflateRawSync(raw,{maxOutputLength:65536}):raw;
      if(data.length!==size)throw new Error('패키지 크기 불일치');manifest=JSON.parse(data.toString('utf8'));
    }
    pos+=46+nl+el+cl;
  }
  if(!manifest||manifest.publisher+'.'+manifest.name!==IDENTITY||manifest.version!==version||!names.has('extension.vsixmanifest')||typeof manifest.main!=='string'||!names.has('extension/'+manifest.main.replace(/^\.\//,'')))throw new Error('패키지 이름/게시자/버전/진입점 불일치');
  return manifest;
}
class Updates{
  constructor(dir,{json=getJson,bytes=getBytes}={}){this.dir=dir;this.file=path.join(dir,'updates.json');this.json=json;this.bytes=bytes;this.state={version:1};this.inFlight=null;this.downloading=null;}
  async init(){try{const s=await readJson(this.file,null);if(s?.version===1){if(s.highestVersion)compareVersions(s.highestVersion,PKG.version);if(s.manifest)compareVersions(s.manifest.version,PKG.version);this.state=s;}}catch(e){this.state.error=text(e.message);}return this;}
  status(config){return {enabled:config.enabled,configured:!!(config.manifestUrl&&config.publicKey),currentVersion:PKG.version,lastAttempt:this.state.lastAttempt||null,lastSuccess:this.state.lastSuccess||null,error:this.state.error||null,available:this.state.manifest&&compareVersions(this.state.manifest.version,PKG.version)>0?this.state.manifest.version:null,staged:this.state.staged?{version:this.state.staged.version}:null,busy:!!(this.inFlight||this.downloading),autoDownload:config.autoDownload};}
  async check(config,force=false){if(this.inFlight)return this.inFlight;this.inFlight=this._check(config,force).finally(()=>{this.inFlight=null;});return this.inFlight;}
  async _check(config,force){
    if(!config.enabled&&!force)return this.status(config);
    if(!config.manifestUrl||!config.publicKey)throw new Error('config.json에 신뢰한 배포 URL/공개키를 먼저 설정하세요. 공개 배포처는 아직 등록되지 않았습니다.');
    if(!force&&this.state.lastAttempt&&Date.now()-Date.parse(this.state.lastAttempt)<config.intervalHours*3600000)return this.status(config);
    const now=new Date().toISOString();
    try{
      checkedUrl(config.manifestUrl,config.allowedHosts);const fp=fingerprint(config.publicKey),same=fp===this.state.fingerprint;
      const response=await this.json(config.manifestUrl,{hosts:config.allowedHosts,maxBytes:256*1024});
      const m=verifyManifest(response.data,config,PKG.version,same?this.state.highestVersion||PKG.version:PKG.version);
      this.state={version:1,fingerprint:fp,highestVersion:m.version,manifest:m,envelope:response.data,lastAttempt:now,lastSuccess:now,error:null,staged:same&&this.state.staged?.version===m.version?this.state.staged:null};
      await atomicJson(this.file,this.state);
      if(config.autoDownload&&compareVersions(m.version,PKG.version)>0){try{await this.verifiedPath(config);}catch{await this.download(config);}}
    }catch(e){this.state.error=text(e.message,300);this.state.lastAttempt=now;await atomicJson(this.file,this.state);}
    return this.status(config);
  }
  async download(config){if(this.downloading)return this.downloading;this.downloading=this._download(config).finally(()=>{this.downloading=null;});return this.downloading;}
  async _download(config){
    const m=verifyManifest(this.state.envelope,config,PKG.version,this.state.highestVersion||PKG.version);
    if(compareVersions(m.version,PKG.version)<=0)throw new Error('더 새로운 정식 버전이 없습니다.');
    const a=m.assets.vsix,response=await this.bytes(a.url,{hosts:config.allowedHosts,maxBytes:32*1024*1024,timeoutMs:30000}),bytes=response.bytes;
    if(!Buffer.isBuffer(bytes)||bytes.length!==a.size||crypto.createHash('sha256').update(bytes).digest('hex')!==a.sha256)throw new Error('다운로드 크기/SHA-256 검증 실패');
    inspectVsix(bytes,m.version);
    const dir=path.join(this.dir,'updates');await fs.mkdir(dir,{recursive:true,mode:0o700});const file=path.join(dir,PKG.name+'-'+m.version+'.vsix'),tmp=file+'.'+crypto.randomUUID()+'.tmp';
    await fs.writeFile(tmp,bytes,{mode:0o600,flag:'wx'});await fs.rename(tmp,file);
    this.state.staged={version:m.version,file,sha256:a.sha256};this.state.error=null;await atomicJson(this.file,this.state);
    return {version:m.version,ready:true};
  }
  async verifiedPath(config){
    const m=verifyManifest(this.state.envelope,config,PKG.version,this.state.highestVersion||PKG.version),s=this.state.staged;
    if(!s||s.version!==m.version)throw new Error('검증된 업데이트 파일을 먼저 다운로드하세요.');
    const expected=path.join(this.dir,'updates',PKG.name+'-'+m.version+'.vsix');if(s.file!==expected)throw new Error('업데이트 저장 경로 불일치');
    const stat=await fs.lstat(expected);if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==m.assets.vsix.size)throw new Error('업데이트 파일이 변경되었습니다.');
    const b=await fs.readFile(expected);if(crypto.createHash('sha256').update(b).digest('hex')!==m.assets.vsix.sha256)throw new Error('설치 직전 SHA-256 검증 실패');inspectVsix(b,m.version);return {path:expected,version:m.version};
  }
}
module.exports={Updates,compareVersions,verifyManifest,inspectVsix,fingerprint,IDENTITY};
