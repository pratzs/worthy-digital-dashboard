import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

/** Odoo JSON-RPC helper — never logs or exposes credentials */
async function odooRpc(service, method, args) {
  const url      = process.env.ODOO_URL;
  const db       = process.env.ODOO_DB;
  const username = process.env.ODOO_USER;
  const password = process.env.ODOO_PASSWORD;

  const res = await fetch(`${url}/jsonrpc`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', method: 'call',
      id: Math.floor(Math.random() * 100000),
      params: { service, method, args: [db, ...args] },
    }),
    signal: AbortSignal.timeout(50000),
  });

  const json = await res.json();
  if (json.error) throw new Error(json.error.data?.message || json.error.message || 'Odoo RPC error');
  return { result: json.result, _creds: { username, password } };
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
    // ── 1. Authenticate (get uid) ─────────────────────────────────────────────
    const authRes = await fetch(`${url}/jsonrpc`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', method: 'call', id: 1,
        params: { service: 'common', method: 'authenticate', args: [db, username, password, {}] },
      }),
      signal: AbortSignal.timeout(15000),
    });
    const authJson = await authRes.json();
    const uid = authJson.result;
    if (!uid) throw new Error('Authentication failed — check ODOO_USER / ODOO_PASSWORD');

    // ── 2. Fetch posted customer invoices + credit notes for the year ─────────
    const domain = [
      ['company_id',    '=',  companyId],
      ['move_type',     'in', ['out_invoice', 'out_refund']],
      ['state',         '=',  'posted'],
      ['invoice_date',  '>=', `${year}-01-01`],
      ['invoice_date',  '<=', `${year}-12-31`],
    ];

    const invoiceRes = await fetch(`${url}/jsonrpc`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', method: 'call', id: 2,
        params: {
          service: 'object', method: 'execute_kw',
          args: [db, uid, password, 'account.move', 'search_read', [domain], {
            fields: ['invoice_date', 'amount_untaxed', 'amount_total', 'move_type', 'invoice_line_ids', 'invoice_user_id', 'partner_id'],
            limit:  5000,
          }],
        },
      }),
      signal: AbortSignal.timeout(45000),
    });
    const invoiceJson = await invoiceRes.json();
    if (invoiceJson.error) throw new Error(invoiceJson.error.data?.message || 'Invoice fetch failed');
    const invoices = invoiceJson.result || [];
    console.log(`[Odoo] company=${companyId} year=${year} invoices=${invoices.length}`);

    // ── 3. Aggregate by month & week ─────────────────────────────────────────
    const monthly          = emptyYear();
    const weeklyRevBuckets = {};

    for (const inv of invoices) {
      if (!inv.invoice_date) continue;
      const d = new Date(inv.invoice_date);
      if (d.getFullYear() !== year) continue;

      const mi       = d.getMonth();
      const weekNum  = Math.ceil(d.getDate() / 7);
      const isCredit = inv.move_type === 'out_refund';
      // amount_untaxed = net excl. tax (same meaning as INVOICENETTAMOUNT in Ostendo)
      const rev      = parseFloat(inv.amount_untaxed || 0) * (isCredit ? -1 : 1);

      monthly[mi].revenue += rev;
      if (isCredit) { monthly[mi].returns++; }
      else          { monthly[mi].orders++;  }

      const wkey = `${mi}_${weekNum}`;
      if (!weeklyRevBuckets[wkey]) weeklyRevBuckets[wkey] = { revenue: 0, orders: 0 };
      weeklyRevBuckets[wkey].revenue += rev;
      if (!isCredit) weeklyRevBuckets[wkey].orders++;
    }

    for (const m of monthly) {
      m.revenue = Math.round(m.revenue);
      m.aov     = m.orders > 0 ? Math.round(m.revenue / m.orders) : 0;
    }

    // ── 4. Build weekly array ─────────────────────────────────────────────────
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
          revenue:        b ? Math.round(b.revenue) : 0,
          orders:         b ? b.orders              : 0,
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

    // ── 5. Per-salesperson aggregates ─────────────────────────────────────────
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

    // ── 6. Top customers ──────────────────────────────────────────────────────
    const custData = {};
    const todayMs = Date.now();
    for (const inv of invoices) {
      if (!inv.invoice_date) continue;
      const d = new Date(inv.invoice_date);
      if (d.getFullYear() !== year) continue;
      const isCredit = inv.move_type === 'out_refund';
      const rev = parseFloat(inv.amount_untaxed || 0) * (isCredit ? -1 : 1);
      const custName = (inv.partner_id && inv.partner_id[1]) ? inv.partner_id[1] : 'Unknown';
      if (!custData[custName]) custData[custName] = { name: custName, revenue: 0, orders: 0, lastOrderDate: null };
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
          lastOrderDate: c.lastOrderDate,
          daysSince,
          status: daysSince === null ? 'Unknown' : daysSince > 90 ? 'Lapsed' : daysSince > 45 ? 'At Risk' : 'Active',
        };
      })
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 50);

    return NextResponse.json({ year, company: companyId, monthly, weekly, salespeople, salespeopleMonthly, salespeopleWeekly, customers });

  } catch (err) {
    console.error(`[Odoo] company=${companyId} year=${year} error:`, err.message);
    return NextResponse.json({ monthly: emptyYear(), weekly: [], error: err.message }, { status: 500 });
  }
}
