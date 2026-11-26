# Worthy Digital Dashboard: where everything stands

Last compiled 26 Nov 2026 from the git history (456 commits since 12 Mar 2026), the docs in this folder and the work sessions behind them. Read this first, then the topic doc it points to.

Live at `worthy-digital-dashboard.vercel.app`. Repo `pratzs/worthy-digital-dashboard` (public), work in `C:\wdd` (short path; Turbopack fails on long Windows paths). A push to `main` deploys.

## What is on it

| Part | Who | Doc |
|---|---|---|
| Sales dashboard: Worthy Products North (Odoo company 4), Dutch Rusk / Worthy Products South (Ostendo), Worthy Oceania (Odoo company 1), Shopify stores. Overview, Analytics, Credit Notes, Debtors, Sales by Rep, targets | Management (all); BDM and Purchasing departments see a cut-down set | [SALES-BASIS.md](SALES-BASIS.md), [ACCURACY-CHECKLIST.md](ACCURACY-CHECKLIST.md) |
| Ask a Question (dashboard chat, `/chat`) | Management; Purchasing gets 5 tools only | [AI-COST.md](AI-COST.md) |
| Management connector (`/api/mcp`) in each person's own Claude or ChatGPT | Management, Hari (Purchasing) | [REP-MCP.md](REP-MCP.md) |
| My Account (`/my-sales`) and rep connector (`/api/rep-mcp`) | Team leads Michelle (Team 2) and Naitik (Team 1); Vishva on the Marketing login | [REP-MCP.md](REP-MCP.md) |
| Social and Web (`/social-web`) and `get_web_and_social` in chat and connector | Management | [SOCIAL-WEB.md](SOCIAL-WEB.md) |
| Command Center (`/command`), including a Social & Web tab | Management; built for the Thursday Ecom x Marketing meeting. Its design is the direction for the whole dashboard | [COMMAND-CENTER.md](COMMAND-CENTER.md) |
| Rep assistant usage (`/rep-usage`) | Management: questions, sign-ins, AI cost per person | [AI-COST.md](AI-COST.md) |

People: Management = Kishan, Jainesh, Lakmal, Hetal, Jiten, Pratham (`lib/people.js`, sign-in is work email + department password). Purchasing = Kylie (dashboard and chat only), Hari (dashboard, chat and connector). AI allowance is 60 questions a day with a 30-day rollover (`lib/repStore.js`).

## The sales basis (agreed 25 Nov 2026, after Kishan found three different figures)

One rule everywhere: dashboard, chat, connectors and the Odoo Sunday emails.
- Worthy Products / North / WP = Odoo company 4. Dutch Rusk / South = Ostendo. Worthy Oceania = Odoo company 1.
- Sales = product lines on posted invoices less credit notes, before GST. Freight is never counted.
- Cost = cost Odoo booked on each invoice, plus today's standard cost on any quantity with no booked cost.
- Sales to our own companies are kept out and shown in the "Sister company sales" section.
- Checked 25 Nov to the cent across dashboard, chat tool, all 10 Odoo report emails and Odoo's ledger. Full detail and code map in [SALES-BASIS.md](SALES-BASIS.md).
- Odoo scheduled report code (actions 103, 104, 105, 107, 108, 110, 111, 123, 137, 151) is kept in the catalog-manager repo `.scratch_docs/` with `_BACKUP_2026-11-25` copies of the old code.

## Sales by rep and what sets the margin (26 Nov 2026)

Kishan asked why Worthy Products' margin reads 15.7% (November). Two changes:
- Nish Jha has no sales target by decision (Pratham, 27 Nov 2026); Sales vs Target shows him as "No target" with his sales and margin.
- **Sales by rep lists every salesperson on their own line.** Until now everyone who is not one of the eight field reps sat in one "Direct" row ($818,937 this year at 1.6%). That row was mostly Kishan: the clearance and short-dated stock Bansri puts on his name, $625,523 this year at -4.5%. Adding up the non-field people still gives finance's Direct figure (`isFieldRep` in `lib/odooReps.js`). Applies to the year, weekly, credits and debtors tables.
- **"What sets the margin" panel** under Sales by rep (Worthy Products only, management only: `/api/margin-mix`, `lib/marginMix.js`, `app/design/MarginMix.js`). The same sales and cost as the headline, split by kind of sale: clearance or damaged stock (picked from WPW01/PICK/Clearance or DG/Stock/DAMAGED GOODS), credit notes, given free, sold below cost, discount 20%+, discount under 20%, no discount, no cost in Odoo. Each invoice line falls in the first that fits, so the rows add up to the headline. Also by person and the products that lost the most, for the selected month or the year so far, with the "effect on company margin" (the margin without that row minus the margin with it). Checked 26 Nov: November $1,220,338.75 sales, $1,028,855.13 cost, $191,298.30 gross profit, 15.7%, all equal to the headline card.
- Month results are saved in Upstash (`wk:last:v1:mix4b:<YYYY-MM>`): 15 minutes for the current month, 7 days for a closed month. The warm-up fills them one month at a time.
- November's finding: the 15.7% is mostly discount depth across all reps (lines at 20%+ discount were 25% of sales at 13.9%). Clearance sold at about -96% against booked cost, but it's small ($4.8k). Kishan pulled the company margin down 0.5 points this month, and about 1.4 points over the year.

### Customer margin, no-cost products, speed and accessibility (27 Nov 2026)
- **Customer margin** for all three businesses under What sets the margin / Sales by Rep (`/api/customer-margin?company=4|1|south&period=`, `app/design/CustomerMargin.js`, management only). Worthy Products and Oceania come from the margin reader (per customer, `lib/marginMix.js`; saved copies rebuild one month at a time in the background, lock `mixbuild:any`); Dutch Rusk per store from Ostendo on the headline's cost rules (`lib/southCustomers.js`). Sort by sales, lowest margin ($1,000+), most discount, biggest pull; search. Checked 27 Nov: rows add up to the headline (October WP $1,307,615.50, Dutch Rusk $1,768,088.74; gross profit within cents of rounding).
- **No-cost products**: sales with no cost in Odoo stay out of the margin (as before) and are now listed in the margin panel so the cost can be fixed.
- **Finance question (open):** Dutch Rusk hand-typed ZZZSTOCK lines with finance-supplied costs: 56 lines in October cost 2 to 6 times what they sold for ($9,015 sales, $23,458 cost), e.g. Briggston Dairy at -124.6%. Either sold below cost or the supplied costs are per carton while lines were sold per inner. Basis unchanged until finance confirms.
- **Speed / Odoo load:** stock value has a shared copy (15 minutes; it was an Odoo read on every page view, 5 s). The Financial year view no longer reads every past calendar year from Odoo (`/api/odoo`, `/api/odoo/advanced`, never shown on screen). Measured page: code 0.5 s, headline 1.5 s.
- **Month bars:** tap or click a month (keyboard too) to read its exact value above the chart.
- **Accessibility:** orange as text uses `--orange-ink` #a8560c (5:1; bright orange text was 2.4:1); dark 3px focus outline; `lang="en-NZ"`; buttons at least 42px; screen-reader captions (`.sr-only`).
- **Meta ads:** Anu's new token (27 Nov) has ads_read and the Worthy ad account (NZD), never expires; Aug $54.74, Sep $14.96 spend. Goes in Vercel as META_ACCESS_TOKEN (Pratham).

### Chosen dates and readability (27 Nov 2026)
- **Every viewer picks the period.** Overview toggle: Month, Week, Financial year, Chosen dates (From/To plus presets: this month, last month, last 3 months, financial year to date, last financial year). The dates sit in the page address (`from`, `to`), so a shared link opens on them. The year readers take any period: `/api/odoo/fy?company=&from=&to=` (`computeFY(cid, fy, custom)`, `readCustom` in lib/odooFyCache.js: one chosen-period Odoo read at a time company-wide, saved 6 hours for a past period, 10 minutes for one to today) and `/api/ostendo/fy?from=&to=`. First and last months and weeks are clipped to the dates. Growth compares with the same dates a year earlier. Sales vs Target pro-rates each month's budget to the dates chosen. The margin panel and sister card follow the dates. Checked 27 Nov: 1 to 31 Oct equals the October month for all three businesses to the cent; 15 Oct to 10 Nov equals the margin panel's own reader ($1,154,814.34, $180,596.52) and the reps add up to it.
- "From orders to profit" (it repeated the headline strip) is replaced by **Margin by month** (orders by month for people without margin).
- Larger type: every font under 14px grew by 1.5px across the dashboard, Command Center, chat, sign-in and My Sales.
- **Clearance and expired stock** card on Fast & Slow Movers (`/api/stock-states`, lib/stockStates.js): North warehouse at standard cost split into past best-before, Damaged Goods, Clearance location, within 90 days and good stock, with item lists; South (Dutch Rusk) total only, because Ostendo has no batches with expiry (ITEMBATCHES is empty) and no clearance or damaged location.

- **Odoo load, 27 Nov:** every reader added on 26 and 27 Nov now shares one copy with a lock (`readWeeks` in lib/odooWeeksCache.js): short-dated stock and stock states (30 minutes), part-month margin pieces (6 hours once the dates are past, 15 minutes to today), chosen-dates year figures (one read at a time company-wide). The weekly summary is cached 30 minutes. The year summary loads last year straight after the business on screen (same reads, better order). Odoo simple reads measured at 65 to 92 ms on 27 Nov.
- **Phone, 27 Nov:** checked at 390px (dashboard and Command Center): no sideways spill; view, company and year buttons are one swipeable row; the single "Odoo Sales" button is gone; the forecast prints each figure once; the first numbers show on the first screen.

### Added later on 26 Nov
- **What sets the margin** now costs each product and month exactly as the year figures do (booked cost plus unit cost on unbooked quantity; a product counts in the margin when its cost was booked in those dates on any invoice), so every month and the year match the headline to the cent for Worthy Products and Worthy Oceania. New rows: **Short-dated stock** (the lot sold was within 90 days of its best-before, `use_date`, when it left). New lists: **who gets 20%+ discounts** (customers and products). Worthy Oceania has the panel and the date picker on its sister card too (`/api/margin-mix?company=1`). Lines are read with search + read `load: ''` so the Oceania variants Odoo cannot name never break a read.
- **Short-dated stock card** on Fast & Slow Movers (Worthy Products, management and Purchasing): lots reaching best-before within 90 days or already past it, cost, value at the connector's clearance tiers (50/40/30% off), units sold a day over the last 90 days and whether each lot sells in time. `lib/shortDated.js`, `/api/short-dated`, `app/design/ShortDated.js`. First read 26 Nov: $377k across 258 lots, of which $286k (160 lots) is already past best-before.
- **Weekly summary** on the Command Center dashboard tab (`lib/weeklySummary.js`, `/api/summary`): last week and month so far for all three businesses, margin watch (anyone 2+ points under their own year margin on $10k+), last week's biggest margin pulls, short-dated stock, open meeting actions. A draft: Copy or Open as email draft. Nothing is sent from the dashboard.
- Command Center 'Online sales' is net sales before GST, Online Store channel only. Shopify's Analytics dashboard shows gross and all channels (Worthy Products adds Point of Sale), so its headline is higher. Checked 19 to 25 Nov: Worthy Products $32,317.02 and Dutch Rusk $141,631.03, both equal to Shopify.

## Design and navigation (26 Nov 2026)

Every page is built from the shared kit in `app/design/`: `ui.js` (cards, headline strip, trends, month bars, ranked bars, ring, chain, share bar, progress), `icons.js` (one icon set), `SiteNav.js` (top bar with the pages the department may open, Back button, Dashboard / page / part trail, Skip to content). Three colours only (`app/globals.css`: page off-white, ink, orange accent), Outfit font, no dark mode. While figures load the page shows a dash, never a zero.

Year tables show Revenue, Sales with a cost, and Cost (the cost of those sales), so Sales with a cost minus Cost equals Gross Profit on every row and in the total, for all three businesses.

## Speed and Odoo load (26 Nov 2026)

Year figures (`lib/odooFyCache.js`): one Odoo read per company and year at a time, every complete result saved as the last good copy in Upstash, a visitor waits at most 2.5 s and otherwise gets the last good copy (marked stale, with the time Odoo was read) while the read finishes in the background; the page asks again a minute later. Before this, every visitor started a 35 to 107 second read and Odoo slowed for the whole company. The GitHub warm job is meant to run every 5 minutes but GitHub runs it only 2 or 3 times a day.

## How to work on it

- Build before push, always chained: `npx next build >/dev/null 2>&1 && echo BUILD-OK && git commit ... && git push`. GitHub sometimes answers 500 on push; retry.
- Cached data needs its key bumped when logic changes: `odoo-fy-v8` (lib/odooFyCache.js and lib/odooFy.js), `rep-data-v4` (lib/repData.js), `bd-data-v5` (lib/bdData.js). A bump means the next page load reads Odoo cold (about 90 s).
- Money in `lib/ostendo.js` helpers is integer micro-dollars: convert with `toDollars`, never `/100`.
- Navigating the browser to the same URL with only a `#` change does not reload the page; use a real reload when checking a deploy.
- Claude and ChatGPT cache a connector's tool list: after adding or changing tools, people disconnect and reconnect.
- Never type passwords or secrets. Pratham pastes Vercel values; I put them on his clipboard.
- Tests: `scripts/rep-leak-test.mjs` (71), `scripts/access-matrix.mjs`, `scripts/purchasing-check.mjs`, `scripts/marketing-e2e.mjs`, `scripts/rep-e2e.mjs`. Run the leak test after any connector change.
- Keep this file and the topic docs current in the same commit as the change.

## Scheduled jobs

| Job | What |
|---|---|
| `.github/workflows/warm.yml` | every 5 min, keeps the year figures warm (`/api/cron/warm`) |
| `.github/workflows/warm-reps.yml` | every 20 min, My Account data |
| `.github/workflows/price-snapshot.yml` | daily 13:30 UTC, list price snapshot for price history |
| `.github/workflows/cost-health.yml` | daily, Dutch Rusk missing-cost check |
| Claude scheduled task `weekly-google-ai-figures` | Mondays 8am NZ, re-captures Google AI Overviews figures for the Command Center |
| Claude scheduled task `thursday-command-center-sync` | Thursdays every 15 min, 2pm to 6pm NZ: reads the Command Center activity log and keeps Asana, ClickUp, meeting notes and memory in step |

## Open items (26 Nov 2026)

- Kishan to retry ChatGPT (disconnect and reconnect the Worthy connector) and the dashboard after the sales basis fix. Corrected Odoo reports were re-sent to him 25 Nov; screenshots in OneDrive `Worthy Ecommerce - Documents\Sales figures check 25 Nov 2026`.
- Social and Web: Facebook and Instagram live since 26 Nov (Anu's token). Facebook post lists need `pages_read_user_content` added to the Worthydashboardreader system user (optional).
- Command Center: ChatGPT, Gemini and Perplexity answer checks need `OPENAI_API_KEY`, `GEMINI_API_KEY`, `PERPLEXITY_API_KEY` (optional). ClickUp storage is full, so card attachments fail (put the OneDrive path in a comment instead).
- Purchasing: a real production sign-in test (Kylie, Hari) has never been run; it needs the real password typed by Pratham.
- Management chat answers cost about US$0.30 each because `get_financial_year` and `get_debtors` return large payloads; trimming them is not done.
- `lib/repTargets.js` (rep budgets) sits in the public repo; moving it to an env value or the store is recommended.
- Oceania per-rep and weekly margins still leave out the four fabric variants Odoo cannot name (one invoice this year, May, $834.05 cost); month and year totals include them.
- A stash in `C:\wdd` ("Debtors: add Over 60 days late tile", from before November) is unreviewed.
- Command Center 'Online sales' and conversion use Shopify's own figures for both shops since 26 Nov (`shopifyql` with the Dutch Rusk reports key); GA4 is used only for worthy.nz.
- ClickUp cards in review: 14yhc7kzutt (one sales basis, waiting on Kishan's retry), 14yhc7kzutu (Social and Web; Dutch Rusk on Shopify figures since 26 Nov), 14yhc7kyrn7 (named sign-in and AI allowance), 14yhc7kymta (departments), 14yhc7kymmw (Vishva's Marketing login).

## Improvements (edge cases found 26 Nov 2026)

Done 26 Nov:
1. Reliable warm-up: the Dutch Rusk Catalog Manager on Render calls `/api/cron/warm` every 5 minutes (`app/lib/dashboard-warm.server.js` in that repo); the GitHub job is an hourly backup.
2. Weekly figures have the same Odoo protection as the year figures (`lib/odooWeeksCache.js`, keys `wk:last:v1`, `wk:busy:v1`); the page asks again a minute later when it got a saved copy.
3. An orange note on the dashboard when figures are over 15 minutes old or a saved copy is shown.
4. Chat and connector answers say when Odoo was read if the figures came from a saved copy (`figuresAsOf`, `fromSavedCopy`; rule `SAVED_COPY_RULE` in lib/mcpRoles.js).
5. Spam: the enquiries popup leaves likely spam out of real enquiries and explains every gap. A worthy.nz Code Snippet (#13, "Contact forms: block obvious bot spam") is ready to switch on so bots stop reaching the inbox.
6. Month bars mark a month in progress (striped, "to 26").
7. The Outfit font is served from the repo (`@fontsource-variable/outfit` through next/font/local), so a Google Fonts outage cannot fail a build.
8. Long tables show 25 rows at a time with Show more / Show all; totals and CSV still use every row.
10. Daily health check (`/api/cron/health`, `.github/workflows/health.yml`, docs/HEALTH.md): Meta, Dutch Rusk reports, Asana, ClickUp, worthy.nz forms, Google Analytics, saved year figures under 2 hours old.
11. The same check flags freight products and own-company partners that would slip into sales. Its first run found Oceania product 12872 "[FREIGHT] FREIGHT (Outgoing)" on 4 sales lines ($142.98 this FY), now in `FREIGHT_PRODUCT_IDS`.

Still to do:
9. Test the Purchasing (Kylie, Hari) and Business Development logins on production (needs the passwords typed by Pratham).
12. Management chat cost (about US$0.30 a question): trim `get_financial_year` and `get_debtors` payloads.
13. Rep budgets in the public repo (`lib/repTargets.js`): move to an environment value or the store.
- Spend and return reads ad spend automatically (`lib/adSpend.js`). Meta: Anu's new token (27 Nov) has `ads_read` and the Worthy ad account; Pratham puts it in Vercel. Google Ads is read from Google Analytics' ad cost, but on 26 Nov none of the three GA4 properties had a Google Ads link with cost: link the Google Ads account in each GA4 property (Admin > Product links > Google Ads links) and cost appears in the card.
- worthy.nz Code Snippet #13 (bot spam) is ACTIVE since 26 Nov; two test submissions to the Contact Page form came back as spam with nothing emailed.

## History in short

- Mar to Sep 2026: dashboard built for Odoo North and Oceania, Ostendo South and the Shopify stores.
- 6 Oct: North sales on finance's basis (product lines only).
- 13 to 14 Oct: shared 5-minute figure slots and the warm job.
- 28 to 30 Oct: rep connector, then team leads only (Michelle), My Account page.
- 9 Nov: Marketing login for Vishva (business development tools), expenses tool, departments enforced, one Anthropic key.
- 11 Nov: named sign-in per person, Purchasing chat, AI allowance and cost per person; South margin self-healing cost.
- 12 Nov: Naitik is the Team 1 lead.
- 19 Nov: Social and Web page (keyless GA4 through Vercel OIDC); selling prices and price tools for Vishva.
- 20 Nov: `get_web_and_social` in chat and the management connector.
- 24 Nov: Command Center (search, AI search, Google Shopping, traffic vs sales, listings, outreach, pipeline, live Asana and ClickUp, worthy.nz enquiries).
- 26 Nov: Facebook and Instagram live; Command Center Social & Web tab in the new design language (infographics, three colours, matching icons) and a browser cache across the Command Center.
- 25 Nov: one sales basis across dashboard, chat, connectors and the Odoo emails; freight never counted; sister company section; Oceania on the same basis; product-table cost and Oceania unit fixes.
