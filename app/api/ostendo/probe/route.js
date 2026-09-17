/** TEMPORARY independent checker for South, on the current revenue basis. */
import { NextResponse } from 'next/server';
import { ostendoSql, q } from '@/lib/ostendo';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request) {
  const p = new URL(request.url).searchParams;
  const start = p.get('start'), end = p.get('end');
  if (!start || !end) return NextResponse.json({ error: 'start and end required' }, { status: 400 });
  const W = `h.INVOICEDATE BETWEEN ${q(start)} AND ${q(end)}`;
  const L = `SALESINVOICELINES l JOIN SALESINVOICEHEADER h ON h.INVOICENUMBER = l.INVOICENUMBER`;
  const out = {};
  const run = async (k, sql) => { out[k] = await ostendoSql(sql).catch((e) => ({ error: e.message })); };

  // Revenue is the product lines; rebates and the invoice total alongside it.
  await run('totals', `SELECT
      SUM(CASE WHEN l.CODETYPE = 'Item Code' THEN l.EXTENDEDNETTPRICE ELSE 0 END) AS REVENUE,
      SUM(CASE WHEN l.CODETYPE <> 'Item Code' THEN l.EXTENDEDNETTPRICE ELSE 0 END) AS REBATES,
      SUM(l.INVOICEQTY * l.INVOICEUNITCOST) AS COST,
      SUM(CASE WHEN l.CODETYPE = 'Item Code'
               THEN l.INVOICEQTY * l.CUSTOMERUNITPRICE - l.EXTENDEDNETTPRICE ELSE 0 END) AS DISC
    FROM ${L} WHERE ${W}`);

  await run('counts', `SELECT
      SUM(CASE WHEN h.INVOICEORCREDIT <> 'Credit' THEN 1 ELSE 0 END) AS INVOICES,
      SUM(CASE WHEN h.INVOICEORCREDIT  = 'Credit' THEN 1 ELSE 0 END) AS CREDITS,
      SUM(h.INVOICENETTAMOUNT) AS NETSALES
    FROM SALESINVOICEHEADER h WHERE ${W}`);

  await run('byMonth', `SELECT EXTRACT(YEAR FROM h.INVOICEDATE) AS YR, EXTRACT(MONTH FROM h.INVOICEDATE) AS MO,
      SUM(CASE WHEN l.CODETYPE = 'Item Code' THEN l.EXTENDEDNETTPRICE ELSE 0 END) AS REVENUE,
      SUM(l.INVOICEQTY * l.INVOICEUNITCOST) AS COST
    FROM ${L} WHERE ${W} GROUP BY 1,2`);

  await run('byRep', `SELECT h.SALESPERSON AS SP,
      SUM(CASE WHEN l.CODETYPE = 'Item Code' THEN l.EXTENDEDNETTPRICE ELSE 0 END) AS REVENUE,
      SUM(l.INVOICEQTY * l.INVOICEUNITCOST) AS COST,
      SUM(CASE WHEN l.CODETYPE <> 'Item Code' THEN l.EXTENDEDNETTPRICE ELSE 0 END) AS REBATES
    FROM ${L} WHERE ${W} GROUP BY 1`);

  return NextResponse.json(out);
}
