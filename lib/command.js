/**
 * Worthy Command Center data (management only).
 *
 *   search     Google Search Console per site: clicks, impressions, average position, non-branded searches and how
 *              they moved against the 28 days before.
 *   indexing   Search Console sitemaps per site (what Google has read and when).
 *   traffic    Daily visits, online sales and conversions for the last 90 days: GA4 for worthy.nz and dutchrusk.co.nz,
 *              Shopify's own reports for worthyproducts.nz (New Zealand visits only, see lib/webStats.js).
 *   live       Visitors on each site right now (GA4 realtime).
 *   board      Work the team types in on the page: pipeline, outreach, listings, authority scores, marketing spend
 *              and Thursday meeting action points. Stored in the dashboard database (lib/repStore.js).
 */
import { unstable_cache } from 'next/cache';
import { ga4Configured, ga4Property, ga4Report, ga4Token } from '@/lib/ga4';
import { gscQuery, gscSitemaps, BRANDED, GSC_SITES } from '@/lib/gsc';
import { kvGet, kvSet, kvPush, kvRange } from '@/lib/repStore';
import { nzToday } from '@/lib/ostendo';
import { asanaSafe } from '@/lib/asana';
import { clickupSafe } from '@/lib/clickup';

export const CC_SITES = [
  { id: 'worthy', name: 'worthy.nz', url: 'https://worthy.nz' },
  { id: 'worthyproducts', name: 'worthyproducts.nz', url: 'https://worthyproducts.nz' },
  { id: 'dutchrusk', name: 'dutchrusk.co.nz', url: 'https://dutchrusk.co.nz' },
];

const addDays = (iso, n) => new Date(new Date(`${iso}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);
const num = (v) => Number(v) || 0;

// ── Search Console ─────────────────────────────────────────────────────────────────────────────────
async function searchSite(site, today, custom = null) {
  const end = custom?.end || addDays(today, -3), start = custom?.start || addDays(end, -27);
  const len = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000) + 1;
  const pEnd = addDays(start, -1), pStart = addDays(pEnd, -(len - 1));
  const [cur, prev, pages, daily, nbDays] = await Promise.all([
    gscQuery(site.id, { startDate: start, endDate: end, dimensions: ['query'], rowLimit: 2000 }),
    gscQuery(site.id, { startDate: pStart, endDate: pEnd, dimensions: ['query'], rowLimit: 2000 }),
    gscQuery(site.id, { startDate: start, endDate: end, dimensions: ['page'], rowLimit: 15 }),
    gscQuery(site.id, { startDate: pStart < addDays(end, -89) ? pStart : addDays(end, -89), endDate: end, dimensions: ['date'], rowLimit: 1000 }),
    gscQuery(site.id, { startDate: start, endDate: end, dimensions: ['date', 'query'], rowLimit: 25000 }),
  ]);
  const nbDaily = new Map();
  nbDays.forEach((r) => { if (!BRANDED.test(r.query)) nbDaily.set(r.date, (nbDaily.get(r.date) || 0) + r.clicks); });
  const prevMap = new Map(prev.map((r) => [r.query, r]));
  const inRange = (rows, a, b) => rows.filter((r) => r.date >= a && r.date <= b);
  const sum = (rows, k) => rows.reduce((a, r) => a + r[k], 0);
  const wpos = (rows) => { const imp = sum(rows, 'impressions'); return imp ? rows.reduce((a, r) => a + r.position * r.impressions, 0) / imp : null; };
  const nb = cur.filter((r) => !BRANDED.test(r.query));
  const nbPrev = prev.filter((r) => !BRANDED.test(r.query));
  const queries = nb
    .map((r) => { const p = prevMap.get(r.query); return { query: r.query, clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position, prevPosition: p ? p.position : null }; })
    .sort((a, b) => b.impressions - a.impressions);
  return {
    id: site.id, status: 'ok', range: { start, end, prevStart: pStart, prevEnd: pEnd },
    totals: {
      clicks: [sum(inRange(daily, start, end), 'clicks'), sum(inRange(daily, pStart, pEnd), 'clicks')],
      impressions: [sum(inRange(daily, start, end), 'impressions'), sum(inRange(daily, pStart, pEnd), 'impressions')],
      position: [wpos(cur), wpos(prev)],
      nonBrandedClicks: [sum(nb, 'clicks'), sum(nbPrev, 'clicks')],
      nonBrandedImpressions: [sum(nb, 'impressions'), sum(nbPrev, 'impressions')],
      nonBrandedPosition: [wpos(nb), wpos(nbPrev)],
      pageOne: [nb.filter((r) => r.position <= 10).length, nbPrev.filter((r) => r.position <= 10).length],
      topThree: [nb.filter((r) => r.position <= 3).length, nbPrev.filter((r) => r.position <= 3).length],
      queries: [nb.length, nbPrev.length],
    },
    queries: queries.slice(0, 150),
    pages: pages.map((r) => ({ page: r.page, clicks: r.clicks, impressions: r.impressions, position: r.position })),
    daily: daily.map((r) => ({ date: r.date, clicks: r.clicks, impressions: r.impressions, nbClicks: nbDaily.get(r.date) || 0 })),
  };
}

async function indexSite(site) {
  const maps = await gscSitemaps(site.id);
  return { id: site.id, status: 'ok', sitemaps: maps };
}

// ── Traffic and sales ──────────────────────────────────────────────────────────────────────────────
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
    const throttled = (j.errors || []).some((e) => e.extensions?.code === 'THROTTLED') || res.status === 429;
    if (throttled && attempt < 4) { await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))); return shopifyql(q, attempt + 1); }
    throw new Error(`Shopify report failed: ${JSON.stringify(s?.parseErrors || j.errors).slice(0, 200)}`);
  }
  return s.tableData?.rows || [];
}

async function trafficSite(site, today) {
  const end = addDays(today, -1), start = addDays(end, -729);
  if (site.id === 'worthyproducts') {
    if (!process.env.SHOPIFY_ACCESS_TOKEN_WORTHY) return { id: site.id, status: 'not_connected' };
    const NZ = "WHERE session_country = 'New Zealand'";
    const [sess, sales] = await Promise.all([
      shopifyql(`FROM sessions SHOW sessions, conversion_rate ${NZ} GROUP BY day SINCE ${start} UNTIL ${end} ORDER BY day ASC`),
      shopifyql(`FROM sales SHOW orders, net_sales WHERE sales_channel = 'Online Store' GROUP BY day SINCE ${start} UNTIL ${end} ORDER BY day ASC`),
    ]);
    const s = new Map(sales.map((r) => [String(r.day).slice(0, 10), r]));
    return {
      id: site.id, status: 'ok', source: 'Shopify',
      daily: sess.map((r) => { const d = String(r.day).slice(0, 10); const o = s.get(d) || {}; return { date: d, sessions: num(r.sessions), conversions: num(o.orders), revenue: num(o.net_sales) }; }),
    };
  }
  if (!ga4Configured()) return { id: site.id, status: 'not_connected' };
  const prop = ga4Property(site.id);
  const rows = await ga4Report(prop, {
    dateRanges: [{ startDate: start, endDate: end }], dimensions: [{ name: 'date' }],
    metrics: [{ name: 'sessions' }, { name: 'keyEvents' }, { name: 'ecommercePurchases' }, { name: 'purchaseRevenue' }],
    orderBys: [{ dimension: { dimensionName: 'date' } }], limit: 1000,
  });
  return {
    id: site.id, status: 'ok', source: 'Google Analytics',
    daily: rows.map((r) => ({
      date: `${r.date.slice(0, 4)}-${r.date.slice(4, 6)}-${r.date.slice(6)}`,
      sessions: r.sessions, conversions: r.ecommercePurchases || r.keyEvents, revenue: r.purchaseRevenue,
    })),
  };
}

async function channelsSite(site, today) {
  if (site.id === 'worthyproducts' || !ga4Configured()) return null;
  const end = addDays(today, -1), start = addDays(end, -29);
  const rows = await ga4Report(ga4Property(site.id), {
    dateRanges: [{ startDate: start, endDate: end }], dimensions: [{ name: 'sessionDefaultChannelGroup' }],
    metrics: [{ name: 'sessions' }, { name: 'keyEvents' }, { name: 'purchaseRevenue' }],
    orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: 10,
  });
  return rows.map((r) => ({ name: r.sessionDefaultChannelGroup, sessions: r.sessions, conversions: r.keyEvents, revenue: r.purchaseRevenue }));
}

/** Visitors on the site in the last 30 minutes (GA4 realtime). Not cached. */
export async function liveVisitors() {
  if (!ga4Configured()) return CC_SITES.map((s) => ({ id: s.id, status: 'not_connected' }));
  const props = { ...Object.fromEntries(CC_SITES.map((s) => [s.id, ga4Property(s.id)])) };
  return Promise.all(CC_SITES.map(async (s) => {
    try {
      const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${props[s.id]}:runRealtimeReport`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${await ga4Token()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ metrics: [{ name: 'activeUsers' }], dimensions: [{ name: 'minutesAgo' }] }),
        signal: AbortSignal.timeout(10000),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error?.message || String(res.status));
      const byMin = new Array(30).fill(0);
      (j.rows || []).forEach((r) => { const m = Number(r.dimensionValues[0].value); if (m < 30) byMin[29 - m] = Number(r.metricValues[0].value) || 0; });
      return { id: s.id, status: 'ok', now: byMin.reduce((a, b) => a + b, 0), byMinute: byMin };
    } catch (e) { return { id: s.id, status: 'error', error: String(e.message || e).slice(0, 160) }; }
  }));
}

const msg = (e) => String(e?.message || e).slice(0, 200);

/**
 * Each source per site is cached on its own. A failure is never cached (unstable_cache does not keep a thrown error),
 * and the last good answer is kept in the dashboard database, so a passing Google or Shopify hiccup shows the last
 * good numbers marked stale instead of a blank card.
 */
async function lastGood(key, fn) {
  try {
    const v = await fn();
    if (v?.status === 'ok') kvSet(`cc:last:${key}`, JSON.stringify({ ...v, savedAt: new Date().toISOString() })).catch(() => {});
    return v;
  } catch (e) {
    const raw = await kvGet(`cc:last:${key}`).catch(() => null);
    if (raw) { try { return { ...JSON.parse(raw), stale: true, error: msg(e) }; } catch { /* fall through */ } }
    throw e;
  }
}
const SOURCES = {
  search: { ttl: 30 * 60, run: (site, today) => searchSite(site, today) },
  indexing: { ttl: 60 * 60, run: (site) => indexSite(site) },
  traffic: {
    ttl: 15 * 60,
    run: async (site, today) => {
      const [t, ch] = await Promise.all([trafficSite(site, today), channelsSite(site, today).catch(() => null)]);
      return { ...t, channels: ch };
    },
  },
};
const cached = {};
for (const [name, src] of Object.entries(SOURCES)) {
  cached[name] = unstable_cache(async (siteId, today) => {
    const v = await src.run(CC_SITES.find((x) => x.id === siteId), today);
    if (v?.status === 'error') throw new Error(v.error);
    return v;
  }, [`cc-${name}-v3`], { revalidate: src.ttl });
}
const load = (name, site, today, fresh) =>
  lastGood(`${name}:${site.id}`, () => (fresh ? SOURCES[name].run(site, today) : cached[name](site.id, today)))
    .catch((e) => ({ id: site.id, status: 'error', error: msg(e) }));

const cachedRangeSearch = unstable_cache(
  async (siteId, start, end) => { const v = await searchSite(CC_SITES.find((x) => x.id === siteId), null, { start, end }); return v; },
  ['cc-search-range-v1'], { revalidate: 30 * 60 },
);
/** Search Console for any period (the page's date picker). */
export async function searchForRange(start, end) {
  return Promise.all(CC_SITES.map((s) => cachedRangeSearch(s.id, start, end).catch((e) => ({ id: s.id, status: 'error', error: msg(e) }))));
}

export async function commandData({ fresh = false } = {}) {
  const today = nzToday();
  const all = (name) => Promise.all(CC_SITES.map((s) => load(name, s, today, fresh)));
  const [search, indexing, traffic, live, board, log, asana, clickup] = await Promise.all([
    all('search'), all('indexing'), all('traffic'), liveVisitors(), readBoard(), readLog(), asanaSafe(), clickupSafe(),
  ]);
  return { today, sites: CC_SITES, gscSites: GSC_SITES, search, indexing, traffic, live, board, log, asana, clickup, builtAt: new Date().toISOString() };
}

// ── Board (typed in on the page) ───────────────────────────────────────────────────────────────────
export const BOARD_KINDS = {
  pipeline: { label: 'Pipeline', statuses: ['next', 'in progress', 'done'] },
  outreach: { label: 'Outreach', statuses: ['prospect', 'contacted', 'replied', 'won', 'lost'] },
  listing:  { label: 'Listings', statuses: ['to submit', 'submitted', 'live', 'needs fixing'] },
  meeting:  { label: 'Meeting actions', statuses: ['open', 'done'] },
  authority: { label: 'Authority', statuses: ['recorded'] },
  spend:    { label: 'Marketing spend', statuses: ['recorded'] },
};
const BOARD_KEY = 'cc:board:v1';
const LOG_KEY = 'cc:log:v1';

export async function readBoard() {
  try {
    const raw = await kvGet(BOARD_KEY);
    if (!raw) return seedBoard();
    const board = JSON.parse(raw);
    // Listings added to the starter set after the board was first saved: add each once, never twice
    const have = new Set(board.map((x) => x.id));
    const extra = seedBoard().filter((x) => x.id.startsWith('seedw_') && !have.has(x.id));
    return extra.length ? [...board, ...extra] : board;
  } catch { return seedBoard(); }
}
export async function readLog() {
  try { return (await kvRange(LOG_KEY, 40)).map((x) => { try { return JSON.parse(x); } catch { return null; } }).filter(Boolean); }
  catch { return []; }
}

const clean = (v, max = 400) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);

/** Add, change or remove one board item. Returns the new board. */
export async function writeBoard(action, item, person) {
  const board = await readBoard();
  const kind = clean(item?.kind, 20);
  if (!BOARD_KINDS[kind]) throw new Error('Unknown kind');
  const now = new Date().toISOString();
  if (action === 'delete') {
    const i = board.findIndex((x) => x.id === item.id);
    if (i >= 0) { const [gone] = board.splice(i, 1); await logEvent({ what: 'removed', kind, title: gone.title, person }); }
  } else {
    const fields = ['title', 'site', 'area', 'owner', 'status', 'due', 'link', 'notes', 'contact', 'amount', 'month', 'score', 'source', 'meeting'];
    const next = { kind };
    fields.forEach((f) => { if (item[f] !== undefined) next[f] = clean(item[f], f === 'notes' ? 1000 : 300); });
    if (!next.title) throw new Error('A title is needed');
    if (next.status && !BOARD_KINDS[kind].statuses.includes(next.status)) next.status = BOARD_KINDS[kind].statuses[0];
    const i = item.id ? board.findIndex((x) => x.id === item.id) : -1;
    if (i >= 0) {
      const was = board[i];
      board[i] = { ...was, ...next, updatedAt: now, updatedBy: person };
      if (next.status && next.status !== was.status) {
        if (['done', 'won', 'live'].includes(next.status)) board[i].doneAt = now.slice(0, 10);
        await logEvent({ what: `moved to ${next.status}`, kind, title: board[i].title, person });
      } else await logEvent({ what: 'updated', kind, title: board[i].title, person });
    } else {
      board.unshift({ id: `cc_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, status: BOARD_KINDS[kind].statuses[0], ...next, createdAt: now, createdBy: person });
      await logEvent({ what: 'added', kind, title: next.title, person });
    }
  }
  await kvSet(BOARD_KEY, JSON.stringify(board.slice(0, 1500)));
  return board;
}

export async function logEvent(e) {
  try { await kvPush(LOG_KEY, JSON.stringify({ ...e, at: new Date().toISOString() }), 200); } catch { /* the log is a nice-to-have */ }
}

// What the board starts with, so the first view is not empty. Everything here is real work from 16 to 24 Nov 2026.
function seedBoard() {
  const d = '2026-11-24';
  const P = (title, site, area, status, due, notes, link) => ({ kind: 'pipeline', title, site, area, status, due, notes, link, createdAt: `${d}T00:00:00Z`, ...(status === 'done' ? { doneAt: due } : {}) });
  const L = (title, site, status, link, notes) => ({ kind: 'listing', title, site, status, link, notes, createdAt: `${d}T00:00:00Z` });
  const items = [
    P('Request re-indexing: Drinks, Dutch Rusk Exclusive, Shop All, Cadbury', 'dutchrusk', 'Indexing', 'next', '2026-11-25', 'Google daily limit stopped these on 24 Nov.'),
    P('Request re-indexing: home and 12 landing pages', 'worthyproducts', 'Indexing', 'next', '2026-11-25', 'Order in the reminder task.'),
    P('Request re-indexing: FMCG and Fabrics', 'worthy', 'Indexing', 'next', '2026-11-25', ''),
    L('Google Business Profile: Dutch Rusk, 8 Cable Street, Christchurch', 'dutchrusk', 'live', 'https://maps.google.com/?cid=7219218126878059900', '2 reviews'),
    L('Google Business Profile: Dutch Rusk, 14 Echodale Place, Nelson', 'dutchrusk', 'needs fixing', '', 'Permanently closed, disabled 20 Nov. Do not reopen. Waiting on Google case.'),
    L('Google Maps: Dutch Rusk Distribution, 145 Pascoe St, Nelson', 'dutchrusk', 'needs fixing', '', 'Unclaimed, shows Open. Reported moved 24 Nov.'),
    L('MapQuest: Dutch Rusk (Nelson address)', 'dutchrusk', 'needs fixing', '', ''),
    L('Cylex: Dutch Rusk Ltd (Nelson address)', 'dutchrusk', 'needs fixing', '', ''),
    L('Finda: Dutch Rusk Ltd (Nelson address)', 'dutchrusk', 'needs fixing', '', ''),
    L('Opendi: Dutch Rusk Ltd (Nelson address)', 'dutchrusk', 'needs fixing', '', ''),
    L('Google Business Profile: Worthy Products, 28 Frost Road, Mount Roskill', 'worthyproducts', 'live', '', ''),
    { id: 'seedw_gbp', ...L('Google Business Profile: Worthy NZ, Avondale', 'worthy', 'needs fixing', '', 'Not owned by our Google account yet ("Own this business?"). Description says 19 Pacific places.') },
    { id: 'seedw_bing', ...L('Bing Webmaster Tools: worthy.nz', 'worthy', 'to submit', 'https://www.bing.com/webmasters', 'Import from Search Console.') },
    { id: 'seedw_li', ...L('LinkedIn: Worthy NZ', 'worthy', 'live', 'https://www.linkedin.com/company/worthynz', '') },
    { id: 'seedw_fb', ...L('Facebook: Worthy FMCG', 'worthy', 'live', '', '') },
    { id: 'seedw_ig', ...L('Instagram: worthyoceania', 'worthy', 'live', 'https://www.instagram.com/worthyoceania', '') },
  ];
  return items.map((x, i) => ({ id: `seed_${i}`, ...x }));   // items that bring their own id keep it
}

/** Every key event (enquiry, form, click that counts) on one GA4 site between two dates, newest first. */
export async function keyEventDetail(siteId, start, end) {
  if (!ga4Configured()) return { status: 'not_connected' };
  const rows = await ga4Report(ga4Property(siteId), {
    dateRanges: [{ startDate: start, endDate: end }],
    dimensions: [{ name: 'dateHourMinute' }, { name: 'eventName' }, { name: 'pagePath' }, { name: 'sessionSourceMedium' }, { name: 'city' }, { name: 'deviceCategory' }],
    metrics: [{ name: 'keyEvents' }],
    dimensionFilter: { filter: { fieldName: 'isKeyEvent', stringFilter: { value: 'true' } } },
    orderBys: [{ dimension: { dimensionName: 'dateHourMinute' }, desc: true }], limit: 500,
  });
  return {
    status: 'ok', site: siteId, start, end,
    rows: rows.filter((r) => r.keyEvents > 0).map((r) => ({
      at: `${r.dateHourMinute.slice(0, 4)}-${r.dateHourMinute.slice(4, 6)}-${r.dateHourMinute.slice(6, 8)}T${r.dateHourMinute.slice(8, 10)}:${r.dateHourMinute.slice(10, 12)}`,
      event: r.eventName, page: r.pagePath, source: r.sessionSourceMedium, city: r.city, device: r.deviceCategory, count: r.keyEvents,
    })),
  };
}
