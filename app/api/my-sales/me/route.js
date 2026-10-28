import { NextResponse } from 'next/server';
import { repFromSession } from '@/lib/repSession';
import { quotaNow } from '@/lib/repStore';
import { nzToday } from '@/lib/ostendo';

export const dynamic = 'force-dynamic';

/** Who is signed in on this browser, or 401. Used by the page on load. */
export async function GET(request) {
  const lead = repFromSession(request);
  if (!lead) return NextResponse.json({ error: 'not signed in' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  const quota = await quotaNow(lead.key, nzToday()).catch(() => null);   // how many questions are left today
  const first = lead.members[0]?.label.split(' ')[0] || 'my team';
  // Suggested questions are written for a team lead; they name only people on the lead's own team.
  const suggestions = [
    'How is my team going this year?',
    'Who on my team needs help right now?',
    `How is ${first} going?`,
    'Which team members are behind target?',
    'Which of my team\'s customers have gone quiet?',
    'Who has overdue accounts to chase?',
    ...(lead.self ? ['How am I going against my own target?'] : []),
    'Give me my Monday summary',
  ];
  return NextResponse.json({
    name: lead.label, role: 'lead', team: lead.teamName, system: lead.system,
    teamMembers: lead.members.map((m) => m.label), hasOwnSales: Boolean(lead.self),
    suggestions, quota,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
