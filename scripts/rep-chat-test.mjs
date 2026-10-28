/**
 * Tests the My Sales chat page backend against a local server with a STAND-IN for the AI
 * service (so no AI cost and fully scripted), but the real rep tools and real data.
 * Start the server first with:
 *   ANTHROPIC_API_URL=http://localhost:3999/v1/messages ANTHROPIC_API_KEY=test REP_CHAT_DAILY_LIMIT=8 \
 *   REP_AUTH_SECRET=... REP_ACCESS=... npx next dev -p 3111
 * then:  node scripts/rep-chat-test.mjs http://localhost:3111 "<private codes folder>" savan jerry
 */
import http from 'node:http';
import { readFileSync } from 'node:fs';

const base = process.argv[2], codesDir = process.argv[3], keys = process.argv.slice(4);
const LABEL = { savan: 'Savan Patel', jerry: 'Jerry', keith: 'Keith', nayan: 'Nayan Patel' };
const codes = Object.fromEntries(readFileSync(`${codesDir}/rep-access-codes.txt`, 'utf8').trim().split('\n').map((l) => {
  const [who, code] = l.split('\t'); const k = Object.keys(LABEL).find((x) => LABEL[x] === who.replace(/ \((North|South)\)$/, '')); return [k, code];
}));
const OTHERS = ['Keith', 'Chris', 'Ravi Kumar', 'Lynette', 'Michelle', 'Nimesh Darjee', 'Nayan Patel', 'Naitik Trivedi', 'Savan Patel', 'Hari Patel', 'Rubin Monpara', 'Direct', 'Leith'];

// ── stand-in AI: scripted by the first user message ───────────────────────────
const seen = [];
const mock = http.createServer((req, res) => {
  let b = ''; req.on('data', (d) => (b += d)).on('end', () => {
    const body = JSON.parse(b); seen.push(body);
    const last = body.messages[body.messages.length - 1];
    const first = body.messages.find((m) => m.role === 'user' && typeof m.content === 'string')?.content || '';
    const reply = (content, stop = 'end_turn') => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ content, stop_reason: stop }));
    if (Array.isArray(last.content) && last.content[0]?.type === 'tool_result') {
      return reply([{ type: 'text', text: `RESULT:${last.content.map((c) => `${c.is_error ? 'ERR:' : ''}${c.content}`).join('||')}` }]);
    }
    if (first.startsWith('SALES')) return reply([{ type: 'tool_use', id: 't1', name: 'my_sales', input: { rep: 'Keith', name: 'Savan Patel', company: 'south', fy: 2026 } }], 'tool_use');
    if (first.startsWith('DEBTORS')) return reply([{ type: 'tool_use', id: 't2', name: 'my_debtors', input: { rep: 'Keith' } }], 'tool_use');
    if (first.startsWith('SNEAK')) return reply([{ type: 'tool_use', id: 't3', name: 'odoo_search', input: { model: 'res.partner' } }], 'tool_use');
    return reply([{ type: 'text', text: 'Hello from the stand-in.' }]);
  });
});
await new Promise((r) => mock.listen(3999, r));

let fails = 0;
const ok = (c, m) => { console.log(`${c ? '  ok  ' : 'FAIL  '}${m}`); if (!c) { fails++; process.exitCode = 1; } };
const post = (path, body, cookie) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
const cookieOf = (r) => (r.headers.get('set-cookie') || '').split(';')[0];

console.log('Signed out');
ok((await fetch(`${base}/api/my-sales/me`)).status === 401, '/me refused without a cookie');
ok((await post('/api/my-sales/chat', { messages: [{ role: 'user', content: 'hi' }] })).status === 401, 'chat refused without a cookie');
const bad = await post('/api/my-sales/login', { code: 'x'.repeat(24) });
ok(bad.status === 401 && !bad.headers.get('set-cookie'), 'wrong code refused, no cookie set');
ok((await fetch(`${base}/my-sales`)).status === 200, 'page itself loads for anyone (it only shows a code box)');
ok((await fetch(`${base}/`, { redirect: 'manual' })).status !== 200, 'dashboard still needs its own login');

for (const key of keys) {
  console.log(`\n== ${key} ==`);
  const login = await post('/api/my-sales/login', { code: codes[key] });
  const cookie = cookieOf(login);
  ok(login.status === 200 && cookie.startsWith('worthy_rep='), 'signed in, cookie set');
  ok(/HttpOnly/i.test(login.headers.get('set-cookie')) && /SameSite=strict/i.test(login.headers.get('set-cookie')), 'cookie is HttpOnly and SameSite=Strict');
  const me = await (await fetch(`${base}/api/my-sales/me`, { headers: { cookie } })).json();
  ok(me.name === LABEL[key], `/me says ${me.name}`);
  const forged = cookie.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'));
  ok((await fetch(`${base}/api/my-sales/me`, { headers: { cookie: forged } })).status === 401, 'tampered cookie refused');

  seen.length = 0;
  const sales = await (await post('/api/my-sales/chat', { messages: [{ role: 'user', content: 'SALES please' }] }, cookie)).json();
  const sys = seen[0].system;
  ok(sys.includes(LABEL[key]), 'the AI is told who this rep is');
  ok(JSON.stringify(seen[0].tools.map((t) => t.name)) === JSON.stringify(['my_profile', 'my_sales', 'my_debtors']), 'the AI is only given the 3 rep tools');
  const text = sales.text || '';
  const others = OTHERS.filter((n) => n !== LABEL[key] && text.includes(n));
  ok(text.startsWith('RESULT:') && text.includes(`"rep":"${LABEL[key]}"`), `tool answered for ${LABEL[key]} even though the AI asked for Keith/Savan`);
  ok(others.length === 0, `no other rep appears in the data the AI received (${others.join(', ') || 'none'})`);
  ok(!text.includes('Direct') && !text.includes('"totals"'), 'no Direct / company totals in the data the AI received');

  const debtors = await (await post('/api/my-sales/chat', { messages: [{ role: 'user', content: 'DEBTORS please' }] }, cookie)).json();
  ok((debtors.text || '').includes(`"rep":"${LABEL[key]}"`), 'debtors tool answered for this rep only');
  const sneak = await (await post('/api/my-sales/chat', { messages: [{ role: 'user', content: 'SNEAK please' }] }, cookie)).json();
  ok((sneak.text || '').includes('ERR:Error: Unknown tool'), 'a management tool asked for by the AI is refused');
  const plain = await (await post('/api/my-sales/chat', { messages: [{ role: 'user', content: 'hello' }] }, cookie)).json();
  ok(plain.text === 'Hello from the stand-in.', 'plain chat works');

  // limits and bad input
  ok((await post('/api/my-sales/chat', { messages: [] }, cookie)).status === 400, 'empty question refused');
  ok((await post('/api/my-sales/chat', { messages: [{ role: 'assistant', content: 'x' }] }, cookie)).status === 400, 'history must end with a question');
  await post('/api/my-sales/logout', {}, cookie);
}

console.log('\nDaily limit');
const l = await post('/api/my-sales/login', { code: codes[keys[0]] }); const c2 = cookieOf(l);
let limited = false;
for (let i = 0; i < 12 && !limited; i++) limited = (await post('/api/my-sales/chat', { messages: [{ role: 'user', content: 'hello' }] }, c2)).status === 429;
ok(limited, 'a rep who keeps asking hits the daily limit (429)');

mock.close();
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
