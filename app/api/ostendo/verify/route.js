/**
 * TEMPORARY — independent check of /api/ostendo/fy. Delete once the audit is done.
 *
 * Deliberately shares nothing with the route it checks:
 *   - `>= start AND < dayAfter(end)` instead of `BETWEEN start AND end`, so a
 *     boundary bug cannot hide behind the same predicate. (A previous check of
 *     South reused BETWEEN and therefore could never have caught one.)
 *   - aggregates per INVOICE inside a subquery, then adds up in JavaScript,
 *     instead of grouping by day and salesperson in SQL.
 *   - counts DISTINCT invoice numbers rather than COUNT(*) over a grouped header.
 */
import { NextResponse } from 'next/server';
import { ostendoSql, q } from '@/lib/ostendo';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const dayAfter = (iso) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};
const n = (v) => Number(v) || 0;
const r2 = (v) => Math.round(v * 100) / 100;

export async function GET(request) {
  const p = new URL(request.url).searchParams;
  const start = p.get('start'), end = p.get('end');
  if (!start || !end) return NextResponse.json({ error: 'start & end required' }, { status: 400 });
  const stop = dayAfter(end);
  const WINDOW = `h.INVOICEDATE >= ${q(start)} AND h.INVOICEDATE < ${q(stop)}`;

  try {
    // One row per invoice: its type, its rep, its header nett, and its line sums.
    const perInvoice = await ostendoSql(`
      SELECT h.INVOICENUMBER AS INV,
             MAX(h.INVOICEORCREDIT) AS OC,
             MAX(h.SALESPERSON) AS SP,
             MAX(h.INVOICENETTAMOUNT) AS HDRNETT,
             MAX(h.INVOICETOTALAMOUNT) AS HDRTOTAL,
             SUM(CASE WHEN l.CODETYPE = 'Item Code' THEN l.EXTENDEDNETTPRICE ELSE 0 END) AS ITEMREV,
             SUM(CASE WHEN l.CODETYPE <> 'Item Code' THEN l.EXTENDEDNETTPRICE ELSE 0 END) AS OTHERREV,
             SUM(l.INVOICEQTY * l.INVOICEUNITCOST) AS COST
      FROM SALESINVOICEHEADER h
      LEFT JOIN SALESINVOICELINES l ON l.INVOICENUMBER = h.INVOICENUMBER
      WHERE ${WINDOW}
      GROUP BY h.INVOICENUMBER`, 110000);

    // Distinct invoice numbers, counted by the database, as a separate opinion.
    const counted = await ostendoSql(`
      SELECT COUNT(DISTINCT h.INVOICENUMBER) AS DOCS
      FROM SALESINVOICEHEADER h WHERE ${WINDOW}`, 60000);

    let revenue = 0, rebates = 0, cost = 0, headerNett = 0, headerTotal = 0;
    let invoices = 0, credits = 0, creditValue = 0;
    const byRep = new Map();
    for (const row of perInvoice) {
      const isCredit = String(row.OC ?? '').toLowerCase().startsWith('cred');
      const item = n(row.ITEMREV), other = n(row.OTHERREV), c = n(row.COST);
      revenue += item; rebates += other; cost += c;
      headerNett += n(row.HDRNETT); headerTotal += n(row.HDRTOTAL);
      if (isCredit) { credits += 1; creditValue += n(row.HDRNETT); } else { invoices += 1; }
      const rep = String(row.SP ?? '').trim() || '(none)';
      if (!byRep.has(rep)) byRep.set(rep, { revenue: 0, cost: 0, invoices: 0, credits: 0 });
      const b = byRep.get(rep);
      b.revenue += item; b.cost += c;
      if (isCredit) b.credits += 1; else b.invoices += 1;
    }

    return NextResponse.json({
      window: `${start} <= INVOICEDATE < ${stop}`,
      documents: { fromRows: perInvoice.length, fromCountDistinct: n(counted?.[0]?.DOCS),
                   agree: perInvoice.length === n(counted?.[0]?.DOCS) },
      totals: {
        revenue: r2(revenue), rebates: r2(rebates), netSales: r2(revenue + rebates),
        cost: r2(cost), grossProfit: r2(revenue - cost),
        marginPct: revenue > 0 ? Math.round(((revenue - cost) / revenue) * 1000) / 10 : null,
        invoices, credits, creditValue: r2(creditValue),
        headerNettAmount: r2(headerNett), headerTotalAmount: r2(headerTotal),
        gstRatio: headerNett !== 0 ? Math.round((headerTotal / headerNett) * 10000) / 10000 : null,
      },
      reps: [...byRep].map(([code, v]) => ({
        code, revenue: r2(v.revenue), cost: r2(v.cost),
        grossProfit: r2(v.revenue - v.cost),
        marginPct: v.revenue > 0 ? Math.round(((v.revenue - v.cost) / v.revenue) * 1000) / 10 : null,
        invoices: v.invoices, credits: v.credits,
      })).sort((a, b) => b.revenue - a.revenue),
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
