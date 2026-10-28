/**
 * Dynamic client registration for the rep connector (RFC 7591). Unlike the
 * management connector, only claude.ai / ChatGPT / OpenAI redirect addresses are
 * accepted, so nobody can register a client that sends a signed-in rep's code
 * to an address of their own.
 */
import { NextResponse } from 'next/server';
import { registerClient, redirectAllowed } from '@/lib/repOauth';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'invalid_client_metadata' }, { status: 400 }); }
  const redirect_uris = Array.isArray(body?.redirect_uris) ? body.redirect_uris : [];
  if (redirect_uris.length === 0 || redirect_uris.length > 5 || !redirect_uris.every(redirectAllowed)) {
    return NextResponse.json({ error: 'invalid_redirect_uri',
      error_description: 'redirect_uris must be https addresses on claude.ai or ChatGPT.' }, { status: 400 });
  }
  let client_id;
  try { client_id = registerClient(redirect_uris); } catch { return NextResponse.json({ error: 'server_error' }, { status: 500 }); }
  return NextResponse.json({
    client_id, redirect_uris,
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code'],
    response_types: ['code'],
    client_name: String(body.client_name || 'MCP client').slice(0, 80),
  }, { status: 201 });
}
