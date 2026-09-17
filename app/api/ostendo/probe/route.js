/** TEMPORARY. Reconcile our revenue to finance's, month by month. */
import { NextResponse } from 'next/server';
import { ostendoSql } from '@/lib/ostendo';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET() {
  const out = {};
  const run = async (k, sql) => { out[k] = await ostendoSql(sql).catch(e => ({ error: e.message })); };

  // Product lines per month — what finance appears to be quoting.
  await run('stockByMonth', `SELECT EXTRACT(MONTH FROM h.INVOICEDATE) AS MO, l.CODETYPE AS CT,
      SUM(l.EXTENDEDNETTPRICE) AS NETT
    FROM SALESINVOICELINES l JOIN SALESINVOICEHEADER h ON h.INVOICENUMBER = l.INVOICENUMBER
    WHERE h.INVOICEDATE BETWEEN '2026-04-01' AND '2026-09-16'
    GROUP BY 1, 2 ORDER BY 1, 2`);

  // Header net per month — what the dashboard reports.
  await run('headerByMonth', `SELECT EXTRACT(MONTH FROM h.INVOICEDATE) AS MO,
      SUM(h.INVOICENETTAMOUNT) AS NETT
    FROM SALESINVOICEHEADER h WHERE h.INVOICEDATE BETWEEN '2026-04-01' AND '2026-09-16'
    GROUP BY 1 ORDER BY 1`);

  // Which rep carries the rebates.
  await run('adjByRep', `SELECT h.SALESPERSON AS SP, SUM(l.EXTENDEDNETTPRICE) AS ADJ
    FROM SALESINVOICELINES l JOIN SALESINVOICEHEADER h ON h.INVOICENUMBER = l.INVOICENUMBER
    WHERE h.INVOICEDATE BETWEEN '2026-04-01' AND '2026-09-16'
      AND l.CODETYPE <> 'Item Code' GROUP BY 1 ORDER BY 2`);

  return NextResponse.json(out);
}
