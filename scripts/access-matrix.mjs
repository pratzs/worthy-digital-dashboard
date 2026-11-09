/**
 * Who can see what: every credential against every door. It proves the walls between
 *   - MANAGEMENT (dashboard password cookie, and the management connector /api/mcp),
 *   - TEAM LEADS (My Account page cookie and rep connector token, e.g. Michelle, Team 1),
 *   - MARKETING / business development (rep connector token, e.g. Vishva),
 *   - the other dashboard departments (BDM, Purchasing cookies).
 * Needs a server started with REP_ALLOW_TEST_LEAD=1 (a test lead), a REP_ACCESS entry for vishva and the test lead, and department
 * passwords. Read only. Passwords come from arguments and are never printed.
 *
 *   node scripts/access-matrix.mjs <base url> <vishva password> <vishva email> <test lead password> <test lead email> <mgmt password> [bdm password] [purchasing password]
 */
import { createHash, randomBytes } from 'node:crypto';

const [base, vPw, vMail, lPw, lMail, mPw, bdmPw, purchPw] = process.argv.slice(2);
if (!base || !vPw || !lPw || !mPw) { console.error('Usage: node scripts/access-matrix.mjs <url> <vishva pw> <vishva email> <lead pw> <lead email> <mgmt pw> [bdm pw] [purchasing pw]'); process.exit(1); }
const R = 'https://claude.ai/api/mcp/auth_callback';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ok  ${m}`); } else { fail++; console.error(`FAIL  ${m}`); process.exitCode = 1; } };
const denied = (s) => [401, 403, 307, 302, 308, 404].includes(s);

async function signIn(prefix, fields) {
  const reg = await (await fetch(`${base}${prefix}/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: [R] }) })).json();
  const v = randomBytes(32).toString('base64url'), ch = createHash('sha256').update(v).digest('base64url');
  const a = await fetch(`${base}${prefix}/authorize`, { method: 'POST', redirect: 'manual', body: new URLSearchParams({ response_type: 'code', client_id: reg.client_id, redirect_uri: R, state: 's', code_challenge: ch, code_challenge_method: 'S256', scope: '', resource: '', ...fields }) });
  const loc = a.headers.get('location'); const c = loc && new URL(loc).searchParams.get('code');
  if (!c) return null;
  const t = await (await fetch(`${base}${prefix}/token`, { method: 'POST', body: new URLSearchParams({ grant_type: 'authorization_code', code: c, client_id: reg.client_id, redirect_uri: R, code_verifier: v }) })).json();
  return t.access_token || null;
}
const rpc = async (path, tok, method, params) => { const r = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }); return { status: r.status, body: r.status === 200 ? (await r.json()).result : null }; };
const call = async (path, tok, name, args = {}) => { const r = await rpc(path, tok, 'tools/call', { name, arguments: args }); const x = r.body; return { status: r.status, err: !x || x.isError, text: x?.content?.[0]?.text || '', data: x?.structuredContent }; };
const login = async (path, body) => { const r = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, cookie: (r.headers.get('set-cookie') || '').split(';')[0] }; };
const get = async (path, headers = {}) => (await fetch(`${base}${path}`, { headers, redirect: 'manual' })).status;

const LEAD_TOOLS = ['my_sales', 'my_debtors', 'my_customers', 'my_best_sellers', 'my_action_plan', 'my_cross_sell', 'my_recent_orders', 'team_overview', 'team_attention', 'team_product_gaps'];
const MKT_TOOLS = ['account_sales', 'top_groups', 'group_accounts', 'new_customers', 'lapsed_accounts', 'top_products', 'cost_basket', 'system_overview'];
const MGMT_TOOLS = ['get_financial_year', 'get_south_financial_year', 'get_debtors', 'get_south_debtors', 'get_expenses', 'get_south_cost_gaps', 'odoo_search', 'odoo_aggregate', 'odoo_list_models', 'ostendo_query', 'search', 'fetch'];
const ARGS = { sql: 'select 1', model: 'res.partner', company: 'north', name: 'CSB', items: [{ name: 'B0008' }], person: 'Savan' };

console.log('Sign-ins');
const V = await signIn('/api/rep-mcp', { access_code: vPw, email: vMail });
const L = await signIn('/api/rep-mcp', { access_code: lPw, email: lMail });
const M = await signIn('/api/mcp', { password: mPw });
ok(Boolean(V) && Boolean(L) && Boolean(M), 'marketing, a team lead and management can each sign in');
ok((await signIn('/api/rep-mcp', { access_code: vPw, email: lMail })) === null && (await signIn('/api/rep-mcp', { access_code: lPw, email: vMail })) === null, 'one person\'s password never works with another person\'s email');
ok((await signIn('/api/rep-mcp', { access_code: mPw, email: vMail })) === null && (await signIn('/api/mcp', { password: vPw })) === null && (await signIn('/api/mcp', { password: lPw })) === null, 'the management password does not open the rep connector, and rep passwords do not open management');

console.log('Marketing (Vishva) on the rep connector');
{
  const names = (await rpc('/api/rep-mcp', V, 'tools/list')).body.tools.map((x) => x.name).sort();
  ok(MKT_TOOLS.every((n) => names.includes(n)) && names.includes('my_profile') && names.includes('product_cost') && names.length === 10, 'sees exactly the ten business development tools');
  for (const n of [...LEAD_TOOLS, ...MGMT_TOOLS]) { const r = await call('/api/rep-mcp', V, n, ARGS); ok(r.err && /Unknown tool/.test(r.text), `cannot call ${n}`); }
  const init = await rpc('/api/rep-mcp', V, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'm', version: '1' } });
  ok(Boolean(init.body.instructions), 'is given the business development instructions');
}

console.log('Team lead on the rep connector');
{
  const names = (await rpc('/api/rep-mcp', L, 'tools/list')).body.tools.map((x) => x.name);
  ok(LEAD_TOOLS.every((n) => names.includes(n)) && MKT_TOOLS.every((n) => !names.includes(n)) && !MGMT_TOOLS.some((n) => names.includes(n)), 'sees the team lead tools and none of the marketing or management tools');
  for (const n of [...MKT_TOOLS, ...MGMT_TOOLS]) { const r = await call('/api/rep-mcp', L, n, ARGS); ok(r.err && /Unknown tool/.test(r.text), `cannot call ${n}`); }
  const init = await rpc('/api/rep-mcp', L, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'l', version: '1' } });
  ok(!init.body.instructions, 'is not given the marketing instructions');
  const ov = await call('/api/rep-mcp', L, 'team_overview', {});
  ok(!ov.err && ov.data.members.length === 2, 'team overview covers only the lead\'s own team');
  const text = JSON.stringify(ov.data);
  ok(!/Michelle|Chris|Ravi|Lynette|Hari|Rubin|Albert/.test(text) && !/Night n Day|Foodstuffs|CSB|Red Circle/i.test(text), 'the team overview names no other team and no group or corporate customer rankings');
  const other = await call('/api/rep-mcp', L, 'my_sales', { person: 'Chris' });
  ok(other.err && /not on your team/.test(other.text), 'cannot read a rep on another team');
  const co = await call('/api/rep-mcp', L, 'my_sales', { person: '*' });
  ok(co.err, 'cannot ask for everyone');
  const pc = await call('/api/rep-mcp', L, 'product_cost', { name: 'Musashi' });
  ok(!pc.err && !/Worthy Products North \(Odoo\)|Worthy Products South \(Dutch Rusk/.test(pc.text), 'product costs for a lead keep the lead format (no marketing labels)');
}

console.log('Management connector');
{
  ok((await rpc('/api/mcp', V, 'tools/list')).status === 401 && (await rpc('/api/mcp', L, 'tools/list')).status === 401, 'a marketing token and a lead token are both refused by the management connector');
  ok((await rpc('/api/rep-mcp', M, 'tools/list')).status === 401, 'a management token is refused by the rep connector');
  const names = (await rpc('/api/mcp', M, 'tools/list')).body.tools.map((x) => x.name);
  ok(MGMT_TOOLS.every((n) => names.includes(n)), 'management has its own full tool set (by design)');
  ok(!names.includes('top_groups') && !names.includes('team_overview'), 'the management tool list does not mix in the rep or marketing tools');
  const r = await fetch(`${base}/api/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer not.a.token' }, body: '{}' });
  ok(r.status === 401, 'a made-up token is refused');
}

console.log('Dashboard pages and APIs (the worthy_auth cookie)');
const PAGES = ['/', '/credits', '/debtors', '/reps', '/rep-usage', '/chat'];
const APIS = ['/api/odoo/fy?fy=2026', '/api/ostendo/fy?fy=2026', '/api/odoo/credits', '/api/targets', '/api/rep-usage', '/api/chat'];
{
  for (const p of [...PAGES, ...APIS]) ok(denied(await get(p)), `no sign-in: ${p} is refused`);
  for (const [who, tok] of [['marketing token', V], ['team lead token', L], ['management connector token', M]]) {
    for (const p of APIS) ok(denied(await get(p, { authorization: `Bearer ${tok}` })), `${who} as a Bearer header does not open ${p}`);
  }
  const lead = await login('/api/my-sales/login', { code: lPw, email: lMail });
  ok(lead.status === 200 && lead.cookie.startsWith('worthy_rep='), 'a team lead can sign in to the My Account page');
  for (const p of [...PAGES, ...APIS]) ok(denied(await get(p, { cookie: lead.cookie })), `team lead cookie does not open ${p}`);
  const vm = await login('/api/my-sales/login', { code: vPw, email: vMail });
  ok(vm.status === 403 && !vm.cookie.startsWith('worthy_rep=') , 'marketing cannot use the My Account page at all (no session issued)');
  const mg = await login('/api/auth/login', { password: mPw });
  ok(mg.status === 200 && mg.cookie.startsWith('worthy_auth='), 'management signs in to the dashboard');
  ok(await get('/api/rep-usage', { cookie: mg.cookie }) === 200 && await get('/api/targets', { cookie: mg.cookie }) === 200, 'management can open the usage and targets pages');
  ok(denied(await get('/api/my-sales/me', { cookie: mg.cookie })), 'the management dashboard cookie is not a rep session');
  for (const [name, pw] of [['BDM', bdmPw], ['Purchasing', purchPw]]) {
    if (!pw) continue;
    const d = await login('/api/auth/login', { password: pw });
    ok(d.status === 200, `${name} department can sign in`);
    for (const p of ['/api/rep-usage', '/api/targets', '/api/chat', '/rep-usage', '/credits', '/debtors']) ok(denied(await get(p, { cookie: d.cookie })) || (await get(p, { cookie: d.cookie })) === 403, `${name} cookie does not open ${p}`);
    ok(denied(await get('/api/my-sales/me', { cookie: d.cookie })), `${name} cookie is not a rep session`);
    const reps = await get('/api/odoo/fy?fy=2026', { cookie: d.cookie });
    console.log(`     info: ${name} can open the Sales by Rep data (/api/odoo/fy) = ${reps === 200}${name === 'BDM' ? '  <- do NOT give Vishva the BDM dashboard password if rep revenue must stay hidden' : ''}`);
  }
  ok(await get('/api/my-sales/me', { cookie: lead.cookie }) === 200, 'the lead\'s own session works on the My Account page');
  const warm = await fetch(`${base}/api/cron/cost-health`); const wj = await warm.json();
  ok(!('items' in wj) && !('customers' in wj), 'the public daily check returns totals only');
}
console.log(`\n${pass} passed, ${fail} failed`);
