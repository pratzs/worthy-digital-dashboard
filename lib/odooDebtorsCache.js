/**
 * Debtors, shared across everyone who opens the dashboard, in five-minute slots - the same
 * rules as the financial-year figures (lib/odooFyCache.js): the slot is in the key so nothing
 * is older than the slot, a failure is never stored, and `fresh` skips the cache. It matters
 * because the read itself is quick (about two seconds) but, asked at the same moment as the
 * big financial-year read, it queued behind it and took thirty.
 */
import { unstable_cache } from 'next/cache';
import { computeDebtors } from '@/lib/odooDebtors';
import { slotOf } from '@/lib/odooFyCache';

const stored = unstable_cache(
  async (cid, slot) => computeDebtors(cid), // eslint-disable-line no-unused-vars
  ['odoo-debtors-v1'],
  { revalidate: 900 },
);

export async function readDebtors(cid, { fresh = false, slot = slotOf() } = {}) {
  return fresh ? computeDebtors(cid) : stored(cid, slot);
}
