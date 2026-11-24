/**
 * Worthy Command Center data (lib/command.js). Management only: the middleware lets only the management department
 * reach this path, and the route checks the role again.
 *   GET            everything the page shows (?fresh=1 skips the 15 to 60 minute caches)
 *   GET ?shopping=1&start=&end=&gscStart=&gscEnd=   Google Shopping visits, product results, Shopify sales channels
 *   GET ?ai=1&start=&end=            visits from AI assistants (GA4) and the latest AI answer checks
 *   POST { action: 'ai-check', force } ask the AI questions again (skipped if the last run is under 20 hours old, unless force)
 *   GET ?search=1&start=&end=        Search Console for any period (date picker)
 *   GET ?events=worthy&start=&end=   each key event (enquiry) on that site: time, event, page, source, town, device
 *   GET ?live=1    visitors right now, the Asana meeting tasks and the ClickUp cards, for the page's 30-second refresh
 *   POST           { action: 'save' | 'delete', item }  change the typed-in board
 *   POST           { action: 'external', source: 'asana' | 'clickup', id, op, value, title }  change the task in Asana or ClickUp
 */
import { NextResponse } from 'next/server';
import { setOidcToken } from '@/lib/ga4';
import { commandData, liveVisitors, writeBoard, readLog, logEvent, keyEventDetail, searchForRange, todaySoFar } from '@/lib/command';
import { asanaSafe, asanaWrite } from '@/lib/asana';
import { clickupSafe, clickupWrite } from '@/lib/clickup';
import { aiReferrals, latestChecks, runChecks, readGoogleAi, saveGoogleAi } from '@/lib/aiVisibility';
import { shoppingData } from '@/lib/shopping';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const denied = () => NextResponse.json({ error: 'Not available to your department' }, { status: 403 });

export async function GET(request) {
  if (request.headers.get('x-worthy-role') !== 'mgmt') return denied();
  setOidcToken(request.headers.get('x-vercel-oidc-token'));
  const q = new URL(request.url).searchParams;
  if (q.get('shopping') === '1') {
    const ok = (d) => /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(d || '');
    const [a, b, c, d] = ['start', 'end', 'gscStart', 'gscEnd'].map((k) => q.get(k));
    if (![a, b, c, d].every(ok)) return NextResponse.json({ error: 'Bad request' }, { status: 400 });
    return NextResponse.json(await shoppingData(a, b, c, d));
  }
  if (q.get('ai') === '1') {
    const ok = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '');
    if (!ok(q.get('start')) || !ok(q.get('end'))) return NextResponse.json({ error: 'Bad request' }, { status: 400 });
    const [referrals, checks, googleAi] = await Promise.all([aiReferrals(q.get('start'), q.get('end')), latestChecks(), readGoogleAi()]);
    return NextResponse.json({ referrals, ...checks, googleAi });
  }
  if (q.get('search') === '1') {
    const ok = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '');
    if (!ok(q.get('start')) || !ok(q.get('end'))) return NextResponse.json({ error: 'Bad request' }, { status: 400 });
    return NextResponse.json({ search: await searchForRange(q.get('start'), q.get('end')) });
  }
  if (q.get('events')) {
    const site = q.get('events');
    const ok = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '');
    if (!['worthy', 'dutchrusk', 'worthyproducts'].includes(site) || !ok(q.get('start')) || !ok(q.get('end'))) return NextResponse.json({ error: 'Bad request' }, { status: 400 });
    try { return NextResponse.json(await keyEventDetail(site, q.get('start'), q.get('end'))); }
    catch (e) { return NextResponse.json({ error: String(e.message || e).slice(0, 200) }, { status: 502 }); }
  }
  if (q.get('live') === '1') {
    const fresh = q.get('fresh') === '1';
    const [live, log, asana, clickup, todayNow] = await Promise.all([liveVisitors(), readLog(), asanaSafe({ fresh }), clickupSafe({ fresh }), todaySoFar({ fresh })]);
    return NextResponse.json({ live, log, asana, clickup, todayNow, at: new Date().toISOString() });
  }
  return NextResponse.json({ ...(await commandData({ fresh: q.get('fresh') === '1' })), person: request.headers.get('x-worthy-person') || '' });
}

export async function POST(request) {
  if (request.headers.get('x-worthy-role') !== 'mgmt') return denied();
  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }); }
  const person = request.headers.get('x-worthy-person') || 'management';
  // Google's AI Overviews / AI Mode figures, read from Search Console's Generative AI report (it has no API yet)
  if (body.action === 'google-ai') {
    try { await saveGoogleAi(body.site, body.data); await logEvent({ what: 'Google AI figures saved', kind: 'search', title: `Google AI figures, ${({ worthy: 'worthy.nz', worthyproducts: 'worthyproducts.nz', dutchrusk: 'dutchrusk.co.nz' })[body.site] || body.site}`, person }); return NextResponse.json({ ok: true, googleAi: await readGoogleAi() }); }
    catch (e) { return NextResponse.json({ error: String(e.message || e).slice(0, 200) }, { status: 400 }); }
  }
  // Ask the AI questions again (the page does this when the last run is over a day old, or on Check now)
  if (body.action === 'ai-check') {
    try {
      const { latest } = await latestChecks();
      if (!body.force && latest?.at && Date.now() - Date.parse(latest.at) < 20 * 3600000) return NextResponse.json({ ...(await latestChecks()), skipped: true });
      await runChecks();
      await logEvent({ what: 'AI answers checked', kind: 'search', title: 'AI search check', person });
      return NextResponse.json(await latestChecks());
    } catch (e) { return NextResponse.json({ error: String(e.message || e).slice(0, 200) }, { status: 502 }); }
  }
  // Changes to Asana tasks and ClickUp cards, made straight in those tools and written to the activity log
  if (body.action === 'external') {
    const { source, id, op, value, title } = body;
    try {
      if (source === 'asana') await asanaWrite(id, op, value);
      else if (source === 'clickup') await clickupWrite(id, op, value);
      else throw new Error('Unknown source');
      const what = op === 'done' ? 'done' : op === 'reopen' ? 'reopened' : op === 'due' ? `due moved to ${value || 'none'}` : op === 'status' ? `moved to ${value}` : 'commented';
      await logEvent({ what, kind: source, title: String(title || id).slice(0, 200), person, source, id, op, value: op === 'comment' ? String(value || '').slice(0, 300) : value });
      const [asana, clickup, log] = await Promise.all([asanaSafe(), clickupSafe(), readLog()]);
      return NextResponse.json({ ok: true, asana, clickup, log });
    } catch (e) { return NextResponse.json({ error: String(e.message || e) }, { status: 400 }); }
  }
  try {
    const board = await writeBoard(body.action === 'delete' ? 'delete' : 'save', body.item || {}, person);
    return NextResponse.json({ ok: true, board, log: await readLog() });
  } catch (e) { return NextResponse.json({ error: String(e.message || e) }, { status: 400 }); }
}
