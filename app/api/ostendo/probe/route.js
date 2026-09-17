/** TEMPORARY. Is the UOM fault confined to a couple of months, and is it over? */
import { NextResponse } from 'next/server';
import { ostendoSql } from '@/lib/ostendo';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const L = `SALESINVOICELINES l JOIN SALESINVOICEHEADER h ON h.INVOICENUMBER = l.INVOICENUMBER`;
const STOCK = `l.CODETYPE='Item Code' AND l.INVOICEQTY>0 AND l.EXTENDEDNETTPRICE>0`;
const RANGE = `h.INVOICEDATE BETWEEN '2025-04-01' AND '2026-09-16'`;

export async function GET() {
  const out = {};
  const run = async (k, sql) => { out[k] = await ostendoSql(sql).catch(e => ({ error: e.message })); };

  // Split each month's suspect cost into "wildly wrong" (a unit-of-measure
  // mix-up shows as a multiple) and "just below cost" (ordinary clearance).
  await run('byMonth', `SELECT EXTRACT(YEAR FROM h.INVOICEDATE) AS YR,
      EXTRACT(MONTH FROM h.INVOICEDATE) AS MO,
      SUM(l.EXTENDEDNETTPRICE) AS TOTREV,
      SUM(l.INVOICEQTY*l.INVOICEUNITCOST) AS TOTCOST,
      SUM(CASE WHEN l.INVOICEQTY*l.INVOICEUNITCOST > l.EXTENDEDNETTPRICE*2
               THEN l.INVOICEQTY*l.INVOICEUNITCOST ELSE 0 END) AS WILD_COST,
      SUM(CASE WHEN l.INVOICEQTY*l.INVOICEUNITCOST > l.EXTENDEDNETTPRICE*2
               THEN l.EXTENDEDNETTPRICE ELSE 0 END) AS WILD_REV,
      SUM(CASE WHEN l.INVOICEQTY*l.INVOICEUNITCOST > l.EXTENDEDNETTPRICE*2 THEN 1 ELSE 0 END) AS WILD_LINES,
      SUM(CASE WHEN l.INVOICEQTY*l.INVOICEUNITCOST > l.EXTENDEDNETTPRICE
                AND l.INVOICEQTY*l.INVOICEUNITCOST <= l.EXTENDEDNETTPRICE*2
               THEN l.INVOICEQTY*l.INVOICEUNITCOST ELSE 0 END) AS MILD_COST,
      SUM(CASE WHEN l.INVOICEQTY*l.INVOICEUNITCOST > l.EXTENDEDNETTPRICE
                AND l.INVOICEQTY*l.INVOICEUNITCOST <= l.EXTENDEDNETTPRICE*2 THEN 1 ELSE 0 END) AS MILD_LINES
    FROM ${L} WHERE ${RANGE} AND ${STOCK} GROUP BY 1,2 ORDER BY 1,2`);

  // The most recent fortnight, day by day — has it actually stopped?
  await run('recentDays', `SELECT h.INVOICEDATE AS D,
      SUM(CASE WHEN l.INVOICEQTY*l.INVOICEUNITCOST > l.EXTENDEDNETTPRICE*2 THEN 1 ELSE 0 END) AS WILD_LINES,
      SUM(CASE WHEN l.INVOICEQTY*l.INVOICEUNITCOST > l.EXTENDEDNETTPRICE*2
               THEN l.INVOICEQTY*l.INVOICEUNITCOST ELSE 0 END) AS WILD_COST
    FROM ${L} WHERE h.INVOICEDATE BETWEEN '2026-09-01' AND '2026-09-16' AND ${STOCK}
    GROUP BY 1 ORDER BY 1`);

  return NextResponse.json(out);
}
