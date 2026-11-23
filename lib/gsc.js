/**
 * Google Search Console, read only, with the same keyless sign-in as GA4 (lib/ga4.js). The service account
 * dashboard-ga4-reader has Restricted (read) access on the three properties below, added 24 Nov 2026.
 *
 * Search Console data runs about 2 to 3 days behind, so periods end 3 days ago.
 */
import { googleToken } from '@/lib/ga4';

const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';

export const GSC_SITES = {
  worthy: 'sc-domain:worthy.nz',
  worthyproducts: 'sc-domain:worthyproducts.nz',
  dutchrusk: 'https://dutchrusk.co.nz/',
};

// Searches that name the business. Everything else counts as non-branded.
export const BRANDED = /\b(worthy|dutch\s*rusk|dutchrusk|v\s*\.?\s*j\.?\s*trading|vjtrading)\b/i;

const enc = (s) => encodeURIComponent(s);

async function gscFetch(path, body) {
  const res = await fetch(`https://searchconsole.googleapis.com/webmasters/v3/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${await googleToken(SCOPE)}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(25000),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Search Console ${res.status}: ${j.error?.message || 'error'}`);
  return j;
}

/** Rows of a Search Analytics query, keyed by dimension name. */
export async function gscQuery(site, { startDate, endDate, dimensions = [], rowLimit = 1000, filters = null }) {
  const body = { startDate, endDate, dimensions, rowLimit, dataState: 'final' };
  if (filters) body.dimensionFilterGroups = [{ filters }];
  const j = await gscFetch(`sites/${enc(GSC_SITES[site])}/searchAnalytics/query`, body);
  return (j.rows || []).map((r) => {
    const o = { clicks: r.clicks || 0, impressions: r.impressions || 0, ctr: r.ctr || 0, position: r.position || 0 };
    dimensions.forEach((d, i) => { o[d] = r.keys?.[i]; });
    return o;
  });
}

export async function gscSitemaps(site) {
  const j = await gscFetch(`sites/${enc(GSC_SITES[site])}/sitemaps`);
  return (j.sitemap || []).map((s) => ({
    path: s.path,
    lastSubmitted: s.lastSubmitted || null,
    lastDownloaded: s.lastDownloaded || null,
    pending: Boolean(s.isPending),
    errors: Number(s.errors) || 0,
    warnings: Number(s.warnings) || 0,
    submitted: (s.contents || []).reduce((a, c) => a + (Number(c.submitted) || 0), 0),
  }));
}
