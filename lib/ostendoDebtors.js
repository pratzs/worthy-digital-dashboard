/**
 * Debtors and overdue invoices for Worthy Products South (Ostendo), in the same
 * shape as lib/odooDebtors.js so one screen serves both companies.
 *
 * Built from the invoices and credit notes that are not fully paid, using the
 * balance Ostendo holds on each (BALANCEDUE, signed: credit notes are negative) and
 * its due date. Payments received but not yet applied to an invoice
 * (CUSTOMERPAYMENTS.UNAPPLIEDAMOUNT) reduce what the customer owes, so they come off
 * that customer, in "not yet due", and are listed as their own line.
 *
 * Billed-to customer, not the delivery store: the bill-to is who pays. A trailing
 * year on a name ("Creek Road Mini Mart 2025") is dropped so one customer is one
 * row. Amounts include GST, as they do on the invoice.
 */
import { ostendoSql, resolveRep, normaliseDate, nzToday } from '@/lib/ostendo';

const cents = (n) => Math.round((Number(n) || 0) * 100);
const dollars = (c) => c / 100;
const BUCKETS = ['current', 'd1to30', 'd31to60', 'd61to90', 'over90'];
const bucketOf = (daysOver) => daysOver <= 0 ? 'current' : daysOver <= 30 ? 'd1to30'
  : daysOver <= 60 ? 'd31to60' : daysOver <= 90 ? 'd61to90' : 'over90';
const emptyBuckets = () => Object.fromEntries(BUCKETS.map((b) => [b, 0]));
const dayNumber = (iso) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86400000);
const tidyName = (n) => String(n || 'No customer').replace(/\s+20\d{2}$/, '').trim() || 'No customer';
const INTERCOMPANY = /^worthy (products|oceania)/i;

/** South's debtors, worked out from Ostendo. Throws if Ostendo cannot answer. */
export async function computeSouthDebtors() {
  const today = nzToday();
  const todayN = dayNumber(today);
  const [open, unapplied, masters] = await Promise.all([
    ostendoSql(`SELECT INVOICENUMBER, CUSTOMER, INVOICEDATE, INVOICEDUEDATE, BALANCEDUE, INVOICEORCREDIT
                FROM SALESINVOICEHEADER
                WHERE INVOICESTATUS <> 'Fully Paid' AND BALANCEDUE <> 0`, 55000),
    ostendoSql(`SELECT CUSTOMER, SUM(UNAPPLIEDAMOUNT) AS UNAPPLIED
                FROM CUSTOMERPAYMENTS WHERE UNAPPLIEDAMOUNT <> 0 GROUP BY CUSTOMER`, 55000),
    ostendoSql(`SELECT CUSTOMER, SALESPERSON FROM CUSTOMERMASTER`, 55000).catch(() => []),
  ]);
  const spOf = new Map(masters.map((m) => [String(m.CUSTOMER), m.SALESPERSON]));

  const byCustomer = new Map();
  const invoices = [];
  const total = emptyBuckets();
  let totalCents = 0;
  const row = (name) => {
    const key = tidyName(name);
    if (!byCustomer.has(key)) {
      byCustomer.set(key, { id: key, name: key, total: 0, oldestDays: 0, documents: 0, overdueDocuments: 0, sp: null, spWeight: -1, ...emptyBuckets() });
    }
    return byCustomer.get(key);
  };
  for (const r of open) {
    const c = cents(r.BALANCEDUE);
    if (c === 0) continue;
    const due = normaliseDate(r.INVOICEDUEDATE) || normaliseDate(r.INVOICEDATE);
    const daysOver = due ? todayN - dayNumber(due) : 0;
    const b = bucketOf(daysOver);
    const cust = row(r.CUSTOMER);
    cust[b] += c; cust.total += c; cust.documents += 1;
    if (daysOver > 0) cust.overdueDocuments += 1;
    if (daysOver > cust.oldestDays) cust.oldestDays = daysOver;
    // the customer's own salesperson: taken from the record that carries the most money
    const w = Math.abs(c), sp = spOf.get(String(r.CUSTOMER));
    if (sp != null && w > cust.spWeight) { cust.sp = sp; cust.spWeight = w; }
    total[b] += c; totalCents += c;
    invoices.push({ c: cust.id, doc: r.INVOICENUMBER, inv: normaliseDate(r.INVOICEDATE), due: due || null, days: daysOver,
                    amt: dollars(c), kind: String(r.INVOICEORCREDIT).toLowerCase().startsWith('cred') ? 'Credit note' : 'Invoice' });
  }
  let unappliedCents = 0;
  for (const r of unapplied) {
    const c = cents(r.UNAPPLIED);
    if (c === 0) continue;
    const cust = row(r.CUSTOMER);
    cust.current -= c; cust.total -= c;
    if (cust.sp == null) cust.sp = spOf.get(String(r.CUSTOMER)) ?? null;
    total.current -= c; totalCents -= c; unappliedCents += c;
    invoices.push({ c: cust.id, doc: 'Payment not yet applied', inv: null, due: null, days: 0, amt: -dollars(c), kind: 'Unapplied payment' });
  }

  const money = (o) => ({ ...o, ...Object.fromEntries(BUCKETS.map((b) => [b, dollars(o[b])])), total: dollars(o.total) });
  const customers = [...byCustomer.values()]
    .map(({ sp, spWeight, ...c }) => ({ ...money(c), overdue: dollars(c.total - c.current),
                   rep: resolveRep(sp), intercompany: INTERCOMPANY.test(c.name) }))
    .sort((a, b) => b.overdue - a.overdue || b.total - a.total);
  const overdueCents = totalCents - total.current;

  const reps = new Map();
  for (const c of customers) {
    const r = reps.get(c.rep) || { rep: c.rep, customers: 0, overdueCustomers: 0, total: 0, current: 0, d1to30: 0, d31to60: 0, d61to90: 0, over90: 0 };
    r.customers += 1; if (c.overdue > 0) r.overdueCustomers += 1;
    for (const k of ['total', ...BUCKETS]) r[k] += c[k];
    reps.set(c.rep, r);
  }
  const r2 = (n) => Math.round(n * 100) / 100;
  const repRows = [...reps.values()].map((r) => ({ ...r, total: r2(r.total), current: r2(r.current), d1to30: r2(r.d1to30),
    d31to60: r2(r.d31to60), d61to90: r2(r.d61to90), over90: r2(r.over90), overdue: r2(r.total - r.current) }))
    .sort((a, b) => b.overdue - a.overdue);

  const ic = customers.filter((c) => c.intercompany);
  return {
    ok: true, version: 2, company: 'south', system: 'Ostendo', intercompanyLabel: 'Worthy North and Oceania',
    asOf: today, generatedAt: new Date().toISOString(),
    basis: 'Unpaid invoices and credit notes by balance due and due date, less payments received but not yet applied. Includes GST',
    documents: open.length,
    unappliedPayments: dollars(unappliedCents),
    totals: {
      outstanding: dollars(totalCents), overdue: dollars(overdueCents),
      overduePct: totalCents > 0 ? Math.round((overdueCents / totalCents) * 1000) / 10 : null,
      ...Object.fromEntries(BUCKETS.map((b) => [b, dollars(total[b])])),
      intercompany: { total: r2(ic.reduce((s, c) => s + c.total, 0)), overdue: r2(ic.reduce((s, c) => s + c.overdue, 0)), customers: ic.length },
    },
    customers, customerCount: customers.length, reps: repRows, invoices,
  };
}
