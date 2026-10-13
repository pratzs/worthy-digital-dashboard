import { NextResponse } from 'next/server';
import { nzFinancialYear } from '@/lib/ostendo';
import { readFY, slotOf } from '@/lib/odooFyCache';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/* Called by Vercel Cron a minute before each five-minute slot begins. Vercel sends
   `Authorization: Bearer <CRON_SECRET>`; without that secret set, or with a wrong
   one, nothing runs. Fills the next slot for the figures the dashboard opens with:
   North and Oceania, this financial year and last. One at a time, so the warm-up
   never piles onto Odoo. */
export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const slot = slotOf(Date.now() + 2 * 60 * 1000);
  const fy = nzFinancialYear();
  const out = [];
  for (const [cid, year] of [[4, fy], [4, fy - 1], [1, fy]]) {
    const t = Date.now();
    try {
      const { payload, cached } = await readFY(cid, year, { slot });
      out.push({ cid, year, ms: Date.now() - t, cached, complete: !payload?.problems?.length });
    } catch (e) {
      out.push({ cid, year, ms: Date.now() - t, error: e.message });
    }
  }
  return NextResponse.json({ slot, out });
}
