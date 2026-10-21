/**
 * The read-only data tools shared by the management chat (app/api/chat) and the
 * OAuth-protected MCP connector (app/api/mcp) for Claude/ChatGPT's own custom
 * connectors.
 *
 * Two tiers:
 *  - The four get_* tools wrap the SAME readFY/readDebtors/Ostendo functions the
 *    rest of the dashboard already uses, so a number asked for here matches the
 *    number on the dashboard page exactly.
 *  - odoo_* / ostendo_query are generic, allowlisted, read-only access (see
 *    lib/odooQuery.js and lib/ostendoQuery.js) for everything that ISN'T one of
 *    those pre-built reports - unit of measure, salesperson, tags, purchasing,
 *    or any other combination. Still never a write: those modules expose no
 *    write/create/unlink path at all, and Ostendo's raw SQL is restricted to a
 *    single SELECT statement.
 */
import { readFY } from '@/lib/odooFyCache';
import { readDebtors } from '@/lib/odooDebtorsCache';
import { handle as ostendoFyHandle } from '@/lib/ostendoFy';
import { computeSouthDebtors } from '@/lib/ostendoDebtors';
import { nzFinancialYear } from '@/lib/ostendo';
import { odooListModels, odooDescribeModel, odooSearch, odooCount, odooAggregate } from '@/lib/odooQuery';
import { ostendoQuery } from '@/lib/ostendoQuery';

// North = Worthy Products North (Odoo company 4). Oceania = Worthy Oceania (Odoo
// company 1). South = Worthy Products South, which lives in Ostendo, not Odoo.
const ODOO_COMPANY = { north: 4, oceania: 1 };

export const DATA_TOOLS = [
  {
    name: 'get_financial_year',
    description: "A company's financial year: monthly revenue, cost, gross profit, margin %, "
      + "invoice/order counts, and the sales-rep breakdown. Covers north and oceania (both in Odoo). "
      + "For south use get_south_financial_year instead - it is a different system (Ostendo), not Odoo.",
    input_schema: {
      type: 'object',
      properties: {
        company: { type: 'string', enum: ['north', 'oceania'] },
        fy: { type: 'integer', description: 'Financial year starting year, e.g. 2026 for FY26 (1 Apr 2026 - 31 Mar 2027). Defaults to the current FY.' },
      },
      required: ['company'],
    },
  },
  {
    name: 'get_south_financial_year',
    description: 'Worthy Products South\'s financial year figures, from Ostendo (not Odoo): monthly '
      + 'revenue, cost, margin, and rep breakdown.',
    input_schema: {
      type: 'object',
      properties: {
        fy: { type: 'integer', description: 'Financial year starting year, e.g. 2026 for FY26. Defaults to the current FY.' },
      },
    },
  },
  {
    name: 'get_debtors',
    description: 'Outstanding customer debtors and overdue invoices for north or oceania (Odoo), with '
      + 'ageing buckets (current, 1-30, 31-60, 61-90, over 90 days) and a per-customer breakdown.',
    input_schema: {
      type: 'object',
      properties: { company: { type: 'string', enum: ['north', 'oceania'] } },
      required: ['company'],
    },
  },
  {
    name: 'get_south_debtors',
    description: 'Outstanding customer debtors for Worthy Products South, from Ostendo (not Odoo).',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'odoo_list_models',
    description: 'For north or oceania (Odoo) ONLY - south is a different system, use ostendo_query instead. '
      + 'Lists every Odoo model odoo_search/odoo_describe_model/odoo_count are allowed to read: purchase orders, '
      + 'products, suppliers, sales orders, invoices, stock, units of measure, tags, salespeople. Call this first '
      + 'for any question the four get_* tools above don\'t cover - e.g. purchasing, a specific product, a '
      + 'salesperson, a customer/product tag, or a unit-of-measure conversion.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'odoo_describe_model',
    description: 'Lists the fields of one allowed Odoo model, with their types, so odoo_search can be called '
      + 'with the right field and domain names. Call odoo_list_models first if you don\'t already know which '
      + 'model to describe.',
    input_schema: {
      type: 'object',
      properties: { model: { type: 'string' } },
      required: ['model'],
    },
  },
  {
    name: 'odoo_search',
    description: 'Search records of an allowed Odoo model and return the requested fields, using standard Odoo '
      + 'domain syntax, e.g. [["company_id","=",4],["product_id.name","ilike","Dragon"]]. Company 4 = north, '
      + 'company 1 = oceania - almost every allowed model has a company_id and it should normally be filtered. '
      + 'Capped at 500 rows regardless of what limit is asked for.',
    input_schema: {
      type: 'object',
      properties: {
        model: { type: 'string' },
        domain: { type: 'array', description: 'Odoo domain, e.g. [["state","=","purchase"]]' },
        fields: { type: 'array', items: { type: 'string' } },
        limit: { type: 'integer' },
        order: { type: 'string' },
      },
      required: ['model'],
    },
  },
  {
    name: 'odoo_count',
    description: 'Counts records of an allowed Odoo model matching a domain, without returning them.',
    input_schema: {
      type: 'object',
      properties: {
        model: { type: 'string' },
        domain: { type: 'array' },
      },
      required: ['model'],
    },
  },
  {
    name: 'odoo_aggregate',
    description: 'For a SUM, average, count or min/max over a number of matching Odoo records - e.g. "how many '
      + 'units total", "total value" - use this, NOT odoo_search. odoo_search is capped at 500 rows, so summing '
      + 'its rows yourself under-reports whenever more than 500 records match; this computes the real total '
      + 'inside Odoo (read_group), correct regardless of how many rows match. fields is a list of '
      + '"field:aggregation" entries, e.g. ["product_qty:sum"] or ["id:count"]. groupby is optional - omit it '
      + 'for one overall total, or e.g. ["product_id"] to get a total per product.',
    input_schema: {
      type: 'object',
      properties: {
        model: { type: 'string' },
        domain: { type: 'array' },
        fields: { type: 'array', items: { type: 'string' }, description: 'e.g. ["product_qty:sum"]' },
        groupby: { type: 'array', items: { type: 'string' } },
      },
      required: ['model', 'fields'],
    },
  },
  {
    name: 'ostendo_query',
    description: 'For Worthy Products SOUTH only - a direct, read-only SQL SELECT against Ostendo (Firebird '
      + 'syntax, e.g. SELECT FIRST 10 instead of LIMIT 10). Use this for anything about south that '
      + 'get_south_financial_year/get_south_debtors don\'t cover - a specific product, purchasing, units of '
      + 'measure, a salesperson. Only a single SELECT statement is accepted; anything else is refused. Capped '
      + 'at 500 rows regardless of what the query asks for. You do not know Ostendo\'s table names in advance - '
      + 'say what you need and let the person confirm the right table if the first attempt errors.',
    input_schema: {
      type: 'object',
      properties: { sql: { type: 'string' } },
      required: ['sql'],
    },
  },
];

export async function runDataTool(name, input) {
  if (name === 'get_financial_year') {
    const cid = ODOO_COMPANY[input.company];
    if (!cid) throw new Error(`Unknown company '${input.company}'. Use north or oceania.`);
    const { payload } = await readFY(cid, input.fy || nzFinancialYear());
    return payload;
  }
  if (name === 'get_south_financial_year') {
    const req = new Request(`http://internal/south-fy?fy=${input.fy || nzFinancialYear()}`);
    const res = await ostendoFyHandle(req);
    return res.json();
  }
  if (name === 'get_debtors') {
    const cid = ODOO_COMPANY[input.company];
    if (!cid) throw new Error(`Unknown company '${input.company}'. Use north or oceania.`);
    return readDebtors(cid);
  }
  if (name === 'get_south_debtors') {
    return computeSouthDebtors();
  }
  if (name === 'odoo_list_models') return odooListModels();
  if (name === 'odoo_describe_model') return odooDescribeModel(input || {});
  if (name === 'odoo_search') return odooSearch(input || {});
  if (name === 'odoo_count') return odooCount(input || {});
  if (name === 'odoo_aggregate') return odooAggregate(input || {});
  if (name === 'ostendo_query') return ostendoQuery(input || {});
  throw new Error(`Unknown tool '${name}'`);
}
