/**
 * Staff expense claims from Odoo (hr.expense), for the MANAGEMENT connector and management chat only
 * (lib/mcpTools.js get_expenses). It is not part of the rep or marketing logins.
 *
 * Read only. Amounts are in NZD (the company currency, total_amount_company) and include GST as claimed; the GST part and
 * the figure without GST are both returned. Refused claims are left out unless asked for. Totals are worked out here from
 * every matching row (never from a capped list): if more than 500 rows would match, it says so and asks for a narrower question.
 *
 * Who is shown is the employee on the claim. Some claims are entered by one person for another (for example a vehicle
 * registration for a staff member's car is entered by Pooja), so `text` also searches the description.
 */
import { odooSearch } from '@/lib/odooQuery';
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
const groupOf = (category) => (GROUPS.find(([, re]) => re.test(category)) || ['other'])[0];
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

const bucket = (rows, keyFn) => {
  const m = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    const c = m.get(k) || { key: k, claims: 0, amountInclGst: 0, gst: 0 };
    c.claims += 1; c.amountInclGst += r.amount; c.gst += r.gst;
    m.set(k, c);
  }
  return [...m.values()].map((c) => ({ ...c, amountInclGst: r2(c.amountInclGst), gst: r2(c.gst), amountExclGst: r2(c.amountInclGst - c.gst) }));
};

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

  const res = await odooSearch({
    model: 'hr.expense', domain, limit: 500, order: 'date desc',
    fields: ['name', 'date', 'employee_id', 'product_id', 'total_amount_company', 'amount_tax_company', 'state', 'payment_mode', 'company_id'],
  });
  if (res.truncated) throw new Error('Too many expense claims match (500 or more). Narrow it with employee, category or a shorter period.');
  let rows = res.rows.map((r) => {
    const cat = cleanCategory(r.product_id && r.product_id[1]);
    return {
      date: String(r.date || '').slice(0, 10), employee: r.employee_id ? r.employee_id[1] : 'Unknown', category: cat, group: groupOf(cat),
      description: String(r.name || '').slice(0, 120), amount: Number(r.total_amount_company) || 0, gst: Number(r.amount_tax_company) || 0,
      status: r.state, paidBy: r.payment_mode === 'own_account' ? 'Employee (to be reimbursed)' : r.payment_mode === 'company_account' ? 'Company card or account' : r.payment_mode || null,
      company: r.company_id ? r.company_id[1] : null,
    };
  });
  if (asGroup) rows = rows.filter((r) => r.group === asGroup);

  const total = rows.reduce((t, r) => t + r.amount, 0), gst = rows.reduce((t, r) => t + r.gst, 0);
  const wantLines = input?.lines === undefined ? 25 : Math.max(0, Math.min(100, Number(input.lines) || 0));
  const notes = [];
  if (!rows.length) {
    notes.push('No expense claims matched.');
    if (employee) {
      const emp = await odooSearch({ model: 'hr.employee', domain: [['name', 'ilike', employee]], fields: ['name', 'company_id'], limit: 5 }).catch(() => null);
      const found = emp?.rows || [];
      notes.push(found.length
        ? `${found.map((e) => e.name).join(', ')} ${found.length === 1 ? 'is an employee' : 'are employees'} in Odoo with no expense claims in this period. Claims entered by someone else for them show under the other person, so try the text filter with their name.`
        : `No employee in Odoo matches "${employee}".`);
    }
  }
  return {
    period: { from: p.from, to: p.to, ...(p.months ? { months: p.months } : {}) },
    filters: { employee: employee || null, category: category || null, text: text || null, company: company || null, status: states || 'all except refused' },
    currency: 'NZD',
    basis: 'Expense claims in Odoo (hr.expense), company-currency amounts including GST as claimed. Refused claims are excluded unless status asks for them. Employee is the person on the claim, which may be whoever entered it.',
    foodMeans: 'The Meals categories only (Meals Expenses, Meals - Local Travelling, Meal Expenses - Non Travelling, Meals Overseas). Staff Amenities is counted under office_and_staff.',
    total: { claims: rows.length, amountInclGst: r2(total), gst: r2(gst), amountExclGst: r2(total - gst) },
    byEmployee: bucket(rows, (r) => r.employee).map(({ key, ...c }) => ({ employee: key, ...c })).sort((a, b) => b.amountInclGst - a.amountInclGst),
    byGroup: bucket(rows, (r) => r.group).map(({ key, ...c }) => ({ group: key, ...c })).sort((a, b) => b.amountInclGst - a.amountInclGst),
    byCategory: bucket(rows, (r) => r.category).map(({ key, ...c }) => ({ category: key, ...c })).sort((a, b) => b.amountInclGst - a.amountInclGst),
    byMonth: bucket(rows, (r) => r.date.slice(0, 7)).map(({ key, ...c }) => ({ month: key, ...c })).sort((a, b) => a.month.localeCompare(b.month)),
    byStatus: bucket(rows, (r) => r.status).map(({ key, ...c }) => ({ status: key, ...c })),
    lines: rows.slice(0, wantLines),
    notes,
  };
}
