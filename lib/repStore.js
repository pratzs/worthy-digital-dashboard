/**
 * Small shared store for everything that runs on Worthy's AI key (the My account assistant and the dashboard chat):
 * the question allowance (so the limit is exact and the person can see how many are left), the usage log, the AI
 * tokens per person per month (for the cost page), and the "this looks wrong" feedback.
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
import { nzMonth } from './aiCost.js';
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

// ── question allowance (per person, New Zealand days) ──────────────────────────────────────────
// Used by BOTH chats that run on Worthy's AI key: the team leads' My Account assistant (who = the lead's key, e.g.
// "michelle") and the dashboard chat (who = "d.<person>", lib/aiCost.js chatWho).
//
// THE RULE: every person earns `dailyLimit()` questions a day (60). Questions they do not use roll over and stay
// available for the rest of their 30-day cycle. When the cycle ends the unused ones are dropped and the next cycle
// starts again at 60. A cycle starts on the day of the person's first question. So nobody can ever ask more than
// 30 x 60 = 1,800 questions in a cycle, which is what bounds the AI bill (see docs/AI-COST.md).
export const dailyLimit = () => Number(process.env.REP_CHAT_DAILY_LIMIT) || 60;
export const CYCLE_DAYS = 30;
const qKey = (day, who) => `rep:q:${day}:${who}`;                // questions asked on one day (kept for the usage page)
const cycKey = (start, who) => `rep:cyc:${start}:${who}`;      // questions asked in the cycle that started on `start`
const firstKey = (who) => `rep:first:${who}`;                     // the day of the person's first question (anchors their cycles)
const addDay = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const dayDiff = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);

/** Where `day` falls in the person's 30-day cycle. */
async function cycleOf(who, day) {
  const first = (await run(['GET', firstKey(who)]).catch(() => null)) || day;
  const dayNo = Math.max(0, dayDiff(first, day)) % CYCLE_DAYS;       // 0 on the first day of a cycle
  const start = addDay(day, -dayNo);
  return { start, dayNo, resets: addDay(start, CYCLE_DAYS) };
}
/** Questions used so far in the cycle. The first look in a cycle adds up the daily counts (so use from before cycles existed still counts). */
async function cycleUsed(who, c, write) {
  const k = cycKey(c.start, who);
  const v = await run(['GET', k]);
  if (v !== null && v !== undefined) return Number(v) || 0;
  let sum = 0;
  for (let i = 0; i <= c.dayNo; i++) sum += Number(await run(['GET', qKey(addDay(c.start, i), who)]).catch(() => 0)) || 0;
  if (write) { await run(['SET', k, String(sum)]); await run(['EXPIRE', k, 60 * 60 * 24 * 70]); }
  return sum;
}
// used = asked today, limit = earned each day, carried = unused questions brought into today, remaining = can still ask now, resets = the day the next cycle starts
const shape = (limit, c, usedCycle, usedToday) => {
  const earned = limit * (c.dayNo + 1);
  return { used: usedToday, limit, carried: Math.max(0, earned - limit - (usedCycle - usedToday)), remaining: Math.max(0, earned - usedCycle), resets: c.resets, cycleDays: CYCLE_DAYS };
};

/** Takes one question from the person's allowance. Returns { allowed, used, limit, carried, remaining, resets }. */
export async function takeQuestion(who, day) {
  if (!(await run(['GET', firstKey(who)]))) await run(['SET', firstKey(who), day]);
  const limit = dailyLimit();
  const c = await cycleOf(who, day);
  await cycleUsed(who, c, true);                                    // makes sure the cycle counter exists
  const n = Number(await run(['INCR', cycKey(c.start, who)]));
  const today = Number(await run(['GET', qKey(day, who)]).catch(() => 0)) || 0;
  if (n > limit * (c.dayNo + 1)) { await run(['DECR', cycKey(c.start, who)]); return { allowed: false, ...shape(limit, c, n - 1, today) }; }
  const t = Number(await run(['INCR', qKey(day, who)]));
  if (t === 1) await run(['EXPIRE', qKey(day, who), 60 * 60 * 24 * 70]);   // keep 70 days, for the usage page
  return { allowed: true, ...shape(limit, c, n, t) };
}
/** Gives a question back (the system failed, so the person should not lose it). */
export async function refundQuestion(who, day) {
  try { const c = await cycleOf(who, day); await run(['DECR', cycKey(c.start, who)]); await run(['DECR', qKey(day, who)]); } catch { /* the store is down: nothing to give back */ }
}
export async function quotaNow(who, day) {
  const limit = dailyLimit();
  const c = await cycleOf(who, day);
  const usedCycle = await cycleUsed(who, c, false);
  const today = Number(await run(['GET', qKey(day, who)]).catch(() => 0)) || 0;
  return shape(limit, c, usedCycle, Math.max(0, today));
}
export async function dailyCount(who, day) { return Math.max(0, Number(await run(['GET', qKey(day, who)]).catch(() => 0)) || 0); }

// ── usage log ──────────────────────────────────────────────────────────────────────────────────
/** entry: { t, rep, question, tools, ok, ms, inTok, outTok, why } */
export async function logUsage(entry) {
  const e = { ...entry, question: String(entry.question || '').slice(0, 500), answer: String(entry.answer || '').slice(0, 6000) };
  await run(['LPUSH', 'rep:usage', JSON.stringify(e)]);
  await run(['LTRIM', 'rep:usage', 0, 4999]);
  const h = `rep:stats:${entry.rep}`;
  await run(['HINCRBY', h, entry.ok ? 'ok' : 'fail', 1]);
  await run(['HINCRBY', h, 'ms', Math.round(entry.ms || 0)]);
  await run(['HINCRBY', h, 'inTok', Math.round(entry.inTok || 0)]);
  await run(['HINCRBY', h, 'outTok', Math.round(entry.outTok || 0)]);
  await addMonthTokens(entry.rep, entry, 1);
}

// ── AI cost: tokens per person per New Zealand month (dollars are worked out in lib/aiCost.js) ────────────────
const monthKey = (ym, who) => `rep:month:${ym}:${who}`;
/** Adds one piece of AI use to the person's month. q = how many questions it was (0 for an AI Insights button). */
export async function addMonthTokens(who, t, q = 0, ym = nzMonth()) {
  const k = monthKey(ym, who);
  for (const [field, v] of [['q', q], ['inTok', t.inTok], ['outTok', t.outTok], ['crTok', t.crTok], ['cwTok', t.cwTok]]) {
    const n = Math.round(Number(v) || 0);
    if (n) await run(['HINCRBY', k, field, n]);
  }
  await run(['EXPIRE', k, 60 * 60 * 24 * 400]).catch(() => {});   // keep about 13 months
}
/** { q, inTok, outTok, crTok, cwTok } for one person and month. */
export async function monthTokens(who, ym = nzMonth()) { return hashObj(await run(['HGETALL', monthKey(ym, who)])); }
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
