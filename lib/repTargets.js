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
  // Hari Patel, FY26: total budget $1,357,000, target GP 18.00% = $244,260.
  {
    rep: 'Hari Patel', fy: 2026, targetGpPct: 18,
    monthly: {
      '2026-04': 104000, '2026-05': 118000, '2026-06': 101000, '2026-07': 106000,
      '2026-08': 104000, '2026-09': 100000, '2026-10': 114000, '2026-11': 128000,
      '2026-12': 121000, '2027-01': 112000, '2027-02': 117000, '2027-03': 132000,
    },
  },
  // Nayan Patel, FY26: total budget $1,898,000, target GP 18.00% = $341,640.
  {
    rep: 'Nayan Patel', fy: 2026, targetGpPct: 18,
    monthly: {
      '2026-04': 136000, '2026-05': 170000, '2026-06': 148000, '2026-07': 152000,
      '2026-08': 168000, '2026-09': 150000, '2026-10': 174000, '2026-11': 144000,
      '2026-12': 177000, '2027-01': 145000, '2027-02': 166000, '2027-03': 168000,
    },
  },
  // Naitik Trivedi, FY26: total budget $2,448,000, target GP 18.00% = $440,640.
  {
    rep: 'Naitik Trivedi', fy: 2026, targetGpPct: 18,
    monthly: {
      '2026-04': 177000, '2026-05': 197000, '2026-06': 172000, '2026-07': 204000,
      '2026-08': 219000, '2026-09': 201000, '2026-10': 235000, '2026-11': 212000,
      '2026-12': 228000, '2027-01': 193000, '2027-02': 194000, '2027-03': 216000,
    },
  },
];

export const fyTargetOf = (t) => Object.values(t.monthly).reduce((a, b) => a + b, 0);
