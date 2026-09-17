/**
 * TEMPORARY independent cross-check of /api/ostendo/fy.
 *
 * The point is to disagree if something is wrong, so nothing here shares code
 * with the endpoint under test. /api/ostendo/fy buckets every invoice by DAY,
 * converts each amount to integer cents and adds the days up in JavaScript.
 * This route asks Firebird for the same answers in a single GROUP BY, in
 * floating point, with no day buckets at all. If the two agree to the cent, the
 * daily bucketing and the rep attribution are sound. If they don't, they don't.
 *
 * DELETE once the comparison is recorded.
 */
import { NextResponse } from 'next/server';
import { ostendoSql, q } from '@/lib/ostendo';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const start = searchParams.get('start');
  const end   = searchParams.get('end');
  if (!start || !end) return NextResponse.json({ error: 'start and end required' }, { status: 400 });

  const W = `h.INVOICEDATE BETWEEN ${q(start)} AND ${q(end)}`;

  try {
    const [total, byRep, byMonth, costTotal, costByRep, invoiceCount] = await Promise.all([
      // Whole period, one row, no grouping at all.
      ostendoSql(`SELECT SUM(h.INVOICENETTAMOUNT) AS NETT, COUNT(*) AS ROWS_ALL
                  FROM SALESINVOICEHEADER h WHERE ${W}`),

      // Rep totals straight from the database — no day buckets, no JS addition.
      ostendoSql(`SELECT h.SALESPERSON AS SP, SUM(h.INVOICENETTAMOUNT) AS NETT
                  FROM SALESINVOICEHEADER h WHERE ${W} GROUP BY 1 ORDER BY 2 DESC`),

      ostendoSql(`SELECT EXTRACT(YEAR FROM h.INVOICEDATE) AS YR,
                         EXTRACT(MONTH FROM h.INVOICEDATE) AS MO,
                         SUM(h.INVOICENETTAMOUNT) AS NETT
                  FROM SALESINVOICEHEADER h WHERE ${W} GROUP BY 1, 2 ORDER BY 1, 2`),

      ostendoSql(`SELECT SUM(l.INVOICEQTY * l.INVOICEUNITCOST) AS COST
                  FROM SALESINVOICELINES l JOIN SALESINVOICEHEADER h
                    ON h.INVOICENUMBER = l.INVOICENUMBER WHERE ${W}`),

      ostendoSql(`SELECT h.SALESPERSON AS SP, SUM(l.INVOICEQTY * l.INVOICEUNITCOST) AS COST
                  FROM SALESINVOICELINES l JOIN SALESINVOICEHEADER h
                    ON h.INVOICENUMBER = l.INVOICENUMBER WHERE ${W} GROUP BY 1`),

      // Orders should be invoices only; credits counted separately.
      ostendoSql(`SELECT h.INVOICEORCREDIT AS OC, COUNT(*) AS N
                  FROM SALESINVOICEHEADER h WHERE ${W} GROUP BY 1`),
    ]);

    // Rep 461 (Ravi Kumar), September, week by week — the exact query handed to
    // the client so they can run it in Ostendo themselves.
    const repCode = searchParams.get('rep');
    let repWeeks = null, repWeeksSql = null, repWeeksCost = null;
    if (repCode) {
      const WEEK = `CASE
        WHEN EXTRACT(DAY FROM h.INVOICEDATE) <= 7  THEN 'Week 1 (1-7)'
        WHEN EXTRACT(DAY FROM h.INVOICEDATE) <= 14 THEN 'Week 2 (8-14)'
        WHEN EXTRACT(DAY FROM h.INVOICEDATE) <= 21 THEN 'Week 3 (15-21)'
        WHEN EXTRACT(DAY FROM h.INVOICEDATE) <= 28 THEN 'Week 4 (22-28)'
        ELSE 'Week 5 (29-31)' END`;
      repWeeksSql = `SELECT ${WEEK} AS WK,
       COUNT(*) AS DOCUMENTS,
       SUM(CASE WHEN h.INVOICEORCREDIT <> 'Credit' THEN 1 ELSE 0 END) AS INVOICES,
       SUM(CASE WHEN h.INVOICEORCREDIT  = 'Credit' THEN 1 ELSE 0 END) AS CREDIT_NOTES,
       SUM(h.INVOICENETTAMOUNT) AS NETT_SALES
FROM SALESINVOICEHEADER h
WHERE h.SALESPERSON = ${q(repCode)} AND ${W}
GROUP BY 1 ORDER BY 1`;
      repWeeks = await ostendoSql(repWeeksSql).catch(e => ({ error: e.message }));
      repWeeksCost = await ostendoSql(
        `SELECT ${WEEK} AS WK, SUM(l.INVOICEQTY * l.INVOICEUNITCOST) AS COST
         FROM SALESINVOICELINES l JOIN SALESINVOICEHEADER h ON h.INVOICENUMBER = l.INVOICENUMBER
         WHERE h.SALESPERSON = ${q(repCode)} AND ${W} GROUP BY 1 ORDER BY 1`
      ).catch(e => ({ error: e.message }));
    }

    return NextResponse.json({ start, end, total, byRep, byMonth, costTotal, costByRep, invoiceCount,
      repCode, repWeeks, repWeeksCost, repWeeksSql });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
