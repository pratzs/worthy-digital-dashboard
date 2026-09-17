/**
 * TEMPORARY — independent check of /api/odoo/fy. Delete once the audit is done.
 *
 * Shares NOTHING with the route it checks: no helper from lib/ostendo, no
 * read_group anywhere, no micro-dollar arithmetic, no reconciliation. It reads
 * whole records and adds them up in plain JavaScript, which is the slow, dumb
 * way to get the same answer — and that is exactly the point. A checker that
 * calls the code under test agrees with its bugs.
 */
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

async function connect() {
  const { ODOO_URL: url, ODOO_DB: db, ODOO_USER: user, ODOO_PASSWORD: pw } = process.env;
  const call = async (p) => (await fetch(`${url}/jsonrpc`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p),
    signal: AbortSignal.timeout(120000) })).json();
  const auth = await call({ jsonrpc: '2.0', method: 'call', id: 1,
    params: { service: 'common', method: 'authenticate', args: [db, user, pw, {}] } });
  if (!auth.result) throw new Error('auth failed');
  return async (model, method, args, kwargs = {}) => {
    const r = await call({ jsonrpc: '2.0', method: 'call', id: 2,
      params: { service: 'object', method: 'execute_kw',
                args: [db, auth.result, pw, model, method, args, kwargs] } });
    if (r.error) throw new Error(r.error.data?.message || r.error.message || `${model}.${method}`);
    return r.result;
  };
}

// Page explicitly. Never limit:0, never limit:10000 — both have lied here before.
async function readAll(exec, model, domain, fields) {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await exec(model, 'search_read', [domain], { fields, limit: 1000, offset, order: 'id asc' });
    out.push(...page);
    if (page.length < 1000) break;
  }
  const expect = await exec(model, 'search_count', [domain]);
  return { rows: out, expect, complete: out.length === expect };
}

const round2 = (n) => Math.round(n * 100) / 100;

export async function GET(request) {
  const p = new URL(request.url).searchParams;
  const cid = parseInt(p.get('company') || '4', 10);
  const start = p.get('start'), end = p.get('end');
  if (!start || !end) return NextResponse.json({ error: 'start & end required' }, { status: 400 });

  try {
    const exec = await connect();

    // TEMP probe: how expensive is stock-on-hand for this company?
    if (p.get('probe') === 'stock') {
      const ids = await exec('product.product', 'search',
        [[['type', '=', 'consu']]], { limit: parseInt(p.get('n') || '200', 10) });
      const t0 = Date.now();
      const rows = await exec('product.product', 'read', [ids],
        { fields: ['qty_available', 'standard_price'], context: { allowed_company_ids: [cid], company_id: cid } });
      return NextResponse.json({ probe: 'stock', company: cid, products: rows.length,
        ms: Date.now() - t0, withStock: rows.filter((r) => Number(r.qty_available) > 0).length,
        sample: rows.slice(0, 3).map((r) => ({ id: r.id, qty: r.qty_available })) });
    }

    // Every posted customer invoice and credit note, one record at a time.
    const moves = await readAll(exec, 'account.move',
      [['company_id', '=', cid], ['move_type', 'in', ['out_invoice', 'out_refund']],
       ['state', '=', 'posted'], ['invoice_date', '>=', start], ['invoice_date', '<=', end]],
      ['amount_untaxed', 'amount_total', 'move_type', 'invoice_user_id', 'invoice_date', 'partner_id']);

    let revenue = 0, invoices = 0, credits = 0, creditValue = 0;
    const byRep = new Map(), byMonth = new Map(), repOfMove = new Map(), byCustomer = new Map();
    for (const m of moves.rows) {
      const credit = m.move_type === 'out_refund';
      const amt = (Number(m.amount_untaxed) || 0) * (credit ? -1 : 1);
      revenue += amt;
      if (credit) { credits += 1; creditValue += amt; } else { invoices += 1; }
      const rep = m.invoice_user_id ? m.invoice_user_id[1] : 'Unassigned';
      repOfMove.set(m.id, rep);
      const mk = String(m.invoice_date).substring(0, 7);
      if (!byRep.has(rep)) byRep.set(rep, { revenue: 0, cost: 0, invoices: 0, credits: 0 });
      const r = byRep.get(rep);
      r.revenue += amt; if (credit) r.credits += 1; else r.invoices += 1;
      byMonth.set(mk, (byMonth.get(mk) || 0) + amt);

      const cust = m.partner_id ? m.partner_id[1] : 'Unknown';
      if (!byCustomer.has(cust)) byCustomer.set(cust, { revenue: 0, orders: 0, first: null, last: null });
      const cu = byCustomer.get(cust);
      cu.revenue += amt; if (!credit) cu.orders += 1;
      const day = String(m.invoice_date);
      if (!cu.first || day < cu.first) cu.first = day;
      if (!cu.last || day > cu.last) cu.last = day;
    }

    // Every product line of those documents, one record at a time.
    const lines = await readAll(exec, 'account.move.line',
      [['move_id.company_id', '=', cid], ['move_id.move_type', 'in', ['out_invoice', 'out_refund']],
       ['move_id.state', '=', 'posted'], ['move_id.invoice_date', '>=', start],
       ['move_id.invoice_date', '<=', end], ['display_type', '=', 'product'],
       ['product_id', '!=', false]],
      ['move_id', 'product_id', 'quantity', 'price_subtotal', 'date']);

    const pids = [...new Set(lines.rows.map((l) => l.product_id[0]))];
    const priceOf = new Map(), meta = new Map();
    for (let i = 0; i < pids.length; i += 500) {
      const got = await exec('product.product', 'read', [pids.slice(i, i + 500)],
        { fields: ['standard_price', 'categ_id', 'default_code', 'display_name'] });
      for (const g of got) {
        priceOf.set(g.id, Number(g.standard_price) || 0);
        meta.set(g.id, { cat: g.categ_id ? g.categ_id[1] : null, code: g.default_code || null, name: g.display_name || null });
      }
    }

    // The move decides the sign; Odoo stores credit-note lines positive.
    const signOf = new Map(moves.rows.map((m) => [m.id, m.move_type === 'out_refund' ? -1 : 1]));
    let cost = 0, costedRevenue = 0, linesWithoutDate = 0, linesWithoutMove = 0;
    const costByRep = new Map(), costedByRep = new Map(), costByMonth = new Map();
    const byProduct = new Map(), byCat = new Map();
    for (const l of lines.rows) {
      const mid = l.move_id && l.move_id[0];
      const sign = signOf.get(mid);
      if (sign === undefined) { linesWithoutMove += 1; continue; }
      if (!l.date) linesWithoutDate += 1;
      const unit = priceOf.get(l.product_id[0]) || 0;
      const c = (Number(l.quantity) || 0) * unit * sign;
      const sub = (Number(l.price_subtotal) || 0) * sign;
      cost += c;
      const rep = repOfMove.get(mid) || 'Unassigned';
      costByRep.set(rep, (costByRep.get(rep) || 0) + c);
      if (unit > 0) {
        costedRevenue += sub;
        costedByRep.set(rep, (costedByRep.get(rep) || 0) + sub);
      }
      const mk = String(l.date || '').substring(0, 7);
      if (mk) costByMonth.set(mk, (costByMonth.get(mk) || 0) + c);

      const pid = l.product_id[0];
      if (!byProduct.has(pid)) byProduct.set(pid, { units: 0, revenue: 0, cost: 0 });
      const pr = byProduct.get(pid);
      pr.units += (Number(l.quantity) || 0) * sign;
      pr.revenue += sub;
      pr.cost += c;

      const cat = meta.get(pid)?.cat || 'Uncategorised';
      if (!byCat.has(cat)) byCat.set(cat, { units: 0, revenue: 0, cost: 0, products: new Set() });
      const ca = byCat.get(cat);
      ca.units += (Number(l.quantity) || 0) * sign; ca.revenue += sub; ca.cost += c; ca.products.add(pid);
    }

    return NextResponse.json({
      company: cid, start, end,
      moves: { counted: moves.rows.length, odooSays: moves.expect, complete: moves.complete },
      lines: { counted: lines.rows.length, odooSays: lines.expect, complete: lines.complete,
               withoutDate: linesWithoutDate, orphaned: linesWithoutMove },
      totals: { revenue: round2(revenue), cost: round2(cost), grossProfit: round2(revenue - cost),
                marginPct: revenue > 0 ? Math.round(((revenue - cost) / revenue) * 1000) / 10 : null,
                costedRevenue: round2(costedRevenue), invoices, credits, creditValue: round2(creditValue) },
      months: [...byMonth].sort().map(([k, v]) => ({ key: k, revenue: round2(v), cost: round2(costByMonth.get(k) || 0) })),
      reps: [...byRep].map(([name, r]) => ({
        name, revenue: round2(r.revenue), cost: round2(costByRep.get(name) || 0),
        costedRevenue: round2(costedByRep.get(name) || 0), invoices: r.invoices, credits: r.credits,
      })).sort((a, b) => b.revenue - a.revenue),
      products: [...byProduct].map(([pid, x]) => ({
        id: pid, code: meta.get(pid)?.code, title: meta.get(pid)?.name, category: meta.get(pid)?.cat,
        unitsSold: Math.round(x.units * 100) / 100, revenue: round2(x.revenue), cost: round2(x.cost),
        margin: x.revenue > 0 ? Math.round(((x.revenue - x.cost) / x.revenue) * 1000) / 10 : null,
      })).sort((a, b) => b.revenue - a.revenue).slice(0, 60),
      categories: [...byCat].map(([cat, x]) => ({
        category: cat, unitsSold: Math.round(x.units * 100) / 100, revenue: round2(x.revenue),
        cost: round2(x.cost), productCount: x.products.size,
        margin: x.revenue > 0 ? Math.round(((x.revenue - x.cost) / x.revenue) * 1000) / 10 : null,
      })).sort((a, b) => b.revenue - a.revenue).slice(0, 40),
      customers: [...byCustomer].map(([name, x]) => ({
        name, revenue: round2(x.revenue), orders: x.orders, first: x.first, last: x.last,
      })).sort((a, b) => b.revenue - a.revenue).slice(0, 60),
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
