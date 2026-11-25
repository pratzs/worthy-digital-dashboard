import { NextResponse } from 'next/server';
import { healthChecks } from '@/lib/health';
import { setOidcToken } from '@/lib/ga4';

export const dynamic = 'force-dynamic';
export const maxDuration = 90;

/* Daily health check (GitHub job .github/workflows/health.yml, docs/HEALTH.md): are the Meta, Dutch Rusk Shopify,
   Asana, ClickUp, worthy.nz forms and Google Analytics connections working, are the saved year figures fresh, and has a
   new freight product or own-company partner appeared on recent Odoo invoices. It returns pass/fail per check with
   product and own-company partner ids and names only (no amounts, no customer names), so it can be public like
   cost-health. `attention: true` makes the scheduled job fail, which GitHub emails. */
export async function GET(request) {
  setOidcToken(request.headers.get('x-vercel-oidc-token'));   // keyless Google Analytics sign-in (lib/ga4.js)
  try {
    return NextResponse.json(await healthChecks(), { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error(JSON.stringify({ evt: 'health_error', why: String(e?.message).slice(0, 200) }));
    return NextResponse.json({ error: 'The health check could not run just now.' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
