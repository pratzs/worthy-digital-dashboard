/**
 * AI search for the Command Center (Search tab, "AI search").
 *
 *   referrals   Visits that came from AI assistants (ChatGPT, Perplexity, Gemini, Copilot, Claude...), from GA4: which
 *               assistant, which page they landed on, and whether they enquired or bought.
 *   checks      The questions our customers ask, put to Claude with live web search, as a customer would. For each answer:
 *               do we get named, which of our pages get cited, and who gets cited instead. Kept in the dashboard
 *               database. Runs when the page asks and the last run is over a day old, or on "Check now".
 *
 * Assistants: Claude (ANTHROPIC_API_KEY), ChatGPT (OPENAI_API_KEY), Gemini (GEMINI_API_KEY), Perplexity (PERPLEXITY_API_KEY).
 * One without a key shows as not connected; nothing is guessed. Copilot has no public API, so it shows visits only.
 * Cost: 15 questions x each connected assistant (one answer + a few web searches) per run, once a day at most.
 */
import Anthropic from '@anthropic-ai/sdk';
import { ga4Configured, ga4Property, ga4Report } from '@/lib/ga4';
import { kvGet, kvSet, kvPush, kvRange } from '@/lib/repStore';

const MODEL = process.env.AI_CHECK_MODEL || 'claude-opus-5-5';
const LATEST_KEY = 'cc:ai:latest:v2';
const HIST_KEY = 'cc:ai:hist:v2';

export const AI_SOURCES = [
  ['ChatGPT', /chatgpt|openai/i],
  ['Perplexity', /perplexity/i],
  ['Gemini', /gemini|bard/i],
  ['Copilot', /copilot/i],
  ['Claude', /claude|anthropic/i],
  ['Other AI', /you\.com|phind|deepseek|meta\.ai|grok|mistral/i],
];
const AI_REGEX = 'chatgpt|openai|perplexity|gemini|bard|copilot|claude|anthropic|you\\.com|phind|deepseek|meta\\.ai|grok|mistral';
const assistantOf = (source) => (AI_SOURCES.find(([, re]) => re.test(source || '')) || ['Other AI'])[0];

// Who we are, so an answer can be scored. A name counts as a mention; one of our domains in the sources counts as a citation.
const SITE_ID = {
  worthy: { names: [/\bworthy\b(?!\s*products)/i, /worthy\.nz/i], domains: ['worthy.nz'] },
  worthyproducts: { names: [/worthy\s*products/i, /worthyproducts/i], domains: ['worthyproducts.nz'] },
  dutchrusk: { names: [/dutch\s*rusk/i], domains: ['dutchrusk.co.nz'] },
};
const OUR_DOMAINS = ['worthy.nz', 'worthyproducts.nz', 'dutchrusk.co.nz'];

/** Questions a buyer would really ask an AI assistant. Edit freely; ids keep history lined up. */
export const AI_QUESTIONS = [
  { id: 'w1', site: 'worthy', q: 'Which company distributes Calypso lemonade in New Zealand?' },
  { id: 'w2', site: 'worthy', q: 'Who imports Ferrarelle sparkling water into New Zealand?' },
  { id: 'w3', site: 'worthy', q: 'I want to bring an international food or drink brand into New Zealand supermarkets. Which FMCG distributors should I talk to?' },
  { id: 'w4', site: 'worthy', q: 'Where can a New Zealand shop get free samples of new FMCG products to try?' },
  { id: 'w5', site: 'worthy', q: 'Which New Zealand companies export food, drinks and fabrics to the Pacific Islands?' },
  { id: 'p1', site: 'worthyproducts', q: 'Where can a dairy in Auckland buy confectionery and drinks wholesale?' },
  { id: 'p2', site: 'worthyproducts', q: 'Best wholesale snack and drink suppliers for convenience stores in New Zealand?' },
  { id: 'p3', site: 'worthyproducts', q: 'Where can I buy Takis wholesale in New Zealand?' },
  { id: 'p4', site: 'worthyproducts', q: 'Is there a cash and carry wholesaler near Mount Roskill, Auckland?' },
  { id: 'p5', site: 'worthyproducts', q: 'Where can a business order Kinder and Ferrero chocolate wholesale online in NZ?' },
  { id: 'd1', site: 'dutchrusk', q: 'Who is a good wholesale confectionery supplier in Christchurch?' },
  { id: 'd2', site: 'dutchrusk', q: 'Which wholesaler supplies sweets and drinks to dairies in the South Island of New Zealand?' },
  { id: 'd3', site: 'dutchrusk', q: 'Where is Dutch Rusk based and how do I open a trade account?' },
  { id: 'd4', site: 'dutchrusk', q: 'Confectionery wholesaler in Nelson, New Zealand' },
  { id: 'd5', site: 'dutchrusk', q: 'Where can a Christchurch store buy energy drinks wholesale?' },
];

const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const ours = (host) => OUR_DOMAINS.find((d) => host === d || host.endsWith(`.${d}`));

let client;
const anthropic = () => (client ||= new Anthropic());

const SYSTEM = 'You are a helpful assistant answering a shopper or business owner in New Zealand. Search the web, then answer in a short paragraph or list, naming the specific businesses you would recommend and where they are.';

/** Each AI assistant we can put a question to. Copilot has no public way to ask, so it shows visits only. */
export const ENGINES = [
  { id: 'claude', name: 'Claude', key: 'ANTHROPIC_API_KEY' },
  { id: 'chatgpt', name: 'ChatGPT', key: 'OPENAI_API_KEY' },
  { id: 'gemini', name: 'Gemini', key: 'GEMINI_API_KEY' },
  { id: 'perplexity', name: 'Perplexity', key: 'PERPLEXITY_API_KEY' },
];

async function askClaude(q) {
  const messages = [{ role: 'user', content: q }];
  let res;
  // Web search is a server tool; a long search turn can come back as pause_turn and is continued as is.
  for (let i = 0; i < 3; i++) {
    res = await anthropic().beta.messages.create({
      model: MODEL,
      max_tokens: 4000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low' },
      system: SYSTEM,
      // The basic search tool on purpose: the filtering version searches inside code and returns no sources to score.
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3, user_location: { type: 'approximate', country: 'NZ', city: 'Auckland' } }],
      messages,
    });
    if (res.stop_reason !== 'pause_turn') break;
    messages.push({ role: 'assistant', content: res.content });
  }
  if (res?.stop_reason === 'refusal') return { refused: true };
  const blocks = res?.content || [];
  const cited = [];
  blocks.forEach((b) => (b.type === 'text' ? (b.citations || []) : []).forEach((c) => { if (c.url) cited.push({ url: c.url, title: c.title || '' }); }));
  const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  return { text, cited: cited.concat(linksIn(text)), model: res?.model || MODEL };
}

// Links written into an answer count as citations too
const linksIn = (text) => [...new Set((text.match(/https?:\/\/[^\s)\]>"']+/g) || []).map((u) => u.replace(/[.,;]+$/, '')))].map((url) => ({ url, title: '' }));

// The other assistants, through their own web-search APIs. Models can be changed with env vars.
async function postJson(url, headers, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(120000) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${res.status}: ${j.error?.message || j.error || 'error'}`.slice(0, 200));
  return j;
}
async function askChatGPT(q) {
  const model = process.env.OPENAI_CHECK_MODEL || 'gpt-5';
  const j = await postJson('https://api.openai.com/v1/responses', { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    { model, instructions: SYSTEM, input: q, tools: [{ type: 'web_search', user_location: { type: 'approximate', country: 'NZ', city: 'Auckland' } }] });
  let text = '';
  const cited = [];
  (j.output || []).forEach((o) => (o.content || []).forEach((c) => {
    if (c.type === 'output_text') { text += c.text || ''; (c.annotations || []).forEach((a) => { if (a.url) cited.push({ url: a.url, title: a.title || '' }); }); }
  }));
  return { text: text.trim(), cited: cited.concat(linksIn(text)), model: j.model || model };
}
async function askGemini(q) {
  const model = process.env.GEMINI_CHECK_MODEL || 'gemini-2.5-flash';
  const j = await postJson(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { 'x-goog-api-key': process.env.GEMINI_API_KEY },
    { systemInstruction: { parts: [{ text: SYSTEM }] }, contents: [{ role: 'user', parts: [{ text: q }] }], tools: [{ google_search: {} }] });
  const cand = j.candidates?.[0];
  const text = (cand?.content?.parts || []).map((p) => p.text || '').join('').trim();
  // Grounding links are Google redirect URLs; their title carries the real domain.
  const cited = (cand?.groundingMetadata?.groundingChunks || []).map((c) => c.web).filter(Boolean)
    .map((w) => ({ url: /^[\w.-]+\.[a-z]{2,}$/i.test(w.title || '') ? `https://${w.title}` : w.uri, title: w.title || '' }));
  return { text, cited: cited.concat(linksIn(text)), model };
}
async function askPerplexity(q) {
  const model = process.env.PERPLEXITY_CHECK_MODEL || 'sonar';
  const j = await postJson('https://api.perplexity.ai/chat/completions', { Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}` },
    { model, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: q }] });
  const text = (j.choices?.[0]?.message?.content || '').trim();
  const cited = (j.search_results || []).map((r) => ({ url: r.url, title: r.title || '' })).concat((j.citations || []).map((u) => ({ url: u, title: '' }))).filter((u) => u.url);
  return { text, cited, model };
}
const ASK = { claude: askClaude, chatgpt: askChatGPT, gemini: askGemini, perplexity: askPerplexity };

function score(item, out) {
  if (out.refused) return { status: 'refused' };
  const text = out.text || '';
  const mentioned = SITE_ID[item.site].names.some((re) => re.test(text));
  const ourCited = [...new Map(out.cited.filter((c) => ours(hostOf(c.url))).map((c) => [c.url, { url: c.url, title: c.title }])).values()];
  const others = [...new Set(out.cited.map((c) => hostOf(c.url)).filter((h) => h && !ours(h) && !/vertexaisearch|google\.com$/.test(h)))].slice(0, 6);
  return {
    status: 'ok', mentioned, cited: ourCited.length > 0, ourCited, others,
    staleNelson: item.site === 'dutchrusk' && mentioned && /nelson|echodale/i.test(text),
    answer: text.slice(0, 2500), model: out.model,
  };
}

async function askAll(item) {
  const engines = {};
  await Promise.all(ENGINES.map(async (e) => {
    if (!process.env[e.key]) { engines[e.id] = { status: 'no_key' }; return; }
    try { engines[e.id] = score(item, await ASK[e.id](item.q)); }
    catch (err) { engines[e.id] = { status: 'error', error: String(err.message || err).slice(0, 200) }; }
  }));
  return { ...item, at: new Date().toISOString(), engines };
}

/** Ask every question again, of every assistant that has a key. */
export async function runChecks() {
  // All at once, so a run finishes inside one request
  const out = await Promise.all(AI_QUESTIONS.map(askAll));
  const run = { at: new Date().toISOString(), engines: ENGINES.map((e) => ({ id: e.id, name: e.name, connected: Boolean(process.env[e.key]) })), results: out };
  await kvSet(LATEST_KEY, JSON.stringify(run));
  const summary = { at: run.at };
  ENGINES.forEach((e) => {
    const r = out.map((x) => x.engines[e.id]).filter((x) => x?.status === 'ok');
    if (r.length) summary[e.id] = { asked: r.length, mentioned: r.filter((x) => x.mentioned).length, cited: r.filter((x) => x.cited).length };
  });
  await kvPush(HIST_KEY, JSON.stringify(summary), 120);
  return run;
}

export async function latestChecks() {
  const [raw, hist] = await Promise.all([kvGet(LATEST_KEY).catch(() => null), kvRange(HIST_KEY, 60).catch(() => [])]);
  let latest = null;
  try { latest = raw ? JSON.parse(raw) : null; } catch { latest = null; }
  return { latest, history: hist.map((x) => { try { return JSON.parse(x); } catch { return null; } }).filter(Boolean).reverse() };
}

/** Visits from AI assistants on one GA4 site: by assistant, and by landing page. */
async function referralsSite(siteId, start, end) {
  const filter = { filter: { fieldName: 'sessionSource', stringFilter: { matchType: 'FULL_REGEXP', value: `.*(${AI_REGEX}).*`, caseSensitive: false } } };
  const [bySource, byPage] = await Promise.all([
    ga4Report(ga4Property(siteId), { dateRanges: [{ startDate: start, endDate: end }], dimensions: [{ name: 'sessionSource' }], metrics: [{ name: 'sessions' }, { name: 'sessionKeyEventRate' }, { name: 'purchaseRevenue' }], dimensionFilter: filter, limit: 50 }),
    ga4Report(ga4Property(siteId), { dateRanges: [{ startDate: start, endDate: end }], dimensions: [{ name: 'sessionSource' }, { name: 'landingPage' }], metrics: [{ name: 'sessions' }, { name: 'sessionKeyEventRate' }, { name: 'engagementRate' }], dimensionFilter: filter, orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: 40 }),
  ]);
  const assistants = {};
  bySource.forEach((r) => { const a = assistantOf(r.sessionSource); const o = assistants[a] || { name: a, sessions: 0, conversions: 0, revenue: 0 }; o.sessions += r.sessions; o.conversions += Math.round(r.sessions * r.sessionKeyEventRate);   // visits that converted, never more than visits
    o.revenue += r.purchaseRevenue; assistants[a] = o; });
  return {
    id: siteId, status: 'ok',
    assistants: Object.values(assistants).sort((a, b) => b.sessions - a.sessions),
    pages: byPage.map((r) => ({ assistant: assistantOf(r.sessionSource), page: r.landingPage, sessions: r.sessions, conversions: Math.round(r.sessions * r.sessionKeyEventRate), engagement: r.engagementRate })),
  };
}

export async function aiReferrals(start, end) {
  if (!ga4Configured()) return [];
  return Promise.all(['worthy', 'worthyproducts', 'dutchrusk'].map((id) => referralsSite(id, start, end).catch((e) => ({ id, status: 'error', error: String(e.message || e).slice(0, 200) }))));
}

// Google AI Overviews and AI Mode: Search Console's "Generative AI" report has no API yet, so its figures are read from
// the report in a signed-in browser and saved here, one entry per site.
const GOOGLE_AI_KEY = 'cc:googleai:v1';
export async function readGoogleAi() {
  try { const raw = await kvGet(GOOGLE_AI_KEY); return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}
export async function saveGoogleAi(site, data) {
  if (!['worthy', 'worthyproducts', 'dutchrusk'].includes(site)) throw new Error('Unknown site');
  const ok = (d) => /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(d || '');
  if (!data || !ok(data.start) || !ok(data.end) || !Number.isFinite(Number(data.impressions))) throw new Error('Bad figures');
  const all = await readGoogleAi();
  all[site] = {
    start: data.start, end: data.end, impressions: Number(data.impressions), shown: String(data.shown || data.impressions).slice(0, 20),
    pages: (data.pages || []).slice(0, 25).map((p) => ({ url: String(p.url).slice(0, 300), impressions: Number(p.impressions) || 0 })),
    savedAt: new Date().toISOString(),
  };
  await kvSet(GOOGLE_AI_KEY, JSON.stringify(all));
  return all;
}
