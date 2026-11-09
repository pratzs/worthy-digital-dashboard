/**
 * Customer-level sales dataset for BUSINESS DEVELOPMENT (the Marketing login, role 'marketing'): who the customers are, which
 * corporate GROUP and chain BANNER they belong to, their channel and region, and what they bought each month, from both systems.
 *
 * What it never holds: a salesperson, a rep, or a week. Monthly totals only, so a rep's or a week's revenue cannot be rebuilt from it.
 *
 * Basis (same as the rep and account figures): posted invoices less credit notes, product lines only, before GST.
 *  - North = Odoo company 4. The invoice line's partner is the commercial (head) partner, so a group such as CSB Groups 3 Ltd is one row.
 *    Banner comes from the partner's chain tags (Mobil, Caltex, Fresh Choice, BP, Four Square). Territory tags (VJ Sales / ...) are rep
 *    routes and are deliberately ignored.
 *  - South = Ostendo. Group = BILLINGCUSTOMER when it differs from the customer (Foodstuffs South Island, Night n Day, Red Circle, CSB...),
 *    banner = CUSTOMERANALYSISCODE (Fresh Choice, Mobil, Pak n Save...), channel = CUSTOMERTYPE, region = CUSTOMERREGIONCODE.
 * Intercompany and staff accounts (Worthy..., Dutch Rusk...) are flagged `internal` and left out of every ranking.
 * Kept 30 minutes and shared across servers (tag 'rep-data', so the rep warm-up refreshes it too).
 */
import { unstable_cache } from 'next/cache';
import { odooExec } from '@/lib/repData';
import { ostendoSql, nzToday, normaliseDate, iso, parseIso } from '@/lib/ostendo';

const NORTH = 4;
export const BD_TTL = 30 * 60;
const MONTHS_BACK = 36;                 // enough for this year, last year, and the year before for a full-year comparison
const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const clean = (s) => String(s ?? '').replace(/\s+20\d{2}$/, '').replace(/\s+/g, ' ').trim();
export const norm = (s) => clean(s).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();

// Our own companies and staff/test accounts: never a prospect, never a customer to rank.
const INTERNAL = /(^|\b)worthy\b|dutch rusk|price check/i;
export const isInternal = (name) => INTERNAL.test(String(name || ''));

// The same group written differently in the two systems.
const GROUP_ALIASES = [
  [/^csb group/i, 'CSB Group'],
  [/^night n day|^night and day/i, 'Night n Day Foodstores'],
  [/^foodstuffs/i, 'Foodstuffs South Island'],
];
export const groupLabel = (raw) => { const c = clean(raw); const a = GROUP_ALIASES.find(([re]) => re.test(c)); return a ? a[1] : c; };

const BANNERS = new Map([
  ['mobil', 'Mobil'], ['caltex', 'Caltex'], ['fresh choice', 'Fresh Choice'], ['bp', 'BP'], ['bp gas', 'BP'], ['four square', 'Four Square'],
  ['night and day', 'Night n Day'], ['night n day', 'Night n Day'], ['pak n save', "Pak n Save"], ['super value', 'Super Value'],
  ['mitre 10', 'Mitre 10'], ['red circle', 'Red Circle'], ['challenge', 'Challenge'], ['z', 'Z'], ['gas', 'Gas'],
]);
export const bannerLabel = (raw) => { const n = norm(raw); if (!n) return null; return BANNERS.get(n) || clean(raw); };

// North: chain banner and channel from the partner's tags. Territory, payment, source and Shopify tags are ignored on purpose.
function northTags(tagNames) {
  let banner = null, channel = null;
  for (const t of tagNames) {
    const s = String(t);
    if (/vj sales/i.test(s)) continue;                       // rep territories, not a group
    if (/mobil/i.test(s)) banner = banner || 'Mobil';
    else if (/caltex/i.test(s)) banner = banner || 'Caltex';
    else if (/fresh.?choice/i.test(s)) banner = banner || 'Fresh Choice';
    else if (/^bp\b/i.test(s)) banner = banner || 'BP';
    else if (/four.?square/i.test(s)) banner = banner || 'Four Square';
    else if (/rakesh soni/i.test(s)) banner = banner || 'Rakesh Soni shops';
    if (/liquor/i.test(s)) channel = 'Liquor store';
  }
  if (!channel && ['Mobil', 'Caltex', 'BP'].includes(banner)) channel = 'Fuel';
  return { banner, channel };
}

const monthKeyOf = (from) => String(from).slice(0, 7);
function windowStart(today) {
  const d = parseIso(today);
  d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - (MONTHS_BACK - 1));
  return iso(d);
}

async function loadNorth(from, to) {
  const exec = await odooExec();
  const lineDom = [
    ['move_id.company_id', '=', NORTH], ['move_id.state', '=', 'posted'], ['move_id.move_type', 'in', ['out_invoice', 'out_refund']],
    ['move_id.invoice_date', '>=', from], ['move_id.invoice_date', '<=', to], ['display_type', '=', 'product'], ['product_id', '!=', false],
  ];
  const moveDom = [['company_id', '=', NORTH], ['state', '=', 'posted'], ['move_type', '=', 'out_invoice']];
  const [lines, ever, stores] = await Promise.all([
    exec('account.move.line', 'read_group', [lineDom, ['balance:sum'], ['partner_id', 'date:month']], { lazy: false }, 120000),
    exec('account.move', 'read_group', [moveDom, ['first:min(invoice_date)', 'last:max(invoice_date)'], ['commercial_partner_id']], { lazy: false }, 120000),
    exec('account.move', 'read_group', [[...moveDom, ['invoice_date', '>=', iso(new Date(parseIso(to).getTime() - 365 * 86400000))]], ['id:count'], ['commercial_partner_id', 'partner_id']], { lazy: false }, 120000),
  ]);
  const ids = [...new Set(lines.filter((r) => r.partner_id).map((r) => r.partner_id[0]))];
  const [partners, cats] = await Promise.all([
    ids.length ? exec('res.partner', 'read', [ids, ['name', 'category_id', 'state_id', 'city', 'parent_id']], { context: { active_test: false } }, 120000) : [],
    exec('res.partner.category', 'search_read', [[]], { fields: ['display_name'], context: { active_test: false } }, 60000),
  ]);
  const catName = new Map(cats.map((c) => [c.id, c.display_name]));
  const pById = new Map(partners.map((p) => [p.id, p]));
  const everBy = new Map(ever.filter((r) => r.commercial_partner_id).map((r) => [r.commercial_partner_id[0], { first: String(r.first || '').slice(0, 10) || null, last: String(r.last || '').slice(0, 10) || null }]));
  const storeSet = new Map();
  for (const r of stores) if (r.commercial_partner_id && r.partner_id) { const k = r.commercial_partner_id[0]; if (!storeSet.has(k)) storeSet.set(k, new Set()); storeSet.get(k).add(r.partner_id[0]); }
  const byPartner = new Map();
  for (const r of lines) {
    if (!r.partner_id) continue;
    const id = r.partner_id[0], from_ = r.__range?.['date:month']?.from; if (!from_) continue;
    const row = byPartner.get(id) || { id, display: r.partner_id[1], months: {} };
    const k = monthKeyOf(from_);
    row.months[k] = r2((row.months[k] || 0) - (Number(r.balance) || 0));
    byPartner.set(id, row);
  }
  const out = [];
  for (const [id, row] of byPartner) {
    const p = pById.get(id);
    // The display name (as on invoices and the dashboard) carries the parent for a contact, so an internal contact is not missed.
    const name = clean(row.display || (p ? p.name : `Customer ${id}`));
    const tags = (p?.category_id || []).map((c) => catName.get(c)).filter(Boolean);
    const { banner, channel } = northTags(tags);
    const e = everBy.get(id) || {};
    out.push({
      system: 'North', account: name, group: groupLabel(name), banner, channel: channel || null,
      region: p?.state_id ? p.state_id[1].replace(/\s*\(.*\)$/, '') : (p?.city || null), city: p?.city || null,
      created: null, firstInvoice: e.first || null, lastInvoice: e.last || null,
      stores: storeSet.get(id)?.size || 1, months: row.months, internal: isInternal(name),
    });
  }
  return out;
}

async function loadSouth(from, to) {
  const [lines, cust, ever] = await Promise.all([
    ostendoSql(`SELECT h.CUSTOMER AS C, EXTRACT(YEAR FROM h.INVOICEDATE) AS Y, EXTRACT(MONTH FROM h.INVOICEDATE) AS M, SUM(l.EXTENDEDNETTPRICE) AS REV
      FROM SALESINVOICELINES l JOIN SALESINVOICEHEADER h ON h.INVOICENUMBER = l.INVOICENUMBER
      WHERE h.INVOICEDATE BETWEEN '${from}' AND '${to}' AND l.CODETYPE = 'Item Code' GROUP BY 1, 2, 3`, 120000),
    ostendoSql(`SELECT CUSTOMER AS C, BILLINGCUSTOMER AS B, CUSTOMERANALYSISCODE AS A, CUSTOMERTYPE AS T, CUSTOMERREGIONCODE AS R, CUSTOMERCITY AS CITY, SYSDATECREATED AS CRE FROM CUSTOMERMASTER`, 120000),
    ostendoSql(`SELECT h.CUSTOMER AS C, MIN(h.INVOICEDATE) AS F, MAX(h.INVOICEDATE) AS L FROM SALESINVOICEHEADER h WHERE h.INVOICEORCREDIT <> 'Credit' GROUP BY 1`, 120000),
  ]);
  const cBy = new Map((cust || []).map((r) => [String(r.C).trim(), r]));
  const eBy = new Map((ever || []).map((r) => [String(r.C).trim(), { first: normaliseDate(r.F), last: normaliseDate(r.L) }]));
  const byC = new Map();
  for (const r of lines || []) {
    const c = String(r.C ?? '').trim(); if (!c) continue;
    const row = byC.get(c) || { c, months: {} };
    const k = `${Number(r.Y)}-${String(Number(r.M)).padStart(2, '0')}`;
    row.months[k] = r2((row.months[k] || 0) + (Number(r.REV) || 0));
    byC.set(c, row);
  }
  const out = [];
  for (const [c, row] of byC) {
    const m = cBy.get(c) || {};
    const billing = String(m.B ?? '').trim();
    const group = billing && billing !== c ? billing : c;
    const e = eBy.get(c) || {};
    out.push({
      system: 'South', account: clean(c), group: groupLabel(group), banner: bannerLabel(m.A), channel: String(m.T ?? '').trim() || null,
      region: String(m.R ?? '').trim() || null, city: String(m.CITY ?? '').trim() || null,
      created: normaliseDate(m.CRE) || null, firstInvoice: e.first || null, lastInvoice: e.last || null,
      stores: 1, months: row.months, internal: isInternal(c) || isInternal(group),
    });
  }
  return out;
}

async function build() {
  const today = nzToday(), from = windowStart(today);
  const [north, south] = await Promise.all([loadNorth(from, today), loadSouth(from, today).catch((e) => { console.error(JSON.stringify({ evt: 'bd_south_error', why: String(e?.message).slice(0, 200) })); return null; })]);
  return { builtAt: new Date().toISOString(), today, from, north, south };
}

export const BD_TAG = 'rep-data';
const stored = unstable_cache(async (day) => build(), ['bd-data-v4'], { revalidate: BD_TTL, tags: [BD_TAG] });
/** The cached dataset (rebuilt at most every 30 minutes). */
export const bdDataset = () => stored(nzToday());

// ── helpers the tools share ───────────────────────────────────────────────────────────────────────
export const monthsOfFy = (fy, today) => {
  const out = []; const end = today.slice(0, 7);
  for (let i = 0; i < 12; i++) {
    const d = new Date(Date.UTC(fy, 3 + i, 1)); const k = d.toISOString().slice(0, 7);
    if (k <= end) out.push(k);
  }
  return out;
};
export const lastNMonths = (n, today) => {
  const out = []; const d = parseIso(today); d.setUTCDate(1);
  for (let i = n - 1; i >= 0; i--) { const x = new Date(d); x.setUTCMonth(x.getUTCMonth() - i); out.push(x.toISOString().slice(0, 7)); }
  return out;
};
export const shiftMonths = (keys, by) => keys.map((k) => { const [y, m] = k.split('-').map(Number); return new Date(Date.UTC(y, m - 1 + by, 1)).toISOString().slice(0, 7); });
export const sumMonths = (row, keys) => r2(keys.reduce((s, k) => s + (row.months[k] || 0), 0));
export const daysSince = (date, today) => (date ? Math.floor((parseIso(today) - parseIso(date)) / 86400000) : null);
export const statusOf = (lastInvoice, today) => {
  const d = daysSince(lastInvoice, today);
  if (d === null) return 'No invoices';
  return d <= 45 ? 'Active' : d <= 90 ? 'At risk (45-90 days quiet)' : 'Lapsed (over 90 days quiet)';
};
/** External rows only (no intercompany or staff accounts), from the systems that loaded. */
export const externalRows = (ds) => [...(ds.north || []), ...(ds.south || [])].filter((r) => !r.internal);
