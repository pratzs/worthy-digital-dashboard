/**
 * What the dashboard's own AI use costs. Everything that runs on Worthy's Anthropic key (the dashboard chat, the team
 * leads' My Account assistant, the AI Insights buttons) records its token counts per person per month (lib/repStore.js),
 * and this turns those counts into dollars. Connectors in a person's own Claude or ChatGPT account cost Worthy nothing
 * and are not counted here.
 *
 * Prices are Anthropic's list prices for claude-sonnet-5-5 in US dollars per million tokens. If the model or the price
 * changes, change it here and every figure on the usage page follows.
 */
export const PRICE_USD_PER_MILLION = { in: 2.0, out: 10.0, cacheRead: 0.10, cacheWrite: 2.50 };

/** tokens: { inTok, outTok, crTok (read from cache), cwTok (written to cache) } -> US dollars */
export function costUsd(t) {
  const p = PRICE_USD_PER_MILLION;
  return ((Number(t?.inTok) || 0) * p.in + (Number(t?.outTok) || 0) * p.out
    + (Number(t?.crTok) || 0) * p.cacheRead + (Number(t?.cwTok) || 0) * p.cacheWrite) / 1e6;
}

/** Adds one Anthropic `usage` object to a running total. */
export function addUsage(total, usage) {
  total.inTok = (total.inTok || 0) + (Number(usage?.input_tokens) || 0);
  total.outTok = (total.outTok || 0) + (Number(usage?.output_tokens) || 0);
  total.crTok = (total.crTok || 0) + (Number(usage?.cache_read_input_tokens) || 0);
  total.cwTok = (total.cwTok || 0) + (Number(usage?.cache_creation_input_tokens) || 0);
  return total;
}

/** The name a dashboard person's allowance and cost are kept under (team leads keep their own key, e.g. "michelle"). */
export const chatWho = (person) => `d.${person}`;

/** The New Zealand month right now, e.g. "2026-11". */
export const nzMonth = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland', year: 'numeric', month: '2-digit' }).format(d).slice(0, 7);
