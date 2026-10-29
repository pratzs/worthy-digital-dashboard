// Checks on a target row. No target figures live in this file or anywhere in the repository.
/* The budget is whole dollars a month. The year's total and GP $ are the figures
   printed on the finance sheet; the twelve months must add up to that total, and
   the sheet's GP $ must be exactly the target GP % of it, or this fails loudly
   rather than showing a target that is not the sheet's. */
export const fyTargetOf = (t) => {
  const sum = Object.values(t.monthly).reduce((a, b) => a + b, 0);
  if (sum !== t.sheetTotal) throw new Error(`Budget for ${t.rep}: months add to ${sum}, the sheet says ${t.sheetTotal}`);
  if (Math.round(t.sheetTotal * t.targetGpPct) !== t.sheetGp * 100) throw new Error(`Budget for ${t.rep}: GP $ ${t.sheetGp} is not ${t.targetGpPct}% of ${t.sheetTotal}`);
  return t.sheetTotal;
};
