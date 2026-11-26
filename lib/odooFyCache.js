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
const WAIT_MS = 2500;          // how long a visitor waits for a fresh read before getting the last good copy
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
// A saved copy under 6 minutes old is as fresh as the 5-minute slot itself, so it is not called stale.
const asSaved = (last) => ({ payload: { ...last, ...(Date.now() - Date.parse(last.generatedAt || 0) > 6 * 60000 ? { stale: true } : {}) }, cached: 'stale' });

/** Returns { payload, cached } where cached is true (shared slot), false (read now) or 'stale' (last good copy). */
export async function readFY(cid, fy, { fresh = false, slot = slotOf(), wait = WAIT_MS } = {}) {
  if (fresh) {
    const payload = await computeFY(cid, fy);
    if (!payload?.problems?.length) await saveLast(cid, fy, payload);
    return { payload, cached: false };
  }
  const last = await readLast(cid, fy);
  // Someone else is already reading Odoo for this company and year: never start a second read.
  if (!(await takeLock(cid, fy))) {
    if (last) return asSaved(last);
    // No saved copy yet: wait for the read that is running to save one.
    for (let i = 0; i < 90; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const got = await readLast(cid, fy);
      if (got) return { payload: got, cached: true };
    }
    throw new Error('Odoo is busy; the figures are still being read. Please try again in a minute.');
  }
  const work = stored(cid, fy, slot)
    .then(async (p) => { await saveLast(cid, fy, p); return p; })
    .finally(() => dropLock(cid, fy));
  const first = await Promise.race([work.then((p) => ({ p }), (e) => ({ e })), new Promise((r) => setTimeout(() => r(TIMEOUT), last ? wait : 280000))]);
  if (first === TIMEOUT) {
    if (last) {
      after(() => work.catch(() => {}));   // let the read finish and save itself after the answer has gone
      return asSaved(last);
    }
    return { payload: await work, cached: true };
  }
  if (first.p) return { payload: first.p, cached: true };
  if (first.e instanceof Incomplete || first.e?.payload) return { payload: first.e.payload, cached: false };
  if (last) return asSaved(last);
  throw first.e;
}

/* ── Chosen dates (the dashboard's date range, 27 Nov 2026) ─────────────────────────────────────────────────────────
   Any period, read with the same reader as the financial year (computeFY with `custom`). Same protection as the weekly
   figures (lib/odooWeeksCache.js: one read per period at a time, last good copy, a 2.5 s wait), plus ONE chosen-period
   read at a time across the whole company, so people picking dates can never pile reads onto Odoo. A period ending
   before today is saved for 6 hours (closed invoices rarely change); one running to today for 10 minutes. */
import { readWeeks } from '@/lib/odooWeeksCache';
import { nzToday } from '@/lib/ostendo';
const fyOfDate = (d) => (Number(d.slice(5, 7)) >= 4 ? Number(d.slice(0, 4)) : Number(d.slice(0, 4)) - 1);
async function oneAtATime(work) {
  const key = 'cfy:any:v1';
  for (let i = 0; i < 80; i++) {
    let got = false;
    try { got = (await kvRun(['SET', key, String(Date.now()), 'NX', 'EX', '240'])) === 'OK'; } catch { got = true; }
    if (got) { try { return await work(); } finally { try { await kvRun(['DEL', key]); } catch { /* expires anyway */ } } }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error('Odoo is busy with another chosen-dates read. Please try again in a minute.');
}
export async function readCustom(cid, custom) {
  const today = nzToday();
  const { payload, cached } = await readWeeks(`cfy${cid}`, `${custom.from}_${custom.to}`,
    () => oneAtATime(() => computeFY(cid, fyOfDate(custom.from), custom)),
    { freshMs: custom.to >= today ? 10 * 60000 : 6 * 3600000 });
  return { payload, cached };
}
