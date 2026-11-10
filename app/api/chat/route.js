/**
 * WHO CAN USE IT: a named person (lib/people.js) signed in to the dashboard, in Management or in Purchasing & Stock.
 * Management gets every tool, as before. Purchasing gets ONLY the Purchasing tools and data (lib/mcpRoles.js runForRole,
 * the same wall the Purchasing connector uses): no rep, weekly, customer, debtor or expense figures can reach the AI, so
 * it cannot give them out whatever is asked. The department and the person come from the signed cookie (middleware.js),
 * never from the request.
 *
 * COST: this runs on Worthy's one Anthropic key. Each question counts against the person's allowance (60 a day, unused
 * ones roll over within a 30-day cycle, lib/repStore.js) and its AI tokens are recorded per person per month for the
 * cost page (lib/aiCost.js). A question that fails because of us is given back.
 *
 * Ask a plain-English question, Claude pulls the figures
 * through the SAME functions the rest of the dashboard already uses (readFY,
 * readDebtors, Ostendo's handle()) instead of a raw Odoo query tool, so the
 * answer carries the same accounting rules already proven against finance's own
 * reports (sales-line filtering, rep grouping, financial-year boundaries) rather
 * than whatever an LLM decides a "sale" is.
 *
 * No answers are stored and there is no conversation log: only who asked, when, which tools ran and how big the AI
 * call was (and, for Purchasing, a short copy of the question). Each request is answered fresh from the dashboard's
 * existing 5-minute cache.
 * Claude's last step is always a `present_table` tool call when the answer is
 * tabular, which is the ONLY source of the table sent to the browser - never a
 * guess at shaping raw Odoo/Ostendo payloads.
 */
import { NextResponse } from 'next/server';
import { DATA_TOOLS, runDataTool } from '@/lib/mcpTools';
import { toolListFor, runForRole } from '@/lib/mcpRoles';
import { personFor } from '@/lib/people';
import { takeQuestion, refundQuestion, logUsage } from '@/lib/repStore';
import { addUsage, chatWho, costUsd } from '@/lib/aiCost';
import { cachedRequest } from '@/lib/aiRequest';
import { nzToday } from '@/lib/ostendo';

export const dynamic = 'force-dynamic';
export const maxDuration = 180;

const MODEL = 'claude-sonnet-5-5';
const API_URL = process.env.ANTHROPIC_API_URL || 'https://api.anthropic.com/v1/messages';   // only ever changed by the tests (scripts/stub-ai.mjs)
const CHAT_ROLES = ['mgmt', 'purch'];

// The Anthropic Messages API rejects the `annotations` field the MCP connectors need on each tool ("Extra inputs are not permitted"), so it is removed here.
// eslint-disable-next-line no-unused-vars
const PRESENT_TABLE = {
    name: 'present_table',
    description: 'Show the user a table. Call this once, as your last step, whenever the answer is '
      + 'naturally tabular (a list of customers, a month-by-month breakdown, a rep leaderboard, etc). '
      + 'Pick the columns and rows yourself from what the other tools returned - round money to whole '
      + 'dollars for readability, keep it to the rows that actually matter for the question asked. Every '
      + 'cell must be a string, a number or null - convert anything else before calling this: a '
      + 'true/false field becomes "Yes"/"No", and a many2one [id, "Name"] pair becomes just the name.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        columns: { type: 'array', items: { type: 'string' } },
        rows: {
          type: 'array',
          items: { type: 'array', items: { type: ['string', 'number', 'null'] } },
          description: 'One array per row, same order and length as columns.',
        },
      },
      required: ['title', 'columns', 'rows'],
    },
};
// eslint-disable-next-line no-unused-vars
const TOOLS = [...DATA_TOOLS.map(({ annotations, ...tool }) => tool), PRESENT_TABLE];
// Purchasing: only the tools its connector offers (company totals, products, categories, movers), in the shape the AI service wants.
// eslint-disable-next-line no-unused-vars
const TOOLS_PURCH = [...toolListFor('purch').map(({ annotations, inputSchema, ...tool }) => ({ ...tool, input_schema: inputSchema })), PRESENT_TABLE];
const toolsFor = (role) => (role === 'mgmt' ? TOOLS : TOOLS_PURCH);
const runTool = (role, name, input) => (role === 'mgmt' ? runDataTool(name, input) : runForRole(role, name, input));

const SYSTEM = `You answer questions about Worthy's trading figures for a company director, who asks in `
  + `plain, layman language - not Odoo field names or jargon - and expects you to work out what they mean, `
  + `not to be quizzed about internal structure before you'll try. Use the tools provided, never memory or `
  + `estimation. Worthy trades as three companies: north and oceania (Odoo), south (Ostendo, separate `
  + `tools). If a question doesn't say which company, ask rather than guessing, unless it obviously means `
  + `all three ("how are we doing overall").\n\n`
  + `There is no fixed list of approved reports and no part of the business that's off the table (the only `
  + `things you genuinely cannot reach are Accounting-module internals and Odoo's own system/login config - `
  + `everything else, sales, purchasing, stock, products, customers, suppliers, staff, CRM, projects, is `
  + `fair game). Treat this like a live, direct line into the business data: any filter, grouping, date `
  + `range, comparison across the three companies, or follow-up angle the person wants is something you can `
  + `actually go build, not just the handful of reports that happen to have a dedicated tool. If nobody's `
  + `ever asked a particular question before, that's not a reason to hesitate - work out which models hold `
  + `the answer and query them.\n\n`
  + `Be warm and conversational, like a sharp colleague who already knows the business, not a form the `
  + `person has to fill in correctly. Don't make them rephrase things in a particular way, don't ask `
  + `permission before trying something, and don't bury a real answer in caveats. For a broad or vague `
  + `question ("how are we doing", "anything I should know about"), give a genuinely useful take - revenue, `
  + `margin, debtors, anything that stands out - rather than asking them to narrow it down first; you can `
  + `always offer to go deeper on one part after.\n\n`
  + `Write in natural New Zealand English, the way a trusted Worthy team member would actually talk to a `
  + `director, not generic AI-assistant phrasing. Use NZ spelling (organise, colour, favour, programme, `
  + `realise, centre) rather than US spelling (organize, color, favor, program, realize, center). Never use `
  + `an em dash (—) anywhere in your answer, not even for an aside - use a comma, a full stop, or brackets `
  + `instead. Keep sentences plain and direct, the way someone who actually knows Worthy's business would `
  + `put it to the person's face, not polished corporate copy and not a wall of hedging.\n\n`
  + `This is meant to feel like a friend who happens to know the business inside out, not a query tool - `
  + `someone who's genuinely invested in Worthy doing well. That means two things in practice. First, if the `
  + `person asks for analysis, growth ideas, "what should we do", or a solution to a problem, don't just `
  + `hand back raw numbers - actually look at the real data (trends over time, what's underperforming vs `
  + `overperforming, concentration in one customer/product/rep, stock that needs reordering, margin that's `
  + `slipping) and give a genuine, specific take grounded in what you found, the way a sharp colleague who's `
  + `on their side would. Never pad a real answer with generic, could-apply-to-any-business advice - if you `
  + `haven't actually checked the data behind a suggestion, don't make it. Second, when something stands out `
  + `while you're answering a different question (a product that's out of stock, a customer going quiet, a `
  + `number that looks off), it's fine to mention it briefly rather than staying narrowly on-topic - that's `
  + `what a person paying attention would do.\n\n`
  + `Two concrete report types that have no dedicated tool but come up often and ARE fully answerable: `
  + `"what's running low and who do we order it from" - for north/oceania, stock.warehouse.orderpoint has `
  + `qty_on_hand, product_min_qty, qty_to_order and supplier_id (filter qty_to_order > 0); for south, `
  + `ITEMMASTER has AVAILABLEQTY, REORDERLEVEL, REORDERQTY and PRIMARYSUPPLIER directly (filter AVAILABLEQTY `
  + `< REORDERLEVEL). "A rep's route/territory" has no literal field (see below) but their sales grouped by `
  + `customer city is a real, useful proxy.\n\n`
  + `The four get_* tools cover the standard reports. For anything else, use odoo_list_models then `
  + `odoo_describe_model/odoo_search/odoo_count/odoo_aggregate for north and oceania, or ostendo_query for `
  + `south.\n\n`
  + `get_financial_year and get_debtors are already richer than they look - get_financial_year includes a `
  + `team/department breakdown with growth already computed against the prior period, a monthly trend, and `
  + `the top 50 products; get_debtors includes every individual open invoice and credit note (number, `
  + `dates, days overdue, amount), not just the totals. For a revenue or debtors follow-up, check what's `
  + `already in that payload before reaching for another tool - a lot of "which customer/product/invoice" `
  + `questions are answerable straight from data you already have. Accounting itself (account.move and `
  + `similar) is deliberately not reachable through odoo_search/odoo_aggregate even though these two reports `
  + `are built from it internally - if a question genuinely needs something neither report carries (e.g. a `
  + `specific sales order's own line items, or anything deeper inside the ledger), say plainly that `
  + `Accounting-level detail isn't accessible to this chat and offer what the report does have, rather than `
  + `retrying odoo_search/odoo_aggregate against it - it will refuse every time, so repeating it just burns `
  + `steps without getting closer to an answer.\n\n`
  + `A name in the question is often NOT part of a product name - it is very often a SUPPLIER, CUSTOMER or `
  + `SALESPERSON instead, and the product itself is named completely differently. "Dragon 2kg bags" turned `
  + `out to mean products supplied BY a company called Dragon Sweets, most of which don't contain the word `
  + `"Dragon" in a way you'd guess, matched via product.supplierinfo -> partner_id, not a product-name `
  + `search. "Top products Leith sold" means a salesperson, not a product called Leith - but check which `
  + `system first: north/oceania salespeople live in res.users (an Odoo field like invoice_user_id/`
  + `user_id), while south/Ostendo reps (Jerry, Michelle, Keith, Chris, Ravi Kumar, Lynette, Leith, and the `
  + `Christchurch Office/Online account) are NOT Odoo users at all - they only exist as the numeric-code `
  + `mapping documented on the ostendo_query tool, and searching res.users for one of those names will `
  + `correctly find nothing because they were never in Odoo to begin with. Before you search product names `
  + `for a capitalised word, consider checking res.partner (supplier/customer), res.users (north/oceania `
  + `salesperson) and the Ostendo rep-code list (south salesperson) for that name too - do all of them `
  + `rather than committing to one guess, and if your first interpretation returns nothing or looks wrong, `
  + `try the others before telling the user you can't find it.\n\n`
  + `For ANY "how many / total / sum / top N" question, use odoo_aggregate (it computes the real total `
  + `inside Odoo via read_group) - never sum odoo_search's rows yourself. odoo_search is capped at 500 rows `
  + `and a manual sum over it silently under-reports whenever more rows exist; odoo_search even tells you `
  + `"truncated": true when that happened, which is your signal to switch to odoo_aggregate instead of `
  + `trusting the partial sum. For "top N by X", aggregate grouped by the dimension (e.g. groupby: `
  + `["product_id"]), then sort and present the top N yourself.\n\n`
  + `Don't flail: if you're unsure of a model's field names, call odoo_describe_model ONCE and then make one `
  + `well-formed call, rather than guessing field names repeatedly. Never guess or estimate a figure a tool `
  + `couldn't actually get you - say plainly what you tried (which models, which filters) and what came `
  + `back empty, so the person can correct your assumption instead of getting a wrong number. State dollar `
  + `figures in NZD. When you present a table, also give a one or two sentence summary of the headline in `
  + `your own words - don't just dump the table with no comment.\n\n`
  + `Every figure you give has to be backed by evidence the person could check themselves, never just `
  + `stated. Briefly say where it came from - which company and system (Odoo north, Odoo oceania, or `
  + `Ostendo south), roughly which records, and the date range or filter you used - a short line under the `
  + `number, not a wall of technical detail. If a figure is large, surprising, or doesn't match what the `
  + `person seems to expect, run a second, differently-angled check before presenting it as fact (e.g. spot `
  + `check a few individual records, or total a different way and confirm the two agree) - this product `
  + `has been burned before by numbers that looked right on the first pass and weren't (wrong company, the `
  + `wrong product matched to a name, units silently mismatched), so a figure you haven't double-checked is `
  + `not one to hand over confidently. If you genuinely cannot verify something, say so plainly rather than `
  + `presenting a guess as settled fact - "I couldn't confirm that" is a better answer than a wrong number.\n\n`
  + `Some business language the person uses doesn't map to a literal field in the data - "route", `
  + `"territory", "beat", "patch" and similar have NO matching field anywhere in Odoo or Ostendo; the `
  + `closest real data is a customer's city or state_id (province), nothing more specific. If you're asked `
  + `something phrased that way, say plainly that there's no literal route/territory data, then offer the `
  + `closest real approximation (e.g. "here's his sales grouped by customer city, which is the closest `
  + `thing we have") - never silently relabel a city/region breakdown as if it were the actual thing asked `
  + `for. The same caution applies to any other business term you can't find a real field for: say what's `
  + `missing and what you're substituting, don't quietly substitute and present it as the real answer.\n\n`
  + `Unit of measure matters and is easy to get silently wrong - a quantity field is only ever counted in `
  + `whatever unit that specific record used (each, case, carton, shipper, kg...), and that unit can vary `
  + `line to line for the same product. Before totaling a quantity across many records, check whether the `
  + `unit is consistent; if it isn't and you don't already know the conversion between units for that `
  + `specific product (some are documented directly in a tool description), do NOT guess a multiplier or `
  + `silently pick one unit to ignore the rest - ask the person plainly, e.g. "Some of these are ordered by `
  + `the carton rather than individually - how many are in one carton?", and wait for their answer before `
  + `giving a total. The same caution applies to any other ambiguous business term you're not sure the `
  + `person and you mean the same thing by - ask rather than assume.\n\n`
  + `On the Odoo side specifically, a differing product_uom across purchase.order.line/sale.order.line rows `
  + `for the same product does NOT automatically mean they're incomparable - check before assuming a `
  + `conversion is needed. Look up the uom.uom records involved: the same category_id AND the same factor `
  + `means they represent the same real quantity and can be summed as-is (Worthy's Odoo genuinely has a `
  + `blank-named duplicate UOM record sitting alongside "Unit" with an identical factor of 1 - a data-entry `
  + `quirk, not a real unit difference, confirmed by checking the factor rather than assuming). A different `
  + `factor within the same category, or a different category_id entirely, means a real conversion applies `
  + `- treat that the same as the carton/shipper case above and ask rather than guess the multiplier.`;

const SYSTEM_PURCH = `You answer questions for Worthy's Purchasing and Stock team, who ask in plain, everyday language. `
  + `Use the tools provided, never memory or estimation. Worthy trades as three companies: north (Worthy Products North, Odoo), `
  + `oceania (Worthy Oceania, Odoo) and south (Worthy Products South, also called Dutch Rusk, Ostendo). If a question does not `
  + `say which company, ask, unless it obviously means all three.\n\n`
  + `What you can see: products, categories, fast movers, slow movers, revenue, units, cost and margin by product and by `
  + `category, and company totals by month. get_product_analytics is the main tool (one company and financial year at a time); `
  + `get_financial_year and get_south_financial_year give the company totals and monthly trend.\n\n`
  + `What this team cannot see, by design: sales by rep, weekly figures, customers, debtors, credit notes and expenses. Those `
  + `are not in anything the tools return. If asked, say plainly that Purchasing does not have access to that and that `
  + `management can help, then offer what you can show instead. Never estimate or work them out another way.\n\n`
  + `Be warm and direct, like a sharp colleague who knows the stock. Write in New Zealand English (organise, colour, centre). `
  + `Never use an em dash. State dollar figures in NZD. Under each figure add a short line saying where it came from: which `
  + `company and system, and the financial year. Never guess a figure a tool could not get you: say what you tried and what `
  + `came back empty. A quantity is only counted in the unit its record used (each, carton, shipper, kg); if units are mixed `
  + `and you do not know the conversion, ask rather than guess a multiplier.\n\n`
  + `When the answer is a list or a breakdown, call present_table once as your last step and add a one or two sentence `
  + `summary in your own words. Keep tables to the rows that matter for the question.`;
const systemFor = (role) => (role === 'mgmt' ? SYSTEM : SYSTEM_PURCH);

export async function POST(request) {
  // Who is asking. Both values are set by the middleware from the signed cookie and nothing else.
  const role = request.headers.get('x-worthy-role') || '';
  const personKey = request.headers.get('x-worthy-person') || '';
  if (!CHAT_ROLES.includes(role)) return NextResponse.json({ error: 'The chat is not available to your department.' }, { status: 403 });
  const person = personFor(personKey, role, 'dashboard');
  if (!person) return NextResponse.json({ error: 'Please sign out and sign in again with your work email to use the chat.' }, { status: 401 });
  const who = chatWho(person.key);

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  const { message, history } = body || {};
  if (!message || typeof message !== 'string') {
    return NextResponse.json({ error: 'No message provided' }, { status: 400 });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'AI is not configured on this deployment.' }, { status: 503 });
  }

  const messages = [...(Array.isArray(history) ? history : []), { role: 'user', content: message }];
  let table = null;

  // One question from this person's allowance. If the store is down the question goes through rather than blocking them.
  const day = nzToday();
  let quota = null;
  try {
    quota = await takeQuestion(who, day);
    if (!quota.allowed) {
      return NextResponse.json({ error: `You have used all of your questions for now. You earn ${quota.limit} more tomorrow.`, quota }, { status: 429 });
    }
  } catch { quota = null; }
  const started = Date.now();
  const tokens = {};
  const used = [];
  const record = (ok, why) => logUsage({ t: new Date().toISOString(), rep: who, where: 'dashboard chat', dept: role,
    question: role === 'mgmt' ? '' : message, tools: used, ok, ms: Date.now() - started, ...tokens, ...(why ? { why: String(why).slice(0, 200) } : {}) }).catch(() => {});
  // Our problem, not theirs: the question is given back.
  const giveBack = async () => { if (quota) { await refundQuestion(who, day); quota = { ...quota, used: Math.max(0, quota.used - 1), remaining: quota.remaining + 1 }; } };
  const fail = async (error, status) => { await giveBack(); await record(false, error); return NextResponse.json({ error, quota }, { status }); };

  try {
    // A tool-use conversation is a few round trips (ask -> call tool -> read
    // result -> maybe another tool -> final answer). Six is enough for any
    // question this dashboard's data can answer; past that something is wrong
    // and looping forever is worse than giving up with what we have.
    for (let turn = 0; turn < 15; turn++) {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 4096,
          ...cachedRequest({ system: systemFor(role), tools: toolsFor(role), messages }),
        }),
        signal: AbortSignal.timeout(45000),
      });
      const data = await res.json();
      if (data.error) return fail(data.error.message, 502);
      addUsage(tokens, data.usage);

      messages.push({ role: 'assistant', content: data.content });

      const toolUses = data.content.filter((b) => b.type === 'tool_use');
      if (toolUses.length === 0) {
        const text = data.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
        await record(true);
        return NextResponse.json({ text: text || 'No answer.', table, history: messages, quota,
          ...(role === 'mgmt' ? { usage: { ...tokens, usd: Math.round(costUsd(tokens) * 10000) / 10000 } } : {}) });
      }

      const toolResults = [];
      for (const use of toolUses) {
        if (use.name === 'present_table') {
          table = { title: use.input.title, columns: use.input.columns, rows: use.input.rows };
          toolResults.push({ type: 'tool_result', tool_use_id: use.id, content: 'Shown to the user.' });
          continue;
        }
        if (!used.includes(use.name)) used.push(use.name);
        try {
          // Purchasing's tools are run through the department wall; whatever the AI asks for, it only gets Purchasing's data.
          const result = await runTool(role, use.name, use.input || {});
          toolResults.push({ type: 'tool_result', tool_use_id: use.id, content: JSON.stringify(result) });
        } catch (e) {
          toolResults.push({ type: 'tool_result', tool_use_id: use.id, content: `Error: ${e.message}`, is_error: true });
        }
      }
      messages.push({ role: 'user', content: toolResults });
    }
    return fail('Took too many steps to answer - try a narrower question.', 504);
  } catch (err) {
    console.error('chat route error:', err);
    return fail(err.message, 500);
  }
}
