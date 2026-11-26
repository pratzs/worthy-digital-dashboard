/**
 * Public figures for the Sell With Us form on worthy.nz (27 Nov 2026).
 *
 * Counts only (no names, no amounts). One shared copy, refreshed at most once a day: a visitor always gets the
 * saved copy straight away and never starts an Odoo or Ostendo read of their own (lib/odooWeeksCache.js lock).
 * Readable from worthy.nz only (CORS). The form falls back to wording without numbers if this is ever down.
 */
import { NextResponse } from 'next/server';
import { readWeeks } from '@/lib/odooWeeksCache';
import { computeSellWithUsStats } from '@/lib/publicStats';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ALLOWED = ['https://worthy.nz', 'https://www.worthy.nz'];
function cors(request) {
  const origin = request.headers.get('origin') || '';
  return {
    'Access-Control-Allow-Origin': ALLOWED.includes(origin) ? origin : ALLOWED[0],
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    Vary: 'Origin',
  };
}

export async function OPTIONS(request) {
  return new NextResponse(null, { status: 204, headers: cors(request) });
}

export async function GET(request) {
  try {
    const { payload } = await readWeeks('pub', 'sell-with-us-v1', () => computeSellWithUsStats(),
      { freshMs: 24 * 60 * 60 * 1000, wait: 2500 });
    const { ok, window, shown, served, generatedAt, stale } = payload;
    return NextResponse.json({ ok, window, shown, served, generatedAt, ...(stale ? { stale: true } : {}) }, {
      headers: { ...cors(request), 'Cache-Control': 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400' },
    });
  } catch (e) {
    return NextResponse.json({ ok: false }, { status: 503, headers: cors(request) });
  }
}
