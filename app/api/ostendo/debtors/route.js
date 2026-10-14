/**
 * Debtors for Worthy Products South (Ostendo): see lib/ostendoDebtors.js. Shared across
 * everyone in five-minute slots, like the North figures (lib/odooDebtorsCache.js).
 */
import { NextResponse } from 'next/server';
import { readDebtors } from '@/lib/odooDebtorsCache';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request) {
  const fresh = new URL(request.url).searchParams.get('fresh') === '1';
  try {
    return NextResponse.json(await readDebtors('south', { fresh }));
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
