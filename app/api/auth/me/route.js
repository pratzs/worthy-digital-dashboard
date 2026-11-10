import { NextResponse } from 'next/server';
import { ROLES, SECTIONS, verifySession } from '@/lib/auth';
import { personByKey } from '@/lib/people';
import { quotaNow } from '@/lib/repStore';
import { nzToday } from '@/lib/ostendo';
import { chatWho } from '@/lib/aiCost';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const session = await verifySession(request.cookies.get('worthy_auth')?.value);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { role, person } = session;
  // How many chat questions this person has left right now (only for departments that have the chat).
  const quota = ROLES[role].sections.includes('chat') ? await quotaNow(chatWho(person), nzToday()).catch(() => null) : null;
  const allowed = ROLES[role].sections;
  return NextResponse.json({ ok: true, role, label: ROLES[role].label, name: personByKey(person)?.name || null, quota,
    sections: SECTIONS.filter((s) => allowed.includes(s.id)) });
}
