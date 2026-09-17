/**
 * Worthy Products North / Oceania — cost per salesperson per WEEK, one month.
 *
 * Kept out of /api/odoo/fy deliberately. Cost is quantity x product standard
 * cost, so week-level cost needs the lines grouped by product AND day, for each
 * rep. Over a financial year that is far too much to carry on every page load.
 * The weekly view only ever shows one month, so this fetches exactly that month
 * and nothing more.
 */
import { NextResponse } from 'next/server';
import { toCents, toDollars, pct1, costCovered } from '@/lib/ostendo';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function connect() {
  const { ODOO_URL: url, ODOO_DB: db, ODOO_USER: user, ODOO_PASSWORD: pw } = process.env;
  const call = async (p) => (await fetch(`${url}/jsonrpc`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p),
    signal: AbortSignal.timeout(45000) })).json();
  const auth = await call({ jsonrpc: '2.0', method: 'call', id: 1,
    params: { service: 'common', method: 'authenticate', args: [db, user, pw, {}] } });
  if (!auth.result) throw new Error('Odoo authentication failed');
  return async (model, method, args, kwargs = {}) => {
    const r = await call({ jsonrpc: '2.0', method: 'call', id: 2,
      params: { service: 'object', method: 'execute_kw',
                args: [db, auth.result, pw, model, method, args, kwargs] } });
    if (r.error) throw new Error(r.error.data?.message || r.error.message || `${model}.${method}`);
    return r.result;
  };
}

const dayOf = (v) => String(v ?? '').substring(0, 10);
const weekOf = (iso) => Math.min(5, Math.ceil(Number(iso.substring(8, 10)) / 7));

export async function GET(request) {
  const p = new URL(request.url).searchParams;
  const cid = parseInt(p.get('company') || '4', 10);
  const month = p.get('month');                       // "2026-09"
  if (!/^\d{4}-\d{2}$/.test(month || '')) return NextResponse.json({ error: 'month=YYYY-MM required' }, { status: 400 });
  const start = `${month}-01`;
  const lastDay = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  const end = `${month}-${String(lastDay).padStart(2, '0')}`;

  try {
    const exec = await connect();
    const lineDom = (type) => [
      ['move_id.company_id', '=', cid], ['move_id.move_type', '=', type],
      ['move_id.state', '=', 'posted'],
      ['move_id.invoice_date', '>=', start], ['move_id.invoice_date', '<=', end],
      ['display_type', '=', 'product'], ['product_id', '!=', false], ['date', '!=', false],
    ];

    // Who sold in this month, and what each invoice is worth per day.
    const moves = await exec('account.move', 'read_group',
      [[['company_id', '=', cid], ['move_type', 'in', ['out_invoice', 'out_refund']],
        ['state', '=', 'posted'], ['invoice_date', '>=', start], ['invoice_date', '<=', end]],
       ['amount_untaxed:sum'], ['invoice_date:day', 'invoice_user_id', 'move_type']], { lazy: false });

    const repIds = new Map();
    const revenue = new Map();   // "rep|week" -> cents
    for (const r of moves) {
      const d = dayOf(r.__range?.['invoice_date:day']?.from); if (!d) continue;
      const name = r.invoice_user_id ? r.invoice_user_id[1] : 'Unassigned';
      if (r.invoice_user_id) repIds.set(name, r.invoice_user_id[0]);
      const sign = r.move_type === 'out_refund' ? -1 : 1;
      const k = `${name}|${weekOf(d)}`;
      revenue.set(k, (revenue.get(k) || 0) + toCents(r.amount_untaxed ?? 0) * sign);
    }

    // Cost per rep per day, from that rep's lines grouped by product and day.
    const cost = new Map();
    const costedRev = new Map();   // "rep|week" -> cents of revenue that HAS a cost behind it
    const entries = [...repIds];
    const runOne = async ([name, id]) => {
      const fetchSide = (type, sign) => exec('account.move.line', 'read_group',
        [[...lineDom(type), ['move_id.invoice_user_id', '=', id]],
         ['quantity:sum', 'price_subtotal:sum'], ['product_id', 'date:day']], { lazy: false })
        .then((rows) => rows.map((r) => ({ ...r, _sign: sign })));
      const [inv, ref] = await Promise.all([fetchSide('out_invoice', 1), fetchSide('out_refund', -1)]);
      const pids = [...new Set([...inv, ...ref].map((r) => r.product_id && r.product_id[0]).filter(Boolean))];
      const prods = pids.length ? await exec('product.product', 'read', [pids], { fields: ['standard_price'] }) : [];
      const std = new Map(prods.map((x) => [x.id, Number(x.standard_price) || 0]));
      for (const r of [...inv, ...ref]) {
        const d = dayOf(r.__range?.['date:day']?.from); if (!d) continue;
        const unit = std.get(r.product_id && r.product_id[0]) || 0;
        const k = `${name}|${weekOf(d)}`;
        cost.set(k, (cost.get(k) || 0) + toCents((Number(r.quantity) || 0) * unit) * r._sign);
        /* Only a product that carries a standard cost can back its own revenue.
           Freight and service lines sell for real money at cost zero, and
           counting them as costed is what turns a week into a 100% margin. */
        if (unit > 0) costedRev.set(k, (costedRev.get(k) || 0) + toCents(r.price_subtotal ?? 0) * r._sign);
      }
    };
    for (let i = 0; i < entries.length; i += 5) {
      await Promise.all(entries.slice(i, i + 5).map(runOne));
    }

    const hasCost = [...cost.values()].some((v) => v !== 0);
    const rows = [...new Set([...revenue.keys(), ...cost.keys()])].map((k) => {
      const [name, week] = k.split('|');
      const rev = revenue.get(k) || 0, cst = cost.get(k);
      const cr = costedRev.get(k) || 0;
      /* Same rule as the financial-year figures: quote a margin only where Odoo
         holds a cost for nearly everything sold in that week. */
      const covered = hasCost && cst != null && costCovered(rev, cr);
      return {
        name, week: Number(week),
        revenue: toDollars(rev),
        cost: hasCost && cst != null ? toDollars(cst) : null,
        grossProfit: covered ? toDollars(rev - cst) : null,
        marginPct: covered ? pct1(rev - cst, rev) : null,
        costCoverage: hasCost && cst != null ? pct1(cr, rev) : null,
        marginWithheld: hasCost && cst != null && !covered,
      };
    });

    return NextResponse.json({ company: cid, month, start, end, hasCost, rows });
  } catch (err) {
    console.error('[odoo/weeks]', err.message);
    return NextResponse.json({ company: cid, month, error: err.message, rows: [] }, { status: 502 });
  }
}
