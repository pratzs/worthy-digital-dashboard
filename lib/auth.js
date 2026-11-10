/**
 * Department access. A named person (lib/people.js) signs in with their work email and their department's password;
 * the cookie carries the department, the person and an HMAC of both, so it cannot be edited to claim another one.
 * A cookie for someone no longer listed in that department stops working. Cookies from before named people existed
 * (department only) are no longer accepted: that person signs in again with their email.
 * Edge-safe (Web Crypto only) because the middleware uses it too.
 */
import { personFor } from './people.js';

export const SECTIONS = [
  { id: 'overview',  path: '/',          label: 'Overview and Sales' },
  { id: 'reps',      path: '/reps',      label: 'Sales by Rep' },
  { id: 'products',  path: '/products',  label: 'Categories & Products' },
  { id: 'movers',    path: '/movers',    label: 'Fast & Slow Movers' },
  { id: 'customers', path: '/customers', label: 'Customers' },
  { id: 'credits',   path: '/credits',   label: 'Credit Notes' },
  { id: 'debtors',   path: '/debtors',   label: 'Debtors' },
  { id: 'chat',      path: '/chat',      label: 'Ask a Question' },
  { id: 'repusage',  path: '/rep-usage', label: 'Rep assistant usage' },   // management only: it is not in the other roles' lists below
];

export const ROLES = {
  mgmt:  { label: 'Management', env: 'DASHBOARD_PASSWORD',
           sections: SECTIONS.map((s) => s.id), api: ['/api/'] },
  bdm:   { label: 'Business Development & Marketing', env: 'DASHBOARD_PASSWORD_BDM',
           sections: ['overview', 'reps', 'products', 'customers'],
           api: ['/api/odoo', '/api/odoo/fy', '/api/odoo/advanced', '/api/odoo/kpi', '/api/odoo/weeks',
                 '/api/ostendo/fy', '/api/ostendo/advanced', '/api/shopify', '/api/shopify/advanced', '/api/auth/'] },
  purch: { label: 'Purchasing & Stock', env: 'DASHBOARD_PASSWORD_PURCHASING',
           sections: ['products', 'movers', 'chat'],   // chat here is the Purchasing chat: only Purchasing's tools and data (app/api/chat)
           api: ['/api/odoo', '/api/odoo/fy', '/api/odoo/advanced', '/api/ostendo/fy',
                 '/api/ostendo/advanced', '/api/stock-value', '/api/auth/', '/api/chat'] },
};

const enc = new TextEncoder();
// No built-in fallback: if neither is set nothing can be signed or verified (fail closed).
const secret = () => {
  const s = process.env.AUTH_SECRET || process.env.DASHBOARD_PASSWORD;
  if (!s) throw new Error('No signing secret is configured');
  return s;
};

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
async function mac(role, person) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret()),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(`worthy:${role}:${person}`)));
}

/** The sign-in cookie for a named person in a department: role.person.hmac */
export const signSession = async (role, person) => `${role}.${person}.${await mac(role, person)}`;

/** Returns { role, person } for a cookie value, or null if missing, tampered with, or the person is no longer listed in that department. */
export async function verifySession(value) {
  const [role, person, sig] = String(value || '').split('.');
  if (!Object.prototype.hasOwnProperty.call(ROLES, role) || !person || !sig || !/^[a-z0-9]{1,24}$/.test(person)) return null;
  const good = await mac(role, person);
  if (sig.length !== good.length) return null;
  let bad = 0;
  for (let i = 0; i < good.length; i++) bad |= sig.charCodeAt(i) ^ good.charCodeAt(i);
  if (bad !== 0) return null;
  return personFor(person, role, 'dashboard') ? { role, person } : null;
}

/** The department named by a cookie value, or null. */
export const verifyRole = async (value) => (await verifySession(value))?.role || null;

export const sectionPath = (id) => SECTIONS.find((s) => s.id === id)?.path || '/';
export const homeFor = (role) => sectionPath(ROLES[role].sections[0]);

export function apiAllowed(role, pathname) {
  // An entry ending in '/' is a prefix; any other entry matches that path only.
  return ROLES[role].api.some((p) => (p.endsWith('/') ? pathname.startsWith(p) : pathname === p));
}
export function pageAllowed(role, pathname) {
  // A section's path also covers its own sub-routes (e.g. /chat/connector
  // under the 'chat' section), not just an exact match - otherwise a page
  // added under a gated section is reachable by anyone until someone
  // remembers to list it separately.
  const s = SECTIONS.find((x) => pathname === x.path || (x.path !== '/' && pathname.startsWith(`${x.path}/`)));
  return !s || ROLES[role].sections.includes(s.id);
}
