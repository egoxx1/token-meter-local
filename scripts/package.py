"""Build an unsigned local VSIX and full source ZIP with Python standard library."""
from pathlib import Path
import zipfile,json,hashlib,xml.etree.ElementTree as ET,argparse
root=Path(__file__).resolve().parent.parent
parser=argparse.ArgumentParser();parser.add_argument('--out',default=str(root/'dist'));args=parser.parse_args()
out=Path(args.out).resolve();out.mkdir(parents=True,exist_ok=True)
pkg=json.loads((root/'package.json').read_text());stem=f"{pkg['name']}-{pkg['version']}"
vsix=out/(stem+'.vsix');source=out/(stem+'-source.zip')
ns='http://schemas.microsoft.com/developer/vsx-schema/2011'
ET.register_namespace('',ns)
def el(parent,tag,attributes=None,text=None):
    obj=ET.SubElement(parent,'{'+ns+'}'+tag,attributes or {})
    if text is not None:obj.text=text
    return obj
manifest=ET.Element('{'+ns+'}PackageManifest',{'Version':'2.0.0'})
metadata=el(manifest,'Metadata');el(metadata,'Identity',{'Language':'en-US','Id':pkg['name'],'Version':pkg['version'],'Publisher':pkg['publisher']})
el(metadata,'DisplayName',text=pkg['displayName']);el(metadata,'Description',{'{http://www.w3.org/XML/1998/namespace}space':'preserve'},pkg['description'])
el(metadata,'Tags',text='tokens,codex,claude,antigravity,gemini,usage');el(metadata,'Categories',text='Other');el(metadata,'GalleryFlags',text='Public');el(metadata,'License',text='extension/LICENSE')
properties=el(metadata,'Properties')
for key,value in {'Microsoft.VisualStudio.Code.Engine':pkg['engines']['vscode'],'Microsoft.VisualStudio.Code.ExtensionDependencies':'','Microsoft.VisualStudio.Code.ExtensionPack':'','Microsoft.VisualStudio.Code.ExtensionKind':'workspace','Microsoft.VisualStudio.Code.ExecutesCode':'true','Microsoft.VisualStudio.Code.LocalizedLanguages':'','Microsoft.VisualStudio.Code.EnabledApiProposals':'','Microsoft.VisualStudio.Code.PreRelease':'false'}.items():el(properties,'Property',{'Id':key,'Value':value})
installation=el(manifest,'Installation');el(installation,'InstallationTarget',{'Id':'Microsoft.VisualStudio.Code'})
el(manifest,'Dependencies');assets=el(manifest,'Assets')
for typ,p in [('Microsoft.VisualStudio.Code.Manifest','extension/package.json'),('Microsoft.VisualStudio.Services.Content.Details','extension/README.md'),('Microsoft.VisualStudio.Services.Content.License','extension/LICENSE'),('Microsoft.VisualStudio.Services.Content.Changelog','extension/CHANGELOG.md')]:el(assets,'Asset',{'Type':typ,'Path':p,'Addressable':'true'})
manifest_bytes=ET.tostring(manifest,encoding='utf-8',xml_declaration=True)
ctns='http://schemas.openxmlformats.org/package/2006/content-types'
ct=ET.Element('Types',{'xmlns':ctns})
for extension,mime in {'json':'application/json','js':'application/javascript','html':'text/html','css':'text/css','md':'text/markdown','png':'image/png','txt':'text/plain','tap':'text/plain','py':'text/x-python','vsixmanifest':'text/xml'}.items():ET.SubElement(ct,'Default',{'Extension':extension,'ContentType':mime})
ET.SubElement(ct,'Override',{'PartName':'/extension/LICENSE','ContentType':'text/plain'})
all_files=[]
for p in root.rglob('*'):
    if not p.is_file():continue
    rel=p.relative_to(root)
    if any(x in {'dist','node_modules','.git','__pycache__'} for x in rel.parts):continue
    if p.suffix in {'.tmp','.vsix','.zip','.pyc'}:continue
    if out in p.parents:continue
    if p.name == '.env' or p.name.startswith('.env.'):raise RuntimeError('Refuse bundling environment secrets')
    if 'usage-log' in rel.parts or 'data-epochs' in rel.parts:raise RuntimeError('Refuse bundling private usage journal')
    if p.name.startswith('ledger.pre-') or p.name in {'identity-repair-plans.json','accounting-repair-plans.json','active-data.json','epoch.json','runtime.json','ledger.json','collector.lock','measurements.json','measurements.backup.json'}:raise RuntimeError('Refuse bundling private runtime state')
    all_files.append((p,rel.as_posix()))
with zipfile.ZipFile(vsix,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
    z.writestr('extension.vsixmanifest',manifest_bytes);z.writestr('[Content_Types].xml',ET.tostring(ct,encoding='utf-8',xml_declaration=True))
    for p,rel in all_files:
        if rel.startswith(('src/','bin/','web/','docs/','data/')) or rel in {'package.json','README.md','LICENSE','CHANGELOG.md'}:z.write(p,'extension/'+rel)
with zipfile.ZipFile(source,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
    for p,rel in all_files:z.write(p,'token-meter/'+rel)
with zipfile.ZipFile(vsix) as z:
    assert z.testzip() is None;ET.fromstring(z.read('extension.vsixmanifest'));ET.fromstring(z.read('[Content_Types].xml'))
    m=json.loads(z.read('extension/package.json'));assert m['version']==pkg['version'];assert 'extension/src/extension.js' in z.namelist()
    for asset in manifest.findall('.//{'+ns+'}Asset'):assert asset.attrib['Path'] in z.namelist()
with zipfile.ZipFile(source) as z:assert z.testzip() is None
checksums=''.join(hashlib.sha256(p.read_bytes()).hexdigest()+'  '+p.name+'\n' for p in (vsix,source))
(out/'SHA256SUMS.txt').write_text(checksums)
for p in (vsix,source):print(f'{p.name}: {p.stat().st_size:,} bytes')
print('Archive CRCs, XML, assets and manifest entry points validated. Actual VS Code installation still requires on-device verification.')
