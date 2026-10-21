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
import { readFY } from '@/lib/odooFyCache';
import { readDebtors } from '@/lib/odooDebtorsCache';
import { handle as ostendoFyHandle } from '@/lib/ostendoFy';
import { computeSouthDebtors } from '@/lib/ostendoDebtors';
import { nzFinancialYear } from '@/lib/ostendo';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MODEL = 'claude-sonnet-5-5';

// North = Worthy Products North (Odoo company 4). Oceania = Worthy Oceania (Odoo
// company 1). South = Worthy Products South, which lives in Ostendo, not Odoo.
const ODOO_COMPANY = { north: 4, oceania: 1 };

const TOOLS = [
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
    name: 'present_table',
    description: 'Show the user a table. Call this once, as your last step, whenever the answer is '
      + 'naturally tabular (a list of customers, a month-by-month breakdown, a rep leaderboard, etc). '
      + 'Pick the columns and rows yourself from what the other tools returned - round money to whole '
      + 'dollars for readability, keep it to the rows that actually matter for the question asked.',
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

async function runTool(name, input) {
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

const SYSTEM = `You answer questions about Worthy's trading figures for a company director, using the `
  + `tools provided - never from memory or estimation. Worthy trades as three companies: north and `
  + `oceania (Odoo), south (Ostendo, separate tools). If a question doesn't say which company, ask `
  + `rather than guessing, unless it obviously means all three ("how are we doing overall"). State `
  + `dollar figures in NZD. When you present a table, also give a one or two sentence summary of the `
  + `headline in your own words - don't just dump the table with no comment.`;

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
    for (let turn = 0; turn < 6; turn++) {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 2000,
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
          const result = await runTool(use.name, use.input || {});
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
