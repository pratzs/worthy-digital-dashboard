/**
 * Costs for NON-CODED sale lines (Ostendo code ZZZSTOCK) that Ostendo recorded with no cost, from 1 October 2026 on.
 * Order of preference: the cost finance supplied for that line (lib/adhocSupplied.js), else a strict match of the typed
 * description to the item master (lib/adhocMatch.js). A line with neither stays out of the margin and is reported.
 * As soon as the invoice line carries a cost in Ostendo it is no longer picked up here (the query asks for cost = 0).
 *
 * If Ostendo cannot be read, this returns nothing and the figures fall back to how they were before (lines left out).
 */
import { ostendoSql, q, FALLBACK_FROM } from '@/lib/ostendo';
import { adhocMatcher } from '@/lib/adhocMatch';
import { SUPPLIED_UNIT_COST } from '@/lib/adhocSupplied';

const MASTER_TTL = 10 * 60 * 1000;
let masterAt = 0, masterFind = null;
async function matcher() {
  if (masterFind && Date.now() - masterAt < MASTER_TTL) return masterFind;
  const rows = await ostendoSql('SELECT ITEMCODE, ITEMDESCRIPTION, AVERAGECOST, STDBUYPRICE FROM ITEMMASTER', 60000);
  masterFind = adhocMatcher(rows || []); masterAt = Date.now();
  return masterFind;
}

/** Every non-coded, no-cost sale line in [start, end] (from 1 Oct 2026), each with the cost found for it, or cost null. */
export async function adhocLines(start, end) {
  const from = start > FALLBACK_FROM ? start : FALLBACK_FROM;
  if (!end || end < from) return [];
  try {
    const [find, lines] = await Promise.all([
      matcher(),
      ostendoSql(`SELECT h.INVOICEDATE AS D, h.SALESPERSON AS SP, h.CUSTOMER AS C, l.SYSUNIQUEID AS ID, l.LINEDESCRIPTION AS DESCR,
                         l.INVOICEQTY AS QTY, l.INVOICEUNITPRICE AS P, l.EXTENDEDNETTPRICE AS REV
                  FROM SALESINVOICELINES l JOIN SALESINVOICEHEADER h ON h.INVOICENUMBER = l.INVOICENUMBER
                  WHERE h.INVOICEDATE BETWEEN ${q(from)} AND ${q(end)} AND l.LINECODE = 'ZZZSTOCK' AND l.CODETYPE = 'Item Code'
                    AND l.INVOICEQTY > 0 AND l.EXTENDEDNETTPRICE > 0 AND l.INVOICEUNITCOST = 0`, 60000),
    ]);
    return (lines || []).map((l) => {
      const qty = Number(l.QTY) || 0, revenue = Number(l.REV) || 0;
      const supplied = SUPPLIED_UNIT_COST.get(Number(l.ID));
      const m = supplied ? null : find(l.DESCR, Number(l.P) || (qty ? revenue / qty : 0));
      const unit = supplied || m?.unitCost || null;
      return {
        D: l.D, SP: l.SP, customer: String(l.C || '').trim(), description: String(l.DESCR || '').trim(), qty, revenue,
        cost: unit ? Math.round(unit * qty * 100) / 100 : null,
        source: supplied ? 'supplied by finance' : m ? `matched to ${m.code} ${m.name}` : null,
      };
    });
  } catch (e) {
    console.error(JSON.stringify({ evt: 'adhoc_cost_error', why: String(e?.message).slice(0, 200) }));
    return [];
  }
}
