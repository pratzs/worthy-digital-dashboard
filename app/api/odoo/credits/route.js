/**
 * Credit notes for Worthy Products North / Worthy Oceania (Odoo), one row per
 * credit note - who it went to and what it was worth. Mirrors
 * /api/ostendo/credits so one panel serves both.
 */
import { cachedAuth } from '@/lib/odooAuth';
import { NextResponse } from 'next/server';
import { fyRange, nzToday, nzFinancialYear } from '@/lib/ostendo';
import { repGroup } from '@/lib/odooReps';

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

/* What a credit with no product on it is. Taken from the account the line posts to,
   because that is what the accountant chose: a discount given, a supplier rebate, a
   rent reversal, a sales adjustment. */
const kindOfAccount = (acc) => {
  const a = String(acc || '').toLowerCase();
  if (a.includes('discount')) return 'Discount';
  if (a.includes('rebate')) return 'Rebate';
  if (a.includes('rent')) return 'Rent';
  if (a.includes('sales')) return 'Sales adjustment';
  return 'Other adjustment';
};
const round2 = (n) => Math.round(n * 100) / 100;
const CHUNK = 300;
const plain = (h) => String(h || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const today = nzToday();
  const cid = parseInt(searchParams.get('company') || '4', 10);
  const fy = parseInt(searchParams.get('fy') || '', 10) || nzFinancialYear();
  let start = searchParams.get('startDate');
  let end = searchParams.get('endDate');
  if (!start || !end) { const r = fyRange(fy, today); start = r.start; end = r.end; }

  try {
    const exec = await connect();
    const moves = await exec('account.move', 'search_read',
      [[['company_id', '=', cid], ['move_type', '=', 'out_refund'], ['state', '=', 'posted'],
        ['invoice_date', '>=', start], ['invoice_date', '<=', end]]],
      { fields: ['name', 'invoice_date', 'partner_id', 'invoice_user_id', 'create_uid', 'amount_untaxed_signed', 'ref', 'reversed_entry_id'],
        order: 'invoice_date desc', limit: 0 }, 45000);

    /* Each note is split into what it credits against PRODUCT sales (the figure the
       Overview and Sales by Rep use) and what it credits with no product on the line
       (discounts, rebates, rent, adjustments). Added together they are the note's
       full value, so the two views of the same notes reconcile. A credit note's lines
       carry a positive balance, so the balance is the amount credited. */
    const lineBy = new Map();
    const reasons = new Map(); // move id -> [{ who, date, text }]
    for (let i = 0; i < moves.length; i += CHUNK) {
      const ids = moves.slice(i, i + CHUNK).map((m) => m.id);
      const [lines, msgs] = await Promise.all([
        exec('account.move.line', 'search_read',
          [[['move_id', 'in', ids], ['display_type', '=', 'product']]],
          { fields: ['move_id', 'name', 'product_id', 'balance', 'account_id'], limit: 0 }, 45000),
        /* The reason lives in the notes the team logs on the credit note in Odoo
           (comment, internal note). Odoo's own tracking messages and OdooBot are
           left out, and so are the "Here is your invoice" emails. */
        exec('mail.message', 'search_read',
          [[['model', '=', 'account.move'], ['res_id', 'in', ids], ['message_type', '=', 'comment']]],
          { fields: ['res_id', 'subtype_id', 'body', 'author_id', 'date'], order: 'date asc', limit: 0 }, 45000)
          .catch(() => []),
      ]);
      for (const l of lines) {
        const k = l.move_id[0];
        const o = lineBy.get(k) || { product: 0, other: 0, kindAmt: new Map(), text: '', textAmt: 0, products: 0 };
        const bal = Number(l.balance) || 0;
        if (l.product_id) {
          o.product += bal; o.products += 1;
          if (Math.abs(bal) > o.textAmt) { o.textAmt = Math.abs(bal); o.text = l.product_id[1]; }
        } else {
          o.other += bal;
          const kind = kindOfAccount(l.account_id && l.account_id[1]);
          o.kindAmt.set(kind, (o.kindAmt.get(kind) || 0) + Math.abs(bal));
          if (Math.abs(bal) > o.textAmt) { o.textAmt = Math.abs(bal); o.text = String(l.name || '').replace(/\s+/g, ' ').trim(); }
        }
        lineBy.set(k, o);
      }
      for (const m of msgs) {
        const author = m.author_id ? m.author_id[1] : '';
        const sub = m.subtype_id ? m.subtype_id[1] : '';
        const text = plain(m.body);
        if (!text || sub !== 'Note' || /odoobot/i.test(author)) continue;
        const arr = reasons.get(m.res_id) || [];
        arr.push({ who: author, date: String(m.date || '').slice(0, 10), text });
        reasons.set(m.res_id, arr);
      }
    }

    const notes = moves.map((m) => {
      const o = lineBy.get(m.id) || { product: 0, other: 0, kindAmt: new Map(), text: '', products: 0 };
      const total = Math.abs(Number(m.amount_untaxed_signed) || 0);
      const product = round2(o.product), other = round2(o.other);
      const topKind = [...o.kindAmt.entries()].sort((a, b) => b[1] - a[1])[0];
      const kind = Math.abs(product) >= Math.abs(other) ? 'Product credit' : (topKind ? topKind[0] : 'Other adjustment');
      const rs = reasons.get(m.id) || [];
      return {
        date: m.invoice_date, docNumber: m.name,
        customer: m.partner_id ? m.partner_id[1] : 'No customer',
        rep: repGroup(cid, m.invoice_user_id ? m.invoice_user_id[1] : 'Unassigned'),
        raisedBy: m.create_uid ? m.create_uid[1] : '',
        amount: total, productAmount: product, otherAmount: other, kind,
        about: (o.text || '').slice(0, 90),
        lines: o.products,
        reason: rs.map((r) => r.text).join(' | ').slice(0, 600),
        reasonBy: [...new Set(rs.map((r) => r.who))].join(', '),
        note: m.ref ? String(m.ref).slice(0, 80) : '',
        creditedInvoice: m.reversed_entry_id ? m.reversed_entry_id[1] : '',
      };
    });

    const sum = (arr, f) => round2(arr.reduce((s, n) => s + f(n), 0));
    const totalValue = sum(notes, (n) => n.amount);
    const productValue = sum(notes, (n) => n.productAmount);
    const otherValue = sum(notes, (n) => n.otherAmount);

    const group = (keyOf) => {
      const m = new Map();
      for (const n of notes) {
        const k = keyOf(n);
        const r = m.get(k) || { key: k, count: 0, product: 0, other: 0, value: 0 };
        r.count += 1; r.product += n.productAmount; r.other += n.otherAmount; r.value += n.amount;
        m.set(k, r);
      }
      return [...m.values()].map((r) => ({ ...r, product: round2(r.product), other: round2(r.other), value: round2(r.value) }));
    };
    const reps = group((n) => n.rep).map((r) => ({ rep: r.key, ...r })).sort((a, b) => b.value - a.value);
    const months = group((n) => String(n.date).slice(0, 7)).map((r) => ({ month: r.key, ...r })).sort((a, b) => a.month.localeCompare(b.month));
    const customers = group((n) => n.customer).map((r) => ({ customer: r.key, ...r })).sort((a, b) => b.value - a.value).slice(0, 15);
    const kinds = group((n) => n.kind).map((r) => ({ kind: r.key, ...r })).sort((a, b) => b.value - a.value);
    const raisers = group((n) => n.raisedBy || 'Unknown').map((r) => ({ person: r.key, ...r })).sort((a, b) => b.value - a.value);

    // The same period's sales, so the credits can be put in proportion.
    let salesBasis = null;
    try {
      const g = await exec('account.move.line', 'read_group',
        [[['move_id.company_id', '=', cid], ['move_id.move_type', '=', 'out_invoice'], ['move_id.state', '=', 'posted'],
          ['move_id.invoice_date', '>=', start], ['move_id.invoice_date', '<=', end],
          ['display_type', '=', 'product'], ['product_id', '!=', false]], ['balance:sum'], []], { lazy: false }, 45000);
      salesBasis = round2(-(Number(g[0]?.balance) || 0));
    } catch { salesBasis = null; }

    return NextResponse.json({
      ok: true, version: 2, company: cid, range: { start, end }, generatedAt: new Date().toISOString(),
      notes, reps, months, customers, kinds, raisers,
      totals: { count: notes.length, value: totalValue, productValue, otherValue, grossSales: salesBasis,
                withReason: notes.filter((n) => n.reason).length,
                productPctOfSales: salesBasis > 0 ? round2((productValue / salesBasis) * 100) : null },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message, notes: [], reps: [], totals: { count: 0, value: 0 } }, { status: 500 });
  }
}
