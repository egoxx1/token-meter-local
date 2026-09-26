'use strict';
// Read-only, bounded HTTPS downloads. No CLI credentials, cookies or usage are sent.
const https = require('node:https');
const dns = require('node:dns');
const net = require('node:net');
function publicAddress(ip) {
  if (net.isIP(ip) === 4) {
    const [a,b] = ip.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0)) ||
      (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19)));
  }
  // Only global-unicast IPv6; mapped/private/link-local addresses are refused.
  return net.isIP(ip) === 6 && /^[23][0-9a-f]{3}:/i.test(ip) && !/^2001:db8:/i.test(ip);
}
function checkedUrl(value, hosts) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || (url.port && url.port !== '443')) throw new Error('HTTPS 기본 포트 URL만 허용합니다. 인증정보/fragment는 금지합니다.');
  if (!hosts.includes(url.hostname.toLowerCase()) || net.isIP(url.hostname.replace(/[\[\]]/g,''))) throw new Error('다운로드 호스트가 허용 목록에 없습니다.');
  return url;
}
function getBytes(value, { hosts, maxBytes = 16*1024*1024, timeoutMs = 15000, etag } = {}) {
  const url = checkedUrl(value, hosts || []);
  return new Promise((resolve, reject) => {
    let settled = false, timer;
    const finish = (error, result) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(result); };
    const req = https.get(url, {
      headers: { Accept: 'application/json, application/octet-stream', 'Accept-Encoding': 'identity', 'User-Agent': 'Token-Meter-Local/0.2.0', ...(etag ? {'If-None-Match':etag} : {}) },
      lookup: (host, options, cb) => dns.lookup(host, {all:true}, (error, addresses) => {
        if (error) return cb(error);
        if (!addresses.length || addresses.some(a => !publicAddress(a.address))) return cb(new Error('사설/예약 IP로의 업데이트 연결을 차단했습니다.'));
        return options?.all ? cb(null, addresses) : cb(null, addresses[0].address, addresses[0].family);
      })
    }, res => {
      if (res.statusCode === 304) { res.resume(); return finish(null, {notModified:true, etag}); }
      // No redirects: do not widen the trust boundary or leak request headers.
      if (res.statusCode !== 200) { res.resume(); return finish(new Error(`업데이트 서버 HTTP ${res.statusCode}`)); }
      if (Number(res.headers['content-length']) > maxBytes) { req.destroy(); return finish(new Error('다운로드 크기 제한 초과')); }
      const chunks = []; let size = 0;
      res.on('data', chunk => { size += chunk.length; if (size > maxBytes) { req.destroy(); finish(new Error('다운로드 크기 제한 초과')); } else chunks.push(chunk); });
      res.on('end', () => finish(null, {bytes:Buffer.concat(chunks), etag:res.headers.etag || null}));
      res.on('error', error => finish(error));
      res.on('aborted', () => finish(new Error('다운로드가 중단되었습니다.')));
    });
    req.on('error', error => finish(error));
    timer = setTimeout(() => { req.destroy(); finish(new Error('업데이트 연결 시간 초과')); }, timeoutMs);
  });
}
async function getJson(url, options) {
  const result = await getBytes(url, options);
  if (result.notModified) return result;
  try { return {...result, data:JSON.parse(result.bytes.toString('utf8'))}; }
  catch { throw new Error('업데이트 응답이 올바른 JSON이 아닙니다.'); }
}
module.exports = { checkedUrl, publicAddress, getBytes, getJson };
