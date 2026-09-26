'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
function walk(p){return fs.readdirSync(p,{withFileTypes:true}).flatMap(d=>d.isDirectory()&&!['node_modules','dist'].includes(d.name)?walk(path.join(p,d.name)):d.isFile()?[path.join(p,d.name)]:[]);}
const files=walk(root).filter(f=>/\.m?js$/.test(f));for(const file of files){const r=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});if(r.status!==0){process.stderr.write(r.stderr);process.exit(r.status||1);}}
const manifest=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
for(const entry of [manifest.main,manifest.bin['token-meter']])if(!fs.existsSync(path.join(root,entry)))throw new Error('Missing entry point: '+entry);
const template=fs.readFileSync(path.join(root,'web/index.html'),'utf8');if(!template.includes('data-ui-version="'+manifest.version+'"'))throw new Error('Dashboard/manifest version mismatch');
if(Object.keys(manifest.dependencies||{}).length)throw new Error('Runtime is intended to have zero external dependencies');
console.log(`${files.length} JavaScript files syntax-checked; package entry points valid; zero runtime dependencies.`);
