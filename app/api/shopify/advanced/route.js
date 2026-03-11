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

  const sleep = ms => new Promise(res => setTimeout(res, ms));

  // Optimized Query: Fetches Discounts, Customer History, and Inventory Levels
  const query = `
    query getDeepAnalytics($query: String!, $cursor: String) {
      orders(first: 40, query: $query, after: $cursor) {
        pageInfo { hasNextPage, endCursor }
        edges {
          node {
            createdAt
            totalPriceSet { shopMoney { amount } }
            totalDiscountsSet { shopMoney { amount } }
            customer {
              id
              displayName
              email
              numberOfOrders
              createdAt
            }
            lineItems(first: 20) {
              edges {
                node {
                  title
                  quantity
                  product { productType }
                  variant {
                    price
                    # Replace the inventoryItem block in your query with this:
                    inventoryItem { 
                    unitCost { amount }
                    # Fetching total available across the first location found
                    inventoryLevels(first: 1) {
                        nodes {
                        quantities(names: ["available"]) { quantity }
                        }
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
      if (hasNextPage) await sleep(500); 
    }

    // ... inside your try block, after the while loop ...

    const products = {};
    const customers = {};
    const categories = {};
    let totalYearlyRevenue = 0;
    let totalYearlyDiscounts = 0;

    allOrders.forEach(order => {
      const orderDate = new Date(order.createdAt);
      const orderRevenue = parseFloat(order.totalPriceSet.shopMoney.amount);
      const orderDiscount = parseFloat(order.totalDiscountsSet?.shopMoney?.amount || 0);

      totalYearlyRevenue += orderRevenue;
      totalYearlyDiscounts += orderDiscount;

      if (order.customer) {
        const cId = order.customer.id;
        if (!customers[cId]) {
          customers[cId] = {
            name: order.customer.displayName || "Unknown",
            email: order.customer.email,
            lastOrderDate: orderDate,
            revenue: 0,
            orderCount: 0
          };
        }
        customers[cId].revenue += orderRevenue;
        customers[cId].orderCount += 1;
        if (orderDate > customers[cId].lastOrderDate) customers[cId].lastOrderDate = orderDate;
      }

      order.lineItems.edges.forEach(({ node: item }) => {
        const title = item.title;
        const catName = item.product?.productType || "Uncategorized";
        const qty = item.quantity;
        const price = parseFloat(item.variant?.price || 0);
        const cost = parseFloat(item.variant?.inventoryItem?.unitCost?.amount || 0);

        const stockNode = item.variant?.inventoryItem?.inventoryLevels?.nodes?.[0];
        const stock = stockNode?.quantities?.[0]?.quantity || 0;

        if (!products[title]) {
          products[title] = { 
            name: title, 
            revenue: 0, 
            qtySold: 0, 
            currentStock: stock, 
            unitCost: cost, 
            lockedCapital: 0 
          };
        }

        // CRITICAL: Update the values for every item found in orders
        products[title].revenue += (price * qty);
        products[title].qtySold += qty;
        products[title].lockedCapital = stock * cost;

        if (!categories[catName]) {
          categories[catName] = { name: catName, revenue: 0, qty: 0 };
        }
        categories[catName].revenue += (price * qty);
        categories[catName].qty += qty;
      });
    });

    // REPORT FIXES:
    const today = new Date();
    
    // 1. Slow Moving: Include items with 0 sales this year if they have stock
    const slowMoving = Object.values(products)
      .filter(p => p.currentStock > 5 && p.qtySold < 10) // Adjusted thresholds for Worthy
      .sort((a, b) => b.lockedCapital - a.lockedCapital)
      .slice(0, 15);

    // 2. Churned: Customers in this year's data whose last order was > 90 days ago
    const churned = Object.values(customers)
      .filter(c => (today - new Date(c.lastOrderDate)) / (1000 * 60 * 60 * 24) > 90)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 15);

    return NextResponse.json({
      topProducts: Object.values(products).sort((a, b) => b.revenue - a.revenue).slice(0, 50),
      topCustomers: Object.values(customers).sort((a, b) => b.revenue - a.revenue).slice(0, 50),
      topCategories: Object.values(categories).sort((a, b) => b.revenue - a.revenue),
      slowMoving,
      churned,
      metrics: {
        discountImpactRatio: totalYearlyRevenue > 0 ? (totalYearlyDiscounts / totalYearlyRevenue).toFixed(4) : 0,
        totalDiscounts: totalYearlyDiscounts.toFixed(2)
      }
    });

  } catch (error) {
    console.error("Advanced API Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}