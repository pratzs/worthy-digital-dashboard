import { NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { wpSales } from '@/lib/salesBasis';
import { nzToday } from '@/lib/ostendo';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;   // a long period is read a month at a time

/* Sister company sales for any dates the reader picks (Worthy Products, Odoo company 4). Same reader as the chat's
   get_sales_summary and the Sunday email (lib/salesBasis.js), so the figures match the fixed columns on the card.
   Management only: this path is in no other department's list (lib/auth.js). Saved 5 minutes per period. */
const cached = unstable_cache((from, to) => wpSales(from, to), ['sister-range-v1'], { revalidate: 300 });

export async function GET(request) {
  const q = new URL(request.url).searchParams;
  const from = q.get('from') || '';
  let to = q.get('to') || '';
  const today = nzToday();
  if (to > today) to = today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
    return NextResponse.json({ error: 'Pick a start and end date, start first.' }, { status: 400 });
  }
  try {
    const r = await cached(from, to);
    return NextResponse.json({ ...r, generatedAt: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e).slice(0, 200) }, { status: 502 });
  }
}
