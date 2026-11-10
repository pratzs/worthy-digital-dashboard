import { NextResponse } from 'next/server';
import { addMonthTokens } from '@/lib/repStore';
import { addUsage, chatWho } from '@/lib/aiCost';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(request) {
  try {
    const { prompt } = await request.json();
    if (!prompt) return NextResponse.json({ error: "No prompt provided" }, { status: 400 });

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        // Same model as the other chats. The old claude-sonnet-4-20250514 has been retired and returned an error for every request.
        model: process.env.AI_INSIGHTS_MODEL || "claude-sonnet-5-5",
        max_tokens: 1200,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const data = await res.json();
    if (data.error) return NextResponse.json({ error: data.error.message }, { status: 500 });
    // Runs on Worthy's key, so its size is added to the person's month for the cost page (it is not a chat question, so it takes nothing from their allowance).
    const person = request.headers.get('x-worthy-person');
    await addMonthTokens(person ? chatWho(person) : 'd.unknown', addUsage({}, data.usage), 0).catch(() => {});

    return NextResponse.json({ text: data.content?.[0]?.text || "No insights available." });
  } catch (err) {
    console.error("AI proxy error:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}