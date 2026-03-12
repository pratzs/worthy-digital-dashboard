import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const year     = parseInt(searchParams.get("year") || new Date().getFullYear());
  const store    = process.env.SHOPIFY_STORE_DOMAIN;
  const token    = process.env.SHOPIFY_ACCESS_TOKEN_WORTHY;
  const endpoint          = `https://${store}/admin/api/2026-01/graphql.json`;
  const analyticsEndpoint = `https://${store}/admin/api/2026-01/graphql.json`;

  const headers = {
    "X-Shopify-Access-Token": token,
    "Content-Type": "application/json",
  };

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
            lineItems(first: 50) {
              edges {
                node {
                  quantity
                  discountedUnitPriceSet { shopMoney { amount } }
                  variant {
                    inventoryItem {
                      unitCost { amount }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  `;

  // ShopifyQL: sessions + conversion rate by month (requires read_reports scope, API 2026-01)
  // No union types - tableData and parseErrors are direct fields per Shopify docs
  const analyticsQuery = `
    {
      shopifyqlQuery(query: "FROM sessions SHOW sessions, orders_placed, conversion_rate SINCE ${year}-01-01 UNTIL ${year}-12-31 GROUP BY month ORDER BY month ASC") {
        tableData {
          columns { name dataType displayName }
          rows
        }
        parseErrors { code message }
      }
    }
  `;

  try {
    // ── Fetch analytics + orders in parallel ────────────────────────────────
    const analyticsMonthly = {}; // monthIndex (0-11) → { sessions, convRate }

    const [analyticsRes] = await Promise.all([
      fetch(analyticsEndpoint, { method: 'POST', headers, body: JSON.stringify({ query: analyticsQuery }) }),
    ]);

    let analyticsDebug = {};
    try {
      const analyticsJson = await analyticsRes.json();
      analyticsDebug = analyticsJson; // expose full response for debugging

      const tableData = analyticsJson?.data?.shopifyqlQuery?.tableData;

      if (tableData?.rows && tableData?.columns) {
        tableData.rows.forEach(row => {
          // Each row is an object like { "month": "2026-01-01", "sessions": "123", ... }
          if (!row.month) return;
          const monthNum = parseInt(String(row.month).slice(5, 7)) - 1;
          analyticsMonthly[monthNum] = {
            sessions: parseInt(row.sessions  || 0),
            convRate: parseFloat(row.conversion_rate || 0),
          };
        });
      } else if (analyticsJson?.data?.shopifyqlQuery?.parseErrors?.length) {
        console.warn("ShopifyQL parse error:", JSON.stringify(analyticsJson.data.shopifyqlQuery.parseErrors));
      }
    } catch (e) {
      console.error("Analytics fetch/parse error:", e.message);
      analyticsDebug = { error: e.message };
    }

    // ── Fetch orders (paginated) ─────────────────────────────────────────────
    let allOrders   = [];
    let hasNextPage = true;
    let cursor      = null;
    const dateQuery = `created_at:>=${year}-01-01T00:00:00 AND created_at:<=${year}-12-31T23:59:59`;

    while (hasNextPage) {
      const response = await fetch(endpoint, {
        method: 'POST', headers,
        body: JSON.stringify({ query: ordersQuery, variables: { query: dateQuery, cursor } })
      });
      const { data, errors } = await response.json();
      if (errors) throw new Error(errors[0].message);
      if (!data?.orders) throw new Error("No orders data returned from Shopify");

      allOrders   = allOrders.concat(data.orders.edges.map(e => e.node));
      hasNextPage = data.orders.pageInfo.hasNextPage;
      cursor      = data.orders.pageInfo.endCursor;
    }

    // ── Build monthly breakdown ──────────────────────────────────────────────
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

    const monthly = months.map((month, i) => {
      const moOrders = allOrders.filter(o => new Date(o.createdAt).getMonth() === i);

      let revenue           = 0;
      let totalCost         = 0;
      let totalDiscounts    = 0;
      let marginableRevenue = 0;
      let hasCostData       = false;

      moOrders.forEach(o => {
        revenue        += parseFloat(o.totalPriceSet.shopMoney.amount);
        totalDiscounts += parseFloat(o.totalDiscountsSet.shopMoney.amount);

        o.lineItems.edges.forEach(({ node: li }) => {
          const cost  = parseFloat(li.variant?.inventoryItem?.unitCost?.amount || 0);
          const price = parseFloat(li.discountedUnitPriceSet?.shopMoney?.amount || 0);
          const qty   = li.quantity || 0;
          if (cost > 0) {
            totalCost         += cost * qty;
            marginableRevenue += price * qty;
            hasCostData        = true;
          }
        });
      });

      const orderCount  = moOrders.length;
      const grossProfit = hasCostData ? marginableRevenue - totalCost : 0;
      const marginPct   = (hasCostData && marginableRevenue > 0)
        ? Math.round((grossProfit / marginableRevenue) * 100) : 0;

      const newCustomers = moOrders.filter(o => {
        if (!o.customer?.createdAt) return false;
        const cd = new Date(o.customer.createdAt);
        return cd.getFullYear() === year && cd.getMonth() === i;
      }).length;

      const analytics = analyticsMonthly[i] || { sessions: 0, convRate: 0 };

      return {
        month,
        revenue:           Math.round(revenue),
        marginableRevenue: Math.round(marginableRevenue),
        totalCost:         Math.round(totalCost),
        grossProfit:       Math.round(grossProfit),
        marginPct,
        orders:            orderCount,
        aov:               orderCount > 0 ? Math.round(revenue / orderCount) : 0,
        newCustomers,
        returns:           0,
        totalDiscounts:    Math.round(totalDiscounts),
        hasCostData,
        sessions:          analytics.sessions,
        convRate:          analytics.convRate,
      };
    });

    return NextResponse.json({
      year,
      totalOrders:    allOrders.length,
      hasAnalytics:   Object.keys(analyticsMonthly).length > 0,
      analyticsDebug, // remove this once working
      monthly,
    });

  } catch (error) {
    console.error("Shopify yearly fetch error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}