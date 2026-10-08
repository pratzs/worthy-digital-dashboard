/**
 * Credit notes for Worthy Products South (Ostendo), one row per credit note.
 *
 * Unlike the rep totals the fy route carries (count + value only), this says
 * WHO each credit went to and WHAT it was worth, so someone reviewing credits
 * can see the actual document, not just a number. Defaults to the current
 * financial year to date if no range is given.
 */
import { NextResponse } from 'next/server';
import { ostendoSql, resolveRep, normaliseDate, nzToday, nzFinancialYear, fyRange, q } from '@/lib/ostendo';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const today = nzToday();
  const fy = parseInt(searchParams.get('fy') || '', 10) || nzFinancialYear();
  let start = searchParams.get('startDate');
  let end = searchParams.get('endDate');
  if (!start || !end) { const r = fyRange(fy, today); start = r.start; end = r.end; }

  try {
    const rows = await ostendoSql(
      `SELECT INVOICENUMBER AS INV, INVOICEDATE AS D, CUSTOMER AS CUST, SALESPERSON AS SP,
              INVOICENETTAMOUNT AS NETT
       FROM SALESINVOICEHEADER
       WHERE INVOICEORCREDIT = 'Credit' AND INVOICEDATE BETWEEN ${q(start)} AND ${q(end)}
       ORDER BY INVOICEDATE DESC`
    );

    const notes = rows.map((r) => ({
      date: normaliseDate(r.D), docNumber: r.INV, customer: r.CUST || 'No customer',
      rep: resolveRep(r.SP), amount: Number(r.NETT) || 0,
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
      ok: true, company: 'south', range: { start, end }, generatedAt: new Date().toISOString(),
      notes, reps,
      totals: { count: notes.length, value: totalValue },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message, notes: [], reps: [], totals: { count: 0, value: 0 } }, { status: 500 });
  }
}
