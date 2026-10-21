/**
 * Management-only chat: ask a plain-English question, Claude pulls the figures
 * through the SAME functions the rest of the dashboard already uses (readFY,
 * readDebtors, Ostendo's handle()) instead of a raw Odoo query tool, so the
 * answer carries the same accounting rules already proven against finance's own
 * reports (sales-line filtering, rep grouping, financial-year boundaries) rather
 * than whatever an LLM decides a "sale" is.
 *
 * Nothing here is stored. Each request is answered fresh from the dashboard's
 * existing 5-minute cache; there is no new database, no conversation log.
 * Claude's last step is always a `present_table` tool call when the answer is
 * tabular, which is the ONLY source of the table sent to the browser - never a
 * guess at shaping raw Odoo/Ostendo payloads.
 */
import { NextResponse } from 'next/server';
import { DATA_TOOLS, runDataTool } from '@/lib/mcpTools';

export const dynamic = 'force-dynamic';
export const maxDuration = 180;

const MODEL = 'claude-sonnet-5-5';

const TOOLS = [
  ...DATA_TOOLS,
  {
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
  },
];

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
  + `The four get_* tools cover the standard reports. For anything else, use odoo_list_models then `
  + `odoo_describe_model/odoo_search/odoo_count/odoo_aggregate for north and oceania, or ostendo_query for `
  + `south.\n\n`
  + `A name in the question is often NOT part of a product name - it is very often a SUPPLIER, CUSTOMER or `
  + `SALESPERSON instead, and the product itself is named completely differently. "Dragon 2kg bags" turned `
  + `out to mean products supplied BY a company called Dragon Sweets, most of which don't contain the word `
  + `"Dragon" in a way you'd guess, matched via product.supplierinfo -> partner_id, not a product-name `
  + `search. "Top products Leith sold" means a salesperson named Leith (res.users or an Odoo field like `
  + `invoice_user_id/user_id), not a product called Leith. Before you search product names for a `
  + `capitalised word, consider checking res.partner (supplier/customer) and res.users (salesperson) for `
  + `that name too - do both searches rather than committing to one guess, and if your first interpretation `
  + `returns nothing or looks wrong, try the others before telling the user you can't find it.\n\n`
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
  + `Unit of measure matters and is easy to get silently wrong - a quantity field is only ever counted in `
  + `whatever unit that specific record used (each, case, carton, shipper, kg...), and that unit can vary `
  + `line to line for the same product. Before totaling a quantity across many records, check whether the `
  + `unit is consistent; if it isn't and you don't already know the conversion between units for that `
  + `specific product (some are documented directly in a tool description), do NOT guess a multiplier or `
  + `silently pick one unit to ignore the rest - ask the person plainly, e.g. "Some of these are ordered by `
  + `the carton rather than individually - how many are in one carton?", and wait for their answer before `
  + `giving a total. The same caution applies to any other ambiguous business term you're not sure the `
  + `person and you mean the same thing by - ask rather than assume.`;

export async function POST(request) {
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

  try {
    // A tool-use conversation is a few round trips (ask -> call tool -> read
    // result -> maybe another tool -> final answer). Six is enough for any
    // question this dashboard's data can answer; past that something is wrong
    // and looping forever is worse than giving up with what we have.
    for (let turn = 0; turn < 15; turn++) {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 4096,
          system: SYSTEM,
          tools: TOOLS,
          messages,
        }),
        signal: AbortSignal.timeout(45000),
      });
      const data = await res.json();
      if (data.error) return NextResponse.json({ error: data.error.message }, { status: 502 });

      messages.push({ role: 'assistant', content: data.content });

      const toolUses = data.content.filter((b) => b.type === 'tool_use');
      if (toolUses.length === 0) {
        const text = data.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
        return NextResponse.json({ text: text || 'No answer.', table, history: messages });
      }

      const toolResults = [];
      for (const use of toolUses) {
        if (use.name === 'present_table') {
          table = { title: use.input.title, columns: use.input.columns, rows: use.input.rows };
          toolResults.push({ type: 'tool_result', tool_use_id: use.id, content: 'Shown to the user.' });
          continue;
        }
        try {
          const result = await runDataTool(use.name, use.input || {});
          toolResults.push({ type: 'tool_result', tool_use_id: use.id, content: JSON.stringify(result) });
        } catch (e) {
          toolResults.push({ type: 'tool_result', tool_use_id: use.id, content: `Error: ${e.message}`, is_error: true });
        }
      }
      messages.push({ role: 'user', content: toolResults });
    }
    return NextResponse.json({ error: 'Took too many steps to answer - try a narrower question.' }, { status: 504 });
  } catch (err) {
    console.error('chat route error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
