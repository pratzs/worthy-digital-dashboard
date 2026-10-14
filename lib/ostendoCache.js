/**
 * South's financial-year figures and analytics, shared across everyone who opens the
 * dashboard in five-minute slots - the same rules as the North figures
 * (lib/odooFyCache.js): the slot is in the key so nothing is older than the slot, a
 * failed read is never stored, and `fresh` skips the cache.
 */
import { unstable_cache } from 'next/cache';
import { handle as fyHandle } from '@/lib/ostendoFy';
import { handle as advancedHandle } from '@/lib/ostendoAdvanced';
import { slotOf } from '@/lib/odooFyCache';

const HANDLERS = { fy: fyHandle, advanced: advancedHandle };

/** Runs the route's own handler and returns its JSON; anything but a clean answer throws. */
async function run(name, qs) {
  const res = await HANDLERS[name](new Request(`http://internal/${name}${qs}`));
  const body = await res.json();
  if (!res.ok || body?.error) { const e = new Error(body?.error || `Ostendo ${name} failed`); e.status = res.status; e.body = body; throw e; }
  return body;
}

const stored = unstable_cache(
  async (name, qs, slot) => run(name, qs), // eslint-disable-line no-unused-vars
  ['ostendo-route-v1'],
  { revalidate: 900 },
);

/** `qs` is the query string including the "?", e.g. "?fy=2026". */
export async function readSouth(name, qs, { fresh = false, slot = slotOf() } = {}) {
  return fresh ? run(name, qs) : stored(name, qs, slot);
}
