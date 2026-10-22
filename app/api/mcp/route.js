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

// Some MCP clients (confirmed: a ChatGPT "Developer Mode" connector) call
// this endpoint directly from the person's browser rather than from their own
// server - without these headers the OAuth handshake still completes (that's
// just a page redirect, not CORS-restricted), so the connector shows as
// "connected", but every actual tool call is silently blocked by the
// browser's CORS policy before it ever reaches us. This is a Bearer-token
// API with no cookie/session auth, so a wildcard origin carries no CSRF risk
// - nothing is sent automatically by the browser the way a cookie would be.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// The Streamable HTTP transport lets the server answer a POST with either a
// single application/json body or a text/event-stream carrying exactly one
// event - both are spec-legal, but some real client implementations send
// Accept: text/event-stream (sometimes without application/json at all) and
// are strict about actually getting SSE back; confirmed live that this
// server previously replied application/json regardless of what Accept said.
// A client whose parser only understands the stream it asked for would
// silently discard a JSON reply - "connected", but no tool call ever lands.
function wantsEventStream(request) {
  const accept = request.headers.get('accept') || '';
  return accept.includes('text/event-stream') && !accept.includes('application/json');
}
function sseResponse(payload, status) {
  const body = `event: message\ndata: ${JSON.stringify(payload)}\n\n`;
  return new NextResponse(body, {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
  });
}
function rpcResult(id, result, sse = false) {
  const payload = { jsonrpc: '2.0', id, result };
  return sse ? sseResponse(payload, 200) : NextResponse.json(payload, { headers: CORS_HEADERS });
}
function rpcError(id, code, message, status = 200, sse = false) {
  const payload = { jsonrpc: '2.0', id, error: { code, message } };
  return sse ? sseResponse(payload, status) : NextResponse.json(payload, { status, headers: CORS_HEADERS });
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
        ...CORS_HEADERS,
      },
    },
  );
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(request) {
  const auth = request.headers.get('authorization') || '';
  const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : null;
  const session = token && await checkAccessToken(token);
  if (!session) return unauthorized(request);

  const sse = wantsEventStream(request);

  let body;
  try {
    body = await request.json();
  } catch {
    return rpcError(null, -32700, 'Parse error', 400, sse);
  }
  const { id, method, params = {} } = body || {};

  // A JSON-RPC NOTIFICATION (notifications/initialized, and any other
  // notifications/* the client sends) has no "id" field at all, and the MCP
  // spec requires the server send back NO body - 202 Accepted, nothing else.
  // This previously returned a normal {jsonrpc, id: null, result: {}} body,
  // which a strict client can treat as a protocol violation right after the
  // handshake and silently abandon the session - "connected" in the client's
  // UI, but no tool ever gets called, which looks exactly like "doesn't work".
  if (id === undefined || id === null) {
    return new NextResponse(null, { status: 202, headers: CORS_HEADERS });
  }

  if (method === 'initialize') {
    return rpcResult(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: 'worthy-reports', version: '1.0.0' },
    }, sse);
  }
  if (method === 'ping') {
    return rpcResult(id, {}, sse);
  }
  if (method === 'tools/list') {
    return rpcResult(id, { tools: DATA_TOOLS }, sse);
  }
  if (method === 'tools/call') {
    const { name, arguments: args = {} } = params;
    try {
      const result = await runDataTool(name, args);
      return rpcResult(id, {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        isError: false,
      }, sse);
    } catch (e) {
      return rpcResult(id, { content: [{ type: 'text', text: e.message }], isError: true }, sse);
    }
  }
  return rpcError(id, -32601, `Unknown method '${method}'`, 200, sse);
}

// A real MCP client probes GET for an SSE stream before falling back to plain
// POST request/response. We only support the latter, so this just says so
// rather than hanging - a hung GET looks like a dead server to some clients.
export async function GET() {
  return NextResponse.json(
    { error: 'This server only supports POST (no SSE stream).' },
    { status: 405, headers: CORS_HEADERS },
  );
}
