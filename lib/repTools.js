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
import { projectSales, projectDebtors, guard, guardTeam, systemLabel } from '@/lib/repProject';
import { getBestSellers, getCustomers, getRecent, getCrossSell, getCustomerDetail, findProductCosts, findProductGaps } from '@/lib/repData';
import { buildActionPlan } from '@/lib/repPlan';
import { resolvePerson, teamNames as names } from '@/lib/repAccess';

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

const PERSON_TOOLS = [
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

const PERSON_ARG = {
  type: 'string',
  description: 'Which person on your team, by first name (for example "Chris"). Leave out to mean yourself. Only people on your own team exist here.',
};
const withPerson = (t) => (t.name === 'my_profile' ? t : {
  ...t,
  description: `${t.description} Team leads: add person to see one team member in full; leave it out for yourself.`,
  inputSchema: { ...t.inputSchema, properties: { ...t.inputSchema.properties, person: PERSON_ARG } },
});

const TEAM_TOOLS = [
  {
    name: 'team_overview',
    description: 'YOUR TEAM at a glance: each team member\'s sales this financial year (sales, orders, gross profit, margin, target, pace, '
      + 'month-end forecast, same time last year) and the team total. Use it for "how is my team going", "who is ahead or behind", "compare my team". '
      + 'Only the people on your own team. Optional fy.',
    inputSchema: { type: 'object', properties: { fy: { type: 'integer', description: 'Financial year, e.g. 2026 for FY26. Defaults to the current one.' } }, additionalProperties: false },
    annotations: ANN,
  },
  {
    name: 'team_attention',
    description: 'Where your team needs help right now: for each team member, their top opportunities and problems (behind target, customers gone quiet, '
      + 'overdue accounts, slipping customers, slowing products), each with the figures behind it. Use it for "who needs my help", "what should I coach", '
      + '"what should my team focus on". Only the people on your own team. Optional fy.',
    inputSchema: { type: 'object', properties: { fy: { type: 'integer', description: 'Financial year, e.g. 2026 for FY26. Defaults to the current one.' } }, additionalProperties: false },
    annotations: ANN,
  },
];

TEAM_TOOLS.push({
  name: 'product_cost',
  description: 'The cost price of a product by name (for example "Musashi 500ml"), from ONLY the system your team sells from (Ostendo, Odoo, or both for a team that spans them). Any product in that system can be looked up. No sales figures. Shows the cost before GST as recorded today and which system it came from. Use it for "what is the cost price of X", "what does X cost us".',
  inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'Part or all of the product name.' } }, required: ['name'], additionalProperties: false },
  annotations: ANN,
});

TEAM_TOOLS.push({
  name: 'team_product_gaps',
  description: 'Range gaps for YOUR TEAM: of the company most widely sold products, the ones your team reaches least (sold to few of your team customers, or not sold by your team for 90 days), with cost, the product company rank, and your team own reach. No company or other-rep sales figures. Use it for "what are we not selling", "what could my team offer more of", "gaps in our range".',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  annotations: ANN,
});

export const REP_TOOLS = [PERSON_TOOLS[0], ...TEAM_TOOLS, ...PERSON_TOOLS.slice(1).map(withPerson)];
export const REP_TOOL_NAMES = new Set(REP_TOOLS.map((t) => t.name));

async function southPayload(fy) {
  const res = await ostendoFyHandle(new Request(`http://internal/south-fy?fy=${fy}`));
  return res.json();
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const r2 = (v) => Math.round(v * 100) / 100;

async function teamOverview(principal, input) {
  const fy = fyArg(input);
  const rows = await Promise.all(principal.people.map(async (p) => {
    try {
      const s = await runPersonTool(p, 'my_sales', { fy });
      return { person: p.label, system: s.system, financialYear: s.financialYear, period: s.period, asOf: s.asOf, year: s.year,
        thisMonth: (s.months || []).find((x) => x.key === String(s.period?.to || '').slice(0, 7)) || null, target: s.target, targetProgress: s.targetProgress,
        sameTimeLastYear: s.sameTimeLastYear, note: s.note };
    } catch { return { person: p.label, error: 'Could not be loaded right now.' }; }
  }));
  const ok = rows.filter((r) => r.year);
  const revenue = r2(ok.reduce((s, r) => s + num(r.year.revenue), 0));
  const withMargin = ok.filter((r) => r.year.grossProfit !== null && r.year.grossProfit !== undefined && num(r.year.marginPct) > 0);
  // Margin is worked out on the sales that have a recorded cost, so the team margin divides by that same base (gross profit / margin %), not by all sales.
  const gpBase = withMargin.reduce((s, r) => s + num(r.year.grossProfit) / (num(r.year.marginPct) / 100), 0);
  const gp = r2(withMargin.reduce((s, r) => s + num(r.year.grossProfit), 0));
  return guardTeam({
    team: principal.teamName, lead: principal.label, financialYear: fy,
    basis: 'Posted invoices less credit notes, before GST, same basis as the Worthy dashboard.',
    members: rows,
    teamTotal: {
      people: principal.people.length, peopleWithSales: ok.length,
      revenue, orders: ok.reduce((s, r) => s + num(r.year.invoices), 0), credits: ok.reduce((s, r) => s + num(r.year.credits), 0),
      grossProfit: withMargin.length ? gp : null,
      marginPct: withMargin.length && gpBase > 0 ? r2((gp / gpBase) * 100) : null,
      marginNote: withMargin.length < ok.length ? 'Margin covers only the people whose costs are recorded.' : null,
      sameTimeLastYear: ok.length && ok.every((r) => r.sameTimeLastYear) ? r2(ok.reduce((s, r) => s + num(r.sameTimeLastYear.salesThen), 0)) : null,
    },
  }, principal.people);
}

async function teamAttention(principal, input) {
  const fy = fyArg(input);
  const rows = await Promise.all(principal.people.map(async (p) => {
    try {
      const plan = await runPersonTool(p, 'my_action_plan', { fy });
      return { person: p.label, asOf: plan.asOf, items: (plan.opportunities || []).slice(0, 3), note: plan.note };
    } catch { return { person: p.label, error: 'Could not be loaded right now.' }; }
  }));
  return guardTeam({
    team: principal.teamName, lead: principal.label, financialYear: fy,
    howToUse: 'Top items per person, each worked out from that person\'s own figures with the evidence shown. Do not add numbers that are not here. Use my_customer or my_customers with person for more detail.',
    members: rows,
  }, principal.people);
}

/**
 * Entry point for the chat page and the rep connector. `principal` is the signed-in LEAD (from the signed
 * cookie or token). The tools answer for the lead or for one named person on the lead's own team, never anyone else.
 */
async function runRepToolInner(principal, name, input) {
  if (!principal || !Array.isArray(principal.people) || !REP_TOOL_NAMES.has(name)) throw new Error('Unknown tool.');
  if (name === 'my_profile') {
    return guardTeam({
      person: principal.label,
      role: 'Team lead',
      team: principal.teamName,
      teamMembers: principal.members.map((m) => ({ person: m.label, system: systemLabel(m) })),
      yourOwnSales: principal.self ? { person: principal.self.label, system: systemLabel(principal.self) } : 'You have no sales of your own in this view.',
      financialYear: nzFinancialYear(),
      scope: 'You can see your own sales and, for each person on your team, their sales, customers, best sellers, margin and debtors, plus team totals. Nobody outside your team.',
    }, principal.people.concat(principal.self ? [] : [{ label: principal.label }]));
  }
  if (name === 'team_overview') return teamOverview(principal, input);
  if (name === 'team_attention') return teamAttention(principal, input);
  if (name === 'team_product_gaps') return guardTeam(await findProductGaps(principal.people), principal.people);
  if (name === 'product_cost') {
    // Only the system(s) the lead's team uses are searched: a team that sells from Ostendo never sees Odoo costs.
    return guardTeam(await findProductCosts(principal.people, String(input?.name ?? '').slice(0, 80)), principal.people);
  }
  const person = resolvePerson(principal, input?.person);
  return runPersonTool(person, name, input);
}

/** One named person's own answer. `rep` here is always a single person from the lead's team (see resolvePerson). */
async function runPersonTool(rep, name, input) {
  if (name === 'my_profile') {
    return guard({
      rep: rep.label,
      system: systemLabel(rep),
      financialYear: nzFinancialYear(),
      scope: 'Their own sales and the debtors of their own customers.',
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

// Only these messages (our own, written for the rep) may reach the person or the AI. Anything else, such as a raw
// Odoo or Ostendo error with table names or SQL in it, is logged on the server and replaced with a plain sentence.
const SAFE_MESSAGE = /^(fy must be|Unknown tool|Your figures could not|Debtors could not|Tell me which customer|Say which team member|"[^"]{0,40}" (is not on your team|matches more than one)|Could not match your account)/;

export async function runRepTool(principal, name, input) {
  try {
    return await runRepToolInner(principal, name, input);
  } catch (e) {
    const msg = String(e?.message || '');
    if (SAFE_MESSAGE.test(msg)) throw e;
    console.error(JSON.stringify({ evt: 'rep_tool_error', lead: principal?.key, tool: String(name), blocked: msg.startsWith('Blocked:'), why: msg.slice(0, 300) }));
    throw new Error(msg.startsWith('Blocked:') ? 'That answer was held back as a precaution. Please ask in a different way.' : 'That could not be loaded right now. Try again shortly.');
  }
}
