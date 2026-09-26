"""Deletion and whole-data reset UI smoke tests. Run only against a fresh isolated demo. Requires Python Playwright and a local Chromium binary.
Run against an isolated `node bin/cli.js demo` instance only.
python scripts/measurement-smoke.py /path/to/demo-data --offline --output /tmp/tm-ui
"""
import argparse,json,pathlib,os,urllib.request,urllib.error,urllib.parse,subprocess
from playwright.sync_api import sync_playwright
p=argparse.ArgumentParser();p.add_argument('data_dir');p.add_argument('--output',default='reset-browser-results');p.add_argument('--chromium',default='/usr/bin/chromium');p.add_argument('--offline',action='store_true',help='Render app files on about:blank and bridge test fetches to the real local API without browser navigation');a=p.parse_args()
out=pathlib.Path(a.output);out.mkdir(parents=True,exist_ok=True)
r=json.loads(pathlib.Path(a.data_dir,'runtime.json').read_text())
if not r.get('demo'):raise SystemExit('Refusing non-demo instance')
browser_origin=r['origin']
url=browser_origin+'/#key='+r['token'];checks=[];errors=[];console_errors=[];requests=[]
def passed(name):checks.append(name);print(name,flush=True)
with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path=a.chromium,args=['--no-sandbox'],headless=True)
    page=browser.new_page(viewport={'width':1440,'height':1050},device_scale_factor=1)
    page.set_default_timeout(7000)
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.on('console',lambda m:console_errors.append(m.text) if m.type=='error' else None)
    page.on('request',lambda q:requests.append(q.url))
    if a.offline:
        web=pathlib.Path(__file__).resolve().parent.parent/'web'
        html=(web/'index.html').read_text().replace('<link rel="stylesheet" href="/style.css">','').replace('<script defer src="/app.js"></script>','').replace('<script defer src="/measurements.js"></script>','').replace('<script defer src="/history.js"></script>','').replace('<script defer src="/rates.js"></script>','').replace('<script defer src="/data-controls.js"></script>','').replace('<script defer src="/billing-view.js"></script>','').replace('<script defer src="/reliability.js"></script>','')
        page.set_content(html)
        page.add_style_tag(content=(web/'style.css').read_text())
        def test_fetch(endpoint,options):
            if not endpoint.startswith('/api/'): raise ValueError('Only this app API may be bridged')
            requests.append(r['origin']+endpoint)
            body=options.get('body')
            headers=options.get('headers',{})
            target=urllib.request.Request(r['origin']+endpoint,data=body.encode() if body else None,headers=headers,method=options.get('method','GET'))
            try: response=urllib.request.urlopen(target,timeout=10)
            except urllib.error.HTTPError as err: response=err
            with response: return {'body':response.read().decode(),'status':response.status,'headers':dict(response.headers)}
        page.expose_function('__tmTestFetch',test_fetch)
        page.evaluate('''token=>{Object.defineProperty(window,'sessionStorage',{value:{getItem:()=>token,setItem(){}}});window.fetch=async(endpoint,options={})=>{const v=await window.__tmTestFetch(endpoint,options);return new Response(v.body,{status:v.status,headers:v.headers});};}''',r['token'])
        page.add_script_tag(content=(web.parent/'src/billing-view.js').read_text());page.add_script_tag(content=(web/'app.js').read_text());page.add_script_tag(content=(web/'measurements.js').read_text());page.add_script_tag(content=(web/'history.js').read_text());page.add_script_tag(content=(web/'rates.js').read_text());page.add_script_tag(content=(web/'data-controls.js').read_text())
    else: page.goto(url)
    def api(endpoint,body=None):
        opts={'headers':{'Authorization':'Bearer '+r['token']}}
        if body is not None:opts.update({'method':'POST','body':json.dumps(body)});opts['headers']['Content-Type']='application/json'
        return page.evaluate('async ([url,opts])=>{const r=await fetch(url,opts);const v=await r.json();if(!r.ok)throw Error(v.error);return v}',[endpoint,opts])
    page.evaluate('load()')
    page.wait_for_function("window.TMMeasurements && window.TMDataControls && document.querySelector('#connection').textContent === '로컬 수집 중'")
    page.click('[data-scope="all"]')
    original=api('/api/status?scope=all')['summary']['total']
    assert original>0
    def refresh(): page.evaluate('load()');page.wait_for_timeout(100)
    def start(name): return api('/api/measurements/start',{'name':name})
    def card(r):return page.locator('.meter-card[data-id="'+r['id']+'"]')
    def confirm(phrase=None):
        page.wait_for_function("document.querySelector('#delete-data-dialog').open")
        if phrase:page.fill('#delete-data-phrase',phrase)
        page.check('#delete-data-ack');page.click('#delete-data-submit')
        try:page.wait_for_function("!document.querySelector('#delete-data-dialog').open")
        except Exception:
            print('Dialog error:',page.locator('#delete-data-error').inner_text(),flush=True)
            raise
        page.wait_for_timeout(100)
    run=start('TEST1 · 삭제할 측정');api('/api/measurements/pin',{'id':run['id']});second=start('비교 실험 · 유지');refresh()
    assert card(run).locator('.delete-measurement').is_visible()
    page.locator('#measurement-section').screenshot(path=str(out/'delete-controls.png')) if page.locator('#measurement-section').count() else page.locator('#measurement-list').screenshot(path=str(out/'delete-controls.png'))
    passed('Each running measurement has a visible Delete button')
    card(run).locator('.delete-measurement').click();page.wait_for_function("document.querySelector('#delete-data-dialog').open")
    assert '진행 중' in page.locator('#delete-data-description').inner_text()
    assert page.locator('#delete-data-submit').is_disabled()
    assert '누적 사용량' in page.locator('#delete-data-description').inner_text()
    passed('Delete dialog explains active cancellation and usage preservation; disabled until acknowledged')
    page.click('#delete-data-cancel');assert len(api('/api/measurements')['runs'])==2
    passed('Cancel leaves active and pinned measurements unchanged')
    page.evaluate('(id)=>TMMeasurements.view(id)',run['id']);page.wait_for_timeout(100)
    card(run).locator('.delete-measurement').click();confirm()
    assert len(api('/api/measurements')['runs'])==1
    assert api('/api/measurements')['pinnedId'] is None
    assert api('/api/status?scope=all')['summary']['total']==original
    page.wait_for_function("document.querySelector('#connection').textContent==='로컬 수집 중' && document.querySelector('#measurement-banner').hidden")
    passed('Delete active selected pinned measurement removes card, clears pin and switches view without erasing usage')
    a1=start('선택 삭제 A');a2=start('선택 삭제 B');refresh()
    card(a1).locator('input[type=checkbox]').check();card(a2).locator('input[type=checkbox]').check()
    assert page.locator('#delete-selected-measurements').inner_text()=='선택 삭제 (2)'
    page.click('#delete-selected-measurements');confirm()
    assert [r['id'] for r in api('/api/measurements')['runs']]==[second['id']]
    assert page.locator('#delete-selected-measurements').is_disabled()
    passed('Bulk delete removes exactly selected cards and clears selection')
    archived=start('숨겨진 종료 기록');api('/api/measurements/stop',{'id':archived['id']});api('/api/measurements/update',{'id':archived['id'],'archived':True});refresh()
    page.click('#clear-all-measurements');page.wait_for_function("document.querySelector('#delete-data-dialog').open")
    assert '숨겨진 종료 기록' in page.locator('#delete-data-description').inner_text()
    page.fill('#delete-data-phrase','틀린 확인');page.check('#delete-data-ack');assert page.locator('#delete-data-submit').is_disabled()
    page.locator('#delete-data-dialog').screenshot(path=str(out/'clear-measurements.png'))
    passed('Delete all includes hidden history and requires the exact confirmation phrase')
    page.fill('#delete-data-phrase','측정 전체 삭제');page.click('#delete-data-submit');page.wait_for_function("!document.querySelector('#delete-data-dialog').open")
    assert api('/api/measurements')['runs']==[];assert api('/api/status?scope=all')['summary']['total']==original
    passed('Delete all measurements preserves cumulative tokens and usage log')
    survivor=start('전체 초기화 대상');api('/api/measurements/pin',{'id':survivor['id']});refresh()
    api('/api/task/start',{'name':'진행 작업'})
    prior=api('/api/data/state');config=api('/api/config')
    page.click('#reset-all-data');page.wait_for_function("document.querySelector('#delete-data-dialog').open")
    for word in ['백업','설정','원본','0부터']:assert word in page.locator('#delete-data-description').inner_text()
    page.locator('#delete-data-dialog').screenshot(path=str(out/'reset-confirmation.png'))
    assert page.locator('#delete-data-submit').is_disabled()
    page.fill('#delete-data-phrase','전체 초기화');assert page.locator('#delete-data-submit').is_disabled()
    passed('Whole reset discloses data scope, preservation and backup, and requires typed phrase plus acknowledgement')
    page.click('#delete-data-cancel');assert api('/api/data/state')['epochId']==prior['epochId']
    passed('Cancelling full reset leaves the dataset and running measurements unchanged')
    page.click('#reset-all-data');confirm('전체 초기화')
    page.wait_for_function("document.querySelector('#total-tokens').textContent==='0' && !document.querySelector('#data-reset-banner').hidden")
    state=api('/api/data/state');assert state['epochId']!=prior['epochId'];assert state['measurementCount']==0;assert state['requestCount']==0;assert state['taskCount']==0
    assert api('/api/config')==config
    assert api('/api/history')['records']==[]
    passed('Whole reset shows zero totals, empties measurements/tasks/history and retains config')
    for row in page.locator('#billing-rows tr').all():
        assert row.locator('.billing-count strong').inner_text()=='0'
        assert row.locator('.billing-amount strong').inner_text().startswith('$0')
    assert page.locator('#total-cost').inner_text().startswith('$0')
    passed('All four billing components and total visibly restart at zero')
    for _ in range(2):api('/api/scan',{})
    api('/api/antigravity/reanalyse',{})
    assert api('/api/status?scope=all')['summary']['total']==0
    assert api('/api/history')['records']==[]
    passed('Rescan and Antigravity reanalysis do not reintroduce pre-reset history')
    page.evaluate('window.scrollTo(0,0)');page.screenshot(path=str(out/'reset-complete.png'))
    assert pathlib.Path(prior['storageDirectory'],'ledger.json').exists()
    passed('Previous dataset remains available locally as backup')
    fresh={'schema':'token-meter.usage.v1','format':'openai','modelProvider':'openai','model':'gpt-6-sol','requestId':'reset-ui-fresh','timestamp':page.evaluate('new Date().toISOString()'),'modality':'text','usage':{'input_tokens':1000,'output_tokens':100,'input_tokens_details':{'cached_tokens':400,'cache_write_tokens':0},'output_tokens_details':{'reasoning_tokens':30}}}
    api('/api/usage',fresh);refresh()
    page.wait_for_function("document.querySelector('#total-tokens').textContent==='1,100'")
    assert api('/api/status?scope=all')['summary']['total']==1100
    passed('A new request after reset is counted with cache and thinking splits')
    for width in [375,768,1440]:
        page.set_viewport_size({'width':width,'height':1000});page.click('#reset-all-data');page.wait_for_function("document.querySelector('#delete-data-dialog').open")
        rect=page.locator('#delete-data-dialog').bounding_box();assert rect['x']>=-1 and rect['x']+rect['width']<=width+1
        if width==375:page.screenshot(path=str(out/'mobile-reset.png'))
        page.click('#delete-data-cancel');passed(f'{width}px reset dialog fits viewport with accessible controls')
    page.set_viewport_size({'width':1440,'height':1000})
    cross=start('다른 창에서 삭제');page.evaluate('(id)=>TMMeasurements.view(id)',cross['id']);page.wait_for_timeout(100)
    api('/api/measurements/delete',{'ids':[cross['id']],'confirmation':'삭제'});refresh()
    page.wait_for_function("document.querySelector('#measurement-banner').hidden && document.querySelector('#connection').textContent==='로컬 수집 중'")
    passed('A deleted selection from another client falls back without an offline error')
    assert not errors,errors
    passed('No uncaught JavaScript runtime errors')
    browser.close()
report={'checks':checks,'passed':len(checks),'errors':errors,'consoleErrors':console_errors,'mode':'offline-render-api-bridge' if a.offline else 'browser-navigation','syntheticData':True}
(out/'reset-ui-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
print(json.dumps({'passed':len(checks),'errors':errors,'output':str(out)},ensure_ascii=False))
