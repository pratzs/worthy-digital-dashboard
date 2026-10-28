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
export function repForCode(code) {
  const c = String(code || '').trim();
  if (c.length < 20) return null;
  const t = table();
  let found = null;
  for (const rep of REPS) {
    const e = t[rep.key];
    if (!e || !e.salt || !e.hash) continue;
    if (sameHex(hashCode(c, e.salt), e.hash) && !found) found = { rep, ver: Number(e.ver) || 1 };
  }
  return found;
}

/** The version a rep's tokens must carry right now (0 = switched off or unknown). */
export function currentVer(key) {
  const e = table()[key];
  return e && e.salt && e.hash ? (Number(e.ver) || 1) : 0;
}
