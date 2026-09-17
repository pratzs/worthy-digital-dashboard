/** TEMPORARY. Line truncation, discounts and cost candidates for the Odoo companies. */
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request) {
  const sp = new URL(request.url).searchParams;
  const year = parseInt(sp.get('year') || '2026');
  const cid  = parseInt(sp.get('company') || '4');
  const url = process.env.ODOO_URL, db = process.env.ODOO_DB;
  const username = process.env.ODOO_USER, password = process.env.ODOO_PASSWORD;

  const call = async (payload) => (await fetch(`${url}/jsonrpc`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload), signal: AbortSignal.timeout(45000),
  })).json();
  const auth = await call({ jsonrpc: '2.0', method: 'call', id: 1,
    params: { service: 'common', method: 'authenticate', args: [db, username, password, {}] } });
  const uid = auth.result;
  const exec = async (model, method, args, kwargs = {}) => {
    const j = await call({ jsonrpc: '2.0', method: 'call', id: 2,
      params: { service: 'object', method: 'execute_kw', args: [db, uid, password, model, method, args, kwargs] } });
    return j.error ? { _err: j.error.data?.message || j.error.message } : j.result;
  };

  const moveDom = [
    ['company_id', '=', cid], ['move_type', 'in', ['out_invoice', 'out_refund']],
    ['state', '=', 'posted'],
    ['invoice_date', '>=', `${year}-01-01`], ['invoice_date', '<=', `${year}-12-31`],
  ];
  // Product lines only — Odoo also stores tax and total rows on a move.
  const lineDom = [
    ['move_id.company_id', '=', cid],
    ['move_id.move_type', 'in', ['out_invoice', 'out_refund']],
    ['move_id.state', '=', 'posted'],
    ['move_id.invoice_date', '>=', `${year}-01-01`],
    ['move_id.invoice_date', '<=', `${year}-12-31`],
    ['display_type', '=', 'product'],
  ];

  const out = { year, company: cid };
  out.moveCount = await exec('account.move', 'search_count', [moveDom]);
  out.lineCount = await exec('account.move.line', 'search_count', [lineDom]);
  out.lineFetchLimitInCode = 30000;

  // Discounts: Odoo stores a percentage per line.
  out.discountAgg = await exec('account.move.line', 'read_group',
    [lineDom, ['price_subtotal:sum', 'quantity:sum'], []], { lazy: false });
  out.linesWithDiscount = await exec('account.move.line', 'search_count',
    [[...lineDom, ['discount', '>', 0]]]);

  // A sample of lines so we can see what cost fields actually carry.
  out.sampleLines = await exec('account.move.line', 'search_read', [lineDom], {
    fields: ['product_id', 'quantity', 'price_unit', 'discount', 'price_subtotal'], limit: 5,
  });

  const pids = (out.sampleLines || []).map(l => l.product_id && l.product_id[0]).filter(Boolean);
  if (pids.length) out.sampleProducts = await exec('product.product', 'read', [pids],
    { fields: ['name', 'standard_price', 'avg_cost', 'purchase_avg_price', 'total_cost', 'list_price'] });

  return NextResponse.json(out);
}
