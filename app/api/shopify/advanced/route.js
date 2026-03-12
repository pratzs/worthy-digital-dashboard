import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const today = new Date();
  const startParam = searchParams.get("startDate") || `${today.getFullYear()}-01-01`;
  const endParam   = searchParams.get("endDate")   || today.toISOString().split('T')[0];

  const store    = process.env.SHOPIFY_STORE_DOMAIN;
  const token    = process.env.SHOPIFY_ACCESS_TOKEN_WORTHY;
  const endpoint = `https://${store}/admin/api/2025-01/graphql.json`;
  const headers  = { "X-Shopify-Access-Token": token, "Content-Type": "application/json" };

  // ── GraphQL: 250 per page (max), no staffMember (needs extra scope) ────────
  const query = `
    query getDeepAnalytics($query: String!, $cursor: String) {
      orders(first: 250, query: $query, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        edges {
          node {
            createdAt
            totalPriceSet      { shopMoney { amount } }
            totalDiscountsSet  { shopMoney { amount } }
            customer {
              id displayName email createdAt
            }
            app { name }
            lineItems(first: 50) {
              edges {
                node {
                  title quantity
                  product { productType }
                  variant {
                    price
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
    }
  `;

  try {
    // ── 1. Fetch all orders (paginated, 250 at a time) ───────────────────────
    let allOrders   = [];
    let hasNextPage = true;
    let cursor      = null;

    // Fetch from prior year so churn detection has history
    const endYear   = new Date(endParam).getFullYear();
    const dateQuery = `created_at:>=${endYear - 1}-01-01 AND created_at:<=${endParam}T23:59:59`;

    while (hasNextPage) {
      const res  = await fetch(endpoint, {
        method: 'POST', headers,
        body: JSON.stringify({ query, variables: { query: dateQuery, cursor } })
      });
      const json = await res.json();

      if (json.errors) {
        console.error("GraphQL errors:", JSON.stringify(json.errors));
        throw new Error(json.errors[0].message);
      }
      if (!json.data?.orders) {
        console.error("No orders data:", JSON.stringify(json));
        throw new Error("No orders data returned");
      }

      allOrders   = allOrders.concat(json.data.orders.edges.map(e => e.node));
      hasNextPage = json.data.orders.pageInfo.hasNextPage;
      cursor      = json.data.orders.pageInfo.endCursor;
    }

    // ── 2. Date window for "current period" filtering ────────────────────────
    // Use local date strings to avoid UTC/NZ timezone mismatches
    const startD = new Date(startParam + 'T00:00:00');
    const endD   = new Date(endParam   + 'T23:59:59');

    const products   = {};
    const customers  = {};
    const categories = {};
    const channels   = {
      pos:    { orders: 0, revenue: 0 },
      online: { orders: 0, revenue: 0 },
    };
    let totalRevenue  = 0;
    let totalDiscount = 0;

    // ── 3. Process orders ────────────────────────────────────────────────────
    allOrders.forEach(order => {
      const orderDate    = new Date(order.createdAt);
      const inPeriod     = orderDate >= startD && orderDate <= endD;
      const monthIndex   = orderDate.getMonth();
      const orderRevenue = parseFloat(order.totalPriceSet?.shopMoney?.amount  || 0);
      const orderDisc    = parseFloat(order.totalDiscountsSet?.shopMoney?.amount || 0);

      // ── Customers (track across full fetched range for churn) ──────────────
      if (order.customer) {
        const cId = order.customer.id;
        if (!customers[cId]) {
          customers[cId] = {
            name: order.customer.displayName || "Unknown",
            email: order.customer.email || "",
            lastOrderDate: orderDate,
            revenue: 0,          // current period spend (for topCustomers)
            lifetimeRevenue: 0,  // full fetched range spend (for churned)
            orderCount: 0,
          };
        }
        if (orderDate > customers[cId].lastOrderDate) {
          customers[cId].lastOrderDate = orderDate;
        }
        // Always accumulate lifetime revenue across full fetched range
        customers[cId].lifetimeRevenue += orderRevenue;
        if (inPeriod) {
          customers[cId].revenue    += orderRevenue;
          customers[cId].orderCount += 1;
        }
      }

      if (!inPeriod) return; // everything below only counts for selected period

      totalRevenue  += orderRevenue;
      totalDiscount += orderDisc;

      // ── Channel detection (POS vs Online) ──────────────────────────────────
      const appName = (order.app?.name || "").toLowerCase();
      const isPos   = appName.includes("point of sale") || appName === "pos" || appName.includes("shopify pos");
      if (isPos) {
        channels.pos.orders   += 1;
        channels.pos.revenue  += orderRevenue;
      } else {
        channels.online.orders  += 1;
        channels.online.revenue += orderRevenue;
      }

      // ── Line items → products & categories ─────────────────────────────────
      order.lineItems.edges.forEach(({ node: item }) => {
        const title   = item.title || "Unknown Item";
        const catName = item.product?.productType || "Uncategorized";
        const qty     = item.quantity || 0;
        const price   = parseFloat(item.variant?.price || 0);
        const cost    = parseFloat(item.variant?.inventoryItem?.unitCost?.amount || 0);
        const stockNode = item.variant?.inventoryItem?.inventoryLevels?.nodes?.[0];
        const stock   = stockNode?.quantities?.[0]?.quantity || 0;

        // Products
        if (!products[title]) {
          products[title] = {
            name: title, revenue: 0, qtySold: 0,
            historicalQtySold: 0, currentStock: stock,
            unitCost: cost, lockedCapital: 0,
          };
        }
        products[title].revenue           += price * qty;
        products[title].qtySold           += qty;
        products[title].historicalQtySold += qty;
        products[title].lockedCapital      = products[title].currentStock * products[title].unitCost;

        // Categories
        if (!categories[catName]) {
          categories[catName] = { name: catName, revenue: 0, qty: 0 };
        }
        categories[catName].revenue += price * qty;
        categories[catName].qty     += qty;
      });
    });

    // ── 4. Dead-stock: fetch high-inventory products ─────────────────────────
    const deadStockQuery = `
      query {
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
      const invRes  = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({ query: deadStockQuery }) });
      const invJson = await invRes.json();
      if (!invJson.errors && invJson.data?.products) {
        invJson.data.products.edges.forEach(({ node: prod }) => {
          if (products[prod.title]) return; // already seen in orders
          let totalStock = 0, highCost = 0;
          prod.variants.edges.forEach(({ node: v }) => {
            const s = v.inventoryItem?.inventoryLevels?.nodes?.[0]?.quantities?.[0]?.quantity || 0;
            const c = parseFloat(v.inventoryItem?.unitCost?.amount || 0);
            totalStock += s;
            if (c > highCost) highCost = c;
          });
          if (totalStock > 10) {
            products[prod.title] = {
              name: prod.title, revenue: 0, qtySold: 0,
              historicalQtySold: 0, currentStock: totalStock,
              unitCost: highCost, lockedCapital: totalStock * highCost,
            };
          }
        });
      }
    } catch (e) { console.error("Dead-stock fetch error:", e.message); }

    // ── 5. Build output arrays ───────────────────────────────────────────────
    const round2 = n => parseFloat((n || 0).toFixed(2));

    const todayMs = Date.now();

    const topProducts = Object.values(products)
      .filter(p => p.revenue > 0)
      .map(p => ({ ...p, revenue: round2(p.revenue), lockedCapital: round2(p.lockedCapital), margin: p.revenue > 0 ? Math.round(((p.revenue - p.unitCost * p.qtySold) / p.revenue) * 100) : 0 }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 50);

    const topCustomers = Object.values(customers)
      .filter(c => c.revenue > 0)
      .map(c => ({ ...c, revenue: round2(c.revenue) }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 50);

    const topCategories = Object.values(categories)
      .filter(c => c.revenue > 0)
      .map(c => ({ ...c, revenue: round2(c.revenue) }))
      .sort((a, b) => b.revenue - a.revenue);

    const slowMoving = Object.values(products)
      .filter(p => p.currentStock > 5 && p.historicalQtySold < 10)
      .map(p => ({ ...p, revenue: round2(p.revenue), lockedCapital: round2(p.lockedCapital) }))
      .sort((a, b) => b.lockedCapital - a.lockedCapital)
      .slice(0, 15);

    const churned = Object.values(customers)
      .filter(c => (todayMs - new Date(c.lastOrderDate).getTime()) / 86400000 > 90)
      .map(c => ({ ...c, revenue: round2(c.lifetimeRevenue) })) // show lifetime spend
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 15);

    const channelData = [
      { channel: "Online Sales", orders: channels.online.orders, revenue: round2(channels.online.revenue), aov: channels.online.orders > 0 ? round2(channels.online.revenue / channels.online.orders) : 0 },
      { channel: "POS Sales",    orders: channels.pos.orders,    revenue: round2(channels.pos.revenue),    aov: channels.pos.orders    > 0 ? round2(channels.pos.revenue    / channels.pos.orders)    : 0 },
    ].sort((a, b) => b.revenue - a.revenue);

    return NextResponse.json({
      channels:       channelData,
      topProducts,
      topCustomers,
      topCategories,
      slowMoving,
      churned,
      metrics: {
        discountImpactRatio: totalRevenue > 0 ? (totalDiscount / totalRevenue).toFixed(4) : 0,
        totalDiscounts: totalDiscount.toFixed(2),
      },
      debug: {
        totalOrdersFetched: allOrders.length,
        ordersInPeriod: allOrders.filter(o => { const d = new Date(o.createdAt); return d >= startD && d <= endD; }).length,
        period: { startParam, endParam },
      }
    });

  } catch (error) {
    console.error("Advanced API error:", error.message);
    return NextResponse.json({
      topProducts: [], topCustomers: [], topCategories: [],
      slowMoving: [], churned: [], channels: [],
      metrics: { discountImpactRatio: 0, totalDiscounts: 0 },
      error: error.message,
    }, { status: 500 });
  }
}