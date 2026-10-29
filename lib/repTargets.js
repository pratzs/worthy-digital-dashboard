/* Rep sales targets (monthly budgets and target gross-profit %) for the FINANCIAL year (April to March), ex GST.
 *
 * The figures are NOT in this repository (it is public) and not in any browser bundle. They live in the
 * REP_TARGETS_JSON environment variable on the server, as a JSON array of
 *   { rep, fy, targetGpPct, sheetTotal, sheetGp, monthly: { 'YYYY-MM': dollars }, company?: 'south' }
 * (company is 'north' unless an entry says 'south'). The Overview "Sales vs Target" table reads them through the
 * dashboard-login-only /api/targets; the rep assistant reads them here, on the server, and a lead only ever gets
 * the targets of the people on their own team. With the variable missing, no targets are shown anywhere.
 */
export { fyTargetOf } from './repTargetMath.js';

function load() {
  try { const v = JSON.parse(process.env.REP_TARGETS_JSON || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}
export const REP_TARGETS = load();
