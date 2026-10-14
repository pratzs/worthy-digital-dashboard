import { NextResponse } from 'next/server';
import { readSouth } from '@/lib/ostendoCache';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request) {
  const url = new URL(request.url);
  const fresh = url.searchParams.get('fresh') === '1';
  url.searchParams.delete('fresh');
  const qs = url.searchParams.toString() ? `?${url.searchParams.toString()}` : '';
  try {
    return NextResponse.json(await readSouth('fy', qs, { fresh }));
  } catch (e) {
    return NextResponse.json(e.body || { error: e.message }, { status: e.status || 502 });
  }
}
