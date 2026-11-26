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
- Command Center 'Online sales' and conversion add Google Analytics revenue for dutchrusk.co.nz (about 7% below Shopify's own figure, 27 Oct to 25 Nov: GA $710,312 vs Shopify $765,245). `DUTCHRUSK_REPORTS_KEY` is in Vercel and the Social and Web page uses it (26 Nov), so the Command Center can switch to the same Shopify figures (`shopifyql(q, 'dutchrusk')` in `lib/webStats.js`).
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
- Spend and return reads ad spend automatically (`lib/adSpend.js`). Meta needs `ads_read` and the ad account on Worthydashboardreader (asked of Anu 26 Nov). Google Ads is read from Google Analytics' ad cost, but on 26 Nov none of the three GA4 properties had a Google Ads link with cost: link the Google Ads account in each GA4 property (Admin > Product links > Google Ads links) and cost appears in the card.
- worthy.nz Code Snippet #13 (bot spam) is created but switched off: Pratham to activate it in wp-admin > Snippets.

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
