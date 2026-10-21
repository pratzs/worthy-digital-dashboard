"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

/** Turns a present_table payload into a CSV string and triggers a download.
 * Quotes every cell and doubles internal quotes (RFC 4180) so commas, quotes
 * and newlines inside a customer name or note don't corrupt the column count. */
function downloadCsv(table) {
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [
    table.columns.map(esc).join(","),
    ...table.rows.map((row) => row.map(esc).join(",")),
  ];
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
            <tr>
              {table.columns.map((c, i) => (
                <th key={i} style={{ textAlign: "left", padding: "8px 14px", position: "sticky", top: 0,
                  background: "#fff", borderBottom: "1.5px solid #e4e0da", whiteSpace: "nowrap" }}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, ri) => (
              <tr key={ri} style={{ borderBottom: "1px solid #f0ece6" }}>
                {row.map((cell, ci) => (
                  <td key={ci} style={{ padding: "7px 14px", whiteSpace: "nowrap" }}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Same palette Dashboard.js uses, so these boxes read as the same three
// companies the rest of the dashboard already shows.
const COMPANIES = [
  { id: "north", name: "Worthy Products North", color: "#2256c2", light: "#eef3fd",
    question: "Using the Worthy Reports connector, give me Worthy Products North's trading summary for this financial year — revenue, margin, and any debtors over 90 days." },
  { id: "south", name: "Worthy Products South", color: "#2256c2", light: "#eef3fd",
    question: "Using the Worthy Reports connector, give me Worthy Products South's trading summary for this financial year, from Ostendo." },
  { id: "oceania", name: "Worthy Oceania", color: "#b13924", light: "#fdf1ee",
    question: "Using the Worthy Reports connector, give me Worthy Oceania's trading summary for this financial year — revenue, margin, and debtors." },
];

function CopyButton({ text, label = "Copy" }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        try { await navigator.clipboard.writeText(text); } catch { /* clipboard denied - nothing to fall back to here */ }
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      style={{
        fontSize: 11, fontWeight: 700, padding: "6px 11px", borderRadius: 7, cursor: "pointer",
        border: "1px solid #e4e0da", background: copied ? "#eaf7ee" : "#fff",
        color: copied ? "#2a7a46" : "#5a524a", whiteSpace: "nowrap",
      }}
    >{copied ? "Copied ✓" : label}</button>
  );
}

function CompanyBox({ company }) {
  return (
    <div style={{ border: "1px solid #e4e0da", borderRadius: 12, padding: 16, background: company.light }}>
      <div style={{ fontWeight: 700, fontSize: 13.5, color: company.color, marginBottom: 8 }}>{company.name}</div>
      <div style={{ fontSize: 12, color: "#5a524a", lineHeight: 1.5, marginBottom: 10 }}>{company.question}</div>
      <CopyButton text={company.question} label="Copy question" />
    </div>
  );
}

function ConnectorSetup({ platform, mcpUrl }) {
  const appUrl = platform === "claude" ? "https://claude.ai" : "https://chatgpt.com";
  const where = platform === "claude"
    ? "Settings → Connectors → Add custom connector"
    : "Settings → Apps & Connectors → Advanced → Create (you may need Developer Mode on first)";
  return (
    <div style={{ marginTop: 14, padding: 16, border: "1px solid #e4e0da", borderRadius: 12, background: "#faf8f5" }}>
      <div style={{ display: "grid", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ width: 20, height: 20, borderRadius: "50%", background: "#b13924", color: "#fff",
            fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>1</span>
          <div style={{ fontSize: 12.5, flex: 1 }}>Copy this connector URL</div>
          <CopyButton text={mcpUrl} />
        </div>
        <div style={{ fontSize: 11.5, fontFamily: "monospace", color: "#8a8178", paddingLeft: 30, wordBreak: "break-all" }}>{mcpUrl}</div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ width: 20, height: 20, borderRadius: "50%", background: "#b13924", color: "#fff",
            fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>2</span>
          <div style={{ fontSize: 12.5, flex: 1 }}>Go to <b>{where}</b> and paste the URL above</div>
          <a href={appUrl} target="_blank" rel="noopener noreferrer" style={{
            fontSize: 11, fontWeight: 700, padding: "6px 12px", borderRadius: 7, textDecoration: "none",
            border: "1px solid #b13924", background: "#fff", color: "#b13924", whiteSpace: "nowrap",
          }}>Open {platform === "claude" ? "Claude" : "ChatGPT"} ↗</a>
        </div>

        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <span style={{ width: 20, height: 20, borderRadius: "50%", background: "#b13924", color: "#fff",
            fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>3</span>
          <div style={{ fontSize: 12.5 }}>It&apos;ll ask for the <b>Management password</b> — one time only. After that it&apos;s connected under your own account, every time you open it, on any device you sign into.</div>
        </div>
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
  const [platform, setPlatform] = useState(null); // 'claude' | 'chatgpt' | null
  const [mcpUrl, setMcpUrl] = useState("");
  const [showConnectorSetup, setShowConnectorSetup] = useState(false);
  const [messages, setMessages] = useState([]); // [{role: 'user'|'assistant', text, table?}]
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const historyRef = useRef([]); // raw Anthropic-format history, sent back each turn
  const bottomRef = useRef(null);

  useEffect(() => {
    fetch("/api/auth/me").then((r) => r.json()).then(setMe).catch(() => {});
    if (typeof window !== "undefined") setMcpUrl(`${window.location.origin}/api/mcp`);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  async function send(text) {
    const q = (text ?? input).trim();
    if (!q || busy) return;
    setInput("");
    setError(null);
    setMessages((m) => [...m, { role: "user", text: q }]);
    setBusy(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: q, history: historyRef.current }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Something went wrong.");
      historyRef.current = data.history || [];
      setMessages((m) => [...m, { role: "assistant", text: data.text, table: data.table }]);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: "#fff", fontFamily: "'DM Sans',sans-serif" }}>
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
          <Link href="/" style={{ fontSize: 12, fontWeight: 700, color: "#8a8178", textDecoration: "none" }}>
            ← Back to dashboard
          </Link>
          {me && <span style={{ fontSize: 11, color: "#b7afa4" }}>{me.label}</span>}
        </div>
      </div>

      <div style={{ maxWidth: 820, margin: "0 auto", padding: "24px 24px 8px" }}>
        {messages.length === 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
            <p style={{ fontSize: 12.5, color: "#8a8178", marginBottom: 2 }}>Just type a question, or try one:</p>
            {STARTERS.map((s) => (
              <button key={s} onClick={() => send(s)} style={{
                textAlign: "left", padding: "10px 14px", borderRadius: 9, border: "1px solid #e4e0da",
                background: "#faf8f5", fontSize: 13, cursor: "pointer", color: "#2a241f",
              }}>{s}</button>
            ))}
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} style={{ marginBottom: 18, display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
            <div style={{ maxWidth: "88%" }}>
              <div style={{
                padding: "10px 14px", borderRadius: 12, fontSize: 13.5, lineHeight: 1.5,
                background: m.role === "user" ? "#b13924" : "#f4f1ec",
                color: m.role === "user" ? "#fff" : "#2a241f",
                whiteSpace: "pre-wrap",
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

        <div style={{ display: "flex", gap: 10, margin: "16px 0 8px" }}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), send())}
            placeholder="Ask about sales, margin, debtors, reps…"
            disabled={busy}
            autoFocus
            style={{ flex: 1, padding: "12px 16px", borderRadius: 10, border: "1px solid #e4e0da",
              fontSize: 13.5, fontFamily: "inherit" }}
          />
          <button onClick={() => send()} disabled={busy || !input.trim()} style={{
            padding: "0 22px", borderRadius: 10, border: "none", background: "#b13924", color: "#fff",
            fontWeight: 700, fontSize: 13, cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1,
          }}>Ask</button>
        </div>
      </div>

      <div style={{ maxWidth: 820, margin: "0 auto", padding: "8px 24px 32px", textAlign: "center" }}>
        <button onClick={() => setShowConnectorSetup((v) => !v)} style={{
          fontSize: 11.5, color: "#8a8178", background: "none", border: "none", cursor: "pointer",
          textDecoration: "underline",
        }}>
          {showConnectorSetup ? "Hide" : "Prefer to use your own Claude or ChatGPT instead?"}
        </button>
      </div>

      {showConnectorSetup && (
        <div style={{ borderTop: "1px solid #e4e0da" }}>
          <div style={{ maxWidth: 820, margin: "0 auto", padding: "24px" }}>
            <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Connect your own account</h2>
            <p style={{ fontSize: 12, color: "#8a8178", marginBottom: 16, lineHeight: 1.5 }}>
              Costs nothing to Worthy, runs under your own subscription — but it&apos;s a one-time setup
              (a few technical steps). If that sounds like more than you want to deal with, the box
              above already does the job.
            </p>

            <div style={{ display: "flex", gap: 10, marginBottom: 4 }}>
              {[["claude", "Claude"], ["chatgpt", "ChatGPT"]].map(([id, label]) => (
                <button key={id} onClick={() => setPlatform(id)} style={{
                  flex: 1, padding: "14px", borderRadius: 11, cursor: "pointer", fontWeight: 700, fontSize: 13.5,
                  border: platform === id ? "1.5px solid #b13924" : "1px solid #e4e0da",
                  background: platform === id ? "#fdf1ee" : "#fff",
                  color: platform === id ? "#b13924" : "#2a241f",
                }}>I use {label}</button>
              ))}
            </div>

            {platform && <ConnectorSetup platform={platform} mcpUrl={mcpUrl} />}

            <div style={{ marginTop: 24, marginBottom: 10, fontSize: 12.5, fontWeight: 700, color: "#5a524a" }}>
              Starter questions — copy one, paste it once you&apos;re connected
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
              {COMPANIES.map((c) => <CompanyBox key={c.id} company={c} />)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
