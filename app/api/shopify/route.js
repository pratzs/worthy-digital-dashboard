import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const year = parseInt(searchParams.get("year") || new Date().getFullYear());
  const store = process.env.SHOPIFY_STORE_DOMAIN;
  const token = process.env.SHOPIFY_ACCESS_TOKEN_WORTHY;
  const endpoint = `https://${store}/admin/api/2025-01/graphql.json`;

  const headers = {
    "X-Shopify-Access-Token": token,
    "Content-Type": "application/json",
  };

  // GraphQL Query: Gets everything in one tree
  const query = `
    query getYearlyData($query: String!, $cursor: String) {
      orders(first: 50, query: $query, after: $cursor) {
        pageInfo { hasNextPage, endCursor }
        edges {
          node {
            createdAt
            totalPriceSet { shopMoney { amount } }
            totalRefundedSet { shopMoney { amount } }
            totalDiscountsSet { shopMoney { amount } }
            customer { createdAt }
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

  try {
    let allOrders = [];
    let hasNextPage = true;
    let cursor = null;
    const dateQuery = `created_at:>=${year}-01-01 AND created_at:<=${year}-12-31`;

    while (hasNextPage) {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          query,
          variables: { query: dateQuery, cursor: cursor }
        })
      });

      const { data, errors } = await response.json();
      if (errors) throw new Error(errors[0].message);

      allOrders = allOrders.concat(data.orders.edges.map(e => e.node));
      hasNextPage = data.orders.pageInfo.hasNextPage;
      cursor = data.orders.pageInfo.endCursor;
    }

    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const monthly = months.map((month, i) => {
      const moOrders = allOrders.filter(o => new Date(o.createdAt).getMonth() === i);

      let revenue = 0;
      let totalCost = 0;
      let totalDiscounts = 0;
      let marginableRevenue = 0;
      let hasCostData = false;

      moOrders.forEach(o => {
        revenue += parseFloat(o.totalPriceSet.shopMoney.amount);
        totalDiscounts += parseFloat(o.totalDiscountsSet.shopMoney.amount);

        o.lineItems.edges.forEach(({ node: li }) => {
          const cost = parseFloat(li.variant?.inventoryItem?.unitCost?.amount || 0);
          const price = parseFloat(li.discountedUnitPriceSet.shopMoney.amount);
          const qty = li.quantity;

          if (cost > 0) {
            totalCost += (cost * qty);
            marginableRevenue += (price * qty);
            hasCostData = true;
          }
        });
      });

      const orderCount = moOrders.length;
      const grossProfit = hasCostData ? (marginableRevenue - totalCost) : 0;
      const marginPct = (hasCostData && marginableRevenue > 0) 
        ? Math.round((grossProfit / marginableRevenue) * 100) 
        : 0;

      const newCustomers = moOrders.filter(o => {
        if (!o.customer) return false;
        const cd = new Date(o.customer.createdAt);
        return cd.getFullYear() === year && cd.getMonth() === i;
      }).length;

      return {
        month,
        revenue: Math.round(revenue),
        marginableRevenue: Math.round(marginableRevenue),
        totalCost: Math.round(totalCost),
        grossProfit: Math.round(grossProfit),
        marginPct,
        orders: orderCount,
        aov: orderCount > 0 ? Math.round(revenue / orderCount) : 0,
        newCustomers,
        returns: 0, // Simplified for this pass
        totalDiscounts: Math.round(totalDiscounts),
        hasCostData,
        sessions: 0,
        convRate: 0
      };
    });

    return NextResponse.json({ year, totalOrders: allOrders.length, monthly });

  } catch (error) {
    console.error("GraphQL Yearly Fetch Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}