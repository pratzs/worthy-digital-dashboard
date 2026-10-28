/**
 * A minimal, stateless OAuth 2.1 authorization server (authorization code +
 * PKCE, dynamic client registration) so Claude and ChatGPT's own "custom
 * connector" flow can let each management person sign in with their OWN
 * Claude/ChatGPT account - no API key held by Worthy, no shared usage bill.
 * The identity on OUR side is still the single Management password; the
 * per-person part is entirely on Anthropic/OpenAI's side.
 *
 * "Stateless" is deliberate, not a shortcut: Vercel functions don't share
 * memory between invocations, and this avoids standing up a database just to
 * hold short-lived codes and tokens. A registered client, an authorization
 * code and an access token are each a signed, self-contained blob (payload +
 * HMAC), verified on the way back in - the same pattern lib/auth.js already
 * uses for the login cookie, just generalised to carry an arbitrary payload
 * and an expiry.
 */
const enc = new TextEncoder();
// No built-in fallback: if neither is set nothing can be signed or verified (fail closed), instead of tokens anyone could forge.
const secret = () => {
  const s = process.env.AUTH_SECRET || process.env.DASHBOARD_PASSWORD;
  if (!s) throw new Error('No signing secret is configured');
  return s;
};

const b64url = (bytes) => Buffer.from(bytes).toString('base64url');
const b64urlJson = (obj) => b64url(enc.encode(JSON.stringify(obj)));
const fromB64urlJson = (s) => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));

async function hmacHex(message) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret()),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let bad = 0;
  for (let i = 0; i < a.length; i++) bad |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return bad === 0;
}

/** Signs an arbitrary JSON-serialisable payload into `<payload>.<hmac>`. */
export async function sign(payload) {
  const p = b64urlJson(payload);
  return `${p}.${await hmacHex(p)}`;
}

/** Verifies and decodes a token from `sign()`. Returns null if tampered,
 * malformed, or past its own `exp` (ms epoch), when it has one. */
export async function verify(token) {
  const [p, sig] = String(token || '').split('.');
  if (!p || !sig) return null;
  const good = await hmacHex(p);
  if (!constantTimeEqual(sig, good)) return null;
  let payload;
  try { payload = fromB64urlJson(p); } catch { return null; }
  if (payload.exp && Date.now() > payload.exp) return null;
  return payload;
}

// RFC 7636 S256: BASE64URL(SHA256(code_verifier)) must equal code_challenge.
export async function pkceVerify(codeVerifier, codeChallenge) {
  if (!codeVerifier || !codeChallenge) return false;
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(codeVerifier));
  return b64url(new Uint8Array(digest)) === codeChallenge;
}

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

export const registerClient = (redirect_uris) => sign({ t: 'client', redirect_uris, iat: Date.now() });

/* A signed code has no server-side record, so there is nothing to mark "used" -
 * the only thing bounding reuse is this expiry. 30s is enough for the redirect
 * round-trip a real client does right after /authorize, while keeping the
 * window a leaked code stays redeemable in as short as this design allows. */
export const issueCode = (fields) => sign({ t: 'code', ...fields, exp: Date.now() + 30 * 1000 });

export const issueAccessToken = (resource) => sign({ t: 'access', role: 'mgmt', aud: resource || null, exp: Date.now() + 90 * DAY });

/** A client's registered redirect_uris, or null if the client_id is invalid. */
export async function clientRedirectUris(clientId) {
  const payload = await verify(clientId);
  return payload?.t === 'client' ? payload.redirect_uris : null;
}

export async function redeemCode(code) {
  const payload = await verify(code);
  return payload?.t === 'code' ? payload : null;
}

export async function checkAccessToken(token) {
  const payload = await verify(token);
  return payload?.t === 'access' ? payload : null;
}

/**
 * Where an AI app may be sent back to after sign-in. Only claude.ai, ChatGPT and OpenAI addresses (https), or an app
 * running on the person's own computer (http on localhost / 127.0.0.1), so nobody can register an address of their own
 * and receive a signed-in person's code.
 */
const ALLOWED_REDIRECT_HOSTS = ['claude.ai', 'claude.com', 'chatgpt.com', 'chat.openai.com', 'platform.openai.com', 'openai.com'];
export function redirectAllowed(u) {
  try {
    const url = new URL(u);
    if (url.protocol === 'http:') return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && !url.username && !url.password;
    return url.protocol === 'https:' && ALLOWED_REDIRECT_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith('.' + h));
  } catch { return false; }
}
