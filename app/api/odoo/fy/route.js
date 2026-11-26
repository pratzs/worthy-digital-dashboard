import { NextResponse } from 'next/server';
import { withRoleFilter } from '@/lib/roleResponse';
import { nzFinancialYear } from '@/lib/ostendo';
import { readFY, readCustom } from '@/lib/odooFyCache';
import { customOf } from '@/lib/ostendo';

export const dynamic = 'force-dynamic';
/* A cold read of North takes 35-45s against Odoo (more when it is busy). Almost
   every request is answered from the shared five-minute slot instead - see
   lib/odooFyCache.js - and only a slot nobody has filled yet pays this cost. */
export const maxDuration = 300;   // a first read with no saved copy can take over 100 s when Odoo is busy

async function handler(request) {
  const { searchParams } = new URL(request.url);
  const cid = parseInt(searchParams.get('company') || '4', 10);
  const fy = parseInt(searchParams.get('fy') || '', 10) || nzFinancialYear();
  const fresh = searchParams.get('fresh') === '1';
  const custom = customOf(searchParams);   // the dashboard's Chosen dates
  if (custom) {
    try {
      const { payload, cached } = await readCustom(cid, custom);
      return NextResponse.json(payload, { headers: { 'X-Figures-Cache': cached === 'stale' ? 'stale' : cached ? 'slot' : 'live' } });
    } catch (err) {
      return NextResponse.json({ fy, company: cid, custom, error: err.message, months: [], reps: [], totals: null }, { status: 502 });
    }
  }
  try {
    const { payload, cached } = await readFY(cid, fy, { fresh });
    return NextResponse.json(payload, { headers: { 'X-Figures-Cache': cached === 'stale' ? 'stale' : cached ? 'slot' : 'live' } });
  } catch (err) {
    return NextResponse.json({ fy, company: cid, error: err.message, months: [], reps: [], totals: null },
      { status: 502 });
  }
}

// Limited to what the caller's department may see (lib/roleData.js).
export const GET = withRoleFilter('fy', handler);
