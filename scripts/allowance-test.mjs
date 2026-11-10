/**
 * The question allowance, on its own (no server, no AI, no database: lib/repStore.js falls back to memory).
 * The rule: 60 a day, unused questions roll over within a 30-day cycle, then it starts again at 60.
 *
 *   node scripts/allowance-test.mjs
 */
delete process.env.KV_REST_API_URL; delete process.env.UPSTASH_REDIS_REST_URL; delete process.env.REP_CHAT_DAILY_LIMIT;
const { takeQuestion, refundQuestion, quotaNow, dailyLimit, CYCLE_DAYS } = await import('../lib/repStore.js');

let fails = 0;
const ok = (c, m) => { console.log(`${c ? '  ok  ' : 'FAIL  '}${m}`); if (!c) { fails++; process.exitCode = 1; } };
const day = (n) => new Date(Date.UTC(2026, 10, 11) + n * 86400000).toISOString().slice(0, 10);   // day(0) = 2026-11-11
const ask = async (who, d, n) => { let last; for (let i = 0; i < n; i++) last = await takeQuestion(who, d); return last; };

ok(dailyLimit() === 60 && CYCLE_DAYS === 30, 'the rule is 60 a day over a 30-day cycle');

// A: normal use
let q = await quotaNow('a', day(0));
ok(q.remaining === 60 && q.carried === 0, 'a new person starts with 60');
q = await ask('a', day(0), 10);
ok(q.allowed && q.remaining === 50 && q.used === 10, 'after 10 questions on day 1, 50 are left');
q = await quotaNow('a', day(1));
ok(q.remaining === 110 && q.carried === 50 && q.used === 0, 'day 2: 60 new + 50 saved = 110');
q = await ask('a', day(1), 110);
ok(q.allowed && q.remaining === 0, 'all 110 can be used on day 2');
q = await takeQuestion('a', day(1));
ok(!q.allowed && q.remaining === 0, 'question 111 on day 2 is refused');
q = await quotaNow('a', day(1));
ok(q.remaining === 0 && q.used === 110, 'a refused question is not counted');
q = await quotaNow('a', day(2));
ok(q.remaining === 60 && q.carried === 0, 'day 3: back to 60 (nothing was saved)');

// B: someone who asks once then is away for the rest of the cycle
await ask('b', day(0), 1);
q = await quotaNow('b', day(29));
ok(q.remaining === 60 * 30 - 1 && q.resets === day(30), 'last day of the cycle: everything unused has rolled over (1,799 left)');
q = await quotaNow('b', day(30));
ok(q.remaining === 60 && q.carried === 0 && q.resets === day(60), 'day 31: the cycle restarts at 60, the saved ones are gone');
q = await quotaNow('b', day(45));
ok(q.remaining === 60 * 16 && q.resets === day(60), 'the second cycle rolls over the same way');

// C: the most anyone can ever use in a cycle is 30 x 60
let total = 0;
for (let d = 0; d < 30; d++) { for (;;) { const r = await takeQuestion('c', day(d)); if (!r.allowed) break; total++; } }
ok(total === 1800, `asking as much as allowed every day for a cycle gives exactly 1,800 (${total})`);
total = 0; for (;;) { const r = await takeQuestion('c', day(29)); if (!r.allowed) break; total++; }
ok(total === 0, 'nothing more on the last day once the cycle is used up');

// D: a failed question is given back
await ask('d', day(0), 5);
await refundQuestion('d', day(0));
q = await quotaNow('d', day(0));
ok(q.remaining === 56 && q.used === 4, 'a question that failed because of us is given back');

// E: people are separate
q = await quotaNow('e', day(1));
ok(q.remaining === 60, 'one person using theirs does not touch another person');

console.log(fails ? `\n${fails} FAILED` : '\nAll allowance checks passed');
