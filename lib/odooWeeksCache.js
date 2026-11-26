/**
 * One month's per-rep weekly figures (/api/odoo/weeks), shared across everyone who opens the dashboard.
 *
 * Same protection as the year figures (lib/odooFyCache.js), keyed by company + month:
 *   - Only one Odoo read per company and month runs at a time across all servers (a lock in the shared store).
 *   - Every complete result is saved as the last good copy, with the time Odoo was read (`generatedAt`).
 *   - A copy read in the last five minutes is answered as it is.
 *   - Otherwise a visitor waits at most 2.5 s for a new read, then gets the last good copy marked `stale`, and the
 *     read finishes in the background and saves itself.
 *   - A read that fails is never saved; the last good copy is answered instead when there is one.
 * The figures themselves are worked out by the route; nothing here changes them.
 */
import { after } from 'next/server';
import { kvGet, kvSet, kvRun } from '@/lib/repStore';

const FRESH_MS = 5 * 60 * 1000;   // a saved copy this young is answered without reading Odoo
const WAIT_MS = 2500;             // how long a visitor waits for a new read before getting the last good copy
const LOCK_S = 240;               // one read per company and month at a time

const lastKey = (cid, month) => `wk:last:v1:${cid}:${month}`;
const lockKey = (cid, month) => `wk:busy:v1:${cid}:${month}`;

async function readLast(cid, month) {
  try { const v = await kvGet(lastKey(cid, month)); return v ? JSON.parse(v) : null; } catch { return null; }
}
async function saveLast(cid, month, payload) {
  try {
    const cur = await readLast(cid, month);
    if (cur?.generatedAt && payload?.generatedAt && cur.generatedAt >= payload.generatedAt) return;
    await kvSet(lastKey(cid, month), JSON.stringify(payload));
  } catch { /* the store is a convenience; the figures are still answered */ }
}
async function takeLock(cid, month) {
  try { return (await kvRun(['SET', lockKey(cid, month), String(Date.now()), 'NX', 'EX', String(LOCK_S)])) === 'OK'; } catch { return true; }
}
async function dropLock(cid, month) { try { await kvRun(['DEL', lockKey(cid, month)]); } catch { /* expires anyway */ } }

const TIMEOUT = Symbol('timeout');
const ageOf = (p) => Date.now() - (Date.parse(p?.generatedAt || '') || 0);

/**
 * compute() reads Odoo and returns the complete payload (with generatedAt) or throws.
 * Returns { payload, cached } where cached is true (saved copy or shared read), false (read now) or 'stale'.
 */
export async function readWeeks(cid, month, compute, { wait = WAIT_MS, freshMs = FRESH_MS } = {}) {
  const last = await readLast(cid, month);
  if (last && ageOf(last) < freshMs) return { payload: last, cached: true };
  // Someone else is already reading Odoo for this company and month: never start a second read.
  if (!(await takeLock(cid, month))) {
    if (last) return { payload: { ...last, ...(Date.now() - Date.parse(last.generatedAt || 0) > 6 * 60000 ? { stale: true } : {}) }, cached: 'stale' };
    // No saved copy yet: wait for the read that is running to save one.
    for (let i = 0; i < 80; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const got = await readLast(cid, month);
      if (got) return { payload: got, cached: true };
    }
    throw new Error('Odoo is busy; the weekly figures are still being read. Please try again in a minute.');
  }
  const work = Promise.resolve()
    .then(compute)
    .then(async (p) => { await saveLast(cid, month, p); return p; })
    .finally(() => dropLock(cid, month));
  let timer;
  const first = await Promise.race([
    work.then((p) => ({ p }), (e) => ({ e })),
    new Promise((r) => { timer = setTimeout(() => r(TIMEOUT), last ? wait : 280000); }),
  ]);
  clearTimeout(timer);   // never leave a long timer running after the answer
  if (first === TIMEOUT) {
    if (last) {
      after(() => work.catch(() => {}));   // let the read finish and save itself after the answer has gone
      return { payload: { ...last, ...(Date.now() - Date.parse(last.generatedAt || 0) > 6 * 60000 ? { stale: true } : {}) }, cached: 'stale' };
    }
    return { payload: await work, cached: false };
  }
  if (first.p) return { payload: first.p, cached: false };
  if (last) return { payload: { ...last, ...(Date.now() - Date.parse(last.generatedAt || 0) > 6 * 60000 ? { stale: true } : {}) }, cached: 'stale' };
  throw first.e;
}
