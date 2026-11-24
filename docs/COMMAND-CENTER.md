# Worthy Command Center

Management only (`/command`, section `command` in `lib/auth.js`). The API (`/api/command`) checks the role itself as well. Built for the Thursday Ecom x Marketing meeting, 24 Nov 2026.

Tabs: Dashboard, Search, Outreach, Listings, Pipeline, Meeting. A site picker (all sites, worthy.nz, worthyproducts.nz, dutchrusk.co.nz) filters everything.

## Where each number comes from

| What | Source | Fresh |
| --- | --- | --- |
| Visitors right now | GA4 realtime, last 30 minutes, all three properties | every 30 s |
| Rankings, clicks, impressions, position | Search Console, 28 days ending 3 days ago, against the 28 days before | 30 min cache |
| Non-branded | any search not matching `BRANDED` in `lib/gsc.js` (worthy, dutch rusk, vj trading) | |
| Indexing | Search Console sitemaps | 60 min cache |
| Visits, sales, conversions | GA4 for worthy.nz and dutchrusk.co.nz; Shopify reports for worthyproducts.nz (New Zealand visits only, Online Store sales) | 15 min cache |
| Meeting tasks | Asana project Ecom x Marketing (`1219139073710791`): owner, Status field, due, subtasks | every 30 s (20 s server memo) |
| Pipeline | the page's own board plus Asana tasks plus ClickUp cards | every 30 s |
| Outreach, listings, authority, spend | typed in on the page, stored in Upstash (`cc:board:v1`, log `cc:log:v1`) | instant |

A failed Google or Shopify fetch is never cached. The last good answer per source and site is kept in Upstash (`cc:last:*`) and shown if a source is down. ShopifyQL retries on THROTTLED.

## Sites on Asana and ClickUp tasks

`sitesFor()` in `lib/asana.js` reads the task name. Dutch Rusk, Worthy Products and worthy.nz by name; brand pages (Ferrarelle, Calypso, H2Coco, Exeter, Riclan, Takis, O'Brien, Tradie, FMCG) count as worthy.nz. A task naming no site shows under every site. ClickUp tags `dutch rusk`, `worthy products` and `worthy.nz` also set the site.

## ClickUp cards included

Lists: E-Commerce > Active Sprint and Marketing > E-Commerce Requests (`CLICKUP_LISTS` to change). `relevant()` in `lib/clickup.js` keeps web, SEO, email, ads, storefront, sign-up and brand work and drops Odoo, warehouse, stock, POS, rep reports, the dashboard itself and single-customer login support. Closed cards show for 14 days.

## Settings on Vercel

- `ASANA_TOKEN`: Asana personal access token from a member of the Ecom x Marketing project (read only use).
- `CLICKUP_TOKEN`: ClickUp personal API token (starts `pk_`).
- Google: the keyless GA4 sign-in (see SOCIAL-WEB.md). The service account `dashboard-ga4-reader` has Restricted access on the three Search Console properties, and the Search Console API is on in project `worthy-properties-509000`. Production only.

Without a token that card shows "not connected" and the rest of the page still works.
