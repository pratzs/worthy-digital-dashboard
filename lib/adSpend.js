/**
 * Advertising spend by month, read automatically (Command Center "Spend and return", 26 Nov 2026).
 *
 *   Google Ads  from Google Analytics: the `advertiserAdCost` metric for each site whose GA4 property is linked to a
 *               Google Ads account (no Google Ads API access needed). NZD, as Google Ads bills.
 *   Meta ads    from Meta's Marketing API: every ad account the dashboard's system user (Worthydashboardreader) can see,
 *               `insights` spend by month. Needs the `ads_read` permission and the ad account assigned to that user.
 *
 * Each source answers { status, rows: [{ month: 'YYYY-MM', channel, site, amount, currency }] }. A source that is not
 * set up says so ('not_connected' with the reason) and never blocks the others. Cached 6 hours per period.
 */
import { unstable_cache } from 'next/cache';
import { ga4Configured, ga4Property, ga4Report } from '@/lib/ga4';

const SITES = ['worthy', 'worthyproducts', 'dutchrusk'];

async function googleAds(start, end) {
  if (!ga4Configured()) return { status: 'not_connected', reason: 'Google Analytics sign-in only works on the live site', rows: [] };
  const rows = [], linked = [], errors = [];
  await Promise.all(SITES.map(async (site) => {
    try {
      const r = await ga4Report(ga4Property(site), {
        // Google Analytics only gives ad cost per campaign, so it is read by month and campaign and added up per month.
        dateRanges: [{ startDate: start, endDate: end }], dimensions: [{ name: 'yearMonth' }, { name: 'sessionCampaignName' }],
        metrics: [{ name: 'advertiserAdCost' }], limit: 5000,
      });
      const byMonth = new Map();
      for (const x of r) byMonth.set(x.yearMonth, (byMonth.get(x.yearMonth) || 0) + (Number(x.advertiserAdCost) || 0));
      let any = false;
      for (const [ym, total] of byMonth) {
        const amount = Math.round(total * 100) / 100;
        if (!amount) continue;
        any = true;
        rows.push({ month: `${ym.slice(0, 4)}-${ym.slice(4)}`, channel: 'Google Ads', site, amount, currency: 'NZD' });
      }
      if (any) linked.push(site);
    } catch (e) { errors.push(`${site}: ${String(e.message || e).slice(0, 120)}`); }
  }));
  return { status: errors.length === SITES.length ? 'error' : 'ok', linked, errors, rows };
}

async function metaGraph(path, params) {
  const u = new URL(`https://graph.facebook.com/v23.0/${path}`);
  for (const [k, v] of Object.entries(params || {})) u.searchParams.set(k, v);
  u.searchParams.set('access_token', process.env.META_ACCESS_TOKEN);
  const res = await fetch(u, { signal: AbortSignal.timeout(20000) });
  const j = await res.json();
  if (!res.ok || j.error) throw new Error(j.error?.message || `Meta ${res.status}`);
  return j;
}

async function metaAds(start, end) {
  if (!process.env.META_ACCESS_TOKEN) return { status: 'not_connected', reason: 'No Meta token', rows: [] };
  let accounts;
  try { accounts = (await metaGraph('me/adaccounts', { fields: 'name,account_id,currency', limit: '50' })).data || []; }
  catch (e) {
    const m = String(e.message || e);
    return { status: 'not_connected', reason: /ads_read|ads_management|permission/i.test(m) ? 'The Meta token needs the ads_read permission' : m.slice(0, 160), rows: [] };
  }
  if (!accounts.length) return { status: 'not_connected', reason: 'No ad account is assigned to Worthydashboardreader', rows: [] };
  const rows = [], errors = [];
  await Promise.all(accounts.map(async (a) => {
    try {
      const j = await metaGraph(`act_${a.account_id}/insights`, { fields: 'spend', time_increment: 'monthly', time_range: JSON.stringify({ since: start, until: end }), limit: '100' });
      for (const x of j.data || []) {
        const amount = Math.round((Number(x.spend) || 0) * 100) / 100;
        if (amount) rows.push({ month: String(x.date_start).slice(0, 7), channel: 'Meta ads', site: '', account: a.name, amount, currency: a.currency || 'NZD' });
      }
    } catch (e) { errors.push(`${a.name}: ${String(e.message || e).slice(0, 120)}`); }
  }));
  return { status: errors.length === accounts.length ? 'error' : 'ok', accounts: accounts.map((a) => a.name), errors, rows };
}

const cached = unstable_cache(async (start, end) => {
  const [google, meta] = await Promise.all([googleAds(start, end), metaAds(start, end)]);
  return { google, meta, at: new Date().toISOString() };
}, ['ad-spend-v3'], { revalidate: 6 * 3600 });

/** Spend by month for the period (whole months). `fresh` skips the 6-hour cache. */
export async function adSpend(start, end, { fresh = false } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start || '') || !/^\d{4}-\d{2}-\d{2}$/.test(end || '')) throw new Error('Bad dates');
  if (fresh) { const [google, meta] = await Promise.all([googleAds(start, end), metaAds(start, end)]); return { google, meta, at: new Date().toISOString() }; }
  return cached(start, end);
}
