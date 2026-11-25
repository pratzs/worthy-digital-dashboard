/**
 * Ecom x Marketing meeting notes (Command Center, 26 Nov 2026).
 *
 * People type notes during the meeting as they normally would. The notes are saved as they type, per meeting (one
 * meeting a week, on Thursday). "Read notes" asks Claude to pull out discussion points and actions, each action with an
 * owner from the Asana project and a due date. The person checks the list, then "Send to Asana" creates the tasks and
 * assigns them (Asana tells each person). Actions done in Asana during the week drop off the next meeting's agenda;
 * open actions and unresolved points carry forward. Nothing is ever deleted: every meeting's notes stay on record.
 *
 * Stored in the shared store (Upstash) under one key, cc:meet:v1.
 */
import { kvGet, kvSet } from '@/lib/repStore';
import { asanaMembers, asanaCreateTask } from '@/lib/asana';
import { nzToday } from '@/lib/ostendo';

const KEY = 'cc:meet:v1';
const addDays = (iso, n) => new Date(new Date(`${iso}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);
/** The meeting these notes belong to: today if it is Thursday in NZ, otherwise the next Thursday. */
export function meetingDate(today = nzToday()) {
  const wd = new Date(`${today}T00:00:00Z`).getUTCDay();
  return addDays(today, (4 - wd + 7) % 7);
}
const id = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export async function readMeeting() {
  try { const v = await kvGet(KEY); if (v) return JSON.parse(v); } catch { /* fall through */ }
  return { meetings: {}, points: [], actions: [] };
}
async function write(state) { await kvSet(KEY, JSON.stringify(state)); return state; }

export async function meetingState() {
  const [state, members] = await Promise.all([readMeeting(), asanaMembers().catch(() => [])]);
  return { ...state, current: meetingDate(), members };
}

/** Save the notes for a meeting (the page sends them as people type). */
export async function saveNotes(date, notes, person) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new Error('Bad meeting date');
  const state = await readMeeting();
  state.meetings[date] = { ...(state.meetings[date] || {}), notes: String(notes || '').slice(0, 40000), updatedAt: new Date().toISOString(), by: person };
  return write(state);
}

const TOOL = {
  name: 'record_meeting',
  description: 'Record the discussion points and actions found in the meeting notes.',
  input_schema: {
    type: 'object',
    properties: {
      points: { type: 'array', description: 'Topics discussed or still to discuss that are not a task for one person.', items: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
      actions: {
        type: 'array', description: 'Things someone has to do.',
        items: { type: 'object', properties: {
          title: { type: 'string', description: 'Short task name starting with a verb, NZ English, no em dashes.' },
          owner: { type: ['string', 'null'], description: 'Exactly one name from the member list, or null if the notes do not say who.' },
          due: { type: ['string', 'null'], description: 'YYYY-MM-DD if the notes give a date or a relative day, otherwise null.' },
          notes: { type: 'string', description: 'What the notes say about it, in a sentence or two.' },
        }, required: ['title', 'owner', 'due', 'notes'] },
      },
    },
    required: ['points', 'actions'],
  },
};

/** Ask Claude to pull points and actions out of the notes. Returns proposals; nothing is sent anywhere yet. */
export async function readNotes(date, person, { trialText = null } = {}) {
  const state = await readMeeting();
  // A trial read (trialText) reads the given text and returns what it found; nothing is saved or sent.
  const notes = trialText !== null ? String(trialText) : (state.meetings[date]?.notes || '');
  if (notes.trim().length < 5) throw new Error('Type some notes first');
  const members = await asanaMembers().catch(() => []);
  const already = state.actions.filter((a) => a.meeting === date).map((a) => `- ${a.title}${a.owner ? ` (${a.owner})` : ''}`).join('\n') || '(none)';
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-sonnet-5-5', max_tokens: 2000,
      tools: [TOOL], tool_choice: { type: 'tool', name: TOOL.name },
      system: [
        'You turn Worthy\'s Ecom x Marketing meeting notes into discussion points and actions. Worthy is a New Zealand FMCG wholesaler; the sites are worthy.nz, worthyproducts.nz and dutchrusk.co.nz.',
        'Only use what the notes say. Never invent a task, an owner or a date. If the notes do not name who does it, owner is null.',
        `Owners must be exactly one of these Asana members (match first names, nicknames or initials to them): ${members.map((m) => m.name).join(', ') || '(none)'}.`,
        `The meeting is on ${date}. Turn relative days into dates from that day ("by Friday" = the Friday after it, "next week" = 7 days after it).`,
        'Do not repeat actions already recorded for this meeting:', already,
        'Write in plain New Zealand English, no em dashes.',
      ].join('\n'),
      messages: [{ role: 'user', content: `Meeting notes:\n\n${notes}` }],
    }),
    signal: AbortSignal.timeout(60000),
  });
  const j = await res.json();
  if (j.error) throw new Error(j.error.message || 'AI error');
  const out = (j.content || []).find((c) => c.type === 'tool_use')?.input || { points: [], actions: [] };
  const byName = new Map(members.map((m) => [m.name.toLowerCase(), m]));
  if (trialText !== null) {
    return { trial: true, points: out.points || [], actions: (out.actions || []).map((a) => { const m = a.owner ? byName.get(String(a.owner).toLowerCase()) : null; return { ...a, owner: m?.name || null, matched: Boolean(m) }; }), members: members.map((m) => m.name) };
  }
  const now = new Date().toISOString();
  const seenPoint = new Set(state.points.map((p) => p.text.trim().toLowerCase()));
  for (const p of out.points || []) {
    const t = String(p.text || '').trim();
    if (t && !seenPoint.has(t.toLowerCase())) { state.points.push({ id: id(), text: t, meeting: date, status: 'open', createdAt: now, by: person }); seenPoint.add(t.toLowerCase()); }
  }
  // Clear earlier proposals for this meeting that were never sent, then add the new ones
  state.actions = state.actions.filter((a) => !(a.meeting === date && a.status === 'proposed'));
  for (const a of out.actions || []) {
    const m = a.owner ? byName.get(String(a.owner).toLowerCase()) : null;
    state.actions.push({ id: id(), title: String(a.title || '').slice(0, 250), owner: m?.name || null, ownerGid: m?.gid || null,
      due: /^\d{4}-\d{2}-\d{2}$/.test(a.due || '') ? a.due : null, notes: String(a.notes || '').slice(0, 1000), meeting: date, status: 'proposed', createdAt: now, by: person });
  }
  state.meetings[date] = { ...(state.meetings[date] || {}), readAt: now };
  return write(state);
}

/** Change a proposed action before it is sent (title, owner, due) or drop it. */
export async function editAction(actionId, patch) {
  const state = await readMeeting();
  const a = state.actions.find((x) => x.id === actionId);
  if (!a) throw new Error('Action not found');
  if (patch.drop) { state.actions = state.actions.filter((x) => x.id !== actionId || x.status !== 'proposed'); return write(state); }
  if (patch.title !== undefined) a.title = String(patch.title).slice(0, 250);
  if (patch.due !== undefined) a.due = /^\d{4}-\d{2}-\d{2}$/.test(patch.due || '') ? patch.due : null;
  if (patch.ownerGid !== undefined) {
    const m = (await asanaMembers().catch(() => [])).find((x) => x.gid === patch.ownerGid);
    a.ownerGid = m?.gid || null; a.owner = m?.name || null;
  }
  return write(state);
}

/** Create the proposed actions in Asana, assigned to their owners. Returns the new state and what was created. */
export async function sendActions(ids, person) {
  const state = await readMeeting();
  const created = [], failed = [];
  for (const a of state.actions.filter((x) => ids.includes(x.id) && x.status === 'proposed')) {
    try {
      const t = await asanaCreateTask({ name: a.title, assignee: a.ownerGid, due: a.due,
        notes: `${a.notes}\n\nFrom the Ecom x Marketing meeting on ${a.meeting} (Worthy Command Center), added by ${person}.` });
      a.status = 'sent'; a.asanaGid = t.gid; a.url = t.url; a.sentAt = new Date().toISOString(); a.sentBy = person;
      created.push(a);
    } catch (e) { failed.push({ id: a.id, title: a.title, error: String(e.message || e).slice(0, 200) }); }
  }
  await write(state);
  return { state, created, failed };
}

/** Mark a discussion point resolved (or open again). */
export async function setPoint(pointId, status, person) {
  const state = await readMeeting();
  const p = state.points.find((x) => x.id === pointId);
  if (!p) throw new Error('Point not found');
  p.status = status === 'resolved' ? 'resolved' : 'open';
  p.resolvedAt = p.status === 'resolved' ? new Date().toISOString() : null; p.resolvedBy = p.status === 'resolved' ? person : null;
  return write(state);
}
