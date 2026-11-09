/**
 * Cost health for Worthy Products South (Ostendo): which recent invoice lines were issued with NO cost, and what the
 * dashboard did about each one. It exists so a missing cost is noticed and fixed at the source (in Ostendo) instead of
 * quietly bending the margin, as happened in October 2026 (Russ Energy to one customer, 252 lines, $64.5k).
 *
 *   recosted  = Ostendo recorded no cost, the item master holds an average cost, so the dashboard used it (self-healed,
 *               already inside the margin). Still worth fixing in Ostendo so the invoice itself carries the cost.
 *   uncosted  = no cost anywhere (or the master cost looks wrong for the price), so the line is left out of the margin.
 *
 * `summary` is safe to publish (totals only, no names); `detail` names items and customers and is for management only.
 */
import { ostendoSql, q, nzToday, parseIso, iso, normaliseDate, RECOSTABLE, ITEM_JOIN } from '@/lib/ostendo';

const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const FROM = `FROM SALESINVOICELINES l JOIN SALESINVOICEHEADER h ON h.INVOICENUMBER = l.INVOICENUMBER ${ITEM_JOIN}`;
const SALE = "l.CODETYPE = 'Item Code' AND l.INVOICEQTY > 0 AND l.EXTENDEDNETTPRICE > 0";
// Same test as the dashboard: not recosted and still a zero cost.
const UNCOSTED = `(${SALE} AND l.INVOICEUNITCOST = 0 AND NOT ${RECOSTABLE})`;
const KIND = `CASE WHEN ${RECOSTABLE} THEN 'recosted' WHEN ${UNCOSTED} THEN 'uncosted' ELSE 'ok' END`;
const ITEM_KEY = "CASE WHEN l.LINECODE STARTING WITH 'ZZZ' THEN l.LINEDESCRIPTION ELSE l.LINECODE END";

// Alert levels, tunable without a deploy. A trickle of brand-new products sold before their cost is entered (about $3k a
// fortnight, 0.4% of sales) is normal and not worth an email; a bulk invoice with no cost (October 2026: $64.5k) is.
const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
const RECOSTED_ALERT = () => num(process.env.COST_HEALTH_RECOSTED, 5000);   // dollars recosted in the window
const UNCOSTED_ALERT = () => num(process.env.COST_HEALTH_UNCOSTED, 8000);   // dollars left out in the window
const UNCOSTED_SHARE_ALERT = () => num(process.env.COST_HEALTH_UNCOSTED_PCT, 1.5);   // or this % of the window's sales

export function windowOf(days) {
  const d = Math.max(1, Math.min(120, Number(days) || 14));
  const end = nzToday();
  return { days: d, from: iso(new Date(parseIso(end).getTime() - (d - 1) * 86400000)), to: end };
}

export async function southCostHealth({ days = 14, detail = false } = {}) {
  const w = windowOf(days);
  const where = `h.INVOICEDATE BETWEEN ${q(w.from)} AND ${q(w.to)} AND ${SALE}`;
  const [sum] = await ostendoSql(`SELECT SUM(l.EXTENDEDNETTPRICE) AS STOCKREV,
      SUM(CASE WHEN ${RECOSTABLE} THEN l.EXTENDEDNETTPRICE ELSE 0 END) AS RECREV,
      SUM(CASE WHEN ${RECOSTABLE} THEN 1 ELSE 0 END) AS RECLINES,
      SUM(CASE WHEN ${UNCOSTED} THEN l.EXTENDEDNETTPRICE ELSE 0 END) AS UNREV,
      SUM(CASE WHEN ${UNCOSTED} THEN 1 ELSE 0 END) AS UNLINES
    ${FROM} WHERE ${where}`, 60000);
  const rev = Number(sum?.STOCKREV) || 0, rr = Number(sum?.RECREV) || 0, ur = Number(sum?.UNREV) || 0;
  const uncostedHigh = ur >= UNCOSTED_ALERT() || (rev > 0 && (ur / rev) * 100 >= UNCOSTED_SHARE_ALERT());
  const attention = rr >= RECOSTED_ALERT() || uncostedHigh;
  const summary = {
    window: { from: w.from, to: w.to, days: w.days },
    salesInWindow: r2(rev),
    recosted: { lines: Number(sum?.RECLINES) || 0, revenue: r2(rr), shareOfSalesPct: rev > 0 ? r2((rr / rev) * 100) : 0 },
    uncosted: { lines: Number(sum?.UNLINES) || 0, revenue: r2(ur), shareOfSalesPct: rev > 0 ? r2((ur / rev) * 100) : 0 },
    attention,
    why: attention
      ? [rr >= RECOSTED_ALERT() ? `$${Math.round(rr).toLocaleString('en-NZ')} of sales were issued in Ostendo with no cost and were costed from the item master (alert at $${RECOSTED_ALERT().toLocaleString('en-NZ')})` : null,
         uncostedHigh ? `$${Math.round(ur).toLocaleString('en-NZ')} of sales have no cost anywhere and are left out of the margin (alert at $${UNCOSTED_ALERT().toLocaleString('en-NZ')} or ${UNCOSTED_SHARE_ALERT()}% of sales)` : null].filter(Boolean)
      : [],
  };
  if (!detail) return summary;

  const [items, customers] = await Promise.all([
    ostendoSql(`SELECT ${ITEM_KEY} AS CODE, MAX(l.LINEDESCRIPTION) AS NAME, ${KIND} AS KIND, COUNT(*) AS LN, SUM(l.EXTENDEDNETTPRICE) AS REV,
        MAX(im.AVERAGECOST) AS AVGCOST, MAX(im.STDBUYPRICE) AS STD, MIN(h.INVOICEDATE) AS D1, MAX(h.INVOICEDATE) AS D2
      ${FROM} WHERE ${where} AND (${RECOSTABLE} OR ${UNCOSTED}) GROUP BY 1, 3 ORDER BY 5 DESC`, 60000),
    ostendoSql(`SELECT h.CUSTOMER AS C, ${KIND} AS KIND, COUNT(*) AS LN, SUM(l.EXTENDEDNETTPRICE) AS REV
      ${FROM} WHERE ${where} AND (${RECOSTABLE} OR ${UNCOSTED}) GROUP BY 1, 2 ORDER BY 4 DESC`, 60000),
  ]);
  return {
    ...summary,
    howToFix: 'In Ostendo, set the cost on these items (and on the invoice lines if they must carry it). recosted = the dashboard already used the item master average cost; uncosted = no usable cost exists, so the line is out of the margin until one is entered.',
    items: (items || []).filter((r) => String(r.CODE ?? '').trim()).slice(0, 25).map((r) => ({
      item: String(r.CODE).trim(), description: String(r.NAME || '').trim(), status: String(r.KIND).trim(), lines: Number(r.LN) || 0, revenue: r2(r.REV),
      masterAverageCost: Number(r.AVGCOST) || null, masterStandardBuyPrice: Number(r.STD) || null, firstInvoice: normaliseDate(r.D1), lastInvoice: normaliseDate(r.D2),
    })),
    customers: (customers || []).slice(0, 15).map((r) => ({ customer: String(r.C || '').trim(), status: String(r.KIND).trim(), lines: Number(r.LN) || 0, revenue: r2(r.REV) })),
  };
}
