/** TEMPORARY independent checker for the South analytics tables. */
import { NextResponse } from 'next/server';
import { ostendoSql, q } from '@/lib/ostendo';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request) {
  const p = new URL(request.url).searchParams;
  const start = p.get('start'), end = p.get('end');
  const codes = (p.get('codes') || '').split(',').filter(Boolean).map(q).join(',');
  const custs = (p.get('custs') || '').split('|').filter(Boolean).map(q).join(',');
  const cats  = (p.get('cats')  || '').split('|').filter(Boolean).map(q).join(',');
  const IN = `l.INVOICENUMBER IN (SELECT INVOICENUMBER FROM SALESINVOICEHEADER WHERE INVOICEDATE BETWEEN ${q(start)} AND ${q(end)})`;
  const out = {};
  const run = async (k, sql) => { out[k] = await ostendoSql(sql).catch(e => ({ error: e.message })); };

  if (codes) await run('products', `SELECT l.LINECODE AS CODE, SUM(l.INVOICEQTY) AS QTY,
      SUM(l.EXTENDEDNETTPRICE) AS NETT, SUM(l.INVOICEQTY*l.INVOICEUNITCOST) AS COST,
      SUM(CASE WHEN NOT (l.INVOICEQTY>0 AND l.EXTENDEDNETTPRICE>0
            AND l.INVOICEQTY*l.INVOICEUNITCOST>l.EXTENDEDNETTPRICE)
          THEN l.EXTENDEDNETTPRICE ELSE 0 END) AS NETTC,
      SUM(CASE WHEN NOT (l.INVOICEQTY>0 AND l.EXTENDEDNETTPRICE>0
            AND l.INVOICEQTY*l.INVOICEUNITCOST>l.EXTENDEDNETTPRICE)
          THEN l.INVOICEQTY*l.INVOICEUNITCOST ELSE 0 END) AS COSTC
    FROM SALESINVOICELINES l WHERE ${IN} AND l.CODETYPE='Item Code'
      AND l.LINECODE IN (${codes}) GROUP BY 1`);

  if (cats) await run('categories', `SELECT i.ITEMCATEGORY AS CAT, SUM(l.INVOICEQTY) AS QTY,
      SUM(l.EXTENDEDNETTPRICE) AS NETT, SUM(l.INVOICEQTY*l.INVOICEUNITCOST) AS COST
    FROM SALESINVOICELINES l JOIN ITEMMASTER i ON i.ITEMCODE=l.LINECODE
    WHERE ${IN} AND l.CODETYPE='Item Code' AND i.ITEMCATEGORY IN (${cats}) GROUP BY 1`);

  if (custs) {
    await run('custPeriod', `SELECT h.CUSTOMER AS NAME, COUNT(*) AS N, SUM(h.INVOICENETTAMOUNT) AS NETT
      FROM SALESINVOICEHEADER h WHERE h.INVOICEDATE BETWEEN ${q(start)} AND ${q(end)}
        AND h.INVOICEORCREDIT <> 'Credit' AND h.CUSTOMER IN (${custs}) GROUP BY 1`);
    await run('custLifetime', `SELECT h.CUSTOMER AS NAME, COUNT(*) AS N, SUM(h.INVOICENETTAMOUNT) AS NETT,
        MIN(h.INVOICEDATE) AS FIRSTD, MAX(h.INVOICEDATE) AS LASTD
      FROM SALESINVOICEHEADER h WHERE h.INVOICEORCREDIT <> 'Credit'
        AND h.CUSTOMER IN (${custs}) GROUP BY 1`);
  }
  return NextResponse.json(out);
}
