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

  const emptyResp = (err) => ({
    topProducts: [], topCategories: [], fastMoving: [], slowMoving: [],
    diagnostics: { invoiceCount: 0, lineCount: 0, productCount: 0, error: err || null },
  });

  try {
    // Auth
    const authJson = await odooCall(url, {
      jsonrpc: '2.0', method: 'call', id: 1,
      params: { service: 'common', method: 'authenticate', args: [db, username, password, {}] },
    }, 15000);
    const uid = authJson.result;
    if (!uid) throw new Error('Authentication failed');

    const exec = async (model, method, args, kwargs = {}, timeout = 40000) => {
      const j = await odooCall(url, {
        jsonrpc: '2.0', method: 'call', id: Math.floor(Math.random() * 1e6),
        params: { service: 'object', method: 'execute_kw',
                  args: [db, uid, password, model, method, args, kwargs] },
      }, timeout);
      if (j.error) throw new Error(j.error.data?.message || j.error.message || `${model}.${method} failed`);
      return j.result;
    };

    const chunkArray = (arr, size) => {
      const out = [];
      for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
      return out;
    };

    // ── Strategy: fetch invoice lines via search_read in one go using domain ──
    // This is much faster than fetching invoices first then reading lines by ID,
    // because we go directly to the lines table with a date+company filter.
    const lineDomain = [
      ['move_id.company_id',    '=',  companyId],
      ['move_id.move_type',     'in', ['out_invoice', 'out_refund']],
      ['move_id.state',         '=',  'posted'],
      ['move_id.invoice_date',  '>=', `${year}-01-01`],
      ['move_id.invoice_date',  '<=', `${year}-12-31`],
      ['display_type',          '=',  false],   // exclude section/note/tax-only lines
      ['product_id',            '!=', false],   // only lines with a product
    ];

    let lines = [];
    try {
      lines = await exec('account.move.line', 'search_read', [lineDomain], {
        fields: ['id', 'move_id', 'date', 'product_id', 'quantity', 'price_subtotal'],
        limit: 100000,
      }, 50000);
    } catch (e) {
      console.error(`[Odoo/adv] line search_read failed: ${e.message}`);
      return NextResponse.json(emptyResp(`Lines fetch failed: ${e.message}`));
    }
    console.log(`[Odoo/adv] lines fetched: ${lines.length}`);

    if (lines.length === 0) {
      return NextResponse.json(emptyResp('No invoice lines returned'));
    }

    // ── Fetch product details in parallel chunks ──────────────────────────────
    const productIds = [...new Set(lines.map(l => l.product_id && l.product_id[0]).filter(Boolean))];
    const fetchProductsChunked = async () => {
      if (productIds.length === 0) return [];
      const chunks = chunkArray(productIds, 500);
      const results = await Promise.all(chunks.map(c =>
        exec('product.product', 'read', [c], {
          fields: ['id', 'name', 'default_code', 'categ_id', 'qty_available',
                   'standard_price', 'list_price', 'type'],
        }, 25000).catch(e => { console.error(`[Odoo/adv] product chunk failed: ${e.message}`); return []; })
      ));
      return results.flat();
    };

    const products = await fetchProductsChunked();
    const productById = {};
    for (const p of products) productById[p.id] = p;
    console.log(`[Odoo/adv] products fetched: ${products.length}/${productIds.length}`);

    // We need move_type per line for credit-note sign. The line.date is on the
    // line itself; for credit detection look up the invoice move_type by move_id.
    // Cheaper: fetch only move_id → move_type for unique move ids.
    const moveIds = [...new Set(lines.map(l => l.move_id && l.move_id[0]).filter(Boolean))];
    let moveTypeById = {};
    try {
      const moves = await exec('account.move', 'read', [moveIds], { fields: ['id', 'move_type'] }, 30000);
      for (const m of moves) moveTypeById[m.id] = m.move_type;
    } catch (e) {
      console.error(`[Odoo/adv] move_type fetch failed: ${e.message} — assuming all out_invoice`);
    }

    // ── Aggregate per product ─────────────────────────────────────────────────
    const prodAgg = {};
    for (const line of lines) {
      const d = line.date ? new Date(line.date) : null;
      if (!d || d.getFullYear() !== year) continue;
      const pid = line.product_id && line.product_id[0];
      if (!pid) continue;

      const moveType = moveTypeById[line.move_id && line.move_id[0]];
      const sign = moveType === 'out_refund' ? -1 : 1;

      const prod = productById[pid] || {};
      const rev  = parseFloat(line.price_subtotal || 0) * sign;
      const qty  = parseFloat(line.quantity || 0) * sign;
      const stdC = parseFloat(prod.standard_price || 0);
      const cost = stdC * qty;
      const catName = (prod.categ_id && prod.categ_id[1]) ? prod.categ_id[1] : 'Uncategorised';

      if (!prodAgg[pid]) {
        prodAgg[pid] = {
          id: pid,
          name: prod.name || (line.product_id && line.product_id[1]) || `Product ${pid}`,
          code: prod.default_code || '',
          category: catName,
          revenue: 0, qty: 0, cost: 0,
          qtyAvailable: parseFloat(prod.qty_available || 0),
          stdPrice: stdC,
          type: prod.type || 'product',
        };
      }
      prodAgg[pid].revenue += rev;
      prodAgg[pid].qty     += qty;
      prodAgg[pid].cost    += cost;
    }

    const allProducts = Object.values(prodAgg)
      .filter(p => p.revenue > 0)
      .map(p => {
        const gp     = p.revenue - p.cost;
        const margin = p.revenue > 0 ? Math.round((gp / p.revenue) * 100) : 0;
        return {
          title:        p.name,
          code:         p.code,
          category:     p.category,
          revenue:      Math.round(p.revenue),
          unitsSold:    Math.round(p.qty),
          grossProfit:  Math.round(gp),
          margin,
          qtyAvailable: Math.round(p.qtyAvailable),
          stdPrice:     p.stdPrice,
          type:         p.type,
        };
      });

    const topProducts = [...allProducts]
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 50);

    // Top categories
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

    // Fast = top by units sold
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

    // Slow = products with on-hand stock but very few units sold (capital tied up)
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
        lineCount:    lines.length,
        productCount: products.length,
        productIds:   productIds.length,
        year, companyId,
      },
    });

  } catch (err) {
    console.error(`[Odoo/adv] company=${companyId} year=${year} error:`, err.message);
    return NextResponse.json(emptyResp(err.message), { status: 200 });
  }
}
