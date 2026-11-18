/**
 * Social and Web page data: website figures (lib/webStats.js), Facebook and Instagram (lib/socialMeta.js) and the
 * LinkedIn and TikTok figures typed in by hand (lib/socialManual.js). Management only: the middleware lets only the
 * management department reach this path, and the route checks the role again.
 */
import { NextResponse } from 'next/server';
import { webStats } from '@/lib/webStats';
import { setOidcToken, ga4Properties } from '@/lib/ga4';
import { metaStats } from '@/lib/socialMeta';
import { readManual, MANUAL_ACCOUNTS, MANUAL_FIELDS } from '@/lib/socialManual';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request) {
  if (request.headers.get('x-worthy-role') !== 'mgmt') return NextResponse.json({ error: 'Not available to your department' }, { status: 403 });
  setOidcToken(request.headers.get('x-vercel-oidc-token'));
  const q = new URL(request.url).searchParams;
  // Setup check: which GA4 properties the reader can see, and whether the Google sign-in works at all.
  if (q.get('props') === '1') {
    try { return NextResponse.json({ ok: true, properties: await ga4Properties() }); }
    catch (e) { return NextResponse.json({ ok: false, error: String(e.message || e) }); }
  }
  const fresh = q.get('fresh') === '1';
  const [web, meta, manual] = await Promise.all([webStats({ fresh }), metaStats({ fresh }), readManual()]);
  return NextResponse.json({ web, meta, manual: { accounts: MANUAL_ACCOUNTS, fields: MANUAL_FIELDS, values: manual } });
}
