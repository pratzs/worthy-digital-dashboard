/** TEMPORARY — understand Worthy Oceania before changing anything. Delete after. */
import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

async function connect() {
  const { ODOO_URL: url, ODOO_DB: db, ODOO_USER: user, ODOO_PASSWORD: pw } = process.env;
  const call = async (p) => (await fetch(`${url}/jsonrpc`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p),
    signal: AbortSignal.timeout(120000) })).json();
  const auth = await call({ jsonrpc: '2.0', method: 'call', id: 1,
    params: { service: 'common', method: 'authenticate', args: [db, user, pw, {}] } });
  if (!auth.result) throw new Error('auth failed');
  return async (model, method, args, kwargs = {}) => {
    const r = await call({ jsonrpc: '2.0', method: 'call', id: 2,
      params: { service: 'object', method: 'execute_kw',
                args: [db, auth.result, pw, model, method, args, kwargs] } });
    if (r.error) throw new Error(r.error.data?.message || r.error.message || `${model}.${method}`);
    return r.result;
  };
}
const tally = (rows, pick) => {
  const m = new Map();
  for (const r of rows) {
    const k = pick(r) ?? '(none)';
    if (!m.has(k)) m.set(k, { docs: 0, untaxed: 0, signed: 0 });
    const b = m.get(k);
    b.docs += 1;
    b.untaxed += Number(r.amount_untaxed) || 0;
    b.signed += Number(r.amount_untaxed_signed) || 0;
  }
  return [...m].map(([k, v]) => ({ key: String(k), docs: v.docs,
    untaxed: Math.round(v.untaxed * 100) / 100, signed: Math.round(v.signed * 100) / 100 }))
    .sort((a, b) => Math.abs(b.signed) - Math.abs(a.signed));
};

export async function GET(request) {
  const p = new URL(request.url).searchParams;
  const cid = parseInt(p.get('company') || '1', 10);
  const start = p.get('start') || '2026-04-01', end = p.get('end') || '2026-09-18';
  try {
    const exec = await connect();
    const company = await exec('res.company', 'read', [[cid]],
      { fields: ['name', 'currency_id', 'country_id', 'parent_id', 'child_ids'] });

    const moves = [];
    for (let off = 0; ; off += 1000) {
      const page = await exec('account.move', 'search_read',
        [[['company_id', '=', cid], ['move_type', 'in', ['out_invoice', 'out_refund']],
          ['state', '=', 'posted'], ['invoice_date', '>=', start], ['invoice_date', '<=', end]]],
        { fields: ['currency_id', 'amount_untaxed', 'amount_untaxed_signed', 'amount_total',
                   'journal_id', 'team_id', 'invoice_user_id', 'partner_id', 'move_type', 'name'],
          limit: 1000, offset: off, order: 'id asc' });
      moves.push(...page);
      if (page.length < 1000) break;
    }

    // How are the two sides of the business separated? Look at every axis we have.
    const axes = {
      currency: tally(moves, (r) => r.currency_id && r.currency_id[1]),
      journal:  tally(moves, (r) => r.journal_id && r.journal_id[1]),
      salesTeam: tally(moves, (r) => r.team_id ? r.team_id[1] : null),
      salesperson: tally(moves, (r) => r.invoice_user_id ? r.invoice_user_id[1] : null),
      invoicePrefix: tally(moves, (r) => String(r.name || '').replace(/\d+/g, '#')),
    };

    // Which product categories does this company actually sell?
    let categories = null, productError = null, brokenVariants = [];
    try {
      const lines = await exec('account.move.line', 'read_group',
        [[['move_id.company_id', '=', cid], ['move_id.move_type', 'in', ['out_invoice', 'out_refund']],
          ['move_id.state', '=', 'posted'], ['move_id.invoice_date', '>=', start],
          ['move_id.invoice_date', '<=', end], ['display_type', '=', 'product'],
          ['product_id', '!=', false]],
         ['price_subtotal:sum', 'quantity:sum'], ['product_id']], { lazy: false });
      categories = { grouped: lines.length };
    } catch (e) {
      productError = e.message;
      // Find the offending variant by reading ids only, then names in small batches.
      try {
        const ids = await exec('account.move.line', 'search_read',
          [[['move_id.company_id', '=', cid], ['move_id.move_type', 'in', ['out_invoice', 'out_refund']],
            ['move_id.state', '=', 'posted'], ['move_id.invoice_date', '>=', start],
            ['move_id.invoice_date', '<=', end], ['display_type', '=', 'product'],
            ['product_id', '!=', false]], ], { fields: ['product_id'], limit: 0 });
        const pids = [...new Set(ids.map((l) => l.product_id[0]))];
        for (const pid of pids) {
          try { await exec('product.product', 'read', [[pid]], { fields: ['display_name', 'categ_id'] }); }
          catch (err) { brokenVariants.push({ id: pid, error: String(err.message).slice(0, 120) }); }
        }
        categories = { productsSold: pids.length };
      } catch (e2) { brokenVariants.push({ scanFailed: e2.message.slice(0, 160) }); }
    }

    return NextResponse.json({
      company: company[0], period: `${start} .. ${end}`,
      documents: moves.length,
      totals: {
        sumOfAmountUntaxed_mixedCurrency: Math.round(moves.reduce((a, r) => a + (Number(r.amount_untaxed) || 0), 0) * 100) / 100,
        sumOfAmountUntaxedSigned_companyCurrency: Math.round(moves.reduce((a, r) => a + (Number(r.amount_untaxed_signed) || 0), 0) * 100) / 100,
      },
      axes, categories, productError, brokenVariants: brokenVariants.slice(0, 10),
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
