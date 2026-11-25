/**
 * Asana: the "Ecom x Marketing" project (the Thursday meeting's single source of truth) for the Command
 * Center. Needs ASANA_TOKEN (a personal access token from a member of that project) on Vercel.
 * Answers are kept for 20 seconds in memory so a room full of open dashboards does not hit Asana's rate limit.
 */
const BASE = 'https://app.asana.com/api/1.0';
export const ASANA_PROJECT = process.env.ASANA_PROJECT || '1219139073710791';
export const asanaConfigured = () => Boolean(process.env.ASANA_TOKEN);

const FIELDS = 'parent.gid,name,assignee.name,due_on,completed,completed_at,modified_at,num_subtasks,permalink_url,custom_fields.name,custom_fields.display_value';
const SUB_FIELDS = 'name,assignee.name,due_on,completed,completed_at,permalink_url';

async function get(path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${process.env.ASANA_TOKEN}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(15000), cache: 'no-store',
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Asana ${res.status}: ${j.errors?.[0]?.message || 'error'}`);
  return j;
}
async function all(path) {
  const out = [];
  let next = `${path}${path.includes('?') ? '&' : '?'}limit=100`;
  for (let i = 0; next && i < 10; i++) {
    const j = await get(next);
    out.push(...(j.data || []));
    next = j.next_page?.path ? j.next_page.path : null;
  }
  return out;
}
const nzDay = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Pacific/Auckland' });
const field = (t, name) => (t.custom_fields || []).find((f) => f.name === name)?.display_value || null;
const shape = (t) => ({
  id: t.gid, name: t.name, owner: t.assignee?.name || null, due: t.due_on || null,
  done: Boolean(t.completed), doneAt: t.completed_at ? nzDay(t.completed_at) : null, url: t.permalink_url,
});

/**
 * Which site a task is about, read from its name. A task that names no site belongs to all of them (empty list).
 * Brand pages (Ferrarelle, Calypso, H2Coco and the rest) live on worthy.nz.
 */
const SITE_RULES = [
  ['dutchrusk', /dutch\s*rusk|dutchrusk/i],
  ['worthyproducts', /worthy\s*products|worthyproducts/i],
  ['worthy', /worthy\.nz|\bbrand pages?\b|\b(ferrarelle|calypso|h2\s*coco|exeter|riclan|takis|o'?brien|tradie|fmcg)\b/i],
];
export function sitesFor(name) {
  const hits = SITE_RULES.filter(([, re]) => re.test(name || '')).map(([id]) => id);
  // "Vidal page - new page (Dutch Rusk)": a named site beats the brand-page rule
  if (hits.length > 1 && hits.includes('worthy') && !/worthy\.nz/i.test(name)) return hits.filter((h) => h !== 'worthy');
  return hits;
}

let memo = { at: 0, value: null };

export async function asanaBoard({ fresh = false } = {}) {
  if (!asanaConfigured()) return { status: 'not_connected' };
  if (!fresh && memo.value && Date.now() - memo.at < 20000) return memo.value;
  const tasks = await all(`/projects/${ASANA_PROJECT}/tasks?opt_fields=${FIELDS}`);
  const recent = Date.now() - 14 * 86400000;
  // Subtasks only for open tasks and ones closed in the last fortnight, to keep the call count small.
  const want = tasks.filter((t) => t.num_subtasks > 0 && (!t.completed || new Date(t.completed_at).getTime() > recent));
  const subs = new Map();
  await Promise.all(want.map(async (t) => {
    try { subs.set(t.gid, (await all(`/tasks/${t.gid}/subtasks?opt_fields=${SUB_FIELDS}`)).map(shape)); } catch { subs.set(t.gid, null); }
  }));
  const value = {
    status: 'ok', project: ASANA_PROJECT, at: new Date().toISOString(),
    // A subtask that is also added to the project shows under its parent only, never twice.
    tasks: tasks.filter((t) => !(t.parent?.gid && tasks.some((p) => p.gid === t.parent.gid))).map((t) => ({
      ...shape(t), sites: sitesFor(t.name), status: field(t, 'Status'), priority: field(t, 'Priority'), type: field(t, 'Work Type'),
      modifiedAt: t.modified_at, subtaskCount: t.num_subtasks || 0,
      subtasks: (subs.get(t.gid) || []).map((x) => ({ ...x, sites: sitesFor(x.name).length ? sitesFor(x.name) : sitesFor(t.name) })),
    })),
  };
  memo = { at: Date.now(), value };
  return value;
}

export async function asanaSafe(opts = {}) {
  try { return await asanaBoard(opts); } catch (e) { return memo.value ? { ...memo.value, stale: true } : { status: 'error', error: String(e.message || e).slice(0, 200) }; }
}

/** Change a task from the Command Center: op 'done' | 'reopen' | 'due' (value YYYY-MM-DD or '') | 'comment' (value text). */
export async function asanaWrite(id, op, value) {
  if (!asanaConfigured()) throw new Error('Asana is not connected');
  if (!/^\d{6,25}$/.test(String(id))) throw new Error('Bad task id');
  const send = async (path, method, data) => {
    const res = await fetch(`${BASE}${path}`, {
      method, headers: { Authorization: `Bearer ${process.env.ASANA_TOKEN}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ data }), signal: AbortSignal.timeout(15000),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Asana ${res.status}: ${j.errors?.[0]?.message || 'error'}`);
    return j.data;
  };
  let out;
  if (op === 'done' || op === 'reopen') out = await send(`/tasks/${id}`, 'PUT', { completed: op === 'done' });
  else if (op === 'due') out = await send(`/tasks/${id}`, 'PUT', { due_on: value || null });
  else if (op === 'comment') out = await send(`/tasks/${id}/stories`, 'POST', { text: String(value || '').slice(0, 2000) });
  else throw new Error('Unknown change');
  memo = { at: 0, value: null };   // next read goes straight to Asana
  return out;
}

/** People who a meeting action can be assigned to: everyone in the Worthy Asana workspace. Kept for 10 minutes. */
let membersMemo = { at: 0, value: null };
export async function asanaMembers() {
  if (!asanaConfigured()) return [];
  if (membersMemo.value && Date.now() - membersMemo.at < 600000) return membersMemo.value;
  // Everyone in the workspace, not only project members: people work on the meeting's tasks without joining the project.
  const p = await get(`/projects/${ASANA_PROJECT}?opt_fields=workspace.gid,members.name,members.email`);
  const ws = p.data?.workspace?.gid;
  const users = ws ? await all(`/workspaces/${ws}/users?opt_fields=name,email`) : (p.data?.members || []);
  const seen = new Set();
  const value = users.filter((m) => m.name && !seen.has(m.gid) && seen.add(m.gid)).map((m) => ({ gid: m.gid, name: m.name, email: m.email || null })).sort((a, b) => a.name.localeCompare(b.name));
  membersMemo = { at: Date.now(), value };
  return value;
}

/** Create a task in the Ecom x Marketing project, assigned to one member (Asana tells them). */
export async function asanaCreateTask({ name, assignee, due, notes }) {
  if (!asanaConfigured()) throw new Error('Asana is not connected');
  if (!name || String(name).trim().length < 3) throw new Error('A task needs a name');
  if (assignee && !/^\d{6,25}$/.test(String(assignee))) throw new Error('Bad assignee');
  if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) throw new Error('Bad due date');
  const res = await fetch(`${BASE}/tasks`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.ASANA_TOKEN}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ data: { projects: [ASANA_PROJECT], name: String(name).slice(0, 250), ...(assignee ? { assignee: String(assignee) } : {}), ...(due ? { due_on: due } : {}), notes: String(notes || '').slice(0, 4000) } }),
    signal: AbortSignal.timeout(15000),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Asana ${res.status}: ${j.errors?.[0]?.message || 'error'}`);
  memo = { at: 0, value: null };
  return { gid: j.data.gid, url: j.data.permalink_url || `https://app.asana.com/0/${ASANA_PROJECT}/${j.data.gid}` };
}
