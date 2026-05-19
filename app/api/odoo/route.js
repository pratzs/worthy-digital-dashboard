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
               'invoice_user_id', 'partner_id'],
      limit:  10000,
    });
    console.log(`[Odoo] company=${companyId} year=${year} invoices=${invoices.length}`);

    const chunkArray = (arr, size) => {
      const out = [];
      for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
      return out;
    };

    // Lines + product analytics now live in /api/odoo/advanced — keeps this
    // route fast (just invoice headers + partner filter for customers/reps).

    // ── 3. Fetch partner records (for supplier vs customer filter) ────────────
    const partnerIds = [...new Set(invoices.map(i => i.partner_id && i.partner_id[0]).filter(Boolean))];
    let partners = [];
    try {
      if (partnerIds.length > 0) {
        const chunks = chunkArray(partnerIds, 500);
        const results = await Promise.all(chunks.map(async c => {
          try {
            return await exec('res.partner', 'read', [c], {
              fields: ['id', 'name', 'customer_rank', 'supplier_rank', 'email', 'phone'],
            }, 25000);
          } catch (e) {
            try {
              return await exec('res.partner', 'read', [c], {
                fields: ['id', 'name', 'email', 'phone'],
              }, 25000);
            } catch (e2) {
              console.error(`[Odoo] partner chunk failed: ${e2.message}`);
              return [];
            }
          }
        }));
        partners = results.flat();
      }
    } catch (e) {
      console.error(`[Odoo] partners fetch failed: ${e.message}`);
    }

    const partnerById = {};
    for (const p of partners) partnerById[p.id] = p;
    console.log(`[Odoo] partners=${partners.length}/${partnerIds.length}`);

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

    // ── 4. Aggregate monthly + weekly (revenue/orders/returns + new customers)
    const monthly          = emptyYear();
    const weeklyRevBuckets = {};

    // Track each customer's FIRST invoice month this year. A customer is
    // counted as "new" in the earliest month they appear.
    const partnerFirstMonth = {}; // pid → mi

    // Pre-pass: walk invoices in date order (only out_invoice — credit notes
    // shouldn't count as a new-customer trigger).
    const ordered = [...invoices]
      .filter(inv => inv.invoice_date && new Date(inv.invoice_date).getFullYear() === year)
      .filter(inv => inv.move_type !== 'out_refund')
      .sort((a, b) => new Date(a.invoice_date) - new Date(b.invoice_date));
    for (const inv of ordered) {
      const pid = inv.partner_id && inv.partner_id[0];
      if (!pid) continue;
      if (!(pid in partnerFirstMonth)) {
        partnerFirstMonth[pid] = new Date(inv.invoice_date).getMonth();
      }
    }
    for (const mi of Object.values(partnerFirstMonth)) {
      monthly[mi].newCustomers += 1;
    }

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
      if (!weeklyRevBuckets[wkey]) weeklyRevBuckets[wkey] = { revenue: 0, orders: 0 };
      weeklyRevBuckets[wkey].revenue += rev;
      if (!isCredit) weeklyRevBuckets[wkey].orders++;
    }

    for (const m of monthly) {
      m.revenue = Math.round(m.revenue);
      m.aov     = m.orders > 0 ? Math.round(m.revenue / m.orders) : 0;
    }

    // ── 5. Build weekly array ─────────────────────────────────────────────────
    const getDaysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();
    const weekly = [];
    for (let mi = 0; mi < 12; mi++) {
      for (let w = 1; w <= 5; w++) {
        const startDay = (w - 1) * 7 + 1;
        const endDay   = Math.min(w * 7, getDaysInMonth(year, mi));
        if (startDay > getDaysInMonth(year, mi)) continue;
        const b = weeklyRevBuckets[`${mi}_${w}`];
        weekly.push({
          label:          `${MONTH_NAMES[mi]} W${w}`,
          month:          mi,
          week:           w,
          dateRange:      `${startDay}–${endDay} ${MONTH_NAMES[mi]}`,
          revenue:        b ? Math.round(b.revenue) : 0,
          orders:         b ? b.orders : 0,
          aov:            b && b.orders > 0 ? Math.round(b.revenue / b.orders) : 0,
          totalCost:      0,
          grossProfit:    null,
          marginPct:      null,
          hasCostData:    false,
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

    // Products / categories / fast / slow are served by /api/odoo/advanced.

    // ── 11. At-risk + lapsed split out from customers ─────────────────────────
    const atRisk  = customers.filter(c => c.status === 'At Risk').slice(0, 50);
    const lapsed  = customers.filter(c => c.status === 'Lapsed').slice(0, 50);

    return NextResponse.json({
      year, company: companyId,
      monthly, weekly,
      salespeople, salespeopleMonthly, salespeopleWeekly,
      customers, atRisk, lapsed,
    });

  } catch (err) {
    console.error(`[Odoo] company=${companyId} year=${year} error:`, err.message);
    return NextResponse.json({
      monthly: emptyYear(), weekly: [],
      salespeople: [], salespeopleMonthly: [], salespeopleWeekly: [],
      customers: [], atRisk: [], lapsed: [],
      error: err.message,
    }, { status: 500 });
  }
}
