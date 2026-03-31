import { NextResponse } from 'next/server';
import https from 'node:https';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const agent = new https.Agent({ rejectUnauthorized: false });

async function ostendoFetch(tablename, condition = null) {
  const base    = process.env.OSTENDO_BASE_URL;
  const apiKey  = process.env.OSTENDO_API_KEY;
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
    req.setTimeout(20000, () => { req.destroy(); reject(new Error('Ostendo timeout')); });
    req.on('error', reject);
    req.end();
  });
}

const col = (row, ...names) => {
  for (const n of names) {
    if (row[n] !== undefined && row[n] !== null && row[n] !== '') return row[n];
  }
  return null;
};
const parseNum = (v) => (v === null || v === undefined) ? 0 : parseFloat(v) || 0;
const parseDate = (v) => {
  if (!v) return null;
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return new Date(s.substring(0, 10));
  if (/^\d{2}\/\d{2}\/\d{4}/.test(s)) {
    const [d, m, y] = s.split('/');
    return new Date(`${y}-${m}-${d}`);
  }
  const d = new Date(s);
  return isNaN(d) ? null : d;
};

const normalizeRows = (res) =>
  Array.isArray(res) ? res : res?.rows || res?.data || res?.records || [];

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const today      = new Date();
  const startParam = searchParams.get('startDate') || `${today.getFullYear()}-01-01`;
  const endParam   = searchParams.get('endDate')   || today.toISOString().split('T')[0];

  try {
    // ── 1. Invoice headers for date range ───────────────────────────────────
    const invCondition = `INVOICEDATE >= '${startParam}' AND INVOICEDATE <= '${endParam}'`;
    const [invoices, invoiceLines, items, customers, itemBalance] = await Promise.allSettled([
      ostendoFetch('SALESINVOICEHEADER', invCondition),
      ostendoFetch('SALESINVOICELINES',  invCondition),  // may fail — handled gracefully
      ostendoFetch('ITEMS'),
      ostendoFetch('CUSTOMERS'),
      ostendoFetch('ITEMBALANCE'),   // or WAREHOUSELOCATIONS
    ]);

    const invRows   = normalizeRows(invoices.status  === 'fulfilled' ? invoices.value  : []);
    const lineRows  = normalizeRows(invoiceLines.status === 'fulfilled' ? invoiceLines.value : []);
    const itemRows  = normalizeRows(items.status     === 'fulfilled' ? items.value     : []);
    const custRows  = normalizeRows(customers.status === 'fulfilled' ? customers.value : []);
    const balRows   = normalizeRows(itemBalance.status === 'fulfilled' ? itemBalance.value : []);

    // ── 2. Item lookup map ───────────────────────────────────────────────────
    const itemMap = {};
    for (const it of itemRows) {
      const code = col(it, 'ITEMCODE', 'CODE', 'ItemCode');
      if (code) itemMap[code] = it;
    }

    // ── 3. Customer lookup map ───────────────────────────────────────────────
    const custMap = {};
    for (const c of custRows) {
      const code = col(c, 'CUSTOMERCODE', 'CUSTCODE', 'CODE', 'CustomerCode');
      if (code) custMap[code] = c;
    }

    // ── 4. Top Products (from invoice lines) ─────────────────────────────────
    const productMap = {};
    for (const line of lineRows) {
      const lineDate = col(line, 'INVOICEDATE', 'DOCDATE', 'DATE', 'InvoiceDate');
      const d = parseDate(lineDate);
      if (d && (d < new Date(startParam) || d > new Date(endParam))) continue;

      const code = col(line, 'ITEMCODE', 'CODE', 'PRODUCTCODE', 'ItemCode');
      if (!code) continue;

      const qty    = parseNum(col(line, 'QUANTITY', 'QTY', 'INVOICEDQTY', 'Quantity'));
      const rev    = parseNum(col(line, 'LINETOTAL', 'TOTALEX', 'LINEAMOUNT', 'SELLPRICE', 'LineTotal'));
      const cost   = parseNum(col(line, 'UNITCOSTPRICE', 'COSTPRICE', 'UNITCOST', 'UnitCostPrice'));
      const lineCost = cost * qty;

      if (!productMap[code]) {
        const it   = itemMap[code] || {};
        const desc = col(it, 'DESCRIPTION', 'ITEMDESCRIPTION', 'NAME', 'Description') || code;
        const cat  = col(it, 'PRODUCTTYPE', 'ITEMGROUP', 'CATEGORY', 'ITEMTYPE', 'ProductType') || 'Uncategorised';
        productMap[code] = { title: desc, category: cat, revenue: 0, unitsSold: 0, grossProfit: 0, margin: 0 };
      }
      productMap[code].revenue    += rev;
      productMap[code].unitsSold  += qty;
      productMap[code].grossProfit += (rev - lineCost);
    }

    // Fallback: derive products from invoices if no lines available
    if (lineRows.length === 0) {
      for (const inv of invRows) {
        const code = col(inv, 'ITEMCODE', 'PRODUCTCODE');
        if (!code) continue;
        const rev = parseNum(col(inv, 'TOTALEX', 'TOTALEXGSTTAX', 'NETSALESVALUE', 'ORDERTOTAL'));
        if (!productMap[code]) productMap[code] = { title: code, category: 'Unknown', revenue: 0, unitsSold: 0, grossProfit: 0, margin: 0 };
        productMap[code].revenue += rev;
        productMap[code].unitsSold += 1;
      }
    }

    const products = Object.values(productMap)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 50)
      .map(p => ({
        ...p,
        margin: p.revenue > 0 ? Math.round((p.grossProfit / p.revenue) * 100) : 0,
        revenue: Math.round(p.revenue),
        grossProfit: Math.round(p.grossProfit),
      }));

    // ── 5. Categories (grouped from products) ────────────────────────────────
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

    // ── 6. Top Customers ─────────────────────────────────────────────────────
    const custSpend = {};
    for (const inv of invRows) {
      const code = col(inv, 'CUSTOMERCODE', 'CUSTCODE', 'CUSTOMER', 'CustomerCode');
      if (!code) continue;
      const rev = parseNum(col(inv, 'TOTALEX', 'TOTALEXGSTTAX', 'NETSALESVALUE', 'ORDERTOTAL'));
      if (!custSpend[code]) {
        const cInfo  = custMap[code] || {};
        const name   = col(cInfo, 'CUSTOMERNAME', 'NAME', 'COMPANY', 'CustomerName') || code;
        const email  = col(cInfo, 'EMAILADDRESS', 'EMAIL', 'EmailAddress') || '';
        custSpend[code] = { customer: name, email, totalSpend: 0, orderCount: 0, lastOrder: null };
      }
      custSpend[code].totalSpend += rev;
      custSpend[code].orderCount += 1;

      const dateVal = col(inv, 'INVOICEDATE', 'INVDATE', 'DOCDATE');
      const d = parseDate(dateVal);
      if (d) {
        const prev = custSpend[code].lastOrder;
        if (!prev || d > prev) custSpend[code].lastOrder = d;
      }
    }

    const customerList = Object.values(custSpend)
      .sort((a, b) => b.totalSpend - a.totalSpend)
      .slice(0, 50)
      .map(c => ({
        ...c,
        totalSpend:  Math.round(c.totalSpend),
        aov:         c.orderCount > 0 ? Math.round(c.totalSpend / c.orderCount) : 0,
        lastOrderDays: c.lastOrder
          ? Math.floor((Date.now() - c.lastOrder.getTime()) / 86400000)
          : null,
        status: c.lastOrder
          ? (Math.floor((Date.now() - c.lastOrder.getTime()) / 86400000) > 90 ? 'Lapsed'
           : Math.floor((Date.now() - c.lastOrder.getTime()) / 86400000) > 45 ? 'At Risk' : 'Active')
          : 'Unknown',
      }));

    // ── 7. Slow-moving inventory (from ITEMBALANCE) ──────────────────────────
    const activeItems = new Set(lineRows.map(r => col(r, 'ITEMCODE', 'CODE', 'PRODUCTCODE')).filter(Boolean));
    const slowMoving = balRows
      .filter(r => {
        const code = col(r, 'ITEMCODE', 'CODE', 'ItemCode');
        const qty  = parseNum(col(r, 'QUANTITYONHAND', 'ONHANDQTY', 'QTY', 'STOCKONHAND', 'QuantityOnHand'));
        return qty > 0 && code && !activeItems.has(code);
      })
      .map(r => {
        const code  = col(r, 'ITEMCODE', 'CODE', 'ItemCode');
        const qty   = parseNum(col(r, 'QUANTITYONHAND', 'ONHANDQTY', 'QTY', 'STOCKONHAND', 'QuantityOnHand'));
        const cost  = parseNum(col(r, 'AVERAGECOST', 'UNITCOSTPRICE', 'COSTPRICE', 'AverageCost'));
        const it    = itemMap[code] || {};
        const desc  = col(it, 'DESCRIPTION', 'ITEMDESCRIPTION', 'NAME', 'Description') || code;
        return { itemCode: code, title: desc, stockOnHand: qty, capitalTied: Math.round(qty * cost), lastSold: null };
      })
      .sort((a, b) => b.capitalTied - a.capitalTied)
      .slice(0, 30);

    // ── 8. Churned / at-risk customers ───────────────────────────────────────
    const churned  = customerList.filter(c => c.status === 'Lapsed');
    const atRisk   = customerList.filter(c => c.status === 'At Risk');

    // ── 9. CLV (all-time: use available period data as proxy) ────────────────
    const clv = customerList.slice(0, 20).map(c => ({
      customer:   c.customer,
      email:      c.email,
      totalSpend: c.totalSpend,
      orderCount: c.orderCount,
      aov:        c.aov,
    }));

    return NextResponse.json({
      products,
      categories,
      customers: customerList,
      slowMoving,
      churned,
      atRisk,
      clv,
      declining: [],   // requires multi-period comparison — future enhancement
      metrics: {
        totalRevenue:  invRows.reduce((s, r) => s + parseNum(col(r, 'TOTALEX','TOTALEXGSTTAX','NETSALESVALUE','ORDERTOTAL')), 0),
        totalOrders:   invRows.length,
        uniqueCustomers: Object.keys(custSpend).length,
      },
    });

  } catch (err) {
    console.error('[Ostendo] Advanced fetch error:', err.message);
    return NextResponse.json({
      products: [], categories: [], customers: [], slowMoving: [],
      churned: [], atRisk: [], clv: [], declining: [], metrics: {},
    });
  }
}
