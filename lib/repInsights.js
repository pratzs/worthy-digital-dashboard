/**
 * Pure functions that turn ONE rep's own invoice rows into the answers a sales rep needs:
 * best sellers, customers (top, gone quiet, slipping, growing, new), recent orders, and how they
 * are pacing against their target. No network and no framework imports, so they are tested on
 * their own (scripts/rep-leak-test.mjs). The rows passed in are already limited to the rep by the
 * query in lib/repData.js; nothing here ever sees another rep's rows.
 */

import { marginOf, monthForecast, weekdaysBetween } from './repAnalysis.js';

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const pct1 = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);
const dayNum = (s) => Math.floor(new Date(`${String(s).substring(0, 10)}T00:00:00Z`).getTime() / 86400000);

/**
 * Best sellers. `rows`: { code, name, units, revenue, rev90, prev90 } where revenue/units are for the
 * year so far, rev90 is the last 90 days and prev90 the 90 days before that.
 */
const mIn = (r) => ({ revenue: r.revenue, mRev: r.mRev, mCost: r.mCost, ucMin: r.ucMin, ucMax: r.ucMax });
export function projectBestSellers(rows, rep, meta) {
  const list = (rows || []).filter((r) => r && (Number(r.revenue) || Number(r.rev90) || Number(r.prev90)));
  const total = list.reduce((s, r) => s + (Number(r.revenue) || 0), 0);
  const shape = (r) => ({
    product: String(r.name || r.code || 'Unnamed product'),
    ...(r.code ? { code: String(r.code) } : {}),
    unitsThisYear: r2(r.units),
    revenueThisYear: r2(r.revenue),
    shareOfYourSalesPct: pct1(r.revenue, total),
    last90DaysRevenue: r2(r.rev90),
    previous90DaysRevenue: r2(r.prev90),
    changePct: Number(r.prev90) > 0 ? pct1(r.rev90 - r.prev90, r.prev90) : null,
    ...(r.mRev !== undefined ? (({ grossProfit, marginPct, marginBasisPct, marginNote }) => ({ grossProfitThisYear: grossProfit, marginPctThisYear: marginPct, marginBasisPct, ...(marginNote ? { marginNote } : {}) }))(marginOf(mIn(r))) : {}),
  });
  const byRev = [...list].sort((a, b) => (b.revenue || 0) - (a.revenue || 0));
  const movers = list.filter((r) => Number(r.prev90) >= 500 || Number(r.rev90) >= 500);
  const growing = movers.filter((r) => r.rev90 > r.prev90).sort((a, b) => (b.rev90 - b.prev90) - (a.rev90 - a.prev90)).slice(0, 8);
  const slowing = movers.filter((r) => r.rev90 < r.prev90).sort((a, b) => (a.rev90 - a.prev90) - (b.rev90 - b.prev90)).slice(0, 8);
  return {
    rep: rep.label, period: meta.period, asOf: meta.asOf, windows: meta.windows, basis: meta.basis,
    totalRevenueOnTheseProducts: r2(total),
    productsSold: list.length,
    bestSellers: byRev.slice(0, 20).map(shape),
    growingProducts: growing.map(shape),
    slowingProducts: slowing.map(shape),
    highestMarginProducts: list.filter((r) => r.revenue >= 2000 && r.mRev !== undefined).map((r) => ({ r, m: marginOf(mIn(r)) }))
      .filter((x) => x.m.marginPct !== null).sort((a, b) => b.m.marginPct - a.m.marginPct).slice(0, 8).map((x) => shape(x.r)),
    lowestMarginProducts: list.filter((r) => r.revenue >= 2000 && r.mRev !== undefined).map((r) => ({ r, m: marginOf(mIn(r)) }))
      .filter((x) => x.m.marginPct !== null).sort((a, b) => a.m.marginPct - b.m.marginPct).slice(0, 8).map((x) => shape(x.r)),
    note: list.length ? null : 'No product sales found for you in this period.',
  };
}

/**
 * Customers. `invoices`: { customer, date (YYYY-MM-DD), amount (credits negative), credit (bool) } for the
 * rep's own invoices and credit notes, covering the previous year as well as this one.
 */
export function projectCustomers(invoices, rep, meta) {
  const today = dayNum(meta.asOf);
  const fyStart = dayNum(meta.fyStart);
  const map = new Map();
  for (const inv of invoices || []) {
    if (!inv || !inv.customer || !inv.date) continue;
    const c = map.get(inv.customer) || { name: String(inv.customer), ytd: 0, orders: 0, last: null, first: null, r90: 0, p90: 0, prior: 0 };
    const d = dayNum(inv.date), amt = Number(inv.amount) || 0;
    if (!inv.credit && (!c.last || inv.date > c.last)) c.last = inv.date;
    if (!inv.credit && (!c.first || inv.date < c.first)) c.first = inv.date;
    if (d >= fyStart) { c.ytd += amt; if (!inv.credit) c.orders += 1; } else c.prior += amt;
    const age = today - d;
    if (age >= 0 && age < 90) c.r90 += amt; else if (age >= 90 && age < 180) c.p90 += amt;
    map.set(inv.customer, c);
  }
  const all = [...map.values()].map((c) => ({
    customer: c.name,
    revenueThisYear: r2(c.ytd), ordersThisYear: c.orders,
    lastOrder: c.last, daysSinceLastOrder: c.last ? today - dayNum(c.last) : null,
    last90DaysRevenue: r2(c.r90), previous90DaysRevenue: r2(c.p90),
    revenueBeforeThisYear: r2(c.prior),
    firstOrderSeen: c.first,
  }));
  const active = all.filter((c) => c.revenueThisYear !== 0 || c.last90DaysRevenue !== 0);
  const mg = meta.marginByCustomer;   // Map: lower-case customer name -> margin facts, when the line data is available
  const withMargin = (c) => { const m = mg && mg.get(String(c.customer).toLowerCase().trim()); return m ? { ...c, grossProfitThisYear: m.grossProfit, marginPctThisYear: m.marginPct, marginBasisPct: m.marginBasisPct } : c; };
  const topCustomers = [...active].sort((a, b) => b.revenueThisYear - a.revenueThisYear).slice(0, 20).map(withMargin);
  // Bought from you before, nothing for 45 days to a year: worth a call (longer than that is a lost account, not a quiet one).
  const quietCustomers = all.filter((c) => c.daysSinceLastOrder !== null && c.daysSinceLastOrder >= 45 && c.daysSinceLastOrder <= 365 && (c.revenueThisYear > 0 || c.revenueBeforeThisYear > 0))
    .sort((a, b) => (b.revenueThisYear + b.revenueBeforeThisYear) - (a.revenueThisYear + a.revenueBeforeThisYear)).slice(0, 15);
  // Still ordering, but clearly down on the 90 days before.
  const slippingCustomers = all.filter((c) => c.previous90DaysRevenue >= 1000 && c.last90DaysRevenue < c.previous90DaysRevenue * 0.6 && (c.daysSinceLastOrder ?? 999) < 45)
    .sort((a, b) => (a.last90DaysRevenue - a.previous90DaysRevenue) - (b.last90DaysRevenue - b.previous90DaysRevenue)).slice(0, 10);
  const growingCustomers = all.filter((c) => c.last90DaysRevenue >= 1000 && c.last90DaysRevenue > c.previous90DaysRevenue * 1.3)
    .sort((a, b) => (b.last90DaysRevenue - b.previous90DaysRevenue) - (a.last90DaysRevenue - a.previous90DaysRevenue)).slice(0, 10);
  // No invoice from you in the 12 months before this financial year: new, or back after a long gap. We cannot tell which.
  const newOrReturningCustomers = all.filter((c) => c.firstOrderSeen && dayNum(c.firstOrderSeen) >= fyStart && c.revenueBeforeThisYear === 0)
    .sort((a, b) => b.revenueThisYear - a.revenueThisYear).slice(0, 10);
  const ytdTotal = r2(all.reduce((s, c) => s + c.revenueThisYear, 0));
  const top5 = topCustomers.slice(0, 5).reduce((s, c) => s + c.revenueThisYear, 0);
  return {
    rep: rep.label, period: meta.period, asOf: meta.asOf, basis: meta.basis,
    summary: {
      customersOrderedThisYear: all.filter((c) => c.ordersThisYear > 0).length,
      totalInvoicedThisYear: ytdTotal,
      top5CustomersSharePct: pct1(top5, ytdTotal),
    },
    topCustomers, quietCustomers, slippingCustomers, growingCustomers, newOrReturningCustomers,
    note: all.length ? null : 'No customer sales found for you in this period.',
  };
}

/** The rep's most recent invoices and credit notes (newest first). */
export function projectRecent(invoices, rep, meta) {
  const rows = [...(invoices || [])].filter((i) => i && i.date)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.number || '').localeCompare(String(a.number || '')))
    .slice(0, 30)
    .map((i) => ({ date: i.date, number: i.number || undefined, customer: String(i.customer || ''), amount: r2(i.amount), type: i.credit ? 'Credit note' : 'Invoice' }));
  return { rep: rep.label, asOf: meta.asOf, basis: meta.basis, recent: rows, note: rows.length ? null : 'No recent invoices found for you.' };
}

/** Where the rep stands against their own target. Pure: from their target and their own months. */
export function targetProgress(target, months, asOfIso) {
  if (!target || !target.monthlyBudget) return null;
  const asOf = new Date(`${asOfIso}T00:00:00Z`);
  const byKey = new Map((months || []).map((m) => [m.key, m]));
  let budgetToDate = 0, actualToDate = 0;
  for (const [key, budget] of Object.entries(target.monthlyBudget)) {
    const [y, mo] = key.split('-').map(Number);
    const start = new Date(Date.UTC(y, mo - 1, 1)), end = new Date(Date.UTC(y, mo, 0));
    if (asOf < start) continue;
    const days = end.getUTCDate();
    const elapsed = asOf >= end ? days : asOf.getUTCDate();
    budgetToDate += budget * (elapsed / days);
    actualToDate += Number(byKey.get(key)?.revenue) || 0;
  }
  const cur = asOfIso.slice(0, 7);
  const curBudget = target.monthlyBudget[cur];
  let thisMonth = null;
  if (curBudget) {
    const [y, mo] = cur.split('-').map(Number);
    const days = new Date(Date.UTC(y, mo, 0)).getUTCDate(), day = asOf.getUTCDate();
    const actual = Number(byKey.get(cur)?.revenue) || 0;
    const left = days - day;
    // Working days (Monday to Friday) still to come after the date the figures run to. Public holidays are not allowed for.
    const tradingLeft = left > 0 ? weekdaysBetween(y, mo - 1, day + 1, days) : 0;
    thisMonth = {
      month: cur, budget: curBudget, soFar: r2(actual), percentOfMonthBudget: pct1(actual, curBudget),
      percentOfMonthElapsed: pct1(day, days), daysLeftInMonth: left,
      stillToSell: r2(Math.max(0, curBudget - actual)),
      tradingDaysLeft: tradingLeft,
      neededPerRemainingTradingDay: tradingLeft > 0 ? r2(Math.max(0, curBudget - actual) / tradingLeft) : null,
      forecast: monthForecast(actual, curBudget, asOfIso),
    };
  }
  return {
    asOf: asOfIso,
    yearBudgetToDate: r2(budgetToDate), actualYearToDate: r2(actualToDate),
    aheadOrBehind: r2(actualToDate - budgetToDate), percentOfBudgetToDate: pct1(actualToDate, budgetToDate),
    thisMonth,
    method: 'Budget to date adds each past month in full plus the current month pro rata by days; actual is your sales for the same months.',
  };
}
