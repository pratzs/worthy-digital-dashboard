import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Metadata for the rep-only connector. Its own authorization server, so a rep
// connector never points at the management sign-in.
export async function GET(request) {
  const origin = request.nextUrl.origin;
  return NextResponse.json({
    resource: `${origin}/api/rep-mcp`,
    authorization_servers: [`${origin}/api/rep-mcp`],
  });
}
