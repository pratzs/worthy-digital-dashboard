/**
 * Bank targets for the Monthly Breakdown table.
 *
 * These are NOT the Odoo sales-rep targets (see KpiTargetsTable / /api/odoo/kpi) -
 * they are the monthly revenue figures given to the bank, one per company per
 * month. Nobody has supplied real numbers yet (Kishan is sourcing them), so every
 * month below reads "-" until a figure is filled in here.
 *
 * Key format: store id ("worthy" | "luxe" | "nova") -> "YYYY-MM" -> target number
 * (ex GST, in the company's own currency). Add rows as targets come in; nothing
 * else in the dashboard needs to change.
 */
export const BANK_TARGETS = {
  worthy: {
    // "2026-04": 250000,
  },
  luxe: {
    // "2026-04": 180000,
  },
  nova: {
    // "2026-04": 400000,
  },
};

export const bankTargetFor = (storeId, monthKey) =>
  BANK_TARGETS[storeId]?.[monthKey] ?? null;
