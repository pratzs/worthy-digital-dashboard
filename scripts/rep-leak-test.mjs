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
const { REPS, repForCode, currentVer, hashCode, repByKey } = await import('../lib/repAccess.js');
const oauth = await import('../lib/repOauth.js');
const { projectSales, projectDebtors, guard } = await import('../lib/repProject.js');
const { projectBestSellers, projectCustomers, projectRecent, targetProgress } = await import('../lib/repInsights.js');

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

console.log('Access codes');
const salt = 's1';
process.env.REP_ACCESS = JSON.stringify({
  jerry: { salt, hash: hashCode('J'.repeat(24), salt), ver: 2 },
  savan: { salt, hash: hashCode('S'.repeat(24), salt), ver: 1 },
});
test('right code names the right rep and version', () => {
  const hit = repForCode('J'.repeat(24));
  assert.equal(hit.rep.key, 'jerry'); assert.equal(hit.ver, 2);
});
test('wrong, short, empty and unknown codes are refused', () => {
  for (const c of ['x'.repeat(24), 'J'.repeat(23), '', null, undefined, 'S'.repeat(24) + 'x']) assert.equal(repForCode(c), null);
});
test('a rep with no entry cannot sign in; version 0 means off', () => {
  assert.equal(currentVer('keith'), 0);
  assert.equal(currentVer('jerry'), 2);
});

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
  assert.equal(p.thisMonth.neededPerRemainingDay, Math.round(50000 / 11 * 100) / 100);
  assert.equal(p.yearBudgetToDate, Math.round((100000 + 200000 * 20 / 31) * 100) / 100);
  assert.equal(p.actualYearToDate, 240000);
  assert.equal(targetProgress(null, months, '2026-10-20'), null);
});
test('empty input gives a clear note, not an error', () => {
  assert.ok(projectBestSellers([], repByKey('jerry'), meta).note);
  assert.ok(projectCustomers([], repByKey('jerry'), meta).note);
  assert.ok(projectRecent([], repByKey('jerry'), meta).note);
});

console.log(`\n${passed} passed${process.exitCode ? ', with FAILURES' : ''}`);
