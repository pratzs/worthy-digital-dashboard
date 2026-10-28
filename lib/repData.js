/**
 * Reads ONE rep's own product and invoice rows from Odoo (North) or Ostendo (South).
 * The rep filter is built here, from the rep's fixed identity in lib/repAccess.js, and is part of
 * every query: nothing the caller types can change it, and no query is ever run without it.
 *  - North: invoice salesperson (Odoo user), found by exact name; if that does not match exactly
 *    one user the call fails closed rather than guessing.
 *  - South: the rep's Ostendo codes (a "-1" legacy code belongs to the same person).
 * Results are kept for ten minutes per rep, so follow-up questions are quick.
 */
import { unstable_cache } from 'next/cache';
import { cachedAuth } from '@/lib/odooAuth';
import { ostendoSql, nzToday, q, normaliseDate, parseIso, iso } from '@/lib/ostendo';
import { projectBestSellers, projectCustomers, projectRecent } from '@/lib/repInsights';

const NORTH = 4;
// Kept for ten minutes and shared across servers, so the warm-up on sign-in helps the first question.
const cached = (key, fn) => unstable_cache(fn, ['rep-data-v1', key], { revalidate: 600 })();

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
    history: [`${fy - 1}-04-01`, end],
  };
}
const metaFor = (w, basis) => ({
  period: { from: w.fyStart, to: w.end }, asOf: w.end, fyStart: w.fyStart, basis,
  windows: { last90Days: { from: w.l90[0], to: w.l90[1] }, previous90Days: { from: w.p90[0], to: w.p90[1] } },
});

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

async function northProducts(rep, fy) {
  const w = windows(fy);
  const exec = await odooExec();
  const ids = await northUserIds(exec, rep);
  const lines = (type, [a, b]) => exec('account.move.line', 'read_group', [[
    ['move_id.company_id', '=', NORTH], ['move_id.state', '=', 'posted'], ['move_id.move_type', '=', type],
    ['move_id.invoice_date', '>=', a], ['move_id.invoice_date', '<=', b],
    ['display_type', '=', 'product'], ['product_id', '!=', false], ['move_id.invoice_user_id', 'in', ids],
  ], ['quantity:sum', 'balance:sum'], ['product_id']], { lazy: false });
  const jobs = [['ytd', w.ytd], ['l90', w.l90], ['p90', w.p90]];
  const results = await Promise.all(jobs.map(async ([key, win]) => {
    const [inv, ref] = await Promise.all([lines('out_invoice', win), lines('out_refund', win)]);
    return [key, inv.map((r) => ({ ...r, _sign: 1 })).concat(ref.map((r) => ({ ...r, _sign: -1 })))];
  }));
  const map = new Map();
  for (const [key, rows] of results) {
    for (const r of rows) {
      const pid = r.product_id && r.product_id[0]; if (!pid) continue;
      const e = map.get(pid) || { ...splitName(r.product_id[1]), units: 0, revenue: 0, rev90: 0, prev90: 0 };
      const revenue = -(Number(r.balance) || 0);   // credit-negative in Odoo; credit notes come out negative
      if (key === 'ytd') { e.revenue += revenue; e.units += _units(r); }
      else if (key === 'l90') e.rev90 += revenue; else e.prev90 += revenue;
      map.set(pid, e);
    }
  }
  return { rows: [...map.values()], w };
}
const _units = (r) => r._sign * (Number(r.quantity) || 0);

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
      number: m.name, customer: m.partner_id[1], date: String(m.invoice_date).slice(0, 10),
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

async function southProducts(rep, fy) {
  const w = windows(fy);
  const clause = southClause(rep);
  const sql = ([a, b]) => `
    SELECT CASE WHEN l.LINECODE STARTING WITH 'ZZZ' THEN l.LINEDESCRIPTION ELSE l.LINECODE END AS CODE,
           MAX(l.LINEDESCRIPTION) AS NAME, SUM(l.INVOICEQTY) AS QTY, SUM(l.EXTENDEDNETTPRICE) AS REV
    FROM SALESINVOICELINES l JOIN SALESINVOICEHEADER h ON h.INVOICENUMBER = l.INVOICENUMBER
    WHERE h.INVOICEDATE BETWEEN ${q(a)} AND ${q(b)} AND l.CODETYPE = 'Item Code' AND ${clause}
    GROUP BY 1`;
  const [ytd, l90, p90] = await Promise.all([w.ytd, w.l90, w.p90].map((win) => ostendoSql(sql(win), 55000)));
  const map = new Map();
  const put = (rows, key) => { for (const r of rows || []) {
    const code = String(r.CODE ?? '').trim(); if (!code) continue;
    const e = map.get(code) || { code, name: String(r.NAME || code).trim(), units: 0, revenue: 0, rev90: 0, prev90: 0 };
    const rev = Number(r.REV) || 0;
    if (key === 'ytd') { e.revenue += rev; e.units += Number(r.QTY) || 0; } else if (key === 'l90') e.rev90 += rev; else e.prev90 += rev;
    map.set(code, e);
  } };
  put(ytd, 'ytd'); put(l90, 'l90'); put(p90, 'p90');
  return { rows: [...map.values()], w };
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
      return { number: String(r.NUM ?? ''), customer: String(r.C).replace(/\s+20\d{2}$/, '').trim(), date, amount: credit ? -Math.abs(nett) : nett, credit };
    }).filter(Boolean),
  };
}

// ── Public ─────────────────────────────────────────────────────────────────────────────────────
const BASIS_NORTH_PRODUCTS = 'Your own invoiced product lines (credit notes taken off), ex GST, from Odoo.';
const BASIS_SOUTH_PRODUCTS = 'Your own invoiced stock lines (credit notes taken off), ex GST, from Ostendo.';
const BASIS_INVOICES = 'Your own invoices and credit notes, ex GST (invoice totals, so a customer total can differ slightly from your product sales).';

export async function getBestSellers(rep, fy) {
  return cached(`${rep.key}|products|${fy}`, async () => {
    const { rows, w } = rep.system === 'north' ? await northProducts(rep, fy) : await southProducts(rep, fy);
    return projectBestSellers(rows, rep, metaFor(w, rep.system === 'north' ? BASIS_NORTH_PRODUCTS : BASIS_SOUTH_PRODUCTS));
  });
}

async function invoicesFor(rep, fy) {
  return cached(`${rep.key}|invoices|${fy}`, () => (rep.system === 'north' ? northInvoices(rep, fy) : southInvoices(rep, fy)));
}
export async function getCustomers(rep, fy) {
  const { rows, w } = await invoicesFor(rep, fy);
  return projectCustomers(rows, rep, metaFor(w, BASIS_INVOICES));
}
export async function getRecent(rep, fy) {
  const { rows, w } = await invoicesFor(rep, fy);
  return projectRecent(rows, rep, metaFor(w, BASIS_INVOICES));
}
