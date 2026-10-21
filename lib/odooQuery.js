/**
 * Generic, read-only, allowlisted access to Odoo for the chat/MCP tools -
 * ad-hoc questions that don't fit one of the purpose-built reports (readFY,
 * readDebtors, ...). Same philosophy as the Odoo-side MCP server reviewed
 * earlier: nothing is reachable until it's explicitly allowed here, no model
 * can ever be written to (only 'read', 'read_group' and 'search_read' are
 * exposed - there is no write/create/unlink path in this file at all, so
 * there's nothing to accidentally call), and a few field names are always
 * stripped regardless of what's asked for.
 *
 * Deliberately excludes deep accounting/config models (chart of accounts,
 * journals, payments, taxes, company and user admin) even though they're
 * technically reachable with these credentials - per the standing rule on
 * this client's Odoo that nothing here gets Accounting-module access.
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

// The allowlist. Business/operational data only - sales, purchasing,
// products, stock, contacts - never accounting internals or Odoo admin.
const ALLOWED_MODELS = {
  'purchase.order': 'Purchase orders raised with suppliers',
  'purchase.order.line': 'Purchase order lines (product, quantity, price)',
  'product.product': 'Product variants (stock on hand, cost, sale price)',
  'product.template': 'Product templates (the product itself, not a specific variant)',
  'product.supplierinfo': "A supplier's price and minimum quantity for a product",
  'res.partner': 'Customers, suppliers and other contacts',
  'sale.order': 'Sales orders',
  'sale.order.line': 'Sales order lines (product, quantity, price)',
  'account.move': 'Invoices, bills and credit notes',
  'account.move.line': 'Invoice/bill lines',
  'stock.quant': 'Stock on hand by location',
  'stock.move': 'Stock movements (receipts, deliveries, transfers)',
  'stock.move.line': 'Stock movement detail lines',
  'uom.uom': 'Units of measure and their conversion factors (e.g. Case of 24 vs Each)',
  'product.category': 'Product categories',
  'product.tag': 'Product tags',
  'res.partner.category': 'Contact/customer tags',
  'res.users': "Salespeople and other users' names (no login credentials - those fields are always stripped)",
};

// Fields never returned, whatever is asked for - matches the same list used
// by the Odoo-side MCP server, for the same reason.
const ALWAYS_REDACTED = new Set([
  'password', 'password_crypt', 'new_password', 'api_key', 'access_token',
  'refresh_token', 'secret', 'private_key', 'signature', 'totp_secret',
  'oauth_access_token', 'webhook_secret', 'bank_account_id', 'bank_ids',
]);

const MAX_ROWS = 500;

function assertAllowed(model) {
  if (!ALLOWED_MODELS[model]) {
    throw new Error(`'${model}' is not on the allowlist. Allowed models: ${Object.keys(ALLOWED_MODELS).join(', ')}.`);
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
  return Object.entries(ALLOWED_MODELS).map(([model, description]) => ({ model, description }));
}

export async function odooDescribeModel({ model }) {
  assertAllowed(model);
  const exec = await connect();
  const fields = await exec(model, 'fields_get', [], { attributes: ['string', 'type', 'relation'] }, 30000);
  return Object.entries(fields)
    .filter(([name]) => !ALWAYS_REDACTED.has(name) && name !== '__last_update')
    .map(([name, meta]) => ({ name, type: meta.type, label: meta.string, relation: meta.relation || null }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function odooSearch({ model, domain, fields, limit, order }) {
  assertAllowed(model);
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
  assertAllowed(model);
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
  assertAllowed(model);
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
