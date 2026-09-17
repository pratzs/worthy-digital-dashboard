/** TEMPORARY. June W5 detail, and every field that could drive rep attribution. */
import { NextResponse } from 'next/server';
import { ostendoSql } from '@/lib/ostendo';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const L = `SALESINVOICELINES l JOIN SALESINVOICEHEADER h ON h.INVOICENUMBER = l.INVOICENUMBER`;
const W5 = `h.INVOICEDATE BETWEEN '2026-06-29' AND '2026-06-30'`;

export async function GET() {
  const out = {};
  const run = async (k, sql) => { out[k] = await ostendoSql(sql).catch(e => ({ error: e.message })); };

  // What columns does the header actually carry? Something else may hold the rep.
  await run('headerColumns', `SELECT FIRST 1 * FROM SALESINVOICEHEADER`);

  // June week 5 for rep 450 — is -54.6% real trade or mis-costed lines?
  await run('w5Summary', `SELECT COUNT(*) AS LINES,
      SUM(l.EXTENDEDNETTPRICE) AS NETT, SUM(l.INVOICEQTY*l.INVOICEUNITCOST) AS COST,
      SUM(CASE WHEN l.INVOICEQTY*l.INVOICEUNITCOST > l.EXTENDEDNETTPRICE*2
               THEN l.INVOICEQTY*l.INVOICEUNITCOST ELSE 0 END) AS OVER2X,
      SUM(CASE WHEN l.INVOICEQTY*l.INVOICEUNITCOST > l.EXTENDEDNETTPRICE
                AND l.INVOICEQTY*l.INVOICEUNITCOST <= l.EXTENDEDNETTPRICE*2
               THEN l.INVOICEQTY*l.INVOICEUNITCOST ELSE 0 END) AS BETWEEN1AND2
    FROM ${L} WHERE ${W5} AND h.SALESPERSON = '450' AND l.CODETYPE='Item Code'`);

  await run('w5Worst', `SELECT FIRST 10 l.LINEDESCRIPTION AS NAME, l.INVOICEQTY AS QTY,
      l.INVOICEUNITPRICE AS SELLU, l.INVOICEUNITCOST AS COSTU, l.EXTENDEDNETTPRICE AS NETT,
      l.EXTENDEDNETTPRICE - l.INVOICEQTY*l.INVOICEUNITCOST AS GP
    FROM ${L} WHERE ${W5} AND h.SALESPERSON = '450' AND l.CODETYPE='Item Code'
    ORDER BY 6 ASC`);

  // Does the customer master hold its own rep, different from the invoice's?
  await run('customerColumns', `SELECT FIRST 1 * FROM CUSTOMER`);

  return NextResponse.json(out);
}
