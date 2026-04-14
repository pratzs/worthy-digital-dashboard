import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const year     = parseInt(searchParams.get("year") || new Date().getFullYear());
  const store    = process.env.SHOPIFY_STORE_DOMAIN;
  const token    = process.env.SHOPIFY_ACCESS_TOKEN_WORTHY;
  const endpoint = `https://${store}/admin/api/2026-01/graphql.json`;
  const headers  = { "X-Shopify-Access-Token": token, "Content-Type": "application/json" };

  const ordersQuery = `
    query getYearlyData($query: String!, $cursor: String) {
      orders(first: 250, query: $query, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        edges {
          node {
            createdAt
            totalPriceSet      { shopMoney { amount } }
            totalDiscountsSet  { shopMoney { amount } }
            customer           { createdAt }
            app                { name }
            lineItems(first: 50) {
              edges {
                node {
                  quantity
                  discountedUnitPriceSet { shopMoney { amount } }
                  variant {
                    inventoryItem { unitCost { amount } }
                  }
                }
              }
            }
          }
        }
      }
    }
  `;

  // Single ShopifyQL query for sessions by month (staff fetched separately only for current year)
  const analyticsQuery = `
    {
      shopifyqlQuery(query: "FROM sessions SHOW sessions, conversion_rate SINCE ${year}-01-01 UNTIL ${year}-12-31 GROUP BY month ORDER BY month ASC") {
        tableData { columns { name } rows }
        parseErrors
      }
    }
  `;

  // Staff query — only net_sales grouped by name (no order count, avoids bad column names)
  const staffAnalyticsQuery = `
    {
      shopifyqlQuery(query: "FROM sales SHOW staff_member_name, net_sales SINCE ${year}-01-01 UNTIL ${year}-12-31 GROUP BY staff_member_name ORDER BY net_sales DESC") {
        tableData { columns { name } rows }
        parseErrors
      }
    }
  `;

  const isPosFn = (appName) =>
    appName.includes("point of sale") || appName === "pos" || appName.includes("shopify pos");

  try {
    // ── Analytics (non-fatal) ─────────────────────────────────────────────────
    const analyticsMonthly = {};
    try {
      const aRes  = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({ query: analyticsQuery }) });
      const aJson = await aRes.json();
      const rows  = aJson?.data?.shopifyqlQuery?.tableData?.rows;
      if (rows) {
        rows.forEach(row => {
          if (!row.month) return;
          const m = parseInt(String(row.month).slice(5, 7)) - 1;
          analyticsMonthly[m] = { sessions: parseInt(row.sessions || 0), convRate: parseFloat(row.conversion_rate || 0) };
        });
      }
    } catch (e) { console.error("Analytics error:", e.message); }

    // ── Orders (paginated) ───────────────────────────────────────────────────
    let allOrders   = [];
    let hasNextPage = true;
    let cursor      = null;
    const dateQuery = `created_at:>=${year}-01-01T00:00:00 AND created_at:<=${year}-12-31T23:59:59`;

    while (hasNextPage) {
      const res       = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({ query: ordersQuery, variables: { query: dateQuery, cursor } }) });
      const { data, errors } = await res.json();
      if (errors) throw new Error(errors[0].message);
      if (!data?.orders) throw new Error("No orders data returned");
      allOrders   = allOrders.concat(data.orders.edges.map(e => e.node));
      hasNextPage = data.orders.pageInfo.hasNextPage;
      cursor      = data.orders.pageInfo.endCursor;
    }

    // ── Staff sales via ShopifyQL — only fetch for current/recent years to avoid rate limits ─
    let salespeopleFromAnalytics = [];
    const currentYear = new Date().getFullYear();
    if (year >= currentYear - 1) { // only fetch staff for current and previous year
    try {
      const sRes  = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({ query: staffAnalyticsQuery }) });
      const sJson = await sRes.json();
      const tableData = sJson?.data?.shopifyqlQuery?.tableData;
      const errs      = sJson?.data?.shopifyqlQuery?.parseErrors;
      if (errs?.length) console.warn("Staff ShopifyQL parseErrors:", JSON.stringify(errs));
      if (sJson?.errors) console.warn("Staff ShopifyQL GraphQL errors:", JSON.stringify(sJson.errors));
      if (tableData) {
        console.log("Staff columns:", JSON.stringify(tableData.columns?.map(c => c.name)));
        console.log("Staff rows sample:", JSON.stringify(tableData.rows?.slice(0, 3)));
        const rows = tableData.rows || [];
        salespeopleFromAnalytics = rows
          .filter(r => r.staff_member_name && r.staff_member_name !== "N/A" && r.staff_member_name !== "")
          .map(r => ({
            name:    r.staff_member_name,
            revenue: parseFloat(r.net_sales || 0),
            orders:  0, // will be populated from POS orders bucket below
          }));
        console.log(`Staff ShopifyQL: found ${salespeopleFromAnalytics.length} staff members`);
      }
    } catch (e) { console.warn("Staff ShopifyQL failed:", e.message); }
    } // end year >= currentYear - 1

    // ── Per-channel monthly buckets ──────────────────────────────────────────
    const mkB = () => Array(12).fill(null).map(() => ({
      revenue: 0, marginableRevenue: 0, totalCost: 0, totalDiscounts: 0,
      orders: 0, newCustomers: 0, hasCostData: false,
    }));
    const allB = mkB(), posB = mkB(), onlineB = mkB();

    // Weekly buckets split by channel (mirrors allB/posB/onlineB)
    const weeklyAllB = {}, weeklyPosB = {}, weeklyOnlineB = {};

    allOrders.forEach(order => {
      const orderDate = new Date(order.createdAt);
      const i       = orderDate.getMonth();
      const day     = orderDate.getDate();
      const weekNum = Math.ceil(day / 7); // 1=days1-7, 2=8-14, 3=15-21, 4=22-28, 5=29-31
      const rev     = parseFloat(order.totalPriceSet?.shopMoney?.amount     || 0);
      const disc    = parseFloat(order.totalDiscountsSet?.shopMoney?.amount || 0);
      const appName = (order.app?.name || "").toLowerCase();
      const isPos   = isPosFn(appName);

      let lineCost = 0, lineMargRev = 0, hasCD = false;
      order.lineItems.edges.forEach(({ node: li }) => {
        const cost  = parseFloat(li.variant?.inventoryItem?.unitCost?.amount || 0);
        const price = parseFloat(li.discountedUnitPriceSet?.shopMoney?.amount || 0);
        const qty   = li.quantity || 0;
        if (cost > 0) { lineCost += cost * qty; lineMargRev += price * qty; hasCD = true; }
      });

      const isNew = (() => {
        if (!order.customer?.createdAt) return false;
        const cd = new Date(order.customer.createdAt);
        return cd.getFullYear() === year && cd.getMonth() === i;
      })();

      [allB, isPos ? posB : onlineB].forEach(b => {
        b[i].revenue            += rev;
        b[i].totalDiscounts     += disc;
        b[i].orders             += 1;
        b[i].totalCost          += lineCost;
        b[i].marginableRevenue  += lineMargRev;
        if (hasCD) b[i].hasCostData  = true;
        if (isNew) b[i].newCustomers += 1;
      });

      // Accumulate weekly — all, pos, online separately (including cost for margin)
      const wkey = `${i}_${weekNum}`;
      const mkW  = () => ({ month: i, week: weekNum, revenue: 0, orders: 0, totalDiscounts: 0, newCustomers: 0, totalCost: 0, marginableRevenue: 0, hasCostData: false });
      [weeklyAllB, isPos ? weeklyPosB : weeklyOnlineB].forEach(wb => {
        if (!wb[wkey]) wb[wkey] = mkW();
        wb[wkey].revenue           += rev;
        wb[wkey].orders            += 1;
        wb[wkey].totalDiscounts    += disc;
        wb[wkey].totalCost         += lineCost;
        wb[wkey].marginableRevenue += lineMargRev;
        if (hasCD) wb[wkey].hasCostData = true;
        if (isNew) wb[wkey].newCustomers += 1;
      });
    });

    // ── Convert buckets → monthly arrays ────────────────────────────────────
    const totalPosOrders = posB.reduce((s, b) => s + b.orders, 0);
    const totalPosRevenue = posB.reduce((s, b) => s + b.revenue, 0);

    // Distribute order counts proportionally across staff by revenue share
    salespeopleFromAnalytics = salespeopleFromAnalytics.map(s => ({
      ...s,
      orders: s.revenue > 0
        ? Math.max(1, Math.round((s.revenue / totalPosRevenue) * totalPosOrders))
        : 0,
    }));
    const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const toMonthly = (buckets, withAnalytics = false) =>
      buckets.map((b, i) => {
        const gp  = b.hasCostData ? b.marginableRevenue - b.totalCost : 0;
        const pct = b.hasCostData && b.marginableRevenue > 0 ? Math.round((gp / b.marginableRevenue) * 100) : 0;
        const an  = withAnalytics ? (analyticsMonthly[i] || { sessions: 0, convRate: 0 }) : { sessions: 0, convRate: 0 };
        return {
          month: MONTHS[i], revenue: Math.round(b.revenue),
          marginableRevenue: Math.round(b.marginableRevenue), totalCost: Math.round(b.totalCost),
          grossProfit: Math.round(gp), marginPct: pct,
          orders: b.orders, aov: b.orders > 0 ? Math.round(b.revenue / b.orders) : 0,
          newCustomers: b.newCustomers, returns: 0,
          totalDiscounts: Math.round(b.totalDiscounts), hasCostData: b.hasCostData,
          sessions: an.sessions, convRate: an.convRate,
        };
      });

    // ── Build weekly arrays (all / pos / online) ─────────────────────────────
    const getDaysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();
    const buildWeekly = (buckets) => {
      const arr = [];
      for (let mi = 0; mi < 12; mi++) {
        for (let w = 1; w <= 5; w++) {
          const startDay = (w - 1) * 7 + 1;
          const endDay   = Math.min(w * 7, getDaysInMonth(year, mi));
          if (startDay > getDaysInMonth(year, mi)) continue;
          const b = buckets[`${mi}_${w}`];
          const gp     = b?.hasCostData ? Math.round(b.marginableRevenue - b.totalCost) : null;
          const margin = b?.hasCostData && b.marginableRevenue > 0
            ? Math.round(((b.marginableRevenue - b.totalCost) / b.marginableRevenue) * 100)
            : null;
          arr.push({
            label:          `${MONTHS[mi]} W${w}`,
            month:          mi,
            week:           w,
            dateRange:      `${startDay}–${endDay} ${MONTHS[mi]}`,
            revenue:        b ? Math.round(b.revenue)        : 0,
            orders:         b ? b.orders                     : 0,
            aov:            b && b.orders > 0 ? Math.round(b.revenue / b.orders) : 0,
            totalCost:      b ? Math.round(b.totalCost)      : 0,
            grossProfit:    gp,
            marginPct:      margin,
            hasCostData:    b?.hasCostData || false,
            totalDiscounts: b ? Math.round(b.totalDiscounts) : 0,
            newCustomers:   b ? b.newCustomers               : 0,
          });
        }
      }
      return arr;
    };
    const weekly       = buildWeekly(weeklyAllB);
    const weeklyPos    = buildWeekly(weeklyPosB);
    const weeklyOnline = buildWeekly(weeklyOnlineB);

    return NextResponse.json({
      year,
      totalOrders:  allOrders.length,
      hasAnalytics: Object.keys(analyticsMonthly).length > 0,
      monthly:      toMonthly(allB,    true),   // all orders + web sessions
      monthlyPos:   toMonthly(posB,    false),  // POS only, no web sessions
      monthlyOnline:toMonthly(onlineB, true),   // online only + web sessions
      weekly,
      weeklyPos,
      weeklyOnline,
      salespeople: salespeopleFromAnalytics,
    });

  } catch (error) {
    console.error("Shopify yearly fetch error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}