/**
 * The ONLY tools the rep-only MCP connector offers. Each one answers for a single
 * rep, taken from the signed-in token and never from anything the caller types:
 * no tool has an argument that names a person, a customer id, a query or a filter.
 *
 * Safety rules this file keeps:
 *  1. Output is BUILT from allowlisted fields of the rep's own rows. The raw
 *     company payload (totals, other reps, "Direct", top customers, cost detail)
 *     is never returned, so a field added to a report later cannot leak by default.
 *  2. A rep who is not in lib/repAccess.js, or who matches no row, gets an empty
 *     answer, never a neighbour's row.
 *  3. A final guard walks the result and fails closed if any `rep` value is not
 *     this rep, or if company-level keys appear.
 * Numbers come from the same cached reports the dashboard uses, so they match it.
 */
import { readFY } from '@/lib/odooFyCache';
import { readDebtors } from '@/lib/odooDebtorsCache';
import { handle as ostendoFyHandle } from '@/lib/ostendoFy';
import { nzFinancialYear } from '@/lib/ostendo';
import { projectSales, projectDebtors, guard, systemLabel } from '@/lib/repProject';
import { getBestSellers, getCustomers, getRecent, getCrossSell, getCustomerDetail } from '@/lib/repData';
import { buildActionPlan } from '@/lib/repPlan';

const NORTH_CID = 4;

const fyArg = (input) => {
  const v = input?.fy;
  if (v === undefined || v === null || v === '') return nzFinancialYear();
  const n = Number(v);
  if (!Number.isInteger(n) || n < 2020 || n > 2100) throw new Error('fy must be a financial year such as 2026.');
  return n;
};

const NO_ARGS = { type: 'object', properties: {}, additionalProperties: false };
const ANN = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };

export const REP_TOOLS = [
  {
    name: 'my_profile',
    description: 'Shows who you are signed in as, and which Worthy system your numbers come from. Takes no arguments.',
    inputSchema: NO_ARGS, annotations: ANN,
  },
  {
    name: 'my_sales',
    description: 'YOUR OWN sales for a financial year: year to date, each month and each week (revenue, orders, '
      + 'average order, credits, your gross profit and margin) plus your target. Only your own figures exist here; '
      + 'there is no way to see anyone else or company totals. Optional fy is the year the April falls in, e.g. 2026 for FY26.',
    inputSchema: {
      type: 'object',
      properties: { fy: { type: 'integer', description: 'Financial year, e.g. 2026 for FY26 (1 Apr 2026 to 31 Mar 2027). Defaults to the current one.' } },
      additionalProperties: false,
    },
    annotations: ANN,
  },
  {
    name: 'my_debtors',
    description: 'Unpaid invoices for the customers assigned to YOU: totals by age (current, 1-30, 31-60, 61-90, over 90 days), '
      + 'each customer and each open invoice. Only your own customers. Takes no arguments.',
    inputSchema: NO_ARGS, annotations: ANN,
  },
  {
    name: 'my_best_sellers',
    description: 'YOUR OWN best-selling products this financial year (revenue, units, share of your sales), plus which of your '
      + 'products are growing or slowing compared with the previous 90 days. Only products you sold. Optional fy.',
    inputSchema: { type: 'object', properties: { fy: { type: 'integer', description: 'Financial year, e.g. 2026 for FY26 (1 Apr 2026 to 31 Mar 2027). Defaults to the current one.' } }, additionalProperties: false },
    annotations: ANN,
  },
  {
    name: 'my_customers',
    description: 'YOUR OWN customers: your top customers this year, customers who have gone quiet (no order for 45+ days), '
      + 'customers slipping against the previous 90 days, customers growing, and new or returning customers (no order from you in the previous 12 months). Use it to decide who to call '
      + 'or visit. Only your own customers. Optional fy.',
    inputSchema: { type: 'object', properties: { fy: { type: 'integer', description: 'Financial year, e.g. 2026 for FY26 (1 Apr 2026 to 31 Mar 2027). Defaults to the current one.' } }, additionalProperties: false },
    annotations: ANN,
  },
  {
    name: 'my_recent_orders',
    description: 'YOUR OWN most recent invoices and credit notes (newest first, last 30): date, number, customer and amount. Optional fy.',
    inputSchema: { type: 'object', properties: { fy: { type: 'integer', description: 'Financial year, e.g. 2026 for FY26 (1 Apr 2026 to 31 Mar 2027). Defaults to the current one.' } }, additionalProperties: false },
    annotations: ANN,
  },
  {
    name: 'my_action_plan',
    description: 'YOUR OWN ranked opportunities to grow sales, each with the exact figures behind it: pace against your target, customers who have '
      + 'gone quiet, overdue accounts to chase, customers slipping or growing, products slowing or growing, and how dependent you are on a few customers. '
      + 'Use this whenever the person asks for suggestions, recommendations, advice, a better way, what to focus on, or how to grow. Optional fy.',
    inputSchema: { type: 'object', properties: { fy: { type: 'integer', description: 'Financial year, e.g. 2026 for FY26 (1 Apr 2026 to 31 Mar 2027). Defaults to the current one.' } }, additionalProperties: false },
    annotations: ANN,
  },
  {
    name: 'my_customer',
    description: 'A deep-dive on ONE of YOUR OWN customers, by name: how they are trading, what they buy (with your margin), what they have started and '
      + 'stopped buying, their recent invoices, what they owe, and products you could offer them. The name is matched only against your own customers; '
      + 'if it matches several, you are shown the choices. Use it for "tell me about X", "should I call X", "what does X buy".',
    inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'Part or all of the customer name, as the rep said it.' } }, required: ['name'], additionalProperties: false },
    annotations: ANN,
  },
  {
    name: 'my_cross_sell',
    description: 'YOUR OWN cross-sell ideas: products that many of your other customers who buy the same things also buy, that your good customers have not '
      + 'bought in the last 12 months, each with the counts behind it. Use it for "what else could I sell", "what should I offer", "upsell ideas". Optional fy.',
    inputSchema: { type: 'object', properties: { fy: { type: 'integer', description: 'Financial year, e.g. 2026 for FY26 (1 Apr 2026 to 31 Mar 2027). Defaults to the current one.' } }, additionalProperties: false },
    annotations: ANN,
  },
];

export const REP_TOOL_NAMES = new Set(REP_TOOLS.map((t) => t.name));

async function southPayload(fy) {
  const res = await ostendoFyHandle(new Request(`http://internal/south-fy?fy=${fy}`));
  return res.json();
}

export async function runRepTool(rep, name, input) {
  if (!rep || !REP_TOOL_NAMES.has(name)) throw new Error('Unknown tool.');
  if (name === 'my_profile') {
    return guard({
      rep: rep.label,
      system: systemLabel(rep),
      financialYear: nzFinancialYear(),
      scope: 'You can only see your own sales and the debtors of your own customers.',
    }, rep);
  }
  if (name === 'my_sales') {
    const fy = fyArg(input);
    const payload = rep.system === 'north' ? (await readFY(NORTH_CID, fy)).payload : await southPayload(fy);
    if (payload?.error) throw new Error('Your figures could not be loaded right now. Try again shortly.');
    return guard(projectSales(payload, rep, fy), rep);
  }
  if (name === 'my_action_plan') {
    const fy = fyArg(input);
    const salesPayload = rep.system === 'north' ? (await readFY(NORTH_CID, fy)).payload : await southPayload(fy);
    if (salesPayload?.error) throw new Error('Your figures could not be loaded right now. Try again shortly.');
    const [customers, products, crossSell, debtorsPayload] = await Promise.all([
      getCustomers(rep, fy), getBestSellers(rep, fy), getCrossSell(rep, fy).catch(() => null), readDebtors(rep.system === 'north' ? NORTH_CID : 'south').catch(() => null),
    ]);
    return guard(buildActionPlan({
      rep, sales: projectSales(salesPayload, rep, fy), customers, products, crossSell,
      debtors: debtorsPayload && !debtorsPayload.error ? projectDebtors(debtorsPayload, rep) : null,
    }), rep);
  }
  if (name === 'my_customer') {
    const n = String(input?.name ?? '').trim().slice(0, 80);
    if (!n) throw new Error('Tell me which customer you mean.');
    const fy = fyArg(input);
    const debtorsPayload = await readDebtors(rep.system === 'north' ? NORTH_CID : 'south').catch(() => null);
    const debtors = debtorsPayload && !debtorsPayload.error ? projectDebtors(debtorsPayload, rep) : null;
    return guard(await getCustomerDetail(rep, fy, n, debtors), rep);
  }
  if (name === 'my_cross_sell') return guard(await getCrossSell(rep, fyArg(input)), rep);
  if (name === 'my_best_sellers') return guard(await getBestSellers(rep, fyArg(input)), rep);
  if (name === 'my_customers') return guard(await getCustomers(rep, fyArg(input)), rep);
  if (name === 'my_recent_orders') return guard(await getRecent(rep, fyArg(input)), rep);
  // my_debtors
  const payload = await readDebtors(rep.system === 'north' ? NORTH_CID : 'south');
  if (payload?.error || payload?.ok === false) throw new Error('Debtors could not be loaded right now. Try again shortly.');
  return guard(projectDebtors(payload, rep), rep);
}
