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

    // ── PHASE 1: invoice IDs (cheap — just IDs) ───────────────────────────────
    const invDomain = [
      ['company_id',    '=',  companyId],
      ['move_type',     'in', ['out_invoice', 'out_refund']],
      ['state',         '=',  'posted'],
      ['invoice_date',  '>=', `${year}-01-01`],
      ['invoice_date',  '<=', `${year}-12-31`],
    ];
    let invoiceIds = [];
    try {
      invoiceIds = await exec('account.move', 'search', [invDomain], { limit: 30000 }, 25000);
    } catch (e) {
      console.error(`[Odoo/adv] invoice search failed: ${e.message}`);
      return NextResponse.json(emptyResp(`Invoice search failed: ${e.message}`));
    }
    console.log(`[Odoo/adv] cid=${companyId} year=${year} invoiceIds=${invoiceIds.length}`);
    if (invoiceIds.length === 0) {
      return NextResponse.json(emptyResp(null, { invoiceCount: 0, year, companyId }));
    }

    // Fetch move_type + invoice_date per invoice once (cheap — small payload).
    // invoice_date is needed so we can bucket line cost into months below.
    const moveTypeById = {};
    const moveDateById = {};
    try {
      const moves = await exec('account.move', 'read', [invoiceIds], { fields: ['id', 'move_type', 'invoice_date'] }, 20000);
      for (const m of moves) {
        moveTypeById[m.id] = m.move_type;
        moveDateById[m.id] = m.invoice_date;
      }
    } catch (e) {
      console.error(`[Odoo/adv] move_type read failed (assuming all out_invoice): ${e.message}`);
    }

    // ── PHASE 2: invoice lines via search_read in tight chunks ────────────────
    // Minimal field set — keeps payload small (~80 bytes per line).
    // 500 invoices per chunk × ~5 lines = ~2.5k lines per call. With 20+ chunks
    // running 8-parallel, total wall time ~10-15s even for 10k invoices.
    // We deliberately use search_read (NOT read_group) because this Odoo
    // instance has a record-rule that fails on read_group with the Python
    // error "expected str instance, bool found".
    // Minimal field set. purchase_price would be ideal but it's not on
    // account.move.line in this Odoo instance (requires the sale_margin
    // module). Cost comes from product.template.standard_price instead.
    const lineFields = ['move_id', 'product_id', 'quantity', 'price_subtotal'];
    const sanitizedIds = invoiceIds.filter(id => typeof id === 'number' && id > 0);
    const idChunks = chunkArray(sanitizedIds, 500);

    const parallelLimit = async (tasks, limit) => {
      const results = new Array(tasks.length);
      let next = 0;
      await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, async () => {
        while (next < tasks.length) {
          const idx = next++;
          results[idx] = await tasks[idx]();
        }
      }));
      return results;
    };

    const chunkResults = await parallelLimit(
      idChunks.map(c => () =>
        exec('account.move.line', 'search_read',
          [[['move_id', 'in', c]]],
          { fields: lineFields, limit: 30000 },
          30000
        ).catch(e => {
          console.error(`[Odoo/adv] line chunk failed: ${e.message}`);
          return [];
        })
      ),
      8
    );
    const rawLines = chunkResults.flat();

    // Drop zero-subtotal rows (tax / payment / receivable lines)
    // and rows with no product_id (out of scope — see prodAgg comment below).
    const lines = rawLines.filter(l => {
      const sub = parseFloat(l.price_subtotal || 0);
      return sub !== 0;
    });
    console.log(`[Odoo/adv] lines: raw=${rawLines.length} kept=${lines.length}`);

    if (lines.length === 0) {
      return NextResponse.json(emptyResp('Line fetch returned no rows', {
        invoiceCount: invoiceIds.length, rawLineCount: rawLines.length, year, companyId,
      }));
    }

    // ── PHASE 3: aggregate per product (sign-flip refunds) ────────────────────
    // Lines without product_id are skipped here. For Oceania (which uses
    // manual-description lines on some invoices) this is acceptable — those
    // entries don't have a product/category to roll up anyway.
    const prodAgg = {};
    let withProduct = 0, withoutProduct = 0;
    for (const line of lines) {
      const pid = line.product_id && line.product_id[0];
      if (!pid) { withoutProduct++; continue; }
      withProduct++;

      const moveType = moveTypeById[line.move_id && line.move_id[0]];
      const sign = moveType === 'out_refund' ? -1 : 1;

      const rev = parseFloat(line.price_subtotal || 0) * sign;
      const qty = parseFloat(line.quantity || 0) * sign;
      const pname = (line.product_id && line.product_id[1]) || `Product ${pid}`;

      if (!prodAgg[pid]) prodAgg[pid] = { pid, pname, revenue: 0, qty: 0 };
      prodAgg[pid].revenue += rev;
      prodAgg[pid].qty     += qty;
    }
    console.log(`[Odoo/adv] line breakdown — withProduct=${withProduct} withoutProduct=${withoutProduct}`);

    const productIds = Object.keys(prodAgg).map(Number);

    // ── PHASE 4: product.product → product.template (two reads-by-id) ────────
    // Reads by id are the fastest query type in Odoo. The previous
    // search_read with product_variant_ids IN (...) was forcing a scan
    // across every template and timing out.
    const variantStart = Date.now();
    let variants = [];
    try {
      const vChunks = chunkArray(productIds, 500);
      const vResults = await parallelLimit(
        vChunks.map(c => () =>
          exec('product.product', 'read', [c], {
            fields: ['id', 'name', 'default_code', 'qty_available', 'list_price',
                     'type', 'product_tmpl_id'],
          }, 25000).catch(e => { console.error(`[Odoo/adv] variant chunk failed: ${e.message}`); return []; })
        ),
        8
      );
      variants = vResults.flat();
    } catch (e) {
      console.error(`[Odoo/adv] variants fetch failed (continuing): ${e.message}`);
    }
    console.log(`[Odoo/adv] variants read: ${variants.length}/${productIds.length} in ${Date.now() - variantStart}ms`);

    const tmplIds = [...new Set(variants.map(v => v.product_tmpl_id && v.product_tmpl_id[0]).filter(Boolean))];
    const tmplStart = Date.now();
    const tmplById = {};
    try {
      if (tmplIds.length > 0) {
        const tChunks = chunkArray(tmplIds, 500);
        const tResults = await parallelLimit(
          tChunks.map(c => () =>
            exec('product.template', 'read', [c], {
              fields: ['id', 'standard_price', 'categ_id'],
            }, 25000).catch(e => { console.error(`[Odoo/adv] template chunk failed: ${e.message}`); return []; })
          ),
          8
        );
        for (const t of tResults.flat()) tmplById[t.id] = t;
      }
    } catch (e) {
      console.error(`[Odoo/adv] templates fetch failed (continuing): ${e.message}`);
    }
    console.log(`[Odoo/adv] templates read: ${Object.keys(tmplById).length}/${tmplIds.length} in ${Date.now() - tmplStart}ms`);

    // Build variant → consolidated record for downstream code.
    const productById = {};
    for (const v of variants) {
      const tid  = v.product_tmpl_id && v.product_tmpl_id[0];
      const tmpl = tid ? tmplById[tid] : null;
      productById[v.id] = {
        id: v.id,
        name: v.name,
        default_code: v.default_code,
        qty_available: v.qty_available,
        list_price: v.list_price,
        type: v.type,
        categ_id: tmpl?.categ_id || null,
        standard_price: parseFloat(tmpl?.standard_price || 0),
      };
    }
    const costForProduct = (pid) => productById[pid]?.standard_price || 0;
    const products = variants; // for diagnostics

    // ── PHASE 5: shape output ────────────────────────────────────────────────
    const allProducts = Object.values(prodAgg)
      .filter(t => t.revenue > 0 || t.qty > 0)
      .map(t => {
        const prod   = productById[t.pid] || {};
        const stdC   = costForProduct(t.pid) || parseFloat(prod.standard_price || 0);
        const cost   = stdC * t.qty;
        const gp     = t.revenue - cost;
        const margin = t.revenue > 0 ? Math.round((gp / t.revenue) * 100) : 0;
        return {
          title:        prod.name || t.pname,
          code:         prod.default_code || '',
          category:     (prod.categ_id && prod.categ_id[1]) ? prod.categ_id[1] : 'Uncategorised',
          revenue:      Math.round(t.revenue),
          unitsSold:    Math.round(t.qty),
          grossProfit:  Math.round(gp),
          margin,
          qtyAvailable: Math.round(parseFloat(prod.qty_available || 0)),
          stdPrice:     stdC, // resolved via template above
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

    // ── PHASE 6: monthly cost / margin buckets ────────────────────────────────
    // We already have every line + each line's product standard_price. Roll
    // them up by invoice month so the dashboard's monthly cards can finally
    // show Cost, Gross Profit, and Margin% for Worthy North + Oceania.
    const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const monthlyCost = MONTH_NAMES.map(m => ({
      month: m, totalCost: 0, marginableRevenue: 0, hasCostData: false,
    }));
    for (const line of lines) {
      const moveId = line.move_id && line.move_id[0];
      const dateStr = moveDateById[moveId];
      if (!dateStr) continue;
      const d = new Date(dateStr);
      if (isNaN(d) || d.getFullYear() !== year) continue;
      const mi = d.getMonth();

      const sign     = moveTypeById[moveId] === 'out_refund' ? -1 : 1;
      const qty      = parseFloat(line.quantity || 0) * sign;
      const rev      = parseFloat(line.price_subtotal || 0) * sign;

      const pid = line.product_id && line.product_id[0];
      const unitCost = pid ? costForProduct(pid) : 0;
      const cost = unitCost * qty;

      // Only fold revenue + cost together when we have a real cost.
      // Lines with no purchase_price are excluded from BOTH sides so
      // margin% reflects only the lines we can actually cost — matching
      // Odoo's own margin reports.
      if (unitCost > 0) {
        monthlyCost[mi].marginableRevenue += rev;
        monthlyCost[mi].totalCost         += cost;
        monthlyCost[mi].hasCostData = true;
      }
    }
    for (const m of monthlyCost) {
      m.totalCost         = Math.round(m.totalCost);
      m.marginableRevenue = Math.round(m.marginableRevenue);
      m.grossProfit       = m.hasCostData ? m.marginableRevenue - m.totalCost : null;
      m.marginPct         = m.hasCostData && m.marginableRevenue > 0
                              ? Math.round((m.grossProfit / m.marginableRevenue) * 100)
                              : null;
    }

    return NextResponse.json({
      topProducts, topCategories, fastMoving, slowMoving,
      monthlyCost,
      diagnostics: {
        invoiceCount:   invoiceIds.length,
        rawLineCount:   rawLines.length,
        keptLineCount:  lines.length,
        withProduct, withoutProduct,
        productCount:   products.length,
        productIds:     productIds.length,
        year, companyId,
      },
    });

  } catch (err) {
    console.error(`[Odoo/adv] cid=${companyId} year=${year} error:`, err.message, err.stack);
    return NextResponse.json(emptyResp(err.message), { status: 200 });
  }
}
