import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const today = new Date();
  const startParam = searchParams.get("startDate") || `${today.getFullYear()}-01-01`;
  const endParam = searchParams.get("endDate") || today.toISOString().split('T')[0];
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
            customer { id displayName email numberOfOrders createdAt }
            app { name }
            staffMember { name }
            lineItems(first: 20) {
              edges {
                node {
                  title quantity product { productType }
                  variant {
                    price
                    inventoryItem { 
                      unitCost { amount }
                      inventoryLevels(first: 1) { nodes { quantities(names: ["available"]) { quantity } } }
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

    // Fetch from previous year for true dead-stock/churn calculations
    const endYear = new Date(endParam).getFullYear();
    const dateQuery = `created_at:>=${endYear - 1}-01-01 AND created_at:<=${endParam}T23:59:59Z`;

    while (hasNextPage) {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ query, variables: { query: dateQuery, cursor: cursor } })
      });

      const json = await response.json();
      if (json.errors) throw new Error(json.errors[0].message);

      const data = json.data;
      allOrders = allOrders.concat(data.orders.edges.map(e => e.node));
      hasNextPage = data.orders.pageInfo.hasNextPage;
      cursor = data.orders.pageInfo.endCursor;

      if (hasNextPage) await new Promise(res => setTimeout(res, 300));
    }

    const products = {};
    const customers = {};
    const categories = {};
    const channels = { pos: { orders: 0, revenue: 0 }, online: { orders: 0, revenue: 0 } };

    let totalYearlyRevenue = 0;
    let totalYearlyDiscounts = 0;

    const startD = new Date(startParam + 'T00:00:00Z');
    const endD = new Date(endParam + 'T23:59:59Z');

    allOrders.forEach(order => {
      const orderDate = new Date(order.createdAt);
      const isCurrentYear = orderDate >= startD && orderDate <= endD;
      const monthIndex = orderDate.getMonth();

      const orderRevenue = parseFloat(order.totalPriceSet?.shopMoney?.amount || 0);
      const orderDiscount = parseFloat(order.totalDiscountsSet?.shopMoney?.amount || 0);

      // Handle Customers (Track activity across the whole fetched range for churn)
      if (order.customer) {
        const cId = order.customer.id;
        if (!customers[cId]) {
          customers[cId] = {
            name: order.customer.displayName || "Unknown Customer",
            email: order.customer.email,
            lastOrderDate: orderDate,
            revenue: 0,
            orderCount: 0,
            monthly: Array(12).fill(null).map(() => ({ revenue: 0, cost: 0 }))
          };
        }
        if (orderDate > customers[cId].lastOrderDate) {
          customers[cId].lastOrderDate = orderDate;
        }

        if (isCurrentYear) {
          customers[cId].revenue += orderRevenue;
          customers[cId].orderCount += 1;
          customers[cId].monthly[monthIndex].revenue += orderRevenue;
        }
      }

      // Handle Revenue & Channels (Only for selected date range)
      if (isCurrentYear) {
        totalYearlyRevenue += orderRevenue;
        totalYearlyDiscounts += orderDiscount;

        const appName = order.app?.name || "";
        const staffName = order.staffMember?.name || "";
        let isPos = appName.toLowerCase().includes("point of sale") || appName.toLowerCase() === "pos" || appName.toLowerCase().includes("shopify pos");

        // Force Worthy-specific staff to Online
        if (staffName.toLowerCase().includes("pram jani") || staffName.toLowerCase().includes("pratham jani")) {
          isPos = false;
        }

        if (isPos) {
          channels.pos.orders += 1;
          channels.pos.revenue += orderRevenue;
        } else {
          channels.online.orders += 1;
          channels.online.revenue += orderRevenue;
        }
      }

      // Handle Line Items
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
            name: title, revenue: 0, qtySold: 0, historicalQtySold: 0,
            currentStock: stock, unitCost: cost, lockedCapital: 0,
            monthly: Array(12).fill(null).map(() => ({ revenue: 0, cost: 0, qty: 0 }))
          };
        }

        products[title].historicalQtySold += qty;
        products[title].lockedCapital = products[title].currentStock * products[title].unitCost;

        if (isCurrentYear) {
          products[title].revenue += (price * qty);
          products[title].qtySold += qty;
          products[title].monthly[monthIndex].revenue += (price * qty);
          products[title].monthly[monthIndex].qty += qty;
          products[title].monthly[monthIndex].cost += (cost * qty);

          if (!categories[catName]) {
            categories[catName] = {
              name: catName, revenue: 0, qty: 0,
              monthly: Array(12).fill(null).map(() => ({ revenue: 0, qty: 0 }))
            };
          }
          categories[catName].revenue += (price * qty);
          categories[catName].qty += qty;
          categories[catName].monthly[monthIndex].revenue += (price * qty);
          categories[catName].monthly[monthIndex].qty += qty;
        }
      });
    });

    // Dead Stock Logic (Ensures high inventory items are visible even if zero sales)
    const deadStockQuery = `
      query getHighInventory {
        products(first: 100, query: "inventory_total:>10") {
          edges { node { title variants(first: 10) { edges { node { inventoryItem { unitCost { amount } inventoryLevels(first: 1) { nodes { quantities(names: ["available"]) { quantity } } } } } } } } }
        }
      }
    `;

    try {
      const invResponse = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({ query: deadStockQuery }) });
      const invJson = await invResponse.json();
      if (!invJson.errors) {
        invJson.data.products.edges.forEach(({ node: prod }) => {
          const title = prod.title;
          if (!products[title]) {
            let totalStock = 0; let highestCost = 0;
            prod.variants.edges.forEach(({ node: variant }) => {
              const stock = variant.inventoryItem?.inventoryLevels?.nodes?.[0]?.quantities?.[0]?.quantity || 0;
              const cost = parseFloat(variant.inventoryItem?.unitCost?.amount || 0);
              totalStock += stock;
              if (cost > highestCost) highestCost = cost;
            });
            if (totalStock > 10) {
              products[title] = {
                name: title, revenue: 0, qtySold: 0, historicalQtySold: 0,
                currentStock: totalStock, unitCost: highestCost, lockedCapital: totalStock * highestCost,
                monthly: Array(12).fill(null).map(() => ({ revenue: 0, cost: 0, qty: 0 }))
              };
            }
          }
        });
      }
    } catch (e) { console.error("Inventory Fetch Error", e); }

    const todayDate = new Date();
    const formatDecimals = (obj) => ({
      ...obj, 
      revenue: parseFloat((obj.revenue || 0).toFixed(2)), 
      lockedCapital: parseFloat((obj.lockedCapital || 0).toFixed(2))
    });

    const slowMoving = Object.values(products)
      .filter(p => p.currentStock > 5 && p.historicalQtySold < 10)
      .map(formatDecimals)
      .sort((a, b) => b.lockedCapital - a.lockedCapital)
      .slice(0, 15);

    const churned = Object.values(customers)
      .filter(c => (todayDate - new Date(c.lastOrderDate)) / (1000 * 60 * 60 * 24) > 90)
      .map(formatDecimals)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 15);

    const channelData = [
      { channel: "Online Sales", orders: channels.online.orders, revenue: parseFloat(channels.online.revenue.toFixed(2)), aov: channels.online.orders > 0 ? parseFloat((channels.online.revenue / channels.online.orders).toFixed(2)) : 0 },
      { channel: "POS Sales", orders: channels.pos.orders, revenue: parseFloat(channels.pos.revenue.toFixed(2)), aov: channels.pos.orders > 0 ? parseFloat((channels.pos.revenue / channels.pos.orders).toFixed(2)) : 0 }
    ].sort((a, b) => b.revenue - a.revenue);

    return NextResponse.json({
      channels: channelData,
      topProducts: Object.values(products).filter(p => p.revenue > 0).map(formatDecimals).sort((a, b) => b.revenue - a.revenue).slice(0, 50),
      topCustomers: Object.values(customers).filter(c => c.revenue > 0).map(formatDecimals).sort((a, b) => b.revenue - a.revenue).slice(0, 50),
      topCategories: Object.values(categories).filter(c => c.revenue > 0).map(formatDecimals).sort((a, b) => b.revenue - a.revenue),
      slowMoving,
      churned,
      metrics: {
        discountImpactRatio: totalYearlyRevenue > 0 ? (totalYearlyDiscounts / totalYearlyRevenue).toFixed(4) : 0,
        totalDiscounts: totalYearlyDiscounts.toFixed(2)
      }
    });

  } catch (error) {
    console.error("🚨 Advanced API Crash:", error);
    return NextResponse.json({
      topProducts: [], topCustomers: [], topCategories: [], slowMoving: [], churned: [],
      metrics: { discountImpactRatio: 0, totalDiscounts: 0 }, error: error.message
    }, { status: 500 });
  }
}