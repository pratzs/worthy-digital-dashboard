# Daily health check

Improvements 10 and 11 in [STATUS.md](STATUS.md). Built 26 Nov 2026.

Every morning at 19:30 UTC (7:30 or 8:30 am NZ) the GitHub job `.github/workflows/health.yml` calls `https://worthy-digital-dashboard.vercel.app/api/cron/health`. The route (`app/api/cron/health/route.js`, checks in `lib/health.js`) answers a list of checks, each `{ name, ok, detail }`, plus `attention` (true when any check failed) and `failed` (one line per failed check). When `attention` is true the job fails with an `::error` naming the failed checks, and GitHub emails the owner. If the dashboard does not answer at all, the job only warns and tries again the next day (same as the cost check).

It can be run by hand from GitHub (Actions, "Daily health check", Run workflow) or by opening the URL.

## The checks

Connections:

| Check | Passes when | Fix |
|---|---|---|
| Meta token | `META_ACCESS_TOKEN` reads `me` and at least one Facebook page | New token from Meta Business Suite (see SOCIAL-WEB.md), paste into Vercel |
| Dutch Rusk Shopify reports | the Dutch Rusk app's `/api/shopifyql` answers a one-day query with `DUTCHRUSK_REPORTS_KEY` (up to 45 s, Render may be waking) | Check the Render app is up and the key matches on both sides |
| Asana | `ASANA_TOKEN` reads the Ecom x Marketing project | New personal access token |
| ClickUp | `CLICKUP_TOKEN` reads the first Command Center list | New ClickUp token |
| worthy.nz forms | the worthy.nz enquiries endpoint answers with `WORTHY_FORMS_KEY` | Check the Code Snippets snippet on worthy.nz is active and the key matches |
| Google Analytics sign-in | the keyless Vercel OIDC sign-in returns a Google token | Check the Google workload identity pool `vercel` (lib/ga4.js) |
| Saved year figures, Worthy Products / Worthy Oceania | the last good copy in Upstash (`fy:last:v8:<company>:<FY>`) was read from Odoo under 2 hours ago | The warm-up is not running (STATUS.md improvement 1); open the dashboard or call `/api/cron/warm` |

A key that is not set reports "not configured". Locally that passes (the keys are only on Vercel); on Vercel production a missing key fails, because it means the key was removed.

Sales codes (Odoo companies 4 and 1, posted customer invoices and credit notes of the last 14 days, one small grouped read each):

| Check | Fails when | Fix |
|---|---|---|
| freight accounts carry only freight products | a product on a 6030 / 7310 line is not in `FREIGHT_PRODUCT_IDS` | Add the product id to `FREIGHT_PRODUCT_IDS` in `lib/salesBasis.js` (and the Sunday email code), then bump the cache keys |
| freight-named products are known | a product named like freight, shipping, delivery or courier was invoiced and is not in `FREIGHT_PRODUCT_IDS` | Same, or if it is a real product, add its id to `HEALTH_IGNORE_PRODUCT_IDS` |
| own-company partners are sisters | an invoice partner named like Worthy, Dutch Rusk or VJ Trading is not in that company's `SISTER_SETS` | Add the partner id to `SISTER_SETS` in `lib/salesBasis.js`, or if it is a real customer, to `HEALTH_IGNORE_PARTNER_IDS` |

The answer names products and our own companies by id and name only. It carries no amounts and no customer names, so the route is public like `/api/cron/cost-health`.

## Settings (Vercel, optional)

- `HEALTH_IGNORE_PRODUCT_IDS`: comma-separated product ids checked and accepted (stops their alert without a deploy).
- `HEALTH_IGNORE_PARTNER_IDS`: the same for partners.

## Found on the first run (26 Nov 2026)

Worthy Oceania's freight product 12872 "[FREIGHT] FREIGHT (Outgoing)" is not in `FREIGHT_PRODUCT_IDS`. It is mostly posted on 6030 (left out by account), but 4 lines this financial year were posted on 6020 Sales Local, so they count as Oceania product sales. Fix: add 12872 to `FREIGHT_PRODUCT_IDS`.

## Testing locally

Load `.env.local` into `process.env` and import `lib/health.js` with the `@/` alias mapped to the repo (a Node loader hook). Only the Odoo checks run locally; the others report "not configured".
