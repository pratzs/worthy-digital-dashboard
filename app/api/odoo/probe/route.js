/** TEMPORARY. Will server-side grouping scale for a financial year? */
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request) {
  const sp = new URL(request.url).searchParams;
  const cid = parseInt(sp.get('company') || '4');
  const start = sp.get('start') || '2026-04-01', end = sp.get('end') || '2026-09-16';
  const url = process.env.ODOO_URL, db = process.env.ODOO_DB;
  const user = process.env.ODOO_USER, pw = process.env.ODOO_PASSWORD;

  const call = async (p) => (await fetch(`${url}/jsonrpc`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(p), signal: AbortSignal.timeout(50000),
  })).json();
  const uid = (await call({ jsonrpc: '2.0', method: 'call', id: 1,
    params: { service: 'common', method: 'authenticate', args: [db, user, pw, {}] } })).result;
  const exec = async (model, method, args, kwargs = {}) => {
    const j = await call({ jsonrpc: '2.0', method: 'call', id: 2,
      params: { service: 'object', method: 'execute_kw', args: [db, uid, pw, model, method, args, kwargs] } });
    return j.error ? { _err: (j.error.data?.message || j.error.message || '').slice(0, 160) } : j.result;
  };

  const lineDom = [
    ['move_id.company_id', '=', cid],
    ['move_id.move_type', 'in', ['out_invoice', 'out_refund']],
    ['move_id.state', '=', 'posted'],
    ['move_id.invoice_date', '>=', start], ['move_id.invoice_date', '<=', end],
    ['display_type', '=', 'product'],
  ];
  const moveDom = [
    ['company_id', '=', cid], ['move_type', 'in', ['out_invoice', 'out_refund']],
    ['state', '=', 'posted'],
    ['invoice_date', '>=', start], ['invoice_date', '<=', end],
  ];

  const t = {}; const timed = async (k, fn) => { const s = Date.now(); const r = await fn(); t[k] = { ms: Date.now() - s, rows: Array.isArray(r) ? r.length : JSON.stringify(r).slice(0, 120) }; return r; };

  // Headers by day + salesperson + type — cheap, drives revenue and counts.
  await timed('movesByDayUser', () => exec('account.move', 'read_group',
    [moveDom, ['amount_untaxed:sum'], ['invoice_date:day', 'invoice_user_id', 'move_type']], { lazy: false }));

  // Lines by product + month — needed because cost is a per-product figure.
  const byProdMonth = await timed('linesByProductMonth', () => exec('account.move.line', 'read_group',
    [lineDom, ['quantity:sum', 'price_subtotal:sum'], ['product_id', 'invoice_date:month']], { lazy: false }));

  // Lines by product + salesperson, for per-rep cost.
  await timed('linesByProductUser', () => exec('account.move.line', 'read_group',
    [lineDom, ['quantity:sum'], ['product_id', 'move_id']], { lazy: false, limit: 1 }));

  // How many distinct products are involved?
  const prodOnly = await timed('linesByProduct', () => exec('account.move.line', 'read_group',
    [lineDom, ['quantity:sum', 'price_subtotal:sum'], ['product_id']], { lazy: false }));
  t.distinctProducts = Array.isArray(prodOnly) ? prodOnly.length : null;

  return NextResponse.json({ company: cid, start, end, timings: t });
}
