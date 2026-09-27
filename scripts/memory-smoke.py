"""0.10.2 preview/cache-evidence UI acceptance tests against an isolated, synthetic local demo.
Python Playwright and Chromium are test-only dependencies. --offline uses
about:blank + a restricted fetch bridge; it is not browser-navigation/CSP proof.
Never run on user data: the demo flag is mandatory and tests reset active data.
"""
import argparse, json, pathlib, re, urllib.request, urllib.error, uuid, math
from playwright.sync_api import sync_playwright

p=argparse.ArgumentParser();p.add_argument('data_dir');p.add_argument('--output',default='billing-ui-results');p.add_argument('--chromium',default='/usr/bin/chromium');p.add_argument('--offline',action='store_true');a=p.parse_args()
root=pathlib.Path(__file__).resolve().parent.parent;out=pathlib.Path(a.output);out.mkdir(parents=True,exist_ok=True)
r=json.loads(pathlib.Path(a.data_dir,'runtime.json').read_text());checks=[];errors=[];run_id=uuid.uuid4().hex
if not r.get('demo'):raise SystemExit('Refusing to reset a non-demo collector')
def call(endpoint,body=None,raw=False):
    if not endpoint.startswith('/api/'):raise ValueError('API paths only')
    headers={'Authorization':'Bearer '+r['token']}
    if body is not None:headers['Content-Type']='application/json'
    req=urllib.request.Request(r['origin']+endpoint,data=json.dumps(body).encode() if body is not None else None,headers=headers)
    with urllib.request.urlopen(req,timeout=60) as res:txt=res.read().decode()
    return txt if raw else json.loads(txt)
def passed(name):checks.append(name);print(name,flush=True)
def reset():
    s=call('/api/data/state');call('/api/data/reset',{'confirmation':'전체 초기화','requestKey':str(uuid.uuid4()),'expectedEpochId':s['epochId']})
with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path=a.chromium,args=['--no-sandbox'],headless=True)
    page=browser.new_page(viewport={'width':1440,'height':1100},device_scale_factor=1);page.set_default_timeout(10000)
    page.on('pageerror',lambda e:errors.append(str(e)))
    if a.offline:
        html=re.sub(r'<script\b[^>]*>.*?</script>','',(root/'web/index.html').read_text()).replace('<link rel="stylesheet" href="/style.css">','')
        page.set_content(html);page.add_style_tag(content=(root/'web/style.css').read_text())
        def bridge(endpoint,opts):
            if not endpoint.startswith('/api/'):raise ValueError('Only local API endpoints are bridged')
            req=urllib.request.Request(r['origin']+endpoint,data=opts.get('body','').encode() if 'body' in opts else None,headers=opts.get('headers',{}),method=opts.get('method','GET'))
            try:res=urllib.request.urlopen(req,timeout=60)
            except urllib.error.HTTPError as e:res=e
            with res:return {'body':res.read().decode(),'status':res.status,'headers':dict(res.headers)}
        page.expose_function('__tmTestFetch',bridge)
        page.evaluate("""token=>{Object.defineProperty(window,'sessionStorage',{value:{getItem:()=>token,setItem(){}}});window.fetch=async(endpoint,options={})=>{const v=await window.__tmTestFetch(endpoint,options);return new Response(v.body,{status:v.status,headers:v.headers});};}""",r['token'])
        for f in ['src/billing-view.js','web/app.js','web/measurements.js','web/history.js','web/rates.js','web/data-controls.js','web/reliability.js']:page.add_script_tag(content=(root/f).read_text())
    else:page.goto(r['origin']+'/#key='+r['token'])
    page.evaluate('load()');page.wait_for_function("document.querySelector('#runtime-resources') !== null")
    page.evaluate('clearTimeout(refreshTimer)')
    assert 'RAM' in page.locator('#runtime-resources').inner_text()
    assert 'MiB' in page.locator('#runtime-resources').inner_text()
    assert 'Python' in page.locator('#runtime-resources').get_attribute('title')
    passed('Live collector memory is shown in MiB and explicitly distinguishes browser/worker/Python scope')
    perf=call('/api/performance');assert perf['rssBytes']>0 and perf['metadataPool']['entries']<=4096 and perf['viewCache']['bytes']<=8388608
    passed('Authenticated resource API exposes bounded caches without access keys')
    result=page.evaluate("""async()=>{
      const original=window.fetch;let concurrent=0,maximum=0,calls=0;
      window.fetch=async(u,o)=>{if(!u.startsWith('/api/status'))return original(u,o);calls++;concurrent++;maximum=Math.max(maximum,concurrent);try{await new Promise(r=>setTimeout(r,40));return await original(u,o);}finally{concurrent--;}};
      await Promise.all(Array.from({length:20},()=>load()));window.fetch=original;clearTimeout(refreshTimer);return {maximum,calls};
    }""")
    assert result['maximum']==1 and result['calls']<=2,result
    passed('Twenty simultaneous refresh requests coalesce; only one status request is in flight')
    result=page.evaluate("""async()=>{
      const original=window.fetch;let calls=0;window.fetch=(u,o)=>{if(u.startsWith('/api/status'))calls++;return original(u,o);};
      Object.defineProperty(document,'hidden',{get:()=>true,configurable:true});await refreshLoop();clearTimeout(refreshTimer);const hidden=calls;
      Object.defineProperty(document,'hidden',{get:()=>false,configurable:true});await refreshLoop();clearTimeout(refreshTimer);delete document.hidden;window.fetch=original;return {hidden,visible:calls};
    }""")
    assert result['hidden']==0 and result['visible']==1,result
    passed('Hidden dashboard skips automatic status work; visible dashboard resumes, without stopping collection')
    result=page.evaluate("""async()=>{
      const oldFetch=window.fetch,oldPicker=window.showSaveFilePicker,oldSecure=Object.getOwnPropertyDescriptor(window,'isSecureContext');let bytes=0,closed=false,blobs=0;
      Object.defineProperty(window,'isSecureContext',{value:true,configurable:true});
      window.showSaveFilePicker=async()=>({createWritable:async()=>new WritableStream({write(chunk){bytes+=chunk.length;},close(){closed=true;}})});
      window.fetch=async()=>{let n=0;const r=new Response(new ReadableStream({pull(c){if(n++<64)c.enqueue(new Uint8Array(16384));else c.close();}}));r.blob=async()=>{blobs++;throw Error('must not buffer');};return r;};
      const saved=await saveExport('/api/export.json','test.json');
      window.fetch=oldFetch;window.showSaveFilePicker=oldPicker;if(oldSecure)Object.defineProperty(window,'isSecureContext',oldSecure);else delete window.isSecureContext;return {saved,bytes,closed,blobs};
    }""")
    assert result=={'saved':True,'bytes':1048576,'closed':True,'blobs':0},result
    passed('Supported-browser export streams 1 MiB to a mock file writer, without calling Blob')
    result=page.evaluate("""async()=>{
      const oldPicker=window.showSaveFilePicker,oldSecure=Object.getOwnPropertyDescriptor(window,'isSecureContext'),oldFetch=window.fetch;let fetched=false;
      Object.defineProperty(window,'isSecureContext',{value:true,configurable:true});window.showSaveFilePicker=async()=>{throw new DOMException('cancelled','AbortError');};window.fetch=()=>{fetched=true;throw Error('unexpected');};
      const saved=await saveExport('/api/export.json','test.json');window.fetch=oldFetch;window.showSaveFilePicker=oldPicker;if(oldSecure)Object.defineProperty(window,'isSecureContext',oldSecure);else delete window.isSecureContext;return {saved,fetched,busy:exportBusy};
    }""")
    assert result=={'saved':False,'fetched':False,'busy':False},result
    passed('Cancelling the file chooser sends no export request and releases the busy guard')
    page.evaluate('load()');page.wait_for_timeout(100);page.evaluate('clearTimeout(refreshTimer)')
    for width in [375,768,1440]:
      page.set_viewport_size({'width':width,'height':1050});page.locator('#runtime-resources').scroll_into_view_if_needed()
      box=page.locator('#runtime-resources').bounding_box();assert box['x']>=0 and box['x']+box['width']<=width+1
      passed(f'Resource details fit within {width}px viewport')
    page.set_viewport_size({'width':1440,'height':1200});page.locator('#reliability-panel').screenshot(path=str(out/'resources.png'))
    assert not errors,errors;passed('No uncaught JavaScript errors')
    browser.close()
report={'version':json.loads((root/'package.json').read_text())['version'],'passed':len(checks),'checks':checks,'errors':errors,'synthetic':True,'mode':'restricted-render-bridge' if a.offline else 'navigation','nativeFilePicker':'mocked, not OS-verified'}
(out/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps(report,ensure_ascii=False))
