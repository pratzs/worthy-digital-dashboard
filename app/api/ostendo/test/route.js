/**
 * DEBUG ONLY — visit /api/ostendo/test to diagnose Ostendo connectivity.
 * Shows raw response, status code, and any errors.
 * Remove or protect this route before going to production.
 */
import { NextResponse } from 'next/server';
import https from 'node:https';

export const dynamic = 'force-dynamic';

const agent = new https.Agent({ rejectUnauthorized: false });

function rawFetch(hostname, port, path) {
  return new Promise((resolve) => {
    const options = { hostname, port, path, method: 'GET', agent };
    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', c => (raw += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: raw }));
    });
    req.setTimeout(15000, () => { req.destroy(); resolve({ status: 0, headers: {}, body: 'TIMEOUT' }); });
    req.on('error', (e) => resolve({ status: -1, headers: {}, body: e.message }));
    req.end();
  });
}

export async function GET() {
  const base   = process.env.OSTENDO_BASE_URL  || '(not set)';
  const rawKey = process.env.OSTENDO_API_KEY   || '(not set)';

  const results = {};

  if (base === '(not set)' || rawKey === '(not set)') {
    return NextResponse.json({ error: 'Env vars not set', OSTENDO_BASE_URL: base });
  }

  try {
    const urlObj = new URL(base);
    const host   = urlObj.hostname;
    const port   = parseInt(urlObj.port) || 443;

    // Test 1: no condition, no table — just root ping
    const ping = await rawFetch(host, port, '/');
    results.ping = { status: ping.status, body: ping.body.substring(0, 300) };

    // Test 2: tabledata with SALESINVOICEHEADER, no condition, apikey as raw (let URLSearchParams encode)
    const p2 = new URLSearchParams({
      tablename: 'SALESINVOICEHEADER',
      apikey:    rawKey,
      format:    'json',
    });
    const t2 = await rawFetch(host, port, `/tabledata?${p2.toString()}`);
    results.salesInvoiceHeader = {
      status: t2.status,
      bodyPreview: t2.body.substring(0, 500),
      isJSON: (() => { try { JSON.parse(t2.body); return true; } catch { return false; } })(),
    };

    // Test 3: same but with condition
    const year = new Date().getFullYear();
    const p3 = new URLSearchParams({
      tablename: 'SALESINVOICEHEADER',
      apikey:    rawKey,
      format:    'json',
      condition: `INVOICEDATE >= '${year}-01-01' AND INVOICEDATE <= '${year}-12-31'`,
    });
    const t3 = await rawFetch(host, port, `/tabledata?${p3.toString()}`);
    results.salesInvoiceHeaderFiltered = {
      status: t3.status,
      bodyPreview: t3.body.substring(0, 500),
      isJSON: (() => { try { JSON.parse(t3.body); return true; } catch { return false; } })(),
    };

    // Test 4: try lowercase table name
    const p4 = new URLSearchParams({ tablename: 'salesinvoiceheader', apikey: rawKey, format: 'json' });
    const t4 = await rawFetch(host, port, `/tabledata?${p4.toString()}`);
    results.salesInvoiceHeaderLower = { status: t4.status, bodyPreview: t4.body.substring(0, 300) };

    // Test 5: try the /salesinvoice direct endpoint (some Ostendo versions use this)
    const p5 = new URLSearchParams({ apikey: rawKey, format: 'json' });
    const t5 = await rawFetch(host, port, `/salesinvoice?${p5.toString()}`);
    results.salesInvoiceDirect = { status: t5.status, bodyPreview: t5.body.substring(0, 300) };

  } catch (err) {
    results.fatalError = err.message;
  }

  return NextResponse.json({
    env: { base, keyLength: rawKey.length, keyEnd: rawKey.slice(-4) },
    results,
  });
}
