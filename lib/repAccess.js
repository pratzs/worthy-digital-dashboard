/**
 * Who a sales rep is, and the access codes that let them into the rep-only MCP
 * connector (app/api/rep-mcp). This is deliberately a SEPARATE system from the
 * management connector (app/api/mcp): its own signing key, its own sign-in, its
 * own tools. A rep token can never be used on the management endpoint, and a
 * management token can never be used here.
 *
 * Identity (who is who) is fixed in code below. Secrets are not: each rep has a
 * long random access code, and only a salted hash of it lives in the REP_ACCESS
 * environment variable, as JSON: { "jerry": { "salt": "...", "hash": "...", "ver": 1 }, ... }.
 * Bump a rep's `ver` (or delete their entry) and every token they hold stops
 * working on its next call. A rep with no entry cannot sign in.
 *
 * North reps are matched to Odoo by the name the dashboard already uses for them
 * (lib/odooReps.js). South reps are matched by their Ostendo code names
 * (lib/ostendo.js REP_NAMES; a "-1" legacy code rolls up to the same person).
 */
import { createHash, timingSafeEqual } from 'node:crypto';

export const REPS = [
  { key: 'nimesh',   label: 'Nimesh Darjee',  system: 'north' },
  { key: 'nayan',    label: 'Nayan Patel',    system: 'north' },
  { key: 'savan',    label: 'Savan Patel',    system: 'north' },
  { key: 'naitik',   label: 'Naitik Trivedi', system: 'north' },
  { key: 'jerry',    label: 'Jerry',          system: 'south', codes: ['410'] },
  { key: 'keith',    label: 'Keith',          system: 'south', codes: ['430'] },
  { key: 'chris',    label: 'Chris',          system: 'south', codes: ['460'] },
  { key: 'ravi',     label: 'Ravi Kumar',     system: 'south', codes: ['461'] },
  { key: 'lynette',  label: 'Lynette',        system: 'south', codes: ['470'] },
  { key: 'michelle', label: 'Michelle',       system: 'south', codes: ['420'] },
];

export const repByKey = (key) => REPS.find((r) => r.key === key) || null;

/**
 * WHO CAN SIGN IN. Only team leads. A lead sees themselves (`self`, if they sell) and each person in
 * `members`, one by one with full detail, plus team totals, and nobody outside that list. The other
 * reps have no way in: only a lead listed here with `enabled: true` can use a code.
 * Team 1's lead is not decided yet, so it stays switched off (no code can be issued for it).
 * `test` leads exist only when REP_ALLOW_TEST_LEAD=1 (local tests, never set in production).
 */
const LEAD_DEFS = [
  { key: 'michelle', label: 'Michelle', teamName: 'Team 2', self: 'michelle', members: ['chris', 'ravi', 'lynette'], enabled: true },
  { key: 'lead1', label: 'Team 1 lead', teamName: 'Team 1', self: null, members: ['jerry', 'keith', 'nimesh', 'nayan', 'savan', 'naitik'], enabled: false },
  { key: 'testlead', label: 'Test Lead', teamName: 'Test team', self: null, members: ['nimesh', 'jerry'], enabled: false, test: true },
];

const buildPrincipal = (d) => {
  const people = [d.self, ...d.members].filter(Boolean).map(repByKey).filter(Boolean);
  return {
    key: d.key, label: d.label, role: 'lead', teamName: d.teamName, test: Boolean(d.test),
    self: d.self ? repByKey(d.self) : null,
    people,
    members: d.members.map(repByKey).filter(Boolean),
    system: people.every((p) => p.system === people[0].system) ? people[0].system : 'mixed',
  };
};

const enabled = (d) => (d.test ? process.env.REP_ALLOW_TEST_LEAD === '1' : d.enabled);

/** Every lead who can sign in right now. */
export const activePrincipals = () => LEAD_DEFS.filter(enabled).map(buildPrincipal);

/** The lead for a token or cookie, or null (also null for a lead who is switched off). */
export const principalByKey = (key) => {
  const d = LEAD_DEFS.find((x) => x.key === key);
  return d && enabled(d) ? buildPrincipal(d) : null;
};

export const hashCode = (code, salt) =>
  createHash('sha256').update(`${salt}:${String(code)}`).digest('hex');

function table() {
  try { return JSON.parse(process.env.REP_ACCESS || '{}') || {}; } catch { return {}; }
}

const sameHex = (a, b) => {
  const x = Buffer.from(String(a), 'utf8'), y = Buffer.from(String(b), 'utf8');
  return x.length === y.length && timingSafeEqual(x, y);
};

/** The rep an access code belongs to, or null. Every entry is checked so timing does not reveal which. */
export function repForCode(code, email) {
  const c = String(code || '').trim();
  if (c.length < 20) return null;
  const t = table();
  let found = null;
  // Only leads are checked, so a code that belonged to any other rep opens nothing.
  for (const rep of activePrincipals()) {
    const e = t[rep.key];
    if (!e || !e.salt || !e.hash) continue;
    // When an email is on file the person must give that email as well as the password (emails are kept in REP_ACCESS, never in the public repo).
    const mailOk = !e.email || String(email || '').trim().toLowerCase() === String(e.email).trim().toLowerCase();
    if (sameHex(hashCode(c, e.salt), e.hash) && mailOk && !found) found = { rep, ver: Number(e.ver) || 1 };
  }
  return found;
}

/** The email on file for a lead (shown to management only), or null. */
export const emailOnFile = (key) => { const e = table()[key]; return e && e.email ? String(e.email) : null; };

/** The version a lead's tokens must carry right now (0 = switched off, not a lead, or unknown). */
export function currentVer(key) {
  if (!principalByKey(key)) return 0;
  const e = table()[key];
  return e && e.salt && e.hash ? (Number(e.ver) || 1) : 0;
}

export const teamNames = (p) => p.people.map((x) => x.label).join(', ');

/** Which team member a question is about. Only people on the lead's own team can ever be returned. */
export function resolvePerson(principal, raw) {
  const q = String(raw ?? '').trim().toLowerCase();
  if (!q) {
    if (principal.self) return principal.self;
    throw new Error(`Say which team member you mean: ${teamNames(principal)}.`);
  }
  const hits = principal.people.filter((x) => {
    const l = x.label.toLowerCase();
    return x.key === q || l === q || l.split(/\s+/)[0] === q || (q.length >= 3 && l.includes(q));
  });
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) throw new Error(`"${q.slice(0, 40)}" matches more than one person on your team (${hits.map((h) => h.label).join(', ')}). Which one?`);
  throw new Error(`"${q.slice(0, 40)}" is not on your team, so their figures are not available to you. You can ask about: ${teamNames(principal)}.`);
}

