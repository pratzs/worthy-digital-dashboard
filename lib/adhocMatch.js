/**
 * Finds the item-master cost for a NON-CODED sale line (Ostendo code ZZZSTOCK, "ad hoc stock"), where the product is
 * only typed into the description, so Ostendo records no cost and the item master cannot be joined by code.
 * These are mostly near-dated cartons cleared below cost; leaving them out of the margin made October 2026 read about
 * a point too high (19.4% against finance's 18.4%).
 *
 * The typed description is matched to an item-master description. Deliberately strict, because a wrong match would
 * put a wrong cost into a finance figure:
 *   - the pack count ("x 36ct") must agree when both state one, and the size ("46g" v "46.7g") must agree within 3%;
 *   - the words must agree (one-letter typing slips allowed: "Watermellon", "Kingzize");
 *   - a near-tie between two master items is accepted only when they cost about the same (flavours of one product);
 *   - where the master holds a cost per single unit while the line is a carton, the cost is multiplied by the count;
 *   - the final cost must sit between 30% and 8 times the line price, or the line stays out of the margin.
 * Checked on 11 Nov 2026 against the costs finance supplied by hand for October 2026: every line it matched carried the same cost.
 * Plain functions, no imports, so the tests can load it directly.
 */
const STOP = new Set(['x', 'ct', 'and', 'the', 'with', 'new', 'count', 'pack', 'g', 'ml', 'units', 'unit']);
export const norm = (s) => String(s || '').toLowerCase().replace(/&/g, ' and ')
  .replace(/\bx\s*(\d+)\s*ct\b/g, ' $1ct ')
  .replace(/(\d)\s*(ct|pk|pc|g|ml|kg|l)\b/g, '$1$2 ')
  .replace(/x\s*(\d+)\b(?!\s*(g|ml|kg|l)\b)/g, ' $1ct ')
  .replace(/[^a-z0-9.]+/g, ' ').trim();
const toks = (s) => norm(s).split(' ').filter((t) => t && !STOP.has(t));
const countOf = (ts) => { const c = ts.filter((t) => /^\d+ct$/.test(t)); return c.length ? parseInt(c[c.length - 1], 10) : null; };
const sizeOf = (ts) => { const c = ts.find((t) => /^\d+(\.\d+)?(g|ml|kg|l)$/.test(t)); return c ? { n: parseFloat(c), u: c.replace(/^[\d.]+/, '') } : null; };
// Same word, allowing one typing slip in words of five letters or more.
const same = (a, b) => {
  if (a === b) return true;
  if (a.length < 5 || b.length < 5 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, d = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++d > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return d + (a.length - i) + (b.length - j) <= 1;
};
const masterCost = (m) => (Number(m.AVERAGECOST) > 0 ? Number(m.AVERAGECOST) : Number(m.STDBUYPRICE) || 0);

export const MIN_SCORE = 0.8;

/** master: rows of ITEMMASTER (ITEMCODE, ITEMDESCRIPTION, AVERAGECOST, STDBUYPRICE). Returns find(description, unitPrice). */
export function adhocMatcher(master) {
  const M = (master || []).filter((m) => masterCost(m) > 0).map((m) => {
    const t = toks(m.ITEMDESCRIPTION);
    return { m, words: t.filter((x) => !/^\d/.test(x)), c: countOf(t), s: sizeOf(t) };
  }).filter((x) => x.words.length >= 2);

  return function find(description, unitPrice) {
    const price = Number(unitPrice) || 0;
    const t = toks(description), words = t.filter((x) => !/^\d/.test(x)), c = countOf(t), s = sizeOf(t);
    if (words.length < 2 || price <= 0) return null;
    let best = null, second = null;
    for (const x of M) {
      if (c && x.c && c !== x.c) continue;
      if (s && x.s && (s.u !== x.s.u || Math.abs(s.n - x.s.n) > Math.max(1, x.s.n * 0.03))) continue;
      const hit = words.filter((w) => x.words.some((y) => same(w, y))).length;
      if (hit < 2) continue;
      const back = x.words.filter((w) => words.some((y) => same(w, y))).length;
      const score = (hit / words.length) * 0.6 + (back / x.words.length) * 0.4;
      if (!best || score > best.score) { second = best; best = { x, score }; }
      else if (!second || score > second.score) second = { x, score };
    }
    if (!best || best.score < MIN_SCORE) return null;
    const unit = masterCost(best.x.m);
    if (second && second.score > best.score - 0.08 && Math.abs(masterCost(second.x.m) - unit) > unit * 0.1) return null;
    // The master sometimes holds the cost of ONE unit while the line is a whole carton.
    const count = c || best.x.c;
    let cost = unit, perUnit = false;
    // Two signs of that: the cost is under half the line price, or the line states a count and the master item does not.
    if (count && count > 1 && (unit < price * 0.5 || (c && !best.x.c))) { cost = unit * count; perUnit = true; }
    if (cost < price * 0.3 || cost > price * 8) return null;
    return {
      code: String(best.x.m.ITEMCODE).trim(), name: String(best.x.m.ITEMDESCRIPTION).trim(),
      unitCost: Math.round(cost * 10000) / 10000, perUnitTimesCount: perUnit, score: Math.round(best.score * 100) / 100,
    };
  };
}
