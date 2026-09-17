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

    // Dump one rep's invoices, EVERY line, product or not.
    if (p.get('rep')) {
      const users = await exec('res.users', 'search_read', [[['name', 'ilike', p.get('rep')]]], { fields: ['name'] });
      if (!users.length) return NextResponse.json({ error: 'rep not found' }, { status: 404 });
      const moves = await exec('account.move', 'search_read',
        [[['company_id', '=', cid], ['move_type', 'in', ['out_invoice', 'out_refund']],
          ['state', '=', 'posted'], ['invoice_date', '>=', start], ['invoice_date', '<=', end],
          ['invoice_user_id', '=', users[0].id]]],
        { fields: ['name', 'invoice_date', 'move_type', 'amount_untaxed', 'partner_id'], limit: 200, order: 'invoice_date asc' });
      const all = await exec('account.move.line', 'search_read',
        [[['move_id', 'in', moves.map((m) => m.id)]]],
        { fields: ['move_id', 'name', 'display_type', 'product_id', 'quantity', 'price_subtotal', 'account_id'], limit: 0 });
      const pids = [...new Set(all.map((l) => l.product_id && l.product_id[0]).filter(Boolean))];
      const prods = pids.length ? await exec('product.product', 'read', [pids],
        { fields: ['standard_price', 'default_code', 'type'] }) : [];
      const pinfo = new Map(prods.map((x) => [x.id, x]));
      return NextResponse.json({
        rep: users[0].name, invoices: moves.length,
        lineTypes: all.reduce((a, l) => { const k = l.display_type || 'null'; a[k] = (a[k] || 0) + 1; return a; }, {}),
        moves: moves.slice(0, 6).map((m) => ({
          ref: m.name, date: m.invoice_date, type: m.move_type, untaxed: m.amount_untaxed,
          partner: m.partner_id && m.partner_id[1],
          lines: all.filter((l) => l.move_id[0] === m.id).map((l) => ({
            display_type: l.display_type, label: l.name, qty: l.quantity, subtotal: l.price_subtotal,
            account: l.account_id && l.account_id[1],
            product: l.product_id ? l.product_id[1] : null,
            productType: l.product_id ? pinfo.get(l.product_id[0])?.type : null,
            standard_price: l.product_id ? pinfo.get(l.product_id[0])?.standard_price : null,
          })),
        })),
      });
    }

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
