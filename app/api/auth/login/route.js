import { NextResponse } from 'next/server';
import { signSession, homeFor } from '@/lib/auth';
import { personByEmail } from '@/lib/people';

export const dynamic = 'force-dynamic';

// Constant-time string compare to avoid trivial timing leaks.
function same(a, b) {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const submitted = String(body?.password || '');
  // Management keeps the original password and its built-in default; the other
  // departments only exist once their password is set on the server.
  const expected = {
    mgmt:  process.env.DASHBOARD_PASSWORD || '',
    bdm:   process.env.DASHBOARD_PASSWORD_BDM || '',
    purch: process.env.DASHBOARD_PASSWORD_PURCHASING || '',
  };
  // A named person (lib/people.js) and THEIR department's password. Anyone else, or a right password for another
  // department, gets the same answer, so the reply never says which half was wrong.
  const who = personByEmail(body?.email);
  const want = who && who.dashboard ? expected[who.dept] : '';
  const good = Boolean(want) && same(submitted, want);
  if (!good) {
    await new Promise((r) => setTimeout(r, 1200));   // slow down guessing
    return NextResponse.json({ error: 'Incorrect email or password' }, { status: 401 });
  }
  const role = who.dept;

  const res = NextResponse.json({ ok: true, role, name: who.name, home: homeFor(role) });
  res.cookies.set('worthy_auth', await signSession(role, who.key), {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path:     '/',
    maxAge:   60 * 60 * 24 * 30, // 30 days
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set('worthy_auth', '', { path: '/', maxAge: 0 });
  return res;
}
