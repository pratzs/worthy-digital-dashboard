/**
 * SELLING PRICES for the Marketing login (lib/repTools.js, role 'marketing'): a product's standard sell price, what each
 * customer actually paid for it, and how those prices moved over time. Before GST, both systems.
 *
 * Where the figures come from:
 *  - Standard sell price today: Odoo product "Sales Price" (list_price); Ostendo ITEMMASTER.STDSELLPRICE.
 *  - What a customer paid: posted invoice lines (credit notes left out, they are not a sale price).
 *      North (Odoo company 4): line list price (price_unit), the line discount %, and the net (price_subtotal / quantity).
 *      South (Ostendo): the standard price at the time of sale (STANDARDUNITPRICE), the price charged (INVOICEUNITPRICE),
 *      the discount %, and the net (EXTENDEDNETTPRICE / INVOICEQTY).
 *  - Standard price history: neither system logs it. It is read back from the list/standard price each invoice line
 *    carried, plus the daily snapshot (lib/priceSnapshot.js) from 19 Nov 2026 onward.
 *
 * Customer pricing is mostly set by hand on each order (a discount in North, a price or discount in South); there are no
 * customer price lists with prices in them in either system, so the invoices are the only true record of "who pays what".
 * No salesperson, rep or week is read or returned; guardMarketing in repTools fails closed if one ever appears.
 */
import { odooExec } from '@/lib/repData';
import { NORTH_LABEL, SOUTH_LABEL } from '@/lib/systemNames';
import { ostendoSql, q, nzToday, normaliseDate } from '@/lib/ostendo';
import { words } from '@/lib/accountData';
import { snapshotChanges } from '@/lib/priceSnapshot';

const NORTH = 4;
const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const r1 = (v) => Math.round((Number(v) || 0) * 10) / 10;
const tidy = (n) => String(n ?? '').replace(/\s+20\d{2}$/, '').trim();
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s)) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
const addMonths = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); };
const looksLikeCode = (s) => /^[A-Za-z0-9][A-Za-z0-9._-]{1,24}$/.test(String(s).trim()) && /\d/.test(String(s));
const MAX_MATCHES = 8;

function period(input, defaultMonths) {
  if (input?.from || input?.to) {
    if (!isDate(input.from) || !isDate(input.to)) throw new Error('Dates must be given as YYYY-MM-DD, both from and to.');
    if (input.from > input.to) throw new Error('Dates must run forward: from must not be after to.');
    if ((Date.parse(input.to) - Date.parse(input.from)) / 86400000 > 366 * 5) throw new Error('Dates must cover 5 years or less.');
    return { from: input.from, to: input.to };
  }
  const months = Math.min(60, Math.max(1, Number(input?.months) || defaultMonths));
  const to = nzToday();
  return { from: addMonths(to, -months), to, months };
}

// ── finding the product ─────────────────────────────────────────────────────────────────────────
/** Products matching a name or code in both systems, with today's standard sell price and cost. */
export async function findProducts(nameOrCode) {
  const raw = String(nameOrCode ?? '').trim().slice(0, 80);
  const exec = await odooExec();
  const fields = ['default_code', 'name', 'list_price', 'standard_price', 'uom_id', 'active'];
  let odoo, south;
  if (looksLikeCode(raw)) {
    [odoo, south] = await Promise.all([
      exec('product.product', 'search_read', [[['default_code', '=ilike', raw]]], { fields, limit: 5, context: { active_test: false, lang: 'en_AU' } }),
      ostendoSql(`SELECT FIRST 5 ITEMCODE, ITEMDESCRIPTION, STDSELLPRICE, AVERAGECOST, STDBUYPRICE, ITEMUNIT, ITEMSTATUS, LASTPRICEUPDATEDATE FROM ITEMMASTER WHERE UPPER(ITEMCODE) = ${q(raw.toUpperCase())}`, 30000).catch(() => []),
    ]);
  }
  if (!odoo?.length && !(south || []).some((r) => String(r.ITEMCODE || '').trim())) {
    const ws = words(raw);
    if (!ws.length) return { odoo: [], south: [] };
    const like = ws.map((w) => `UPPER(ITEMDESCRIPTION) LIKE ${q(`%${w.toUpperCase()}%`)}`).join(' AND ');
    [odoo, south] = await Promise.all([
      exec('product.product', 'search_read', [[...ws.map((w) => ['name', 'ilike', w]), ['sale_ok', '=', true]]], { fields, limit: 40, order: 'name asc', context: { lang: 'en_AU' } }),
      ostendoSql(`SELECT FIRST ${MAX_MATCHES + 1} ITEMCODE, ITEMDESCRIPTION, STDSELLPRICE, AVERAGECOST, STDBUYPRICE, ITEMUNIT, ITEMSTATUS, LASTPRICEUPDATEDATE FROM ITEMMASTER WHERE ${like} AND ITEMSTATUS <> 'Inactive' ORDER BY ITEMDESCRIPTION`, 30000).catch(() => []),
    ]);
  }
  const eventCopy = (r) => /\s-\s[A-Z]{2}\d{2}[A-Z]{3}$/.test(String(r.default_code || ''));
  odoo = [...(odoo || []).filter((r) => !eventCopy(r)), ...(odoo || []).filter(eventCopy)];
  return {
    odoo: (odoo || []).map((r) => ({ id: r.id, system: NORTH_LABEL, code: r.default_code || null, product: r.name, unit: r.uom_id ? r.uom_id[1] : null,
      standardSellPrice: r2(r.list_price) || null, cost: r2(r.standard_price) || null })),
    south: (south || []).filter((r) => String(r.ITEMCODE || '').trim()).map((r) => ({ system: SOUTH_LABEL, code: String(r.ITEMCODE).trim(), product: String(r.ITEMDESCRIPTION || '').trim(),
      unit: String(r.ITEMUNIT || '').trim() || null, standardSellPrice: r2(r.STDSELLPRICE) || null, cost: r2(Number(r.AVERAGECOST) || Number(r.STDBUYPRICE)) || null,
      status: String(r.ITEMSTATUS || '').trim() || null, standardPriceLastChanged: normaliseDate(String(r.LASTPRICEUPDATEDATE || '').split(' ')[0]) || null })),
  };
}

const marginPct = (price, cost) => (price && cost ? r1(((price - cost) / price) * 100) : null);

/** Tool: product_price. Standard sell price, cost and margin at that price, for every product matching. */
export async function productPrice(input) {
  const found = await findProducts(input?.name);
  const items = [...found.odoo.slice(0, MAX_MATCHES), ...found.south.slice(0, MAX_MATCHES)].map((p) => ({
    system: p.system, code: p.code, product: p.product, unit: p.unit,
    standardSellPrice: p.standardSellPrice, cost: p.cost, marginAtStandardPricePct: marginPct(p.standardSellPrice, p.cost),
    ...(p.status ? { status: p.status } : {}), ...(p.standardPriceLastChanged ? { standardPriceLastChanged: p.standardPriceLastChanged } : {}),
  }));
  const notes = [];
  if (!items.length) notes.push('No product matched. Try fewer words, or the item code.');
  if (found.odoo.length > MAX_MATCHES || found.south.length > MAX_MATCHES) notes.push(`More than ${MAX_MATCHES} products matched in a system; only the first ${MAX_MATCHES} are shown. Add a word or use the item code.`);
  return {
    searched: String(input?.name ?? '').slice(0, 80),
    basis: 'Standard sell price and cost before GST as recorded today, per the unit the item is sold in. North is Odoo "Sales Price" and standard cost; South is Ostendo standard sell price and average cost (standard buy price if there is no average). Customers often pay less: use customer_prices to see what each customer actually paid.',
    items, notes,
  };
}

// ── invoice lines for one product ───────────────────────────────────────────────────────────────
async function northLines(product, ws, p) {
  const exec = await odooExec();
  const domain = [
    ['move_id.company_id', '=', NORTH], ['move_id.state', '=', 'posted'], ['move_id.move_type', '=', 'out_invoice'],
    ['date', '>=', p.from], ['date', '<=', p.to], ['display_type', '=', 'product'], ['product_id', '=', product.id], ['quantity', '>', 0],
    ...ws.flatMap((w) => ['|', ['move_id.commercial_partner_id.name', 'ilike', w], ['move_id.partner_id.name', 'ilike', w]]),
  ];
  const lines = await exec('account.move.line', 'search_read', [domain], { fields: ['date', 'move_id', 'quantity', 'price_unit', 'discount', 'price_subtotal'], order: 'date asc, id asc', limit: 3000 }, 90000);
  // The store is the invoice's own customer (a store is often a contact under its group), as on the dashboard customer list.
  const moveIds = [...new Set(lines.map((l) => l.move_id[0]))];
  const moves = new Map();
  for (let i = 0; i < moveIds.length; i += 500) {
    for (const m of await exec('account.move', 'read', [moveIds.slice(i, i + 500)], { fields: ['partner_id'] }, 60000)) moves.set(m.id, m.partner_id ? tidy(m.partner_id[1]) : 'Unknown');
  }
  return {
    capped: lines.length >= 3000,
    rows: lines.map((l) => ({ date: l.date, invoice: String(l.move_id[1]).replace(/\s*\(.*$/, ''), customer: moves.get(l.move_id[0]) || 'Unknown', quantity: Number(l.quantity) || 0,
      listPrice: r2(l.price_unit), discountPct: r1(l.discount), netUnitPrice: r2((Number(l.price_subtotal) || 0) / (Number(l.quantity) || 1)) })),
  };
}

async function southLines(product, ws, p) {
  const like = ws.map((w) => ` AND UPPER(h.CUSTOMER) LIKE ${q(`%${w.toUpperCase()}%`)}`).join('');
  const rows = await ostendoSql(`SELECT FIRST 3000 h.INVOICEDATE, h.CUSTOMER, l.INVOICENUMBER, l.INVOICEQTY, l.STANDARDUNITPRICE, l.INVOICEUNITPRICE, l.DISCOUNTPERCENT, l.EXTENDEDNETTPRICE
      FROM SALESINVOICELINES l JOIN SALESINVOICEHEADER h ON h.INVOICENUMBER = l.INVOICENUMBER
      WHERE l.CODETYPE = 'Item Code' AND l.LINECODE = ${q(product.code)} AND l.INVOICEQTY > 0
        AND h.INVOICEDATE BETWEEN ${q(p.from)} AND ${q(p.to)}${like}
      ORDER BY h.INVOICEDATE, l.INVOICENUMBER`, 90000);
  const list = (rows || []).filter((r) => String(r.INVOICENUMBER || '').trim());
  return {
    capped: list.length >= 3000,
    rows: list.map((r) => {
      // INVOICEUNITPRICE is already after the discount; STANDARDUNITPRICE is the standard price on the day of sale.
      const qty = Number(r.INVOICEQTY) || 0, std = r2(r.STANDARDUNITPRICE);
      const net = r2((Number(r.EXTENDEDNETTPRICE) || 0) / (qty || 1));
      return { date: normaliseDate(r.INVOICEDATE), invoice: String(r.INVOICENUMBER).trim(), customer: tidy(r.CUSTOMER), quantity: qty,
        listPrice: std || r2(r.INVOICEUNITPRICE), discountPct: r1(r.DISCOUNTPERCENT), netUnitPrice: net };
    }),
  };
}

/** Resolve to at most one product per system; several matches come back as a list to choose from. */
async function oneProductPerSystem(name) {
  const found = await findProducts(name);
  const pick = (list) => (list.length === 1 ? list[0] : list.find((x) => String(x.code || '').toUpperCase() === String(name || '').trim().toUpperCase()) || null);
  const n = pick(found.odoo), s = pick(found.south);
  const ambiguous = [...(n ? [] : found.odoo), ...(s ? [] : found.south)].slice(0, 12).map((x) => ({ system: x.system, code: x.code, product: x.product }));
  return { north: n, south: s, ambiguous };
}

async function linesFor(input, defaultMonths) {
  const p = period(input, defaultMonths);
  const ws = words(input?.customer);
  const pr = await oneProductPerSystem(input?.name);
  const [n, s] = await Promise.all([
    pr.north ? northLines(pr.north, ws, p) : null,
    pr.south ? southLines(pr.south, ws, p).catch((e) => ({ error: String(e?.message || e).slice(0, 120), rows: [] })) : null,
  ]);
  return { p, ws, pr, n, s };
}

const describe = (prod) => (prod ? { system: prod.system, code: prod.code, product: prod.product, unit: prod.unit, standardSellPriceToday: prod.standardSellPrice, costToday: prod.cost } : null);

// Sales between Worthy's own companies are transfers at cost-plus, not customer pricing, so they are left out.
const INTERCO = /^worthy (products|oceania)( |$)/i;
const splitRows = (rows) => {
  const own = rows.filter((r) => INTERCO.test(r.customer));
  return { rows: rows.filter((r) => !INTERCO.test(r.customer)), interCompanyLines: own.length };
};

function byCustomer(allRows, standardToday) {
  const m = new Map();
  for (const r of allRows) {
    const c = m.get(r.customer) || { customer: r.customer, invoices: 0, units: 0, value: 0, freeUnits: 0, lowest: Infinity, highest: -Infinity, last: null };
    c.invoices += 1;
    // A line at no charge is free stock (a bonus or promotion), not a price: counted, but kept out of the price figures.
    if (r.netUnitPrice <= 0) { c.freeUnits += r.quantity; m.set(r.customer, c); continue; }
    c.units += r.quantity; c.value += r.netUnitPrice * r.quantity;
    c.lowest = Math.min(c.lowest, r.netUnitPrice); c.highest = Math.max(c.highest, r.netUnitPrice);
    if (!c.last || r.date >= c.last.date) c.last = r;
    m.set(r.customer, c);
  }
  return [...m.values()].filter((c) => c.last).map((c) => {
    const vs = standardToday ? r1(((c.last.netUnitPrice - standardToday) / standardToday) * 100) : null;
    return {
      customer: c.customer, invoices: c.invoices, units: r2(c.units), averageNetPrice: c.units ? r2(c.value / c.units) : null,
      lowestNetPrice: r2(c.lowest), highestNetPrice: r2(c.highest), ...(c.freeUnits ? { freeUnits: r2(c.freeUnits) } : {}),
      lastPaid: { date: c.last.date, netUnitPrice: c.last.netUnitPrice, listPrice: c.last.listPrice, discountPct: c.last.discountPct },
      lastPaidVsStandardTodayPct: vs,
      pricing: vs === null ? null : vs < -0.5 ? 'below standard' : vs > 0.5 ? 'above standard' : 'at standard',
    };
  }).sort((a, b) => b.units - a.units);
}

/** Tool: customer_prices. Who bought this product, what each paid last, against today's standard price. */
export async function customerPrices(input) {
  const { p, pr, n, s } = await linesFor(input, 12);
  const notes = [];
  if (!pr.north && !pr.south) notes.push(pr.ambiguous.length ? 'Several products matched. Ask again with the exact item code from the list.' : 'No product matched. Try fewer words, or the item code.');
  const part = (prod, res) => {
    if (!prod || !res) return null;
    if (res.error) { notes.push(`${prod.system} could not be read just now. Try again shortly.`); return null; }
    if (res.capped) notes.push(`${prod.system}: more than 3,000 invoice lines, so the oldest are missing. Use a shorter period or a customer name.`);
    const { rows, interCompanyLines } = splitRows(res.rows);
    const customers = byCustomer(rows, prod.standardSellPrice);
    const count = (k) => customers.filter((c) => c.pricing === k).length;
    return { ...describe(prod), invoiceLines: rows.length, ...(interCompanyLines ? { interCompanyLinesLeftOut: interCompanyLines } : {}),
      customers: customers.length, belowStandard: count('below standard'), atStandard: count('at standard'), aboveStandard: count('above standard'),
      list: customers.slice(0, 40) };
  };
  let out = [part(pr.north, n), part(pr.south, s)].filter(Boolean);
  if (input?.customer && out.length) {
    const none = out.filter((x) => !x.invoiceLines).map((x) => x.system);
    out = out.filter((x) => x.invoiceLines);
    if (none.length) notes.push(`No sales of this product to that customer in ${none.join(' or ')} in this period.`);
  }
  if (out.some((x) => x.customers > 40)) notes.push('Only the 40 customers who bought the most are listed per system.');
  return {
    searched: String(input?.name ?? '').slice(0, 80), customerFilter: input?.customer ? String(input.customer).slice(0, 80) : null,
    period: { from: p.from, to: p.to },
    basis: 'Posted invoices only (credit notes left out), before GST. Net price is after the line discount. "Standard" is the standard sell price today. Customers are the invoice customer (store), not the salesperson. Sales between Worthy companies are left out, and lines at no charge (free stock) are counted as freeUnits, not as a price.',
    products: out, chooseFrom: pr.ambiguous.length ? pr.ambiguous : undefined, notes,
  };
}

/** Each customer's price changes (net price moved by more than half a percent from their previous invoice). */
function changePoints(rows) {
  const prev = new Map(), out = [];
  for (const r of rows) {
    const before = prev.get(r.customer);
    if (before && Math.abs(r.netUnitPrice - before.netUnitPrice) > Math.max(0.01, before.netUnitPrice * 0.005)) {
      out.push({ customer: r.customer, date: r.date, from: before.netUnitPrice, to: r.netUnitPrice, changePct: before.netUnitPrice ? r1(((r.netUnitPrice - before.netUnitPrice) / before.netUnitPrice) * 100) : null,
        invoice: r.invoice, discountPctNow: r.discountPct });
    }
    prev.set(r.customer, r);
  }
  return out;
}

/** The list/standard price each invoice line carried, collapsed into the dates it changed. */
function listPriceSteps(rows) {
  const out = [];
  for (const r of rows) {
    const last = out[out.length - 1];
    if (!last || Math.abs(r.listPrice - last.listPrice) > 0.005) out.push({ from: r.date, listPrice: r.listPrice });
  }
  return out;
}

/** Tool: price_history. Invoice-by-invoice prices for a product (optionally one customer or group), with every change marked. */
export async function priceHistory(input) {
  const { p, pr, n, s } = await linesFor(input, 24);
  const notes = [];
  if (!pr.north && !pr.south) notes.push(pr.ambiguous.length ? 'Several products matched. Ask again with the exact item code from the list.' : 'No product matched. Try fewer words, or the item code.');
  const snaps = await snapshotChanges([pr.north?.code, pr.south?.code].filter(Boolean)).catch(() => []);
  const part = (prod, res, sysKey) => {
    if (!prod || !res) return null;
    if (res.error) { notes.push(`${prod.system} could not be read just now. Try again shortly.`); return null; }
    if (res.capped) notes.push(`${prod.system}: more than 3,000 invoice lines, so the oldest are missing. Use a shorter period or a customer name.`);
    const { rows: sold, interCompanyLines } = splitRows(res.rows);
    const rows = sold.filter((r) => r.netUnitPrice > 0);   // free-stock lines are not a price
    const changes = changePoints(rows);
    return {
      ...describe(prod), invoiceLines: rows.length, ...(interCompanyLines ? { interCompanyLinesLeftOut: interCompanyLines } : {}),
      ...(sold.length - rows.length ? { freeStockLinesLeftOut: sold.length - rows.length } : {}),
      standardPriceFromInvoices: listPriceSteps(rows),
      standardPriceChangesRecorded: snaps.filter((c) => c.system === sysKey && c.code === prod.code).map(({ date, from, to }) => ({ date, from, to })),
      customerPriceChanges: changes.slice(-60).reverse(),
      latestInvoices: rows.slice(-40).reverse(),
    };
  };
  let out = [part(pr.north, n, 'north'), part(pr.south, s, 'south')].filter(Boolean);
  if (input?.customer && out.length) {
    const none = out.filter((x) => !x.invoiceLines).map((x) => x.system);
    out = out.filter((x) => x.invoiceLines);
    if (none.length) notes.push(`No sales of this product to that customer in ${none.join(' or ')} in this period.`);
  }
  if (out.some((x) => x.invoiceLines > 40)) notes.push('Only the latest 40 invoice lines and 60 price changes are listed per system; the price steps and changes cover the whole period.');
  return {
    searched: String(input?.name ?? '').slice(0, 80), customerFilter: input?.customer ? String(input.customer).slice(0, 80) : null,
    period: { from: p.from, to: p.to },
    basis: 'Posted invoices only (credit notes left out), before GST, oldest to newest. standardPriceFromInvoices is the list or standard price each invoice line carried (North: Odoo line price before discount; South: Ostendo standard price at the time of sale), so it only shows a step when something was invoiced. standardPriceChangesRecorded comes from the daily price snapshot, which started on 19 Nov 2026. A customer price change is a net price more than 0.5% away from that customer\'s previous invoice.',
    products: out, chooseFrom: pr.ambiguous.length ? pr.ambiguous : undefined, notes,
  };
}
