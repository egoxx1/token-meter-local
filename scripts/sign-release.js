#!/usr/bin/env node
'use strict';
// Operator-only tool. A private key is supplied externally and is never bundled.
const fs=require('node:fs/promises'),crypto=require('node:crypto'),path=require('node:path');
const {parseArgs}=require('node:util');
const {inspectVsix,verifyManifest,IDENTITY}=require('../src/updates');
async function main(){
  const {values:v}=parseArgs({options:{vsix:{type:'string'},version:{type:'string'},url:{type:'string'},key:{type:'string'},out:{type:'string'},days:{type:'string',default:'30'},help:{type:'boolean'}}});
  if(v.help){console.log('node scripts/sign-release.js --vsix release.vsix --version 0.3.1 --url https://YOUR-HOST/0.3.1.vsix --key /secure/private.pem --out latest.json [--days 30]');return;}
  for(const k of ['vsix','version','url','key','out'])if(!v[k])throw Error('--'+k+' 필요');
  const days=Number(v.days);if(!Number.isInteger(days)||days<1||days>90)throw Error('--days: 1~90');
  const bytes=await fs.readFile(v.vsix);inspectVsix(bytes,v.version);
  const privateKey=crypto.createPrivateKey(await fs.readFile(v.key));if(privateKey.asymmetricKeyType!=='ed25519')throw Error('Ed25519 개인키 필요');
  const now=Date.now(),manifest={schema:1,extensionId:IDENTITY,version:v.version,publishedAt:new Date(now).toISOString(),expiresAt:new Date(now+days*86400000).toISOString(),assets:{vsix:{url:v.url,size:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')}}};
  const payload=Buffer.from(JSON.stringify(manifest)),envelope={payload:payload.toString('base64'),signature:crypto.sign(null,payload,privateKey).toString('base64')};
  const publicKey=crypto.createPublicKey(privateKey).export({type:'spki',format:'pem'});
  verifyManifest(envelope,{publicKey,allowedHosts:[new URL(v.url).hostname]},'0.0.0','0.0.0');
  await fs.writeFile(path.resolve(v.out),JSON.stringify(envelope,null,2)+'\n',{mode:0o644});
  console.log('Signed manifest written: '+path.resolve(v.out));console.log('Distribute this PUBLIC key through a trusted independent channel:\n'+publicKey);
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
