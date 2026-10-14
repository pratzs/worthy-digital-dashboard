import { NextResponse } from 'next/server';
import { nzFinancialYear } from '@/lib/ostendo';
import { readFY, slotOf } from '@/lib/odooFyCache';
import { readDebtors } from '@/lib/odooDebtorsCache';

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
/* A cold start (nothing stored yet) can take several minutes of Odoo reads, longer than
   one request is allowed to run. So the warm-up works to a time budget: it stops STARTING
   new reads once the budget is used and answers normally, and whatever is left is picked up
   by the next call five minutes later. A read already running finishes well inside the limit. */
const BUDGET_MS = 150 * 1000;

export async function GET() {
  const began = Date.now();
  const fy = nzFinancialYear();
  const now = slotOf();
  const out = [];
  // Debtors first: quick, and the screen is opened often.
  for (const slot of [now, now + 1]) {
    for (const cid of [4, 1]) {
      const t0 = Date.now();
      try { await readDebtors(cid, { slot }); out.push({ slot: slot - now, debtors: cid, ms: Date.now() - t0 }); }
      catch (e) { out.push({ slot: slot - now, debtors: cid, ms: Date.now() - t0, error: String(e.message).slice(0, 80) }); }
    }
  }
  for (const slot of [now, now + 1]) {
    for (const [cid, year] of [[4, fy], [1, fy], [4, fy - 1]]) {
      if (Date.now() - began > BUDGET_MS) { out.push({ slot: slot - now, cid, year, skipped: 'time budget used, next call continues' }); continue; }
      const t = Date.now();
      try {
        const { payload } = await readFY(cid, year, { slot });
        out.push({ slot: slot - now, cid, year, ms: Date.now() - t, complete: !payload?.problems?.length });
      } catch (e) {
        out.push({ slot: slot - now, cid, year, ms: Date.now() - t, error: String(e.message).slice(0, 80) });
      }
    }
  }
  return NextResponse.json({
    ok: out.every((o) => !o.error), done: out.filter((o) => o.ms != null && !o.error).length,
    skipped: out.filter((o) => o.skipped).length, ms: Date.now() - began, out,
  });
}
