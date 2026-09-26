'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
function text(value, max = 200) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '').slice(0, max) : '';
}
function count(value) { return Number.isSafeInteger(value) && value >= 0 ? value : null; }
function number(value, fallback = 0) { return count(value) ?? fallback; }
function hash(value) { return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 24); }
function iso(value) { const t = Date.parse(value); return Number.isFinite(t) ? new Date(t).toISOString() : null; }
function expand(p) { return path.resolve(p === '~' ? os.homedir() : p.startsWith('~/') || p.startsWith('~\\') ? path.join(os.homedir(), p.slice(2)) : p); }
function project(value, fallback = '미분류') {
  const v = text(value, 2048);
  return v ? { projectId: hash(v), project: text(v.split(/[\\/]/).filter(Boolean).pop() || v, 80) } : { projectId: hash(fallback), project: text(fallback, 80) };
}
async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return fallback; throw new Error(`${path.basename(file)} 읽기 실패 (${e.code || '잘못된 JSON'})`); }
}
async function atomicJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    await fs.writeFile(tmp, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
    await fs.rename(tmp, file);
  } finally { await fs.unlink(tmp).catch(() => {}); }
}
function short(n) { return n >= 1e9 ? `${(n/1e9).toFixed(2)}B` : n >= 1e6 ? `${(n/1e6).toFixed(2)}M` : n >= 1000 ? `${(n/1000).toFixed(1)}K` : String(n); }
function money(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '미정';
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: n > 0 && n < 0.01 ? 12 : 6 });
}
function csvCell(v) {
  let s = String(v ?? '');
  if (/^[\s]*[=+@-]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}
module.exports = { text, count, number, hash, iso, expand, project, readJson, atomicJson, short, money, csvCell };
