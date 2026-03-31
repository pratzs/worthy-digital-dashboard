import { NextResponse } from 'next/server';
import https from 'node:https';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Custom HTTPS agent — handles self-signed certs on ostendo.dutchrusk.co.nz:442
const agent = new https.Agent({ rejectUnauthorized: false });

/**
 * Confirmed table & column names from Dutch Rusk Ostendo (Table for Queries.rps):
 *
 *  SALESINVOICEHEADER  → INVOICEDATE, INVOICENO, INVOICECUSTOMER,
 *                         INVOICENETTAMOUNT, INVOICETOTALAMOUNT, DISCOUNTAMOUNT
 *  SALESINVOICELINES   → ITEMCODE, INVOICEDQTY, INVOICEDNETTAMOUNT,
 *                         INVOICEDTOTALAMOUNT, INVOICEUNITCOST, INVOICEDCOST
 *  ITEMMASTER          → ITEMCODE, ITEMDESCRIPTION, ITEMCATEGORY,
 *                         ITEMSUBCATEGORY, ITEMAVERAGECOST, ITEMUNIT
 *  CUSTOMERMASTER      → CUSTOMERCODE, CUSTOMERNAME, CUSTOMEREMAIL,
 *                         CUSTOMERPHONE, CUSTOMERREGION
 *  ITEMQTYSUMMARIES    → ITEMCODE, ONHANDQTY (or QTYONHAND / STOCKONHANDQTY)
 */
async function ostendoFetch(tablename, condition = null) {
  const base   = process.env.OSTENDO_BASE_URL;
  const apiKey = process.env.OSTENDO_API_KEY;

  // Use URLSearchParams — it handles encoding internally (do NOT pre-encode the key)
  const params = new URLSearchParams({ tablename, apikey: apiKey, format: 'json' });
  if (condition) params.set('condition', condition);

  return new Promise((resolve, reject) => {
    const urlObj = new URL(base);
    const options = {
      hostname: urlObj.hostname,
      port:     parseInt(urlObj.port) || 443,
      path:     `/tabledata?${params.toString()}`,
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
  if (/^\d{2}\/\d{2}\/\d{4}/.test(s)) {
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
    const invCondition = `INVOICEDATE >= '${startParam}' AND INVOICEDATE <= '${endParam}'`;

    // Fetch in parallel — gracefully handle any table that errors
    const [invRes, linesRes, itemsRes, custsRes, qtyRes] = await Promise.allSettled([
      ostendoFetch('SALESINVOICEHEADER', invCondition),
      ostendoFetch('SALESINVOICELINES',  invCondition),
      ostendoFetch('ITEMMASTER'),
      ostendoFetch('CUSTOMERMASTER'),
      ostendoFetch('ITEMQTYSUMMARIES'),
    ]);

    const invRows   = normalizeRows(invRes.status   === 'fulfilled' ? invRes.value   : []);
    const lineRows  = normalizeRows(linesRes.status === 'fulfilled' ? linesRes.value : []);
    const itemRows  = normalizeRows(itemsRes.status === 'fulfilled' ? itemsRes.value : []);
    const custRows  = normalizeRows(custsRes.status === 'fulfilled' ? custsRes.value : []);
    const qtyRows   = normalizeRows(qtyRes.status   === 'fulfilled' ? qtyRes.value   : []);

    // ── Item lookup ──────────────────────────────────────────────────────────
    const itemMap = {};
    for (const it of itemRows) {
      if (it.ITEMCODE) itemMap[it.ITEMCODE] = it;
    }

    // ── Customer lookup ──────────────────────────────────────────────────────
    const custMap = {};
    for (const c of custRows) {
      if (c.CUSTOMERCODE) custMap[c.CUSTOMERCODE] = c;
    }

    // ── Top Products (from SALESINVOICELINES) ────────────────────────────────
    const productMap = {};
    for (const line of lineRows) {
      const code = line.ITEMCODE;
      if (!code) continue;

      const qty      = parseNum(line.INVOICEDQTY);
      const lineNet  = parseNum(line.INVOICEDNETTAMOUNT  ?? line.INVOICEDTOTALAMOUNT ?? line.INVOICEEXTENDEDPRICE);
      const unitCost = parseNum(line.INVOICEUNITCOST     ?? line.INVOICEDCOST);
      const lineCost = unitCost * qty;

      if (!productMap[code]) {
        const it   = itemMap[code] || {};
        productMap[code] = {
          title:       it.ITEMDESCRIPTION || code,
          category:    it.ITEMCATEGORY    || it.ITEMSUBCATEGORY || 'Uncategorised',
          revenue:     0,
          unitsSold:   0,
          grossProfit: 0,
        };
      }
      productMap[code].revenue    += lineNet;
      productMap[code].unitsSold  += qty;
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
      if (!catMap[c]) catMap[c] = { category: c, revenue: 0, unitsSold: 0, grossProfit: 0, productCount: 0, products: [] };
      catMap[c].revenue     += p.revenue;
      catMap[c].unitsSold   += p.unitsSold;
      catMap[c].grossProfit += p.grossProfit;
      catMap[c].productCount++;
      catMap[c].products.push(p);
    }
    const categories = Object.values(catMap)
      .sort((a, b) => b.revenue - a.revenue)
      .map(c => ({ ...c, margin: c.revenue > 0 ? Math.round((c.grossProfit / c.revenue) * 100) : 0 }));

    // ── Top Customers (from SALESINVOICEHEADER.INVOICECUSTOMER) ─────────────
    const custSpend = {};
    for (const inv of invRows) {
      // INVOICECUSTOMER is the customer reference on the invoice header
      const code = inv.INVOICECUSTOMER ?? inv.CUSTOMERCODE;
      if (!code) continue;

      const rev = parseNum(inv.INVOICENETTAMOUNT ?? inv.INVOICETOTALAMOUNT ?? inv.INVOICEVALUE);

      if (!custSpend[code]) {
        const cInfo = custMap[code] || {};
        custSpend[code] = {
          customer:   cInfo.CUSTOMERNAME || code,
          email:      cInfo.CUSTOMEREMAIL || '',
          totalSpend: 0,
          orderCount: 0,
          lastOrder:  null,
        };
      }
      custSpend[code].totalSpend += rev;
      custSpend[code].orderCount += 1;

      const d = parseDate(inv.INVOICEDATE);
      if (d) {
        const prev = custSpend[code].lastOrder;
        if (!prev || d > prev) custSpend[code].lastOrder = d;
      }
    }

    const customerList = Object.values(custSpend)
      .sort((a, b) => b.totalSpend - a.totalSpend)
      .slice(0, 50)
      .map(c => {
        const daysSince = c.lastOrder
          ? Math.floor((Date.now() - c.lastOrder.getTime()) / 86400000)
          : null;
        return {
          ...c,
          totalSpend:    Math.round(c.totalSpend),
          aov:           c.orderCount > 0 ? Math.round(c.totalSpend / c.orderCount) : 0,
          lastOrderDays: daysSince,
          status:        daysSince === null ? 'Unknown'
                       : daysSince > 90    ? 'Lapsed'
                       : daysSince > 45    ? 'At Risk'
                       : 'Active',
        };
      });

    // ── Slow-moving inventory (from ITEMQTYSUMMARIES) ────────────────────────
    const soldCodes = new Set(lineRows.map(r => r.ITEMCODE).filter(Boolean));
    const slowMoving = qtyRows
      .filter(r => {
        const qty = parseNum(r.ONHANDQTY ?? r.QTYONHAND ?? r.STOCKONHANDQTY);
        return qty > 0 && r.ITEMCODE && !soldCodes.has(r.ITEMCODE);
      })
      .map(r => {
        const qty   = parseNum(r.ONHANDQTY ?? r.QTYONHAND ?? r.STOCKONHANDQTY);
        const it    = itemMap[r.ITEMCODE] || {};
        const cost  = parseNum(it.ITEMAVERAGECOST);
        return {
          itemCode:    r.ITEMCODE,
          title:       it.ITEMDESCRIPTION || r.ITEMCODE,
          stockOnHand: Math.round(qty),
          capitalTied: Math.round(qty * cost),
          lastSold:    null,
        };
      })
      .sort((a, b) => b.capitalTied - a.capitalTied)
      .slice(0, 30);

    const churned = customerList.filter(c => c.status === 'Lapsed');
    const atRisk  = customerList.filter(c => c.status === 'At Risk');
    const clv     = customerList.slice(0, 20).map(({ customer, email, totalSpend, orderCount, aov }) =>
      ({ customer, email, totalSpend, orderCount, aov }));

    return NextResponse.json({
      products,
      categories,
      customers:  customerList,
      slowMoving,
      churned,
      atRisk,
      clv,
      declining:  [],
      metrics: {
        totalRevenue:    invRows.reduce((s, r) => s + parseNum(r.INVOICENETTAMOUNT ?? r.INVOICETOTALAMOUNT), 0),
        totalOrders:     invRows.length,
        uniqueCustomers: Object.keys(custSpend).length,
      },
    });

  } catch (err) {
    console.error('[Ostendo] Advanced fetch error:', err.message);
    return NextResponse.json({
      products: [], categories: [], customers: [], slowMoving: [],
      churned: [], atRisk: [], clv: [], declining: [], metrics: {},
      error: err.message,
    });
  }
}
