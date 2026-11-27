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
 * Cached 15 minutes; Brevo is not Odoo, so there is no shared lock.
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

async function get(brand, path) {
  const res = await fetch(URL_, {
    method: 'POST',
    headers: { 'x-reports-key': process.env.DUTCHRUSK_REPORTS_KEY || '', 'Content-Type': 'application/json' },
    body: JSON.stringify({ brand, path }),
    signal: AbortSignal.timeout(40000),
  });
  const j = await res.json().catch(() => ({}));
  if (j.error === 'not_connected') throw new NotConnected();
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
      unsubscribed: num(s.unsubscriptions), bounced: num(s.hardBounces) + num(s.softBounces),
    };
  });
}
const tally = (rows) => rows.reduce((t, r) => {
  for (const k of ['sent', 'delivered', 'opens', 'clicks', 'unsubscribed', 'bounced']) t[k] += r[k] || 0;
  return t;
}, { count: rows.length, sent: 0, delivered: 0, opens: 0, clicks: 0, unsubscribed: 0, bounced: 0 });

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
  const stats = { sent: new Set(), delivered: new Set(), opens: new Set(), clicks: new Set(), unsubscribed: new Set() };
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
      }
      if (ev.length < 2500) break;
    }
  }
  const mine = (set) => [...set].filter((id) => stats.sent.has(id)).length;
  return { byDay, sent: stats.sent.size, delivered: mine(stats.delivered), opens: mine(stats.opens), clicks: mine(stats.clicks), unsubscribed: mine(stats.unsubscribed) };
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
      for (const f of ['sent', 'delivered', 'opens', 'clicks', 'unsubscribed']) t[f] += e[k][f];
      return t;
    }, { sent: 0, delivered: 0, opens: 0, clicks: 0, unsubscribed: 0 });
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
    return {
      id: shop.id, name: shop.name, status: 'ok',
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

const cached = unstable_cache((from, to) => compute(from, to), ['brevo-email-v4'], { revalidate: 900 });

export async function emailStats(from, to, { fresh = false } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(to || '') || from > to) throw new Error('from and to must be dates YYYY-MM-DD');
  if (days(from, to) > 400) throw new Error('Pick a period of up to 400 days');
  return fresh ? compute(from, to) : cached(from, to);
}
