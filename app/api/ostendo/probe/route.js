/** TEMPORARY. Reconcile our revenue against a finance view, month by month. */
import { NextResponse } from 'next/server';
import { ostendoSql } from '@/lib/ostendo';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const FY = `h.INVOICEDATE BETWEEN '2026-04-01' AND '2026-09-16'`;
const L  = `SALESINVOICELINES l JOIN SALESINVOICEHEADER h ON h.INVOICENUMBER = l.INVOICENUMBER`;

export async function GET() {
  const out = {};
  const run = async (k, sql) => { out[k] = await ostendoSql(sql).catch(e => ({ error: e.message })); };

  /* Four ways of saying "sales", per month:
     A  header net            — what the dashboard reports
     B  invoices only, no credit notes
     C  stock lines only      — excludes rebates and other non-product lines
     D  the rebate/adjustment component on its own                             */
  await run('monthlyViews', `SELECT EXTRACT(MONTH FROM h.INVOICEDATE) AS MO,
      SUM(h.INVOICENETTAMOUNT) AS A_HEADER_NET,
      SUM(CASE WHEN h.INVOICEORCREDIT <> 'Credit' THEN h.INVOICENETTAMOUNT ELSE 0 END) AS B_NO_CREDITS
    FROM SALESINVOICEHEADER h WHERE ${FY} GROUP BY 1 ORDER BY 1`);

  await run('monthlyLines', `SELECT EXTRACT(MONTH FROM h.INVOICEDATE) AS MO,
      SUM(CASE WHEN l.CODETYPE = 'Item Code' THEN l.EXTENDEDNETTPRICE ELSE 0 END) AS C_STOCK_ONLY,
      SUM(CASE WHEN l.CODETYPE <> 'Item Code' THEN l.EXTENDEDNETTPRICE ELSE 0 END) AS D_ADJUSTMENTS
    FROM ${L} WHERE ${FY} GROUP BY 1 ORDER BY 1`);

  // The same split per rep, since the rep table is what is being compared.
  await run('repAdjustments', `SELECT h.SALESPERSON AS SP,
      SUM(CASE WHEN l.CODETYPE = 'Item Code' THEN l.EXTENDEDNETTPRICE ELSE 0 END) AS STOCK,
      SUM(CASE WHEN l.CODETYPE <> 'Item Code' THEN l.EXTENDEDNETTPRICE ELSE 0 END) AS ADJ
    FROM ${L} WHERE ${FY} GROUP BY 1 ORDER BY 2 DESC`);

  await run('bySite', `SELECT h.SITENAME AS SITE, COUNT(*) AS N, SUM(h.INVOICENETTAMOUNT) AS NETT
    FROM SALESINVOICEHEADER h WHERE ${FY} GROUP BY 1 ORDER BY 3 DESC`);

  return NextResponse.json(out);
}
