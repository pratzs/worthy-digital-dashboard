/** TEMPORARY. How big is the bad-cost problem, and where do discounts really live? */
import { NextResponse } from 'next/server';
import { ostendoSql } from '@/lib/ostendo';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const FY = `h.INVOICEDATE BETWEEN '2026-04-01' AND '2026-09-16'`;
const L  = `SALESINVOICELINES l JOIN SALESINVOICEHEADER h ON h.INVOICENUMBER = l.INVOICENUMBER`;
const STOCK = `l.CODETYPE = 'Item Code' AND l.INVOICEQTY > 0 AND l.EXTENDEDNETTPRICE > 0`;

export async function GET() {
  const out = {};
  const run = async (k, sql) => { out[k] = await ostendoSql(sql).catch(e => ({ error: e.message })); };

  // Split the year's stock sales by how cost compares with the price achieved.
  await run('costSanity', `SELECT
      CASE WHEN l.INVOICEQTY * l.INVOICEUNITCOST > l.EXTENDEDNETTPRICE * 2   THEN 'cost over 2x revenue'
           WHEN l.INVOICEQTY * l.INVOICEUNITCOST > l.EXTENDEDNETTPRICE       THEN 'cost above revenue'
           ELSE 'normal' END AS BAND,
      COUNT(*) AS LINES, SUM(l.EXTENDEDNETTPRICE) AS NETT,
      SUM(l.INVOICEQTY * l.INVOICEUNITCOST) AS COST
    FROM ${L} WHERE ${FY} AND ${STOCK} GROUP BY 1`);

  // Does the invoiced cost agree with what the item master says it costs?
  await run('costVsMasterBands', `SELECT
      CASE WHEN l.INVOICEUNITCOST > i.STDBUYPRICE * 3 THEN 'invoiced cost over 3x master'
           WHEN l.INVOICEUNITCOST > i.STDBUYPRICE * 1.3 THEN 'invoiced cost 1.3-3x master'
           ELSE 'within 30% of master' END AS BAND,
      COUNT(*) AS LINES, SUM(l.EXTENDEDNETTPRICE) AS NETT,
      SUM(l.INVOICEQTY * l.INVOICEUNITCOST) AS COST
    FROM ${L} JOIN ITEMMASTER i ON i.ITEMCODE = l.LINECODE
    WHERE ${FY} AND ${STOCK} AND i.STDBUYPRICE > 0 GROUP BY 1`);

  // Where do discounts actually live? List price vs the price achieved.
  await run('priceVsList', `SELECT
      SUM(l.INVOICEQTY * l.INVOICEUNITPRICE) AS AT_LIST,
      SUM(l.EXTENDEDNETTPRICE) AS ACHIEVED,
      SUM(l.DISCOUNTAMOUNT) AS DISC_FIELD,
      SUM(CASE WHEN l.DISCOUNTPERCENT <> 0 THEN 1 ELSE 0 END) AS LINES_WITH_PCT,
      COUNT(*) AS LINES
    FROM ${L} WHERE ${FY} AND ${STOCK}`);

  // Is CUSTOMERUNITPRICE the real, discounted price?
  await run('custPrice', `SELECT FIRST 8 l.LINECODE AS CODE, MAX(l.LINEDESCRIPTION) AS NAME,
      AVG(l.INVOICEUNITPRICE) AS LISTP, AVG(l.CUSTOMERUNITPRICE) AS CUSTP,
      AVG(l.DISCOUNTPERCENT) AS DPCT
    FROM ${L} WHERE ${FY} AND ${STOCK}
    GROUP BY l.LINECODE ORDER BY SUM(l.EXTENDEDNETTPRICE) DESC`);

  return NextResponse.json(out);
}
