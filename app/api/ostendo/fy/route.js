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
         COUNT(*) AS N, SUM(h.INVOICENETTAMOUNT) AS NETT
  FROM SALESINVOICEHEADER h
  WHERE h.INVOICEDATE BETWEEN ${q(start)} AND ${q(end)}
  GROUP BY 1, 2, 3`;

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

/** Empty accumulator, all money in integer cents. */
const blank = () => ({ revenue: 0, cost: 0, invoices: 0, credits: 0, creditValue: 0 });

const add = (t, s) => {
  t.revenue     += s.revenue;
  t.cost        += s.cost;
  t.invoices    += s.invoices;
  t.credits     += s.credits;
  t.creditValue += s.creditValue;
  return t;
};

/** Turn a cents accumulator into the dollars shape the UI renders. */
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
    aov:         a.invoices > 0 ? toDollars(Math.round(a.revenue / a.invoices)) : 0,
  };
};

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
    const n        = Number(r.N) || 0;

    const entry = touch(d);
    const rep   = touchRep(entry, code);

    // Revenue always includes credits — they are how returns and rebates land.
    // Order counts never do: a credit note is not a sale.
    for (const bucket of [entry.total, rep]) {
      bucket.revenue += cents;
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

/** Sum every day whose date falls in [from, to]. */
function sumRange(days, from, to, repCode = null) {
  const out = blank();
  for (const [d, entry] of days) {
    if (d < from || d > to) continue;
    const src = repCode === null ? entry.total : entry.reps.get(repCode);
    if (src) add(out, src);
  }
  return out;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const today = new Date();
  const fy    = parseInt(searchParams.get('fy') || '', 10) ||
                (today.getUTCMonth() >= 3 ? today.getUTCFullYear() : today.getUTCFullYear() - 1);

  try {
    const range = fyRange(fy, today);
    const prior = priorRange(range);

    const [hdr, cost, hdrPrior, costPrior, bounds] = await Promise.all([
      ostendoSql(headerSql(range.start, range.end)),
      ostendoSql(costSql(range.start, range.end)),
      ostendoSql(headerSql(prior.start, prior.end)),
      ostendoSql(costSql(prior.start, prior.end)),
      ostendoSql(`SELECT MIN(INVOICEDATE) AS FIRSTD, MAX(INVOICEDATE) AS LASTD FROM SALESINVOICEHEADER`)
        .catch(() => []),
    ]);

    const days      = indexDays(hdr, cost);
    const daysPrior = indexDays(hdrPrior, costPrior);

    const todayIso = iso(today);
    const months   = fyMonthKeys(fy);

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
        ...present(curr),
        prior:      present(priorSum),
        priorFull:  present(priorFull),
        growthPct:  started ? growth(curr.revenue, priorSum.revenue) : null,
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

    const repRows = [...repCodes].map((code) => {
      const curr  = sumRange(days,      range.start, range.end, code);
      const prev  = sumRange(daysPrior, prior.start, prior.end, code);
      const perMonth = monthRows.map((m) => ({
        key: m.key, label: m.label, started: m.started,
        ...present(m.started ? sumRange(days, `${m.key}-01`, m.through, code) : blank()),
      }));
      const perWeek = weekRows.map((w) => ({
        monthKey: w.monthKey, week: w.week,
        ...present(sumRange(days, w.start, w.end, code)),
      }));
      return {
        code: code || '(none)',
        name: resolveRep(code),
        named: code === '' || Boolean(resolveRep(code) !== code),
        ...present(curr),
        prior:     present(prev),
        growthPct: growth(curr.revenue, prev.revenue),
        months: perMonth,
        weeks:  perWeek,
      };
    })
      .filter((r) => r.revenue !== 0 || r.invoices > 0 || r.prior.revenue !== 0)
      .sort((a, b) => b.revenue - a.revenue);

    /* ── Year totals ─────────────────────────────────────────────────────── */
    const currTotal  = sumRange(days,      range.start, range.end);
    const priorTotal = sumRange(daysPrior, prior.start, prior.end);

    const firstSeen = bounds?.[0]?.FIRSTD ? dayKey(bounds[0].FIRSTD) : null;
    const lastSeen  = bounds?.[0]?.LASTD  ? dayKey(bounds[0].LASTD)  : null;

    return NextResponse.json({
      fy,
      generatedAt: new Date().toISOString(),
      range: { ...range, throughLabel: range.complete ? 'full year' : `to ${range.end}` },
      prior,
      dataAvailable: { first: firstSeen, last: lastSeen },
      months: monthRows,
      weeks:  weekRows,
      reps:   repRows,
      totals: {
        ...present(currTotal),
        prior:     present(priorTotal),
        growthPct: growth(currTotal.revenue, priorTotal.revenue),
        comparable: !range.complete
          ? `1 Apr – ${range.end} vs 1 Apr – ${prior.end}`
          : 'full financial year vs full financial year',
      },
    });
  } catch (err) {
    console.error('[ostendo/fy]', err.message);
    return NextResponse.json({ fy, error: err.message, months: [], weeks: [], reps: [], totals: null }, { status: 502 });
  }
}
