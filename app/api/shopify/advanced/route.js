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
    
    // Fetch 2 years for accurate historical churn and dead stock
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

      const json = await response.json();
      
      if (json.errors) {
        console.error("Shopify GraphQL Error:", json.errors);
        throw new Error(json.errors[0].message);
      }

      const data = json.data;
      allOrders = allOrders.concat(data.orders.edges.map(e => e.node));
      hasNextPage = data.orders.pageInfo.hasNextPage;
      cursor = data.orders.pageInfo.endCursor;
      
      // Restored the 500ms breather. Fetching 24 months of data will hit Shopify's rate limit without this.
      if (hasNextPage) await new Promise(res => setTimeout(res, 500)); 
    }

    const products = {};
    const customers = {};
    const categories = {};
    let totalYearlyRevenue = 0;
    let totalYearlyDiscounts = 0;

    allOrders.forEach(order => {
      const orderDate = new Date(order.createdAt);
      const isCurrentYear = orderDate.getFullYear() === year;
      const monthIndex = orderDate.getMonth(); // Extract the exact month
      
      const orderRevenue = parseFloat(order.totalPriceSet?.shopMoney?.amount || 0);
      const orderDiscount = parseFloat(order.totalDiscountsSet?.shopMoney?.amount || 0);

      if (isCurrentYear) {
        totalYearlyRevenue += orderRevenue;
        totalYearlyDiscounts += orderDiscount;
      }

      // 1. Customer Monthly Tracking
      if (order.customer) {
        const cId = order.customer.id;
        if (!customers[cId]) {
          customers[cId] = {
            name: order.customer.displayName || "Unknown Customer",
            email: order.customer.email,
            lastOrderDate: orderDate,
            revenue: 0, 
            orderCount: 0,
            // Generate empty 12-month array
            monthly: Array(12).fill(null).map(() => ({ revenue: 0, cost: 0 })) 
          };
        }
        customers[cId].revenue += orderRevenue;
        customers[cId].orderCount += 1;
        if (orderDate > customers[cId].lastOrderDate) {
          customers[cId].lastOrderDate = orderDate;
        }
        
        // Add revenue to the specific month
        if (isCurrentYear) {
          customers[cId].monthly[monthIndex].revenue += orderRevenue;
        }
      }

      // 2. Product & Category Monthly Tracking
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
            qtySold: 0, 
            historicalQtySold: 0,
            currentStock: stock, 
            unitCost: cost, 
            lockedCapital: 0,
            // Generate empty 12-month array
            monthly: Array(12).fill(null).map(() => ({ revenue: 0, cost: 0, qty: 0 }))
          };
        }
        
        products[title].historicalQtySold += qty;
        products[title].lockedCapital = products[title].currentStock * products[title].unitCost;

        if (isCurrentYear) {
          products[title].revenue += (price * qty);
          products[title].qtySold += qty;
          
          // Populate the specific month for the product
          products[title].monthly[monthIndex].revenue += (price * qty);
          products[title].monthly[monthIndex].qty += qty;
          products[title].monthly[monthIndex].cost += (cost * qty);

          if (!categories[catName]) {
            categories[catName] = { 
              name: catName, revenue: 0, qty: 0,
              // Generate empty 12-month array
              monthly: Array(12).fill(null).map(() => ({ revenue: 0, qty: 0 }))
            };
          }
          categories[catName].revenue += (price * qty);
          categories[catName].qty += qty;
          
          // Populate the specific month for the category
          categories[catName].monthly[monthIndex].revenue += (price * qty);
          categories[catName].monthly[monthIndex].qty += qty;
        }
      });
    });

    // --- NEW: ABSOLUTE DEAD STOCK FETCH ---
    // Fetch products with high inventory directly to catch items with ZERO sales in the last 2 years
    const deadStockQuery = `
      query getHighInventory {
        products(first: 100, query: "inventory_total:>10") {
          edges {
            node {
              title
              variants(first: 10) {
                edges {
                  node {
                    inventoryItem {
                      unitCost { amount }
                      inventoryLevels(first: 1) {
                        nodes { quantities(names: ["available"]) { quantity } }
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
      const inventoryResponse = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ query: deadStockQuery })
      });
      
      const inventoryJson = await inventoryResponse.json();
      
      if (!inventoryJson.errors) {
        inventoryJson.data.products.edges.forEach(({ node: prod }) => {
          const title = prod.title;
          
          // If it is NOT in our 'products' object, it means it hasn't sold a single unit in 24 months.
          if (!products[title]) {
            let totalStock = 0;
            let highestCost = 0;
            
            prod.variants.edges.forEach(({ node: variant }) => {
              const stockNode = variant.inventoryItem?.inventoryLevels?.nodes?.[0];
              const stock = stockNode?.quantities?.[0]?.quantity || 0;
              const cost = parseFloat(variant.inventoryItem?.unitCost?.amount || 0);
              
              totalStock += stock;
              if (cost > highestCost) highestCost = cost; // Grab the highest variant cost for the estimate
            });

            // If we have more than 10 units of this absolute dead item, add it to the tracking object
            if (totalStock > 10) {
              products[title] = {
                name: title,
                revenue: 0,
                qtySold: 0,
                historicalQtySold: 0,
                currentStock: totalStock,
                unitCost: highestCost,
                lockedCapital: totalStock * highestCost,
                monthly: Array(12).fill(null).map(() => ({ revenue: 0, cost: 0, qty: 0 }))
              };
            }
          }
        });
      }
    } catch (invError) {
      console.error("Non-fatal error fetching absolute dead stock:", invError);
      // We don't throw here so the main dashboard doesn't crash if this secondary fetch fails
    }
    // --- END DEAD STOCK FETCH ---

    const today = new Date();
    const formatDecimals = (obj) => ({
      ...obj,
      revenue: parseFloat(obj.revenue.toFixed(2)),
      lockedCapital: obj.lockedCapital ? parseFloat(obj.lockedCapital.toFixed(2)) : 0
    });

    const slowMoving = Object.values(products)
      .filter(p => p.currentStock > 5 && p.historicalQtySold < 10)
      .map(formatDecimals)
      .sort((a, b) => b.lockedCapital - a.lockedCapital)
      .slice(0, 15);

    const churned = Object.values(customers)
      .filter(c => (today - new Date(c.lastOrderDate)) / (1000 * 60 * 60 * 24) > 90)
      .map(formatDecimals)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 15);

    return NextResponse.json({
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
    // CRITICAL FIX: Always return valid empty arrays to prevent frontend .filter() crashes
    return NextResponse.json({ 
      topProducts: [], 
      topCustomers: [], 
      topCategories: [], 
      slowMoving: [], 
      churned: [],
      metrics: { discountImpactRatio: 0, totalDiscounts: 0 },
      error: error.message 
    }, { status: 500 });
  }
}