/**
 * Gross profit and margin on ONLINE SALES (27 Nov 2026), worked out order by order.
 *
 * Online sales = every shop channel except Point of Sale (docs/DESIGN-PLAYBOOK.md). For each shop:
 *   1. The period's online orders from the shop's own reports (order id, number, channel, net sales). Their net sales add up
 *      to the online sales figure the Command Center shows.
 *   2. Each order's invoices, and the cost booked on them:
 *        Worthy Products  Odoo company 4: the sale order ONLINE_#<number> and its invoices and credit notes; product lines
 *                         (freight never counted), the cost Odoo booked on each invoice, standard cost where none was booked
 *                         (the agreed basis, docs/SALES-BASIS.md). Free-in, free-out merchandise has $0 and $0.
 *        Dutch Rusk       Ostendo: the sales order carrying the shop order id (SALESHEADER.ADDITIONALFIELD_4), the
 *                         invoices that point at it (GROUPORDERNUMBERS), stock lines with the Dutch Rusk headline's cost
 *                         rules (suspect costs left out of the margin).
 *   3. Gross profit = invoiced sales with a cost minus that cost; margin = gross profit / invoiced sales with a cost.
 * Orders not invoiced yet are counted and reported, never estimated. Shared copy with a lock, 30 minutes (6 hours for a
 * period that has ended).
 */
import { shopifyql } from '@/lib/webStats';
import { odooExec } from '@/lib/repData';
import { ostendoSql, q, nzToday, EFF_UNIT_COST_H as EFF_UNIT_COST, ITEM_JOIN } from '@/lib/ostendo';
import { STOCK_LINE, SUSPECT } from '@/lib/ostendoFy';
import { FREIGHT_ACCOUNTS, FREIGHT_PRODUCT_IDS } from '@/lib/salesBasis';
import { readWeeks } from '@/lib/odooWeeksCache';

const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const num = (v) => Number(v) || 0;
const idOf = (v) => (Array.isArray(v) ? v[0] : v || null);
const chunks = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };

async function shopOrders(shop, from, to) {
  const rows = await shopifyql(`FROM sales SHOW orders, net_sales GROUP BY order_id, order_name, sales_channel SINCE ${from} UNTIL ${to} LIMIT 20000`, shop);
  const online = rows.filter((r) => String(r.sales_channel) !== 'Point of Sale' && r.order_id);
  /* placed: an order placed in the period (orders = 1). A row with orders = 0 is a refund in the period of an order placed
     earlier: it counts in online sales (as the shop's net sales does) but is never matched to invoices, or the earlier
     order's own invoice would land in this period's margin (27 Nov 2026). */
  return online.map((r) => ({ id: String(r.order_id), name: String(r.order_name), channel: String(r.sales_channel), net: num(r.net_sales), placed: num(r.orders) > 0 }));
}

/* ── Worthy Products: Odoo ── */
async function worthyCost(orders) {
  const base = await odooExec();
  const exec = (m, meth, a, kw = {}, ms) => base(m, meth, a, { ...kw, context: { allowed_company_ids: [4], company_id: 4, ...(kw.context || {}) } }, ms);
  const names = [...new Set(orders.map((o) => `ONLINE_${o.name}`))];
  const sos = [];
  for (const c of chunks(names, 400)) sos.push(...await exec('sale.order', 'search_read', [[['company_id', '=', 4], ['name', 'in', c]]], { fields: ['name', 'invoice_ids'] }, 60000));
  const invIds = [...new Set(sos.flatMap((s) => s.invoice_ids || []))];
  const out = { matched: new Set(sos.filter((s) => (s.invoice_ids || []).length).map((s) => s.name.replace(/^ONLINE_/, ''))), sales: 0, costed: 0, cost: 0 };
  if (!invIds.length) return out;
  const moves = await exec('account.move', 'read', [invIds, ['state', 'move_type']], {}, 60000);
  const posted = moves.filter((m) => m.state === 'posted' && ['out_invoice', 'out_refund'].includes(m.move_type)).map((m) => m.id);
  if (!posted.length) return out;
  const lineIds = [], cogsIds = [];
  for (const c of chunks(posted, 1000)) {
    lineIds.push(...await exec('account.move.line', 'search', [[['move_id', 'in', c], ['display_type', '=', 'product'], ['product_id', '!=', false],
      ['account_id.code', 'not in', FREIGHT_ACCOUNTS], ['product_id', 'not in', FREIGHT_PRODUCT_IDS]]], {}, 60000));
    cogsIds.push(...await exec('account.move.line', 'search', [[['move_id', 'in', c], ['display_type', '=', 'cogs'], ['account_id.code', '=like', '7%'], ['product_id', '!=', false]]], {}, 60000));
  }
  const read = async (ids, f) => { const r = []; for (const c of chunks(ids, 5000)) r.push(...await exec('account.move.line', 'read', [c, f], { load: '' }, 90000)); return r; };
  const [lines, cogs] = await Promise.all([read(lineIds, ['move_id', 'product_id', 'balance', 'quantity']), read(cogsIds, ['move_id', 'product_id', 'balance'])]);
  const booked = new Map();
  for (const c of cogs) { const k = `${c.move_id}|${c.product_id}`; booked.set(k, (booked.get(k) || 0) + num(c.balance)); }
  const refund = new Set(moves.filter((m) => m.move_type === 'out_refund').map((m) => m.id));
  const items = new Map();
  for (const l of lines) {
    const k = `${l.move_id}|${l.product_id}`; const it = items.get(k) || { pid: l.product_id, rev: 0, qty: 0 };
    it.rev += -num(l.balance); it.qty += (refund.has(l.move_id) ? -1 : 1) * num(l.quantity); items.set(k, it);
  }
  const noBooked = [...items.entries()].filter(([k]) => !booked.has(k)).map(([, it]) => it.pid);
  const std = new Map();
  for (const c of chunks([...new Set(noBooked)], 1000)) for (const p of await exec('product.product', 'read', [c, ['standard_price']], {}, 60000)) std.set(p.id, num(p.standard_price));
  for (const [k, it] of items) {
    const cost = booked.has(k) ? booked.get(k) : (std.get(it.pid) || 0) * it.qty;
    if (Math.abs(it.rev) < 0.005 && Math.abs(cost) < 0.005) continue;   // free-in, free-out merchandise
    out.sales += it.rev;
    if (booked.has(k) || std.get(it.pid) > 0) { out.costed += it.rev; out.cost += cost; }
  }
  return out;
}

/* ── Dutch Rusk: Ostendo ── */
async function dutchRuskCost(orders, from, to) {
  const ids = [...new Set(orders.map((o) => o.id))];
  const soOf = new Map();   // sales order number -> shop order id
  for (const c of chunks(ids, 400)) {
    const rows = await ostendoSql(`SELECT ORDERNUMBER, ADDITIONALFIELD_4 SHID FROM SALESHEADER WHERE ADDITIONALFIELD_4 IN (${c.map((x) => q(x)).join(',')})`, 60000);
    for (const r of rows) soOf.set(String(r.ORDERNUMBER).trim(), String(r.SHID).trim());
  }
  const out = { matched: new Set(), sales: 0, costed: 0, cost: 0 };
  if (!soOf.size) return out;
  // Invoices point at their sales orders; they are raised on or after the order, so read from the period start on.
  const until = new Date(Date.parse(`${to}T00:00:00Z`) + 60 * 86400000).toISOString().slice(0, 10);
  const inv = await ostendoSql(`SELECT INVOICENUMBER, GROUPORDERNUMBERS FROM SALESINVOICEHEADER WHERE INVOICEDATE BETWEEN ${q(from)} AND ${q(until)} AND GROUPORDERNUMBERS <> ''`, 90000);
  const invNums = [];
  for (const i of inv) {
    const sos = String(i.GROUPORDERNUMBERS || '').split(/[\s,;]+/).filter(Boolean).filter((s) => soOf.has(s));
    if (sos.length) { invNums.push(String(i.INVOICENUMBER).trim()); sos.forEach((s) => out.matched.add(soOf.get(s))); }
  }
  for (const c of chunks(invNums, 300)) {
    const rows = await ostendoSql(`
      SELECT SUM(CASE WHEN ${STOCK_LINE} THEN l.EXTENDEDNETTPRICE ELSE 0 END) AS REV,
             SUM(l.INVOICEQTY * ${EFF_UNIT_COST}) AS COST,
             SUM(CASE WHEN ${SUSPECT} THEN l.EXTENDEDNETTPRICE ELSE 0 END) AS SUSREV,
             SUM(CASE WHEN ${SUSPECT} THEN l.INVOICEQTY * ${EFF_UNIT_COST} ELSE 0 END) AS SUSCOST
      FROM SALESINVOICELINES l JOIN SALESINVOICEHEADER h ON h.INVOICENUMBER = l.INVOICENUMBER ${ITEM_JOIN}
      WHERE l.INVOICENUMBER IN (${c.map((x) => q(x)).join(',')})`, 90000);
    const r = rows?.[0] || {};
    out.sales += num(r.REV); out.costed += num(r.REV) - num(r.SUSREV); out.cost += num(r.COST) - num(r.SUSCOST);
  }
  return out;
}

async function compute(shop, from, to) {
  const all = await shopOrders(shop, from, to);
  const orders = all.filter((o) => o.placed);
  const c = shop === 'dutchrusk' ? await dutchRuskCost(orders, from, to) : await worthyCost(orders);
  const key = (o) => (shop === 'dutchrusk' ? o.id : o.name);
  const inv = orders.filter((o) => c.matched.has(key(o)));
  const notYet = orders.filter((o) => !c.matched.has(key(o)));
  const gp = c.costed - c.cost;
  return {
    shop, from, to, generatedAt: new Date().toISOString(),
    onlineSales: r2(all.reduce((t, o) => t + o.net, 0)), orders: orders.length,
    refundsOfEarlierOrders: r2(all.filter((o) => !o.placed).reduce((t, o) => t + o.net, 0)),
    invoicedOrders: inv.length, invoicedOnlineSales: r2(inv.reduce((t, o) => t + o.net, 0)),
    notInvoicedOrders: notYet.length, notInvoicedSales: r2(notYet.reduce((t, o) => t + o.net, 0)),
    invoicedSales: r2(c.sales), costedSales: r2(c.costed), cost: r2(c.cost), grossProfit: r2(gp),
    marginPct: c.costed > 0 ? Math.round((gp / c.costed) * 1000) / 10 : null,
  };
}

/** shop: worthyproducts | dutchrusk | all (both added up). */
export async function onlineMargin(shop, from, to) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(to || '') || from > to) throw new Error('from and to must be dates YYYY-MM-DD');
  const today = nzToday();
  const one = async (s) => (await readWeeks(`om2-${s}`, `${from}_${to}`, () => compute(s, from, to), { freshMs: to >= today ? 30 * 60000 : 6 * 3600000 })).payload;
  if (shop !== 'all') return one(shop);
  const parts = await Promise.all(['worthyproducts', 'dutchrusk'].map(one));
  const sum = (k) => r2(parts.reduce((t, p) => t + (p[k] || 0), 0));
  const costed = sum('costedSales'), cost = sum('cost'), gp = r2(costed - cost);
  return { shop: 'all', from, to, generatedAt: parts.map((p) => p.generatedAt).sort()[0], parts,
    onlineSales: sum('onlineSales'), orders: sum('orders'), invoicedOrders: sum('invoicedOrders'), invoicedOnlineSales: sum('invoicedOnlineSales'),
    notInvoicedOrders: sum('notInvoicedOrders'), notInvoicedSales: sum('notInvoicedSales'), invoicedSales: sum('invoicedSales'),
    costedSales: costed, cost, grossProfit: gp, marginPct: costed > 0 ? Math.round((gp / costed) * 1000) / 10 : null };
}
