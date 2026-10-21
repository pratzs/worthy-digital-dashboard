/**
 * Executes one data tool for the in-dashboard BYOK chat. The browser (using
 * the person's own Claude/ChatGPT key) decides WHICH tool to call and with
 * what arguments; this endpoint just runs it against the live Odoo/Ostendo
 * connection, which is the one part that has to stay server-side (the
 * credentials for that are never exposed to the browser). Auth is the normal
 * worthy_auth session cookie via middleware.js - nothing new here, same as
 * every other /api/ route this login can already reach.
 */
import { NextResponse } from 'next/server';
import { runDataTool } from '@/lib/mcpTools';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  const { name, arguments: args } = body || {};
  if (!name) return NextResponse.json({ error: 'No tool name provided' }, { status: 400 });

  try {
    const result = await runDataTool(name, args || {});
    return NextResponse.json({ result });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
