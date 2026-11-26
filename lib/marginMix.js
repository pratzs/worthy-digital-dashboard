/**
 * What sets Worthy Products' margin (Odoo company 4), month by month (26 Nov 2026).
 *
 * Kishan asked why the company margin reads 15.7%. This splits the same sales and the same cost the dashboard's headline
 * uses (docs/SALES-BASIS.md: product lines on posted invoices less credit notes, no freight, sister companies apart, cost =
 * the cost Odoo booked on each invoice, standard cost where none was booked) into kinds of sale, so the reader can see
 * what pulls the figure down:
 *
 *   Clearance or damaged stock   picked from WPW01/PICK/Clearance or DG/Stock/DAMAGED GOODS (the stock Bansri puts on
 *                                Kishan's name when it is sold)
 *   Given free                   no money charged, cost booked (free stock, 100% discount)
 *   Sold below cost              charged less than the booked cost
 *   Discount 20% or more         the line carries a discount of 20% or more
 *   Discount under 20%           the line carries a smaller discount
 *   No discount                  sold at the line's own price
 *
 * Each invoice line (one product on one invoice) falls in the first group it matches, in that order, so the groups add up
 * to the headline exactly. Also by salesperson (every person on their own line) and the products that lost the most.
 * Read-only. One month is one Odoo read of its invoice lines; it is saved in the shared store (lib/odooWeeksCache.js
 * protection) for 15 minutes for the current month and 7 days for a closed month, so Odoo is not asked again and again.
 */
import { odooExec } from '@/lib/repData';
import { readWeeks } from '@/lib/odooWeeksCache';
import { SISTERS, FREIGHT_ACCOUNTS, FREIGHT_PRODUCT_IDS } from '@/lib/salesBasis';
import { nzToday } from '@/lib/ostendo';

const WP = 4;
const SISTER_IDS = Object.values(SISTERS).map((s) => s.id);
export const MIX_GROUPS = [
  { key: 'clearance', label: 'Clearance or damaged stock' },
  { key: 'free', label: 'Given free' },
  { key: 'below', label: 'Sold below cost' },
  { key: 'd20', label: 'Discount 20% or more' },
  { key: 'd1', label: 'Discount under 20%' },
  { key: 'list', label: 'No discount' },
];
const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const pct = (gp, rev) => (rev > 0 ? Math.round((gp / rev) * 1000) / 10 : null);
const monthEnd = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };

async function chunked(exec, model, domainOf, ids, fields, size = 3000) {
  const out = [];
  for (let i = 0; i < ids.length; i += size) out.push(...await exec(model, 'search_read', [domainOf(ids.slice(i, i + size))], { fields }, 90000));
  return out;
}

/** One calendar month (YYYY-MM), up to today. Raw sums in dollars; present() rounds. */
async function computeMonth(ym) {
  const exec = await odooExec();
  const from = `${ym}-01`;
  const last = monthEnd(ym); const today = nzToday();
  const to = last < today ? last : today;
  const base = [['move_id.company_id', '=', WP], ['move_id.state', '=', 'posted'], ['move_id.move_type', 'in', ['out_invoice', 'out_refund']],
    ['move_id.invoice_date', '>=', from], ['move_id.invoice_date', '<=', to]];
  const ours = [...base, ['move_id.commercial_partner_id', 'not in', SISTER_IDS]];
  const [lines, cogs, moves, sis, locs] = await Promise.all([
    exec('account.move.line', 'search_read', [[...ours, ['display_type', '=', 'product'], ['product_id', '!=', false],
      ['account_id.code', 'not in', FREIGHT_ACCOUNTS], ['product_id', 'not in', FREIGHT_PRODUCT_IDS]]],
    { fields: ['move_id', 'product_id', 'quantity', 'balance', 'discount', 'sale_line_ids'] }, 120000),
    exec('account.move.line', 'search_read', [[...ours, ['display_type', '=', 'cogs'], ['account_id.code', '=like', '7%'], ['product_id', '!=', false]]],
      { fields: ['move_id', 'product_id', 'balance'] }, 120000),
    exec('account.move', 'search_read', [[['company_id', '=', WP], ['state', '=', 'posted'], ['move_type', 'in', ['out_invoice', 'out_refund']],
      ['invoice_date', '>=', from], ['invoice_date', '<=', to]]], { fields: ['invoice_user_id', 'move_type'] }, 60000),
    exec('account.move.line', 'read_group', [[...base, ['move_id.commercial_partner_id', 'in', SISTER_IDS], ['display_type', '=', 'product'],
      ['product_id', '!=', false], ['account_id.code', 'not in', FREIGHT_ACCOUNTS], ['product_id', 'not in', FREIGHT_PRODUCT_IDS]], ['balance:sum'], []], { lazy: false }, 60000),
    exec('stock.location', 'search_read', [['|', ['complete_name', 'ilike', 'Clearance'], ['complete_name', 'ilike', 'DAMAGED']]], { fields: ['complete_name'] }, 30000),
  ]);
  const moveOf = new Map(moves.map((m) => [m.id, m]));
  const personOf = (moveId) => (moveOf.get(moveId)?.invoice_user_id || [0, 'No salesperson'])[1];

  // Sale lines whose goods were picked from a clearance or damaged location
  const clrSale = new Set();
  const saleIds = [...new Set(lines.flatMap((l) => l.sale_line_ids || []))];
  if (locs.length && saleIds.length) {
    const sm = await chunked(exec, 'stock.move', (ids) => [['sale_line_id', 'in', ids], ['state', '=', 'done'], ['location_id', 'child_of', locs.map((l) => l.id)]],
      saleIds, ['sale_line_id']);
    for (const m of sm) if (m.sale_line_id) clrSale.add(m.sale_line_id[0]);
  }

  // Booked cost per invoice + product; standard cost where nothing was booked (same as the headline)
  const key = (l) => `${l.move_id[0]}|${l.product_id[0]}`;
  const booked = new Map();
  for (const c of cogs) booked.set(key(c), (booked.get(key(c)) || 0) + (Number(c.balance) || 0));
  const items = new Map();
  for (const l of lines) {
    const k = key(l);
    const it = items.get(k) || { move: l.move_id[0], pid: l.product_id[0], pname: l.product_id[1], rev: 0, gross: 0, qty: 0, disc: 0, clr: false };
    const rev = -(Number(l.balance) || 0); const d = Number(l.discount) || 0;
    it.rev += rev; it.gross += d > 0 && d < 100 ? rev / (1 - d / 100) : rev; it.disc = Math.max(it.disc, d);
    it.qty += (moveOf.get(l.move_id[0])?.move_type === 'out_refund' ? -1 : 1) * (Number(l.quantity) || 0);
    if ((l.sale_line_ids || []).some((id) => clrSale.has(id))) it.clr = true;
    items.set(k, it);
  }
  const noCost = [...items.entries()].filter(([k]) => !booked.has(k)).map(([, it]) => it.pid);
  const std = new Map();
  if (noCost.length) {
    const ps = await chunked(exec, 'product.product', (ids) => [['id', 'in', ids]], [...new Set(noCost)], ['standard_price'], 1000);
    for (const p of ps) std.set(p.id, Number(p.standard_price) || 0);
  }

  const groups = Object.fromEntries(MIX_GROUPS.map((g) => [g.key, { rev: 0, cost: 0, discount: 0, lines: 0 }]));
  const people = new Map(); const losers = new Map();
  for (const [k, it] of items) {
    const cost = booked.has(k) ? booked.get(k) : (std.get(it.pid) || 0) * it.qty;
    const g = it.clr ? 'clearance' : (it.rev <= 0.005 && cost > 0) ? 'free' : it.rev < cost ? 'below' : it.disc >= 20 ? 'd20' : it.disc > 0 ? 'd1' : 'list';
    const disc = it.gross - it.rev;
    const G = groups[g]; G.rev += it.rev; G.cost += cost; G.discount += disc; G.lines += 1;
    const who = personOf(it.move);
    const P = people.get(who) || { rev: 0, cost: 0, clearance: 0, belowLoss: 0, discount: 0 };
    P.rev += it.rev; P.cost += cost; P.discount += disc;
    if (g === 'clearance') P.clearance += it.rev;
    if (cost > it.rev) P.belowLoss += cost - it.rev;
    people.set(who, P);
    if (cost > it.rev + 0.005) {
      const L = losers.get(it.pname) || { rev: 0, cost: 0, people: {} };
      L.rev += it.rev; L.cost += cost; L.people[who] = (L.people[who] || 0) + (cost - it.rev);
      losers.set(it.pname, L);
    }
  }
  return {
    month: ym, from, to, generatedAt: new Date().toISOString(),
    groups, people: Object.fromEntries(people), losers: Object.fromEntries(losers),
    sisters: -(Number(sis?.[0]?.balance) || 0),
  };
}

/** Add month results together (the year so far). */
function combine(parts) {
  const out = { groups: Object.fromEntries(MIX_GROUPS.map((g) => [g.key, { rev: 0, cost: 0, discount: 0, lines: 0 }])), people: {}, losers: {}, sisters: 0 };
  for (const p of parts) {
    for (const g of MIX_GROUPS) for (const f of ['rev', 'cost', 'discount', 'lines']) out.groups[g.key][f] += p.groups[g.key][f];
    for (const [n, v] of Object.entries(p.people)) { const o = out.people[n] || (out.people[n] = { rev: 0, cost: 0, clearance: 0, belowLoss: 0, discount: 0 }); for (const f of Object.keys(o)) o[f] += v[f]; }
    for (const [n, v] of Object.entries(p.losers)) {
      const o = out.losers[n] || (out.losers[n] = { rev: 0, cost: 0, people: {} });
      o.rev += v.rev; o.cost += v.cost; for (const [w, x] of Object.entries(v.people)) o.people[w] = (o.people[w] || 0) + x;
    }
    out.sisters += p.sisters;
  }
  return out;
}

function present(raw, meta) {
  let rev = 0, cost = 0, discount = 0;
  for (const g of Object.values(raw.groups)) { rev += g.rev; cost += g.cost; discount += g.discount; }
  const groups = MIX_GROUPS.map(({ key, label }) => {
    const g = raw.groups[key];
    return { key, label, revenue: r2(g.rev), cost: r2(g.cost), grossProfit: r2(g.rev - g.cost), marginPct: pct(g.rev - g.cost, g.rev),
      share: rev > 0 ? Math.round((g.rev / rev) * 1000) / 10 : 0, discount: r2(g.discount), lines: g.lines,
      // what this group does to the company margin: the margin without it, minus the margin with it
      pullPts: (() => { const r = rev - g.rev, c = cost - g.cost; const without = pct(r - c, r); const all = pct(rev - cost, rev); return without == null || all == null ? null : Math.round((without - all) * 10) / 10; })() };
  });
  const people = Object.entries(raw.people).map(([name, p]) => ({ name, revenue: r2(p.rev), cost: r2(p.cost), grossProfit: r2(p.rev - p.cost),
    marginPct: pct(p.rev - p.cost, p.rev), clearance: r2(p.clearance), belowCostLoss: r2(p.belowLoss), discount: r2(p.discount),
    share: rev > 0 ? Math.round((p.rev / rev) * 1000) / 10 : 0,
    pullPts: (() => { const r = rev - p.rev, c = cost - p.cost; const without = pct(r - c, r); const all = pct(rev - cost, rev); return without == null || all == null ? null : Math.round((without - all) * 10) / 10; })() }))
    .filter((p) => Math.abs(p.revenue) >= 0.5 || Math.abs(p.cost) >= 0.5).sort((a, b) => b.revenue - a.revenue);
  const losers = Object.entries(raw.losers).map(([name, l]) => ({ name, revenue: r2(l.rev), cost: r2(l.cost), loss: r2(l.cost - l.rev),
    people: Object.entries(l.people).sort((a, b) => b[1] - a[1]).map(([n]) => n) }))
    .sort((a, b) => b.loss - a.loss).slice(0, 12);
  return { ...meta, revenue: r2(rev), cost: r2(cost), grossProfit: r2(rev - cost), marginPct: pct(rev - cost, rev), discount: r2(discount),
    groups, people, losers, sisters: r2(raw.sisters) };
}

/** The months of financial year `fy` that have started, April first. */
export const fyMonths = (fy, today = nzToday()) => monthKeysOfFY(fy, today);
const monthKeysOfFY = (fy, today) => {
  const out = [];
  for (let i = 0; i < 12; i++) { const m = (3 + i) % 12; const y = m >= 3 ? fy : fy + 1; const ym = `${y}-${String(m + 1).padStart(2, '0')}`; if (`${ym}-01` <= today) out.push(ym); }
  return out;
};

async function monthRaw(ym, { fresh = false } = {}) {
  const current = ym === nzToday().slice(0, 7);
  if (fresh) return computeMonth(ym);
  const { payload, cached } = await readWeeks('mix4', ym, () => computeMonth(ym), { freshMs: current ? 15 * 60000 : 7 * 86400000 });
  return { ...payload, cached };
}

/** `period` is 'YYYY-MM' or 'fy:YYYY' (the financial year so far, April on). */
export async function marginMix(period) {
  if (/^\d{4}-\d{2}$/.test(period)) {
    const raw = await monthRaw(period);
    return present(raw, { period, from: raw.from, to: raw.to, generatedAt: raw.generatedAt, stale: Boolean(raw.stale) });
  }
  const m = /^fy:(\d{4})$/.exec(period || '');
  if (!m) throw new Error('period must be YYYY-MM or fy:YYYY');
  const months = monthKeysOfFY(Number(m[1]), nzToday());
  const parts = [];
  for (const ym of months) parts.push(await monthRaw(ym));   // one month at a time: gentle on Odoo
  const gen = parts.map((p) => p.generatedAt).sort()[0];
  return present(combine(parts), { period, from: parts[0]?.from, to: parts[parts.length - 1]?.to, generatedAt: gen, stale: parts.some((p) => p.stale) });
}
