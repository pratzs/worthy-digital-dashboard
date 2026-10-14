/**
 * Credit notes for Worthy Products South (Ostendo), one row per credit note.
 *
 * Same shape as /api/odoo/credits (version 2) so one screen serves both companies.
 *
 * Each note's value is split exactly as the Overview splits it:
 *   - PRODUCT credits: the note's stock (Item Code) lines. This is what comes off
 *     sales on the Overview and Sales by Rep.
 *   - REBATES: the note's descriptor lines (Ostendo's "Rebate - ..." line). These
 *     are not product sales; the Overview reports rebates on their own.
 * Product + rebates is the note's full value (the header's net amount), so the two
 * views reconcile to the cent.
 *
 * Who raised it is the Ostendo user that created the note. The reason is what the
 * team typed on the note (its reference and any line note): Ostendo has no log of
 * notes the way Odoo does, so that is the whole of it.
 */
import { NextResponse } from 'next/server';
import { ostendoSql, resolveRep, normaliseDate, nzToday, nzFinancialYear, fyRange, q, toCents, toDollars } from '@/lib/ostendo';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const tidyName = (n) => String(n || 'No customer').replace(/\s+20\d{2}$/, '').trim() || 'No customer';
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
/** A rebate line on a credit note reads "Rebate - Pods Twix": the kind is the first word. */
const kindOfDescriptor = (desc) => (/^rebate/i.test(clean(desc)) ? 'Rebate' : 'Other adjustment');

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const today = nzToday();
  const fy = parseInt(searchParams.get('fy') || '', 10) || nzFinancialYear();
  let start = searchParams.get('startDate');
  let end = searchParams.get('endDate');
  if (!start || !end) { const r = fyRange(fy, today); start = r.start; end = r.end; }
  const between = `${q(start)} AND ${q(end)}`;

  try {
    const [heads, lines, noted, sales] = await Promise.all([
      ostendoSql(
        `SELECT INVOICENUMBER AS INV, INVOICEDATE AS D, CUSTOMER AS CUST, SALESPERSON AS SP,
                SYSUSERCREATED AS WHO, INVOICENETTAMOUNT AS NETT, DIRECTPURCHASEREF AS REF,
                CREDITREASON AS CR, INVOICENOTES AS INOTE
         FROM SALESINVOICEHEADER
         WHERE INVOICEORCREDIT = 'Credit' AND INVOICEDATE BETWEEN ${between}
         ORDER BY INVOICEDATE DESC, INVOICENUMBER DESC`, 55000),
      // per note: what the stock lines and the rebate lines add up to, and the biggest line's text
      ostendoSql(
        `SELECT h.INVOICENUMBER AS INV,
                SUM(CASE WHEN l.CODETYPE = 'Item Code' THEN l.EXTENDEDNETTPRICE ELSE 0 END) AS PRODUCT,
                SUM(CASE WHEN l.CODETYPE = 'Item Code' THEN 0 ELSE l.EXTENDEDNETTPRICE END) AS OTHER,
                SUM(CASE WHEN l.CODETYPE = 'Item Code' THEN 1 ELSE 0 END) AS PRODUCTS,
                MAX(CASE WHEN l.CODETYPE = 'Item Code' THEN '' ELSE l.LINEDESCRIPTION END) AS OTHERDESC
         FROM SALESINVOICELINES l
         JOIN SALESINVOICEHEADER h ON h.INVOICENUMBER = l.INVOICENUMBER
         WHERE h.INVOICEORCREDIT = 'Credit' AND h.INVOICEDATE BETWEEN ${between}
         GROUP BY 1`, 55000),
      ostendoSql(
        `SELECT h.INVOICENUMBER AS INV, l.LINENUMBER AS LN, l.LINEDESCRIPTION AS DESCR, l.LINENOTES AS NOTE,
                l.EXTENDEDNETTPRICE AS AMT, l.CODETYPE AS CT
         FROM SALESINVOICELINES l
         JOIN SALESINVOICEHEADER h ON h.INVOICENUMBER = l.INVOICENUMBER
         WHERE h.INVOICEORCREDIT = 'Credit' AND h.INVOICEDATE BETWEEN ${between}`, 55000),
      // the same period's product sales, so the credits can be put in proportion
      ostendoSql(
        `SELECT SUM(l.EXTENDEDNETTPRICE) AS S
         FROM SALESINVOICELINES l
         JOIN SALESINVOICEHEADER h ON h.INVOICENUMBER = l.INVOICENUMBER
         WHERE h.INVOICEORCREDIT <> 'Credit' AND h.INVOICEDATE BETWEEN ${between} AND l.CODETYPE = 'Item Code'`, 55000)
        .catch(() => null),
    ]);

    const byInv = new Map(lines.map((l) => [String(l.INV), l]));
    // the line that is biggest by value, per note, to say what the note was about
    const biggest = new Map();
    const lineNotes = new Map();
    for (const l of noted) {
      const k = String(l.INV);
      const amt = Math.abs(Number(l.AMT) || 0);
      const cur = biggest.get(k);
      if (!cur || amt > cur.amt) biggest.set(k, { amt, text: clean(l.DESCR), other: String(l.CT) !== 'Item Code' });
      const t = clean(l.NOTE);
      if (t) { const a = lineNotes.get(k) || []; if (!a.includes(t)) a.push(t); lineNotes.set(k, a); }
    }

    const notes = heads.map((h) => {
      const k = String(h.INV);
      const ln = byInv.get(k) || {};
      const productC = toCents(ln.PRODUCT), otherC = toCents(ln.OTHER);
      const totalC = toCents(h.NETT);
      const product = Math.abs(toDollars(productC)), other = Math.abs(toDollars(otherC));
      const kind = Math.abs(productC) >= Math.abs(otherC) ? 'Product credit' : kindOfDescriptor(ln.OTHERDESC);
      const typed = [clean(h.REF), clean(h.INOTE), ...(lineNotes.get(k) || [])].filter(Boolean);
      const wasFor = (/^credit for invoice:\s*(.+)$/i.exec(clean(h.CR)) || [])[1] || '';
      const big = biggest.get(k);
      return {
        date: normaliseDate(h.D), docNumber: h.INV,
        customer: tidyName(h.CUST),
        rep: resolveRep(h.SP),
        raisedBy: clean(h.WHO) || 'Unknown',
        amount: Math.abs(toDollars(totalC)), productAmount: product, otherAmount: other, kind,
        about: (big?.text || '').slice(0, 90),
        lines: Number(ln.PRODUCTS) || 0,
        reason: [...new Set(typed)].join(' | ').slice(0, 600),
        reasonBy: typed.length ? clean(h.WHO) : '',
        note: '',
        creditedInvoice: wasFor,
      };
    });

    const round2 = (n) => Math.round(n * 100) / 100;
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
    const raisers = group((n) => n.raisedBy).map((r) => ({ person: r.key, ...r })).sort((a, b) => b.value - a.value);

    const grossSales = sales && sales[0] ? toDollars(toCents(sales[0].S)) : null;

    return NextResponse.json({
      ok: true, version: 2, company: 'south', system: 'Ostendo', range: { start, end }, generatedAt: new Date().toISOString(),
      otherLabel: 'Rebates',
      otherNote: 'Credits with no product on them: the rebates given to customers',
      reasonNote: 'the reason typed on the credit note in Ostendo',
      notes, reps, months, customers, kinds, raisers,
      totals: { count: notes.length, value: totalValue, productValue, otherValue, grossSales,
                withReason: notes.filter((n) => n.reason).length,
                productPctOfSales: grossSales > 0 ? round2((productValue / grossSales) * 100) : null },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message, notes: [], reps: [], totals: { count: 0, value: 0 } }, { status: 500 });
  }
}
