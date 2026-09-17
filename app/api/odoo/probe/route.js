/**
 * TEMPORARY independent checker for the Odoo companies.
 * Deliberately groups differently from /api/odoo/fy — by month rather than by
 * day, by rep alone rather than day-and-rep, by product alone rather than
 * product-and-month — so it disagrees if the endpoint is wrong. Delete after use.
 */
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request) {
  const p = new URL(request.url).searchParams;
  const cid = parseInt(p.get('company') || '4', 10);
  const start = p.get('start'), end = p.get('end');
  if (!start || !end) return NextResponse.json({ error: 'start and end required' }, { status: 400 });

  const url = process.env.ODOO_URL, db = process.env.ODOO_DB;
  const user = process.env.ODOO_USER, pw = process.env.ODOO_PASSWORD;
  const call = async (x) => (await fetch(`${url}/jsonrpc`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(x),
    signal: AbortSignal.timeout(50000) })).json();
  const uid = (await call({ jsonrpc: '2.0', method: 'call', id: 1,
    params: { service: 'common', method: 'authenticate', args: [db, user, pw, {}] } })).result;
  const exec = async (m, meth, args, kw = {}) => {
    const j = await call({ jsonrpc: '2.0', method: 'call', id: 2,
      params: { service: 'object', method: 'execute_kw', args: [db, uid, pw, m, meth, args, kw] } });
    if (j.error) throw new Error((j.error.data?.message || j.error.message || '').slice(0, 160));
    return j.result;
  };

  const moveDom = [['company_id', '=', cid], ['move_type', 'in', ['out_invoice', 'out_refund']],
    ['state', '=', 'posted'], ['invoice_date', '>=', start], ['invoice_date', '<=', end]];
  const lineDom = [['move_id.company_id', '=', cid], ['move_id.move_type', 'in', ['out_invoice', 'out_refund']],
    ['move_id.state', '=', 'posted'], ['move_id.invoice_date', '>=', start],
    ['move_id.invoice_date', '<=', end], ['display_type', '=', 'product'],
    ['product_id', '!=', false], ['date', '!=', false]];

  const out = { company: cid, start, end };
  const safe = async (k, fn) => { try { out[k] = await fn(); } catch (e) { out[k] = { _err: e.message }; } };

  // Revenue and counts by MONTH (the endpoint groups by day).
  await safe('byMonth', () => exec('account.move', 'read_group',
    [moveDom, ['amount_untaxed:sum'], ['invoice_date:month', 'move_type']], { lazy: false }));

  // Revenue by REP alone (the endpoint groups by day and rep together).
  await safe('byRep', () => exec('account.move', 'read_group',
    [moveDom, ['amount_untaxed:sum'], ['invoice_user_id', 'move_type']], { lazy: false }));

  // Straight totals, no grouping at all.
  await safe('grandTotal', () => exec('account.move', 'read_group',
    [moveDom, ['amount_untaxed:sum'], ['move_type']], { lazy: false }));
  await safe('invoiceCount', () => exec('account.move', 'search_count',
    [[...moveDom, ['move_type', '=', 'out_invoice']]]));
  await safe('creditCount', () => exec('account.move', 'search_count',
    [[...moveDom, ['move_type', '=', 'out_refund']]]));

  // Cost: quantity by product for the WHOLE period (endpoint splits by month).
  await safe('qtyByProduct', () => exec('account.move.line', 'read_group',
    [lineDom, ['quantity:sum', 'price_subtotal:sum'], ['product_id']], { lazy: false }));

  // Discounts by rate for the whole period (endpoint splits by month).
  await safe('byDiscount', () => exec('account.move.line', 'read_group',
    [[...lineDom.slice(0, 6), ['date', '!=', false]], ['price_subtotal:sum'], ['discount']], { lazy: false }));

  // New customers: partners whose first ever invoice falls inside the period.
  await safe('firstInvoices', () => exec('account.move', 'read_group',
    [[['company_id', '=', cid], ['move_type', '=', 'out_invoice'], ['state', '=', 'posted'],
      ['partner_id', '!=', false]], ['invoice_date:min'], ['partner_id']], { lazy: false }));

  return NextResponse.json(out);
}
