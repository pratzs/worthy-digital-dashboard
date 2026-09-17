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
    // Do CREDIT notes carry a salesperson? If not, credits never reduce a rep's revenue.
    creditsByRep: `SELECT SALESPERSON, INVOICEORCREDIT, COUNT(*) AS N, SUM(INVOICENETTAMOUNT) AS NETT ` +
                  `FROM SALESINVOICEHEADER WHERE ${Y} GROUP BY SALESPERSON, INVOICEORCREDIT ORDER BY SALESPERSON`,

    // Is there a salesperson master table we can resolve names from dynamically?
    spTable1: `SELECT FIRST 5 * FROM SALESPERSON`,
    spTable2: `SELECT FIRST 5 * FROM SALESPEOPLE`,
    spTable3: `SELECT FIRST 5 * FROM EMPLOYEEMASTER`,

    // Rebates: zero-cost lines with a negative net — what are they called?
    rebateLines: `SELECT FIRST 20 LINECODE, LINEDESCRIPTION, CATALOGUECATEGORY, COUNT(*) AS N, ` +
                 `SUM(EXTENDEDNETTPRICE) AS NETT FROM SALESINVOICELINES ` +
                 `WHERE INVOICENUMBER IN (SELECT INVOICENUMBER FROM SALESINVOICEHEADER WHERE ${Y}) ` +
                 `AND INVOICEUNITCOST = 0 AND EXTENDEDNETTPRICE < 0 ` +
                 `GROUP BY LINECODE, LINEDESCRIPTION, CATALOGUECATEGORY ORDER BY 5`,

    // What CODETYPEs exist on lines (stock vs descriptor vs service)?
    codeTypes: `SELECT CODETYPE, COUNT(*) AS N, SUM(EXTENDEDNETTPRICE) AS NETT, ` +
               `SUM(INVOICEQTY * INVOICEUNITCOST) AS COST FROM SALESINVOICELINES ` +
               `WHERE INVOICENUMBER IN (SELECT INVOICENUMBER FROM SALESINVOICEHEADER WHERE ${Y}) ` +
               `GROUP BY CODETYPE`,
  };

  const out = {};
  for (const [name, sql] of Object.entries(queries)) {
    out[name] = { sql, result: await ostendoSql(sql) };
  }
  return NextResponse.json(out);
}
