import { NextResponse } from 'next/server';

// Routes that don't require auth (the login screen itself, login API,
// static assets the login page needs, and Next.js internals).
const PUBLIC_PATHS = [
  '/login',
  '/api/auth/login',
  '/logo-black.png',
  '/logo-white.png',
  '/favicon.ico',
];

export function middleware(request) {
  const { pathname } = request.nextUrl;

  // Allow public paths and all Next.js internals straight through.
  if (
    PUBLIC_PATHS.some(p => pathname === p) ||
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/static/')
  ) {
    return NextResponse.next();
  }

  const token = request.cookies.get('worthy_auth')?.value;
  if (token === 'ok') {
    return NextResponse.next();
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
