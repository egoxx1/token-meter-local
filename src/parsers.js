'use strict';
// Only metadata is returned. Prompt, response and tool bodies must never enter the ledger.
const path = require('node:path');
const {attachSplit} = require('./output-breakdown');
const { text, number, count, hash, iso, project } = require('./util');
const KEYS = ['input_tokens', 'cached_input_tokens', 'cache_write_input_tokens', 'output_tokens', 'reasoning_output_tokens', 'total_tokens'];
function initial(provider, file) {
  const sub = /[/\\]subagents[/\\]/.test(file) || /^agent-/.test(path.basename(file));
  return { provider, parentHint: provider === 'gemini' && path.basename(path.dirname(path.dirname(file))) === 'chats' ? text(path.basename(path.dirname(file)),180) : '', sessionId: hash(file), model: '', effort: '', serviceTier: 'standard', modelProvider: '', role: sub ? 'subagent' : 'main', agentId: sub ? text(path.basename(file, '.jsonl')) : '', ...project('', `${provider}: 미분류`), epoch: 0, lastTotals: null, lastTime: null, metaTime: null, forkedFrom: null, turnId: '' };
}
function common(s, timestamp) {
  return { provider: s.provider, sessionId: `${s.provider}:${s.sessionId}`, projectId: s.projectId, project: s.project, model: s.model || 'unknown', effort: s.effort, role: s.role, agentId: s.agentId, parentSessionId: s.parentSessionId || null, timestamp: iso(timestamp), modelEvidence: 'log', serviceTier: s.serviceTier || 'standard', modelProvider: s.modelProvider || '', warnings: [] };
}
function usageBase() { return { input: 0, output: 0, normalInput: 0, cacheRead: 0, cacheWrite: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheWriteUnknown: 0, reasoning: 0, tool: 0, total: 0 }; }
function effort(value) { return text(typeof value === 'string' ? value : value?.effort || value?.level || '', 40); }
function touch(s, time) { const ts = iso(time); if (ts && (!s.lastTime || ts > s.lastTime)) s.lastTime = ts; }
function openaiUsage(u) {
  const t = usageBase();
  t.input = number(u.input_tokens); t.output = number(u.output_tokens);
  t.cacheRead = number(u.cached_input_tokens); t.cacheWrite = number(u.cache_write_input_tokens);
  t.cacheWriteUnknown = t.cacheWrite;
  t.normalInput = Math.max(0, t.input - t.cacheRead - t.cacheWrite);
  t.reasoning = number(u.reasoning_output_tokens); t.total = t.input + t.output;
  return attachSplit(t, {thinking:count(u.reasoning_output_tokens),source:'openai-output-tokens-details'});
}
function codex(row, s) {
  const p = row?.payload;
  if (!p || typeof p !== 'object') return [];
  if (row.type === 'session_meta') {
    s.sessionId = text(p.id, 180) || s.sessionId;
    s.metaTime = iso(p.timestamp) || iso(row.timestamp);
    s.forkedFrom = text(p.forked_from_id) || null;
    s.parentSessionId = text(p.parent_thread_id) || text(p.source?.subagent?.spawn?.parent_thread_id) || null;
    s.modelProvider = text(p.model_provider);
    if (p.cwd) Object.assign(s, project(p.cwd));
    if (s.parentSessionId || (p.source && typeof p.source === 'object' && p.source.subagent)) { s.role = 'subagent'; s.agentId = s.sessionId; }
    return [];
  }
  if (row.type === 'turn_context') {
    if (p.cwd) Object.assign(s, project(p.cwd));
    s.model = text(p.model) || s.model;
    s.modelProvider = text(p.model_provider) || s.modelProvider;
    s.effort = effort(p.effort ?? p.reasoning_effort);
    s.turnId = text(p.turn_id) || s.turnId;
    s.serviceTier = text(p.service_tier) || 'standard';
    touch(s, row.timestamp);
    return [];
  }
  if (row.type !== 'event_msg' || p.type !== 'token_count' || !p.info?.total_token_usage) return [];
  const raw = p.info.total_token_usage;
  if (count(raw.input_tokens) === null || count(raw.output_tokens) === null) { s.invalidUsage = (s.invalidUsage || 0) + 1; return []; }
  const totals = Object.fromEntries(KEYS.map(k => [k, number(raw[k])]));
  const previous = s.lastTotals;
  const reasoningPresent=count(raw.reasoning_output_tokens)!==null;
  const reasoningDeltaKnown=reasoningPresent&&(!previous||(s.lastReasoningKnown===true&&totals.reasoning_output_tokens>=previous.reasoning_output_tokens));
  const readKnown=count(raw.cached_input_tokens)!==null&&(!previous||s.lastCacheReadKnown===true)&&totals.cached_input_tokens>=(previous?.cached_input_tokens||0);
  const writeKnown=count(raw.cache_write_input_tokens)!==null&&(!previous||s.lastCacheWriteKnown===true)&&totals.cache_write_input_tokens>=(previous?.cache_write_input_tokens||0);
  s.lastCacheReadKnown=count(raw.cached_input_tokens)!==null;s.lastCacheWriteKnown=count(raw.cache_write_input_tokens)!==null;
  s.lastReasoningKnown=reasoningPresent;
  s.lastTotals = totals;
  touch(s, row.timestamp);
  s.contextWindow = count(p.info.model_context_window);
  s.lastContextTokens = count(p.info.last_token_usage?.total_tokens);
  // A counter rollback is a new baseline, not negative usage and not a fresh bill.
  if (previous && ['input_tokens','output_tokens'].some(k => totals[k] < previous[k])) { s.epoch++; s.counterResets = (s.counterResets || 0) + 1; return []; }
  const delta = Object.fromEntries(KEYS.map(k => [k, totals[k] - (previous?.[k] || 0)]));
  if (delta.input_tokens + delta.output_tokens === 0) return [];
  if (s.forkedFrom && s.metaTime && iso(row.timestamp) && iso(row.timestamp) < s.metaTime) return [];
  const e = { ...common(s, row.timestamp), ...openaiUsage({...delta,reasoning_output_tokens:reasoningDeltaKnown?delta.reasoning_output_tokens:undefined}), modelEvidence: 'turn-context' };
  if (delta.cached_input_tokens<0||delta.cache_write_input_tokens<0)e.warnings.push('cache-breakdown-inconsistent');
  if(reasoningPresent&&previous&&raw.reasoning_output_tokens<previous.reasoning_output_tokens)e.warnings.push('reasoning-counter-inconsistent');
  // Shared turn IDs make copied history deduplicate across forked files too.
  e.id = `codex:${hash((s.turnId || s.sessionId) + ':' + (iso(row.timestamp) || '') + ':' + JSON.stringify(totals))}`;
  e.cacheReadKnown=readKnown;e.cacheWriteKnown=writeKnown;e.inputEvidence='codex-counter-delta';
  e.contextInputKnown=count(p.info.last_token_usage?.input_tokens)!==null&&e.input<=p.info.last_token_usage.input_tokens;
  e.contextInput = number(p.info.last_token_usage?.input_tokens, e.input);
  if (e.cacheRead + e.cacheWrite > e.input || e.reasoning > e.output) e.warnings.push('inconsistent-token-breakdown');
  if (!previous && p.info.last_token_usage && delta.input_tokens + delta.output_tokens > number(p.info.last_token_usage.input_tokens) + number(p.info.last_token_usage.output_tokens)) {
    e.model = 'unknown'; e.modelEvidence = 'history-gap'; e.warnings.push('history-gap-model-unknown');
  }
  if (!e.timestamp) e.warnings.push('timestamp-missing');
  return [e];
}
function claude(row, s) {
  if (!row || row.type !== 'assistant' || !row.message?.usage) return [];
  const m = row.message, u = m.usage;
  if (row.sessionId) s.sessionId = text(row.sessionId, 180);
  if (row.cwd) Object.assign(s, project(row.cwd));
  if (row.isSidechain || row.agentId) { s.role = 'subagent'; s.agentId = text(row.agentId) || s.agentId; }
  s.model = text(m.model) || s.model;
  s.modelProvider = text(row.modelProvider) || s.modelProvider;
  s.serviceTier = u.speed === 'fast' || row.speed === 'fast' ? 'fast' : text(u.service_tier) || 'standard';
  s.effort = effort(row.effort ?? row.reasoningEffort);
  touch(s, row.timestamp);
  const req = text(row.requestId, 180) || text(m.id, 180);
  if (!req) { s.missingIds = (s.missingIds || 0) + 1; return []; }
  const e = { ...common(s, row.timestamp), ...usageBase(), id: `claude:${req}`, modelEvidence: 'response-model' };
  e.normalInput = number(u.input_tokens); e.output = number(u.output_tokens);
  e.cacheRead = number(u.cache_read_input_tokens);
  e.cacheWrite5m = number(u.cache_creation?.ephemeral_5m_input_tokens);
  e.cacheWrite1h = number(u.cache_creation?.ephemeral_1h_input_tokens);
  const nested = e.cacheWrite5m + e.cacheWrite1h;
  e.cacheWrite = Math.max(number(u.cache_creation_input_tokens), nested);
  e.cacheWriteUnknown = Math.max(0, e.cacheWrite - nested);
  e.input = e.normalInput + e.cacheRead + e.cacheWrite;
  e.total = e.input + e.output; e.contextInput = e.input;e.contextInputKnown=true;
  e.cacheReadKnown=count(u.cache_read_input_tokens)!==null;e.cacheWriteKnown=count(u.cache_creation_input_tokens)!==null||count(u.cache_creation?.ephemeral_5m_input_tokens)!==null||count(u.cache_creation?.ephemeral_1h_input_tokens)!==null;e.inputEvidence='anthropic-named-counters';
  const thinking=u.output_tokens_details?.thinking_tokens??u.output_tokens_details?.reasoning_tokens;
  e.reasoning = number(thinking);
  attachSplit(e,{thinking:count(thinking),source:u.output_tokens_details?.thinking_tokens!=null?'anthropic-thinking-tokens':'anthropic-output-details'});
  if (count(u.input_tokens) === null || count(u.output_tokens) === null) e.warnings.push('usage-fields-missing');
  if (count(u.cache_creation_input_tokens) !== null && nested && u.cache_creation_input_tokens !== nested) e.warnings.push('cache-breakdown-inconsistent');
  // Older transcripts can contain streaming placeholders. Never claim invoice accuracy.
  if (m.stop_reason == null) e.warnings.push('transcript-not-final');
  if (e.reasoning > e.output) e.warnings.push('inconsistent-token-breakdown');
  if (!e.timestamp) e.warnings.push('timestamp-missing');
  return [e];
}
function geminiMessage(m, s) {
  if (!m || m.type !== 'gemini' || !m.tokens) return [];
  if (!m.id) { s.missingIds = (s.missingIds || 0) + 1; return []; }
  const u = m.tokens;
  s.model = text(m.model) || s.model;
  touch(s, m.timestamp);
  const e = { ...common(s, m.timestamp), ...usageBase(), id: `gemini:${s.sessionId}:${text(m.id, 180)}`, modelEvidence: 'recorded-model' };
  e.input = number(u.input); e.cacheRead = number(u.cached);
  e.reasoning = number(u.thoughts); e.output = number(u.output) + e.reasoning;
  e.tool = number(u.tool);
  // Some Gemini responses report tool-use prompts separately. Add only when the total proves it.
  if (e.tool && number(u.total) === e.input + e.output + e.tool) e.input += e.tool;
  else if (e.tool && number(u.total) !== e.input + e.output) e.warnings.push('tool-token-accounting-unknown');
  e.normalInput = Math.max(0, e.input - e.cacheRead); e.total = e.input + e.output; e.contextInput = e.input;e.contextInputKnown=true;
  e.cacheReadKnown=count(u.cache_read_input_tokens)!==null;e.cacheWriteKnown=count(u.cache_creation_input_tokens)!==null||count(u.cache_creation?.ephemeral_5m_input_tokens)!==null||count(u.cache_creation?.ephemeral_1h_input_tokens)!==null;e.inputEvidence='anthropic-named-counters';
  if (count(u.input) === null || count(u.output) === null) e.warnings.push('usage-fields-missing');
  if (e.cacheRead > e.input) e.warnings.push('inconsistent-token-breakdown');
  if (count(u.total) !== null && u.total !== e.total) e.warnings.push('reported-total-mismatch');
  if (!e.timestamp) e.warnings.push('timestamp-missing');
  attachSplit(e,{thinking:count(u.thoughts),response:count(u.thoughts)!==null?number(u.output):null,source:'gemini-cli-tokens',totalKnown:count(u.thoughts)!==null||count(u.total)!==null&&u.total===e.total});
  return [e];
}
function geminiMeta(row, s) {
  if (row.sessionId) s.sessionId = text(row.sessionId, 180);
  if (row.projectHash) { s.projectId = text(row.projectHash, 200); s.project = `Gemini ${s.projectId.slice(0, 8)}`; }
  if (Array.isArray(row.directories) && row.directories[0]) Object.assign(s, project(row.directories[0]));
  if (row.kind === 'subagent') { s.role = 'subagent'; s.agentId = s.sessionId; if(s.parentHint)s.parentSessionId='gemini:'+s.parentHint; }
}
function gemini(row, s) {
  if (!row || typeof row !== 'object') return [];
  if (row.$set) { geminiMeta(row.$set, s); return Array.isArray(row.$set.messages) ? row.$set.messages.flatMap(m=>geminiMessage(m,s)) : []; }
  // Rewind changes context; it cannot refund already observed usage.
  if (row.$rewindTo) return [];
  if (row.sessionId) geminiMeta(row, s);
  if (Array.isArray(row.messages)) return row.messages.flatMap(m => geminiMessage(m, s));
  return geminiMessage(row, s);
}
function parse(provider, row, state) { return ({ codex, claude, gemini, generic:require('./generic').generic })[provider](row, state); }
module.exports = { initial, parse, codex, claude, gemini, openaiUsage, KEYS };
