/**
 * Full leak scan against a running server. Signs in as a team lead, calls EVERY tool for EVERY person on the team (and the
 * team tools), for this and last financial year, and scans the whole text of every answer for anyone outside the team,
 * company-level words and internal details. It also cross-checks the figures against each other (best sellers add up to
 * sales, debtors add up, team total adds up, ...).
 *
 *   node scripts/rep-leak-scan.mjs <url> <lead email> <lead password> <lead key>
 *
 * lead key: michelle (Team 2) or testlead (needs REP_ALLOW_TEST_LEAD=1 on the server).
 */
import { createHash, randomBytes } from 'node:crypto';

const [base, email, password, leadKey] = process.argv.slice(2);
if (!base || !email || !password || !leadKey) { console.error('Usage: node scripts/rep-leak-scan.mjs <url> <email> <password> <michelle|testlead>'); process.exit(1); }
const R = 'https://claude.ai/api/mcp/auth_callback';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.error(`FAIL  ${m}`); } };
const note = (m) => console.log(`  note ${m}`);

// Everyone who exists in the system, by the labels and first names that could appear in text.
const EVERYONE = [
  ['nimesh', 'Nimesh Darjee'], ['nayan', 'Nayan Patel'], ['savan', 'Savan Patel'], ['naitik', 'Naitik Trivedi'],
  ['jerry', 'Jerry'], ['keith', 'Keith'], ['chris', 'Chris'], ['ravi', 'Ravi Kumar'], ['lynette', 'Lynette'], ['michelle', 'Michelle'],
];
const TEAMS = { michelle: ['michelle', 'chris', 'ravi', 'lynette'], testlead: ['nimesh', 'jerry'] };
const team = new Set(TEAMS[leadKey]);
const outsiders = EVERYONE.filter(([k]) => !team.has(k));
const OTHER_WORDS = ['Leith', 'Christchurch Office', 'Hari Patel', 'Rubin', 'Direct', 'Pratham'];
const COMPANY_KEYS = ['"totals"', '"reps"', '"repMargins"', '"customersTop"', '"atRisk"', '"churned"', '"clv"', '"categories"'];
const INTERNALS = [/ostendo_query|odoo_search|execute_kw/i, /select\s.+\sfrom\s/i, /RDB\$/, /firebird/i, /psycopg|traceback|stack trace|at \w+\.\w+ \(/i, /sk-ant/i, /REP_ACCESS|REP_AUTH_SECRET|KV_REST/i, /https?:\/\/[^"\s]*(odoo|ostendo)[^"\s]*/i];

async function token() {
  const reg = await (await fetch(`${base}/api/rep-mcp/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: [R] }) })).json();
  const v = randomBytes(32).toString('base64url'), ch = createHash('sha256').update(v).digest('base64url');
  const a = await fetch(`${base}/api/rep-mcp/authorize`, { method: 'POST', redirect: 'manual', body: new URLSearchParams({ response_type: 'code', client_id: reg.client_id, redirect_uri: R, state: 's', code_challenge: ch, code_challenge_method: 'S256', scope: '', resource: '', access_code: password, email }) });
  const c = new URL(a.headers.get('location')).searchParams.get('code');
  return (await (await fetch(`${base}/api/rep-mcp/token`, { method: 'POST', body: new URLSearchParams({ grant_type: 'authorization_code', code: c, client_id: reg.client_id, redirect_uri: R, code_verifier: v }) })).json()).access_token;
}
const T = await token();
const call = async (name, args = {}) => {
  const r = (await (await fetch(`${base}/api/rep-mcp`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${T}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) })).json()).result;
  return { err: r.isError, text: r.content?.[0]?.text || '', data: r.structuredContent };
};
const word = (n) => new RegExp(`(^|[^A-Za-z])${n.replace(/ /g, '\\s+')}([^A-Za-z]|$)`, 'i');
const names = EVERYONE.filter(([k]) => team.has(k)).map(([, l]) => l);
const scan = (label, text) => {
  for (const [, l] of outsiders) {
    const first = l.split(' ')[0];
    for (const needle of new Set([l, first])) {
      const m = word(needle).exec(text);
      if (m) {
        const i = m.index; note(`"${needle}" appears in ${label}: …${text.slice(Math.max(0, i - 60), i + 80).replace(/\s+/g, ' ')}…`);
        // A name inside a customer or product name is not a leak, but a name in a rep field is: judge by field.
        if (new RegExp(`"(rep|person|salesperson|owner|assignedTo)"\\s*:\\s*"[^"]*${needle}`, 'i').test(text)) ok(false, `${label}: ${needle} in a rep field`);
      }
    }
  }
  for (const w of OTHER_WORDS) if (word(w).test(text)) note(`"${w}" appears in ${label} (a customer or product name, not a rep field)`);
  for (const k of COMPANY_KEYS) ok(!text.includes(k), `${label}: company key ${k}`);
  for (const re of INTERNALS) ok(!re.test(text), `${label}: internal detail ${re}`);
};

const FYS = [undefined, 2025];
const TOOLS = ['my_sales', 'my_debtors', 'my_best_sellers', 'my_customers', 'my_recent_orders', 'my_action_plan', 'my_cross_sell'];
const byPerson = {};
console.log(`Lead ${leadKey}: team ${names.join(', ')}; checking ${outsiders.length} outsiders`);
for (const [k, label] of EVERYONE.filter(([k]) => team.has(k))) {
  const first = label.split(' ')[0];
  byPerson[k] = {};
  for (const fy of FYS) {
    for (const tool of TOOLS) {
      const args = { person: first, ...(fy ? { fy } : {}) };
      const r = await call(tool, args);
      ok(!r.err, `${tool} ${first} fy=${fy || 'now'} errored: ${r.text.slice(0, 80)}`);
      if (r.err) continue;
      scan(`${tool}/${first}/fy${fy || 'now'}`, r.text);
      ok(r.data && r.data.rep === label, `${tool}/${first}: answer is for ${label} (got ${r.data?.rep})`);
      if (!fy) byPerson[k][tool] = r.data;
    }
  }
  const cu = await call('my_customer', { person: first, name: (byPerson[k].my_customers?.topCustomers?.[0]?.customer || 'a').slice(0, 20) });
  scan(`my_customer/${first}`, cu.text);
  const pr = await call('my_profile', {}); scan('my_profile', pr.text);
}
for (const tool of ['team_overview', 'team_attention', 'my_profile']) {
  const r = await call(tool); ok(!r.err, `${tool} errored`); scan(tool, r.text); byPerson[tool] = r.data;
}

console.log('\nCross-checks between answers');
const near = (a, b, tol = 1) => Math.abs((Number(a) || 0) - (Number(b) || 0)) <= tol;
let teamRev = 0;
for (const [k, label] of EVERYONE.filter(([k]) => team.has(k))) {
  const d = byPerson[k]; const first = label.split(' ')[0];
  const rev = d.my_sales?.year?.revenue || 0; teamRev += rev;
  ok(near(d.my_best_sellers.totalRevenueOnTheseProducts, rev, 1), `${first}: best sellers total ${d.my_best_sellers.totalRevenueOnTheseProducts} = sales ${rev}`);
  const months = (d.my_sales.months || []).reduce((s, m) => s + (Number(m.revenue) || 0), 0);
  ok(near(months, rev, 1), `${first}: months add to year (${Math.round(months)} vs ${Math.round(rev)})`);
  const weeks = (d.my_sales.weeks || []).reduce((s, w) => s + (Number(w.revenue) || 0), 0);
  ok(near(weeks, rev, 2), `${first}: weeks add to year (${Math.round(weeks)} vs ${Math.round(rev)})`);
  const top = (d.my_customers.topCustomers || []).reduce((s, c) => s + (Number(c.revenueThisYear) || 0), 0);
  ok(top <= rev + 1, `${first}: top customers (${Math.round(top)}) do not exceed sales (${Math.round(rev)})`);
  const db = d.my_debtors;
  const custSum = (db.customers || []).reduce((s, c) => s + (Number(c.total) || 0), 0);
  ok(near(db.summary.outstanding, custSum, 1), `${first}: debtors summary ${db.summary.outstanding} = sum of customers ${Math.round(custSum * 100) / 100}`);
  const ageing = ['current', 'd1to30', 'd31to60', 'd61to90', 'over90'].reduce((s, f) => s + (Number(db.summary[f]) || 0), 0);
  ok(near(ageing, db.summary.outstanding, 1), `${first}: debtor age buckets add to outstanding (${Math.round(ageing)} vs ${db.summary.outstanding})`);
  const ids = new Set((db.customers || []).map((c) => c.id));
  ok((db.invoices || []).every((i) => ids.has(i.c)), `${first}: every debtor invoice belongs to one of their customers`);
  const od = (db.customers || []).reduce((s, c) => s + (Number(c.overdue) || 0), 0);
  ok(near(od, db.summary.overdue, 1), `${first}: overdue adds up`);
  ok((d.my_recent_orders.recent || []).length <= 30, `${first}: recent orders capped`);
  const opp = d.my_action_plan.opportunities || [];
  ok(opp.length <= 10 && opp.every((o) => Array.isArray(o.evidence) && o.evidence.length), `${first}: every suggestion carries evidence`);
}
const ov = byPerson.team_overview;
ok(near(ov.teamTotal.revenue, teamRev, 1), `team total ${ov.teamTotal.revenue} = sum of people ${Math.round(teamRev * 100) / 100}`);
ok(ov.members.length === team.size && ov.members.every((m) => names.includes(m.person)), 'team overview lists exactly the team');
for (const m of ov.members) {
  const key = EVERYONE.find(([, l]) => l === m.person)[0];
  ok(near(m.year?.revenue, byPerson[key].my_sales.year?.revenue, 0.01), `overview matches my_sales for ${m.person}`);
  ok(m.thisMonth && m.thisMonth.key === m.period.to.slice(0, 7), `${m.person}: "this month" is the month of the data (${m.thisMonth?.key})`);
}

console.log(`\n${pass} checks passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
