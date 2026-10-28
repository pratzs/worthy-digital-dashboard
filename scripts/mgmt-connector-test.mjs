/**
 * Tests for the MANAGEMENT connector after the security fixes: only claude.ai / ChatGPT / OpenAI (or an app on the
 * person's own computer) can be registered; a wrong password is slowed down; the right password still gets a working
 * token; a rep token and a management token never work on each other's endpoint; and with no secret configured
 * nothing can be signed. Run against a local server started with DASHBOARD_PASSWORD=localtestpw and REP_AUTH_SECRET set.
 *
 *   node scripts/mgmt-connector-test.mjs http://localhost:3111
 */
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';

const base = process.argv[2];
let fails = 0;
const ok = (c, m) => { console.log(`${c ? '  ok  ' : 'FAIL  '}${m}`); if (!c) { fails++; process.exitCode = 1; } };
const post = (path, body) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

console.log('Registration only accepts the AI apps');
const reg = async (uri) => (await post('/api/mcp/register', { redirect_uris: [uri], client_name: 't' })).status;
for (const good of ['https://claude.ai/api/mcp/auth_callback', 'https://chatgpt.com/connector_platform_oauth_redirect', 'https://platform.openai.com/apps-manage/oauth', 'http://localhost:54321/callback', 'http://127.0.0.1:8123/cb'])
  ok((await reg(good)) === 201, `accepted: ${good}`);
for (const bad of ['https://evil.example/x', 'https://claude.ai.evil.com/x', 'https://evilclaude.ai/x', 'http://claude.ai/x', 'http://evil.com/x', 'http://user:pw@localhost/x', 'javascript:alert(1)'])
  ok((await reg(bad)) === 400, `refused: ${bad}`);
ok((await post('/api/mcp/register', { redirect_uris: [] })).status === 400, 'refused: no redirect address');

console.log('\nSign-in');
const R = 'https://claude.ai/api/mcp/auth_callback';
const client = await (await post('/api/mcp/register', { redirect_uris: [R] })).json();
const verifier = randomBytes(32).toString('base64url');
const challenge = createHash('sha256').update(verifier).digest('base64url');
const form = (pw, redirect = R) => new URLSearchParams({ response_type: 'code', client_id: client.client_id, redirect_uri: redirect, state: 's', code_challenge: challenge, code_challenge_method: 'S256', scope: '', resource: '', password: pw });
const t0 = Date.now();
const wrong = await fetch(base + '/api/mcp/authorize', { method: 'POST', body: form('not-the-password'), redirect: 'manual' });
ok(wrong.status === 401 && Date.now() - t0 >= 1300, `a wrong password is refused and slowed (${Date.now() - t0}ms)`);
const other = await fetch(base + '/api/mcp/authorize', { method: 'POST', body: form('localtestpw', 'https://evil.example/cb'), redirect: 'manual' });
ok(other.status === 400, 'a different redirect address than the one registered is refused');
const good = await fetch(base + '/api/mcp/authorize', { method: 'POST', body: form('localtestpw'), redirect: 'manual' });
const loc = good.headers.get('location');
ok(good.status === 302 && loc && loc.startsWith(R), 'the right password still signs in and goes back to claude.ai');
const code = new URL(loc).searchParams.get('code');
const tokRes = await fetch(base + '/api/mcp/token', { method: 'POST', body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: client.client_id, redirect_uri: R, code_verifier: verifier }) });
const mgmtToken = (await tokRes.json()).access_token;
ok(Boolean(mgmtToken), 'the code is exchanged for a working token');
const list = await (await fetch(base + '/api/mcp', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${mgmtToken}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) })).json();
const names = (list.result?.tools || []).map((t) => t.name);
ok(names.includes('get_financial_year') && names.includes('odoo_search'), `management still has its full tool list (${names.length} tools)`);

console.log('\nThe two connectors never work on each other');
const repReq = await fetch(base + '/api/rep-mcp', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${mgmtToken}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
ok(repReq.status === 401, 'a management token is refused by the rep connector');
const repClient = await (await post('/api/rep-mcp/register', { redirect_uris: [R] })).json();
ok(Boolean(repClient.client_id), 'the rep connector still registers');
const mgmtWithRepClient = await fetch(base + '/api/mcp/authorize?' + new URLSearchParams({ response_type: 'code', client_id: repClient.client_id, redirect_uri: R, code_challenge: challenge, code_challenge_method: 'S256' }));
ok(mgmtWithRepClient.status === 400, 'a rep connector client cannot be used on the management sign-in');

console.log('\nNo secret configured: nothing can be signed');
delete process.env.AUTH_SECRET; delete process.env.DASHBOARD_PASSWORD;
const oauth = await import('../lib/oauth.js');
await assert.rejects(() => oauth.registerClient(['https://claude.ai/x']), /No signing secret/);
ok(true, 'with no secret, signing fails instead of using a built-in one');
const auth = await import('../lib/auth.js');
await assert.rejects(() => auth.signRole('mgmt'), /No signing secret/);
ok(true, 'the dashboard login cookie cannot be signed without a secret either');

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
