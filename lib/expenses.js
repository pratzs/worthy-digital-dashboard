/**
 * Staff expense claims from Odoo (hr.expense), for the MANAGEMENT connector and management chat only
 * (lib/mcpTools.js get_expenses). It is not part of the rep or marketing logins.
 *
 * Read only. Amounts are in NZD (the company currency, total_amount_company) and include GST as claimed; the GST part and
 * the figure without GST are both returned. Refused claims are left out unless asked for.
 *
 * Totals are worked out INSIDE Odoo (read_group), so they are exact however many claims match (this business has well over a
 * thousand a year); only the optional list of individual claim lines is capped. Every breakdown is a separate grouping of the
 * same filter, so they all add to the total.
 *
 * COMPLETENESS DEPENDS ON THE ODOO LOGIN: Odoo only shows a login the claims its expenses access allows. The dashboard's login
 * must be an Expenses administrator to see every employee (as a Team Approver it saw 239 claims from 7 people; as an
 * administrator, 2,698 from 42). Who is shown is the employee on the claim, which may be whoever it was entered for or by,
 * so `text` also searches the description.
 */
import { odooSearch, odooAggregate } from '@/lib/odooQuery';
import { nzToday } from '@/lib/ostendo';

const COMPANY = { north: 4, oceania: 1 };
const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s)) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
const STATES = new Set(['draft', 'reported', 'approved', 'done', 'refused']);

// Plain groups over the expense category name. "food" means the Meals categories (Meals Expenses, Meals - Local Travelling,
// Meal Expenses - Non Travelling, Meals Overseas); Staff Amenities is listed under office_and_staff, not food.
const GROUPS = [
  ['food', /meal/i],
  ['fuel', /fuel|mileage/i],
  ['vehicle', /levies|repair|maintenance|rego|toll/i],
  ['accommodation', /accommodation/i],
  ['travel', /air tickets|taxi|car rental/i],
  ['software', /software|subscription/i],
  ['marketing', /marketing|gifts|ice bags|expo|event/i],
  ['office_and_staff', /office|printing|stationar|amenit|recruit|communication/i],
];
export const EXPENSE_GROUPS = [...GROUPS.map(([n]) => n), 'other'];
export const groupOf = (category) => (GROUPS.find(([, re]) => re.test(category)) || ['other'])[0];
const cleanCategory = (display) => String(display || '').replace(/^\[[^\]]*\]\s*/, '').trim() || 'No category';

function period(input) {
  if (input?.from || input?.to) {
    if (!isDate(input.from) || !isDate(input.to)) throw new Error('Dates must be given as YYYY-MM-DD, both from and to.');
    if (input.from > input.to) throw new Error('Dates must run forward: from must not be after to.');
    return { from: input.from, to: input.to };
  }
  const months = input?.months === undefined || input?.months === null || input?.months === '' ? 12 : Number(input.months);
  if (!Number.isInteger(months) || months < 1 || months > 60) throw new Error('months must be a whole number from 1 to 60.');
  const to = nzToday();
  const d = new Date(`${to}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - months);
  d.setUTCDate(d.getUTCDate() + 1);
  return { from: d.toISOString().slice(0, 10), to, months };
}

const rowsOf = (res) => {
  if (Array.isArray(res)) return res;
  if (res?.truncated) throw new Error('That grouping has too many groups to total exactly. Narrow it with employee, category or a shorter period.');
  return res?.rows || [];
};
/** One grouping of the filter, summed inside Odoo. Returns [{ key, label, claims, amount, gst }]. */
async function grouped(domain, field) {
  const res = rowsOf(await odooAggregate({ model: 'hr.expense', domain, fields: ['total_amount_company:sum', 'amount_tax_company:sum'], groupby: [field] }));
  return res.map((r) => {
    const raw = r[field];
    const label = Array.isArray(raw) ? raw[1] : raw;
    return { label: label === false || label == null ? null : String(label), id: Array.isArray(raw) ? raw[0] : null, claims: Number(r[`${field.split(':')[0]}_count`] ?? r.__count ?? 0), amount: Number(r.total_amount_company) || 0, gst: Number(r.amount_tax_company) || 0 };
  });
}
const monthKey = (label) => { const t = Date.parse(`1 ${label} UTC`); return Number.isNaN(t) ? String(label) : new Date(t).toISOString().slice(0, 7); };
const bucket = (items) => items.map((c) => ({ ...c, amountInclGst: r2(c.amount), gst: r2(c.gst), amountExclGst: r2(c.amount - c.gst) }));
const out = (c, key, name) => { const { label, id, amount, ...rest } = c; return { [key]: name ?? label, claims: rest.claims, amountInclGst: rest.amountInclGst, gst: rest.gst, amountExclGst: rest.amountExclGst }; };

export async function getExpenses(input = {}) {
  const p = period(input);
  const category = input?.category ? String(input.category).trim().slice(0, 60) : '';
  const asGroup = EXPENSE_GROUPS.includes(category.toLowerCase()) ? category.toLowerCase() : null;
  const company = input?.company ? String(input.company).toLowerCase() : '';
  if (company && !COMPANY[company]) throw new Error("company must be 'north' or 'oceania'.");
  const states = Array.isArray(input?.status) ? input.status.map(String) : input?.status ? [String(input.status)] : null;
  if (states && states.some((s) => !STATES.has(s))) throw new Error('status must be draft, reported, approved, done or refused.');

  const domain = [['date', '>=', p.from], ['date', '<=', p.to]];
  if (company) domain.push(['company_id', '=', COMPANY[company]]);
  if (states) domain.push(['state', 'in', states]); else domain.push(['state', '!=', 'refused']);
  const employee = String(input?.employee || '').trim().slice(0, 60);
  if (employee) domain.push(['employee_id.name', 'ilike', employee]);
  const text = String(input?.text || '').trim().slice(0, 80);
  if (text) domain.push(['name', 'ilike', text]);
  if (category && !asGroup) domain.push(['product_id.name', 'ilike', category]);

  // Categories first: they decide which group each claim is in, and which products a group filter keeps.
  let products = bucket(await grouped(domain, 'product_id')).map((c) => ({ ...c, category: cleanCategory(c.label), group: groupOf(cleanCategory(c.label)) }));
  let finalDomain = domain;
  if (asGroup) {
    products = products.filter((c) => c.group === asGroup);
    const ids = products.filter((c) => c.id !== null).map((c) => c.id);
    const noProduct = products.some((c) => c.id === null);
    finalDomain = noProduct ? [...domain, '|', ['product_id', '=', false], ['product_id', 'in', ids]] : [...domain, ['product_id', 'in', ids]];
    if (!ids.length && !noProduct) products = [];
  }
  const empty = products.length === 0;
  const [employees, months, statuses] = empty ? [[], [], []] : await Promise.all([grouped(finalDomain, 'employee_id'), grouped(finalDomain, 'date:month'), grouped(finalDomain, 'state')]);

  const sumOf = (a, k) => a.reduce((s, c) => s + c[k], 0);
  const total = { claims: sumOf(products, 'claims'), amount: sumOf(products, 'amount'), gst: sumOf(products, 'gst') };
  const wantLines = input?.lines === undefined ? 25 : Math.max(0, Math.min(100, Number(input.lines) || 0));
  let lines = [];
  if (wantLines > 0 && !empty) {
    const res = await odooSearch({
      model: 'hr.expense', domain: finalDomain, limit: wantLines, order: 'date desc',
      fields: ['name', 'date', 'employee_id', 'product_id', 'total_amount_company', 'amount_tax_company', 'state', 'payment_mode', 'company_id'],
    });
    lines = (res.rows || []).map((r) => {
      const cat = cleanCategory(r.product_id && r.product_id[1]);
      return {
        date: String(r.date || '').slice(0, 10), employee: r.employee_id ? r.employee_id[1] : 'Unknown', category: cat, group: groupOf(cat),
        description: String(r.name || '').slice(0, 120), amount: r2(r.total_amount_company), gst: r2(r.amount_tax_company), status: r.state,
        paidBy: r.payment_mode === 'own_account' ? 'Employee (to be reimbursed)' : r.payment_mode === 'company_account' ? 'Company card or account' : r.payment_mode || null,
        company: r.company_id ? r.company_id[1] : null,
      };
    });
  }

  const notes = [];
  if (empty) {
    notes.push('No expense claims matched.');
    if (employee) {
      const emp = await odooSearch({ model: 'hr.employee', domain: [['name', 'ilike', employee]], fields: ['name', 'company_id'], limit: 5 }).catch(() => null);
      const found = emp?.rows || [];
      notes.push(found.length
        ? `${found.map((e) => e.name).join(', ')} ${found.length === 1 ? 'is an employee' : 'are employees'} in Odoo with no expense claims matching this filter. Claims entered by someone else for them show under the other person, so try the text filter with their name.`
        : `No employee in Odoo matches "${employee}".`);
    }
  }
  const byCategory = products.reduce((m, c) => { const e = m.get(c.category) || { category: c.category, claims: 0, amount: 0, gst: 0 }; e.claims += c.claims; e.amount += c.amount; e.gst += c.gst; m.set(c.category, e); return m; }, new Map());
  const byGroup = products.reduce((m, c) => { const e = m.get(c.group) || { group: c.group, claims: 0, amount: 0, gst: 0 }; e.claims += c.claims; e.amount += c.amount; e.gst += c.gst; m.set(c.group, e); return m; }, new Map());
  const money = (e) => ({ claims: e.claims, amountInclGst: r2(e.amount), gst: r2(e.gst), amountExclGst: r2(e.amount - e.gst) });
  const monthMap = new Map();
  for (const c of months) { const k = monthKey(c.label); const e = monthMap.get(k) || { month: k, claims: 0, amount: 0, gst: 0 }; e.claims += c.claims; e.amount += c.amount; e.gst += c.gst; monthMap.set(k, e); }

  return {
    period: { from: p.from, to: p.to, ...(p.months ? { months: p.months } : {}) },
    filters: { employee: employee || null, category: category || null, text: text || null, company: company || null, status: states || 'all except refused' },
    currency: 'NZD',
    basis: 'Expense claims in Odoo (hr.expense), company-currency amounts including GST as claimed, totalled inside Odoo so they are exact. Refused claims are excluded unless status asks for them. Employee is the person on the claim, which may be whoever it was entered for or by. Covers every claim the dashboard\'s Odoo login is allowed to see (it needs to be an Expenses administrator to see everyone).',
    foodMeans: 'The Meals categories only (Meals Expenses, Meals - Local Travelling, Meal Expenses - Non Travelling, Meals Overseas). Staff Amenities is counted under office_and_staff.',
    total: { claims: total.claims, amountInclGst: r2(total.amount), gst: r2(total.gst), amountExclGst: r2(total.amount - total.gst) },
    byEmployee: employees.map((c) => ({ employee: c.label || 'Unknown', ...money(c) })).sort((a, b) => b.amountInclGst - a.amountInclGst),
    byGroup: [...byGroup.values()].map((e) => ({ group: e.group, ...money(e) })).sort((a, b) => b.amountInclGst - a.amountInclGst),
    byCategory: [...byCategory.values()].map((e) => ({ category: e.category, ...money(e) })).sort((a, b) => b.amountInclGst - a.amountInclGst),
    byMonth: [...monthMap.values()].map((e) => ({ month: e.month, ...money(e) })).sort((a, b) => a.month.localeCompare(b.month)),
    byStatus: statuses.map((c) => ({ status: c.label, ...money(c) })),
    lines,
    notes,
  };
}
