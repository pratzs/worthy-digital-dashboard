/**
 * A stand-in for Anthropic's streaming Messages API, for tests. It answers by script (no cost, no randomness), in the
 * same server-sent-event format the real service uses, so the chat endpoint's streaming code is exercised for real.
 *
 *   node scripts/stub-ai.mjs 3999            (or import { startStub } and use it inside a test)
 *
 * Scripts, chosen by the rep's latest message:
 *   SALES    -> asks for my_sales (and tries to name another rep in the arguments)
 *   CUSTOMER <name> -> asks for my_customer with that name
 *   PLAN     -> asks for my_action_plan
 *   SNEAK    -> asks for a management tool (odoo_search)
 *   TEXT     -> writes some text, THEN asks for a tool (so the page must drop that text)
 *   FAIL     -> the service answers with a billing error
 *   (a tool result just came back) -> a streamed answer that echoes the tool result, so a test can inspect what the AI was given
 *   anything else -> a short streamed answer
 */
import http from 'node:http';

const NEXT = '\nBased on: your test figures.\nNext questions: Which customers should I call first? | What are my best sellers? | How can I grow my sales?';

export function startStub(port = 3999) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let b = ''; req.on('data', (d) => (b += d)).on('end', () => {
      const body = JSON.parse(b); seen.push(body);
      const msgs = body.messages;
      const last = msgs[msgs.length - 1];
      const firstUser = [...msgs].reverse().find((m) => m.role === 'user' && typeof m.content === 'string')?.content || '';
      const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
      const begin = () => { res.writeHead(200, { 'content-type': 'text/event-stream' }); ev('message_start', { message: { usage: { input_tokens: 120 } } }); };
      const end = (reason) => { ev('message_delta', { delta: { stop_reason: reason }, usage: { output_tokens: 40 } }); ev('message_stop', {}); res.end(); };
      const text = (i, t) => { ev('content_block_start', { index: i, content_block: { type: 'text', text: '' } }); for (let k = 0; k < t.length; k += 18) ev('content_block_delta', { index: i, delta: { type: 'text_delta', text: t.slice(k, k + 18) } }); ev('content_block_stop', { index: i }); };
      const tool = (i, id, name, input) => { ev('content_block_start', { index: i, content_block: { type: 'tool_use', id, name, input: {} } }); const j = JSON.stringify(input); ev('content_block_delta', { index: i, delta: { type: 'input_json_delta', partial_json: j.slice(0, 7) } }); ev('content_block_delta', { index: i, delta: { type: 'input_json_delta', partial_json: j.slice(7) } }); ev('content_block_stop', { index: i }); };

      if (Array.isArray(last.content) && last.content[0]?.type === 'tool_result') {
        begin(); text(0, `RESULT:${last.content.map((c) => `${c.is_error ? 'ERR:' : ''}${c.content}`).join('||')}${NEXT}`); return end('end_turn');
      }
      if (firstUser.startsWith('FAIL')) { res.writeHead(400, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API.' } })); }
      begin();
      if (firstUser.startsWith('SALES')) { tool(0, 't1', 'my_sales', { rep: 'Keith', name: 'Savan Patel', company: 'south', fy: 2026 }); return end('tool_use'); }
      if (firstUser.startsWith('PLAN')) { tool(0, 't4', 'my_action_plan', {}); return end('tool_use'); }
      if (firstUser.startsWith('CUSTOMER')) { tool(0, 't5', 'my_customer', { name: firstUser.slice(9).trim() }); return end('tool_use'); }
      if (firstUser.startsWith('SNEAK')) { tool(0, 't3', 'odoo_search', { model: 'res.partner' }); return end('tool_use'); }
      if (firstUser.startsWith('TEXT')) { text(0, 'Let me check that for you. '); tool(1, 't6', 'my_sales', {}); return end('tool_use'); }
      text(0, `Hello from the stand-in.${NEXT}`); return end('end_turn');
    });
  });
  return new Promise((resolve) => server.listen(port, () => resolve({ server, seen })));
}

if (process.argv[1] && process.argv[1].endsWith('stub-ai.mjs')) {
  const port = Number(process.argv[2]) || 3999;
  await startStub(port);
  console.log(`stub AI listening on ${port}`);
}
