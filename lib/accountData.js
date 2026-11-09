/**
 * Sales for NAMED CUSTOMER ACCOUNTS, for the Marketing login (lib/repTools.js, role 'marketing').
 *
 * What this is for: "how much has CSB / Fresh Choice / Mobil bought", which stores, which products, month by month.
 * What it deliberately is NOT: nothing here reads or returns a salesperson, a rep, or a week. The queries never select the
 * salesperson columns, the output is built field by field, and `guardMarketing` fails closed if a rep or weekly key ever appears.
 *
 * Basis (same as the rep figures): posted invoices less credit notes, product lines only, before GST.
 *  - North = Odoo company 4 (Worthy Products North). South = Ostendo (Dutch Rusk), stock item lines.
 * A name matches an account when EVERY word of it appears in the customer name, so "CSB" returns every CSB / Caltex store
 * and "Fresh Choice Flat Bush" returns one store. Accounts are summed and also listed store by store.
 */
import { odooExec } from '@/lib/repData';
import { ostendoSql, q, nzToday, nzFinancialYear, normaliseDate } from '@/lib/ostendo';

const NORTH = 4;
const MAX_ACCOUNTS_SHOWN = 30;
const MAX_PRODUCTS_SHOWN = 20;
const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const tidy = (n) => String(n ?? '').replace(/\s+20\d{2}$/, '').trim();
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s)) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

export const words = (query) => String(query || '').toLowerCase().replace(/[^a-z0-9&' ]+/g, ' ').split(/\s+/).filter((w) => w.length >= 2).slice(0, 5);

function periodFrom(input) {
  const hasFrom = input?.from !== undefined && input?.from !== '', hasTo = input?.to !== undefined && input?.to !== '';
  if (hasFrom || hasTo) {
    if (!isDate(input.from) || !isDate(input.to)) throw new Error('Dates must be given as YYYY-MM-DD, both from and to.');
    if (input.from > input.to) throw new Error('Dates must run forward: from must not be after to.');
    if ((Date.parse(input.to) - Date.parse(input.from)) / 86400000 > 366 * 5) throw new Error('Dates must cover 5 years or less.');
    return { from: input.from, to: input.to };
  }
  const fy = input?.fy === undefined || input?.fy === null || input?.fy === '' ? nzFinancialYear() : Number(input.fy);
  if (!Number.isInteger(fy) || fy < 2020 || fy > 2100) throw new Error('fy must be a financial year such as 2026.');
  const today = nzToday(), end = `${fy + 1}-03-31`;
  return { from: `${fy}-04-01`, to: today < end ? today : end, fy };
}

const splitName = (display) => {
  const m = /^\[([^\]]+)\]\s*(.*)$/.exec(String(display || ''));
  return m ? { code: m[1], name: m[2] || m[1] } : { code: null, name: String(display || '') };
};

// ── North (Odoo) ───────────────────────────────────────────────────────────────────────────────
async function north(ws, p) {
  const exec = await odooExec();
  const base = (types) => [
    ['move_id.company_id', '=', NORTH], ['move_id.state', '=', 'posted'], ['move_id.move_type', 'in', types],
    ['move_id.invoice_date', '>=', p.from], ['move_id.invoice_date', '<=', p.to],
    ['display_type', '=', 'product'], ['product_id', '!=', false],
    ...ws.flatMap((w) => ['|', ['move_id.commercial_partner_id.name', 'ilike', w], ['move_id.partner_id.name', 'ilike', w]]),
  ];
  const both = base(['out_invoice', 'out_refund']);
  const [byAccount, byMonth, prodInv, prodRef] = await Promise.all([
    // Stores as the dashboard's customer list has them: the invoice's own customer (a store is often a contact under the group).
    exec('account.move', 'read_group', [[
      ['company_id', '=', NORTH], ['state', '=', 'posted'], ['move_type', 'in', ['out_invoice', 'out_refund']],
      ['invoice_date', '>=', p.from], ['invoice_date', '<=', p.to],
      ...ws.flatMap((w) => ['|', ['commercial_partner_id.name', 'ilike', w], ['partner_id.name', 'ilike', w]]),
    ], ['amount_untaxed_signed:sum', 'invoice_date:max'], ['partner_id']], { lazy: false, limit: 500 }, 90000),
    exec('account.move.line', 'read_group', [both, ['balance:sum'], ['date:month']], { lazy: false }, 90000),
    exec('account.move.line', 'read_group', [base(['out_invoice']), ['quantity:sum', 'balance:sum'], ['product_id']], { lazy: false, limit: 500 }, 90000),
    exec('account.move.line', 'read_group', [base(['out_refund']), ['quantity:sum', 'balance:sum'], ['product_id']], { lazy: false, limit: 500 }, 90000)
  ]);
  const accounts = byAccount.filter((r) => r.partner_id).map((r) => ({
    account: tidy(r.partner_id[1]), revenue: r2(Number(r.amount_untaxed_signed) || 0), lastInvoice: String(r.invoice_date || '').slice(0, 10) || null,
  }));
  const months = byMonth.map((r) => {
    const from = r.__range?.['date:month']?.from;
    return from ? { month: String(from).slice(0, 7), revenue: r2(-(Number(r.balance) || 0)) } : null;
  }).filter(Boolean);
  const prod = new Map();
  for (const [list, sign] of [[prodInv, 1], [prodRef, -1]]) {
    for (const r of list) {
      if (!r.product_id) continue;
      const k = r.product_id[0];
      const cur = prod.get(k) || { ...splitName(r.product_id[1]), units: 0, revenue: 0 };
      cur.units += sign * (Number(r.quantity) || 0); cur.revenue += -(Number(r.balance) || 0);
      prod.set(k, cur);
    }
  }
  return {
    accounts, months,
    products: [...prod.values()].map((x) => ({ code: x.code, product: x.name, units: r2(x.units), revenue: r2(x.revenue) })),
    capped: byAccount.length >= 500,
  };
}

// ── South (Ostendo) ────────────────────────────────────────────────────────────────────────────
const STOCK_LINE = "l.CODETYPE = 'Item Code'";
const PRODUCT_KEY = "CASE WHEN l.LINECODE STARTING WITH 'ZZZ' THEN l.LINEDESCRIPTION ELSE l.LINECODE END";

async function south(ws, p) {
  const like = ws.map((w) => `UPPER(h.CUSTOMER) LIKE ${q(`%${w.toUpperCase()}%`)}`).join(' AND ');
  const where = `h.INVOICEDATE BETWEEN ${q(p.from)} AND ${q(p.to)} AND ${STOCK_LINE} AND ${like}`;
  const from = 'FROM SALESINVOICELINES l JOIN SALESINVOICEHEADER h ON h.INVOICENUMBER = l.INVOICENUMBER';
  const [acc, prod] = await Promise.all([
    ostendoSql(`SELECT h.CUSTOMER AS C, EXTRACT(YEAR FROM h.INVOICEDATE) AS Y, EXTRACT(MONTH FROM h.INVOICEDATE) AS M,
        SUM(l.EXTENDEDNETTPRICE) AS REV, MAX(h.INVOICEDATE) AS LASTD ${from} WHERE ${where} GROUP BY 1, 2, 3`, 80000),
    ostendoSql(`SELECT ${PRODUCT_KEY} AS CODE, MAX(l.LINEDESCRIPTION) AS NAME, SUM(l.INVOICEQTY) AS QTY, SUM(l.EXTENDEDNETTPRICE) AS REV ${from} WHERE ${where} GROUP BY 1`, 80000),
  ]);
  const accounts = new Map(), months = new Map();
  for (const r of acc || []) {
    if (!r.C) continue;
    const name = tidy(r.C), rev = Number(r.REV) || 0;
    const a = accounts.get(name) || { account: name, revenue: 0, lastInvoice: null };
    a.revenue += rev;
    const d = normaliseDate(r.LASTD);
    if (d && (!a.lastInvoice || d > a.lastInvoice)) a.lastInvoice = d;
    accounts.set(name, a);
    const key = `${Number(r.Y)}-${String(Number(r.M)).padStart(2, '0')}`;
    months.set(key, (months.get(key) || 0) + rev);
  }
  return {
    accounts: [...accounts.values()].map((a) => ({ ...a, revenue: r2(a.revenue) })),
    months: [...months.entries()].map(([month, revenue]) => ({ month, revenue: r2(revenue) })),
    products: (prod || []).filter((r) => String(r.CODE ?? '').trim()).map((r) => ({
      code: String(r.CODE).trim(), product: String(r.NAME || r.CODE).trim(), units: r2(r.QTY), revenue: r2(r.REV) })),
    capped: false,
  };
}

const withAvg = (x, system) => ({ system, code: x.code, product: x.product, units: x.units, revenue: x.revenue, averagePricePerUnit: x.units > 0 ? r2(x.revenue / x.units) : null });

/** Sales for the named account(s): monthly (never weekly), by store, top products. No salesperson anywhere. */
export async function accountSales(input) {
  const ws = words(input?.name);
  if (!ws.length) throw new Error('Tell me which account, for example "CSB" or "Fresh Choice Flat Bush".');
  const p = periodFrom(input);
  const [n, s] = await Promise.all([north(ws, p), south(ws, p).catch((e) => { console.error(JSON.stringify({ evt: 'account_south_error', why: String(e?.message).slice(0, 200) })); return null; })]);
  const accounts = [
    ...n.accounts.map((a) => ({ ...a, system: 'Worthy Products North' })),
    ...(s ? s.accounts.map((a) => ({ ...a, system: 'Worthy Products South (Dutch Rusk)' })) : []),
  ].sort((a, b) => b.revenue - a.revenue);
  const monthMap = new Map();
  for (const m of [...n.months, ...(s ? s.months : [])]) monthMap.set(m.month, (monthMap.get(m.month) || 0) + m.revenue);
  const northRevenue = r2(n.months.reduce((t, m) => t + m.revenue, 0));
  const southRevenue = s ? r2(s.accounts.reduce((t, a) => t + a.revenue, 0)) : 0;
  const total = r2(northRevenue + southRevenue);
  const byMonth = [...monthMap.entries()].sort().map(([month, revenue]) => ({ month, revenue: r2(revenue) }));
  const products = [...n.products.map((x) => withAvg(x, 'Worthy Products North')), ...(s ? s.products.map((x) => withAvg(x, 'Worthy Products South (Dutch Rusk)')) : [])]
    .sort((a, b) => b.revenue - a.revenue);
  const notes = [];
  if (n.accounts.length) notes.push('North store figures are invoice totals, as on the dashboard customer list, so a store total can differ slightly from the product-sales total (for example by discount lines). The headline total and the months are product sales.');
  if (!accounts.length) notes.push('No customer account matched every word of that name with sales in this period. Try fewer or different words, or a wider period.');
  if (s === null) notes.push('Worthy Products South could not be read just now, so this covers North only. Try again shortly.');
  if (n.capped) notes.push('More than 500 accounts matched, so some are missing. Use a more specific name.');
  if (accounts.length > MAX_ACCOUNTS_SHOWN) notes.push(`${accounts.length} accounts matched; the biggest ${MAX_ACCOUNTS_SHOWN} are listed. Totals include all of them.`);
  return {
    searched: String(input.name).slice(0, 80),
    period: { from: p.from, to: p.to, ...(p.fy ? { financialYear: p.fy } : {}) },
    basis: 'Posted invoices less credit notes, product lines only, before GST. North is Worthy Products North (Odoo); South is Dutch Rusk (Ostendo). Worthy Oceania is not included. Months are shown, not weeks, and no salesperson figures exist in this view.',
    accountsMatched: accounts.length,
    total: { revenue: total },
    bySystem: [
      { system: 'Worthy Products North', accounts: n.accounts.length, revenue: northRevenue },
      ...(s ? [{ system: 'Worthy Products South (Dutch Rusk)', accounts: s.accounts.length, revenue: southRevenue }] : []),
    ],
    byMonth,
    accounts: accounts.slice(0, MAX_ACCOUNTS_SHOWN),
    topProducts: products.slice(0, MAX_PRODUCTS_SHOWN),
    notes,
  };
}
