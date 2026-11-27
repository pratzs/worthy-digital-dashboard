/**
 * Ecom and Marketing weekly summary for the Command Center (27 Nov 2026). Last week (Monday to Sunday) against the week
 * before, from readers the Command Center already uses, each behind its saved copy:
 *   online sales and orders per shop (every channel except Point of Sale) and shop visits / conversion  lib/webStats.js
 *   gross profit and margin on the online orders invoiced so far                                       lib/onlineMargin.js
 *   worthy.nz visits and enquiries                                                                        lib/webStats.js (GA4)
 *   non-branded search clicks                                                                             lib/command.js (Search Console)
 *   social views and engagements                                                                          lib/socialMeta.js
 *   ad spend and visits from ads, month to date                                                           lib/adSpend.js
 *   meeting points to discuss and actions sent to Asana                                                   lib/meeting.js
 * A draft: shown with Copy and Open as email draft; nothing is sent from here. Company sales, salespeople's margins and
 * stock are the management summary (lib/weeklySummary.js), on the dashboard Overview.
 */
import { nzToday } from '@/lib/ostendo';
import { webStats, customPeriods } from '@/lib/webStats';
import { onlineMargin } from '@/lib/onlineMargin';
import { searchForRange } from '@/lib/command';
import { metaStats } from '@/lib/socialMeta';
import { adSpend } from '@/lib/adSpend';
import { readMeeting } from '@/lib/meeting';

const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = (iso, year = true) => `${Number(iso.slice(8, 10))} ${MON[Number(iso.slice(5, 7)) - 1]}${year ? ` ${iso.slice(0, 4)}` : ''}`;
const money = (v) => (v == null ? '-' : `$${Math.round(v).toLocaleString('en-NZ')}`);
const n0 = (v) => (v == null ? '-' : Math.round(v).toLocaleString('en-NZ'));
const chg = (a, b) => (a == null || !b ? null : Math.round(((a - b) / b) * 1000) / 10);
const chgTxt = (c) => (c == null ? '' : ` (${c >= 0 ? 'up' : 'down'} ${Math.abs(c).toFixed(1)}% on the week before)`);
const safe = async (f) => { try { return await f(); } catch (e) { return { error: String(e.message || e).slice(0, 120) }; } };

export async function ecomSummary() {
  const today = nzToday();
  const wd = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
  const end = addDays(today, -wd - 1), start = addDays(end, -6);
  const period = customPeriods({ from: start, to: end }, today);
  const monthStart = `${end.slice(0, 7)}-01`;
  const [web, om, search, social, ads, meet] = await Promise.all([
    safe(() => webStats({ period })),
    safe(() => onlineMargin('all', start, end)),
    safe(() => searchForRange(start, end)),
    safe(() => metaStats({ period })),
    safe(() => adSpend(monthStart, end)),
    safe(() => readMeeting()),
  ]);
  const site = (id) => (web?.sites || []).find((x) => x.id === id && x.status === 'ok');
  const partOf = (id) => (om && !om.error ? (om.parts || []).find((p) => p.shop === id) : null);
  const shops = ['worthyproducts', 'dutchrusk'].map(site).filter(Boolean).map((x) => {
    const p = partOf(x.id);
    return {
      id: x.id, name: x.name, sales: x.totals?.revenue || [0, 0], orders: x.totals?.orders || [0, 0], visits: x.totals?.sessions || [0, 0], conversion: x.totals?.conversion || [null, null],
      // Gross profit and margin on this shop's online orders invoiced so far (lib/onlineMargin.js)
      margin: p && p.marginPct != null ? { grossProfit: p.grossProfit, marginPct: p.marginPct, invoicedOrders: p.invoicedOrders, orders: p.orders } : null,
    };
  });
  const wn = site('worthy');
  const company = wn ? { visits: wn.totals?.sessions || [0, 0], enquiries: wn.totals?.keyEvents || [0, 0] } : null;
  const sum = (k, i) => shops.reduce((t, x) => t + (x[k]?.[i] || 0), 0);
  const online = { sales: [sum('sales', 0), sum('sales', 1)], orders: [sum('orders', 0), sum('orders', 1)], visits: [sum('visits', 0), sum('visits', 1)] };
  const okSearch = Array.isArray(search) ? search.filter((s) => s.status === 'ok') : [];
  const nb = !okSearch.length ? null : okSearch.reduce((t, s) => [t[0] + (s.totals?.nonBrandedClicks?.[0] || 0), t[1] + (s.totals?.nonBrandedClicks?.[1] || 0)], [0, 0]);
  const accts = social?.accounts || [];
  const views = accts.length ? accts.reduce((t, a) => [t[0] + (a.totals?.views?.[0] || 0), t[1] + (a.totals?.views?.[1] || 0)], [0, 0]) : null;
  const eng = accts.length ? accts.reduce((t, a) => [t[0] + (a.totals?.engagements?.[0] || 0), t[1] + (a.totals?.engagements?.[1] || 0)], [0, 0]) : null;
  const adRows = [...(ads?.google?.rows || []), ...(ads?.meta?.rows || [])].filter((r) => r.month === end.slice(0, 7));
  const ad = { spend: adRows.reduce((t, r) => t + (r.amount || 0), 0), visits: adRows.some((r) => r.visits != null) ? adRows.reduce((t, r) => t + (r.visits || 0), 0) : null };
  const points = (meet?.points || []).filter((p) => p.status === 'open').length;
  const sent = (meet?.actions || []).filter((a) => a.status === 'sent').length;

  const L = [`Ecom and Marketing, week ${day(start, false)} to ${day(end)}`, ''];
  L.push(`Online sales: ${money(online.sales[0])} from ${n0(online.orders[0])} orders${chgTxt(chg(online.sales[0], online.sales[1]))}`);
  for (const x of shops) L.push(`  ${x.name}: ${money(x.sales[0])}, ${n0(x.orders[0])} orders, ${n0(x.visits[0])} NZ visits${x.conversion[0] != null ? `, ${(x.conversion[0] * 100).toFixed(2)}% converted` : ''}${x.margin ? `, gross profit ${money(x.margin.grossProfit)} at ${x.margin.marginPct}% margin (${n0(x.margin.invoicedOrders)} of ${n0(x.margin.orders)} orders invoiced)` : ''}`);
  if (om && !om.error && om.marginPct != null) L.push(`Gross profit on online orders invoiced so far: ${money(om.grossProfit)} at ${om.marginPct}% (${n0(om.invoicedOrders)} of ${n0(om.orders)} orders invoiced)`);
  if (company) L.push(`worthy.nz: ${n0(company.visits[0])} visits, ${n0(company.enquiries[0])} enquiries${chgTxt(chg(company.enquiries[0], company.enquiries[1]))}`);
  if (nb) L.push(`Non-branded search clicks: ${n0(nb[0])}${chgTxt(chg(nb[0], nb[1]))}`);
  if (views) L.push(`Social: ${n0(views[0])} views, ${n0(eng?.[0])} engagements${chgTxt(chg(views[0], views[1]))}`);
  L.push(`Ads, ${MON[Number(end.slice(5, 7)) - 1]} to date: ${money(ad.spend)} spent${ad.visits != null ? `, ${n0(ad.visits)} visits from ads` : ''}`);
  L.push('', `Meeting: ${points} points still to discuss, ${sent} ${sent === 1 ? 'action' : 'actions'} sent to Asana.`);

  return {
    generatedAt: new Date().toISOString(), week: { start, end },
    online, shops, margin: om && !om.error ? { grossProfit: om.grossProfit, marginPct: om.marginPct, invoicedOrders: om.invoicedOrders, orders: om.orders } : null,
    company, search: nb, social: views ? { views, engagements: eng } : null, ads: ad, meeting: { points, sent },
    errors: Object.entries({ web, om, search, social, ads, meet }).filter(([, v]) => v?.error).map(([k, v]) => `${k}: ${v.error}`),
    text: L.join('\n'),
  };
}
