/** TEMPORARY. Can invoice lines be filtered by salesperson, and how fast? */
import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET() {
  const url = process.env.ODOO_URL, db = process.env.ODOO_DB;
  const user = process.env.ODOO_USER, pw = process.env.ODOO_PASSWORD;
  const call = async (p) => (await fetch(`${url}/jsonrpc`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p),
    signal: AbortSignal.timeout(50000) })).json();
  const uid = (await call({ jsonrpc: '2.0', method: 'call', id: 1,
    params: { service: 'common', method: 'authenticate', args: [db, user, pw, {}] } })).result;
  const exec = async (m, meth, args, kw = {}) => {
    const j = await call({ jsonrpc: '2.0', method: 'call', id: 2,
      params: { service: 'object', method: 'execute_kw', args: [db, uid, pw, m, meth, args, kw] } });
    if (j.error) throw new Error((j.error.data?.message || j.error.message || '').slice(0, 160));
    return j.result;
  };
  const start = '2026-04-01', end = '2026-09-17';
  const base = [['move_id.company_id', '=', 4], ['move_id.move_type', 'in', ['out_invoice', 'out_refund']],
    ['move_id.state', '=', 'posted'], ['move_id.invoice_date', '>=', start],
    ['move_id.invoice_date', '<=', end], ['display_type', '=', 'product'],
    ['product_id', '!=', false], ['date', '!=', false]];

  // Who are the salespeople?
  const reps = await exec('account.move', 'read_group',
    [[['company_id', '=', 4], ['move_type', 'in', ['out_invoice', 'out_refund']], ['state', '=', 'posted'],
      ['invoice_date', '>=', start], ['invoice_date', '<=', end]],
     ['amount_untaxed:sum'], ['invoice_user_id']], { lazy: false });

  const out = { reps: reps.map(r => ({ id: r.invoice_user_id ? r.invoice_user_id[0] : null,
                                       name: r.invoice_user_id ? r.invoice_user_id[1] : 'Unassigned' })) };
  const t0 = Date.now();
  const one = reps.find(r => r.invoice_user_id);
  const rid = one.invoice_user_id[0];
  try {
    const byProd = await exec('account.move.line', 'read_group',
      [[...base, ['move_id.invoice_user_id', '=', rid]], ['quantity:sum', 'price_subtotal:sum'], ['product_id']],
      { lazy: false });
    out.oneRepByProduct = { rep: one.invoice_user_id[1], rows: byProd.length, ms: Date.now() - t0 };
  } catch (e) { out.oneRepByProduct = { error: e.message, ms: Date.now() - t0 }; }

  const t1 = Date.now();
  try {
    const byProdMonth = await exec('account.move.line', 'read_group',
      [[...base, ['move_id.invoice_user_id', '=', rid]], ['quantity:sum'], ['product_id', 'date:month']],
      { lazy: false });
    out.oneRepByProductMonth = { rows: byProdMonth.length, ms: Date.now() - t1 };
  } catch (e) { out.oneRepByProductMonth = { error: e.message, ms: Date.now() - t1 }; }

  return NextResponse.json(out);
}
