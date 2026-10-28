/**
 * The rep-only MCP endpoint: JSON-RPC 2.0 over HTTP, Bearer-token protected.
 * Separate from app/api/mcp (management). A token here names ONE rep; every tool
 * answers only for that rep (lib/repTools.js). Nothing the caller sends can pick
 * a different rep, a different company or a raw query.
 */
import { NextResponse } from 'next/server';
import { checkAccessToken } from '@/lib/repOauth';
import { principalByKey, currentVer } from '@/lib/repAccess';
import { REP_TOOLS, runRepTool } from '@/lib/repTools';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const SUPPORTED_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const negotiateVersion = (requested) => (SUPPORTED_VERSIONS.includes(requested) ? requested : SUPPORTED_VERSIONS[0]);

// Bearer-token API with no cookies, so a wildcard origin carries no CSRF risk and lets
// browser-based clients (ChatGPT) complete the call.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const wantsEventStream = (request) => {
  const accept = request.headers.get('accept') || '';
  return accept.includes('text/event-stream') && !accept.includes('application/json');
};
const sseResponse = (payload, status) => new NextResponse(`event: message\ndata: ${JSON.stringify(payload)}\n\n`, {
  status, headers: { ...CORS_HEADERS, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
});
const rpcResult = (id, result, sse = false) => {
  const payload = { jsonrpc: '2.0', id, result };
  return sse ? sseResponse(payload, 200) : NextResponse.json(payload, { headers: CORS_HEADERS });
};
const rpcError = (id, code, message, status = 200, sse = false) => {
  const payload = { jsonrpc: '2.0', id, error: { code, message } };
  return sse ? sseResponse(payload, status) : NextResponse.json(payload, { status, headers: CORS_HEADERS });
};

function unauthorized(request) {
  const origin = request.nextUrl.origin;
  return new NextResponse(JSON.stringify({ error: 'unauthorized' }), {
    status: 401,
    headers: {
      'Content-Type': 'application/json',
      'WWW-Authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/api/rep-mcp"`,
      ...CORS_HEADERS,
    },
  });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/** The rep this request is allowed to act as, or null. Re-checked on EVERY call. */
function repFromRequest(request) {
  const auth = request.headers.get('authorization') || '';
  const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : null;
  const claims = token ? checkAccessToken(token) : null;
  if (!claims) return null;
  const rep = principalByKey(claims.sub);
  // A rep who has been switched off, or whose version was bumped, stops working at once.
  if (!rep || currentVer(rep.key) === 0 || currentVer(rep.key) !== claims.ver) return null;
  return rep;
}

export async function POST(request) {
  let rep = null;
  try { rep = repFromRequest(request); } catch { rep = null; }
  if (!rep) return unauthorized(request);

  const sse = wantsEventStream(request);
  let body;
  try { body = await request.json(); } catch { return rpcError(null, -32700, 'Parse error', 400, sse); }
  const { id, method, params = {} } = body || {};

  // A JSON-RPC notification has no id and must get no body back.
  if (id === undefined || id === null) return new NextResponse(null, { status: 202, headers: CORS_HEADERS });

  if (method === 'initialize') {
    return rpcResult(id, {
      protocolVersion: negotiateVersion(params.protocolVersion),
      capabilities: { tools: {} },
      serverInfo: { name: 'worthy-my-sales', version: '1.0.0' },
    }, sse);
  }
  if (method === 'ping') return rpcResult(id, {}, sse);
  if (method === 'tools/list') return rpcResult(id, { tools: REP_TOOLS }, sse);
  if (method === 'tools/call') {
    const { name, arguments: args = {} } = params;
    const started = Date.now();
    try {
      const result = await runRepTool(rep, name, args);
      console.log(JSON.stringify({ evt: 'rep_mcp', rep: rep.key, tool: String(name), ok: true, ms: Date.now() - started }));
      return rpcResult(id, {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
        isError: false,
      }, sse);
    } catch (e) {
      console.log(JSON.stringify({ evt: 'rep_mcp', rep: rep.key, tool: String(name), ok: false, ms: Date.now() - started }));
      return rpcResult(id, { content: [{ type: 'text', text: e.message }], isError: true }, sse);
    }
  }
  return rpcError(id, -32601, `Unknown method '${method}'`, 200, sse);
}

export async function GET() {
  return NextResponse.json({ error: 'This server only supports POST (no SSE stream).' }, { status: 405, headers: CORS_HEADERS });
}
