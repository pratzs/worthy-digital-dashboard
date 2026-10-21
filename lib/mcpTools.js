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
      + 'Lists common business models (purchase orders, products, suppliers, sales orders, stock, units of '
      + 'measure, tags, salespeople) as a starting point - NOT the full set of what\'s reachable. Any Odoo model '
      + 'can be used with odoo_describe_model/odoo_search/odoo_count/odoo_aggregate even if it isn\'t listed '
      + 'here; only Accounting-module internals and Odoo\'s own system/config models are blocked, and you\'ll '
      + 'get a clear error naming exactly that if you hit one. Call this first for any question the four get_* '
      + 'tools above don\'t cover.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'odoo_describe_model',
    description: 'Lists the fields of one Odoo model, with their types, so odoo_search can be called with the '
      + 'right field and domain names. Call odoo_list_models first if you don\'t already know which model to '
      + 'describe, or just try the model name you\'d expect - most business models are reachable even if '
      + 'odoo_list_models didn\'t name them.',
    input_schema: {
      type: 'object',
      properties: { model: { type: 'string' } },
      required: ['model'],
    },
  },
  {
    name: 'odoo_search',
    description: 'Search records of an Odoo model and return the requested fields, using standard Odoo domain '
      + 'syntax, e.g. [["company_id","=",4],["product_id.name","ilike","Dragon"]]. Company 4 = north, company 1 '
      + '= oceania - almost every model has a company_id and it should normally be filtered. Capped at 500 rows '
      + 'regardless of what limit is asked for - the result tells you if it was truncated. Any relation field '
      + '(many2one - product_id, partner_id, currency_id, user_id, etc) comes back as a [id, "Display Name"] '
      + 'pair, not a plain value - when showing it to the person or putting it in a table cell, use the '
      + 'display name (the second item), never the raw pair, and never pass an array into present_table - '
      + 'that tool only accepts strings, numbers and null.',
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
    description: 'Counts records of an Odoo model matching a domain, without returning them.',
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
      + 'for one overall total, or e.g. ["product_id"] to get a total per product. A GROUPED result is '
      + 'capped at 500 groups (a per-customer or per-product breakdown can genuinely have that many rows) - '
      + 'the result tells you if it was truncated; narrow the domain (date range, company) rather than '
      + 'presenting a capped list as complete. When no records match the domain at all, a sum/count comes '
      + 'back as 0 or an empty list, not an error - that is a real answer ("none found"), not a failure to '
      + 'retry.',
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
      + 'syntax: SELECT FIRST 10 instead of LIMIT 10 or TOP 10; no system catalog access, so don\'t try '
      + 'RDB$RELATIONS - it is blocked). Only a single SELECT statement is accepted; anything else is refused. '
      + 'When joining tables, always give each selected column an explicit alias if the same column name '
      + 'could come from more than one table (e.g. two tables both have a DESCRIPTION column) - a plain '
      + 'SELECT * across a join with duplicate column names silently loses one of them in the result, since '
      + 'results come back as one object per row keyed by column name.\n\n'
      + 'Rows capped at 500, EXCEPT a query that computes its own SUM/COUNT/AVG returns that one computed row '
      + 'uncapped - for ANY "how many / total" question, write SUM()/COUNT() directly in the SQL yourself '
      + 'rather than fetching rows and adding them up, for exactly the reason odoo_aggregate exists on the '
      + 'Odoo side: summing possibly-truncated rows under-reports silently.\n\n'
      + 'Known real tables (found live, not guessed - trust these over guessing a name):\n'
      + '  ITEMMASTER: ITEMCODE, ITEMDESCRIPTION, ITEMCATEGORY, ONHANDQTY, STDBUYPRICE, AVERAGECOST\n'
      + '  SUPPLIERMASTER: SUPPLIER (the name/key, not an id), SUPPLIERSTATUS, SUPPLIERTYPE\n'
      + '  PURCHASEHEADER: ORDERNUMBER, SUPPLIER, ORDERDATE, ORDERSTATUS, ORIGINALTOTALAMOUNT\n'
      + '  PURCHASELINES: ORDERNUMBER (join to PURCHASEHEADER), LINEDESCRIPTION, LINECODE, ORDERQTY, '
      + 'LINEUNIT, ORDERUNITPRICE - "Dragon 2kg bags purchased" means JOIN PURCHASELINES to PURCHASEHEADER '
      + 'on ORDERNUMBER, filter PURCHASEHEADER.SUPPLIER for the supplier\'s name (check SUPPLIERMASTER first '
      + 'if unsure of the exact string), filter PURCHASELINES.LINEDESCRIPTION for the product, SUM(ORDERQTY). '
      + 'IMPORTANT - check LINEUNIT before summing: ORDERQTY is counted in whatever unit that line used, '
      + 'and it is NOT consistent even within the same product - some lines order in "Bag", others in '
      + '"Shipper" (a carton of several bags). A raw SUM(ORDERQTY) across mixed LINEUNIT values mixes units '
      + 'and silently under-reports (confirmed live: summing Dragon 2kg lines without converting gave 26,127, '
      + 'the real figure accounting for units was 84,757 - a 3x understatement). For Dragon 2kg products '
      + 'specifically, 1 Shipper = 6 Bags (confirmed by the client) - convert '
      + 'with SUM(CASE WHEN LINEUNIT = \'Shipper\' THEN ORDERQTY * 6 ELSE ORDERQTY END) rather than a plain '
      + 'SUM(ORDERQTY). For any OTHER product where LINEUNIT varies and you do not already know the '
      + 'bags/units-per-shipper conversion, do NOT guess a multiplier - ask the person directly (e.g. "Some '
      + 'of these are ordered by the Shipper/carton rather than individually - how many units are in one '
      + 'Shipper for this product?") and wait for their answer before totaling.\n'
      + '  CUSTOMERMASTER: customer contacts. CUSTOMERPAYMENTS: payments received.\n'
      + '  SALESINVOICEHEADER / SALESINVOICELINES: sales, already covered by get_south_financial_year/'
      + 'get_south_debtors for the standard reports - use this tool only for something those don\'t cover.\n'
      + 'Ostendo has NO salesperson table at all (SALESPERSON/SALESPEOPLE/EMPLOYEEMASTER all error "Table '
      + 'unknown") - a rep is only ever a numeric CODE in SALESINVOICEHEADER.SALESPERSON, and the name-to-'
      + 'code mapping below is the ONLY place it exists, not something a query can look up. If a person asks '
      + 'about a south/Ostendo rep by name (the question will usually make this obvious without saying '
      + '"Ostendo" - these are NOT Odoo res.users names), use this table rather than searching res.users '
      + '(which is Odoo-only and will never contain these names): 410=Jerry, 420=Michelle, 430=Keith, '
      + '450=Christchurch Office/Online, 460=Chris, 461=Ravi Kumar, 470=Lynette, 490=Leith. A code can carry '
      + 'a "-1" style suffix (e.g. "490-1") for a legacy clearance account - that still belongs to the same '
      + 'person, so match with SALESPERSON = \'490\' OR SALESPERSON LIKE \'490-%\' rather than an exact-only '
      + 'match, or the total will quietly miss some of their sales.\n'
      + 'A table genuinely not listed above may still exist - if a query errors with "Table unknown", try a '
      + 'plausible variant ONCE (e.g. singular/plural, HEADER vs HEADERS) before giving up, but don\'t guess '
      + 'indefinitely - say what you tried and ask the person to confirm the table if it keeps failing.',
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
