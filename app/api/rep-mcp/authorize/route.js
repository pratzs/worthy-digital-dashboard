/**
 * The human step of OAuth for the rep connector: a rep types THEIR OWN access
 * code (there is no shared password here). A correct code issues a 30-second
 * authorization code naming that one rep, and redirects back to the AI client.
 */
import { NextResponse } from 'next/server';
import { clientRedirectUris, issueCode, redirectAllowed } from '@/lib/repOauth';
import { repForCode } from '@/lib/repAccess';
import { logSignin } from '@/lib/repStore';

export const dynamic = 'force-dynamic';

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function page({ error, fields }) {
  const hidden = Object.entries(fields)
    .map(([k, v]) => `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}">`).join('\n');
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Worthy My Sales - Sign in</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,'DM Sans',sans-serif;background:#faf8f5;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
  .card{background:#fff;border:1px solid #e4e0da;border-radius:14px;padding:32px;width:340px}
  h1{font-size:17px;margin:0 0 6px} p{font-size:12.5px;color:#8a8178;margin:0 0 20px}
  input[type=password],input[type=email]{width:100%;padding:11px 13px;border-radius:9px;border:1px solid #e4e0da;font-size:14px;box-sizing:border-box;margin-bottom:12px}
  button{width:100%;padding:11px;border-radius:9px;border:none;background:#b13924;color:#fff;font-weight:700;font-size:13px;cursor:pointer}
  .err{color:#b13924;font-size:12px;margin-bottom:12px}
</style></head><body>
<div class="card">
  <h1>Connect to Worthy My Sales</h1>
  <p>Sign in with your Worthy email and the password you were given. You will only see your own and your team's figures.</p>
  <form method="POST">
    ${hidden}
    ${error ? `<div class="err">${escapeHtml(error)}</div>` : ''}
    <input type="email" name="email" placeholder="Your email" autocomplete="username" autofocus required>
    <input type="password" name="access_code" placeholder="Your password" autocomplete="off" required>
    <button type="submit">Connect</button>
  </form>
</div>
</body></html>`;
}

const html = (body, status = 200) => new NextResponse(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });

const FIELDS = ['response_type', 'client_id', 'redirect_uri', 'state', 'code_challenge', 'code_challenge_method', 'scope', 'resource'];
const fromGet = (sp) => Object.fromEntries(FIELDS.map((k) => [k, sp.get(k) || '']));
const fromForm = (form) => Object.fromEntries(FIELDS.map((k) => [k, String(form.get(k) || '')]));

function validate(fields) {
  if (fields.response_type !== 'code') return 'Unsupported response_type.';
  if (fields.code_challenge_method !== 'S256' || !fields.code_challenge) return 'PKCE (S256) is required.';
  let uris;
  try { uris = clientRedirectUris(fields.client_id); } catch { return 'This connector is not configured yet.'; }
  if (!uris) return 'Unknown client. Try adding the connector again.';
  if (!uris.includes(fields.redirect_uri) || !redirectAllowed(fields.redirect_uri)) return 'redirect_uri does not match this client.';
  return null;
}

export async function GET(request) {
  const fields = fromGet(request.nextUrl.searchParams);
  const err = validate(fields);
  if (err) return html(page({ error: err, fields }), 400);
  return html(page({ error: null, fields }));
}

export async function POST(request) {
  const form = await request.formData();
  const fields = fromForm(form);
  const err = validate(fields);
  if (err) return html(page({ error: err, fields }), 400);

  const email = String(form.get('email') || '');
  const hit = repForCode(form.get('access_code'), email);
  const ua = request.headers.get('user-agent') || '';
  if (!hit) {
    await new Promise((r) => setTimeout(r, 1500)); // slow down guessing
    console.log(JSON.stringify({ evt: 'rep_mcp_signin', ok: false }));
    await logSignin({ t: new Date().toISOString(), rep: null, email, how: 'connector', ok: false, ua }).catch(() => {});
    return html(page({ error: 'That email or password is not recognised.', fields }), 401);
  }
  console.log(JSON.stringify({ evt: 'rep_mcp_signin', ok: true, rep: hit.rep.key }));
  await logSignin({ t: new Date().toISOString(), rep: hit.rep.key, email, how: 'connector', ok: true, ua }).catch(() => {});

  const code = issueCode({
    client_id: fields.client_id, redirect_uri: fields.redirect_uri, code_challenge: fields.code_challenge,
    resource: fields.resource, sub: hit.rep.key, ver: hit.ver,
  });
  const dest = new URL(fields.redirect_uri);
  dest.searchParams.set('code', code);
  if (fields.state) dest.searchParams.set('state', fields.state);
  return NextResponse.redirect(dest, 302);
}
