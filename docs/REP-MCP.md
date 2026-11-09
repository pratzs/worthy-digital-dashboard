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

## 9 Nov 2026: Marketing login (Vishva) and the expenses tool for management

**Marketing login (`vishva`, role `marketing`, lib/repAccess.js `LEAD_DEFS`).** Asked for by Kishan: Vishva (marketing) needs costing and sales for corporate accounts, but no individual rep revenue and no weekly revenue. He signs in on the same rep connector (`/api/rep-mcp`) with email + password, in Claude (he uses Claude; Kishan uses ChatGPT on the management connector). He is not a team lead: no team, no own sales, and the My Account chat page refuses him (login returns 403, `repFromSession` returns null for the role), so nothing is billed to Worthy's chat key.
- Tools offered, exactly three: `my_profile`, `product_cost` (any product, BOTH Odoo and Ostendo), `account_sales`. Every rep and team tool answers "Unknown tool" for him (enforced in `runRepToolInner`), and the management tools are unreachable with his token.
- `account_sales {name, fy | from+to}` (lib/accountData.js): a customer matches when every word of the name appears in the customer or its parent account, so "CSB" returns the group and "Caltex Dargaville" returns one store. Returns total, month by month (never weekly), store by store, top products with average price per unit, last invoice date. Basis: posted invoices less credit notes, product lines, before GST; North = Odoo company 4, South = Ostendo; Worthy Oceania is not included. North store figures are invoice totals (same as the dashboard customer list) so a store can differ slightly from the product-sales total.
- No salesperson column is ever selected, output is built field by field, and `guardMarketing` (lib/repProject.js) fails closed if a rep, salesperson, week or team key appears.
- Verified 9 Nov against Odoo directly: North CSB $554,971.49 to the cent; "Caltex Dargaville" $52,661.42 = the dashboard's customer list; Fresh Choice Flat Bush within $54 of the dashboard (non-product lines). Months, systems and totals add up.
- Access code: made with `node scripts/make-rep-codes.mjs "<new folder>" vishva=vishva@worthy.nz` (it refuses an existing folder, so use a new one; never re-run it on the leads' folder, that would rotate their codes). `REP_ACCESS` in Vercel must hold michelle, lead1 AND vishva (merge, do not replace). Switch him off by removing `vishva` from `REP_ACCESS` or raising `ver`.
- Tests: `node scripts/rep-leak-test.mjs` (61, includes the marketing wall), `node scripts/marketing-e2e.mjs <url> <password> <email> [management password]` (60, real data).

**Expenses tool for management (`get_expenses`, lib/expenses.js, in lib/mcpTools.js).** Asked for by Kishan, for the management connector (`/api/mcp`) and management chat only, not the rep or marketing logins. Reads Odoo `hr.expense` (read only; NZD company-currency amounts incl. GST, GST and ex-GST both returned). Defaults: last 12 months, refused claims excluded. Filters: `employee`, `category` (food = the Meals categories; fuel, vehicle, accommodation, travel, software, marketing, office_and_staff, other, or part of a category name), `text` (description), `months` or `from`+`to`, `company`, `status`, `lines`. Returns totals and breakdowns by employee, group, category, month and status plus the newest lines; every breakdown adds to the total; more than 500 matches asks for a narrower question rather than under-reporting.
- **CORRECTION 9 Nov (read this):** the first version of these notes said Savan Patel had no claims and quoted 136 claims and $26,754.68 for 12 months. Those were wrong: they were what the dashboard's Odoo login could SEE when it was only a Team Approver (239 claims, 7 people). Odoo only shows a login the claims its Expenses access allows. After Lakmal made the login an Expenses administrator it sees everything (2,698 claims, 42 employees, both companies, all NZD). Real figures for the 12 months to 9 Nov 2026: **1,443 claims, $287,310.69 incl GST** (North $81,255.81, Oceania $206,054.88); **food (Meals categories) 483 claims, $27,634.32**, top Prashant Khatri $7,520.86, Vishal Soni $3,977.11, Archit Patel $3,348.78, Lakmal $2,738.57; **Savan Patel 58 claims, $7,939.29, of which food 25 claims, $1,283.16**; Pooja Jani food $322.47. Food this financial year (1 Apr to 9 Nov): 310 claims, $18,902.70.
- **How it works now:** totals are worked out INSIDE Odoo (read_group), so they are exact at any size; only the optional list of claim lines is capped. The earlier version fetched up to 500 rows and refused any question matching more, which a whole year of food would have hit. Verified against an independent recomputation (every claim downloaded and added up separately): whole year, food, Savan, Pooja, North plus Oceania all equal to the cent (`expense_compare` run, 21 checks), and by `scripts/marketing-e2e.mjs`.
- **Completeness depends on the Odoo login:** the dashboard uses one Odoo login (Pratham Jani) for everything. If it ever loses Expenses administrator access, expense totals silently shrink to what it can see. Check with a count: the login should see claims from all ~42 employees. The claim's employee is whoever it was entered for/by (Pooja enters some for others, e.g. a rego "Savan 12 Months"), so use `text` as well as `employee` when hunting for a person.
- Anyone who has the management password can use this (the management connector is one shared sign-in). It exposes staff claim detail, so keep that password to management.

## 9 Nov 2026: Marketing login grows into a business development toolset (Vishva, business development lead)

Vishva Dave finds new groups, corporates and customers. Kishan's limits: customer and group detail is fine, but no individual sales rep revenue and no weekly revenue. He uses Claude, through the rep connector (`/api/rep-mcp`) with his own email and password. He sees BOTH Worthy Products North (Odoo) and Worthy Products South / Dutch Rusk (Ostendo) in every tool; each row says which system it came from. Worthy Oceania is not included. The My Account chat page refuses his login.

**Ten tools, and only these (lib/repTools.js `MARKETING_TOOLS`):**
- `my_profile`
- `product_cost`: cost price by name or exact item code, both systems.
- `cost_basket`: cost a deal (list of products and quantities, optional target margin). Ambiguous products are flagged, never guessed; each line can say `system: north|south` because the same code exists in both at different costs (C0422: North 18.21, South 19.10).
- `account_sales`: one account or group by name, month by month, store by store, top products.
- `top_groups`: rank GROUPS, BANNERS, CHANNELS or REGIONS with revenue, share, accounts, stores, active accounts, change on last year.
- `group_accounts`: a group or banner store by store with status (Active, At risk 45-90 days, Lapsed over 90) and an average-revenue-per-active-account benchmark.
- `new_customers`: who joined in the last N days, by channel, banner and city.
- `lapsed_accounts`: win-back targets, biggest past spend first.
- `top_products`: company-wide best sellers with average price and today's cost per unit.
- `system_overview`: Worthy Products North (Odoo) and Worthy Products South / Dutch Rusk (Ostendo) side by side: revenue, growth, accounts, active accounts, new customers, top groups, banners and channels.

**Names (lib/systemNames.js).** `system` accepts every name people use: north, odoo, Worthy Products North = North (Odoo company 4); south, ostendo, Dutch Rusk, Worthy Products South = South (Ostendo). Blank or a plain "Worthy Products" (both businesses carry the name) means both, never a silent pick; anything else (for example Oceania) is refused. Every row is labelled "Worthy Products North (Odoo)" or "Worthy Products South (Dutch Rusk, Ostendo)", `my_profile` returns a glossary of the names and terms, and the connector `initialize` answer carries `instructions` telling Claude what each name means and not to mix the two systems up.

**How groups are defined (lib/bdData.js).** One cached customer x month dataset (30 minutes, tag `rep-data`, refreshed by the rep warm-up job). North: the invoice line's partner is the head account, so CSB Groups 3 Ltd is one row (74 delivery stores under it); banner comes from chain tags (Mobil, Caltex, Fresh Choice, BP, Four Square, Rakesh Soni shops); `VJ Sales / ...` tags are rep territories and are ignored. South: group = `BILLINGCUSTOMER` when it differs from the customer (Foodstuffs South Island, Night n Day, Red Circle, CSB Group...), banner = `CUSTOMERANALYSISCODE`, channel = `CUSTOMERTYPE`, region = `CUSTOMERREGIONCODE`. CSB is aliased across the two systems. Intercompany and staff accounts (Worthy..., Dutch Rusk..., price check) are left out of every ranking. "New" = North first invoice ever in the window; South customer record created in the window (1,563 accounts were migrated in Feb 2025, so those are not new) and invoiced since.

**Rules that keep it honest.** Revenue basis is the dashboard's: posted invoices less credit notes, product lines, before GST. Only monthly totals are held, so a rep's or a week's revenue cannot be rebuilt. Year on year compares COMPLETED months only (this month is part-way through). Every ranking adds back to the total (banner and channel rankings plus "not recorded" equal the external total). `guardMarketing` blocks rep, salesperson, week and team keys at any depth.

**Verified 9 Nov against independent Odoo and Ostendo queries:** external revenue FY26 to date $19,791,546.19 = North $10,519,174.13 + South $11,012,319.22 less intercompany and staff accounts, and North equals the dashboard's North revenue exactly. Mobil banner $577,298.16, same months last year $296,130.42, +88.0%. Lapsed list matches the dashboard's own lapsed customers (Merry's Berries $70,283, Canary Distributor $56,052, IJH $53,323). BIC FLIK top product 4,061 units $204,376 = Analytics tab. `scripts/marketing-e2e.mjs` (153 checks on real data, includes the dashboard reconciliation when given the management password).

**Open points:** channel is recorded for South only (North only for fuel and liquor-store tags); regions are each system's own records and not harmonised; "Standard" in South is the default customer type; 1,495 accounts have no banner. Vishva's access code is in `Worthy Rep Access\vishva`; `REP_ACCESS` in Vercel needs michelle, lead1 and vishva together (merged file provided).

## 9 Nov 2026: who can see what (access audit)

Four separate doors, each with its own credential. `node scripts/access-matrix.mjs <url> <vishva pw> <vishva email> <test lead pw> <test lead email> <mgmt pw> [bdm pw] [purchasing pw]` tests every credential against every door (124 checks, run against a local server with `REP_ALLOW_TEST_LEAD=1`; `REP_ALLOW_TEST_LEAD` must never be set in Vercel, and is not).

| Credential | What it opens | What it cannot open |
|---|---|---|
| Management dashboard cookie / management connector token (`/api/mcp`) | Everything on the dashboard, `/rep-usage`, `/api/targets`, all management tools incl. Odoo/Ostendo queries, expenses, cost gaps | The rep connector (`/api/rep-mcp`) refuses a management token |
| Team lead (My Account cookie, or rep connector token), e.g. Michelle, Team 1 | Own sales and each person on their own team, team totals, product cost in their own system | Another team's people ("not on your team"), company totals, any marketing or management tool, any dashboard page or API |
| Marketing (rep connector token), Vishva | Ten business development tools over both systems (groups, banners, channels, accounts, new, lapsed, products, costing) | Any rep, team or weekly figure, any lead tool, any management tool, the My Account page (403, no session), the dashboard, the management connector |
| BDM / Purchasing dashboard cookies | Their listed pages and APIs only | `/rep-usage`, `/api/targets`, `/api/chat`, any rep session |

Findings (9 Nov, existing design, not changed): the BDM role includes Sales by Rep by design, and the Purchasing role can read `/api/odoo/fy` and `/api/ostendo/fy` directly, which return every rep's revenue, weekly figures and customer rankings (its pages hide them, the API does not). So: never give Vishva the BDM or Purchasing dashboard password; to stop rep revenue reaching Purchasing, strip `reps`, `weeks`, `customers` and `clv` from those two payloads for that role (needs the role passed from middleware to the routes).

## 9 Nov 2026: departments (Management, Business Development, Purchasing) on the dashboard AND the connector

**Problem found by the access audit:** the Purchasing password could read every rep's revenue, weekly figures and customer rankings from the dashboard API (its pages hid them, the API did not), and the management connector only knew one login (the Management password).

**What changed**
- **One rule, enforced in the data (`lib/roleData.js`, `lib/roleResponse.js`).** Middleware sets `x-worthy-role` from the verified `worthy_auth` cookie on every request and always discards a value sent by the caller. The five data routes (`/api/odoo`, `/api/odoo/fy`, `/api/odoo/advanced`, `/api/ostendo/fy`, `/api/ostendo/advanced`) are wrapped with `withRoleFilter`. Management and Business Development get the payload unchanged (the BDM department includes Sales by Rep and customers by design, set 11 Oct). Purchasing (and any unknown or missing department, which fails closed) loses `reps`, `weeks`, `weekly`, `repMargins`, `repMarginAvailable/Note`, `salespeople*`, `customers`, `clv`, `churned`, `atRisk`, `lapsed` at any depth. Purchasing keeps totals, months, products, categories, fast and slow movers, stock, and new-customer counts. Its Products and Movers pages were checked on North and South: they render fully, no console errors.
- **The connector now asks which department (`/api/mcp/authorize`).** Choose Management, Business Development & Marketing or Purchasing & Stock, then that department's own dashboard password (`DASHBOARD_PASSWORD`, `DASHBOARD_PASSWORD_BDM`, `DASHBOARD_PASSWORD_PURCHASING`; constant-time compare, 1.5 s delay on a wrong one, and a department with no password set cannot sign in). The signed token carries the department; `lib/mcpRoles.js` scopes tools, instructions and every call. Tokens issued before departments existed (including Kishan's ChatGPT connector) carry `mgmt` and keep working unchanged; a sign-in with no department chosen is Management.
- **Tools by department.** Management: all (raw Odoo and Ostendo queries, debtors, expenses, cost gaps, plus the new `get_product_analytics`). Business Development and Purchasing: only `get_financial_year`, `get_south_financial_year`, `get_product_analytics`, `search`, `fetch`. Purchasing's results go through the filter above; its `search` and `fetch` return products, items and suppliers only (no customers); Business Development's `fetch` of a customer omits the assigned salesperson. Everything else answers "not available to your department".
- Vishva's Marketing login is unchanged and separate (rep connector). Never give him the BDM or Purchasing dashboard password.

**Checks:** `node scripts/rep-leak-test.mjs` (71 offline, includes the filter), `node scripts/access-matrix.mjs ...` (229 on a local server: every credential against every door, spoofed role header, wrong-department passwords, `__proto__` and `constructor` as department), and `scripts/department-check.mjs` which Pratham can run against production with only the three department passwords in environment variables.
