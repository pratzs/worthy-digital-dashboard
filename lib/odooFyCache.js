/**
 * A financial year's figures, shared across everyone who opens the dashboard.
 *
 * Working one out takes 35-45 seconds against Odoo, and well over a minute when Odoo is busy. On 26 Nov 2026 every
 * visitor was starting that read at once (the warm-up job runs only a few times a day on GitHub), which slowed Odoo for
 * the whole company and failed the page. So:
 *   - The figures are read once per five-minute slot and shared (the slot is part of the cache key).
 *   - Only one read per company and year runs at a time across all servers (a lock in the shared store).
 *   - Every complete result is saved as the last good copy. If the slot is not ready within a few seconds, the last
 *     good copy is answered at once, marked `stale` with the time Odoo was read (`generatedAt`), and the new read
 *     finishes in the background. The page shows that time and asks again shortly, so nobody waits on Odoo.
 *   - Only COMPLETE results are kept. A result with `problems` is returned but never stored or saved as last good.
 *   - `fresh` skips all of this (the page's "Try again" uses it).
 */
import { unstable_cache } from 'next/cache';
import { after } from 'next/server';
import { computeFY } from '@/lib/odooFy';
import { kvGet, kvSet, kvRun } from '@/lib/repStore';

export const SLOT_MS = 5 * 60 * 1000;
export const slotOf = (t = Date.now()) => Math.floor(t / SLOT_MS);
const WAIT_MS = 9000;          // how long a visitor waits for a fresh read before getting the last good copy
const LOCK_S = 240;            // one read per company and year at a time

class Incomplete extends Error {
  constructor(payload) { super('incomplete'); this.payload = payload; }
}

const stored = unstable_cache(
  async (cid, fy, slot) => { // eslint-disable-line no-unused-vars
    const payload = await computeFY(cid, fy);
    if (payload?.problems?.length) throw new Incomplete(payload); // thrown, so not stored
    return payload;
  },
  // v4 25 Nov 2026: Worthy Products and Worthy Oceania on one basis (docs/SALES-BASIS.md)
  ['odoo-fy-v8'],
  { revalidate: 900 },
);

const lastKey = (cid, fy) => `fy:last:v8:${cid}:${fy}`;
const lockKey = (cid, fy) => `fy:busy:v8:${cid}:${fy}`;
async function readLast(cid, fy) {
  try { const v = await kvGet(lastKey(cid, fy)); return v ? JSON.parse(v) : null; } catch { return null; }
}
async function saveLast(cid, fy, payload) {
  try {
    const cur = await readLast(cid, fy);
    if (cur?.generatedAt && payload?.generatedAt && cur.generatedAt >= payload.generatedAt) return;
    await kvSet(lastKey(cid, fy), JSON.stringify(payload));
  } catch { /* the store is a convenience; the figures are still answered */ }
}
async function takeLock(cid, fy) {
  try { return (await kvRun(['SET', lockKey(cid, fy), String(Date.now()), 'NX', 'EX', String(LOCK_S)])) === 'OK'; } catch { return true; }
}
async function dropLock(cid, fy) { try { await kvRun(['DEL', lockKey(cid, fy)]); } catch { /* expires anyway */ } }

const TIMEOUT = Symbol('timeout');

/** Returns { payload, cached } where cached is true (shared slot), false (read now) or 'stale' (last good copy). */
export async function readFY(cid, fy, { fresh = false, slot = slotOf(), wait = WAIT_MS } = {}) {
  if (fresh) {
    const payload = await computeFY(cid, fy);
    if (!payload?.problems?.length) await saveLast(cid, fy, payload);
    return { payload, cached: false };
  }
  const last = await readLast(cid, fy);
  // Someone else is already reading Odoo for this company and year: do not start a second read.
  if (last && !(await takeLock(cid, fy))) {
    const ready = await Promise.race([stored(cid, fy, slot).catch(() => null), new Promise((r) => setTimeout(() => r(TIMEOUT), 1500))]);
    if (ready && ready !== TIMEOUT) return { payload: ready, cached: true };
    return { payload: { ...last, stale: true }, cached: 'stale' };
  }
  const work = stored(cid, fy, slot)
    .then(async (p) => { await saveLast(cid, fy, p); return p; })
    .finally(() => dropLock(cid, fy));
  const first = await Promise.race([work.then((p) => ({ p }), (e) => ({ e })), new Promise((r) => setTimeout(() => r(TIMEOUT), last ? wait : 280000))]);
  if (first === TIMEOUT) {
    if (last) {
      after(() => work.catch(() => {}));   // let the read finish and save itself after the answer has gone
      return { payload: { ...last, stale: true }, cached: 'stale' };
    }
    return { payload: await work, cached: true };
  }
  if (first.p) return { payload: first.p, cached: true };
  if (first.e instanceof Incomplete || first.e?.payload) return { payload: first.e.payload, cached: false };
  if (last) return { payload: { ...last, stale: true }, cached: 'stale' };
  throw first.e;
}
