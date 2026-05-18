import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

async function odooCall(url, payload, timeoutMs = 45000) {
  const res = await fetch(`${url}/jsonrpc`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
    signal:  AbortSignal.timeout(timeoutMs),
  });
  return res.json();
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const year      = parseInt(searchParams.get('year')    || new Date().getFullYear());
  const companyId = parseInt(searchParams.get('company') || 4);

  const url      = process.env.ODOO_URL;
  const db       = process.env.ODOO_DB;
  const username = process.env.ODOO_USER;
  const password = process.env.ODOO_PASSWORD;

  if (!url || !db || !username || !password) {
    return NextResponse.json({ error: 'Odoo env vars not configured' }, { status: 500 });
  }

  const emptyYear = () => MONTH_NAMES.map(m => ({
    month: m, revenue: 0, totalCost: 0, grossProfit: 0, marginPct: null,
    orders: 0, returns: 0, sessions: 0, totalDiscounts: 0,
    aov: 0, convRate: 0, newCustomers: 0, hasCostData: false, marginableRevenue: 0,
  }));

  try {
    // ── 1. Authenticate ───────────────────────────────────────────────────────
    const authJson = await odooCall(url, {
      jsonrpc: '2.0', method: 'call', id: 1,
      params: { service: 'common', method: 'authenticate', args: [db, username, password, {}] },
    }, 15000);
    const uid = authJson.result;
    if (!uid) throw new Error('Authentication failed — check ODOO_USER / ODOO_PASSWORD');

    const exec = async (model, method, args, kwargs = {}, timeout = 45000) => {
      const j = await odooCall(url, {
        jsonrpc: '2.0', method: 'call', id: Math.floor(Math.random() * 1e6),
        params: { service: 'object', method: 'execute_kw',
                  args: [db, uid, password, model, method, args, kwargs] },
      }, timeout);
      if (j.error) throw new Error(j.error.data?.message || j.error.message || `${model}.${method} failed`);
      return j.result;
    };

    // ── 2. Fetch invoices for the year ────────────────────────────────────────
    const invDomain = [
      ['company_id',    '=',  companyId],
      ['move_type',     'in', ['out_invoice', 'out_refund']],
      ['state',         '=',  'posted'],
      ['invoice_date',  '>=', `${year}-01-01`],
      ['invoice_date',  '<=', `${year}-12-31`],
    ];
    const invoices = await exec('account.move', 'search_read', [invDomain], {
      fields: ['id', 'invoice_date', 'amount_untaxed', 'amount_total', 'move_type',
               'invoice_line_ids', 'invoice_user_id', 'partner_id'],
      limit:  10000,
    });
    console.log(`[Odoo] company=${companyId} year=${year} invoices=${invoices.length}`);

    // ── 3. Fetch invoice lines for the year (batched) ─────────────────────────
    const lineIds = [...new Set(invoices.flatMap(i => i.invoice_line_ids || []))];
    const lineFields = ['id', 'move_id', 'date', 'product_id', 'product_uom_id',
                        'quantity', 'price_subtotal', 'price_unit', 'price_total'];
    let lines = [];
    if (lineIds.length > 0) {
      // Fetch in chunks of 5000 to avoid request size limits
      const chunkSize = 5000;
      for (let i = 0; i < lineIds.length; i += chunkSize) {
        const chunk = lineIds.slice(i, i + chunkSize);
        const part = await exec('account.move.line', 'read', [chunk], { fields: lineFields }, 45000);
        lines = lines.concat(part);
      }
    }
    console.log(`[Odoo] lines fetched: ${lines.length}`);

    // ── 4. Fetch product details for sold products ────────────────────────────
    const productIds = [...new Set(lines.map(l => l.product_id && l.product_id[0]).filter(Boolean))];
    let products = [];
    if (productIds.length > 0) {
      const chunkSize = 1000;
      for (let i = 0; i < productIds.length; i += chunkSize) {
        const chunk = productIds.slice(i, i + chunkSize);
        const part = await exec('product.product', 'read', [chunk], {
          fields: ['id', 'name', 'default_code', 'categ_id', 'qty_available',
                   'standard_price', 'list_price', 'type'],
        }, 45000);
        products = products.concat(part);
      }
    }
    const productById = {};
    for (const p of products) productById[p.id] = p;
    console.log(`[Odoo] products fetched: ${products.length}`);

    // ── 5. Fetch partner records — keep customers only (customer_rank > 0) ────
    const partnerIds = [...new Set(invoices.map(i => i.partner_id && i.partner_id[0]).filter(Boolean))];
    let partners = [];
    if (partnerIds.length > 0) {
      const chunkSize = 500;
      for (let i = 0; i < partnerIds.length; i += chunkSize) {
        const chunk = partnerIds.slice(i, i + chunkSize);
        try {
          const part = await exec('res.partner', 'read', [chunk], {
            fields: ['id', 'name', 'customer_rank', 'supplier_rank', 'email', 'phone'],
          }, 30000);
          partners = partners.concat(part);
        } catch (e) {
          // Some Odoo versions may not expose these fields; fall back
          const part = await exec('res.partner', 'read', [chunk], {
            fields: ['id', 'name', 'email', 'phone'],
          }, 30000);
          partners = partners.concat(part);
        }
      }
    }
    const partnerById = {};
    for (const p of partners) partnerById[p.id] = p;
    console.log(`[Odoo] partners fetched: ${partners.length}`);

    // A partner is a real customer if customer_rank > 0,
    // OR if customer_rank field unavailable (older Odoo) AND not pure supplier.
    const isCustomerPartner = (pid) => {
      const p = partnerById[pid];
      if (!p) return true; // unknown — keep
      if (typeof p.customer_rank === 'number' || typeof p.supplier_rank === 'number') {
        const cr = p.customer_rank || 0;
        const sr = p.supplier_rank || 0;
        if (cr > 0) return true;
        if (sr > 0 && cr === 0) return false;
        return true;
      }
      return true;
    };

    // ── 6. Build invoice → date map ───────────────────────────────────────────
    const invById = {};
    for (const inv of invoices) invById[inv.id] = inv;

    const getMoveDate = (line) => {
      if (line.date) return new Date(line.date);
      const inv = invById[line.move_id && line.move_id[0]];
      return inv?.invoice_date ? new Date(inv.invoice_date) : null;
    };
    const getMoveType = (line) => {
      const inv = invById[line.move_id && line.move_id[0]];
      return inv?.move_type;
    };

    // ── 7. Aggregate monthly + weekly with cost from line.product.standard_price ──
    const monthly          = emptyYear();
    const weeklyRevBuckets = {};

    for (const inv of invoices) {
      if (!inv.invoice_date) continue;
      const d = new Date(inv.invoice_date);
      if (d.getFullYear() !== year) continue;

      const mi       = d.getMonth();
      const weekNum  = Math.ceil(d.getDate() / 7);
      const isCredit = inv.move_type === 'out_refund';
      const rev      = parseFloat(inv.amount_untaxed || 0) * (isCredit ? -1 : 1);

      monthly[mi].revenue += rev;
      if (isCredit) monthly[mi].returns++; else monthly[mi].orders++;

      const wkey = `${mi}_${weekNum}`;
      if (!weeklyRevBuckets[wkey]) weeklyRevBuckets[wkey] = { revenue: 0, orders: 0, cost: 0 };
      weeklyRevBuckets[wkey].revenue += rev;
      if (!isCredit) weeklyRevBuckets[wkey].orders++;
    }

    // Aggregate cost per month/week from invoice lines
    for (const line of lines) {
      const d = getMoveDate(line);
      if (!d || d.getFullYear() !== year) continue;
      const mi      = d.getMonth();
      const weekNum = Math.ceil(d.getDate() / 7);
      const isCredit = getMoveType(line) === 'out_refund';
      const prod    = productById[line.product_id && line.product_id[0]];
      const stdCost = prod ? parseFloat(prod.standard_price || 0) : 0;
      const qty     = parseFloat(line.quantity || 0);
      const lineCost = stdCost * qty * (isCredit ? -1 : 1);
      monthly[mi].totalCost += lineCost;
      if (lineCost > 0) monthly[mi].hasCostData = true;
      monthly[mi].marginableRevenue += parseFloat(line.price_subtotal || 0) * (isCredit ? -1 : 1);
      const wkey = `${mi}_${weekNum}`;
      if (!weeklyRevBuckets[wkey]) weeklyRevBuckets[wkey] = { revenue: 0, orders: 0, cost: 0 };
      weeklyRevBuckets[wkey].cost += lineCost;
    }

    for (const m of monthly) {
      m.revenue     = Math.round(m.revenue);
      m.totalCost   = Math.round(m.totalCost);
      m.grossProfit = m.hasCostData ? Math.round(m.marginableRevenue - m.totalCost) : 0;
      m.marginPct   = m.hasCostData && m.marginableRevenue > 0
                       ? Math.round((m.grossProfit / m.marginableRevenue) * 100)
                       : null;
      m.marginableRevenue = Math.round(m.marginableRevenue);
      m.aov         = m.orders > 0 ? Math.round(m.revenue / m.orders) : 0;
    }

    // ── 8. Build weekly array ─────────────────────────────────────────────────
    const getDaysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();
    const weekly = [];
    for (let mi = 0; mi < 12; mi++) {
      for (let w = 1; w <= 5; w++) {
        const startDay = (w - 1) * 7 + 1;
        const endDay   = Math.min(w * 7, getDaysInMonth(year, mi));
        if (startDay > getDaysInMonth(year, mi)) continue;
        const b = weeklyRevBuckets[`${mi}_${w}`];
        const wkRev = b ? Math.round(b.revenue) : 0;
        const wkCost = b ? Math.round(b.cost) : 0;
        const wkHasCost = wkCost > 0;
        weekly.push({
          label:          `${MONTH_NAMES[mi]} W${w}`,
          month:          mi,
          week:           w,
          dateRange:      `${startDay}–${endDay} ${MONTH_NAMES[mi]}`,
          revenue:        wkRev,
          orders:         b ? b.orders : 0,
          aov:            b && b.orders > 0 ? Math.round(b.revenue / b.orders) : 0,
          totalCost:      wkCost,
          grossProfit:    wkHasCost ? wkRev - wkCost : null,
          marginPct:      wkHasCost && wkRev > 0 ? Math.round(((wkRev - wkCost) / wkRev) * 100) : null,
          hasCostData:    wkHasCost,
          totalDiscounts: 0,
          newCustomers:   0,
        });
      }
    }

    // ── 9. Per-salesperson aggregates ─────────────────────────────────────────
    const repData = {};
    for (const inv of invoices) {
      if (!inv.invoice_date) continue;
      const d = new Date(inv.invoice_date);
      if (d.getFullYear() !== year) continue;
      const mi       = d.getMonth();
      const weekNum  = Math.ceil(d.getDate() / 7);
      const isCredit = inv.move_type === 'out_refund';
      const rev      = parseFloat(inv.amount_untaxed || 0) * (isCredit ? -1 : 1);
      const repName  = (inv.invoice_user_id && inv.invoice_user_id[1]) ? inv.invoice_user_id[1] : 'Unassigned';
      if (!repData[repName]) {
        repData[repName] = {
          monthly: Array.from({ length: 12 }, () => ({ revenue: 0, orders: 0 })),
          weeklyBuckets: {},
        };
      }
      repData[repName].monthly[mi].revenue += rev;
      if (!isCredit) repData[repName].monthly[mi].orders++;
      const wkey = `${mi}_${weekNum}`;
      if (!repData[repName].weeklyBuckets[wkey]) repData[repName].weeklyBuckets[wkey] = { revenue: 0, orders: 0 };
      repData[repName].weeklyBuckets[wkey].revenue += rev;
      if (!isCredit) repData[repName].weeklyBuckets[wkey].orders++;
    }

    const salespeople = Object.entries(repData).map(([name, d]) => {
      const totalRev = d.monthly.reduce((s, m) => s + m.revenue, 0);
      const totalOrd = d.monthly.reduce((s, m) => s + m.orders, 0);
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
          if ((w - 1) * 7 + 1 > getDaysInMonth(year, mi)) continue;
          const b = d.weeklyBuckets[`${mi}_${w}`];
          wkly.push({ month: mi, week: w, revenue: b ? Math.round(b.revenue) : 0, orders: b ? b.orders : 0 });
        }
      }
      return { name, weekly: wkly };
    }).sort((a, b) => b.weekly.reduce((s, w) => s + w.revenue, 0) - a.weekly.reduce((s, w) => s + w.revenue, 0));

    // ── 10. Top customers (CUSTOMERS ONLY — exclude pure suppliers) ───────────
    const custData = {};
    const todayMs = Date.now();
    for (const inv of invoices) {
      if (!inv.invoice_date) continue;
      const d = new Date(inv.invoice_date);
      if (d.getFullYear() !== year) continue;
      const pid = inv.partner_id && inv.partner_id[0];
      if (pid && !isCustomerPartner(pid)) continue; // skip suppliers
      const isCredit = inv.move_type === 'out_refund';
      const rev = parseFloat(inv.amount_untaxed || 0) * (isCredit ? -1 : 1);
      const custName = (inv.partner_id && inv.partner_id[1]) ? inv.partner_id[1] : 'Unknown';
      const p = pid ? partnerById[pid] : null;
      if (!custData[custName]) {
        custData[custName] = {
          name: custName, revenue: 0, orders: 0, lastOrderDate: null,
          email: p?.email || '', phone: p?.phone || '',
        };
      }
      custData[custName].revenue += rev;
      if (!isCredit) custData[custName].orders++;
      if (!custData[custName].lastOrderDate || d > new Date(custData[custName].lastOrderDate))
        custData[custName].lastOrderDate = inv.invoice_date;
    }
    const customers = Object.values(custData)
      .filter(c => c.revenue > 0)
      .map(c => {
        const daysSince = c.lastOrderDate ? Math.floor((todayMs - new Date(c.lastOrderDate).getTime()) / 86400000) : null;
        return {
          name: c.name,
          revenue: Math.round(c.revenue),
          orders: c.orders,
          aov: c.orders > 0 ? Math.round(c.revenue / c.orders) : 0,
          email: c.email,
          phone: c.phone,
          lastOrderDate: c.lastOrderDate,
          daysSince,
          status: daysSince === null ? 'Unknown' : daysSince > 90 ? 'Lapsed' : daysSince > 45 ? 'At Risk' : 'Active',
        };
      })
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 100);

    // ── 11. Top products + categories ─────────────────────────────────────────
    const prodAgg = {}; // id → { name, code, category, revenue, qty, cost }
    for (const line of lines) {
      const d = getMoveDate(line);
      if (!d || d.getFullYear() !== year) continue;
      const pid = line.product_id && line.product_id[0];
      if (!pid) continue;
      const prod  = productById[pid] || {};
      const isCredit = getMoveType(line) === 'out_refund';
      const sign  = isCredit ? -1 : 1;
      const rev   = parseFloat(line.price_subtotal || 0) * sign;
      const qty   = parseFloat(line.quantity || 0) * sign;
      const stdC  = parseFloat(prod.standard_price || 0);
      const cost  = stdC * qty;
      const catName = (prod.categ_id && prod.categ_id[1]) ? prod.categ_id[1] : 'Uncategorised';
      if (!prodAgg[pid]) {
        prodAgg[pid] = {
          id: pid,
          name: prod.name || (line.product_id && line.product_id[1]) || `Product ${pid}`,
          code: prod.default_code || '',
          category: catName,
          revenue: 0, qty: 0, cost: 0,
          qtyAvailable: parseFloat(prod.qty_available || 0),
          stdPrice: stdC,
          type: prod.type || 'product',
        };
      }
      prodAgg[pid].revenue += rev;
      prodAgg[pid].qty     += qty;
      prodAgg[pid].cost    += cost;
    }

    const allProducts = Object.values(prodAgg)
      .filter(p => p.revenue > 0)
      .map(p => {
        const gp     = p.revenue - p.cost;
        const margin = p.revenue > 0 ? Math.round((gp / p.revenue) * 100) : 0;
        return {
          title:        p.name,
          code:         p.code,
          category:     p.category,
          revenue:      Math.round(p.revenue),
          unitsSold:    Math.round(p.qty),
          grossProfit:  Math.round(gp),
          margin,
          qtyAvailable: Math.round(p.qtyAvailable),
          stdPrice:     p.stdPrice,
          type:         p.type,
        };
      });

    const topProducts = [...allProducts]
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 50);

    // Top categories
    const catMap = {};
    for (const p of allProducts) {
      const c = p.category;
      if (!catMap[c]) catMap[c] = { category: c, revenue: 0, unitsSold: 0, grossProfit: 0, productCount: 0 };
      catMap[c].revenue     += p.revenue;
      catMap[c].unitsSold   += p.unitsSold;
      catMap[c].grossProfit += p.grossProfit;
      catMap[c].productCount++;
    }
    const topCategories = Object.values(catMap)
      .sort((a, b) => b.revenue - a.revenue)
      .map(c => ({ ...c, margin: c.revenue > 0 ? Math.round((c.grossProfit / c.revenue) * 100) : 0 }));

    // ── 12. Fast & slow movers ────────────────────────────────────────────────
    // Fast = top 20 by units sold per dollar of stock (sell-through)
    const fastMoving = [...allProducts]
      .filter(p => p.unitsSold > 0)
      .sort((a, b) => b.unitsSold - a.unitsSold)
      .slice(0, 20)
      .map(p => ({
        name:         p.title,
        code:         p.code,
        category:     p.category,
        unitsSold:    p.unitsSold,
        revenue:      p.revenue,
        margin:       p.margin,
        currentStock: p.qtyAvailable,
        sellThrough:  p.qtyAvailable > 0 ? Math.round((p.unitsSold / (p.unitsSold + p.qtyAvailable)) * 100) : 100,
      }));

    // Slow = products with on-hand stock but very few units sold (capital tied up)
    const slowMoving = allProducts
      .filter(p => p.qtyAvailable > 0 && p.type !== 'service')
      .map(p => {
        const lockedCapital = Math.round(p.qtyAvailable * p.stdPrice);
        const turnover      = p.unitsSold / Math.max(p.qtyAvailable, 1);
        const slowScore     = lockedCapital * (1 - Math.min(turnover, 1));
        return {
          name:          p.title,
          code:          p.code,
          category:      p.category,
          currentStock:  p.qtyAvailable,
          qtySold:       p.unitsSold,
          lockedCapital,
          slowScore,
        };
      })
      .filter(p => p.lockedCapital > 0)
      .sort((a, b) => b.slowScore - a.slowScore)
      .slice(0, 30)
      .map(({ slowScore: _s, ...rest }) => rest);

    // ── 13. At-risk + lapsed split out from customers ─────────────────────────
    const atRisk  = customers.filter(c => c.status === 'At Risk').slice(0, 50);
    const lapsed  = customers.filter(c => c.status === 'Lapsed').slice(0, 50);

    return NextResponse.json({
      year, company: companyId,
      monthly, weekly,
      salespeople, salespeopleMonthly, salespeopleWeekly,
      customers, atRisk, lapsed,
      topProducts, topCategories, fastMoving, slowMoving,
    });

  } catch (err) {
    console.error(`[Odoo] company=${companyId} year=${year} error:`, err.message);
    return NextResponse.json({
      monthly: emptyYear(), weekly: [],
      salespeople: [], salespeopleMonthly: [], salespeopleWeekly: [],
      customers: [], atRisk: [], lapsed: [],
      topProducts: [], topCategories: [], fastMoving: [], slowMoving: [],
      error: err.message,
    }, { status: 500 });
  }
}
