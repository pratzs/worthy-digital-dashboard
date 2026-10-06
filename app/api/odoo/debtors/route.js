/**
 * Debtors and overdue invoices for an Odoo company.
 *
 * Built from the open customer invoices and credit notes (posted, not fully
 * paid), using each document's own outstanding balance and due date. This is the
 * same figure as Odoo's receivable ledger: checked 7 Oct 2026 on Worthy Products
 * North, where the invoice-level total ($2,486,152.55 over 2,021 documents) and
 * the receivable-account line total agreed to the cent, as did the overdue
 * figure ($461,599.11 over 457).
 *
 * Credit notes carry a negative balance and sit against the customer, so a
 * customer's figure is what they actually owe. Ageing is by days past the due
 * date: not yet due, 1-30, 31-60, 61-90, over 90. Rolled up by commercial
 * partner, so a head office and its stores read as one customer.
 */
import { NextResponse } from 'next/server';
import { nzToday } from '@/lib/ostendo';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ODOO = {
  url: process.env.ODOO_URL, db: process.env.ODOO_DB,
  user: process.env.ODOO_USER, pw: process.env.ODOO_PASSWORD,
};

async function rpc(payload, timeoutMs = 45000) {
  const res = await fetch(`${ODOO.url}/jsonrpc`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload), signal: AbortSignal.timeout(timeoutMs),
  });
  return res.json();
}

async function connect() {
  const j = await rpc({ jsonrpc: '2.0', method: 'call', id: 1,
    params: { service: 'common', method: 'authenticate', args: [ODOO.db, ODOO.user, ODOO.pw, {}] } }, 15000);
  if (!j.result) throw new Error('Odoo authentication failed');
  const uid = j.result;
  return async (model, method, args, kwargs = {}, timeout = 45000) => {
    const r = await rpc({ jsonrpc: '2.0', method: 'call', id: 2,
      params: { service: 'object', method: 'execute_kw',
                args: [ODOO.db, uid, ODOO.pw, model, method, args, kwargs] } }, timeout);
    if (r.error) throw new Error(r.error.data?.message || r.error.message || `${model}.${method} failed`);
    return r.result;
  };
}

const cents = (n) => Math.round((Number(n) || 0) * 100);
const dollars = (c) => c / 100;
const BUCKETS = ['current', 'd1to30', 'd31to60', 'd61to90', 'over90'];
const bucketOf = (daysOver) => daysOver <= 0 ? 'current' : daysOver <= 30 ? 'd1to30'
  : daysOver <= 60 ? 'd31to60' : daysOver <= 90 ? 'd61to90' : 'over90';
const emptyBuckets = () => Object.fromEntries(BUCKETS.map((b) => [b, 0]));
const dayNumber = (iso) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86400000);

export async function GET(request) {
  const cid = Number(new URL(request.url).searchParams.get('company')) || 4;
  try {
    const call = await connect();
    const today = nzToday();
    const todayN = dayNumber(today);
    const rows = await call('account.move', 'search_read',
      [[['company_id', '=', cid], ['state', '=', 'posted'],
        ['move_type', 'in', ['out_invoice', 'out_refund']],
        ['payment_state', 'in', ['not_paid', 'partial', 'in_payment']]]],
      { fields: ['name', 'commercial_partner_id', 'partner_id', 'invoice_date', 'invoice_date_due', 'amount_residual_signed'] },
      60000);

    const byCustomer = new Map();
    const total = emptyBuckets();
    let totalCents = 0;
    for (const r of rows) {
      const c = cents(r.amount_residual_signed);
      if (c === 0) continue;
      const party = r.commercial_partner_id || r.partner_id;
      const id = party ? party[0] : 0;
      const due = r.invoice_date_due || r.invoice_date;
      const daysOver = due ? todayN - dayNumber(due) : 0;
      const b = bucketOf(daysOver);
      if (!byCustomer.has(id)) {
        byCustomer.set(id, { name: party ? party[1] : 'No customer', total: 0, oldestDays: 0, documents: 0, ...emptyBuckets() });
      }
      const cust = byCustomer.get(id);
      cust[b] += c; cust.total += c; cust.documents += 1;
      if (daysOver > cust.oldestDays) cust.oldestDays = daysOver;
      total[b] += c; totalCents += c;
    }

    const money = (o) => ({ ...o, ...Object.fromEntries(BUCKETS.map((b) => [b, dollars(o[b])])), total: dollars(o.total) });
    const customers = [...byCustomer.values()]
      .map((c) => ({ ...money(c), overdue: dollars(c.total - c.current) }))
      .sort((a, b) => b.overdue - a.overdue || b.total - a.total);
    const overdueCents = totalCents - total.current;

    return NextResponse.json({
      ok: true, company: cid, asOf: today, generatedAt: new Date().toISOString(),
      basis: 'Open customer invoices and credit notes, by outstanding balance and due date',
      documents: rows.length,
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
