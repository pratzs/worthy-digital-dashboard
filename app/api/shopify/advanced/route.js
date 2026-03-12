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

  // channel filter: "pos" | "online" | "all" (default)
  const channelFilter = searchParams.get("channel") || "all";
  const isPosFn = (appName) =>
    appName.includes("point of sale") || appName === "pos" || appName.includes("shopify pos");

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

    // Fetch from earlier so prevMonth comparison has data
    const endYear   = new Date(endParam).getFullYear();
    const fetchFrom = startPrevMo < new Date(`${endYear - 1}-01-01`) 
      ? `${endYear - 1}-01-01` 
      : startPrevMo.toISOString().split('T')[0];
    const dateQuery = `created_at:>=${fetchFrom} AND created_at:<=${endParam}T23:59:59`;

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

    // Prior year same period (for YoY declining)
    const startPrev = new Date(startD); startPrev.setFullYear(startPrev.getFullYear() - 1);
    const endPrev   = new Date(endD);   endPrev.setFullYear(endPrev.getFullYear() - 1);

    // Prior calendar month (for monthly declining)
    const periodMs    = endD - startD;
    const startPrevMo = new Date(startD.getTime() - periodMs - 86400000);
    const endPrevMo   = new Date(startD.getTime() - 86400000);

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
      const orderRevenue = parseFloat(order.totalPriceSet?.shopMoney?.amount  || 0);
      const orderDisc    = parseFloat(order.totalDiscountsSet?.shopMoney?.amount || 0);

      // ── Channel filter ────────────────────────────────────────────────────
      const appName = (order.app?.name || "").toLowerCase();
      const isPos   = isPosFn(appName);
      if (channelFilter === "pos"    && !isPos) return;
      if (channelFilter === "online" &&  isPos) return;

      // ── Customers (track across full fetched range for churn) ──────────────
      if (order.customer) {
        const cId = order.customer.id;
        if (!customers[cId]) {
          customers[cId] = {
            name: order.customer.displayName || "Unknown",
            email: order.customer.email || "",
            firstOrderDate: orderDate,
            lastOrderDate: orderDate,
            revenue: 0,          // current period spend (for topCustomers)
            lifetimeRevenue: 0,  // full fetched range spend (for churned/CLV)
            orderCount: 0,       // current period orders
            totalOrderCount: 0,  // all-time orders across full fetched range
          };
        }
        if (orderDate > customers[cId].lastOrderDate) customers[cId].lastOrderDate = orderDate;
        if (orderDate < customers[cId].firstOrderDate) customers[cId].firstOrderDate = orderDate;
        // Always accumulate lifetime revenue across full fetched range
        customers[cId].lifetimeRevenue  += orderRevenue;
        customers[cId].totalOrderCount  += 1;
        if (inPeriod) {
          customers[cId].revenue    += orderRevenue;
          customers[cId].orderCount += 1;
        }
      }

      if (!inPeriod) return; // everything below only counts for selected period

      totalRevenue  += orderRevenue;
      totalDiscount += orderDisc;

      // ── Channel tracking (POS vs Online totals) ────────────────────────────
      if (isPos) {
        channels.pos.orders   += 1;
        channels.pos.revenue  += orderRevenue;
      } else {
        channels.online.orders  += 1;
        channels.online.revenue += orderRevenue;
      }

      // ── Line items → products & categories ─────────────────────────────────
      const inPrevPeriod = orderDate >= startPrev  && orderDate <= endPrev;
      const inPrevMonth  = orderDate >= startPrevMo && orderDate <= endPrevMo;

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
            name: title, category: catName,
            revenue: 0, qtySold: 0,
            prevRevenue: 0, prevQtySold: 0,
            prevMonthRevenue: 0, prevMonthQty: 0, // prior calendar month
            historicalQtySold: 0, currentStock: stock,
            unitCost: cost, lockedCapital: 0,
          };
        }
        products[title].historicalQtySold += qty;
        products[title].lockedCapital      = products[title].currentStock * products[title].unitCost;

        if (inPeriod) {
          products[title].revenue  += price * qty;
          products[title].qtySold  += qty;
        }
        if (inPrevPeriod) {
          products[title].prevRevenue  += price * qty;
          products[title].prevQtySold  += qty;
        }
        if (inPrevMonth) {
          products[title].prevMonthRevenue += price * qty;
          products[title].prevMonthQty     += qty;
        }

        // Categories (current period only)
        if (inPeriod) {
          if (!categories[catName]) {
            categories[catName] = { name: catName, revenue: 0, qty: 0 };
          }
          categories[catName].revenue += price * qty;
          categories[catName].qty     += qty;
        }
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

    // ── Category → Products map for drill-down ───────────────────────────────
    const categoryProducts = {};
    Object.values(products).forEach(p => {
      const cat = p.category || "Uncategorized";
      if (!categoryProducts[cat]) categoryProducts[cat] = [];
      categoryProducts[cat].push({
        name:        p.name,
        revenue:     round2(p.revenue),
        prevRevenue: round2(p.prevRevenue),
        prevMonthRevenue: round2(p.prevMonthRevenue),
        qtySold:     p.qtySold,
        margin:      p.revenue > 0 ? Math.round(((p.revenue - p.unitCost * p.qtySold) / p.revenue) * 100) : 0,
        yoyChange:   p.prevRevenue > 0 ? Math.round(((p.revenue - p.prevRevenue) / p.prevRevenue) * 100) : null,
        momChange:   p.prevMonthRevenue > 0 ? Math.round(((p.revenue - p.prevMonthRevenue) / p.prevMonthRevenue) * 100) : null,
      });
    });
    // Sort each category's products by revenue desc
    Object.keys(categoryProducts).forEach(cat => {
      categoryProducts[cat].sort((a, b) => b.revenue - a.revenue);
    });

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
      .slice(0, 50);

    // ── At-Risk: 45–90 days since last order ─────────────────────────────────
    const atRisk = Object.values(customers)
      .filter(c => {
        const daysSince = (todayMs - new Date(c.lastOrderDate).getTime()) / 86400000;
        return daysSince >= 45 && daysSince < 90;
      })
      .map(c => ({
        name: c.name,
        lastOrderDate: c.lastOrderDate,
        daysSince: Math.floor((todayMs - new Date(c.lastOrderDate).getTime()) / 86400000),
        revenue: round2(c.lifetimeRevenue),
        orderCount: c.totalOrderCount,
      }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 50);

    // ── Customer Lifetime Value ───────────────────────────────────────────────
    const clv = Object.values(customers)
      .filter(c => c.lifetimeRevenue > 0)
      .map(c => ({
        name: c.name,
        firstOrderDate: c.firstOrderDate,
        lastOrderDate: c.lastOrderDate,
        totalOrders: c.totalOrderCount,
        lifetimeRevenue: round2(c.lifetimeRevenue),
        avgOrderValue: c.totalOrderCount > 0 ? round2(c.lifetimeRevenue / c.totalOrderCount) : 0,
      }))
      .sort((a, b) => b.lifetimeRevenue - a.lifetimeRevenue)
      .slice(0, 50);

    // ── Declining Products: YoY ───────────────────────────────────────────────
    const declining = Object.values(products)
      .filter(p => p.prevRevenue > 50 && p.revenue < p.prevRevenue * 0.8)
      .map(p => ({
        name: p.name, category: p.category,
        revenue: round2(p.revenue), prevRevenue: round2(p.prevRevenue),
        change: p.prevRevenue > 0 ? Math.round(((p.revenue - p.prevRevenue) / p.prevRevenue) * 100) : null,
        qtySold: p.qtySold, prevQtySold: p.prevQtySold,
        comparisonType: "yoy",
      }))
      .sort((a, b) => a.change - b.change)
      .slice(0, 30);

    // ── Declining Products: Month-over-Month ─────────────────────────────────
    const decliningMoM = Object.values(products)
      .filter(p => p.prevMonthRevenue > 20 && p.revenue < p.prevMonthRevenue * 0.8)
      .map(p => ({
        name: p.name, category: p.category,
        revenue: round2(p.revenue), prevRevenue: round2(p.prevMonthRevenue),
        change: p.prevMonthRevenue > 0 ? Math.round(((p.revenue - p.prevMonthRevenue) / p.prevMonthRevenue) * 100) : null,
        qtySold: p.qtySold, prevQtySold: p.prevMonthQty,
        comparisonType: "mom",
      }))
      .sort((a, b) => a.change - b.change)
      .slice(0, 30);

    const channelData = [
      { channel: "Online Sales", orders: channels.online.orders, revenue: round2(channels.online.revenue), aov: channels.online.orders > 0 ? round2(channels.online.revenue / channels.online.orders) : 0 },
      { channel: "POS Sales",    orders: channels.pos.orders,    revenue: round2(channels.pos.revenue),    aov: channels.pos.orders    > 0 ? round2(channels.pos.revenue    / channels.pos.orders)    : 0 },
    ].sort((a, b) => b.revenue - a.revenue);

    return NextResponse.json({
      channels:         channelData,
      topProducts,
      topCustomers,
      topCategories,
      categoryProducts,
      slowMoving,
      churned,
      atRisk,
      clv,
      declining,
      decliningMoM,
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
      topProducts: [], topCustomers: [], topCategories: [], categoryProducts: {},
      slowMoving: [], churned: [], channels: [],
      atRisk: [], clv: [], declining: [], decliningMoM: [],
      metrics: { discountImpactRatio: 0, totalDiscounts: 0 },
      error: error.message,
    }, { status: 500 });
  }
}