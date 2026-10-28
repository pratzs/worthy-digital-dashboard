/**
 * The rep's action plan: ranked opportunities worked out by rules from the rep's OWN figures, each with the
 * exact numbers behind it as plain-sentence evidence. The assistant explains these in friendly words; it is
 * not left to invent suggestions, so every recommendation can be traced back to a figure the rep can check.
 * Pure (no network, no framework imports) so it is tested on its own: scripts/rep-leak-test.mjs.
 *
 * Inputs are the already-scoped answers for ONE rep: sales (projectSales), customers (projectCustomers),
 * products (projectBestSellers) and debtors (projectDebtors). Nothing here can reach another rep's data.
 */

const money = (n) => `$${Math.round(Number(n) || 0).toLocaleString('en-NZ')}`;
const pct = (n) => (n === null || n === undefined ? '' : `${Math.round(n)}%`);
const shortDate = (iso) => {
  if (!iso) return 'unknown';
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
  return d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
};

const monthName = (key) => {
  const [y, m] = String(key).split('-').map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, 1)).toLocaleDateString('en-NZ', { month: 'long', year: 'numeric', timeZone: 'UTC' });
};
const change = (now, before) => {
  if (!(before > 0)) return 'new';
  const ratio = now / before;
  if (ratio >= 5) return `more than ${Math.floor(ratio)} times higher`;
  return `${ratio >= 1 ? 'up' : 'down'} ${Math.round(Math.abs(ratio - 1) * 100)}%`;
};
const MAX_ITEMS = 10, MAX_PER_TYPE = 3;

export function buildActionPlan({ rep, sales, customers, products, debtors }) {
  const asOf = sales?.asOf || customers?.asOf || products?.asOf || null;
  const list = [];
  const add = (o) => list.push(o);

  // 1. Pace against target
  const tp = sales?.targetProgress;
  if (tp) {
    const ev = [];
    if (tp.percentOfBudgetToDate !== null) {
      ev.push(`Year to ${shortDate(tp.asOf)}: you have sold ${money(tp.actualYearToDate)} against a budget to date of ${money(tp.yearBudgetToDate)} (${pct(tp.percentOfBudgetToDate)}), so you are ${tp.aheadOrBehind >= 0 ? 'ahead by' : 'behind by'} ${money(Math.abs(tp.aheadOrBehind))}.`);
    }
    const m = tp.thisMonth;
    if (m) {
      ev.push(`This month (${monthName(m.month)}): ${money(m.soFar)} of your ${money(m.budget)} budget (${pct(m.percentOfMonthBudget)}) with ${pct(m.percentOfMonthElapsed)} of the month gone.`);
      if (m.stillToSell > 0 && m.daysLeftInMonth > 0) ev.push(`To reach this month's budget you need about ${money(m.neededPerRemainingDay)} a day for the remaining ${m.daysLeftInMonth} days (${money(m.stillToSell)} still to sell).`);
      else if (m.stillToSell === 0) ev.push('You have already reached this month\'s budget.');
    }
    if (ev.length) add({ type: 'target', title: 'Where you are against your target', action: tp.aheadOrBehind < 0 ? 'Focus the next few weeks on the customers and products below to close the gap.' : 'Keep the pace and protect your biggest customers.', evidence: ev, atStake: tp.aheadOrBehind < 0 ? Math.abs(tp.aheadOrBehind) : null });
  }

  // 2. Customers who have gone quiet
  for (const c of (customers?.quietCustomers || []).filter((x) => x.revenueThisYear + x.revenueBeforeThisYear >= 2000).slice(0, 5)) {
    add({ type: 'quiet_customer', title: `Call ${c.customer}`, action: 'Phone or visit to find out why they have stopped ordering and offer to restock.',
      evidence: [`${c.customer}: last order ${shortDate(c.lastOrder)} (${c.daysSinceLastOrder} days ago).`,
        `Invoiced ${money(c.revenueThisYear)} this financial year and ${money(c.revenueBeforeThisYear)} in the 12 months before it started.`],
      atStake: c.revenueThisYear + c.revenueBeforeThisYear });
  }

  // 3. Overdue accounts to chase (not intercompany)
  const owing = (debtors?.customers || []).filter((c) => !c.intercompany && Number(c.overdue) > 0).sort((a, b) => b.overdue - a.overdue).slice(0, 5);
  for (const c of owing) {
    add({ type: 'overdue_account', title: `Chase ${c.name}`, action: c.oldestDays > 90 ? 'This one is very overdue. Check with the accounts team on the best way to approach it before you chase.' : 'Send a friendly reminder with the invoice numbers and ask for a payment date.',
      evidence: [`${c.name}: ${money(c.total)} owing (incl GST), of which ${money(Math.min(c.overdue, c.total))} is overdue; oldest item ${c.oldestDays} days past due.`],
      atStake: Math.min(c.overdue, c.total) });
  }

  // 4. Customers slipping
  for (const c of (customers?.slippingCustomers || []).slice(0, 3)) {
    const down = c.previous90DaysRevenue > 0 ? ((c.previous90DaysRevenue - c.last90DaysRevenue) / c.previous90DaysRevenue) * 100 : null;
    add({ type: 'slipping_customer', title: `${c.customer} is ordering less`, action: 'Check in on what has changed (range, price, a competitor) before they drift further.',
      evidence: [`${c.customer}: ${money(c.last90DaysRevenue)} in the last 90 days vs ${money(c.previous90DaysRevenue)} in the 90 days before (down ${pct(down)}); last order ${shortDate(c.lastOrder)}.`],
      atStake: c.previous90DaysRevenue - c.last90DaysRevenue });
  }

  // 5. Customers growing (upsell and protect)
  for (const c of (customers?.growingCustomers || []).slice(0, 3)) {
    const started = !(c.previous90DaysRevenue > 0);
    add({ type: 'growing_customer', title: started ? `${c.customer} has started ordering` : `${c.customer} is growing`,
      action: started ? 'Make sure they are happy, and show them more of your range while they are warm.' : 'Thank them, and show them more of your range while they are buying well.',
      evidence: [`${c.customer}: ${money(c.last90DaysRevenue)} in the last 90 days vs ${money(c.previous90DaysRevenue)} in the 90 days before.`],
      atStake: c.last90DaysRevenue - c.previous90DaysRevenue });
  }

  // 6. Products slowing and growing
  for (const p of (products?.slowingProducts || []).filter((x) => x.previous90DaysRevenue >= 1000).slice(0, 3)) {
    add({ type: 'slowing_product', title: `${p.product} is slowing`, action: 'Ask your customers whether price, stock or a competitor is the reason, and whether a promotion would help.',
      evidence: [`${p.product}: ${money(p.last90DaysRevenue)} in the last 90 days vs ${money(p.previous90DaysRevenue)} in the 90 days before (${pct(p.changePct)}); ${money(p.revenueThisYear)} this financial year.`],
      atStake: p.previous90DaysRevenue - p.last90DaysRevenue });
  }
  for (const p of (products?.growingProducts || []).filter((x) => x.last90DaysRevenue >= 1000).slice(0, 3)) {
    add({ type: 'growing_product', title: `${p.product} is selling better`, action: 'Offer it to customers who have not bought it yet.',
      evidence: [`${p.product}: ${money(p.last90DaysRevenue)} in the last 90 days vs ${money(p.previous90DaysRevenue)} in the 90 days before (${change(p.last90DaysRevenue, p.previous90DaysRevenue)}).`],
      atStake: p.last90DaysRevenue - p.previous90DaysRevenue });
  }

  // 7. Dependence on a few customers
  const s = customers?.summary;
  if (s && s.top5CustomersSharePct !== null && s.top5CustomersSharePct >= 50) {
    const top = (customers.topCustomers || []).slice(0, 3).map((c) => `${c.customer} ${money(c.revenueThisYear)}`).join(', ');
    add({ type: 'concentration', title: 'A lot of your sales rest on a few customers', action: 'Look after those customers closely, and add a few new accounts to spread the risk.',
      evidence: [`Your top 5 customers make up ${pct(s.top5CustomersSharePct)} of your ${money(s.totalInvoicedThisYear)} invoiced this financial year (top three: ${top}).`],
      atStake: null });
  }

  // Keep it short for a busy rep: the target first, then the biggest dollar amounts, no more than three of any one kind.
  const first = list.filter((o) => o.type === 'target');
  const rest = list.filter((o) => o.type !== 'target').sort((a, b) => (b.atStake ?? -1) - (a.atStake ?? -1));
  const perType = {};
  const picked = [...first];
  for (const o of rest) {
    if (picked.length >= MAX_ITEMS) break;
    perType[o.type] = (perType[o.type] || 0) + 1;
    if (perType[o.type] <= MAX_PER_TYPE) picked.push(o);
  }
  list.length = 0; list.push(...picked);
  list.forEach((o, i) => { o.rank = i + 1; });
  return {
    rep: rep.label, asOf,
    howToUse: 'Each item is worked out from the rep own figures, biggest dollar amounts first (at most 10). Give the rep the top 3 or 4, with the evidence, in friendly words, and do not add numbers that are not shown here. More detail is available from my_customers and my_best_sellers.',
    opportunities: list,
    note: list.length ? null : 'Nothing stands out right now. Ask about your customers or best sellers for more detail.',
  };
}
