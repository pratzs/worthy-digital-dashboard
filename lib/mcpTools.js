/**
 * The read-only data tools shared by the management chat (app/api/chat) and the
 * OAuth-protected MCP connector (app/api/mcp) for Claude/ChatGPT's own custom
 * connectors. Both wrap the SAME readFY/readDebtors/Ostendo functions the rest
 * of the dashboard already uses, so a number asked for here matches the number
 * on the dashboard page - never a raw Odoo/Ostendo query an LLM wrote itself.
 */
import { readFY } from '@/lib/odooFyCache';
import { readDebtors } from '@/lib/odooDebtorsCache';
import { handle as ostendoFyHandle } from '@/lib/ostendoFy';
import { computeSouthDebtors } from '@/lib/ostendoDebtors';
import { nzFinancialYear } from '@/lib/ostendo';

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
  throw new Error(`Unknown tool '${name}'`);
}
