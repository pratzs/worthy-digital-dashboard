/**
 * Production-safe check of the DEPARTMENT limits: the connector's "choose your department" sign-in and what each department
 * gets in the data. Read only. It needs only the three department passwords, taken from environment variables so they never appear
 * on the command line or in the output:
 *
 *   $env:MGMT_PW = "..."; $env:BDM_PW = "..."; $env:PURCH_PW = "..."
 *   node scripts/department-check.mjs https://worthy-digital-dashboard.vercel.app
 */
import { createHash, randomBytes } from 'node:crypto';

const base = process.argv[2];
const { MGMT_PW: mPw, BDM_PW: bdmPw, PURCH_PW: purchPw } = process.env;
if (!base || !mPw || !bdmPw || !purchPw) { console.error('Usage: set MGMT_PW, BDM_PW and PURCH_PW, then: node scripts/department-check.mjs <base url>'); process.exit(1); }
const R = 'https://claude.ai/api/mcp/auth_callback';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ok  ${m}`); } else { fail++; console.error(`FAIL  ${m}`); process.exitCode = 1; } };

// Sign-in is by named person now (lib/people.js). Locally the test people are used (PEOPLE_ALLOW_TEST=1); against production set MGMT_EMAIL / BDM_EMAIL / PURCH_EMAIL to listed people.
const EMAILS = { mgmt: process.env.MGMT_EMAIL || 'test.mgmt@worthy.nz', bdm: process.env.BDM_EMAIL || 'test.bdm@worthy.nz', purch: process.env.PURCH_EMAIL || 'test.purch@worthy.nz' };
const deptOfPw = (pw) => (pw === mPw ? 'mgmt' : pw === bdmPw ? 'bdm' : 'purch');
async function signIn(fields) {
  if (!('email' in fields)) fields = { ...fields, email: EMAILS[fields.department || 'mgmt'] || '' };
  const reg = await (await fetch(`${base}/api/mcp/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: [R] }) })).json();
  const v = randomBytes(32).toString('base64url'), ch = createHash('sha256').update(v).digest('base64url');
  const a = await fetch(`${base}/api/mcp/authorize`, { method: 'POST', redirect: 'manual', body: new URLSearchParams({ response_type: 'code', client_id: reg.client_id, redirect_uri: R, state: 's', code_challenge: ch, code_challenge_method: 'S256', scope: '', resource: '', ...fields }) });
  const loc = a.headers.get('location'); const c = loc && new URL(loc).searchParams.get('code');
  if (!c) return null;
  const t = await (await fetch(`${base}/api/mcp/token`, { method: 'POST', body: new URLSearchParams({ grant_type: 'authorization_code', code: c, client_id: reg.client_id, redirect_uri: R, code_verifier: v }) })).json();
  return t.access_token || null;
}
const rpc = async (tok, method, params, path = '/api/mcp') => { const r = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }); return { status: r.status, body: r.status === 200 ? (await r.json()).result : null }; };
const call = async (tok, name, args = {}) => { const r = (await rpc(tok, 'tools/call', { name, arguments: args })).body; return { err: !r || r.isError, text: r?.content?.[0]?.text || '', data: r?.structuredContent }; };
const login = async (password) => { const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password, email: EMAILS[deptOfPw(password)] }) }); return (r.headers.get('set-cookie') || '').split(';')[0]; };
const getJson = async (path, headers) => { const r = await fetch(`${base}${path}`, { headers }); return r.status === 200 ? r.json() : null; };
const STRIPPED = new Set(['reps', 'weeks', 'weekly', 'repMargins', 'repMarginAvailable', 'repMarginNote', 'salespeople', 'salespeopleMonthly', 'salespeopleWeekly', 'customers', 'clv', 'churned', 'atRisk', 'lapsed']);
const hasKey = (v, set) => Array.isArray(v) ? v.some((x) => hasKey(x, set)) : v && typeof v === 'object' ? Object.entries(v).some(([k, x]) => set.has(k) || hasKey(x, set)) : false;
const DEPT = ['fetch', 'get_financial_year', 'get_product_analytics', 'get_south_financial_year', 'search'];

console.log('Sign-in: each department only with its own password');
const B = await signIn({ password: bdmPw, department: 'bdm' }), P = await signIn({ password: purchPw, department: 'purch' }), M = await signIn({ password: mPw, department: 'mgmt' }), M0 = await signIn({ password: mPw });
ok(Boolean(B && P && M && M0), 'Business Development, Purchasing and Management each sign in (and Management with none chosen)');
for (const [pw, d] of [[purchPw, 'mgmt'], [purchPw, 'bdm'], [bdmPw, 'purch'], [bdmPw, 'mgmt'], [mPw, 'purch'], [mPw, 'bdm'], [purchPw, 'nonsense']]) ok((await signIn({ password: pw, department: d })) === null, `a password does not open the wrong department (${d})`);

console.log('Tools offered');
const names = async (t) => (await rpc(t, 'tools/list')).body.tools.map((x) => x.name).sort();
ok(JSON.stringify(await names(B)) === JSON.stringify(DEPT) && JSON.stringify(await names(P)) === JSON.stringify(DEPT), 'Business Development and Purchasing are each offered only five department tools');
const full = await names(M);
ok(full.length > DEPT.length && full.includes('odoo_search') && full.includes('get_expenses') && JSON.stringify(await names(M0)) === JSON.stringify(full), 'Management is offered everything');
for (const [who, t] of [['Business Development', B], ['Purchasing', P]]) {
  for (const n of ['get_debtors', 'get_expenses', 'get_south_cost_gaps', 'odoo_search', 'ostendo_query']) { const r = await call(t, n, { company: 'north', sql: 'select 1', model: 'res.partner' }); ok(r.err && /not available to your department/.test(r.text), `${who} cannot call ${n}`); }
  ok((await rpc(t, 'tools/list', {}, '/api/rep-mcp')).status === 401, `${who} token is refused by the rep connector`);
}

console.log('What Purchasing gets');
for (const co of ['north', 'oceania']) { const r = await call(P, 'get_financial_year', { company: co }); ok(!r.err && !hasKey(r.data, STRIPPED) && r.data.months?.length > 0, `year (${co}): totals and months, no rep, weekly or customer data`); }
const ps = await call(P, 'get_south_financial_year', {}); ok(!ps.err && !hasKey(ps.data, STRIPPED), 'year (south): no rep or weekly data');
for (const co of ['north', 'oceania', 'south']) { const r = await call(P, 'get_product_analytics', { company: co }); ok(!r.err && !hasKey(r.data, STRIPPED), `product analytics (${co}): no rep or customer data`); }
const sp = await call(P, 'search', { query: 'Musashi' }); ok(!sp.err && sp.data.results.every((x) => /^(odoo:product:|ostendo:item:|ostendo:supplier:)/.test(x.id)), 'search returns products, items and suppliers only');
ok((await call(P, 'fetch', { id: 'odoo:partner:1' })).err, 'cannot fetch a customer record');
console.log('What Business Development and Management keep');
const bf = await call(B, 'get_financial_year', { company: 'north' }); ok(!bf.err && bf.data.reps?.length > 0, 'Business Development keeps Sales by Rep (as designed)');
const mf = await call(M, 'get_financial_year', { company: 'north' }); ok(!mf.err && mf.data.reps?.length > 0 && mf.data.customers?.length > 0, 'Management keeps everything');

console.log('Dashboard data routes');
const pc = await login(purchPw), mc = await login(mPw);
for (const p of ['/api/odoo/fy?fy=2026', '/api/ostendo/fy?fy=2026', '/api/odoo/advanced?fy=2026', '/api/ostendo/advanced?fy=2026']) {
  const a = await getJson(p, { cookie: pc }), s = await getJson(p, { cookie: pc, 'x-worthy-role': 'mgmt' }), m = await getJson(p, { cookie: mc });
  ok(a && !hasKey(a, STRIPPED), `Purchasing: ${p} has no rep, weekly or customer data`);
  ok(s && !hasKey(s, STRIPPED), `Purchasing claiming to be management still gets the limited answer: ${p}`);
  ok(m && hasKey(m, STRIPPED), `Management still gets the full answer: ${p}`);
}
console.log(`\n${pass} passed, ${fail} failed`);
