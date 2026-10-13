/* Worthy Products North: rep targets, FINANCIAL year (April to March), ex GST.
 *
 * Each rep has a monthly sales budget and a target gross-profit percentage, taken
 * from the budget sheet the business works to. Keys are the month the budget is
 * for, in the same "YYYY-MM" form the dashboard uses. Add a rep by adding an entry;
 * the table on the Overview and Sales page picks it up. A new financial year needs
 * its own entry: the `fy` field is the year the April belongs to.
 *
 * Savan Patel, FY26 (Apr 2026 to Mar 2027): total budget $2,568,000, average
 * $214,000 a month, target GP 18.00%, GP target $462,240.
 */
export const REP_TARGETS = [
  {
    rep: 'Savan Patel', fy: 2026, targetGpPct: 18,
    monthly: {
      '2026-04': 199000, '2026-05': 232000, '2026-06': 184000, '2026-07': 221000,
      '2026-08': 216000, '2026-09': 190000, '2026-10': 220000, '2026-11': 214000,
      '2026-12': 248000, '2027-01': 204000, '2027-02': 212000, '2027-03': 228000,
    },
  },
];

export const fyTargetOf = (t) => Object.values(t.monthly).reduce((a, b) => a + b, 0);
