/**
 * Worthy Products North: rep KPI targets against year-to-date sales.
 *
 * Re-runs the same selection rules as the three KPI scheduled actions in Odoo
 * (ir.cron 107, 110, 111; see lib/kpiTargets.js) so this table agrees with the
 * weekly KPI emails: calendar-year YTD to the last completed Sunday, posted
 * invoices less credit notes, untaxed, company 4.
 *
 * Totals only: the sums are done inside Odoo with read_group, so no invoice
 * rows are pulled and nothing can be silently truncated by a row limit.
 */
import { NextResponse } from 'next/server';
import { KPI_REPS, SERVICE_STATION_BRANDS } from '@/lib/kpiTargets';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ODOO = {
  url: process.env.ODOO_URL, db: process.env.ODOO_DB,
  user: process.env.ODOO_USER, pw: process.env.ODOO_PASSWORD,
};
const COMPANY = 4;

async function rpc(payload, timeoutMs = 45000) {
  const res = await fetch(`${ODOO.url}/jsonrpc`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload), signal: AbortSignal.timeout(timeoutMs),
  });
  return res.json();
}

async function connect() {
  const j = await rpc({ jsonrpc: '2.0', method: 'call', id: 1,
    params: { service: 'common', method: 'authenticate', args: [ODOO.db, ODOO.user, ODOO.pw, {}] } }, 15000);
  if (!j.result) throw new Error('Odoo authentication failed');
  const uid = j.result;
  return async (model, method, args, kwargs = {}, timeout = 45000) => {
    const r = await rpc({ jsonrpc: '2.0', method: 'call', id: 2,
      params: { service: 'object', method: 'execute_kw',
                args: [ODOO.db, uid, ODOO.pw, model, method, args, kwargs] } }, timeout);
    if (r.error) throw new Error(r.error.data?.message || r.error.message || `${model}.${method} failed`);
    return r.result;
  };
}

/* Dates: NZ calendar, last completed Monday-Sunday (as the Odoo crons do). */
const pad = (n) => String(n).padStart(2, '0');
const isoDate = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
function kpiDates(asOf) {
  const nz = new Date(new Date().toLocaleString('en-US', { timeZone: 'Pacific/Auckland' }));
  let today = new Date(Date.UTC(nz.getFullYear(), nz.getMonth(), nz.getDate()));
  if (/^\d{4}-\d{2}-\d{2}$/.test(asOf || '')) today = new Date(`${asOf}T00:00:00Z`);   // for checking against a sent email
  const weekday = (today.getUTCDay() + 6) % 7;                 // Monday = 0
  const weekStart = new Date(today.getTime() - (weekday + 7) * 864e5);
  const weekEnd = new Date(weekStart.getTime() + 6 * 864e5);
  const yearStart = new Date(Date.UTC(today.getUTCFullYear(), 0, 1));
  const daysInYear = (Date.UTC(today.getUTCFullYear() + 1, 0, 1) - yearStart.getTime()) / 864e5;
  const dayOfYear = Math.round((weekEnd.getTime() - yearStart.getTime()) / 864e5) + 1;
  return {
    yearStart: isoDate(yearStart), weekStart: isoDate(weekStart), weekEnd: isoDate(weekEnd),
    paceFraction: Math.max(0, Math.min(1, dayOfYear / daysInYear)),
  };
}

const orAll = (conds) => [...Array(Math.max(0, conds.length - 1)).fill('|'), ...conds];

function brandNameConds(prefix = '') {
  const out = [];
  for (const b of SERVICE_STATION_BRANDS) {
    out.push([`${prefix}name`, '=ilike', `${b} %`], [`${prefix}name`, '=ilike', `% ${b} %`],
             [`${prefix}name`, '=ilike', `% ${b}`], [`${prefix}name`, '=ilike', b]);
  }
  return out;
}

/* A partner "family": the partners, their commercial parents and their children. */
async function family(call, domain) {
  const rows = await call('res.partner', 'search_read', [domain],
    { fields: ['id', 'commercial_partner_id', 'child_ids'] }, 60000);
  const ids = new Set();
  for (const r of rows) {
    ids.add(r.id);
    if (r.commercial_partner_id) ids.add(r.commercial_partner_id[0]);
    for (const c of r.child_ids || []) ids.add(c);
  }
  return ids;
}

/* Untaxed invoices less credit notes for a domain, summed inside Odoo. */
async function netSales(call, base, start, end) {
  const g = await call('account.move', 'read_group',
    [[...base, ['invoice_date', '>=', start], ['invoice_date', '<=', end]], ['amount_untaxed:sum'], ['move_type']],
    { lazy: false }, 60000);
  let total = 0;
  for (const r of g) total += (r.move_type === 'out_refund' ? -1 : 1) * (r.amount_untaxed || 0);
  return total;
}

const invoiceBase = () => [
  ['state', '=', 'posted'], ['company_id', '=', COMPANY],
  ['move_type', 'in', ['out_invoice', 'out_refund']],
];

async function ytdAndWeek(call, base, d) {
  const [ytd, week] = await Promise.all([
    netSales(call, base, d.yearStart, d.weekEnd),
    netSales(call, base, d.weekStart, d.weekEnd),
  ]);
  return [ytd, week];
}

/* Rubin: three named Fresh Choice customers. */
async function rubin(call, cfg, d) {
  return ytdAndWeek(call, [...invoiceBase(), ['partner_id', 'in', cfg.customerIds]], d);
}

/* Naitik: invoices to service-station customers where Naitik is the account
 * manager on the customer or the person who raised the invoice. */
async function naitik(call, cfg, d) {
  const invConds = [
    ['partner_id.x_studio_many2one_field_IPrg0.x_name', '=ilike', 'Service Stations'],
    ['partner_id.category_id.name', 'in', SERVICE_STATION_BRANDS],
    ...brandNameConds('partner_id.'),
  ];
  return ytdAndWeek(call, [
    ...invoiceBase(),
    '|', ['invoice_user_id.name', '=ilike', `${cfg.repFirstName}%`],
         ['partner_id.user_id.name', '=ilike', `${cfg.repFirstName}%`],
    ...orAll(invConds),
  ], d);
}

/* Savan: must be a service-station family member AND on Savan's patch (or
 * invoiced by Savan), including the manually listed non-station stores. */
async function savan(call, cfg, d) {
  const pConds = [
    ['x_studio_many2one_field_IPrg0', 'ilike', 'Service Stations'],
    ['x_studio_many2one_field_IPrg0.x_name', '=ilike', 'Service Stations'],
    ['category_id.name', 'in', SERVICE_STATION_BRANDS],
    ...brandNameConds(),
  ];
  const station = await family(call, orAll(pConds));
  if (cfg.extraStoreNames?.length) {
    const extra = await family(call, orAll(cfg.extraStoreNames.map((n) => ['name', '=ilike', n])));
    extra.forEach((id) => station.add(id));
  }
  const mine = await family(call, [['user_id.name', '=ilike', `${cfg.repFirstName}%`]]);
  const stores = [...station].filter((id) => mine.has(id));
  return ytdAndWeek(call, [
    ...invoiceBase(),
    ['partner_id', 'in', [...station]],
    '|', ['partner_id', 'in', stores], ['invoice_user_id.name', '=ilike', `${cfg.repFirstName}%`],
  ], d);
}

const RUNNERS = { rubin, savan, naitik };
const r2 = (n) => Math.round(n * 100) / 100;

export async function GET(request) {
  try {
    const call = await connect();
    const d = kpiDates(new URL(request.url).searchParams.get('asOf'));
    const reps = await Promise.all(KPI_REPS.map(async (cfg) => {
      const [ytd, week] = await RUNNERS[cfg.key](call, cfg, d);
      const expected = cfg.target * d.paceFraction;
      return {
        rep: cfg.rep, group: cfg.group, scope: cfg.scope, cron: cfg.cron, target: cfg.target,
        ytd: r2(ytd), week: r2(week), remaining: r2(cfg.target - ytd),
        pctOfTarget: Math.round((ytd / cfg.target) * 1000) / 10,
        paceTarget: Math.round(expected), vsPace: r2(ytd - expected),
      };
    }));
    return NextResponse.json({
      ok: true, basis: 'Calendar year, ex GST, invoices less credit notes',
      period: { from: d.yearStart, to: d.weekEnd, lastWeekFrom: d.weekStart },
      paceFraction: Math.round(d.paceFraction * 1000) / 10, reps,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
