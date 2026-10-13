import { NextResponse } from 'next/server';
import { nzFinancialYear } from '@/lib/ostendo';
import { readFY, slotOf } from '@/lib/odooFyCache';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/* Keeps the shared figures filled so nobody waits for Odoo. A scheduled GitHub job
   calls this every five minutes (Vercel's own scheduler is not available on this
   plan). It fills this five-minute slot and the NEXT one, for the figures the
   dashboard opens with: North and Oceania, this financial year and last.
   One at a time, so the warm-up never piles onto Odoo.

   It needs no secret because it can do no harm and reveals nothing: it returns only
   a status, and a slot that is already filled is answered from the cache, so calling
   it often costs Odoo nothing. At most one live read per slot per figure, ever. */
export async function GET() {
  const fy = nzFinancialYear();
  const now = slotOf();
  const out = [];
  for (const slot of [now, now + 1]) {
    for (const [cid, year] of [[4, fy], [1, fy], [4, fy - 1]]) {
      const t = Date.now();
      try {
        const { payload } = await readFY(cid, year, { slot });
        out.push({ slot: slot - now, cid, year, ms: Date.now() - t, complete: !payload?.problems?.length });
      } catch (e) {
        out.push({ slot: slot - now, cid, year, ms: Date.now() - t, error: String(e.message).slice(0, 80) });
      }
    }
  }
  return NextResponse.json({ ok: out.every((o) => !o.error), out });
}
