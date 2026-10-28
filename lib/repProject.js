/**
 * Pure projection and guard functions for the rep-only connector (no network, no
 * framework imports) so they can be tested on their own: scripts/rep-leak-test.mjs.
 * See lib/repTools.js for the rules these enforce.
 */
import { REP_TARGETS } from './repTargets.js';
import { targetProgress } from './repInsights.js';

export { projectBestSellers, projectCustomers, projectRecent, targetProgress } from './repInsights.js';

export const pick = (o, keys) => {
  const out = {};
  for (const k of keys) if (o && o[k] !== undefined) out[k] = o[k];
  return out;
};

const MONEY_ROW = ['revenue', 'netSales', 'grossProfit', 'marginPct', 'costCoverage', 'invoices', 'credits', 'creditValue', 'discounts', 'aov'];
const projectMonth = (m) => pick(m, ['key', 'label', 'started', ...MONEY_ROW]);
const projectWeek = (w, ranges) => ({
  ...pick(w, ['monthKey', 'week', ...MONEY_ROW]),
  dateRange: ranges.get(`${w.monthKey}|${w.week}`) || null,
});

export const systemLabel = (rep) => (rep.system === 'north' ? 'Worthy Products North (Odoo)' : 'Worthy Products South (Ostendo)');

function targetFor(rep, fy) {
  const t = REP_TARGETS.find((x) => x.rep === rep.label && x.fy === fy && (x.company === 'south') === (rep.system === 'south'));
  if (!t) return null;
  return { fy: t.fy, targetGpPct: t.targetGpPct, yearBudget: t.sheetTotal, monthlyBudget: t.monthly };
}

/** Builds the sales answer for one rep out of a full report payload. Pure, so it can be tested. */
export function projectSales(payload, rep, fy) {
  const row = (payload?.reps || []).find((r) => r && r.name === rep.label) || null;
  const ranges = new Map((payload?.weeks || []).map((w) => [`${w.monthKey}|${w.week}`, w.dateRange]));
  return {
    rep: rep.label,
    system: systemLabel(rep),
    financialYear: fy,
    period: payload?.range ? { from: payload.range.start, to: payload.range.end } : null,
    asOf: payload?.asOfNZ || null,
    basis: 'Your own sales only, ex GST, on the same basis as the Worthy dashboard.',
    year: row ? pick(row, [...MONEY_ROW, 'growthPct']) : null,
    months: row ? (row.months || []).map(projectMonth) : [],
    weeks: row ? (row.weeks || []).map((w) => projectWeek(w, ranges)) : [],
    target: targetFor(rep, fy),
    targetProgress: row && payload?.range ? targetProgress(targetFor(rep, fy), row.months || [], payload.range.end) : null,
    note: row ? null : 'No sales found for you in this financial year.',
  };
}

/** Builds the debtors answer for one rep: only the customers assigned to them. Pure. */
export function projectDebtors(payload, rep) {
  const mine = (payload?.customers || []).filter((c) => c && c.rep === rep.label);
  const ids = new Set(mine.map((c) => c.id));
  const num = (v) => Number(v) || 0;
  const sum = (k) => Math.round(mine.reduce((s, c) => s + num(c[k]), 0) * 100) / 100;
  const keep = ['id', 'name', 'total', 'overdue', 'current', 'd1to30', 'd31to60', 'd61to90', 'over90', 'oldestDays', 'documents', 'overdueDocuments', 'intercompany'];
  return {
    rep: rep.label,
    asOf: payload?.asOf || null,
    basis: payload?.basis || null,
    summary: {
      customers: mine.length,
      customersOverdue: mine.filter((c) => num(c.overdue) > 0).length,
      outstanding: sum('total'), overdue: sum('overdue'),
      current: sum('current'), d1to30: sum('d1to30'), d31to60: sum('d31to60'), d61to90: sum('d61to90'), over90: sum('over90'),
    },
    customers: mine.map((c) => pick(c, keep)),
    invoices: (payload?.invoices || []).filter((i) => ids.has(i.c))
      .map((i) => pick(i, ['c', 'doc', 'inv', 'due', 'days', 'amt', 'kind'])),
    note: mine.length ? null : 'No customers with a balance are assigned to you.',
  };
}

/** Fails closed if the answer carries anything that is not this rep's own. */
export function guard(result, rep) {
  const bad = (why) => { throw new Error(`Blocked: ${why}`); };
  const COMPANY_KEYS = new Set(['totals', 'reps', 'repMargins', 'customersTop', 'atRisk', 'churned', 'clv', 'products', 'categories']);
  const walk = (v, depth) => {
    if (depth > 8) bad('too deep');
    if (Array.isArray(v)) { v.forEach((x) => walk(x, depth + 1)); return; }
    if (v && typeof v === 'object') {
      for (const [k, val] of Object.entries(v)) {
        if (COMPANY_KEYS.has(k)) bad(`company field '${k}'`);
        if (k === 'rep' && val !== rep.label) bad('another rep');
        walk(val, depth + 1);
      }
    }
  };
  walk(result, 0);
  return result;
}

