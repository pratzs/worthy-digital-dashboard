/**
 * Monday summary for management (Command Center, 26 Nov 2026). A DRAFT: shown on the Command Center with Copy and
 * "Open as email"; nothing is ever sent from here (Worthy rule: messages are drafted, a person sends them).
 *
 * Last week (Monday to Sunday) and the month so far, for all three businesses, on the agreed sales basis:
 *   Worthy Products  lib/salesBasis.js wpSales (the Sunday email's reader) for the week, the year figures for the month
 *   Worthy Oceania   lib/marginMix.js for the week, the year figures for the month
 *   Dutch Rusk       the Ostendo year figures (month so far and last month)
 * Margin watch: any salesperson whose month margin is 2 or more points under their own year margin (on $10k+ of sales),
 * and what pulled Worthy Products' margin last week (lib/marginMix.js). Short-dated stock (lib/shortDated.js).
 * Meeting actions still open (lib/meeting.js).
 */
import { nzToday, nzFinancialYear } from '@/lib/ostendo';
import { readFY } from '@/lib/odooFyCache';
import { readSouth } from '@/lib/ostendoCache';
import { wpSales } from '@/lib/salesBasis';
import { marginMix } from '@/lib/marginMix';
import { shortDated } from '@/lib/shortDated';
import { readMeeting } from '@/lib/meeting';

const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const money = (v) => (v == null ? '-' : `$${Math.round(v).toLocaleString('en-NZ')}`);
const pctTxt = (v) => (v == null ? '-' : `${Number(v).toFixed(1)}%`);
const DROP = 2, MIN_SALES = 10000;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const nzDay = (iso, year = true) => `${Number(iso.slice(8, 10))} ${MON[Number(iso.slice(5, 7)) - 1]}${year ? ` ${iso.slice(0, 4)}` : ''}`;

/** Last full Monday-to-Sunday week before `today`. */
function lastWeek(today) {
  const wd = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;   // 0 = Monday
  const end = addDays(today, -wd - 1);
  return { start: addDays(end, -6), end };
}
const safe = async (f) => { try { return await f(); } catch (e) { return { error: String(e.message || e).slice(0, 120) }; } };

function marginWatch(payload, business) {
  const out = [];
  if (!payload?.reps) return out;
  const months = (payload.months || []).filter((m) => m.started);
  const last = [...months].reverse().find((m) => m.complete); const cur = months.find((m) => !m.complete);
  for (const r of payload.reps) {
    if (r.marginPct == null) continue;
    for (const m of [cur, last].filter(Boolean)) {
      const rm = r.months?.find((x) => x.key === m.key);
      if (!rm || rm.marginPct == null || (rm.revenue || 0) < MIN_SALES) continue;
      if (rm.marginPct <= r.marginPct - DROP) out.push({ business, rep: r.name, month: m.label, through: m.complete ? null : m.through, margin: rm.marginPct, usual: r.marginPct, sales: rm.revenue });
    }
  }
  return out;
}
const monthOf = (payload) => {
  const months = (payload?.months || []).filter((m) => m.started);
  const cur = months.find((m) => !m.complete) || months[months.length - 1];
  const last = [...months].reverse().find((m) => m.complete && m !== cur);
  return { cur, last };
};

export async function weeklySummary() {
  const today = nzToday(); const fy = nzFinancialYear(); const wk = lastWeek(today);
  const [wp, wpFy, ocWeek, ocFy, dr, mixWk, sd, meet] = await Promise.all([
    safe(() => wpSales(wk.start, wk.end)),
    safe(async () => (await readFY(4, fy)).payload),
    safe(() => marginMix(`${wk.start}:${wk.end}`, 1)),
    safe(async () => (await readFY(1, fy)).payload),
    safe(() => readSouth('fy', `?fy=${fy}`)),
    safe(() => marginMix(`${wk.start}:${wk.end}`, 4)),
    safe(() => shortDated()),
    safe(() => readMeeting()),
  ]);
  const wpM = monthOf(wpFy), ocM = monthOf(ocFy), drM = monthOf(dr);
  const watch = [...marginWatch(wpFy, 'Worthy Products'), ...marginWatch(ocFy, 'Worthy Oceania'), ...marginWatch(dr, 'Dutch Rusk')]
    .sort((a, b) => (a.margin - a.usual) - (b.margin - b.usual));
  const pulls = mixWk?.groups ? mixWk.groups.filter((g) => g.pullPts > 0.05).sort((a, b) => b.pullPts - a.pullPts).slice(0, 3) : [];
  const openActions = (meet?.actions || []).filter((a) => a.status === 'sent');
  const openPoints = (meet?.points || []).filter((p) => p.status === 'open');

  const business = [
    { name: 'Worthy Products', week: wp?.worthyProducts ? { sales: wp.worthyProducts.sales, margin: wp.worthyProducts.marginPct } : null,
      month: wpM.cur ? { label: wpM.cur.label, through: wpM.cur.through, sales: wpM.cur.revenue, margin: wpM.cur.marginPct } : null,
      lastMonth: wpM.last ? { label: wpM.last.label, sales: wpM.last.revenue, margin: wpM.last.marginPct } : null,
      sisters: wp?.sisterCompanies?.total ? { sales: wp.sisterCompanies.total.sales, margin: wp.sisterCompanies.total.marginPct } : null },
    { name: 'Worthy Oceania', week: ocWeek?.revenue != null ? { sales: ocWeek.revenue, margin: ocWeek.marginPct } : null,
      month: ocM.cur ? { label: ocM.cur.label, through: ocM.cur.through, sales: ocM.cur.revenue, margin: ocM.cur.marginPct } : null,
      lastMonth: ocM.last ? { label: ocM.last.label, sales: ocM.last.revenue, margin: ocM.last.marginPct } : null },
    { name: 'Dutch Rusk', week: null,
      month: drM.cur ? { label: drM.cur.label, through: drM.cur.through, sales: drM.cur.revenue, margin: drM.cur.marginPct } : null,
      lastMonth: drM.last ? { label: drM.last.label, sales: drM.last.revenue, margin: drM.last.marginPct } : null },
  ];

  // The draft, plain text
  const L = [];
  L.push(`Weekly summary, ${nzDay(wk.start, false)} to ${nzDay(wk.end)}`, '');
  for (const b of business) {
    const parts = [];
    if (b.week) parts.push(`last week ${money(b.week.sales)} at ${pctTxt(b.week.margin)}`);
    if (b.month) parts.push(`${b.month.label} so far ${money(b.month.sales)} at ${pctTxt(b.month.margin)}`);
    if (b.lastMonth) parts.push(`${b.lastMonth.label} ${money(b.lastMonth.sales)} at ${pctTxt(b.lastMonth.margin)}`);
    L.push(`${b.name}: ${parts.join('; ') || 'figures not available'}`);
    if (b.sisters) L.push(`  Sold to Dutch Rusk and Oceania last week: ${money(b.sisters.sales)} at ${pctTxt(b.sisters.margin)} (not in the figures above)`);
  }
  L.push('', 'Margin watch');
  if (pulls.length) L.push(`  Worthy Products last week: biggest pulls on margin were ${pulls.map((g) => `${g.label.toLowerCase()} (${g.pullPts.toFixed(1)} pts)`).join(', ')}.`);
  if (watch.length) for (const w of watch.slice(0, 8)) L.push(`  ${w.rep} (${w.business}): ${w.month}${w.through ? ' so far' : ''} ${pctTxt(w.margin)} against ${pctTxt(w.usual)} for the year, on ${money(w.sales)}`);
  else L.push('  No salesperson is 2 points or more under their usual margin.');
  if (sd?.totals) {
    const past = sd.bands?.find((x) => x.label === 'Past best-before');
    L.push('', 'Short-dated stock (Worthy Products)');
    L.push(`  ${sd.totals.lots} lots reach best-before within 90 days or have passed it, costing ${money(sd.totals.cost)}.`);
    if (past?.lots) L.push(`  ${past.lots} lots (${money(past.cost)}) are already past best-before.`);
    L.push(`  ${sd.totals.wontSellLots} lots (${money(sd.totals.wontSellCost)}) won't sell in time at the current pace.`);
  }
  L.push('', 'Ecom x Marketing');
  L.push(`  ${openActions.length} actions sent to Asana, ${openPoints.length} points still to discuss.`);
  return {
    generatedAt: new Date().toISOString(), week: wk, business, watch, pulls: pulls.map((g) => ({ label: g.label, pts: g.pullPts })),
    shortDated: sd?.totals ? { ...sd.totals, past: sd.bands?.find((x) => x.label === 'Past best-before') || null } : null,
    meeting: { actions: openActions.length, points: openPoints.length },
    errors: Object.entries({ wp, wpFy, ocWeek, ocFy, dr, mixWk, sd, meet }).filter(([, v]) => v?.error).map(([k, v]) => `${k}: ${v.error}`),
    text: L.join('\n'),
  };
}
