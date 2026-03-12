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
            staffMember        { name }
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

  const analyticsQuery = `
    {
      shopifyqlQuery(query: "FROM sessions SHOW sessions, conversion_rate SINCE ${year}-01-01 UNTIL ${year}-12-31 GROUP BY month ORDER BY month ASC") {
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

    // ── Per-channel monthly buckets ──────────────────────────────────────────
    const mkB = () => Array(12).fill(null).map(() => ({
      revenue: 0, marginableRevenue: 0, totalCost: 0, totalDiscounts: 0,
      orders: 0, newCustomers: 0, hasCostData: false,
    }));
    const allB = mkB(), posB = mkB(), onlineB = mkB();
    const salespeople = {};

    allOrders.forEach(order => {
      const i       = new Date(order.createdAt).getMonth();
      const rev     = parseFloat(order.totalPriceSet?.shopMoney?.amount     || 0);
      const disc    = parseFloat(order.totalDiscountsSet?.shopMoney?.amount || 0);
      const appName = (order.app?.name || "").toLowerCase();
      const isPos   = isPosFn(appName);
      const staff   = order.staffMember?.name || (isPos ? "Unknown Staff" : null);

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

      if (isPos && staff) {
        if (!salespeople[staff]) salespeople[staff] = { name: staff, revenue: 0, orders: 0, monthly: Array(12).fill(0) };
        salespeople[staff].revenue    += rev;
        salespeople[staff].orders     += 1;
        salespeople[staff].monthly[i] += Math.round(rev);
      }
    });

    // ── Convert buckets → monthly arrays ────────────────────────────────────
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

    return NextResponse.json({
      year,
      totalOrders:  allOrders.length,
      hasAnalytics: Object.keys(analyticsMonthly).length > 0,
      monthly:      toMonthly(allB,    true),   // all orders + web sessions
      monthlyPos:   toMonthly(posB,    false),  // POS only, no web sessions
      monthlyOnline:toMonthly(onlineB, true),   // online only + web sessions
      salespeople:  Object.values(salespeople).sort((a, b) => b.revenue - a.revenue),
    });

  } catch (error) {
    console.error("Shopify yearly fetch error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}