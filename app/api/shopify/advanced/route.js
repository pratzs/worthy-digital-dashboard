import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; 

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

  const query = `
    query getDeepAnalytics($query: String!, $cursor: String) {
      orders(first: 50, query: $query, after: $cursor) {
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
                    inventoryItem { 
                      unitCost { amount }
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
    }
  `;

  try {
    let allOrders = [];
    let hasNextPage = true;
    let cursor = null;
    
    // BUSINESS FIX: Fetch data from Jan 1st of the PREVIOUS year to Dec 31st of the CURRENT year
    const dateQuery = `created_at:>=${year - 1}-01-01 AND created_at:<=${year}-12-31`;

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
      
      if (errors) {
        console.error("GraphQL Error:", errors);
        throw new Error(errors[0].message);
      }

      allOrders = allOrders.concat(data.orders.edges.map(e => e.node));
      hasNextPage = data.orders.pageInfo.hasNextPage;
      cursor = data.orders.pageInfo.endCursor;
      
      if (hasNextPage) await new Promise(res => setTimeout(res, 50)); 
    }

    const products = {};
    const customers = {};
    const categories = {};
    let totalYearlyRevenue = 0;
    let totalYearlyDiscounts = 0;

    allOrders.forEach(order => {
      const orderDate = new Date(order.createdAt);
      // Determine if the order belongs to the actively selected year on the dashboard
      const isCurrentYear = orderDate.getFullYear() === year;
      
      const orderRevenue = parseFloat(order.totalPriceSet?.shopMoney?.amount || 0);
      const orderDiscount = parseFloat(order.totalDiscountsSet?.shopMoney?.amount || 0);

      // Only add to the dashboard's top-level metrics if it happened in the selected year
      if (isCurrentYear) {
        totalYearlyRevenue += orderRevenue;
        totalYearlyDiscounts += orderDiscount;
      }

      // 1. CHURN LOGIC: Track customers across the ENTIRE 24-month period
      if (order.customer) {
        const cId = order.customer.id;
        if (!customers[cId]) {
          customers[cId] = {
            name: order.customer.displayName || "Unknown Customer",
            email: order.customer.email,
            lastOrderDate: orderDate,
            revenue: 0, // Total lifetime spend in the 2-year window
            orderCount: 0
          };
        }
        customers[cId].revenue += orderRevenue;
        customers[cId].orderCount += 1;
        
        // Keep updating the date so we know their absolute final order
        if (orderDate > customers[cId].lastOrderDate) {
          customers[cId].lastOrderDate = orderDate;
        }
      }

      // 2. PRODUCT & INVENTORY LOGIC
      order.lineItems.edges.forEach(({ node: item }) => {
        const title = item.title || "Unknown Item";
        const catName = item.product?.productType || "Uncategorized";
        const qty = item.quantity || 0;
        const price = parseFloat(item.variant?.price || 0);
        const cost = parseFloat(item.variant?.inventoryItem?.unitCost?.amount || 0);
        
        const stockNode = item.variant?.inventoryItem?.inventoryLevels?.nodes?.[0];
        const stock = stockNode?.quantities?.[0]?.quantity || 0;

        if (!products[title]) {
          products[title] = { 
            name: title, 
            revenue: 0, 
            qtySoldThisYear: 0, 
            historicalQtySold: 0,
            currentStock: stock, 
            unitCost: cost, 
            lockedCapital: 0 
          };
        }
        
        // Always track historical volume for accurate slow-moving calculations
        products[title].historicalQtySold += qty;
        products[title].lockedCapital = products[title].currentStock * products[title].unitCost;

        // Only attribute revenue and current sales if it's the selected year
        if (isCurrentYear) {
          products[title].revenue += (price * qty);
          products[title].qtySoldThisYear += qty;

          if (!categories[catName]) {
            categories[catName] = { name: catName, revenue: 0, qty: 0 };
          }
          categories[catName].revenue += (price * qty);
          categories[catName].qty += qty;
        }
      });
    });

    const today = new Date();
    const formatDecimals = (obj) => ({
      ...obj,
      revenue: parseFloat(obj.revenue.toFixed(2)),
      lockedCapital: obj.lockedCapital ? parseFloat(obj.lockedCapital.toFixed(2)) : 0
    });

    // TRUE SLOW MOVING: Stock > 5, but sold less than 10 units across the ENTIRE 2-year history
    const slowMoving = Object.values(products)
      .filter(p => p.currentStock > 5 && p.historicalQtySold < 10)
      .map(formatDecimals)
      .sort((a, b) => b.lockedCapital - a.lockedCapital)
      .slice(0, 15);

    // TRUE CHURN: Customers from the last 2 years who haven't ordered in 90+ days
    const churned = Object.values(customers)
      .filter(c => (today - new Date(c.lastOrderDate)) / (1000 * 60 * 60 * 24) > 90)
      .map(formatDecimals)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 15);

    return NextResponse.json({
      // Sort Top Products/Categories strictly by the selected year's revenue
      topProducts: Object.values(products).filter(p => p.revenue > 0).map(formatDecimals).sort((a, b) => b.revenue - a.revenue).slice(0, 50),
      topCustomers: Object.values(customers).map(formatDecimals).sort((a, b) => b.revenue - a.revenue).slice(0, 50),
      topCategories: Object.values(categories).map(formatDecimals).sort((a, b) => b.revenue - a.revenue),
      slowMoving,
      churned,
      metrics: {
        discountImpactRatio: totalYearlyRevenue > 0 ? (totalYearlyDiscounts / totalYearlyRevenue).toFixed(4) : 0,
        totalDiscounts: totalYearlyDiscounts.toFixed(2)
      }
    });

  } catch (error) {
    console.error("🚨 Advanced API Crash:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}