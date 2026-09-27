"""0.9 billing UI acceptance tests against an isolated, synthetic local demo.
Python Playwright and Chromium are test-only dependencies. --offline uses
about:blank + a restricted fetch bridge; it is not browser-navigation/CSP proof.
Never run on user data: the demo flag is mandatory and tests reset active data.
"""
import argparse, json, pathlib, re, urllib.request, urllib.error, uuid, math
from playwright.sync_api import sync_playwright

p=argparse.ArgumentParser();p.add_argument('data_dir');p.add_argument('--output',default='billing-ui-results');p.add_argument('--chromium',default='/usr/bin/chromium');p.add_argument('--offline',action='store_true');a=p.parse_args()
root=pathlib.Path(__file__).resolve().parent.parent;out=pathlib.Path(a.output);out.mkdir(parents=True,exist_ok=True)
r=json.loads(pathlib.Path(a.data_dir,'runtime.json').read_text());checks=[];errors=[]
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
    refresh();page.wait_for_function("document.querySelector('#billing-rows').children.length===4")
    page.click('[data-scope="all"]');refresh()
    old=call('/api/status?scope=all')['summary'];assert old['total']>0
    assert page.locator('#billing-rows tr').count()==4
    passed('Existing mixed CLI / Antigravity demo renders four billing items without changing ledger totals')
    assert '0.10.2' in page.locator('#app-version').inner_text()
    assert page.locator('#billing-advanced').get_attribute('open') is None
    assert not page.locator('#thinking-tokens').is_visible()
    passed('Default overview hides THINKING and TTL details; version is 0.10.2')
    assert '단가' in page.locator('#billing-rows').inner_text();assert old['total']==call('/api/status?scope=all')['summary']['total']
    passed('Rendering mixed tariffs is read-only and retains saved component costs')
    reset();refresh();page.wait_for_function("document.querySelector('#total-tokens').textContent==='0'")
    assert page.locator('#billing-rows tr').count()==4
    for tr in page.locator('#billing-rows tr').all():assert '0' in tr.inner_text()
    passed('Full-reset active epoch shows four zero items and a zero total')
    for i in range(10):
        n=10069+(i<2);cr=214988+(i<8);o=1061+(i<9)
        ingest('screenshot-billing-'+str(i),n=n,cr=cr,cw=0,o=o,t=500)
    refresh();page.wait_for_function("document.querySelector('#total-tokens').textContent==='2,261,199'")
    s=call('/api/status?scope=all')['summary'];assert math.isclose(s['totalUsd'],.7375516,abs_tol=1e-12)
    assert s['input']==2250580 and s['output']==10619
    passed('Ten synthetic short requests reproduce sample total: 2,261,199 tokens / $0.7375516')
    rows=page.locator('#billing-rows tr')
    for row,number,cost in zip(rows.all(),['100,692','2,149,888','0','10,619'],['$0.201384','$0.429978','$0.000','$0.10619']):
        assert number in row.inner_text(),row.inner_text();assert cost in row.inner_text(),row.inner_text()
    passed('IN excludes cached tokens; each of four rows shows the correct token count and money')
    for row,rate in zip(rows.all(),['$2.00','$0.20','$2.50','$10.00']):assert rate in row.inner_text(),row.inner_text()
    assert 'gpt-6-sol' in page.locator('#billing-model-context').inner_text()
    passed('All four saved unit prices are visible, including $2.50 write price at zero usage')
    totaltext=page.locator('#total-cost').inner_text();page.select_option('#rate-unit-select','1000');page.wait_for_timeout(100)
    assert '1,000' in page.locator('#billing-rate-heading').inner_text()
    for row,rate in zip(rows.all(),['$0.002','$0.0002','$0.0025','$0.01']):assert rate in row.inner_text(),row.inner_text()
    assert page.locator('#total-cost').inner_text()==totaltext
    passed('Switching to 1,000-token tariffs rescales all four rates without changing money or totals')
    page.select_option('#rate-unit-select','1000000');page.wait_for_timeout(80)
    page.locator('#billing-advanced > summary').click();assert '5,000' in page.locator('#thinking-tokens').inner_text()
    assert '5,619' in page.locator('#response-tokens').inner_text()
    assert page.locator('#total-cost').inner_text()==totaltext
    passed('THINKING can be expanded: 5,000 + non-thinking 5,619 = OUT 10,619, no new charge')
    page.click('#input-details-toggle');page.wait_for_function("document.querySelector('#input-detail-dialog').open")
    assert '5분' in page.locator('#input-detail-content').inner_text();assert '1시간' in page.locator('#input-detail-content').inner_text()
    close('input-detail-dialog');page.locator('#billing-advanced > summary').click()
    passed('Cache-write TTL subdivisions remain available in an optional dialog')
    page.click('#show-all-rates');page.wait_for_function("document.querySelector('#rate-detail-dialog').open")
    detail=page.locator('#rate-detail-content').inner_text();assert 'gpt-6-sol' in detail and 'OUT' in detail
    assert page.locator('#rate-detail-content .billing-table tbody tr').count()==4
    page.locator('#rate-detail-dialog').screenshot(path=str(out/'rate-details.png'));close('rate-detail-dialog')
    passed('Rate details bind to the observed model and show the same four-component calculation')
    tr=page.locator('#model-table tr').first
    assert tr.locator('[data-metric]').count()==5
    assert '100,692' in tr.locator('[data-metric="normalInput"]').inner_text()
    assert '2,149,888' in tr.locator('[data-metric="cacheRead"]').inner_text()
    assert '10,619' in tr.locator('[data-metric="output"]').inner_text()
    passed('Model table uses IN / READ / WRITE / OUT / TOTAL without overlapping columns')
    for label in ['IN','CACHE READ','CACHE WRITE','OUT','TOTAL']:assert label in page.locator('#bottom-bar').inner_text()
    assert '100.7K' in page.locator('#bar-in-tokens').inner_text() or '100,692' in page.locator('#bar-in-tokens').inner_text()
    passed('Fixed status bar uses the same ordinary-input and whole-output semantics')
    page.set_viewport_size({'width':1440,'height':1600});page.evaluate('window.scrollTo(0,0)');page.screenshot(path=str(out/'desktop.png'))
    page.locator('#input-pricing-panel').screenshot(path=str(out/'billing-view.png'))
    # Use the real PiP renderer in another document, not an operating-system topmost window.
    mini=browser.new_page(viewport={'width':1000,'height':220});mini.set_content('<html><body></body></html>')
    htmlmini=page.evaluate("""()=>{const d=document.implementation.createHTMLDocument('mini');pipWindow={document:d,closed:false};renderPip();const html=d.documentElement.outerHTML;pipWindow=null;return html;}""")
    mini.set_content(htmlmini);mini.add_style_tag(content=(root/'web/style.css').read_text());assert mini.locator('.pip-metric').count()==5
    mini.screenshot(path=str(out/'mini-bar.png'));mini.close()
    passed('PiP renderer displays four components plus total (separate-document render only)')
    for width in [375,430,768,1280,1440]:
        page.set_viewport_size({'width':width,'height':1050});page.locator('#input-pricing-panel').scroll_into_view_if_needed();page.wait_for_timeout(80)
        assert page.evaluate('document.documentElement.scrollWidth')<=width+1
        for row in rows.all():
            rect=row.bounding_box();assert rect and rect['x']>=-1 and rect['x']+rect['width']<=width+1
        for part in page.locator('.bar-segment').all():
            rect=part.bounding_box();assert rect and rect['x']>=-1 and rect['x']+rect['width']<=width+1 and rect['y']+rect['height']<=1051
        if width==375:
            page.set_viewport_size({'width':375,'height':2100});page.locator('#input-pricing-panel').screenshot(path=str(out/'mobile-statement.png'));page.set_viewport_size({'width':375,'height':1050})
            page.screenshot(path=str(out/'mobile.png'))
        passed(str(width)+'px: main statement and all five footer items fit viewport horizontally')
    page.set_viewport_size({'width':1440,'height':1100})
    page.evaluate('TMHistory.refresh(true)');page.wait_for_timeout(150)
    assert page.locator('#recent-table tr').count()==10
    assert page.locator('#recent-table tr').first.locator('[data-metric]').count()==5
    page.locator('.history-detail-btn').first.click();page.wait_for_function("document.querySelector('#price-detail-dialog').open")
    assert page.locator('#price-detail-content > .billing-table-wrap > .billing-table > tbody > tr').count()==4
    assert all(x.get_attribute('open') is None for x in page.locator('#price-detail-content > details').all())
    page.locator('#price-detail-dialog').screenshot(path=str(out/'request-details.png'));close('price-detail-dialog')
    passed('History list and request calculation dialog use four charges, with split details collapsed')
    export=call('/api/history/export.csv?scope=all',raw=True)
    for field in ['normalInput','cacheRead','cacheWriteUsd','inputFieldMeaning','displayINField']:assert field in export
    records=call('/api/history/export.jsonl?scope=all',raw=True).strip().splitlines();assert len(records)==10
    rec=json.loads(records[0]);assert 'billingView' in rec or 'billingView' in rec.get('event',{})
    passed('Full history CSV / JSONL preserve raw inclusive input and add explicit four-item display fields')
    page.click('#rate-audit-button');page.wait_for_function("document.querySelector('#rate-audit-dialog').open")
    assert 'gpt-6-sol' in page.locator('#rate-audit-table').inner_text();close('rate-audit-dialog')
    passed('Model / tariff binding audit still works from the redesigned screen')
    page.click('#settings-button');page.wait_for_function("document.querySelector('#settings-dialog').open")
    page.select_option('#billing-mode','api-estimate');page.locator('#settings-form button[type="submit"]').click();page.wait_for_timeout(200)
    assert call('/api/config')['billingMode']=='api-estimate'
    assert page.locator('#total-cost').inner_text()==totaltext
    passed('Settings still save; label mode does not recalculate stored charges')
    # Named measurements, baseline rows, pin, comparison, deletion.
    page.click('#new-measurement');page.fill('#measurement-name','새 요금표 검증');page.fill('#measurement-model','gpt-6-sol')
    page.locator('#measurement-form button[type="submit"]').click();page.wait_for_function("!document.querySelector('#measurement-dialog').open")
    runs=call('/api/measurements')['runs'];run=next(x for x in runs if x['name']=='새 요금표 검증')
    ingest('measured-billing');refresh()
    card=page.locator('.meter-card[data-id="'+run['id']+'"]')
    assert card.locator('.meter-values > div').count()==5
    assert [x.inner_text() for x in card.locator('.meter-values b').all()]==['IN','CACHE READ','CACHE WRITE','OUT','TOTAL']
    assert '10,000' in card.inner_text() and '5,000' in card.inner_text() and '2,000' in card.inner_text()
    passed('Named measurement cards preserve all four token and cost components')
    card.get_by_role('button',name='상태바 고정',exact=True).click();page.wait_for_timeout(180);assert call('/api/measurements')['pinnedId']==run['id']
    card.get_by_role('button',name='보기',exact=True).click();page.wait_for_function("document.querySelector('#total-tokens').textContent==='19,000'")
    assert '$0.046' in page.locator('#total-cost').inner_text()
    passed('Pinned and selected measurement uses regular 10K / read 5K / write 2K / output 2K = $0.046')
    page.click('[data-scope="all"]');refresh()
    modeltr=page.locator('#model-table tr').filter(has_text='gpt-6-sol').first;modeltr.locator('.reset-row').click();page.wait_for_timeout(250)
    ingest('measured-after-reset',n=100,cr=50,cw=20,o=30,t=10);refresh()
    modeltr=page.locator('#model-table tr').filter(has_text='gpt-6-sol').first
    for metric,value in [('normalInput','100'),('cacheRead','50'),('cacheWrite','20'),('output','30'),('total','200')]:assert value in modeltr.locator('[data-metric="'+metric+'"]').inner_text()
    passed('Model reset row keeps its input breakdown instead of losing cache cost data while combining groups')
    cards=page.locator('.meter-card');cards.first.locator('input[type=checkbox]').check();cards.last.locator('input[type=checkbox]').check()
    page.click('#compare-measurements');page.wait_for_function("document.querySelector('#comparison-dialog').open")
    text=page.locator('#comparison-table').inner_text()
    for label in ['IN 토큰','CACHE READ 토큰','CACHE WRITE 토큰','OUT 토큰','TOTAL 토큰']:assert label in text
    assert 'THINKING 토큰' not in text and 'BILLABLE OUT' not in text
    close('comparison-dialog');page.locator('#measurement-panel').screenshot(path=str(out/'measurements.png'))
    passed('Comparison aligns four token/cost categories and omits overlapping THINKING columns')
    total_before=call('/api/status?scope=all')['summary']['total']
    card=page.locator('.meter-card[data-id="'+run['id']+'"]');card.locator('.delete-measurement').click();page.wait_for_function("document.querySelector('#delete-data-dialog').open")
    assert page.locator('#delete-data-submit').is_disabled();page.check('#delete-data-ack');page.click('#delete-data-submit');page.wait_for_function("!document.querySelector('#delete-data-dialog').open")
    assert call('/api/status?scope=all')['summary']['total']==total_before
    assert all(x['id']!=run['id'] for x in call('/api/measurements')['runs'])
    passed('Deleting an active measurement still requires acknowledgement and preserves cumulative use')
    # Return to cumulative table mode before inspecting added mixed tariffs.
    if page.locator('#table-mode').inner_text()=='재측정 표시 중':page.click('#table-mode')
    ingest('different-model',model='gpt-6-luna');refresh()
    assert '혼합' in page.locator('#billing-rows').inner_text()
    page.select_option('#rate-unit-select','1000');page.click('#catalog-button');page.wait_for_function("document.querySelector('#catalog-dialog').open")
    assert '100만' in page.locator('#catalog-dialog').inner_text();close('catalog-dialog');page.select_option('#rate-unit-select','1000000')
    passed('Mixed models show separate rate groups, while catalog remains clearly per-million')
    ingest('unknown-tariff',model='synthetic-unpriced-model');refresh()
    assert '계산분' in page.locator('#total-cost').inner_text() or '계산' in page.locator('#billing-rows').inner_text()
    passed('Unpriced model remains an explicit partial amount; no other model price is substituted')
    # Missing cache and THINKING metadata in a supported imported response.
    call('/api/usage',{'schema':'token-meter.usage.v1','format':'openai','modelProvider':'openai','model':'gpt-6-sol','requestId':'missing-optional','timestamp':page.evaluate('new Date().toISOString()'),'modality':'text','usage':{'input_tokens':100,'output_tokens':15}})
    refresh();assert '캐시 쓰기 카운터가 없습니다' in page.locator('#input-bucket-notes').inner_text()
    passed('Missing cache metadata remains annotated instead of silently becoming a confirmed zero')
    page.select_option('#provider','claude');page.wait_for_timeout(180);assert page.locator('#total-tokens').inner_text() in ['—','0']
    page.select_option('#provider','all');page.wait_for_timeout(150)
    passed('Provider filter with no active records does not show the previous provider tariff')
    assert not errors,errors;passed('No uncaught JavaScript errors during billing, filters, history, settings, measurement and deletion flows')
    browser.close()
report={'version':'0.10.2','passed':len(checks),'checks':checks,'errors':errors,'syntheticData':True,'mode':'about:blank-app-and-real-loopback-api' if a.offline else 'browser-navigation','limitations':['No real VS Code installation','No original user logs or billing account','No OS-level PiP test','Offline mode does not test navigation/CSP']}
(out/'billing-ui-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
print(json.dumps({'passed':len(checks),'errors':errors}))
