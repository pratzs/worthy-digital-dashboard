/**
 * Google Shopping and sales channels for the Command Center (Search tab, "Shopping").
 *
 *   visits     GA4 "Organic Shopping" (free product listings) and "Paid Shopping" (Shopping ads) for the two shops:
 *              visits, orders, sales, and the product pages people land on.
 *   google     Search Console search appearances (how often our pages show as product or merchant results), and
 *              the searches and pages behind the shopping-type appearances.
 *   channels   worthyproducts.nz sales by Shopify sales channel (Online Store, ChatGPT, Shop, Google...).
 */
import { ga4Configured, ga4Property, ga4Report } from '@/lib/ga4';
import { gscQuery } from '@/lib/gsc';

const SHOPS = ['worthyproducts', 'dutchrusk'];
const SHOP_GROUPS = ['Organic Shopping', 'Paid Shopping'];

async function ga4Shopping(siteId, start, end) {
  const filter = { filter: { fieldName: 'sessionDefaultChannelGroup', inListFilter: { values: SHOP_GROUPS } } };
  const [groups, pages] = await Promise.all([
    ga4Report(ga4Property(siteId), { dateRanges: [{ startDate: start, endDate: end }], dimensions: [{ name: 'sessionDefaultChannelGroup' }], metrics: [{ name: 'sessions' }, { name: 'ecommercePurchases' }, { name: 'purchaseRevenue' }], dimensionFilter: filter }),
    ga4Report(ga4Property(siteId), { dateRanges: [{ startDate: start, endDate: end }], dimensions: [{ name: 'sessionDefaultChannelGroup' }, { name: 'landingPage' }], metrics: [{ name: 'sessions' }, { name: 'ecommercePurchases' }, { name: 'purchaseRevenue' }], dimensionFilter: filter, orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: 25 }),
  ]);
  return {
    id: siteId, status: 'ok',
    groups: SHOP_GROUPS.map((g) => { const r = groups.find((x) => x.sessionDefaultChannelGroup === g) || {}; return { name: g === 'Organic Shopping' ? 'Free listings' : 'Shopping ads', sessions: r.sessions || 0, orders: r.ecommercePurchases || 0, revenue: r.purchaseRevenue || 0 }; }),
    pages: pages.map((r) => ({ kind: r.sessionDefaultChannelGroup === 'Organic Shopping' ? 'Free listings' : 'Shopping ads', page: r.landingPage, sessions: r.sessions, orders: r.ecommercePurchases, revenue: r.purchaseRevenue })),
  };
}

const SHOPPING_APPEARANCE = /merchant|product|shopping|review_snippet/i;
async function gscShopping(siteId, start, end) {
  const appearances = await gscQuery(siteId, { startDate: start, endDate: end, dimensions: ['searchAppearance'], rowLimit: 50 });
  const shop = appearances.filter((a) => SHOPPING_APPEARANCE.test(a.searchAppearance));
  const detail = await Promise.all(shop.slice(0, 3).map(async (a) => {
    const filters = [{ dimension: 'searchAppearance', operator: 'equals', expression: a.searchAppearance }];
    const [queries, pages] = await Promise.all([
      gscQuery(siteId, { startDate: start, endDate: end, dimensions: ['query'], rowLimit: 15, filters }),
      gscQuery(siteId, { startDate: start, endDate: end, dimensions: ['page'], rowLimit: 15, filters }),
    ]);
    return { appearance: a.searchAppearance, queries, pages };
  }));
  return { id: siteId, status: 'ok', appearances, detail };
}

async function shopifyql(q, attempt = 0) {
  const res = await fetch(`https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/2026-01/graphql.json`, {
    method: 'POST',
    headers: { 'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN_WORTHY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'query($q:String!){ shopifyqlQuery(query:$q){ tableData{ rows } parseErrors } }', variables: { q } }),
    signal: AbortSignal.timeout(30000),
  });
  const j = await res.json();
  const s = j.data?.shopifyqlQuery;
  if (!s || s.parseErrors?.length) {
    if ((j.errors || []).some((e) => e.extensions?.code === 'THROTTLED') && attempt < 4) { await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))); return shopifyql(q, attempt + 1); }
    throw new Error(`Shopify report failed: ${JSON.stringify(s?.parseErrors || j.errors).slice(0, 200)}`);
  }
  return s.tableData?.rows || [];
}

async function shopifyChannels(start, end) {
  if (!process.env.SHOPIFY_ACCESS_TOKEN_WORTHY) return { status: 'not_connected' };
  const rows = await shopifyql(`FROM sales SHOW orders, net_sales GROUP BY sales_channel SINCE ${start} UNTIL ${end} ORDER BY net_sales DESC`);
  return { status: 'ok', site: 'worthyproducts', channels: rows.map((r) => ({ name: r.sales_channel || 'Not recorded', orders: Number(r.orders) || 0, sales: Number(r.net_sales) || 0 })) };
}

const safe = (p, id) => p.catch((e) => ({ id, status: 'error', error: String(e.message || e).slice(0, 200) }));

export async function shoppingData(start, end, gscStart, gscEnd) {
  const [visits, google, channels] = await Promise.all([
    ga4Configured() ? Promise.all(SHOPS.map((id) => safe(ga4Shopping(id, start, end), id))) : [],
    Promise.all(['worthy', ...SHOPS].map((id) => safe(gscShopping(id, gscStart, gscEnd), id))),
    safe(shopifyChannels(start, end), 'worthyproducts'),
  ]);
  return { visits, google, channels };
}
