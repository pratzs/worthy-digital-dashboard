/**
 * Management view of how the rep assistant is being used: questions per rep (today, last 7 days), failures,
 * speed, AI size, the latest questions, and every "this looks wrong" note. Behind the dashboard login
 * (management only, see lib/auth.js), never reachable by a rep.
 */
import { NextResponse } from 'next/server';
import { activePrincipals, emailOnFile } from '@/lib/repAccess';
import { dailyCount, dailyLimit, recentUsage, recentFeedback, recentSignins, repStats, storeConnected, monthTokens, quotaNow, CYCLE_DAYS } from '@/lib/repStore';
import { peopleWho } from '@/lib/people';
import { ROLES } from '@/lib/auth';
import { chatWho, costUsd, nzMonth, PRICE_USD_PER_MILLION } from '@/lib/aiCost';
import { nzToday } from '@/lib/ostendo';

export const dynamic = 'force-dynamic';

const addDays = (iso, n) => new Date(new Date(`${iso}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);

export async function GET() {
  const today = nzToday();
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, -i));
  // Everyone whose questions run on Worthy's AI key: team leads on the My Account page (the marketing role only uses its
  // own Claude, so it is left out), and every named person who can sign in to the dashboard.
  const month = nzMonth();
  const lastMonth = nzMonth(new Date(Date.now() - 31 * 86400000));
  const everyone = [
    ...activePrincipals().filter((r) => r.role !== 'marketing').map((r) => ({ key: r.key, name: r.label, system: r.system, email: emailOnFile(r.key), where: 'My Account page' })),
    ...peopleWho('dashboard').filter((p) => ROLES[p.dept].sections.includes('chat')).map((p) => ({ key: chatWho(p.key), name: p.name, system: ROLES[p.dept].label, email: p.email, where: 'Dashboard chat' })),
  ];
  const reps = await Promise.all(everyone.map(async (r) => {
    const [counts, stats, mt, lmt, quota] = await Promise.all([Promise.all(days.map((d) => dailyCount(r.key, d))), repStats(r.key), monthTokens(r.key, month), monthTokens(r.key, lastMonth), quotaNow(r.key, today).catch(() => null)]);
    const total = (stats.ok || 0) + (stats.fail || 0);
    return {
      key: r.key, name: r.name, system: r.system, email: r.email, where: r.where,
      month: { questions: mt.q || 0, usd: Math.round(costUsd(mt) * 100) / 100, tokens: mt },
      lastMonth: { questions: lmt.q || 0, usd: Math.round(costUsd(lmt) * 100) / 100 },
      questionsLeft: quota ? quota.remaining : null, cycleResets: quota ? quota.resets : null,
      today: counts[0], last7Days: counts.reduce((a, b) => a + b, 0), perDay: days.map((d, i) => ({ day: d, questions: counts[i] })),
      answered: stats.ok || 0, failed: stats.fail || 0,
      avgSeconds: total ? Math.round((stats.ms || 0) / total / 100) / 10 : null,
      inputTokens: stats.inTok || 0, outputTokens: stats.outTok || 0,
    };
  }));
  // AI Insights calls made when the person could not be told (kept under "d.unknown") still cost money, so they are in the totals.
  const [usage, feedback, signins, otherNow, otherLast] = await Promise.all([recentUsage(100), recentFeedback(100), recentSignins(100), monthTokens('d.unknown', month), monthTokens('d.unknown', lastMonth)]);
  const otherUsd = costUsd(otherNow), otherLastUsd = costUsd(otherLast);
  return NextResponse.json({
    today, dailyLimit: dailyLimit(), cycleDays: CYCLE_DAYS, storeConnected: storeConnected(),
    cost: {
      month, lastMonth, currency: 'USD', pricePerMillionTokens: PRICE_USD_PER_MILLION,
      thisMonthUsd: Math.round((reps.reduce((a, r) => a + costUsd(r.month.tokens), 0) + otherUsd) * 100) / 100,
      lastMonthUsd: Math.round((reps.reduce((a, r) => a + r.lastMonth.usd, 0) + otherLastUsd) * 100) / 100,
      otherUsd: Math.round(otherUsd * 100) / 100,   // AI Insights with no person recorded
      thisMonthQuestions: reps.reduce((a, r) => a + r.month.questions, 0),
      // The most the allowance lets these people spend in one 30-day cycle is people x 60 x 30 questions; see docs/AI-COST.md for the dollars.
      mostQuestionsPerCycle: reps.length * dailyLimit() * CYCLE_DAYS,
    },
    note: storeConnected() ? null : 'No database is connected yet, so these numbers only cover this server since it last started.',
    reps, usage, feedback, signins,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
