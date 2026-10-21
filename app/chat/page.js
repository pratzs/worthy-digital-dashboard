"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

const LS_PROVIDER = "worthy_chat_provider";
const LS_KEY_PREFIX = "worthy_chat_key_";

const SYSTEM = `You answer questions about Worthy's trading figures for a company director, using the `
  + `tools provided - never from memory or estimation. Worthy trades as three companies: north and `
  + `oceania (Odoo), south (Ostendo, separate tools). If a question doesn't say which company, ask `
  + `rather than guessing, unless it obviously means all three ("how are we doing overall"). State `
  + `dollar figures in NZD. When you present a table, call present_table with your own chosen columns `
  + `and rows - also give a one or two sentence summary of the headline in your own words, don't just `
  + `dump the table with no comment.`;

const PRESENT_TABLE_TOOL = {
  name: "present_table",
  description: "Show the user a table. Call this once, as your last step, whenever the answer is "
    + "naturally tabular (a list of customers, a month-by-month breakdown, a rep leaderboard, etc). "
    + "Pick the columns and rows yourself from what the other tools returned - round money to whole "
    + "dollars for readability, keep it to the rows that actually matter for the question asked.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string" },
      columns: { type: "array", items: { type: "string" } },
      rows: {
        type: "array",
        items: { type: "array", items: { type: ["string", "number", "null"] } },
        description: "One array per row, same order and length as columns.",
      },
    },
    required: ["title", "columns", "rows"],
  },
};

/** Anthropic's tool shape ({name, description, input_schema}) to OpenAI's
 * function-calling shape ({type:'function', function:{name, description, parameters}}). */
function toOpenAiTools(anthropicTools) {
  return anthropicTools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }));
}

async function runTool(name, args) {
  if (name === "present_table") return { __presented: true, table: args };
  const res = await fetch("/api/tools/call", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, arguments: args }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Tool call failed.");
  return data.result;
}

/** Runs the full ask-tool-answer loop against Claude, directly from the
 * browser, using the person's own API key - Anthropic's documented "bring
 * your own key" pattern (the anthropic-dangerous-direct-browser-access
 * header exists specifically for this). Returns { text, table, history }. */
async function askClaude(apiKey, userMessage, history, dataTools) {
  const tools = [...dataTools, PRESENT_TABLE_TOOL];
  const messages = [...history, { role: "user", content: userMessage }];
  let table = null;

  for (let turn = 0; turn < 6; turn++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({ model: "claude-sonnet-5-5", max_tokens: 2000, system: SYSTEM, tools, messages }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || "Claude API error.");

    messages.push({ role: "assistant", content: data.content });
    const toolUses = data.content.filter((b) => b.type === "tool_use");
    if (toolUses.length === 0) {
      const text = data.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
      return { text: text || "No answer.", table, history: messages };
    }

    const results = [];
    for (const use of toolUses) {
      try {
        const r = await runTool(use.name, use.input || {});
        if (r?.__presented) { table = r.table; results.push({ type: "tool_result", tool_use_id: use.id, content: "Shown to the user." }); continue; }
        results.push({ type: "tool_result", tool_use_id: use.id, content: JSON.stringify(r) });
      } catch (e) {
        results.push({ type: "tool_result", tool_use_id: use.id, content: `Error: ${e.message}`, is_error: true });
      }
    }
    messages.push({ role: "user", content: results });
  }
  throw new Error("Took too many steps to answer - try a narrower question.");
}

/** Same loop, against ChatGPT's Chat Completions API with its own key and
 * its own (OpenAI-shaped) function-calling format. */
async function askChatGpt(apiKey, userMessage, history, dataTools) {
  const tools = toOpenAiTools([...dataTools, PRESENT_TABLE_TOOL]);
  const messages = [{ role: "system", content: SYSTEM }, ...history, { role: "user", content: userMessage }];
  let table = null;

  for (let turn = 0; turn < 6; turn++) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: "gpt-5.1", messages, tools, tool_choice: "auto" }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || "ChatGPT API error.");

    const msg = data.choices[0].message;
    messages.push(msg);
    const calls = msg.tool_calls || [];
    if (calls.length === 0) {
      return { text: msg.content || "No answer.", table, history: messages.slice(1) }; // drop the system msg we prepended
    }

    for (const call of calls) {
      const args = JSON.parse(call.function.arguments || "{}");
      let content;
      try {
        const r = await runTool(call.function.name, args);
        if (r?.__presented) { table = r.table; content = "Shown to the user."; }
        else content = JSON.stringify(r);
      } catch (e) {
        content = `Error: ${e.message}`;
      }
      messages.push({ role: "tool", tool_call_id: call.id, content });
    }
  }
  throw new Error("Took too many steps to answer - try a narrower question.");
}

function downloadCsv(table) {
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [table.columns.map(esc).join(","), ...table.rows.map((row) => row.map(esc).join(","))];
  const blob = new Blob([lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${table.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "report"}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function Table({ table }) {
  return (
    <div style={{ marginTop: 10, border: "1px solid #e4e0da", borderRadius: 10, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 14px", background: "#faf8f5", borderBottom: "1px solid #e4e0da" }}>
        <span style={{ fontWeight: 700, fontSize: 13 }}>{table.title}</span>
        <button onClick={() => downloadCsv(table)} style={{
          fontSize: 11, fontWeight: 700, padding: "6px 12px", borderRadius: 7,
          border: "1px solid #b13924", background: "#fff", color: "#b13924", cursor: "pointer",
        }}>Export CSV</button>
      </div>
      <div style={{ overflowX: "auto", maxHeight: 420, overflowY: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
          <thead>
            <tr>{table.columns.map((c, i) => (
              <th key={i} style={{ textAlign: "left", padding: "8px 14px", position: "sticky", top: 0,
                background: "#fff", borderBottom: "1.5px solid #e4e0da", whiteSpace: "nowrap" }}>{c}</th>
            ))}</tr>
          </thead>
          <tbody>
            {table.rows.map((row, ri) => (
              <tr key={ri} style={{ borderBottom: "1px solid #f0ece6" }}>
                {row.map((cell, ci) => <td key={ci} style={{ padding: "7px 14px", whiteSpace: "nowrap" }}>{cell}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const KEY_HELP = {
  claude: { label: "Claude", url: "https://console.anthropic.com/settings/keys", host: "console.anthropic.com" },
  chatgpt: { label: "ChatGPT", url: "https://platform.openai.com/api-keys", host: "platform.openai.com" },
};

function KeySetup({ onSaved }) {
  const [provider, setProvider] = useState("claude");
  const [key, setKey] = useState("");
  const [error, setError] = useState(null);
  const [checking, setChecking] = useState(false);

  async function save() {
    const trimmed = key.trim();
    if (!trimmed) return;
    setChecking(true);
    setError(null);
    try {
      // A cheap real call, not a format guess - proves the key actually works
      // before we save it, so a typo doesn't surface three steps later.
      if (provider === "claude") {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json", "x-api-key": trimmed, "anthropic-version": "2023-06-01",
            "anthropic-dangerous-direct-browser-access": "true",
          },
          body: JSON.stringify({ model: "claude-sonnet-5-5", max_tokens: 1, messages: [{ role: "user", content: "hi" }] }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error.message || "That key didn't work.");
      } else {
        const res = await fetch("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${trimmed}` } });
        const data = await res.json();
        if (data.error) throw new Error(data.error.message || "That key didn't work.");
      }
      localStorage.setItem(LS_PROVIDER, provider);
      localStorage.setItem(LS_KEY_PREFIX + provider, trimmed);
      onSaved(provider, trimmed);
    } catch (e) {
      setError(e.message);
    } finally {
      setChecking(false);
    }
  }

  const info = KEY_HELP[provider];
  return (
    <div style={{ maxWidth: 520 }}>
      <h1 style={{ fontSize: 17, fontWeight: 700, marginBottom: 4 }}>Connect your AI, right here</h1>
      <p style={{ fontSize: 12.5, color: "#8a8178", marginBottom: 18, lineHeight: 1.5 }}>
        Your own API key, billed to you — a few cents per question, not a subscription. Chat happens
        on this page; nothing is billed to Worthy and your key is only ever stored in your own browser.
      </p>

      <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
        {[["claude", "Claude"], ["chatgpt", "ChatGPT"]].map(([id, label]) => (
          <button key={id} onClick={() => { setProvider(id); setError(null); setKey(""); }} style={{
            flex: 1, padding: "12px", borderRadius: 10, cursor: "pointer", fontWeight: 700, fontSize: 13,
            border: provider === id ? "1.5px solid #b13924" : "1px solid #e4e0da",
            background: provider === id ? "#fdf1ee" : "#fff", color: provider === id ? "#b13924" : "#2a241f",
          }}>{label}</button>
        ))}
      </div>

      <p style={{ fontSize: 12, color: "#5a524a", marginBottom: 8 }}>
        Get a key from <a href={info.url} target="_blank" rel="noopener noreferrer" style={{ color: "#b13924", fontWeight: 700 }}>{info.host}</a> (sign up, add a small amount of credit, create a key), then paste it below.
      </p>

      <input
        type="password"
        value={key}
        onChange={(e) => setKey(e.target.value)}
        placeholder={provider === "claude" ? "sk-ant-..." : "sk-..."}
        style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: "1px solid #e4e0da",
          fontSize: 13, fontFamily: "monospace", boxSizing: "border-box", marginBottom: 10 }}
      />
      {error && (
        <div style={{ fontSize: 12, color: "#b13924", marginBottom: 10 }}>{error}</div>
      )}
      <button onClick={save} disabled={checking || !key.trim()} style={{
        width: "100%", padding: "12px", borderRadius: 10, border: "none", background: "#b13924", color: "#fff",
        fontWeight: 700, fontSize: 13, cursor: checking ? "default" : "pointer", opacity: checking ? 0.6 : 1,
      }}>{checking ? "Checking…" : "Save and start chatting"}</button>

      <div style={{ marginTop: 24, paddingTop: 16, borderTop: "1px solid #e4e0da" }}>
        <Link href="/chat/connector" style={{ fontSize: 11.5, color: "#8a8178" }}>
          Prefer not to get an API key? Use your Claude or ChatGPT app directly instead →
        </Link>
      </div>
    </div>
  );
}

const STARTERS = [
  "How did Worthy Products North do this financial year?",
  "Who are our top 10 overdue debtors on North, and how much do they owe?",
  "Compare north, south and oceania revenue this FY.",
  "Which north customers are over 90 days overdue?",
];

export default function ChatPage() {
  const [me, setMe] = useState(null);
  const [provider, setProvider] = useState(null);
  const [apiKey, setApiKey] = useState(null);
  const [ready, setReady] = useState(false); // avoids a flash of the key-setup screen before localStorage is read
  const [dataTools, setDataTools] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const historyRef = useRef([]);
  const bottomRef = useRef(null);

  useEffect(() => {
    fetch("/api/auth/me").then((r) => r.json()).then(setMe).catch(() => {});
    fetch("/api/tools/list").then((r) => r.json()).then((d) => setDataTools(d.tools)).catch(() => setDataTools([]));
    const p = localStorage.getItem(LS_PROVIDER);
    const k = p && localStorage.getItem(LS_KEY_PREFIX + p);
    if (p && k) { setProvider(p); setApiKey(k); }
    setReady(true);
  }, []);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, busy]);

  function forgetKey() {
    if (provider) localStorage.removeItem(LS_KEY_PREFIX + provider);
    localStorage.removeItem(LS_PROVIDER);
    setProvider(null);
    setApiKey(null);
    setMessages([]);
    historyRef.current = [];
  }

  async function send(text) {
    const q = (text ?? input).trim();
    if (!q || busy || !dataTools) return;
    setInput("");
    setError(null);
    setMessages((m) => [...m, { role: "user", text: q }]);
    setBusy(true);
    try {
      const ask = provider === "claude" ? askClaude : askChatGpt;
      const { text: answer, table, history } = await ask(apiKey, q, historyRef.current, dataTools);
      historyRef.current = history;
      setMessages((m) => [...m, { role: "assistant", text: answer, table }]);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: "#fff", fontFamily: "'DM Sans',sans-serif",
      display: "flex", flexDirection: "column" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,600;9..40,700&display=swap');`}</style>

      <div style={{ borderBottom: "1px solid #e4e0da", padding: "16px 24px",
        display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <img src="/logo-black.png" alt="Worthy" style={{ height: 32 }} />
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>Ask a Question</div>
            <div style={{ fontSize: 11.5, color: "#8a8178" }}>Live from Odoo and Ostendo</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          {apiKey && (
            <button onClick={forgetKey} style={{ fontSize: 11, color: "#8a8178", background: "none",
              border: "1px solid #e4e0da", borderRadius: 7, padding: "5px 10px", cursor: "pointer" }}>
              Forget {KEY_HELP[provider]?.label} key
            </button>
          )}
          <Link href="/" style={{ fontSize: 12, fontWeight: 700, color: "#8a8178", textDecoration: "none" }}>← Back to dashboard</Link>
          {me && <span style={{ fontSize: 11, color: "#b7afa4" }}>{me.label}</span>}
        </div>
      </div>

      {!ready ? null : !apiKey ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <KeySetup onSaved={(p, k) => { setProvider(p); setApiKey(k); }} />
        </div>
      ) : (
        <>
          <div style={{ flex: 1, overflowY: "auto", padding: "24px", maxWidth: 820, width: "100%", margin: "0 auto" }}>
            {messages.length === 0 && (
              <div>
                <p style={{ fontSize: 13, color: "#8a8178", marginBottom: 14 }}>
                  Ask about sales, margin, debtors or reps across North, South or Oceania. Try:
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {STARTERS.map((s) => (
                    <button key={s} onClick={() => send(s)} style={{
                      textAlign: "left", padding: "10px 14px", borderRadius: 9, border: "1px solid #e4e0da",
                      background: "#faf8f5", fontSize: 13, cursor: "pointer", color: "#2a241f",
                    }}>{s}</button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) => (
              <div key={i} style={{ marginBottom: 18, display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
                <div style={{ maxWidth: "88%" }}>
                  <div style={{
                    padding: "10px 14px", borderRadius: 12, fontSize: 13.5, lineHeight: 1.5,
                    background: m.role === "user" ? "#b13924" : "#f4f1ec",
                    color: m.role === "user" ? "#fff" : "#2a241f", whiteSpace: "pre-wrap",
                  }}>{m.text}</div>
                  {m.table && <Table table={m.table} />}
                </div>
              </div>
            ))}

            {busy && <div style={{ fontSize: 13, color: "#8a8178", padding: "10px 14px" }}>Pulling the figures…</div>}
            {error && (
              <div style={{ fontSize: 13, color: "#b13924", padding: "10px 14px", background: "#fdf1ee",
                borderRadius: 9, border: "1px solid #f3c9bd" }}>{error}</div>
            )}
            <div ref={bottomRef} />
          </div>

          <div style={{ borderTop: "1px solid #e4e0da", padding: 16 }}>
            <div style={{ maxWidth: 820, margin: "0 auto", display: "flex", gap: 10 }}>
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), send())}
                placeholder="Ask about sales, margin, debtors, reps…"
                disabled={busy}
                style={{ flex: 1, padding: "12px 16px", borderRadius: 10, border: "1px solid #e4e0da",
                  fontSize: 13.5, fontFamily: "inherit" }}
              />
              <button onClick={() => send()} disabled={busy || !input.trim()} style={{
                padding: "0 22px", borderRadius: 10, border: "none", background: "#b13924", color: "#fff",
                fontWeight: 700, fontSize: 13, cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1,
              }}>Ask</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
