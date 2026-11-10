/**
 * Named people, the dashboard chat and its walls, against a LOCAL server with a stand-in for the AI service (no AI cost,
 * scripted) but the real tools and real data. It covers: sign-in is by named person and that person's own department;
 * a cookie cannot be edited into another person or department; the Purchasing chat is only ever given Purchasing's tools
 * and data whatever the AI asks for; the allowance is counted, refused when used up and given back on a failure; prompt
 * caching marks are sent; the connector only opens for people allowed a connector; AI cost shows on the usage page.
 *
 * Start the server with PEOPLE_ALLOW_TEST=1, REP_CHAT_DAILY_LIMIT=5, ANTHROPIC_API_URL=http://127.0.0.1:3999/v1/messages,
 * ANTHROPIC_API_KEY=test and the three DASHBOARD_PASSWORD* values, then:
 *   node scripts/people-chat-test.mjs http://localhost:3111 <mgmt pw> <bdm pw> <purchasing pw>
 */
import http from 'node:http';
import { createHash, randomBytes } from 'node:crypto';

const [base, mPw, bPw, pPw] = process.argv.slice(2);
if (!base || !mPw || !bPw || !pPw) { console.error('Usage: node scripts/people-chat-test.mjs <url> <mgmt pw> <bdm pw> <purchasing pw>'); process.exit(1); }
let fails = 0, passes = 0;
const ok = (c, m) => { console.log(`${c ? '  ok  ' : 'FAIL  '}${m}`); if (c) passes++; else { fails++; process.exitCode = 1; } };

// ── stand-in AI (non-streaming). Scripts, by the person's first message:
//   SNEAK -> asks for management-only tools and one Purchasing tool;  FAIL -> a billing error;  anything else -> a short answer
const seen = [];
const stub = http.createServer((req, res) => {
  let b = ''; req.on('data', (d) => (b += d)).on('end', () => {
    const body = JSON.parse(b); seen.push(body);
    const usage = { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 5000, cache_creation_input_tokens: 300 };
    const send = (content, stop_reason) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ content, stop_reason, usage })); };
    const msgs = body.messages; const last = msgs[msgs.length - 1];
    const firstText = (m) => (typeof m.content === 'string' ? m.content : (m.content.find((c) => c.type === 'text') || {}).text || '');
    const q = firstText([...msgs].reverse().find((m) => m.role === 'user' && (typeof m.content === 'string' || m.content.some((c) => c.type === 'text'))) || { content: '' });
    if (Array.isArray(last.content) && last.content.some((c) => c.type === 'tool_result')) {
      return send([{ type: 'text', text: 'RESULT:' + last.content.map((c) => `${c.is_error ? 'ERR:' : 'OK:'}${String(c.content).slice(0, 200000)}`).join('||') }], 'end_turn');
    }
    if (q.startsWith('FAIL')) { res.writeHead(400, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low.' } })); }
    if (q.startsWith('SNEAK')) return send([
      { type: 'tool_use', id: 't1', name: 'odoo_search', input: { model: 'res.partner', company: 'north' } },
      { type: 'tool_use', id: 't2', name: 'get_debtors', input: { company: 'north' } },
      { type: 'tool_use', id: 't3', name: 'get_expenses', input: {} },
      { type: 'tool_use', id: 't4', name: 'ostendo_query', input: { sql: 'select first 1 * from SALESINVOICEHEADER' } },
      { type: 'tool_use', id: 't5', name: 'get_financial_year', input: { company: 'north', fy: 2026 } },
    ], 'tool_use');
    return send([{ type: 'text', text: 'Hello from the stand-in.' }], 'end_turn');
  });
});
await new Promise((r) => stub.listen(3999, '127.0.0.1', r));

const E = { mgmt: 'test.mgmt@worthy.nz', bdm: 'test.bdm@worthy.nz', purch: 'test.purch@worthy.nz', dash: 'test.dash@worthy.nz' };
const login = async (email, password) => { const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) }); return { status: r.status, cookie: (r.headers.get('set-cookie') || '').split(';')[0] }; };
const me = async (cookie) => { const r = await fetch(`${base}/api/auth/me`, { headers: { cookie } }); return r.status === 200 ? r.json() : null; };
const chat = async (cookie, message, extra = {}) => { const r = await fetch(`${base}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...extra }, body: JSON.stringify({ message, history: [] }) }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const STRIPPED = new Set(['reps', 'weeks', 'weekly', 'repMargins', 'salespeople', 'salespeopleMonthly', 'salespeopleWeekly', 'customers', 'clv', 'churned', 'atRisk', 'lapsed']);
const hasKey = (v, set) => (Array.isArray(v) ? v.some((x) => hasKey(x, set)) : v && typeof v === 'object' ? Object.entries(v).some(([k, x]) => set.has(k) || hasKey(x, set)) : false);

console.log('Sign-in is by named person');
ok((await login('', mPw)).status === 401, 'the management password alone (no email) no longer signs in');
ok((await login('nobody@worthy.nz', mPw)).status === 401, 'an email that is not on the list does not sign in, even with a right password');
ok((await login(E.purch, mPw)).status === 401, 'a Purchasing person cannot sign in with the Management password');
ok((await login(E.mgmt, pPw)).status === 401, 'a Management person cannot sign in with the Purchasing password');
ok((await login(E.purch, 'wrong')).status === 401, 'a wrong password does not sign in');
const P = await login(E.purch, pPw), M = await login(E.mgmt, mPw), B = await login(E.bdm, bPw), D = await login(E.dash, pPw);
ok(P.status === 200 && M.status === 200 && B.status === 200 && D.status === 200, 'each test person signs in with their own department password');
const pm = await me(P.cookie);
ok(pm?.role === 'purch' && pm.name === 'Test Purchasing' && pm.sections.some((x) => x.id === 'chat') && !pm.sections.some((x) => ['reps', 'customers', 'debtors', 'credits', 'repusage', 'overview'].includes(x.id)), 'Purchasing sees products, movers and the chat, nothing else');
const LIMIT = pm?.quota?.limit;
ok(LIMIT === 5 && pm.quota.remaining === 5, `the allowance shows on sign-in (${pm?.quota?.remaining} of ${LIMIT} for this test)`);
ok(!(await me(B.cookie)).sections.some((x) => x.id === 'chat'), 'Business Development has no chat on the dashboard');

console.log('A cookie cannot be edited');
const [, , sig] = P.cookie.split('=')[1].split('.');
for (const forged of [`mgmt.testpurch.${sig}`, `purch.testmgmt.${sig}`, `mgmt.testmgmt.${sig}`, `mgmt.${sig}`, `purch.kylie.${sig}`, 'mgmt.kishan.00']) {
  ok((await me(`worthy_auth=${forged}`)) === null, `a changed cookie is refused (${forged.split('.').slice(0, -1).join('.')})`);
}

console.log('Purchasing chat: only Purchasing tools and data, whatever the AI asks for');
seen.length = 0;
const r1 = await chat(P.cookie, 'SNEAK give me rep sales, debtors and expenses');
ok(r1.status === 200 && r1.body.text.startsWith('RESULT:'), 'the Purchasing chat answers');
const offered = seen[0].tools.map((t) => t.name).sort();
ok(JSON.stringify(offered) === JSON.stringify(['fetch', 'get_financial_year', 'get_product_analytics', 'get_south_financial_year', 'present_table', 'search']), `the AI is offered only the Purchasing tools (${offered.join(', ')})`);
ok(!seen[0].tools.some((t) => 'annotations' in t || 'inputSchema' in t), 'tools are sent in the shape the AI service accepts');
const sys = seen[0].system.map((x) => x.text).join(' ');
ok(/Purchasing and Stock/.test(sys) && !/company director/.test(sys), 'it gets the Purchasing instructions, not the management ones');
const parts = r1.body.text.slice(7).split('||');
ok(parts.length === 5 && parts.slice(0, 4).every((x) => x.startsWith('ERR:') && /not available to your department/.test(x)), 'odoo_search, get_debtors, get_expenses and ostendo_query are all refused');
let fy = null; try { fy = JSON.parse(parts[4].slice(3)); } catch { fy = null; }
ok(parts[4].startsWith('OK:') && fy && !hasKey(fy, STRIPPED), 'get_financial_year comes back with no rep, weekly or customer data');
ok(!('usage' in r1.body) && r1.body.quota.remaining === LIMIT - 1, 'one question was taken from the allowance');
ok(seen[0].tools[seen[0].tools.length - 1].cache_control && seen[0].system[0].cache_control && seen[1].messages[seen[1].messages.length - 1].content.slice(-1)[0].cache_control, 'the request marks the instructions, tools and conversation for the cheaper cached price');
ok(!JSON.stringify(r1.body.history).includes('cache_control'), 'the conversation kept by the browser carries no cache marks');

seen.length = 0;
await chat(P.cookie, 'hello', { 'x-worthy-role': 'mgmt', 'x-worthy-person': 'testmgmt' });
ok(seen[0].tools.length === 6, 'claiming to be Management in the request changes nothing');

console.log('Who else can and cannot use the chat');
ok((await chat(null, 'hello')).status === 401, 'no sign-in, no chat');
ok((await chat(B.cookie, 'hello')).status === 403, 'Business Development cannot use the dashboard chat');
seen.length = 0;
const rm = await chat(M.cookie, 'hello');
ok(rm.status === 200 && seen[0].tools.some((t) => t.name === 'odoo_search') && seen[0].tools.some((t) => t.name === 'get_expenses') && /company director/.test(seen[0].system[0].text), 'Management still gets every tool and its own instructions');
ok(rm.body.usage && rm.body.usage.usd > 0 && rm.body.usage.crTok === 5000, 'Management sees what the answer cost in AI tokens');

console.log('Allowance');
const before = (await me(D.cookie)).quota.remaining;
seen.length = 0;
const rf = await chat(D.cookie, 'FAIL please');
ok(rf.status === 502 && (await me(D.cookie)).quota.remaining === before, 'a question that fails because of us is given back');
for (let i = 0; i < before; i++) await chat(D.cookie, 'hello');
ok((await me(D.cookie)).quota.remaining === 0, `after ${before} questions none are left`);
seen.length = 0;
const over = await chat(D.cookie, 'one more');
ok(over.status === 429 && seen.length === 0 && /used all/.test(over.body.error), 'the next question is refused before any AI is called (no cost)');
ok((await me(P.cookie)).quota.remaining === LIMIT - 2, 'one person running out does not touch another person');

console.log('Connector: only people allowed a connector, in their own department');
const R = 'https://claude.ai/api/mcp/auth_callback';
async function connect(fields) {
  const reg = await (await fetch(`${base}/api/mcp/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: [R] }) })).json();
  const v = randomBytes(32).toString('base64url'), ch = createHash('sha256').update(v).digest('base64url');
  const a = await fetch(`${base}/api/mcp/authorize`, { method: 'POST', redirect: 'manual', body: new URLSearchParams({ response_type: 'code', client_id: reg.client_id, redirect_uri: R, state: 's', code_challenge: ch, code_challenge_method: 'S256', scope: '', resource: '', ...fields }) });
  const loc = a.headers.get('location'); const c = loc && new URL(loc).searchParams.get('code');
  if (!c) return null;
  return (await (await fetch(`${base}/api/mcp/token`, { method: 'POST', body: new URLSearchParams({ grant_type: 'authorization_code', code: c, client_id: reg.client_id, redirect_uri: R, code_verifier: v }) })).json()).access_token || null;
}
const tools = async (tok) => { const r = await fetch(`${base}/api/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) }); return r.status === 200 ? (await r.json()).result.tools.map((t) => t.name) : null; };
ok((await connect({ department: 'mgmt', password: mPw })) === null, 'the department password alone (no email) no longer connects');
ok((await connect({ email: E.dash, department: 'purch', password: pPw })) === null, 'a dashboard-only person (like Kylie) cannot connect a connector');
ok((await connect({ email: 'kylie@worthy.nz', department: 'purch', password: pPw })) === null, 'Kylie herself cannot connect a connector');
ok((await connect({ email: E.purch, department: 'mgmt', password: mPw })) === null, 'a Purchasing person cannot connect as Management, even with the Management password');
ok((await connect({ email: E.mgmt, department: 'purch', password: pPw })) === null, 'a Management person does not connect as Purchasing');
const pt = await connect({ email: E.purch, department: 'purch', password: pPw });
const mt = await connect({ email: E.mgmt, department: 'mgmt', password: mPw });
const pl = pt && await tools(pt), ml = mt && await tools(mt);
ok(pl && pl.length === 5 && !pl.includes('odoo_search'), 'a Purchasing person connects and gets the 5 Purchasing tools');
ok(ml && ml.includes('odoo_search') && ml.includes('get_expenses'), 'a Management person connects and gets every tool');

console.log('Usage and cost page (management only)');
const u = await fetch(`${base}/api/rep-usage`, { headers: { cookie: M.cookie } });
const uj = u.status === 200 ? await u.json() : null;
const row = uj?.reps.find((x) => x.key === 'd.testpurch');
ok(row && row.where === 'Dashboard chat' && row.month.questions === 2 && row.month.usd > 0, `the usage page shows each dashboard person's questions and AI cost this month (US$${row?.month?.usd})`);
ok(uj.cost && uj.cost.thisMonthUsd > 0 && uj.cost.mostQuestionsPerCycle === uj.reps.length * LIMIT * 30, 'and the total for the month');
ok(!uj.usage.some((x) => x.where === 'dashboard chat' && x.dept === 'mgmt' && x.question), 'management questions are not kept');
ok((await fetch(`${base}/api/rep-usage`, { headers: { cookie: P.cookie } })).status === 403, 'Purchasing cannot open the usage page');
const ch = await (await fetch(`${base}/api/cron/cost-health`)).json().catch(() => ({}));
ok(typeof ch.allowanceStoreConnected === 'boolean', `the health check says whether the shared store is connected (${ch.allowanceStoreConnected})`);

stub.close();
console.log(fails ? `\n${fails} FAILED, ${passes} passed` : `\nAll ${passes} checks passed`);
