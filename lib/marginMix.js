/**
 * What sets the margin, by business (Worthy Products = Odoo company 4, Worthy Oceania = company 1). 26 Nov 2026.
 *
 * Kishan asked why the company margin reads 15.7%. This splits the same sales and the same cost the dashboard's headline
 * uses (docs/SALES-BASIS.md: product lines on posted invoices less credit notes, no freight, sister companies apart) into
 * kinds of sale, so the reader can see what pulls the figure down.
 *
 * Cost is worked exactly as the year figures do it (lib/odooFy.js costByKey): per product and month, the cost Odoo booked
 * on the invoices plus today's unit cost on any quantity with no booked cost; a product and month with neither has no
 * cost and its sales stay out of the margin. Each invoice line then carries its own booked cost plus its share of the
 * rest. So every row adds up to the headline, to the cent.
 *
 *   Clearance or damaged stock   picked from a Clearance or DAMAGED location
 *   Short-dated stock            the lot sold had a best-before date within 90 days of the day it left the warehouse
 *   Credit notes (returns)       a credit note line
 *   No cost in Odoo              a product and month with no cost at all (left out of the margin)
 *   Given free                   no money charged, cost booked
 *   Sold below cost              charged less than its cost
 *   Discount 20% or more / Discount under 20% / No discount
 *
 * Each line falls in the first group that fits. Also by salesperson (every person on their own line), the products that
 * lost the most, who gets the 20%+ discounts (customers and products), and sales to the sister companies with their margin.
 * Read-only. One month is one Odoo read; saved in the shared store for 15 minutes (current month) or 7 days (closed).
 */
import { odooExec } from '@/lib/repData';
import { readWeeks } from '@/lib/odooWeeksCache';
import { kvGet, kvRun } from '@/lib/repStore';
import { after } from 'next/server';
import { SISTER_SETS, FREIGHT_ACCOUNTS, FREIGHT_PRODUCT_IDS } from '@/lib/salesBasis';
import { loadUnitCosts, makeQtyInProductUnit } from '@/lib/odooCost';
import { nzToday } from '@/lib/ostendo';

export const MIX_COMPANIES = { 4: 'Worthy Products', 1: 'Worthy Oceania' };
const SHORT_DAYS = 90;
// Worthy Oceania fabric variants whose names Odoo cannot build (lib/odooFy.js): never ask for their names.
const UNNAMEABLE = new Set([28085, 28084, 6691, 7503]);
export const MIX_GROUPS = [
  { key: 'clearance', label: 'Clearance or damaged stock' },
  { key: 'short', label: 'Short-dated stock' },
  { key: 'returns', label: 'Credit notes (returns)' },
  { key: 'free', label: 'Given free' },
  { key: 'below', label: 'Sold below cost' },
  { key: 'd20', label: 'Discount 20% or more' },
  { key: 'd1', label: 'Discount under 20%' },
  { key: 'list', label: 'No discount' },
  { key: 'nocost', label: 'No cost in Odoo' },
];
const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const pct = (gp, rev) => (rev > 0 ? Math.round((gp / rev) * 1000) / 10 : null);
const monthEnd = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
const idOf = (v) => (Array.isArray(v) ? v[0] : v || null);

/* search + read with load '' (many2one fields come back as plain ids): Odoo never builds a product's name this way, so
   the Oceania variants it cannot name do not break the read. search_read does not take `load`. */
async function sread(exec, model, domain, fields) {
  const ids = await exec(model, 'search', [domain], {}, 120000);
  const out = [];
  for (let i = 0; i < ids.length; i += 5000) out.push(...await exec(model, 'read', [ids.slice(i, i + 5000), fields], { load: '' }, 120000));
  return out;
}
async function chunked(exec, model, domainOf, ids, fields, size = 3000) {
  const out = [];
  for (let i = 0; i < ids.length; i += size) out.push(...await sread(exec, model, domainOf(ids.slice(i, i + size)), fields));
  return out;
}
async function namesOf(exec, model, ids, field = 'display_name') {
  const out = new Map();
  const list = [...new Set(ids.filter(Boolean))];
  for (let i = 0; i < list.length; i += 1000) {
    for (const r of await exec(model, 'read', [list.slice(i, i + 1000)], { fields: [field], context: { active_test: false } }, 60000)) out.set(r.id, r[field]);
  }
  return out;
}

async function connect(cid) {
  const exec = await odooExec();
  return (model, method, args, kw = {}, ms) => exec(model, method, args, { ...kw, context: { allowed_company_ids: [cid], company_id: cid, ...(kw.context || {}) } }, ms);
}

/** Any dates (the caller splits long periods by month). Raw sums in dollars; present() rounds. */
async function computeRange(cid, from, to) {
  const exec = await connect(cid);
  const sets = SISTER_SETS[cid] || [];
  const sisterOf = new Map(sets.flatMap((s) => s.ids.map((id) => [id, s.key])));
  const base = [['move_id.company_id', '=', cid], ['move_id.state', '=', 'posted'], ['move_id.move_type', 'in', ['out_invoice', 'out_refund']],
    ['move_id.invoice_date', '>=', from], ['move_id.invoice_date', '<=', to]];
  const notFreight = [['account_id.code', 'not in', FREIGHT_ACCOUNTS], ['product_id', 'not in', FREIGHT_PRODUCT_IDS]];
  const [lines, cogs, moves, locs] = await Promise.all([
    sread(exec, 'account.move.line', [...base, ['display_type', '=', 'product'], ['product_id', '!=', false], ['date', '!=', false], ...notFreight],
      ['move_id', 'product_id', 'product_uom_id', 'quantity', 'balance', 'discount', 'sale_line_ids', 'date']),
    sread(exec, 'account.move.line', [...base, ['display_type', '=', 'cogs'], ['account_id.code', '=like', '7%'], ['product_id', '!=', false], ['date', '!=', false]],
      ['move_id', 'product_id', 'product_uom_id', 'quantity', 'balance', 'date']),
    sread(exec, 'account.move', [['company_id', '=', cid], ['state', '=', 'posted'], ['move_type', 'in', ['out_invoice', 'out_refund']],
      ['invoice_date', '>=', from], ['invoice_date', '<=', to]], ['invoice_user_id', 'move_type', 'commercial_partner_id']),
    exec('stock.location', 'search_read', [[['company_id', 'in', [cid, false]], '|', ['complete_name', 'ilike', 'Clearance'], ['complete_name', 'ilike', 'DAMAGED']]], { fields: ['id'] }, 30000),
  ]);
  const moveOf = new Map(moves.map((m) => [m.id, m]));
  /* Products with cost booked in these dates on ANY invoice (by the line's accounting date), as the year figures decide
     whether a product's sales count in the margin. Sister invoices aside; never grouped on the variants Odoo cannot name. */
  const bookedAny = new Map((await exec('account.move.line', 'read_group', [[['move_id.company_id', '=', cid], ['move_id.state', '=', 'posted'],
    ['move_id.move_type', 'in', ['out_invoice', 'out_refund']], ['display_type', '=', 'cogs'], ['account_id.code', '=like', '7%'],
    ['date', '>=', from], ['date', '<=', to], ['product_id', '!=', false], ['product_id', 'not in', [...UNNAMEABLE]],
    ...(sets.length ? [['move_id.commercial_partner_id', 'not in', sets.flatMap((x) => x.ids)]] : [])], ['balance:sum'], ['product_id']], { lazy: false }, 60000))
    .map((r) => [idOf(r.product_id), Number(r.balance) || 0]));
  const scopeOf = (moveId) => sisterOf.get(moveOf.get(moveId)?.commercial_partner_id) || 'own';
  const isRefundMove = (moveId) => moveOf.get(moveId)?.move_type === 'out_refund';

  // Unit cost and units, exactly as the year figures (North: dropship cost where there is no standard cost; Oceania: units converted)
  const pids = [...new Set(lines.map((l) => l.product_id))];
  const { costOf, prods } = await loadUnitCosts(exec, cid, pids, { dropship: cid === 4 });
  const qtyOf = await makeQtyInProductUnit(exec, prods, cid !== 4);
  const q = (l) => qtyOf({ quantity: l.quantity, product_id: [l.product_id], product_uom_id: [idOf(l.product_uom_id)] });

  // Sale lines picked from clearance/damaged, and sale lines whose lot was within 90 days of its best-before date
  const saleIds = [...new Set(lines.flatMap((l) => l.sale_line_ids || []))];
  const clrSale = new Set(), shortSale = new Set();
  if (saleIds.length) {
    if (locs.length) {
      const sm = await chunked(exec, 'stock.move', (ids) => [['sale_line_id', 'in', ids], ['state', '=', 'done'], ['location_id', 'child_of', locs.map((l) => l.id)]], saleIds, ['sale_line_id']);
      for (const m of sm) if (m.sale_line_id) clrSale.add(idOf(m.sale_line_id));
    }
    const ml = await chunked(exec, 'stock.move.line', (ids) => [['move_id.sale_line_id', 'in', ids], ['state', '=', 'done'], ['lot_id.use_date', '!=', false]], saleIds, ['move_id', 'lot_id', 'date']);
    if (ml.length) {
      const lotDate = await namesOf(exec, 'stock.lot', ml.map((x) => idOf(x.lot_id)), 'use_date');
      const smv = await chunked(exec, 'stock.move', (ids) => [['id', 'in', ids]], [...new Set(ml.map((x) => idOf(x.move_id)))], ['sale_line_id'], 3000);
      const saleOfMove = new Map(smv.map((m) => [m.id, idOf(m.sale_line_id)]));
      for (const x of ml) {
        const bb = String(lotDate.get(idOf(x.lot_id)) || '').slice(0, 10); const left = (Date.parse(bb) - Date.parse(String(x.date).slice(0, 10))) / 86400000;
        if (bb && Number.isFinite(left) && left <= SHORT_DAYS) { const s = saleOfMove.get(idOf(x.move_id)); if (s) shortSale.add(s); }
      }
    }
  }

  // Booked cost per invoice+product (signed), and per scope+product+month (cost and quantity, as the year figures)
  const month = (d) => String(d).slice(0, 7);
  const bookedItem = new Map(), bookedPM = new Map();
  for (const c of cogs) {
    const ik = `${c.move_id}|${c.product_id}`; const bal = Number(c.balance) || 0;
    const bi = bookedItem.get(ik) || { cost: 0, qty: 0 }; bi.cost += bal; bi.qty += (isRefundMove(c.move_id) ? -1 : 1) * q(c); bookedItem.set(ik, bi);
    const pk = `${scopeOf(c.move_id)}|${c.product_id}|${month(c.date)}`;
    const bp = bookedPM.get(pk) || { cost: 0, qty: 0 }; bp.cost += bal; bp.qty += (isRefundMove(c.move_id) ? -1 : 1) * q(c); bookedPM.set(pk, bp);
  }
  // Items: one product on one invoice
  const items = new Map(); const pms = new Map();
  for (const l of lines) {
    const k = `${l.move_id}|${l.product_id}`;
    const it = items.get(k) || { move: l.move_id, pid: l.product_id, scope: scopeOf(l.move_id), month: month(l.date), rev: 0, gross: 0, qty: 0, disc: 0, clr: false, short: false };
    const rev = -(Number(l.balance) || 0); const d = Number(l.discount) || 0;
    it.rev += rev; it.gross += d > 0 && d < 100 ? rev / (1 - d / 100) : rev; it.disc = Math.max(it.disc, d);
    it.qty += (isRefundMove(l.move_id) ? -1 : 1) * q(l);
    if ((l.sale_line_ids || []).some((id) => clrSale.has(id))) it.clr = true;
    if ((l.sale_line_ids || []).some((id) => shortSale.has(id))) it.short = true;
    items.set(k, it);
  }
  for (const [k, it] of items) {
    const pk = `${it.scope}|${it.pid}|${it.month}`;
    const p = pms.get(pk) || { qty: 0, items: [] }; p.qty += it.qty; p.items.push(k); pms.set(pk, p);
  }
  // Cost per product+month as the year figures, then shared out to its items
  for (const [pk, p] of pms) {
    const [, pid] = pk.split('|'); const unit = costOf.get(Number(pid)) || 0; const b = bookedPM.get(pk);
    const total = b ? b.cost + (Math.abs(p.qty - b.qty) > 1e-6 ? (p.qty - b.qty) * unit : 0) : p.qty * unit;
    const costed = (b ? b.cost !== 0 : false) || unit > 0 || (pk.startsWith('own|') && (bookedAny.get(Number(pid)) || 0) !== 0);
    const own = p.items.map((k) => bookedItem.get(k)?.cost || 0);
    const rest = total - own.reduce((t, v) => t + v, 0);
    const weights = p.items.map((k) => { const it = items.get(k); return it.qty - (bookedItem.get(k)?.qty || 0); });
    let wsum = weights.reduce((t, v) => t + v, 0);
    const byRev = Math.abs(wsum) < 1e-9;
    if (byRev) wsum = p.items.reduce((t, k) => t + items.get(k).rev, 0);
    p.items.forEach((k, i) => {
      const it = items.get(k);
      const share = Math.abs(rest) < 1e-9 ? 0 : Math.abs(wsum) < 1e-9 ? rest / p.items.length : rest * ((byRev ? it.rev : weights[i]) / wsum);
      it.cost = own[i] + share; it.costed = costed;
    });
  }

  const userName = await namesOf(exec, 'res.users', moves.map((m) => m.invoice_user_id), 'name');
  const groups = Object.fromEntries(MIX_GROUPS.map((g) => [g.key, { rev: 0, cost: 0, discount: 0, lines: 0 }]));
  const people = {}, losers = {}, deepCust = {}, deepProd = {}, sisters = {}, customers = {}, nocostProd = {};
  for (const it of items.values()) {
    const cost = it.cost || 0;
    /* Free in, free out (27 Nov 2026, Pratham): display stands, towels, shirts and other merchandise the supplier gives us
       free and we give the customer free. $0 sale and $0 cost: no effect on any figure, so they are left out of every list. */
    if (Math.abs(it.rev) < 0.005 && Math.abs(cost) < 0.005) continue;
    if (it.scope !== 'own') {
      const S = sisters[it.scope] || (sisters[it.scope] = { rev: 0, cost: 0, costedRev: 0 });
      S.rev += it.rev; S.cost += cost; if (it.costed) S.costedRev += it.rev;
      continue;
    }
    const isRefund = isRefundMove(it.move);
    // No cost first, whatever the line: the headline leaves every uncosted line (credit notes too) out of the margin base
    const g = !it.costed ? 'nocost' : it.clr ? 'clearance' : it.short && !isRefund ? 'short' : isRefund ? 'returns'
      : (it.rev <= 0.005 && cost > 0) ? 'free' : it.rev < cost ? 'below' : it.disc >= 20 ? 'd20' : it.disc > 0 ? 'd1' : 'list';
    const disc = it.gross - it.rev;
    const G = groups[g]; G.rev += it.rev; G.cost += cost; G.discount += disc; G.lines += 1;
    const who = userName.get(moveOf.get(it.move)?.invoice_user_id) || 'No salesperson';
    const P = people[who] || (people[who] = { rev: 0, cost: 0, clearance: 0, short: 0, belowLoss: 0, discount: 0, nocost: 0, deep: 0 });
    P.rev += it.rev; P.cost += cost; P.discount += disc;
    if (g === 'clearance') P.clearance += it.rev;
    if (g === 'short') P.short += it.rev;
    if (g === 'nocost') P.nocost += it.rev;
    if (g === 'd20') P.deep += it.rev;
    if (!isRefund && it.costed && cost > it.rev) P.belowLoss += cost - it.rev;
    if (!isRefund && it.costed && cost > it.rev + 0.005) {
      const L = losers[it.pid] || (losers[it.pid] = { rev: 0, cost: 0, people: {} });
      L.rev += it.rev; L.cost += cost; L.people[who] = (L.people[who] || 0) + (cost - it.rev);
    }
    // Every customer (27 Nov 2026): sales, the sales with a cost, their cost, discount given and who sold to them
    {
      const ck = moveOf.get(it.move)?.commercial_partner_id || 0;
      const C = customers[ck] || (customers[ck] = { rev: 0, crev: 0, cost: 0, discount: 0, below: 0, people: {} });
      C.rev += it.rev; C.discount += disc; C.people[who] = (C.people[who] || 0) + it.rev;
      if (g !== 'nocost') { C.crev += it.rev; C.cost += cost; }
      if (!isRefund && it.costed && cost > it.rev) C.below += cost - it.rev;
    }
    // Products sold with no cost in Odoo: kept out of the margin, listed so the cost can be fixed
    if (g === 'nocost') {
      const N = nocostProd[it.pid] || (nocostProd[it.pid] = { rev: 0, lines: 0, people: {} });
      N.rev += it.rev; N.lines += 1; N.people[who] = (N.people[who] || 0) + it.rev;
    }
    if (g === 'd20') {
      const cust = moveOf.get(it.move)?.commercial_partner_id || 0;
      for (const [map, key] of [[deepCust, cust], [deepProd, it.pid]]) {
        const D = map[key] || (map[key] = { rev: 0, cost: 0, discount: 0, people: {} });
        D.rev += it.rev; D.cost += cost; D.discount += disc; D.people[who] = (D.people[who] || 0) + it.rev;
      }
    }
  }
  // Names only for what is shown (never for the variants Odoo cannot name)
  const topKeys = (obj, by, n = 40) => Object.entries(obj).sort((a, b) => by(b[1]) - by(a[1])).slice(0, n).map(([k]) => Number(k));
  const prodIds = [...topKeys(losers, (v) => v.cost - v.rev), ...topKeys(deepProd, (v) => v.discount), ...topKeys(nocostProd, (v) => Math.abs(v.rev))].filter((id) => !UNNAMEABLE.has(id));
  const prodName = await namesOf(exec, 'product.product', prodIds);
  const custName = await namesOf(exec, 'res.partner', [...new Set([...topKeys(deepCust, (v) => v.discount), ...Object.keys(customers).map(Number)])].filter(Boolean));
  const named = (obj, names, by) => Object.fromEntries(topKeys(obj, by).map((k) => [names.get(k) || (UNNAMEABLE.has(k) ? 'Fabric variant (no name in Odoo)' : k ? `#${k}` : 'No customer'), obj[k]]));
  return {
    from, to, generatedAt: new Date().toISOString(),
    groups, people, sisters,
    losers: named(losers, prodName, (v) => v.cost - v.rev),
    deepCustomers: named(deepCust, custName, (v) => v.discount),
    deepProducts: named(deepProd, prodName, (v) => v.discount),
    // Keyed by name so months add up; every customer is kept (a month holds a few hundred)
    customers: Object.fromEntries(Object.entries(customers).map(([k, v]) => [custName.get(Number(k)) || (Number(k) ? `#${k}` : 'No customer'), v])),
    nocostProducts: named(nocostProd, prodName, (v) => Math.abs(v.rev)),
  };
}

const mergeMap = (into, from) => {
  for (const [n, v] of Object.entries(from || {})) {
    const o = into[n] || (into[n] = {});
    for (const [f, x] of Object.entries(v)) {
      if (f === 'people') { o.people = o.people || {}; for (const [w, y] of Object.entries(x)) o.people[w] = (o.people[w] || 0) + y; }
      else o[f] = (o[f] || 0) + (Number(x) || 0);
    }
  }
};
/** Add pieces together (several months, or the year so far). */
function combine(parts) {
  const out = { groups: Object.fromEntries(MIX_GROUPS.map((g) => [g.key, { rev: 0, cost: 0, discount: 0, lines: 0 }])), people: {}, losers: {}, deepCustomers: {}, deepProducts: {}, sisters: {}, customers: {}, nocostProducts: {}, partial: false };
  for (const p of parts) {
    for (const g of MIX_GROUPS) for (const f of ['rev', 'cost', 'discount', 'lines']) out.groups[g.key][f] += p.groups[g.key]?.[f] || 0;
    for (const k of ['people', 'losers', 'deepCustomers', 'deepProducts', 'sisters', 'customers', 'nocostProducts']) mergeMap(out[k], p[k]);
    if (!p.customers) out.partial = true;   // a month still on the older saved copy, before customers were added
  }
  return out;
}

function present(cid, raw, meta) {
  let rev = 0, cost = 0, discount = 0;
  for (const g of Object.values(raw.groups)) { rev += g.rev; cost += g.cost; discount += g.discount; }
  const uncosted = raw.groups.nocost?.rev || 0; const nocostCost = raw.groups.nocost?.cost || 0;
  const crev = rev - uncosted;   // the margin base, as the headline
  const all = pct(crev - cost, crev);
  const effect = (r0, c0) => { const r = crev - r0, c = cost - c0; const without = pct(r - c, r); return without == null || all == null ? null : Math.round((without - all) * 10) / 10; };
  const share = (v) => (rev > 0 ? Math.round((v / rev) * 1000) / 10 : 0);
  const groups = MIX_GROUPS.map(({ key, label }) => {
    const g = raw.groups[key];
    if (key === 'nocost') return { key, label, revenue: r2(g.rev), cost: r2(g.cost), grossProfit: null, marginPct: null, share: share(g.rev), discount: r2(g.discount), lines: g.lines, pullPts: null };
    return { key, label, revenue: r2(g.rev), cost: r2(g.cost), grossProfit: r2(g.rev - g.cost), marginPct: g.rev > 0 ? pct(g.rev - g.cost, g.rev) : null,
      share: share(g.rev), discount: r2(g.discount), lines: g.lines, pullPts: effect(g.rev, g.cost) };
  });
  const people = Object.entries(raw.people).map(([name, p]) => { const pc = p.rev - (p.nocost || 0); return { name, revenue: r2(p.rev), cost: r2(p.cost), grossProfit: r2(pc - p.cost),
    marginPct: pct(pc - p.cost, pc), clearance: r2(p.clearance), shortDated: r2(p.short), deepDiscount: r2(p.deep), belowCostLoss: r2(p.belowLoss), discount: r2(p.discount),
    share: share(p.rev), pullPts: effect(pc, p.cost) }; })
    .filter((p) => Math.abs(p.revenue) >= 0.5 || Math.abs(p.cost) >= 0.5).sort((a, b) => b.revenue - a.revenue);
  const whoList = (o) => Object.entries(o || {}).sort((a, b) => b[1] - a[1]).map(([n]) => n);
  const losers = Object.entries(raw.losers).map(([name, l]) => ({ name, revenue: r2(l.rev), cost: r2(l.cost), loss: r2(l.cost - l.rev), people: whoList(l.people) }))
    .sort((a, b) => b.loss - a.loss).slice(0, 12);
  const deep = (o) => Object.entries(o).map(([name, d]) => ({ name, revenue: r2(d.rev), discount: r2(d.discount), marginPct: pct(d.rev - d.cost, d.rev), people: whoList(d.people) }))
    .sort((a, b) => b.discount - a.discount).slice(0, 12);
  const sets = SISTER_SETS[cid] || [];
  const sisters = Object.fromEntries(sets.map((s) => { const v = raw.sisters[s.key] || { rev: 0, cost: 0, costedRev: 0 };
    return [s.key, { name: s.name, sales: r2(v.rev), cost: r2(v.cost), costedSales: r2(v.costedRev), marginPct: v.costedRev > 0 ? Math.round(((v.costedRev - v.cost) / v.costedRev) * 10000) / 100 : null }]; }));
  const sTot = Object.values(raw.sisters).reduce((t, v) => ({ rev: t.rev + v.rev, cost: t.cost + v.cost, costedRev: t.costedRev + v.costedRev }), { rev: 0, cost: 0, costedRev: 0 });
  return { ...meta, company: cid, companyName: MIX_COMPANIES[cid], revenue: r2(rev), cost: r2(cost - nocostCost), grossProfit: r2(crev - (cost - nocostCost)), marginPct: pct(crev - (cost - nocostCost), crev),
    costedRevenue: r2(crev), discount: r2(discount), groups, people, losers, deepCustomers: deep(raw.deepCustomers), deepProducts: deep(raw.deepProducts),
    sisterSales: { ...sisters, total: { sales: r2(sTot.rev), cost: r2(sTot.cost), costedSales: r2(sTot.costedRev), marginPct: sTot.costedRev > 0 ? Math.round(((sTot.costedRev - sTot.cost) / sTot.costedRev) * 10000) / 100 : null } },
    sisters: r2(sTot.rev),
    customers: raw.partial ? null : Object.entries(raw.customers || {}).map(([name, c]) => ({ name, revenue: r2(c.rev), costedRevenue: r2(c.crev), cost: r2(c.cost),
      grossProfit: r2(c.crev - c.cost), marginPct: c.crev > 0 ? pct(c.crev - c.cost, c.crev) : null, discount: r2(c.discount), belowCostLoss: r2(c.below),
      share: share(c.rev), people: whoList(c.people), pullPts: effect(c.crev, c.cost) }))
      .filter((c) => Math.abs(c.revenue) >= 0.5 || Math.abs(c.cost) >= 0.5).sort((a, b) => b.revenue - a.revenue).slice(0, 3000),
    nocostProducts: Object.entries(raw.nocostProducts || {}).filter(([, n]) => Math.abs(n.rev) >= 0.005).map(([name, n]) => ({ name, revenue: r2(n.rev), lines: n.lines, people: whoList(n.people) }))
      .sort((a, b) => Math.abs(b.revenue) - Math.abs(a.revenue)).slice(0, 25) };
}

/** The months of financial year `fy` that have started, April first. */
export const fyMonths = (fy, today = nzToday()) => {
  const out = [];
  for (let i = 0; i < 12; i++) { const m = (3 + i) % 12; const y = m >= 3 ? fy : fy + 1; const ym = `${y}-${String(m + 1).padStart(2, '0')}`; if (`${ym}-01` <= today) out.push(ym); }
  return out;
};

async function monthRaw(cid, ym) {
  const NEW = `mix${cid}g`, OLD = `mix${cid}f`;
  try {
    const have = await kvGet(`wk:last:v1:${NEW}:${ym}`);
    if (!have) {
      const old = await kvGet(`wk:last:v1:${OLD}:${ym}`);
      if (old) {
        const today = nzToday(); const last = monthEnd(ym);
        // One rebuild at a time across the company; if one is running, this month waits for a later visit or the warm-up
        try { after(async () => {
          if ((await kvRun(['SET', 'mixbuild:any', '1', 'NX', 'EX', '300']).catch(() => null)) !== 'OK') return;
          try { await readWeeks(NEW, ym, () => computeRange(cid, `${ym}-01`, last < today ? last : today), { wait: 0 }); } catch { /* next time */ }
          finally { await kvRun(['DEL', 'mixbuild:any']).catch(() => {}); }
        }); } catch { /* outside a request */ }
        return { ...JSON.parse(old), cached: 'stale' };
      }
    }
  } catch { /* the store is a convenience */ }
  return monthRawNew(cid, ym, NEW);
}
async function monthRawNew(cid, ym, key) {
  const today = nzToday(); const last = monthEnd(ym);
  const current = ym === today.slice(0, 7);
  const { payload, cached } = await readWeeks(key, ym, () => computeRange(cid, `${ym}-01`, last < today ? last : today),
    { freshMs: current ? 30 * 60000 : 7 * 86400000 });
  return { ...payload, cached };
}

/* Part of a month (chosen dates, the weekly summary's last week): one shared copy per piece with a lock, like the year
   figures, so several viewers never start the same Odoo read. A piece ending before today is kept 6 hours; one running
   to today, 15 minutes (27 Nov 2026). */
const partCached = async (cid, from, to) => {
  const { payload } = await readWeeks(`mixq${cid}`, `${from}_${to}`, () => computeRange(cid, from, to),
    { freshMs: to >= nzToday() ? 15 * 60000 : 6 * 3600000 });
  return payload;
};

async function rangeRaw(cid, from, to) {
  const today = nzToday();
  if (to > today) to = today;
  const parts = [];
  let s = from;
  while (s <= to) {
    const ym = s.slice(0, 7); const me = monthEnd(ym);
    const e = me < to ? me : to;
    const wholeMonth = s === `${ym}-01` && (e === me || e === today);
    parts.push(wholeMonth ? await monthRaw(cid, ym) : await partCached(cid, s, e));
    s = new Date(Date.parse(`${e}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
  }
  return { parts, to };
}

/** `period`: 'YYYY-MM', 'fy:YYYY' (the financial year so far) or 'YYYY-MM-DD:YYYY-MM-DD'. `cid`: 4 or 1. */
export async function marginMix(period, cid = 4) {
  cid = Number(cid);
  if (!MIX_COMPANIES[cid]) throw new Error('period must be YYYY-MM or fy:YYYY (company 4 or 1)');
  let from, to;
  const r = /^(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})$/.exec(period || '');
  const m = /^fy:(\d{4})$/.exec(period || '');
  if (r) { [from, to] = [r[1], r[2]]; }
  else if (/^\d{4}-\d{2}$/.test(period || '')) { from = `${period}-01`; to = monthEnd(period); }
  else if (m) { from = `${m[1]}-04-01`; to = `${Number(m[1]) + 1}-03-31`; }
  else throw new Error('period must be YYYY-MM or fy:YYYY');
  if (from > to || (Date.parse(to) - Date.parse(from)) / 86400000 > 800) throw new Error('period must be YYYY-MM or fy:YYYY (start first, at most about 2 years)');
  const { parts, to: until } = await rangeRaw(cid, from, to);
  const gen = parts.map((p) => p.generatedAt).sort()[0];
  return present(cid, combine(parts), { period, from, to: until, generatedAt: gen, stale: parts.some((p) => p.stale) });
}
