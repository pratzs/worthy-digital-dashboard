/**
 * "This looks wrong" (and "This was helpful") from the rep, saved with the question and the answer
 * so management can look into it. Only the signed-in rep can send it, and it is filed under that rep.
 */
import { NextResponse } from 'next/server';
import { repFromSession } from '@/lib/repSession';
import { logFeedback } from '@/lib/repStore';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  const rep = repFromSession(request);
  if (!rep) return NextResponse.json({ error: 'Please sign in again.' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid request.' }, { status: 400 }); }
  const kind = body?.kind === 'good' ? 'good' : 'wrong';
  try {
    await logFeedback({ t: new Date().toISOString(), rep: rep.key, kind, question: body?.question, answer: body?.answer, note: body?.note });
  } catch {
    return NextResponse.json({ error: 'Could not save that just now. Please try again.' }, { status: 502 });
  }
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}
