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
  toCents, toDollars, pct1, costCovered, fyRange, priorRange, fyMonthKeys, parseIso, iso, MONTH_NAMES,
  nzToday, nzFinancialYear,
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
 * Neither can carry a cost, so they are excluded from the cost query only.
 *
 * `type` splits invoices from credit notes. Odoo stores a credit note's line
 * quantity and subtotal as POSITIVE — the sign lives on the move, not the line —
 * so summing them raw ADDS the cost of returned goods to cost of sales instead
 * of taking it off. Each side is fetched separately and the credit side negated. */
const costLineDomain = (cid, start, end, type) => [
  ...lineDomain(cid, start, end), ['product_id', '!=', false], ['date', '!=', false],
  ...(type ? [['move_id.move_type', '=', type]] : []),
];

const blank = () => ({ revenue: 0, cost: 0, invoices: 0, credits: 0, creditValue: 0, discount: 0,
                       costedRevenue: 0 });
const add = (t, s) => {
  t.revenue += s.revenue; t.cost += s.cost; t.invoices += s.invoices;
  t.credits += s.credits; t.creditValue += s.creditValue; t.discount += s.discount;
  t.costedRevenue += s.costedRevenue;
  return t;
};
const present = (a, hasCost) => {
  const gp = a.revenue - a.cost;
  /* Only quote a margin when Odoo actually holds a cost for what was sold.
     Some reps sell almost nothing but freight and service lines, which carry no
     standard cost: summing those as cost zero produced a 100% margin — a number
     that is not just wrong but unbelievable, and one wrong row costs the reader
     their trust in every other row. Where the cost is missing the margin is left
     blank and said to be missing. Revenue and recorded cost are untouched, so
     the rows still add up to the company total. */
  const covered = hasCost && costCovered(a.revenue, a.costedRevenue);
  return {
    revenue: toDollars(a.revenue),
    cost: hasCost ? toDollars(a.cost) : null,
    grossProfit: covered ? toDollars(gp) : null,
    marginPct: covered ? pct1(gp, a.revenue) : null,
    /* What share of the revenue has a cost behind it, and whether the margin was
       withheld because too little of it did. */
    costCoverage: hasCost ? pct1(a.costedRevenue, a.revenue) : null,
    marginWithheld: hasCost && !covered,
    invoices: a.invoices, credits: a.credits,
    creditValue: toDollars(a.creditValue),
    discounts: toDollars(a.discount),
    /* Revenue with a real cost behind it, and revenue without. A line carrying
       no product, or a product with no standard cost, contributes sales but no
       cost — so its margin reads 100% because the cost is missing, not because
       the sale was that good. */
    costedRevenue:   hasCost ? toDollars(a.costedRevenue) : null,
    uncoveredRevenue: hasCost ? toDollars(a.revenue - a.costedRevenue) : null,
    aov: a.invoices > 0 ? toDollars(a.revenue / a.invoices) : 0,
  };
};
const growth = (c, p) => (p > 0 ? Math.round(((c - p) / p) * 1000) / 10 : null);

/**
 * Make rounded rows add up to the rounded total. Each rep's cost comes back from
 * its own query, so the rows can land a cent away from the company figure. Each
 * keeps its own correctly rounded value; the odd cent goes to the largest row,
 * where it distorts least.
 */
function reconcile(rows, totalDollars, get, set) {
  if (!rows.length) return;
  const totalC = Math.round(totalDollars * 100);
  const sumC = rows.reduce((a, r) => a + Math.round(get(r) * 100), 0);
  let residual = totalC - sumC;
  if (!residual) return;
  const order = [...rows].sort((a, b) => Math.abs(get(b)) - Math.abs(get(a)));
  for (let i = 0; residual !== 0 && i < order.length; i++) {
    const step = residual > 0 ? 1 : -1;
    set(order[i], (Math.round(get(order[i]) * 100) + step) / 100);
    residual -= step;
  }
}
const restate = (r) => {
  if (r.cost == null) return;
  /* A margin withheld for want of cost data stays withheld. Reconciliation
     moves cents between rows; it does not conjure the cost that is missing. */
  if (r.marginWithheld) { r.grossProfit = null; r.marginPct = null; return; }
  r.grossProfit = Math.round((r.revenue - r.cost) * 100) / 100;
  r.marginPct = r.revenue > 0 ? Math.round((r.grossProfit / r.revenue) * 1000) / 10 : null;
};

/** "2026-04-17 00:00:00" or "2026-04-17" -> "2026-04-17" */
const dayOf = (v) => String(v ?? '').substring(0, 10);

/* read_group labels its groups for display ("10 Sep 2026", "September 2026").
 * The machine-readable boundary is in __range, so read the key from there. */
const rangeStart = (row, key) => dayOf(row?.__range?.[key]?.from);

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const today = nzToday();                       // the NZ date, not the server's UTC date
  const cid = parseInt(searchParams.get('company') || '4', 10);
  const fy = parseInt(searchParams.get('fy') || '', 10) || nzFinancialYear();

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

    const problems = [];
    const pull = async (start, end) => {
      const [moves, prodMonth, discRows] = await Promise.all([
        // Revenue and counts, per day, per rep, per type.
        exec('account.move', 'read_group', [moveDomain(cid, start, end),
          ['amount_untaxed:sum'], ['invoice_date:day', 'invoice_user_id', 'move_type']], { lazy: false }),
        // Quantity per product per month — cost is a per-product figure.
        /* Grouping by product asks Odoo to build each product's display name, and
         * Worthy Oceania has variants whose attributes are incomplete, so the
         * whole call fails with "expected str instance, bool found". Reading the
         * lines directly avoids the grouping; if that fails too the reason is
         * reported rather than leaving an empty table with no explanation. */
        Promise.all([
          exec('account.move.line', 'read_group', [costLineDomain(cid, start, end, 'out_invoice'),
            ['quantity:sum', 'price_subtotal:sum'], ['product_id', 'date:month']], { lazy: false }),
          exec('account.move.line', 'read_group', [costLineDomain(cid, start, end, 'out_refund'),
            ['quantity:sum', 'price_subtotal:sum'], ['product_id', 'date:month']], { lazy: false }),
        ]).then(([inv, ref]) => [
          ...inv,
          // Returned goods reduce both quantity sold and cost of sales.
          ...ref.map((r) => ({ ...r, quantity: -(Number(r.quantity) || 0),
                               price_subtotal: -(Number(r.price_subtotal) || 0) })),
        ])
          .catch(async (e) => {
            problems.push(`grouping lines by product failed (${e.message.slice(0, 90)}); read line by line instead`);
            const rows = [];
            for (let offset = 0; ; offset += 2000) {
              const page = await exec('account.move.line', 'search_read', [costLineDomain(cid, start, end)],
                { fields: ['product_id', 'quantity', 'price_subtotal', 'date'], limit: 2000, offset, order: 'id asc' })
                .catch((e2) => { problems.push(`reading lines failed: ${e2.message.slice(0, 90)}`); return null; });
              if (!page) return [];
              rows.push(...page);
              if (page.length < 2000) break;
            }
            // Fold into the same shape read_group would have produced.
            const agg = new Map();
            for (const l of rows) {
              const pid = l.product_id && l.product_id[0]; if (!pid || !l.date) continue;
              const month = String(l.date).substring(0, 7);
              const k = `${pid}|${month}`;
              if (!agg.has(k)) agg.set(k, { product_id: l.product_id, quantity: 0, price_subtotal: 0,
                                            __range: { 'date:month': { from: `${month}-01` } } });
              const a = agg.get(k);
              a.quantity += Number(l.quantity) || 0;
              a.price_subtotal += Number(l.price_subtotal) || 0;
            }
            return [...agg.values()];
          }),
        // Discount value recovered from the rate each line was sold at.
        Promise.all([
          exec('account.move.line', 'read_group', [[...lineDomain(cid, start, end), ['date', '!=', false],
            ['move_id.move_type', '=', 'out_invoice']], ['price_subtotal:sum'], ['date:month', 'discount']],
            { lazy: false }),
          exec('account.move.line', 'read_group', [[...lineDomain(cid, start, end), ['date', '!=', false],
            ['move_id.move_type', '=', 'out_refund']], ['price_subtotal:sum'], ['date:month', 'discount']],
            { lazy: false }),
        ]).then(([inv, ref]) => [...inv,
          ...ref.map((r) => ({ ...r, price_subtotal: -(Number(r.price_subtotal) || 0) }))]).catch(() => []),
      ]);
      return { moves, prodMonth, discRows };
    };

    const [curr, prev] = await Promise.all([pull(range.start, range.end), pull(prior.start, prior.end)]);

    /* Customers: what they spent in this period, and their whole history, so
       lifetime value and "quiet since" mean what they say. */
    const custDomain = (start, end) => [...moveDomain(cid, start, end), ['partner_id', '!=', false]];
    const [custPeriod, custLifetime] = await Promise.all([
      exec('account.move', 'read_group', [custDomain(range.start, range.end),
        ['amount_untaxed:sum'], ['partner_id', 'move_type']], { lazy: false }).catch(() => []),
      exec('account.move', 'read_group',
        [[...allPosted, ['partner_id', '!=', false]],
         ['amount_untaxed:sum'], ['partner_id', 'move_type']], { lazy: false }).catch(() => []),
    ]);
    // First and last invoice per customer, for new-customer counts and lapse.
    const [firstSeen, lastSeen] = await Promise.all([
      exec('account.move', 'read_group', [[...allPosted, ['move_type', '=', 'out_invoice']],
        ['invoice_date:min'], ['partner_id']], { lazy: false }).catch(() => []),
      exec('account.move', 'read_group', [[...allPosted, ['move_type', '=', 'out_invoice']],
        ['invoice_date:max'], ['partner_id']], { lazy: false }).catch(() => []),
    ]);

    // Product costs, once, for everything either period touched.
    const productIds = [...new Set([...curr.prodMonth, ...prev.prodMonth]
      .map((r) => r.product_id && r.product_id[0]).filter(Boolean))];
    const prods = productIds.length
      ? await exec('product.product', 'read', [productIds], { fields: ['standard_price', 'categ_id'] })
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
        if (unit > 0) touch(k).costedRev = (touch(k).costedRev || 0) + toCents(r.price_subtotal ?? 0);
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

    // New customers by month: the month a customer's FIRST invoice falls in.
    const newCustByMonth = new Map();
    for (const r of firstSeen) {
      const k = dayOf(r.invoice_date).substring(0, 7);
      if (k) newCustByMonth.set(k, (newCustByMonth.get(k) || 0) + 1);
    }
    const firstDataMonth = firstLoaded ? firstLoaded.substring(0, 7) : null;
    const newCustFor = (k) => (firstDataMonth && k <= firstDataMonth) ? null : (newCustByMonth.get(k) || 0);
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
      if (started) { const x = extras.get(key);
        if (x) { acc.cost = x.cost; acc.discount = x.discount; acc.costedRevenue = x.costedRev || 0; } }
      const pAcc = started ? sumRange(daysPrior, shift(first), shift(through)) : blank();
      if (started) { const x = extrasPrior.get(shift(key));
        if (x) { pAcc.cost = x.cost; pAcc.discount = x.discount; pAcc.costedRevenue = x.costedRev || 0; } }

      return {
        key, label, year, started, complete, through,
        daysInMonth: lastDay,
        newCustomers: started ? newCustFor(key) : null,
        /* The untouched accumulators, so the year's totals can be rounded once
           from the raw figures instead of adding up twelve already-rounded
           months. Stripped before the response goes out. */
        __acc: acc, __pAcc: pAcc,
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

    /* Cost per salesperson.
     * Odoo does not store the salesperson on the invoice line, but the line CAN
     * be filtered through move_id.invoice_user_id, so one grouped query per rep
     * gives that rep's quantity by product and month — and therefore their cost
     * and margin. Sixteen reps come back in a few seconds at four at a time. */
    const repIds = new Map();
    for (const r of curr.moves) {
      const id = r.invoice_user_id ? r.invoice_user_id[0] : null;
      const nm = r.invoice_user_id ? r.invoice_user_id[1] : 'Unassigned';
      if (id) repIds.set(nm, id);
    }
    /** rep name -> Map(monthKey -> cost in cents), and a whole-period total */
    const repCost = new Map();
    if (hasCost && repIds.size) {
      const entries = [...repIds];
      /* Every credit-note line at once, with the salesperson of its move, so the
         per-rep loop below needs only ONE query each instead of two. */
      const refundByRep = new Map();
      try {
        const [refMoves, refLines] = await Promise.all([
          exec('account.move', 'search_read',
            [[...moveDomain(cid, range.start, range.end), ['move_type', '=', 'out_refund']]],
            { fields: ['invoice_user_id'], limit: 0 }, 25000),
          exec('account.move.line', 'search_read',
            [costLineDomain(cid, range.start, range.end, 'out_refund')],
            { fields: ['move_id', 'product_id', 'quantity', 'price_subtotal', 'date'], limit: 0 }, 25000),
        ]);
        const repOfMove = new Map(refMoves.map((m) => [m.id, m.invoice_user_id ? m.invoice_user_id[1] : 'Unassigned']));
        for (const l of refLines) {
          const name = repOfMove.get(l.move_id && l.move_id[0]); if (!name || !l.date) continue;
          if (!refundByRep.has(name)) refundByRep.set(name, []);
          refundByRep.get(name).push({
            product_id: l.product_id, quantity: -(Number(l.quantity) || 0),
            price_subtotal: -(Number(l.price_subtotal) || 0),
            __range: { 'date:month': { from: `${String(l.date).substring(0, 7)}-01` } },
          });
        }
      } catch (e) { problems.push(`credit-note lines could not be split by rep (${e.message.slice(0, 80)})`); }

      const runOne = async ([name, id]) => {
        try {
          const inv = await exec('account.move.line', 'read_group',
            [[...costLineDomain(cid, range.start, range.end, 'out_invoice'), ['move_id.invoice_user_id', '=', id]],
             ['quantity:sum', 'price_subtotal:sum'], ['product_id', 'date:month']], { lazy: false }, 30000);
          const rows = [...inv, ...(refundByRep.get(name) || [])];
          /* Costed revenue is kept per month as well as for the year. Carrying
             only the year figure made a single month's cost coverage read against
             twelve months of costed sales — 3,066% for one rep — which is how a
             month with no cost at all still passed for a real 100% margin. */
          const byMonth = new Map(), crByMonth = new Map();
          let total = 0, costedRev = 0;
          for (const r of rows) {
            const k = rangeStart(r, 'date:month').substring(0, 7);
            const unit = costOf.get(r.product_id && r.product_id[0]) || 0;
            const cents = toCents((Number(r.quantity) || 0) * unit);
            byMonth.set(k, (byMonth.get(k) || 0) + cents);
            total += cents;
            if (unit > 0) {
              const sub = toCents(r.price_subtotal ?? 0);
              costedRev += sub;
              crByMonth.set(k, (crByMonth.get(k) || 0) + sub);
            }
          }
          repCost.set(name, { byMonth, crByMonth, total, costedRev });
        } catch (e) {
          problems.push(`cost for ${name} could not be read (${e.message.slice(0, 80)})`);
        }
      };
      // Four at a time — fast enough, and gentle on Odoo.
      for (let i = 0; i < entries.length; i += 4) {
        await Promise.all(entries.slice(i, i + 4).map(runOne));
      }
    }
    const repHasCost = repCost.size > 0;

    const repNames = new Set();
    for (const [, e] of days) for (const k of e.reps.keys()) repNames.add(k);
    for (const [, e] of daysPrior) for (const k of e.reps.keys()) repNames.add(k);

    const repRows = [...repNames].map((name) => {
      const c = sumRange(days, range.start, range.end, name);
      const p = sumRange(daysPrior, prior.start, prior.end, name);
      const rc = repCost.get(name);
      const withCost = (acc, cents, costedRev) => (rc ? { ...acc, cost: cents || 0, costedRevenue: costedRev || 0 } : acc);
      return {
        name,
        ...present(withCost(c, rc?.total, rc?.costedRev), Boolean(rc)),
        prior: present(p, false),
        growthPct: priorComparable ? growth(c.revenue, p.revenue) : null,
        months: monthRows.map((m) => {
          const acc = m.started ? sumRange(days, `${m.key}-01`, m.through, name) : blank();
          return {
            key: m.key, label: m.label, started: m.started,
            ...present(withCost(acc, rc?.byMonth.get(m.key), rc?.crByMonth.get(m.key)), Boolean(rc) && m.started),
          };
        }),
        // Cost is held per month, so a week shows revenue and orders without a margin.
        weeks: weekRows.map((w) => ({
          monthKey: w.monthKey, week: w.week,
          ...present(sumRange(days, w.start, w.end, name), false),
        })),
      };
    }).filter((r) => r.revenue !== 0 || r.invoices > 0 || r.credits > 0)
      .sort((a, b) => b.revenue - a.revenue);

    const started = monthRows.filter((m) => m.started);
    /* Add up the RAW accumulators. Summing the rounded months instead let half a
       cent per month accumulate — the year's cost landed two cents above the true
       figure, and reconciliation then pushed those two cents onto the largest
       rep, where they showed. Round once, at the end. */
    const total = blank();
    for (const m of started) add(total, m.__acc);
    const priorTotal = blank();
    for (const m of started) add(priorTotal, m.__pAcc);
    for (const m of monthRows) { delete m.__acc; delete m.__pAcc; }

    /* ── Analytics tables, on the same financial year as everything else ───── */
    const netBy = (rows) => {
      const m = new Map();
      for (const r of rows) {
        const id = r.partner_id && r.partner_id[0]; if (!id) continue;
        const sign = r.move_type === 'out_refund' ? -1 : 1;
        const cur = m.get(id) || { name: r.partner_id[1], cents: 0, orders: 0 };
        cur.cents += toCents(r.amount_untaxed ?? 0) * sign;
        if (sign > 0) cur.orders += Number(r.__count) || 0;
        m.set(id, cur);
      }
      return m;
    };
    const periodBy = netBy(custPeriod), lifetimeBy = netBy(custLifetime);
    const lastBy = new Map(lastSeen.map((r) => [r.partner_id && r.partner_id[0], dayOf(r.invoice_date)]));
    const firstBy = new Map(firstSeen.map((r) => [r.partner_id && r.partner_id[0], dayOf(r.invoice_date)]));
    const asOf = parseIso(range.end);

    const customers = [...lifetimeBy].map(([id, v]) => {
      const last = lastBy.get(id) || null;
      const daysSince = last ? Math.floor((asOf - parseIso(last)) / 86400000) : null;
      const p = periodBy.get(id);
      return {
        customer: v.name,
        revenue: toDollars(p?.cents || 0), orderCount: p?.orders || 0,
        lifetimeRevenue: toDollars(v.cents), lifetimeOrders: v.orders,
        firstOrder: firstBy.get(id) || null, lastOrder: last, lastOrderDays: daysSince,
        status: daysSince === null ? 'Unknown' : daysSince > 90 ? 'Lapsed'
              : daysSince > 45 ? 'At Risk' : 'Active',
      };
    });

    // Products and categories from the same aggregate the cost came from.
    const prodAgg = new Map();
    for (const r of curr.prodMonth) {
      const id = r.product_id && r.product_id[0]; if (!id) continue;
      const cur = prodAgg.get(id) || { name: r.product_id[1], qty: 0, cents: 0 };
      cur.qty += Number(r.quantity) || 0;
      cur.cents += toCents(r.price_subtotal ?? 0);
      prodAgg.set(id, cur);
    }
    const catOf = new Map(prods.map((p) => [p.id, p.categ_id ? p.categ_id[1] : 'Uncategorised']));
    const productRows = [...prodAgg].map(([id, v]) => {
      const cost = v.qty * (costOf.get(id) || 0);
      return {
        code: String(id), title: v.name, category: catOf.get(id) || 'Uncategorised',
        unitsSold: Math.round(v.qty), rawQty: v.qty, revenue: toDollars(v.cents),
        cost: hasCost ? toDollars(toCents(cost)) : null,
        margin: hasCost ? pct1(v.cents - toCents(cost), v.cents) : null,
      };
    }).sort((a, b) => b.revenue - a.revenue);

    const catAgg = new Map();
    for (const p of productRows) {
      const cur = catAgg.get(p.category) || { revenue: 0, cost: 0, units: 0, products: 0 };
      /* Sum the RAW quantities and round once at the end. Adding up units that
         were each already rounded to a whole item let half a unit per product
         accumulate — 2.29 units across Soft Drinks — so the category total did
         not equal the products beneath it. */
      cur.revenue += p.revenue; cur.cost += p.cost || 0; cur.units += p.rawQty; cur.products += 1;
      catAgg.set(p.category, cur);
    }
    for (const p of productRows) delete p.rawQty;
    const categoryRows = [...catAgg].map(([category, v]) => ({
      category, productCount: v.products, unitsSold: Math.round(v.units),
      revenue: Math.round(v.revenue * 100) / 100,
      cost: hasCost ? Math.round(v.cost * 100) / 100 : null,
      margin: hasCost ? pct1(toCents(v.revenue - v.cost), toCents(v.revenue)) : null,
    })).sort((a, b) => b.revenue - a.revenue);

    /* The month column has a TOTAL under it, so it has to add up to it. The
       year is rounded once from the raw figures and each month is rounded on its
       own, which leaves a cent or two between them; the same largest-remainder
       pass used for the reps settles it, so every month keeps its own correct
       value except the largest, which carries the odd cent. */
    {
      const fin = present(total, hasCost);
      const startedRows = monthRows.filter((m) => m.started);
      reconcile(startedRows, fin.revenue, (m) => m.revenue, (m, v) => { m.revenue = v; });
      if (hasCost) {
        const costed = startedRows.filter((m) => m.cost != null);
        reconcile(costed, fin.cost, (m) => m.cost, (m, v) => { m.cost = v; });
        costed.forEach(restate);
      }
      const withDisc = startedRows.filter((m) => m.discounts != null);
      reconcile(withDisc, fin.discounts, (m) => m.discounts, (m, v) => { m.discounts = v; });
      const withCredit = startedRows.filter((m) => m.creditValue != null);
      reconcile(withCredit, fin.creditValue, (m) => m.creditValue, (m, v) => { m.creditValue = v; });
    }

    /* Rows must add up to the totals printed beneath them. */
    if (hasCost) {
      const costed = repRows.filter((r) => r.cost != null);
      reconcile(costed, present(total, true).cost, (r) => r.cost, (r, v) => { r.cost = v; });
      costed.forEach(restate);
      for (const r of costed) {
        const ms = r.months.filter((m) => m.started && m.cost != null);
        reconcile(ms, r.cost, (m) => m.cost, (m, v) => { m.cost = v; });
        ms.forEach(restate);
      }
    }

    /* Stock on hand, for the products that actually get shown and no others.
       `qty_available` is computed per product, so asking for all few-thousand
       would cost ~13s on a route that already takes 25; the 60-odd rows on
       screen cost about 260ms. Company context matters — without it Odoo sums
       the quantity across every company on the database. */
    /* Why some revenue carries no cost. Odoo does hold a cost price for virtually
       every product Worthy sells — the gap is almost entirely invoice lines with
       NO product on them at all: freight recharges, pallet rent, expense
       reimbursements and supplier rebate claims, typed in by hand. Real income,
       but nothing was bought to earn it, so there is no cost of sales to show.
       Split it here so the page can say which is which instead of guessing. */
    let nonStockRevenue = null;
    try {
      const side = (type) => exec('account.move.line', 'read_group',
        [[...lineDomain(cid, range.start, range.end), ['product_id', '=', false],
          ['move_id.move_type', '=', type]], ['price_subtotal:sum'], []], { lazy: false });
      const [inv, ref] = await Promise.all([side('out_invoice'), side('out_refund')]);
      const total = (rows) => rows.reduce((a, r) => a + (Number(r.price_subtotal) || 0), 0);
      nonStockRevenue = toDollars(toCents(total(inv) - total(ref)));
    } catch (e) {
      problems.push(`non-stock revenue could not be split out (${e.message.slice(0, 80)})`);
    }

    const topProducts = productRows.slice(0, 50);
    const topMoving = [...productRows].sort((a, b) => b.unitsSold - a.unitsSold).slice(0, 25);
    const showIds = [...new Set([...topProducts, ...topMoving].map((r) => Number(r.code)))];
    if (showIds.length) {
      try {
        const stock = await exec('product.product', 'read', [showIds],
          { fields: ['qty_available'], context: { allowed_company_ids: [cid], company_id: cid } });
        const onHand = new Map(stock.map((r) => [r.id, Number(r.qty_available) || 0]));
        for (const r of [...topProducts, ...topMoving]) {
          const q = onHand.get(Number(r.code));
          r.onHand = q === undefined ? null : Math.round(q);
        }
      } catch (e) {
        problems.push(`stock on hand unavailable (${e.message.slice(0, 80)})`);
      }
    }

    const byRev = (a, b) => b.revenue - a.revenue;
    return NextResponse.json({
      fy, company: cid, nonStockRevenue,
      products:   topProducts,
      fastMoving: topMoving,
      categories: categoryRows.slice(0, 30),
      customers:  customers.filter((c) => c.orderCount > 0).sort(byRev).slice(0, 100),
      clv:        [...customers].sort((a, b) => b.lifetimeRevenue - a.lifetimeRevenue).slice(0, 50),
      churned:    customers.filter((c) => c.status === 'Lapsed' && c.lifetimeRevenue > 0)
                           .sort((a, b) => b.lifetimeRevenue - a.lifetimeRevenue).slice(0, 50),
      atRisk:     customers.filter((c) => c.status === 'At Risk')
                           .sort((a, b) => b.lifetimeRevenue - a.lifetimeRevenue).slice(0, 50),
      generatedAt: new Date().toISOString(),
      /* The New Zealand date this was built against. The period can still end
         earlier when the newest invoice on file is older than today; this says
         what the dashboard believes "today" is, so the two are never confused. */
      asOfNZ: today,
      range, prior,
      dataAvailable: { first: firstLoaded, last: lastLoaded,
                       coversWholeYear: Boolean(firstLoaded && firstLoaded <= range.start) },
      costBasis: hasCost
        ? "product standard cost as it stands today, not the cost at the time of sale"
        : "no product costs are held in Odoo for this company, so margin cannot be calculated",
      hasCost,
      // Anything that could not be read, said out loud rather than left blank.
      problems: [...new Set(problems)],
      months: monthRows,
      weeks: weekRows,
      reps: repRows,
      repMarginAvailable: repHasCost,
      repMarginNote: repHasCost
        ? 'Rep margin is available for the year and for each month. Weekly rep figures show revenue and orders only, because cost is held per month.'
        : 'Rep margin is unavailable for this company.',
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
