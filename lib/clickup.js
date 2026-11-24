/**
 * ClickUp, read only: the e-commerce cards that matter to marketing too, for the Command Center pipeline.
 * Lists: E-Commerce > Active Sprint and Marketing > E-Commerce Requests. Needs CLICKUP_TOKEN on Vercel.
 * Warehouse, Odoo, stock, rep reporting, dashboard and single-customer support cards are left out.
 * Kept for 20 seconds in memory.
 */
import { sitesFor } from '@/lib/asana';

const LISTS = (process.env.CLICKUP_LISTS || '901613878266,901614088829').split(',').map((x) => x.trim()).filter(Boolean);
export const clickupConfigured = () => Boolean(process.env.CLICKUP_TOKEN);

const SKIP = /odoo|stocktake|scanner|scan log|warehouse|picking|stock|barcode|\bpos\b|clearance|rep orders|route|deal claims|dashboard|ostendo|catalog|gateway|cannot sign in|bau support|upstock|per-rep|weekly sales|exception notes|returns|unique id|connector/i;
const KEEP = /seo|google|website|page|banner|email|brevo|\bads?\b|landing|checkout|sign-?up|application form|signed in|portal|campaign|freight messaging|brand|samples|marketing|\.co\.nz|worthy\.nz|worthyproducts|address and hours|search/i;
const KEEP_TAGS = /seo|worthy\.nz|brevo|google business profile|marketing/i;
const TAG_SITE = { 'dutch rusk': 'dutchrusk', 'worthy products': 'worthyproducts', 'worthy.nz': 'worthy' };

export const relevant = (name, tags = []) => !SKIP.test(name) && (KEEP.test(name) || tags.some((t) => KEEP_TAGS.test(t)));

async function listTasks(listId, sinceMs) {
  const out = [];
  for (let page = 0; page < 10; page++) {
    const res = await fetch(`https://api.clickup.com/api/v2/list/${listId}/task?include_closed=true&subtasks=true&page=${page}&date_updated_gt=${sinceMs}`, {
      headers: { Authorization: process.env.CLICKUP_TOKEN }, signal: AbortSignal.timeout(15000), cache: 'no-store',
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`ClickUp ${res.status}: ${j.err || 'error'}`);
    out.push(...(j.tasks || []));
    if (j.last_page !== false && (j.tasks || []).length < 100) break;
  }
  return out;
}

const day = (ms) => (ms ? new Date(Number(ms)).toISOString().slice(0, 10) : null);
let memo = { at: 0, value: null };

export async function clickupBoard() {
  if (!clickupConfigured()) return { status: 'not_connected' };
  if (memo.value && Date.now() - memo.at < 20000) return memo.value;
  const since = Date.now() - 120 * 86400000;
  const doneCut = Date.now() - 14 * 86400000;
  const raw = (await Promise.all(LISTS.map((id) => listTasks(id, since)))).flat();
  const tasks = raw
    .map((t) => {
      const tags = (t.tags || []).map((x) => x.name);
      const fromTags = tags.map((x) => TAG_SITE[x]).filter(Boolean);
      const closed = t.status?.type === 'closed' || t.status?.type === 'done' || /complete|closed|done/i.test(t.status?.status || '');
      return {
        id: t.id, name: t.name, url: t.url, tags,
        status: t.status?.status || '', done: closed, doneAt: closed ? day(t.date_closed || t.date_done || t.date_updated) : null,
        due: day(t.due_date), owner: (t.assignees || []).map((a) => a.username).join(', ') || null,
        priority: t.priority?.priority || null, parent: t.parent || null,
        sites: [...new Set([...fromTags, ...sitesFor(t.name)])],
        updatedAt: day(t.date_updated),
      };
    })
    .filter((t) => relevant(t.name, t.tags))
    .filter((t) => !t.done || (t.doneAt && new Date(`${t.doneAt}T00:00:00Z`).getTime() >= doneCut));
  const value = { status: 'ok', at: new Date().toISOString(), tasks };
  memo = { at: Date.now(), value };
  return value;
}

export async function clickupSafe() {
  try { return await clickupBoard(); } catch (e) { return memo.value ? { ...memo.value, stale: true } : { status: 'error', error: String(e.message || e).slice(0, 200) }; }
}
