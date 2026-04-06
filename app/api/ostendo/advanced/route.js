import { NextResponse } from 'next/server';
import https from 'node:https';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const agent = new https.Agent({ rejectUnauthorized: false });

/**
 * CONFIRMED column names (from Vercel logs + Table for Queries.rps):
 *
 *  SALESINVOICEHEADER → INVOICENUMBER, INVOICEDATE, CUSTOMER,
 *                        INVOICENETTAMOUNT, INVOICETOTALAMOUNT, INVOICESTATUS,
 *                        INVOICEORCREDIT, LINEDISCOUNTAMOUNT, BILLINGEMAIL,
 *                        SALESPERSON, CURRENCYCODE, SITENAME, ...
 *
 *  SALESINVOICELINES  → INVOICENUMBER (FK),
 *                        LINECODE          ← item/product code (NOT ITEMCODE)
 *                        LINEDESCRIPTION   ← product name (direct on line)
 *                        CATALOGUECATEGORY ← product category (direct on line)
 *                        INVOICEQTY        ← quantity (NOT INVOICEDQTY)
 *                        EXTENDEDNETTPRICE ← pre-calculated net line total (most accurate)
 *                        INVOICEUNITPRICE  ← unit sell price (ex-tax)
 *                        CUSTOMERUNITPRICE ← customer-specific price
 *                        INVOICEUNITCOST   ← cost per unit
 *                        INVOICEUNITTAX    ← unit tax
 *                        DISCOUNTAMOUNT, DISCOUNTPERCENT
 *
 *  ITEMMASTER         → ITEMCODE (= LINECODE from lines), ITEMDESCRIPTION,
 *                        ITEMCATEGORY, ITEMSUBCATEGORY, ITEMUNIT, ITEMSTATUS,
 *                        ONHANDQTY    ← stock on hand (slow-moving only)
 *                        STDBUYPRICE  ← standard buy price (capital tied)
 *                        STDSELLPRICE
 *
 * Ostendo API (confirmed from official docs):
 *   GET  /tabledata?tablename=X&apikey=KEY&format=json&condition=SQL_WHERE
 *   POST /sqlquery?apikey=KEY&format=json   Body = full SQL SELECT text
 *   Spaces in condition → %20, single quotes → %27
 */

async function ostendoFetch(tablename, condition = null, timeoutMs = 18000) {
  const base   = process.env.OSTENDO_BASE_URL;
  const apiKey = process.env.OSTENDO_API_KEY;
  const params = new URLSearchParams({ tablename, apikey: apiKey, format: 'json' });
  // Encode spaces as %20 (Firebird rejects + from URLSearchParams)
  // Encode single quotes as %27 (bare ' in URL breaks Firebird string literals)
  const conditionStr = condition
    ? `&condition=${condition.replace(/ /g, '%20').replace(/'/g, '%27')}`
    : '';
  const fullPath = `/tabledata?${params.toString()}${conditionStr}`;

  return new Promise((resolve, reject) => {
    const urlObj = new URL(base);
    const options = {
      hostname: urlObj.hostname,
      port:     parseInt(urlObj.port) || 443,
      path:     fullPath,
      method:   'GET',
      agent,
    };
    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', chunk => (raw += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(raw));
        } catch {
          // Log non-JSON response so we can diagnose Firebird/Ostendo errors
          console.error(`[Ostendo:${tablename}] non-JSON (${raw.length}b): ${raw.substring(0, 300)}`);
          resolve([]);
        }
      });
    });
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error(`timeout:${tablename}`)); });
    req.on('error', reject);
    req.end();
  });
}

/**
 * Execute a raw SQL SELECT via the Ostendo sqlquery endpoint (POST).
 * Confirmed in Ostendo API docs — more reliable than tabledata + condition
 * for complex multi-level subqueries.
 * API docs: POST /sqlquery?apikey=...&format=json   Body = SQL SELECT text
 */
async function ostendoSqlQuery(sql, timeoutMs = 30000) {
  const base   = process.env.OSTENDO_BASE_URL;
  const apiKey = process.env.OSTENDO_API_KEY;
  const urlObj = new URL(base);
  const body   = Buffer.from(sql, 'utf8');
  const fullPath = `/sqlquery?apikey=${encodeURIComponent(apiKey)}&format=json`;

  return new Promise((resolve, reject) => {
    const options = {
      hostname: urlObj.hostname,
      port:     parseInt(urlObj.port) || 443,
      path:     fullPath,
      method:   'POST',
      agent,
      headers: {
        'Content-Type':   'text/plain',
        'Content-Length': body.length,
      },
    };
    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', chunk => (raw += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(raw));
        } catch {
          console.error(`[Ostendo/sqlquery] non-JSON (${raw.length}b): ${raw.substring(0, 300)}`);
          resolve([]);
        }
      });
    });
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('timeout:sqlquery')); });
    req.on('error', reject);
    req.write(body);
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

/**
 * Format a value for a Firebird IN() clause.
 * Pure integers → unquoted (avoids type-mismatch if column is INTEGER).
 * Everything else → single-quoted string.
 */
const fmtInVal = (v) => {
  const s = String(v).trim();
  return /^\d+$/.test(s) ? s : `'${s.replace(/'/g, "''")}'`;
};

/**
 * Fetch SALESINVOICELINES using a Firebird subquery so the DB filters server-side.
 * Avoids: (1) large IN() lists that Ostendo rejects, (2) full-table "Out of memory".
 *
 * condition example:
 *   INVOICENUMBER IN (SELECT INVOICENUMBER FROM SALESINVOICEHEADER
 *     WHERE EXTRACT(YEAR FROM INVOICEDATE) = 2026
 *     AND EXTRACT(MONTH FROM INVOICEDATE) IN (1,2,3,4))
 *
 * Single quotes in strings are encoded as %27 by ostendoFetch.
 */
async function fetchLinesViaSubquery(headerDateCond) {
  const cond = `INVOICENUMBER IN (SELECT INVOICENUMBER FROM SALESINVOICEHEADER WHERE ${headerDateCond})`;
  console.log(`[Ostendo/lines] subquery: ${cond}`);
  const rows = await safe(() => ostendoFetch('SALESINVOICELINES', cond, 45000));
  console.log(`[Ostendo/lines] subquery rows returned: ${rows.length}`);
  return rows;
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
      const inList = chunk.map(fmtInVal).join(',');
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
 * Line net revenue — uses EXTENDEDNETTPRICE (pre-calculated by Ostendo, most accurate).
 * Falls back to INVOICEQTY × (CUSTOMERUNITPRICE or INVOICEUNITPRICE) − tax if absent.
 */
const lineNet = (line) => {
  const pre = parseNum(line.EXTENDEDNETTPRICE ?? line.LOCALEXTENDEDNETTPRICE);
  if (pre !== 0) return pre;
  const qty       = parseNum(line.INVOICEQTY);
  const unitPrice = parseNum(line.CUSTOMERUNITPRICE) || parseNum(line.INVOICEUNITPRICE);
  const unitTax   = parseNum(line.INVOICEUNITTAX);
  return qty * Math.max(unitPrice - unitTax, 0);
};

const lineCostTotal = (line) =>
  parseNum(line.INVOICEQTY) * parseNum(line.INVOICEUNITCOST);

/**
 * Build a Firebird INVOICEDATE condition using only EXTRACT() and IN() —
 * avoids >= / <= operators which can be problematic in Firebird URL conditions.
 *
 * Same-year example: Jan–Apr 2026
 *   → EXTRACT(YEAR FROM INVOICEDATE) = 2026
 *     AND EXTRACT(MONTH FROM INVOICEDATE) IN (1,2,3,4)
 *
 * Multi-year example: Oct 2025–Apr 2026
 *   → EXTRACT(YEAR FROM INVOICEDATE) IN (2025,2026)
 *   (over-fetches slightly; JS filters rows to exact date range after)
 */
function buildDateCond(startIso, endIso) {
  const s  = new Date(startIso);
  const e  = new Date(endIso);
  const sy = s.getFullYear(), sm = s.getMonth() + 1; // months 1-12
  const ey = e.getFullYear(), em = e.getMonth() + 1;

  if (sy === ey) {
    if (sm === 1 && em === 12) {
      return `EXTRACT(YEAR FROM INVOICEDATE) = ${sy}`;
    }
    const months = Array.from({ length: em - sm + 1 }, (_, i) => sm + i);
    if (months.length === 1) {
      return `EXTRACT(YEAR FROM INVOICEDATE) = ${sy} AND EXTRACT(MONTH FROM INVOICEDATE) = ${sm}`;
    }
    return `EXTRACT(YEAR FROM INVOICEDATE) = ${sy} AND EXTRACT(MONTH FROM INVOICEDATE) IN (${months.join(',')})`;
  }

  // Multi-year span: use IN() for the year list
  const years = Array.from({ length: ey - sy + 1 }, (_, i) => sy + i);
  return `EXTRACT(YEAR FROM INVOICEDATE) IN (${years.join(',')})`;
}

/** Same date range shifted back 1 year (for prior-year comparison) */
function buildPrevYearCond(startIso, endIso) {
  const s  = new Date(startIso);
  const e  = new Date(endIso);
  const py = s.getFullYear() - 1;
  const sm = s.getMonth() + 1;
  const em = e.getMonth() + 1;

  if (sm === 1 && em === 12) {
    return `EXTRACT(YEAR FROM INVOICEDATE) = ${py}`;
  }
  const months = Array.from({ length: em - sm + 1 }, (_, i) => sm + i);
  if (months.length === 1) {
    return `EXTRACT(YEAR FROM INVOICEDATE) = ${py} AND EXTRACT(MONTH FROM INVOICEDATE) = ${sm}`;
  }
  return `EXTRACT(YEAR FROM INVOICEDATE) = ${py} AND EXTRACT(MONTH FROM INVOICEDATE) IN (${months.join(',')})`;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const today      = new Date();
  const startParam = searchParams.get('startDate') || `${today.getFullYear()}-01-01`;
  const endParam   = searchParams.get('endDate')   || today.toISOString().split('T')[0];

  try {
    const startDate = new Date(startParam);
    const endDate   = new Date(endParam);

    // Conditions respect the exact date range chosen in the UI
    const currCond = buildDateCond(startParam, endParam);
    const prevCond = buildPrevYearCond(startParam, endParam);

    console.log(`[Ostendo/adv] curr cond: ${currCond}`);
    console.log(`[Ostendo/adv] prev cond: ${prevCond}`);

    // ── PHASE 1: headers for current period + same-period prior year ──────────
    //
    // Prior-year LINES are not fetched — header INVOICENETTAMOUNT is accurate
    // for all customer spend calculations (lapsed / at-risk / CLV).
    //
    const [currInvRows, prevInvRows] = await Promise.all([
      safe(() => ostendoFetch('SALESINVOICEHEADER', currCond)),
      safe(() => ostendoFetch('SALESINVOICEHEADER', prevCond)),
    ]);

    // JS-side date filter for multi-year fetches that may over-fetch
    const inRange = (inv) => {
      const d = parseDate(inv.INVOICEDATE);
      return d && d >= startDate && d <= endDate;
    };
    const filteredCurrInvRows = currInvRows.filter(inRange);
    // prev rows: already month-filtered by SQL
    const filteredPrevInvRows = prevInvRows;
    // Log actual field names from first row so we can verify column names
    if (filteredCurrInvRows.length > 0) {
      console.log(`[Ostendo/adv] header keys: ${Object.keys(filteredCurrInvRows[0]).join(', ')}`);
    }
    console.log(`[Ostendo/adv] curr headers: ${filteredCurrInvRows.length}, prev headers: ${filteredPrevInvRows.length}`);

    // ── PHASE 2: current-period lines ────────────────────────────────────────
    // SALESINVOICEHEADER may return INVOICENO or INVOICENUMBER depending on version
    const getInvNum = (r) => r.INVOICENUMBER ?? r.INVOICENO ?? r.InvoiceNumber ?? r.InvoiceNo;
    const currInvNums    = [...new Set(filteredCurrInvRows.map(getInvNum).filter(Boolean))];
    const currInvNumSet  = new Set(currInvNums.map(String));
    console.log(`[Ostendo/adv] invoice nums sample: ${currInvNums.slice(0,3).join(', ')}`);

    // Fetch lines via Firebird subquery — Ostendo rejects large IN() lists and
    // full-table fetch causes "Out of memory" on the server
    const currLineRows = await fetchLinesViaSubquery(currCond);
    console.log(`[Ostendo/adv] curr lines: ${currLineRows.length}`);

    // Log actual column names from the first line row to identify the item code field
    if (currLineRows.length > 0) {
      console.log(`[Ostendo/lines] line keys: ${Object.keys(currLineRows[0]).join(', ')}`);
    }

    // ── PHASE 3: item master for sold codes ───────────────────────────────────
    // CONFIRMED from logs: actual column in SALESINVOICELINES is LINECODE (not ITEMCODE).
    // LINEDESCRIPTION and CATALOGUECATEGORY are also directly on every line row.
    const getItemCode = (r) => r.LINECODE ?? r.ITEMCODE ?? r.DESCRIPTORCODE ?? r.STOCKCODE ?? r.PRODUCTCODE ?? r.ITEMNO;
    const soldCodes   = [...new Set(currLineRows.map(getItemCode).filter(Boolean))];
    console.log(`[Ostendo/adv] soldCodes count: ${soldCodes.length}, sample: ${soldCodes.slice(0,3).join(', ')}`);

    // ITEMMASTER is used ONLY for ONHANDQTY + STDBUYPRICE (slow-moving inventory).
    // Products/Categories use LINEDESCRIPTION + CATALOGUECATEGORY directly — no ITEMMASTER needed.
    //
    // Strategy:
    //   1. Try sqlquery POST (most reliable — avoids URL condition encoding issues).
    //   2. If that returns 0 and we have soldCodes, fallback to chunked IN() fetches.
    //
    // LINECODE in SALESINVOICELINES = ITEMCODE in ITEMMASTER (confirmed column mapping).
    let itemRows = [];
    if (soldCodes.length > 0) {
      const itemSql = `SELECT ITEMCODE, ITEMDESCRIPTION, ITEMCATEGORY, ITEMSUBCATEGORY, ONHANDQTY, STDBUYPRICE, STDSELLPRICE FROM ITEMMASTER WHERE ITEMCODE IN (SELECT DISTINCT LINECODE FROM SALESINVOICELINES WHERE INVOICENUMBER IN (SELECT INVOICENUMBER FROM SALESINVOICEHEADER WHERE ${currCond}))`;
      console.log(`[Ostendo/adv] item sqlquery: ${itemSql.substring(0, 200)}`);
      itemRows = normalizeRows(await safe(() => ostendoSqlQuery(itemSql, 30000)));
      console.log(`[Ostendo/adv] itemRows (sqlquery): ${itemRows.length}`);

      // Fallback: if sqlquery returns nothing, chunk-fetch by the soldCodes we already have
      if (itemRows.length === 0) {
        console.log(`[Ostendo/adv] sqlquery returned 0 — falling back to chunked ITEMMASTER fetch`);
        itemRows = await fetchByItemCodes(soldCodes, 50);
        console.log(`[Ostendo/adv] itemRows (chunked): ${itemRows.length}`);
      }
    }

    // Build item map keyed by both ITEMCODE and DESCRIPTORCODE for flexible lookup
    const itemMap = {};
    for (const it of itemRows) {
      if (it.ITEMCODE)      itemMap[it.ITEMCODE]      = it;
      if (it.DESCRIPTORCODE) itemMap[it.DESCRIPTORCODE] = it;
    }

    // ── BUILD per-item revenue map from current lines ─────────────────────────
    // LINEDESCRIPTION and CATALOGUECATEGORY are on every line row — use them directly.
    // This means products/categories populate even if ITEMMASTER returns nothing.
    const buildItemRevMap = (lines) => {
      const map = {};
      for (const line of lines) {
        const code = getItemCode(line); // LINECODE is the confirmed column
        if (!code) continue;
        const rev  = lineNet(line);
        const qty  = parseNum(line.INVOICEQTY);
        const cost = lineCostTotal(line);
        if (!map[code]) {
          map[code] = {
            revenue:  0,
            qty:      0,
            cost:     0,
            name:     line.LINEDESCRIPTION     || code,      // direct from line
            category: line.CATALOGUECATEGORY   || 'Uncategorised', // direct from line
          };
        }
        map[code].revenue += rev;
        map[code].qty     += qty;
        map[code].cost    += cost;
      }
      return map;
    };

    const invDateMap = {};
    for (const inv of filteredCurrInvRows) {
      const n = getInvNum(inv);
      if (n) invDateMap[n] = parseDate(inv.INVOICEDATE);
    }

    const currItemRevMap = buildItemRevMap(currLineRows);

    // ── TOP PRODUCTS ──────────────────────────────────────────────────────────
    // Use LINEDESCRIPTION / CATALOGUECATEGORY first (always present on line rows).
    // Fall back to ITEMMASTER only for any missing fields.
    const products = Object.entries(currItemRevMap)
      .map(([code, v]) => {
        const it     = itemMap[code] || {};
        const gp     = v.revenue - v.cost;
        const margin = v.revenue > 0 ? Math.round((gp / v.revenue) * 100) : 0;
        return {
          title:       v.name     || it.ITEMDESCRIPTION || code,
          category:    (v.category && v.category !== 'Uncategorised') ? v.category
                        : (it.ITEMCATEGORY || it.ITEMSUBCATEGORY || 'Uncategorised'),
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
    for (const inv of [...filteredCurrInvRows, ...filteredPrevInvRows]) {
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
        const d = invDateMap[line.INVOICENUMBER ?? line.INVOICENO];
        if (!d || d.getMonth() !== targetMon) continue;
        const code = getItemCode(line); // FIXED: use LINECODE via getItemCode
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
        const rv     = currItemRevMap[code] || {};
        const change = Math.round(((curr.revenue - prev.revenue) / prev.revenue) * 100);
        return { name: rv.name || it.ITEMDESCRIPTION || code, revenue: Math.round(curr.revenue), prevRevenue: Math.round(prev.revenue), change, qtySold: Math.round(curr.qty), prevQtySold: Math.round(prev.qty) };
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
        totalRevenue:    Math.round(filteredCurrInvRows.reduce((s, r) => s + parseNum(r.INVOICENETTAMOUNT ?? r.INVOICETOTALAMOUNT), 0)),
        totalOrders:     filteredCurrInvRows.length,
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
