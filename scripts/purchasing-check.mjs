/**
 * Purchasing wall check for the two named Purchasing people: Kylie (dashboard and its chat only) and Hari (dashboard and connector).
 * Signs in as each of them and tries every door: allowed pages and data must work and carry no rep, weekly, customer, debtor
 * or expense data; everything else must be refused. No AI question is asked, so it costs nothing.
 *
 *   PURCH_PW=<Purchasing password> [MGMT_PW=<Management password>] node scripts/purchasing-check.mjs <base url>
 *
 * With MGMT_PW (use it on a local server only) it also reads the real rep and customer names from the management view and
 * proves none of them appear anywhere in what Purchasing receives. Passwords come from the environment and are never printed.
 */
import { createHash, randomBytes } from 'node:crypto';

const base = (process.argv[2] || '').replace(/\/$/, '');
const PW = process.env.PURCH_PW, MPW = process.env.MGMT_PW || '';
const MGMT_EMAIL = process.env.MGMT_EMAIL || 'test.mgmt@worthy.nz';
if (!base || !PW) { console.error('Usage: PURCH_PW=... [MGMT_PW=...] node scripts/purchasing-check.mjs <base url>'); process.exit(1); }
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ' + m); } else { fail++; console.log('FAIL  ' + m); } };
const PEOPLE = [{ name: 'Kylie', email: 'kylie@worthy.nz', connector: false }, { name: 'Hari', email: 'hari@worthy.nz', connector: true }];
const FORBIDDEN_KEYS = ['reps', 'weeks', 'weekly', 'repMargins', 'repMarginAvailable', 'repMarginNote', 'salespeople', 'salespeopleMonthly', 'salespeopleWeekly', 'customers', 'clv', 'churned', 'atRisk', 'lapsed', 'debtors', 'expenses', 'salesperson', 'invoice_user_id'];

const login = async (email, password) => {
  const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
  return { status: r.status, cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
};
const get = (path, cookie, extra = {}) => fetch(base + path, { headers: { cookie, ...extra }, redirect: 'manual' });
const keysIn = (v, found = new Set(), d = 0) => { if (d > 14 || !v || typeof v !== 'object') return found; if (Array.isArray(v)) { for (const x of v.slice(0, 400)) keysIn(x, found, d + 1); return found; } for (const [k, x] of Object.entries(v)) { found.add(k); keysIn(x, found, d + 1); } return found; };
const wordRe = (n) => new RegExp(`(^|[^A-Za-z])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Za-z]|$)`);

// What only management should see: rep names and customer names, read from the management view (local servers only).
let repNames = [], customerNames = [];
if (MPW) {
  const m = await login(MGMT_EMAIL, MPW);
  if (m.status === 200) {
    const [n, s, na, sa] = await Promise.all(['/api/odoo/fy?fy=2026', '/api/ostendo/fy?fy=2026', '/api/odoo/advanced?fy=2026', '/api/ostendo/advanced?fy=2026'].map((p) => get(p, m.cookie).then((r) => r.json()).catch(() => ({}))));
    repNames = [...new Set([...(n.reps || []), ...(s.reps || [])].map((r) => String(r.name || r.rep || '').trim()).filter((x) => x.length >= 4 && !/^(direct|unassigned|other)$/i.test(x)))];
    const cust = (o) => [...(o.customers || []), ...(o.clv || []), ...(o.atRisk || []), ...(o.churned || []), ...(o.lapsed || [])].map((c) => String(c.name || c.customer || '').trim());
    customerNames = [...new Set([...cust(n), ...cust(s), ...cust(na), ...cust(sa)].filter((x) => x.length >= 8))].slice(0, 400);
    console.log(`Management view read: ${repNames.length} rep names and ${customerNames.length} customer names to look for.`);
  } else console.log('Management sign-in did not work, so names are not compared.');
}
const scan = (label, text, json) => {
  const keys = json ? keysIn(json) : new Set();
  const badKeys = FORBIDDEN_KEYS.filter((k) => keys.has(k));
  ok(badKeys.length === 0, `${label}: no rep, weekly, customer, debtor or expense fields` + (badKeys.length ? ' FOUND ' + badKeys.join(',') : ''));
  if (repNames.length) { const hit = repNames.filter((n) => wordRe(n).test(text)); ok(hit.length === 0, `${label}: none of the ${repNames.length} rep names appear` + (hit.length ? ' FOUND ' + hit.slice(0, 5).join(', ') : '')); }
  if (customerNames.length) { const hit = customerNames.filter((n) => text.includes(n)); ok(hit.length === 0, `${label}: none of the ${customerNames.length} customer names appear` + (hit.length ? ' FOUND ' + hit.slice(0, 5).join(' | ') : '')); }
};

const ALLOWED = ['/api/odoo?fy=2026', '/api/odoo/fy?fy=2026', '/api/odoo/advanced?fy=2026', '/api/ostendo/fy?fy=2026', '/api/ostendo/advanced?fy=2026', '/api/stock-value'];
const REFUSED = ['/api/odoo/debtors', '/api/odoo/credits', '/api/odoo/weeks?fy=2026', '/api/ostendo/debtors', '/api/ostendo/credits', '/api/rep-usage', '/api/targets', '/api/shopify', '/api/shopify/advanced', '/api/tools/list', '/api/my-sales/me', '/api/odoo/kpi'];
const PAGES_OK = ['/products', '/chat'], PAGES_NO = ['/', '/reps', '/customers', '/debtors', '/credits', '/rep-usage'];

for (const p of PEOPLE) {
  console.log(`\n${p.name} (${p.email}) on the dashboard`);
  const s = await login(p.email, PW);
  ok(s.status === 200 && s.cookie.startsWith('worthy_auth='), 'signs in with work email and the Purchasing password');
  if (s.status !== 200) continue;
  ok((await login(p.email, PW + 'x')).status === 401, 'a wrong password is refused');
  ok((await login(p.email.replace('@', '.x@'), PW)).status === 401, 'the Purchasing password with a different email is refused');
  if (MPW) ok((await login(p.email, MPW)).status === 401, 'the Management password with this email is refused');
  const me = await get('/api/auth/me', s.cookie).then((r) => r.json());
  ok(me.role === 'purch' && me.name === p.name, `the dashboard knows them as ${me.name}, ${me.label}`);
  ok(JSON.stringify((me.sections || []).map((x) => x.id).sort()) === JSON.stringify(['chat', 'movers', 'products']), 'their pages are Products, Movers and the chat only: ' + (me.sections || []).map((x) => x.id).join(', '));
  ok(me.quota && me.quota.limit > 0 && me.quota.remaining >= 0, `question allowance is ${me.quota?.limit} a day (${me.quota?.remaining} left)`);
  for (const path of ALLOWED) {
    const r = await get(path, s.cookie); const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch {}
    ok(r.status === 200 && j, `${path} opens (${r.status}, ${Math.round(text.length / 1024)} KB)`);
    if (j) scan(path, text, j);
    // A caller cannot claim to be Management by sending the header the server uses internally.
    const sp = await get(path, s.cookie, { 'x-worthy-role': 'mgmt', 'x-worthy-person': 'kishan' }); const st = await sp.text(); let sj = null; try { sj = JSON.parse(st); } catch {}
    ok(!sj || FORBIDDEN_KEYS.every((k) => !keysIn(sj).has(k)), `${path}: sending a fake "I am Management" header changes nothing`);
  }
  for (const path of REFUSED) { const r = await get(path, s.cookie); ok([401, 403, 404, 405, 307, 308].includes(r.status), `${path} is refused (${r.status})`); }
  for (const [path, body] of [['/api/ai', { prompt: 'x' }], ['/api/tools/call', { name: 'get_debtors', arguments: {} }], ['/api/targets', { rep: 'x' }]]) {
    const r = await fetch(base + path, { method: 'POST', headers: { cookie: s.cookie, 'content-type': 'application/json' }, body: JSON.stringify(body), redirect: 'manual' });
    ok([401, 403, 404, 405, 307, 308].includes(r.status), `POST ${path} is refused (${r.status})`);
  }
  for (const path of PAGES_OK) { const r = await get(path, s.cookie); ok(r.status === 200, `page ${path} opens (${r.status})`); }
  { const r = await get('/movers', s.cookie); ok(r.status === 307 && String(r.headers.get('location') || '').endsWith('/products'), 'page /movers sends them to Products, where Fast and Slow Movers now lives'); }
  for (const path of PAGES_NO) { const r = await get(path, s.cookie); ok(r.status !== 200, `page ${path} is not shown (${r.status} to ${r.headers.get('location') || '-'})`); }
  // An edited cookie: same person claiming Management, and another Purchasing person's name.
  const [role, person, sig] = decodeURIComponent(s.cookie.split('=')[1]).split('.');
  for (const forged of [`mgmt.${person}.${sig}`, `mgmt.kishan.${sig}`, `${role}.kishan.${sig}`, `${role}.${person}.${sig.slice(0, -2)}aa`]) {
    const r = await get('/api/odoo/debtors', `worthy_auth=${encodeURIComponent(forged)}`); const r2 = await get('/api/auth/me', `worthy_auth=${encodeURIComponent(forged)}`);
    ok(r.status !== 200 && r2.status !== 200, `a cookie edited to "${forged.split('.').slice(0, 2).join('.')}" is refused`);
  }
}

console.log('\nConnector (their own Claude or ChatGPT)');
const R = 'https://claude.ai/api/mcp/auth_callback';
async function connect(fields) {
  const reg = await (await fetch(`${base}/api/mcp/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: [R] }) })).json();
  const v = randomBytes(32).toString('base64url'), ch = createHash('sha256').update(v).digest('base64url');
  const a = await fetch(`${base}/api/mcp/authorize`, { method: 'POST', redirect: 'manual', body: new URLSearchParams({ response_type: 'code', client_id: reg.client_id, redirect_uri: R, state: 's', code_challenge: ch, code_challenge_method: 'S256', scope: '', resource: '', ...fields }) });
  const loc = a.headers.get('location'); const c = loc && new URL(loc).searchParams.get('code'); if (!c) return null;
  return (await (await fetch(`${base}/api/mcp/token`, { method: 'POST', body: new URLSearchParams({ grant_type: 'authorization_code', code: c, client_id: reg.client_id, redirect_uri: R, code_verifier: v }) })).json()).access_token || null;
}
const rpc = async (t, method, params, path = '/api/mcp') => { const r = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${t}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
ok((await connect({ email: 'kylie@worthy.nz', department: 'purch', password: PW })) === null, 'Kylie cannot connect a connector, even with the right password');
ok((await connect({ email: 'kylie@worthy.nz', department: 'mgmt', password: PW })) === null, 'Kylie cannot connect as Management');
ok((await connect({ department: 'purch', password: PW })) === null, 'the Purchasing password with no email connects nothing');
ok((await connect({ email: 'hari@worthy.nz', department: 'mgmt', password: PW })) === null, 'Hari cannot connect as Management with the Purchasing password');
ok((await connect({ email: 'hari@worthy.nz', department: 'bdm', password: PW })) === null, 'Hari cannot connect as Business Development');
if (MPW) ok((await connect({ email: 'hari@worthy.nz', department: 'mgmt', password: MPW })) === null, 'Hari cannot connect as Management even with the Management password');
ok((await connect({ email: 'hari@worthy.nz', department: 'purch', password: PW + 'x' })) === null, 'Hari with a wrong password is refused');
const T = await connect({ email: 'hari@worthy.nz', department: 'purch', password: PW });
ok(Boolean(T), 'Hari connects as Purchasing with his work email and the Purchasing password');
if (T) {
  const tools = ((await rpc(T, 'tools/list')).body.result?.tools || []).map((t) => t.name).sort();
  ok(JSON.stringify(tools) === JSON.stringify(['fetch', 'get_financial_year', 'get_product_analytics', 'get_south_financial_year', 'search']), 'he is offered exactly the five Purchasing tools: ' + tools.join(', '));
  const call = async (name, args) => { const r = (await rpc(T, 'tools/call', { name, arguments: args })).body; return { err: Boolean(r.error) || r.result?.isError, text: r.result?.content?.[0]?.text || r.error?.message || '', data: r.result?.structuredContent }; };
  for (const [name, args] of [['get_financial_year', { company: 'north', fy: 2026 }], ['get_financial_year', { company: 'north', fy: 2025 }], ['get_south_financial_year', { fy: 2026 }], ['get_product_analytics', { company: 'north', fy: 2026 }], ['get_product_analytics', { company: 'south', fy: 2026 }], ['search', { query: 'mars' }], ['search', { query: 'countdown' }], ['search', { query: 'naitik' }]]) {
    const r = await call(name, args); const label = `${name} ${JSON.stringify(args)}`;
    ok(!r.err, `${label} answers (${Math.round(r.text.length / 1024)} KB)` + (r.err ? ': ' + r.text.slice(0, 100) : ''));
    let j = r.data; if (!j) { try { j = JSON.parse(r.text); } catch {} }
    scan(label, r.text, j);
  }
  const blocked = [];
  for (const name of ['get_debtors', 'get_expenses', 'odoo_search', 'odoo_aggregate', 'ostendo_query', 'get_south_cost_gaps', 'get_weekly', 'get_credits', 'get_stock', 'my_sales', 'team_overview', 'account_sales', 'top_groups']) {
    const r = await call(name, { company: 'north', fy: 2026, model: 'res.partner', domain: [], sql: 'SELECT FIRST 1 CUSTOMER FROM SALESINVOICEHEADER', name: 'CSB' });
    if (!r.err) blocked.push(name);
  }
  ok(blocked.length === 0, 'every management, rep and business development tool is refused' + (blocked.length ? ' OPENED: ' + blocked.join(', ') : ''));
  const f1 = await call('fetch', { id: 'odoo:partner:1' }); ok(f1.err, 'he cannot fetch a customer record');
  ok((await rpc(T, 'tools/list', {}, '/api/rep-mcp')).status === 401, 'his connector token is refused by the team leads\' connector');
  for (const path of ['/api/odoo/debtors', '/api/rep-usage', '/api/odoo/fy?fy=2026']) { const r = await fetch(base + path, { headers: { authorization: `Bearer ${T}` }, redirect: 'manual' }); ok(r.status !== 200, `his connector token does not open the dashboard's ${path} (${r.status})`); }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
