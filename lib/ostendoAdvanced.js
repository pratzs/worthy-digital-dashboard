/**
 * Worthy Products South (Dutch Rusk) - analytics tables.
 *
 * WHAT CHANGED AND WHY
 * The previous version pulled every invoice LINE for the period over HTTP, 60
 * invoice numbers at a time. A financial year is ~20,000 invoices and ~330,000
 * lines, so that was ~345 round trips and it exceeded the 60s function limit
 * every single time. The whole analytics half of the dashboard showed
 * "No data available" as a result - silently, because the failure was caught
 * and replaced with empty arrays.
 *
 * Everything is now aggregated inside Firebird: six queries, a few hundred rows
 * back, about three seconds.
 *
 * Other corrections:
 *  - Categories come from ITEMMASTER.ITEMCATEGORY. The line-level
 *    CATALOGUECATEGORY column is empty for every row in this database, which is
 *    why the category table could never populate.
 *  - Cost is INVOICEUNITCOST, the cost recorded when the invoice was raised.
 *    The old code overwrote it with today's ITEMMASTER.AVERAGECOST, which
 *    priced last year's sales at this year's cost.
 *  - Customer lifetime value and "days since last order" are measured over all
 *    of history and against the end of the period being viewed - not against
 *    today, which made every customer look lapsed whenever a past year was open.
 *  - Rebates and credits (descriptor-code lines, no cost) are reported in their
 *    own table instead of appearing as products with impossible margins.
 */
import { NextResponse } from 'next/server';
import {
  ostendoSql, toCents, toDollars, pct1, fyRange, parseIso, iso, q, normaliseDate, nzToday, nzFinancialYear,
} from '@/lib/ostendo';


/* A line whose recorded cost exceeds the sale cannot be right. Product and
 * category tables report both bases so they stay in step with the monthly
 * table's Cost basis switch instead of contradicting it. */
const SUSPECT = `l.INVOICEQTY > 0 AND l.EXTENDEDNETTPRICE > 0
                 AND (l.INVOICEQTY * l.INVOICEUNITCOST > l.EXTENDEDNETTPRICE * 2 OR l.INVOICEUNITCOST = 0)`;
const SOUND = `NOT (${SUSPECT})`;

/* Ostendo has a few catch-all codes (ZZZSTOCK is "ad hoc stock": 358 different products
 * were sold under it this year). Grouped by code they would read as ONE product named after
 * whichever description sorts last, and be the fastest mover in the business. For those codes
 * each description is its own row. Every real product code is grouped by code alone. */
const ADHOC = `CASE WHEN l.LINECODE STARTING WITH 'ZZZ' THEN l.LINEDESCRIPTION ELSE '' END`;

const SALES = (start, end) =>
  `SELECT INVOICENUMBER FROM SALESINVOICEHEADER WHERE INVOICEDATE BETWEEN ${q(start)} AND ${q(end)}`;

export async function handle(request) {
  const { searchParams } = new URL(request.url);
  const today = nzToday();                       // the NZ date, not the server's UTC date
  const fyParam = parseInt(searchParams.get('fy') || '', 10);
  const fy = fyParam || nzFinancialYear();

  let start = searchParams.get('startDate');
  let end   = searchParams.get('endDate');
  if (!start || !end) { const r = fyRange(fy, today); start = r.start; end = r.end; }

  try {
    // Stop at the last invoice actually on file, so the period shown here matches
    // the one the financial-year endpoint reports rather than running to today.
    if (!searchParams.get('endDate')) {
      const bounds = await ostendoSql(
        `SELECT MAX(INVOICEDATE) AS LASTD FROM SALESINVOICEHEADER`
      ).catch(() => []);
      const lastLoaded = normaliseDate(bounds?.[0]?.LASTD);
      if (lastLoaded && lastLoaded < end) end = lastLoaded;
    }

    const inPeriod = SALES(start, end);

    const [products, categories, custPeriod, custLifetime, stock, soldAll, adjustments, fastest, orderCounts] = await Promise.all([
      // 1. Products actually sold in the period (stock lines only).
      //    LEFT JOIN so a product missing from ITEMMASTER still appears, just
      //    without a category, rather than dropping out of the table.
      ostendoSql(`
        SELECT FIRST 200 l.LINECODE AS CODE, ${ADHOC} AS ADHOC, MAX(l.LINEDESCRIPTION) AS NAME,
               MAX(i.ITEMCATEGORY) AS CAT,
               SUM(l.INVOICEQTY) AS QTY, SUM(l.EXTENDEDNETTPRICE) AS NETT,
               SUM(l.INVOICEQTY * l.INVOICEUNITCOST) AS COST,
               SUM(CASE WHEN ${SOUND} THEN l.INVOICEQTY ELSE 0 END) AS QTYC,
               SUM(CASE WHEN ${SOUND} THEN l.EXTENDEDNETTPRICE ELSE 0 END) AS NETTC,
               SUM(CASE WHEN ${SOUND} THEN l.INVOICEQTY * l.INVOICEUNITCOST ELSE 0 END) AS COSTC
        FROM SALESINVOICELINES l
        LEFT JOIN ITEMMASTER i ON i.ITEMCODE = l.LINECODE
        WHERE l.INVOICENUMBER IN (${inPeriod}) AND l.CODETYPE = 'Item Code'
        GROUP BY 1, 2 ORDER BY 6 DESC`),

      // 2. Categories - from the item master, because the line column is blank.
      ostendoSql(`
        SELECT i.ITEMCATEGORY AS CAT, COUNT(DISTINCT l.LINECODE) AS NPROD,
               SUM(l.INVOICEQTY) AS QTY, SUM(l.EXTENDEDNETTPRICE) AS NETT,
               SUM(l.INVOICEQTY * l.INVOICEUNITCOST) AS COST,
               SUM(CASE WHEN ${SOUND} THEN l.INVOICEQTY ELSE 0 END) AS QTYC,
               SUM(CASE WHEN ${SOUND} THEN l.EXTENDEDNETTPRICE ELSE 0 END) AS NETTC,
               SUM(CASE WHEN ${SOUND} THEN l.INVOICEQTY * l.INVOICEUNITCOST ELSE 0 END) AS COSTC
        FROM SALESINVOICELINES l
        JOIN ITEMMASTER i ON i.ITEMCODE = l.LINECODE
        WHERE l.INVOICENUMBER IN (${inPeriod}) AND l.CODETYPE = 'Item Code'
        GROUP BY i.ITEMCATEGORY ORDER BY 4 DESC`),

      // 3. Spend inside the period: the product lines, credit notes taking their share off,
      //    which is the basis of the Overview and Sales by Rep, so every customer adds up to
      //    the same total.
      ostendoSql(`
        SELECT h.CUSTOMER AS NAME, SUM(l.EXTENDEDNETTPRICE) AS NETT
        FROM SALESINVOICELINES l
        JOIN SALESINVOICEHEADER h ON h.INVOICENUMBER = l.INVOICENUMBER
        WHERE h.INVOICEDATE BETWEEN ${q(start)} AND ${q(end)} AND l.CODETYPE = 'Item Code'
        GROUP BY h.CUSTOMER`),

      // 4. Whole trading history - the only honest basis for lifetime value and
      //    for how long a customer has actually been quiet. Orders, first and last
      //    invoice come from invoices only; the spend is product lines, as above.
      Promise.all([
        ostendoSql(`
          SELECT h.CUSTOMER AS NAME, COUNT(*) AS N,
                 MIN(h.INVOICEDATE) AS FIRSTD, MAX(h.INVOICEDATE) AS LASTD,
                 MAX(h.BILLINGEMAIL) AS EMAIL
          FROM SALESINVOICEHEADER h
          WHERE h.INVOICEORCREDIT <> 'Credit'
          GROUP BY h.CUSTOMER`),
        ostendoSql(`
          SELECT h.CUSTOMER AS NAME, SUM(l.EXTENDEDNETTPRICE) AS NETT
          FROM SALESINVOICELINES l
          JOIN SALESINVOICEHEADER h ON h.INVOICENUMBER = l.INVOICENUMBER
          WHERE l.CODETYPE = 'Item Code'
          GROUP BY h.CUSTOMER`, 55000),
      ]),

      // 5. Stock on hand, for capital tied up in slow movers.
      ostendoSql(`
        SELECT FIRST 400 i.ITEMCODE AS CODE, i.ITEMDESCRIPTION AS NAME, i.ITEMCATEGORY AS CAT,
               i.ONHANDQTY AS ONHAND, i.STDBUYPRICE AS BUY, i.AVERAGECOST AS AVGCOST
        FROM ITEMMASTER i WHERE i.ONHANDQTY > 0 ORDER BY i.ONHANDQTY * i.STDBUYPRICE DESC`),

      // 6. Units sold for EVERY stock code, not just the top sellers.
      //     The slow-moving table was looking its quantities up in the top-200
      //     by revenue, which by definition a slow mover is never in - so every
      //     row reported "0 sold" even for items that plainly had sold.
      ostendoSql(`
        SELECT l.LINECODE AS CODE, SUM(l.INVOICEQTY) AS QTY
        FROM SALESINVOICELINES l
        WHERE l.INVOICENUMBER IN (${inPeriod}) AND l.CODETYPE = 'Item Code'
        GROUP BY l.LINECODE`),

      // 7. Rebates, credits and write-offs - non-stock lines carrying no cost.
      ostendoSql(`
        SELECT l.LINECODE AS CODE, MAX(l.LINEDESCRIPTION) AS NAME, COUNT(*) AS N,
               SUM(l.EXTENDEDNETTPRICE) AS NETT
        FROM SALESINVOICELINES l
        WHERE l.INVOICENUMBER IN (${inPeriod}) AND l.CODETYPE <> 'Item Code'
        GROUP BY l.LINECODE ORDER BY 4`),

      // 8. The fastest movers by units, chosen from EVERY product sold. Taking them from the
      //    top 200 by revenue cannot find a fast mover that earns little.
      ostendoSql(`
        SELECT FIRST 25 l.LINECODE AS CODE, ${ADHOC} AS ADHOC, MAX(l.LINEDESCRIPTION) AS NAME,
               MAX(i.ITEMCATEGORY) AS CAT,
               SUM(l.INVOICEQTY) AS QTY, SUM(l.EXTENDEDNETTPRICE) AS NETT,
               SUM(l.INVOICEQTY * l.INVOICEUNITCOST) AS COST,
               SUM(CASE WHEN ${SOUND} THEN l.EXTENDEDNETTPRICE ELSE 0 END) AS NETTC,
               SUM(CASE WHEN ${SOUND} THEN l.INVOICEQTY * l.INVOICEUNITCOST ELSE 0 END) AS COSTC
        FROM SALESINVOICELINES l
        LEFT JOIN ITEMMASTER i ON i.ITEMCODE = l.LINECODE
        WHERE l.INVOICENUMBER IN (${inPeriod}) AND l.CODETYPE = 'Item Code'
        GROUP BY 1, 2 ORDER BY 5 DESC`),

      // 9. Orders per customer in the period (credit notes are not orders).
      ostendoSql(`
        SELECT h.CUSTOMER AS NAME, COUNT(*) AS N
        FROM SALESINVOICEHEADER h
        WHERE h.INVOICEDATE BETWEEN ${q(start)} AND ${q(end)} AND h.INVOICEORCREDIT <> 'Credit'
        GROUP BY h.CUSTOMER`),
    ]);

    const money = (v) => toDollars(toCents(v));
    const marginOf = (nett, cost) => pct1(toCents(nett) - toCents(cost), toCents(nett));

    const productRows = products.map((p) => ({
      code: p.CODE, title: String(p.ADHOC || p.NAME || p.CODE).trim(),
      category: (p.CAT || '').trim() || 'Uncategorised',
      unitsSold: Math.round(Number(p.QTY) || 0),
      revenue: money(p.NETT), cost: money(p.COST),
      grossProfit: money(Number(p.NETT) - Number(p.COST)),
      margin: marginOf(p.NETT, p.COST),
      // Same figures with the impossible-cost lines left out.
      unitsSoldClean: Math.round(Number(p.QTYC) || 0),
      revenueClean: money(p.NETTC), costClean: money(p.COSTC),
      marginClean: marginOf(p.NETTC, p.COSTC),
    }));

    const categoryRows = categories
      .map((c) => ({
        category: (c.CAT || '').trim() || 'Uncategorised',
        productCount: Number(c.NPROD) || 0,
        unitsSold: Math.round(Number(c.QTY) || 0),
        revenue: money(c.NETT), cost: money(c.COST),
        margin: marginOf(c.NETT, c.COST),
        unitsSoldClean: Math.round(Number(c.QTYC) || 0),
        revenueClean: money(c.NETTC), costClean: money(c.COSTC),
        marginClean: marginOf(c.NETTC, c.COSTC),
      }))
      .filter((c) => c.revenue !== 0);

    /* Customer view. Ostendo opens a new customer each year ("Creek Road Mini Mart 2025",
       then "... 2026"), so the year is dropped and each shop is ONE customer: otherwise last
       year's record looks lapsed while the shop is trading under this year's. */
    const tidy = (n) => String(n || '').replace(/\s+20\d{2}$/, '').trim();
    const merged = new Map();
    const slot = (name) => {
      const k = tidy(name);
      if (!merged.has(k)) merged.set(k, { name: k, email: '', orders: 0, first: null, last: null, lifeC: 0, periodC: 0, periodOrders: 0 });
      return merged.get(k);
    };
    const [lifeInv, lifeLines] = custLifetime;
    for (const r of lifeInv) {
      if (!r.NAME) continue;
      const m = slot(r.NAME);
      m.orders += Number(r.N) || 0;
      const f = normaliseDate(r.FIRSTD), l = normaliseDate(r.LASTD);
      if (f && (!m.first || f < m.first)) m.first = f;
      if (l && (!m.last || l > m.last)) m.last = l;
      if (r.EMAIL && !m.email) m.email = r.EMAIL;
    }
    for (const r of lifeLines) if (r.NAME) slot(r.NAME).lifeC += toCents(r.NETT);
    for (const r of custPeriod) if (r.NAME) slot(r.NAME).periodC += toCents(r.NETT);
    for (const r of orderCounts) if (r.NAME) slot(r.NAME).periodOrders += Number(r.N) || 0;

    const asOf = parseIso(end);
    const customers = [...merged.values()].map((m) => {
      const daysSince = m.last ? Math.floor((asOf - parseIso(m.last)) / 86400000) : null;
      const revenue = toDollars(m.periodC);
      return {
        customer: m.name, email: m.email,
        lifetimeRevenue: toDollars(m.lifeC), lifetimeOrders: m.orders,
        revenue, orderCount: m.periodOrders,
        aov: m.periodOrders > 0 ? toDollars(Math.round(m.periodC / m.periodOrders)) : 0,
        firstOrder: m.first, lastOrder: m.last, lastOrderDays: daysSince,
        status: daysSince === null ? 'Unknown' : daysSince > 90 ? 'Lapsed' : daysSince > 45 ? 'At Risk' : 'Active',
      };
    });

    const soldQty = new Map((soldAll || []).map((r) => [r.CODE, Math.round(Number(r.QTY) || 0)]));
    const slowMoving = stock
      .map((s) => {
        const onHand = Number(s.ONHAND) || 0;
        const buy    = Number(s.BUY) || Number(s.AVGCOST) || 0;
        const tied   = money(onHand * buy);
        const sold   = soldQty.get(s.CODE) || 0;
        return {
          code: s.CODE, title: s.NAME || s.CODE, category: (s.CAT || '').trim() || 'Uncategorised',
          stockOnHand: Math.round(onHand), soldInPeriod: sold, capitalTied: tied,
          turnover: onHand > 0 ? Math.round((sold / onHand) * 100) / 100 : 0,
        };
      })
      .filter((s) => s.capitalTied > 0)
      .sort((a, b) => (a.turnover - b.turnover) || (b.capitalTied - a.capitalTied))
      .slice(0, 25);

    const adjustmentRows = adjustments
      .map((a) => ({ code: a.CODE, title: a.NAME || a.CODE, count: Number(a.N) || 0, value: money(a.NETT) }))
      .filter((a) => a.value !== 0);

    const fastRows = fastest.map((p) => ({
      code: p.CODE, title: String(p.ADHOC || p.NAME || p.CODE).trim(),
      category: (p.CAT || '').trim() || 'Uncategorised',
      unitsSold: Math.round(Number(p.QTY) || 0),
      revenue: money(p.NETT), cost: money(p.COST),
      margin: marginOf(p.NETT, p.COST), marginClean: marginOf(p.NETTC, p.COSTC),
    }));

    const byRevenueDesc = (a, b) => b.revenue - a.revenue;

    return NextResponse.json({
      fy, range: { start, end },
      products:   productRows.slice(0, 50),
      categories: categoryRows.slice(0, 30),
      fastMoving: fastRows,
      customers:  [...customers].filter((c) => c.orderCount > 0).sort(byRevenueDesc).slice(0, 100),
      clv:        [...customers].sort((a, b) => b.lifetimeRevenue - a.lifetimeRevenue).slice(0, 50),
      churned:    customers.filter((c) => c.status === 'Lapsed' && c.lifetimeRevenue > 0)
                           .sort((a, b) => b.lifetimeRevenue - a.lifetimeRevenue).slice(0, 50),
      atRisk:     customers.filter((c) => c.status === 'At Risk')
                           .sort((a, b) => b.lifetimeRevenue - a.lifetimeRevenue).slice(0, 50),
      slowMoving,
      adjustments: adjustmentRows,
      metrics: {
        productsSold:    productRows.length,
        categoriesSold:  categoryRows.length,
        customersInPeriod: customers.filter((c) => c.orderCount > 0).length,
        customersAllTime:  customers.length,
        adjustmentTotal: adjustmentRows.reduce((s, a) => s + a.value, 0),
      },
    });
  } catch (err) {
    console.error('[ostendo/advanced]', err.message);
    // Surface the failure instead of returning empty arrays that read as "no sales".
    return NextResponse.json({
      fy, range: { start, end }, error: err.message,
      products: [], categories: [], fastMoving: [], customers: [], clv: [],
      churned: [], atRisk: [], slowMoving: [], adjustments: [], metrics: {},
    }, { status: 502 });
  }
}
