/** TEMPORARY. Does finance report by SITE rather than by salesperson? */
import { NextResponse } from 'next/server';
import { ostendoSql } from '@/lib/ostendo';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const FY = `h.INVOICEDATE BETWEEN '2026-04-01' AND '2026-09-16'`;

export async function GET() {
  const out = {};
  const run = async (k, sql) => { out[k] = await ostendoSql(sql).catch(e => ({ error: e.message })); };

  // Revenue split by SITENAME — a branch view, which is how a finance team often reports.
  await run('bySite', `SELECT h.SITENAME AS SITE, COUNT(*) AS N, SUM(h.INVOICENETTAMOUNT) AS NETT
    FROM SALESINVOICEHEADER h WHERE ${FY} GROUP BY 1 ORDER BY 3 DESC`);

  // Salesperson against site, to see whether one rep spans several sites.
  await run('bySiteAndRep', `SELECT h.SITENAME AS SITE, h.SALESPERSON AS SP,
      SUM(h.INVOICENETTAMOUNT) AS NETT
    FROM SALESINVOICEHEADER h WHERE ${FY} GROUP BY 1,2 ORDER BY 1,3 DESC`);

  // Per month per rep, so any month can be compared against finance directly.
  await run('repByMonth', `SELECT EXTRACT(MONTH FROM h.INVOICEDATE) AS MO, h.SALESPERSON AS SP,
      SUM(h.INVOICENETTAMOUNT) AS NETT,
      SUM(CASE WHEN h.INVOICEORCREDIT <> 'Credit' THEN h.INVOICENETTAMOUNT ELSE 0 END) AS NETT_EXCL_CREDITS
    FROM SALESINVOICEHEADER h WHERE ${FY} GROUP BY 1,2 ORDER BY 1,2`);

  return NextResponse.json(out);
}
