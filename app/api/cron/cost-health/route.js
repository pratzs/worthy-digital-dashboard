import { NextResponse } from 'next/server';
import { southCostHealth } from '@/lib/southCostHealth';
import { storeConnected } from '@/lib/repStore';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/* Daily check (GitHub job .github/workflows/cost-health.yml) that South's recent invoices carry costs. It returns
   TOTALS ONLY (no customer or item names) so it can be public like the warm-up routes; the names are in the
   management tool get_south_cost_gaps. `attention: true` makes the scheduled job fail, which GitHub emails. */
export async function GET(request) {
  const days = Number(new URL(request.url).searchParams.get('days')) || 14;
  try {
    return NextResponse.json({ ...(await southCostHealth({ days })), allowanceStoreConnected: storeConnected() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error(JSON.stringify({ evt: 'cost_health_error', why: String(e?.message).slice(0, 200) }));
    return NextResponse.json({ error: 'Could not read Ostendo just now.' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
