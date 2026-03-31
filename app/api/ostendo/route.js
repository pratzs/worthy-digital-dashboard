import { NextResponse } from 'next/server';
import https from 'node:https';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// Custom HTTPS agent to handle self-signed certs on the Ostendo server
const agent = new https.Agent({ rejectUnauthorized: false });

/**
 * Fetch a table from the Ostendo REST API.
 * Endpoint: GET /tabledata?tablename=TABLE&apikey=KEY&format=json[&condition=SQL_WHERE]
 *
 * NOTE: Ostendo column names may need adjusting to match your specific
 * Ostendo version. Common alternatives are listed in comments below.
 */
async function ostendoFetch(tablename, condition = null) {
  const base    = process.env.OSTENDO_BASE_URL;   // e.g. https://ostendo.dutchrusk.co.nz:442
  const apiKey  = process.env.OSTENDO_API_KEY;    // decoded (no %3D%3D)
  const encoded = encodeURIComponent(apiKey);

  const url = new URL(`${base}/tabledata`);
  url.searchParams.set('tablename', tablename);
  url.searchParams.set('apikey',    encoded);
  url.searchParams.set('format',    'json');
  if (condition) url.searchParams.set('condition', condition);

  return new Promise((resolve, reject) => {
    const urlObj = new URL(url.toString());
    const options = {
      hostname: urlObj.hostname,
      port:     parseInt(urlObj.port) || 443,
      path:     urlObj.pathname + urlObj.search,
      method:   'GET',
      agent,
    };

    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', chunk => (raw += chunk));
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch { resolve([]); }
      });
    });
    req.setTimeout(20000, () => { req.destroy(); reject(new Error('Ostendo request timed out')); });
    req.on('error', reject);
    req.end();
  });
}

/**
 * Safely read a field value from an Ostendo row, trying multiple common column
 * name variants (Ostendo versions differ in naming convention).
 */
function col(row, ...names) {
  for (const n of names) {
    if (row[n] !== undefined && row[n] !== null && row[n] !== '') return row[n];
  }
  return null;
}

const parseNum = (v) => (v === null || v === undefined) ? 0 : parseFloat(v) || 0;
const parseDate = (v) => {
  if (!v) return null;
  // Ostendo dates come as "YYYY-MM-DD", "DD/MM/YYYY", or ISO strings
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return new Date(s.substring(0, 10));
  if (/^\d{2}\/\d{2}\/\d{4}/.test(s)) {
    const [d, m, y] = s.split('/');
    return new Date(`${y}-${m}-${d}`);
  }
  const d = new Date(s);
  return isNaN(d) ? null : d;
};

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const year = parseInt(searchParams.get('year') || new Date().getFullYear());

  const yearStart = `${year}-01-01`;
  const yearEnd   = `${year}-12-31`;

  try {
    // ── 1. Fetch invoices for the year ───────────────────────────────────────
    // Ostendo table: SALESINVOICEHEADER
    // Common column names tried: INVOICEDATE | INVDATE | DOCDATE
    //                            TOTALEX | TOTALEXGSTTAX | NETSALESVALUE | ORDERTOTAL
    //                            CUSTOMERCODE | CUSTCODE | CUSTOMER
    //                            INVOICENUMBER | DOCNUMBER | INVNUMBER
    const condition = `INVOICEDATE >= '${yearStart}' AND INVOICEDATE <= '${yearEnd}'`;
    const invoices  = await ostendoFetch('SALESINVOICEHEADER', condition);

    const rows = Array.isArray(invoices)
      ? invoices
      : invoices?.rows || invoices?.data || invoices?.records || [];

    // ── 2. Aggregate by month ────────────────────────────────────────────────
    const monthly = MONTH_NAMES.map((m, i) => ({
      month: m, revenue: 0, totalCost: 0, grossProfit: 0, marginPct: null,
      orders: 0, returns: 0, sessions: 0, totalDiscounts: 0,
      aov: 0, convRate: 0, newCustomers: 0, hasCostData: false,
      marginableRevenue: 0,
    }));

    for (const row of rows) {
      const dateVal = col(row, 'INVOICEDATE', 'INVDATE', 'DOCDATE', 'DATE', 'InvoiceDate', 'invoicedate');
      const d = parseDate(dateVal);
      if (!d || d.getFullYear() !== year) continue;

      const mi  = d.getMonth(); // 0-indexed
      const rev = parseNum(col(row, 'TOTALEX', 'TOTALEXGSTTAX', 'NETSALESVALUE', 'ORDERTOTAL',
                                    'TOTALEXCLTAX', 'SALESVALUE', 'TotalEx', 'totalex'));
      const disc = parseNum(col(row, 'DISCOUNTAMOUNT', 'DISCOUNT', 'TOTALDISCOUNT', 'DISCOUNTVALUE'));

      monthly[mi].revenue        += rev;
      monthly[mi].totalDiscounts += disc;
      monthly[mi].orders         += 1;
    }

    // Compute AOV for each month
    for (const m of monthly) {
      m.aov = m.orders > 0 ? Math.round(m.revenue / m.orders) : 0;
    }

    // ── 3. Fetch prior year for YoY (best-effort, don't fail if unavailable) ─
    // (not needed here — the dashboard fetches years independently)

    // ── 4. Salesperson data from SALESREP or INVOICEHEADER ──────────────────
    // Try to aggregate net sales by SALESREPCODE / REPNAME from invoices
    const repMap = {};
    for (const row of rows) {
      const dateVal = col(row, 'INVOICEDATE', 'INVDATE', 'DOCDATE', 'DATE', 'InvoiceDate');
      const d = parseDate(dateVal);
      if (!d || d.getFullYear() !== year) continue;

      const rep = col(row, 'SALESREPCODE', 'REPCODE', 'SALESREP', 'REPNAME', 'STAFFCODE', 'SALESPERSON');
      if (!rep) continue;

      const rev = parseNum(col(row, 'TOTALEX', 'TOTALEXGSTTAX', 'NETSALESVALUE', 'ORDERTOTAL',
                                    'TOTALEXCLTAX', 'SALESVALUE'));
      if (!repMap[rep]) repMap[rep] = { name: rep, netSales: 0 };
      repMap[rep].netSales += rev;
    }
    const salespeople = Object.values(repMap).sort((a, b) => b.netSales - a.netSales);

    return NextResponse.json({ monthly, monthlyPos: monthly, monthlyOnline: monthly, salespeople });

  } catch (err) {
    console.error('[Ostendo] Monthly fetch error:', err.message);
    // Return empty months on error so the dashboard doesn't crash
    const empty = MONTH_NAMES.map(m => ({
      month: m, revenue: 0, totalCost: 0, grossProfit: 0, marginPct: null,
      orders: 0, returns: 0, sessions: 0, totalDiscounts: 0,
      aov: 0, convRate: 0, newCustomers: 0, hasCostData: false, marginableRevenue: 0,
    }));
    return NextResponse.json({ monthly: empty, monthlyPos: empty, monthlyOnline: empty, salespeople: [] });
  }
}
