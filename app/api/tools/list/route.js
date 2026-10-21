/**
 * Tool schemas for the in-dashboard, bring-your-own-key chat (app/chat). This
 * route is just the schema; the actual LLM call happens client-side against
 * the person's own Claude/ChatGPT API key (never seen by this server) - only
 * the data READ (app/api/tools/call) needs us, because that's the only step
 * that touches the Odoo/Ostendo credentials. Protected by the normal
 * worthy_auth cookie via middleware.js, same as every other /api/ route.
 */
import { NextResponse } from 'next/server';
import { DATA_TOOLS } from '@/lib/mcpTools';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ tools: DATA_TOOLS });
}
