"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

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
          <div style={{ fontSize: 12.5 }}>It&apos;ll ask for the <b>Management password</b> — one time only. After that it&apos;s connected under your own account, every time, on any device you sign into.</div>
        </div>
      </div>
    </div>
  );
}

export default function ChatPage() {
  const [me, setMe] = useState(null);
  const [platform, setPlatform] = useState(null); // 'claude' | 'chatgpt' | null
  const [mcpUrl] = useState(() => (typeof window !== "undefined" ? `${window.location.origin}/api/mcp` : ""));

  useEffect(() => {
    fetch("/api/auth/me").then((r) => r.json()).then(setMe).catch(() => {});
  }, []);

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

      <div style={{ maxWidth: 820, margin: "0 auto", padding: "28px 24px 40px" }}>
        <h1 style={{ fontSize: 17, fontWeight: 700, marginBottom: 4 }}>Log in with your own Claude or ChatGPT</h1>
        <p style={{ fontSize: 12.5, color: "#8a8178", marginBottom: 18, lineHeight: 1.5 }}>
          Nothing billed to Worthy. Pick what you use, connect once, then ask anything.
        </p>

        <div style={{ display: "flex", gap: 10, marginBottom: 4 }}>
          {[["claude", "Claude"], ["chatgpt", "ChatGPT"]].map(([id, label]) => (
            <button key={id} onClick={() => setPlatform(id)} style={{
              flex: 1, padding: "16px", borderRadius: 11, cursor: "pointer", fontWeight: 700, fontSize: 14,
              border: platform === id ? "1.5px solid #b13924" : "1px solid #e4e0da",
              background: platform === id ? "#fdf1ee" : "#fff",
              color: platform === id ? "#b13924" : "#2a241f",
            }}>I use {label}</button>
          ))}
        </div>

        {platform && <ConnectorSetup platform={platform} mcpUrl={mcpUrl} />}

        <div style={{ marginTop: 28, marginBottom: 10, fontSize: 12.5, fontWeight: 700, color: "#5a524a" }}>
          Starter questions — copy one, paste it once you&apos;re connected
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
          {COMPANIES.map((c) => <CompanyBox key={c.id} company={c} />)}
        </div>
      </div>
    </div>
  );
}
