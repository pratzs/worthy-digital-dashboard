/**
 * A financial year's figures, shared across everyone who opens the dashboard.
 *
 * Working one out takes 35-45 seconds against Odoo (more when Odoo is busy), so
 * it is done once per five-minute slot and the result is shared. The rules that
 * keep it accurate:
 *   - The slot is part of the cache key, so nothing is ever older than five
 *     minutes. An old entry is never served "while refreshing".
 *   - Only COMPLETE results are kept. If any part could not be read (the payload
 *     lists it under `problems`) the result is returned to the caller but not
 *     stored, so the next request tries again instead of repeating a gap.
 *   - A failure is never stored.
 *   - `fresh` skips the cache altogether (the page's "Try again" uses it).
 * The scheduled warm-up (/api/cron/warm) fills the NEXT slot just before it
 * starts, so people almost never wait for the first read.
 */
import { unstable_cache } from 'next/cache';
import { computeFY } from '@/lib/odooFy';

export const SLOT_MS = 5 * 60 * 1000;
export const slotOf = (t = Date.now()) => Math.floor(t / SLOT_MS);

class Incomplete extends Error {
  constructor(payload) { super('incomplete'); this.payload = payload; }
}

const stored = unstable_cache(
  async (cid, fy, slot) => { // eslint-disable-line no-unused-vars
    const payload = await computeFY(cid, fy);
    if (payload?.problems?.length) throw new Incomplete(payload); // thrown, so not stored
    return payload;
  },
  ['odoo-fy-v1'],
  { revalidate: 900 },
);

/** Returns { payload, cached } where cached says it came from a shared slot. */
export async function readFY(cid, fy, { fresh = false, slot = slotOf() } = {}) {
  if (fresh) return { payload: await computeFY(cid, fy), cached: false };
  try {
    return { payload: await stored(cid, fy, slot), cached: true };
  } catch (e) {
    if (e instanceof Incomplete || e?.payload) return { payload: e.payload, cached: false };
    throw e;
  }
}
