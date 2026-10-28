/**
 * Quietly loads the signed-in rep's own figures the moment they open the page, so their first question is
 * answered from a warm cache instead of waiting on Odoo or Ostendo. Nothing is returned except ok.
 * It uses the same rep tools as the chat, so it can only ever touch that one rep's own data.
 */
import { NextResponse } from 'next/server';
import { repFromSession } from '@/lib/repSession';
import { runRepTool } from '@/lib/repTools';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(request) {
  const rep = repFromSession(request);
  if (!rep) return NextResponse.json({ error: 'not signed in' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  const started = Date.now();
  const names = ['my_sales', 'my_customers', 'my_best_sellers', 'my_cross_sell', 'my_debtors'];
  const results = await Promise.allSettled(names.map((n) => runRepTool(rep, n, {})));
  console.log(JSON.stringify({ evt: 'rep_warm', rep: rep.key, ok: results.filter((r) => r.status === 'fulfilled').length, of: names.length, ms: Date.now() - started }));
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}
