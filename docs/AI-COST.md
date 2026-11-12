# Who uses what, and what the AI costs Worthy

Last updated 11 November 2026.

## 1. Who uses what

| Department | People | How they ask questions | Who pays for the AI |
|---|---|---|---|
| Management | kishan@, jainesh@, lakmal@, hetal@, jiten@ (and pratham@, who runs it) | Department connector in their own Claude or ChatGPT account. The dashboard and its chat are also open to them. | Connector: the person's own account. Dashboard chat: Worthy. |
| Sales team leads | Michelle (Team 2). Team 1 lead to be decided. | My Account page on the dashboard only. Own email and access code. | Worthy |
| Purchasing and Stock | kylie@ (dashboard and its chat only), hari@ (connector, and the dashboard) | Kylie: dashboard chat. Hari: connector in his own Claude or ChatGPT, or the dashboard chat. | Kylie: Worthy. Hari: his own account on the connector, Worthy on the dashboard chat. |
| Business Development | Vishva Dave (more people later) | The business development connector in his own Claude, with his own email and access code. No individual rep revenue and no weekly revenue. | The person's own account |

Where each list lives in the code:

- Management and Purchasing people: `lib/people.js`. One line per person. `dashboard: true` lets them sign in to the dashboard, `connector: true` lets them connect a connector. Remove the line and both stop working on the next request.
- Team leads and business development: `lib/repAccess.js` (own email and access code each, kept as a hash in the `REP_ACCESS` setting).

Sign-in for Management and Purchasing is the person's work email plus their department's password, on the dashboard and on the connector. A department password on its own no longer opens anything. Nobody is listed under Business Development on the dashboard, so that department password opens nothing until someone is added.

## 2. What each department can reach

- Management: everything.
- Purchasing and Stock: products, categories, fast and slow movers, cost and margin by product, company totals by month. No sales by rep, no weekly figures, no customers, no debtors, no expenses. This is enforced in the data the AI is given (`lib/mcpRoles.js`, `lib/roleData.js`), on the connector and on the dashboard chat alike, so the AI cannot give out what it never receives.
- Team leads: their own team only.
- Business Development: groups, accounts and costing across North and South. No individual rep revenue, no team figures, no weekly revenue.

## 3. The question allowance (dashboard chat and My Account only)

Anything that runs on Worthy's AI key is limited per person:

- 60 questions a day.
- Questions not used roll over and stay available for the rest of the person's 30-day cycle.
- When the 30 days end, unused questions are dropped and the next cycle starts again at 60.
- So the most one person can ever ask in 30 days is 1,800.
- A question that fails because of the system is given back.
- When the allowance is used up, the next question is refused before any AI is called, so it costs nothing.

The count is kept in the shared store (`lib/repStore.js`). The daily number can be changed with the `REP_CHAT_DAILY_LIMIT` setting in Vercel; no code change is needed.

Connectors in a person's own Claude or ChatGPT have no allowance from Worthy. Their own plan's limits apply and they pay for it.

## 4. What a question costs

Model: Claude Sonnet 5.5. Anthropic's list price in US dollars per million tokens: 2.00 in, 10.00 out, 0.10 for input read from cache, 2.50 for input written to cache.

Sizes below were measured on 11 November 2026 with the real instructions, tool lists and live Odoo and Ostendo data. Tokens are estimated from the measured size (about 3 characters per token for figures), so treat each cost as good to within about 30 percent. The usage page shows the real figure once people are using it.

| Chat | What is sent | Typical question | Range |
|---|---|---|---|
| Purchasing (dashboard chat) | Instructions and tools about 2,000 tokens. One lookup returns 9,000 to 13,000 tokens. | about US$0.05 | US$0.03 to 0.10 |
| Team leads (My Account) | Instructions and tools about 6,000 tokens. Lookups are capped at 20,000 tokens each. | about US$0.05 | US$0.02 to 0.10 |
| Management (dashboard chat) | Instructions and tools about 9,000 tokens. One financial-year lookup returns about 80,000 tokens, debtors about 150,000. | about US$0.30 | US$0.05 to 0.60 |
| AI Insights button | One short call | about US$0.01 | |

Management questions cost about six times more because the management reports hand the AI the full report (every customer, every open invoice). Management mostly use their own connector, where this costs Worthy nothing.

Prompt caching is switched on for both chats (`lib/aiRequest.js`): the repeated part of every step is charged at a tenth of the normal price. Without it a question with a lookup would cost close to double.

## 5. Monthly forecast

Assumes 22 working days a month and US$0.05 a question (team leads and Purchasing).

| Use per person | Questions a month | One person | 10 people |
|---|---|---|---|
| Light, 5 a day | 110 | US$6 | US$55 |
| Normal, 15 a day | 330 | US$17 | US$165 |
| Heavy, 40 a day | 880 | US$44 | US$440 |
| The most the allowance permits (1,800 in 30 days) | 1,800 | US$90 | US$900 |

If a person's questions are management-type questions on the dashboard chat (US$0.30 each), multiply that person's row by six: normal use about US$100 a month, and the ceiling US$540.

Today, the people whose questions Worthy pays for are Michelle, Kylie, Hari when he uses the dashboard chat, and the Team 1 lead once named. At normal use that is roughly US$35 to 70 a month.

Suggested budget for 10 people: US$250 a month, with the Anthropic console spend limit set at US$400 so a surprise cannot run past it. Review after the first full month against the usage page.

## 6. Where to see the real cost

- Dashboard, Rep assistant usage page (management only): questions and AI cost per person for this month and last month, and the month total. Worked out from the tokens recorded for every question.
- The Anthropic console has the invoice figure and the spend limit.

## 7. Adding a person or a department

- A Management or Purchasing person: add a line in `lib/people.js`, deploy, give them the department password.
- A business development person: add them in `lib/repAccess.js` with the marketing role and issue an access code (`scripts/make-rep-codes.mjs`).
- A new department: add a role in `lib/auth.js` (which pages), in `lib/roleData.js` (what is removed from the data) and in `lib/mcpRoles.js` (which tools), then people in `lib/people.js`.

## 8. Tests

- `node scripts/allowance-test.mjs`: the 60 a day and 30-day rule (15 checks).
- `node scripts/people-chat-test.mjs <url> <mgmt pw> <bdm pw> <purchasing pw>`: named sign-in, edited cookies, the Purchasing chat wall, the allowance, connector access, the cost page (45 checks, local server with test people).
- `scripts/access-matrix.mjs` (230), `scripts/department-check.mjs` (44), `scripts/marketing-e2e.mjs` (155): the existing walls between management, team leads, business development and departments.

## 9. Checking the dashboard cost against Anthropic (13 Nov 2026)

On 13 Nov the usage page showed US$0.26 for November and the Anthropic console US$0.36. The US$0.26 is exact for everything since per-person cost recording went live on 11 Nov: six questions, 78,893 tokens written to cache, 70,442 read from cache, 5,175 out, which is US$0.26 at list price and matches the console's 150K input tokens and US$0.26 bar for that day. The other US$0.10 was spent on 9 and 10 Nov, before recording existed (one Team 1 test question and management chat and AI Insights tests), so it is on Anthropic's bill but not in the dashboard's month total. From 11 Nov on the two should agree, apart from the console using UTC days. AI Insights calls where the person is not known are now included in the month total (`otherUsd`).

## 10. Purchasing people (Kylie and Hari)

Both are in `lib/people.js`. Kylie: dashboard and its chat only. Hari: dashboard and the connector. Check the wall with `PURCH_PW=<Purchasing password> node scripts/purchasing-check.mjs <url>` (add `MGMT_PW` on a local server to also search everything Purchasing receives for real rep and customer names). 13 Nov, local server, live data: 177 checks pass (16 rep names and 394 customer names searched for, none found; every other page, API, tool and edited cookie refused). It asks no AI question, so it costs nothing and is safe to run against production.
