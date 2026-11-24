/**
 * Worthy Command Center data (lib/command.js). Management only: the middleware lets only the management department
 * reach this path, and the route checks the role again.
 *   GET            everything the page shows (?fresh=1 skips the 15 to 60 minute caches)
 *   GET ?live=1    visitors right now, the Asana meeting tasks and the ClickUp cards, for the page's 30-second refresh
 *   POST           { action: 'save' | 'delete', item }  change the typed-in board
 */
import { NextResponse } from 'next/server';
import { setOidcToken } from '@/lib/ga4';
import { commandData, liveVisitors, writeBoard, readLog } from '@/lib/command';
import { asanaSafe } from '@/lib/asana';
import { clickupSafe } from '@/lib/clickup';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const denied = () => NextResponse.json({ error: 'Not available to your department' }, { status: 403 });

export async function GET(request) {
  if (request.headers.get('x-worthy-role') !== 'mgmt') return denied();
  setOidcToken(request.headers.get('x-vercel-oidc-token'));
  const q = new URL(request.url).searchParams;
  if (q.get('live') === '1') {
    const [live, log, asana, clickup] = await Promise.all([liveVisitors(), readLog(), asanaSafe(), clickupSafe()]);
    return NextResponse.json({ live, log, asana, clickup, at: new Date().toISOString() });
  }
  return NextResponse.json({ ...(await commandData({ fresh: q.get('fresh') === '1' })), person: request.headers.get('x-worthy-person') || '' });
}

export async function POST(request) {
  if (request.headers.get('x-worthy-role') !== 'mgmt') return denied();
  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }); }
  const person = request.headers.get('x-worthy-person') || 'management';
  try {
    const board = await writeBoard(body.action === 'delete' ? 'delete' : 'save', body.item || {}, person);
    return NextResponse.json({ ok: true, board, log: await readLog() });
  } catch (e) { return NextResponse.json({ error: String(e.message || e) }, { status: 400 }); }
}
