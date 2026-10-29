/**
 * Small shared store for the My account assistant: the daily question count (so the limit is exact and
 * the rep can see how many are left), the usage log, and the "this looks wrong" feedback.
 *
 * It talks to an Upstash Redis database over its REST API (created from Vercel Storage, which adds
 * KV_REST_API_URL / KV_REST_API_TOKEN, or UPSTASH_REDIS_REST_URL / _TOKEN, to the project). With no database
 * connected it falls back to memory on this server only, so local tests and a first deploy still work, but
 * counts then reset whenever the server restarts and are not shared between servers.
 *
 * Only small facts are kept: who (the rep key), when, which tools ran, whether it worked, how long it took,
 * the size of the AI call, and a short copy of the question. Never answers, never figures.
 */
import { createHash as _hash } from 'node:crypto';
const url = () => process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const token = () => process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
export const storeConnected = () => Boolean(url() && token());

// ── memory fallback ─────────────────────────────────────────────────────────────────────────────
const mem = { kv: new Map(), lists: new Map(), exp: new Map() };
const alive = (k) => { const e = mem.exp.get(k); if (e && Date.now() > e) { mem.kv.delete(k); mem.lists.delete(k); mem.exp.delete(k); return false; } return true; };
const memRun = (a) => {
  const [op, key, ...rest] = a; alive(key);
  switch (String(op).toUpperCase()) {
    case 'GET': return mem.kv.has(key) ? String(mem.kv.get(key)) : null;
    case 'SET': mem.kv.set(key, rest[0]); return 'OK';
    case 'INCR': { const v = (Number(mem.kv.get(key)) || 0) + 1; mem.kv.set(key, v); return v; }
    case 'DECR': { const v = (Number(mem.kv.get(key)) || 0) - 1; mem.kv.set(key, v); return v; }
    case 'EXPIRE': mem.exp.set(key, Date.now() + Number(rest[0]) * 1000); return 1;
    case 'HINCRBY': { const h = mem.kv.get(key) || {}; h[rest[0]] = (Number(h[rest[0]]) || 0) + Number(rest[1]); mem.kv.set(key, h); return h[rest[0]]; }
    case 'HGETALL': { const h = mem.kv.get(key) || {}; return Object.entries(h).flatMap(([k, v]) => [k, String(v)]); }
    case 'LPUSH': { const l = mem.lists.get(key) || []; l.unshift(rest[0]); mem.lists.set(key, l); return l.length; }
    case 'LTRIM': { const l = mem.lists.get(key) || []; mem.lists.set(key, l.slice(Number(rest[0]), Number(rest[1]) + 1)); return 'OK'; }
    case 'LRANGE': { const l = mem.lists.get(key) || []; const e = Number(rest[1]); return l.slice(Number(rest[0]), e < 0 ? undefined : e + 1); }
    default: throw new Error(`memory store: unsupported ${op}`);
  }
};

async function run(args) {
  if (!storeConnected()) return memRun(args);
  const res = await fetch(url(), {
    method: 'POST', headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args), signal: AbortSignal.timeout(8000),
  });
  const j = await res.json();
  if (j.error) throw new Error(`store: ${j.error}`);
  return j.result;
}

const hashObj = (flat) => { const o = {}; for (let i = 0; i < (flat || []).length; i += 2) o[flat[i]] = Number(flat[i + 1]) || 0; return o; };

// ── daily question quota (per rep, per New Zealand day) ────────────────────────────────────────
export const dailyLimit = () => Number(process.env.REP_CHAT_DAILY_LIMIT) || 60;
const qKey = (day, rep) => `rep:q:${day}:${rep}`;

/** Takes one question from today's allowance. Returns { allowed, used, limit, remaining }. */
export async function takeQuestion(rep, day) {
  const limit = dailyLimit();
  const k = qKey(day, rep);
  const n = await run(['INCR', k]);
  if (n === 1) await run(['EXPIRE', k, 60 * 60 * 24 * 40]);   // keep 40 days, for the usage page
  if (n > limit) { await run(['DECR', k]); return { allowed: false, used: limit, limit, remaining: 0 }; }
  return { allowed: true, used: n, limit, remaining: limit - n };
}
/** Gives a question back (the system failed, so the rep should not lose it). */
export async function refundQuestion(rep, day) { await run(['DECR', qKey(day, rep)]).catch(() => {}); }
export async function quotaNow(rep, day) {
  const limit = dailyLimit();
  const used = Math.min(limit, Number(await run(['GET', qKey(day, rep)]).catch(() => 0)) || 0);
  return { used, limit, remaining: Math.max(0, limit - used) };
}
export async function dailyCount(rep, day) { return Number(await run(['GET', qKey(day, rep)]).catch(() => 0)) || 0; }

// ── usage log ──────────────────────────────────────────────────────────────────────────────────
/** entry: { t, rep, question, tools, ok, ms, inTok, outTok, why } */
export async function logUsage(entry) {
  const e = { ...entry, question: String(entry.question || '').slice(0, 300) };
  await run(['LPUSH', 'rep:usage', JSON.stringify(e)]);
  await run(['LTRIM', 'rep:usage', 0, 4999]);
  const h = `rep:stats:${entry.rep}`;
  await run(['HINCRBY', h, entry.ok ? 'ok' : 'fail', 1]);
  await run(['HINCRBY', h, 'ms', Math.round(entry.ms || 0)]);
  await run(['HINCRBY', h, 'inTok', Math.round(entry.inTok || 0)]);
  await run(['HINCRBY', h, 'outTok', Math.round(entry.outTok || 0)]);
}
export async function recentUsage(n = 200) {
  return ((await run(['LRANGE', 'rep:usage', 0, n - 1])) || []).map((s) => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean);
}
export async function repStats(rep) { return hashObj(await run(['HGETALL', `rep:stats:${rep}`])); }

// ── sign-ins (who signed in, when, from what, and failed attempts) ───────────────────────────
/** entry: { t, rep, email, how: 'page' | 'connector', ok, ua } (never the password) */
export async function logSignin(entry) {
  const e = { ...entry, email: String(entry.email || '').slice(0, 120), ua: String(entry.ua || '').slice(0, 120) };
  await run(['LPUSH', 'rep:signins', JSON.stringify(e)]);
  await run(['LTRIM', 'rep:signins', 0, 999]);
}
export async function recentSignins(n = 100) {
  return ((await run(['LRANGE', 'rep:signins', 0, n - 1])) || []).map((s) => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean);
}

// ── "this looks wrong" feedback ────────────────────────────────────────────────────────────────
/** entry: { t, rep, kind: 'wrong' | 'good', question, answer, note } */
export async function logFeedback(entry) {
  const e = { ...entry, question: String(entry.question || '').slice(0, 500), answer: String(entry.answer || '').slice(0, 2500), note: String(entry.note || '').slice(0, 500) };
  await run(['LPUSH', 'rep:feedback', JSON.stringify(e)]);
  await run(['LTRIM', 'rep:feedback', 0, 999]);
}
export async function recentFeedback(n = 100) {
  return ((await run(['LRANGE', 'rep:feedback', 0, n - 1])) || []).map((s) => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean);
}

// ── small stamps (for example, when the scheduled warm-up last ran) ───────────────────────────
export async function getStamp(name) { return Number(await run(['GET', `rep:stamp:${name}`]).catch(() => 0)) || 0; }
export async function setStamp(name, ms = Date.now()) { await run(['SET', `rep:stamp:${name}`, String(ms), 'EX', 86400]).catch(() => {}); }

// ── sign-in guessing: after 8 wrong tries for one email in 15 minutes, further tries are refused for the rest of the 15 minutes ──
const failKey = (who) => `rep:fail:${_hash('sha256').update(String(who || '').trim().toLowerCase()).digest('hex').slice(0, 24)}`;
export async function signinBlocked(who) {
  try { return (Number(await run(['GET', failKey(who)])) || 0) >= 8; } catch { return false; }
}
export async function noteSigninFail(who) {
  try { const k = failKey(who); const n = await run(['INCR', k]); if (Number(n) === 1) await run(['EXPIRE', k, 900]); } catch { /* the store is down: the 1.5 second delay still applies */ }
}
