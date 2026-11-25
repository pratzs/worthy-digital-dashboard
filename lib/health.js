/**
 * Daily health check (docs/HEALTH.md), run by the GitHub job .github/workflows/health.yml through /api/cron/health.
 * Each check answers { name, ok, detail }; `attention` is true when any check failed, which fails the job (GitHub
 * emails the owner).
 *
 *   Connections (improvement 10): Meta token, the Dutch Rusk app's Shopify reports key (Render can be asleep, so up to
 *   45 s), Asana, ClickUp, the worthy.nz forms key, the Google Analytics sign-in, and the saved last-good year figures
 *   for Worthy Products (Odoo company 4) and Worthy Oceania (company 1) being under 2 hours old.
 *
 *   Sales codes (improvement 11): a new freight product or a related-company partner would slip into sales silently,
 *   because lib/salesBasis.js leaves out only the ids it knows. Over the last 14 days of posted customer invoices in
 *   companies 4 and 1 it reports (product id + name, partner id + name; never amounts or customers):
 *     - a product on a 6030 / 7310 line that is not in FREIGHT_PRODUCT_IDS,
 *     - a product named like freight / shipping / delivery / courier that is not in FREIGHT_PRODUCT_IDS,
 *     - an invoice partner named like one of our own companies that is not in that company's SISTER_SETS.
 *   Each is one small read_group on 14 days of invoices, so the check is light on Odoo.
 *
 * A key that is not set (as on a local machine) reports "not configured" and does not fail the check, except on Vercel
 * production, where a missing key is a failure (it means the key was removed).
 */
import { FREIGHT_ACCOUNTS, FREIGHT_PRODUCT_IDS, sisterIdsOf } from '@/lib/salesBasis';
import { odooExec } from '@/lib/repData';
import { kvGet, storeConnected } from '@/lib/repStore';
import { shopifyql } from '@/lib/webStats';
import { ga4Configured, ga4Token } from '@/lib/ga4';
import { ASANA_PROJECT, asanaConfigured } from '@/lib/asana';
import { clickupConfigured } from '@/lib/clickup';
import { formsConfigured, worthyEnquiries } from '@/lib/worthyForms';
import { nzToday, nzFinancialYear } from '@/lib/ostendo';

const DAYS = 14;
const FY_MAX_AGE_H = 2;
const COMPANY_NAMES = { 4: 'Worthy Products', 1: 'Worthy Oceania' };
const FREIGHT_NAME = ['%freight%', '%shipping%', '%delivery%', '%courier%'];
const OWN_NAME = ['%worthy%', '%dutch%rusk%', '%vj%trading%'];
// Products or partners checked and accepted as fine (comma-separated ids), so a known one stops alerting without a deploy.
const ids = (v) => String(v || '').split(',').map((x) => Number(x.trim())).filter((n) => Number.isInteger(n) && n > 0);
const IGNORE_PRODUCTS = () => ids(process.env.HEALTH_IGNORE_PRODUCT_IDS);
const IGNORE_PARTNERS = () => ids(process.env.HEALTH_IGNORE_PARTNER_IDS);

const onProduction = () => process.env.VERCEL_ENV === 'production';
const short = (e) => String(e?.message || e).replace(/access_token=[^&\s]+/g, 'access_token=…').slice(0, 160);
const notConfigured = (name, what) => ({ name, ok: !onProduction(), detail: `not configured (${what} is not set)` });

async function check(name, fn) {
  const t = Date.now();
  try { const r = await fn(); return { name, ...r, ms: Date.now() - t }; }
  catch (e) { return { name, ok: false, detail: short(e), ms: Date.now() - t }; }
}

// ── connections ─────────────────────────────────────────────────────────────────────────────────
async function metaCheck() {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) return notConfigured('Meta token', 'META_ACCESS_TOKEN');
  return check('Meta token', async () => {
    const get = async (path, params) => {
      const u = new URL(`https://graph.facebook.com/v23.0/${path}`);
      for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
      u.searchParams.set('access_token', token);
      const res = await fetch(u, { signal: AbortSignal.timeout(20000), cache: 'no-store' });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) throw new Error(`Meta ${res.status}: ${j.error?.message || 'error'}`);
      return j;
    };
    await get('me', { fields: 'id' });
    const pages = (await get('me/accounts', { fields: 'id', limit: '5' })).data || [];
    return pages.length ? { ok: true, detail: `reads me and ${pages.length} page(s)` } : { ok: false, detail: 'token works but sees no Facebook page' };
  });
}

async function shopifyCheck() {
  if (!process.env.DUTCHRUSK_REPORTS_KEY) return notConfigured('Dutch Rusk Shopify reports', 'DUTCHRUSK_REPORTS_KEY');
  return check('Dutch Rusk Shopify reports', async () => {
    const rows = await shopifyql('FROM sales SHOW orders SINCE today UNTIL today', 'dutchrusk');   // 45 s timeout inside
    return { ok: Array.isArray(rows), detail: 'the Dutch Rusk app answered a report query' };
  });
}

async function asanaCheck() {
  if (!asanaConfigured()) return notConfigured('Asana', 'ASANA_TOKEN');
  return check('Asana', async () => {
    const res = await fetch(`https://app.asana.com/api/1.0/projects/${ASANA_PROJECT}?opt_fields=name`, {
      headers: { Authorization: `Bearer ${process.env.ASANA_TOKEN}`, Accept: 'application/json' }, signal: AbortSignal.timeout(15000), cache: 'no-store',
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Asana ${res.status}: ${j.errors?.[0]?.message || 'error'}`);
    return { ok: true, detail: 'reads the Ecom x Marketing project' };
  });
}

async function clickupCheck() {
  if (!clickupConfigured()) return notConfigured('ClickUp', 'CLICKUP_TOKEN');
  return check('ClickUp', async () => {
    // The first list the Command Center reads (same default as lib/clickup.js).
    const list = (process.env.CLICKUP_LISTS || '901613878266').split(',')[0].trim();
    const res = await fetch(`https://api.clickup.com/api/v2/list/${list}`, {
      headers: { Authorization: process.env.CLICKUP_TOKEN }, signal: AbortSignal.timeout(15000), cache: 'no-store',
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`ClickUp ${res.status}: ${j.err || 'error'}`);
    return { ok: true, detail: 'reads the E-Commerce list' };
  });
}

async function formsCheck() {
  if (!formsConfigured()) return notConfigured('worthy.nz forms', 'WORTHY_FORMS_KEY');
  return check('worthy.nz forms', async () => {
    const day = nzToday();
    const r = await worthyEnquiries(day, day);   // only the status is kept; no names leave this function
    return r.status === 'ok' ? { ok: true, detail: 'the worthy.nz enquiries endpoint answered' } : { ok: false, detail: `status ${r.status}` };
  });
}

async function ga4Check() {
  if (!ga4Configured()) return notConfigured('Google Analytics sign-in', 'the Vercel OIDC token');
  return check('Google Analytics sign-in', async () => { await ga4Token(); return { ok: true, detail: 'signed in as the read-only reader' }; });
}

// The saved last-good year figures (lib/odooFyCache.js lastKey). The key version follows odoo-fy-v8; after a bump this
// check reports "no saved copy" until the version here is bumped too, which is the reminder.
const FY_LAST_KEY = (cid, fy) => `fy:last:v8:${cid}:${fy}`;
async function fyCheck(cid) {
  const name = `Saved year figures, ${COMPANY_NAMES[cid]}`;
  if (!storeConnected()) return notConfigured(name, 'the Upstash store (KV_REST_API_URL / KV_REST_API_TOKEN)');
  return check(name, async () => {
    const fy = nzFinancialYear();
    const raw = await kvGet(FY_LAST_KEY(cid, fy));
    if (!raw) return { ok: false, detail: `no saved copy for FY${fy}` };
    const at = JSON.parse(raw)?.generatedAt;
    const ageH = at ? (Date.now() - Date.parse(at)) / 3600000 : NaN;
    if (!Number.isFinite(ageH)) return { ok: false, detail: `FY${fy} saved copy has no read time` };
    const when = new Date(at).toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland', dateStyle: 'medium', timeStyle: 'short' });
    return { ok: ageH < FY_MAX_AGE_H, detail: `FY${fy} read from Odoo ${when} NZ (${ageH.toFixed(1)} h ago, limit ${FY_MAX_AGE_H} h)` };
  });
}

// ── sales codes ────────────────────────────────────────────────────────────────────────────────
const daysAgo = (n) => new Date(Date.parse(`${nzToday()}T00:00:00Z`) - n * 86400000).toISOString().slice(0, 10);
const anyOf = (field, op, values) => [...Array(values.length - 1).fill('|'), ...values.map((v) => [field, op, v])];
const named = (g, field) => (Array.isArray(g[field]) ? { id: g[field][0], name: String(g[field][1] || '').slice(0, 80) } : null);
const list = (xs) => xs.map((x) => `${x.id} ${x.name}`).join('; ');

async function salesCodeChecks(exec, cid) {
  const co = COMPANY_NAMES[cid];
  const from = daysAgo(DAYS);
  const ctx = { context: { allowed_company_ids: [cid], company_id: cid } };
  const lineBase = [['move_id.company_id', '=', cid], ['move_id.state', '=', 'posted'], ['move_id.move_type', 'in', ['out_invoice', 'out_refund']],
    ['move_id.invoice_date', '>=', from], ['product_id', '!=', false], ['product_id', 'not in', [...FREIGHT_PRODUCT_IDS, ...IGNORE_PRODUCTS()]]];
  const products = async (extra) => (await exec('account.move.line', 'read_group', [[...lineBase, ...extra], ['product_id'], ['product_id']],
    { lazy: false, limit: 30, ...ctx }, 60000)).map((g) => named(g, 'product_id')).filter(Boolean);

  return Promise.all([
    check(`${co}: freight accounts carry only freight products`, async () => {
      const found = await products([['account_id.code', 'in', FREIGHT_ACCOUNTS]]);
      return found.length
        ? { ok: false, detail: `on ${FREIGHT_ACCOUNTS.join('/')} in the last ${DAYS} days but not in FREIGHT_PRODUCT_IDS: ${list(found)}`, items: found }
        : { ok: true, detail: `none in the last ${DAYS} days` };
    }),
    check(`${co}: freight-named products are known`, async () => {
      const found = await products(anyOf('product_id.name', '=ilike', FREIGHT_NAME));
      return found.length
        ? { ok: false, detail: `named like freight, invoiced in the last ${DAYS} days, not in FREIGHT_PRODUCT_IDS: ${list(found)}`, items: found }
        : { ok: true, detail: `none in the last ${DAYS} days` };
    }),
    check(`${co}: own-company partners are sisters`, async () => {
      const groups = await exec('account.move', 'read_group', [[['company_id', '=', cid], ['state', '=', 'posted'], ['move_type', 'in', ['out_invoice', 'out_refund']],
        ['invoice_date', '>=', from], ['commercial_partner_id', 'not in', [...sisterIdsOf(cid), ...IGNORE_PARTNERS()]],
        ...anyOf('commercial_partner_id.name', '=ilike', OWN_NAME)], ['commercial_partner_id'], ['commercial_partner_id']],
        { lazy: false, limit: 30, ...ctx }, 60000);
      const found = groups.map((g) => named(g, 'commercial_partner_id')).filter(Boolean);
      return found.length
        ? { ok: false, detail: `invoiced in the last ${DAYS} days, named like our own company, not in SISTER_SETS[${cid}]: ${list(found)}`, items: found }
        : { ok: true, detail: `none in the last ${DAYS} days` };
    }),
  ]);
}

async function odooChecks() {
  if (!process.env.ODOO_URL) return [notConfigured('Odoo sales codes', 'ODOO_URL')];
  let exec;
  try { exec = await odooExec(); } catch (e) { return [{ name: 'Odoo sign-in', ok: false, detail: short(e) }]; }
  // One company at a time, so Odoo gets at most three small reads at once.
  const out = [];
  for (const cid of [4, 1]) out.push(...(await salesCodeChecks(exec, cid)));
  return out;
}

export async function healthChecks() {
  const started = Date.now();
  const [connections, codes] = await Promise.all([
    Promise.all([metaCheck(), shopifyCheck(), asanaCheck(), clickupCheck(), formsCheck(), ga4Check(), fyCheck(4), fyCheck(1)]),
    odooChecks(),
  ]);
  const checks = [...connections, ...codes];
  const failed = checks.filter((c) => !c.ok);
  return {
    attention: failed.length > 0,
    failed: failed.map((c) => `${c.name}: ${c.detail}`),
    checks,
    window: { days: DAYS, from: daysAgo(DAYS), to: nzToday() },
    ms: Date.now() - started,
  };
}
