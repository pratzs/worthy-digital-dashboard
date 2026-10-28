/**
 * Browser session for the My Sales chat page. The cookie holds a signed token
 * naming ONE rep and their access version (lib/repOauth.js, signed with
 * REP_AUTH_SECRET). It is separate from the dashboard's own login cookie, so it
 * opens nothing on the dashboard, and the dashboard cookie opens nothing here.
 */
import { checkSession } from '@/lib/repOauth';
import { principalByKey, currentVer } from '@/lib/repAccess';

export const REP_COOKIE = 'worthy_rep';

export const cookieOptions = (maxAge) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  path: '/',
  maxAge,
});

/** The rep this request belongs to, or null. Re-checked on every call, so switching a rep off cuts them off at once. */
export function repFromSession(request) {
  try {
    const claims = checkSession(request.cookies.get(REP_COOKIE)?.value);
    if (!claims) return null;
    const rep = principalByKey(claims.sub);
    if (!rep || currentVer(rep.key) === 0 || currentVer(rep.key) !== claims.ver) return null;
    return rep;
  } catch {
    return null;
  }
}
