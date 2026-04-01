import { NextResponse } from 'next/server';
import https from 'node:https';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const agent = new https.Agent({ rejectUnauthorized: false });

/**
 * CONFIRMED column names from Dutch Rusk Ostendo (Table for Queries.rps):
 *
 *  SALESINVOICEHEADER → INVOICENUMBER, INVOICEDATE (D/MM/YYYY), CUSTOMER,
 *                        INVOICENETTAMOUNT, INVOICETOTALAMOUNT, INVOICESTATUS,
 *                        INVOICEORCREDIT, LINEDISCOUNTAMOUNT, BILLINGEMAIL
 *
 *  SALESINVOICELINES  → INVOICENUMBER (FK), ITEMCODE,
 *                        INVOICEQTY          ← correct (NOT INVOICEDQTY)
 *                        INVOICEUNITPRICE    ← unit sell price (ex-tax)
 *                        CUSTOMERUNITPRICE   ← customer-specific price (use first)
 *                        INVOICEUNITCOST     ← cost per unit
 *                        DISCOUNTAMOUNT, DISCOUNTPERCENT
 *                        INVOICEUNITTAX      ← unit tax
 *
 *  ITEMMASTER         → ITEMCODE, ITEMDESCRIPTION, ITEMCATEGORY, ITEMSUBCATEGORY,
 *                        ITEMUNIT, ITEMSTATUS,
 *                        ONHANDQTY    ← stock on hand
 *                        STDBUYPRICE  ← standard buy price (capital tied)
 *                        STDSELLPRICE, STDSELLPRICEINCTAX
 */

async function ostendoFetch(tablename, condition = null, timeoutMs = 18000) {
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
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error(`timeout:${tablename}`)); });
    req.on('error', reject);
    req.end();
  });
}

const normalizeRows = (res) =>
  Array.isArray(res) ? res : res?.rows || res?.data || res?.records || [];

const safe = async (fn) => { try { return normalizeRows(await fn()); } catch { return []; } };

/** Run async tasks with at most `limit` concurrent */
async function parallelLimit(tasks, limit = 4) {
  const results = new Array(tasks.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, tasks.length) }, async () => {
      while (next < tasks.length) {
        const idx = next++;
        results[idx] = await tasks[idx]();
      }
    })
  );
  return results;
}

/** Batch-fetch SALESINVOICELINES by INVOICENUMBER IN (...) — parallel chunks */
async function fetchLinesByInvoiceNumbers(invoiceNumbers, chunkSize = 50) {
  if (!invoiceNumbers.length) return [];
  const chunks = [];
  for (let i = 0; i < invoiceNumbers.length; i += chunkSize) {
    chunks.push(invoiceNumbers.slice(i, i + chunkSize));
  }
  const results = await parallelLimit(
    chunks.map(chunk => () => {
      const inList = chunk.map(n => `'${String(n).replace(/'/g, "''")}'`).join(',');
      return safe(() => ostendoFetch('SALESINVOICELINES', `INVOICENUMBER IN (${inList})`));
    }),
    4
  );
  return results.flat();
}

/** Batch-fetch ITEMMASTER by ITEMCODE IN (...) — parallel chunks */
async function fetchByItemCodes(codes, chunkSize = 50) {
  if (!codes.length) return [];
  const chunks = [];
  for (let i = 0; i < codes.length; i += chunkSize) {
    chunks.push(codes.slice(i, i + chunkSize));
  }
  const results = await parallelLimit(
    chunks.map(chunk => () => {
      const inList = chunk.map(c => `'${String(c).replace(/'/g, "''")}'`).join(',');
      return safe(() => ostendoFetch('ITEMMASTER', `ITEMCODE IN (${inList})`));
    }),
    4
  );
  return results.flat();
}

const parseNum  = (v) => (v === null || v === undefined || v === '') ? 0 : parseFloat(v) || 0;
const parseDate = (v) => {
  if (!v) return null;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return new Date(s.substring(0, 10));
  if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(s)) {
    const [d, m, y] = s.split('/');
    return new Date(`${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`);
  }
  const d = new Date(s);
  return isNaN(d) ? null : d;
};

/**
 * Line net revenue = INVOICEQTY × (CUSTOMERUNITPRICE or INVOICEUNITPRICE) − tax
 * CUSTOMERUNITPRICE is the actual price charged to this customer (post-discount).
 */
const lineNet = (line) => {
  const qty       = parseNum(line.INVOICEQTY);
  const unitPrice = parseNum(line.CUSTOMERUNITPRICE) || parseNum(line.INVOICEUNITPRICE);
  const unitTax   = parseNum(line.INVOICEUNITTAX);
  return qty * Math.max(unitPrice - unitTax, 0);
};

const lineCostTotal = (line) =>
  parseNum(line.INVOICEQTY) * parseNum(line.INVOICEUNITCOST);

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const today      = new Date();
  const startParam = searchParams.get('startDate') || `${today.getFullYear()}-01-01`;
  const endParam   = searchParams.get('endDate')   || today.toISOString().split('T')[0];

  try {
    const startYear = new Date(startParam).getFullYear();
    const endYear   = new Date(endParam).getFullYear();
    const prevYear  = startYear - 1;

    const makeYearCond = (yr) => `EXTRACT(YEAR FROM INVOICEDATE) = ${yr}`;
    const currCond = startYear === endYear
      ? makeYearCond(startYear)
      : `EXTRACT(YEAR FROM INVOICEDATE) >= ${startYear} AND EXTRACT(YEAR FROM INVOICEDATE) <= ${endYear}`;

    // ── PHASE 1: headers for BOTH years + current year lines — all parallel ───
    //
    // We do NOT fetch prior-year lines — header-level INVOICENETTAMOUNT is
    // accurate for customer spend, so lines are only needed for product analysis.
    //
    const [currInvRows, prevInvRows] = await Promise.all([
      safe(() => ostendoFetch('SALESINVOICEHEADER', currCond)),
      safe(() => ostendoFetch('SALESINVOICEHEADER', makeYearCond(prevYear))),
    ]);
    console.log(`[Ostendo/adv] curr headers: ${currInvRows.length}, prev headers: ${prevInvRows.length}`);

    // ── PHASE 2: current-year lines (parallel chunks) ─────────────────────────
    const currInvNums = [...new Set(currInvRows.map(r => r.INVOICENUMBER).filter(Boolean))];
    const currLineRows = await fetchLinesByInvoiceNumbers(currInvNums);
    console.log(`[Ostendo/adv] curr lines: ${currLineRows.length}`);

    // ── PHASE 3: item master for sold codes (parallel chunks) ─────────────────
    const soldCodes = [...new Set(currLineRows.map(r => r.ITEMCODE).filter(Boolean))];
    const itemRows  = await fetchByItemCodes(soldCodes);
    console.log(`[Ostendo/adv] itemRows: ${itemRows.length}`);

    const itemMap = {};
    for (const it of itemRows) {
      if (it.ITEMCODE) itemMap[it.ITEMCODE] = it;
    }

    // ── BUILD per-item revenue map from current lines ─────────────────────────
    const buildItemRevMap = (lines) => {
      const map = {};
      for (const line of lines) {
        const code = line.ITEMCODE;
        if (!code) continue;
        const rev  = lineNet(line);
        const qty  = parseNum(line.INVOICEQTY);
        const cost = lineCostTotal(line);
        if (!map[code]) map[code] = { revenue: 0, qty: 0, cost: 0 };
        map[code].revenue += rev;
        map[code].qty     += qty;
        map[code].cost    += cost;
      }
      return map;
    };

    const invDateMap = {};
    for (const inv of currInvRows) {
      if (inv.INVOICENUMBER) invDateMap[inv.INVOICENUMBER] = parseDate(inv.INVOICEDATE);
    }

    const currItemRevMap = buildItemRevMap(currLineRows);

    // ── TOP PRODUCTS ──────────────────────────────────────────────────────────
    const products = Object.entries(currItemRevMap)
      .map(([code, v]) => {
        const it     = itemMap[code] || {};
        const gp     = v.revenue - v.cost;
        const margin = v.revenue > 0 ? Math.round((gp / v.revenue) * 100) : 0;
        return {
          title:       it.ITEMDESCRIPTION || code,
          category:    it.ITEMCATEGORY || it.ITEMSUBCATEGORY || 'Uncategorised',
          revenue:     Math.round(v.revenue),
          unitsSold:   Math.round(v.qty),
          grossProfit: Math.round(gp),
          margin,
        };
      })
      .filter(p => p.revenue > 0)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 50);

    // ── TOP CATEGORIES ────────────────────────────────────────────────────────
    const catMap = {};
    for (const p of products) {
      const c = p.category;
      if (!catMap[c]) catMap[c] = { category: c, revenue: 0, unitsSold: 0, grossProfit: 0, productCount: 0 };
      catMap[c].revenue     += p.revenue;
      catMap[c].unitsSold   += p.unitsSold;
      catMap[c].grossProfit += p.grossProfit;
      catMap[c].productCount++;
    }
    const categories = Object.values(catMap)
      .sort((a, b) => b.revenue - a.revenue)
      .map(c => ({ ...c, margin: c.revenue > 0 ? Math.round((c.grossProfit / c.revenue) * 100) : 0 }));

    // ── CUSTOMERS — uses header-level INVOICENETTAMOUNT (confirmed accurate) ──
    // Combine curr + prev headers so lapsed 2025 customers appear
    const custMap = {};
    for (const inv of [...currInvRows, ...prevInvRows]) {
      const name = inv.CUSTOMER ?? inv.INVOICECUSTOMER;
      if (!name) continue;
      const d   = parseDate(inv.INVOICEDATE);
      const rev = parseNum(inv.INVOICENETTAMOUNT ?? inv.INVOICETOTALAMOUNT ?? inv.INVOICEVALUE);
      if (!custMap[name]) {
        custMap[name] = { customer: name, email: inv.BILLINGEMAIL || '', totalSpend: 0, orderCount: 0, lastOrder: null, firstOrder: null };
      }
      custMap[name].totalSpend += rev;
      custMap[name].orderCount += 1;
      if (d) {
        if (!custMap[name].lastOrder  || d > custMap[name].lastOrder)  custMap[name].lastOrder  = d;
        if (!custMap[name].firstOrder || d < custMap[name].firstOrder) custMap[name].firstOrder = d;
      }
    }

    const todayMs = Date.now();
    const customerList = Object.values(custMap)
      .sort((a, b) => b.totalSpend - a.totalSpend)
      .slice(0, 100)
      .map(c => {
        const daysSince = c.lastOrder
          ? Math.floor((todayMs - c.lastOrder.getTime()) / 86400000)
          : null;
        return {
          customer:      c.customer,
          email:         c.email,
          totalSpend:    Math.round(c.totalSpend),
          orderCount:    c.orderCount,
          aov:           c.orderCount > 0 ? Math.round(c.totalSpend / c.orderCount) : 0,
          lastOrder:     c.lastOrder  ? c.lastOrder.toISOString()  : null,
          firstOrder:    c.firstOrder ? c.firstOrder.toISOString() : null,
          lastOrderDays: daysSince,
          status: daysSince === null ? 'Unknown'
                : daysSince > 90    ? 'Lapsed'
                : daysSince > 45    ? 'At Risk'
                : 'Active',
        };
      });

    const churned = customerList.filter(c => c.status === 'Lapsed')
      .sort((a, b) => b.totalSpend - a.totalSpend);
    const atRisk  = customerList.filter(c => c.status === 'At Risk')
      .sort((a, b) => (b.lastOrderDays ?? 0) - (a.lastOrderDays ?? 0));
    const clv     = [...customerList].sort((a, b) => b.totalSpend - a.totalSpend).slice(0, 50);

    // ── SLOW-MOVING INVENTORY ─────────────────────────────────────────────────
    // Use ONHANDQTY + STDBUYPRICE from itemMap (items that appeared in any sale)
    const slowMoving = Object.values(itemMap)
      .filter(it => parseNum(it.ONHANDQTY) > 0)
      .map(it => {
        const code      = it.ITEMCODE;
        const onHand    = parseNum(it.ONHANDQTY);
        const soldQty   = currItemRevMap[code]?.qty || 0;
        const buyPrice  = parseNum(it.STDBUYPRICE) ||
                          parseNum(it.ITEMAVERAGECOST) ||
                          parseNum(it.STDSELLPRICE) * 0.7;
        const capitalTied = Math.round(onHand * buyPrice);
        if (capitalTied <= 0) return null;
        const turnover  = soldQty / Math.max(onHand, 1);
        const slowScore = capitalTied * (1 - Math.min(turnover, 1));
        return { title: it.ITEMDESCRIPTION || code, category: it.ITEMCATEGORY || 'Uncategorised', stockOnHand: Math.round(onHand), soldInPeriod: Math.round(soldQty), capitalTied, slowScore };
      })
      .filter(Boolean)
      .sort((a, b) => b.slowScore - a.slowScore)
      .slice(0, 20)
      .map(({ slowScore: _s, ...rest }) => rest);

    // ── DECLINING PRODUCTS (MoM — last complete month vs month before) ────────
    const endMon   = new Date(endParam).getMonth(); // 0-indexed
    const priorMon = endMon === 0 ? 11 : endMon - 1;

    const moMRevMap = (targetMon, lines) => {
      const map = {};
      for (const line of lines) {
        const d = invDateMap[line.INVOICENUMBER];
        if (!d || d.getMonth() !== targetMon) continue;
        const code = line.ITEMCODE;
        if (!code) continue;
        const rev = lineNet(line);
        const qty = parseNum(line.INVOICEQTY);
        if (!map[code]) map[code] = { revenue: 0, qty: 0 };
        map[code].revenue += rev;
        map[code].qty     += qty;
      }
      return map;
    };

    const currMonMap  = moMRevMap(endMon,   currLineRows);
    const priorMonMap = moMRevMap(priorMon, currLineRows);

    const decliningMoM = Object.entries(currMonMap)
      .filter(([code, curr]) => {
        const prev = priorMonMap[code];
        return prev && prev.revenue > 50 && curr.revenue < prev.revenue * 0.8;
      })
      .map(([code, curr]) => {
        const prev   = priorMonMap[code];
        const it     = itemMap[code] || {};
        const change = Math.round(((curr.revenue - prev.revenue) / prev.revenue) * 100);
        return { name: it.ITEMDESCRIPTION || code, revenue: Math.round(curr.revenue), prevRevenue: Math.round(prev.revenue), change, qtySold: Math.round(curr.qty), prevQtySold: Math.round(prev.qty) };
      })
      .sort((a, b) => a.change - b.change)
      .slice(0, 20);

    // YoY declining: only meaningful if there is prior-year line data.
    // Since Dutch Rusk started Oct 2025, prior-year product lines are not yet available.
    // Return empty — will populate once a full year of data exists.
    const declining = [];

    return NextResponse.json({
      products,
      categories,
      customers:   customerList,
      slowMoving,
      churned,
      atRisk,
      clv,
      declining,
      decliningMoM,
      metrics: {
        totalRevenue:    Math.round(currInvRows.reduce((s, r) => s + parseNum(r.INVOICENETTAMOUNT ?? r.INVOICETOTALAMOUNT), 0)),
        totalOrders:     currInvRows.length,
        uniqueCustomers: Object.keys(custMap).length,
        lineCount:       currLineRows.length,
        invoiceCount:    currInvNums.length,
      },
    });

  } catch (err) {
    console.error('[Ostendo/advanced] fatal:', err.message, err.stack);
    return NextResponse.json({
      products: [], categories: [], customers: [], slowMoving: [],
      churned: [], atRisk: [], clv: [], declining: [], decliningMoM: [],
      metrics: {}, error: err.message,
    });
  }
}
