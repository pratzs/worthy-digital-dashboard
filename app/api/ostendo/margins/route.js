import { NextResponse } from 'next/server';
import https from 'node:https';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const agent = new https.Agent({ rejectUnauthorized: false });

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// GET /tabledata — for fetching SALESINVOICEHEADER (invoice dates)
async function ostendoGet(tablename, condition) {
  const base   = process.env.OSTENDO_BASE_URL;
  const apiKey = process.env.OSTENDO_API_KEY;
  const params = new URLSearchParams({ tablename, apikey: apiKey, format: 'json' });
  const condStr = `&condition=${condition.replace(/ /g, '%20')}`;

  return new Promise((resolve, reject) => {
    const urlObj = new URL(base);
    const req = https.request({
      hostname: urlObj.hostname,
      port:     parseInt(urlObj.port) || 443,
      path:     `/tabledata?${params.toString()}${condStr}`,
      method:   'GET',
      agent,
    }, (res) => {
      let raw = '';
      res.on('data', c => (raw += c));
      res.on('end', () => { try { resolve(JSON.parse(raw)); } catch { resolve([]); } });
    });
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('timeout:headers')); });
    req.on('error', reject);
    req.end();
  });
}

// POST /sqlquery — for running aggregated SQL (cost per invoice)
async function ostendoSql(sql) {
  const base   = process.env.OSTENDO_BASE_URL;
  const apiKey = process.env.OSTENDO_API_KEY;
  const urlObj = new URL(base);
  const body   = Buffer.from(sql, 'utf8');

  return new Promise((resolve, reject) => {
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
      res.on('end', () => { try { resolve(JSON.parse(raw)); } catch { resolve([]); } });
    });
    req.setTimeout(35000, () => { req.destroy(); reject(new Error('timeout:sqlquery')); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

const normalizeRows = (res) =>
  Array.isArray(res) ? res : res?.rows || res?.data || res?.records || [];

const parseNum  = (v) => (!v && v !== 0) ? 0 : parseFloat(v) || 0;
const parseDate = (v) => {
  if (!v) return null;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return new Date(s.substring(0, 10));
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

  try {
    // Run both fetches in parallel:
    // 1. Headers → to get INVOICEDATE per invoice
    // 2. SQL query → to get total cost per invoice (INVOICEQTY × INVOICEUNITCOST)
    const [rawHeaders, rawCosts] = await Promise.all([
      ostendoGet('SALESINVOICEHEADER', `EXTRACT(YEAR FROM INVOICEDATE) = ${year}`),
      ostendoSql(
        `SELECT INVOICENUMBER, SUM(INVOICEQTY * INVOICEUNITCOST) AS TOTALCOST ` +
        `FROM SALESINVOICELINES ` +
        `WHERE INVOICENUMBER IN (SELECT INVOICENUMBER FROM SALESINVOICEHEADER WHERE EXTRACT(YEAR FROM INVOICEDATE) = ${year}) ` +
        `AND INVOICEUNITCOST > 0 ` +
        `GROUP BY INVOICENUMBER`
      ).catch(e => {
        console.warn('[Ostendo/margins] sqlquery failed:', e.message);
        return [];
      }),
    ]);

    const headerRows = normalizeRows(rawHeaders);
    const costRows   = normalizeRows(rawCosts);

    console.log(`[Ostendo/margins] headers: ${headerRows.length}, cost rows: ${costRows.length}`);

    // Build invoice → date map
    const invDateMap = {};
    for (const row of headerRows) {
      const d   = parseDate(row.INVOICEDATE);
      const num = String(row.INVOICENUMBER ?? row.INVOICENO ?? '');
      if (d && num) invDateMap[num] = d;
    }

    // Build invoice → totalCost map
    const invCostMap = {};
    for (const row of costRows) {
      const num  = String(row.INVOICENUMBER ?? row.INVOICENO ?? '');
      const cost = parseNum(row.TOTALCOST ?? row.totalcost ?? row.LINECOST);
      if (num && cost > 0) invCostMap[num] = cost;
    }

    // Aggregate cost by month and week
    const monthlyCost    = Array(12).fill(0);
    const monthlyHasCost = Array(12).fill(false);
    const weeklyCostMap  = {};

    for (const [invNum, cost] of Object.entries(invCostMap)) {
      const d = invDateMap[invNum];
      if (!d || d.getFullYear() !== year) continue;
      const mi      = d.getMonth();
      const weekNum = Math.ceil(d.getDate() / 7);
      monthlyCost[mi]    += cost;
      monthlyHasCost[mi]  = true;
      const wkey = `${mi}_${weekNum}`;
      weeklyCostMap[wkey] = (weeklyCostMap[wkey] || 0) + cost;
    }

    // Build monthly cost array
    const monthly = MONTH_NAMES.map((m, mi) => ({
      month:       m,
      totalCost:   Math.round(monthlyCost[mi]),
      hasCostData: monthlyHasCost[mi],
    }));

    // Build weekly cost array
    const getDaysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();
    const weekly = [];
    for (let mi = 0; mi < 12; mi++) {
      for (let w = 1; w <= 5; w++) {
        const startDay = (w - 1) * 7 + 1;
        if (startDay > getDaysInMonth(year, mi)) continue;
        const wkey = `${mi}_${w}`;
        weekly.push({
          month:       mi,
          week:        w,
          totalCost:   Math.round(weeklyCostMap[wkey] || 0),
          hasCostData: !!(weeklyCostMap[wkey]),
        });
      }
    }

    return NextResponse.json({ monthly, weekly });

  } catch (err) {
    console.error('[Ostendo/margins] error:', err.message);
    return NextResponse.json({ monthly: [], weekly: [], error: err.message }, { status: 500 });
  }
}
