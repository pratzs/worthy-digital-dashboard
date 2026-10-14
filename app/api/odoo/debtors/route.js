import { NextResponse } from 'next/server';
import { readDebtors } from '@/lib/odooDebtorsCache';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request) {
  const params = new URL(request.url).searchParams;
  const cid = Number(params.get('company')) || 4;
  try {
    return NextResponse.json(await readDebtors(cid, { fresh: params.get('fresh') === '1' }));
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
