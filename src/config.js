'use strict';
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs/promises');
const { expand, readJson, atomicJson } = require('./util');
const PROVIDERS = ['codex', 'claude', 'antigravity', 'gemini', 'generic'];
function defaults() {
  const codex = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  const claude = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  return {
    version: 1, catalogUpdates: { enabled: false, intervalHours: 24, sources: ['models-dev', 'openrouter'] }, appUpdates: { enabled: false, intervalHours: 24, manifestUrl: '', publicKey: '', allowedHosts: [], autoDownload: false }, pollMs: 5000, timeZone: 'Asia/Seoul',
    billingMode: 'equivalent', dailyBudgetUsd: null, usdToKrw: null, fxAsOf: null,
    roots: { codex: [path.join(codex, 'sessions'), path.join(codex, 'archived_sessions')], claude: [path.join(claude, 'projects')], antigravity: process.env.ANTIGRAVITY_DATA_DIR ? process.env.ANTIGRAVITY_DATA_DIR.split(',').map(s=>expand(s.trim())).filter(Boolean) : ['antigravity','antigravity-cli','antigravity-ide'].map(app=>path.join(os.homedir(),'.gemini',app,'conversations')), gemini: [path.join(os.homedir(), '.gemini', 'tmp')], generic: [] },
    maxDepth: 12, maxFiles: 20000,
    notes: 'billingMode: equivalent = API 환산, api-estimate = API 추정. 실제 청구액/구독 한도는 수집하지 않습니다. 원화 환율은 직접 입력합니다.'
  };
}
function validate(raw) {
  const d = defaults();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('설정은 JSON 객체여야 합니다.');
  const c = { ...d };
  if (raw.timeZone !== undefined) {
    try { new Intl.DateTimeFormat('en', { timeZone: raw.timeZone }).format(); } catch { throw new Error('올바르지 않은 timeZone'); }
    c.timeZone = raw.timeZone;
  }
  if (raw.pollMs !== undefined) {
    if (!Number.isInteger(raw.pollMs) || raw.pollMs < 1000 || raw.pollMs > 60000) throw new Error('pollMs는 1000~60000 정수');
    c.pollMs = raw.pollMs;
  }
  for (const key of ['dailyBudgetUsd', 'usdToKrw']) {
    if (raw[key] === null || raw[key] === undefined) c[key] = null;
    else if (typeof raw[key] === 'number' && Number.isFinite(raw[key]) && raw[key] > 0 && raw[key] <= 1e9) c[key] = raw[key];
    else throw new Error(`${key}: 양수 또는 null 필요`);
  }
  if (raw.fxAsOf != null) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw.fxAsOf)) throw new Error('fxAsOf: YYYY-MM-DD 형식 필요');
    c.fxAsOf = raw.fxAsOf;
  }
  if (raw.billingMode !== undefined) {
    if (!['equivalent', 'api-estimate'].includes(raw.billingMode)) throw new Error('billingMode: equivalent 또는 api-estimate');
    c.billingMode = raw.billingMode;
  }
  if (raw.roots !== undefined) {
    c.roots = {};
    for (const p of PROVIDERS) {
      const roots = raw.roots[p] ?? d.roots[p];
      if (!Array.isArray(roots) || roots.length > 20 || roots.some(r => typeof r !== 'string' || !r || r.length > 4096)) throw new Error(`roots.${p}: 경로 배열 필요`);
      c.roots[p] = [...new Set(roots.map(expand))];
    }
  }
  for (const key of ['maxDepth', 'maxFiles']) if (raw[key] !== undefined) {
    if (!Number.isSafeInteger(raw[key]) || raw[key] < 1 || raw[key] > (key === 'maxDepth' ? 30 : 200000)) throw new Error(`잘못된 ${key}`);
    c[key] = raw[key];
  }
  if (raw.catalogUpdates !== undefined) {
    const u = raw.catalogUpdates;
    if (!u || typeof u !== 'object' || typeof u.enabled !== 'boolean' || !Array.isArray(u.sources) || !u.sources.length || u.sources.some(x => !['models-dev','openrouter'].includes(x))) throw new Error('catalogUpdates 설정 오류');
    const hours = u.intervalHours ?? 24;
    if (!Number.isInteger(hours) || hours < 1 || hours > 168) throw new Error('가격표 갱신 간격: 1~168시간');
    c.catalogUpdates = {enabled:u.enabled, intervalHours:hours, sources:[...new Set(u.sources)]};
  }
  if (raw.appUpdates !== undefined) {
    const u = raw.appUpdates;
    if (!u || typeof u.enabled !== 'boolean' || !Array.isArray(u.allowedHosts) || u.allowedHosts.length > 10 || u.allowedHosts.some(h => typeof h !== 'string' || !/^[a-z0-9.-]+$/.test(h) || h.length > 253)) throw new Error('appUpdates 설정 오류');
    const hours = u.intervalHours ?? 24;
    if (!Number.isInteger(hours) || hours < 1 || hours > 168 || typeof (u.autoDownload ?? false) !== 'boolean') throw new Error('appUpdates 간격/다운로드 설정 오류');
    if (typeof u.manifestUrl !== 'string' || u.manifestUrl.length > 2000 || typeof u.publicKey !== 'string' || u.publicKey.length > 2000) throw new Error('업데이트 URL/키 오류');
    if (u.manifestUrl) require('./network').checkedUrl(u.manifestUrl, u.allowedHosts);
    if (u.publicKey && require('node:crypto').createPublicKey(u.publicKey).asymmetricKeyType !== 'ed25519') throw new Error('Ed25519 공개키만 지원');
    if (u.enabled && (!u.manifestUrl || !u.publicKey)) throw new Error('자동 업데이트에는 배포 URL과 별도로 신뢰한 Ed25519 공개키가 필요합니다.');
    c.appUpdates = {enabled:u.enabled, intervalHours:hours, manifestUrl:u.manifestUrl, publicKey:u.publicKey, allowedHosts:u.allowedHosts, autoDownload:u.autoDownload ?? false};
  }
  return c;
}
async function initConfig(dir) {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, 'config.json');
  if (await readJson(file, null) === null) await atomicJson(file, defaults());
  const custom = path.join(dir, 'prices.user.json');
  if (await readJson(custom, null) === null) await atomicJson(custom, { version: 1, rules: [] });
  return validate(await readJson(file, {}));
}
module.exports = { defaults, validate, initConfig, PROVIDERS };
