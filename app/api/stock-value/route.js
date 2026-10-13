/**
 * Stock valuation: what the stock on hand is worth today, one number per store.
 *
 * South (Ostendo): on hand x buy price, falling back to average cost, the same
 * basis the slow-moving table already uses.
 * North (Odoo company 4): the stock valuation Odoo keeps on every quant in an
 * internal location, summed inside Odoo in one call.
 *
 * Totals only, so it is fast and nothing can be cut off by a row limit.
 */
import { cachedAuth } from '@/lib/odooAuth';
import { NextResponse } from 'next/server';
import { ostendoSql } from '@/lib/ostendo';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const UNRENDERABLE_VARIANTS = [28085, 28084, 6691, 7503];

async function rpc(payload, timeoutMs) {
  const res = await fetch(`${process.env.ODOO_URL}/jsonrpc`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload), signal: AbortSignal.timeout(timeoutMs),
  });
  return res.json();
}

async function odooValue(cid) {
  const { ODOO_DB: db, ODOO_USER: user, ODOO_PASSWORD: pw } = process.env;
  const auth = await cachedAuth(() => rpc({ jsonrpc: '2.0', method: 'call', id: 1,
    params: { service: 'common', method: 'authenticate', args: [db, user, pw, {}] } }, 15000),
    process.env.ODOO_URL, db, user);
  if (!auth.result) throw new Error('Odoo authentication failed');
  const call = async (model, method, args, kwargs) => {
    const r = await rpc({ jsonrpc: '2.0', method: 'call', id: 2,
      params: { service: 'object', method: 'execute_kw',
        args: [db, auth.result, pw, model, method, args, kwargs] } }, 50000);
    if (r.error) throw new Error(r.error.data?.message || r.error.message);
    return r.result;
  };
  const ctx = { allowed_company_ids: [cid], company_id: cid };
  /* Quantity per product, summed inside Odoo, then valued at each product's
     standard cost: the same basis the slow-moving table uses. */
  const quants = await call('stock.quant', 'read_group',
    [[['location_id.usage', '=', 'internal'], ['company_id', '=', cid],
      ['product_id', 'not in', UNRENDERABLE_VARIANTS]], ['quantity:sum'], ['product_id']],
    { lazy: false, context: ctx });
  const held = quants.filter((q) => q.product_id && Number(q.quantity) > 0);
  if (!held.length) return 0;
  const info = await call('product.product', 'read', [held.map((q) => q.product_id[0])],
    { fields: ['standard_price'], context: ctx });
  const cost = new Map(info.map((r) => [r.id, Number(r.standard_price) || 0]));
  return held.reduce((t, q) => t + Number(q.quantity) * (cost.get(q.product_id[0]) || 0), 0);
}

async function southValue() {
  const rows = await ostendoSql(`
    SELECT SUM(i.ONHANDQTY * CASE WHEN i.STDBUYPRICE > 0 THEN i.STDBUYPRICE ELSE i.AVERAGECOST END) AS V
    FROM ITEMMASTER i WHERE i.ONHANDQTY > 0`);
  return Number(rows?.[0]?.V) || 0;
}

export async function GET(request) {
  const store = new URL(request.url).searchParams.get('store');
  try {
    const value = store === 'luxe' ? await southValue() : await odooValue(store === 'nova' ? 1 : 4);
    return NextResponse.json({ ok: true, store, value: Math.round(value * 100) / 100,
                               asOf: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e.message || e).slice(0, 200) }, { status: 502 });
  }
}
