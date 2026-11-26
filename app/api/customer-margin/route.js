import { NextResponse } from 'next/server';
import { marginMix } from '@/lib/marginMix';
import { southCustomers } from '@/lib/southCustomers';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/* Customer margin for any business and period. Management only (no other department lists this path, lib/auth.js).
   company: 4 (Worthy Products North), 1 (Worthy Oceania) or south (Dutch Rusk). period: YYYY-MM, fy:YYYY or from:to. */
const monthEnd = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
function datesOf(period) {
  let m = /^(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})$/.exec(period); if (m && m[1] <= m[2]) return [m[1], m[2]];
  if (/^\d{4}-\d{2}$/.test(period)) return [`${period}-01`, monthEnd(period)];
  m = /^fy:(\d{4})$/.exec(period); if (m) return [`${m[1]}-04-01`, `${Number(m[1]) + 1}-03-31`];
  return null;
}
export async function GET(request) {
  const q = new URL(request.url).searchParams;
  const company = q.get('company') || '4'; const period = q.get('period') || '';
  const dates = datesOf(period);
  if (!dates || (Date.parse(dates[1]) - Date.parse(dates[0])) / 86400000 > 800) return NextResponse.json({ error: 'period must be YYYY-MM, fy:YYYY or YYYY-MM-DD:YYYY-MM-DD' }, { status: 400 });
  try {
    if (company === 'south') return NextResponse.json(await southCustomers(dates[0], dates[1]));
    const m = await marginMix(period, Number(company));
    return NextResponse.json({ company: m.company, companyName: m.companyName, from: m.from, to: m.to, generatedAt: m.generatedAt, stale: m.stale,
      revenue: m.revenue, costedRevenue: m.costedRevenue, cost: m.cost, grossProfit: m.grossProfit, marginPct: m.marginPct,
      customers: m.customers, building: m.customers == null });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e).slice(0, 200) }, { status: 502 });
  }
}
