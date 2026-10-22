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

// search/fetch exist for ONE reason: ChatGPT's connector system requires a
// tool literally named "search" (and "fetch" to resolve its results) before
// it will treat the connector as usable at all - without them, ChatGPT's own
// "action discovery" step fails right after a successful OAuth handshake,
// which is exactly what was reported live ("Authentication succeeded, action
// discovery failed"). This isn't part of the general MCP spec and Claude's
// connector doesn't need it, which is why Claude worked and ChatGPT didn't.
// Rather than a token pair that does nothing useful, this is a real
// name/entity lookup across both systems - find which customer, supplier or
// product a name refers to, then fetch its key details - which is also
// exactly the disambiguation step (Dragon Sweets, Leith, etc) the rest of
// this file already has to do by hand for every ambiguous name.
async function searchEntities({ query }) {
  const term = String(query || '').trim();
  if (!term) return { results: [] };
  const escapedUpper = term.toUpperCase().replace(/'/g, "''");

  const [partnersRaw, productsRaw, suppliersRaw, itemsRaw] = await Promise.all([
    odooSearch({
      model: 'res.partner', domain: [['name', 'ilike', term]],
      fields: ['id', 'name', 'customer_rank', 'supplier_rank'], limit: 5,
    }).then((r) => r.rows || r).catch(() => []),
    odooSearch({
      model: 'product.template', domain: [['name', 'ilike', term]], fields: ['id', 'name'], limit: 5,
    }).then((r) => r.rows || r).catch(() => []),
    ostendoQuery({
      sql: `SELECT FIRST 5 SUPPLIER FROM SUPPLIERMASTER WHERE UPPER(SUPPLIER) LIKE '%${escapedUpper}%'`,
    }).catch(() => []),
    ostendoQuery({
      sql: `SELECT FIRST 5 ITEMCODE, ITEMDESCRIPTION FROM ITEMMASTER `
        + `WHERE UPPER(ITEMDESCRIPTION) LIKE '%${escapedUpper}%'`,
    }).catch(() => []),
  ]);

  const results = [];
  for (const p of partnersRaw) {
    const kind = p.supplier_rank > 0 ? 'Supplier' : p.customer_rank > 0 ? 'Customer' : 'Contact';
    const id = `odoo:partner:${p.id}`;
    results.push({ id, title: `${p.name} (${kind} - Odoo, north/oceania)`, url: id });
  }
  for (const pr of productsRaw) {
    const id = `odoo:product:${pr.id}`;
    results.push({ id, title: `${pr.name} (Product - Odoo, north/oceania)`, url: id });
  }
  for (const s of suppliersRaw) {
    if (!s.SUPPLIER) continue;
    const id = `ostendo:supplier:${s.SUPPLIER}`;
    results.push({ id, title: `${s.SUPPLIER} (Supplier - Ostendo, south)`, url: id });
  }
  for (const it of itemsRaw) {
    if (!it.ITEMCODE) continue;
    const id = `ostendo:item:${it.ITEMCODE}`;
    results.push({ id, title: `${it.ITEMDESCRIPTION} [${it.ITEMCODE}] (Product - Ostendo, south)`, url: id });
  }
  return { results };
}

async function fetchEntity({ id }) {
  const key = String(id || '');
  if (key.startsWith('odoo:partner:')) {
    const partnerId = Number(key.slice('odoo:partner:'.length));
    const { rows } = await odooSearch({
      model: 'res.partner', domain: [['id', '=', partnerId]],
      fields: ['id', 'name', 'city', 'state_id', 'customer_rank', 'supplier_rank', 'user_id'],
    });
    const p = rows[0];
    if (!p) throw new Error(`No contact found for '${key}'.`);
    return { id: key, title: p.name, text: JSON.stringify(p, null, 2), url: key };
  }
  if (key.startsWith('odoo:product:')) {
    const productId = Number(key.slice('odoo:product:'.length));
    const { rows } = await odooSearch({
      model: 'product.template', domain: [['id', '=', productId]],
      fields: ['id', 'name', 'qty_available', 'list_price', 'standard_price'],
    });
    const p = rows[0];
    if (!p) throw new Error(`No product found for '${key}'.`);
    return { id: key, title: p.name, text: JSON.stringify(p, null, 2), url: key };
  }
  if (key.startsWith('ostendo:supplier:')) {
    const name = key.slice('ostendo:supplier:'.length).replace(/'/g, "''");
    const rows = await ostendoQuery({
      sql: `SELECT SUPPLIER, SUPPLIERSTATUS, SUPPLIERTYPE FROM SUPPLIERMASTER WHERE SUPPLIER = '${name}'`,
    });
    const r = rows[0];
    if (!r) throw new Error(`No supplier found for '${key}'.`);
    return { id: key, title: r.SUPPLIER, text: JSON.stringify(r, null, 2), url: key };
  }
  if (key.startsWith('ostendo:item:')) {
    const code = key.slice('ostendo:item:'.length).replace(/'/g, "''");
    const rows = await ostendoQuery({
      sql: 'SELECT ITEMCODE, ITEMDESCRIPTION, ITEMCATEGORY, ONHANDQTY, STDBUYPRICE, AVERAGECOST '
        + `FROM ITEMMASTER WHERE ITEMCODE = '${code}'`,
    });
    const r = rows[0];
    if (!r) throw new Error(`No item found for '${key}'.`);
    return { id: key, title: r.ITEMDESCRIPTION, text: JSON.stringify(r, null, 2), url: key };
  }
  throw new Error(`Unrecognised id '${key}' - ids must come from a prior search result.`);
}

// OpenAI's Apps SDK docs list accurate readOnlyHint/destructiveHint/openWorldHint
// annotations as part of what a tool definition needs - every tool here is
// read-only, never destructive, and only ever touches Worthy's own closed
// Odoo/Ostendo data (never the open web), so the same three annotations apply
// to all of them. Applied once below rather than repeated on every entry.
const RAW_DATA_TOOLS = [
  {
    name: 'search',
    description: 'Finds which real customer, supplier or product a name refers to, across BOTH systems '
      + '(Odoo for north/oceania, Ostendo for south) in one call. Use this whenever a question names '
      + 'someone or something and you are not already certain which company/system they belong to, or '
      + 'whether the name is a supplier, a customer or a product - e.g. before assuming a capitalised word '
      + 'in the question is a product name. Returns a short list of candidates; pass one of their "id" '
      + 'values to the fetch tool to get its full detail. This is a lookup/disambiguation step, not a '
      + 'reporting tool - for totals, trends or aggregates once you know which entity is meant, use '
      + 'get_financial_year/get_debtors/odoo_aggregate/ostendo_query instead.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'A name or partial name to look up, e.g. "Dragon Sweets" or "H2 500ml".' } },
      required: ['query'],
    },
  },
  {
    name: 'fetch',
    description: 'Gets the full detail for one id returned by the search tool (a customer, supplier or '
      + 'product). Always call search first to get a valid id - this tool does not accept a free-text name.',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'An id exactly as returned by a prior search call.' } },
      required: ['id'],
    },
  },
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
      + 'get_south_debtors for the standard reports - use this tool only for something those don\'t cover, '
      + 'e.g. margin or revenue by PRODUCT or by CUSTOMER rather than by month. IMPORTANT if you compute a '
      + 'margin yourself: raw SUM(INVOICEQTY * INVOICEUNITCOST) / SUM(EXTENDEDNETTPRICE) is NOT safe '
      + 'without the same guards the dashboard\'s own report uses, or the margin comes out wrong, usually '
      + 'misleadingly high. First filter to SALESINVOICELINES.CODETYPE = \'Item Code\' only - other line '
      + 'types (freight, rebates, service) have no real product cost and will distort a per-product margin '
      + 'if included. Second, INVOICEUNITCOST = 0 on a line almost always means the cost is MISSING in '
      + 'Ostendo, not that the item genuinely cost nothing - a line like that inflates margin if treated as '
      + 'real. Before presenting a margin, check what share of revenue actually has a real cost figure '
      + '(e.g. SUM of EXTENDEDNETTPRICE where INVOICEUNITCOST > 0, divided by total EXTENDEDNETTPRICE for '
      + 'the same item-code lines) - below roughly 95% coverage, say plainly that Ostendo doesn\'t have '
      + 'enough cost data to give a reliable margin for this slice, rather than presenting a number.\n'
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

export const DATA_TOOLS = RAW_DATA_TOOLS.map((tool) => ({
  ...tool,
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
}));

export async function runDataTool(name, input) {
  if (name === 'search') return searchEntities(input || {});
  if (name === 'fetch') return fetchEntity(input || {});
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
