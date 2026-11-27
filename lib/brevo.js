/**
 * Email marketing from Brevo, per shop (Command Center, Email tab, 27 Nov 2026).
 *
 * The Brevo keys stay on the Dutch Rusk app (BREVO_API_KEY = Dutch Rusk, BREVO_API_KEY_WORTHY = Worthy Products); this
 * reads through its read-only route /api/brevo-read (same DUTCHRUSK_REPORTS_KEY as /api/shopifyql). Figures are Brevo's own:
 *   Campaigns    every campaign sent in the period (NZ dates): sent, delivered, unique opens, unique clicks, unsubscribes,
 *                bounces, as Brevo's campaign report counts them (statistics.globalStats).
 *   Automations  each workflow, its status and trigger, and the emails its steps sent in the period, counted from Brevo's
 *                email events for each step's template: sent, delivered, unique opens and clicks (one per message), unsubscribes.
 * The period before (same length) is read the same way for the change. A shop with no Brevo key answers not_connected.
 * Cached 5 minutes; Brevo is not Odoo, so there is no shared lock. emailActions() at the end lists what needs fixing now.
 */
import { unstable_cache } from 'next/cache';

const URL_ = 'https://dutch-rusk-catalog-manager.onrender.com/api/brevo-read';
export const EMAIL_SHOPS = [
  { id: 'dutchrusk', brand: 'dutchrusk', name: 'dutchrusk.co.nz' },
  { id: 'worthyproducts', brand: 'worthy', name: 'worthyproducts.nz' },
];

const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const days = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000) + 1;
const nzDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Pacific/Auckland' }) : null);
const num = (v) => Number(v) || 0;

class NotConnected extends Error {}

async function get(brand, path, tries = 2) {
  const res = await fetch(URL_, {
    method: 'POST',
    headers: { 'x-reports-key': process.env.DUTCHRUSK_REPORTS_KEY || '', 'Content-Type': 'application/json' },
    body: JSON.stringify({ brand, path }),
    signal: AbortSignal.timeout(40000),
  });
  const j = await res.json().catch(() => ({}));
  if (j.error === 'not_connected') throw new NotConnected();
  if ((!res.ok || j.error) && tries > 1 && res.status >= 500 && !/unrecognised IP|restricted api keys|not allowed/i.test(String(j.error || ''))) {
    await new Promise((r) => setTimeout(r, 800));
    return get(brand, path, tries - 1);
  }
  if (!res.ok || j.error) throw new Error(`Brevo (${res.status}): ${String(j.error || '').slice(0, 160)}`);
  return j;
}

/* ── Campaigns ── */
async function allSentCampaigns(brand) {
  const out = [];
  for (let off = 0; off < 2000; off += 100) {
    const j = await get(brand, `/emailCampaigns?status=sent&limit=100&offset=${off}&sort=desc&statistics=globalStats`);
    const c = j.campaigns || [];
    out.push(...c);
    if (c.length < 100) break;
  }
  return out.map((c) => {
    const s = c.statistics?.globalStats || {};
    return {
      id: c.id, name: c.name, subject: c.subject || '', date: nzDate(c.sentDate || c.scheduledAt), from: c.sender?.name || '',
      sent: num(s.sent), delivered: num(s.delivered), opens: num(s.uniqueViews), clicks: num(s.uniqueClicks),
      unsubscribed: num(s.unsubscriptions), bounced: num(s.hardBounces) + num(s.softBounces), hardBounced: num(s.hardBounces), spam: num(s.complaints),
    };
  });
}
const tally = (rows) => rows.reduce((t, r) => {
  for (const k of ['sent', 'delivered', 'opens', 'clicks', 'unsubscribed', 'bounced', 'hardBounced']) t[k] += r[k] || 0;
  return t;
}, { count: rows.length, sent: 0, delivered: 0, opens: 0, clicks: 0, unsubscribed: 0, bounced: 0, hardBounced: 0 });

/* ── Automations ── */
const TRIGGER = {
  cart_updated: () => 'Cart left without an order',
  order_created: () => 'Order placed',
  added_to_lists: (t) => `Joined ${(t.lists || []).map((l) => l.name).join(', ') || 'a list'}`,
  contact_match_one_segment: (t) => `In segment ${t.segment?.name || ''}`.trim(),
  contact_match_custom_filter: () => 'Daily contact filter',
};
const triggerText = (wf) => (wf.triggers || []).map((t) => (TRIGGER[t.type] ? TRIGGER[t.type](t) : String(t.type || '').replace(/_/g, ' '))).join(' or ');

async function templateEvents(brand, templateId, from, to) {
  // Brevo's event log, at most 2,500 a page and 30 days a call
  /* Opens, clicks and unsubscribes count only for emails sent in the period (by message), so a click today on an email sent
     last month never lands on this period's sends (it read 1,400% clicked before, 27 Nov 2026). */
  const stats = { sent: new Set(), delivered: new Set(), opens: new Set(), clicks: new Set(), unsubscribed: new Set(), bounced: new Set(), hardBounced: new Set() };
  const byDay = {};   // emails sent per NZ day, for the chart
  for (let a = from; a <= to; a = addDays(a, 30)) {
    const b = addDays(a, 29) < to ? addDays(a, 29) : to;
    for (let off = 0; off < 50000; off += 2500) {
      const j = await get(brand, `/smtp/statistics/events?templateId=${templateId}&startDate=${a}&endDate=${b}&limit=2500&offset=${off}&sort=desc`);
      const ev = j.events || [];
      for (const e of ev) {
        if (e.event === 'requests') { if (!stats.sent.has(e.messageId)) { const dd = nzDate(e.date); if (dd) byDay[dd] = (byDay[dd] || 0) + 1; } stats.sent.add(e.messageId); }
        else if (e.event === 'delivered') stats.delivered.add(e.messageId);
        else if (e.event === 'opened' || e.event === 'loadedByProxy') stats.opens.add(e.messageId);
        else if (e.event === 'clicks') stats.clicks.add(e.messageId);
        else if (e.event === 'unsubscribed') stats.unsubscribed.add(e.messageId);
        else if (e.event === 'hardBounces' || e.event === 'softBounces' || e.event === 'bounces') { stats.bounced.add(e.messageId); if (e.event === 'hardBounces') stats.hardBounced.add(e.messageId); }
      }
      if (ev.length < 2500) break;
    }
  }
  const mine = (set) => [...set].filter((id) => stats.sent.has(id)).length;
  return { byDay, sent: stats.sent.size, delivered: mine(stats.delivered), opens: mine(stats.opens), clicks: mine(stats.clicks), unsubscribed: mine(stats.unsubscribed), bounced: mine(stats.bounced), hardBounced: mine(stats.hardBounced) };
}

async function automations(brand, from, to, pFrom, pTo) {
  const list = (await get(brand, '/automation/workflows')).workflows || [];
  const out = [];
  for (const w of list) {
    const wf = await get(brand, `/automation/workflows/${w.id}`);
    const steps = (wf.steps || []).filter((s) => s.type === 'send_email' && (s.send_email?.template_id || s.message?.template_id));
    const emails = [];
    for (const s of steps) {
      const tid = s.send_email?.template_id || s.message?.template_id;
      const [now, before] = await Promise.all([templateEvents(brand, tid, from, to), templateEvents(brand, tid, pFrom, pTo)]);
      emails.push({ templateId: tid, subject: (s.message?.subject || s.message?.template_name || '').replace(/\{\{[^}]*\}\}/g, '').replace(/^[\s,]+/, '').trim(), now, before });
    }
    const sum = (k) => emails.reduce((t, e) => {
      for (const f of ['sent', 'delivered', 'opens', 'clicks', 'unsubscribed', 'bounced', 'hardBounced']) t[f] += e[k][f] || 0;
      return t;
    }, { sent: 0, delivered: 0, opens: 0, clicks: 0, unsubscribed: 0, bounced: 0, hardBounced: 0 });
    const byDay = {};
    for (const e of emails) for (const [k, v] of Object.entries(e.now.byDay || {})) byDay[k] = (byDay[k] || 0) + v;
    for (const e of emails) { delete e.now.byDay; delete e.before.byDay; }
    out.push({ id: w.id, name: w.name, status: w.status, trigger: triggerText(wf), emails, now: sum('now'), before: sum('before'), byDay });
  }
  const rank = { active: 0, pause: 1, inactive: 2 };
  return out.sort((a, b) => (rank[a.status] ?? 3) - (rank[b.status] ?? 3) || b.now.sent - a.now.sent);
}

async function shopEmail(shop, from, to) {
  const n = days(from, to), pTo = addDays(from, -1), pFrom = addDays(pTo, -(n - 1));
  try {
    const camps = await allSentCampaigns(shop.brand);
    const inP = camps.filter((c) => c.date >= from && c.date <= to).sort((a, b) => (a.date < b.date ? 1 : -1));
    const inPrev = camps.filter((c) => c.date >= pFrom && c.date <= pTo);
    // A restricted Brevo key can read campaigns but not automations: campaigns still show, automations are flagged.
    let autos = [], automationsBlocked = false;
    try { autos = await automations(shop.brand, from, to, pFrom, pTo); }
    catch (e) { if (/restricted api keys/i.test(String(e.message))) automationsBlocked = true; else throw e; }
    // Emails Brevo could not send in the period (its own report): errors, blocked, and spam complaints
    let aggError = null;
    const agg = await get(shop.brand, `/smtp/statistics/aggregatedReport?startDate=${from}&endDate=${to}`).catch((e) => { aggError = String(e.message || e).slice(0, 160); return null; });   // retried once in get()
    const failed = agg ? { errors: num(agg.error) + num(agg.blocked), spam: num(agg.spamReports) } : null;
    return {
      id: shop.id, name: shop.name, status: 'ok', failed, aggError,
      campaigns: { now: tally(inP), before: tally(inPrev), list: inP },
      automations: autos, automationsBlocked,
    };
  } catch (e) {
    if (e instanceof NotConnected) return { id: shop.id, name: shop.name, status: 'not_connected' };
    return { id: shop.id, name: shop.name, status: 'error', error: String(e.message || e).slice(0, 200) };
  }
}

async function compute(from, to) {
  const n = days(from, to), pTo = addDays(from, -1), pFrom = addDays(pTo, -(n - 1));
  const shops = await Promise.all(EMAIL_SHOPS.map((s) => shopEmail(s, from, to)));
  return { from, to, prevFrom: pFrom, prevTo: pTo, generatedAt: new Date().toISOString(), shops };
}

const cached = unstable_cache((from, to) => compute(from, to), ['brevo-email-v8'], { revalidate: 300 });   // five minutes

export async function emailStats(from, to, { fresh = false } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(to || '') || from > to) throw new Error('from and to must be dates YYYY-MM-DD');
  if (days(from, to) > 400) throw new Error('Pick a period of up to 400 days');
  return fresh ? compute(from, to) : cached(from, to);
}

/* ── Action items (27 Nov 2026): what needs fixing in email right now, worked out live on every read (5-minute copy).
   Each check looks at the current state, so an item drops off by itself once the problem is fixed: sends that fail
   (last 2 days), spam complaints (last 7 days), campaigns with high hard bounces or unsubscribes and active automations
   that sent nothing (last 30 days), and a shop Brevo will not answer for. ── */
const BOUNCE_LIMIT = 0.02, UNSUB_LIMIT = 0.01;
const n0 = (v) => Math.round(v || 0).toLocaleString('en-NZ');
async function computeActions() {
  const today = nzDate(new Date().toISOString());
  const from30 = addDays(today, -29), from7 = addDays(today, -6), from2 = addDays(today, -1);
  const stats = await emailStats(from30, today);
  const items = [];
  const push = (shop, level, key, title, detail) => items.push({ id: `${shop.id}:${key}`, shop: shop.name, level, title, detail });
  for (const shop of EMAIL_SHOPS) {
    const x = stats.shops.find((y) => y.id === shop.id);
    if (!x || x.status === 'not_connected') { push(shop, 'high', 'nokey', 'Brevo is not connected', 'Add the Brevo API key on Render'); continue; }
    if (x.status !== 'ok') {
      const ip = /unrecognised IP/i.test(x.error || '');
      push(shop, 'high', 'down', ip ? 'Brevo is blocking the dashboard server' : 'Brevo did not answer',
        ip ? 'Authorise the Render outbound IPs in Brevo, Security' : String(x.error || '').slice(0, 120));
      continue;
    }
    if (x.automationsBlocked) push(shop, 'medium', 'restricted', 'Brevo key cannot read automations', 'Use a standard API key');
    // Sends failing now, with Brevo's own reason (last 2 days); how many failed in 30 days for the size of it
    try {
      const ev = (await get(shop.brand, `/smtp/statistics/events?startDate=${from2}&endDate=${today}&limit=500&event=error`)).events || [];
      const reasons = new Map();
      for (const e of ev) {
        const r = String(e.reason || 'No reason given').replace(/\s*This error is logged once per 24 hours.*$/i, '').replace(/^Email not sent:\s*/i, '');
        reasons.set(r, (reasons.get(r) || 0) + 1);
      }
      for (const [r] of reasons) {
        const off = /sending platform is currently disabled/i.test(r);
        push(shop, 'high', `err:${r.slice(0, 40)}`, off ? 'Brevo sending is switched off: automation emails are not going out' : 'Emails are failing to send',
          `${r}${x.failed?.errors ? ` ${n0(x.failed.errors)} failed in 30 days.` : ''}`);
      }
      const sp = num((await get(shop.brand, `/smtp/statistics/aggregatedReport?startDate=${from7}&endDate=${today}`)).spamReports);
      const spC = x.campaigns.list.filter((c) => c.date >= from7).reduce((t, c) => t + (c.spam || 0), 0);
      if (sp + spC > 0) push(shop, 'medium', 'spam', `${sp + spC} spam ${sp + spC === 1 ? 'complaint' : 'complaints'} in the last 7 days`, 'Remove those people from the lists');
    } catch { /* the checks below still stand */ }
    for (const c of x.campaigns.list) {
      const hb = c.sent ? c.hardBounced / c.sent : 0;
      if (hb >= BOUNCE_LIMIT && c.hardBounced >= 3) push(shop, 'medium', `hb:${c.id}`, `${c.name}: ${(hb * 100).toFixed(1)}% hard bounced`, `${n0(c.hardBounced)} addresses do not exist; clean the list before the next send`);
      const un = c.delivered ? c.unsubscribed / c.delivered : 0;
      if (un >= UNSUB_LIMIT && c.unsubscribed >= 3) push(shop, 'medium', `un:${c.id}`, `${c.name}: ${(un * 100).toFixed(1)}% unsubscribed`, `${n0(c.unsubscribed)} people left the list`);
    }
    for (const a of x.automations) {
      if (a.status === 'active' && a.emails.length && a.now.sent === 0) push(shop, 'high', `idle:${a.id}`, `${a.name} is on but sent nothing in 30 days`, a.trigger);
      const hb = a.now.sent ? a.now.hardBounced / a.now.sent : 0;
      if (hb >= BOUNCE_LIMIT && a.now.hardBounced >= 3) push(shop, 'medium', `ahb:${a.id}`, `${a.name}: ${(hb * 100).toFixed(1)}% hard bounced`, `${n0(a.now.hardBounced)} addresses do not exist`);
    }
  }
  const rank = { high: 0, medium: 1 };
  return { generatedAt: new Date().toISOString(), items: items.sort((p, q) => rank[p.level] - rank[q.level]) };
}
const cachedActions = unstable_cache(() => computeActions(), ['brevo-actions-v3'], { revalidate: 300 });
export async function emailActions({ fresh = false } = {}) { return fresh ? computeActions() : cachedActions(); }
