/**
 * Quietly loads the signed-in lead's own figures and each team member's the moment they open the page, so the first
 * question is answered from a warm cache instead of waiting on Odoo or Ostendo. Nothing is returned except ok.
 * It uses the same rep tools as the chat, so it can only ever touch people on that lead's own team.
 */
import { NextResponse } from 'next/server';
import { repFromSession } from '@/lib/repSession';
import { runRepTool } from '@/lib/repTools';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(request) {
  const lead = repFromSession(request);
  if (!lead) return NextResponse.json({ error: 'not signed in' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  const started = Date.now();
  const names = ['my_sales', 'my_customers', 'my_best_sellers', 'my_cross_sell', 'my_debtors'];
  const jobs = lead.people.flatMap((p) => names.map((n) => () => runRepTool(lead, n, { person: p.key })));
  // One team member at a time keeps the load on Odoo and Ostendo gentle; each person's five lookups run together.
  const results = [];
  for (let i = 0; i < jobs.length; i += names.length) {
    results.push(...await Promise.allSettled(jobs.slice(i, i + names.length).map((j) => j())));
  }
  console.log(JSON.stringify({ evt: 'rep_warm', rep: lead.key, ok: results.filter((r) => r.status === 'fulfilled').length, of: jobs.length, ms: Date.now() - started }));
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}
