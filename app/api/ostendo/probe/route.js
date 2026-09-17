/**
 * TEMPORARY independent checker for Worthy Products South.
 * Shares no code with the endpoints it checks: single-pass GROUP BYs in plain
 * floating point, no day buckets, no cent arithmetic. Delete once proven.
 */
import { NextResponse } from 'next/server';
import { ostendoSql, q } from '@/lib/ostendo';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request) {
  const p = new URL(request.url).searchParams;
  const start = p.get('start'), end = p.get('end');
  if (!start || !end) return NextResponse.json({ error: 'start and end required' }, { status: 400 });

  const W  = `h.INVOICEDATE BETWEEN ${q(start)} AND ${q(end)}`;
  const L  = `SALESINVOICELINES l JOIN SALESINVOICEHEADER h ON h.INVOICENUMBER = l.INVOICENUMBER`;
  const IN = `l.INVOICENUMBER IN (SELECT INVOICENUMBER FROM SALESINVOICEHEADER WHERE INVOICEDATE BETWEEN ${q(start)} AND ${q(end)})`;
  const out = {};
  const run = async (k, sql) => { out[k] = await ostendoSql(sql).catch(e => ({ error: e.message })); };

  await run('headerTotals', `SELECT SUM(h.INVOICENETTAMOUNT) AS NETT,
      SUM(CASE WHEN h.INVOICEORCREDIT <> 'Credit' THEN 1 ELSE 0 END) AS INVOICES,
      SUM(CASE WHEN h.INVOICEORCREDIT  = 'Credit' THEN 1 ELSE 0 END) AS CREDITS
    FROM SALESINVOICEHEADER h WHERE ${W}`);

  await run('lineTotals', `SELECT SUM(l.INVOICEQTY * l.INVOICEUNITCOST) AS COST,
      SUM(CASE WHEN l.CODETYPE = 'Item Code'
               THEN l.INVOICEQTY * l.CUSTOMERUNITPRICE - l.EXTENDEDNETTPRICE ELSE 0 END) AS DISC
    FROM ${L} WHERE ${W}`);

  await run('byRep', `SELECT h.SALESPERSON AS SP, SUM(h.INVOICENETTAMOUNT) AS NETT,
      SUM(CASE WHEN h.INVOICEORCREDIT <> 'Credit' THEN 1 ELSE 0 END) AS INVOICES
    FROM SALESINVOICEHEADER h WHERE ${W} GROUP BY 1`);

  await run('costByRep', `SELECT h.SALESPERSON AS SP,
      SUM(l.INVOICEQTY * l.INVOICEUNITCOST) AS COST,
      SUM(CASE WHEN l.CODETYPE = 'Item Code'
               THEN l.INVOICEQTY * l.CUSTOMERUNITPRICE - l.EXTENDEDNETTPRICE ELSE 0 END) AS DISC
    FROM ${L} WHERE ${W} GROUP BY 1`);

  await run('byMonth', `SELECT EXTRACT(YEAR FROM h.INVOICEDATE) AS YR,
      EXTRACT(MONTH FROM h.INVOICEDATE) AS MO, SUM(h.INVOICENETTAMOUNT) AS NETT
    FROM SALESINVOICEHEADER h WHERE ${W} GROUP BY 1,2`);

  // Independent check of the slow-moving "sold" column for named codes.
  const codes = (p.get('codes') || '').split(',').filter(Boolean).map(q).join(',');
  if (codes) await run('soldForCodes', `SELECT l.LINECODE AS CODE, SUM(l.INVOICEQTY) AS QTY
    FROM SALESINVOICELINES l WHERE ${IN} AND l.CODETYPE = 'Item Code'
      AND l.LINECODE IN (${codes}) GROUP BY 1`);

  // Independent count of lines whose cost exceeds the sale.
  await run('suspect', `SELECT COUNT(*) AS LINES,
      SUM(l.INVOICEQTY * l.INVOICEUNITCOST) AS COST, SUM(l.EXTENDEDNETTPRICE) AS NETT
    FROM ${L} WHERE ${W} AND l.CODETYPE = 'Item Code' AND l.INVOICEQTY > 0
      AND l.EXTENDEDNETTPRICE > 0 AND l.INVOICEQTY * l.INVOICEUNITCOST > l.EXTENDEDNETTPRICE`);

  return NextResponse.json(out);
}
