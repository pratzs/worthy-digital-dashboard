import { NextResponse } from 'next/server';
import https from 'node:https';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const agent = new https.Agent({ rejectUnauthorized: false });

/**
 * Confirmed live column names from Dutch Rusk Ostendo:
 *
 *  SALESINVOICEHEADER → INVOICENUMBER, INVOICEDATE (D/MM/YYYY), CUSTOMER,
 *                        INVOICENETTAMOUNT, INVOICETOTALAMOUNT, LINEDISCOUNTAMOUNT,
 *                        BILLINGEMAIL
 *  SALESINVOICELINES  → INVOICENUMBER (FK, no INVOICEDATE!), ITEMCODE,
 *                        INVOICEDQTY, INVOICEDNETTAMOUNT, INVOICEDTOTALAMOUNT,
 *                        INVOICEUNITCOST, INVOICEDCOST
 *  ITEMMASTER         → ITEMCODE, ITEMDESCRIPTION, ITEMCATEGORY, ITEMSUBCATEGORY,
 *                        ITEMAVERAGECOST, ITEMUNIT
 */

// Spaces must be %20 — Firebird treats URLSearchParams '+' as arithmetic operator
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

/** Run an array of async tasks with at most `limit` running at once */
async function parallelLimit(tasks, limit = 4) {
  const results = new Array(tasks.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (next < tasks.length) {
      const idx = next++;
      results[idx] = await tasks[idx]();
    }
  });
  await Promise.all(workers);
  return results;
}

/** Batch-fetch SALESINVOICELINES by INVOICENUMBER IN (...) — parallel chunks */
async function fetchLinesByInvoiceNumbers(invoiceNumbers, chunkSize = 50) {
  if (!invoiceNumbers.length) return [];
  const chunks = [];
  for (let i = 0; i < invoiceNumbers.length; i += chunkSize) {
    chunks.push(invoiceNumbers.slice(i, i + chunkSize));
  }
  // Run up to 4 chunks at once to stay within timeout
  const taskResults = await parallelLimit(
    chunks.map(chunk => () => {
      const inList = chunk.map(n => `'${String(n).replace(/'/g, "''")}'`).join(',');
      return safe(() => ostendoFetch('SALESINVOICELINES', `INVOICENUMBER IN (${inList})`));
    }),
    4
  );
  return taskResults.flat();
}

/** Batch-fetch ITEMMASTER by ITEMCODE IN (...) — parallel chunks */
async function fetchByItemCodes(codes, chunkSize = 50) {
  if (!codes.length) return [];
  const chunks = [];
  for (let i = 0; i < codes.length; i += chunkSize) {
    chunks.push(codes.slice(i, i + chunkSize));
  }
  const taskResults = await parallelLimit(
    chunks.map(chunk => () => {
      const inList = chunk.map(c => `'${String(c).replace(/'/g, "''")}'`).join(',');
      return safe(() => ostendoFetch('ITEMMASTER', `ITEMCODE IN (${inList})`));
    }),
    4
  );
  return taskResults.flat();
}

const parseNum  = (v) => (v === null || v === undefined) ? 0 : parseFloat(v) || 0;
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
  const today      = new Date();
  const startParam = searchParams.get('startDate') || `${today.getFullYear()}-01-01`;
  const endParam   = searchParams.get('endDate')   || today.toISOString().split('T')[0];

  try {
    const startYear = new Date(startParam).getFullYear();
    const endYear   = new Date(endParam).getFullYear();
    const invCondition = startYear === endYear
      ? `EXTRACT(YEAR FROM INVOICEDATE) = ${startYear}`
      : `EXTRACT(YEAR FROM INVOICEDATE) >= ${startYear} AND EXTRACT(YEAR FROM INVOICEDATE) <= ${endYear}`;

    // ── Step 1: Invoice headers (year-filtered — confirmed working) ───────────
    const invRows = await safe(() => ostendoFetch('SALESINVOICEHEADER', invCondition));
    console.log(`[Ostendo/adv] invRows: ${invRows.length}`);

    // ── Step 2: Invoice lines — parallel chunks (SALESINVOICELINES has no date col) ──
    const invoiceNumbers = [...new Set(invRows.map(r => r.INVOICENUMBER).filter(Boolean))];
    const lineRows = await fetchLinesByInvoiceNumbers(invoiceNumbers);
    console.log(`[Ostendo/adv] lineRows: ${lineRows.length} from ${invoiceNumbers.length} invoices`);

    // ── Step 3: Item master — parallel chunks, only for sold items ────────────
    const soldCodes = [...new Set(lineRows.map(r => r.ITEMCODE).filter(Boolean))];
    const itemRows  = await fetchByItemCodes(soldCodes);
    console.log(`[Ostendo/adv] itemRows: ${itemRows.length}`);

    const itemMap = {};
    for (const it of itemRows) {
      if (it.ITEMCODE) itemMap[it.ITEMCODE] = it;
    }

    // ── Top Products ─────────────────────────────────────────────────────────
    const productMap = {};
    for (const line of lineRows) {
      const code = line.ITEMCODE;
      if (!code) continue;
      const qty      = parseNum(line.INVOICEDQTY);
      const lineNet  = parseNum(line.INVOICEDNETTAMOUNT ?? line.INVOICEDTOTALAMOUNT ?? line.INVOICEEXTENDEDPRICE);
      const unitCost = parseNum(line.INVOICEUNITCOST    ?? line.INVOICEDCOST);
      const lineCost = unitCost * qty;
      if (!productMap[code]) {
        const it = itemMap[code] || {};
        productMap[code] = {
          title:       it.ITEMDESCRIPTION || code,
          category:    it.ITEMCATEGORY || it.ITEMSUBCATEGORY || 'Uncategorised',
          revenue:     0,
          unitsSold:   0,
          grossProfit: 0,
        };
      }
      productMap[code].revenue     += lineNet;
      productMap[code].unitsSold   += qty;
      productMap[code].grossProfit += (lineNet - lineCost);
    }

    const products = Object.values(productMap)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 50)
      .map(p => ({
        ...p,
        revenue:     Math.round(p.revenue),
        grossProfit: Math.round(p.grossProfit),
        margin:      p.revenue > 0 ? Math.round((p.grossProfit / p.revenue) * 100) : 0,
      }));

    // ── Categories ───────────────────────────────────────────────────────────
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

    // ── Top Customers (from invoice header — CUSTOMER field is the name) ──────
    const custSpend = {};
    for (const inv of invRows) {
      const name = inv.CUSTOMER ?? inv.INVOICECUSTOMER;
      if (!name) continue;
      const rev = parseNum(inv.INVOICENETTAMOUNT ?? inv.INVOICETOTALAMOUNT ?? inv.INVOICEVALUE);
      if (!custSpend[name]) {
        custSpend[name] = { customer: name, email: inv.BILLINGEMAIL || '', totalSpend: 0, orderCount: 0, lastOrder: null, firstOrder: null };
      }
      custSpend[name].totalSpend += rev;
      custSpend[name].orderCount += 1;
      const d = parseDate(inv.INVOICEDATE);
      if (d) {
        if (!custSpend[name].lastOrder  || d > custSpend[name].lastOrder)  custSpend[name].lastOrder  = d;
        if (!custSpend[name].firstOrder || d < custSpend[name].firstOrder) custSpend[name].firstOrder = d;
      }
    }

    const today2 = new Date();
    const customerList = Object.values(custSpend)
      .sort((a, b) => b.totalSpend - a.totalSpend)
      .slice(0, 100)
      .map(c => {
        const daysSince = c.lastOrder
          ? Math.floor((today2.getTime() - c.lastOrder.getTime()) / 86400000)
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
          status:        daysSince === null ? 'Unknown'
                       : daysSince > 90    ? 'Lapsed'
                       : daysSince > 45    ? 'At Risk'
                       : 'Active',
        };
      });

    const churned = customerList.filter(c => c.status === 'Lapsed');
    const atRisk  = customerList.filter(c => c.status === 'At Risk');
    const clv     = [...customerList].sort((a, b) => b.totalSpend - a.totalSpend).slice(0, 50);

    return NextResponse.json({
      products,
      categories,
      customers:  customerList,
      slowMoving: [],
      churned,
      atRisk,
      clv,
      declining:  [],
      metrics: {
        totalRevenue:    Math.round(invRows.reduce((s, r) => s + parseNum(r.INVOICENETTAMOUNT ?? r.INVOICETOTALAMOUNT), 0)),
        totalOrders:     invRows.length,
        uniqueCustomers: Object.keys(custSpend).length,
        lineCount:       lineRows.length,
        invoiceCount:    invoiceNumbers.length,
      },
    });

  } catch (err) {
    console.error('[Ostendo/advanced] fatal:', err.message);
    return NextResponse.json({
      products: [], categories: [], customers: [], slowMoving: [],
      churned: [], atRisk: [], clv: [], declining: [], metrics: {},
      error: err.message,
    });
  }
}
