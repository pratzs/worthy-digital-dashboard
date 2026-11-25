/**
 * Unit cost per product, in the company's own currency.
 *
 * 1. The product's standard cost, where it has one.
 * 2. Otherwise, for a product that was DROPSHIPPED (stock went straight from the
 *    vendor to the customer), the cost Odoo booked on that dropship receipt. A
 *    dropship never enters the warehouse, so it never updates the product's own
 *    cost and the product reads 0 - but the purchase cost is known. It is taken
 *    from the stock valuation layer, which is already in NZD: the purchase order
 *    itself can be in another currency (these were in AUD), and its unit price is
 *    not comparable with an NZD sale.
 * Weighted by quantity across every such receipt. A product with neither stays
 * at 0 and is treated as having no cost, so its sales are left out of margin.
 */
const CHUNK = 400;

export async function loadUnitCosts(exec, cid, productIds, { dropship = true } = {}) {
  const costOf = new Map();
  const dropshipped = new Set();
  const prods = [];
  for (let i = 0; i < productIds.length; i += CHUNK) {
    prods.push(...await exec('product.product', 'read', [productIds.slice(i, i + CHUNK)],
      { fields: ['standard_price', 'categ_id', 'uom_id'] }));
  }
  for (const p of prods) costOf.set(p.id, Number(p.standard_price) || 0);
  const zero = prods.filter((p) => !(Number(p.standard_price) > 0)).map((p) => p.id);
  for (let i = 0; dropship && i < zero.length; i += CHUNK) {
    let layers = [];
    try {
      layers = await exec('stock.valuation.layer', 'search_read',
        [[['product_id', 'in', zero.slice(i, i + CHUNK)], ['company_id', '=', cid], ['quantity', '>', 0],
          ['stock_move_id.location_id.usage', '=', 'supplier'],
          ['stock_move_id.location_dest_id.usage', '=', 'customer']]],
        { fields: ['product_id', 'quantity', 'value'] });
    } catch { layers = []; } // no dropship cost is better than a failed page: those sales stay uncosted
    const acc = new Map();
    for (const l of layers) {
      const pid = l.product_id && l.product_id[0]; if (!pid) continue;
      const a = acc.get(pid) || { q: 0, v: 0 }; a.q += Number(l.quantity) || 0; a.v += Number(l.value) || 0;
      acc.set(pid, a);
    }
    for (const [pid, a] of acc) if (a.q > 0 && a.v > 0) { costOf.set(pid, a.v / a.q); dropshipped.add(pid); }
  }
  const hasCost = [...costOf.values()].some((v) => v > 0);
  return { costOf, hasCost, dropshipped, prods };
}

/**
 * Turns a line's quantity into the product's own unit. Standard cost is held per
 * product unit (Oceania costs fabric per yard), but a line can be sold in another
 * unit of the same kind (metres), and quantity x cost is only right in one unit.
 * Returns a function (row) -> quantity in the product's unit. With `enabled` false
 * the quantity is left exactly as Odoo holds it on the line.
 */
export async function makeQtyInProductUnit(exec, prods, enabled) {
  const raw = (r) => Number(r.quantity) || 0;
  if (!enabled) return raw;
  const prodUom = new Map(prods.map((p) => [p.id, p.uom_id && p.uom_id[0]]));
  let uoms = [];
  try {
    uoms = await exec('uom.uom', 'search_read', [[]], { fields: ['factor', 'category_id'], context: { active_test: false } });
  } catch { return raw; } // units unreadable: quantities stay as the line holds them
  const info = new Map(uoms.map((u) => [u.id, { f: Number(u.factor) || 0, c: u.category_id && u.category_id[0] }]));
  return (r) => {
    const q = raw(r);
    const lu = r.product_uom_id && r.product_uom_id[0];
    const pu = prodUom.get(r.product_id && r.product_id[0]);
    if (!lu || !pu || lu === pu) return q;
    const a = info.get(lu), b = info.get(pu);
    if (!a || !b || !a.f || !b.f || a.c !== b.c) return q;
    return (q / a.f) * b.f;
  };
}

/**
 * The cost Odoo BOOKED on customer invoices and credit notes: the cost-of-goods lines (display_type 'cogs') on the
 * 7xxx expense accounts, which is what accounts reports. `domain` is an invoice-line domain; its display_type filter is
 * swapped for the cost-of-goods one. Returns Map("productId|YYYY-MM" -> dollars), already signed (a credit note's cost
 * comes back negative). Products with no booked cost are simply absent, so callers can fall back to standard cost.
 */
export async function ledgerCostByProductMonth(exec, domain, groupKey = 'date:month', qtyOf = null) {
  const base = [...domain.filter((d) => !(Array.isArray(d) && (d[0] === 'display_type' || d[0] === 'move_id.move_type'))),
    ['display_type', '=', 'cogs'], ['account_id.code', '=like', '7%'], ['product_id', '!=', false], ['date', '!=', false]];
  const side = (type) => exec('account.move.line', 'read_group', [[...base, ['move_id.move_type', '=', type]], ['balance:sum', 'quantity:sum'], ['product_id', 'product_uom_id', groupKey]], { lazy: false }, 90000);
  const [inv, ref] = await Promise.all([side('out_invoice'), side('out_refund')]);
  const out = new Map();
  for (const [rows, sign] of [[inv, 1], [ref, -1]]) {
    for (const r of rows) {
      const pid = r.product_id && r.product_id[0];
      const from = String(r.__range?.[groupKey]?.from || '');
      const k = groupKey === 'date:month' ? from.substring(0, 7) : from.substring(0, 10);
      if (!pid || !k) continue;
      const cur = out.get(`${pid}|${k}`) || { cost: 0, qty: 0 };
      cur.cost += Number(r.balance) || 0;           // already signed: a credit note's cost is negative
      // Quantity in the product's own unit, the same as the invoice lines it is set against (Oceania: metres vs yards).
      cur.qty += sign * (qtyOf ? qtyOf(r) : (Number(r.quantity) || 0));  // stored positive on credit notes
      out.set(`${pid}|${k}`, cur);
    }
  }
  return out;
}
