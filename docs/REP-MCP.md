# Rep-only MCP connector (My Sales)

A separate connector for sales reps. Each rep sees ONLY their own sales and the debtors of their own customers, from the system they work in (North = Odoo, South = Ostendo). The management connector (`/api/mcp`) is unchanged and unrelated: different endpoint, different signing key, different sign-in, different tools. A token from one never works on the other.

- Endpoint to add in Claude / ChatGPT: `https://worthy-digital-dashboard.vercel.app/api/rep-mcp`
- Tools: `my_profile`, `my_sales` (optional `fy`; includes pace against target), `my_debtors`, `my_action_plan` (ranked, evidence-backed opportunities, computed in `lib/repPlan.js`), `my_best_sellers`, `my_customers` (top, gone quiet, slipping, growing, new or returning), `my_recent_orders`. No tool accepts a person, customer, query or filter. Product and customer data is read per rep in `lib/repData.js` (North: invoice salesperson matched to exactly one Odoo user; South: the rep's Ostendo codes); the calculations are pure functions in `lib/repInsights.js`.
- Sales and own gross profit/margin come from the same cached reports as the dashboard. Debtors are the customers assigned to the rep.

## How leaks are prevented
1. Output is built field by field from the rep's own rows (`lib/repProject.js`); the company payload is never returned.
2. The rep comes from the signed token only. Nothing in a request can choose another rep.
3. A guard fails closed if a foreign `rep` value or a company-level field appears.
4. Redirect addresses are limited to claude.ai / ChatGPT / OpenAI at registration and sign-in.
5. Tokens last 7 days, carry a version, and the version is checked on every call.

## Setup (Vercel environment variables)
- `REP_AUTH_SECRET`: a random string of 24+ characters (signs the rep tokens). Without it nothing validates.
- `REP_ACCESS`: JSON of salted hashes, made by `node scripts/make-rep-codes.mjs "<private folder>"`. The plain codes are written to that folder (outside the repo) and handed to each rep individually.

## Switch a rep off
Remove their entry from `REP_ACCESS` (or raise its `ver`) and redeploy. Their existing token fails on its next call.

## Checks
- `node scripts/rep-leak-test.mjs` (projection, guard, tokens, redirects).
- Every rep and every management tool name tested against a running server: other reps and company totals never appear; management tools are refused.

## Adding or changing a rep
Edit `REPS` in `lib/repAccess.js` (label must match the name the dashboard uses for them), regenerate their code with `make-rep-codes.mjs <folder> <key>`, update `REP_ACCESS`.

## My Sales chat page (the easy way in for reps)
`https://worthy-digital-dashboard.vercel.app/my-sales` : a rep opens the link, types their personal code, and chats. No Claude or ChatGPT account, no connector. It uses the same rep tools and the same access codes as the connector, so a rep still only ever gets their own sales and their own customers' debtors.

- Sign-in sets a 12 hour HttpOnly cookie (`worthy_rep`, signed with `REP_AUTH_SECRET`) naming one rep; the version is checked on every request, so removing a rep from `REP_ACCESS` cuts them off at once.
- The chat (`/api/my-sales/chat`) hands Claude only the three rep tools; the rep comes from the cookie, never from the request. AI usage is billed to Worthy's `REP_CHAT_API_KEY` (falls back to `ANTHROPIC_API_KEY` if that is not set), so the rep chat has its own key and limits.
- Limits: 60 questions per rep per day (`REP_CHAT_DAILY_LIMIT`, per server instance, best effort), 12 messages of history, 6 tool steps per question. Set a monthly spend limit on the Anthropic key as the hard ceiling.
- Optional `REP_CHAT_MODEL` changes the model (default claude-sonnet-5-5).
- Nothing is stored: no conversation log. A one line audit entry (rep, ok/failed, time) goes to the Vercel logs.
- Test: `node scripts/rep-chat-test.mjs <url> "<codes folder>" savan jerry` against a local server started with `ANTHROPIC_API_URL` pointing at a stand-in (see the header of the script).
- One-page instructions for reps: generated per rep (with their code) into `Worthy Rep Access\Rep sheets` outside the repo.

## Mentor behaviour
The chat assistant acts as the rep's own sales mentor: it shows its evidence (period, as-of date, a 'Based on:' line), ties every recommendation to a figure from the rep's own data, labels general advice as such, and never invents numbers. Cost and margin are shown only as the rep's own gross profit and margin (no per-product margin yet).

## Page behaviour for non-technical reps
- Answers lead with one plain sentence, show a "Based on:" evidence line, and finish with three tap-to-ask next questions (parsed from a final `Next questions:` line the assistant writes).
- The conversation is kept on the rep's own device (localStorage, 24 hours, cleared on Sign out), so an accidental refresh carries on. A question interrupted by a refresh shows "Your last question did not finish" with a Try again button. **New conversation** clears it.
- Signing in starts a quiet warm-up (`/api/my-sales/warm`) so the first answer is quicker; rep data is cached for ten minutes across servers (`unstable_cache` in `lib/repData.js`).
- While waiting: a progress panel with plain messages (changes after 4, 12, 30 and 60 seconds). Failures say what to do and offer Try again; technical reasons only go to the server log.

## 29 Oct 2026 additions

**Tools (rep connector and the My account page share them):** `my_profile`, `my_sales` (now with a month-end forecast and the same time last year), `my_debtors`, `my_best_sellers` and `my_customers` (both now with the rep's own margin), `my_customer` (deep-dive on ONE of the rep's own customers, matched only against that rep's own customers), `my_cross_sell`, `my_recent_orders`, `my_action_plan`.

**Where the figures come from (verified 29 Oct against Odoo and Ostendo directly):** posted invoices and credit notes only. North: `account.move.line` where the move is posted, product lines only, credit notes taken off (draft and cancelled invoices and sales orders are never read). South: stock lines of `SALESINVOICELINES` joined to `SALESINVOICEHEADER` (every status there is an issued document: Printed, Fully Paid, Partially Paid), credit-note lines carry negative amounts. For all 10 reps the assistant's year total equals the independent figure to the cent.

**Margin** is the rep's own, on the part of sales with a recorded cost, left blank when under 60% has one (North uses standard cost; South uses the invoice line cost and the dashboard's rule that excludes impossible costs). Margin is per product and per customer over the financial year to date.

**Cross-sell** (`lib/repAnalysis.js crossSell`) uses only the rep's own customers' purchases over 12 months. A suggestion needs: the "because" product bought by 6 or more of the rep's customers and at least $150 by this customer, 4 or more customers buying both, at least 40% overlap and a lift of 1.5, and a typical yearly spend on the suggested product of at least $250. The counts are shown as evidence.

**Month-end forecast** counts Monday to Friday only and does not allow for public holidays (always said so). **Same time last year** is withheld as a percentage when the swing is above +300% or below -80% (a different customer list last year).

**Daily limit and usage records:** `lib/repStore.js` keeps the exact daily question count per rep (default 60, `REP_CHAT_DAILY_LIMIT`), a usage log (rep, time, question shortened to 300 characters, tools, ok or not, seconds, AI tokens) and the "this looks wrong" notes. It uses an Upstash Redis database over REST (create it in Vercel: Storage, Create Database, Upstash, Redis, connect to the project; that adds `KV_REST_API_URL` and `KV_REST_API_TOKEN`). With none connected it falls back to memory on one server, so counts are approximate and reset on restart. The rep sees "Questions left today: N of 60". A question that failed because of us is given back. Management views it at `/rep-usage` (dashboard login, management only; API `/api/rep-usage`).

**Streaming:** `/api/my-sales/chat` streams newline-delimited JSON events (`status`, `delta`, `reset`, `done`, `error`) from the AI service's server-sent events.

**Warm-up:** `/api/cron/warm-reps` (called every 20 minutes from 04:00 to 20:00 NZ time by `.github/workflows/warm-reps.yml`) expires the rep datasets (`revalidateTag('rep-data')`) and reloads them one rep at a time; a call within 9 minutes of the last does nothing (`?force=<WARM_KEY>` overrides). Rep datasets are cached for 40 minutes.

**Home-screen app and QR:** `/my-account.webmanifest` and icons (`public/my-account-*.png`) let a phone install the page like an app; the printed sheets carry a QR code of the link. If the link moves to a subdomain, regenerate the sheets.

**Management connector hardening (`/api/mcp`):** only claude.ai, claude.com, chatgpt.com, openai.com addresses (https) or an app on the person's own computer (http on localhost / 127.0.0.1) can be registered or used as a redirect; wrong passwords wait 1.5 seconds; the hard-coded fallback secret and default password are gone (with no `AUTH_SECRET` or `DASHBOARD_PASSWORD`, nothing signs or verifies).

**Tests:** `node scripts/rep-leak-test.mjs`, `node scripts/rep-analysis-test.mjs`, `node scripts/mgmt-connector-test.mjs <url>` (server with `DASHBOARD_PASSWORD=localtestpw`), `node scripts/rep-e2e.mjs <url> "<codes folder>" <reps>`, and `node scripts/rep-chat-test.mjs <url> "<codes folder>" savan jerry` (uses `scripts/stub-ai.mjs`, a streaming stand-in for the AI service).

## 29 Oct 2026: team leads only, email and password

**Who can sign in:** only team leads (`LEAD_DEFS` in `lib/repAccess.js`). Team 2 = Michelle (team: Michelle, Chris, Ravi Kumar, Lynette). Team 1's lead is not decided, so `lead1` is switched off (no sign-in is possible until it is enabled in code and an entry exists). The other nine reps have no way in: only leads are checked at sign-in and on every call. A `testlead` (Nimesh North + Jerry South) exists only when `REP_ALLOW_TEST_LEAD=1` (local tests; never set in production).

**What a lead sees:** themself (if they sell) and each team member in full (sales, customers, best sellers, margin, debtors, cross-sell, action plan, customer deep-dive) through the optional `person` argument on every person tool, plus `team_overview` (everyone side by side and the team total) and `team_attention` (top items per person). `person` is matched only against the lead's own team (`resolvePerson`); anyone else is refused with "not on your team". Answers are checked by `guardTeam` (only team names, no company keys).

**Sign-in:** email and password. The "password" is the long random code made by `scripts/make-rep-codes.mjs <folder> michelle=michelle@worthy.nz`. The REP_ACCESS entry holds `salt`, `hash`, `ver` and `email` (emails are kept in the env var, not the public repo). When an email is on file both must match (email is not case sensitive); with none on file the password alone works. Every sign-in (and failed try, with the email typed, never the password) is logged and shown on `/rep-usage` under "Sign-ins", beside questions, failures and "looks wrong" notes. Switch a lead off: remove the entry or raise `ver`.

**Tests:** `node scripts/rep-leak-test.mjs` (53), `node scripts/rep-team-e2e.mjs <url> <password> [test lead password]` (with `MICHELLE_EMAIL` for a real server; 65 checks against real data locally). `scripts/rep-e2e.mjs` and `rep-chat-test.mjs` were written for single reps and need updating before reuse.

## 29 Oct 2026: hardening and verification

- **Errors:** only our own plain-English messages reach a lead or the AI. Anything else (an Odoo or Ostendo error with table names or SQL) is logged on the server (`rep_tool_error`) and replaced by "That could not be loaded right now". A guard block says "held back as a precaution".
- **Guessing:** 8 wrong tries for one email in 15 minutes locks that email for the rest of the 15 minutes (page and connector), shown in the sign-ins table. (Anyone can therefore lock a lead out for 15 minutes by typing wrong passwords for their email; that is the price of stopping guessing.)
- **Headers:** `/my-sales`, `/api/my-sales/*`, `/rep-usage`, `/api/rep-usage` send `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store`; the page is `noindex`.
- **Tests:** `node scripts/rep-leak-scan.mjs <url> <email> <password> <michelle|testlead>` calls every tool for every team member (this and last financial year), scans all text for anyone outside the team, company keys and internal details, and cross-checks the figures (best sellers add up to sales, months and weeks add to the year, debtors add up, team total adds up). 1,237 checks pass for Michelle's team.
- **Known exposure:** the GitHub repository is public and contains `lib/repTargets.js` (each rep's monthly sales targets). It is not a secret key, but it is business-sensitive. Moving targets into a private place (an environment variable or the database) is recommended; the repo cannot simply be made private because the 5-minute warm-up workflow would exceed the free private-repo minutes.
- **Model:** the chat uses `claude-sonnet-5-5` (decided 29 Oct 2026); revisit Haiku 5.5 after a week of usage data.

## 30 Oct 2026: Team 1 test lead, products, rollover, fuller tracking

- **Team 1 test login:** `lead1` ("Team 1 lead (test)", email team1.lead@worthy.test) is enabled with no sales of its own and the six Team 1 people (Jerry, Keith on Ostendo; Nimesh, Nayan, Savan, Naitik on Odoo). When the real lead is named: set `self` and `label` in `LEAD_DEFS` and issue a new code with their email (`make-rep-codes.mjs <folder> lead1=<email>`), which replaces the test password.
- **Products are open, sales are not:** `product_cost` looks up any product's cost price, but only in the system(s) the lead's team sells from (Team 2: Ostendo only; Team 1: Ostendo and Odoo). `team_product_gaps` lists the company's 150 most widely sold products that the team reaches least, with the team's own reach and the product's company rank only. Neither returns any company or other-rep sales figure. Ostendo's blank "no match" row is filtered out.
- **Questions roll over:** 60 a day; unused questions carry over for up to 7 days (a day that used carried questions takes them back off). Only days since the lead's first question count.
- **Tracking:** every question now keeps the full answer (up to 6,000 characters), each lookup with the person or product it was about, the internet address, the approximate place (Vercel's city and region from the address, not a street or suburb), device, system and browser. Sign-ins record the same. All shown on `/rep-usage`. Leads are told on their sheets that this is recorded.
- **Tests:** `scripts/rep-leak-test.mjs` (Team 1 lead sees exactly its six, none of Team 2), `rep-analysis-test.mjs` (rollover rules).
