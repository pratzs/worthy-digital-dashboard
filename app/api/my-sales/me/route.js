import { NextResponse } from 'next/server';
import { repFromSession } from '@/lib/repSession';

export const dynamic = 'force-dynamic';

/** Who is signed in on this browser, or 401. Used by the page on load. */
export async function GET(request) {
  const rep = repFromSession(request);
  if (!rep) return NextResponse.json({ error: 'not signed in' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  return NextResponse.json({ name: rep.label, system: rep.system }, { headers: { 'Cache-Control': 'no-store' } });
}
