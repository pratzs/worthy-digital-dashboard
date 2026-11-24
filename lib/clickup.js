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

// ClickUp copies of Thursday meeting items made in Sept 2026. Asana has been the single source of truth for those since
// 5 Oct, so these never show here (no duplicates).
const ASANA_TWINS = new Set(['14yhc7kumgy', '14yhc7kumh0', '14yhc7kumh1', '14yhc7kumh2', '14yhc7kur1x', '14yhc7kur1y', '14yhc7kur1z', '14yhc7kur20', '14yhc7kur21']);

export const relevant = (name, tags = []) => !SKIP.test(name) && (KEEP.test(name) || tags.some((t) => KEEP_TAGS.test(t)));

async function listTasks(listId, { closed }) {
  const out = [];
  for (let page = 0; page < 10; page++) {
    const res = await fetch(`https://api.clickup.com/api/v2/list/${listId}/task?subtasks=true&page=${page}${closed ? `&include_closed=true&date_updated_gt=${Date.now() - 20 * 86400000}` : ''}`, {
      headers: { Authorization: process.env.CLICKUP_TOKEN }, signal: AbortSignal.timeout(15000), cache: 'no-store',
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`ClickUp ${res.status}: ${j.err || 'error'}`);
    out.push(...(j.tasks || []));
    if (j.last_page !== false && (j.tasks || []).length < 100) break;
  }
  return out;
}

// ClickUp stores dates as epoch ms at NZ midnight, so read them in NZ time (UTC would show the day before).
const day = (ms) => (ms ? new Date(Number(ms)).toLocaleDateString('en-CA', { timeZone: 'Pacific/Auckland' }) : null);
let memo = { at: 0, value: null };

export async function clickupBoard() {
  if (!clickupConfigured()) return { status: 'not_connected' };
  if (memo.value && Date.now() - memo.at < 20000) return memo.value;
  const doneCut = Date.now() - 14 * 86400000;
  // Every open card, however old, plus anything (open or closed) updated in the last 20 days for the closed ones.
  const lists = await Promise.all(LISTS.flatMap((id) => [listTasks(id, { closed: false }), listTasks(id, { closed: true })]));
  const seen = new Set();
  const raw = lists.flat().filter((t) => (seen.has(t.id) ? false : seen.add(t.id)));
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
    .filter((t) => !ASANA_TWINS.has(t.id) && relevant(t.name, t.tags))
    .filter((t) => !t.done || (t.doneAt && new Date(`${t.doneAt}T00:00:00Z`).getTime() >= doneCut));
  const value = { status: 'ok', at: new Date().toISOString(), tasks };
  memo = { at: Date.now(), value };
  return value;
}

export async function clickupSafe() {
  try { return await clickupBoard(); } catch (e) { return memo.value ? { ...memo.value, stale: true } : { status: 'error', error: String(e.message || e).slice(0, 200) }; }
}

/** Change a card from the Command Center: op 'done' | 'reopen' | 'status' (value) | 'due' (YYYY-MM-DD or '') | 'comment'. */
export async function clickupWrite(id, op, value) {
  if (!clickupConfigured()) throw new Error('ClickUp is not connected');
  if (!/^[a-z0-9]{6,20}$/i.test(String(id))) throw new Error('Bad card id');
  const send = async (path, method, body) => {
    const res = await fetch(`https://api.clickup.com/api/v2${path}`, {
      method, headers: { Authorization: process.env.CLICKUP_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`ClickUp ${res.status}: ${j.err || 'error'}`);
    return j;
  };
  // NZ midnight of the chosen day, the way ClickUp stores a date with no time
  const nzMidnight = (d) => {
    const utc = Date.parse(`${d}T00:00:00Z`);
    for (const h of [13, 12]) { const t = utc - h * 3600000; const p = new Date(t).toLocaleString('en-CA', { timeZone: 'Pacific/Auckland', hour12: false }); if (p.startsWith(d) && /, (00|24):00/.test(p)) return t + 4 * 3600000; }   // ClickUp keeps date-only due dates at 4am
    return utc - 9 * 3600000;
  };
  let out;
  if (op === 'done') out = await send(`/task/${id}`, 'PUT', { status: 'complete' });
  else if (op === 'reopen') out = await send(`/task/${id}`, 'PUT', { status: 'to do' });
  else if (op === 'status') out = await send(`/task/${id}`, 'PUT', { status: String(value || '').slice(0, 40) });
  else if (op === 'due') out = await send(`/task/${id}`, 'PUT', value ? { due_date: nzMidnight(value), due_date_time: false } : { due_date: null });
  else if (op === 'comment') out = await send(`/task/${id}/comment`, 'POST', { comment_text: String(value || '').slice(0, 2000), notify_all: false });
  else throw new Error('Unknown change');
  memo = { at: 0, value: null };
  return out;
}
