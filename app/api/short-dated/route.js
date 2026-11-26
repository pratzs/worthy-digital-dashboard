import { NextResponse } from 'next/server';
import { shortDated } from '@/lib/shortDated';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/* Management and Purchasing & Stock (lib/auth.js). Saved 30 minutes (lib/shortDated.js). */
export async function GET() {
  try { return NextResponse.json(await shortDated()); }
  catch (e) { return NextResponse.json({ error: String(e.message || e).slice(0, 200) }, { status: 502 }); }
}
