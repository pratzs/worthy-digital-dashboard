/**
 * Week of the month for a date, weeks running Monday to Sunday and clipped to
 * the month (week 1 is a short stub when the 1st is not a Monday; a month can
 * have six weeks). Same rule as the week buckets in lib/odooFy.js.
 */
export function weekOfMonth(d) {
  const lead = (new Date(d.getFullYear(), d.getMonth(), 1).getDay() + 6) % 7; // 0 = the 1st is a Monday
  return Math.floor((d.getDate() - 1 + lead) / 7) + 1;
}
