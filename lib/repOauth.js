/**
 * OAuth 2.1 (authorization code + PKCE, dynamic client registration) for the
 * rep-only connector. A twin of lib/oauth.js with three deliberate differences:
 *  - it signs with its OWN secret (REP_AUTH_SECRET), so a token from one connector
 *    fails verification on the other even if someone tries;
 *  - there is no fallback secret: if REP_AUTH_SECRET is missing nothing validates;
 *  - only claude.ai / ChatGPT / OpenAI redirect addresses can be registered.
 * Access tokens carry the rep's key and a version, and last 7 days.
 */
import { createHmac, createHash, timingSafeEqual } from 'node:crypto';

const secret = () => {
  const s = process.env.REP_AUTH_SECRET;
  if (!s || s.length < 24) throw new Error('REP_AUTH_SECRET is not set');
  return s;
};

const b64 = (s) => Buffer.from(s).toString('base64url');
const mac = (p) => createHmac('sha256', secret()).update(p).digest('base64url');

export function sign(payload) {
  const p = b64(JSON.stringify(payload));
  return `${p}.${mac(p)}`;
}

export function verify(token) {
  let p, s;
  try { [p, s] = String(token || '').split('.'); if (!p || !s) return null; } catch { return null; }
  let good;
  try { good = mac(p); } catch { return null; }
  const a = Buffer.from(s), b = Buffer.from(good);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let payload;
  try { payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8')); } catch { return null; }
  if (payload.exp && Date.now() > payload.exp) return null;
  return payload;
}

export const pkceVerify = (verifier, challenge) =>
  Boolean(verifier && challenge) && createHash('sha256').update(String(verifier)).digest('base64url') === challenge;

const ALLOWED_REDIRECT_HOSTS = ['claude.ai', 'claude.com', 'chatgpt.com', 'chat.openai.com', 'platform.openai.com', 'openai.com'];
export function redirectAllowed(u) {
  try {
    const url = new URL(u);
    return url.protocol === 'https:' && ALLOWED_REDIRECT_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`));
  } catch { return false; }
}

const DAY = 24 * 60 * 60 * 1000;
export const registerClient = (redirect_uris) => sign({ t: 'rclient', redirect_uris, iat: Date.now() });
export const issueCode = (fields) => sign({ t: 'rcode', ...fields, exp: Date.now() + 30 * 1000 });
export const issueAccessToken = ({ sub, ver, resource }) =>
  sign({ t: 'raccess', sub, ver, aud: resource || null, exp: Date.now() + 7 * DAY });

export function clientRedirectUris(clientId) {
  const p = verify(clientId);
  return p?.t === 'rclient' ? p.redirect_uris : null;
}
export function redeemCode(code) { const p = verify(code); return p?.t === 'rcode' ? p : null; }
export function checkAccessToken(token) { const p = verify(token); return p?.t === 'raccess' ? p : null; }
