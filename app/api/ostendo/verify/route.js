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

    return NextResponse.json({ start, end, total, byRep, byMonth, costTotal, costByRep, invoiceCount });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
