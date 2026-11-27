import { NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { weeklySummary } from '@/lib/weeklySummary';
import { ecomSummary } from '@/lib/ecomSummary';
import { setOidcToken } from '@/lib/ga4';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/* Management only (no other department lists this path, lib/auth.js). A draft for a person to send; nothing is sent here.
   ?kind=ecom is the Command Center's Ecom and Marketing summary (lib/ecomSummary.js); otherwise the management summary
   for the dashboard Overview (lib/weeklySummary.js). 30 minutes: last week does not change. */
const cached = unstable_cache(() => weeklySummary(), ['weekly-summary-v3'], { revalidate: 1800 });
const cachedEcom = unstable_cache(() => ecomSummary(), ['ecom-summary-v2'], { revalidate: 1800 });
export async function GET(request) {
  setOidcToken(request.headers.get('x-vercel-oidc-token'));   // keyless Google sign-in for Analytics and Search Console (lib/ga4.js)
  const kind = new URL(request.url).searchParams.get('kind');
  try { return NextResponse.json(await (kind === 'ecom' ? cachedEcom() : cached())); }
  catch (e) { return NextResponse.json({ error: String(e.message || e).slice(0, 200) }, { status: 502 }); }
}
