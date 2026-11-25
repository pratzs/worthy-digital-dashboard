/**
 * THE agreed sales basis for Worthy Products (Odoo company 4), used by the management chat and connector and by the
 * checks that keep the dashboard and the Odoo Sunday email honest (docs/SALES-BASIS.md).
 *
 *   "Worthy Products" = Odoo company 4 ONLY.
 *   Sales            = product lines on posted customer invoices less credit notes, before GST.
 *   Freight          = NEVER counted: not sales, not margin, not in any total (6030, 7310, shipping products).
 *   Other            = non-freight lines with no product (discounts typed as lines, rebates): not sales, never margin.
 *   Cost             = the cost Odoo booked on each invoice (the cost-of-goods lines on the 7xxx accounts), i.e. what
 *                      accounts reports. A product with no booked cost falls back to its standard cost today; a product
 *                      with neither is left out of the margin base (costCoverage says how much was costed).
 *   Margin %         = (sales - cost) / costed sales.
 *   Sister companies = Dutch Rusk (Worthy Products South, partner 27830) and Worthy Oceania (partner 32490). Sales to them
 *                      are transfers between our own companies: always shown separately, never inside Worthy Products.
 */
import { odooExec } from '@/lib/repData';

export const WP_COMPANY = 4;
export const SISTERS = { dutchRusk: { id: 27830, name: 'Dutch Rusk (Worthy Products South)' }, oceania: { id: 32490, name: 'Worthy Oceania' } };
export const SISTER_IDS = Object.values(SISTERS).map((s) => s.id);
/* Each Odoo company's own sister / related companies: sales to them are transfers between our own companies and are
   never inside that company's figures (shown separately instead). Company 4 = Worthy Products; company 1 = Worthy Oceania. */
export const SISTER_SETS = {
  4: [{ key: 'dutchRusk', ids: [27830], name: 'Dutch Rusk' }, { key: 'oceania', ids: [32490], name: 'Worthy Oceania' }],
  1: [{ key: 'worthyProducts', ids: [9271], name: 'Worthy Products' }, { key: 'dutchRusk', ids: [32462], name: 'Dutch Rusk' },
      { key: 'otherWorthy', ids: [7397, 7391], name: 'Worthy Enterprises and Worthy Properties' }],
};
export const sisterIdsOf = (cid) => (SISTER_SETS[cid] || []).flatMap((x) => x.ids);
/** The Odoo companies reported on this basis (product sales, booked cost, no freight, sisters apart). */
export const ON_BASIS = (cid) => cid === 4 || cid === 1;
/* FREIGHT IS NEVER COUNTED (Pratham, 25 Nov 2026): not in sales, not in margin, not in any total. Freight = any line on
   6030 Freight Recovered or 7310 Outward Freight, or a shipping/delivery product (Standard Shipping 77932, 79478, 77497;
   the delivery method's product 76579), whether or not the line carries a product. */
export const FREIGHT_ACCOUNTS = ['6030', '7310'];
export const FREIGHT_PRODUCT_IDS = [76579, 77932, 79478, 77497, 12872];   // 12872 "[FREIGHT] FREIGHT (Outgoing)", Worthy Oceania: 4 lines on 6020 this FY ($142.98) were counted as sales until 26 Nov 2026
export const NOT_FREIGHT = [['account_id.code', 'not in', FREIGHT_ACCOUNTS], ['product_id', 'not in', FREIGHT_PRODUCT_IDS]];


const r2 = (v) => Math.round(((Number(v) || 0) + Number.EPSILON) * 100) / 100;
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 10000) / 100 : null);
const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s)) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

const addDay = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
/** Calendar-month pieces of a period, so a long period never becomes one request too big for Odoo. */
function pieces(from, to) {
  const out = []; let s = from;
  while (s <= to) {
    const d = new Date(`${s}T00:00:00Z`); const monthEnd = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
    const e = monthEnd < to ? monthEnd : to; out.push([s, e]); s = addDay(e, 1);
  }
  return out;
}

/** Every figure for company 4 between two NZ dates (inclusive). Long periods are read a month at a time and added up. */
export async function wpSales(from, to) {
  if (!isDay(from) || !isDay(to) || from > to) throw new Error('from and to must be dates YYYY-MM-DD, from not after to.');
  if ((Date.parse(to) - Date.parse(from)) / 86400000 > 800) throw new Error('A period can be at most about 2 years; ask per financial year.');
  const exec = await odooExec();
  const acc = { wp: null, dutchRusk: null, oceania: null };
  for (const [a, b] of pieces(from, to)) {
    // Odoo sometimes drops a reused connection part-way through a long run; a month is retried up to twice.
    let part;
    for (let tryNo = 0; ; tryNo++) {
      try { part = await rawBuckets(exec, a, b); break; }
      catch (e) { if (tryNo >= 2 || !/terminated|socket|ECONNRESET|fetch failed|other side closed/i.test(String(e?.message) + String(e?.cause?.code || ''))) throw e; }
    }
    for (const k of Object.keys(acc)) {
      if (!acc[k]) acc[k] = part[k];
      else for (const f of Object.keys(part[k])) acc[k][f] += part[k][f];
    }
  }
  return present(from, to, acc);
}

async function rawBuckets(exec, from, to) {
  const moveDom = [['company_id', '=', WP_COMPANY], ['state', '=', 'posted'], ['move_type', 'in', ['out_invoice', 'out_refund']],
    ['invoice_date', '>=', from], ['invoice_date', '<=', to]];
  const lineBase = [['move_id.company_id', '=', WP_COMPANY], ['move_id.state', '=', 'posted'], ['move_id.move_type', 'in', ['out_invoice', 'out_refund']],
    ['move_id.invoice_date', '>=', from], ['move_id.invoice_date', '<=', to]];
  const [moves, prodLines, otherLines, cogs] = await Promise.all([
    exec('account.move', 'read_group', [moveDom, ['amount_untaxed_signed:sum'], ['commercial_partner_id', 'move_type']], { lazy: false }, 90000),
    exec('account.move.line', 'read_group', [[...lineBase, ['display_type', '=', 'product'], ['product_id', '!=', false], ...NOT_FREIGHT], ['balance:sum'], ['move_id', 'product_id']], { lazy: false }, 120000),
    exec('account.move.line', 'read_group', [[...lineBase, ['display_type', '=', 'product'], ['product_id', '=', false], ['account_id.code', 'not in', FREIGHT_ACCOUNTS]], ['balance:sum'], ['move_id']], { lazy: false }, 90000),
    exec('account.move.line', 'read_group', [[...lineBase, ['display_type', '=', 'cogs'], ['account_id.code', '=like', '7%']], ['balance:sum'], ['move_id', 'product_id']], { lazy: false }, 120000),
  ]);
  // Which bucket each invoice belongs to (company 4 customers, or one of the sisters).
  const moveIds = [...new Set([...prodLines, ...otherLines, ...cogs].map((r) => r.move_id && r.move_id[0]).filter(Boolean))];
  const bucketOf = new Map();
  for (let i = 0; i < moveIds.length; i += 1000) {
    for (const m of await exec('account.move', 'read', [moveIds.slice(i, i + 1000)], { fields: ['commercial_partner_id', 'move_type'] }, 90000)) {
      const p = m.commercial_partner_id && m.commercial_partner_id[0];
      bucketOf.set(m.id, { bucket: p === SISTERS.dutchRusk.id ? 'dutchRusk' : p === SISTERS.oceania.id ? 'oceania' : 'wp', refund: m.move_type === 'out_refund' });
    }
  }
  const B = () => ({ sales: 0, other: 0, ledgerCost: 0, costedSales: 0, stdCost: 0, invoices: 0, credits: 0 });
  const out = { wp: B(), dutchRusk: B(), oceania: B() };
  const cogsBy = new Map(cogs.map((r) => [`${r.move_id[0]}|${r.product_id ? r.product_id[0] : 0}`, Number(r.balance) || 0]));
  // Standard cost fallback for product lines with no booked cost.
  const noCogs = prodLines.filter((r) => !cogsBy.has(`${r.move_id[0]}|${r.product_id[0]}`));
  const std = new Map();
  if (noCogs.length) {
    const pids = [...new Set(noCogs.map((r) => r.product_id[0]))];
    for (let i = 0; i < pids.length; i += 400) for (const p of await exec('product.product', 'read', [pids.slice(i, i + 400)], { fields: ['standard_price'] })) std.set(p.id, Number(p.standard_price) || 0);
  }
  const qtyNeeded = noCogs.length ? await exec('account.move.line', 'read_group', [[...lineBase, ['display_type', '=', 'product'], ['product_id', 'in', [...std.keys()]]], ['quantity:sum'], ['move_id', 'product_id']], { lazy: false }, 90000) : [];
  const qtyBy = new Map(qtyNeeded.map((r) => [`${r.move_id[0]}|${r.product_id[0]}`, Number(r.quantity) || 0]));
  for (const r of prodLines) {
    const info = bucketOf.get(r.move_id[0]); if (!info) continue;
    const t = out[info.bucket]; const sale = -(Number(r.balance) || 0);
    t.sales += sale;
    const key = `${r.move_id[0]}|${r.product_id[0]}`;
    if (cogsBy.has(key)) { t.ledgerCost += cogsBy.get(key); if (cogsBy.get(key) !== 0) t.costedSales += sale; }
    else {
      const unit = std.get(r.product_id[0]) || 0;
      if (unit > 0) { const q = (qtyBy.get(key) || 0) * (info.refund ? -1 : 1); t.stdCost += q * unit; t.costedSales += sale; }
    }
  }
  for (const r of otherLines) { const info = bucketOf.get(r.move_id[0]); if (info) out[info.bucket].other += -(Number(r.balance) || 0); }
  for (const m of moves) {
    const p = m.commercial_partner_id && m.commercial_partner_id[0];
    const t = out[p === SISTERS.dutchRusk.id ? 'dutchRusk' : p === SISTERS.oceania.id ? 'oceania' : 'wp'];
    if (m.move_type === 'out_refund') t.credits += m.__count; else t.invoices += m.__count;
  }
  return out;
}

function present(from, to, out) {
  const show = (t) => {
    const cost = t.ledgerCost + t.stdCost;
    return {
      sales: r2(t.sales), cost: r2(cost), grossProfit: r2(t.costedSales - cost), marginPct: pct(t.costedSales - cost, t.costedSales),
      costCoverage: pct(t.costedSales, t.sales), costFromInvoicesPct: pct(t.ledgerCost, cost),
      otherInvoicedLines: r2(t.other), allInvoiced: r2(t.sales + t.other), invoices: t.invoices, creditNotes: t.credits,
    };
  };
  const wp = show(out.wp), dr = show(out.dutchRusk), oc = show(out.oceania);
  const sistersSales = r2(out.dutchRusk.sales + out.oceania.sales), sistersCost = out.dutchRusk.ledgerCost + out.dutchRusk.stdCost + out.oceania.ledgerCost + out.oceania.stdCost;
  const sistersCosted = out.dutchRusk.costedSales + out.oceania.costedSales;
  return {
    period: { from, to },
    worthyProducts: wp,
    sisterCompanies: {
      dutchRusk: { name: SISTERS.dutchRusk.name, ...dr },
      worthyOceania: { name: SISTERS.oceania.name, ...oc },
      total: { sales: sistersSales, marginPct: pct(sistersCosted - sistersCost, sistersCosted), allInvoiced: r2(dr.allInvoiced + oc.allInvoiced) },
    },
    allInvoicedIncludingSisters: r2(wp.allInvoiced + dr.allInvoiced + oc.allInvoiced),
    basis: 'Worthy Products = Odoo company 4 only. Sales = product lines on posted invoices less credit notes, before GST. Freight (6030, 7310 and shipping products) is never counted anywhere. Other lines with no product (discounts typed as lines, rebates) are not sales and never margin. Cost = the cost Odoo booked on each invoice (cost-of-goods lines), standard cost only where none was booked. Margin % = (sales - cost) / costed sales. Sales to Dutch Rusk and Worthy Oceania are transfers between our own companies, shown separately and never inside Worthy Products.',
  };
}

/**
 * Sales to the sister companies, per NZ day, for the dashboard's separate section. Same basis as wpSales:
 * product sales, booked cost (standard cost only where none was booked), other invoiced lines kept apart.
 * Returns Map(day -> { dutchRusk: {...}, oceania: {...} }) with sums in dollars.
 */
export async function sisterDaily(exec, from, to, cid = WP_COMPANY, skipProducts = []) {
  const sets = SISTER_SETS[cid] || [];
  const ids = sets.flatMap((x) => x.ids);
  if (!ids.length) return new Map();
  const whoOf = new Map(); for (const x of sets) for (const id of x.ids) whoOf.set(id, x.key);
  const lineBase = [['move_id.company_id', '=', cid], ['move_id.state', '=', 'posted'], ['move_id.move_type', 'in', ['out_invoice', 'out_refund']],
    ['move_id.invoice_date', '>=', from], ['move_id.invoice_date', '<=', to], ['move_id.commercial_partner_id', 'in', ids],
    ...(skipProducts.length ? [['product_id', 'not in', skipProducts]] : [])];
  const moves = await exec('account.move', 'search_read', [[['company_id', '=', cid], ['state', '=', 'posted'], ['move_type', 'in', ['out_invoice', 'out_refund']],
    ['invoice_date', '>=', from], ['invoice_date', '<=', to], ['commercial_partner_id', 'in', ids]]], { fields: ['invoice_date', 'commercial_partner_id', 'move_type'] }, 60000);
  if (!moves.length) return new Map();
  const [prod, cogs] = await Promise.all([
    exec('account.move.line', 'search_read', [[...lineBase, ['display_type', '=', 'product'], ['product_id', '!=', false], ...NOT_FREIGHT]], { fields: ['move_id', 'product_id', 'balance', 'quantity'] }, 90000),
    exec('account.move.line', 'search_read', [[...lineBase, ['display_type', '=', 'cogs'], ['account_id.code', '=like', '7%']]], { fields: ['move_id', 'product_id', 'balance'] }, 90000),
  ]);
  const info = new Map(moves.map((m) => [m.id, { day: String(m.invoice_date).slice(0, 10), who: whoOf.get(m.commercial_partner_id[0]), refund: m.move_type === 'out_refund' }]));
  const booked = new Map();
  for (const c of cogs) { const k = `${c.move_id[0]}|${c.product_id ? c.product_id[0] : 0}`; booked.set(k, (booked.get(k) || 0) + (Number(c.balance) || 0)); }
  const noBook = [...new Set(prod.filter((l) => !booked.has(`${l.move_id[0]}|${l.product_id[0]}`)).map((l) => l.product_id[0]))];
  const std = new Map();
  for (let i = 0; i < noBook.length; i += 400) for (const p of await exec('product.product', 'read', [noBook.slice(i, i + 400)], { fields: ['standard_price'] })) std.set(p.id, Number(p.standard_price) || 0);
  const out = new Map();
  const slot = (day, who) => {
    if (!out.has(day)) { const o = {}; for (const x of sets) o[x.key] = { sales: 0, cost: 0, costedSales: 0 }; out.set(day, o); }
    return out.get(day)[who];
  };
  const usedBooked = new Set();
  for (const l of prod) {
    const m = info.get(l.move_id[0]); if (!m || !m.who) continue;
    const t = slot(m.day, m.who); const sale = -(Number(l.balance) || 0); t.sales += sale;
    const k = `${l.move_id[0]}|${l.product_id[0]}`;
    if (booked.has(k)) {
      if (!usedBooked.has(k)) { t.cost += booked.get(k); usedBooked.add(k); }
      if (booked.get(k) !== 0) t.costedSales += sale;
    } else if ((std.get(l.product_id[0]) || 0) > 0) {
      t.cost += (Number(l.quantity) || 0) * std.get(l.product_id[0]) * (m.refund ? -1 : 1); t.costedSales += sale;
    }
  }
  out.sets = sets;
  return out;
}

/** Add up sisterDaily between two days. Returns { <key>: { name, sales, cost, costedSales, marginPct }, ..., total }. */
export function sumSisters(daily, from, to) {
  const sets = daily.sets || [];
  const acc = {}; for (const x of sets) acc[x.key] = { sales: 0, cost: 0, costedSales: 0 };
  for (const [day, v] of daily) {
    if (day < from || day > to) continue;
    for (const x of sets) for (const f of ['sales', 'cost', 'costedSales']) acc[x.key][f] += v[x.key][f];
  }
  const show = (t, name) => ({ ...(name ? { name } : {}), sales: r2(t.sales), cost: r2(t.cost), costedSales: r2(t.costedSales), marginPct: pct(t.costedSales - t.cost, t.costedSales) });
  const out = {}; const tot = { sales: 0, cost: 0, costedSales: 0 };
  for (const x of sets) { out[x.key] = show(acc[x.key], x.name); for (const f of ['sales', 'cost', 'costedSales']) tot[f] += acc[x.key][f]; }
  out.total = show(tot);
  return out;
}
