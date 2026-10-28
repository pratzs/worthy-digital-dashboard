# Rep-only MCP connector (My Sales)

A separate connector for sales reps. Each rep sees ONLY their own sales and the debtors of their own customers, from the system they work in (North = Odoo, South = Ostendo). The management connector (`/api/mcp`) is unchanged and unrelated: different endpoint, different signing key, different sign-in, different tools. A token from one never works on the other.

- Endpoint to add in Claude / ChatGPT: `https://worthy-digital-dashboard.vercel.app/api/rep-mcp`
- Tools: `my_profile`, `my_sales` (optional `fy`), `my_debtors`. No tool accepts a person, customer, query or filter.
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
