/**
 * Worthy Products North and Worthy Oceania — one financial year, resolved.
 *
 * Mirrors /api/ostendo/fy so all three companies report the same way: an
 * April–March financial year, a part-finished period compared only against the
 * same number of days last year, and months that have not started reporting
 * nothing rather than a 100% fall.
 *
 * HOW THE FIGURES ARE BUILT
 *   Revenue and counts come from account.move, grouped by day, salesperson and
 *   move type inside Odoo. Credit notes (out_refund) carry positive amounts in
 *   Odoo, so they are negated here; they reduce revenue and are never counted
 *   as orders.
 *
 *   Cost is quantity x product.standard_price. Odoo holds no cost on the
 *   invoice line, so this is today's standard cost rather than the cost at the
 *   time of sale — stated on the dashboard rather than implied. Worthy Oceania
 *   carries no product costs at all, so its margin is reported as unavailable
 *   instead of showing 100%.
 *
 *   Discounts are real: account.move.line.discount is a percentage, populated on
 *   181,892 of 188,229 North lines. Grouping by discount rate lets the value be
 *   recovered without reading every line.
 *
 * Nothing is fetched with a row limit. The previous invoice fetch capped at
 * 10,000 and silently dropped the oldest month.
 */
import { NextResponse } from 'next/server';
import {
  toCents, toDollars, pct1, fyRange, priorRange, fyMonthKeys, parseIso, iso, MONTH_NAMES,
} from '@/lib/ostendo';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ODOO = {
  url: process.env.ODOO_URL, db: process.env.ODOO_DB,
  user: process.env.ODOO_USER, pw: process.env.ODOO_PASSWORD,
};

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

const moveDomain = (cid, start, end) => [
  ['company_id', '=', cid], ['move_type', 'in', ['out_invoice', 'out_refund']],
  ['state', '=', 'posted'], ['invoice_date', '>=', start], ['invoice_date', '<=', end],
];
const lineDomain = (cid, start, end) => [
  ['move_id.company_id', '=', cid], ['move_id.move_type', 'in', ['out_invoice', 'out_refund']],
  ['move_id.state', '=', 'posted'], ['move_id.invoice_date', '>=', start],
  ['move_id.invoice_date', '<=', end], ['display_type', '=', 'product'],
];
/* Grouping by product breaks on lines with no product or no accounting date.
 * Neither can carry a cost, so they are excluded from the cost query only. */
const costLineDomain = (cid, start, end) => [
  ...lineDomain(cid, start, end), ['product_id', '!=', false], ['date', '!=', false],
];

const blank = () => ({ revenue: 0, cost: 0, invoices: 0, credits: 0, creditValue: 0, discount: 0 });
const add = (t, s) => {
  t.revenue += s.revenue; t.cost += s.cost; t.invoices += s.invoices;
  t.credits += s.credits; t.creditValue += s.creditValue; t.discount += s.discount;
  return t;
};
const present = (a, hasCost) => {
  const gp = a.revenue - a.cost;
  return {
    revenue: toDollars(a.revenue),
    cost: hasCost ? toDollars(a.cost) : null,
    grossProfit: hasCost ? toDollars(gp) : null,
    marginPct: hasCost ? pct1(gp, a.revenue) : null,
    invoices: a.invoices, credits: a.credits,
    creditValue: toDollars(a.creditValue),
    discounts: toDollars(a.discount),
    aov: a.invoices > 0 ? toDollars(a.revenue / a.invoices) : 0,
  };
};
const growth = (c, p) => (p > 0 ? Math.round(((c - p) / p) * 1000) / 10 : null);

/** "2026-04-17 00:00:00" or "2026-04-17" -> "2026-04-17" */
const dayOf = (v) => String(v ?? '').substring(0, 10);

/* read_group labels its groups for display ("10 Sep 2026", "September 2026").
 * The machine-readable boundary is in __range, so read the key from there. */
const rangeStart = (row, key) => dayOf(row?.__range?.[key]?.from);

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const today = new Date();
  const cid = parseInt(searchParams.get('company') || '4', 10);
  const fy = parseInt(searchParams.get('fy') || '', 10) ||
             (today.getUTCMonth() >= 3 ? today.getUTCFullYear() : today.getUTCFullYear() - 1);

  try {
    const exec = await connect();

    /* Stop at the last invoice Odoo actually holds for this company.
     * Asking read_group for min AND max of the same field is rejected
     * ("Output name 'invoice_date' is used twice"), so take the first and last
     * rows instead. */
    const allPosted = [['company_id', '=', cid],
                       ['move_type', 'in', ['out_invoice', 'out_refund']], ['state', '=', 'posted']];
    const edge = (order) => exec('account.move', 'search_read', [allPosted],
      { fields: ['invoice_date'], order, limit: 1 }, 20000).catch(() => []);
    const [newest, oldest] = await Promise.all([edge('invoice_date desc'), edge('invoice_date asc')]);
    const lastLoaded  = dayOf(newest?.[0]?.invoice_date);
    const firstLoaded = dayOf(oldest?.[0]?.invoice_date);

    const full = fyRange(fy, today);
    const range = lastLoaded && lastLoaded < full.end ? { ...full, end: lastLoaded } : full;
    const prior = priorRange(range);

    const pull = async (start, end) => {
      const [moves, prodMonth, discRows] = await Promise.all([
        // Revenue and counts, per day, per rep, per type.
        exec('account.move', 'read_group', [moveDomain(cid, start, end),
          ['amount_untaxed:sum'], ['invoice_date:day', 'invoice_user_id', 'move_type']], { lazy: false }),
        // Quantity per product per month — cost is a per-product figure.
        exec('account.move.line', 'read_group', [costLineDomain(cid, start, end),
          ['quantity:sum'], ['product_id', 'date:month']], { lazy: false }).catch(() => []),
        // Discount value recovered from the rate each line was sold at.
        exec('account.move.line', 'read_group', [
          [...lineDomain(cid, start, end), ['date', '!=', false]],
          ['price_subtotal:sum'], ['date:month', 'discount']], { lazy: false }).catch(() => []),
      ]);
      return { moves, prodMonth, discRows };
    };

    const [curr, prev] = await Promise.all([pull(range.start, range.end), pull(prior.start, prior.end)]);

    // Product costs, once, for everything either period touched.
    const productIds = [...new Set([...curr.prodMonth, ...prev.prodMonth]
      .map((r) => r.product_id && r.product_id[0]).filter(Boolean))];
    const prods = productIds.length
      ? await exec('product.product', 'read', [productIds], { fields: ['standard_price'] })
      : [];
    const costOf = new Map(prods.map((p) => [p.id, Number(p.standard_price) || 0]));
    const hasCost = prods.some((p) => Number(p.standard_price) > 0);

    /** month key "YYYY-MM" -> { cost, discount } in cents */
    const monthExtras = (pack) => {
      const out = new Map();
      const touch = (k) => { if (!out.has(k)) out.set(k, { cost: 0, discount: 0 }); return out.get(k); };
      for (const r of pack.prodMonth) {
        const k = rangeStart(r, 'date:month').substring(0, 7);
        if (!k) continue;
        const unit = costOf.get(r.product_id && r.product_id[0]) || 0;
        touch(k).cost += toCents((Number(r.quantity) || 0) * unit);
      }
      for (const r of pack.discRows) {
        const k = rangeStart(r, 'date:month').substring(0, 7);
        const d = Number(r.discount) || 0;
        if (!k || d <= 0 || d >= 100) continue;
        const sub = Number(r.price_subtotal) || 0;
        touch(k).discount += toCents(sub / (1 - d / 100) - sub);
      }
      return out;
    };

    /** day -> { total, reps } in cents, revenue and counts only */
    const dayIndex = (pack) => {
      const days = new Map();
      for (const r of pack.moves) {
        const d = rangeStart(r, 'invoice_date:day');
        if (!d) continue;
        const isCredit = r.move_type === 'out_refund';
        const cents = toCents(r.amount_untaxed ?? 0) * (isCredit ? -1 : 1);
        const n = Number(r.__count) || 0;
        const rep = r.invoice_user_id ? r.invoice_user_id[1] : 'Unassigned';
        if (!days.has(d)) days.set(d, { total: blank(), reps: new Map() });
        const entry = days.get(d);
        if (!entry.reps.has(rep)) entry.reps.set(rep, blank());
        for (const b of [entry.total, entry.reps.get(rep)]) {
          b.revenue += cents;
          if (isCredit) { b.credits += n; b.creditValue += cents; } else { b.invoices += n; }
        }
      }
      return days;
    };

    const days = dayIndex(curr), daysPrior = dayIndex(prev);
    const extras = monthExtras(curr), extrasPrior = monthExtras(prev);

    const sumRange = (idx, from, to, rep = null) => {
      const out = blank();
      for (const [d, e] of idx) {
        if (d < from || d > to) continue;
        if (rep === null) add(out, e.total);
        else if (e.reps.has(rep)) add(out, e.reps.get(rep));
      }
      return out;
    };

    const todayIso = range.end;
    const months = fyMonthKeys(fy);
    const covered = (s) => !firstLoaded || s >= firstLoaded;
    const priorComparable = covered(prior.start);

    const monthRows = months.map(({ key, label, year, monthIdx }) => {
      const first = `${key}-01`;
      const lastDay = new Date(Date.UTC(year, monthIdx + 1, 0)).getUTCDate();
      const last = `${key}-${String(lastDay).padStart(2, '0')}`;
      const started = first <= todayIso;
      const complete = last <= todayIso;
      const through = complete ? last : (started ? todayIso : null);
      const shift = (s) => `${Number(s.substring(0, 4)) - 1}${s.substring(4)}`;

      const acc = started ? sumRange(days, first, through) : blank();
      if (started) { const x = extras.get(key); if (x) { acc.cost = x.cost; acc.discount = x.discount; } }
      const pAcc = started ? sumRange(daysPrior, shift(first), shift(through)) : blank();
      if (started) { const x = extrasPrior.get(shift(key)); if (x) { pAcc.cost = x.cost; pAcc.discount = x.discount; } }

      return {
        key, label, year, started, complete, through,
        daysInMonth: lastDay,
        ...present(acc, hasCost),
        prior: present(pAcc, hasCost),
        priorComparable: started && covered(shift(first)),
        growthPct: started && covered(shift(first)) ? growth(acc.revenue, pAcc.revenue) : null,
      };
    });

    /* Weeks inside each month: 1-7, 8-14, 15-21, 22-28, 29-end. `days` says how
     * long the bucket actually is, so a short month-end stub is never mistaken
     * for a collapse in trade. Cost is only held per month, so a week reports
     * revenue and counts without a margin. */
    const weekRows = [];
    for (const m of monthRows) {
      if (!m.started) continue;
      for (let w = 1; w <= 5; w++) {
        const from = (w - 1) * 7 + 1;
        if (from > m.daysInMonth) continue;
        const to = Math.min(w * 7, m.daysInMonth);
        const fromIso = `${m.key}-${String(from).padStart(2, '0')}`;
        const toIso = `${m.key}-${String(to).padStart(2, '0')}`;
        if (fromIso > todayIso) continue;
        const cappedTo = toIso <= todayIso ? toIso : todayIso;
        weekRows.push({
          monthKey: m.key, monthLabel: m.label, week: w,
          label: `${m.label} W${w}`,
          dateRange: `${from}–${to} ${m.label}`,
          start: fromIso, end: cappedTo,
          days: Math.round((parseIso(cappedTo) - parseIso(fromIso)) / 86400000) + 1,
          expectedDays: to - from + 1,
          complete: toIso <= todayIso,
          ...present(sumRange(days, fromIso, cappedTo), false),
        });
      }
    }

    const repNames = new Set();
    for (const [, e] of days) for (const k of e.reps.keys()) repNames.add(k);
    for (const [, e] of daysPrior) for (const k of e.reps.keys()) repNames.add(k);

    const repRows = [...repNames].map((name) => {
      const c = sumRange(days, range.start, range.end, name);
      const p = sumRange(daysPrior, prior.start, prior.end, name);
      return {
        name,
        // Cost cannot be split by salesperson: Odoo does not store the rep on the
        // invoice line, so margin is reported per month and per company, not per rep.
        ...present(c, false),
        prior: present(p, false),
        growthPct: priorComparable ? growth(c.revenue, p.revenue) : null,
        months: monthRows.map((m) => ({
          key: m.key, label: m.label, started: m.started,
          ...present(m.started ? sumRange(days, `${m.key}-01`, m.through, name) : blank(), false),
        })),
        weeks: weekRows.map((w) => ({
          monthKey: w.monthKey, week: w.week,
          ...present(sumRange(days, w.start, w.end, name), false),
        })),
      };
    }).filter((r) => r.revenue !== 0 || r.invoices > 0 || r.credits > 0)
      .sort((a, b) => b.revenue - a.revenue);

    const started = monthRows.filter((m) => m.started);
    const total = blank();
    for (const m of started) {
      add(total, { revenue: toCents(m.revenue), cost: toCents(m.cost || 0), invoices: m.invoices,
                   credits: m.credits, creditValue: toCents(m.creditValue), discount: toCents(m.discounts) });
    }
    const priorTotal = blank();
    for (const m of started) {
      add(priorTotal, { revenue: toCents(m.prior.revenue), cost: toCents(m.prior.cost || 0),
                        invoices: m.prior.invoices, credits: m.prior.credits,
                        creditValue: toCents(m.prior.creditValue), discount: toCents(m.prior.discounts) });
    }

    return NextResponse.json({
      fy, company: cid,
      generatedAt: new Date().toISOString(),
      range, prior,
      dataAvailable: { first: firstLoaded, last: lastLoaded,
                       coversWholeYear: Boolean(firstLoaded && firstLoaded <= range.start) },
      costBasis: hasCost
        ? "product standard cost as it stands today, not the cost at the time of sale"
        : "no product costs are held in Odoo for this company, so margin cannot be calculated",
      hasCost,
      months: monthRows,
      weeks: weekRows,
      reps: repRows,
      repMarginAvailable: false,
      totals: {
        ...present(total, hasCost),
        prior: present(priorTotal, hasCost),
        growthPct: priorComparable ? growth(total.revenue, priorTotal.revenue) : null,
        priorComparable,
        comparable: !priorComparable
          ? `no comparison shown — Odoo's records start ${firstLoaded || 'later'}, so ${prior.start} to ${prior.end} is not fully on file`
          : !range.complete ? `1 Apr – ${range.end} vs 1 Apr – ${prior.end}`
          : 'full financial year vs full financial year',
      },
    });
  } catch (err) {
    console.error('[odoo/fy]', err.message);
    return NextResponse.json({ fy, company: cid, error: err.message, months: [], reps: [], totals: null },
      { status: 502 });
  }
}
