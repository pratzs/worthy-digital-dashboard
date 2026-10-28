import { NextResponse } from 'next/server';
import { repFromSession } from '@/lib/repSession';
import { quotaNow } from '@/lib/repStore';
import { nzToday } from '@/lib/ostendo';

export const dynamic = 'force-dynamic';

/** Who is signed in on this browser, or 401. Used by the page on load. */
export async function GET(request) {
  const rep = repFromSession(request);
  if (!rep) return NextResponse.json({ error: 'not signed in' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  const quota = await quotaNow(rep.key, nzToday()).catch(() => null);   // how many questions are left today
  return NextResponse.json({ name: rep.label, system: rep.system, quota }, { headers: { 'Cache-Control': 'no-store' } });
}
