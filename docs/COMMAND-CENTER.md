# Worthy Command Center

Management only (`/command`, section `command` in `lib/auth.js`). The API (`/api/command`) checks the role itself as well. Built for the Thursday Ecom x Marketing meeting, 24 Nov 2026.

Two halves:
- **E-commerce department** (Pratham's): Dashboard, Search, Social & Web, Outreach, Listings, Pipeline (own items plus relevant ClickUp cards).
- **Ecom x Marketing** tab: the Thursday meeting. Week numbers, live Asana tasks, done this week, spend and return, where visits come from.

A site picker and a date range picker (7, 30, 90 days, this month, last month, 12 months, custom) drive every number and the chart. Search Console periods end 3 days ago at the latest. Clicking enquiries or conversion rate opens every key event GA4 recorded in that period: when, what (contact form, order), page, where the visitor came from, town, device. GA4 holds no names.

worthy.nz is the company site, so it counts enquiries, not sales. "All sites" conversion uses the two shops only.

## Changing tasks from the page

Ticking a task, changing its due date, adding a note, or Start/Done on a pipeline card writes straight to Asana or ClickUp (`asanaWrite`, `clickupWrite`), then reloads from the tool. Every change goes to the activity log (`cc:log:v1`) with the person. ClickUp date-only due dates are stored at 4am NZ, matched here.

## No duplicates

- Asana subtasks that are also in the project show under their parent only.
- ClickUp copies of Thursday meeting items (ids in `ASANA_TWINS`, lib/clickup.js) never show; Asana is the source of truth for meeting items.
- Starter pipeline items were cut to the three re-indexing jobs, which live nowhere else.

## Where each number comes from

| What | Source | Fresh |
| --- | --- | --- |
| Visitors right now | GA4 realtime, last 30 minutes, all three properties | every 30 s |
| Rankings, clicks, impressions, position | Search Console, 28 days ending 3 days ago, against the 28 days before | 30 min cache |
| Non-branded | any search not matching `BRANDED` in `lib/gsc.js` (worthy, dutch rusk, vj trading) | |
| Indexing | Search Console sitemaps | 60 min cache |
| Visits, sales, conversions | GA4 for worthy.nz and dutchrusk.co.nz; Shopify reports for worthyproducts.nz (New Zealand visits only, Online Store sales) | 15 min cache |
| Meeting tasks | Asana project Ecom x Marketing (`1219139073710791`): owner, Status field, due, subtasks | every 30 s (20 s server memo) |
| Pipeline | the page's own board plus ClickUp cards | every 30 s |
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

## Search tab: Google, AI search, Google Shopping

- **AI search** (lib/aiVisibility.js):
  - One card per assistant: Google AI, Claude, ChatGPT, Gemini, Perplexity, Copilot.
  - Visits from each assistant come from GA4, with "converted" meaning visits with a key event.
  - The ChatGPT card shows orders from the Shopify ChatGPT channel.
  - Daily answer checks: 15 buyer questions (`AI_QUESTIONS`), each put to every assistant with a key. Each answer is scored on three things: names us, links our site, and Dutch Rusk still in Nelson. Clicking a cell opens the full answer.
  - The checks run when the view opens and the last run is over a day old, or on Check now.
  - Keys: ANTHROPIC_API_KEY (Claude, set), and optionally OPENAI_API_KEY, GEMINI_API_KEY, PERPLEXITY_API_KEY. Copilot has no API, so it shows visits only.
  - Claude uses the basic web search tool on purpose, because the filtering version returns no sources.
  - Rough cost: about NZ$1 a day for Claude.
- **Google AI** (AI Overviews and AI Mode):
  - Search Console's Generative AI report has no API (probed 24 Nov 2026; every `type` value was rejected). Its figures are read from the report in a signed-in browser and saved with POST `{action: 'google-ai', site, data}`.
  - First capture 24 Nov covers 23 Aug to 22 Nov: worthyproducts.nz 19.6k, worthy.nz 2.43k, dutchrusk.co.nz 434.
- **Google Shopping** (lib/shopping.js):
  - GA4 Organic Shopping (free listings) and Paid Shopping.
  - Product landing pages.
  - Search Console search appearances (Product snippets, Merchant listings) and the searches behind them.

## Social & Web tab (26 Nov 2026)

The Social and Web page's figures inside the Command Center, for the page's own date range and site (`SocialTab`, data from `/api/social-web?from=&to=`).
- Order: headline (online sales, shop visits, worthy.nz visitors, social views), then "From visit to sale" (NZ visits, orders, online sales, with the conversion rate and average order on the links, plus sales by month) and "Social at a glance" (views, engagements, views by account), then each site, then each Facebook and Instagram account, then LinkedIn and TikTok.
- Shop figures are Shopify's (New Zealand sessions, Online Store sales). worthy.nz is Google Analytics. The two are never added together. A site still on Google Analytics is not counted as a shop.
- Meta figures for any period: page insights in 90-day windows, Instagram in 30-day windows, added up; Instagram reach and accounts engaged are left out for periods over 30 days because they count people once.
- When the earlier period has no data (tracking started later) the card says "none recorded before", not "was 0".
- Design rules for this tab and, over time, the whole dashboard: three colours (off-white page, ink, orange accent), infographics with the numbers beside them, icons that fit each title. See the memory note `feedback-dashboard-design-language`.

## Browser cache

Kept in the browser (`cache` helper in app/command/page.js), so a refresh loses nothing:

| Key | What | How long |
|---|---|---|
| `cc-view-v1` | tab, date range, site, chart mode, feed filter | until changed |
| `cc-data-v1` | last Command Center data, shown at once while fresh figures load | up to 24 h, then refreshed |
| `cc-social-v1:<from>\|<to>` | Social & Web figures for that period | 30 min (the server's cache), Refresh always asks again |
| `cc-draft-v1` | an editor with unsaved text | reopens after refresh until saved or cancelled |

Saved work (pipeline, outreach, listings, Asana, ClickUp) lives on the server.

## Meeting notes (Ecom x Marketing tab, 26 Nov 2026)

`MeetingNotes` in app/command/page.js, `lib/meeting.js`, store key `cc:meet:v1`.
- Type during the meeting as normal. Notes save as you type (1.2 s after the last key; unsaved text also kept in the browser) and every meeting's notes stay on record (pick an earlier meeting from the list to read it). The meeting is today if it is Thursday in NZ, otherwise the next Thursday.
- "Read notes into actions": Claude (claude-sonnet-5-5) pulls out discussion points and actions with an owner (only people in the Worthy Asana workspace) and a due date (relative days turned into dates from the meeting day). It never invents owners or dates.
- Check the list (rename, change owner or due date, remove), then "Send to Asana": after a confirm, each task is created in the Ecom x Marketing project and assigned; Asana tells the person. Each send is in the activity log.
- Next meeting: open discussion points (tick when discussed) and the open actions sent from here, with live Asana status; anything marked done in Asana moves to "Done since" the last meeting.
- Trial read without saving: POST `{ action: 'meeting-read', date, trialText }`.
- Asana workspace people on 26 Nov: Anu Shah, Isabel Brooks, Nilam Patel, Pratham Jani, Vishva (shown by email). Kishan is not in Asana, so he cannot be an owner.
- One shared record: if two people type in the notes at the same moment, the last save wins. One person should take the notes.
