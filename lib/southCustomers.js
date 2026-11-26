/**
 * Customer margin for Worthy Products South / Dutch Rusk (Ostendo), 27 Nov 2026.
 *
 * Per store (DELIVERYCUSTOMER: the shop that receives the goods; a billing account such as Foodstuffs covers many), on
 * exactly the basis of the Dutch Rusk headline (lib/ostendoFy.js): sales = stock product lines, cost = the line cost
 * (item-master cost where the line has none and that is safe), margin on the lines with a believable cost only (the
 * "suspect" lines are left out of the margin, as the headline does), ad hoc ZZZSTOCK lines costed by lib/southAdhoc.js.
 * Read-only SQL against Ostendo, shared copy for 30 minutes (one read at a time).
 */
import { ostendoSql, q, resolveRep, nzToday, EFF_UNIT_COST_H as EFF_UNIT_COST, ITEM_JOIN } from '@/lib/ostendo';
import { STOCK_LINE, SUSPECT } from '@/lib/ostendoFy';
import { adhocLines } from '@/lib/southAdhoc';
import { readWeeks } from '@/lib/odooWeeksCache';

const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const pct = (gp, rev) => (rev > 0 ? Math.round((gp / rev) * 1000) / 10 : null);

async function compute(from, to) {
  const [rows, adhoc] = await Promise.all([
    ostendoSql(`
      SELECT TRIM(h.DELIVERYCUSTOMER) AS C, h.SALESPERSON AS SP,
             SUM(CASE WHEN ${STOCK_LINE} THEN l.EXTENDEDNETTPRICE ELSE 0 END) AS REV,
             SUM(l.INVOICEQTY * ${EFF_UNIT_COST}) AS COST,
             SUM(CASE WHEN ${SUSPECT} THEN l.EXTENDEDNETTPRICE ELSE 0 END) AS SUSREV,
             SUM(CASE WHEN ${SUSPECT} THEN l.INVOICEQTY * ${EFF_UNIT_COST} ELSE 0 END) AS SUSCOST,
             SUM(CASE WHEN ${STOCK_LINE} THEN l.INVOICEQTY * l.CUSTOMERUNITPRICE - l.EXTENDEDNETTPRICE ELSE 0 END) AS DISC
      FROM SALESINVOICELINES l
      JOIN SALESINVOICEHEADER h ON h.INVOICENUMBER = l.INVOICENUMBER
      ${ITEM_JOIN}
      WHERE h.INVOICEDATE BETWEEN ${q(from)} AND ${q(to)}
      GROUP BY 1, 2`, 90000),
    adhocLines(from, to),
  ]);
  const C = new Map();
  const get = (name) => { const k = name || 'No customer'; if (!C.has(k)) C.set(k, { rev: 0, cost: 0, susRev: 0, susCost: 0, disc: 0, people: {} }); return C.get(k); };
  for (const r of rows) {
    const c = get(String(r.C || '').trim()); const rev = Number(r.REV) || 0;
    c.rev += rev; c.cost += Number(r.COST) || 0; c.susRev += Number(r.SUSREV) || 0; c.susCost += Number(r.SUSCOST) || 0; c.disc += Number(r.DISC) || 0;
    const who = resolveRep(r.SP); c.people[who] = (c.people[who] || 0) + rev;
  }
  // Ad hoc lines with a cost found: their cost counts and they come back into the margin (as the headline)
  for (const a of adhoc) {
    if (a.cost == null) continue;
    const c = get(a.deliveryCustomer || a.customer);
    c.cost += a.cost; c.susRev -= a.revenue;
  }
  const list = [...C].map(([name, c]) => {
    const mRev = c.rev - c.susRev, mCost = c.cost - c.susCost;
    return { name, revenue: c.rev, costedRevenue: mRev, cost: mCost, discount: c.disc, people: c.people };
  });
  const tot = list.reduce((t, c) => ({ rev: t.rev + c.revenue, crev: t.crev + c.costedRevenue, cost: t.cost + c.cost }), { rev: 0, crev: 0, cost: 0 });
  const all = pct(tot.crev - tot.cost, tot.crev);
  const customers = list.map((c) => {
    const r = tot.crev - c.costedRevenue, k = tot.cost - c.cost; const without = pct(r - k, r);
    return { name: c.name, revenue: r2(c.revenue), costedRevenue: r2(c.costedRevenue), cost: r2(c.cost), grossProfit: r2(c.costedRevenue - c.cost),
      marginPct: pct(c.costedRevenue - c.cost, c.costedRevenue), discount: r2(c.discount), belowCostLoss: 0,
      share: tot.rev > 0 ? Math.round((c.revenue / tot.rev) * 1000) / 10 : 0,
      people: Object.entries(c.people).sort((a, b) => b[1] - a[1]).map(([n]) => n),
      pullPts: without == null || all == null ? null : Math.round((without - all) * 10) / 10 };
  }).filter((c) => Math.abs(c.revenue) >= 0.5).sort((a, b) => b.revenue - a.revenue);
  return { company: 'south', companyName: 'Worthy Products South (Dutch Rusk)', from, to, generatedAt: new Date().toISOString(),
    revenue: r2(tot.rev), costedRevenue: r2(tot.crev), cost: r2(tot.cost), grossProfit: r2(tot.crev - tot.cost), marginPct: all, customers };
}

export async function southCustomers(from, to) {
  const today = nzToday(); if (to > today) to = today;
  const { payload } = await readWeeks('sc', `${from}_${to}`, () => compute(from, to), { freshMs: to >= today ? 30 * 60000 : 6 * 3600000 });
  return payload;
}
