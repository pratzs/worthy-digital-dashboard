/**
 * Management view of how the rep assistant is being used: questions per rep (today, last 7 days), failures,
 * speed, AI size, the latest questions, and every "this looks wrong" note. Behind the dashboard login
 * (management only, see lib/auth.js), never reachable by a rep.
 */
import { NextResponse } from 'next/server';
import { activePrincipals, emailOnFile } from '@/lib/repAccess';
import { dailyCount, dailyLimit, recentUsage, recentFeedback, recentSignins, repStats, storeConnected } from '@/lib/repStore';
import { nzToday } from '@/lib/ostendo';

export const dynamic = 'force-dynamic';

const addDays = (iso, n) => new Date(new Date(`${iso}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);

export async function GET() {
  const today = nzToday();
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, -i));
  const reps = await Promise.all(activePrincipals().map(async (r) => {
    const [counts, stats] = await Promise.all([Promise.all(days.map((d) => dailyCount(r.key, d))), repStats(r.key)]);
    const total = (stats.ok || 0) + (stats.fail || 0);
    return {
      key: r.key, name: r.label, system: r.system, email: emailOnFile(r.key),
      today: counts[0], last7Days: counts.reduce((a, b) => a + b, 0), perDay: days.map((d, i) => ({ day: d, questions: counts[i] })),
      answered: stats.ok || 0, failed: stats.fail || 0,
      avgSeconds: total ? Math.round((stats.ms || 0) / total / 100) / 10 : null,
      inputTokens: stats.inTok || 0, outputTokens: stats.outTok || 0,
    };
  }));
  const [usage, feedback, signins] = await Promise.all([recentUsage(100), recentFeedback(100), recentSignins(100)]);
  return NextResponse.json({
    today, dailyLimit: dailyLimit(), storeConnected: storeConnected(),
    note: storeConnected() ? null : 'No database is connected yet, so these numbers only cover this server since it last started.',
    reps, usage, feedback, signins,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
