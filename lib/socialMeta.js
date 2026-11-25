/**
 * Facebook pages and their linked Instagram accounts, read only, through Meta's Graph API.
 *
 *   META_ACCESS_TOKEN  a read-only token from Meta Business Suite (a system user token, or a long-lived user token from a
 *                      page admin) with pages_show_list, pages_read_engagement, read_insights, instagram_basic,
 *                      instagram_manage_insights. Every page the token can see is shown, with its Instagram account.
 *
 * Each figure is asked for on its own and simply left out if Meta refuses it, because Meta retires page metrics often.
 */
import { unstable_cache } from 'next/cache';
import { periods } from '@/lib/webStats';
import { nzToday } from '@/lib/ostendo';

const G = 'https://graph.facebook.com/v23.0';
export const metaConfigured = () => Boolean(process.env.META_ACCESS_TOKEN);

async function graph(path, params, token) {
  const u = new URL(`${G}/${path}`);
  for (const [k, v] of Object.entries(params || {})) u.searchParams.set(k, v);
  u.searchParams.set('access_token', token);
  const res = await fetch(u, { signal: AbortSignal.timeout(20000) });
  const j = await res.json();
  if (!res.ok || j.error) throw new Error(`Meta ${res.status}: ${j.error?.message || 'error'}`);
  return j;
}
const unixDay = (iso, end = false) => Math.floor(new Date(`${iso}T${end ? '23:59:59' : '00:00:00'}+13:00`).getTime() / 1000);
const sum = (values) => (values || []).reduce((a, v) => a + (typeof v.value === 'number' ? v.value : 0), 0);

/* Meta answers at most about 90 days of page insights and 30 days of Instagram insights per request, so a longer period
   is read in windows and added up. Instagram reach and accounts engaged count each person once, so they cannot be added
   across windows: for a period longer than 30 days they are left out rather than overstated. */
const addDays = (iso, n) => new Date(new Date(`${iso}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);
function windows(a, b, maxDays) {
  const out = [];
  for (let from = a; from <= b; from = addDays(from, maxDays)) { const to = addDays(from, maxDays - 1); out.push([from, to < b ? to : b]); }
  return out;
}
const UNIQUE_IG = new Set(['reach', 'accounts_engaged']);

async function pageMetric(pageId, metric, a, b, token) {
  try {
    const parts = await Promise.all(windows(a, b, 90).map(async ([x, y]) => {
      const j = await graph(`${pageId}/insights`, { metric, period: 'day', since: unixDay(x), until: unixDay(y, true) }, token);
      return j.data?.[0] ? sum(j.data[0].values) : null;
    }));
    return parts.every((v) => v === null) ? null : parts.reduce((t, v) => t + (v || 0), 0);
  } catch { return null; }
}
async function igMetric(igId, metric, a, b, token) {
  try {
    const w = windows(a, b, 30);
    if (w.length > 1 && UNIQUE_IG.has(metric)) return null;
    const parts = await Promise.all(w.map(async ([x, y]) => {
      const j = await graph(`${igId}/insights`, { metric, period: 'day', metric_type: 'total_value', since: unixDay(x), until: unixDay(y, true) }, token);
      return j.data?.[0]?.total_value?.value ?? null;
    }));
    return parts.every((v) => v === null) ? null : parts.reduce((t, v) => t + (v || 0), 0);
  } catch { return null; }
}

const PAGE_METRICS = { views: 'page_media_view', reach: 'page_impressions_unique', engagements: 'page_post_engagements', newFollows: 'page_daily_follows_unique' };
const IG_METRICS = { views: 'views', reach: 'reach', engagements: 'total_interactions', profileViews: 'profile_views', accountsEngaged: 'accounts_engaged' };

async function both(fn, id, metrics, p, token) {
  const out = {};
  await Promise.all(Object.entries(metrics).map(async ([k, m]) => {
    const [c, pv] = await Promise.all([fn(id, m, p.start, p.end, token), fn(id, m, p.prevStart, p.prevEnd, token)]);
    if (c !== null || pv !== null) out[k] = [c, pv];
  }));
  return out;
}

async function build(today, per = null) {
  const token = process.env.META_ACCESS_TOKEN;
  const p = per || periods(today);
  const pages = (await graph('me/accounts', { fields: 'id,name,link,followers_count,fan_count,access_token,instagram_business_account{id,username,followers_count,media_count}', limit: '50' }, token)).data || [];
  const accounts = [];
  for (const pg of pages) {
    const pt = pg.access_token || token;
    const [fb, posts] = await Promise.all([
      both(pageMetric, pg.id, PAGE_METRICS, p, pt),
      graph(`${pg.id}/posts`, { fields: 'message,created_time,permalink_url,shares,reactions.summary(true).limit(0),comments.summary(true).limit(0)', limit: '6' }, pt).catch(() => ({ data: [] })),
    ]);
    accounts.push({
      platform: 'Facebook', name: pg.name, link: pg.link || `https://www.facebook.com/${pg.id}`,
      followers: pg.followers_count ?? pg.fan_count ?? null, totals: fb,
      posts: (posts.data || []).map((x) => ({ when: x.created_time, text: (x.message || '').slice(0, 120), link: x.permalink_url,
        reactions: x.reactions?.summary?.total_count || 0, comments: x.comments?.summary?.total_count || 0, shares: x.shares?.count || 0 })),
    });
    const ig = pg.instagram_business_account;
    if (ig?.id) {
      const [igt, media] = await Promise.all([
        both(igMetric, ig.id, IG_METRICS, p, pt),
        graph(`${ig.id}/media`, { fields: 'caption,timestamp,permalink,like_count,comments_count,media_type', limit: '6' }, pt).catch(() => ({ data: [] })),
      ]);
      accounts.push({
        platform: 'Instagram', name: `@${ig.username}`, link: `https://www.instagram.com/${ig.username}`,
        followers: ig.followers_count ?? null, postsTotal: ig.media_count ?? null, totals: igt,
        posts: (media.data || []).map((x) => ({ when: x.timestamp, text: (x.caption || '').slice(0, 120), link: x.permalink,
          reactions: x.like_count || 0, comments: x.comments_count || 0, shares: null })),
      });
    }
  }
  return { status: 'ok', accounts, period: p, builtAt: new Date().toISOString() };
}

const stored = unstable_cache(async (day) => build(day), ['social-meta-v2'], { revalidate: 30 * 60 });
// A chosen period (the Command Center's date picker) is kept for 30 minutes too, keyed by its dates.
const storedPeriod = unstable_cache(async (day, a, b, pa, pb) => build(day, { start: a, end: b, prevStart: pa, prevEnd: pb }),
  ['social-meta-period-v1'], { revalidate: 30 * 60 });
export async function metaStats({ fresh = false, period = null } = {}) {
  if (!metaConfigured()) return { status: 'not_connected', accounts: [] };
  try {
    const today = nzToday();
    if (period) return await (fresh ? build(today, period) : storedPeriod(today, period.start, period.end, period.prevStart, period.prevEnd));
    return await (fresh ? build(today) : stored(today));
  }
  catch (e) { return { status: 'error', error: String(e.message || e).slice(0, 200), accounts: [] }; }
}
