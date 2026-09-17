/** TEMPORARY. Is INVOICEUNITCOST GST-inclusive? And what happened in June? */
import { NextResponse } from 'next/server';
import { ostendoSql } from '@/lib/ostendo';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const FY  = `h.INVOICEDATE BETWEEN '2026-04-01' AND '2026-09-16'`;
const JUN = `h.INVOICEDATE BETWEEN '2026-06-01' AND '2026-06-30'`;

export async function GET() {
  const out = {};
  const run = async (k, sql) => { out[k] = await ostendoSql(sql).catch(e => ({ error: e.message })); };

  // The decisive test: invoiced unit cost against the item master's buy price for
  // the same items. A consistent 1.15 ratio means cost carries GST and revenue does not.
  await run('costVsMaster', `SELECT FIRST 15 l.LINECODE AS CODE, MAX(l.LINEDESCRIPTION) AS NAME,
      AVG(l.INVOICEUNITCOST) AS INVCOST, MAX(i.STDBUYPRICE) AS STDBUY,
      MAX(i.AVERAGECOST) AS AVGCOST, AVG(l.INVOICEUNITPRICE) AS SELLPRICE
    FROM SALESINVOICELINES l
    JOIN SALESINVOICEHEADER h ON h.INVOICENUMBER = l.INVOICENUMBER
    JOIN ITEMMASTER i ON i.ITEMCODE = l.LINECODE
    WHERE ${FY} AND l.CODETYPE = 'Item Code' AND l.INVOICEUNITCOST > 0 AND i.STDBUYPRICE > 0
    GROUP BY l.LINECODE ORDER BY SUM(l.EXTENDEDNETTPRICE) DESC`);

  // Lines carrying cost but no revenue at all.
  await run('freeGoods', `SELECT COUNT(*) AS N, SUM(l.INVOICEQTY * l.INVOICEUNITCOST) AS COST
    FROM SALESINVOICELINES l JOIN SALESINVOICEHEADER h ON h.INVOICENUMBER = l.INVOICENUMBER
    WHERE ${FY} AND l.EXTENDEDNETTPRICE = 0 AND l.INVOICEQTY * l.INVOICEUNITCOST <> 0`);

  // June: where did the money go?
  await run('juneWorst', `SELECT FIRST 10 l.LINECODE AS CODE, MAX(l.LINEDESCRIPTION) AS NAME,
      SUM(l.INVOICEQTY) AS QTY, SUM(l.EXTENDEDNETTPRICE) AS NETT,
      SUM(l.INVOICEQTY * l.INVOICEUNITCOST) AS COST,
      SUM(l.EXTENDEDNETTPRICE) - SUM(l.INVOICEQTY * l.INVOICEUNITCOST) AS GP
    FROM SALESINVOICELINES l JOIN SALESINVOICEHEADER h ON h.INVOICENUMBER = l.INVOICENUMBER
    WHERE ${JUN} AND l.CODETYPE = 'Item Code'
    GROUP BY l.LINECODE ORDER BY 6 ASC`);

  await run('juneByType', `SELECT l.CODETYPE AS CT, COUNT(*) AS N,
      SUM(l.EXTENDEDNETTPRICE) AS NETT, SUM(l.INVOICEQTY * l.INVOICEUNITCOST) AS COST
    FROM SALESINVOICELINES l JOIN SALESINVOICEHEADER h ON h.INVOICENUMBER = l.INVOICENUMBER
    WHERE ${JUN} GROUP BY 1`);

  return NextResponse.json(out);
}
