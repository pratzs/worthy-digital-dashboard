/**
 * TEMPORARY DIAGNOSTIC — answers three questions the dashboard depends on:
 *   1. How does Ostendo represent credit notes (INVOICEORCREDIT + sign of the amount)?
 *   2. What INVOICESTATUS values exist, and do any represent non-posted invoices?
 *   3. Does header INVOICENETTAMOUNT reconcile to SUM(line EXTENDEDNETTPRICE)?
 *
 * DELETE THIS ROUTE once the answers are recorded.
 */
import { NextResponse } from 'next/server';
import https from 'node:https';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const agent = new https.Agent({ rejectUnauthorized: false });

function ostendoSql(sql, timeoutMs = 25000) {
  const base   = process.env.OSTENDO_BASE_URL;
  const apiKey = process.env.OSTENDO_API_KEY;
  const urlObj = new URL(base);
  const body   = Buffer.from(sql, 'utf8');
  return new Promise((resolve) => {
    const req = https.request({
      hostname: urlObj.hostname,
      port:     parseInt(urlObj.port) || 443,
      path:     `/sqlquery?apikey=${encodeURIComponent(apiKey)}&format=json`,
      method:   'POST',
      agent,
      headers: { 'Content-Type': 'text/plain', 'Content-Length': body.length },
    }, (res) => {
      let raw = '';
      res.on('data', c => (raw += c));
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch { resolve({ _nonJson: raw.substring(0, 400) }); }
      });
    });
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve({ _timeout: true }); });
    req.on('error', (e) => resolve({ _error: e.message }));
    req.write(body);
    req.end();
  });
}

const Y = 'EXTRACT(YEAR FROM INVOICEDATE) = 2026';

export async function GET() {
  const R = `h.INVOICEDATE BETWEEN '2026-04-01' AND '2026-09-17'`;
  const queries = {
    // 1. Does a literal BETWEEN date range work over POST /sqlquery?
    betweenWorks: `SELECT COUNT(*) AS N, SUM(h.INVOICENETTAMOUNT) AS NETT ` +
                  `FROM SALESINVOICEHEADER h WHERE ${R}`,

    // 2. Orders excluding credits, plus the credit tally as its own metric
    ordersVsCredits: `SELECT h.INVOICEORCREDIT, COUNT(*) AS N, SUM(h.INVOICENETTAMOUNT) AS NETT ` +
                     `FROM SALESINVOICEHEADER h WHERE ${R} GROUP BY h.INVOICEORCREDIT`,

    // 3. Product aggregate in ONE query (replaces ~345 chunked line fetches)
    productAgg: `SELECT FIRST 5 l.LINECODE, MAX(l.LINEDESCRIPTION) AS NAME, ` +
                `MAX(l.CATALOGUECATEGORY) AS CAT, SUM(l.INVOICEQTY) AS QTY, ` +
                `SUM(l.EXTENDEDNETTPRICE) AS NETT, SUM(l.INVOICEQTY * l.INVOICEUNITCOST) AS COST ` +
                `FROM SALESINVOICELINES l JOIN SALESINVOICEHEADER h ON h.INVOICENUMBER = l.INVOICENUMBER ` +
                `WHERE ${R} AND l.CODETYPE = 'Item Code' ` +
                `GROUP BY l.LINECODE ORDER BY 5 DESC`,

    // 4. Rep aggregate by month in ONE query
    repAgg: `SELECT h.SALESPERSON, EXTRACT(MONTH FROM h.INVOICEDATE) AS MO, ` +
            `EXTRACT(YEAR FROM h.INVOICEDATE) AS YR, ` +
            `SUM(l.EXTENDEDNETTPRICE) AS NETT, SUM(l.INVOICEQTY * l.INVOICEUNITCOST) AS COST ` +
            `FROM SALESINVOICELINES l JOIN SALESINVOICEHEADER h ON h.INVOICENUMBER = l.INVOICENUMBER ` +
            `WHERE ${R} GROUP BY h.SALESPERSON, 2, 3 ORDER BY 1, 3, 2`,

    // 5. Category aggregate
    catAgg: `SELECT FIRST 5 l.CATALOGUECATEGORY AS CAT, COUNT(DISTINCT l.LINECODE) AS NPROD, ` +
            `SUM(l.INVOICEQTY) AS QTY, SUM(l.EXTENDEDNETTPRICE) AS NETT, ` +
            `SUM(l.INVOICEQTY * l.INVOICEUNITCOST) AS COST ` +
            `FROM SALESINVOICELINES l JOIN SALESINVOICEHEADER h ON h.INVOICENUMBER = l.INVOICENUMBER ` +
            `WHERE ${R} AND l.CODETYPE = 'Item Code' GROUP BY l.CATALOGUECATEGORY ORDER BY 4 DESC`,
  };

  const out = {};
  for (const [name, sql] of Object.entries(queries)) {
    out[name] = { sql, result: await ostendoSql(sql) };
  }
  return NextResponse.json(out);
}
