/**
 * End-to-end test of (1) the Marketing login on the rep connector and (2) the expense tool on the management
 * connector, against a running server with real Odoo/Ostendo data (local or live).
 *
 *   node scripts/marketing-e2e.mjs <base url> <vishva password> <vishva email> <management password>
 *
 * Marketing must offer exactly the nine business development tools (profile, product cost, cost basket, account sales, top groups, group accounts, new customers, lapsed accounts, top products); refuse every rep/team tool; return account
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
  const WANT = 'account_sales,cost_basket,group_accounts,lapsed_accounts,my_profile,new_customers,product_cost,system_overview,top_groups,top_products';
  ok(names.join() === WANT, `offers exactly the ten business development tools (have ${names.join(', ')})`);
  for (const n of ['my_sales', 'my_debtors', 'my_customers', 'my_best_sellers', 'my_action_plan', 'team_overview', 'team_attention', 'team_product_gaps', 'my_recent_orders', 'get_financial_year', 'odoo_search']) {
    const r = await call(P, t, n, { person: 'Savan', sql: 'select 1' });
    ok(r.err && /Unknown tool/.test(r.text), `${n} is refused`);
  }
  const prof = await call(P, t, 'my_profile');
  ok(!prof.err && prof.data.role === 'Marketing', 'profile says Marketing');
  const ptxt = JSON.stringify(prof.data);
  ok(prof.data.systems.length === 2 && /Dutch Rusk/.test(ptxt) && /Odoo/.test(ptxt) && /Ostendo/.test(ptxt) && /Worthy Products South/.test(ptxt) && prof.data.terms.banner && prof.data.terms.channel, 'the profile explains the two systems, their other names, and the terms group, banner, channel');

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

  // ── business development tools: both systems, totals that add up, no rep or weekly information ──
  const FULL_NAMES = ['Nimesh Darjee', 'Nayan Patel', 'Savan Patel', 'Naitik Trivedi', 'Hari Patel', 'Rubin Monpara', 'Albert Lee', 'Nish Jha', 'Ravi Kumar'];
  const clean = (r, label) => {
    ok(!/"(rep|reps|salesperson|week|weeks|weekly|person|members)"\s*:/i.test(r.text), `${label}: no rep, salesperson or weekly key`);
    ok(FULL_NAMES.every((n) => !r.text.includes(n)), `${label}: no rep name anywhere`);
  };
  const North = 'Worthy Products North (Odoo)', South = 'Worthy Products South (Dutch Rusk, Ostendo)';
  const sum = (a, k) => a.reduce((x, y) => x + (y[k] || 0), 0);

  const tg = await call(P, t, 'top_groups', { by: 'group', limit: 100 });
  ok(!tg.err, 'top_groups (group) answers');
  if (!tg.err) {
    const d = tg.data; clean(tg, 'top_groups');
    console.log('     top group:', d.groups[0].group, d.groups[0].revenue, '| external total', d.totalExternalRevenue, '| groups', d.of);
    ok(d.groups.every((g, i, a) => i === 0 || a[i - 1].revenue >= g.revenue), 'groups are ranked by revenue');
    ok(d.groups.some((g) => g.systems.includes(North)) && d.groups.some((g) => g.systems.includes(South)), 'groups come from BOTH Worthy Products North (Odoo) and South (Ostendo)');
    ok(!d.groups.some((g) => /^worthy\b|dutch rusk/i.test(g.group)), 'intercompany and staff accounts are not ranked');
    ok(sum(d.groups, 'shareOfRevenuePct') <= 100.5, 'shares add up to 100% or less');
  }
  for (const by of ['channel', 'banner']) {
    const r = await call(P, t, 'top_groups', { by, limit: 100 });
    ok(!r.err, `top_groups by ${by} answers`);
    if (r.err) continue;
    clean(r, `top_groups ${by}`);
    const covered = sum(r.data.groups, 'revenue') + (r.data.noBannerOrGroupRecorded?.revenue || 0);
    ok(Math.abs(covered - r.data.totalExternalRevenue) <= 1, `${by}: ranked revenue plus the unassigned adds up to the total (${covered.toFixed(2)} vs ${r.data.totalExternalRevenue})`);
    if (by === 'banner') ok(r.data.groups.some((g) => g.banner === 'Mobil' && g.systems.includes(North) && g.systems.includes(South)), 'Mobil is one banner across both systems');
  }
  const lyr = await call(P, t, 'top_groups', { by: 'banner', fy: 2025, limit: 5 });
  ok(!lyr.err && /FY25/.test(lyr.data.period), 'a past financial year can be asked for');
  ok((await call(P, t, 'top_groups', { by: 'rep' })).err, 'ranking by rep is refused');
  ok((await call(P, t, 'top_groups', { months: 99 })).err, 'a bad month count is refused');
  const one = await call(P, t, 'top_groups', { by: 'group', system: 'south', limit: 3 });
  ok(!one.err && one.data.groups.every((g) => g.systems.length === 1 && g.systems[0] === South), 'the system filter limits to South');

  // every name people use for the two systems resolves to the right one
  for (const [alias, want] of [['Dutch Rusk', South], ['dutch rusk', South], ['ostendo', South], ['Ostendo', South], ['Worthy Products South', South], ['South', South], ['odoo', North], ['Odoo', North], ['Worthy Products North', North], ['north', North]]) {
    const r = await call(P, t, 'top_groups', { by: 'group', system: alias, limit: 3 });
    ok(!r.err && r.data.groups.length > 0 && r.data.groups.every((g) => g.systems.length === 1 && g.systems[0] === want), `system "${alias}" means ${want}`);
  }
  const bothNames = await call(P, t, 'top_groups', { by: 'group', system: 'Worthy Products', limit: 100 });
  ok(!bothNames.err && bothNames.data.groups.some((g) => g.systems.includes(North)) && bothNames.data.groups.some((g) => g.systems.includes(South)), 'plain "Worthy Products" shows both systems rather than picking one');
  ok((await call(P, t, 'top_groups', { system: 'Oceania' })).err, 'an unknown system is refused with a plain message');
  const sOnly = await call(P, t, 'new_customers', { days: 90, system: 'Dutch Rusk' });
  ok(!sOnly.err && sOnly.data.customers.every((c) => c.system === South), 'new_customers accepts "Dutch Rusk"');
  const lOnly = await call(P, t, 'lapsed_accounts', { system: 'odoo' });
  ok(!lOnly.err && lOnly.data.accounts.every((c) => c.system === North), 'lapsed_accounts accepts "odoo"');

  const so = await call(P, t, 'system_overview', {});
  ok(!so.err, 'system_overview answers');
  if (!so.err) {
    const d = so.data; clean(so, 'system_overview');
    console.log('     overview:', d.systems.map((x) => x.system + ' ' + x.revenue + ' (' + x.changeVsLastYearPct + '%)').join(' | '));
    ok(d.systems.length === 2 && d.systems[0].system === North && d.systems[1].system === South, 'the overview shows North (Odoo) and South (Dutch Rusk, Ostendo) side by side');
    ok(Math.abs(d.combinedRevenue - tg.data.totalExternalRevenue) <= 1, 'combined revenue equals the external total in top_groups');
    ok(d.systems.every((x) => x.revenue > 0 && x.accountsWithSales > 0 && x.topGroups.length > 0 && x.activeAccounts <= x.accountsWithSales), 'each system has revenue, accounts and top groups, and active never exceeds accounts');
    ok(Math.abs(d.systems.reduce((s, x) => s + x.shareOfCombinedRevenuePct, 0) - 100) <= 0.2, 'shares of combined revenue add up to 100%');
  }

  const ga = await call(P, t, 'group_accounts', { name: 'Mobil', limit: 150 });
  ok(!ga.err, 'group_accounts "Mobil" answers');
  if (!ga.err) {
    const d = ga.data; clean(ga, 'group_accounts');
    const st = Object.values(d.totals.byStatus).reduce((x, y) => x + y, 0);
    console.log('     Mobil:', d.totals.accountsWithSales, 'accounts with sales, revenue', d.totals.revenue, 'avg per active', d.totals.averageRevenuePerActiveAccount, JSON.stringify(d.totals.byStatus));
    ok(Math.abs(sum(d.accounts, 'revenue') - d.totals.revenue) <= 0.5, 'Mobil accounts add up to the Mobil total');
    ok(st === d.totals.accountsWithSales, 'status counts add up to the accounts with sales');
    ok(d.accounts.some((a) => a.system === North) && d.accounts.some((a) => a.system === South), 'Mobil includes North and South accounts');
    ok(d.accounts.every((a) => ['Active', 'At risk (45-90 days quiet)', 'Lapsed (over 90 days quiet)', 'No invoices'].includes(a.status)), 'every account has a status');
  }
  ok((await call(P, t, 'group_accounts', { name: '' })).err, 'group_accounts with no name is refused');
  const nomatch = await call(P, t, 'group_accounts', { name: 'qqqzzzxxx' });
  ok(!nomatch.err && nomatch.data.matched.accounts === 0 && nomatch.data.notes.some((n) => /No customer/.test(n)), 'an unknown group says so plainly');

  const nc = await call(P, t, 'new_customers', { days: 90 });
  ok(!nc.err, 'new_customers answers');
  if (!nc.err) {
    const d = nc.data; clean(nc, 'new_customers');
    console.log('     new customers (90 days):', d.newCustomersWithSales, 'revenue', d.revenueFromThem);
    ok(d.customers.every((c) => c.joined >= d.window.from && c.revenueSinceJoining > 0), 'every new customer joined inside the window and has sales');
    ok(d.newCustomersWithSales > 0 && d.customers.some((c) => c.system === North) && d.customers.some((c) => c.system === South), 'new customers appear from both systems');
  }
  ok((await call(P, t, 'new_customers', { days: 2 })).err, 'a too-short window is refused');

  const lp = await call(P, t, 'lapsed_accounts', {});
  ok(!lp.err, 'lapsed_accounts answers');
  if (!lp.err) {
    const d = lp.data; clean(lp, 'lapsed_accounts');
    console.log('     lapsed:', d.accountsFound, 'accounts, value at stake', d.valueAtStake);
    ok(d.accounts.every((a) => a.daysQuiet > 90), 'every lapsed account has been quiet more than 90 days');
    ok(d.accounts.every((a, i, arr) => i === 0 || arr[i - 1].spendInTheYearBeforeTheirLastOrder >= a.spendInTheYearBeforeTheirLastOrder), 'ranked by past spend');
    ok(d.accounts.some((a) => a.system === North) && d.accounts.some((a) => a.system === South), 'lapsed accounts come from both systems');
  }
  ok((await call(P, t, 'lapsed_accounts', { quietDays: 5 })).err, 'a bad quiet period is refused');

  const tp = await call(P, t, 'top_products', { limit: 20 });
  ok(!tp.err, 'top_products answers');
  if (!tp.err) {
    const d = tp.data; clean(tp, 'top_products');
    ok(d.products.every((p, i, a) => i === 0 || a[i - 1].revenue >= p.revenue), 'products ranked by revenue');
    ok(d.products.some((p) => p.system === North) && d.products.some((p) => p.system === South), 'products come from both systems');
    ok(d.products.every((p) => !p.units || Math.abs(p.averagePricePerUnit - p.revenue / p.units) <= 0.02), 'average price is revenue over units');
  }
  const tpf = await call(P, t, 'top_products', { name: 'coconut water', limit: 5 });
  ok(!tpf.err && tpf.data.products.length > 0 && tpf.data.products.every((p) => /coco/i.test(p.product)), 'a product name filter works');

  const cb = await call(P, t, 'cost_basket', { items: [{ name: 'B0008', quantity: 20 }, { name: 'C0422', quantity: 10, system: 'north' }, { name: 'C0422', quantity: 10, system: 'south' }, { name: 'C0422', quantity: 1 }, { name: 'zzzznotfound', quantity: 2 }], targetMarginPct: 20 });
  ok(!cb.err, 'cost_basket answers');
  if (!cb.err) {
    const d = cb.data; clean(cb, 'cost_basket');
    const costed = d.lines.filter((l) => l.status === 'costed');
    ok(costed.length === 3 && d.complete === false, 'three lines costed, the unclear and unknown ones are flagged');
    ok(costed.every((l) => Math.abs(l.lineCost - l.unitCost * l.quantity) <= 0.02), 'line cost is unit cost times quantity');
    ok(costed.every((l) => Math.abs(l.suggestedPricePerUnit - l.unitCost / 0.8) <= 0.02), 'price for 20% margin is cost divided by 0.8');
    ok(Math.abs(d.totals.totalCost - sum(costed, 'lineCost')) <= 0.02 && Math.abs(d.totals.grossProfit - d.totals.suggestedPrice * 0.2) <= 0.05, 'totals and gross profit add up');
    ok(d.lines.some((l) => l.status === 'choose one' && l.candidates.length >= 2) && d.lines.some((l) => l.status === 'not found'), 'an ambiguous code asks which one; an unknown product says not found');
    const north = costed.find((l) => l.system === North && l.code === 'C0422'), south = costed.find((l) => l.system === South && l.code === 'C0422');
    ok(north && south && north.unitCost !== south.unitCost, 'the same code is costed separately in North and South');
  }
  ok((await call(P, t, 'cost_basket', { items: [{ name: 'B0008', quantity: -3 }] })).err, 'a negative quantity is refused');
  ok((await call(P, t, 'cost_basket', { items: [{ name: 'B0008', quantity: 1 }], targetMarginPct: 95 })).err, 'a 95% margin target is refused');
  ok((await call(P, t, 'cost_basket', { items: [] })).err, 'an empty basket is refused');
  const pc = await call(P, t, 'product_cost', { name: 'RUSS4' });
  ok(!pc.err && pc.data.items.some((i) => i.code === 'RUSS4'), 'product_cost finds a product by its code');
  ok(pc.data.items.every((i) => i.system === North || i.system === South), 'every product cost says which system it came from, by full name');
  const init = await rpc(P, t, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } });
  ok(/Dutch Rusk/.test(init.instructions) && /Odoo/.test(init.instructions) && /Ostendo/.test(init.instructions) && /Worthy Products South/.test(init.instructions), 'the connector tells Claude what Dutch Rusk, Worthy Products South, Odoo and Ostendo mean');
  ok(/never add North and South together without saying/i.test(init.instructions) || /Never add North and South/.test(init.instructions), 'the instructions forbid mixing the two systems up');

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

if (mgmtPw && t) {
  console.log('Marketing totals against the dashboard');
  const lg = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: mgmtPw }) });
  const cookie = (lg.headers.get('set-cookie') || '').split(';')[0];
  const dash = async (p) => (await fetch(base + p, { headers: { cookie } })).json();
  const [nf, sf] = await Promise.all([dash('/api/odoo/fy?fy=2026&fresh=1'), dash('/api/ostendo/fy?fy=2026&fresh=1')]);
  const tg2 = (await call('/api/rep-mcp', t, 'top_groups', { limit: 1 })).data;
  const dashTotal = nf.totals.revenue + sf.totals.revenue;
  console.log('     BD external total', tg2.totalExternalRevenue, '| dashboard North + South', dashTotal.toFixed(2));
  // The gap between the dashboard and the external total must be exactly our own intercompany and staff accounts (found by name, both systems).
  const own = async (name) => (await call('/api/rep-mcp', t, 'account_sales', { name })).data?.total?.revenue || 0;
  const internal = (await own('worthy')) + (await own('dutch rusk')) - (await own('worthy dutch rusk')) + (await own('price check'));
  const gap = dashTotal - tg2.totalExternalRevenue;
  console.log('     gap', gap.toFixed(2), '| our own intercompany and staff accounts', internal.toFixed(2));
  // The business development figures are kept for up to 30 minutes, so invoices raised since can differ by a little; 0.1% of sales is far below the $1.7m being explained.
  ok(Math.abs(gap - internal) <= dashTotal * 0.001, 'the gap to the dashboard is our own intercompany and staff accounts (within 0.1% of sales, the 30 minute cache)');
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
    const gaps = await call(P, m, 'get_south_cost_gaps', { days: 45 });
    ok(!gaps.err && tools.includes('get_south_cost_gaps'), 'get_south_cost_gaps answers for management');
    if (!gaps.err) {
      const g = gaps.data;
      console.log('     recosted', g.recosted.lines, 'lines', g.recosted.revenue, '| uncosted', g.uncosted.lines, 'lines', g.uncosted.revenue, '| top item:', JSON.stringify(g.items[0]));
      ok(g.items.length > 0 && g.items.every((i) => ['recosted', 'uncosted'].includes(i.status)), 'items are listed as recosted or uncosted');
      ok(near(g.items.filter((i) => i.status === 'recosted').reduce((s, i) => s + i.revenue, 0), g.recosted.revenue, 0.5) || g.items.length >= 25, 'recosted items add up to the recosted total');
      ok(g.customers.length > 0, 'customers involved are named for management');
    }
    const pub = await (await fetch(base + '/api/cron/cost-health?days=45')).json();
    ok(pub.window && !('items' in pub) && !('customers' in pub) && !JSON.stringify(pub).match(/Night n Day|RUSS|nippys|Foodstores/i), 'the public daily check returns totals only, no names');
    const repOnMgmt = await signIn('/api/rep-mcp', { access_code: vCode, email: vEmail });
    const r2 = await fetch(`${base}/api/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${repOnMgmt}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_expenses', arguments: {} } }) });
    ok(r2.status === 401, 'expenses are unreachable with a marketing (rep connector) token');
  }
}
console.log(`\n${pass} passed, ${fail} failed`);
