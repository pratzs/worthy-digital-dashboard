/**
 * Team-lead end-to-end test against a running server (real Odoo/Ostendo data when the server has them).
 * Signs in through the real connector sign-in with leads' codes and checks that each lead sees their own team
 * in full, totals add up, and nobody outside the team can be reached by any tool or argument.
 *
 *   node scripts/rep-team-e2e.mjs <base url> <michelle code> [test lead code]
 *
 * The test lead (Nimesh North + Jerry South, a mixed team) exists only on a server started with REP_ALLOW_TEST_LEAD=1.
 */
import { createHash, randomBytes } from 'node:crypto';

const [base, michelleCode, testCode] = process.argv.slice(2);
const MICHELLE_EMAIL = process.env.MICHELLE_EMAIL || 'michelle@test.invalid';   // set to her real email when testing a real server
const EMAIL = { [michelleCode]: MICHELLE_EMAIL, [testCode]: 'lead@test.invalid' };
if (!base || !michelleCode) { console.error('Usage: node scripts/rep-team-e2e.mjs <url> <michelle code> [test lead code]'); process.exit(1); }
const R = 'https://claude.ai/api/mcp/auth_callback';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ok  ${m}`); } else { fail++; console.error(`FAIL  ${m}`); } };

async function token(code) {
  const reg = await (await fetch(`${base}/api/rep-mcp/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: [R] }) })).json();
  const v = randomBytes(32).toString('base64url'), ch = createHash('sha256').update(v).digest('base64url');
  const a = await fetch(`${base}/api/rep-mcp/authorize`, { method: 'POST', redirect: 'manual', body: new URLSearchParams({ response_type: 'code', client_id: reg.client_id, redirect_uri: R, state: 's', code_challenge: ch, code_challenge_method: 'S256', scope: '', resource: '', access_code: code, email: EMAIL[code] ?? 'x@test.invalid' }) });
  const loc = a.headers.get('location');
  const c = loc && new URL(loc).searchParams.get('code');
  if (!c) return null;
  const t = await (await fetch(`${base}/api/rep-mcp/token`, { method: 'POST', body: new URLSearchParams({ grant_type: 'authorization_code', code: c, client_id: reg.client_id, redirect_uri: R, code_verifier: v }) })).json();
  return t.access_token || null;
}
const rpc = async (t, method, params) => (await (await fetch(`${base}/api/rep-mcp`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${t}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json()).result;
const call = async (t, name, args = {}) => { const r = await rpc(t, 'tools/call', { name, arguments: args }); return { err: r.isError, text: r.content?.[0]?.text || '', data: r.structuredContent }; };

const OTHERS_FOR_MICHELLE = ['Jerry', 'Keith', 'Nimesh', 'Nayan', 'Savan', 'Naitik', 'Leith', 'Direct', 'Hari Patel', 'Rubin'];

async function michelle() {
  console.log('Michelle (Team 2: Michelle, Chris, Ravi, Lynette)');
  const t = await token(michelleCode);
  ok(Boolean(t), 'signs in with her code');
  if (!t) return;
  const list = (await rpc(t, 'tools/list')).tools;
  const names = list.map((x) => x.name);
  ok(names.includes('team_overview') && names.includes('team_attention') && names.includes('my_sales'), 'team tools are offered');
  ok(names.length === 11, `11 tools (have ${names.length})`);
  ok(list.filter((x) => x.name !== 'my_profile' && !x.name.startsWith('team_')).every((x) => x.inputSchema.properties.person), 'person argument on each person tool');

  const prof = await call(t, 'my_profile');
  ok(!prof.err && prof.data.teamMembers.length === 3 && prof.data.team === 'Team 2', 'profile shows lead and 3 team members');

  const ov = await call(t, 'team_overview');
  ok(!ov.err, 'team_overview works');
  const labels = ov.data.members.map((m) => m.person).sort();
  ok(JSON.stringify(labels) === JSON.stringify(['Chris', 'Lynette', 'Michelle', 'Ravi Kumar']), `team is exactly ${labels.join(', ')}`);
  for (const o of OTHERS_FOR_MICHELLE) ok(!ov.text.includes(o), `overview does not mention ${o}`);
  const sum = ov.data.members.reduce((s, m) => s + (m.year?.revenue || 0), 0);
  ok(Math.abs(sum - ov.data.teamTotal.revenue) < 0.05, `team total ${ov.data.teamTotal.revenue} = sum of members ${Math.round(sum * 100) / 100}`);
  console.log('     ', ov.data.members.map((m) => `${m.person}: ${m.year ? Math.round(m.year.revenue) : 'none'}`).join(' | '), '| team', Math.round(ov.data.teamTotal.revenue));

  for (const who of ['Chris', 'Ravi', 'Lynette']) {
    const s = await call(t, 'my_sales', { person: who });
    const row = ov.data.members.find((m) => m.person.startsWith(who));
    ok(!s.err && s.data.year && Math.abs(s.data.year.revenue - row.year.revenue) < 0.01, `${who} my_sales matches the overview`);
    const d = await call(t, 'my_debtors', { person: who });
    ok(!d.err && d.data.customers.every(() => true) && d.data.rep.startsWith(who), `${who} debtors are ${who}'s`);
    for (const tool of ['my_best_sellers', 'my_customers', 'my_cross_sell', 'my_recent_orders', 'my_action_plan']) {
      const r = await call(t, tool, { person: who });
      ok(!r.err && r.data.rep.startsWith(who) && OTHERS_FOR_MICHELLE.every((o) => !r.text.includes(`"${o}"`)), `${who} ${tool} is ${who}'s only`);
    }
  }
  const self = await call(t, 'my_sales');
  ok(!self.err && self.data.rep === 'Michelle', 'no person means Michelle herself');
  const att = await call(t, 'team_attention');
  ok(!att.err && att.data.members.length === 4 && OTHERS_FOR_MICHELLE.every((o) => !att.text.includes(o)), 'team_attention covers the 4 and nobody else');

  // Every way of asking for someone outside the team
  for (const who of ['Jerry', 'Keith', 'Savan', 'Nimesh Darjee', 'naitik', 'Leith', 'everyone', 'Direct', '*', 'Chris,Jerry']) {
    for (const tool of ['my_sales', 'my_debtors', 'my_customers', 'my_best_sellers', 'my_action_plan', 'my_recent_orders', 'my_cross_sell']) {
      const r = await call(t, tool, { person: who });
      if (!r.err || !/not on your team|more than one/.test(r.text)) { ok(false, `${tool} person=${who} was NOT refused: ${r.text.slice(0, 80)}`); }
    }
  }
  ok(true, 'every outside person x every tool refused');
  const cust = await call(t, 'my_customer', { name: 'a', person: 'Jerry' });
  ok(cust.err, 'my_customer for Jerry refused');
  const unknown = await call(t, 'ostendo_query', { sql: 'select 1' });
  ok(unknown.err, 'management tools do not exist here');
  // Extra unexpected arguments must not widen anything
  const sneaky = await call(t, 'team_overview', { people: ['jerry'], rep: 'jerry', company: 4 });
  ok(!sneaky.err && sneaky.data.members.length === 4 && !sneaky.text.includes('Jerry'), 'extra arguments are ignored');
}

async function testLead() {
  console.log('Test lead (Nimesh North + Jerry South): a mixed team');
  const t = await token(testCode);
  ok(Boolean(t), 'test lead signs in');
  if (!t) return;
  const ov = await call(t, 'team_overview');
  ok(!ov.err && ov.data.members.map((m) => m.person).sort().join() === 'Jerry,Nimesh Darjee', 'team is Nimesh Darjee and Jerry');
  const sum = ov.data.members.reduce((s, m) => s + (m.year?.revenue || 0), 0);
  ok(sum > 0 && Math.abs(sum - ov.data.teamTotal.revenue) < 0.05, `team total ${ov.data.teamTotal.revenue} = North + South sum`);
  console.log('     ', ov.data.members.map((m) => `${m.person} (${m.system}): ${m.year ? Math.round(m.year.revenue) : 'none'}`).join(' | '));
  const none = await call(t, 'my_sales');
  ok(none.err && /Say which team member/.test(none.text), 'with no sales of their own the lead must name someone');
  for (const who of ['Savan', 'Chris', 'Michelle', 'Keith']) { const r = await call(t, 'my_sales', { person: who }); ok(r.err && /not on your team/.test(r.text), `${who} refused`); }
  for (const who of ['Nimesh', 'Jerry']) {
    const r = await call(t, 'my_best_sellers', { person: who });
    ok(!r.err && r.data.rep.startsWith(who), `${who} best sellers (full detail)`);
    const d = await call(t, 'my_debtors', { person: who });
    ok(!d.err && d.data.rep.startsWith(who), `${who} debtors (full detail)`);
  }
  ok(!ov.text.includes('Savan') && !ov.text.includes('Keith') && !ov.text.includes('Chris'), 'no other names in the mixed team overview');
}

// Wall between leads: a lead's token can never act as the other lead
async function crossLead() {
  if (!testCode) return;
  console.log('Wall between leads');
  const a = await token(michelleCode), b = await token(testCode);
  const m = await call(a, 'team_overview'), x = await call(b, 'team_overview');
  ok(m.data.members.every((r) => !['Jerry', 'Nimesh Darjee'].includes(r.person)), 'Michelle never gets the test lead\'s people');
  ok(x.data.members.every((r) => !['Chris', 'Michelle', 'Lynette', 'Ravi Kumar'].includes(r.person)), 'the test lead never gets Michelle\'s people');
}

async function badCodes() {
  console.log('Everyone else is locked out');
  for (const c of ['x'.repeat(24), '', 'a'.repeat(30)]) ok((await token(c)) === null, `code "${c.slice(0, 6)}" refused`);
  EMAIL[michelleCode] = 'someone.else@test.invalid';
  ok((await token(michelleCode)) === null, 'right password with the WRONG email is refused');
  EMAIL[michelleCode] = MICHELLE_EMAIL.toUpperCase();
  ok(Boolean(await token(michelleCode)), 'email is not case sensitive');
  EMAIL[michelleCode] = MICHELLE_EMAIL;
}

await badCodes();
await michelle();
if (testCode) await testLead();
await crossLead();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
