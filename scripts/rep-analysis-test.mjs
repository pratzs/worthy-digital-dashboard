/**
 * Tests for the margin, forecast, customer lookup, cross-sell, deep-dive and quota/usage store code.
 * Known numbers in, known numbers out; no network.
 *   node scripts/rep-analysis-test.mjs
 */
import assert from 'node:assert/strict';

process.env.REP_CHAT_DAILY_LIMIT = '3';
const { repByKey } = await import('../lib/repAccess.js');
const { guard } = await import('../lib/repProject.js');
const an = await import('../lib/repAnalysis.js');
const store = await import('../lib/repStore.js');

let passed = 0;
const pending = [];
const test = (name, fn) => pending.push([name, fn]);

test('margin is only quoted when at least 60% of the sales have a cost', () => {
  assert.equal(an.marginOf({ revenue: 1000, mRev: 500, mCost: 300 }).marginPct, null);
  const m = an.marginOf({ revenue: 1000, mRev: 700, mCost: 560 });
  assert.equal(m.marginPct, 20); assert.equal(m.grossProfit, 140); assert.equal(m.marginBasisPct, 70);
  assert.equal(an.marginOf({ revenue: 0, mRev: 0, mCost: 0 }).marginPct, null);
});

test('credit notes come off: negative revenue and units net against sales', () => {
  const rows = [
    { customerKey: 'a', customer: 'A', productKey: 'p', product: 'P', units: 10, revenue: 1000, mRev: 1000, mCost: 700 },
    { customerKey: 'a', customer: 'A', productKey: 'p', product: 'P', units: -2, revenue: -200, mRev: -200, mCost: -140 },
  ];
  const pm = an.productMargins(rows).get('p');
  assert.equal(pm.revenue, 800); assert.equal(pm.units, 8); assert.equal(pm.marginPct, 30);
});

test('month forecast counts Monday to Friday only', () => {
  const f = an.monthForecast(120000, 200000, '2026-10-20');
  assert.equal(f.tradingDaysSoFar, 14); assert.equal(f.tradingDaysInMonth, 22);
  assert.equal(f.projectedMonthEnd, Math.round(120000 / 14 * 22 * 100) / 100);
  assert.equal(f.percentOfBudget, Math.round(120000 / 14 * 22 / 200000 * 1000) / 10);
  assert.equal(an.monthForecast(5000, 200000, '2026-10-02'), null, 'too early in the month to forecast');
});

test('customer lookup only matches the rep own customers and asks when unsure', () => {
  const names = ['Flaxmere Supermarket', 'Flaxmere Dairy', 'Awakeri Store', 'The Fresh Market CBD'];
  assert.equal(an.findCustomer(names, 'awakeri').match, 'Awakeri Store');
  assert.equal(an.findCustomer(names, 'FRESH market').match, 'The Fresh Market CBD');
  assert.deepEqual(an.findCustomer(names, 'flaxmere').many.slice().sort(), ['Flaxmere Dairy', 'Flaxmere Supermarket']);
  assert.ok(an.findCustomer(names, 'Keith Dairy').none);
  assert.ok(an.findCustomer(names, '   ').none);
  assert.equal(an.findCustomer(names, 'Flaxmere Dairy').match, 'Flaxmere Dairy');
});

test('cross-sell: finds what similar customers buy, with the counts as evidence', () => {
  const rows = [];
  const add = (c, p, rev = 500) => rows.push({ customerKey: c, customer: c, productKey: p, product: p, revenue: rev });
  for (let i = 1; i <= 10; i++) { add(`c${i}`, 'Red Bull'); add(`c${i}`, 'Chips'); add(`c${i}`, 'Gum'); }
  for (let i = 1; i <= 6; i++) add(`c${i}`, 'Musashi', 800);          // 6 of the 10 Red Bull customers also buy Musashi
  for (let i = 11; i <= 20; i++) { add(`c${i}`, 'Cola'); add(`c${i}`, 'Mints'); add(`c${i}`, 'Pies'); }
  const out = an.crossSell(rows, { customerKey: 'c9' });
  const hit = out.find((x) => x.product === 'Musashi');
  assert.ok(hit, 'suggests Musashi to c9');
  assert.match(hit.evidence, /6 of your 10 customers who buy .* also buy Musashi/);
  assert.equal(hit.typicalYearlySpendOnIt, 800);
  assert.equal(hit.customersBuyingIt, 6);
  assert.ok(!out.some((x) => x.product === 'Cola'), 'does not suggest unrelated products');
  assert.deepEqual(an.crossSell(rows.slice(0, 5)), [], 'too little data gives nothing rather than a guess');
});

test('customer deep-dive: what they buy, stopped and started buying, owing', () => {
  const rep = repByKey('savan');
  const meta = { period: {}, asOf: '2026-10-28', fyStart: '2026-04-01', basis: 'x' };
  const out = an.projectCustomerDetail({
    rep, customer: 'Flaxmere Supermarket', meta,
    invoices: [{ customer: 'Flaxmere Supermarket', date: '2026-05-14', amount: 4767, number: 'INV/1' }, { customer: 'Flaxmere Supermarket', date: '2025-12-01', amount: 14815 }],
    lines: [{ productKey: 1, product: 'Noodles', units: 40, revenue: 3000, mRev: 3000, mCost: 2400 }, { productKey: 2, product: 'Drinks', units: 10, revenue: 1767, mRev: 1767, mCost: 1500 }],
    recentProducts: [{ key: 3, name: 'New Biscuit', revenue: 600 }],
    earlierProducts: [{ key: 1, name: 'Noodles', revenue: 5000 }, { key: 2, name: 'Drinks', revenue: 900 }, { key: 9, name: 'Old Sweets', revenue: 450 }],
    debtor: { total: 5000, overdue: 7000, oldestDays: 40 }, suggestions: [],
  });
  guard(out, rep);
  assert.equal(out.summary.revenueThisYear, 4767); assert.equal(out.summary.daysSinceLastOrder, 167);
  assert.equal(out.summary.revenueBeforeThisYear, 14815);
  assert.equal(out.whatTheyBuy[0].product, 'Noodles'); assert.equal(out.whatTheyBuy[0].marginPct, 20);
  assert.deepEqual(out.stoppedBuying.map((x) => x.product).sort(), ['Drinks', 'Noodles', 'Old Sweets']);
  assert.deepEqual(out.startedBuying.map((x) => x.product), ['New Biscuit']);
  assert.equal(out.owing.overdue, 5000, 'overdue is never shown larger than the total owing');
});

test('quota: the daily limit is exact, refunds give a question back, reps are separate', async () => {
  const day = '2099-01-01';
  const a = [];
  for (let i = 0; i < 4; i++) a.push(await store.takeQuestion('jerry', day));
  assert.deepEqual(a.map((x) => x.allowed), [true, true, true, false]);
  assert.equal(a[2].remaining, 0); assert.equal(a[0].remaining, 2);
  assert.equal((await store.quotaNow('jerry', day)).remaining, 0);
  await store.refundQuestion('jerry', day);
  assert.equal((await store.quotaNow('jerry', day)).remaining, 1);
  assert.equal((await store.takeQuestion('keith', day)).remaining, 2, 'another rep has their own allowance');
  // day 1 ended with 2 of 3 used, so 1 rolls over: day 2 allows 3 + 1
  const d2 = await store.takeQuestion('jerry', '2099-01-02');
  assert.equal(d2.carried, 1, 'unused questions roll over'); assert.equal(d2.remaining, 3);
  for (let i = 0; i < 3; i++) await store.takeQuestion('jerry', '2099-01-02');
  assert.equal((await store.takeQuestion('jerry', '2099-01-02')).allowed, false, 'carried questions are used up, then it stops');
  // day 2 used 4 of 3 (one carried), day 1 left 1: nothing carries into day 3
  assert.equal((await store.quotaNow('jerry', '2099-01-03')).carried, 0, 'a carried question is only spent once');
  assert.equal((await store.takeQuestion('newlead', '2099-01-05')).carried, 0, 'a new lead does not start with saved questions');
  // a quiet week saves up to 7 days' worth; a day more than 7 days back no longer counts
  assert.equal((await store.quotaNow('jerry', '2099-01-09')).carried, 17, 'days 2 to 8: one over on day 2, six unused days');
  assert.equal((await store.quotaNow('jerry', '2099-01-10')).carried, 21, 'only the last 7 days count');
});

test('usage and feedback are recorded newest first, questions shortened', async () => {
  await store.logUsage({ t: '2026-10-29T01:00:00Z', rep: 'jerry', question: 'q1', tools: ['my_sales'], ok: true, ms: 4000, inTok: 100, outTok: 50 });
  await store.logUsage({ t: '2026-10-29T02:00:00Z', rep: 'jerry', question: 'x'.repeat(900), tools: [], ok: false, ms: 100, why: 'boom' });
  const u = await store.recentUsage(10);
  assert.equal(u[0].question.length, 500); assert.equal(u[1].question, 'q1');
  const st = await store.repStats('jerry');
  assert.equal(st.ok, 1); assert.equal(st.fail, 1); assert.equal(st.inTok, 100);
  await store.logFeedback({ t: 'x', rep: 'jerry', kind: 'wrong', question: 'q', answer: 'a'.repeat(5000), note: 'n' });
  const f = await store.recentFeedback(5);
  assert.equal(f[0].answer.length, 2500); assert.equal(f[0].kind, 'wrong');
});

for (const [name, fn] of pending) {
  try { await fn(); passed++; console.log(`  ok  ${name}`); } catch (e) { console.error(`FAIL  ${name}\n      ${e.message}`); process.exitCode = 1; }
}
console.log(`\n${passed} of ${pending.length} passed${process.exitCode ? ', with FAILURES' : ''}`);
