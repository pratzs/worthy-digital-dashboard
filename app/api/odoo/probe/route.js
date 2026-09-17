/** TEMPORARY. Which grouping breaks for Oceania? */
import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request) {
  const cid = parseInt(new URL(request.url).searchParams.get('company') || '1', 10);
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
    return j.error ? { _err: (j.error.data?.message || j.error.message || '').slice(0, 220) } : j.result;
  };
  const base = [['move_id.company_id', '=', cid], ['move_id.move_type', 'in', ['out_invoice', 'out_refund']],
    ['move_id.state', '=', 'posted'], ['move_id.invoice_date', '>=', '2026-04-01'],
    ['move_id.invoice_date', '<=', '2026-09-17'], ['display_type', '=', 'product']];
  const safe = [...base, ['product_id', '!=', false], ['date', '!=', false]];
  const r = (x) => Array.isArray(x) ? `ok:${x.length}` : x;

  return NextResponse.json({
    company: cid,
    countBase: await exec('account.move.line', 'search_count', [base]),
    countSafe: await exec('account.move.line', 'search_count', [safe]),
    groupProductOnly: r(await exec('account.move.line', 'read_group',
      [safe, ['quantity:sum'], ['product_id']], { lazy: false })),
    groupMonthOnly: r(await exec('account.move.line', 'read_group',
      [safe, ['quantity:sum'], ['date:month']], { lazy: false })),
    groupProductMonth: r(await exec('account.move.line', 'read_group',
      [safe, ['quantity:sum', 'price_subtotal:sum'], ['product_id', 'date:month']], { lazy: false })),
    groupProductMonthQtyOnly: r(await exec('account.move.line', 'read_group',
      [safe, ['quantity:sum'], ['product_id', 'date:month']], { lazy: false })),
    sampleProducts: await exec('account.move.line', 'search_read', [safe],
      { fields: ['product_id', 'quantity', 'price_subtotal', 'date'], limit: 3 }),
  });
}
