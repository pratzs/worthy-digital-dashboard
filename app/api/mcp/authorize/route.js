/**
 * The human step of OAuth: asks for the person's work email, their department and that department's password. Only a
 * person listed in lib/people.js for that department, and allowed to use a connector, gets in. On success it issues a short-lived authorization code and redirects
 * back to the AI client's own redirect_uri. This is the ONLY place a Worthy
 * password is ever typed for this flow - the resulting access token (see
 * lib/oauth.js) is what the AI client holds from then on, not the password.
 */
import { NextResponse } from 'next/server';
import { clientRedirectUris, issueCode, redirectAllowed } from '@/lib/oauth';
import { ROLES } from '@/lib/auth';
import { personByEmail } from '@/lib/people';
import { timingSafeEqual } from 'node:crypto';

// Constant-time compare so a password cannot be guessed from how quickly it is refused.
const sameString = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

export const dynamic = 'force-dynamic';

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function page({ error, fields }) {
  const hidden = Object.entries(fields)
    .map(([k, v]) => `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}">`)
    .join('\n');
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Worthy Reports — Sign in</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,'DM Sans',sans-serif;background:#faf8f5;
    display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
  .card{background:#fff;border:1px solid #e4e0da;border-radius:14px;padding:32px;width:320px}
  h1{font-size:17px;margin:0 0 6px}
  p{font-size:12.5px;color:#8a8178;margin:0 0 20px}
  select,input[type=password],input[type=email]{width:100%;padding:11px 13px;border-radius:9px;border:1px solid #e4e0da;
    font-size:14px;box-sizing:border-box;margin-bottom:12px}
  button{width:100%;padding:11px;border-radius:9px;border:none;background:#b13924;color:#fff;
    font-weight:700;font-size:13px;cursor:pointer}
  .err{color:#b13924;font-size:12px;margin-bottom:12px}
</style></head><body>
<div class="card">
  <h1>Connect to Worthy Reports</h1>
  <p>Enter your work email, choose your department and enter its password. This app will then read the reports your department can see.</p>
  <form method="POST">
    ${hidden}
    ${error ? `<div class="err">${escapeHtml(error)}</div>` : ''}
    <input type="email" name="email" placeholder="Work email (you@worthy.nz)" autocomplete="username" autofocus required>
    <select name="department" aria-label="Department">
      <option value="mgmt">Management</option>
      <option value="bdm">Business Development &amp; Marketing</option>
      <option value="purch">Purchasing &amp; Stock</option>
    </select>
    <input type="password" name="password" placeholder="Department password" autocomplete="current-password" required>
    <button type="submit">Authorize</button>
  </form>
</div>
</body></html>`;
}

function html(body, status = 200) {
  return new NextResponse(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

function authParams(sp) {
  return {
    response_type: sp.get('response_type') || '',
    client_id: sp.get('client_id') || '',
    redirect_uri: sp.get('redirect_uri') || '',
    state: sp.get('state') || '',
    code_challenge: sp.get('code_challenge') || '',
    code_challenge_method: sp.get('code_challenge_method') || '',
    scope: sp.get('scope') || '',
    resource: sp.get('resource') || '',
  };
}

async function validate(fields) {
  if (fields.response_type !== 'code') return 'Unsupported response_type.';
  if (fields.code_challenge_method && fields.code_challenge_method !== 'S256') return 'Unsupported code_challenge_method.';
  const uris = await clientRedirectUris(fields.client_id);
  if (!uris) return 'Unknown client. Try adding the connector again.';
  if (!uris.includes(fields.redirect_uri) || !redirectAllowed(fields.redirect_uri)) return 'redirect_uri does not match this client\'s registration.';
  return null;
}

export async function GET(request) {
  const fields = authParams(request.nextUrl.searchParams);
  const err = await validate(fields);
  if (err) return html(page({ error: err, fields }), 400);
  return html(page({ error: null, fields }));
}

export async function POST(request) {
  const form = await request.formData();
  const fields = {
    response_type: form.get('response_type') || '',
    client_id: form.get('client_id') || '',
    redirect_uri: form.get('redirect_uri') || '',
    state: form.get('state') || '',
    code_challenge: form.get('code_challenge') || '',
    code_challenge_method: form.get('code_challenge_method') || '',
    scope: form.get('scope') || '',
    resource: form.get('resource') || '',
  };
  const err = await validate(fields);
  if (err) return html(page({ error: err, fields }), 400);

  // The department they chose decides which password is checked. No department means Management (existing connectors and tests).
  const asked = String(form.get('department') || 'mgmt');
  const role = Object.prototype.hasOwnProperty.call(ROLES, asked) ? asked : null;
  const expected = role ? process.env[ROLES[role].env] : '';
  const password = String(form.get('password') || '');
  // The person must be listed (lib/people.js) in the department they chose and be allowed a connector. Every refusal
  // reads the same, so the page never says which part was wrong.
  const who = personByEmail(form.get('email'));
  const listed = Boolean(who && role && who.dept === role && who.connector === true);
  if (!role || !expected || !sameString(password, expected) || !listed) {
    await new Promise((r) => setTimeout(r, 1500));   // slow down password guessing
    return html(page({ error: 'Wrong email, department or password.', fields }), 401);
  }

  const code = await issueCode({
    client_id: fields.client_id,
    redirect_uri: fields.redirect_uri,
    code_challenge: fields.code_challenge,
    resource: fields.resource,
    role,
    person: who.key,
  });
  const dest = new URL(fields.redirect_uri);
  dest.searchParams.set('code', code);
  if (fields.state) dest.searchParams.set('state', fields.state);
  return NextResponse.redirect(dest, 302);
}
