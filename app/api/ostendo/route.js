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
 */
async function ostendoFetch(tablename, condition = null, timeoutMs = 25000) {
  const base   = process.env.OSTENDO_BASE_URL;
  const apiKey = process.env.OSTENDO_API_KEY;

  const params = new URLSearchParams({ tablename, apikey: apiKey, format: 'json' });
  const conditionStr = condition
    ? `&condition=${condition.replace(/ /g, '%20').replace(/'/g, '%27')}`
    : '';

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
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error(`Ostendo timeout: ${tablename}`)); });
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
    // ── Step 1: Fetch SALESINVOICEHEADER (same as original — sequential, safe) ─
    const yearCond = `EXTRACT(YEAR FROM INVOICEDATE) = ${year}`;
    const rawHeaders = await ostendoFetch('SALESINVOICEHEADER', yearCond, 30000);
    const headerRows = normalizeRows(rawHeaders);
    console.log(`[Ostendo/monthly] headers: ${headerRows.length}`);

    // ── Step 2: Build invoice → date map ─────────────────────────────────────
    const invDateMap = {};
    for (const row of headerRows) {
      const d   = parseDate(row.INVOICEDATE);
      const num = String(row.INVOICENUMBER ?? row.INVOICENO ?? '');
      if (d && num) invDateMap[num] = d;
    }

    // ── Step 3: Try to fetch SALESINVOICELINES for cost data (non-fatal) ─────
    // INVOICEUNITCOST × INVOICEQTY = line cost (confirmed column from advanced route)
    let lineRows = [];
    try {
      const lineCond = `INVOICENUMBER IN (SELECT INVOICENUMBER FROM SALESINVOICEHEADER WHERE EXTRACT(YEAR FROM INVOICEDATE) = ${year})`;
      const rawLines = await ostendoFetch('SALESINVOICELINES', lineCond, 40000);
      lineRows = normalizeRows(rawLines);
      console.log(`[Ostendo/monthly] lines: ${lineRows.length}`);
    } catch (e) {
      console.warn('[Ostendo/monthly] Lines fetch failed — margins will show as N/A:', e.message);
    }

    // ── Step 4: Aggregate cost per month and week from lines ─────────────────
    const monthlyCost    = Array(12).fill(0);
    const monthlyHasCost = Array(12).fill(false);
    const weeklyCostMap  = {}; // key `${mi}_${weekNum}` → total cost

    for (const line of lineRows) {
      const invNum  = String(line.INVOICENUMBER ?? line.INVOICENO ?? '');
      const d       = invDateMap[invNum];
      if (!d || d.getFullYear() !== year) continue;
      const mi      = d.getMonth();
      const weekNum = Math.ceil(d.getDate() / 7);
      const qty     = parseNum(line.INVOICEQTY);
      const unitCost= parseNum(line.INVOICEUNITCOST);
      const cost    = qty * unitCost;
      if (unitCost > 0) {
        monthlyCost[mi]    += cost;
        monthlyHasCost[mi]  = true;
        const wkey = `${mi}_${weekNum}`;
        weeklyCostMap[wkey] = (weeklyCostMap[wkey] || 0) + cost;
      }
    }

    // ── Step 5: Aggregate monthly revenue from headers ───────────────────────
    const monthly = MONTH_NAMES.map(m => ({
      month: m, revenue: 0, totalCost: 0, grossProfit: 0, marginPct: null,
      orders: 0, returns: 0, sessions: 0, totalDiscounts: 0,
      aov: 0, convRate: 0, newCustomers: 0, hasCostData: false, marginableRevenue: 0,
    }));

    const weeklyRevBuckets = {}; // key `${mi}_${weekNum}` → { revenue, orders, totalDiscounts }

    for (const row of headerRows) {
      const d = parseDate(row.INVOICEDATE);
      if (!d || d.getFullYear() !== year) continue;
      const mi      = d.getMonth();
      const weekNum = Math.ceil(d.getDate() / 7);
      const rev     = parseNum(row.INVOICENETTAMOUNT ?? row.INVOICETOTALAMOUNT ?? row.INVOICEVALUE);
      const disc    = parseNum(row.LINEDISCOUNTAMOUNT ?? row.DISCOUNTAMOUNT);

      monthly[mi].revenue        += rev;
      monthly[mi].totalDiscounts += disc;
      monthly[mi].orders         += 1;

      const wkey = `${mi}_${weekNum}`;
      if (!weeklyRevBuckets[wkey]) weeklyRevBuckets[wkey] = { revenue: 0, orders: 0, totalDiscounts: 0 };
      weeklyRevBuckets[wkey].revenue        += rev;
      weeklyRevBuckets[wkey].orders         += 1;
      weeklyRevBuckets[wkey].totalDiscounts += disc;
    }

    // ── Step 6: Finalise monthly (with cost/margin where available) ──────────
    for (let mi = 0; mi < 12; mi++) {
      const m   = monthly[mi];
      const cst = monthlyCost[mi];
      m.revenue        = Math.round(m.revenue);
      m.totalDiscounts = Math.round(m.totalDiscounts);
      m.aov            = m.orders > 0 ? Math.round(m.revenue / m.orders) : 0;
      m.totalCost      = Math.round(cst);
      m.hasCostData    = monthlyHasCost[mi];
      if (m.hasCostData && m.revenue > 0) {
        m.grossProfit       = Math.round(m.revenue - cst);
        m.marginPct         = Math.round(((m.revenue - cst) / m.revenue) * 100);
        m.marginableRevenue = m.revenue;
      }
    }

    // ── Step 7: Build weekly array ────────────────────────────────────────────
    const getDaysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();
    const weekly = [];
    for (let mi = 0; mi < 12; mi++) {
      for (let w = 1; w <= 5; w++) {
        const startDay = (w - 1) * 7 + 1;
        const endDay   = Math.min(w * 7, getDaysInMonth(year, mi));
        if (startDay > getDaysInMonth(year, mi)) continue;
        const wkey    = `${mi}_${w}`;
        const b       = weeklyRevBuckets[wkey];
        const wCost   = weeklyCostMap[wkey] || 0;
        const wRev    = b ? b.revenue : 0;
        const hasCost = wCost > 0;
        const gp      = hasCost ? Math.round(wRev - wCost) : null;
        const margin  = hasCost && wRev > 0 ? Math.round(((wRev - wCost) / wRev) * 100) : null;
        weekly.push({
          label:          `${MONTH_NAMES[mi]} W${w}`,
          month:          mi,
          week:           w,
          dateRange:      `${startDay}–${endDay} ${MONTH_NAMES[mi]}`,
          revenue:        Math.round(wRev),
          orders:         b ? b.orders : 0,
          aov:            b && b.orders > 0 ? Math.round(wRev / b.orders) : 0,
          totalCost:      Math.round(wCost),
          grossProfit:    gp,
          marginPct:      margin,
          hasCostData:    hasCost,
          totalDiscounts: b ? Math.round(b.totalDiscounts) : 0,
          newCustomers:   0,
        });
      }
    }

    const salespeople = [];

    return NextResponse.json({
      monthly,
      monthlyPos:    monthly,
      monthlyOnline: monthly,
      weekly,
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
      monthly: empty, monthlyPos: empty, monthlyOnline: empty, weekly: [], salespeople: [],
      error: err.message,
    });
  }
}
