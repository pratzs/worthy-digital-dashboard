/**
 * Google Analytics 4, read only, with NO key file. On Vercel each request carries a short-lived OIDC token
 * (x-vercel-oidc-token). Google's workload identity pool "vercel" (project worthy-properties-509000, number 918800204822)
 * trusts ONLY this project's production deployments, swaps that token for a Google one, and lets it act as the service
 * account dashboard-ga4-reader, which has Viewer on the GA4 properties it reads and nothing else.
 *
 *   GA4_PROPERTIES   optional JSON {"worthy":"123", "dutchrusk":"456", ...} to override the ids below
 *
 * Call setOidcToken(request.headers.get('x-vercel-oidc-token')) at the start of a route that reads GA4.
 */
const PROJECT_NUMBER = '918800204822';
const POOL = 'vercel', PROVIDER = 'vercel';
const SERVICE_ACCOUNT = 'dashboard-ga4-reader@worthy-properties-509000.iam.gserviceaccount.com';

let oidc = '';
export const setOidcToken = (t) => { if (t) oidc = t; };
const vercelToken = () => oidc || process.env.VERCEL_OIDC_TOKEN || '';

const DEFAULT_PROPERTIES = {
  worthy: '459697422',      // worthy.nz (account Worthy)
  dutchrusk: '554865794',   // Dutch Rusk (Worthy Products South), stream G-4C5Y1Y26NV
  worthyproducts: '390549744',
};

export const ga4Configured = () => Boolean(vercelToken());

export function ga4Property(site) {
  let extra = {};
  try { extra = JSON.parse(process.env.GA4_PROPERTIES || '{}') || {}; } catch { extra = {}; }
  return String(extra[site] || DEFAULT_PROPERTIES[site] || '').replace(/^properties\//, '');
}

const cachedTokens = {};
/** A short-lived Google access token for the read-only service account, for one scope. No key file (see top). */
export async function googleToken(scope = 'https://www.googleapis.com/auth/analytics.readonly') {
  const c = cachedTokens[scope];
  if (c && c.token && Date.now() < c.until) return c.token;
  const sts = await fetch('https://sts.googleapis.com/v1/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      audience: `//iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/providers/${PROVIDER}`,
      grantType: 'urn:ietf:params:oauth:grant-type:token-exchange',
      requestedTokenType: 'urn:ietf:params:oauth:token-type:access_token',
      scope: 'https://www.googleapis.com/auth/cloud-platform',
      subjectTokenType: 'urn:ietf:params:oauth:token-type:jwt',
      subjectToken: vercelToken(),
    }),
    signal: AbortSignal.timeout(10000),
  });
  const st = await sts.json();
  if (!sts.ok || !st.access_token) throw new Error(`Google sign-in failed (exchange): ${st.error_description || st.error || sts.status}`);
  const res = await fetch(`https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${SERVICE_ACCOUNT}:generateAccessToken`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${st.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ scope: [scope], lifetime: '3600s' }),
    signal: AbortSignal.timeout(10000),
  });
  const j = await res.json();
  if (!res.ok || !j.accessToken) throw new Error(`Google sign-in failed (reader): ${j.error?.message || res.status}`);
  cachedTokens[scope] = { token: j.accessToken, until: new Date(j.expireTime).getTime() - 120000 };
  return j.accessToken;
}

export const ga4Token = () => googleToken('https://www.googleapis.com/auth/analytics.readonly');

/** One runReport call. Returns rows as plain objects keyed by dimension and metric names. */
export async function ga4Report(property, body) {
  const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${property}:runReport`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await ga4Token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`Google Analytics ${res.status}: ${j.error?.message || 'error'}`);
  const dims = (j.dimensionHeaders || []).map((h) => h.name);
  const mets = (j.metricHeaders || []).map((h) => h.name);
  return (j.rows || []).map((r) => {
    const o = {};
    dims.forEach((d, i) => { o[d] = r.dimensionValues[i].value; });
    mets.forEach((m, i) => { o[m] = Number(r.metricValues[i].value) || 0; });
    return o;
  });
}

/** Every GA4 property the signed-in Google account can see (for setup and checks). */
export async function ga4Properties() {
  const res = await fetch('https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200', {
    headers: { Authorization: `Bearer ${await ga4Token()}` }, signal: AbortSignal.timeout(15000),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`Google Analytics admin ${res.status}: ${j.error?.message || 'error'}`);
  return (j.accountSummaries || []).flatMap((a) => (a.propertySummaries || []).map((p) => ({
    account: a.displayName, property: p.property.replace('properties/', ''), name: p.displayName,
  })));
}
