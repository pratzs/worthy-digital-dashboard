/**
 * Tests the My Account chat backend against a local server with a STAND-IN for the AI service (scripts/stub-ai.mjs:
 * no AI cost, fully scripted, same streaming format) but the REAL rep tools and real data. It covers: sign-in rules,
 * streaming, progress messages, scoping (the AI is told who the rep is and can only reach their own data), the exact
 * daily limit and the questions-left count, a failed question being given back, the "this looks wrong" button, and the
 * management usage page (and that a rep cannot open it).
 *
 * Start the server first with:
 *   ANTHROPIC_API_URL=http://localhost:3999/v1/messages ANTHROPIC_API_KEY=test REP_CHAT_DAILY_LIMIT=8 \
 *   DASHBOARD_PASSWORD=localtestpw REP_AUTH_SECRET=... REP_ACCESS=... npx next dev -p 3111
 * then:  node scripts/rep-chat-test.mjs http://localhost:3111 "<private codes folder>" savan jerry
 */
import { readFileSync } from 'node:fs';
import { startStub } from './stub-ai.mjs';

const base = process.argv[2], codesDir = process.argv[3], keys = process.argv.slice(4);
const LABEL = { savan: 'Savan Patel', jerry: 'Jerry', keith: 'Keith', nayan: 'Nayan Patel', chris: 'Chris' };
const codes = Object.fromEntries(readFileSync(`${codesDir}/rep-access-codes.txt`, 'utf8').trim().split('\n').map((l) => {
  const [who, code] = l.split('\t'); const k = Object.keys(LABEL).find((x) => LABEL[x] === who.replace(/ \((North|South)\)$/, '')); return [k, code];
}));
const OTHERS = ['Keith', 'Chris', 'Ravi Kumar', 'Lynette', 'Michelle', 'Nimesh Darjee', 'Nayan Patel', 'Naitik Trivedi', 'Savan Patel', 'Hari Patel', 'Rubin Monpara', 'Direct', 'Leith', 'Jerry'];
const LIMIT = 8;

const { server, seen } = await startStub(3999);
let fails = 0;
const ok = (c, m) => { console.log(`${c ? '  ok  ' : 'FAIL  '}${m}`); if (!c) { fails++; process.exitCode = 1; } };
const post = (path, body, cookie) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
const cookieOf = (r) => (r.headers.get('set-cookie') || '').split(';')[0];
const me = async (cookie) => (await fetch(`${base}/api/my-sales/me`, { headers: { cookie } })).json();

/** Asks a question and reads the streamed events. */
async function ask(cookie, content) {
  const r = await post('/api/my-sales/chat', { messages: [{ role: 'user', content }] }, cookie);
  if (!(r.headers.get('content-type') || '').includes('ndjson')) return { status: r.status, json: await r.json().catch(() => ({})), events: [], text: '' };
  const raw = await r.text();
  const events = raw.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  let text = ''; for (const e of events) { if (e.type === 'reset') text = ''; if (e.type === 'delta') text += e.text; }
  return { status: r.status, events, text, done: events.find((e) => e.type === 'done'), error: events.find((e) => e.type === 'error') };
}

console.log('Signed out');
for (const [m, p] of [['GET', '/api/my-sales/me'], ['POST', '/api/my-sales/chat'], ['POST', '/api/my-sales/feedback'], ['POST', '/api/my-sales/warm']]) {
  const r = await fetch(base + p, { method: m, headers: { 'content-type': 'application/json' }, body: m === 'POST' ? '{"messages":[{"role":"user","content":"hi"}]}' : undefined });
  ok(r.status === 401, `${p} refused without a cookie`);
}
const bad = await post('/api/my-sales/login', { code: 'x'.repeat(24) });
ok(bad.status === 401 && !bad.headers.get('set-cookie'), 'wrong code refused, no cookie set');
ok((await fetch(`${base}/my-sales`)).status === 200, 'page itself loads for anyone (it only shows a code box)');
ok((await fetch(`${base}/`, { redirect: 'manual' })).status !== 200, 'dashboard still needs its own login');
ok((await fetch(`${base}/api/rep-usage`)).status === 401, 'usage data is not open to the public');
ok((await fetch(`${base}/my-account.webmanifest`)).status === 200, 'the home-screen app file is public (so a phone can read it)');

for (const key of keys) {
  console.log(`\n== ${key} ==`);
  const login = await post('/api/my-sales/login', { code: codes[key] });
  const cookie = cookieOf(login);
  ok(login.status === 200 && cookie.startsWith('worthy_rep='), 'signed in, cookie set');
  ok(/HttpOnly/i.test(login.headers.get('set-cookie')) && /SameSite=strict/i.test(login.headers.get('set-cookie')), 'cookie is HttpOnly and SameSite=Strict');
  const m0 = await me(cookie);
  ok(m0.name === LABEL[key] && m0.quota && m0.quota.limit === LIMIT && m0.quota.remaining === LIMIT, `/me says ${m0.name} with ${m0.quota?.remaining} of ${m0.quota?.limit} questions left`);
  ok((await fetch(`${base}/api/my-sales/me`, { headers: { cookie: cookie.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')) } })).status === 401, 'tampered cookie refused');

  seen.length = 0;
  const s = await ask(cookie, 'SALES please');
  const names = seen[0].tools.map((t) => t.name);
  ok(seen[0].stream === true, 'the AI is asked to stream');
  ok(seen[0].system.includes(LABEL[key]), 'the AI is told who this rep is');
  ok(['my_sales', 'my_customer', 'my_cross_sell', 'my_best_sellers', 'my_action_plan'].every((n) => names.includes(n)) && !names.some((n) => /odoo|ostendo|financial|^search$|^fetch$/.test(n)), `the AI is only given rep tools (${names.length})`);
  ok(s.events.filter((e) => e.type === 'delta').length > 3, 'the answer arrives in pieces (streamed)');
  ok(s.events.some((e) => e.type === 'status' && /Checking your sales/.test(e.text)), 'a plain progress message shows while the lookup runs');
  ok(s.text.startsWith('RESULT:') && s.text.includes(`"rep":"${LABEL[key]}"`), `tool answered for ${LABEL[key]} even though the AI asked for Keith / Savan`);
  ok(OTHERS.filter((n) => n !== LABEL[key] && s.text.includes(n)).length === 0, 'no other rep appears in the data the AI received');
  ok(!s.text.includes('Direct') && !s.text.includes('"totals"'), 'no Direct / company totals in the data the AI received');
  ok(s.done && s.done.quota.remaining === LIMIT - 1, `questions left drops to ${s.done?.quota?.remaining}`);
  ok((await me(cookie)).quota.remaining === LIMIT - 1, '/me agrees');

  const t = await ask(cookie, 'TEXT first');
  ok(t.events.some((e) => e.type === 'reset') && t.text.startsWith('RESULT:'), 'text written before a lookup is dropped (reset), the real answer follows');
  const c = await ask(cookie, 'CUSTOMER Zzzz Nonexistent Shop');
  ok(c.text.includes('"found":false') && !OTHERS.some((n) => n !== LABEL[key] && c.text.includes(`"${n}"`)), 'asking about a customer that is not theirs finds nothing');
  const sn = await ask(cookie, 'SNEAK please');
  ok(sn.text.includes('ERR:Error: Unknown tool'), 'a management tool asked for by the AI is refused');
  const plan = await ask(cookie, 'PLAN please');
  ok(plan.text.includes('"opportunities"') && plan.text.includes(`"rep":"${LABEL[key]}"`), 'the action plan comes back for this rep');

  const beforeFail = (await me(cookie)).quota.remaining;
  const f = await ask(cookie, 'FAIL now');
  ok(f.error && /paused/i.test(f.error.message) && !/credit|anthropic|balance/i.test(f.error.message), 'a billing problem is shown in plain words, with no technical details');
  ok((await me(cookie)).quota.remaining === beforeFail, 'a question that failed because of us is given back');

  const fbOk = await post('/api/my-sales/feedback', { kind: 'wrong', question: 'q?', answer: 'an answer', note: 'the number looks too high' }, cookie);
  ok(fbOk.status === 200, 'the "this looks wrong" note is accepted');
  ok((await post('/api/my-sales/chat', { messages: [] }, cookie)).status === 400, 'empty question refused');
  ok((await fetch(`${base}/api/rep-usage`, { headers: { cookie } })).status === 401, 'a rep cannot open the management usage data');
}

console.log('\nDaily limit');
const lk = keys[0];
const l = await post('/api/my-sales/login', { code: codes[lk] }); const c2 = cookieOf(l);
let blocked = null;
for (let i = 0; i < 12 && !blocked; i++) { const r = await ask(c2, 'hello'); if (r.status === 429) blocked = r; }
ok(blocked && /all 8 of today/.test(blocked.json.error) && blocked.json.quota.remaining === 0, 'a rep who keeps asking hits the exact daily limit (429) with a clear message');
ok((await me(c2)).quota.remaining === 0, 'questions left shows 0');

console.log('\nManagement usage page');
const adm = await post('/api/auth/login', { password: 'localtestpw' });
const admCookie = cookieOf(adm);
ok(adm.status === 200 && admCookie.startsWith('worthy_auth='), 'management can sign in (test password)');
const u = await (await fetch(`${base}/api/rep-usage`, { headers: { cookie: admCookie } })).json();
const row = u.reps.find((r) => r.key === lk);
ok(row.answered >= 5 && row.failed >= 1, `usage shows answered ${row?.answered} and failed ${row?.failed} for ${lk}`);
ok(u.usage.length > 5 && u.usage.every((e) => !('answer' in e)), 'the usage log keeps questions and tools, never answers');
ok(u.feedback.some((x) => x.kind === 'wrong' && x.note.includes('too high')), 'the "looks wrong" note is there for management');
ok((await fetch(`${base}/rep-usage`, { headers: { cookie: admCookie }, redirect: 'manual' })).status === 200, 'management can open the usage page');
ok((await fetch(`${base}/rep-usage`, { redirect: 'manual' })).status !== 200, 'the usage page is closed to anyone not signed in');

server.close();
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
