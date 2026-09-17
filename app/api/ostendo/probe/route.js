/** TEMPORARY. Discounts, GST basis, and first-ever-order dates. */
import { NextResponse } from 'next/server';
import { ostendoSql } from '@/lib/ostendo';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const W = `h.INVOICEDATE BETWEEN '2026-04-01' AND '2026-09-16'`;

export async function GET() {
  const out = {};
  const run = async (k, sql) => { out[k] = await ostendoSql(sql).catch(e => ({ error: e.message })); };

  // Is INVOICENETTAMOUNT really ex-GST? If TOTAL/NETT ~= 1.15 it is.
  await run('gstCheck', `SELECT SUM(h.INVOICENETTAMOUNT) AS NETT, SUM(h.INVOICETOTALAMOUNT) AS TOTAL
    FROM SALESINVOICEHEADER h WHERE ${W}`);

  // Header-level discount column.
  await run('hdrDiscount', `SELECT SUM(h.LINEDISCOUNTAMOUNT) AS DISC, COUNT(*) AS N
    FROM SALESINVOICEHEADER h WHERE ${W}`);

  // Line-level discount columns.
  await run('lineDiscount', `SELECT SUM(l.DISCOUNTAMOUNT) AS DISCAMT,
      SUM(CASE WHEN l.DISCOUNTPERCENT <> 0 THEN 1 ELSE 0 END) AS LINES_WITH_PCT,
      COUNT(*) AS LINES_ALL
    FROM SALESINVOICELINES l JOIN SALESINVOICEHEADER h ON h.INVOICENUMBER = l.INVOICENUMBER
    WHERE ${W}`);

  // Discount by month, if it is populated at all.
  await run('discByMonth', `SELECT EXTRACT(YEAR FROM h.INVOICEDATE) AS YR,
      EXTRACT(MONTH FROM h.INVOICEDATE) AS MO, SUM(h.LINEDISCOUNTAMOUNT) AS DISC
    FROM SALESINVOICEHEADER h WHERE ${W} GROUP BY 1,2 ORDER BY 1,2`);

  // First-ever order per customer -> new customers per month.
  await run('firstOrders', `SELECT EXTRACT(YEAR FROM F.FIRSTD) AS YR, EXTRACT(MONTH FROM F.FIRSTD) AS MO,
      COUNT(*) AS NEW_CUSTOMERS
    FROM (SELECT h.CUSTOMER AS C, MIN(h.INVOICEDATE) AS FIRSTD
          FROM SALESINVOICEHEADER h WHERE h.INVOICEORCREDIT <> 'Credit' GROUP BY 1) F
    GROUP BY 1,2 ORDER BY 1,2`);

  return NextResponse.json(out);
}
