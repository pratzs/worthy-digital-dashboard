/**
 * Sign in to the My Sales chat page with their email and password. A correct code
 * sets a 12 hour cookie naming that one rep. Wrong codes wait 1.5 seconds.
 */
import { NextResponse } from 'next/server';
import { repForCode } from '@/lib/repAccess';
import { issueSession } from '@/lib/repOauth';
import { REP_COOKIE, cookieOptions } from '@/lib/repSession';
import { logSignin, signinBlocked, noteSigninFail } from '@/lib/repStore';
import { clientInfo } from '@/lib/repClient';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  let code = '', email = '';
  try { const b = await request.json(); code = String(b?.code || ''); email = String(b?.email || ''); } catch { /* handled below */ }
  let hit = null;
  try { hit = repForCode(code, email); } catch { hit = null; }
  const ua = request.headers.get('user-agent') || '';
  if (await signinBlocked(email)) {
    await new Promise((r) => setTimeout(r, 1500));
    await logSignin({ t: new Date().toISOString(), rep: null, email, how: 'page', ok: false, ...clientInfo(request), ua: `${ua} [blocked: too many tries]` }).catch(() => {});
    return NextResponse.json({ error: 'Too many tries. Please wait 15 minutes and try again, or ask Pratham.' }, { status: 429, headers: { 'Cache-Control': 'no-store' } });
  }
  if (!hit) {
    await noteSigninFail(email);
    await new Promise((r) => setTimeout(r, 1500));
    console.log(JSON.stringify({ evt: 'rep_chat_signin', ok: false }));
    await logSignin({ t: new Date().toISOString(), rep: null, email, how: 'page', ok: false, ...clientInfo(request) }).catch(() => {});
    return NextResponse.json({ error: 'That email or password is not recognised. Check them and try again.' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  }
  let token;
  try { token = issueSession({ sub: hit.rep.key, ver: hit.ver }); } catch {
    return NextResponse.json({ error: 'This page is not switched on yet.' }, { status: 503 });
  }
  console.log(JSON.stringify({ evt: 'rep_chat_signin', ok: true, rep: hit.rep.key }));
  await logSignin({ t: new Date().toISOString(), rep: hit.rep.key, email, how: 'page', ok: true, ...clientInfo(request) }).catch(() => {});
  const res = NextResponse.json({ ok: true, name: hit.rep.label, system: hit.rep.system }, { headers: { 'Cache-Control': 'no-store' } });
  res.cookies.set(REP_COOKIE, token, cookieOptions(12 * 60 * 60));
  return res;
}
