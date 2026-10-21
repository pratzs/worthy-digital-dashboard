/**
 * RFC 7591 Dynamic Client Registration. Claude and ChatGPT both call this
 * before showing the "sign in" screen, to get a client_id without a human
 * pre-registering one anywhere. No database: the client_id IS the signed
 * registration (its redirect_uris included), verified back open at
 * /authorize and /token - see lib/oauth.js for why that's deliberate.
 */
import { NextResponse } from 'next/server';
import { registerClient } from '@/lib/oauth';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_client_metadata' }, { status: 400 });
  }
  const redirect_uris = Array.isArray(body?.redirect_uris) ? body.redirect_uris : [];
  if (redirect_uris.length === 0 || !redirect_uris.every((u) => {
    try { return new URL(u).protocol === 'https:'; } catch { return false; }
  })) {
    return NextResponse.json({ error: 'invalid_redirect_uri',
      error_description: 'redirect_uris must be a non-empty array of https URLs' }, { status: 400 });
  }

  const client_id = await registerClient(redirect_uris);
  return NextResponse.json({
    client_id,
    redirect_uris,
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code'],
    response_types: ['code'],
    client_name: body.client_name || 'MCP client',
  }, { status: 201 });
}
