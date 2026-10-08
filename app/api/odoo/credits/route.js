/**
 * Credit notes for Worthy Products North / Worthy Oceania (Odoo), one row per
 * credit note - who it went to and what it was worth. Mirrors
 * /api/ostendo/credits so one panel serves both.
 */
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
      { fields: ['name', 'invoice_date', 'partner_id', 'invoice_user_id', 'amount_untaxed_signed'],
        order: 'invoice_date desc', limit: 0 }, 45000);

    // Credit-note amounts come back positive on account.move; the sign lives on
    // the move type, not the figure - so negate for display consistency with
    // revenue, but the note's OWN value should read as a positive amount credited.
    const notes = moves.map((m) => ({
      date: m.invoice_date, docNumber: m.name,
      customer: m.partner_id ? m.partner_id[1] : 'No customer',
      rep: repGroup(cid, m.invoice_user_id ? m.invoice_user_id[1] : 'Unassigned'),
      amount: Math.abs(Number(m.amount_untaxed_signed) || 0),
    }));

    const totalValue = Math.round(notes.reduce((s, n) => s + n.amount, 0) * 100) / 100;

    const byRep = new Map();
    for (const n of notes) {
      const r = byRep.get(n.rep) || { rep: n.rep, count: 0, value: 0 };
      r.count += 1; r.value += n.amount;
      byRep.set(n.rep, r);
    }
    const reps = [...byRep.values()]
      .map((r) => ({ ...r, value: Math.round(r.value * 100) / 100 }))
      .sort((a, b) => b.value - a.value);

    return NextResponse.json({
      ok: true, company: cid, range: { start, end }, generatedAt: new Date().toISOString(),
      notes, reps,
      totals: { count: notes.length, value: totalValue },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message, notes: [], reps: [], totals: { count: 0, value: 0 } }, { status: 500 });
  }
}
