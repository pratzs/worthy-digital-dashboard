/**
 * Worthy Products North / Oceania - cost per salesperson per WEEK, one month.
 *
 * Kept out of /api/odoo/fy deliberately. Cost is quantity x product standard
 * cost, so week-level cost needs the lines grouped by product AND day, for each
 * rep. Over a financial year that is far too much to carry on every page load.
 * The weekly view only ever shows one month, so this fetches exactly that month
 * and nothing more.
 */
import { sisterIdsOf, ON_BASIS, NOT_FREIGHT } from '@/lib/salesBasis';
import { cachedAuth } from '@/lib/odooAuth';
import { loadUnitCosts, makeQtyInProductUnit } from '@/lib/odooCost';
import { repGroup, usesFinanceBasis } from '@/lib/odooReps';
import { NextResponse } from 'next/server';
import { readWeeks } from '@/lib/odooWeeksCache';
import { toCents, toDollars, pct1 } from '@/lib/ostendo';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;   // a cold read, or waiting on another visitor's read, can take a few minutes when Odoo is busy

const NORTH = 4; // Worthy Products North. Oceania (company 1) is read in its own company too.
async function connect(cid) {
  const { ODOO_URL: url, ODOO_DB: db, ODOO_USER: user, ODOO_PASSWORD: pw } = process.env;
  const call = async (p) => (await fetch(`${url}/jsonrpc`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p),
    signal: AbortSignal.timeout(45000) })).json();
  const auth = await cachedAuth(() => call({ jsonrpc: '2.0', method: 'call', id: 1,
    params: { service: 'common', method: 'authenticate', args: [db, user, pw, {}] } }), url, db, user);
  if (!auth.result) throw new Error('Odoo authentication failed');
  return async (model, method, args, kwargs = {}) => {
    // Company-scoped: cost is held per company, so never read it in the user's default one.
    const scoped = { ...kwargs, context: { allowed_company_ids: [cid], company_id: cid, ...(kwargs.context || {}) } };
    const r = await call({ jsonrpc: '2.0', method: 'call', id: 2,
      params: { service: 'object', method: 'execute_kw',
                args: [db, auth.result, pw, model, method, args, scoped] } });
    if (r.error) throw new Error(r.error.data?.message || r.error.message || `${model}.${method}`);
    return r.result;
  };
}

const dayOf = (v) => String(v ?? '').substring(0, 10);
// Weeks run Monday to Sunday, clipped to the month (week 1 may be a short stub); same rule as lib/odooFy.js.
const weekOf = (iso) => {
  const lead = (new Date(`${iso.substring(0, 7)}-01T00:00:00Z`).getUTCDay() + 6) % 7;
  return Math.floor((Number(iso.substring(8, 10)) - 1 + lead) / 7) + 1;
};

export async function GET(request) {
  const p = new URL(request.url).searchParams;
  const cid = parseInt(p.get('company') || '4', 10);
  const month = p.get('month');                       // "2026-09"
  if (!/^\d{4}-\d{2}$/.test(month || '')) return NextResponse.json({ error: 'month=YYYY-MM required' }, { status: 400 });
  const start = `${month}-01`;
  const lastDay = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  const end = `${month}-${String(lastDay).padStart(2, '0')}`;

  // Reads Odoo. Run through readWeeks so only one read per company and month runs at a time (lib/odooWeeksCache.js).
  const compute = async () => {
    const exec = await connect(cid);
    const lineDom = (type) => [
      ['move_id.company_id', '=', cid], ['move_id.move_type', '=', type],
      ['move_id.state', '=', 'posted'],
      ['move_id.invoice_date', '>=', start], ['move_id.invoice_date', '<=', end],
      ['display_type', '=', 'product'], ['product_id', '!=', false], ['date', '!=', false],
      // Worthy Products never includes sales to its sister companies (docs/SALES-BASIS.md).
      ...(ON_BASIS(cid) ? [['move_id.commercial_partner_id', 'not in', sisterIdsOf(cid)], ...NOT_FREIGHT] : []),   // freight never counted
    ];

    // Who sold in this month, and what each invoice is worth per day.
    const moves = await exec('account.move', 'read_group',
      [[['company_id', '=', cid], ['move_type', 'in', ['out_invoice', 'out_refund']],
        ['state', '=', 'posted'], ['invoice_date', '>=', start], ['invoice_date', '<=', end],
        ...(ON_BASIS(cid) ? [['commercial_partner_id', 'not in', sisterIdsOf(cid)]] : [])],
       ['amount_untaxed:sum'], ['invoice_date:day', 'invoice_user_id', 'move_type']], { lazy: false });

    /* North reports like finance does: the eight field reps one by one and everyone
       else (including invoices with no salesperson) as "Direct", and sales are
       PRODUCT LINES only. So here a group is a set of users, and its revenue comes
       from the same product lines its cost does. Other companies keep one row per
       user and the invoice total. */
    const financeBasis = usesFinanceBasis(cid) || ON_BASIS(cid);
    const groups = new Map();    // group name -> user ids (false = no salesperson)
    const revenue = new Map();   // "group|week" -> cents
    for (const r of moves) {
      const d = dayOf(r.__range?.['invoice_date:day']?.from); if (!d) continue;
      const raw = r.invoice_user_id ? r.invoice_user_id[1] : 'Unassigned';
      const name = repGroup(cid, raw);
      const ids = groups.get(name) || new Set();
      ids.add(r.invoice_user_id ? r.invoice_user_id[0] : false); groups.set(name, ids);
      if (financeBasis) continue;
      const sign = r.move_type === 'out_refund' ? -1 : 1;
      const k = `${name}|${weekOf(d)}`;
      revenue.set(k, (revenue.get(k) || 0) + toCents(r.amount_untaxed ?? 0) * sign);
    }

    // Cost per rep per day, from that rep's lines grouped by product and day.
    const cost = new Map();
    const costedRev = new Map();   // "rep|week" -> cents of revenue that HAS a cost behind it
    const entries = [...groups].map(([name, ids]) => [name, [...ids]]);
    const runOne = async ([name, ids]) => {
      const fetchSide = (type, sign) => exec('account.move.line', 'read_group',
        [[...lineDom(type), ['move_id.invoice_user_id', 'in', ids]],
         ['quantity:sum', 'balance:sum'], ['product_id', 'product_uom_id', 'date:day']], { lazy: false })
        .then((rows) => rows.map((r) => ({ ...r, _sign: sign })));
      const [inv, ref] = await Promise.all([fetchSide('out_invoice', 1), fetchSide('out_refund', -1)]);
      const pids = [...new Set([...inv, ...ref].map((r) => r.product_id && r.product_id[0]).filter(Boolean))];
      const { costOf: std, prods } = pids.length ? await loadUnitCosts(exec, cid, pids, { dropship: cid === NORTH }) : { costOf: new Map(), prods: [] };
      const qtyOf = await makeQtyInProductUnit(exec, prods, cid !== NORTH);   // Oceania: metres vs yards
      /* Worthy Products: the cost Odoo BOOKED on this rep's invoices (cost-of-goods lines), per product per day;
         today's standard cost only where nothing was booked. Same rule as the month figures and the Sunday email. */
      const booked = new Map();
      if (ON_BASIS(cid)) {
        const cogsSide = (type) => exec('account.move.line', 'read_group',
          [[['move_id.company_id', '=', cid], ['move_id.move_type', '=', type], ['move_id.state', '=', 'posted'],
            ['move_id.invoice_date', '>=', start], ['move_id.invoice_date', '<=', end], ['move_id.commercial_partner_id', 'not in', sisterIdsOf(cid)],
            ['move_id.invoice_user_id', 'in', ids], ['display_type', '=', 'cogs'], ['account_id.code', '=like', '7%'],
            ['product_id', '!=', false], ['date', '!=', false], ['product_id', 'not in', [28085, 28084, 6691, 7503]]],   // Oceania variants Odoo cannot name
           ['balance:sum', 'quantity:sum'], ['product_id', 'product_uom_id', 'date:day']], { lazy: false }).then((rs) => rs.map((r) => ({ ...r, _type: type })));
        const rows = [...await cogsSide('out_invoice'), ...await cogsSide('out_refund')];
        for (const r of rows) {
          const d = dayOf(r.__range?.['date:day']?.from); const pid = r.product_id && r.product_id[0]; if (!d || !pid) continue;
          const sign = r._type === 'out_refund' ? -1 : 1;
          const cur = booked.get(`${pid}|${d}`) || { cost: 0, qty: 0 };
          cur.cost += Number(r.balance) || 0; cur.qty += sign * qtyOf(r);   // product's own unit, like the invoice lines
          booked.set(`${pid}|${d}`, cur);
        }
      }
      const agg = new Map();   // product|day -> { week, rev, std, unit }
      for (const r of [...inv, ...ref]) {
        const d = dayOf(r.__range?.['date:day']?.from); if (!d) continue;
        const pid = r.product_id && r.product_id[0];
        const unit = std.get(pid) || 0;
        const k = `${name}|${weekOf(d)}`;
        // balance is in company currency and already signed (a credit note is negative once negated)
        if (financeBasis) revenue.set(k, (revenue.get(k) || 0) + toCents(-(Number(r.balance) || 0)));
        const a = agg.get(`${pid}|${d}`) || { k, rev: 0, std: 0, qty: 0, unit };
        a.rev += toCents(-(Number(r.balance) || 0)); a.std += toCents(qtyOf(r) * unit) * r._sign; a.qty += qtyOf(r) * r._sign;
        agg.set(`${pid}|${d}`, a);
      }
      for (const [pk, a] of agg) {
        const b = booked.get(pk);
        const unbookedQty = b !== undefined ? a.qty - b.qty : 0;
        cost.set(a.k, (cost.get(a.k) || 0) + (b !== undefined ? toCents(b.cost) + (Math.abs(unbookedQty) > 1e-6 ? toCents(unbookedQty * a.unit) : 0) : a.std));
        /* Only a product with a real cost can back its own revenue. Freight and service lines sell for real money
           at cost zero, and counting them as costed is what turns a week into a 100% margin. */
        if (b !== undefined ? (b.cost !== 0 || a.unit > 0) : a.unit > 0) costedRev.set(a.k, (costedRev.get(a.k) || 0) + a.rev);
      }
    };
    for (let i = 0; i < entries.length; i += 5) {
      await Promise.all(entries.slice(i, i + 5).map(runOne));
    }

    const hasCost = [...cost.values()].some((v) => v !== 0);
    const rows = [...new Set([...revenue.keys(), ...cost.keys()])].map((k) => {
      const [name, week] = k.split('|');
      const rev = revenue.get(k) || 0, cst = cost.get(k);
      const cr = costedRev.get(k) || 0;
      /* Same rule as the financial-year figures: margin on the sales that have a cost. */
      const covered = hasCost && cst != null && cr > 0;
      return {
        name, week: Number(week),
        revenue: toDollars(rev),
        cost: hasCost && cst != null ? toDollars(cst) : null,
        // On the sales that have a cost: dropship / inter-company lines carry none.
        grossProfit: covered ? toDollars(cr - cst) : null,
        marginPct: covered ? pct1(cr - cst, cr) : null,
        costCoverage: hasCost && cst != null ? pct1(cr, rev) : null,
        marginWithheld: hasCost && cst != null && !covered,
      };
    });

    return { company: cid, month, start, end, hasCost, rows, generatedAt: new Date().toISOString() };
  };

  try {
    // Same figures; a saved copy is marked stale: true with the time Odoo was read (generatedAt).
    const { payload } = await readWeeks(cid, month, compute);
    return NextResponse.json(payload);
  } catch (err) {
    console.error('[odoo/weeks]', err.message);
    return NextResponse.json({ company: cid, month, error: err.message, rows: [] }, { status: 502 });
  }
}
