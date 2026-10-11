import { NextResponse } from 'next/server';
import { ROLES, SECTIONS, verifyRole } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const role = await verifyRole(request.cookies.get('worthy_auth')?.value);
  if (!role) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const allowed = ROLES[role].sections;
  return NextResponse.json({ ok: true, role, label: ROLES[role].label,
    sections: SECTIONS.filter((s) => allowed.includes(s.id)) });
}
