import { NextResponse } from 'next/server';
import { marginMix } from '@/lib/marginMix';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;   // a month nobody has read yet takes 20-40 s; the year so far reads its months one at a time

/* Management only: this path is not in any other department's list (lib/auth.js), so middleware turns them away. */
export async function GET(request) {
  const period = new URL(request.url).searchParams.get('period') || '';
  try {
    return NextResponse.json(await marginMix(period));
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e).slice(0, 200) }, { status: /period must/.test(String(e.message)) ? 400 : 502 });
  }
}
