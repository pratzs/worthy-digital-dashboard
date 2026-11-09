/**
 * The business development tools for the Marketing login (see lib/repTools.js MARKETING_TOOLS). They answer: where the money is
 * (groups, banners, channels, regions), what a group looks like store by store, who is new, who has gone quiet and could be won back,
 * what sells, and what a deal costs.
 *
 * Every figure is built from lib/bdData.js (customer x MONTH totals) or an item/product query. No salesperson, no rep and no weekly
 * figure exists in any of it, and guardMarketing (lib/repProject.js) fails closed if one ever appears.
 */
import { bdDataset, externalRows, norm, monthsOfFy, lastNMonths, shiftMonths, sumMonths, daysSince, statusOf } from '@/lib/bdData';
import { odooExec, findProductCosts } from '@/lib/repData';
import { loadUnitCosts } from '@/lib/odooCost';
import { ostendoSql, q, nzToday, nzFinancialYear, parseIso, iso } from '@/lib/ostendo';

const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);
const SYSTEM_NAME = { North: 'Worthy Products North', South: 'Worthy Products South (Dutch Rusk)' };
const NORTH = 4;
const words = (s) => norm(s).split(' ').filter((w) => w.length >= 2).slice(0, 5);

/** The months a question is about: a financial year to date (default) or the last N months including this one. */
function period(input, today = nzToday()) {
  if (input?.months !== undefined && input?.months !== null && input?.months !== '') {
    const n = Number(input.months);
    if (!Number.isInteger(n) || n < 1 || n > 24) throw new Error('months must be a whole number from 1 to 24.');
    const keys = lastNMonths(n, today);
    return { keys, label: `the last ${n} month${n === 1 ? '' : 's'} (${keys[0]} to ${keys[keys.length - 1]})`, fy: null };
  }
  const fy = input?.fy === undefined || input?.fy === null || input?.fy === '' ? nzFinancialYear() : Number(input.fy);
  if (!Number.isInteger(fy) || fy < 2020 || fy > 2100) throw new Error('fy must be a financial year such as 2026.');
  const keys = monthsOfFy(fy, today);
  if (!keys.length) throw new Error('That financial year has not started yet.');
  return { keys, label: `FY${String(fy).slice(2)} to date (${keys[0]} to ${keys[keys.length - 1]})`, fy };
}
const limitOf = (v, d, max) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? Math.min(n, max) : d; };
const systemFilter = (rows, sys) => {
  const s = String(sys || '').toLowerCase();
  if (!s) return rows;
  if (!['north', 'south'].includes(s)) throw new Error("system must be 'north' or 'south'.");
  return rows.filter((r) => r.system.toLowerCase() === s);
};
const basisNote = 'Posted invoices less credit notes, product lines, before GST, by calendar month (the current month is part-way through). Intercompany and staff accounts are left out. North = Worthy Products North (Odoo), South = Dutch Rusk (Ostendo); Worthy Oceania is not included. No salesperson or weekly figures exist in this view.';
const coverageNote = (ds) => (ds.south ? null : 'Worthy Products South could not be read just now, so this covers North only. Try again shortly.');

// ── top_groups ─────────────────────────────────────────────────────────────────────────────────
export async function topGroups(input = {}) {
  const ds = await bdDataset();
  const p = period(input, ds.today);
  const by = String(input?.by || 'group').toLowerCase();
  if (!['group', 'banner', 'channel', 'region'].includes(by)) throw new Error("by must be 'group', 'banner', 'channel' or 'region'.");
  const rows = systemFilter(externalRows(ds), input?.system);
  // Year on year compares COMPLETED months on both sides: this month is part-way through, last year's same month was whole.
  const done = p.keys.filter((k) => k < ds.today.slice(0, 7));
  const prior = shiftMonths(done, -12);
  const keyOf = (r) => (by === 'group' ? r.group : r[by]);
  const total = r2(rows.reduce((s, r) => s + sumMonths(r, p.keys), 0));
  const unassigned = { accounts: 0, revenue: 0 };
  const m = new Map();
  for (const r of rows) {
    const rev = sumMonths(r, p.keys), prev = sumMonths(r, prior), revDone = sumMonths(r, done);
    const label = keyOf(r);
    if (!label) { if (rev !== 0) { unassigned.accounts += 1; unassigned.revenue += rev; } continue; }
    const k = norm(label);
    const g = m.get(k) || { name: label, systems: new Set(), accounts: 0, stores: 0, activeAccounts: 0, revenue: 0, done: 0, prior: 0, last: null };
    g.systems.add(SYSTEM_NAME[r.system]);
    if (rev > 0) {
      g.accounts += 1; g.stores += r.system === 'North' ? r.stores : 1;
      if (daysSince(r.lastInvoice, ds.today) !== null && daysSince(r.lastInvoice, ds.today) <= 45) g.activeAccounts += 1;
    }
    g.revenue += rev; g.done += revDone; g.prior += prev;
    if (r.lastInvoice && (!g.last || r.lastInvoice > g.last)) g.last = r.lastInvoice;
    m.set(k, g);
  }
  const list = [...m.values()].filter((g) => g.revenue !== 0).sort((a, b) => b.revenue - a.revenue);   // nonzero, so a group with net credits still shows and every ranking adds to the total
  const lim = limitOf(input?.limit, 25, 100);
  const notes = [coverageNote(ds)].filter(Boolean);
  if (by === 'channel') notes.push('Channel is recorded for South customers (Dairy, Supermarket, Fuel, School...); for North it is only known for fuel and liquor-store tagged customers, so North revenue mostly sits under "no channel recorded".');
  if (by === 'banner') notes.push('Banner is the chain or brand (Mobil, Fresh Choice, Pak n Save...) from Ostendo analysis codes and Odoo chain tags. Customers with no banner recorded are shown separately.');
  if (by === 'group') notes.push('A group is the head account that bills (for example CSB Group, Foodstuffs South Island, Night n Day Foodstores). "stores" are the delivery accounts under it that were invoiced in the last 12 months (North) or customer accounts with sales (South).');
  notes.push(done.length ? `Change on last year compares the completed months only (${done[0]} to ${done[done.length - 1]}) with the same months a year earlier; revenue also includes this month so far.` : 'Only the current part-month is in this period, so there is no like-for-like change on last year.');
  if (by === 'channel') notes.push('In South, "Head Office" is the head-office billing account of a group (Foodstuffs, Night n Day...) and "Standard" is the default type when none was chosen.');
  if (by === 'region') notes.push('Regions are each system\'s own records and are not harmonised: North uses the customer\'s state or city, South uses its region code.');
  return {
    period: p.label, rankedBy: by, basis: basisNote,
    totalExternalRevenue: total, shown: Math.min(lim, list.length), of: list.length,
    groups: list.slice(0, lim).map((g, i) => ({
      rank: i + 1, [by]: g.name, systems: [...g.systems], revenue: r2(g.revenue), shareOfRevenuePct: pct(g.revenue, total),
      accountsWithSales: g.accounts, stores: g.stores, activeAccounts: g.activeAccounts,
      averagePerAccount: g.accounts ? r2(g.revenue / g.accounts) : null,
      completedMonthsRevenue: r2(g.done), sameMonthsLastYear: r2(g.prior), changeVsLastYearPct: g.prior > 0 && done.length ? Math.round(((g.done - g.prior) / g.prior) * 1000) / 10 : null,
      lastInvoice: g.last,
    })),
    noBannerOrGroupRecorded: by === 'group' ? undefined : { accounts: unassigned.accounts, revenue: r2(unassigned.revenue) },
    notes,
  };
}

// ── group_accounts ─────────────────────────────────────────────────────────────────────────────
export async function groupAccounts(input = {}) {
  const ws = words(input?.name);
  if (!ws.length) throw new Error('Tell me which group or banner, for example "Mobil", "Foodstuffs" or "CSB".');
  const ds = await bdDataset();
  const p = period(input, ds.today);
  const done = p.keys.filter((k) => k < ds.today.slice(0, 7));   // completed months only, so year on year is like for like
  const prior = shiftMonths(done, -12);
  const hay = (r) => norm(`${r.group} ${r.banner || ''} ${r.account}`);
  const hits = externalRows(ds).filter((r) => ws.every((w) => hay(r).includes(w)));
  const rows = hits.map((r) => {
    const rev = sumMonths(r, p.keys), prev = sumMonths(r, prior), revDone = sumMonths(r, done);
    return {
      account: r.account, system: SYSTEM_NAME[r.system], group: r.group, banner: r.banner, channel: r.channel, city: r.city, region: r.region,
      revenue: rev, completedMonthsRevenue: revDone, sameMonthsLastYear: prev, changeVsLastYearPct: prev > 0 && done.length ? Math.round(((revDone - prev) / prev) * 1000) / 10 : null,
      firstInvoice: r.firstInvoice, lastInvoice: r.lastInvoice, daysSinceLastInvoice: daysSince(r.lastInvoice, ds.today), status: statusOf(r.lastInvoice, ds.today),
      ...(r.system === 'North' && r.stores > 1 ? { storesUnderThisAccount: r.stores } : {}),
    };
  }).filter((r) => r.revenue !== 0 || r.sameMonthsLastYear !== 0).sort((a, b) => b.revenue - a.revenue);
  const withSales = rows.filter((r) => r.revenue > 0);
  const byStatus = {};
  for (const r of withSales) { const k = r.status.split(' (')[0]; byStatus[k] = (byStatus[k] || 0) + 1; }
  const active = withSales.filter((r) => r.status === 'Active');
  const total = r2(rows.reduce((s, r) => s + r.revenue, 0));
  const notes = [coverageNote(ds)].filter(Boolean);
  notes.push(done.length ? `Change on last year compares the completed months only (${done[0]} to ${done[done.length - 1]}); revenue also includes this month so far.` : 'Only the current part-month is in this period, so there is no like-for-like change on last year.');
  if (!rows.length) notes.push('No customer, group or banner matched every word of that name with sales in this period (or the year before). Try fewer or different words.');
  if (rows.some((r) => r.storesUnderThisAccount)) notes.push('Some North accounts bill many stores under one head account; use account_sales with the name to list those stores one by one.');
  const lim = limitOf(input?.limit, 40, 150);
  return {
    searched: String(input.name).slice(0, 80), period: p.label, basis: basisNote,
    matched: {
      groups: [...new Set(hits.map((r) => r.group))].slice(0, 15), banners: [...new Set(hits.map((r) => r.banner).filter(Boolean))].slice(0, 10),
      accounts: rows.length,
    },
    totals: {
      revenue: total, completedMonthsRevenue: r2(rows.reduce((s, r) => s + r.completedMonthsRevenue, 0)), sameMonthsLastYear: r2(rows.reduce((s, r) => s + r.sameMonthsLastYear, 0)),
      accountsWithSales: withSales.length, byStatus,
      averageRevenuePerActiveAccount: active.length ? r2(active.reduce((s, r) => s + r.revenue, 0) / active.length) : null,
    },
    accounts: rows.slice(0, lim).map((r) => ({ ...r, revenue: r2(r.revenue), completedMonthsRevenue: r2(r.completedMonthsRevenue), sameMonthsLastYear: r2(r.sameMonthsLastYear) })),
    notes: [...notes, ...(rows.length > lim ? [`${rows.length} accounts matched; the biggest ${lim} are listed. Totals include all of them.`] : [])],
  };
}

// ── new_customers ──────────────────────────────────────────────────────────────────────────────
export async function newCustomers(input = {}) {
  const ds = await bdDataset();
  const days = input?.days === undefined || input?.days === null || input?.days === '' ? 90 : Number(input.days);
  if (!Number.isInteger(days) || days < 7 || days > 365) throw new Error('days must be a whole number from 7 to 365.');
  const since = iso(new Date(parseIso(ds.today).getTime() - days * 86400000));
  const sinceMonth = since.slice(0, 7);
  const allKeys = lastNMonths(24, ds.today);
  const rows = systemFilter(externalRows(ds), input?.system).map((r) => {
    // North: the customer's first invoice ever falls in the window. South: the customer record was created in the window
    // (the 1,563 accounts brought across in Feb 2025 are not "new"), and they have since been invoiced.
    const startDate = r.system === 'North' ? r.firstInvoice : r.created;
    if (!startDate || startDate < since) return null;
    const spend = r2(allKeys.filter((k) => k >= startDate.slice(0, 7)).reduce((s, k) => s + (r.months[k] || 0), 0));
    return { account: r.account, system: SYSTEM_NAME[r.system], group: r.group !== r.account ? r.group : null, banner: r.banner, channel: r.channel, city: r.city, region: r.region,
      joined: startDate, firstInvoice: r.firstInvoice, revenueSinceJoining: spend };
  }).filter((r) => r && r.revenueSinceJoining > 0).sort((a, b) => b.revenueSinceJoining - a.revenueSinceJoining);
  const tally = (key) => { const m = new Map(); for (const r of rows) { const k = r[key] || '(not recorded)'; const c = m.get(k) || { name: k, customers: 0, revenue: 0 }; c.customers += 1; c.revenue += r.revenueSinceJoining; m.set(k, c); } return [...m.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 10).map((c) => ({ ...c, revenue: r2(c.revenue) })); };
  const lim = limitOf(input?.limit, 40, 150);
  return {
    window: { from: since, to: ds.today, days }, basis: basisNote,
    newCustomersWithSales: rows.length, revenueFromThem: r2(rows.reduce((s, r) => s + r.revenueSinceJoining, 0)),
    byChannel: tally('channel'), byBanner: tally('banner'), byCity: tally('city'),
    customers: rows.slice(0, lim),
    notes: [coverageNote(ds),
      'North: a customer is new when their first invoice ever is in the window. South: when the customer record was created in the window and they have been invoiced since.',
      `Revenue is whole calendar months from ${sinceMonth} on, so the join month may include a little before they joined.`].filter(Boolean),
  };
}

// ── lapsed_accounts ────────────────────────────────────────────────────────────────────────────
export async function lapsedAccounts(input = {}) {
  const ds = await bdDataset();
  const quiet = input?.quietDays === undefined || input?.quietDays === null || input?.quietDays === '' ? 90 : Number(input.quietDays);
  if (!Number.isInteger(quiet) || quiet < 30 || quiet > 540) throw new Error('quietDays must be a whole number from 30 to 540.');
  const min = input?.minSpend === undefined || input?.minSpend === null || input?.minSpend === '' ? 1000 : Number(input.minSpend);
  if (!Number.isFinite(min) || min < 0) throw new Error('minSpend must be a number of dollars, 0 or more.');
  const out = [];
  for (const r of systemFilter(externalRows(ds), input?.system)) {
    const d = daysSince(r.lastInvoice, ds.today);
    if (d === null || d <= quiet) continue;
    const lastMonth = r.lastInvoice.slice(0, 7);
    const yearKeys = shiftMonths([lastMonth], 0).concat(Array.from({ length: 11 }, (_, i) => shiftMonths([lastMonth], -(i + 1))[0]));
    const spend = r2(yearKeys.reduce((s, k) => s + (r.months[k] || 0), 0));
    if (spend < min) continue;
    out.push({ account: r.account, system: SYSTEM_NAME[r.system], group: r.group !== r.account ? r.group : null, banner: r.banner, channel: r.channel, city: r.city, region: r.region,
      lastInvoice: r.lastInvoice, daysQuiet: d, spendInTheYearBeforeTheirLastOrder: spend });
  }
  out.sort((a, b) => b.spendInTheYearBeforeTheirLastOrder - a.spendInTheYearBeforeTheirLastOrder);
  const lim = limitOf(input?.limit, 30, 150);
  const tally = (key) => { const m = new Map(); for (const r of out) { const k = r[key] || '(not recorded)'; const c = m.get(k) || { name: k, accounts: 0, value: 0 }; c.accounts += 1; c.value += r.spendInTheYearBeforeTheirLastOrder; m.set(k, c); } return [...m.values()].sort((a, b) => b.value - a.value).slice(0, 8).map((c) => ({ ...c, value: r2(c.value) })); };
  return {
    asOf: ds.today, quietForDays: quiet, minimumSpend: min, basis: basisNote,
    accountsFound: out.length, valueAtStake: r2(out.reduce((s, r) => s + r.spendInTheYearBeforeTheirLastOrder, 0)),
    byChannel: tally('channel'), byBanner: tally('banner'),
    accounts: out.slice(0, lim),
    notes: [coverageNote(ds), 'Win-back list: customers who used to order and have not for the number of days shown, biggest past spend first. The spend is the 12 months up to and including the month of their last order. Only history held in the last 36 months is searched (South history starts March 2025).'].filter(Boolean),
  };
}

// ── top_products ───────────────────────────────────────────────────────────────────────────────
export async function topProducts(input = {}) {
  const today = nzToday();
  const p = period(input, today);
  const from = `${p.keys[0]}-01`;
  const ws = words(input?.name);
  const lim = limitOf(input?.limit, 25, 100);
  const exec = await odooExec();
  const nameDom = ws.map((w) => ['product_id.name', 'ilike', w]);
  const dom = (type) => [
    ['move_id.company_id', '=', NORTH], ['move_id.state', '=', 'posted'], ['move_id.move_type', '=', type],
    ['move_id.invoice_date', '>=', from], ['move_id.invoice_date', '<=', today], ['display_type', '=', 'product'], ['product_id', '!=', false], ...nameDom,
  ];
  const likeS = ws.map((w) => `UPPER(l.LINEDESCRIPTION) LIKE ${q(`%${w.toUpperCase()}%`)}`).join(' AND ');
  const [inv, ref, south] = await Promise.all([
    exec('account.move.line', 'read_group', [dom('out_invoice'), ['quantity:sum', 'balance:sum'], ['product_id']], { lazy: false, limit: 600 }, 90000),
    exec('account.move.line', 'read_group', [dom('out_refund'), ['quantity:sum', 'balance:sum'], ['product_id']], { lazy: false, limit: 600 }, 90000),
    ostendoSql(`SELECT CASE WHEN l.LINECODE STARTING WITH 'ZZZ' THEN l.LINEDESCRIPTION ELSE l.LINECODE END AS CODE, MAX(l.LINEDESCRIPTION) AS NAME, SUM(l.INVOICEQTY) AS QTY, SUM(l.EXTENDEDNETTPRICE) AS REV, MAX(im.AVERAGECOST) AS AVGC
      FROM SALESINVOICELINES l JOIN SALESINVOICEHEADER h ON h.INVOICENUMBER = l.INVOICENUMBER LEFT JOIN ITEMMASTER im ON im.ITEMCODE = l.LINECODE
      WHERE h.INVOICEDATE BETWEEN ${q(from)} AND ${q(today)} AND l.CODETYPE = 'Item Code' ${likeS ? `AND ${likeS}` : ''} GROUP BY 1 ORDER BY 4 DESC`, 90000).catch(() => null),
  ]);
  const prod = new Map();
  for (const [list, sign] of [[inv, 1], [ref, -1]]) for (const r of list) {
    if (!r.product_id) continue;
    const c = prod.get(r.product_id[0]) || { id: r.product_id[0], display: r.product_id[1], units: 0, revenue: 0 };
    c.units += sign * (Number(r.quantity) || 0); c.revenue += -(Number(r.balance) || 0); prod.set(c.id, c);
  }
  const northTop = [...prod.values()].sort((a, b) => b.revenue - a.revenue).slice(0, lim);
  let costOf = new Map();
  if (northTop.length) { try { ({ costOf } = await loadUnitCosts(exec, NORTH, northTop.map((x) => x.id), { dropship: true })); } catch { costOf = new Map(); } }
  const split = (d) => { const m = /^\[([^\]]+)\]\s*(.*)$/.exec(String(d || '')); return m ? { code: m[1], name: m[2] || m[1] } : { code: null, name: String(d || '') }; };
  const rows = [
    ...northTop.map((x) => { const s = split(x.display); const c = costOf.get(x.id) || 0; return { system: SYSTEM_NAME.North, code: s.code, product: s.name, units: r2(x.units), revenue: r2(x.revenue), averagePricePerUnit: x.units > 0 ? r2(x.revenue / x.units) : null, costPerUnitToday: c > 0 ? r2(c) : null }; }),
    ...((south || []).filter((r) => String(r.CODE ?? '').trim()).slice(0, lim).map((r) => ({ system: SYSTEM_NAME.South, code: String(r.CODE).trim(), product: String(r.NAME || r.CODE).trim(), units: r2(r.QTY), revenue: r2(r.REV),
      averagePricePerUnit: Number(r.QTY) > 0 ? r2(Number(r.REV) / Number(r.QTY)) : null, costPerUnitToday: Number(r.AVGC) > 0 ? r2(r.AVGC) : null }))),
  ].sort((a, b) => b.revenue - a.revenue).slice(0, lim);
  return {
    period: p.label, filter: input?.name ? String(input.name).slice(0, 80) : null, basis: basisNote,
    note: 'Company-wide product sales (no customer or salesperson split). costPerUnitToday is the cost recorded today per the unit the product is sold in (Odoo standard cost, Ostendo average cost); blank where none is recorded. Use account_sales for what one account buys.',
    products: rows,
    notes: [south === null ? 'Worthy Products South could not be read just now, so this covers North only.' : null].filter(Boolean),
  };
}

// ── cost lookup by code or name ──────────────────────────────────────────────────────────────────
const looksLikeCode = (s) => /^[A-Za-z0-9][A-Za-z0-9._-]{1,24}$/.test(String(s).trim());
/** Cost lines for a product typed as a CODE (exact, either system) or as words in the name. Same shape as findProductCosts. */
export async function costLookup(nameOrCode) {
  const raw = String(nameOrCode ?? '').trim().slice(0, 80);
  if (looksLikeCode(raw) && !/^[a-z]+$/.test(raw)) {   // a single plain lowercase word is a name, not a code
    const code = raw.toUpperCase();
    const exec = await odooExec();
    const [odoo, south] = await Promise.all([
      exec('product.product', 'search_read', [[['default_code', '=ilike', raw]]], { fields: ['default_code', 'name', 'standard_price', 'uom_id'], limit: 5, context: { active_test: false } }).catch(() => []),
      ostendoSql(`SELECT FIRST 5 ITEMCODE, ITEMDESCRIPTION, AVERAGECOST, STDBUYPRICE, ITEMSTATUS FROM ITEMMASTER WHERE UPPER(ITEMCODE) = ${q(code)}`, 30000).catch(() => []),
    ]);
    const items = [
      ...(south || []).filter((r) => String(r.ITEMCODE || '').trim()).map((r) => ({ source: 'Ostendo', code: String(r.ITEMCODE).trim(), product: String(r.ITEMDESCRIPTION || '').trim(), averageCost: Number(r.AVERAGECOST) || null, standardBuyPrice: Number(r.STDBUYPRICE) || null, status: String(r.ITEMSTATUS || '').trim() || null })),
      ...(odoo || []).map((r) => ({ source: 'Odoo', code: r.default_code || null, product: r.name, standardCost: Number(r.standard_price) || null, unit: r.uom_id ? r.uom_id[1] : null })),
    ];
    if (items.length) return { searchedIn: ['Ostendo', 'Odoo'], matchedBy: 'item code', items, basis: 'Cost before GST as recorded today, per the unit the item is stocked in. Ostendo shows average cost and standard buy price; Odoo shows standard cost.', note: null };
  }
  return findProductCosts([{ system: 'south' }, { system: 'north' }], raw);
}

// ── cost_basket ────────────────────────────────────────────────────────────────────────────────
export async function costBasket(input = {}) {
  const items = Array.isArray(input?.items) ? input.items : [];
  if (!items.length) throw new Error('Give me the products to cost, for example items: [{ name: "Musashi 500ml mango", quantity: 24 }].');
  if (items.length > 20) throw new Error('Cost at most 20 products at a time.');
  const target = input?.targetMarginPct === undefined || input?.targetMarginPct === null || input?.targetMarginPct === '' ? null : Number(input.targetMarginPct);
  if (target !== null && (!Number.isFinite(target) || target < 0 || target > 90)) throw new Error('targetMarginPct must be between 0 and 90.');
  const lines = [];
  for (const it of items) {
    const name = String(it?.name ?? '').slice(0, 80), qty = Number(it?.quantity ?? 1);
    if (!name.trim()) throw new Error('Each product needs a name.');
    if (!Number.isFinite(qty) || qty <= 0 || qty > 1e6) throw new Error('Each quantity must be a number above 0.');
    const res = await costLookup(name);
    let found = res.items || [];
    const sys = String(it?.system ?? '').toLowerCase();
    if (sys === 'north') found = found.filter((f) => f.source === 'Odoo');
    else if (sys === 'south') found = found.filter((f) => f.source === 'Ostendo');
    else if (sys) throw new Error("Each product's system must be 'north' or 'south'.");
    if (found.length === 0) { lines.push({ asked: name, quantity: qty, status: 'not found', note: 'No product matched those words in Odoo or Ostendo.' }); continue; }
    if (found.length > 1) {
      lines.push({ asked: name, quantity: qty, status: 'choose one', note: 'More than one product matched. Say which one (use the code, or add system: north or south), then ask again.',
        candidates: found.slice(0, 8).map((f) => ({ code: f.code, product: f.product, system: f.source === 'Odoo' ? SYSTEM_NAME.North : SYSTEM_NAME.South })) });
      continue;
    }
    const f = found[0];
    const unitCost = f.source === 'Odoo' ? f.standardCost : (f.averageCost || f.standardBuyPrice || null);
    if (!unitCost) { lines.push({ asked: name, quantity: qty, status: 'no cost recorded', product: f.product, code: f.code, system: f.source === 'Odoo' ? SYSTEM_NAME.North : SYSTEM_NAME.South }); continue; }
    lines.push({
      asked: name, status: 'costed', code: f.code, product: f.product, system: f.source === 'Odoo' ? SYSTEM_NAME.North : SYSTEM_NAME.South,
      quantity: qty, unit: f.unit || null, unitCost: r2(unitCost), lineCost: r2(unitCost * qty),
      ...(target !== null ? { suggestedPricePerUnit: r2(unitCost / (1 - target / 100)), suggestedLinePrice: r2((unitCost * qty) / (1 - target / 100)) } : {}),
    });
  }
  const costed = lines.filter((l) => l.status === 'costed');
  const total = r2(costed.reduce((s, l) => s + l.lineCost, 0));
  return {
    targetMarginPct: target, lines,
    totals: { costedLines: costed.length, ofLines: lines.length, totalCost: total, ...(target !== null ? { suggestedPrice: r2(total / (1 - target / 100)), grossProfit: r2(total / (1 - target / 100) - total) } : {}) },
    complete: costed.length === lines.length,
    basis: 'Cost before GST as recorded today, per the unit the product is stocked in (carton, each...). The quantity must be in that same unit. Odoo shows standard cost; Ostendo average cost, or the standard buy price when there is no average. Nothing is guessed: a product that matches more than one item, or has no cost, is flagged instead of costed.',
    notes: costed.length < lines.length ? ['Some lines could not be costed, so the total covers only the costed lines.'] : [],
  };
}
