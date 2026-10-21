/**
 * Generic, read-only access to Odoo for the chat/MCP tools - ad-hoc questions
 * that don't fit one of the purpose-built reports (readFY, readDebtors, ...).
 *
 * Deliberately a DENYLIST, not an allowlist: questions are genuinely
 * unpredictable ("full platform read access... works like real chat with API
 * connected" was the explicit ask), so a fixed list of ~18 "safe" models kept
 * refusing legitimate questions nobody anticipated. What's still blocked,
 * and why, is specific rather than "everything we didn't think of":
 *   - account.* - the standing rule on this client's Odoo is no Accounting-
 *     module access, independent of what else opens up.
 *   - ir.*, base.*, res.config.*, res.groups, res.company, mail.*, bus.* -
 *     Odoo's own system/technical config and internal messaging, not
 *     business data a director would ask about.
 *   - anything whose model name itself suggests credentials (auth, oauth,
 *     apikey, token, session) - defense in depth alongside the field-level
 *     redaction below.
 * No model can ever be written to regardless: only 'read', 'read_group' and
 * 'search_read' are called anywhere in this file - there is no write/create/
 * unlink path to even misuse.
 */
import { cachedAuth } from '@/lib/odooAuth';

const ODOO = {
  url: process.env.ODOO_URL, db: process.env.ODOO_DB,
  user: process.env.ODOO_USER, pw: process.env.ODOO_PASSWORD,
};

async function rpc(payload, timeoutMs = 45000) {
  const res = await fetch(`${ODOO.url}/jsonrpc`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload), signal: AbortSignal.timeout(timeoutMs),
  });
  return res.json();
}

async function connect() {
  const j = await cachedAuth(() => rpc({ jsonrpc: '2.0', method: 'call', id: 1,
    params: { service: 'common', method: 'authenticate', args: [ODOO.db, ODOO.user, ODOO.pw, {}] } }, 15000),
    ODOO.url, ODOO.db, ODOO.user);
  if (!j.result) throw new Error('Odoo authentication failed');
  const uid = j.result;
  return async (model, method, args, kwargs = {}, timeout = 45000) => {
    const r = await rpc({ jsonrpc: '2.0', method: 'call', id: 2,
      params: { service: 'object', method: 'execute_kw',
                args: [ODOO.db, uid, ODOO.pw, model, method, args, kwargs] } }, timeout);
    if (r.error) throw new Error(r.error.data?.message || r.error.message || `${model}.${method} failed`);
    return r.result;
  };
}

// Blocked by prefix or exact name. res.users stays OPEN (needed to resolve a
// salesperson's name) even though other res.* admin models are blocked.
const DENIED_PREFIXES = ['account.', 'ir.', 'base.', 'res.config', 'mail.', 'bus.', 'auth.', 'oauth.'];
const DENIED_EXACT = new Set(['res.groups', 'res.company', 'res.users.log', 'res.users.settings']);
const DENIED_NAME_HINTS = ['token', 'apikey', 'api_key', 'session', 'password'];

// A starting point for odoo_list_models - common business models, not an
// exhaustive or restrictive list. Anything not denied above is still usable
// via odoo_search/odoo_describe_model/odoo_count/odoo_aggregate even if it
// isn't named here.
const COMMON_MODELS = {
  'purchase.order': 'Purchase orders raised with suppliers',
  'purchase.order.line': 'Purchase order lines (product, quantity, price)',
  'product.product': 'Product variants (stock on hand, cost, sale price)',
  'product.template': 'Product templates (the product itself, not a specific variant)',
  'product.supplierinfo': "A supplier's price and minimum quantity for a product",
  'res.partner': 'Customers, suppliers and other contacts',
  'sale.order': 'Sales orders',
  'sale.order.line': 'Sales order lines (product, quantity, price)',
  'stock.quant': 'Stock on hand by location',
  'stock.move': 'Stock movements (receipts, deliveries, transfers)',
  'stock.move.line': 'Stock movement detail lines',
  'uom.uom': 'Units of measure and their conversion factors (e.g. Case of 24 vs Each)',
  'product.category': 'Product categories',
  'product.tag': 'Product tags',
  'res.partner.category': 'Contact/customer tags',
  'res.users': "Salespeople and other users' names (no login credentials - those fields are always stripped)",
  'crm.lead': 'CRM leads/opportunities, if the Worthy database uses this module',
  'project.task': 'Project tasks, if the Worthy database uses this module',
};

// Fields never returned, whatever is asked for.
const ALWAYS_REDACTED = new Set([
  'password', 'password_crypt', 'new_password', 'api_key', 'access_token',
  'refresh_token', 'secret', 'private_key', 'signature', 'totp_secret',
  'oauth_access_token', 'webhook_secret', 'bank_account_id', 'bank_ids',
]);

const MAX_ROWS = 500;

function assertNotDenied(model) {
  const m = String(model || '');
  if (!m) throw new Error('No model given.');
  if (DENIED_EXACT.has(m) || DENIED_PREFIXES.some((p) => m.startsWith(p))
    || DENIED_NAME_HINTS.some((h) => m.toLowerCase().includes(h))) {
    throw new Error(`'${model}' is not reachable - it's in a protected area (Accounting module or Odoo system `
      + `config). Business/operational models (sales, purchasing, products, stock, contacts) are open.`);
  }
}

function strip(rows) {
  return rows.map((row) => {
    const out = {};
    for (const [k, v] of Object.entries(row)) {
      if (!ALWAYS_REDACTED.has(k) && k !== '__last_update') out[k] = v;
    }
    return out;
  });
}

export async function odooListModels() {
  return Object.entries(COMMON_MODELS).map(([model, description]) => ({ model, description }));
}

export async function odooDescribeModel({ model }) {
  assertNotDenied(model);
  const exec = await connect();
  const fields = await exec(model, 'fields_get', [], { attributes: ['string', 'type', 'relation'] }, 30000);
  return Object.entries(fields)
    .filter(([name]) => !ALWAYS_REDACTED.has(name) && name !== '__last_update')
    .map(([name, meta]) => ({ name, type: meta.type, label: meta.string, relation: meta.relation || null }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function odooSearch({ model, domain, fields, limit, order }) {
  assertNotDenied(model);
  const exec = await connect();
  const cappedLimit = Math.min(Number(limit) || 100, MAX_ROWS);
  const requestedFields = (fields || []).filter((f) => !ALWAYS_REDACTED.has(f));
  const rows = await exec(model, 'search_read', [domain || []],
    { fields: requestedFields.length ? requestedFields : undefined, limit: cappedLimit, order: order || undefined },
    45000);
  const stripped = strip(rows);
  // Never let a capped result look complete: if exactly the cap came back,
  // there may be more - summing these rows for a total would silently
  // under-report. odoo_aggregate (read_group) is the correct tool for a sum.
  if (stripped.length === cappedLimit) {
    return {
      rows: stripped,
      truncated: true,
      note: `Capped at ${cappedLimit} rows - there may be more matching records. `
        + `Do not sum these rows for a total; use odoo_aggregate (read_group) instead, `
        + `which computes the real total inside Odoo regardless of row count.`,
    };
  }
  return { rows: stripped, truncated: false };
}

export async function odooCount({ model, domain }) {
  assertNotDenied(model);
  const exec = await connect();
  const count = await exec(model, 'search_count', [domain || []], {}, 30000);
  return { count };
}

/** Odoo computes the sum/avg/count/min/max INSIDE Odoo via read_group, so the
 * answer is exact regardless of how many records match - unlike odoo_search,
 * which is capped at 500 rows and will silently under-report a total summed
 * from a truncated row list. Always prefer this for "how many / what's the
 * total" questions; only use odoo_search when the actual rows are needed. */
export async function odooAggregate({ model, domain, fields, groupby }) {
  assertNotDenied(model);
  const exec = await connect();
  const aggFields = (fields || []).filter((f) => {
    const name = f.split(':')[0];
    return !ALWAYS_REDACTED.has(name);
  });
  if (aggFields.length === 0) throw new Error("fields must include at least one 'field:agg' entry, e.g. 'product_qty:sum'.");
  const rows = await exec(model, 'read_group', [domain || [], aggFields, groupby || []], {}, 45000);
  return rows.map((row) => {
    const out = {};
    for (const [k, v] of Object.entries(row)) {
      if (k === '__domain' || k === '__range') continue;
      if (!ALWAYS_REDACTED.has(k.split(':')[0])) out[k] = v;
    }
    return out;
  });
}
