/**
 * Figures for the public Sell With Us form on worthy.nz (27 Nov 2026).
 *
 * Counts only: no customer names, no amounts. Read at most once a day (the route keeps a shared
 * last good copy), so it never adds load to Odoo or Ostendo for visitors.
 *
 * Window: the last 12 months to today (NZ), posted customer invoices only.
 *   North = Worthy Products, Odoo company 4.   South = Dutch Rusk, Ostendo.   Fabrics = Worthy Oceania, Odoo company 1.
 * Store types are matched on Odoo tags and on the store name, so they are minimums.
 * Own companies, staff accounts and cash sales are left out.
 */
import { cachedAuth } from '@/lib/odooAuth';
import { ostendoSql } from '@/lib/ostendo';

const INTERNAL = /worthy|v ?j trading|dutch rusk|cash sale|price check|\bstaff account\b/i;
const TYPES = {
  fuel: { tags: ['caltex', 'bp gas', 'mobil new', 'mobil existing', 'mobil/mobil mercer'], name: /caltex|\bbp\b|mobil|gull|z energy|waitomo|\bnpd\b|challenge|service station|allied petroleum/i },
  dairy: { tags: [], name: /dairy|dairies|superette/i },
  grocer: { tags: ['fresh-choice', 'four-square', 'metromart', 'farro'], name: /supermarket|fresh ?choice|four square|super ?value|new world|pak ?n ?save|metro ?mart|countdown|woolworths/i },
  convenience: { tags: [], name: /convenience|\bmart\b|mini ?mart|night ?n ?day|on the spot|\bexpress\b/i },
};
const PACIFIC = ['Samoa', 'American Samoa', 'Fiji', 'Tonga', 'Cook Islands', 'French Polynesia', 'New Caledonia', 'Solomon Islands', 'Vanuatu', 'Kiribati', 'Marshall Islands', 'Nauru', 'Wallis and Futuna', 'Papua New Guinea', 'Niue', 'Tuvalu', 'Tokelau', 'Palau', 'Micronesia'];

function nzDate(d) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
export function window12(now = new Date()) {
  const to = nzDate(now);
  const y = Number(to.slice(0, 4)) - 1;
  const from = `${y}${to.slice(4)}`;
  return { from, to };
}

async function rpc(payload, timeoutMs) {
  const res = await fetch(`${process.env.ODOO_URL}/jsonrpc`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload), signal: AbortSignal.timeout(timeoutMs),
  });
  return res.json();
}
async function odoo() {
  const { ODOO_DB: db, ODOO_USER: user, ODOO_PASSWORD: pw } = process.env;
  const auth = await cachedAuth(() => rpc({ jsonrpc: '2.0', method: 'call', id: 1,
    params: { service: 'common', method: 'authenticate', args: [db, user, pw, {}] } }, 15000),
    process.env.ODOO_URL, db, user);
  if (!auth.result) throw new Error('Odoo authentication failed');
  return async (model, method, args, kwargs = {}) => {
    const r = await rpc({ jsonrpc: '2.0', method: 'call', id: 2,
      params: { service: 'object', method: 'execute_kw', args: [db, auth.result, pw, model, method, args, kwargs] } }, 55000);
    if (r.error) throw new Error(r.error.data?.message || r.error.message);
    return r.result;
  };
}

/** Customers invoiced by one Odoo company in the window, grouped by a partner field. */
async function invoicedPartners(call, cid, field, { from, to }) {
  const ctx = { allowed_company_ids: [cid], company_id: cid, lang: 'en_AU' };
  const groups = await call('account.move', 'read_group',
    [[['company_id', '=', cid], ['move_type', '=', 'out_invoice'], ['state', '=', 'posted'],
      ['invoice_date', '>=', from], ['invoice_date', '<=', to]], [field], [field]],
    { lazy: true, context: ctx });
  return groups.filter((g) => g[field]).map((g) => g[field][0]);
}

async function north(call, win) {
  const ctx = { allowed_company_ids: [4], company_id: 4, lang: 'en_AU' };
  const ids = await invoicedPartners(call, 4, 'partner_id', win);
  const parts = ids.length ? await call('res.partner', 'read', [ids], { fields: ['name', 'category_id'], context: ctx }) : [];
  const tagIds = [...new Set(parts.flatMap((p) => p.category_id || []))];
  const tagRows = tagIds.length ? await call('res.partner.category', 'read', [tagIds], { fields: ['name'], context: ctx }) : [];
  const tagName = new Map(tagRows.map((t) => [t.id, String(t.name || '').toLowerCase()]));
  const real = parts.filter((p) => !INTERNAL.test(p.name || ''));
  const out = { stores: real.length };
  for (const [k, rule] of Object.entries(TYPES)) {
    out[k] = real.filter((p) => (p.category_id || []).some((t) => rule.tags.includes(tagName.get(t))) || rule.name.test(p.name || '')).length;
  }
  return out;
}

async function south(win) {
  const rows = await ostendoSql(`
    SELECT DISTINCT DELIVERYCUSTOMER, CUSTOMER FROM SALESINVOICEHEADER
    WHERE INVOICEORCREDIT = 'Invoice' AND INVOICEDATE >= '${win.from}' AND INVOICEDATE <= '${win.to}'`);
  // The same store can carry a year suffix (Caltex Redwood / Caltex Redwood 2026): count it once.
  const names = new Set();
  for (const r of rows || []) {
    const n = String(r.DELIVERYCUSTOMER || r.CUSTOMER || '').trim();
    if (!n || INTERNAL.test(n) || / - dutch rusk$|^dutch rusk - /i.test(n)) continue;
    names.add(n.replace(/\s*\b(19|20)\d{2}\b\s*$/, '').toLowerCase());
  }
  const list = [...names];
  const out = { stores: list.length };
  for (const [k, rule] of Object.entries(TYPES)) out[k] = list.filter((n) => rule.name.test(n)).length;
  return out;
}

async function fabrics(call, win) {
  const ctx = { allowed_company_ids: [1], company_id: 1, lang: 'en_AU' };
  // Which countries we already serve looks back 24 months, so a nation that orders once a year is not dropped.
  const win24 = { from: `${Number(win.from.slice(0, 4)) - 1}${win.from.slice(4)}`, to: win.to };
  const ids = await invoicedPartners(call, 1, 'partner_shipping_id', win24);
  const parts = ids.length ? await call('res.partner', 'read', [ids], { fields: ['name', 'country_id'], context: ctx }) : [];
  const byCountry = {};
  for (const p of parts) {
    if (INTERNAL.test(p.name || '') || !p.country_id) continue;
    const c = p.country_id[1];
    byCountry[c] = (byCountry[c] || 0) + 1;
  }
  const lines = await call('account.move.line', 'read_group',
    [[['company_id', '=', 1], ['move_id.move_type', '=', 'out_invoice'], ['move_id.state', '=', 'posted'],
      ['move_id.invoice_date', '>=', win.from], ['move_id.invoice_date', '<=', win.to], ['display_type', '=', 'product']],
      ['quantity:sum'], ['product_uom_id']],
    { lazy: true, context: ctx });
  let metres = 0;
  for (const g of lines) {
    const u = String(g.product_uom_id?.[1] || '').toUpperCase();
    if (u === 'MTR' || u === 'M' || u === 'METRE' || u === 'METRES') metres += Number(g.quantity) || 0;
    if (u === 'YDS' || u === 'YD' || u === 'YARD' || u === 'YARDS') metres += (Number(g.quantity) || 0) * 0.9144;
  }
  const pacific = {};
  for (const n of PACIFIC) if (byCountry[n]) pacific[n] = byCountry[n];
  return { metres: Math.round(metres), australia: byCountry.Australia || 0, pacific };
}

/** Round down for display: 2,307 -> 2,300; 268 -> 260; 87 -> 80; 11 -> 10; 7 -> 7. */
export function floorNice(n) {
  const v = Math.max(0, Math.floor(Number(n) || 0));
  if (v >= 1000) return Math.floor(v / 100) * 100;
  if (v >= 10) return Math.floor(v / 10) * 10;
  return v;
}
const fmt = (n) => n.toLocaleString('en-NZ');
const SHOW_MIN = 100;

export async function computeSellWithUsStats(now = new Date()) {
  const win = window12(now);
  const call = await odoo();
  const [n, s, f] = await Promise.all([north(call, win), south(win), fabrics(call, win)]);
  const both = {};
  for (const k of ['stores', ...Object.keys(TYPES)]) both[k] = (n[k] || 0) + (s[k] || 0);
  // Only figures that are worth showing go out (Pratham, 27 Nov: small numbers undersell us). Anything under the
  // threshold is left out and the form uses its wording without a number. As figures grow they appear by themselves.
  const shown = {};
  for (const [k, v] of Object.entries(both)) if (v >= SHOW_MIN) shown[k] = `${fmt(floorNice(v))}+`;
  if (f.metres >= 100000) shown.metres = f.metres >= 1e6 ? `${(Math.floor(f.metres / 1e5) / 10).toFixed(1)} million` : `${fmt(Math.floor(f.metres / 10000) * 10000)}`;
  return {
    ok: true,
    window: win,
    shown,
    // Nations and Australia: served or not, never a small count.
    served: { australia: f.australia > 0, pacific: Object.keys(f.pacific) },
    counts: { north: n, south: s, both, australia: f.australia, metres: f.metres, pacific: f.pacific },
    basis: 'Distinct customers with posted invoices in the window. North: Worthy Products (Odoo). South: Dutch Rusk (Ostendo). Fabrics: Worthy Oceania (Odoo), 12 months. Australia and Pacific nations served: Worthy Oceania customers in the last 24 months. Store types matched on tags and names, so they are minimums. Own companies, staff and cash sales excluded.',
    generatedAt: new Date().toISOString(),
  };
}
