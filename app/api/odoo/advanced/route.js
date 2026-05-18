import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function odooCall(url, payload, timeoutMs = 45000) {
  const res = await fetch(`${url}/jsonrpc`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
    signal:  AbortSignal.timeout(timeoutMs),
  });
  return res.json();
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const year      = parseInt(searchParams.get('year')    || new Date().getFullYear());
  const companyId = parseInt(searchParams.get('company') || 4);

  const url      = process.env.ODOO_URL;
  const db       = process.env.ODOO_DB;
  const username = process.env.ODOO_USER;
  const password = process.env.ODOO_PASSWORD;

  if (!url || !db || !username || !password) {
    return NextResponse.json({ error: 'Odoo env vars not configured' }, { status: 500 });
  }

  const emptyResp = (err, diag = {}) => ({
    topProducts: [], topCategories: [], fastMoving: [], slowMoving: [],
    diagnostics: { error: err || null, ...diag },
  });

  try {
    const authJson = await odooCall(url, {
      jsonrpc: '2.0', method: 'call', id: 1,
      params: { service: 'common', method: 'authenticate', args: [db, username, password, {}] },
    }, 15000);
    const uid = authJson.result;
    if (!uid) throw new Error('Authentication failed');

    // Pin company context so record rules don't fail with the "expected str
    // instance, bool found" error we saw on multi-company access (Oceania).
    const ctx = { allowed_company_ids: [companyId], force_company: companyId };

    const exec = async (model, method, args, kwargs = {}, timeout = 40000) => {
      const mergedKwargs = { ...kwargs, context: { ...(kwargs.context || {}), ...ctx } };
      const j = await odooCall(url, {
        jsonrpc: '2.0', method: 'call', id: Math.floor(Math.random() * 1e6),
        params: { service: 'object', method: 'execute_kw',
                  args: [db, uid, password, model, method, args, mergedKwargs] },
      }, timeout);
      if (j.error) throw new Error(j.error.data?.message || j.error.message || `${model}.${method} failed`);
      return j.result;
    };

    const chunkArray = (arr, size) => {
      const out = [];
      for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
      return out;
    };

    // ── PHASE 1: invoice IDs split by move_type ──────────────────────────────
    // search() returns just IDs — far lighter than search_read.
    const baseDomain = [
      ['company_id',    '=',  companyId],
      ['state',         '=',  'posted'],
      ['invoice_date',  '>=', `${year}-01-01`],
      ['invoice_date',  '<=', `${year}-12-31`],
    ];
    const [invIds, refundIds] = await Promise.all([
      exec('account.move', 'search', [[...baseDomain, ['move_type', '=', 'out_invoice']]], { limit: 30000 }, 25000)
        .catch(e => { console.error(`[Odoo/adv] inv search failed: ${e.message}`); return []; }),
      exec('account.move', 'search', [[...baseDomain, ['move_type', '=', 'out_refund']]],  { limit: 30000 }, 25000)
        .catch(e => { console.error(`[Odoo/adv] refund search failed: ${e.message}`); return []; }),
    ]);
    console.log(`[Odoo/adv] cid=${companyId} year=${year} invoices=${invIds.length} refunds=${refundIds.length}`);
    if (invIds.length === 0 && refundIds.length === 0) {
      return NextResponse.json(emptyResp(null, { invoiceCount: 0, year, companyId }));
    }

    // ── PHASE 2: read_group on lines (the win) ────────────────────────────────
    // Aggregates in the DB → returns one row per product instead of millions
    // of line records. We do it once for invoices and once for refunds so we
    // can sign-flip the refund totals.
    const groupByMoveSet = async (moveIds, label) => {
      if (moveIds.length === 0) return [];
      // For very large id lists, chunk to keep the JSON-RPC payload reasonable.
      const chunks = chunkArray(moveIds, 5000);
      const results = await Promise.all(chunks.map(c =>
        exec('account.move.line', 'read_group',
          [[['move_id', 'in', c], ['product_id', '!=', false]]],
          { fields: ['price_subtotal:sum', 'quantity:sum'], groupby: ['product_id'] },
          35000
        ).catch(e => {
          console.error(`[Odoo/adv] ${label} read_group chunk failed: ${e.message}`);
          return [];
        })
      ));
      return results.flat();
    };

    const [invGroups, refundGroups] = await Promise.all([
      groupByMoveSet(invIds,    'invoice'),
      groupByMoveSet(refundIds, 'refund'),
    ]);
    console.log(`[Odoo/adv] invGroups=${invGroups.length} refundGroups=${refundGroups.length}`);

    // Merge: invoice positive, refund negative — keyed by product_id
    const prodTotals = {};
    const accumulate = (rows, sign) => {
      for (const r of rows) {
        if (!r.product_id || !Array.isArray(r.product_id)) continue;
        const [pid, pname] = r.product_id;
        if (!prodTotals[pid]) prodTotals[pid] = { pid, pname, revenue: 0, qty: 0 };
        prodTotals[pid].revenue += sign * parseFloat(r.price_subtotal || 0);
        prodTotals[pid].qty     += sign * parseFloat(r.quantity       || 0);
      }
    };
    accumulate(invGroups,    1);
    accumulate(refundGroups, -1);

    const productIds = Object.keys(prodTotals).map(Number);
    if (productIds.length === 0) {
      return NextResponse.json(emptyResp('No product lines found in any invoice — every line is product-less manual entry', {
        invoiceCount: invIds.length, refundCount: refundIds.length, year, companyId,
      }));
    }

    // ── PHASE 3: product master (categories, stock, cost) ─────────────────────
    let products = [];
    try {
      const chunks = chunkArray(productIds, 500);
      const results = await Promise.all(chunks.map(c =>
        exec('product.product', 'read', [c], {
          fields: ['id', 'name', 'default_code', 'categ_id', 'qty_available',
                   'standard_price', 'list_price', 'type'],
        }, 25000).catch(e => { console.error(`[Odoo/adv] product chunk failed: ${e.message}`); return []; })
      ));
      products = results.flat();
    } catch (e) {
      console.error(`[Odoo/adv] product master fetch failed: ${e.message}`);
    }
    const productById = {};
    for (const p of products) productById[p.id] = p;
    console.log(`[Odoo/adv] product master rows: ${products.length}/${productIds.length}`);

    // ── PHASE 4: shape output ────────────────────────────────────────────────
    const allProducts = Object.values(prodTotals)
      .filter(t => t.revenue > 0 || t.qty > 0)
      .map(t => {
        const prod   = productById[t.pid] || {};
        const stdC   = parseFloat(prod.standard_price || 0);
        const cost   = stdC * t.qty;
        const gp     = t.revenue - cost;
        const margin = t.revenue > 0 ? Math.round((gp / t.revenue) * 100) : 0;
        return {
          title:        prod.name || t.pname || `Product ${t.pid}`,
          code:         prod.default_code || '',
          category:     (prod.categ_id && prod.categ_id[1]) ? prod.categ_id[1] : 'Uncategorised',
          revenue:      Math.round(t.revenue),
          unitsSold:    Math.round(t.qty),
          grossProfit:  Math.round(gp),
          margin,
          qtyAvailable: Math.round(parseFloat(prod.qty_available || 0)),
          stdPrice:     stdC,
          type:         prod.type || 'product',
        };
      });

    const topProducts = [...allProducts]
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 50);

    const catMap = {};
    for (const p of allProducts) {
      const c = p.category;
      if (!catMap[c]) catMap[c] = { category: c, revenue: 0, unitsSold: 0, grossProfit: 0, productCount: 0 };
      catMap[c].revenue     += p.revenue;
      catMap[c].unitsSold   += p.unitsSold;
      catMap[c].grossProfit += p.grossProfit;
      catMap[c].productCount++;
    }
    const topCategories = Object.values(catMap)
      .sort((a, b) => b.revenue - a.revenue)
      .map(c => ({ ...c, margin: c.revenue > 0 ? Math.round((c.grossProfit / c.revenue) * 100) : 0 }));

    const fastMoving = [...allProducts]
      .filter(p => p.unitsSold > 0)
      .sort((a, b) => b.unitsSold - a.unitsSold)
      .slice(0, 25)
      .map(p => ({
        name:         p.title,
        code:         p.code,
        category:     p.category,
        unitsSold:    p.unitsSold,
        revenue:      p.revenue,
        margin:       p.margin,
        currentStock: p.qtyAvailable,
      }));

    const slowMoving = allProducts
      .filter(p => p.qtyAvailable > 0 && p.type !== 'service')
      .map(p => {
        const lockedCapital = Math.round(p.qtyAvailable * p.stdPrice);
        const turnover      = p.unitsSold / Math.max(p.qtyAvailable, 1);
        const slowScore     = lockedCapital * (1 - Math.min(turnover, 1));
        return {
          name:          p.title,
          code:          p.code,
          category:      p.category,
          currentStock:  p.qtyAvailable,
          qtySold:       p.unitsSold,
          lockedCapital,
          slowScore,
        };
      })
      .filter(p => p.lockedCapital > 0)
      .sort((a, b) => b.slowScore - a.slowScore)
      .slice(0, 30)
      .map(({ slowScore: _s, ...rest }) => rest);

    return NextResponse.json({
      topProducts, topCategories, fastMoving, slowMoving,
      diagnostics: {
        invoiceCount: invIds.length,
        refundCount:  refundIds.length,
        productGroups: productIds.length,
        productCount: products.length,
        year, companyId,
      },
    });

  } catch (err) {
    console.error(`[Odoo/adv] cid=${companyId} year=${year} error:`, err.message, err.stack);
    return NextResponse.json(emptyResp(err.message), { status: 200 });
  }
}
