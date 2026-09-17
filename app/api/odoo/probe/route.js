/** TEMPORARY. Is the 10,000 row limit truncating, and what cost/discount data exists? */
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request) {
  const year = parseInt(new URL(request.url).searchParams.get('year') || '2025');
  const url = process.env.ODOO_URL, db = process.env.ODOO_DB;
  const username = process.env.ODOO_USER, password = process.env.ODOO_PASSWORD;

  const call = async (payload) => (await fetch(`${url}/jsonrpc`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload), signal: AbortSignal.timeout(40000),
  })).json();

  const auth = await call({ jsonrpc: '2.0', method: 'call', id: 1,
    params: { service: 'common', method: 'authenticate', args: [db, username, password, {}] } });
  const uid = auth.result;
  if (!uid) return NextResponse.json({ error: 'auth failed' }, { status: 500 });

  const exec = async (model, method, args, kwargs = {}) => {
    const j = await call({ jsonrpc: '2.0', method: 'call', id: 2,
      params: { service: 'object', method: 'execute_kw', args: [db, uid, password, model, method, args, kwargs] } });
    if (j.error) return { _err: j.error.data?.message || j.error.message };
    return j.result;
  };

  const dom = (cid) => [
    ['company_id', '=', cid], ['move_type', 'in', ['out_invoice', 'out_refund']],
    ['state', '=', 'posted'],
    ['invoice_date', '>=', `${year}-01-01`], ['invoice_date', '<=', `${year}-12-31`],
  ];

  const out = { year };
  for (const cid of [4, 1]) {
    out[`company${cid}`] = {
      // How many rows actually match? If this exceeds 10000 the fetch was truncated.
      trueCount: await exec('account.move', 'search_count', [dom(cid)]),
      // Server-side aggregation — no row limit at all.
      byMonth: await exec('account.move', 'read_group',
        [dom(cid), ['amount_untaxed:sum', 'amount_total:sum'], ['invoice_date:month']], { lazy: false }),
    };
  }

  // What can we use for cost, discount and margin on invoice lines?
  const lineFields = await exec('account.move.line', 'fields_get', [[], ['string', 'type']]);
  out.lineFieldsOfInterest = lineFields && !lineFields._err
    ? Object.keys(lineFields).filter(k => /cost|margin|purchase_price|discount|quantity|price_subtotal|product_id/i.test(k)).sort()
    : lineFields;

  const prodFields = await exec('product.product', 'fields_get', [[], ['string', 'type']]);
  out.productCostFields = prodFields && !prodFields._err
    ? Object.keys(prodFields).filter(k => /standard_price|cost|avg/i.test(k)).sort()
    : prodFields;

  return NextResponse.json(out);
}
