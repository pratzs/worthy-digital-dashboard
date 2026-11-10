import { NextResponse } from 'next/server';
import { verifySession, apiAllowed, pageAllowed, homeFor } from '@/lib/auth';

// Routes that don't require auth (the login screen itself, login API,
// static assets the login page needs, and Next.js internals).
const PUBLIC_PATHS = [
  '/login',
  '/api/auth/login',
  '/api/cron/warm', // protected by CRON_SECRET inside the route, not by the login cookie
  '/api/cron/cost-health', // totals only, no names; the scheduled check needs no login
  '/api/cron/warm-reps', // reveals nothing and rate-limits itself, so the scheduled job needs no login
  '/logo-black.png',
  '/logo-white.png',
  '/favicon.ico',
];

export async function middleware(request) {
  const { pathname } = request.nextUrl;

  // The department the data routes filter by (lib/roleResponse.js). Set only from the verified sign-in cookie; a value sent by the caller is always discarded.
  const pass = (role, person) => {
    const h = new Headers(request.headers);
    h.delete('x-worthy-role'); h.delete('x-worthy-person');
    if (role) h.set('x-worthy-role', role);
    if (role && person) h.set('x-worthy-person', person);   // who is asking (for the chat allowance and the AI cost record)
    return NextResponse.next({ request: { headers: h } });
  };

  // Allow public paths and all Next.js internals straight through.
  // /api/mcp/* and /.well-known/* authenticate themselves (OAuth Bearer
  // tokens, not the worthy_auth cookie) - an AI client calling them has no
  // cookie to present, so the cookie check must not apply here at all.
  if (
    PUBLIC_PATHS.some(p => pathname === p) ||
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/static/') ||
    pathname.startsWith('/api/mcp') ||
    // the rep-only connector and the My Sales chat page sign reps in themselves, with their own tokens
    pathname.startsWith('/api/rep-mcp') ||
    pathname.startsWith('/my-account') ||   // the My account app icons and manifest (a phone fetches them without signing in)
    pathname === '/my-sales' || pathname.startsWith('/my-sales/') || pathname.startsWith('/api/my-sales') ||
    pathname.startsWith('/.well-known/')
  ) {
    return pass(null);
  }

  const session = await verifySession(request.cookies.get('worthy_auth')?.value);
  const role = session?.role, person = session?.person;
  if (role) {
    if (pathname.startsWith('/api/')) {
      if (apiAllowed(role, pathname)) return pass(role, person);
      return NextResponse.json({ error: 'Not available to your department' }, { status: 403 });
    }
    if (pageAllowed(role, pathname)) return pass(role, person);
    return NextResponse.redirect(new URL(homeFor(role), request.url));
  }

  // For API calls, return 401 instead of an HTML redirect so client fetches
  // surface the error cleanly.
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const loginUrl = new URL('/login', request.url);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
