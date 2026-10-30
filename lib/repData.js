/**
 * Reads ONE rep's own invoice lines from Odoo (North) or Ostendo (South).
 * The rep filter is built here, from the rep's fixed identity in lib/repAccess.js, and is part of every query:
 * nothing the caller types can change it, and no query is ever run without it.
 *  - North: invoice salesperson (an Odoo user), found by exact name; if that does not match exactly one user the
 *    call fails closed rather than guessing. Only POSTED invoices and credit notes are read (never drafts, and
 *    never sales orders); credit notes come off.
 *  - South: the rep's Ostendo codes (a "-1" legacy code belongs to the same person). SALESINVOICEHEADER holds
 *    invoices and credit notes; credit lines carry negative quantities and amounts, so they come off.
 * Even the customer deep-dive, which takes a customer name, only matches against that rep's own customers.
 * Results are kept for 40 minutes per rep and shared across servers; a scheduled warm-up keeps them fresh.
 */
import { unstable_cache } from 'next/cache';
import { cachedAuth } from '@/lib/odooAuth';
import { loadUnitCosts } from '@/lib/odooCost';
import { ostendoSql, nzToday, q, normaliseDate, parseIso, iso } from '@/lib/ostendo';
import { projectBestSellers, projectCustomers, projectRecent } from '@/lib/repInsights';
import { productMargins, customerMargins, aggregate, findCustomer, projectCustomerDetail, crossSell } from '@/lib/repAnalysis';

const NORTH = 4;
export const REP_DATA_TTL = 40 * 60;
// Shared across servers, so the warm-up (on sign-in and on a schedule) helps the first question.
export const REP_DATA_TAG = 'rep-data';
const cached = (key, fn) => unstable_cache(fn, ['rep-data-v2', key], { revalidate: REP_DATA_TTL, tags: [REP_DATA_TAG] })();

const addDays = (s, n) => iso(new Date(parseIso(s).getTime() + n * 86400000));

function windows(fy) {
  const today = nzToday();
  const fyStart = `${fy}-04-01`, fyEnd = `${fy + 1}-03-31`;
  const end = today < fyEnd ? today : fyEnd;
  return {
    fyStart, end,
    ytd: [fyStart, end],
    l90: [addDays(end, -89), end],
    p90: [addDays(end, -179), addDays(end, -90)],
    y12: [addDays(end, -364), end],
    earlier: [addDays(end, -364), addDays(end, -90)],
    history: [`${fy - 1}-04-01`, end],
  };
}
const metaFor = (w, basis, extra = {}) => ({
  period: { from: w.fyStart, to: w.end }, asOf: w.end, fyStart: w.fyStart, basis,
  windows: { last90Days: { from: w.l90[0], to: w.l90[1] }, previous90Days: { from: w.p90[0], to: w.p90[1] } },
  ...extra,
});

const tidyCustomer = (n) => String(n ?? '').replace(/\s+20\d{2}$/, '').trim();
const ckey = (name) => String(name).toLowerCase().trim();

// ── North (Odoo) ────────────────────────────────────────────────────────────────────────────────
async function odooExec() {
  const { ODOO_URL: url, ODOO_DB: db, ODOO_USER: user, ODOO_PASSWORD: pw } = process.env;
  const call = async (p, ms = 45000) => (await fetch(`${url}/jsonrpc`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p), signal: AbortSignal.timeout(ms),
  })).json();
  const auth = await cachedAuth(() => call({ jsonrpc: '2.0', method: 'call', id: 1,
    params: { service: 'common', method: 'authenticate', args: [db, user, pw, {}] } }, 15000), url, db, user);
  if (!auth.result) throw new Error('Odoo authentication failed');
  return async (model, method, args, kwargs = {}, ms = 60000) => {
    const r = await call({ jsonrpc: '2.0', method: 'call', id: 2, params: { service: 'object', method: 'execute_kw',
      args: [db, auth.result, pw, model, method, args, { ...kwargs, context: { allowed_company_ids: [NORTH], company_id: NORTH, ...(kwargs.context || {}) } }] } }, ms);
    if (r.error) throw new Error(r.error.data?.message || r.error.message || `${model}.${method} failed`);
    return r.result;
  };
}

async function northUserIds(exec, rep) {
  const users = await exec('res.users', 'search_read', [[['name', '=', rep.label]]], { fields: ['id'], context: { active_test: false } });
  if (users.length !== 1) throw new Error('Could not match your account to your sales records. Please tell Pratham.');
  return users.map((u) => u.id);
}

const splitName = (display) => {
  const m = /^\[([^\]]+)\]\s*(.*)$/.exec(String(display || ''));
  return m ? { code: m[1], name: m[2] || m[1] } : { code: null, name: String(display || '') };
};

/** Posted invoice lines of this rep's own, grouped by customer and product (credit notes taken off). */
async function northLines(rep, win, { withCost, partnerId = null }) {
  const exec = await odooExec();
  const ids = await northUserIds(exec, rep);
  const read = (type) => exec('account.move.line', 'read_group', [[
    ['move_id.company_id', '=', NORTH], ['move_id.state', '=', 'posted'], ['move_id.move_type', '=', type],
    ['move_id.invoice_date', '>=', win[0]], ['move_id.invoice_date', '<=', win[1]],
    ['display_type', '=', 'product'], ['product_id', '!=', false], ['move_id.invoice_user_id', 'in', ids],
    ...(partnerId ? [['partner_id', '=', partnerId]] : []),
  ], ['quantity:sum', 'balance:sum'], ['partner_id', 'product_id']], { lazy: false }, 90000);
  const [inv, ref] = await Promise.all([read('out_invoice'), read('out_refund')]);
  const rows = [];
  for (const [list, sign] of [[inv, 1], [ref, -1]]) {
    for (const r of list) {
      if (!r.product_id || !r.partner_id) continue;
      const nm = splitName(r.product_id[1]);
      rows.push({
        customer: tidyCustomer(r.partner_id[1]), customerKey: ckey(tidyCustomer(r.partner_id[1])), customerId: r.partner_id[0],
        productKey: r.product_id[0], product: nm.name, code: nm.code,
        units: sign * (Number(r.quantity) || 0), revenue: -(Number(r.balance) || 0),
      });
    }
  }
  if (withCost && rows.length) {
    // Standard cost, as the dashboard uses it. A product with no cost has no margin, rather than a made-up one.
    const { costOf } = await loadUnitCosts(exec, NORTH, [...new Set(rows.map((r) => r.productKey))], { dropship: true });
    for (const r of rows) {
      const unit = costOf.get(r.productKey) || 0;
      if (unit > 0) { r.mRev = r.revenue; r.mCost = r.units * unit; } else { r.mRev = 0; r.mCost = 0; }
    }
  }
  return rows;
}

async function northProductWindow(rep, win) {
  const exec = await odooExec();
  const ids = await northUserIds(exec, rep);
  const read = (type) => exec('account.move.line', 'read_group', [[
    ['move_id.company_id', '=', NORTH], ['move_id.state', '=', 'posted'], ['move_id.move_type', '=', type],
    ['move_id.invoice_date', '>=', win[0]], ['move_id.invoice_date', '<=', win[1]],
    ['display_type', '=', 'product'], ['product_id', '!=', false], ['move_id.invoice_user_id', 'in', ids],
  ], ['balance:sum'], ['product_id']], { lazy: false });
  const [inv, ref] = await Promise.all([read('out_invoice'), read('out_refund')]);
  const m = new Map();
  for (const r of [...inv, ...ref]) { if (r.product_id) m.set(r.product_id[0], (m.get(r.product_id[0]) || 0) - (Number(r.balance) || 0)); }
  return m;
}

async function northInvoices(rep, fy) {
  const w = windows(fy);
  const exec = await odooExec();
  const ids = await northUserIds(exec, rep);
  const moves = await exec('account.move', 'search_read', [[
    ['company_id', '=', NORTH], ['state', '=', 'posted'], ['move_type', 'in', ['out_invoice', 'out_refund']],
    ['invoice_user_id', 'in', ids], ['invoice_date', '>=', w.history[0]], ['invoice_date', '<=', w.history[1]],
  ]], { fields: ['name', 'partner_id', 'invoice_date', 'amount_untaxed_signed', 'move_type'], limit: 0, order: 'invoice_date desc' }, 90000);
  return {
    w,
    rows: moves.filter((m) => m.invoice_date && m.partner_id).map((m) => ({
      number: m.name, customer: tidyCustomer(m.partner_id[1]), customerId: m.partner_id[0], date: String(m.invoice_date).slice(0, 10),
      amount: Number(m.amount_untaxed_signed) || 0, credit: m.move_type === 'out_refund',
    })),
  };
}

// ── South (Ostendo) ─────────────────────────────────────────────────────────────────────────────
function southClause(rep) {
  const codes = (rep.codes || []).map(String);
  if (!codes.length || !codes.every((c) => /^\d{2,4}$/.test(c))) throw new Error('Could not match your account to your sales records. Please tell Pratham.');
  return `(${codes.map((c) => `h.SALESPERSON = '${c}' OR h.SALESPERSON STARTING WITH '${c}-'`).join(' OR ')})`;
}
const STOCK_LINE = "l.CODETYPE = 'Item Code'";
// The dashboard's own rule: a line whose recorded cost cannot be real (more than twice the price, or zero) is left out of margin.
const SUSPECT = `${STOCK_LINE} AND l.INVOICEQTY > 0 AND l.EXTENDEDNETTPRICE > 0 AND (l.INVOICEQTY * l.INVOICEUNITCOST > l.EXTENDEDNETTPRICE * 2 OR l.INVOICEUNITCOST = 0)`;
const PRODUCT_KEY = "CASE WHEN l.LINECODE STARTING WITH 'ZZZ' THEN l.LINEDESCRIPTION ELSE l.LINECODE END";

async function southLines(rep, win, { withCost, customer = null }) {
  const cost = withCost
    ? `, SUM(CASE WHEN ${STOCK_LINE} AND NOT (${SUSPECT.replace(`${STOCK_LINE} AND `, '')}) THEN l.EXTENDEDNETTPRICE ELSE 0 END) AS MREV,
         SUM(CASE WHEN ${STOCK_LINE} AND NOT (${SUSPECT.replace(`${STOCK_LINE} AND `, '')}) THEN l.INVOICEQTY * l.INVOICEUNITCOST ELSE 0 END) AS MCOST,
         MIN(CASE WHEN l.INVOICEUNITCOST > 0 THEN l.INVOICEUNITCOST END) AS UCMIN, MAX(CASE WHEN l.INVOICEUNITCOST > 0 THEN l.INVOICEUNITCOST END) AS UCMAX`
    : '';
  const rows = await ostendoSql(`
    SELECT h.CUSTOMER AS C, ${PRODUCT_KEY} AS CODE, MAX(l.LINEDESCRIPTION) AS NAME, SUM(l.INVOICEQTY) AS QTY, SUM(l.EXTENDEDNETTPRICE) AS REV${cost}
    FROM SALESINVOICELINES l JOIN SALESINVOICEHEADER h ON h.INVOICENUMBER = l.INVOICENUMBER
    WHERE h.INVOICEDATE BETWEEN ${q(win[0])} AND ${q(win[1])} AND ${STOCK_LINE} AND ${southClause(rep)}
      ${customer ? `AND h.CUSTOMER = ${q(customer)}` : ''}
    GROUP BY 1, 2`, 80000);
  return (rows || []).filter((r) => r.C && r.CODE).map((r) => {
    const c = tidyCustomer(r.C);
    const row = { customer: c, customerKey: ckey(c), customerRaw: String(r.C), productKey: String(r.CODE).trim(), product: String(r.NAME || r.CODE).trim(), code: String(r.CODE).trim(), units: Number(r.QTY) || 0, revenue: Number(r.REV) || 0 };
    if (withCost) { row.mRev = Number(r.MREV) || 0; row.mCost = Number(r.MCOST) || 0; row.ucMin = Number(r.UCMIN) || 0; row.ucMax = Number(r.UCMAX) || 0; }
    return row;
  });
}

async function southProductWindow(rep, win) {
  const rows = await ostendoSql(`
    SELECT ${PRODUCT_KEY} AS CODE, SUM(l.EXTENDEDNETTPRICE) AS REV
    FROM SALESINVOICELINES l JOIN SALESINVOICEHEADER h ON h.INVOICENUMBER = l.INVOICENUMBER
    WHERE h.INVOICEDATE BETWEEN ${q(win[0])} AND ${q(win[1])} AND ${STOCK_LINE} AND ${southClause(rep)}
    GROUP BY 1`, 55000);
  const m = new Map();
  for (const r of rows || []) { const k = String(r.CODE ?? '').trim(); if (k) m.set(k, Number(r.REV) || 0); }
  return m;
}

async function southInvoices(rep, fy) {
  const w = windows(fy);
  const rows = await ostendoSql(`
    SELECT h.INVOICENUMBER AS NUM, h.CUSTOMER AS C, h.INVOICEDATE AS D, h.INVOICEORCREDIT AS OC, h.INVOICENETTAMOUNT AS NETT
    FROM SALESINVOICEHEADER h
    WHERE h.INVOICEDATE BETWEEN ${q(w.history[0])} AND ${q(w.history[1])} AND ${southClause(rep)}`, 55000);
  return {
    w,
    rows: (rows || []).map((r) => {
      const date = normaliseDate(r.D); if (!date || !r.C) return null;
      const credit = String(r.OC ?? '').toLowerCase().startsWith('cred');
      const nett = Number(r.NETT) || 0;
      return { number: String(r.NUM ?? ''), customer: tidyCustomer(r.C), customerRaw: String(r.C), date, amount: credit ? -Math.abs(nett) : nett, credit };
    }).filter(Boolean),
  };
}

// ── Shared datasets (cached) ────────────────────────────────────────────────────────────────────
const BASIS_NORTH = 'Your own posted invoices (credit notes taken off), ex GST, from Odoo. Draft invoices and sales orders are not included.';
const BASIS_SOUTH = 'Your own posted invoices (credit notes taken off), ex GST, from Ostendo.';
const BASIS_INVOICES = 'Your own posted invoices and credit notes, ex GST (invoice totals, so a customer total can differ slightly from your product sales).';
const basisOf = (rep) => (rep.system === 'north' ? BASIS_NORTH : BASIS_SOUTH);

/** Year-to-date customer x product lines, with costs. */
const ytdLines = (rep, fy) => cached(`${rep.key}|ytdlines|${fy}`, () => {
  const w = windows(fy);
  return rep.system === 'north' ? northLines(rep, w.ytd, { withCost: true }) : southLines(rep, w.ytd, { withCost: true });
});
/** Last 12 months of customer x product lines (revenue only), for cross-sell. */
const y12Lines = (rep, fy) => cached(`${rep.key}|y12lines|${fy}`, () => {
  const w = windows(fy);
  return rep.system === 'north' ? northLines(rep, w.y12, { withCost: false }) : southLines(rep, w.y12, { withCost: false });
});
const invoicesFor = (rep, fy) => cached(`${rep.key}|invoices|${fy}`, () => (rep.system === 'north' ? northInvoices(rep, fy) : southInvoices(rep, fy)));
const productTrend = (rep, fy) => cached(`${rep.key}|trend|${fy}`, async () => {
  const w = windows(fy);
  const [l90, p90] = rep.system === 'north'
    ? await Promise.all([northProductWindow(rep, w.l90), northProductWindow(rep, w.p90)])
    : await Promise.all([southProductWindow(rep, w.l90), southProductWindow(rep, w.p90)]);
  return { l90: [...l90], p90: [...p90] };
});

// ── Public ─────────────────────────────────────────────────────────────────────────────────────
export async function getBestSellers(rep, fy) {
  const w = windows(fy);
  const [lines, trend] = await Promise.all([ytdLines(rep, fy), productTrend(rep, fy)]);
  const l90 = new Map(trend.l90), p90 = new Map(trend.p90);
  const byProd = aggregate(lines, (r) => r.productKey, (r) => r.product);
  const rows = [...byProd.values()].map((a) => ({
    code: a.code || undefined, name: a.name, units: a.units, revenue: a.revenue, mRev: a.mRev, mCost: a.mCost, ucMin: a.ucMin, ucMax: a.ucMax,
    rev90: l90.get(a.key) || 0, prev90: p90.get(a.key) || 0,
  }));
  return projectBestSellers(rows, rep, metaFor(w, `${basisOf(rep)} Margin is on the part of your sales that has a cost recorded, and is left blank where less than 60% does.`));
}

export async function getCustomers(rep, fy) {
  const w = windows(fy);
  const [{ rows }, lines] = await Promise.all([invoicesFor(rep, fy), ytdLines(rep, fy)]);
  const cm = customerMargins(lines);
  return projectCustomers(rows, rep, metaFor(w, BASIS_INVOICES, { marginByCustomer: cm }));
}

export async function getRecent(rep, fy) {
  const { rows, w } = await invoicesFor(rep, fy);
  return projectRecent(rows, rep, metaFor(w, BASIS_INVOICES));
}

/** Cross-sell suggestions across the rep's best customers, from what their own customers buy together. */
export async function getCrossSell(rep, fy) {
  const w = windows(fy);
  const [rows, ytd] = await Promise.all([y12Lines(rep, fy), ytdLines(rep, fy)]);
  const suggestions = crossSell(rows, { margins: productMargins(ytd) });
  return {
    rep: rep.label, asOf: w.end, basis: 'What your own customers bought in the last 12 months (posted invoices, ex GST).',
    howItWorks: 'For each good customer, we look for products that many of your other customers who buy the same things also buy, but this customer has not bought in the last 12 months. The counts are shown so you can check them.',
    suggestions,
    note: suggestions.length ? null : 'Not enough buying patterns across your customers to suggest anything reliable yet.',
  };
}

/** Everything about one of the rep's own customers. The name is matched only against this rep's own customers. */
export async function getCustomerDetail(rep, fy, nameQuery, debtors) {
  const w = windows(fy);
  const { rows: inv } = await invoicesFor(rep, fy);
  const found = findCustomer([...new Set(inv.map((i) => i.customer))], nameQuery);
  if (found.none) return { rep: rep.label, found: false, message: `I could not find a customer of yours called "${String(nameQuery).slice(0, 60)}". Check the spelling, or ask for your customer list.` };
  if (found.many) return { rep: rep.label, found: false, didYouMean: found.many, message: 'More than one of your customers matches. Which one do you mean?' };
  const customer = found.match;
  const mine = inv.filter((i) => i.customer === customer);
  const sample = mine[0];
  const [ytd, y12] = await Promise.all([ytdLines(rep, fy), y12Lines(rep, fy)]);
  const lines = ytd.filter((r) => r.customerKey === ckey(customer));
  const margin = customerMargins(lines).get(ckey(customer));
  // What they have started and stopped buying: two small questions for this one customer.
  let recent = [], earlier = [];
  try {
    const grab = async (win) => (rep.system === 'north'
      ? northLines(rep, win, { withCost: false, partnerId: sample.customerId })
      : southLines(rep, win, { withCost: false, customer: sample.customerRaw }));
    const [r1, r2] = await Promise.all([grab(w.l90), grab(w.earlier)]);
    recent = [...aggregate(r1, (r) => r.productKey, (r) => r.product).values()];
    earlier = [...aggregate(r2, (r) => r.productKey, (r) => r.product).values()];
  } catch { recent = []; earlier = []; }
  const suggestions = crossSell(y12, { customerKey: ckey(customer), maxPerCustomer: 4, limit: 4, margins: productMargins(ytd) });
  const d = (debtors?.customers || []).find((c) => c && ckey(tidyCustomer(c.name)) === ckey(customer));
  return projectCustomerDetail({
    rep, customer, invoices: mine, lines, recentProducts: recent, earlierProducts: earlier,
    debtor: d || null, meta: metaFor(w, BASIS_INVOICES), suggestions: suggestions.map(({ customer: _c, customerKey: _k, ...rest }) => rest), margin,
  });
}

/** Warms every dataset for a rep (used on sign-in and by the scheduled warm-up). */
export async function warmRepData(rep, fy) {
  await Promise.allSettled([getBestSellers(rep, fy), getCustomers(rep, fy), getCrossSell(rep, fy)]);
}

const productWords = (nameQuery) => String(nameQuery || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length >= 2).slice(0, 5);
const systemsOf = (people) => ({ south: people.filter((p) => p.system === 'south'), north: people.filter((p) => p.system === 'north') });
const sourcesOf = (people) => [...new Set(people.map((p) => (p.system === 'south' ? 'Ostendo' : 'Odoo')))];

/**
 * A product's cost price, from ONLY the system(s) the lead's team sells from (Ostendo for South people, Odoo company 4
 * for North people). Any product in that system can be looked up, sold by the team or not, because a lead may want to
 * offer something new; no sales figures are ever returned. Every word of the name must appear; at most 12 per system.
 */
export async function findProductCosts(people, nameQuery) {
  const words = productWords(nameQuery);
  if (!words.length) return { items: [], note: 'Tell me the product name, for example "Musashi 500ml".' };
  const { south, north } = systemsOf(people);
  const out = [];
  if (south.length) {
    const where = words.map((w) => `UPPER(ITEMDESCRIPTION) LIKE ${q(`%${w.toUpperCase()}%`)}`).join(' AND ');
    const rows = await ostendoSql(`SELECT FIRST 12 ITEMCODE, ITEMDESCRIPTION, AVERAGECOST, STDBUYPRICE, ITEMSTATUS FROM ITEMMASTER WHERE ${where} ORDER BY ITEMDESCRIPTION`, 30000);
    // Ostendo's API returns one blank row when nothing matches: skip rows with no item code.
    for (const r of (rows || []).filter((x) => String(x.ITEMCODE || '').trim())) out.push({ source: 'Ostendo', code: String(r.ITEMCODE || '').trim(), product: String(r.ITEMDESCRIPTION || '').trim(),
      averageCost: Number(r.AVERAGECOST) || null, standardBuyPrice: Number(r.STDBUYPRICE) || null, status: String(r.ITEMSTATUS || '').trim() || null });
  }
  if (north.length) {
    const exec = await odooExec();
    const rows = await exec('product.product', 'search_read', [[...words.map((w) => ['name', 'ilike', w]), ['sale_ok', '=', true]]],
      { fields: ['default_code', 'name', 'standard_price', 'uom_id'], limit: 12, order: 'name asc' });
    for (const r of rows || []) out.push({ source: 'Odoo', code: r.default_code || null, product: r.name,
      standardCost: Number(r.standard_price) || null, unit: r.uom_id ? r.uom_id[1] : null });
  }
  return {
    searchedIn: sourcesOf(people),
    items: out,
    basis: 'Cost before GST, as recorded in the system today, per the unit the item is stocked in. Ostendo shows average cost and standard buy price; Odoo shows standard cost. Only the system(s) your team sells from are searched.',
    note: out.length ? null : 'No product matched those words in the system your team sells from.',
  };
}

/**
 * Range gaps for the lead's team, in the team's own system(s): of the company's most widely sold products (top 150 by
 * how many different customers bought them in the last 12 months), the 15 the TEAM reaches least: sold to the fewest
 * of the team's own customers, then those not sold by the team in the last 90 days. Only the team's own figures are returned
 * (how many of its customers bought it, when it last sold it) plus the product's company rank; never a company or
 * other-rep sales figure.
 */
export async function findProductGaps(people, limit = 15) {
  const today = nzToday(), since = addDays(today, -365), recent = addDays(today, -90);
  const { south, north } = systemsOf(people);
  const out = [];
  // The least reached first: fewest of the team's customers, then not sold recently, then the more widely sold product.
  const pick = (rows) => rows
    .map((r) => ({ ...r, notSoldIn90Days: !r.teamLastSold || r.teamLastSold < recent }))
    .sort((a, b) => a.teamCustomers12m - b.teamCustomers12m || Number(b.notSoldIn90Days) - Number(a.notSoldIn90Days) || a.companyRank - b.companyRank)
    .slice(0, limit);
  if (south.length) {
    const team = south.map((p) => southClause(p)).join(' OR ');
    const wide = (await ostendoSql(`SELECT FIRST 150 l.LINECODE AS CODE, MAX(l.LINEDESCRIPTION) AS NAME, COUNT(DISTINCT h.CUSTOMER) AS N
      FROM SALESINVOICELINES l JOIN SALESINVOICEHEADER h ON h.INVOICENUMBER = l.INVOICENUMBER
      WHERE h.INVOICEDATE >= ${q(since)} AND l.CODETYPE = 'Item Code' AND h.INVOICEORCREDIT <> 'Credit' AND NOT (l.LINECODE STARTING WITH 'ZZZ')
      GROUP BY 1 ORDER BY 3 DESC`, 60000)).filter((r) => String(r.CODE || '').trim());
    const codes = wide.map((r) => String(r.CODE).trim());
    const mine = codes.length ? (await ostendoSql(`SELECT l.LINECODE AS CODE, COUNT(DISTINCT h.CUSTOMER) AS N, MAX(h.INVOICEDATE) AS D
      FROM SALESINVOICELINES l JOIN SALESINVOICEHEADER h ON h.INVOICENUMBER = l.INVOICENUMBER
      WHERE h.INVOICEDATE >= ${q(since)} AND l.CODETYPE = 'Item Code' AND h.INVOICEORCREDIT <> 'Credit' AND (${team})
        AND l.LINECODE IN (${codes.map(q).join(',')}) GROUP BY 1`, 60000)).filter((r) => String(r.CODE || '').trim()) : [];
    const mineBy = new Map(mine.map((r) => [String(r.CODE).trim(), r]));
    const rows = wide.map((r, i) => {
      const m = mineBy.get(String(r.CODE).trim());
      return { source: 'Ostendo', code: String(r.CODE).trim(), product: String(r.NAME || '').trim(), companyRank: i + 1,
        teamCustomers12m: m ? Number(m.N) || 0 : 0, teamLastSold: m ? normaliseDate(m.D) : null };
    });
    const chosen = pick(rows);
    const costs = chosen.length ? (await ostendoSql(`SELECT ITEMCODE, AVERAGECOST, ITEMSTATUS FROM ITEMMASTER WHERE ITEMCODE IN (${chosen.map((g) => q(g.code)).join(',')})`, 30000))
      .filter((c) => String(c.ITEMCODE || '').trim()) : [];
    const cost = new Map(costs.map((c) => [String(c.ITEMCODE).trim(), c]));
    for (const g of chosen) {
      const c = cost.get(g.code);
      if (c && /obsolete/i.test(String(c.ITEMSTATUS || ''))) continue;
      out.push({ ...g, averageCost: c ? Number(c.AVERAGECOST) || null : null });
    }
  }
  if (north.length) {
    const exec = await odooExec();
    const uids = (await Promise.all(north.map((p) => northUserIds(exec, p)))).flat();
    const base = [['move_id.company_id', '=', NORTH], ['move_id.state', '=', 'posted'], ['move_id.move_type', '=', 'out_invoice'],
      ['move_id.invoice_date', '>=', since], ['display_type', '=', 'product'], ['product_id', '!=', false]];
    // how widely each product sells: the number of invoice lines over the year (one line = one product on one invoice)
    const wide = (await exec('account.move.line', 'read_group', [base, ['quantity:sum'], ['product_id']], { lazy: false }, 90000))
      .filter((r) => r.product_id).sort((a, b) => (b.__count || 0) - (a.__count || 0)).slice(0, 150);
    const ids = wide.map((r) => r.product_id[0]);
    // the team's own reach: distinct customers per product, and the last date the team invoiced it
    const teamLines = ids.length ? await exec('account.move.line', 'read_group', [[...base, ['move_id.invoice_user_id', 'in', uids], ['product_id', 'in', ids]],
      ['date:max'], ['product_id', 'partner_id']], { lazy: false }, 90000) : [];
    const reach = new Map();
    for (const r of teamLines) {
      if (!r.product_id) continue;
      const a = reach.get(r.product_id[0]) || { n: 0, d: null };
      a.n += 1; if (r.date && (!a.d || r.date > a.d)) a.d = r.date;
      reach.set(r.product_id[0], a);
    }
    const rows = wide.map((r, i) => {
      const a = reach.get(r.product_id[0]);
      return { source: 'Odoo', id: r.product_id[0], companyRank: i + 1, teamCustomers12m: a ? a.n : 0, teamLastSold: a ? String(a.d).slice(0, 10) : null };
    });
    const chosen = pick(rows);
    const prods = chosen.length ? await exec('product.product', 'read', [chosen.map((g) => g.id)], { fields: ['default_code', 'name', 'standard_price', 'active'] }) : [];
    const byId = new Map(prods.map((r) => [r.id, r]));
    for (const g of chosen) {
      const r = byId.get(g.id); if (!r || r.active === false) continue;
      out.push({ source: 'Odoo', code: r.default_code || null, product: r.name, companyRank: g.companyRank,
        teamCustomers12m: g.teamCustomers12m, teamLastSold: g.teamLastSold, standardCost: Number(r.standard_price) || null });
    }
  }
  return {
    searchedIn: sourcesOf(people),
    howToRead: 'Range gaps: of the company\'s 150 most widely sold products, the ones your team reaches least. companyRank is the product\'s place in that list (1 = bought by the most different customers in the last 12 months). teamCustomers12m is how many of your team\'s customers bought it in the last 12 months, teamLastSold is when your team last invoiced it. No company or other-rep sales figures are given, on purpose.',
    items: out,
    note: out.length ? null : 'Your team already sells the company\'s most widely sold products widely and recently.',
  };
}
