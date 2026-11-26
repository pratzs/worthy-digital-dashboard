/**
 * Clearance and expired stock, with the whole warehouse's value (27 Nov 2026).
 *
 * Worthy Products North (Odoo company 4): every unit on hand in an internal location, valued at the product's standard
 * cost (the same basis as /api/stock-value, so the warehouse total matches the dashboard's stock value), split into one
 * state each, first that fits:
 *   Expired          the lot's best-before (use_date) is before today, wherever it sits
 *   Damaged          in a DAMAGED location (DG/Stock/DAMAGED GOODS, WPW01/DAMAGED)
 *   Clearance        in WPW01/PICK/Clearance
 *   Short-dated      best-before within the next 90 days
 *   Good stock       everything else
 * Worthy Products South / Dutch Rusk (Ostendo): Ostendo keeps no best-before dates (ITEMBATCHES is empty, no stock
 * movement carries an expiry) and has no clearance or damaged location, so only the warehouse total is shown: on hand x
 * buy price, falling back to average cost (the /api/stock-value basis).
 * Read-only, saved 30 minutes.
 */
import { readWeeks } from '@/lib/odooWeeksCache';
import { odooExec } from '@/lib/repData';
import { nzToday, ostendoSql } from '@/lib/ostendo';

const CID = 4;
const UNNAMEABLE = [28085, 28084, 6691, 7503];
const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const idOf = (v) => (Array.isArray(v) ? v[0] : v || null);
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
export const STATES = [
  { key: 'expired', label: 'Past best-before' },
  { key: 'damaged', label: 'Damaged Goods' },
  { key: 'clearance', label: 'Clearance location' },
  { key: 'short', label: 'Best-before within 90 days' },
  { key: 'good', label: 'Good stock' },
];

async function north() {
  const base = await odooExec();
  const exec = (m, meth, a, kw = {}, ms) => base(m, meth, a, { ...kw, context: { allowed_company_ids: [CID], company_id: CID, ...(kw.context || {}) } }, ms);
  const today = nzToday(); const soon = addDays(today, 90);
  const ids = await exec('stock.quant', 'search', [[['company_id', '=', CID], ['location_id.usage', '=', 'internal'], ['quantity', '!=', 0], ['product_id', 'not in', UNNAMEABLE]]], {}, 90000);
  const quants = [];
  for (let i = 0; i < ids.length; i += 5000) quants.push(...await exec('stock.quant', 'read', [ids.slice(i, i + 5000), ['product_id', 'lot_id', 'location_id', 'quantity']], { load: '' }, 90000));
  const uniq = (k) => [...new Set(quants.map((x) => idOf(x[k])).filter(Boolean))];
  const readAll = async (model, list, fields) => { const out = []; for (let i = 0; i < list.length; i += 2000) out.push(...await exec(model, 'read', [list.slice(i, i + 2000), fields], {}, 90000)); return out; };
  const [lots, prods, locs] = await Promise.all([
    readAll('stock.lot', uniq('lot_id'), ['name', 'use_date']),
    readAll('product.product', uniq('product_id'), ['display_name', 'standard_price']),
    readAll('stock.location', uniq('location_id'), ['complete_name']),
  ]);
  const lotOf = new Map(lots.map((l) => [l.id, l])); const prodOf = new Map(prods.map((p) => [p.id, p])); const locName = new Map(locs.map((l) => [l.id, l.complete_name || '']));
  /* Same basis as the dashboard's stock value (/api/stock-value): a product counts when its total on hand is above zero,
     and its negative stock records net off inside it. */
  const prodQty = new Map(); for (const q of quants) prodQty.set(idOf(q.product_id), (prodQty.get(idOf(q.product_id)) || 0) + (Number(q.quantity) || 0));
  const sums = Object.fromEntries(STATES.map((s) => [s.key, { units: 0, value: 0, products: new Set(), lots: new Set() }]));
  const lines = { expired: new Map(), damaged: new Map(), clearance: new Map() };
  for (const q of quants) {
    const pid = idOf(q.product_id);
    if (!((prodQty.get(pid) || 0) > 0)) continue; const lot = lotOf.get(idOf(q.lot_id)); const loc = locName.get(idOf(q.location_id)) || '';
    const bb = String(lot?.use_date || '').slice(0, 10);
    const state = bb && bb < today ? 'expired' : /damaged/i.test(loc) ? 'damaged' : /clearance/i.test(loc) ? 'clearance' : bb && bb <= soon ? 'short' : 'good';
    const qty = Number(q.quantity) || 0; const value = qty * (Number(prodOf.get(pid)?.standard_price) || 0);
    const S = sums[state]; S.units += qty; S.value += value; S.products.add(pid); if (lot) S.lots.add(lot.id);
    if (lines[state]) {
      const k = `${pid}|${lot?.id || 0}|${loc}`;
      const L = lines[state].get(k) || { product: prodOf.get(pid)?.display_name || `#${pid}`, lot: lot?.name || '', bestBefore: bb || null, location: loc, units: 0, value: 0 };
      L.units += qty; L.value += value; lines[state].set(k, L);
    }
  }
  const total = Object.values(sums).reduce((t, s) => ({ units: t.units + s.units, value: t.value + s.value }), { units: 0, value: 0 });
  const list = (m) => [...m.values()].map((l) => ({ ...l, units: r2(l.units), value: r2(l.value) })).sort((a, b) => b.value - a.value);
  return {
    company: 'Worthy Products North', total: { units: r2(total.units), value: r2(total.value) },
    states: STATES.map(({ key, label }) => ({ key, label, units: r2(sums[key].units), value: r2(sums[key].value), products: sums[key].products.size, lots: sums[key].lots.size,
      share: total.value > 0 ? Math.round((sums[key].value / total.value) * 1000) / 10 : 0 })),
    expired: list(lines.expired), damaged: list(lines.damaged), clearance: list(lines.clearance),
  };
}

async function south() {
  const rows = await ostendoSql(`
    SELECT COUNT(*) AS N, SUM(i.ONHANDQTY) AS U, SUM(i.ONHANDQTY * CASE WHEN i.STDBUYPRICE > 0 THEN i.STDBUYPRICE ELSE i.AVERAGECOST END) AS V
    FROM ITEMMASTER i WHERE i.ONHANDQTY > 0`);
  const r = rows?.[0] || {};
  return { company: 'Worthy Products South (Dutch Rusk)', total: { units: r2(r.U), value: r2(r.V), products: Number(r.N) || 0 },
    tracked: false, why: 'Ostendo keeps no best-before dates and has no clearance or damaged location' };
}

const build = async () => {
  const [n, s] = await Promise.all([north().catch((e) => ({ error: String(e.message || e).slice(0, 160) })), south().catch((e) => ({ error: String(e.message || e).slice(0, 160) }))]);
  if (n.error && s.error) throw new Error(n.error);
  return { generatedAt: new Date().toISOString(), today: nzToday(), north: n, south: s };
};
/* One shared copy with a lock (lib/odooWeeksCache.js): only one Odoo read at a time, everyone else gets the copy. */
export const stockStates = async () => (await readWeeks('ss4', 'all-v2', build, { freshMs: 30 * 60000 })).payload;
