/** TEMPORARY. Which Odoo cost field is usable, and what do discounts come to? */
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request) {
  const sp = new URL(request.url).searchParams;
  const year = parseInt(sp.get('year') || '2026');
  const cid  = parseInt(sp.get('company') || '4');
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
    return j.error ? { _err: (j.error.data?.message || j.error.message || '').slice(0, 200) } : j.result;
  };

  const lineDom = [
    ['move_id.company_id', '=', cid],
    ['move_id.move_type', 'in', ['out_invoice', 'out_refund']],
    ['move_id.state', '=', 'posted'],
    ['move_id.invoice_date', '>=', `${year}-01-01`],
    ['move_id.invoice_date', '<=', `${year}-12-31`],
    ['display_type', '=', 'product'],
  ];

  const out = { year, company: cid };
  out.lineCount = await exec('account.move.line', 'search_count', [lineDom]);

  // Sales and discount, aggregated server-side — no row limit.
  out.salesAgg = await exec('account.move.line', 'read_group',
    [lineDom, ['price_subtotal:sum', 'quantity:sum'], []], { lazy: false });

  // A wide sample of lines with their products, to test cost candidates.
  const sample = await exec('account.move.line', 'search_read', [lineDom],
    { fields: ['product_id', 'quantity', 'price_unit', 'discount', 'price_subtotal'], limit: 400 });
  out.sampleSize = Array.isArray(sample) ? sample.length : sample;

  if (Array.isArray(sample)) {
    const pids = [...new Set(sample.map(l => l.product_id && l.product_id[0]).filter(Boolean))];
    const prods = await exec('product.product', 'read', [pids],
      { fields: ['standard_price', 'avg_cost', 'purchase_avg_price', 'total_cost', 'list_price'] });
    const byId = {}; (prods || []).forEach(p => byId[p.id] = p);
    const tally = { rev: 0, std: 0, avg: 0, pavg: 0, lines: 0, zeroStd: 0, discountValue: 0 };
    for (const l of sample) {
      const p = byId[l.product_id && l.product_id[0]]; if (!p) continue;
      tally.lines++;
      tally.rev  += l.price_subtotal || 0;
      tally.std  += (l.quantity || 0) * (p.standard_price || 0);
      tally.avg  += (l.quantity || 0) * (p.avg_cost || 0);
      tally.pavg += (l.quantity || 0) * (p.purchase_avg_price || 0);
      if (!p.standard_price) tally.zeroStd++;
      tally.discountValue += (l.quantity || 0) * (l.price_unit || 0) * ((l.discount || 0) / 100);
    }
    out.costTest = tally;
    out.sampleRows = sample.slice(0, 5).map(l => ({
      name: l.product_id && l.product_id[1], qty: l.quantity, price: l.price_unit,
      disc: l.discount, sub: l.price_subtotal,
      std: byId[l.product_id[0]]?.standard_price, pavg: byId[l.product_id[0]]?.purchase_avg_price,
    }));
  }
  return NextResponse.json(out);
}
