/**
 * Worthy Products South (Dutch Rusk) — one financial year, fully resolved.
 *
 * Replaces the old split of /api/ostendo (revenue, calendar year) plus
 * /api/ostendo/margins (cost, calendar year) plus client-side stitching of the
 * two into an April–March year. That split is what allowed the revenue column
 * and the margin column to describe different periods on the same table row.
 *
 * HOW IT WORKS
 *   Four aggregate queries run inside Firebird and come back at DAY level:
 *     revenue + invoice/credit counts per day per rep   (header rows)
 *     cost per day per rep                              (line rows)
 *   ...for this financial year and for the identical span one year earlier.
 *   Months, weeks, rep totals, year totals and every comparison are then
 *   derived from those daily numbers, so they cannot disagree with each other.
 *
 * WHAT IT GUARANTEES
 *   - Money is summed in whole cents. Totals tie to Ostendo exactly.
 *   - Credit notes reduce revenue (they already carry negative amounts in
 *     Ostendo) but are NOT counted as orders. They are reported separately.
 *   - A period still in progress is only ever compared against the SAME number
 *     of days last year. A month that has not started reports no comparison at
 *     all rather than a 100% fall.
 */
import { NextResponse } from 'next/server';
import {
  ostendoSql, resolveRep, toCents, toDollars, pct1,
  fyRange, priorRange, fyMonthKeys, parseIso, iso, q, normaliseDate,
} from '@/lib/ostendo';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/* Revenue and order counts come from header rows only. Joining headers to lines
 * and summing INVOICENETTAMOUNT would multiply each invoice by its line count. */
const headerSql = (start, end) => `
  SELECT h.INVOICEDATE AS D, h.INVOICEORCREDIT AS OC, h.SALESPERSON AS SP,
         COUNT(*) AS N, SUM(h.INVOICENETTAMOUNT) AS NETT,
         SUM(h.LINEDISCOUNTAMOUNT) AS DISC
  FROM SALESINVOICEHEADER h
  WHERE h.INVOICEDATE BETWEEN ${q(start)} AND ${q(end)}
  GROUP BY 1, 2, 3`;

/**
 * When each customer first ever bought. A customer is "new" in the month of
 * their first invoice across ALL of history, not the first time they appear in
 * whatever period happens to be on screen.
 */
const firstOrderSql = () => `
  SELECT EXTRACT(YEAR FROM F.FIRSTD) AS YR, EXTRACT(MONTH FROM F.FIRSTD) AS MO, COUNT(*) AS N
  FROM (SELECT h.CUSTOMER AS C, MIN(h.INVOICEDATE) AS FIRSTD
        FROM SALESINVOICEHEADER h WHERE h.INVOICEORCREDIT <> 'Credit' GROUP BY 1) F
  GROUP BY 1, 2`;

/* Cost of goods. Credit-note lines carry negative quantities, so they reduce
 * COGS here exactly as they reduce revenue above. */
const costSql = (start, end) => `
  SELECT h.INVOICEDATE AS D, h.SALESPERSON AS SP,
         SUM(l.INVOICEQTY * l.INVOICEUNITCOST) AS COST
  FROM SALESINVOICELINES l
  JOIN SALESINVOICEHEADER h ON h.INVOICENUMBER = l.INVOICENUMBER
  WHERE h.INVOICEDATE BETWEEN ${q(start)} AND ${q(end)}
  GROUP BY 1, 2`;

/* Ostendo hands dates back as D/M/YYYY, not ISO. Normalise before comparing. */
const dayKey = (v) => normaliseDate(v);

/** Empty accumulator. All money is held as exact integer units, never floats. */
const blank = () => ({ revenue: 0, cost: 0, invoices: 0, credits: 0, creditValue: 0, discount: 0 });

const add = (t, s) => {
  t.revenue     += s.revenue;
  t.cost        += s.cost;
  t.invoices    += s.invoices;
  t.credits     += s.credits;
  t.creditValue += s.creditValue;
  t.discount    += s.discount;
  return t;
};

/** Turn an accumulator into the dollars shape the UI renders, rounding once. */
const present = (a) => {
  const grossProfit = a.revenue - a.cost;
  return {
    revenue:     toDollars(a.revenue),
    cost:        toDollars(a.cost),
    grossProfit: toDollars(grossProfit),
    marginPct:   pct1(grossProfit, a.revenue),
    invoices:    a.invoices,
    credits:     a.credits,
    creditValue: toDollars(a.creditValue),
    discounts:   toDollars(a.discount),
    aov:         a.invoices > 0 ? toDollars(a.revenue / a.invoices) : 0,
  };
};


/**
 * Make a set of rounded parts add up to the rounded whole, exactly.
 *
 * Cost of goods carries more precision than a cent (quantity x unit cost), so
 * rounding each rep and each month on its own leaves the column one cent short
 * of the total underneath it. That is correct arithmetic and still wrong on a
 * report: the rows have to add up to the total printed below them.
 *
 * Each part keeps its own correctly rounded value; the leftover cent is given to
 * the largest part, where it distorts least. Nothing is invented — the total is
 * still the exact figure Ostendo holds.
 */
function reconcile(parts, totalDollars, get, set) {
  if (!parts.length) return;
  const totalC = Math.round(totalDollars * 100);
  const sumC   = parts.reduce((acc, p) => acc + Math.round(get(p) * 100), 0);
  let residual = totalC - sumC;
  if (residual === 0) return;
  const order = [...parts].sort((a, b) => Math.abs(get(b)) - Math.abs(get(a)));
  for (let i = 0; residual !== 0 && i < order.length; i++) {
    const step = residual > 0 ? 1 : -1;
    set(order[i], (Math.round(get(order[i]) * 100) + step) / 100);
    residual -= step;
  }
}

/** Re-derive gross profit and margin after a cost has been nudged. */
function restate(row) {
  row.grossProfit = Math.round((row.revenue - row.cost) * 100) / 100;
  row.marginPct   = row.revenue > 0
    ? Math.round((row.grossProfit / row.revenue) * 1000) / 10 : null;
}

const growth = (curr, prior) =>
  prior > 0 ? Math.round(((curr - prior) / prior) * 1000) / 10 : null;

/** Build day -> {overall, byRep} from one header result set and one cost set. */
function indexDays(headerRows, costRows) {
  const days = new Map();
  const touch = (d) => {
    if (!days.has(d)) days.set(d, { total: blank(), reps: new Map() });
    return days.get(d);
  };
  const touchRep = (day, code) => {
    if (!day.reps.has(code)) day.reps.set(code, blank());
    return day.reps.get(code);
  };

  for (const r of headerRows) {
    const d = dayKey(r.D); if (!d) continue;
    const code     = String(r.SP ?? '').trim();
    const isCredit = String(r.OC ?? '').toLowerCase().startsWith('cred');
    const cents    = toCents(r.NETT);
    const disc     = toCents(r.DISC);
    const n        = Number(r.N) || 0;

    const entry = touch(d);
    const rep   = touchRep(entry, code);

    // Revenue always includes credits — they are how returns and rebates land.
    // Order counts never do: a credit note is not a sale.
    for (const bucket of [entry.total, rep]) {
      bucket.revenue  += cents;
      bucket.discount += disc;
      if (isCredit) { bucket.credits += n; bucket.creditValue += cents; }
      else          { bucket.invoices += n; }
    }
  }

  for (const r of costRows) {
    const d = dayKey(r.D); if (!d) continue;
    const code  = String(r.SP ?? '').trim();
    const cents = toCents(r.COST);
    const entry = touch(d);
    entry.total.cost += cents;
    touchRep(entry, code).cost += cents;
  }

  return days;
}

/**
 * Sum every day whose date falls in [from, to].
 * `codes` (a Set) narrows to one salesperson. It is a Set rather than a single
 * code because Ostendo issues legacy clearance accounts a "-1" suffix — 460 and
 * 460-1 are both Chris, and must appear as one row, not two.
 */
function sumRange(days, from, to, codes = null) {
  const out = blank();
  for (const [d, entry] of days) {
    if (d < from || d > to) continue;
    if (codes === null) { add(out, entry.total); continue; }
    for (const c of codes) { const src = entry.reps.get(c); if (src) add(out, src); }
  }
  return out;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const today = new Date();
  const fy    = parseInt(searchParams.get('fy') || '', 10) ||
                (today.getUTCMonth() >= 3 ? today.getUTCFullYear() : today.getUTCFullYear() - 1);

  try {
    // Find the real extent of the data first. Comparing "1 Apr to today" against
    // "1 Apr to today last year" is only fair if today actually has data; if the
    // most recent invoice is two days old, both sides must stop there.
    const bounds = await ostendoSql(
      `SELECT MIN(INVOICEDATE) AS FIRSTD, MAX(INVOICEDATE) AS LASTD FROM SALESINVOICEHEADER`
    ).catch(() => []);
    const lastLoaded  = normaliseDate(bounds?.[0]?.LASTD);
    const firstLoaded = normaliseDate(bounds?.[0]?.FIRSTD);

    const fullRange = fyRange(fy, today);
    const range = lastLoaded && lastLoaded < fullRange.end
      ? { ...fullRange, end: lastLoaded }
      : fullRange;
    const prior = priorRange(range);

    const [hdr, cost, hdrPrior, costPrior, firstOrders] = await Promise.all([
      ostendoSql(headerSql(range.start, range.end)),
      ostendoSql(costSql(range.start, range.end)),
      ostendoSql(headerSql(prior.start, prior.end)),
      ostendoSql(costSql(prior.start, prior.end)),
      ostendoSql(firstOrderSql()).catch(() => []),
    ]);

    /* New customers by month. Ostendo's history starts part-way through, so every
     * customer that already existed then looks "new" in that first month (421 of
     * them). Counts are withheld for that month and anything before it — the data
     * cannot tell a genuinely new customer from a pre-existing one. */
    const newCustByMonth = new Map();
    for (const r of firstOrders) {
      const key = `${r.YR}-${String(r.MO).padStart(2, '0')}`;
      newCustByMonth.set(key, (newCustByMonth.get(key) || 0) + (Number(r.N) || 0));
    }
    const firstDataMonth = normaliseDate(bounds?.[0]?.FIRSTD)?.substring(0, 7) || null;
    const newCustFor = (monthKey) =>
      (firstDataMonth && monthKey <= firstDataMonth) ? null : (newCustByMonth.get(monthKey) || 0);

    const days      = indexDays(hdr, cost);
    const daysPrior = indexDays(hdrPrior, costPrior);

    const todayIso = range.end;   // the last day we actually hold data for
    const months   = fyMonthKeys(fy);

    /* Ostendo's records begin part-way through a financial year. Comparing a
     * full year against a window that is mostly missing produces a number that
     * looks like explosive growth and means nothing, so any comparison whose
     * earlier window starts before the first invoice on file is withheld
     * rather than shown. */
    const covered = (windowStart) => !firstLoaded || windowStart >= firstLoaded;
    const priorComparable = covered(prior.start);

    /* ── Months ──────────────────────────────────────────────────────────────
     * A month in progress is compared against the same days last year, never
     * against the whole of last year's month.                                  */
    const monthRows = months.map(({ key, label, year, monthIdx }) => {
      const first    = `${key}-01`;
      const lastDay  = new Date(Date.UTC(year, monthIdx + 1, 0)).getUTCDate();
      const last     = `${key}-${String(lastDay).padStart(2, '0')}`;
      const started  = first <= todayIso;
      const complete = last <= todayIso;
      const through  = complete ? last : (started ? todayIso : null);

      const curr = started ? sumRange(days, first, through) : blank();

      // Same window, one year earlier — day for day.
      const shiftYear = (s) => `${Number(s.substring(0, 4)) - 1}${s.substring(4)}`;
      const priorSum  = started
        ? sumRange(daysPrior, shiftYear(first), shiftYear(through))
        : blank();
      // Whole prior month, for context when this month is only part-done.
      const priorFull = sumRange(daysPrior, shiftYear(first), shiftYear(last));

      return {
        key, label, year,
        started, complete,
        through,
        daysElapsed: started ? Math.round((parseIso(through) - parseIso(first)) / 86400000) + 1 : 0,
        daysInMonth: lastDay,
        newCustomers: started ? newCustFor(key) : null,
        ...present(curr),
        prior:      present(priorSum),
        priorFull:  present(priorFull),
        priorComparable: started && covered(shiftYear(first)),
        growthPct: started && covered(shiftYear(first))
          ? growth(curr.revenue, priorSum.revenue) : null,
      };
    });

    /* ── Weeks ───────────────────────────────────────────────────────────────
     * Calendar weeks inside each month: 1-7, 8-14, 15-21, 22-28, 29-end.
     * `days` says how long the bucket actually is, so a 3-day month-end stub is
     * never mistaken for a collapse in trade.                                  */
    const weekRows = [];
    for (const m of monthRows) {
      if (!m.started) continue;
      for (let w = 1; w <= 5; w++) {
        const from = (w - 1) * 7 + 1;
        if (from > m.daysInMonth) continue;
        const to      = Math.min(w * 7, m.daysInMonth);
        const fromIso = `${m.key}-${String(from).padStart(2, '0')}`;
        const toIso   = `${m.key}-${String(to).padStart(2, '0')}`;
        if (fromIso > todayIso) continue;
        const cappedTo = toIso <= todayIso ? toIso : todayIso;
        const elapsed  = Math.round((parseIso(cappedTo) - parseIso(fromIso)) / 86400000) + 1;
        weekRows.push({
          monthKey: m.key, monthLabel: m.label, week: w,
          label: `${m.label} W${w}`,
          dateRange: `${from}–${to} ${m.label}`,
          start: fromIso, end: cappedTo,
          days: elapsed, expectedDays: to - from + 1,
          complete: toIso <= todayIso,
          ...present(sumRange(days, fromIso, cappedTo)),
        });
      }
    }

    /* ── Reps ────────────────────────────────────────────────────────────────
     * Built from exactly the same daily buckets as the totals above, so the rep
     * table always adds up to the year total.                                  */
    const repCodes = new Set();
    for (const [, e] of days)      for (const c of e.reps.keys()) repCodes.add(c);
    for (const [, e] of daysPrior) for (const c of e.reps.keys()) repCodes.add(c);

    // One row per person, not per code: 460 and 460-1 are both Chris.
    const byName = new Map();
    for (const code of repCodes) {
      const name = resolveRep(code);
      if (!byName.has(name)) byName.set(name, new Set());
      byName.get(name).add(code);
    }

    const repRows = [...byName].map(([name, codes]) => {
      const curr  = sumRange(days,      range.start, range.end, codes);
      const prev  = sumRange(daysPrior, prior.start, prior.end, codes);
      const perMonth = monthRows.map((m) => ({
        key: m.key, label: m.label, started: m.started,
        ...present(m.started ? sumRange(days, `${m.key}-01`, m.through, codes) : blank()),
      }));
      const perWeek = weekRows.map((w) => ({
        monthKey: w.monthKey, week: w.week,
        ...present(sumRange(days, w.start, w.end, codes)),
      }));
      return {
        code: [...codes].sort().join(', ') || '(none)',
        name,
        // false = this code has no name yet and is showing as a bare number
        named: name !== [...codes][0],
        ...present(curr),
        prior:     present(prev),
        growthPct: priorComparable ? growth(curr.revenue, prev.revenue) : null,
        months: perMonth,
        weeks:  perWeek,
      };
    })
      // Only reps who actually traded in this period. Codes that carried sales in
      // an earlier year but have nothing allocated to them now were listing as
      // rows of zeros, which is noise rather than information.
      .filter((r) => r.revenue !== 0 || r.invoices > 0 || r.credits > 0)
      .sort((a, b) => b.revenue - a.revenue);

    /* ── Year totals ─────────────────────────────────────────────────────── */
    const currTotal  = sumRange(days,      range.start, range.end);
    const priorTotal = sumRange(daysPrior, prior.start, prior.end);

    /* Make every column add up to the total printed beneath it. */
    const started = monthRows.filter((m) => m.started);
    reconcile(started, currTotal ? toDollars(currTotal.cost) : 0, (r) => r.cost, (r, v) => { r.cost = v; restate(r); });
    started.forEach(restate);

    reconcile(repRows, toDollars(currTotal.cost), (r) => r.cost, (r, v) => { r.cost = v; restate(r); });
    repRows.forEach(restate);

    // Weeks inside each month, and each rep's months inside that rep.
    for (const m of started) {
      const wk = weekRows.filter((w) => w.monthKey === m.key);
      reconcile(wk, m.cost, (w) => w.cost, (w, v) => { w.cost = v; restate(w); });
      wk.forEach(restate);
    }
    for (const r of repRows) {
      const ms = r.months.filter((m) => m.started);
      reconcile(ms, r.cost, (m) => m.cost, (m, v) => { m.cost = v; restate(m); });
      ms.forEach(restate);
    }

    const firstSeen = bounds?.[0]?.FIRSTD ? dayKey(bounds[0].FIRSTD) : null;
    const lastSeen  = bounds?.[0]?.LASTD  ? dayKey(bounds[0].LASTD)  : null;

    return NextResponse.json({
      fy,
      generatedAt: new Date().toISOString(),
      range: { ...range, throughLabel: range.complete ? 'full year' : `to ${range.end}` },
      prior,
      dataAvailable: {
        first: firstSeen, last: lastSeen,
        // Is the whole of THIS financial year on file?
        coversWholeYear: Boolean(firstLoaded && firstLoaded <= range.start),
      },
      months: monthRows,
      weeks:  weekRows,
      reps:   repRows,
      totals: {
        newCustomers: monthRows.some((m) => m.started && m.newCustomers === null)
          ? null
          : monthRows.reduce((acc, m) => acc + (m.newCustomers || 0), 0),
        ...present(currTotal),
        prior:      present(priorTotal),
        growthPct:  priorComparable ? growth(currTotal.revenue, priorTotal.revenue) : null,
        priorComparable,
        comparable: !priorComparable
          ? `no comparison shown — Ostendo's records start ${firstLoaded || 'later'}, so ${prior.start} to ${prior.end} is not fully on file`
          : !range.complete
            ? `1 Apr – ${range.end} vs 1 Apr – ${prior.end}`
            : 'full financial year vs full financial year',
      },
    });
  } catch (err) {
    console.error('[ostendo/fy]', err.message);
    return NextResponse.json({ fy, error: err.message, months: [], weeks: [], reps: [], totals: null }, { status: 502 });
  }
}
