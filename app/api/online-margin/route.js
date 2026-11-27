import { NextResponse } from 'next/server';
import { onlineMargin } from '@/lib/onlineMargin';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/* Gross profit and margin on online sales, order by order (lib/onlineMargin.js). Management only. */
export async function GET(request) {
  const q = new URL(request.url).searchParams;
  const site = q.get('site') || 'all';
  const shop = site === 'worthyproducts' || site === 'dutchrusk' ? site : 'all';
  try { return NextResponse.json(await onlineMargin(shop, q.get('from'), q.get('to'))); }
  catch (e) { return NextResponse.json({ error: String(e.message || e).slice(0, 200) }, { status: /must be dates/.test(String(e.message)) ? 400 : 502 }); }
}
