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
    sheetTotal: 2568000, sheetGp: 462240, // the totals printed on the budget sheet
    monthly: {
      '2026-04': 199000, '2026-05': 232000, '2026-06': 184000, '2026-07': 221000,
      '2026-08': 216000, '2026-09': 190000, '2026-10': 220000, '2026-11': 214000,
      '2026-12': 248000, '2027-01': 204000, '2027-02': 212000, '2027-03': 228000,
    },
  },
  // Hari Patel, FY26: total budget $1,357,000, target GP 18.00% = $244,260.
  {
    rep: 'Hari Patel', fy: 2026, targetGpPct: 18,
    sheetTotal: 1357000, sheetGp: 244260, // the totals printed on the budget sheet
    monthly: {
      '2026-04': 104000, '2026-05': 118000, '2026-06': 101000, '2026-07': 106000,
      '2026-08': 104000, '2026-09': 100000, '2026-10': 114000, '2026-11': 128000,
      '2026-12': 121000, '2027-01': 112000, '2027-02': 117000, '2027-03': 132000,
    },
  },
  // Nayan Patel, FY26: total budget $1,898,000, target GP 18.00% = $341,640.
  {
    rep: 'Nayan Patel', fy: 2026, targetGpPct: 18,
    sheetTotal: 1898000, sheetGp: 341640, // the totals printed on the budget sheet
    monthly: {
      '2026-04': 136000, '2026-05': 170000, '2026-06': 148000, '2026-07': 152000,
      '2026-08': 168000, '2026-09': 150000, '2026-10': 174000, '2026-11': 144000,
      '2026-12': 177000, '2027-01': 145000, '2027-02': 166000, '2027-03': 168000,
    },
  },
  // Naitik Trivedi, FY26: total budget $2,448,000, target GP 18.00% = $440,640.
  {
    rep: 'Naitik Trivedi', fy: 2026, targetGpPct: 18,
    sheetTotal: 2448000, sheetGp: 440640, // the totals printed on the budget sheet
    monthly: {
      '2026-04': 177000, '2026-05': 197000, '2026-06': 172000, '2026-07': 204000,
      '2026-08': 219000, '2026-09': 201000, '2026-10': 235000, '2026-11': 212000,
      '2026-12': 228000, '2027-01': 193000, '2027-02': 194000, '2027-03': 216000,
    },
  },
  // Rubin Monpara, FY26: total budget $3,462,000, target GP 18.00% = $623,160.
  {
    rep: 'Rubin Monpara', fy: 2026, targetGpPct: 18,
    sheetTotal: 3462000, sheetGp: 623160, // the totals printed on the budget sheet
    monthly: {
      '2026-04': 241000, '2026-05': 284000, '2026-06': 243000, '2026-07': 324000,
      '2026-08': 308000, '2026-09': 262000, '2026-10': 301000, '2026-11': 300000,
      '2026-12': 336000, '2027-01': 275000, '2027-02': 290000, '2027-03': 298000,
    },
  },
  // Nimesh Darjee, FY26: no April budget (started in May); total budget $835,000,
  // target GP 18.00% = $150,300.
  {
    rep: 'Nimesh Darjee', fy: 2026, targetGpPct: 18,
    sheetTotal: 835000, sheetGp: 150300, // the totals printed on the budget sheet
    monthly: {
      '2026-04': 0, '2026-05': 50000, '2026-06': 50000, '2026-07': 50000,
      '2026-08': 75000, '2026-09': 75000, '2026-10': 75000, '2026-11': 100000,
      '2026-12': 100000, '2027-01': 80000, '2027-02': 80000, '2027-03': 100000,
    },
  },
];

/* The budget is whole dollars a month. The year's total and GP $ are the figures
   printed on the finance sheet; the twelve months must add up to that total, and
   the sheet's GP $ must be exactly the target GP % of it, or this fails loudly
   rather than showing a target that is not the sheet's. */
export const fyTargetOf = (t) => {
  const sum = Object.values(t.monthly).reduce((a, b) => a + b, 0);
  if (sum !== t.sheetTotal) throw new Error(`Budget for ${t.rep}: months add to ${sum}, the sheet says ${t.sheetTotal}`);
  if (Math.round(t.sheetTotal * t.targetGpPct) !== t.sheetGp * 100) throw new Error(`Budget for ${t.rep}: GP $ ${t.sheetGp} is not ${t.targetGpPct}% of ${t.sheetTotal}`);
  return t.sheetTotal;
};
