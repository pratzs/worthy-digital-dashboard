/** TEMPORARY — is standard_price company-dependent on this database? */
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
  const uid = auth.result;
  const exec = async (model, method, args, kwargs = {}) => {
    const r = await call({ jsonrpc: '2.0', method: 'call', id: 2,
      params: { service: 'object', method: 'execute_kw',
                args: [db, uid, pw, model, method, args, kwargs] } });
    if (r.error) throw new Error(r.error.data?.message || r.error.message || `${model}.${method}`);
    return r.result;
  };
  return { exec, uid };
}

export async function GET(request) {
  const p = new URL(request.url).searchParams;
  const cid = parseInt(p.get('company') || '4', 10);
  const start = p.get('start') || '2026-04-01', end = p.get('end') || '2026-09-17';
  try {
    const { exec, uid } = await connect();

    // Which company does this login default to? That is what a context-free read returns.
    const me = await exec('res.users', 'read', [[uid]], { fields: ['name', 'company_id', 'company_ids'] });
    const companies = await exec('res.company', 'search_read', [[]], { fields: ['name'] });

    // Is standard_price company-dependent on this Odoo?
    const fld = await exec('product.template', 'fields_get', [['standard_price']],
      { attributes: ['company_dependent', 'type', 'store'] });

    // Products sold by this company in the period.
    const lines = await exec('account.move.line', 'read_group',
      [[['move_id.company_id', '=', cid], ['move_id.move_type', 'in', ['out_invoice', 'out_refund']],
        ['move_id.state', '=', 'posted'], ['move_id.invoice_date', '>=', start],
        ['move_id.invoice_date', '<=', end], ['display_type', '=', 'product'],
        ['product_id', '!=', false]],
       ['quantity:sum', 'price_subtotal:sum'], ['product_id']], { lazy: false });

    const ids = lines.map((l) => l.product_id[0]);
    const read = async (ctx) => {
      const out = new Map();
      for (let i = 0; i < ids.length; i += 500) {
        const got = await exec('product.product', 'read', [ids.slice(i, i + 500)],
          ctx ? { fields: ['standard_price'], context: ctx } : { fields: ['standard_price'] });
        for (const g of got) out.set(g.id, Number(g.standard_price) || 0);
      }
      return out;
    };
    const noCtx = await read(null);
    const withCtx = await read({ allowed_company_ids: [cid], company_id: cid });

    let differ = 0, zeroNoCtx = 0, zeroBoth = 0, rescued = 0, rescuedRevenue = 0;
    let costNoCtx = 0, costWithCtx = 0;
    const samples = [];
    for (const l of lines) {
      const id = l.product_id[0];
      const qty = Number(l.quantity) || 0, sub = Number(l.price_subtotal) || 0;
      const a = noCtx.get(id) || 0, b = withCtx.get(id) || 0;
      costNoCtx += qty * a; costWithCtx += qty * b;
      if (a !== b) { differ += 1; if (samples.length < 8) samples.push({ id, name: l.product_id[1], noContext: a, withCompany: b, qty }); }
      if (a === 0) { zeroNoCtx += 1; if (b === 0) zeroBoth += 1; else { rescued += 1; rescuedRevenue += sub; } }
    }

    return NextResponse.json({
      company: cid, period: `${start} .. ${end}`,
      loginDefaultCompany: me[0]?.company_id, loginName: me[0]?.name,
      companiesOnDb: companies,
      standard_price_field: fld.standard_price,
      productsSold: lines.length,
      pricesThatDiffer: differ,
      zeroWithoutContext: zeroNoCtx,
      stillZeroWithCompanyContext: zeroBoth,
      rescuedByCompanyContext: rescued,
      revenueRescued: Math.round(rescuedRevenue * 100) / 100,
      costWithoutContext: Math.round(costNoCtx * 100) / 100,
      costWithCompanyContext: Math.round(costWithCtx * 100) / 100,
      samples,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
