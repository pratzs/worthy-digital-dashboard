/**
 * Department access. One shared password per department; the cookie carries the
 * department and an HMAC of it, so it cannot be edited to claim another one.
 * Edge-safe (Web Crypto only) because the middleware uses it too.
 */
export const SECTIONS = [
  { id: 'overview',  path: '/',          label: 'Overview and Sales' },
  { id: 'reps',      path: '/reps',      label: 'Sales by Rep' },
  { id: 'products',  path: '/products',  label: 'Categories & Products' },
  { id: 'movers',    path: '/movers',    label: 'Fast & Slow Movers' },
  { id: 'customers', path: '/customers', label: 'Customers' },
  { id: 'credits',   path: '/credits',   label: 'Credit Notes' },
  { id: 'debtors',   path: '/debtors',   label: 'Debtors' },
  { id: 'chat',      path: '/chat',      label: 'Ask a Question' },
];

export const ROLES = {
  mgmt:  { label: 'Management', env: 'DASHBOARD_PASSWORD',
           sections: SECTIONS.map((s) => s.id), api: ['/api/'] },
  bdm:   { label: 'Business Development & Marketing', env: 'DASHBOARD_PASSWORD_BDM',
           sections: ['overview', 'reps', 'products', 'customers'],
           api: ['/api/odoo', '/api/odoo/fy', '/api/odoo/advanced', '/api/odoo/kpi', '/api/odoo/weeks',
                 '/api/ostendo/fy', '/api/ostendo/advanced', '/api/shopify', '/api/shopify/advanced', '/api/auth/'] },
  purch: { label: 'Purchasing & Stock', env: 'DASHBOARD_PASSWORD_PURCHASING',
           sections: ['products', 'movers'],
           api: ['/api/odoo', '/api/odoo/fy', '/api/odoo/advanced', '/api/ostendo/fy',
                 '/api/ostendo/advanced', '/api/stock-value', '/api/auth/'] },
};

const enc = new TextEncoder();
const secret = () => process.env.AUTH_SECRET || process.env.DASHBOARD_PASSWORD || 'Worthy-Insights-2026';

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
async function mac(role) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret()),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(`worthy:${role}`)));
}

export const signRole = async (role) => `${role}.${await mac(role)}`;

/** Returns the role named by a cookie value, or null if missing or tampered with. */
export async function verifyRole(value) {
  const [role, sig] = String(value || '').split('.');
  if (!ROLES[role] || !sig) return null;
  const good = await mac(role);
  if (sig.length !== good.length) return null;
  let bad = 0;
  for (let i = 0; i < good.length; i++) bad |= sig.charCodeAt(i) ^ good.charCodeAt(i);
  return bad === 0 ? role : null;
}

export const sectionPath = (id) => SECTIONS.find((s) => s.id === id)?.path || '/';
export const homeFor = (role) => sectionPath(ROLES[role].sections[0]);

export function apiAllowed(role, pathname) {
  // An entry ending in '/' is a prefix; any other entry matches that path only.
  return ROLES[role].api.some((p) => (p.endsWith('/') ? pathname.startsWith(p) : pathname === p));
}
export function pageAllowed(role, pathname) {
  const s = SECTIONS.find((x) => x.path === pathname);
  return !s || ROLES[role].sections.includes(s.id);
}
