/**
 * Sign in to the My Sales chat page with a personal access code. A correct code
 * sets a 12 hour cookie naming that one rep. Wrong codes wait 1.5 seconds.
 */
import { NextResponse } from 'next/server';
import { repForCode } from '@/lib/repAccess';
import { issueSession } from '@/lib/repOauth';
import { REP_COOKIE, cookieOptions } from '@/lib/repSession';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  let code = '';
  try { code = String((await request.json())?.code || ''); } catch { /* handled below */ }
  let hit = null;
  try { hit = repForCode(code); } catch { hit = null; }
  if (!hit) {
    await new Promise((r) => setTimeout(r, 1500));
    console.log(JSON.stringify({ evt: 'rep_chat_signin', ok: false }));
    return NextResponse.json({ error: 'That code is not recognised. Check it and try again.' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  }
  let token;
  try { token = issueSession({ sub: hit.rep.key, ver: hit.ver }); } catch {
    return NextResponse.json({ error: 'This page is not switched on yet.' }, { status: 503 });
  }
  console.log(JSON.stringify({ evt: 'rep_chat_signin', ok: true, rep: hit.rep.key }));
  const res = NextResponse.json({ ok: true, name: hit.rep.label, system: hit.rep.system }, { headers: { 'Cache-Control': 'no-store' } });
  res.cookies.set(REP_COOKIE, token, cookieOptions(12 * 60 * 60));
  return res;
}
