"""0.10.1 preview/cache-evidence UI acceptance tests against an isolated, synthetic local demo.
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
    def refresh():page.evaluate('load()');page.wait_for_timeout(200)
    def close(id):page.locator('#'+id+' [data-close="'+id+'"]').click()
    def ingest(id,n=10000,cr=5000,cw=2000,o=2000,t=1500,model='gpt-6-sol'):
        return call('/api/usage',{'schema':'token-meter.usage.v1','format':'normalized','modelProvider':'openai','model':model,'requestId':id,'sessionId':'four-items-test','timestamp':page.evaluate('new Date().toISOString()'),'modality':'text','usage':{'input':n+cr+cw,'cacheRead':cr,'cacheWriteUnknown':cw,'output':o,'thinkingOutput':t}})

    def api_usage(request_id,normal,read,output,write=None):
        details={'cached_tokens':read}
        if write is not None:details['cache_write_tokens']=write
        return call('/api/usage',{'schema':'token-meter.usage.v1','format':'openai','modelProvider':'openai','model':'gpt-6-sol','requestId':run_id+'-'+request_id,'sessionId':'cache-evidence-demo','timestamp':page.evaluate('new Date().toISOString()'),'modality':'text','usage':{'input_tokens':normal+read+(write or 0),'output_tokens':output,'input_tokens_details':details,'output_tokens_details':{'reasoning_tokens':min(400,output)}}})
    reset();refresh();page.click('[data-scope="all"]');refresh()
    # Ten short synthetic requests reproduce the user's aggregate; no raw user log is imported.
    for i in range(10):api_usage('missing-write-'+str(i),8047+(i<4),237401+(i<6),1486+(i<6))
    refresh();page.wait_for_function("document.querySelector('#total-tokens').textContent==='2,469,356'")
    s=call('/api/status?scope=all')['summary']
    assert math.isclose(s['totalUsd'],.7844112,abs_tol=1e-12)
    assert s['inputBreakdown']['cacheWriteUnreportedRecords']==10
    passed('User-provided aggregate reproduced with ten synthetic requests: 2,469,356 tokens / $0.7844112 reference cost')
    assert '0.10.1' in page.locator('#app-version').inner_text()
    assert not page.locator('#version-warning').is_visible()
    assert '2,469,356' in page.locator('#overview-tokens').inner_text()
    assert '참고' in page.locator('#overview-basis').inner_text()
    passed('Header and collector versions agree; overview reuses real API summary and reference status')
    w=page.locator('#billing-rows [data-bucket="cacheWrite"]')
    assert w.get_attribute('data-evidence')=='unreported'
    assert w.locator('.billing-count > strong').inner_text()=='미기록'
    assert w.locator('.billing-amount > strong').inner_text()=='분리 불가'
    assert '$2.50' in w.locator('.billing-tariff').inner_text()
    passed('Absent write counter shows unreported / cannot split, while the applicable unit rate remains visible')
    assert '미기록' in page.locator('#bar-write-tokens').inner_text()
    assert '분리 불가' in page.locator('#bar-write-cost').inner_text()
    passed('Fixed status bar no longer presents an absent counter as zero-dollar spend')
    before=call('/api/status?scope=all')['summary']['knownTotalUsd']
    page.click('#cache-help-button');page.wait_for_function("document.querySelector('#cache-help-dialog').open")
    assert '코드 파일 쓰기' in page.locator('#cache-help-title').inner_text()
    assert '프롬프트' in page.locator('#cache-help-dialog').inner_text()
    assert len(page.locator('#cache-help-dialog a').all())==2
    page.locator('#cache-help-dialog').screenshot(path=str(out/'cache-guide.png'))
    close('cache-help-dialog');assert before==call('/api/status?scope=all')['summary']['knownTotalUsd']
    passed('Cache help explains model output, local file edits, and future prompt caching without changing usage')
    page.click('#input-details-toggle') if page.locator('#input-details-toggle').is_visible() else None
    if not page.locator('#input-detail-dialog').is_visible():
        page.locator('#billing-advanced > summary').click();page.click('#input-details-toggle')
    detail=page.locator('#input-detail-content').inner_text();assert '미기록' in detail and '분리 불가' in detail
    close('input-detail-dialog')
    page.locator('#billing-advanced').evaluate('(el)=>el.open=false')
    passed('TTL detail uses unreported rather than fabricating three zero cache-write counters')
    # Screenshot is the actual running app with synthetic request data; keep demo badge visible.
    page.set_viewport_size({'width':1440,'height':1380});page.evaluate("window.scrollTo({top:0,left:0,behavior:'instant'})");page.wait_for_timeout(200)
    page.screenshot(path=str(out/'preview-desktop.png'))
    page.locator('#input-pricing-panel').screenshot(path=str(out/'cache-evidence.png'))
    for width in [375,430,768,1280,1440]:
        page.set_viewport_size({'width':width,'height':1300});page.wait_for_timeout(100)
        assert page.evaluate('document.documentElement.scrollWidth')<=width+1
        for row in page.locator('#billing-rows tr').all():
            rect=row.bounding_box();assert rect and rect['x']>=-1 and rect['x']+rect['width']<=width+1
        assert page.locator('#overview-cost').inner_text()=='$0.784411'
        if width==375:
            page.evaluate("window.scrollTo({top:0,left:0,behavior:'instant'})");page.wait_for_timeout(200);page.screenshot(path=str(out/'preview-mobile.png'))
        passed(str(width)+'px: responsive overview and four billing rows retain evidence and no page overflow')
    page.set_viewport_size({'width':1440,'height':1200})
    htmlmini=page.evaluate("""()=>{const d=document.implementation.createHTMLDocument('mini');pipWindow={document:d,closed:false};renderPip();const html=d.documentElement.outerHTML;pipWindow=null;return html;}""")
    mini=browser.new_page(viewport={'width':1080,'height':250});mini.set_content(htmlmini);mini.add_style_tag(content=(root/'web/style.css').read_text())
    assert '미기록' in mini.locator('[data-kind="cacheWrite"]').inner_text();assert '분리 불가' in mini.locator('[data-kind="cacheWrite"]').inner_text()
    mini.screenshot(path=str(out/'mini-bar.png'));mini.close()
    passed('Separate-document PiP renderer preserves missing-counter evidence; OS topmost behavior not tested')
    reset();api_usage('known-zero',1000,500,100,write=0);refresh()
    assert w.get_attribute('data-evidence')=='reported-zero'
    assert w.locator('.billing-count > strong').inner_text()=='0'
    assert '$0.000' in w.locator('.billing-amount').inner_text()
    passed('An explicit zero stays a real reported zero, distinct from an absent field')
    api_usage('known-write',1000,500,100,write=2000);refresh()
    assert w.get_attribute('data-evidence')=='reported'
    assert w.locator('.billing-count > strong').inner_text()=='2,000'
    assert '$0.005' in w.locator('.billing-amount').inner_text()
    passed('A reported 2,000-token cache write is displayed and priced once at $2.50 / 1M')
    api_usage('another-missing',1000,500,100);refresh()
    assert w.get_attribute('data-evidence')=='partial'
    assert '관측분' in w.locator('.billing-count').inner_text()
    passed('Mixed reported/missing requests show observed subtotal, not full-coverage cache-write usage')
    assert not errors,errors;passed('No uncaught JavaScript errors in preview and cache-evidence flows')
    browser.close()
report={'passed':len(checks),'checks':checks,'errors':errors,'synthetic':True,'mode':'restricted-render-bridge' if a.offline else 'navigation'}
(out/'cache-preview-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
print(json.dumps({'passed':len(checks),'errors':errors}))
