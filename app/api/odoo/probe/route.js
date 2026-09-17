/** TEMPORARY. What exactly does read_group return for grouped date keys? */
import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET() {
  const url = process.env.ODOO_URL, db = process.env.ODOO_DB;
  const user = process.env.ODOO_USER, pw = process.env.ODOO_PASSWORD;
  const call = async (p) => (await fetch(`${url}/jsonrpc`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p),
    signal: AbortSignal.timeout(40000) })).json();
  const uid = (await call({ jsonrpc: '2.0', method: 'call', id: 1,
    params: { service: 'common', method: 'authenticate', args: [db, user, pw, {}] } })).result;
  const exec = async (m, meth, args, kw = {}) => {
    const j = await call({ jsonrpc: '2.0', method: 'call', id: 2,
      params: { service: 'object', method: 'execute_kw', args: [db, uid, pw, m, meth, args, kw] } });
    return j.error ? { _err: (j.error.data?.message || '').slice(0, 200) } : j.result;
  };
  const moveDom = [['company_id', '=', 4], ['move_type', 'in', ['out_invoice', 'out_refund']],
    ['state', '=', 'posted'], ['invoice_date', '>=', '2026-09-10'], ['invoice_date', '<=', '2026-09-16']];
  const lineDom = [['move_id.company_id', '=', 4], ['move_id.move_type', 'in', ['out_invoice', 'out_refund']],
    ['move_id.state', '=', 'posted'], ['move_id.invoice_date', '>=', '2026-09-10'],
    ['move_id.invoice_date', '<=', '2026-09-16'], ['display_type', '=', 'product']];

  return NextResponse.json({
    movesByDay: (await exec('account.move', 'read_group', [moveDom, ['amount_untaxed:sum'],
      ['invoice_date:day', 'invoice_user_id', 'move_type']], { lazy: false }))?.slice?.(0, 3),
    linesByProductMonth: (await exec('account.move.line', 'read_group', [lineDom, ['quantity:sum'],
      ['product_id', 'date:month']], { lazy: false }))?.slice?.(0, 2),
    linesByDiscount: (await exec('account.move.line', 'read_group', [lineDom, ['price_subtotal:sum'],
      ['date:month', 'discount']], { lazy: false }))?.slice?.(0, 3),
  });
}
