/** TEMPORARY. Define "discount" correctly, and identify the implausible-cost lines. */
import { NextResponse } from 'next/server';
import { ostendoSql } from '@/lib/ostendo';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const FY = `h.INVOICEDATE BETWEEN '2026-04-01' AND '2026-09-16'`;
const L  = `SALESINVOICELINES l JOIN SALESINVOICEHEADER h ON h.INVOICENUMBER = l.INVOICENUMBER`;

export async function GET() {
  const out = {};
  const run = async (k, sql) => { out[k] = await ostendoSql(sql).catch(e => ({ error: e.message })); };

  // Two independent ways of valuing the discount. If they agree, the definition holds.
  await run('discountTwoWays', `SELECT
      SUM(l.INVOICEQTY * l.CUSTOMERUNITPRICE) AS AT_CUSTOMER_PRICE,
      SUM(l.EXTENDEDNETTPRICE) AS ACHIEVED,
      SUM(l.INVOICEQTY * l.CUSTOMERUNITPRICE * l.DISCOUNTPERCENT / 100) AS BY_PERCENT,
      COUNT(*) AS LINES
    FROM ${L} WHERE ${FY} AND l.CODETYPE = 'Item Code'`);

  await run('discountByMonth', `SELECT EXTRACT(MONTH FROM h.INVOICEDATE) AS MO,
      SUM(l.INVOICEQTY * l.CUSTOMERUNITPRICE) - SUM(l.EXTENDEDNETTPRICE) AS DISC
    FROM ${L} WHERE ${FY} AND l.CODETYPE = 'Item Code' GROUP BY 1 ORDER BY 1`);

  // What ARE the lines whose cost dwarfs the revenue? Real clearance or bad data?
  await run('badCostExamples', `SELECT FIRST 12 l.INVOICENUMBER AS INV, h.CUSTOMER AS CUST,
      h.INVOICEORCREDIT AS OC, l.LINECODE AS CODE, l.LINEDESCRIPTION AS NAME,
      l.INVOICEQTY AS QTY, l.INVOICEUNITPRICE AS SELLU, l.INVOICEUNITCOST AS COSTU,
      l.EXTENDEDNETTPRICE AS NETT
    FROM ${L} WHERE ${FY} AND l.CODETYPE = 'Item Code' AND l.INVOICEQTY > 0
      AND l.EXTENDEDNETTPRICE > 0
      AND l.INVOICEQTY * l.INVOICEUNITCOST > l.EXTENDEDNETTPRICE * 2
    ORDER BY l.INVOICEQTY * l.INVOICEUNITCOST DESC`);

  // Does the same item sometimes cost a sane amount and sometimes not?
  await run('costSpread', `SELECT FIRST 10 l.LINECODE AS CODE, MAX(l.LINEDESCRIPTION) AS NAME,
      MIN(l.INVOICEUNITCOST) AS MINC, MAX(l.INVOICEUNITCOST) AS MAXC,
      AVG(l.INVOICEUNITPRICE) AS AVGSELL, COUNT(*) AS LINES
    FROM ${L} WHERE ${FY} AND l.CODETYPE = 'Item Code' AND l.INVOICEUNITCOST > 0
    GROUP BY l.LINECODE
    HAVING MAX(l.INVOICEUNITCOST) > MIN(l.INVOICEUNITCOST) * 3
    ORDER BY SUM(l.EXTENDEDNETTPRICE) DESC`);

  return NextResponse.json(out);
}
