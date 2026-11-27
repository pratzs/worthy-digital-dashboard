/**
 * Website figures for the Social and Web page (management only).
 *
 *   worthy.nz          WordPress site: Google Analytics 4 (lib/ga4.js)
 *   worthyproducts.nz  Shopify Plus: Shopify's own figures (ShopifyQL, the dashboard's existing store token)
 *   dutchrusk.co.nz    Shopify Plus: Shopify's own figures (ShopifyQL through the Dutch Rusk Catalog Manager app's
 *                      /api/shopifyql, key DUTCHRUSK_REPORTS_KEY; that app refreshes its own expiring token)
 *
 * Periods: the last 30 complete New Zealand days, against the 30 days before them, plus the last 12 months.
 */
import { unstable_cache } from 'next/cache';
import { ga4Configured, ga4Property, ga4Report } from '@/lib/ga4';
import { nzToday } from '@/lib/ostendo';

const addDays = (iso, n) => new Date(new Date(`${iso}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);

export function periods(today = nzToday()) {
  const end = addDays(today, -1), start = addDays(end, -29);
  const prevEnd = addDays(start, -1), prevStart = addDays(prevEnd, -29);
  const m = new Date(`${today.slice(0, 7)}-01T00:00:00Z`); m.setUTCMonth(m.getUTCMonth() - 11);
  return { start, end, prevStart, prevEnd, yearStart: m.toISOString().slice(0, 10) };
}

export const SITES = [
  { id: 'worthy',         name: 'worthy.nz',         source: 'ga4' },
  { id: 'worthyproducts', name: 'worthyproducts.nz', source: 'shopify' },
  { id: 'dutchrusk',      name: 'dutchrusk.co.nz',   source: 'shopify' },
];

// ── Google Analytics 4 ─────────────────────────────────────────────────────────────────────────────
const GA_TOTALS = ['activeUsers', 'newUsers', 'sessions', 'engagedSessions', 'screenPageViews', 'keyEvents', 'ecommercePurchases', 'purchaseRevenue'];

async function gaSite(site, p) {
  const prop = ga4Property(site.id);
  if (!ga4Configured()) return { ...site, status: 'not_connected' };
  if (!prop) return { ...site, status: 'no_property' };
  const range = (a, b) => [{ startDate: a, endDate: b }];
  const [cur, prev, channels, pages, devices, months] = await Promise.all([
    ga4Report(prop, { dateRanges: range(p.start, p.end), metrics: GA_TOTALS.map((name) => ({ name })) }),
    ga4Report(prop, { dateRanges: range(p.prevStart, p.prevEnd), metrics: GA_TOTALS.map((name) => ({ name })) }),
    ga4Report(prop, { dateRanges: range(p.start, p.end), dimensions: [{ name: 'sessionDefaultChannelGroup' }], metrics: [{ name: 'sessions' }, { name: 'keyEvents' }],
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: 10 }),
    ga4Report(prop, { dateRanges: range(p.start, p.end), dimensions: [{ name: 'pagePath' }], metrics: [{ name: 'screenPageViews' }, { name: 'activeUsers' }],
      orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }], limit: 10 }),
    ga4Report(prop, { dateRanges: range(p.start, p.end), dimensions: [{ name: 'deviceCategory' }], metrics: [{ name: 'sessions' }],
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }] }),
    ga4Report(prop, { dateRanges: range(p.yearStart, p.end), dimensions: [{ name: 'yearMonth' }], metrics: [{ name: 'activeUsers' }, { name: 'sessions' }],
      orderBys: [{ dimension: { dimensionName: 'yearMonth' } }] }),
  ]);
  const t = (rows) => { const r = rows[0] || {}; return Object.fromEntries(GA_TOTALS.map((k) => [k, r[k] || 0])); };
  const c = t(cur), pv = t(prev);
  return {
    ...site, status: 'ok',
    totals: {
      visitors: [c.activeUsers, pv.activeUsers], newVisitors: [c.newUsers, pv.newUsers], sessions: [c.sessions, pv.sessions],
      engagedRate: [c.sessions ? c.engagedSessions / c.sessions : null, pv.sessions ? pv.engagedSessions / pv.sessions : null],
      pageViews: [c.screenPageViews, pv.screenPageViews], keyEvents: [c.keyEvents, pv.keyEvents],
      orders: c.ecommercePurchases || pv.ecommercePurchases ? [c.ecommercePurchases, pv.ecommercePurchases] : null,
      revenue: c.purchaseRevenue || pv.purchaseRevenue ? [c.purchaseRevenue, pv.purchaseRevenue] : null,
    },
    sources: channels.map((r) => ({ name: r.sessionDefaultChannelGroup, sessions: r.sessions, keyEvents: r.keyEvents })),
    pages: pages.map((r) => ({ name: r.pagePath, views: r.screenPageViews, visitors: r.activeUsers })),
    devices: devices.map((r) => ({ name: r.deviceCategory, sessions: r.sessions })),
    months: months.map((r) => ({ month: `${r.yearMonth.slice(0, 4)}-${r.yearMonth.slice(4)}`, visitors: r.activeUsers, sessions: r.sessions })),
  };
}

// ── Shopify (ShopifyQL) ────────────────────────────────────────────────────────────────────────────
const DR_REPORTS_URL = 'https://dutch-rusk-catalog-manager.onrender.com/api/shopifyql';
const shopifyConnected = (id) => Boolean(id === 'dutchrusk' ? process.env.DUTCHRUSK_REPORTS_KEY : process.env.SHOPIFY_ACCESS_TOKEN_WORTHY);

export async function shopifyql(q, id = 'worthyproducts') {
  if (id === 'dutchrusk') {
    const res = await fetch(DR_REPORTS_URL, {
      method: 'POST',
      headers: { 'x-reports-key': process.env.DUTCHRUSK_REPORTS_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q }),
      signal: AbortSignal.timeout(45000),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.rows) throw new Error(`Dutch Rusk Shopify report failed (${res.status}): ${String(j.error || '').slice(0, 200)}`);
    return j.rows;
  }
  const res = await fetch(`https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/2026-01/graphql.json`, {
    method: 'POST',
    headers: { 'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN_WORTHY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'query($q:String!){ shopifyqlQuery(query:$q){ tableData{ rows } parseErrors } }', variables: { q } }),
    signal: AbortSignal.timeout(30000),
  });
  const j = await res.json();
  const s = j.data?.shopifyqlQuery;
  if (!s || s.parseErrors?.length) throw new Error(`Shopify report failed: ${JSON.stringify(s?.parseErrors || j.errors).slice(0, 200)}`);
  return s.tableData?.rows || [];
}
const num = (v) => Number(v) || 0;

async function shopifySite(site, p) {
  if (!shopifyConnected(site.id)) return { ...site, status: 'not_connected' };
  const ql = (q) => shopifyql(q, site.id);
  // Sessions are New Zealand only: overseas bot visits (October 2026: about 110,000 from the Americas) swamp the real ones.
  const NZ = "WHERE session_country = 'New Zealand'";
  const sess = (a, b) => `FROM sessions SHOW sessions, conversion_rate ${NZ} SINCE ${a} UNTIL ${b}`;
  const sales = (a, b) => `FROM sales SHOW orders, net_sales GROUP BY sales_channel SINCE ${a} UNTIL ${b}`;
  const [sc, sp, oc, op, src, dev, ms, mo] = await Promise.all([
    ql(sess(p.start, p.end)), ql(sess(p.prevStart, p.prevEnd)),
    ql(sales(p.start, p.end)), ql(sales(p.prevStart, p.prevEnd)),
    ql(`FROM sessions SHOW sessions ${NZ} GROUP BY referrer_source SINCE ${p.start} UNTIL ${p.end} ORDER BY sessions DESC LIMIT 10`),
    ql(`FROM sessions SHOW sessions ${NZ} GROUP BY session_device_type SINCE ${p.start} UNTIL ${p.end} ORDER BY sessions DESC`),
    ql(`FROM sessions SHOW sessions, conversion_rate ${NZ} GROUP BY month SINCE ${p.yearStart} UNTIL ${p.end} ORDER BY month ASC`),
    ql(`FROM sales SHOW orders, net_sales WHERE sales_channel != 'Point of Sale' GROUP BY month SINCE ${p.yearStart} UNTIL ${p.end} ORDER BY month ASC`),
  ]);
  /* Online sales = every channel except Point of Sale (online store, B2B Wholesale Hub, Miko B2B, draft orders; 27 Nov 2026) */
  const online = (rows) => rows.filter((r) => r.sales_channel !== 'Point of Sale').reduce((t, r) => ({ orders: num(t.orders) + num(r.orders), net_sales: num(t.net_sales) + num(r.net_sales) }), { orders: 0, net_sales: 0 });
  const ocO = online(oc), opO = online(op);
  const monthOrders = new Map(mo.map((r) => [String(r.month).slice(0, 7), r]));
  return {
    ...site, status: 'ok',
    totals: {
      sessions: [num(sc[0]?.sessions), num(sp[0]?.sessions)],
      conversion: [num(sc[0]?.conversion_rate), num(sp[0]?.conversion_rate)],
      orders: [num(ocO.orders), num(opO.orders)],
      revenue: [num(ocO.net_sales), num(opO.net_sales)],
    },
    channels: oc.map((r) => ({ name: r.sales_channel, orders: num(r.orders), revenue: num(r.net_sales) })),
    sources: src.map((r) => ({ name: r.referrer_source || 'not recorded', sessions: num(r.sessions) })),
    devices: dev.map((r) => ({ name: r.session_device_type || 'not recorded', sessions: num(r.sessions) })),
    /* Only from the month the shop went live (the first month with 50+ orders; worthyproducts.nz June 2026). Before that its
       online orders went through the old system, so the few test orders would read as the business selling almost nothing
       online (27 Nov 2026). */
    ...(() => {
      const all = ms.map((r) => {
        const k = String(r.month).slice(0, 7); const o = monthOrders.get(k) || {};
        return { month: k, sessions: num(r.sessions), conversion: num(r.conversion_rate), orders: num(o.orders), revenue: num(o.net_sales) };
      });
      const live = all.findIndex((m) => m.orders >= 50);
      return { months: all, liveFrom: null };   // every month shown, every channel but Point of Sale (Pratham, 27 Nov 2026)
    })(),
  };
}

const oneSite = (s, today, per) => { const p = per || periods(today); return s.source === 'shopify' ? shopifySite(s, p) : gaSite(s, p); };

const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v)) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
/** A chosen period (from..to), compared with the same number of days just before it unless a comparison is given. */
export function customPeriods({ from, to, compareFrom, compareTo }, today = nzToday()) {
  if (!isDay(from) || !isDay(to) || from > to) throw new Error('from and to must be dates YYYY-MM-DD, from not after to.');
  if (to > today) throw new Error('to cannot be in the future.');
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
  if (days > 731) throw new Error('A period can be at most 2 years.');
  let prevStart, prevEnd;
  if (compareFrom || compareTo) {
    if (!isDay(compareFrom) || !isDay(compareTo) || compareFrom > compareTo) throw new Error('compareFrom and compareTo must be dates YYYY-MM-DD.');
    prevStart = compareFrom; prevEnd = compareTo;
  } else { prevEnd = addDays(from, -1); prevStart = addDays(prevEnd, -(days - 1)); }
  const m = new Date(`${to.slice(0, 7)}-01T00:00:00Z`); m.setUTCMonth(m.getUTCMonth() - 11);
  return { start: from, end: to, prevStart, prevEnd, yearStart: m.toISOString().slice(0, 10) };
}
// Each site is cached on its own for 30 minutes. A failure throws, and unstable_cache never keeps a throw, so the next
// visit tries again instead of showing an error for half an hour. Results that say "not connected" are also not kept.
const storedSite = unstable_cache(async (id, today) => {
  const r = await oneSite(SITES.find((x) => x.id === id), today);
  if (r.status !== 'ok') throw Object.assign(new Error('not cached'), { result: r });
  return { ...r, builtAt: new Date().toISOString() };
}, ['web-stats-v7'], { revalidate: 30 * 60 });

export async function webStats({ fresh = false, period = null, only = null } = {}) {
  const today = nzToday();
  const list = only ? SITES.filter((x) => x.id === only) : SITES;
  const sites = await Promise.all(list.map((s) =>
    (period ? oneSite(s, today, period) : fresh ? oneSite(s, today) : storedSite(s.id, today))
      .catch((e) => e.result || { ...s, status: 'error', error: String(e.message || e).slice(0, 200) })));
  return { periods: period || periods(today), sites };
}
