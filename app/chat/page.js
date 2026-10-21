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

const STARTERS = [
  "How did Worthy Products North do this financial year?",
  "Who are our top 10 overdue debtors on North, and how much do they owe?",
  "Compare north, south and oceania revenue this FY.",
  "Which north customers are over 90 days overdue?",
];

export default function ChatPage() {
  const [me, setMe] = useState(null);
  const [messages, setMessages] = useState([]); // [{role: 'user'|'assistant', text, table?}]
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const historyRef = useRef([]); // raw Anthropic-format history, sent back each turn
  const bottomRef = useRef(null);

  useEffect(() => {
    fetch("/api/auth/me").then((r) => r.json()).then(setMe).catch(() => {});
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
    <div style={{ minHeight: "100vh", background: "#fff", fontFamily: "'DM Sans',sans-serif",
      display: "flex", flexDirection: "column" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,600;9..40,700&display=swap');`}</style>

      <div style={{ borderBottom: "1px solid #e4e0da", padding: "16px 24px",
        display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <img src="/logo-black.png" alt="Worthy" style={{ height: 32 }} />
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>Ask a Question</div>
            <div style={{ fontSize: 11.5, color: "#8a8178" }}>Live from Odoo and Ostendo · nothing here is saved</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <Link href="/" style={{ fontSize: 12, fontWeight: 700, color: "#8a8178", textDecoration: "none" }}>
            ← Back to dashboard
          </Link>
          {me && <span style={{ fontSize: 11, color: "#b7afa4" }}>{me.label}</span>}
        </div>
      </div>

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
                color: m.role === "user" ? "#fff" : "#2a241f",
                whiteSpace: "pre-wrap",
              }}>{m.text}</div>
              {m.table && <Table table={m.table} />}
            </div>
          </div>
        ))}

        {busy && (
          <div style={{ fontSize: 13, color: "#8a8178", padding: "10px 14px" }}>Pulling the figures…</div>
        )}
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
    </div>
  );
}
