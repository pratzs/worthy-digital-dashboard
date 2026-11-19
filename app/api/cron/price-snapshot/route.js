import { NextResponse } from 'next/server';
import { takePriceSnapshot } from '@/lib/priceSnapshot';
import { getStamp, setStamp } from '@/lib/repStore';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/* Daily standard sell price snapshot (lib/priceSnapshot.js), called by .github/workflows/price-snapshot.yml.
   Needs no secret: it returns counts only, and a call within 20 hours of the last one does nothing, so it cannot be
   used to load Odoo or Ostendo. Add ?force=<WARM_KEY> to run it anyway. */
export async function GET(request) {
  const key = request.nextUrl.searchParams.get('force');
  const forced = Boolean(process.env.WARM_KEY) && key === process.env.WARM_KEY;
  const last = await getStamp('price-snapshot');
  if (!forced && Date.now() - last < 20 * 3600 * 1000) return NextResponse.json({ ok: true, skipped: 'already taken today' });
  await setStamp('price-snapshot');
  const res = await takePriceSnapshot();
  return NextResponse.json({ ok: !res.north?.error && !res.south?.error, ...res });
}
