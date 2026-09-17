/** TEMPORARY. Which stored line fields can carry date and salesperson? */
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request) {
  const sp = new URL(request.url).searchParams;
  const cid = parseInt(sp.get('company') || '4');
  const start = sp.get('start') || '2026-04-01', end = sp.get('end') || '2026-09-16';
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
    return j.error ? { _err: (j.error.data?.message || j.error.message || '').slice(0, 160) } : j.result;
  };

  const out = {};
  const f = await exec('account.move.line', 'fields_get', [[], ['type', 'store', 'string']]);
  out.storedCandidates = f && !f._err
    ? Object.entries(f).filter(([k, v]) => v.store && /date|user|salesperson|team|partner/i.test(k))
        .map(([k, v]) => `${k}:${v.type}`).sort()
    : f;

  const lineDom = [
    ['move_id.company_id', '=', cid],
    ['move_id.move_type', 'in', ['out_invoice', 'out_refund']],
    ['move_id.state', '=', 'posted'],
    ['move_id.invoice_date', '>=', start], ['move_id.invoice_date', '<=', end],
    ['display_type', '=', 'product'],
  ];
  const t = {};
  const timed = async (k, fn) => { const s = Date.now(); const r = await fn(); t[k] = { ms: Date.now() - s, rows: Array.isArray(r) ? r.length : JSON.stringify(r).slice(0, 140) }; return r; };

  // Cost by product and month, using the line's own stored date.
  await timed('productByMonth', () => exec('account.move.line', 'read_group',
    [lineDom, ['quantity:sum', 'price_subtotal:sum'], ['product_id', 'date:month']], { lazy: false }));

  // Can the line be grouped by salesperson directly?
  await timed('productByUser', () => exec('account.move.line', 'read_group',
    [lineDom, ['quantity:sum'], ['product_id', 'invoice_user_id']], { lazy: false }));

  await timed('byUserOnly', () => exec('account.move.line', 'read_group',
    [lineDom, ['quantity:sum', 'price_subtotal:sum'], ['invoice_user_id']], { lazy: false }));

  return NextResponse.json({ company: cid, timings: t, storedCandidates: out.storedCandidates });
}
