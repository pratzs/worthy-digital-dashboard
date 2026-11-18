# Social and Web page

Management only (`/social-web`, section `socialweb` in `lib/auth.js`). Purchasing and Business Development cannot open the page or its API (`/api/social-web`, `/api/social-web/manual`); the route also checks the role itself.

## Where each figure comes from

| What | Source | Code |
|---|---|---|
| worthy.nz | Google Analytics 4, property 459697422 (account "Worthy") | `lib/ga4.js`, `lib/webStats.js` |
| dutchrusk.co.nz | Google Analytics 4, property in account "V J TRADING" (stream G-4C5Y1Y26NV) | same |
| worthyproducts.nz | Shopify (ShopifyQL) with the dashboard's existing store token | `lib/webStats.js` |
| Facebook and Instagram | Meta Graph API, every page the token can see plus its linked Instagram account | `lib/socialMeta.js` |
| LinkedIn and TikTok | typed in once a month on the page, kept in the shared store (Upstash) | `lib/socialManual.js` |

Period: the last 30 complete New Zealand days against the 30 days before, plus the last 12 months. Each site and the Meta figures are cached for 30 minutes; a failure is never cached. The Refresh button skips the cache.

worthyproducts.nz sessions, sources, devices and conversion are **New Zealand only**. Overseas bot visits (October 2026: about 110,000 direct sessions from the USA, Brazil, Colombia and Ecuador, 2 to 15 October, 0.2% conversion) otherwise swamp the real traffic of about 4,000 sessions a month. Orders and sales are not filtered.

Dutch Rusk uses GA4 because the Dutch Rusk app does not have the `read_reports` scope Shopify needs for ShopifyQL. Adding it needs the store to re-approve the app.

## Google sign-in (no key file)

Google Cloud project `worthy-properties-509000` blocks service account key files (organisation policy `iam.disableServiceAccountKeyCreation`). The dashboard signs in without a key:

1. Every Vercel function request carries a short-lived OIDC token (`x-vercel-oidc-token`; Vercel project Settings > Security, issuer mode Team).
2. Google workload identity pool `vercel`, provider `vercel` (issuer `https://oidc.vercel.com/pratzs-projects-118791ea`, audience `https://vercel.com/pratzs-projects-118791ea`, mapping `google.subject = assertion.sub`) accepts ONLY `owner:pratzs-projects-118791ea:project:worthy-digital-dashboard:environment:production`.
3. That identity may act as `dashboard-ga4-reader@worthy-properties-509000.iam.gserviceaccount.com` (no project roles), which is **Viewer** on the worthy.nz property and on the V J TRADING account.

So it works on production only, not on preview deployments or locally. Setup check (management sign-in): `/api/social-web?props=1` lists the GA4 properties the reader can see. Property ids can be overridden with the `GA4_PROPERTIES` env var (JSON, e.g. `{"dutchrusk":"123"}`).

To switch it off: remove the reader from the two GA4 access lists, or disable the `vercel` provider in Google Cloud.

## Facebook and Instagram

Set `META_ACCESS_TOKEN` in Vercel to a read-only system user token from Meta Business Suite with `pages_show_list`, `pages_read_engagement`, `read_insights`, `instagram_basic`, `instagram_manage_insights`. Each figure is asked for on its own and left out if Meta refuses it (Meta retires page metrics often).
