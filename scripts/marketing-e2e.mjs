/**
 * End-to-end test of (1) the Marketing login on the rep connector and (2) the expense tool on the management
 * connector, against a running server with real Odoo/Ostendo data (local or live).
 *
 *   node scripts/marketing-e2e.mjs <base url> <vishva password> <vishva email> <management password>
 *
 * Marketing must offer exactly my_profile, product_cost and account_sales; refuse every rep/team tool; return account
 * sales that add up (accounts = months = total) with no rep, salesperson or weekly figure. The expense tool must answer
 * Kishan's question shape exactly and add up. Passwords come from arguments and are never printed.
 */
import { createHash, randomBytes } from 'node:crypto';

const [base, vCode, vEmail, mgmtPw] = process.argv.slice(2);
if (!base || !vCode || !vEmail) { console.error('Usage: node scripts/marketing-e2e.mjs <url> <vishva password> <vishva email> [management password]'); process.exit(1); }
const R = 'https://claude.ai/api/mcp/auth_callback';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ok  ${m}`); } else { fail++; console.error(`FAIL  ${m}`); process.exitCode = 1; } };
const near = (a, b, tol = 0.06) => Math.abs(a - b) <= tol;

async function signIn(prefix, fields) {
  const reg = await (await fetch(`${base}${prefix}/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: [R] }) })).json();
  const v = randomBytes(32).toString('base64url'), ch = createHash('sha256').update(v).digest('base64url');
  const a = await fetch(`${base}${prefix}/authorize`, { method: 'POST', redirect: 'manual', body: new URLSearchParams({ response_type: 'code', client_id: reg.client_id, redirect_uri: R, state: 's', code_challenge: ch, code_challenge_method: 'S256', scope: '', resource: '', ...fields }) });
  const loc = a.headers.get('location'); const c = loc && new URL(loc).searchParams.get('code');
  if (!c) return null;
  const t = await (await fetch(`${base}${prefix}/token`, { method: 'POST', body: new URLSearchParams({ grant_type: 'authorization_code', code: c, client_id: reg.client_id, redirect_uri: R, code_verifier: v }) })).json();
  return t.access_token || null;
}
const rpc = async (path, t, method, params) => (await (await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${t}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json()).result;
const call = async (path, t, name, args = {}) => { const r = await rpc(path, t, 'tools/call', { name, arguments: args }); return { err: r.isError, text: r.content?.[0]?.text || '', data: r.structuredContent }; };

const REP_NAMES = ['Nimesh', 'Nayan Patel', 'Savan', 'Naitik', 'Jerry', 'Keith', 'Chris', 'Ravi Kumar', 'Lynette', 'Michelle', 'Hari Patel', 'Rubin Monpara', 'Albert Lee', 'Nish Jha', 'Leith'];

console.log('Marketing (Vishva)');
const bad = await signIn('/api/rep-mcp', { access_code: 'x'.repeat(24), email: vEmail });
ok(bad === null, 'a wrong password does not sign in');
const wrongMail = await signIn('/api/rep-mcp', { access_code: vCode, email: 'someone.else@test.invalid' });
ok(wrongMail === null, 'right password with the wrong email does not sign in');
const t = await signIn('/api/rep-mcp', { access_code: vCode, email: vEmail });
ok(Boolean(t), 'signs in with email and password');
if (t) {
  const P = '/api/rep-mcp';
  const names = (await rpc(P, t, 'tools/list')).tools.map((x) => x.name).sort();
  ok(names.join() === 'account_sales,my_profile,product_cost', `offers exactly account_sales, my_profile, product_cost (have ${names.join(', ')})`);
  for (const n of ['my_sales', 'my_debtors', 'my_customers', 'my_best_sellers', 'my_action_plan', 'team_overview', 'team_attention', 'team_product_gaps', 'my_recent_orders', 'get_financial_year', 'odoo_search']) {
    const r = await call(P, t, n, { person: 'Savan', sql: 'select 1' });
    ok(r.err && /Unknown tool/.test(r.text), `${n} is refused`);
  }
  const prof = await call(P, t, 'my_profile');
  ok(!prof.err && prof.data.role === 'Marketing', 'profile says Marketing');

  const cost = await call(P, t, 'product_cost', { name: 'Musashi' });
  ok(!cost.err && cost.data.items.length > 0, `product_cost finds products (${cost.data?.items?.length})`);
  console.log('     searched:', cost.data?.searchedIn?.join(', '), '| first:', JSON.stringify(cost.data?.items?.[0]));
  ok(cost.data.searchedIn.includes('Odoo') && cost.data.searchedIn.includes('Ostendo'), 'costing searches both Odoo and Ostendo');

  for (const acct of ['CSB', 'Fresh Choice', 'Mobil']) {
    const r = await call(P, t, 'account_sales', { name: acct });
    ok(!r.err, `account_sales "${acct}" answers`);
    if (r.err) { console.error('     ', r.text.slice(0, 200)); continue; }
    const d = r.data;
    const sumAcc = d.accounts.reduce((s, a) => s + a.revenue, 0), sumMon = d.byMonth.reduce((s, m) => s + m.revenue, 0), sumSys = d.bySystem.reduce((s, x) => s + x.revenue, 0);
    console.log(`     ${acct}: total ${d.total.revenue} | ${d.accountsMatched} accounts | months ${d.byMonth.length} | products ${d.topProducts.length}`);
    ok(d.accountsMatched > 0 && d.total.revenue > 0, `${acct}: has sales`);
    if (d.accountsMatched <= 30) ok(Math.abs(sumAcc - d.total.revenue) <= d.total.revenue * 0.05, `${acct}: store list is within 5% of the product-sales total (invoice totals include discount lines): ${sumAcc.toFixed(2)} vs ${d.total.revenue}`);
    ok(near(sumMon, d.total.revenue), `${acct}: months add up to the total (${sumMon.toFixed(2)} vs ${d.total.revenue})`);
    ok(near(sumSys, d.total.revenue), `${acct}: systems add up to the total`);
    ok(!/"(rep|reps|salesperson|week|weeks|weekly)"\s*:/i.test(r.text), `${acct}: no rep, salesperson or weekly key`);
    ok(REP_NAMES.every((n) => !r.text.includes(n)), `${acct}: no rep name appears anywhere in the answer`);
    ok(d.byMonth.every((m) => /^\d{4}-\d{2}$/.test(m.month)), `${acct}: months are YYYY-MM`);
  }
  const ly = await call(P, t, 'account_sales', { name: 'CSB', fy: 2025 });
  ok(!ly.err && ly.data.period.from === '2025-04-01' && ly.data.period.to === '2026-03-31', 'a full past financial year can be asked for');
  const dr = await call(P, t, 'account_sales', { name: 'CSB', from: '2026-10-01', to: '2026-10-31' });
  ok(!dr.err && dr.data.byMonth.every((m) => m.month === '2026-10'), 'a date range limits the months');
  ok(!(await call(P, t, 'account_sales', { name: '' })).text.includes('Odoo'), 'an empty name is refused politely');
  ok((await call(P, t, 'account_sales', { name: 'CSB', from: '2026-13-01', to: '2026-10-31' })).err, 'a bad date is refused');
  const sneak = await call(P, t, 'account_sales', { name: 'CSB', rep: 'Savan', person: 'Savan', groupby: 'week', sql: 'x' });
  ok(!sneak.err && REP_NAMES.every((n) => !sneak.text.includes(n)) && !/week/i.test(Object.keys(sneak.data).join()), 'extra arguments for rep or week are ignored');
  const inj = await call(P, t, 'account_sales', { name: "x' OR 1=1 --" });
  ok(!inj.err || /No customer|Tell me which/.test(inj.text), 'an injection-style name is harmless');
  const mgmtOnRep = await fetch(`${base}/api/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${t}` }, body: '{}' });
  ok(mgmtOnRep.status === 401, 'the marketing token is refused by the management connector');
}

if (mgmtPw) {
  console.log('Management: expenses');
  const m = await signIn('/api/mcp', { password: mgmtPw });
  ok(Boolean(m), 'management signs in');
  if (m) {
    const P = '/api/mcp';
    const tools = (await rpc(P, m, 'tools/list')).tools.map((x) => x.name);
    ok(tools.includes('get_expenses'), 'get_expenses is offered');
    const sav = await call(P, m, 'get_expenses', { employee: 'Savan', category: 'food', months: 12 });
    ok(!sav.err && sav.data.total.claims === 0 && sav.data.notes.some((n) => /Savan Patel/.test(n)), "Kishan's example: Savan on food in 12 months answers plainly (no claims, and says he is an employee)");
    console.log('     ', sav.data?.notes?.join(' | '));
    const all = await call(P, m, 'get_expenses', { months: 12, lines: 0 });
    ok(!all.err, '12 months of all expenses answers');
    const d = all.data;
    const s1 = d.byEmployee.reduce((s, x) => s + x.amountInclGst, 0), s2 = d.byGroup.reduce((s, x) => s + x.amountInclGst, 0), s3 = d.byCategory.reduce((s, x) => s + x.amountInclGst, 0), s4 = d.byMonth.reduce((s, x) => s + x.amountInclGst, 0), s5 = d.byStatus.reduce((s, x) => s + x.amountInclGst, 0);
    console.log(`      total ${d.total.amountInclGst} over ${d.total.claims} claims, ${d.period.from} to ${d.period.to}`);
    ok([s1, s2, s3, s4, s5].every((x) => near(x, d.total.amountInclGst, 0.1)), 'employee, group, category, month and status breakdowns all add up to the total');
    ok(near(d.total.amountInclGst - d.total.gst, d.total.amountExclGst), 'GST and ex-GST figures agree');
    const food = await call(P, m, 'get_expenses', { category: 'food', months: 12, lines: 5 });
    ok(!food.err && food.data.byGroup.length === 1 && food.data.byGroup[0].group === 'food', 'food filter returns only the food group');
    console.log('      food (12 months):', food.data.total.amountInclGst, 'by', food.data.byEmployee.map((e) => `${e.employee} ${e.amountInclGst}`).join(' | '));
    const pooja = await call(P, m, 'get_expenses', { employee: 'Pooja', months: 12, lines: 3 });
    ok(!pooja.err && pooja.data.byEmployee.length === 1 && /Pooja/.test(pooja.data.byEmployee[0].employee), 'employee filter returns only that person');
    const txt = await call(P, m, 'get_expenses', { text: 'Savan', months: 24, lines: 5 });
    ok(!txt.err && txt.data.total.claims >= 1, 'description search finds claims that mention a person (e.g. rego entered by Pooja)');
    ok((await call(P, m, 'get_expenses', { from: '2026-02-30', to: '2026-03-01' })).err, 'a bad date is refused');
    ok((await call(P, m, 'get_expenses', { status: ['bogus'] })).err, 'a bad status is refused');
    ok((await call(P, m, 'get_expenses', { company: 'mars' })).err, 'a bad company is refused');
    const repOnMgmt = await signIn('/api/rep-mcp', { access_code: vCode, email: vEmail });
    const r2 = await fetch(`${base}/api/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${repOnMgmt}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_expenses', arguments: {} } }) });
    ok(r2.status === 401, 'expenses are unreachable with a marketing (rep connector) token');
  }
}
console.log(`\n${pass} passed, ${fail} failed`);
