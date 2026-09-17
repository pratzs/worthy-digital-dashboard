/** TEMPORARY. Do credit-note lines carry positive or negative quantity? */
import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET() {
  const url = process.env.ODOO_URL, db = process.env.ODOO_DB;
  const user = process.env.ODOO_USER, pw = process.env.ODOO_PASSWORD;
  const call = async (p) => (await fetch(`${url}/jsonrpc`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p),
    signal: AbortSignal.timeout(45000) })).json();
  const uid = (await call({ jsonrpc: '2.0', method: 'call', id: 1,
    params: { service: 'common', method: 'authenticate', args: [db, user, pw, {}] } })).result;
  const exec = async (m, meth, args, kw = {}) => {
    const j = await call({ jsonrpc: '2.0', method: 'call', id: 2,
      params: { service: 'object', method: 'execute_kw', args: [db, uid, pw, m, meth, args, kw] } });
    if (j.error) throw new Error((j.error.data?.message || '').slice(0, 160));
    return j.result;
  };
  const base = (type) => [['move_id.company_id', '=', 4], ['move_id.move_type', '=', type],
    ['move_id.state', '=', 'posted'], ['move_id.invoice_date', '>=', '2026-04-01'],
    ['move_id.invoice_date', '<=', '2026-09-17'], ['display_type', '=', 'product'],
    ['product_id', '!=', false], ['date', '!=', false]];

  const out = {};
  for (const type of ['out_invoice', 'out_refund']) {
    out[type] = (await exec('account.move.line', 'read_group',
      [base(type), ['quantity:sum', 'price_subtotal:sum'], []], { lazy: false }))[0];
    out[type + '_sample'] = await exec('account.move.line', 'search_read', [base(type)],
      { fields: ['quantity', 'price_subtotal', 'product_id'], limit: 3 });
  }
  return NextResponse.json(out);
}
