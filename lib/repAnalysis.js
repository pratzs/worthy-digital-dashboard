/**
 * More pure functions over ONE rep's own invoice lines: margin by product and customer, a month-end forecast,
 * a deep-dive on one of the rep's own customers, and cross-sell suggestions worked out from what the rep's own
 * customers buy. No network and no framework imports, so they are tested on their own
 * (scripts/rep-leak-test.mjs). The rows are already limited to the rep by the query in lib/repData.js.
 *
 * A "line row" is { customer, customerKey, productKey, product, code?, units, revenue, mRev?, mCost? } where
 * mRev is the revenue that has a real cost behind it and mCost is that cost. Margin is only quoted when at
 * least 60% of the revenue has a cost, the same idea as the dashboard: no cost, no margin.
 */

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const pct1 = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);
const money = (n) => `$${Math.round(Number(n) || 0).toLocaleString('en-NZ')}`;
const MIN_COVERAGE = 0.6;
const MIXED_UNIT_RATIO = 3;

/** Sums line rows by a key. */
export function aggregate(rows, keyOf, nameOf) {
  const m = new Map();
  for (const r of rows || []) {
    const k = keyOf(r); if (k === undefined || k === null || k === '') continue;
    const a = m.get(k) || { key: k, name: nameOf ? nameOf(r) : String(k), units: 0, revenue: 0, mRev: 0, mCost: 0, ucMin: 0, ucMax: 0, code: r.code };
    a.units += Number(r.units) || 0; a.revenue += Number(r.revenue) || 0; a.mRev += Number(r.mRev) || 0; a.mCost += Number(r.mCost) || 0;
    const lo = Number(r.ucMin) || 0, hi = Number(r.ucMax) || 0;
    if (lo > 0) a.ucMin = a.ucMin > 0 ? Math.min(a.ucMin, lo) : lo;
    if (hi > a.ucMax) a.ucMax = hi;
    m.set(k, a);
  }
  return m;
}

/** Margin facts for an aggregate: only quoted when enough of the revenue has a cost. */
export function marginOf(a) {
  const coverage = a.revenue > 0 ? a.mRev / a.revenue : 0;
  // The same product code invoiced with unit costs that differ by more than 3 times is almost always a mix of units
  // (each versus a carton): the margin would be meaningless, so it is withheld rather than shown as a loss.
  const mixedUnits = a.ucMin > 0 && a.ucMax / a.ucMin > MIXED_UNIT_RATIO;
  const ok = a.mRev > 0 && coverage >= MIN_COVERAGE && !mixedUnits;
  return {
    ...(mixedUnits ? { marginNote: 'The recorded cost for this product is in different units on different invoices, so no margin is shown.' } : {}),
    grossProfit: ok ? r2(a.mRev - a.mCost) : null,
    marginPct: ok ? pct1(a.mRev - a.mCost, a.mRev) : null,
    marginBasisPct: a.revenue > 0 ? Math.round(coverage * 100) : null,
  };
}

/** Margin by product, for the year so far. */
export function productMargins(lines) {
  const m = aggregate(lines, (r) => r.productKey, (r) => r.product);
  return new Map([...m].map(([k, a]) => [k, { ...marginOf(a), revenue: r2(a.revenue), units: r2(a.units), name: a.name, code: a.code }]));
}
/** Margin by customer, for the year so far. */
export function customerMargins(lines) {
  // Different products have different unit costs, so the mixed-unit check is for single products only, not whole customers.
  const m = aggregate((lines || []).map((r) => ({ ...r, ucMin: 0, ucMax: 0 })), (r) => r.customerKey, (r) => r.customer);
  return new Map([...m].map(([k, a]) => [k, { ...marginOf(a), revenue: r2(a.revenue), name: a.name }]));
}

// ── Month-end forecast ──────────────────────────────────────────────────────────────────────────
export const weekdaysBetween = (y, m0, from, to) => {
  let n = 0;
  for (let d = from; d <= to; d++) { const dow = new Date(Date.UTC(y, m0, d)).getUTCDay(); if (dow !== 0 && dow !== 6) n++; }
  return n;
};

/** Where this month is heading at the pace so far, counting Monday to Friday only (public holidays are not allowed for). */
export function monthForecast(soFar, budget, asOfIso) {
  const [y, mo, day] = asOfIso.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const elapsed = weekdaysBetween(y, mo - 1, 1, day);
  const total = weekdaysBetween(y, mo - 1, 1, daysInMonth);
  if (elapsed < 3) return null;   // too early in the month to say anything useful
  const perDay = soFar / elapsed;
  const projected = perDay * total;
  return {
    projectedMonthEnd: r2(projected),
    perTradingDay: r2(perDay),
    tradingDaysSoFar: elapsed, tradingDaysInMonth: total,
    percentOfBudget: budget ? pct1(projected, budget) : null,
    method: 'Sales so far this month divided by the Monday to Friday days gone, times all the Monday to Friday days in the month. Public holidays and unusual days are not allowed for, so treat it as a guide.',
  };
}

// ── Customer deep-dive ──────────────────────────────────────────────────────────────────────────
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Finds the rep's own customer a name refers to: { match } for exactly one, { many } to choose from, or { none }. */
export function findCustomer(names, query) {
  const q = norm(query);
  if (!q) return { none: true };
  const list = [...new Set(names || [])];
  const exact = list.filter((n) => norm(n) === q);
  if (exact.length === 1) return { match: exact[0] };
  const tokens = q.split(' ').filter(Boolean);
  const hits = list.filter((n) => tokens.every((t) => norm(n).includes(t)));
  if (hits.length === 1) return { match: hits[0] };
  if (hits.length > 1) return { many: hits.slice(0, 8) };
  return { none: true };
}

/**
 * One customer of the rep: how they are trading, what they buy, what they have stopped buying, what they owe.
 * Inputs are all already limited to this rep and this customer.
 */
export function projectCustomerDetail({ rep, customer, invoices, lines, recentProducts, earlierProducts, debtor, meta, suggestions, margin }) {
  const today = Math.floor(new Date(`${meta.asOf}T00:00:00Z`).getTime() / 86400000);
  const fyStart = Math.floor(new Date(`${meta.fyStart}T00:00:00Z`).getTime() / 86400000);
  const day = (s) => Math.floor(new Date(`${String(s).slice(0, 10)}T00:00:00Z`).getTime() / 86400000);
  let ytd = 0, orders = 0, last = null, r90 = 0, p90 = 0, before = 0;
  for (const i of invoices || []) {
    const d = day(i.date), amt = Number(i.amount) || 0;
    if (!i.credit && (!last || i.date > last)) last = i.date;
    if (d >= fyStart) { ytd += amt; if (!i.credit) orders++; } else before += amt;
    const age = today - d;
    if (age >= 0 && age < 90) r90 += amt; else if (age >= 90 && age < 180) p90 += amt;
  }
  const buys = aggregate(lines, (r) => r.productKey, (r) => r.product);
  const buysList = [...buys.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 10)
    .map((a) => ({ product: a.name, unitsThisYear: r2(a.units), revenueThisYear: r2(a.revenue), ...marginOf(a) }));
  const rec = new Map((recentProducts || []).map((p) => [p.key, p]));
  const earlier = new Map((earlierProducts || []).map((p) => [p.key, p]));
  const stopped = [...earlier.values()].filter((p) => !rec.has(p.key) && p.revenue >= 300).sort((a, b) => b.revenue - a.revenue).slice(0, 8)
    .map((p) => ({ product: p.name, boughtBefore: r2(p.revenue), boughtInLast90Days: 0 }));
  const started = [...rec.values()].filter((p) => !earlier.has(p.key) && p.revenue >= 300).sort((a, b) => b.revenue - a.revenue).slice(0, 5)
    .map((p) => ({ product: p.name, last90DaysRevenue: r2(p.revenue) }));
  return {
    rep: rep.label, customer, period: meta.period, asOf: meta.asOf, basis: meta.basis,
    summary: {
      revenueThisYear: r2(ytd), ordersThisYear: orders, lastOrder: last,
      daysSinceLastOrder: last ? today - day(last) : null,
      last90DaysRevenue: r2(r90), previous90DaysRevenue: r2(p90), revenueBeforeThisYear: r2(before),
      ...(margin ? { grossProfitThisYear: margin.grossProfit, marginPctThisYear: margin.marginPct, marginBasisPct: margin.marginBasisPct } : {}),
    },
    recentInvoices: [...(invoices || [])].sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 10)
      .map((i) => ({ date: i.date, number: i.number || undefined, amount: r2(i.amount), type: i.credit ? 'Credit note' : 'Invoice' })),
    whatTheyBuy: buysList,
    stoppedBuying: stopped,
    startedBuying: started,
    owing: debtor ? { totalOwingInclGst: r2(debtor.total), overdue: r2(Math.min(debtor.overdue, debtor.total)), oldestDaysOverdue: debtor.oldestDays } : null,
    productsToOffer: suggestions || [],
  };
}

// ── Cross-sell from the rep's own customers ─────────────────────────────────────────────────────
/**
 * `rows`: the rep's own customer x product lines for the last 12 months. For each focus customer, finds products
 * that many of the rep's other customers who buy the same things also buy, but this customer does not.
 * Everything is shown with the counts behind it, so the rep can check it.
 */
export function crossSell(rows, { customerKey = null, maxPerCustomer = 2, limit = 12, margins = null } = {}) {
  const byProd = new Map(), byCust = new Map(), names = new Map();
  for (const r of rows || []) {
    if (!(Number(r.revenue) > 0)) continue;
    const cp = byCust.get(r.customerKey) || new Map(); cp.set(r.productKey, (cp.get(r.productKey) || 0) + r.revenue); byCust.set(r.customerKey, cp);
    const pc = byProd.get(r.productKey) || new Map(); pc.set(r.customerKey, (pc.get(r.customerKey) || 0) + r.revenue); byProd.set(r.productKey, pc);
    names.set(r.productKey, r.product); names.set(r.customerKey, r.customer);
  }
  const N = byCust.size;
  if (N < 8) return [];
  const spendOf = (p) => [...byProd.get(p).values()].sort((a, b) => a - b);
  const median = (xs) => (xs.length ? xs[Math.floor(xs.length / 2)] : 0);
  const focus = customerKey ? [customerKey].filter((k) => byCust.has(k))
    : [...byCust].map(([k, p]) => [k, [...p.values()].reduce((a, b) => a + b, 0)]).sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k]) => k);
  const out = [];
  for (const c of focus) {
    const mine = byCust.get(c);
    if (!mine || mine.size < 3) continue;
    const cands = new Map();
    for (const [a, aSpend] of mine) {
      const A = byProd.get(a);
      if (A.size < 6 || aSpend < 150) continue;
      for (const [p, P] of byProd) {
        if (mine.has(p) || P.size < 5) continue;
        let both = 0; for (const k of A.keys()) if (P.has(k)) both++;
        if (both < 4) continue;
        const conf = both / A.size, lift = conf / (P.size / N);
        if (conf < 0.4 || lift < 1.5) continue;
        const cur = cands.get(p);
        if (!cur || conf > cur.conf) cands.set(p, { p, a, conf, both, aSize: A.size, lift, aSpend });
      }
    }
    const list = [...cands.values()].filter((x) => median(spendOf(x.p)) >= 250).map((x) => {
      const typical = median(spendOf(x.p));
      const mg = margins?.get(x.p);
      return {
        customer: names.get(c), customerKey: c, product: names.get(x.p),
        because: names.get(x.a),
        evidence: `${x.both} of your ${x.aSize} customers who buy ${names.get(x.a)} also buy ${names.get(x.p)}. ${names.get(c)} buys ${names.get(x.a)} (${money(x.aSpend)} in the last 12 months) but has not bought ${names.get(x.p)} in that time.`,
        customersBuyingIt: byProd.get(x.p).size, outOfCustomers: N,
        typicalYearlySpendOnIt: r2(typical),
        ...(mg && mg.marginPct !== null ? { yourMarginPct: mg.marginPct } : {}),
        _score: typical * x.conf,
      };
    }).sort((a, b) => b._score - a._score).slice(0, maxPerCustomer);
    out.push(...list);
  }
  return out.sort((a, b) => b._score - a._score).slice(0, limit).map(({ _score, ...rest }) => rest);
}
