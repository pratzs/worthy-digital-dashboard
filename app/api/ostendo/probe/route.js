/** TEMPORARY. Why does a BETWEEN range disagree with a day-by-day listing? */
import { NextResponse } from 'next/server';
import { ostendoSql } from '@/lib/ostendo';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET() {
  const out = {};
  const run = async (k, sql) => { out[k] = { sql, r: await ostendoSql(sql).catch(e => ({ error: e.message })) }; };

  // Day by day for rep 461 across September — the ground truth.
  await run('perDay', `SELECT h.INVOICEDATE AS D, COUNT(*) AS N, SUM(h.INVOICENETTAMOUNT) AS NETT
    FROM SALESINVOICEHEADER h WHERE h.SALESPERSON = '461'
      AND h.INVOICEDATE BETWEEN '2026-09-01' AND '2026-09-30' GROUP BY 1 ORDER BY 1`);

  // The window the dashboard actually asks for.
  await run('dashWindow', `SELECT COUNT(*) AS N, SUM(h.INVOICENETTAMOUNT) AS NETT
    FROM SALESINVOICEHEADER h WHERE h.SALESPERSON = '461'
      AND h.INVOICEDATE BETWEEN '2026-09-15' AND '2026-09-16'`);

  // The window the client ran.
  await run('userWindow', `SELECT COUNT(*) AS N, SUM(h.INVOICENETTAMOUNT) AS NETT
    FROM SALESINVOICEHEADER h WHERE h.SALESPERSON = '461'
      AND h.INVOICEDATE BETWEEN '2026-09-15' AND '2026-09-21'`);

  // Is INVOICEDATE carrying a time component?
  await run('maxDate', `SELECT MAX(h.INVOICEDATE) AS MAXD,
    CAST(MAX(h.INVOICEDATE) AS TIMESTAMP) AS MAXTS FROM SALESINVOICEHEADER h`);

  // Does the whole catalogue hold anything after 16 Sep?
  await run('after16', `SELECT COUNT(*) AS N, MIN(h.INVOICEDATE) AS FIRSTD, MAX(h.INVOICEDATE) AS LASTD
    FROM SALESINVOICEHEADER h WHERE h.INVOICEDATE > '2026-09-16'`);

  return NextResponse.json(out);
}
