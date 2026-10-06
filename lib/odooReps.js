/* Worthy Products North (Odoo company 4) reports on finance's terms:
 *
 *  - SALES are product lines only. Lines with no product on them (an
 *    intercompany expense reimbursement, pallet and parking rent, supplier
 *    rebate claims, freight recharges, "Discounts Given" lines) are not sales
 *    and are left out of sales and of margin.
 *  - REPS: the eight field reps are reported individually and everyone else
 *    (Kishan, Pratham, Pooja, Bansri, Rashmi, unassigned...) is one "Direct" line.
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

export function repGroup(companyId, name) {
  if (!usesFinanceBasis(companyId)) return name;
  return FIELD_REPS.has(name) ? name : 'Direct';
}
