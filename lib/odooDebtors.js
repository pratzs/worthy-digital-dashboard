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
import { cachedAuth } from '@/lib/odooAuth';
import { nzToday } from '@/lib/ostendo';
import { repGroup } from '@/lib/odooReps';


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
  const j = await cachedAuth(() => rpc({ jsonrpc: '2.0', method: 'call', id: 1,
    params: { service: 'common', method: 'authenticate', args: [ODOO.db, ODOO.user, ODOO.pw, {}] } }, 15000),
    ODOO.url, ODOO.db, ODOO.user);
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

const INTERCOMPANY = /worthy (products south|oceania)/i;

/** One company's debtors, worked out from Odoo. Throws if Odoo cannot answer. */
export async function computeDebtors(cid) {
  {
    const call = await connect();
    const today = nzToday();
    const todayN = dayNumber(today);
    const rows = await call('account.move', 'search_read',
      [[['company_id', '=', cid], ['state', '=', 'posted'],
        ['move_type', 'in', ['out_invoice', 'out_refund']],
        ['payment_state', 'in', ['not_paid', 'partial', 'in_payment']]]],
      { fields: ['name', 'commercial_partner_id', 'partner_id', 'invoice_date', 'invoice_date_due', 'amount_residual_signed', 'move_type'] },
      60000);

    const byCustomer = new Map();
    const invoices = [];
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
        byCustomer.set(id, { id, name: party ? party[1] : 'No customer', total: 0, oldestDays: 0, documents: 0, overdueDocuments: 0, ...emptyBuckets() });
      }
      const cust = byCustomer.get(id);
      cust[b] += c; cust.total += c; cust.documents += 1;
      if (daysOver > 0) cust.overdueDocuments += 1;
      if (daysOver > cust.oldestDays) cust.oldestDays = daysOver;
      total[b] += c; totalCents += c;
      invoices.push({ c: id, doc: r.name, inv: r.invoice_date || null, due: due || null, days: daysOver,
                      amt: dollars(c), kind: r.move_type === 'out_refund' ? 'Credit note' : 'Invoice' });
    }

    /* The salesperson each customer is assigned to in Odoo, so the team knows whose
       customer to chase. Reported the way the rest of the dashboard reports reps: the
       eight field reps by name and everyone else as "Direct". */
    const repOf = new Map();
    const ids = [...byCustomer.keys()].filter(Boolean);
    for (let i = 0; i < ids.length; i += 300) {
      try {
        const ps = await call('res.partner', 'read', [ids.slice(i, i + 300)], { fields: ['user_id'], context: { active_test: false } }, 45000);
        for (const p of ps) repOf.set(p.id, p.user_id ? p.user_id[1] : 'Unassigned');
      } catch { /* a missing salesperson is shown as Direct, never a failed page */ }
    }

    const money = (o) => ({ ...o, ...Object.fromEntries(BUCKETS.map((b) => [b, dollars(o[b])])), total: dollars(o.total) });
    const customers = [...byCustomer.values()]
      .map((c) => ({ ...money(c), overdue: dollars(c.total - c.current),
                     rep: repGroup(cid, repOf.get(c.id) || 'Unassigned'),
                     intercompany: INTERCOMPANY.test(c.name) }))
      .sort((a, b) => b.overdue - a.overdue || b.total - a.total);
    const overdueCents = totalCents - total.current;

    // By rep, for whoever manages the chasing.
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
    return ({
      ok: true, version: 2, company: cid, asOf: today, generatedAt: new Date().toISOString(),
      basis: 'Open customer invoices and credit notes, by outstanding balance and due date',
      documents: rows.length,
      totals: {
        outstanding: dollars(totalCents), overdue: dollars(overdueCents),
        overduePct: totalCents > 0 ? Math.round((overdueCents / totalCents) * 1000) / 10 : null,
        ...Object.fromEntries(BUCKETS.map((b) => [b, dollars(total[b])])),
        intercompany: { total: r2(ic.reduce((s, c) => s + c.total, 0)), overdue: r2(ic.reduce((s, c) => s + c.overdue, 0)), customers: ic.length },
      },
      customers, customerCount: customers.length, reps: repRows, invoices,
    });
  }
}
