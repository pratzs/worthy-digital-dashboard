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
