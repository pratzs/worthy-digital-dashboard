/** TEMPORARY. Which cost basis is trustworthy, and are the bad costs clustered? */
import { NextResponse } from 'next/server';
import { ostendoSql } from '@/lib/ostendo';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const FY = `h.INVOICEDATE BETWEEN '2026-04-01' AND '2026-09-16'`;
const L  = `SALESINVOICELINES l JOIN SALESINVOICEHEADER h ON h.INVOICENUMBER = l.INVOICENUMBER`;

export async function GET() {
  const out = {};
  const run = async (k, sql) => { out[k] = await ostendoSql(sql).catch(e => ({ error: e.message })); };

  // Every cost-ish column the item master offers.
  await run('itemFields', `SELECT FIRST 1 * FROM ITEMMASTER`);

  // Are the impossible costs clustered on particular days? A bad stock receipt
  // corrupts the running average and every sale after it is costed wrong.
  await run('badByDay', `SELECT h.INVOICEDATE AS D, COUNT(*) AS LINES,
      SUM(l.INVOICEQTY * l.INVOICEUNITCOST) AS BADCOST, SUM(l.EXTENDEDNETTPRICE) AS BADREV
    FROM ${L} WHERE ${FY} AND l.CODETYPE='Item Code' AND l.INVOICEQTY>0
      AND l.EXTENDEDNETTPRICE>0 AND l.INVOICEQTY*l.INVOICEUNITCOST > l.EXTENDEDNETTPRICE*2
    GROUP BY 1 ORDER BY 3 DESC`);

  // For the worst items: how does the invoiced cost sit against the sell price
  // across the year? If most lines are sane and a few are wild, a per-item
  // typical cost is recoverable.
  await run('perItemSpread', `SELECT FIRST 12 l.LINECODE AS CODE, MAX(l.LINEDESCRIPTION) AS NAME,
      COUNT(*) AS LINES,
      SUM(CASE WHEN l.INVOICEUNITCOST <= l.INVOICEUNITPRICE THEN 1 ELSE 0 END) AS SANE_LINES,
      MIN(l.INVOICEUNITCOST) AS MINC, MAX(l.INVOICEUNITCOST) AS MAXC,
      AVG(l.INVOICEUNITPRICE) AS AVGSELL,
      SUM(l.INVOICEQTY * l.INVOICEUNITCOST) AS TOTCOST,
      SUM(l.EXTENDEDNETTPRICE) AS TOTREV
    FROM ${L} WHERE ${FY} AND l.CODETYPE='Item Code' AND l.INVOICEQTY>0
    GROUP BY l.LINECODE ORDER BY SUM(l.INVOICEQTY*l.INVOICEUNITCOST) - SUM(l.EXTENDEDNETTPRICE) DESC`);

  // What would the margin be if every line were costed at that item's CHEAPEST
  // observed cost that is still at or below the price it sold for?
  await run('marginBases', `SELECT
      SUM(l.EXTENDEDNETTPRICE) AS REV,
      SUM(l.INVOICEQTY * l.INVOICEUNITCOST) AS COST_INVOICED,
      SUM(l.INVOICEQTY * i.AVERAGECOST) AS COST_AVG,
      SUM(l.INVOICEQTY * i.STDBUYPRICE) AS COST_STDBUY
    FROM ${L} JOIN ITEMMASTER i ON i.ITEMCODE = l.LINECODE
    WHERE ${FY} AND l.CODETYPE='Item Code' AND l.INVOICEQTY>0`);

  return NextResponse.json(out);
}
