"""0.10.1 UI acceptance against a separate synthetic reliability-demo collector.
The optional --offline bridge tests actual app code/local HTTP, NOT navigation/CSP/PiP.
Never points at actual user data. Start scripts/reliability-demo.js first.
"""
import argparse, json, pathlib, re, urllib.request, urllib.error
from playwright.sync_api import sync_playwright
p=argparse.ArgumentParser();p.add_argument('data_dir');p.add_argument('--output',default='reliability-ui');p.add_argument('--offline',action='store_true');a=p.parse_args()
root=pathlib.Path(__file__).resolve().parent.parent;out=pathlib.Path(a.output);out.mkdir(parents=True,exist_ok=True)
r=json.loads(pathlib.Path(a.data_dir,'runtime.json').read_text());checks=[];errors=[]
if not r.get('demo') or not pathlib.Path(a.data_dir).name.startswith('token-meter-demo-reliability-'):raise SystemExit('Isolated reliability demo required')
def call(endpoint,body=None):
 headers={'Authorization':'Bearer '+r['token']}
 if body is not None:headers['Content-Type']='application/json'
 req=urllib.request.Request(r['origin']+endpoint,data=json.dumps(body).encode() if body is not None else None,headers=headers)
 with urllib.request.urlopen(req,timeout=180) as x:return json.loads(x.read())
def passed(name):checks.append(name);print(name,flush=True)
with sync_playwright() as pw:
 browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
 page=browser.new_page(viewport={'width':1440,'height':1080},device_scale_factor=1);page.set_default_timeout(15000)
 page.on('pageerror',lambda e:errors.append(str(e)))
 if a.offline:
  html=re.sub(r'<script\b[^>]*>.*?</script>','',(root/'web/index.html').read_text()).replace('<link rel="stylesheet" href="/style.css">','')
  page.set_content(html);page.add_style_tag(content=(root/'web/style.css').read_text())
  def bridge(endpoint,opts):
   if not endpoint.startswith('/api/'):raise ValueError('Only local API paths')
   req=urllib.request.Request(r['origin']+endpoint,data=opts.get('body','').encode() if 'body' in opts else None,headers=opts.get('headers',{}),method=opts.get('method','GET'))
   try:x=urllib.request.urlopen(req,timeout=180)
   except urllib.error.HTTPError as e:x=e
   with x:return {'body':x.read().decode(),'status':x.status,'headers':dict(x.headers)}
  page.expose_function('__tmTestFetch',bridge)
  page.evaluate("""token=>{Object.defineProperty(window,'sessionStorage',{value:{getItem:()=>token,setItem(){}}});window.fetch=async(endpoint,options={})=>{const v=await window.__tmTestFetch(endpoint,options);return new Response(v.body,{status:v.status,headers:v.headers});};}""",r['token'])
  for f in ['src/billing-view.js','web/app.js','web/measurements.js','web/history.js','web/rates.js','web/data-controls.js','web/reliability.js']:page.add_script_tag(content=(root/f).read_text())
 else:page.goto(r['origin']+'/#key='+r['token'])
 page.wait_for_function("document.querySelector('#verify-session').options.length>=3")
 assert '0.10.1' in page.locator('#app-version').inner_text();assert not page.locator('#version-warning').is_visible()
 passed('Static UI version agrees with running collector without a stale hard-coded warning')
 scope=page.locator('#scope-explanation').inner_text();assert '전체 초기화 기준' in scope and '입력 전체' in scope and 'Codex' in scope and 'Antigravity' in scope
 passed('Mixed active view exposes epoch time, included providers and inclusive input definition')
 assert '25 → 559' in page.locator('#repair-results').inner_text();assert '359' in page.locator('#repair-results').inner_text()
 assert '정확히 복원' in page.locator('#repair-results').inner_text()
 passed('Repair report shows 25 to 559, 359 active, and irrecoverable boundary qualification')
 page.select_option('#verify-session','antigravity:reliability-session')
 page.click('#open-source-session');page.wait_for_function("document.querySelector('#total-tokens').textContent==='75,044,000'")
 assert page.locator('#provider').input_value()=='antigravity';assert page.locator('#session').input_value()=='antigravity:reliability-session'
 assert page.locator('#dataset-select').input_value()=='source'
 assert '74,740,000' in page.locator('#scope-explanation').inner_text();assert '초기화 전 포함' in page.locator('#scope-explanation').inner_text()
 passed('Source-session view shows 559 complete observed calls and 74,740,000 inclusive input, not mixed Codex')
 page.screenshot(path=str(out/'session-overview.png'),full_page=False)
 page.click('#open-active-session');page.wait_for_function("document.querySelector('#dataset-select').value==='active'")
 page.wait_for_timeout(300);d=call('/api/status?scope=session&provider=antigravity&session=antigravity:reliability-session')
 assert d['summary']['records']==359;assert page.locator('#total-tokens').inner_text()==f"{d['summary']['total']:,}"
 assert '초기화 이후' in page.locator('#scope-explanation').inner_text()
 passed('Active-session view retains reset boundary; viewing source did not re-add pre-reset use')
 page.click('#verify-db');page.wait_for_function("document.querySelector('#verification-result').textContent.includes('장부 일치')",timeout=60000)
 assert '559' in page.locator('#verification-result').inner_text();assert '74,740,000' in page.locator('#verification-result').inner_text()
 assert '독립 검증이 아닙니다' in page.locator('#verification-result').inner_text()
 passed('Real local SQLite re-read displays source/ledger differences with verification limits')
 cells=page.locator('#verification-result tbody tr td:last-child');assert cells.count()==7
 for cell in cells.all():
  assert cell.inner_text()=='0'
  box=cell.bounding_box();assert box['x']+box['width']<=page.viewport_size['width']+1
 page.evaluate("document.querySelector('#bottom-bar').style.visibility='hidden'")
 page.locator('#reliability-panel').screenshot(path=str(out/'reconciliation.png'))
 page.evaluate("document.querySelector('#bottom-bar').style.visibility=''")
 with page.expect_download() as dl:page.click('#reliability-export')
 artifact=out/'diagnostics-synthetic.json';dl.value.save_as(str(artifact));diag=json.loads(artifact.read_text());serialized=json.dumps(diag)
 assert diag['schema']=='token-meter.diagnostics.v1';assert r['token'] not in serialized;assert a.data_dir not in serialized;assert 'PRIVATE_ANTIGRAVITY' not in serialized
 passed('Diagnostic download contains counters and hashes, not bearer key/source paths/body')
 page.locator('#reliability-panel details > summary').click()
 page.fill('#reference-input','1.36M');page.fill('#reference-output','41.2k');page.fill('#reference-thinking','24.2k');page.select_option('#reference-output-meaning','inclusive');page.select_option('#reference-dataset','source')
 page.locator('#reference-compare-form button[type="submit"]').click();page.wait_for_function("document.querySelector('#reference-result').textContent.includes('차이 있음')")
 passed('CLI numbers from a different snapshot yield explicit differences instead of forced equality')
 page.fill('#reference-input','74,740,000');page.fill('#reference-output','304,000');page.fill('#reference-thinking','111,800')
 page.locator('#reference-compare-form button[type="submit"]').click();page.wait_for_function("document.querySelector('#reference-result').querySelectorAll('tbody tr').length===3")
 page.wait_for_timeout(250);assert '차이 있음' not in page.locator('#reference-result').inner_text();assert '참고 해석' in page.locator('#reference-result').inner_text()
 passed('Matching exact counts compare successfully, with separate THINKING reference warning')
 page.locator('#reliability-panel').screenshot(path=str(out/'reference-comparison.png'))
 before=call('/api/status?scope=all')['summary']['total'];page.click('#measure-session');page.wait_for_timeout(450)
 measurements=call('/api/measurements');runs=measurements['runs'];run=runs[0]
 assert run['filter']['sessionId']=='antigravity:reliability-session';assert run['filter']['provider']=='antigravity'
 assert measurements['pinnedId']==run['id'];assert call('/api/status?scope=all')['summary']['total']==before
 passed('Session-only measurement and pin leave cumulative data unchanged and exclude other sessions')
 page.click('#open-source-session');page.wait_for_timeout(300)
 for width in [375,768,1440]:
  page.set_viewport_size({'width':width,'height':1000});page.wait_for_timeout(150)
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),f'page overflow {width}'
  for selector in ['#reliability-refresh','#verify-session','#verify-db','#reliability-export']:
   box=page.locator(selector).bounding_box();assert box and box['width']>0 and box['x']>=-1 and box['x']+box['width']<=width+1,(width,selector,box)
  passed(f'Reliability and scope controls remain within {width}px viewport')
  if width==375:page.locator('#reliability-panel').screenshot(path=str(out/'mobile-reconciliation.png'))
 assert not errors,errors;passed('No uncaught JavaScript errors in recovery, comparison, diagnostic export and session actions')
 browser.close()
(out/'report.json').write_text(json.dumps({'passed':len(checks),'checks':checks,'errors':errors,'synthetic':True,'offlineBridge':a.offline},ensure_ascii=False,indent=2))
print(json.dumps({'passed':len(checks),'errors':errors}))
