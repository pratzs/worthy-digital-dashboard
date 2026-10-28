/**
 * Exchanges an authorization code (+ PKCE verifier) for a rep access token.
 * The rep's key and version are read from the signed code, never from the request.
 */
import { NextResponse } from 'next/server';
import { redeemCode, pkceVerify, issueAccessToken } from '@/lib/repOauth';
import { currentVer } from '@/lib/repAccess';

export const dynamic = 'force-dynamic';

const fail = (error, description, status = 400) =>
  NextResponse.json({ error, error_description: description }, { status });

export async function POST(request) {
  let params;
  const ct = request.headers.get('content-type') || '';
  if (ct.includes('application/json')) params = await request.json().catch(() => ({}));
  else params = Object.fromEntries((await request.formData()).entries());

  if (params.grant_type !== 'authorization_code') return fail('unsupported_grant_type', 'Only authorization_code is supported.');
  let code;
  try { code = redeemCode(params.code); } catch { return fail('server_error', 'Not configured.', 500); }
  if (!code) return fail('invalid_grant', 'Code is invalid or expired.');
  if (code.client_id !== params.client_id) return fail('invalid_grant', 'client_id mismatch.');
  if (params.redirect_uri && code.redirect_uri !== params.redirect_uri) return fail('invalid_grant', 'redirect_uri mismatch.');
  if (!pkceVerify(params.code_verifier, code.code_challenge)) return fail('invalid_grant', 'PKCE verification failed.');
  if (params.resource && code.resource && params.resource !== code.resource) return fail('invalid_target', 'resource does not match.');
  if (currentVer(code.sub) !== code.ver) return fail('invalid_grant', 'Access has been switched off.');

  return NextResponse.json({
    access_token: issueAccessToken({ sub: code.sub, ver: code.ver, resource: code.resource || params.resource }),
    token_type: 'Bearer',
    expires_in: 7 * 24 * 60 * 60,
    scope: 'my-sales',
  });
}
