/**
 * What each dashboard DEPARTMENT may see in the data itself (not just on its pages).
 *
 *   mgmt  (Management)                   everything
 *   bdm   (Business Development & Marketing)  as before: overview, Sales by Rep, products, customers. Unchanged on purpose.
 *   purch (Purchasing & Stock)           products, categories, fast and slow movers, stock, and company totals by month.
 *                                        NO rep tables, rep margins, weekly breakdowns, or customer lists and rankings.
 *
 * Why it lives here and not in the pages: the Purchasing pages never showed reps or customers, but the API behind them returned
 * them to anyone holding the Purchasing password. Every dashboard data route and the department connector now pass their answer
 * through filterForRole, so the page, the API and the connector all give the same limited answer.
 * Anything that is not clearly mgmt or bdm gets the most restrictive treatment (fail closed). No imports: testable on its own.
 */
const PURCH_STRIP = new Set([
  // Sales by Rep: rep tables, rep margins, weekly breakdowns
  'reps', 'weeks', 'weekly', 'repMargins', 'repMarginAvailable', 'repMarginNote', 'salespeople', 'salespeopleMonthly', 'salespeopleWeekly',
  // customers: lists, lifetime value, at risk, lapsed
  'customers', 'clv', 'churned', 'atRisk', 'lapsed',
]);

function strip(value, drop, depth = 0) {
  if (depth > 12) return value;
  if (Array.isArray(value)) return value.map((x) => strip(x, drop, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) { if (!drop.has(k)) out[k] = strip(v, drop, depth + 1); }
    return out;
  }
  return value;
}

/** The roles that see a payload unchanged. Everything else is treated as Purchasing. */
export const FULL_VIEW_ROLES = new Set(['mgmt', 'bdm']);

/** `kind` is only for documentation and future differences ('fy', 'advanced', 'main'); the strip list is the same everywhere. */
export function filterForRole(role, kind, payload) {
  if (FULL_VIEW_ROLES.has(role)) return payload;
  return strip(payload, PURCH_STRIP);
}

export const PURCH_STRIPPED_KEYS = [...PURCH_STRIP];
