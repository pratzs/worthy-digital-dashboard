/** Save one month of LinkedIn or TikTok figures typed in by hand. Management only. */
import { NextResponse } from 'next/server';
import { saveManual } from '@/lib/socialManual';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  if (request.headers.get('x-worthy-role') !== 'mgmt') return NextResponse.json({ error: 'Not available to your department' }, { status: 403 });
  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }); }
  try {
    const values = await saveManual({ account: body.account, month: body.month, values: body.values, person: request.headers.get('x-worthy-person') });
    return NextResponse.json({ ok: true, values });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 400 });
  }
}
