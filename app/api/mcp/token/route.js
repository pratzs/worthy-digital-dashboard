/**
 * Exchanges an authorization code (+ PKCE code_verifier) for an access token.
 * The code is single-shot by construction, not by a "used" flag: it is a
 * signed, self-contained blob with no server-side record, so there is nothing
 * to mark as spent - its 2-minute expiry (lib/oauth.js) is what bounds a
 * replay window, same tradeoff a very short-TTL cache entry would give.
 */
import { NextResponse } from 'next/server';
import { redeemCode, pkceVerify, issueAccessToken } from '@/lib/oauth';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  let params;
  const ct = request.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    params = await request.json().catch(() => ({}));
  } else {
    const form = await request.formData();
    params = Object.fromEntries(form.entries());
  }

  if (params.grant_type !== 'authorization_code') {
    return NextResponse.json({ error: 'unsupported_grant_type' }, { status: 400 });
  }

  const code = await redeemCode(params.code);
  if (!code) {
    return NextResponse.json({ error: 'invalid_grant', error_description: 'Code is invalid or expired.' }, { status: 400 });
  }
  if (code.client_id !== params.client_id) {
    return NextResponse.json({ error: 'invalid_grant', error_description: 'client_id mismatch.' }, { status: 400 });
  }
  if (params.redirect_uri && code.redirect_uri !== params.redirect_uri) {
    return NextResponse.json({ error: 'invalid_grant', error_description: 'redirect_uri mismatch.' }, { status: 400 });
  }
  if (!(await pkceVerify(params.code_verifier, code.code_challenge))) {
    return NextResponse.json({ error: 'invalid_grant', error_description: 'PKCE verification failed.' }, { status: 400 });
  }
  // RFC 8707: the client (ChatGPT) sends the same resource on /authorize and
  // /token - if it sends one at this step, it must match what /authorize
  // captured, rather than silently accepting a mismatched one.
  if (params.resource && code.resource && params.resource !== code.resource) {
    return NextResponse.json({ error: 'invalid_target', error_description: 'resource does not match the authorization request.' }, { status: 400 });
  }

  const access_token = await issueAccessToken(code.resource || params.resource);
  return NextResponse.json({
    access_token,
    token_type: 'Bearer',
    expires_in: 90 * 24 * 60 * 60,
    scope: 'reports',
  });
}
