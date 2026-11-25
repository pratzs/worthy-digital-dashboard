/**
 * Department scoping for the management connector (app/api/mcp). The person picks their department when they connect and
 * enters that department's dashboard password; the access token then carries the department, and every call is checked against it.
 *
 *   mgmt  all tools, as before (including raw Odoo/Ostendo queries, debtors, expenses, cost gaps)
 *   bdm   sales and product reports as the Business Development & Marketing dashboard shows them (Sales by Rep, customers), no raw queries
 *   purch product, category, movers and company totals for Purchasing & Stock: no rep, weekly or customer data (lib/roleData.js)
 *
 * Tokens issued before departments existed carry no department and are management, as they always were.
 * Anything unknown is refused.
 */
import { DATA_TOOLS, runDataTool } from '@/lib/mcpTools';
import { readFY } from '@/lib/odooFyCache';
import { readSouth } from '@/lib/ostendoCache';
import { nzFinancialYear } from '@/lib/ostendo';
import { filterForRole } from '@/lib/roleData';
import { figuresAsOf } from '@/lib/salesTool';

export const ROLE_LABEL = { mgmt: 'Management', bdm: 'Business Development & Marketing', purch: 'Purchasing & Stock' };
const DEPT_TOOLS = new Set(['get_financial_year', 'get_south_financial_year', 'get_product_analytics', 'search', 'fetch']);
const ann = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };

const ANALYTICS_TOOL = {
  name: 'get_product_analytics',
  description: 'Products, categories, fast movers and slow movers for a company and financial year (revenue, units, cost and margin by product and category, what is selling fast and what is sitting). '
    + 'company is north (Worthy Products North, Odoo), oceania (Worthy Oceania, Odoo) or south (Worthy Products South / Dutch Rusk, Ostendo). '
    + 'Use it for "what are the fast movers", "which products are slow", "top categories". Rep and weekly figures are never included; customer lists only for departments that may see them.',
  inputSchema: { type: 'object', properties: { company: { type: 'string', enum: ['north', 'oceania', 'south'] }, fy: { type: 'integer', description: 'Financial year, e.g. 2026 for FY26. Defaults to the current one.' } }, required: ['company'] },
  annotations: ann,
};

const ALL_TOOLS = [...DATA_TOOLS.map(({ input_schema, ...tool }) => ({ ...tool, inputSchema: input_schema })), ANALYTICS_TOOL];

/** The tools this department is offered. */
export const toolListFor = (role) => (role === 'mgmt' ? ALL_TOOLS : ALL_TOOLS.filter((t) => DEPT_TOOLS.has(t.name)));

/** Year figures can come from the saved copy when Odoo is busy (lib/odooFyCache.js); the answer must then say when Odoo was read. */
export const SAVED_COPY_RULE = 'SAVED COPY: when a tool result has fromSavedCopy, Odoo was busy and the figures are the last saved copy; say the time they were read (figuresAsOf). ';

export const NAME_AND_BASIS_RULES = 'NAMES, ALWAYS: "Worthy Products", "Worthy Products North", "North", "WP" or "Odoo" on their own mean Odoo company 4 (company: north). "Dutch Rusk", "Worthy Products South", "South", "DR" or "Ostendo" mean Dutch Rusk in Ostendo (the south tools). "Worthy Oceania", "Oceania" or "fabric" mean Odoo company 1 (company: oceania). Never mix them up and never add them together without saying so. SALES AND MARGIN: for any sales, revenue or margin question about a period, call get_sales_summary first; it returns exactly what the dashboard and the Sunday email show. Worthy Products figures never include sales to Dutch Rusk or Worthy Oceania (transfers between our own companies, shown separately). Sales are posted invoices less credit notes, before GST; do not answer sales from sales orders unless the person asks about orders. ' + SAVED_COPY_RULE;

export const instructionsFor = (role) => (role === 'mgmt' ? NAME_AND_BASIS_RULES
  : `You are connected as the ${ROLE_LABEL[role] || 'restricted'} department. This connector gives that department's reports for Worthy Products North (Odoo), Worthy Oceania (Odoo) and Worthy Products South / Dutch Rusk (Ostendo). `
    + (role === 'purch'
      ? 'Purchasing can see products, categories, fast and slow movers and company totals by month. Sales by rep, weekly figures and customer information are not available to this department; if asked, say so.'
      : 'This department sees sales and product reports including Sales by Rep and customers. Raw system queries, debtors, credit notes and expenses are not available to this department.')
    + ' Say which system a figure came from. ' + SAVED_COPY_RULE);

const PRODUCT_ID = /^(odoo:product:|ostendo:item:)/;
const allowedId = (role, id) => PRODUCT_ID.test(id) || (role === 'purch' ? /^ostendo:supplier:/.test(id) : /^odoo:partner:/.test(id));

async function productAnalytics(role, input) {
  const company = String(input?.company || 'north').toLowerCase();
  const fyN = Number(input?.fy);
  const fy = Number.isInteger(fyN) && fyN >= 2020 && fyN <= 2100 ? fyN : nzFinancialYear();
  if (company === 'south') return filterForRole(role, 'advanced', await readSouth('advanced', `?fy=${fy}`));
  const cid = company === 'north' ? 4 : company === 'oceania' ? 1 : null;
  if (!cid) throw new Error("company must be 'north', 'oceania' or 'south'.");
  const { payload } = await readFY(cid, fy);
  const picked = { ...figuresAsOf(payload) };   // when Odoo was read, and whether it is the saved copy
  for (const k of ['fy', 'company', 'products', 'categories', 'fastMoving', 'slowMoving', 'excludedProducts', 'nonStockExcluded', 'costBasis', 'hasCost', 'customers', 'clv', 'churned', 'atRisk']) if (k in payload) picked[k] = payload[k];
  return filterForRole(role, 'fy', picked);
}

/** Runs a tool for a department. Throws a plain message for anything it may not do. */
export async function runForRole(role, name, input) {
  if (role === 'mgmt') return name === 'get_product_analytics' ? productAnalytics(role, input || {}) : runDataTool(name, input || {});
  if (!['bdm', 'purch'].includes(role) || !DEPT_TOOLS.has(name)) throw new Error('That tool is not available to your department.');
  if (name === 'get_product_analytics') return productAnalytics(role, input || {});
  if (name === 'search') {
    const r = await runDataTool('search', input || {});
    return { results: (r.results || []).filter((x) => allowedId(role, String(x.id))) };
  }
  if (name === 'fetch') {
    const id = String(input?.id || '');
    if (!allowedId(role, id)) throw new Error('That record is not available to your department.');
    const r = await runDataTool('fetch', input || {});
    if (/^odoo:partner:/.test(id)) { try { const o = JSON.parse(r.text); delete o.user_id; return { ...r, text: JSON.stringify(o, null, 2) }; } catch { return { ...r, text: '' }; } }
    return r;
  }
  // get_financial_year / get_south_financial_year
  return filterForRole(role, 'fy', await runDataTool(name, input || {}));
}
