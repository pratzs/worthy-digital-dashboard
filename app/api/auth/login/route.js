import { NextResponse } from 'next/server';
import { ROLES, signRole, homeFor } from '@/lib/auth';

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
  let role = null;
  for (const r of Object.keys(ROLES)) {
    if (expected[r] && same(submitted, expected[r])) role = r;
  }
  if (!role) return NextResponse.json({ error: 'Incorrect password' }, { status: 401 });

  const res = NextResponse.json({ ok: true, role, home: homeFor(role) });
  res.cookies.set('worthy_auth', await signRole(role), {
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
