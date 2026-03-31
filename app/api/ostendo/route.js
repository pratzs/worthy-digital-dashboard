import { NextResponse } from 'next/server';
import https from 'node:https';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// Custom HTTPS agent — handles self-signed certs on ostendo.dutchrusk.co.nz:442
const agent = new https.Agent({ rejectUnauthorized: false });

/**
 * Fetch a table from the Ostendo REST API.
 * GET /tabledata?tablename=TABLE&apikey=KEY&format=json[&condition=SQL_WHERE]
 *
 * Column names confirmed from Dutch Rusk Ostendo schema (Table for Queries.rps):
 *   SALESINVOICEHEADER → INVOICEDATE, INVOICENO, INVOICECUSTOMER,
 *                         INVOICENETTAMOUNT, INVOICETOTALAMOUNT, DISCOUNTAMOUNT
 */
async function ostendoFetch(tablename, condition = null) {
  const base   = process.env.OSTENDO_BASE_URL;
  const apiKey = process.env.OSTENDO_API_KEY;

  // URLSearchParams for safe params only; condition appended manually with %20
  // Ostendo's Firebird parser requires %20 for spaces — URLSearchParams uses + which breaks SQL
  const params = new URLSearchParams({ tablename, apikey: apiKey, format: 'json' });
  const conditionStr = condition ? `&condition=${condition.replace(/ /g, '%20')}` : '';

  return new Promise((resolve, reject) => {
    const urlObj = new URL(base);
    const options = {
      hostname: urlObj.hostname,
      port:     parseInt(urlObj.port) || 443,
      path:     `/tabledata?${params.toString()}${conditionStr}`,
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
    req.setTimeout(25000, () => { req.destroy(); reject(new Error('Ostendo timeout')); });
    req.on('error', reject);
    req.end();
  });
}

const normalizeRows = (res) =>
  Array.isArray(res) ? res : res?.rows || res?.data || res?.records || [];

const parseNum = (v) => (v === null || v === undefined) ? 0 : parseFloat(v) || 0;
const parseDate = (v) => {
  if (!v) return null;
  const s = String(v).trim();
  // YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return new Date(s.substring(0, 10));
  // D/MM/YYYY or DD/MM/YYYY (Ostendo format e.g. "3/03/2025")
  if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(s)) {
    const [d, m, y] = s.split('/');
    return new Date(`${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`);
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
    // ── Fetch SALESINVOICEHEADER for the year ────────────────────────────────
    // Use EXTRACT() to avoid >= / <= encoding issues with Ostendo's Firebird SQL parser
    const condition = `EXTRACT(YEAR FROM INVOICEDATE) = ${year}`;
    const raw = await ostendoFetch('SALESINVOICEHEADER', condition);
    const rows = normalizeRows(raw);

    // ── Aggregate by month ───────────────────────────────────────────────────
    const monthly = MONTH_NAMES.map(m => ({
      month: m, revenue: 0, totalCost: 0, grossProfit: 0, marginPct: null,
      orders: 0, returns: 0, sessions: 0, totalDiscounts: 0,
      aov: 0, convRate: 0, newCustomers: 0, hasCostData: false, marginableRevenue: 0,
    }));

    for (const row of rows) {
      const d = parseDate(row.INVOICEDATE);
      if (!d || d.getFullYear() !== year) continue;

      const mi  = d.getMonth();
      // INVOICENETTAMOUNT = excl. tax  |  fallback to INVOICETOTALAMOUNT
      const rev  = parseNum(row.INVOICENETTAMOUNT ?? row.INVOICETOTALAMOUNT ?? row.INVOICEVALUE);
      const disc = parseNum(row.LINEDISCOUNTAMOUNT ?? row.DISCOUNTAMOUNT);

      monthly[mi].revenue        += rev;
      monthly[mi].totalDiscounts += disc;
      monthly[mi].orders         += 1;
    }

    for (const m of monthly) {
      m.aov = m.orders > 0 ? Math.round(m.revenue / m.orders) : 0;
      m.revenue = Math.round(m.revenue);
      m.totalDiscounts = Math.round(m.totalDiscounts);
    }

    // ── Salespeople: group by INVOICECUSTOMER or agent if available ──────────
    // Ostendo doesn't always store rep on invoice — return empty array for now;
    // the Advanced route handles rep aggregation if the data is available.
    const salespeople = [];

    return NextResponse.json({
      monthly,
      monthlyPos:    monthly,
      monthlyOnline: monthly,
      salespeople,
    });

  } catch (err) {
    console.error('[Ostendo] Monthly fetch error:', err.message);
    const empty = MONTH_NAMES.map(m => ({
      month: m, revenue: 0, totalCost: 0, grossProfit: 0, marginPct: null,
      orders: 0, returns: 0, sessions: 0, totalDiscounts: 0,
      aov: 0, convRate: 0, newCustomers: 0, hasCostData: false, marginableRevenue: 0,
    }));
    return NextResponse.json({
      monthly: empty, monthlyPos: empty, monthlyOnline: empty, salespeople: [],
      error: err.message,
    });
  }
}
