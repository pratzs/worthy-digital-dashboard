import { NextResponse } from 'next/server';
import { stockStates } from '@/lib/stockStates';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/* Management and Purchasing & Stock (lib/auth.js). Saved 30 minutes (lib/stockStates.js). */
export async function GET() {
  try { return NextResponse.json(await stockStates()); }
  catch (e) { return NextResponse.json({ error: String(e.message || e).slice(0, 200) }, { status: 502 }); }
}
