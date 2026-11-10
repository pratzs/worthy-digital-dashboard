/**
 * Prompt caching for the dashboard's own AI calls. Every step of a question re-sends the same long instructions and
 * tool list, and then the same conversation so far; Anthropic charges a tenth of the normal price for the part it has
 * seen in the last five minutes, if the request marks where that part ends. This marks three places: the end of the
 * tool list, the end of the instructions, and the end of the conversation so far. Nothing about the answer changes.
 *
 * The marks are put on COPIES, so the conversation kept by the caller (and sent back to the browser) never carries them.
 */
const MARK = { type: 'ephemeral' };

export function cachedRequest({ system, tools, messages }) {
  const t = Array.isArray(tools) && tools.length ? [...tools.slice(0, -1), { ...tools[tools.length - 1], cache_control: MARK }] : tools;
  const sys = typeof system === 'string' && system ? [{ type: 'text', text: system, cache_control: MARK }] : system;
  const msgs = Array.isArray(messages) ? messages.slice() : messages;
  const last = Array.isArray(msgs) && msgs.length ? msgs[msgs.length - 1] : null;
  if (last && last.role === 'user') {
    const blocks = typeof last.content === 'string' ? [{ type: 'text', text: last.content }] : Array.isArray(last.content) ? last.content.slice() : null;
    const end = blocks && blocks.length ? blocks[blocks.length - 1] : null;
    if (end && ['text', 'tool_result'].includes(end.type) && (end.type !== 'text' || end.text)) {
      blocks[blocks.length - 1] = { ...end, cache_control: MARK };
      msgs[msgs.length - 1] = { ...last, content: blocks };
    }
  }
  return { system: sys, tools: t, messages: msgs };
}
