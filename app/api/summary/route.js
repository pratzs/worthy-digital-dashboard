import { NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { weeklySummary } from '@/lib/weeklySummary';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/* Management only (no other department lists this path, lib/auth.js). A draft for a person to send; nothing is sent here. */
const cached = unstable_cache(() => weeklySummary(), ['weekly-summary-v1'], { revalidate: 600 });
export async function GET() {
  try { return NextResponse.json(await cached()); }
  catch (e) { return NextResponse.json({ error: String(e.message || e).slice(0, 200) }, { status: 502 }); }
}
