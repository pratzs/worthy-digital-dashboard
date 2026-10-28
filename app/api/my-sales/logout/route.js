import { NextResponse } from 'next/server';
import { REP_COOKIE, cookieOptions } from '@/lib/repSession';

export const dynamic = 'force-dynamic';

export async function POST() {
  const res = NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  res.cookies.set(REP_COOKIE, '', cookieOptions(0));
  return res;
}
