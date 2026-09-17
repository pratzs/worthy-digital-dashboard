/** TEMPORARY. Does a per-item typical cost give a defensible margin? */
import { NextResponse } from 'next/server';
import { ostendoSql } from '@/lib/ostendo';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const FY = `h.INVOICEDATE BETWEEN '2026-04-01' AND '2026-09-16'`;
const L  = `SALESINVOICELINES l JOIN SALESINVOICEHEADER h ON h.INVOICENUMBER = l.INVOICENUMBER`;

export async function GET() {
  // Every distinct unit cost each item was invoiced at, with how much quantity
  // went out at that cost. The typical cost is then the quantity-weighted median.
  const rows = await ostendoSql(`
    SELECT l.LINECODE AS CODE, l.INVOICEUNITCOST AS UC,
           SUM(l.INVOICEQTY) AS QTY, COUNT(*) AS LINES
    FROM ${L} WHERE ${FY} AND l.CODETYPE='Item Code' AND l.INVOICEQTY > 0
    GROUP BY 1, 2`).catch(e => ({ error: e.message }));
  if (rows.error) return NextResponse.json(rows, { status: 502 });

  const byItem = new Map();
  for (const r of rows) {
    const code = r.CODE, uc = Number(r.UC) || 0, qty = Number(r.QTY) || 0;
    if (!byItem.has(code)) byItem.set(code, []);
    byItem.get(code).push({ uc, qty });
  }
  const typical = new Map();
  for (const [code, list] of byItem) {
    list.sort((a, b) => a.uc - b.uc);
    const total = list.reduce((s, x) => s + x.qty, 0);
    let run = 0, pick = list[0]?.uc ?? 0;
    for (const x of list) { run += x.qty; if (run >= total / 2) { pick = x.uc; break; } }
    typical.set(code, pick);
  }

  // Apply it back across the year.
  const actual = await ostendoSql(`
    SELECT l.LINECODE AS CODE, SUM(l.INVOICEQTY) AS QTY,
           SUM(l.EXTENDEDNETTPRICE) AS NETT, SUM(l.INVOICEQTY * l.INVOICEUNITCOST) AS COST
    FROM ${L} WHERE ${FY} AND l.CODETYPE='Item Code' AND l.INVOICEQTY > 0
    GROUP BY 1`);

  let rev = 0, costInvoiced = 0, costTypical = 0;
  const worst = [];
  for (const r of actual) {
    const q = Number(r.QTY) || 0, nett = Number(r.NETT) || 0, ci = Number(r.COST) || 0;
    const ct = q * (typical.get(r.CODE) ?? 0);
    rev += nett; costInvoiced += ci; costTypical += ct;
    if (ci - ct > 500) worst.push({ code: r.CODE, overstated: Math.round(ci - ct) });
  }
  worst.sort((a, b) => b.overstated - a.overstated);

  return NextResponse.json({
    revenue: rev,
    costInvoiced, marginInvoiced: ((rev - costInvoiced) / rev * 100).toFixed(1),
    costTypical,  marginTypical:  ((rev - costTypical)  / rev * 100).toFixed(1),
    costOverstatedBy: costInvoiced - costTypical,
    itemsAffected: worst.length, worstItems: worst.slice(0, 12),
  });
}
