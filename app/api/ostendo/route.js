import { NextResponse } from 'next/server';
import https from 'node:https';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// Custom HTTPS agent — handles self-signed certs on ostendo.dutchrusk.co.nz:442
const agent = new https.Agent({ rejectUnauthorized: false });

async function ostendoFetch(tablename, condition = null) {
  const base   = process.env.OSTENDO_BASE_URL;
  const apiKey = process.env.OSTENDO_API_KEY;

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
    // ── Fetch SALESINVOICEHEADER for the year ────────────────────────────────
    const condition = `EXTRACT(YEAR FROM INVOICEDATE) = ${year}`;
    const raw  = await ostendoFetch('SALESINVOICEHEADER', condition);
    const rows = normalizeRows(raw);

    // ── Aggregate by month ───────────────────────────────────────────────────
    const monthly = MONTH_NAMES.map(m => ({
      month: m, revenue: 0, totalCost: 0, grossProfit: 0, marginPct: null,
      orders: 0, returns: 0, sessions: 0, totalDiscounts: 0,
      aov: 0, convRate: 0, newCustomers: 0, hasCostData: false, marginableRevenue: 0,
    }));

    // Weekly revenue buckets: key = "${monthIdx}_${weekNum}"
    const weeklyRevBuckets = {};

    const repData = {};

    for (const row of rows) {
      const d = parseDate(row.INVOICEDATE);
      if (!d || d.getFullYear() !== year) continue;

      const mi      = d.getMonth();
      const day     = d.getDate();
      const weekNum = Math.ceil(day / 7);
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

      // Per-salesperson aggregation
      const repName = (row.SALESPERSON && String(row.SALESPERSON).trim()) || 'Unassigned';
      if (!repData[repName]) {
        repData[repName] = {
          monthly: Array.from({ length: 12 }, () => ({ revenue: 0, orders: 0 })),
          weeklyBuckets: {},
        };
      }
      repData[repName].monthly[mi].revenue += rev;
      repData[repName].monthly[mi].orders  += 1;
      const rwkey = `${mi}_${weekNum}`;
      if (!repData[repName].weeklyBuckets[rwkey]) repData[repName].weeklyBuckets[rwkey] = { revenue: 0, orders: 0 };
      repData[repName].weeklyBuckets[rwkey].revenue += rev;
      repData[repName].weeklyBuckets[rwkey].orders  += 1;
    }

    for (const m of monthly) {
      m.aov            = m.orders > 0 ? Math.round(m.revenue / m.orders) : 0;
      m.revenue        = Math.round(m.revenue);
      m.totalDiscounts = Math.round(m.totalDiscounts);
    }

    // ── Build weekly array ────────────────────────────────────────────────────
    const getDaysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();
    const weekly = [];
    for (let mi = 0; mi < 12; mi++) {
      for (let w = 1; w <= 5; w++) {
        const startDay = (w - 1) * 7 + 1;
        const endDay   = Math.min(w * 7, getDaysInMonth(year, mi));
        if (startDay > getDaysInMonth(year, mi)) continue;
        const wkey = `${mi}_${w}`;
        const b    = weeklyRevBuckets[wkey];
        weekly.push({
          label:          `${MONTH_NAMES[mi]} W${w}`,
          month:          mi,
          week:           w,
          dateRange:      `${startDay}–${endDay} ${MONTH_NAMES[mi]}`,
          revenue:        b ? Math.round(b.revenue)        : 0,
          orders:         b ? b.orders                     : 0,
          aov:            b && b.orders > 0 ? Math.round(b.revenue / b.orders) : 0,
          totalCost:      0,
          grossProfit:    null,
          marginPct:      null,
          hasCostData:    false,
          totalDiscounts: b ? Math.round(b.totalDiscounts) : 0,
          newCustomers:   0,
        });
      }
    }

    const getDaysInMonthO = (y, m) => new Date(y, m + 1, 0).getDate();

    const salespeople = Object.entries(repData).map(([name, d]) => {
      const totalRev = d.monthly.reduce((s, m) => s + m.revenue, 0);
      const totalOrd = d.monthly.reduce((s, m) => s + m.orders,  0);
      return { name, revenue: Math.round(totalRev), orders: totalOrd, aov: totalOrd > 0 ? Math.round(totalRev / totalOrd) : 0 };
    }).sort((a, b) => b.revenue - a.revenue);

    const salespeopleMonthly = Object.entries(repData).map(([name, d]) => ({
      name,
      months: d.monthly.map((m, mi) => ({ month: MONTH_NAMES[mi], revenue: Math.round(m.revenue), orders: m.orders })),
    })).sort((a, b) => b.months.reduce((s, m) => s + m.revenue, 0) - a.months.reduce((s, m) => s + m.revenue, 0));

    const salespeopleWeekly = Object.entries(repData).map(([name, d]) => {
      const wkly = [];
      for (let mi = 0; mi < 12; mi++) {
        for (let w = 1; w <= 5; w++) {
          if ((w - 1) * 7 + 1 > getDaysInMonthO(year, mi)) continue;
          const b = d.weeklyBuckets[`${mi}_${w}`];
          wkly.push({ month: mi, week: w, revenue: b ? Math.round(b.revenue) : 0, orders: b ? b.orders : 0 });
        }
      }
      return { name, weekly: wkly };
    }).sort((a, b) => b.weekly.reduce((s, w) => s + w.revenue, 0) - a.weekly.reduce((s, w) => s + w.revenue, 0));

    return NextResponse.json({
      monthly,
      monthlyPos:    monthly,
      monthlyOnline: monthly,
      weekly,
      salespeople,
      salespeopleMonthly,
      salespeopleWeekly,
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
