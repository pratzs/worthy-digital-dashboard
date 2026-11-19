/**
 * Daily snapshot of every product's STANDARD SELL PRICE, because neither Odoo nor Ostendo keeps a history of it
 * (Odoo does not track list_price changes; Ostendo keeps only the date of the last change).
 *
 * Once a day (.github/workflows/price-snapshot.yml -> /api/cron/price-snapshot) it reads every saleable North product
 * (Odoo "Sales Price") and every active South item (Ostendo standard sell price), compares them with the last snapshot
 * and records each change: date, system, code, product, old price, new price. The first run only stores the starting
 * point, so changes are recorded from 19 Nov 2026 onward. Kept in the shared store (Upstash): the latest snapshot per
 * system, a short list of changes per product, and the latest 500 changes overall.
 */
import { odooExec } from '@/lib/repData';
import { ostendoSql, nzToday } from '@/lib/ostendo';
import { kvGet, kvSet, kvPush, kvRange } from '@/lib/repStore';

const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const SNAP = (sys) => `price:snap:${sys}`;
const CHG = (sys, code) => `price:chg:${sys}:${code}`;
const ALL = 'price:chg:all';

async function readNorth() {
  const exec = await odooExec();
  const rows = await exec('product.product', 'search_read', [[['sale_ok', '=', true], ['company_id', 'in', [4, false]]]],
    { fields: ['default_code', 'name', 'list_price'], limit: 20000 }, 120000);
  return Object.fromEntries(rows.map((r) => [r.default_code || `#${r.id}`, { p: r2(r.list_price), n: String(r.name || '').slice(0, 90) }]));
}
async function readSouth() {
  const rows = await ostendoSql(`SELECT ITEMCODE, ITEMDESCRIPTION, STDSELLPRICE FROM ITEMMASTER WHERE ITEMSTATUS <> 'Inactive'`, 120000);
  return Object.fromEntries((rows || []).filter((r) => String(r.ITEMCODE || '').trim())
    .map((r) => [String(r.ITEMCODE).trim(), { p: r2(r.STDSELLPRICE), n: String(r.ITEMDESCRIPTION || '').trim().slice(0, 90) }]));
}

/** Take today's snapshot for both systems. Returns counts only. */
export async function takePriceSnapshot() {
  const date = nzToday();
  const out = {};
  for (const [sys, read] of [['north', readNorth], ['south', readSouth]]) {
    try {
      const now = await read();
      if (Object.keys(now).length < 50) throw new Error(`only ${Object.keys(now).length} products read, snapshot kept as it was`);
      const prevRaw = await kvGet(SNAP(sys));
      const prev = prevRaw ? JSON.parse(prevRaw) : null;
      let changes = 0;
      if (prev?.items) {
        for (const [code, cur] of Object.entries(now)) {
          const old = prev.items[code];
          if (old && Math.abs(old.p - cur.p) > 0.004) {
            const rec = JSON.stringify({ date, system: sys, code, product: cur.n, from: old.p, to: cur.p });
            await kvPush(CHG(sys, code), rec, 50);
            await kvPush(ALL, rec, 500);
            changes += 1;
          }
        }
      }
      await kvSet(SNAP(sys), JSON.stringify({ date, items: now }));
      out[sys] = { products: Object.keys(now).length, changes, firstSnapshot: !prev };
    } catch (e) {
      out[sys] = { error: String(e?.message || e).slice(0, 160) };
    }
  }
  return { date, ...out };
}

/** Recorded standard price changes for these product codes (both systems). */
export async function snapshotChanges(codes) {
  const lists = await Promise.all(codes.flatMap((c) => ['north', 'south'].map((sys) => kvRange(CHG(sys, c), 50))));
  return lists.flat().map((x) => { try { return JSON.parse(x); } catch { return null; } }).filter(Boolean)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

/** The latest recorded changes across all products. */
export async function recentPriceChanges(n = 100) {
  return (await kvRange(ALL, n)).map((x) => { try { return JSON.parse(x); } catch { return null; } }).filter(Boolean);
}
