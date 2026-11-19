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
const r2 = (v) => Math.round(((Number(v) || 0) + Number.EPSILON) * 100) / 100;
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
async function northLines(product, ws, p, max = 3000, pw = []) {
  const exec = await odooExec();
  const domain = [
    ['move_id.company_id', '=', NORTH], ['move_id.state', '=', 'posted'], ['move_id.move_type', '=', 'out_invoice'],
    ['date', '>=', p.from], ['date', '<=', p.to], ['display_type', '=', 'product'], ['quantity', '>', 0],
    ...(product ? [['product_id', '=', product.id]] : [['product_id', '!=', false]]),
    ...ws.flatMap((w) => ['|', ['move_id.commercial_partner_id.name', 'ilike', w], ['move_id.partner_id.name', 'ilike', w]]),
    ...pw.flatMap((w) => ['|', ['product_id.default_code', 'ilike', w], ['product_id.name', 'ilike', w]]),
  ];
  // Newest first, so a cap drops the OLDEST lines; turned back to oldest-first below.
  const lines = (await exec('account.move.line', 'search_read', [domain], { fields: ['date', 'move_id', 'product_id', 'quantity', 'price_unit', 'discount', 'price_subtotal'], order: 'date desc, id desc', limit: max }, 90000)).reverse();
  // The store is the invoice's own customer (a store is often a contact under its group), as on the dashboard customer list.
  // invoice_origin is the sales order the invoice came from (SO number).
  const moveIds = [...new Set(lines.map((l) => l.move_id[0]))];
  const moves = new Map();
  for (let i = 0; i < moveIds.length; i += 500) {
    for (const m of await exec('account.move', 'read', [moveIds.slice(i, i + 500)], { fields: ['partner_id', 'invoice_origin'] }, 60000)) {
      moves.set(m.id, { customer: m.partner_id ? tidy(m.partner_id[1]) : 'Unknown', order: String(m.invoice_origin || '').trim() || null });
    }
  }
  return {
    capped: lines.length >= max,
    rows: lines.map((l) => {
      const mv = moves.get(l.move_id[0]) || {};
      const pn = /^\[([^\]]+)\]\s*(.*)$/.exec(String(l.product_id?.[1] || ''));
      return { date: l.date, invoice: String(l.move_id[1]).replace(/\s*\(.*$/, ''), order: mv.order || null, customer: mv.customer || 'Unknown',
        code: pn ? pn[1] : null, product: pn ? pn[2] : String(l.product_id?.[1] || ''), quantity: Number(l.quantity) || 0,
        listPrice: r2(l.price_unit), discountPct: r1(l.discount), netUnitPrice: r2((Number(l.price_subtotal) || 0) / (Number(l.quantity) || 1)) };
    }),
  };
}

async function southLines(product, ws, p, max = 3000, pw = []) {
  const like = ws.map((w) => ` AND UPPER(h.CUSTOMER) LIKE ${q(`%${w.toUpperCase()}%`)}`).join('');
  const which = (product ? ` AND l.LINECODE = ${q(product.code)}` : '')
    + pw.map((w) => ` AND (UPPER(l.LINECODE) LIKE ${q(`%${w.toUpperCase()}%`)} OR UPPER(l.LINEDESCRIPTION) LIKE ${q(`%${w.toUpperCase()}%`)})`).join('');
  const rows = await ostendoSql(`SELECT FIRST ${max} h.INVOICEDATE, h.CUSTOMER, l.INVOICENUMBER, l.ORDERNUMBER, l.LINECODE, l.LINEDESCRIPTION, l.INVOICEQTY, l.STANDARDUNITPRICE, l.INVOICEUNITPRICE, l.DISCOUNTPERCENT, l.EXTENDEDNETTPRICE
      FROM SALESINVOICELINES l JOIN SALESINVOICEHEADER h ON h.INVOICENUMBER = l.INVOICENUMBER
      WHERE l.CODETYPE = 'Item Code' AND l.INVOICEQTY > 0${which}
        AND h.INVOICEDATE BETWEEN ${q(p.from)} AND ${q(p.to)}${like}
      ORDER BY h.INVOICEDATE DESC, l.INVOICENUMBER DESC`, 90000);
  // Newest first, so a cap drops the OLDEST lines; turned back to oldest-first here.
  const list = (rows || []).filter((r) => String(r.INVOICENUMBER || '').trim()).reverse();
  return {
    capped: list.length >= max,
    rows: list.map((r) => {
      // INVOICEUNITPRICE is already after the discount; STANDARDUNITPRICE is the standard price on the day of sale.
      const qty = Number(r.INVOICEQTY) || 0, std = r2(r.STANDARDUNITPRICE);
      const net = r2((Number(r.EXTENDEDNETTPRICE) || 0) / (qty || 1));
      const code = String(r.LINECODE || '').trim();
      return { date: normaliseDate(r.INVOICEDATE), invoice: String(r.INVOICENUMBER).trim(), order: String(r.ORDERNUMBER || '').trim() || null, customer: tidy(r.CUSTOMER),
        code: code.startsWith('ZZZ') ? null : code, product: String(r.LINEDESCRIPTION || '').trim(), quantity: qty,
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
      latestInvoices: rows.slice(-40).reverse().map(({ code, product, ...r }) => r),
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

/** Tool: customer_price_list. Start from the CUSTOMER: every product they bought in the period and each different price
 *  they were charged for it (list price, discount, net), when it applied, on which invoices and sales orders. */
export async function customerPriceList(input) {
  const ws = words(input?.customer);
  if (!ws.length) throw new Error('Tell me which customer, for example "Fresh Choice Flat Bush" or "CSB".');
  const p = period(input, 6);
  const pw = words(input?.product);
  const MAX = 6000;
  const [n, s] = await Promise.all([
    northLines(null, ws, p, MAX, pw),
    southLines(null, ws, p, MAX, pw).catch((e) => ({ error: String(e?.message || e).slice(0, 120), rows: [] })),
  ]);
  const notes = [];
  const part = (system, res) => {
    if (res.error) { notes.push(`${system} could not be read just now. Try again shortly.`); return null; }
    if (res.capped) notes.push(`${system}: more than ${MAX.toLocaleString()} invoice lines, so the oldest are missing. Use a shorter period, a more specific customer, or a product.`);
    const split = splitRows(res.rows);
    let rows = split.rows;
    if (pw.length) rows = rows.filter((r) => { const t = `${r.code || ''} ${r.product}`.toLowerCase(); return pw.every((w) => t.includes(w)); });
    if (!rows.length) return null;
    const stores = [...new Set(rows.map((r) => r.customer))];
    const prods = new Map();
    for (const r of rows) {
      const k = r.code || r.product;
      const x = prods.get(k) || { code: r.code, product: r.product, units: 0, freeUnits: 0, invoices: new Set(), points: new Map(), last: null };
      x.invoices.add(r.invoice);
      if (r.netUnitPrice <= 0) { x.freeUnits += r.quantity; prods.set(k, x); continue; }
      x.units += r.quantity;
      const pk = `${r.listPrice}|${r.discountPct}|${r.netUnitPrice}`;
      const pt = x.points.get(pk) || { listPrice: r.listPrice, discountPct: r.discountPct, netUnitPrice: r.netUnitPrice, firstCharged: r.date, lastCharged: r.date, units: 0, invoices: new Set(), orders: new Set(), stores: new Set() };
      pt.units += r.quantity; pt.invoices.add(r.invoice); if (r.order) pt.orders.add(r.order); pt.stores.add(r.customer);
      if (r.date < pt.firstCharged) pt.firstCharged = r.date;
      if (r.date > pt.lastCharged) pt.lastCharged = r.date;
      x.points.set(pk, pt);
      if (!x.last || r.date >= x.last.date) x.last = r;
      prods.set(k, x);
    }
    const products = [...prods.values()].filter((x) => x.last).sort((a, b) => b.units - a.units).map((x) => {
      const points = [...x.points.values()].sort((a, b) => (a.firstCharged < b.firstCharged ? -1 : 1));
      const nets = points.map((pt) => pt.netUnitPrice);
      return {
        code: x.code, product: x.product, units: r2(x.units), invoices: x.invoices.size, ...(x.freeUnits ? { freeUnits: r2(x.freeUnits) } : {}),
        lastCharged: { date: x.last.date, invoice: x.last.invoice, order: x.last.order, ...(stores.length > 1 ? { store: x.last.customer } : {}),
          listPrice: x.last.listPrice, discountPct: x.last.discountPct, netUnitPrice: x.last.netUnitPrice },
        differentPricesCharged: points.length, lowestNet: Math.min(...nets), highestNet: Math.max(...nets),
        pricesCharged: points.slice(-12).map((pt) => ({
          listPrice: pt.listPrice, discountPct: pt.discountPct, netUnitPrice: pt.netUnitPrice, firstCharged: pt.firstCharged, lastCharged: pt.lastCharged,
          units: r2(pt.units), invoices: pt.invoices.size, orders: [...pt.orders].slice(-5),
          ...(stores.length > 1 ? { stores: pt.stores.size, storeNames: [...pt.stores].slice(0, 3) } : {}),
        })),
      };
    });
    return {
      system, storesMatched: stores.length, storeNames: stores.slice(0, 25), invoiceLines: rows.length,
      ...(split.interCompanyLines ? { interCompanyLinesLeftOut: split.interCompanyLines } : {}),
      productsBought: products.length, productsWithMoreThanOnePrice: products.filter((x) => x.differentPricesCharged > 1).length,
      products: products.slice(0, 80),
    };
  };
  const out = [part(NORTH_LABEL, n), part(SOUTH_LABEL, s)].filter(Boolean);
  if (!out.length) notes.push('No sales to a customer matching every word of that name in this period. Try fewer words or a longer period.');
  if (out.some((x) => x.productsBought > 80)) notes.push('Only the 80 products bought most are listed per system.');
  if (out.some((x) => x.products.some((pr) => pr.differentPricesCharged > 12))) notes.push('Where a product had more than 12 different prices, only the latest 12 are listed.');
  return {
    customerSearched: String(input.customer).slice(0, 80), productFilter: input?.product ? String(input.product).slice(0, 80) : null,
    period: { from: p.from, to: p.to },
    basis: 'Posted invoices only (credit notes left out), before GST. Each different price charged is a separate row: list price on the invoice line, the discount given on that order, and the net price per unit after it, with the dates it was first and last charged and the sales order (SO) numbers. North list price is the Odoo line price; South is the Ostendo standard price on the day of sale. Sales between Worthy companies and lines at no charge (free stock, counted as freeUnits) are left out of the prices. Customers are the invoice customer (store), never the salesperson.',
    systems: out, notes,
  };
}

// ── checking a proposed price list ─────────────────────────────────────────────────────────────
const GST = 0.15;
const inc = (v) => (v === null || v === undefined ? null : r2(v * (1 + GST)));
const exFrom = (v, includesGst) => (includesGst ? v / (1 + GST) : v);
const margin = (price, cost) => (price > 0 && cost ? r1(((price - cost) / price) * 100) : null);
const markup = (price, cost) => (price > 0 && cost ? r1(((price - cost) / cost) * 100) : null);
const pair = (ex) => (ex === null || ex === undefined ? null : { exGst: r2(ex), incGst: inc(ex) });

/** Tool: price_list_check. A proposed price list (code or name + price) checked line by line: cost, margin and markup,
 *  the standard price today, the account's current price, and the same again net of a rebate. Ex and inc GST. */
export async function priceListCheck(input) {
  const items = Array.isArray(input?.items) ? input.items.slice(0, 60) : [];
  if (!items.length) throw new Error('Give the proposed price list as items, each with a product code or name and a price.');
  const includesGst = input?.pricesIncludeGst === true;
  const rebateAll = Number(input?.rebatePct) || 0;
  if (rebateAll < 0 || rebateAll > 90) throw new Error('rebatePct must be between 0 and 90.');
  const sys = String(input?.system || '').toLowerCase();
  const wantNorth = !/^(south|ostendo|dutch)/.test(sys), wantSouth = !/^(north|odoo)/.test(sys);

  // The account's current price: the last price it was charged per product in the last 12 months.
  const ws = words(input?.customer);
  const current = { north: new Map(), south: new Map() };
  let accountStores = [];
  if (ws.length) {
    const p = period({ months: 12 }, 12);
    const [n, s] = await Promise.all([
      wantNorth ? northLines(null, ws, p, 6000).catch(() => ({ rows: [] })) : { rows: [] },
      wantSouth ? southLines(null, ws, p, 6000).catch(() => ({ rows: [] })) : { rows: [] },
    ]);
    for (const [key, res] of [['north', n], ['south', s]]) {
      for (const r of splitRows(res.rows).rows) {
        if (r.netUnitPrice <= 0 || !r.code) continue;
        const k = r.code.toUpperCase(), was = current[key].get(k);
        if (!was || r.date >= was.date) current[key].set(k, r);
      }
      accountStores = accountStores.concat(splitRows(res.rows).rows.map((r) => r.customer));
    }
    accountStores = [...new Set(accountStores)];
  }

  // Look the products up a few at a time, so a long list does not load Odoo or Ostendo all at once.
  const found = new Array(items.length);
  for (let i = 0; i < items.length; i += 5) {
    await Promise.all(items.slice(i, i + 5).map(async (it, j) => { found[i + j] = await findProducts(it?.code || it?.name).catch(() => ({ odoo: [], south: [] })); }));
  }

  const lines = items.map((it, idx) => {
    const asked = String(it?.code || it?.name || '').trim().slice(0, 80);
    const priceRaw = Number(String(it?.price ?? '').replace(/[$,\s]/g, ''));
    if (!asked || !Number.isFinite(priceRaw) || priceRaw <= 0) return { line: idx + 1, asked, problem: 'Needs a product code or name and a price above zero.' };
    const f = found[idx];
    const pool = [...(wantNorth ? f.odoo : []), ...(wantSouth ? f.south : [])];
    const exact = pool.filter((x) => String(x.code || '').toUpperCase() === asked.toUpperCase());
    let matches = exact.length ? exact : pool;
    // With an account given, prefer the system(s) that account actually buys from.
    if (matches.length > 1 && ws.length) {
      const bought = matches.filter((x) => current[x.system === NORTH_LABEL ? 'north' : 'south'].has(String(x.code || '').toUpperCase()));
      if (bought.length) matches = bought;
    }
    if (!matches.length) return { line: idx + 1, asked, problem: 'No product matched. Use the item code.' };
    const perSystem = new Set(matches.map((x) => x.system));
    if (matches.length > perSystem.size) {
      return { line: idx + 1, asked, problem: 'More than one product matched. Use the item code.', chooseFrom: matches.slice(0, 8).map((x) => ({ system: x.system, code: x.code, product: x.product })) };
    }
    const rebate = it?.rebatePct !== undefined && it?.rebatePct !== '' ? Number(it.rebatePct) : rebateAll;
    const proposedEx = exFrom(priceRaw, includesGst);
    const afterRebateEx = proposedEx * (1 - (Number.isFinite(rebate) ? rebate : 0) / 100);
    return matches.map((m) => {
      const cur = ws.length ? current[m.system === NORTH_LABEL ? 'north' : 'south'].get(String(m.code || '').toUpperCase()) : null;
      const vs = (a, b) => (a && b ? r1(((a - b) / b) * 100) : null);
      return {
        line: idx + 1, asked, system: m.system, code: m.code, product: m.product, unit: m.unit,
        proposedPrice: pair(proposedEx),
        cost: pair(m.cost),
        marginPct: margin(proposedEx, m.cost), markupPct: markup(proposedEx, m.cost),
        ...(rebate ? {
          rebatePct: rebate,
          netOfRebate: { price: pair(afterRebateEx), marginPct: margin(afterRebateEx, m.cost), markupPct: markup(afterRebateEx, m.cost) },
        } : {}),
        standardPriceToday: pair(m.standardSellPrice),
        proposedVsStandardPct: vs(proposedEx, m.standardSellPrice),
        ...(ws.length ? {
          accountCurrentPrice: cur ? { ...pair(cur.netUnitPrice), lastCharged: cur.date, discountPct: cur.discountPct, order: cur.order, invoice: cur.invoice, ...(accountStores.length > 1 ? { store: cur.customer } : {}) } : null,
          proposedVsAccountCurrentPct: cur ? vs(proposedEx, cur.netUnitPrice) : null,
        } : {}),
        ...(m.cost ? {} : { problem: 'No cost recorded for this product, so margin and markup cannot be worked out.' }),
        ...(proposedEx < (m.cost || 0) ? { warning: 'Proposed price is below cost.' } : {}),
        ...(rebate && afterRebateEx < (m.cost || 0) ? { warningAfterRebate: 'Below cost once the rebate is taken off.' } : {}),
      };
    });
  }).flat();

  const ok = lines.filter((l) => l.proposedPrice && l.cost);
  const totals = (key) => {
    const rows = ok.filter((l) => (key === 'rebate' ? l.netOfRebate : true));
    if (!rows.length) return null;
    const avg = (f) => r1(rows.reduce((t, l) => t + (f(l) || 0), 0) / rows.length);
    return key === 'rebate'
      ? { lines: rows.length, averageMarginPct: avg((l) => l.netOfRebate.marginPct), averageMarkupPct: avg((l) => l.netOfRebate.markupPct) }
      : { lines: rows.length, averageMarginPct: avg((l) => l.marginPct), averageMarkupPct: avg((l) => l.markupPct) };
  };
  const notes = [];
  if (Array.isArray(input?.items) && input.items.length > 60) notes.push('Only the first 60 lines were checked. Send the rest as a second list.');
  if (ws.length && !accountStores.length) notes.push('No invoices to an account matching that name in the last 12 months, so there is no current account price to compare.');
  if (ws.length && accountStores.length > 1) notes.push(`The account name matched ${accountStores.length} stores; the current price is the last one charged to any of them, and the store is named.`);
  return {
    pricesEnteredAs: includesGst ? 'including GST' : 'excluding GST',
    account: ws.length ? { searched: String(input.customer).slice(0, 80), storesMatched: accountStores.length } : null,
    rebatePct: rebateAll || null,
    basis: 'Every price is shown twice and labelled: exGst (before GST) and incGst (with 15% GST). Cost is the cost recorded today (North Odoo standard cost; South Ostendo average cost, or standard buy price if none), per the unit the item is sold in, so the proposed price must be for that same unit. Margin % = (price - cost) / price. Markup % = (price - cost) / cost. Net of rebate = the proposed price less the rebate %, with margin and markup worked out again on that. Standard price is the standard sell price today. The account current price is the net price (after its discount) on the last invoice to that account in the last 12 months.',
    summary: { linesChecked: items.length, linesWithProblems: lines.filter((l) => l.problem).length, belowCost: lines.filter((l) => l.warning).length,
      belowCostAfterRebate: lines.filter((l) => l.warningAfterRebate).length, atProposedPrice: totals('plain'), netOfRebate: rebateAll || ok.some((l) => l.netOfRebate) ? totals('rebate') : null },
    lines, notes,
  };
}

/** Tool: product_stores. Which stores bought a brand or product (any product whose code or name has every word), when they
 *  last bought it, and how many are still buying (bought within activeDays). From posted invoices. */
export async function productStores(input) {
  const pw = words(input?.product);
  if (!pw.length) throw new Error('Tell me the brand or product, for example "Chia Sisters" or "Musashi 500ml".');
  const p = period(input, 12);
  const activeDays = Math.min(365, Math.max(7, Number(input?.activeDays) || 90));
  const activeFrom = new Date(Date.parse(`${nzToday()}T00:00:00Z`) - activeDays * 86400000).toISOString().slice(0, 10);
  const ws = words(input?.customer);
  const MAX = 15000;
  // Store totals are added up inside Odoo and Ostendo (no line cap), so the counts are complete however big the brand.
  // The invoice lines (newest first, capped) only feed the per-product detail.
  const [nt, st, n, s] = await Promise.all([
    northStoreTotals(ws, p, pw).catch((e) => ({ error: String(e?.message || e).slice(0, 120) })),
    southStoreTotals(ws, p, pw).catch((e) => ({ error: String(e?.message || e).slice(0, 120) })),
    northLines(null, ws, p, MAX, pw).catch(() => ({ rows: [] })),
    southLines(null, ws, p, MAX, pw).catch(() => ({ rows: [] })),
  ]);
  const notes = [];
  const all = [];
  const productsSeen = new Map();
  for (const [system, totals, res] of [[NORTH_LABEL, nt, n], [SOUTH_LABEL, st, s]]) {
    if (totals.error) { notes.push(`${system} could not be read just now. Try again shortly.`); continue; }
    if (res.capped) notes.push(`${system}: the per-product detail covers the newest ${MAX.toLocaleString()} invoice lines only; the store counts and totals cover the whole period.`);
    const prodsByStore = new Map();
    for (const r of splitRows(res.rows).rows) {
      const pk = r.code || r.product;
      const m = prodsByStore.get(r.customer) || new Map();
      m.set(pk, (m.get(pk) || 0) + r.quantity); prodsByStore.set(r.customer, m);
      const ps = productsSeen.get(`${system}|${pk}`) || { system, code: r.code, product: r.product, stores: new Set(), units: 0 };
      ps.stores.add(r.customer); ps.units += r.quantity; productsSeen.set(`${system}|${pk}`, ps);
    }
    for (const t of totals.stores.filter((x) => !INTERCO.test(x.store))) all.push({ ...t, system, products: prodsByStore.get(t.store) || new Map() });
  }
  const list = all.map((x) => ({
    store: x.store, system: x.system, status: x.lastBought >= activeFrom ? 'buying' : 'stopped',
    firstBought: x.firstBought, lastBought: x.lastBought, units: r2(x.units), value: r2(x.value), invoices: x.invoices,
    productsBought: x.products.size || null, topProducts: [...x.products.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, u]) => ({ product: k, units: r2(u) })),
  })).sort((a, b) => (a.status === b.status ? b.value - a.value : a.status === 'buying' ? -1 : 1));
  const count = (sys, status) => list.filter((x) => (!sys || x.system === sys) && (!status || x.status === status)).length;
  if (!list.length) notes.push('No store bought a product matching every one of those words in this period. Try fewer words, or check the spelling as it appears in the product name.');
  if (list.length > 150) notes.push(`${list.length} stores matched; the 150 at the top of the list are shown (stores still buying first, biggest first). The counts include all of them.`);
  return {
    productSearched: String(input.product).slice(0, 80), customerFilter: input?.customer ? String(input.customer).slice(0, 80) : null,
    period: { from: p.from, to: p.to }, buyingMeans: `bought at least once since ${activeFrom} (the last ${activeDays} days)`,
    basis: 'Posted invoices only (credit notes left out), before GST. A product counts when its code or name contains every word given. A store is the invoice customer. "Buying" means it bought in the recent window; "stopped" means it bought earlier in the period but not since. Value is the net amount invoiced. Sales between Worthy companies are left out. This shows who we have SOLD to; it cannot see what a store has on its own shelf.',
    stores: { total: list.length, buying: count(null, 'buying'), stopped: count(null, 'stopped'),
      north: { total: count(NORTH_LABEL), buying: count(NORTH_LABEL, 'buying') }, south: { total: count(SOUTH_LABEL), buying: count(SOUTH_LABEL, 'buying') } },
    productsMatched: [...productsSeen.values()].sort((a, b) => b.units - a.units).slice(0, 40).map((x) => ({ system: x.system, code: x.code, product: x.product, stores: x.stores.size, units: r2(x.units) })),
    list: list.slice(0, 150), notes,
  };
}

/** Per store totals of every product matching the words, added up inside Odoo (company 4, posted invoices). */
async function northStoreTotals(ws, p, pw) {
  const exec = await odooExec();
  const domain = [
    ['move_id.company_id', '=', NORTH], ['move_id.state', '=', 'posted'], ['move_id.move_type', '=', 'out_invoice'],
    ['date', '>=', p.from], ['date', '<=', p.to], ['display_type', '=', 'product'], ['quantity', '>', 0], ['product_id', '!=', false],
    ...ws.flatMap((w) => ['|', ['move_id.commercial_partner_id.name', 'ilike', w], ['move_id.partner_id.name', 'ilike', w]]),
    ...pw.flatMap((w) => ['|', ['product_id.default_code', 'ilike', w], ['product_id.name', 'ilike', w]]),
  ];
  const groups = await exec('account.move.line', 'read_group', [domain, ['quantity:sum', 'price_subtotal:sum', 'last:max(date)', 'first:min(date)'], ['move_id']], { lazy: false }, 120000);
  const ids = groups.map((g) => g.move_id && g.move_id[0]).filter(Boolean);
  const partner = new Map();
  for (let i = 0; i < ids.length; i += 1000) {
    for (const m of await exec('account.move', 'read', [ids.slice(i, i + 1000)], { fields: ['partner_id'] }, 90000)) partner.set(m.id, m.partner_id ? tidy(m.partner_id[1]) : 'Unknown');
  }
  const stores = new Map();
  for (const g of groups) {
    if (!g.move_id) continue;
    const name = partner.get(g.move_id[0]) || 'Unknown';
    const x = stores.get(name) || { store: name, units: 0, value: 0, invoices: 0, firstBought: null, lastBought: null };
    x.units += Number(g.quantity) || 0; x.value += Number(g.price_subtotal) || 0; x.invoices += 1;
    const f = String(g.first || '').slice(0, 10), l = String(g.last || '').slice(0, 10);
    if (f && (!x.firstBought || f < x.firstBought)) x.firstBought = f;
    if (l && (!x.lastBought || l > x.lastBought)) x.lastBought = l;
    stores.set(name, x);
  }
  return { stores: [...stores.values()] };
}

/** Per store totals of every product matching the words, added up inside Ostendo (stock item lines, invoices only). */
async function southStoreTotals(ws, p, pw) {
  const like = ws.map((w) => ` AND UPPER(h.CUSTOMER) LIKE ${q(`%${w.toUpperCase()}%`)}`).join('');
  const which = pw.map((w) => ` AND (UPPER(l.LINECODE) LIKE ${q(`%${w.toUpperCase()}%`)} OR UPPER(l.LINEDESCRIPTION) LIKE ${q(`%${w.toUpperCase()}%`)})`).join('');
  const rows = await ostendoSql(`SELECT h.CUSTOMER AS C, MIN(h.INVOICEDATE) AS F, MAX(h.INVOICEDATE) AS L, SUM(l.INVOICEQTY) AS Q, SUM(l.EXTENDEDNETTPRICE) AS V, COUNT(DISTINCT l.INVOICENUMBER) AS N
      FROM SALESINVOICELINES l JOIN SALESINVOICEHEADER h ON h.INVOICENUMBER = l.INVOICENUMBER
      WHERE l.CODETYPE = 'Item Code' AND l.INVOICEQTY > 0 AND h.INVOICEDATE BETWEEN ${q(p.from)} AND ${q(p.to)}${like}${which}
      GROUP BY h.CUSTOMER`, 90000);
  const stores = new Map();
  for (const r of (rows || []).filter((x) => String(x.C || '').trim())) {
    const name = tidy(r.C);
    const x = stores.get(name) || { store: name, units: 0, value: 0, invoices: 0, firstBought: null, lastBought: null };
    x.units += Number(r.Q) || 0; x.value += Number(r.V) || 0; x.invoices += Number(r.N) || 0;
    const f = normaliseDate(r.F), l = normaliseDate(r.L);
    if (f && (!x.firstBought || f < x.firstBought)) x.firstBought = f;
    if (l && (!x.lastBought || l > x.lastBought)) x.lastBought = l;
    stores.set(name, x);
  }
  return { stores: [...stores.values()] };
}
