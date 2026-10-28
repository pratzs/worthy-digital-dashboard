"use client";

import { useEffect, useRef, useState } from "react";

const BRAND = { rust: "#B13924", gold: "#FDB714", brown: "#66270F", bg: "#FAF8F5", line: "#E4E0DA", muted: "#8A8178" };

const SUGGESTIONS = [
  "How are my sales this month?",
  "What are my best sellers?",
  "Which customers should I call this week?",
  "How am I going against my target?",
  "Which of my customers owe me money?",
  "How can I grow my sales?",
];

/* A small, safe renderer for the answer text: paragraphs, bullet lists, bold and simple tables.
   It builds React elements, so nothing the model writes can inject HTML. */
function inline(text, key) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") && part.length > 4
      ? <strong key={`${key}-${i}`}>{part.slice(2, -2)}</strong>
      : <span key={`${key}-${i}`}>{part}</span>);
}
function Answer({ text }) {
  const lines = String(text || "").split("\n");
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (line.trim().startsWith("|")) {
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) { rows.push(lines[i].trim()); i++; }
      const cells = (r) => r.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const body = rows.filter((r) => !/^[|:\-\s]+$/.test(r));   // drop the |---| divider row
      const [head, ...rest] = body;
      blocks.push(
        <div key={blocks.length} style={{ overflowX: "auto", margin: "8px 0" }}>
          <table style={{ borderCollapse: "collapse", fontSize: 13, minWidth: "100%" }}>
            <thead><tr>{cells(head).map((c, j) => <th key={j} style={{ textAlign: "left", padding: "6px 10px", borderBottom: `1px solid ${BRAND.line}`, color: BRAND.brown, whiteSpace: "nowrap" }}>{inline(c, `h${j}`)}</th>)}</tr></thead>
            <tbody>{rest.map((r, ri) => <tr key={ri}>{cells(r).map((c, j) => <td key={j} style={{ padding: "6px 10px", borderBottom: `1px solid ${BRAND.line}`, whiteSpace: "nowrap" }}>{inline(c, `c${ri}-${j}`)}</td>)}</tr>)}</tbody>
          </table>
        </div>);
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*[-*]\s+/, "")); i++; }
      blocks.push(<ul key={blocks.length} style={{ margin: "6px 0", paddingLeft: 20 }}>{items.map((it, j) => <li key={j} style={{ margin: "3px 0" }}>{inline(it, `l${j}`)}</li>)}</ul>);
      continue;
    }
    blocks.push(<p key={blocks.length} style={{ margin: "6px 0", lineHeight: 1.5 }}>{inline(line.replace(/^#+\s*/, ""), `p${blocks.length}`)}</p>);
    i++;
  }
  return <div>{blocks}</div>;
}

export default function MySales() {
  const [rep, setRep] = useState(undefined);   // undefined = checking, null = signed out
  const [code, setCode] = useState("");
  const [signErr, setSignErr] = useState("");
  const [signing, setSigning] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef(null);

  useEffect(() => {
    fetch("/api/my-sales/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setRep(j))
      .catch(() => setRep(null));
  }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages, busy]);

  async function signIn(e) {
    e.preventDefault();
    setSigning(true); setSignErr("");
    try {
      const r = await fetch("/api/my-sales/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
      const j = await r.json();
      if (!r.ok) { setSignErr(j.error || "Could not sign in."); }
      else { setCode(""); setRep({ name: j.name, system: j.system }); }
    } catch { setSignErr("Could not connect. Check your internet and try again."); }
    setSigning(false);
  }

  async function signOut() {
    await fetch("/api/my-sales/logout", { method: "POST" }).catch(() => {});
    setRep(null); setMessages([]);
  }

  async function ask(text) {
    const q = (text ?? input).trim();
    if (!q || busy) return;
    const next = [...messages, { role: "user", content: q }];
    setMessages(next); setInput(""); setBusy(true);
    try {
      const r = await fetch("/api/my-sales/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: next }) });
      const j = await r.json();
      if (r.status === 401) { setRep(null); setMessages([]); setSignErr("Your session ended. Please sign in again."); }
      else setMessages([...next, { role: "assistant", content: r.ok ? j.text : (j.error || "Something went wrong. Please try again."), error: !r.ok }]);
    } catch {
      setMessages([...next, { role: "assistant", content: "Could not connect. Check your internet and try again.", error: true }]);
    }
    setBusy(false);
  }

  const shell = { minHeight: "100dvh", background: BRAND.bg, color: "#2b2622", fontFamily: "-apple-system, BlinkMacSystemFont, 'DM Sans', 'Segoe UI', sans-serif", display: "flex", flexDirection: "column" };

  if (rep === undefined) return <div style={{ ...shell, alignItems: "center", justifyContent: "center", color: BRAND.muted }}>Loading</div>;

  if (!rep) {
    return (
      <div style={{ ...shell, alignItems: "center", justifyContent: "center", padding: 16 }}>
        <form onSubmit={signIn} style={{ boxSizing: "border-box", background: "#fff", border: `1px solid ${BRAND.line}`, borderRadius: 16, padding: 28, width: "100%", maxWidth: 380 }}>
          <img src="/logo-black.png" alt="Worthy" style={{ height: 56, width: "auto", display: "block", marginBottom: 14 }} />
          <h1 style={{ fontSize: 20, margin: "0 0 6px", color: BRAND.brown }}>My account</h1>
          <p style={{ fontSize: 14, color: BRAND.muted, margin: "0 0 18px", lineHeight: 1.45 }}>Type your personal code to ask about your own sales and your own customers.</p>
          {signErr && <div role="alert" style={{ color: BRAND.rust, fontSize: 13, marginBottom: 12 }}>{signErr}</div>}
          <input type="password" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Your personal code" autoComplete="off" autoFocus required
            style={{ width: "100%", boxSizing: "border-box", padding: "13px 14px", fontSize: 16, borderRadius: 10, border: `1px solid ${BRAND.line}`, marginBottom: 12 }} />
          <button type="submit" disabled={signing || code.trim().length < 10}
            style={{ width: "100%", padding: 13, fontSize: 15, fontWeight: 700, color: "#fff", background: BRAND.rust, border: "none", borderRadius: 10, cursor: "pointer", opacity: signing || code.trim().length < 10 ? 0.6 : 1 }}>
            {signing ? "Checking" : "Open"}
          </button>
          <p style={{ fontSize: 12, color: BRAND.muted, margin: "14px 0 0" }}>Lost your code? Ask Pratham.</p>
        </form>
      </div>
    );
  }

  return (
    <div style={shell}>
      <header style={{ background: "#fff", borderBottom: `1px solid ${BRAND.line}`, padding: "10px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <img src="/logo-black.png" alt="Worthy" style={{ height: 40, width: "auto", display: "block" }} />
          <div style={{ fontWeight: 700, fontSize: 17, color: BRAND.brown }}>My account</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginLeft: "auto" }}>
          <div style={{ fontSize: 13, color: BRAND.muted, textAlign: "right", lineHeight: 1.3 }}>Signed in as<br /><strong style={{ color: BRAND.brown, fontWeight: 600 }}>{rep.name}</strong></div>
          <button onClick={signOut} style={{ fontSize: 13, color: BRAND.rust, background: "none", border: `1px solid ${BRAND.line}`, borderRadius: 8, padding: "7px 12px", cursor: "pointer", whiteSpace: "nowrap" }}>Sign out</button>
        </div>
      </header>

      <main style={{ flex: 1, width: "100%", maxWidth: 760, margin: "0 auto", padding: "16px 16px 8px", boxSizing: "border-box" }}>
        {messages.length === 0 && (
          <div>
            <h2 style={{ fontSize: 20, color: BRAND.brown, margin: "8px 0 6px" }}>Hi {rep.name.split(" ")[0]}</h2>
            <p style={{ fontSize: 14, color: BRAND.muted, margin: "0 0 16px", lineHeight: 1.5 }}>Ask me about your own sales and your own customers. Tap one to start, or type your own question.</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => ask(s)} style={{ maxWidth: "100%", textAlign: "left", fontSize: 14, padding: "10px 14px", background: "#fff", border: `1px solid ${BRAND.line}`, borderRadius: 12, cursor: "pointer", color: "#2b2622" }}>{s}</button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start", margin: "10px 0" }}>
            <div style={{ maxWidth: "92%", minWidth: 0, overflowWrap: "anywhere", padding: "10px 14px", borderRadius: 14, fontSize: 15, background: m.role === "user" ? BRAND.rust : "#fff", color: m.role === "user" ? "#fff" : (m.error ? BRAND.rust : "#2b2622"), border: m.role === "user" ? "none" : `1px solid ${BRAND.line}` }}>
              {m.role === "user" ? m.content : <Answer text={m.content} />}
            </div>
          </div>
        ))}
        {busy && <div style={{ color: BRAND.muted, fontSize: 14, margin: "10px 0" }}>Looking up your figures. This can take up to a minute the first time.</div>}
        <div ref={endRef} />
      </main>

      <form onSubmit={(e) => { e.preventDefault(); ask(); }} style={{ position: "sticky", bottom: 0, background: BRAND.bg, borderTop: `1px solid ${BRAND.line}`, padding: "10px 16px calc(10px + env(safe-area-inset-bottom))" }}>
        <div style={{ display: "flex", gap: 8, maxWidth: 760, margin: "0 auto" }}>
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask a question" maxLength={2000}
            style={{ flex: 1, minWidth: 0, padding: "13px 14px", fontSize: 16, borderRadius: 12, border: `1px solid ${BRAND.line}`, background: "#fff" }} />
          <button type="submit" disabled={busy || !input.trim()}
            style={{ flexShrink: 0, padding: "0 20px", fontSize: 15, fontWeight: 700, color: "#fff", background: BRAND.rust, border: "none", borderRadius: 12, cursor: "pointer", opacity: busy || !input.trim() ? 0.6 : 1 }}>Ask</button>
        </div>
      </form>
    </div>
  );
}
