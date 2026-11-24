/**
 * get_sales_summary: the ONE answer to "how much did X sell / what margin" for any period, for the management chat and
 * connector. Every business is read the same way the dashboard reads it, so the chat can never disagree with the page:
 *
 *   Worthy Products / Worthy Products North / North / WP  -> Odoo company 4 (lib/salesBasis.js, which the dashboard matches)
 *   Dutch Rusk / Worthy Products South / South / DR       -> Ostendo (the dashboard's South figures)
 *   Worthy Oceania / Oceania / fabric / textiles           -> Odoo company 1 (the dashboard's Oceania figures)
 *
 * Sales are posted invoices less credit notes, before GST. For Worthy Products, sales to Dutch Rusk and Worthy Oceania
 * are shown separately and never inside the figure (docs/SALES-BASIS.md).
 */
import { wpSales } from '@/lib/salesBasis';
import { readFY } from '@/lib/odooFyCache';
import { handle as ostendoFyHandle } from '@/lib/ostendoFy';
import { nzToday, nzFinancialYear } from '@/lib/ostendo';

/** Plain words -> which business. Tolerant of spelling, spacing and the many names people use. */
export function resolveBusinesses(text) {
  const t = ` ${String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;
  if (!t.trim() || /\b(all|every|everything|group|whole|total|combined|all three|each)\b/.test(t)) return ['north', 'south', 'oceania'];
  const out = new Set();
  if (/\b(dutch ?rusk|dutchrusk|dr|south|southern|ostendo|wps|worthy products? south|christchurch|south island)\b/.test(t)) out.add('south');
  if (/\b(oceania|ocean|fabric|fabrics|textile|textiles|company 1|fashion)\b/.test(t)) out.add('oceania');
  // "Worthy Products" (without South), North, Odoo, WP, company 4, or just "Worthy" -> Odoo company 4.
  const stripped = t.replace(/worthy products? south/g, ' ').replace(/worthy oceania/g, ' ');
  if (/\b(north|northern|wp|wpn|company 4|auckland|worthy products?|worthy)\b/.test(stripped) || /\bodoo\b/.test(t) && !out.has('oceania')) out.add('north');
  return out.size ? [...out] : ['north'];
}

export const BUSINESS_LABEL = {
  north: 'Worthy Products (Worthy Products North, Odoo company 4)',
  south: 'Dutch Rusk (Worthy Products South, Ostendo)',
  oceania: 'Worthy Oceania (Odoo company 1)',
};

const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const fyOf = (iso) => (Number(iso.slice(5, 7)) >= 4 ? Number(iso.slice(0, 4)) : Number(iso.slice(0, 4)) - 1);

/** "last week", "this month", "last financial year" ... -> NZ dates. Weeks run Monday to Sunday. */
export function periodFor(input) {
  if (input?.from && input?.to) return { from: input.from, to: input.to };
  const today = nzToday();
  const dow = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;   // 0 = Monday
  const p = String(input?.period || 'this financial year').toLowerCase();
  const monday = addDays(today, -dow);
  if (/last week|previous week/.test(p)) return { from: addDays(monday, -7), to: addDays(monday, -1) };
  if (/this week|week to date|wtd/.test(p)) return { from: monday, to: today };
  const m1 = `${today.slice(0, 7)}-01`;
  if (/last month|previous month/.test(p)) { const e = addDays(m1, -1); return { from: `${e.slice(0, 7)}-01`, to: e }; }
  if (/this month|month to date|mtd/.test(p)) return { from: m1, to: today };
  const fy = nzFinancialYear();
  if (/last (fy|financial year|year)|previous (fy|financial year)/.test(p)) return { from: `${fy - 1}-04-01`, to: `${fy}-03-31` };
  if (/yesterday/.test(p)) return { from: addDays(today, -1), to: addDays(today, -1) };
  if (/today/.test(p)) return { from: today, to: today };
  return { from: `${fy}-04-01`, to: today };
}

/** The dashboard's own rows (weeks, months, year) that make up the period, for Dutch Rusk and Worthy Oceania. */
async function dashboardRows(business, from, to) {
  const fy = fyOf(from);
  if (fyOf(to) !== fy) throw new Error('For Dutch Rusk and Worthy Oceania ask within one financial year (1 April to 31 March) at a time.');
  const payload = business === 'south'
    ? await (await ostendoFyHandle(new Request(`http://internal/south-fy?fy=${fy}`))).json()
    : (await readFY(1, fy)).payload;
  if (payload?.error) throw new Error(`${BUSINESS_LABEL[business]} could not be read just now.`);
  const pick = (r) => ({ from: r.start || (r.key ? `${r.key}-01` : null), to: r.end || r.through || null, sales: r.revenue, cost: r.cost ?? null,
    grossProfit: r.grossProfit ?? null, marginPct: r.marginPct ?? null, invoices: r.invoices, creditNotes: r.credits });
  const week = (payload.weeks || []).find((w) => w.start === from && w.end === to);
  if (week) return { exact: true, rows: [{ label: week.label, ...pick(week) }] };
  const months = (payload.months || []).filter((m) => m.started && `${m.key}-01` >= from && (m.through || '') <= to);
  const covered = months.length && `${months[0].key}-01` === from && (months[months.length - 1].through === to);
  if (from === payload.range?.start && to >= (payload.range?.end || to)) {
    return { exact: true, rows: [{ label: `FY${String(fy).slice(2)} to date`, from, to: payload.range.end, sales: payload.totals?.revenue, cost: payload.totals?.cost ?? null,
      grossProfit: payload.totals?.grossProfit ?? null, marginPct: payload.totals?.marginPct ?? null }] };
  }
  if (covered) {
    const sum = (f) => months.reduce((t, m) => t + (Number(m[f]) || 0), 0);
    const sales = sum('revenue'), cost = months.every((m) => m.cost != null) ? sum('cost') : null;
    return { exact: true, rows: [{ label: months.map((m) => m.label).join(' + '), from, to, sales: Math.round(sales * 100) / 100,
      cost: cost == null ? null : Math.round(cost * 100) / 100, marginPct: months.length === 1 ? months[0].marginPct : null }] };
  }
  const weeks = (payload.weeks || []).filter((w) => w.end >= from && w.start <= to);
  return { exact: false, rows: weeks.map((w) => ({ label: w.label, ...pick(w) })),
    note: 'That period is not a whole week (Monday to Sunday), month or financial year, so the dashboard weeks that overlap it are listed instead.' };
}

export async function salesSummary(input) {
  const businesses = resolveBusinesses(input?.business);
  const { from, to } = periodFor(input);
  const out = { period: { from, to }, understoodAs: businesses.map((b) => BUSINESS_LABEL[b]) };
  for (const b of businesses) {
    try {
      if (b === 'north') out.worthyProducts = await wpSales(from, to > nzToday() ? nzToday() : to);
      else out[b === 'south' ? 'dutchRusk' : 'worthyOceania'] = await dashboardRows(b, from, to);
    } catch (e) { out[b === 'north' ? 'worthyProducts' : b === 'south' ? 'dutchRusk' : 'worthyOceania'] = { error: String(e.message || e).slice(0, 200) }; }
  }
  out.basis = 'Posted invoices less credit notes, before GST, the same figures as the dashboard and the Sunday email. Worthy Products = Odoo company 4 only: product sales, other invoiced lines (freight recharged etc.) shown separately, margin on the cost Odoo booked on each invoice, and sales to Dutch Rusk and Worthy Oceania shown separately, never inside Worthy Products. Dutch Rusk = Ostendo. Worthy Oceania = Odoo company 1. Never add the businesses together without saying so.';
  return out;
}
