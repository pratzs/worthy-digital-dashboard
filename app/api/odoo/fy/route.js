import { NextResponse } from 'next/server';
import { nzFinancialYear } from '@/lib/ostendo';
import { readFY } from '@/lib/odooFyCache';

export const dynamic = 'force-dynamic';
/* A cold read of North takes 35-45s against Odoo (more when it is busy). Almost
   every request is answered from the shared five-minute slot instead - see
   lib/odooFyCache.js - and only a slot nobody has filled yet pays this cost. */
export const maxDuration = 90;

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const cid = parseInt(searchParams.get('company') || '4', 10);
  const fy = parseInt(searchParams.get('fy') || '', 10) || nzFinancialYear();
  const fresh = searchParams.get('fresh') === '1';
  try {
    const { payload, cached } = await readFY(cid, fy, { fresh });
    return NextResponse.json(payload, { headers: { 'X-Figures-Cache': cached ? 'slot' : 'live' } });
  } catch (err) {
    return NextResponse.json({ fy, company: cid, error: err.message, months: [], reps: [], totals: null },
      { status: 502 });
  }
}
