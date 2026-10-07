/**
 * Debtors and overdue invoices for Worthy Products South (Ostendo).
 *
 * Same shape as /api/odoo/debtors so one panel serves both.
 *
 * Built from the invoices and credit notes that are not fully paid, using the
 * balance Ostendo holds on each (BALANCEDUE, signed: credit notes are negative)
 * and its due date. Payments received but not yet applied to an invoice
 * (CUSTOMERPAYMENTS.UNAPPLIEDAMOUNT) reduce what the customer owes, so they come
 * off that customer, in "not yet due", and are shown as their own line.
 *
 * Billed-to customer, not the delivery store: the bill-to is who pays. A trailing
 * year on a name ("Creek Road Mini Mart 2025") is dropped so one customer is one
 * row. Amounts include GST, as they do on the invoice.
 */
import { NextResponse } from 'next/server';
import { ostendoSql, normaliseDate, nzToday } from '@/lib/ostendo';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const cents = (n) => Math.round((Number(n) || 0) * 100);
const dollars = (c) => c / 100;
const BUCKETS = ['current', 'd1to30', 'd31to60', 'd61to90', 'over90'];
const bucketOf = (daysOver) => daysOver <= 0 ? 'current' : daysOver <= 30 ? 'd1to30'
  : daysOver <= 60 ? 'd31to60' : daysOver <= 90 ? 'd61to90' : 'over90';
const emptyBuckets = () => Object.fromEntries(BUCKETS.map((b) => [b, 0]));
const dayNumber = (iso) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86400000);
const tidyName = (n) => String(n || 'No customer').replace(/\s+20\d{2}$/, '').trim();

export async function GET() {
  try {
    const today = nzToday();
    const todayN = dayNumber(today);
    const [open, unapplied] = await Promise.all([
      ostendoSql(`SELECT INVOICENUMBER, CUSTOMER, INVOICEDATE, INVOICEDUEDATE, BALANCEDUE
                  FROM SALESINVOICEHEADER
                  WHERE INVOICESTATUS <> 'Fully Paid' AND BALANCEDUE <> 0`, 55000),
      ostendoSql(`SELECT CUSTOMER, SUM(UNAPPLIEDAMOUNT) AS UNAPPLIED
                  FROM CUSTOMERPAYMENTS WHERE UNAPPLIEDAMOUNT <> 0 GROUP BY CUSTOMER`, 55000),
    ]);

    const byCustomer = new Map();
    const total = emptyBuckets();
    let totalCents = 0;
    const row = (name) => {
      const key = tidyName(name);
      if (!byCustomer.has(key)) byCustomer.set(key, { name: key, total: 0, oldestDays: 0, documents: 0, ...emptyBuckets() });
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
      if (daysOver > cust.oldestDays) cust.oldestDays = daysOver;
      total[b] += c; totalCents += c;
    }
    let unappliedCents = 0;
    for (const r of unapplied) {
      const c = cents(r.UNAPPLIED);
      if (c === 0) continue;
      const cust = row(r.CUSTOMER);
      cust.current -= c; cust.total -= c;
      total.current -= c; totalCents -= c; unappliedCents += c;
    }

    const money = (o) => ({ ...o, ...Object.fromEntries(BUCKETS.map((b) => [b, dollars(o[b])])), total: dollars(o.total) });
    const customers = [...byCustomer.values()]
      .map((c) => ({ ...money(c), overdue: dollars(c.total - c.current) }))
      .sort((a, b) => b.overdue - a.overdue || b.total - a.total);
    const overdueCents = totalCents - total.current;

    return NextResponse.json({
      ok: true, company: 'south', asOf: today, generatedAt: new Date().toISOString(),
      basis: 'Unpaid invoices and credit notes by balance due and due date, less payments received but not yet applied. Includes GST',
      documents: open.length,
      unappliedPayments: dollars(unappliedCents),
      totals: {
        outstanding: dollars(totalCents), overdue: dollars(overdueCents),
        overduePct: totalCents > 0 ? Math.round((overdueCents / totalCents) * 1000) / 10 : null,
        ...Object.fromEntries(BUCKETS.map((b) => [b, dollars(total[b])])),
      },
      customers: customers.slice(0, 40), customerCount: customers.length,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
