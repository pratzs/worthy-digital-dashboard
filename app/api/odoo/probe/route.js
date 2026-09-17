/** TEMPORARY. Which call fails for Oceania? */
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
    return j.error ? { _err: (j.error.data?.message || j.error.message || '').slice(0, 200) } : j.result;
  };
  const start = '2026-04-01', end = '2026-09-17';
  const moveDom = [['company_id', '=', cid], ['move_type', 'in', ['out_invoice', 'out_refund']],
    ['state', '=', 'posted'], ['invoice_date', '>=', start], ['invoice_date', '<=', end]];
  const lineDom = [['move_id.company_id', '=', cid], ['move_id.move_type', 'in', ['out_invoice', 'out_refund']],
    ['move_id.state', '=', 'posted'], ['move_id.invoice_date', '>=', start],
    ['move_id.invoice_date', '<=', end], ['display_type', '=', 'product']];

  const out = { company: cid };
  const t = async (k, fn) => { try { const r = await fn(); out[k] = r && r._err ? r : (Array.isArray(r) ? `ok:${r.length} rows` : 'ok'); return r; } catch (e) { out[k] = 'THREW: ' + e.message; } };

  await t('bounds', () => exec('account.move', 'read_group',
    [[['company_id', '=', cid], ['move_type', 'in', ['out_invoice', 'out_refund']], ['state', '=', 'posted']],
     ['invoice_date:max', 'invoice_date:min'], []], { lazy: false }));
  await t('moves', () => exec('account.move', 'read_group',
    [moveDom, ['amount_untaxed:sum'], ['invoice_date:day', 'invoice_user_id', 'move_type']], { lazy: false }));
  const pm = await t('prodMonth', () => exec('account.move.line', 'read_group',
    [lineDom, ['quantity:sum'], ['product_id', 'date:month']], { lazy: false }));
  await t('discounts', () => exec('account.move.line', 'read_group',
    [lineDom, ['price_subtotal:sum'], ['date:month', 'discount']], { lazy: false }));
  if (Array.isArray(pm)) {
    const ids = [...new Set(pm.map(r => r.product_id && r.product_id[0]).filter(Boolean))];
    out.productIdCount = ids.length;
    await t('productRead', () => exec('product.product', 'read', [ids], { fields: ['standard_price'] }));
  }
  return NextResponse.json(out);
}
