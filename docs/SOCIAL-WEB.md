# Social and Web page

Management only (`/social-web`, section `socialweb` in `lib/auth.js`). Purchasing and Business Development cannot open the page or its API (`/api/social-web`, `/api/social-web/manual`); the route also checks the role itself.

## Where each figure comes from

| What | Source | Code |
|---|---|---|
| worthy.nz | Google Analytics 4, property 459697422 (account "Worthy") | `lib/ga4.js`, `lib/webStats.js` |
| dutchrusk.co.nz | Shopify (ShopifyQL) through the Dutch Rusk Catalog Manager app (since 26 Nov 2026) | `lib/webStats.js` |
| worthyproducts.nz | Shopify (ShopifyQL) with the dashboard's existing store token | `lib/webStats.js` |
| Facebook and Instagram | Meta Graph API, every page the token can see plus its linked Instagram account | `lib/socialMeta.js` |
| LinkedIn and TikTok | typed in once a month on the page, kept in the shared store (Upstash) | `lib/socialManual.js` |

Period: the last 30 complete New Zealand days against the 30 days before, plus the last 12 months. Each site and the Meta figures are cached for 30 minutes; a failure is never cached. The Refresh button skips the cache.

worthyproducts.nz sessions, sources, devices and conversion are **New Zealand only**. Overseas bot visits (October 2026: about 110,000 direct sessions from the USA, Brazil, Colombia and Ecuador, 2 to 15 October, 0.2% conversion) otherwise swamp the real traffic of about 4,000 sessions a month. Orders and sales are not filtered.

dutchrusk.co.nz is on the same basis as worthyproducts.nz: New Zealand sessions, sources, devices and conversion; Online Store orders and net sales. Until 26 Nov 2026 it used GA4 (property 554865794, account "V J TRADING"), which recorded about 7% less revenue than Shopify.

How Dutch Rusk is read: the dashboard has no Dutch Rusk token. The Dutch Rusk Catalog Manager app (repo `dutch-rusk-catalog-manager`, Render service `srv-d6u8b8nafjfc73fvaip0`) has the `read_reports` scope (app version 295, approved by the store 26 Nov 2026) and uses expiring offline tokens that it refreshes itself, so it runs the query for the dashboard: `POST https://dutch-rusk-catalog-manager.onrender.com/api/shopifyql` with header `x-reports-key`, body `{"q": "FROM ..."}`. It only runs ShopifyQL. The key is `DUTCHRUSK_REPORTS_KEY` in Vercel and `REPORTS_API_KEY` on Render (same value). To switch it off, delete either one.

## Google sign-in (no key file)

Google Cloud project `worthy-properties-509000` blocks service account key files (organisation policy `iam.disableServiceAccountKeyCreation`). The dashboard signs in without a key:

1. Every Vercel function request carries a short-lived OIDC token (`x-vercel-oidc-token`; Vercel project Settings > Security, issuer mode Team).
2. Google workload identity pool `vercel`, provider `vercel` (issuer `https://oidc.vercel.com/pratzs-projects-118791ea`, audience `https://vercel.com/pratzs-projects-118791ea`, mapping `google.subject = assertion.sub`) accepts ONLY `owner:pratzs-projects-118791ea:project:worthy-digital-dashboard:environment:production`.
3. That identity may act as `dashboard-ga4-reader@worthy-properties-509000.iam.gserviceaccount.com` (no project roles), which is **Viewer** on the worthy.nz property and on the V J TRADING account.

So it works on production only, not on preview deployments or locally. Setup check (management sign-in): `/api/social-web?props=1` lists the GA4 properties the reader can see. Property ids can be overridden with the `GA4_PROPERTIES` env var (JSON, e.g. `{"dutchrusk":"123"}`).

To switch it off: remove the reader from the two GA4 access lists, or disable the `vercel` provider in Google Cloud.

## Facebook and Instagram

Set `META_ACCESS_TOKEN` in Vercel to a read-only system user token from Meta Business Suite with `pages_show_list`, `pages_read_engagement`, `read_insights`, `instagram_basic`, `instagram_manage_insights`. Each figure is asked for on its own and left out if Meta refuses it (Meta retires page metrics often).

Live 26 Nov 2026: token from Anu for the system user Worthydashboardreader (all five permissions granted), set on Vercel Production by Pratham. It sees Facebook pages Worthy and Worthy Products and Instagram accounts @worthyoceania and @worthyproducts_. Verified on /social-web and through `get_web_and_social` (chat and connector). Facebook post lists stay empty: they need `pages_read_user_content` on the system user; the page totals do not.

## Asking about it in the chat and the connector (20 Nov 2026)

Management can ask in the dashboard chat (Ask a Question) and in their own ChatGPT/Claude management connector: tool `get_web_and_social` (`lib/webTool.js`, registered in `lib/mcpTools.js`). Same figures as the page, for any period: `from`/`to` (compared with the same number of days just before, or `compareFrom`/`compareTo`), `site` = all, worthy, worthyproducts, dutchrusk or social. Management only: it is not in the department allow-list in `lib/mcpRoles.js`, so Purchasing and Business Development are never offered it and are refused if they call it. Both routes pass the Vercel OIDC token to `lib/ga4.js` (`setOidcToken`), so Google Analytics works there on production too. People using the management connector in their own Claude must disconnect and reconnect it to see the new tool (Claude keeps the old tool list).
