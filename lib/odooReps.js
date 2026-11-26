/* Worthy Products North (Odoo company 4) reports on finance's terms:
 *
 *  - SALES are product lines only. Lines with no product on them (an
 *    intercompany expense reimbursement, pallet and parking rent, supplier
 *    rebate claims, freight recharges, "Discounts Given" lines) are not sales
 *    and are left out of sales and of margin.
 *  - REPS: every salesperson is reported on their own line (26 Nov 2026). Until then everyone who is not one of the
 *    eight field reps (Kishan, Pratham, Pooja, Bansri, Rashmi...) was one "Direct" line, as finance's MTD report has it.
 *    That hid Kishan's clearance sales (about $625k this year at a loss) inside one row at 1.6%. Adding up every
 *    non-field person still gives finance's Direct figure; FIELD_REPS says who they are.
 *
 * Both confirmed against the head of finance's MTD sales-rep report, September
 * 2026, which this reproduces to the dollar.
 */
export const NORTH_COMPANY_ID = 4;
const FIELD_REPS = new Set([
  'Hari Patel', 'Naitik Trivedi', 'Nayan Patel', 'Rubin Monpara',
  'Savan Patel', 'Albert Lee', 'Nish Jha', 'Nimesh Darjee',
]);

export const usesFinanceBasis = (companyId) => companyId === NORTH_COMPANY_ID;

export const isFieldRep = (name) => FIELD_REPS.has(name);

/** The row a salesperson's sales sit on: their own name, for everyone. */
export function repGroup(companyId, name) {
  return name;
}
