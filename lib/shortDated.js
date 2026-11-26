/**
 * Short-dated stock, Worthy Products (Odoo company 4). 26 Nov 2026.
 *
 * Stock that reaches its best-before date (the lot's `use_date`, where Worthy keeps best-before) within 90 days, or has
 * already passed it, so it can be acted on before it is sold at a loss. For each lot: units on hand, what it cost (today's
 * unit cost), what it would bring in at the clearance price, how fast the product sells (last 90 days), and whether it
 * will sell before its date at that pace.
 *
 * Clearance price = the product's sale price less the Odoo Connector's clearance tiers (services/clearance.py): 50% off
 * with 30 days or less left, 40% with 31 to 60, 30% with 61 to 90. Stock already past its date is counted at nothing:
 * it cannot be sold (the connector holds anything within 15 days back for food safety).
 * Read-only, saved 30 minutes.
 */
import { readWeeks } from '@/lib/odooWeeksCache';
import { odooExec } from '@/lib/repData';
import { nzToday } from '@/lib/ostendo';

const CID = 4;
const WINDOW = 90;
const tierOff = (days) => (days <= 30 ? 0.5 : days <= 60 ? 0.4 : 0.3);
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const idOf = (v) => (Array.isArray(v) ? v[0] : v || null);

async function compute() {
  const base = await odooExec();
  const exec = (m, meth, a, kw = {}, ms) => base(m, meth, a, { ...kw, context: { allowed_company_ids: [CID], company_id: CID, ...(kw.context || {}) } }, ms);
  const today = nzToday();
  const until = addDays(today, WINDOW);
  const quants = await exec('stock.quant', 'search_read', [[['company_id', '=', CID], ['location_id.usage', '=', 'internal'], ['quantity', '>', 0],
    ['lot_id', '!=', false], ['lot_id.use_date', '!=', false], ['lot_id.use_date', '<=', `${until} 23:59:59`]]],
  { fields: ['product_id', 'lot_id', 'location_id', 'quantity', 'reserved_quantity'] }, 90000);
  if (!quants.length) return { generatedAt: new Date().toISOString(), today, rows: [], totals: { lots: 0, units: 0, cost: 0, clearance: 0, atRisk: 0 } };
  const ids = (k) => [...new Set(quants.map((x) => idOf(x[k])).filter(Boolean))];
  const [lots, prods, locs, sold] = await Promise.all([
    exec('stock.lot', 'read', [ids('lot_id')], { fields: ['name', 'use_date'] }, 60000),
    exec('product.product', 'read', [ids('product_id')], { fields: ['display_name', 'default_code', 'standard_price', 'lst_price'] }, 60000),
    exec('stock.location', 'read', [ids('location_id')], { fields: ['complete_name'] }, 60000),
    // Units sold in the last 90 days, per product (delivered to customers)
    exec('stock.move', 'read_group', [[['company_id', '=', CID], ['state', '=', 'done'], ['location_dest_id.usage', '=', 'customer'],
      ['product_id', 'in', ids('product_id')], ['date', '>=', `${addDays(today, -90)} 00:00:00`]], ['product_uom_qty:sum'], ['product_id']], { lazy: false }, 60000),
  ]);
  const lotOf = new Map(lots.map((l) => [l.id, l])); const prodOf = new Map(prods.map((p) => [p.id, p])); const locOf = new Map(locs.map((l) => [l.id, l.complete_name]));
  const pace = new Map(sold.map((r) => [idOf(r.product_id), (Number(r.product_uom_qty) || 0) / 90]));
  // Units of the same product that run out sooner come first in the queue: a later lot sells only after earlier ones
  const byLot = new Map();
  for (const qn of quants) {
    const k = `${idOf(qn.product_id)}|${idOf(qn.lot_id)}`;
    const r = byLot.get(k) || { pid: idOf(qn.product_id), lot: idOf(qn.lot_id), qty: 0, reserved: 0, locations: new Set() };
    r.qty += Number(qn.quantity) || 0; r.reserved += Number(qn.reserved_quantity) || 0; r.locations.add(locOf.get(idOf(qn.location_id)) || ''); byLot.set(k, r);
  }
  const rows = [...byLot.values()].map((r) => {
    const p = prodOf.get(r.pid) || {}; const l = lotOf.get(r.lot) || {};
    const bb = String(l.use_date || '').slice(0, 10);
    const daysLeft = Math.round((Date.parse(`${bb}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
    const unit = Number(p.standard_price) || 0; const price = Number(p.lst_price) || 0;
    const expired = daysLeft < 0;
    const clearanceUnit = expired ? 0 : price * (1 - tierOff(daysLeft));
    return { product: p.display_name || `#${r.pid}`, code: p.default_code || '', lot: l.name || '', bestBefore: bb, daysLeft, expired,
      units: r2(r.qty), reserved: r2(r.reserved), locations: [...r.locations].filter(Boolean),
      inClearance: [...r.locations].some((n) => /clearance|damaged/i.test(n)),
      cost: r2(r.qty * unit), clearanceValue: r2(r.qty * clearanceUnit), clearanceOff: expired ? null : Math.round(tierOff(daysLeft) * 100),
      atRisk: r2(Math.max(0, r.qty * unit - r.qty * clearanceUnit)), perDay: r2(pace.get(r.pid) || 0), pid: r.pid };
  });
  // Will it sell before its date? Same product's lots queue by best-before; a lot sells in time if the units ahead of it
  // plus its own are sold by its date at the last 90 days' pace.
  const byProd = new Map();
  for (const r of rows) { if (!byProd.has(r.pid)) byProd.set(r.pid, []); byProd.get(r.pid).push(r); }
  for (const list of byProd.values()) {
    list.sort((a, b) => a.bestBefore.localeCompare(b.bestBefore));
    let ahead = 0;
    for (const r of list) {
      const need = ahead + r.units;
      r.sellsInTime = !r.expired && r.perDay > 0 && need / r.perDay <= r.daysLeft;
      r.daysToSell = r.perDay > 0 ? Math.round(need / r.perDay) : null;
      ahead = need;
    }
  }
  rows.sort((a, b) => b.atRisk - a.atRisk || a.daysLeft - b.daysLeft);
  const sum = (f, list = rows) => r2(list.reduce((t, r) => t + (r[f] || 0), 0));
  const band = (lo, hi) => rows.filter((r) => r.daysLeft >= lo && r.daysLeft <= hi);
  const bands = [['Past best-before', -100000, -1], ['30 days or less', 0, 30], ['31 to 60 days', 31, 60], ['61 to 90 days', 61, 90]]
    .map(([label, lo, hi]) => { const l = band(lo, hi); return { label, lots: l.length, units: sum('units', l), cost: sum('cost', l), atRisk: sum('atRisk', l) }; });
  const wontSell = rows.filter((r) => !r.sellsInTime);
  return { generatedAt: new Date().toISOString(), today, windowDays: WINDOW, bands,
    totals: { lots: rows.length, units: sum('units'), cost: sum('cost'), clearance: sum('clearanceValue'), atRisk: sum('atRisk'),
      wontSellLots: wontSell.length, wontSellCost: sum('cost', wontSell) },
    rows: rows.map(({ pid, ...r }) => r) };
}

/* One shared copy with a lock (lib/odooWeeksCache.js): only one Odoo read at a time, everyone else gets the copy. */
export const shortDated = async () => (await readWeeks('sd4', 'all', compute, { freshMs: 30 * 60000 })).payload;
