import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { activePrincipals } from '@/lib/repAccess';

// Only people who sit on an enabled lead's team are warmed; everyone else has no access, so nothing is loaded for them.
const teamPeople = () => [...new Map(activePrincipals().flatMap((p) => p.people).map((r) => [r.key, r])).values()];
import { nzFinancialYear } from '@/lib/ostendo';
import { warmRepData, REP_DATA_TAG } from '@/lib/repData';
import { getStamp, setStamp } from '@/lib/repStore';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/* Keeps every rep's own figures ready so the first question of the day is quick, not just the first after signing in.
   A scheduled GitHub job calls this every 20 minutes through the working day (.github/workflows/warm-reps.yml).
   Each run marks the rep datasets out of date, then reloads them one rep at a time (so it never piles onto Odoo or
   Ostendo), so what a rep sees is at most about 20 minutes old.

   It needs no secret because it reveals nothing (it returns only a status) and it protects itself: a call within
   9 minutes of the last one does nothing, so repeated calls cannot hammer Odoo. Add ?force=<WARM_KEY> to run it anyway. */
const BUDGET_MS = 250 * 1000;

export async function GET(request) {
  const began = Date.now();
  const key = request.nextUrl.searchParams.get('force');
  const forced = Boolean(process.env.WARM_KEY) && key === process.env.WARM_KEY;
  const last = await getStamp('warm-reps');
  if (!forced && began - last < 9 * 60 * 1000) return NextResponse.json({ ok: true, skipped: 'warmed a few minutes ago' });
  await setStamp('warm-reps', began);

  revalidateTag(REP_DATA_TAG, { expire: 0 });
  const fy = nzFinancialYear();
  const out = [];
  const REPS = teamPeople();
  for (const rep of REPS) {
    if (Date.now() - began > BUDGET_MS) { out.push({ rep: rep.key, skipped: 'time budget used, the next run continues' }); continue; }
    const t = Date.now();
    try { await warmRepData(rep, fy); out.push({ rep: rep.key, ms: Date.now() - t }); }
    catch (e) { out.push({ rep: rep.key, ms: Date.now() - t, error: String(e.message).slice(0, 80) }); }
  }
  return NextResponse.json({ ok: out.every((o) => !o.error), done: out.filter((o) => o.ms != null && !o.error).length, of: REPS.length, ms: Date.now() - began, results: out });
}
