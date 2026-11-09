/**
 * Leak and token tests for the rep-only connector. No network, no Odoo/Ostendo:
 * it feeds realistic multi-rep payloads through the same projection functions the
 * live tools use and asserts that nothing but the signed-in rep's own data comes out.
 *
 *   node scripts/rep-leak-test.mjs
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

process.env.REP_AUTH_SECRET = randomBytes(24).toString('hex');
const { REPS, repForCode, currentVer, hashCode, repByKey, principalByKey, resolvePerson } = await import('../lib/repAccess.js');
const oauth = await import('../lib/repOauth.js');
const { projectSales, projectDebtors, guard, guardTeam } = await import('../lib/repProject.js');
const { projectBestSellers, projectCustomers, projectRecent, targetProgress } = await import('../lib/repInsights.js');
const { buildActionPlan } = await import('../lib/repPlan.js');

let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log(`  ok  ${name}`); } catch (e) { console.error(`FAIL  ${name}\n      ${e.message}`); process.exitCode = 1; } };

// ── Realistic company payloads: every rep, "Direct", totals, top customers ──────────
const money = (n) => ({ revenue: n, cost: n * 0.8, grossProfit: n * 0.2, marginPct: 20, costCoverage: 99, invoices: 10, credits: 1, creditValue: 5, discounts: 1, aov: n / 10, netSales: n });
const repRow = (name, n) => ({
  name, ...money(n), growthPct: 3,
  months: [{ key: '2026-10', label: 'Oct', started: true, ...money(n / 2) }],
  weeks: [{ monthKey: '2026-10', week: 4, ...money(n / 4) }],
});
const NORTH_NAMES = ['Nimesh Darjee', 'Nayan Patel', 'Savan Patel', 'Naitik Trivedi', 'Hari Patel', 'Rubin Monpara', 'Direct'];
const SOUTH_NAMES = ['Jerry', 'Keith', 'Chris', 'Ravi Kumar', 'Lynette', 'Michelle', 'Leith', 'Christchurch Office / Online'];
const company = (names) => ({
  asOfNZ: '2026-10-28', range: { start: '2026-04-01', end: '2026-10-28' },
  totals: { revenue: 99999999 }, customers: [{ customer: 'TOP CUSTOMER' }],
  weeks: [{ monthKey: '2026-10', week: 4, dateRange: '19-25 Oct' }],
  reps: names.map((n, i) => repRow(n, 1000000 + i * 111111)),
});
const debtors = (names) => ({
  asOf: '2026-10-28', basis: 'Open invoices', totals: { outstanding: 5 },
  customers: names.map((n, i) => ({ id: `c${i}`, name: `Shop ${i} for ${n.replace(/\W/g, '')}`, rep: n, total: 100 + i, overdue: 10 + i, current: 90, d1to30: 10 + i, d31to60: 0, d61to90: 0, over90: 0, oldestDays: 12, documents: 2, overdueDocuments: 1 })),
  invoices: names.flatMap((n, i) => [{ c: `c${i}`, doc: `INV-${i}`, inv: '2026-10-01', due: '2026-10-15', days: 13, amt: 100 + i, kind: 'Invoice' }]),
  reps: names.map((n) => ({ rep: n, total: 1 })),
});

console.log('Projection: each rep only ever gets their own rows');
for (const rep of REPS) {
  const names = rep.system === 'north' ? NORTH_NAMES : SOUTH_NAMES;
  const others = names.filter((n) => n !== rep.label);
  test(`${rep.label}: sales`, () => {
    const out = projectSales(company(names), rep, 2026);
    guard(out, rep);
    const text = JSON.stringify(out);
    assert.equal(out.rep, rep.label);
    assert.ok(out.year && out.year.revenue > 0, 'has own year');
    for (const o of others) assert.ok(!text.includes(o), `leaked name ${o}`);
    for (const bad of ['Direct', 'TOP CUSTOMER', '99999999', '"totals"', '"cost"']) assert.ok(!text.includes(bad), `leaked ${bad}`);
  });
  test(`${rep.label}: debtors`, () => {
    const out = projectDebtors(debtors(names), rep);
    guard(out, rep);
    const text = JSON.stringify(out);
    assert.equal(out.customers.length, 1);
    assert.equal(out.invoices.length, 1);
    assert.equal(out.customers[0].id, out.invoices[0].c);
    for (const o of others) assert.ok(!text.includes(o.replace(/\W/g, '')) || o === rep.label, `leaked customer of ${o}`);
    assert.ok(!text.includes('"totals"') && !text.includes('"reps"'));
  });
}

test('a rep with no row gets an empty answer, never a neighbour', () => {
  const rep = repByKey('jerry');
  const out = projectSales({ ...company(['Keith', 'Chris']) }, rep, 2026);
  assert.equal(out.year, null);
  assert.deepEqual(out.months, []);
  assert.ok(!JSON.stringify(out).includes('Keith'));
});
test('similar names do not match (Savan Patel vs Nayan Patel)', () => {
  const out = projectSales(company(['Nayan Patel', 'Savan Patel']), repByKey('nayan'), 2026);
  assert.equal(out.rep, 'Nayan Patel');
  assert.ok(!JSON.stringify(out).includes('Savan'));
});

console.log('Guard: fails closed');
test('foreign rep field is blocked', () => assert.throws(() => guard({ customers: [{ rep: 'Keith' }] }, repByKey('jerry')), /another rep/));
test('company fields are blocked', () => {
  for (const k of ['totals', 'reps', 'atRisk']) assert.throws(() => guard({ [k]: [] }, repByKey('jerry')), /company field/);
});

console.log('Access codes (team leads only)');
const salt = 's1';
process.env.REP_ACCESS = JSON.stringify({
  michelle: { salt, hash: hashCode('M'.repeat(24), salt), ver: 2 },
  jerry: { salt, hash: hashCode('J'.repeat(24), salt), ver: 1 },
  savan: { salt, hash: hashCode('S'.repeat(24), salt), ver: 1 },
  lead1: { salt, hash: hashCode('L'.repeat(24), salt), ver: 1 },
});
test('a lead code names the lead and version', () => {
  const hit = repForCode('M'.repeat(24));
  assert.equal(hit.rep.key, 'michelle'); assert.equal(hit.ver, 2);
  assert.deepEqual(hit.rep.people.map((p) => p.key).sort(), ['chris', 'lynette', 'michelle', 'ravi']);
});
test('when an email is on file both email and password are needed', () => {
  const keep = process.env.REP_ACCESS;
  process.env.REP_ACCESS = JSON.stringify({ michelle: { salt, hash: hashCode('M'.repeat(24), salt), ver: 1, email: 'Michelle@Worthy.test' } });
  assert.equal(repForCode('M'.repeat(24), 'michelle@worthy.test').rep.key, 'michelle');
  for (const e of ['', undefined, 'jerry@worthy.test', 'michelle@worthy.test.evil']) assert.equal(repForCode('M'.repeat(24), e), null);
  assert.equal(repForCode('x'.repeat(24), 'michelle@worthy.test'), null);
  process.env.REP_ACCESS = keep;
});
test('wrong, short, empty and unknown codes are refused', () => {
  for (const c of ['x'.repeat(24), 'M'.repeat(23), '', null, undefined, 'M'.repeat(24) + 'x']) assert.equal(repForCode(c), null);
});
test('the other nine reps cannot sign in even with a valid entry', () => {
  for (const c of ['J', 'S']) assert.equal(repForCode(c.repeat(24)), null);
  for (const k of ['jerry', 'savan', 'keith', 'chris', 'ravi', 'lynette', 'nimesh', 'nayan', 'naitik']) assert.equal(currentVer(k), 0, k);
});
test('Team 1 lead signs in, sees exactly the six Team 1 people and none of Team 2', () => {
  const hit = repForCode('L'.repeat(24));
  assert.equal(hit.rep.key, 'lead1'); assert.equal(hit.rep.self, null);
  assert.deepEqual(hit.rep.people.map((p) => p.key).sort(), ['jerry', 'keith', 'naitik', 'nayan', 'nimesh', 'savan']);
  for (const q of ['Michelle', 'Chris', 'Ravi', 'Lynette', 'Leith']) assert.throws(() => resolvePerson(hit.rep, q), /not on your team/, q);
  assert.equal(hit.rep.system, 'mixed');
});
test('the test lead only exists when REP_ALLOW_TEST_LEAD=1', () => {
  assert.equal(principalByKey('testlead'), null);
  process.env.REP_ALLOW_TEST_LEAD = '1';
  assert.ok(principalByKey('testlead')); delete process.env.REP_ALLOW_TEST_LEAD;
  assert.equal(principalByKey('testlead'), null);
});
test('version 0 means off, a lead with an entry works', () => {
  assert.equal(currentVer('michelle'), 2);
  delete process.env.REP_ACCESS; assert.equal(currentVer('michelle'), 0);
  process.env.REP_ACCESS = JSON.stringify({ michelle: { salt, hash: hashCode('M'.repeat(24), salt), ver: 2 } });
});

console.log('Team wall');
const michelle = principalByKey('michelle');
test('team is exactly Michelle, Chris, Ravi Kumar, Lynette', () => {
  assert.deepEqual(michelle.people.map((p) => p.label), ['Michelle', 'Chris', 'Ravi Kumar', 'Lynette']);
});
test('a lead resolves herself and her own team, by first name', () => {
  assert.equal(resolvePerson(michelle, '').key, 'michelle');
  for (const [q, k] of [['Chris', 'chris'], ['ravi', 'ravi'], ['Ravi Kumar', 'ravi'], ['lyn', 'lynette'], ['michelle', 'michelle']]) assert.equal(resolvePerson(michelle, q).key, k);
});
test('anyone outside the team is refused (Team 1 reps, North reps, Leith, company, odd input)', () => {
  for (const q of ['Jerry', 'keith', 'Savan', 'Nimesh Darjee', 'naitik', 'Leith', 'everyone', 'all', 'company', 'Direct', '*', '.*', 'a', 'Chris;Jerry', ' ']) {
    if (q.trim() === '') continue;
    assert.throws(() => resolvePerson(michelle, q), /not on your team|more than one/, q);
  }
});
test('a lead with no sales of her own must name someone', () => {
  const t = { ...michelle, self: null, people: michelle.members };
  assert.throws(() => resolvePerson(t, ''), /Say which team member/);
});
test('guardTeam allows only team labels and blocks company keys', () => {
  guardTeam({ members: [{ person: 'Chris' }, { person: 'Lynette' }], teamTotal: { revenue: 1 } }, michelle.people);
  assert.throws(() => guardTeam({ members: [{ person: 'Jerry' }] }, michelle.people), /another rep/);
  assert.throws(() => guardTeam({ members: [{ rep: 'Keith' }] }, michelle.people), /another rep/);
  assert.throws(() => guardTeam({ totals: {} }, michelle.people), /company field/);
});
test('a mixed North and South test team resolves both systems', () => {
  process.env.REP_ALLOW_TEST_LEAD = '1';
  const t = principalByKey('testlead');
  assert.equal(t.system, 'mixed'); assert.equal(resolvePerson(t, 'jerry').system, 'south'); assert.equal(resolvePerson(t, 'nimesh').system, 'north');
  assert.throws(() => resolvePerson(t, 'chris'), /not on your team/);
  delete process.env.REP_ALLOW_TEST_LEAD;
});


console.log('Accuracy guards');
{
  const { productMargins, customerMargins } = await import('../lib/repAnalysis.js');
  const rows = [
    { customer: 'A', customerKey: 'a', productKey: 'PODS', product: 'Pods', units: 3, revenue: 16, mRev: 16, mCost: 14, ucMin: 4.6, ucMax: 4.6 },
    { customer: 'B', customerKey: 'b', productKey: 'PODS', product: 'Pods', units: 20, revenue: 782, mRev: 782, mCost: 1365, ucMin: 68.25, ucMax: 68.25 },
    { customer: 'A', customerKey: 'a', productKey: 'COLA', product: 'Cola', units: 10, revenue: 100, mRev: 100, mCost: 80, ucMin: 8, ucMax: 8 },
  ];
  test('a product costed in different units (4.6 vs 68.25) gets no margin, only a note', () => {
    const pm = productMargins(rows).get('PODS');
    assert.equal(pm.marginPct, null); assert.equal(pm.grossProfit, null); assert.ok(pm.marginNote);
    assert.equal(productMargins(rows).get('COLA').marginPct, 20);
  });
  test('customer margins are not tripped by different products having different costs', () => {
    assert.ok(customerMargins(rows).get('a').marginPct !== null);
  });
  test('normal cost drift (under 3x) still gives a margin', () => {
    const r = [{ customer: 'A', customerKey: 'a', productKey: 'X', product: 'X', units: 1, revenue: 100, mRev: 100, mCost: 80, ucMin: 7, ucMax: 9 }];
    assert.equal(productMargins(r).get('X').marginPct, 20);
  });
}

console.log('Tokens');
test('a good token verifies and carries the rep and version', () => {
  const t = oauth.issueAccessToken({ sub: 'jerry', ver: 2 });
  const c = oauth.checkAccessToken(t);
  assert.equal(c.sub, 'jerry'); assert.equal(c.ver, 2);
});
test('tampered token is refused', () => {
  const t = oauth.issueAccessToken({ sub: 'jerry', ver: 2 });
  const [p, s] = t.split('.');
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, 'base64url')), sub: 'savan' })).toString('base64url');
  assert.equal(oauth.checkAccessToken(`${forged}.${s}`), null);
});
test('a token signed with another secret (e.g. management) is refused', async () => {
  const { createHmac } = await import('node:crypto');
  const p = Buffer.from(JSON.stringify({ t: 'raccess', sub: 'jerry', ver: 2, exp: Date.now() + 1e6 })).toString('base64url');
  const s = createHmac('sha256', 'Worthy-Insights-2026').update(p).digest('base64url');
  assert.equal(oauth.checkAccessToken(`${p}.${s}`), null);
});
test('a management-style token type is refused', () => {
  const t = oauth.sign({ t: 'access', role: 'mgmt', exp: Date.now() + 1e6 });
  assert.equal(oauth.checkAccessToken(t), null);
});
test('expired token is refused', () => {
  const t = oauth.sign({ t: 'raccess', sub: 'jerry', ver: 2, exp: Date.now() - 1 });
  assert.equal(oauth.checkAccessToken(t), null);
});
test('a code cannot be used as an access token, nor an access token as a code', () => {
  assert.equal(oauth.checkAccessToken(oauth.issueCode({ sub: 'jerry', ver: 2 })), null);
  assert.equal(oauth.redeemCode(oauth.issueAccessToken({ sub: 'jerry', ver: 2 })), null);
});
test('PKCE', () => {
  const v = 'a'.repeat(50);
  const ch = oauth.pkceVerify; // sanity: wrong verifier fails
  assert.equal(ch(v, 'nope'), false);
});
test('only claude.ai / ChatGPT / OpenAI https redirects are allowed', () => {
  for (const ok of ['https://claude.ai/api/mcp/auth_callback', 'https://chatgpt.com/connector_platform_oauth_redirect', 'https://platform.openai.com/apps-manage/oauth'])
    assert.equal(oauth.redirectAllowed(ok), true, ok);
  for (const bad of ['http://claude.ai/x', 'https://evil.com/claude.ai', 'https://claude.ai.evil.com/x', 'https://evilclaude.ai/x', 'javascript:alert(1)', 'https://localhost/x'])
    assert.equal(oauth.redirectAllowed(bad), false, bad);
});
test('with no REP_AUTH_SECRET nothing validates', () => {
  const keep = process.env.REP_AUTH_SECRET; delete process.env.REP_AUTH_SECRET;
  try { assert.equal(oauth.checkAccessToken('a.b'), null); assert.throws(() => oauth.issueAccessToken({ sub: 'jerry', ver: 1 })); }
  finally { process.env.REP_AUTH_SECRET = keep; }
});


console.log('Best sellers, customers, recent orders, target pace');
const meta = { period: { from: '2026-04-01', to: '2026-10-28' }, asOf: '2026-10-28', fyStart: '2026-04-01', windows: {}, basis: 'test' };
test('best sellers rank by revenue, show share and trend, and hold no other rep', () => {
  const rows = [
    { code: 'A1', name: 'Alpha', units: 10, revenue: 5000, rev90: 3000, prev90: 1000 },
    { code: 'B2', name: 'Beta', units: 50, revenue: 9000, rev90: 1000, prev90: 4000 },
    { code: 'C3', name: 'Gamma', units: 1, revenue: 100, rev90: 0, prev90: 0 },
  ];
  const out = projectBestSellers(rows, repByKey('jerry'), meta);
  guard(out, repByKey('jerry'));
  assert.equal(out.bestSellers[0].product, 'Beta');
  assert.equal(out.bestSellers[0].shareOfYourSalesPct, Math.round(9000 / 14100 * 1000) / 10);
  assert.equal(out.growingProducts[0].product, 'Alpha');
  assert.equal(out.slowingProducts[0].product, 'Beta');
  assert.ok(!JSON.stringify(out).includes('"products"'));
});
test('customers: top, quiet, slipping, growing and new come from the rep own invoices', () => {
  const inv = [
    { customer: 'Big Shop', date: '2026-10-20', amount: 8000 }, { customer: 'Big Shop', date: '2026-08-01', amount: 7000 },
    { customer: 'Quiet Dairy', date: '2026-07-01', amount: 3000 }, { customer: 'Quiet Dairy', date: '2026-05-10', amount: 2500 },
    { customer: 'Slipping Cafe', date: '2026-10-10', amount: 500 }, { customer: 'Slipping Cafe', date: '2026-06-20', amount: 4000 },
    { customer: 'New Store', date: '2026-10-01', amount: 2500 },
    { customer: 'Last Year Only', date: '2025-12-01', amount: 900 },
    { customer: 'Big Shop', date: '2026-09-01', amount: -200, credit: true },
  ];
  const out = projectCustomers(inv, repByKey('keith'), meta);
  guard(out, repByKey('keith'));
  assert.equal(out.topCustomers[0].customer, 'Big Shop');
  assert.equal(out.topCustomers[0].revenueThisYear, 14800);
  assert.equal(out.topCustomers[0].ordersThisYear, 2, 'credit notes are not orders');
  assert.ok(out.quietCustomers.some((c) => c.customer === 'Quiet Dairy'));
  assert.ok(out.quietCustomers.some((c) => c.customer === 'Last Year Only'));
  assert.ok(out.slippingCustomers.some((c) => c.customer === 'Slipping Cafe'));
  assert.ok(out.newOrReturningCustomers.some((c) => c.customer === 'New Store'));
  assert.ok(!out.newOrReturningCustomers.some((c) => c.customer === 'Last Year Only'));
});
test('recent orders: newest first, credit notes flagged, capped at 30', () => {
  const inv = Array.from({ length: 40 }, (_, i) => ({ customer: `C${i}`, date: `2026-10-${String(1 + (i % 28)).padStart(2, '0')}`, amount: 10 + i, credit: i % 10 === 0, number: `N${i}` }));
  const out = projectRecent(inv, repByKey('chris'), meta);
  assert.equal(out.recent.length, 30);
  assert.ok(out.recent[0].date >= out.recent[29].date);
  assert.ok(out.recent.some((r) => r.type === 'Credit note'));
});
test('target pace: budget to date, ahead or behind, and what is needed per day', () => {
  const months = [{ key: '2026-09', revenue: 90000 }, { key: '2026-10', revenue: 150000 }];
  const t = { monthlyBudget: { '2026-09': 100000, '2026-10': 200000, '2026-11': 300000 } };
  const p = targetProgress(t, months, '2026-10-20');
  assert.equal(p.thisMonth.budget, 200000);
  assert.equal(p.thisMonth.daysLeftInMonth, 11);
  assert.equal(p.thisMonth.stillToSell, 50000);
  // 21 to 31 Oct 2026 has 7 working days (Wed 21 to Fri 23, Mon 26 to Fri 30)... counted from the 21st: 21,22,23,26,27,28,29,30 = 8
  assert.equal(p.thisMonth.tradingDaysLeft, 8);
  assert.equal(p.thisMonth.neededPerRemainingTradingDay, Math.round(50000 / 8 * 100) / 100);
  assert.equal(p.yearBudgetToDate, Math.round((100000 + 200000 * 20 / 31) * 100) / 100);
  assert.equal(p.actualYearToDate, 240000);
  assert.equal(targetProgress(null, months, '2026-10-20'), null);
});
test('empty input gives a clear note, not an error', () => {
  assert.ok(projectBestSellers([], repByKey('jerry'), meta).note);
  assert.ok(projectCustomers([], repByKey('jerry'), meta).note);
  assert.ok(projectRecent([], repByKey('jerry'), meta).note);
});


console.log('Action plan: every suggestion carries its evidence');
test('plan is built only from the rep own figures and every item shows exact numbers', () => {
  const rep = repByKey('keith');
  const sales = { asOf: '2026-10-28', targetProgress: targetProgress({ monthlyBudget: { '2026-10': 200000 } }, [{ key: '2026-10', revenue: 120000 }], '2026-10-28') };
  const inv = [
    { customer: 'Quiet Dairy', date: '2026-07-01', amount: 3000 }, { customer: 'Quiet Dairy', date: '2026-05-10', amount: 2500 },
    { customer: 'Slipping Cafe', date: '2026-10-10', amount: 500 }, { customer: 'Slipping Cafe', date: '2026-06-20', amount: 4000 },
    { customer: 'Big Shop', date: '2026-10-20', amount: 90000 }, { customer: 'Tiny', date: '2026-04-20', amount: 100 },
  ];
  const customers = projectCustomers(inv, rep, { period: {}, asOf: '2026-10-28', fyStart: '2026-04-01', basis: 'x' });
  const products = projectBestSellers([
    { code: 'A', name: 'Alpha Bars', units: 5, revenue: 9000, rev90: 1500, prev90: 4000 },
    { code: 'B', name: 'Beta Drink', units: 5, revenue: 8000, rev90: 5000, prev90: 2000 },
  ], rep, { period: {}, asOf: '2026-10-28', windows: {}, basis: 'x' });
  const debtors = projectDebtors({ asOf: '2026-10-28', basis: 'b', customers: [
    { id: 1, name: 'Slow Payer', rep: 'Keith', total: 5000, overdue: 4000, current: 1000, d1to30: 0, d31to60: 4000, d61to90: 0, over90: 0, oldestDays: 40, documents: 2, overdueDocuments: 1 },
    { id: 2, name: 'Worthy North Ltd', rep: 'Keith', total: 9000, overdue: 9000, intercompany: true, oldestDays: 70 },
    { id: 3, name: 'Someone Elses', rep: 'Jerry', total: 7000, overdue: 7000, oldestDays: 90 },
  ], invoices: [] }, rep);
  const plan = buildActionPlan({ rep, sales, customers, products, debtors });
  guard(plan, rep);
  const types = plan.opportunities.map((o) => o.type);
  for (const t of ['target', 'quiet_customer', 'overdue_account', 'slipping_customer', 'slowing_product', 'growing_product']) assert.ok(types.includes(t), `missing ${t}`);
  assert.equal(plan.opportunities[0].type, 'target');
  const text = JSON.stringify(plan);
  assert.ok(!text.includes('Worthy North Ltd'), 'intercompany debtor is never suggested');
  assert.ok(!text.includes('Someone Elses') && !text.includes('Jerry'), 'no other rep data');
  const tgt = plan.opportunities.find((o) => o.type === 'target');
  assert.ok(tgt.evidence.some((e) => e.includes('$120,000') && e.includes('$200,000')), 'target evidence quotes the real numbers');
  // 29 and 30 Oct are working days, 31 Oct is a Saturday: 80,000 over 2 working days, never over 3 calendar days
  assert.ok(tgt.evidence.some((e) => e.includes('$40,000') && e.includes('2 working days')), 'needed per working day: (200000-120000)/2');
  const quiet = plan.opportunities.find((o) => o.type === 'quiet_customer');
  assert.ok(quiet.evidence[0].includes('Quiet Dairy') && quiet.evidence[1].includes('$5,500'), 'quiet customer evidence');
  const od = plan.opportunities.find((o) => o.type === 'overdue_account');
  assert.ok(od.evidence[0].includes('$5,000') && od.evidence[0].includes('$4,000') && od.evidence[0].includes('40 days'));
  for (const o of plan.opportunities) assert.ok(o.evidence.length > 0 && o.action && o.title, 'each item has a title, an action and evidence');
  assert.deepEqual(plan.opportunities.map((o) => o.rank), plan.opportunities.map((_, i) => i + 1));
});
test('thin data gives an honest note, not invented advice', () => {
  const plan = buildActionPlan({ rep: repByKey('chris'), sales: null, customers: null, products: null, debtors: null });
  assert.equal(plan.opportunities.length, 0);
  assert.ok(plan.note);
});

console.log('Marketing login (Vishva): costing and account sales only');
{
  const { guardMarketing } = await import('../lib/repProject.js');
  const { activePrincipals } = await import('../lib/repAccess.js');
  const vishva = principalByKey('vishva');
  test('Vishva exists as a marketing principal with no team, no own sales and no systems of a rep', () => {
    assert.ok(vishva); assert.equal(vishva.role, 'marketing');
    assert.deepEqual(vishva.people, []); assert.deepEqual(vishva.members, []); assert.equal(vishva.self, null);
    assert.equal(vishva.system, 'both');
  });
  test('team leads keep the lead role; only the marketing entries are marketing', () => {
    assert.equal(principalByKey('michelle').role, 'lead'); assert.equal(principalByKey('lead1').role, 'lead');
    assert.deepEqual(activePrincipals().filter((p) => p.role === 'marketing').map((p) => p.key), ['vishva']);
  });
  test('Vishva cannot sign in until an access entry exists, then email and password both work', () => {
    delete process.env.REP_ACCESS; assert.equal(repForCode('V'.repeat(24), 'vishva@worthy.test'), null);
    assert.equal(currentVer('vishva'), 0);
    const salt = 'cd'.repeat(8);
    process.env.REP_ACCESS = JSON.stringify({ vishva: { salt, hash: hashCode('V'.repeat(24), salt), ver: 1, email: 'vishva@worthy.test' } });
    assert.equal(repForCode('V'.repeat(24), 'VISHVA@worthy.test').rep.key, 'vishva');
    for (const e of ['', 'michelle@worthy.test', 'vishva@worthy.test.evil']) assert.equal(repForCode('V'.repeat(24), e), null);
    assert.equal(currentVer('vishva'), 1);
  });
  test('a team lead code never opens the marketing login, and the marketing code never opens a lead', () => {
    const s1 = 'ab'.repeat(8), s2 = 'cd'.repeat(8);
    process.env.REP_ACCESS = JSON.stringify({
      michelle: { salt: s1, hash: hashCode('M'.repeat(24), s1), ver: 2 },
      vishva: { salt: s2, hash: hashCode('V'.repeat(24), s2), ver: 1 },
    });
    assert.equal(repForCode('M'.repeat(24)).rep.key, 'michelle');
    assert.equal(repForCode('V'.repeat(24)).rep.key, 'vishva');
    assert.equal(repForCode('V'.repeat(24)).rep.role, 'marketing');
  });
  test('guardMarketing blocks rep, salesperson, weekly and team keys at any depth, and passes account data', () => {
    guardMarketing({ accounts: [{ account: 'CSB Groups', revenue: 1 }], byMonth: [{ month: '2026-10', revenue: 1 }], topProducts: [{ product: 'X', units: 1 }] });
    for (const key of ['rep', 'reps', 'salesperson', 'sales_rep', 'invoice_user_id', 'week', 'weeks', 'weekly', 'person', 'members', 'Rep', 'SALESPERSON']) {
      assert.throws(() => guardMarketing({ ok: 1 , nested: [{ deep: { [key]: 'x' } }] }), /not available in this view/, key);
    }
  });
}

console.log('Department data limits (Purchasing sees no rep, weekly or customer data)');
{
  const { filterForRole, PURCH_STRIPPED_KEYS } = await import('../lib/roleData.js');
  const sample = () => ({
    fy: 2026, totals: { revenue: 100, newCustomers: 3 }, months: [{ key: '2026-10', revenue: 50, newCustomers: 2, weeks: [{ week: 1 }] }],
    products: [{ code: 'A', revenue: 5 }], categories: [{ category: 'Gum' }], fastMoving: [{ code: 'A' }], slowMoving: [{ code: 'B' }],
    reps: [{ name: 'Savan Patel', revenue: 9, weeks: [{ week: 1, revenue: 1 }], months: [{ revenue: 2 }] }], weeks: [{ week: 1, revenue: 1 }], weekly: [{ week: 1 }],
    repMargins: [{ name: 'Savan Patel' }], repMarginAvailable: true, repMarginNote: 'x',
    salespeople: [{ name: 'Nimesh Darjee' }], salespeopleMonthly: [], salespeopleWeekly: [],
    customers: [{ customer: 'CSB' }], clv: [{ customer: 'CSB' }], churned: [], atRisk: [{ customer: 'X' }], lapsed: [{ name: 'Y' }],
    metrics: { customersInPeriod: 5 },
  });
  const hasKey = (v, set) => Array.isArray(v) ? v.some((x) => hasKey(x, set)) : v && typeof v === 'object' ? Object.entries(v).some(([k, x]) => set.has(k) || hasKey(x, set)) : false;
  test('Purchasing loses every rep, weekly, rep margin and customer carrier, at any depth', () => {
    const out = filterForRole('purch', 'fy', sample());
    assert.equal(hasKey(out, new Set(PURCH_STRIPPED_KEYS)), false);
    assert.ok(!/Savan|Nimesh|CSB/.test(JSON.stringify(out)));
  });
  test('Purchasing keeps what it needs: totals, months, products, categories, movers, counts', () => {
    const out = filterForRole('purch', 'fy', sample());
    assert.equal(out.totals.revenue, 100); assert.equal(out.months[0].revenue, 50); assert.equal(out.months[0].newCustomers, 2);
    assert.ok(out.products.length && out.categories.length && out.fastMoving.length && out.slowMoving.length); assert.equal(out.metrics.customersInPeriod, 5);
  });
  test('Management and Business Development see the payload unchanged (as designed)', () => {
    for (const r of ['mgmt', 'bdm']) assert.deepEqual(filterForRole(r, 'fy', sample()), sample());
  });
  test('an unknown, missing or made-up department is treated as Purchasing (fails closed)', () => {
    for (const r of [undefined, null, '', 'admin', 'MGMT', 'marketing', 'lead', 'true']) assert.equal(hasKey(filterForRole(r, 'fy', sample()), new Set(PURCH_STRIPPED_KEYS)), false, String(r));
  });
  test('the filter never changes the caller\'s own object', () => {
    const s = sample(); filterForRole('purch', 'fy', s); assert.ok(s.reps && s.customers);
  });
}

console.log('System names (Odoo, Ostendo, Dutch Rusk, Worthy Products North and South)');
{
  const { resolveSystem, MARKETING_INSTRUCTIONS, NORTH_LABEL, SOUTH_LABEL } = await import('../lib/systemNames.js');
  test('every name for Worthy Products North means north', () => {
    for (const v of ['north', 'North', 'NORTH', 'odoo', 'Odoo', 'Worthy Products North', 'worthy products north', 'Worthy North', 'worthy-products-north', 'WPN']) assert.equal(resolveSystem(v), 'north', v);
  });
  test('every name for Worthy Products South and Dutch Rusk means south', () => {
    for (const v of ['south', 'South', 'ostendo', 'Ostendo', 'Dutch Rusk', 'dutch rusk', 'DutchRusk', 'Dutch Rusk Worthy Products South', 'Worthy Products South', 'worthy south', 'worthy-products-south', 'DR']) assert.equal(resolveSystem(v), 'south', v);
  });
  test('blank, both, or plain "Worthy Products" mean both, never a silent pick', () => {
    for (const v of [undefined, null, '', ' ', 'both', 'all', 'Worthy Products', 'worthy', 'combined', 'north and south', 'Odoo and Ostendo', 'north & south']) assert.equal(resolveSystem(v), null, String(v));
  });
  test('anything else is refused with a plain sentence', () => {
    for (const v of ['Oceania', 'Worthy Oceania', 'fabric', 'mars', 'xyz']) assert.throws(() => resolveSystem(v), /system must be/, v);
  });
  test('the labels carry both names, and the instructions explain every alias and forbid mixing them up', () => {
    assert.ok(/North/.test(NORTH_LABEL) && /Odoo/.test(NORTH_LABEL)); assert.ok(/South/.test(SOUTH_LABEL) && /Dutch Rusk/.test(SOUTH_LABEL) && /Ostendo/.test(SOUTH_LABEL));
    for (const w of ['Worthy Products North', 'Worthy Products South', 'Dutch Rusk', 'Odoo', 'Ostendo', 'Oceania', 'side by side', 'Never add North and South']) assert.ok(MARKETING_INSTRUCTIONS.includes(w), w);
  });
}

console.log(`\n${passed} passed${process.exitCode ? ', with FAILURES' : ''}`);
