/**
 * End-to-end test of the rep connector against a running server (local or live). It signs in as each
 * named rep with their own access code, then checks: only the three rep tools are offered, every
 * management tool is refused, answers name only that rep, tampered tokens are refused.
 * Codes are read from the private folder and are never printed.
 *
 *   node scripts/rep-e2e.mjs <baseUrl> <private codes folder> <repKey> [more repKeys]
 */
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

const base = process.argv[2];
const codesDir = process.argv[3];
const keys = process.argv.slice(4);
const LABEL = { nimesh: 'Nimesh Darjee', nayan: 'Nayan Patel', savan: 'Savan Patel', naitik: 'Naitik Trivedi', jerry: 'Jerry', keith: 'Keith', chris: 'Chris', ravi: 'Ravi Kumar', lynette: 'Lynette', michelle: 'Michelle' };
const codes = Object.fromEntries(readFileSync(`${codesDir}/rep-access-codes.txt`, 'utf8').trim().split('\n').map((l) => {
  const [who, code] = l.split('\t'); const key = Object.keys(LABEL).find((k) => LABEL[k] === who.replace(/ \((North|South)\)$/, '')); return [key, code];
}));

const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
const rpc = async (token, method, params = {}, id = 1) => {
  const r = await fetch(`${base}/api/rep-mcp`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: '2.0', id, method, params }) });
  return { status: r.status, json: r.status === 401 ? null : await r.json().catch(() => null) };
};
async function signIn(key) {
  const reg = await (await fetch(`${base}/api/rep-mcp/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: [REDIRECT], client_name: 'e2e' }) })).json();
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const form = new URLSearchParams({ response_type: 'code', client_id: reg.client_id, redirect_uri: REDIRECT, state: 's', code_challenge: challenge, code_challenge_method: 'S256', scope: '', resource: `${base}/api/rep-mcp`, access_code: codes[key] });
  const a = await fetch(`${base}/api/rep-mcp/authorize`, { method: 'POST', body: form, redirect: 'manual' });
  const loc = a.headers.get('location');
  if (!loc) throw new Error(`sign-in failed for ${key}: ${a.status}`);
  const code = new URL(loc).searchParams.get('code');
  const t = await (await fetch(`${base}/api/rep-mcp/token`, { method: 'POST', body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: reg.client_id, redirect_uri: REDIRECT, code_verifier: verifier }) })).json();
  return t.access_token;
}
const call = async (token, name, args = {}) => {
  const { json } = await rpc(token, 'tools/call', { name, arguments: args });
  return json?.result;
};
const ok = (c, m) => console.log(`${c ? '  ok  ' : 'FAIL  '}${m}`) || (c || (process.exitCode = 1));

for (const key of keys) {
  console.log(`\n== ${key} ==`);
  const token = await signIn(key);
  ok(Boolean(token), 'signed in with own code');
  const list = (await rpc(token, 'tools/list')).json.result.tools.map((t) => t.name);
  ok(JSON.stringify(list) === JSON.stringify(['my_profile', 'my_sales', 'my_debtors', 'my_best_sellers', 'my_customers', 'my_recent_orders', 'my_action_plan', 'my_customer', 'my_cross_sell']), `tools offered: ${list.join(', ')}`);
  for (const bad of ['odoo_search', 'ostendo_query', 'get_financial_year', 'get_south_financial_year', 'get_debtors', 'search', 'fetch']) {
    const r = await call(token, bad, { company: 'north', sql: 'select 1', model: 'res.partner' });
    ok(r?.isError === true, `management tool ${bad} refused`);
  }
  const prof = await call(token, 'my_profile');
  ok(prof.structuredContent.rep === LABEL[key], `profile says ${prof.structuredContent.rep}`);
  // arguments that try to pick someone else are ignored/refused
  const sneaky = await call(token, 'my_sales', { rep: 'Keith', name: 'Savan Patel', company: 'north', fy: 2026 });
  const sales = sneaky.structuredContent;
  ok(sales && sales.rep === LABEL[key], `my_sales answers for ${sales?.rep} even when asked for someone else`);
  const text = JSON.stringify(sales);
  const others = Object.values(LABEL).filter((n) => n !== LABEL[key]);
  const leaked = others.filter((n) => text.includes(n));
  ok(leaked.length === 0, `no other rep named in sales (${leaked.join(', ') || 'none'})`);
  ok(!text.includes('Direct') && !text.includes('"totals"'), 'no Direct / totals');
  console.log(`  YTD revenue ${sales.year?.revenue}  GP ${sales.year?.grossProfit} (${sales.year?.marginPct}%)  months ${sales.months.length}  weeks ${sales.weeks.length}  period ${JSON.stringify(sales.period)}`);
  console.log(`  target ${sales.target ? `FY${sales.target.fy} budget ${sales.target.yearBudget}` : 'none'}`);
  const d = (await call(token, 'my_debtors')).structuredContent;
  const dt = JSON.stringify(d);
  const leakedD = others.filter((n) => d.customers.some((c) => false) || dt.includes(`"rep": "${n}"`));
  ok(leakedD.length === 0, 'debtors: no other rep');
  console.log(`  debtors: ${d.summary.customers} customers, outstanding ${d.summary.outstanding}, overdue ${d.summary.overdue}, invoices ${d.invoices.length}`);
  for (const tool of ['my_best_sellers', 'my_customers', 'my_recent_orders', 'my_action_plan', 'my_cross_sell']) {
    const t0 = Date.now();
    const r = await call(token, tool, { rep: 'Keith', fy: 2026 });
    const res = r?.structuredContent;
    ok(r && !r.isError && res?.rep === LABEL[key], `${tool} answered for ${res?.rep ?? r?.content?.[0]?.text}`);
    const txt = JSON.stringify(res || {});
    const leak = others.filter((n) => txt.includes(`"${n}"`));
    ok(leak.length === 0 && !txt.includes('Direct'), `${tool}: no other rep named`);
    if (tool === 'my_best_sellers') console.log(`  best sellers: ${res.productsSold} products, top: ${res.bestSellers?.[0]?.product} ($${res.bestSellers?.[0]?.revenueThisYear}), ${Date.now() - t0}ms`);
    if (tool === 'my_customers') console.log(`  customers: ${res.summary.customersOrderedThisYear} ordered, top: ${res.topCustomers?.[0]?.customer} ($${res.topCustomers?.[0]?.revenueThisYear}), quiet ${res.quietCustomers.length}, slipping ${res.slippingCustomers.length}, ${Date.now() - t0}ms`);
    if (tool === 'my_recent_orders') console.log(`  recent: ${res.recent.length}, newest ${res.recent?.[0]?.date} ${res.recent?.[0]?.type} $${res.recent?.[0]?.amount}`);
  }
  console.log(`  target pace: ${JSON.stringify(sales.targetProgress && { behind: sales.targetProgress.aheadOrBehind, pct: sales.targetProgress.percentOfBudgetToDate, month: sales.targetProgress.thisMonth && sales.targetProgress.thisMonth.percentOfMonthBudget })}`);
  const bogus = await rpc(token.slice(0, -3) + 'abc', 'tools/list');
  ok(bogus.status === 401, 'tampered token refused (401)');
}
const none = await rpc('not-a-token', 'tools/list');
ok(none.status === 401, 'garbage token refused (401)');
