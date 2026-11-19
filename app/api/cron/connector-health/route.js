import { NextResponse } from 'next/server';
import { kvGet, kvHash } from '@/lib/repStore';
import { nzToday } from '@/lib/ostendo';

export const dynamic = 'force-dynamic';

/* Names-free health of the rep-only connector (/api/rep-mcp): how many times each tool was called today, by kind of
   login (lead or marketing), and when each kind last fetched the tool list. No person, no figures, no questions, so
   it is public like the other check routes. Used to confirm a person's Claude picked up newly added tools. */
export async function GET() {
  const today = nzToday();
  const [calls, marketing, lead] = await Promise.all([kvHash(`mcp:calls:${today}`), kvGet('mcp:listed:marketing'), kvGet('mcp:listed:lead')]);
  return NextResponse.json({ today, toolListLastFetched: { marketing, lead }, successfulCallsToday: calls }, { headers: { 'Cache-Control': 'no-store' } });
}
