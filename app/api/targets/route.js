import { NextResponse } from 'next/server';
import { REP_TARGETS } from '@/lib/repTargets';

export const dynamic = 'force-dynamic';

// Dashboard sign-in only (middleware protects everything that is not listed as public): the Sales vs Target table loads
// the targets here instead of having them built into the page's JavaScript, which anyone could download.
export async function GET() {
  return NextResponse.json({ targets: REP_TARGETS }, { headers: { 'Cache-Control': 'no-store' } });
}
