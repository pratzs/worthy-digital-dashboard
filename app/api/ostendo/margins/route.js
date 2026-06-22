import { NextResponse } from 'next/server';
import https from 'node:https';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const agent = new https.Agent({ rejectUnauthorized: false });

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const REP_NAMES = {
  '410': 'Kevin', '420': 'Michelle', '430': 'Keith',
  '450': 'Nelson Office Online Sales', '460': 'Chris',
  '470': 'Lynette', '490': 'Leith',
};
const resolveRep = (raw) => {
  if (!raw) return 'Unassigned';
  const code = String(raw).trim();
  const base = code.replace(/-\d+$/, '');
  return REP_NAMES[base] || REP_NAMES[code] || code;
};

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
    const yearCond = `EXTRACT(YEAR FROM INVOICEDATE) = ${year}`;

    // Run in parallel: headers (revenue + rep + date) and per-invoice cost aggregate
    const [rawHeaders, rawCosts] = await Promise.all([
      ostendoGet('SALESINVOICEHEADER', yearCond),
      ostendoSql(
        // INVOICEUNITCOST is the average cost at invoice time (Ostendo's Average Cost
        // valuation method writes it to the line when posted — it is NOT the current
        // ITEMMASTER.AVERAGECOST, which changes as new stock arrives).
        // HAVING <> 0 (not WHERE > 0) so return/credit invoices with negative totals
        // are included and correctly reduce COGS.
        `SELECT INVOICENUMBER, ` +
        `SUM(INVOICEQTY * INVOICEUNITCOST) AS TOTALCOST ` +
        `FROM SALESINVOICELINES ` +
        `WHERE INVOICENUMBER IN (SELECT INVOICENUMBER FROM SALESINVOICEHEADER WHERE ${yearCond}) ` +
        `GROUP BY INVOICENUMBER ` +
        `HAVING SUM(INVOICEQTY * INVOICEUNITCOST) <> 0`
      ).catch(e => {
        console.warn('[Ostendo/margins] sqlquery failed:', e.message);
        return [];
      }),
    ]);

    const headerRows = normalizeRows(rawHeaders);
    const costRows   = normalizeRows(rawCosts);

    console.log(`[Ostendo/margins] headers: ${headerRows.length}, cost rows: ${costRows.length}`);

    const getInvNum = (r) => String(r.INVOICENUMBER ?? r.INVOICENO ?? r.InvoiceNumber ?? r.InvoiceNo ?? '').trim();

    // Build invoice → date map
    const invDateMap = {};
    for (const row of headerRows) {
      const d   = parseDate(row.INVOICEDATE);
      const num = getInvNum(row);
      if (d && num) invDateMap[num] = d;
    }

    // Build invoice → totalCost map
    const invCostMap = {};
    for (const row of costRows) {
      const num  = getInvNum(row);
      const cost = parseNum(row.TOTALCOST ?? row.totalcost ?? row.LINECOST);
      if (num && cost !== 0) invCostMap[num] = cost;
    }

    // ── Overall monthly/weekly aggregates (used by KPI cards) ───────────────────
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

    const monthly = MONTH_NAMES.map((m, mi) => ({
      month:       m,
      totalCost:   monthlyCost[mi],          // keep full precision — margin calc needs this unrounded
      hasCostData: monthlyHasCost[mi],
    }));

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
          totalCost:   weeklyCostMap[wkey] || 0,  // keep full precision — margin calc needs this unrounded
          hasCostData: !!(weeklyCostMap[wkey]),
        });
      }
    }

    // ── Per-rep margins (independent from analytics tables) ─────────────────────
    // Revenue comes from INVOICENETTAMOUNT in headers (same source as main route).
    // Cost comes from the SQL aggregation above (per invoice, no line scan needed).
    const repAgg = {};
    for (const row of headerRows) {
      const num  = getInvNum(row);
      const d    = invDateMap[num];
      if (!d || d.getFullYear() !== year) continue;
      const rep  = resolveRep(row.SALESPERSON);
      const rev  = parseNum(row.INVOICENETTAMOUNT ?? row.INVOICETOTALAMOUNT ?? row.INVOICEVALUE);
      const cost = invCostMap[num] || 0;
      const mi   = d.getMonth();
      const wk   = Math.ceil(d.getDate() / 7);
      const wkey = `${mi}_${wk}`;

      if (!repAgg[rep]) repAgg[rep] = {
        revenue: 0, cost: 0,
        monthly: Array.from({length: 12}, () => ({revenue: 0, cost: 0})),
        weekly:  {},
      };
      repAgg[rep].revenue += rev;
      repAgg[rep].cost    += cost;
      repAgg[rep].monthly[mi].revenue += rev;
      repAgg[rep].monthly[mi].cost    += cost;
      if (!repAgg[rep].weekly[wkey]) repAgg[rep].weekly[wkey] = {revenue: 0, cost: 0};
      repAgg[rep].weekly[wkey].revenue += rev;
      repAgg[rep].weekly[wkey].cost    += cost;
    }

    const pct1 = (num, den) => den > 0 ? parseFloat(((num / den) * 100).toFixed(1)) : null;

    const repMargins = Object.entries(repAgg).map(([name, r]) => {
      const gp = r.revenue - r.cost;
      const months = r.monthly.map((m, mi) => {
        const mGP = m.revenue - m.cost;
        return {
          month: MONTH_NAMES[mi],
          revenue:     Math.round(m.revenue),
          cost:        Math.round(m.cost),
          grossProfit: Math.round(mGP),
          marginPct:   pct1(mGP, m.revenue),
        };
      });
      const weeks = Object.entries(r.weekly).map(([key, w]) => {
        const [moIdx, wkIdx] = key.split('_').map(Number);
        const wGP = w.revenue - w.cost;
        return {
          month: moIdx, week: wkIdx,
          revenue:     Math.round(w.revenue),
          cost:        Math.round(w.cost),
          grossProfit: Math.round(wGP),
          marginPct:   pct1(wGP, w.revenue),
        };
      });
      return {
        name,
        revenue:           Math.round(r.revenue),
        cost:              Math.round(r.cost),
        grossProfit:       Math.round(gp),
        marginableRevenue: Math.round(r.revenue),
        marginPct:         pct1(gp, r.revenue),
        months, weeks,
      };
    }).sort((a, b) => b.revenue - a.revenue);

    console.log(`[Ostendo/margins] repMargins computed: ${repMargins.length} reps`);

    return NextResponse.json({ monthly, weekly, repMargins });

  } catch (err) {
    console.error('[Ostendo/margins] error:', err.message);
    return NextResponse.json({ monthly: [], weekly: [], repMargins: [], error: err.message }, { status: 500 });
  }
}
