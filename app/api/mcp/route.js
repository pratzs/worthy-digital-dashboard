/**
 * The MCP endpoint itself: JSON-RPC 2.0 over HTTP, Bearer-token protected.
 * Claude or ChatGPT call this directly from the person's own account once
 * they've been through /api/mcp/authorize - this server never sees which
 * person it is, only that SOME management login completed the OAuth step.
 * Read-only: the same four tools app/api/chat uses, via lib/mcpTools.js.
 */
import { NextResponse } from 'next/server';
import { checkAccessToken } from '@/lib/oauth';
import { DATA_TOOLS, runDataTool } from '@/lib/mcpTools';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const PROTOCOL_VERSION = '2024-11-05';

function rpcResult(id, result) {
  return NextResponse.json({ jsonrpc: '2.0', id, result });
}
function rpcError(id, code, message, status = 200) {
  return NextResponse.json({ jsonrpc: '2.0', id, error: { code, message } }, { status });
}

function unauthorized(request) {
  const origin = request.nextUrl.origin;
  return new NextResponse(
    JSON.stringify({ error: 'unauthorized' }),
    {
      status: 401,
      headers: {
        'Content-Type': 'application/json',
        'WWW-Authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
      },
    },
  );
}

export async function POST(request) {
  const auth = request.headers.get('authorization') || '';
  const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : null;
  const session = token && await checkAccessToken(token);
  if (!session) return unauthorized(request);

  let body;
  try {
    body = await request.json();
  } catch {
    return rpcError(null, -32700, 'Parse error', 400);
  }
  const { id, method, params = {} } = body || {};

  if (method === 'initialize') {
    return rpcResult(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: 'worthy-reports', version: '1.0.0' },
    });
  }
  if (method === 'notifications/initialized' || method === 'ping') {
    return rpcResult(id, {});
  }
  if (method === 'tools/list') {
    return rpcResult(id, { tools: DATA_TOOLS });
  }
  if (method === 'tools/call') {
    const { name, arguments: args = {} } = params;
    try {
      const result = await runDataTool(name, args);
      return rpcResult(id, {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        isError: false,
      });
    } catch (e) {
      return rpcResult(id, { content: [{ type: 'text', text: e.message }], isError: true });
    }
  }
  return rpcError(id, -32601, `Unknown method '${method}'`);
}

// A real MCP client probes GET for an SSE stream before falling back to plain
// POST request/response. We only support the latter, so this just says so
// rather than hanging - a hung GET looks like a dead server to some clients.
export async function GET() {
  return NextResponse.json({ error: 'This server only supports POST (no SSE stream).' }, { status: 405 });
}
