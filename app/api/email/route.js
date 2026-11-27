import { NextResponse } from 'next/server';
import { emailStats } from '@/lib/brevo';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/* Command Center Email tab: Brevo campaigns and automations per shop (lib/brevo.js). Management only (lib/auth.js). */
export async function GET(request) {
  const p = new URL(request.url).searchParams;
  try { return NextResponse.json(await emailStats(p.get('from'), p.get('to'), { fresh: p.get('fresh') === '1' })); }
  catch (e) { return NextResponse.json({ error: String(e.message || e).slice(0, 200) }, { status: 502 }); }
}
