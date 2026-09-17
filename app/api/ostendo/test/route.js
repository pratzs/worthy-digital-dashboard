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
  const queries = {
    // Q1 — credit notes: how many, and is the amount signed?
    byOrCredit: `SELECT INVOICEORCREDIT, COUNT(*) AS N, SUM(INVOICENETTAMOUNT) AS NETT, ` +
                `MIN(INVOICENETTAMOUNT) AS MINV, MAX(INVOICENETTAMOUNT) AS MAXV ` +
                `FROM SALESINVOICEHEADER WHERE ${Y} GROUP BY INVOICEORCREDIT`,

    // Q2 — statuses present, and the value sitting behind each
    byStatus:   `SELECT INVOICESTATUS, COUNT(*) AS N, SUM(INVOICENETTAMOUNT) AS NETT ` +
                `FROM SALESINVOICEHEADER WHERE ${Y} GROUP BY INVOICESTATUS`,

    // Q3 — how many headers carry a negative nett (i.e. credits already signed)
    negatives:  `SELECT COUNT(*) AS N, SUM(INVOICENETTAMOUNT) AS NETT FROM SALESINVOICEHEADER ` +
                `WHERE ${Y} AND INVOICENETTAMOUNT < 0`,

    // Q4 — header total vs line total for the same year (revenue-base reconciliation)
    headerTotal: `SELECT COUNT(*) AS N, SUM(INVOICENETTAMOUNT) AS NETT FROM SALESINVOICEHEADER WHERE ${Y}`,
    lineTotal:   `SELECT SUM(EXTENDEDNETTPRICE) AS LINENETT, SUM(INVOICEQTY * INVOICEUNITCOST) AS LINECOST ` +
                 `FROM SALESINVOICELINES WHERE INVOICENUMBER IN ` +
                 `(SELECT INVOICENUMBER FROM SALESINVOICEHEADER WHERE ${Y})`,

    // Q5 — lines carrying revenue but no cost (inflates margin)
    zeroCostLines: `SELECT COUNT(*) AS N, SUM(EXTENDEDNETTPRICE) AS NETT FROM SALESINVOICELINES ` +
                   `WHERE INVOICENUMBER IN (SELECT INVOICENUMBER FROM SALESINVOICEHEADER WHERE ${Y}) ` +
                   `AND INVOICEUNITCOST = 0 AND EXTENDEDNETTPRICE <> 0`,
  };

  const out = {};
  for (const [name, sql] of Object.entries(queries)) {
    out[name] = { sql, result: await ostendoSql(sql) };
  }
  return NextResponse.json(out);
}
