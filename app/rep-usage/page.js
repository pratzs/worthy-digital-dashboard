"use client";

import { useEffect, useState } from "react";

const C = { brown: "#66270F", rust: "#B13924", line: "#E4E0DA", bg: "#FAF8F5", muted: "#7A7168" };
const th = { textAlign: "left", padding: "8px 10px", borderBottom: `1px solid ${C.line}`, color: C.brown, fontSize: 12, whiteSpace: "nowrap" };
const td = { padding: "8px 10px", borderBottom: `1px solid ${C.line}`, fontSize: 13, verticalAlign: "top" };
const card = { background: "#fff", border: `1px solid ${C.line}`, borderRadius: 14, padding: 16, marginBottom: 18, overflowX: "auto" };
const when = (iso) => { try { return new Date(iso).toLocaleString("en-NZ", { timeZone: "Pacific/Auckland", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }); } catch { return iso; } };

const deviceOf = (x) => [x.device, x.system, x.browser].filter(Boolean).join(", ") || x.ua || "-";

export default function RepUsage() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    fetch("/api/rep-usage", { cache: "no-store" }).then((r) => (r.ok ? r.json() : Promise.reject(r.status))).then(setD).catch((e) => setErr(String(e)));
  }, []);
  const name = (k) => d?.reps.find((r) => r.key === k)?.name || k;
  return (
    <div style={{ background: C.bg, minHeight: "100dvh", padding: 20, fontFamily: "-apple-system, BlinkMacSystemFont, 'DM Sans', 'Segoe UI', sans-serif" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <h1 style={{ color: C.brown, fontSize: 24, margin: "0 0 4px" }}>Rep assistant usage</h1>
        <p style={{ color: C.muted, margin: "0 0 16px", fontSize: 14 }}>How the My account assistant is being used. Daily limit per rep: {d?.dailyLimit ?? "..."} questions. Times are New Zealand time.</p>
        {err && <div style={{ color: C.rust }}>Could not load: {err}</div>}
        {d?.note && <div style={{ ...card, borderColor: C.rust, color: C.rust, fontSize: 14 }}>{d.note}</div>}
        {!d && !err && <div style={{ color: C.muted }}>Loading...</div>}
        {d && (<>
          <div style={card}>
            <h2 style={{ fontSize: 16, color: C.brown, margin: "0 0 10px" }}>Questions by rep</h2>
            <table style={{ borderCollapse: "collapse", minWidth: "100%" }}>
              <thead><tr>{["Lead", "Email", "Today", "Last 7 days", "Answered", "Failed", "Average seconds", "AI tokens in / out"].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>{d.reps.map((r) => (
                <tr key={r.key}><td style={{ ...td, fontWeight: 600 }}>{r.name}</td><td style={td}>{r.email || "-"}</td><td style={td}>{r.today} / {d.dailyLimit}</td><td style={td}>{r.last7Days}</td><td style={td}>{r.answered}</td><td style={{ ...td, color: r.failed ? C.rust : undefined }}>{r.failed}</td><td style={td}>{r.avgSeconds ?? "-"}</td><td style={td}>{r.inputTokens.toLocaleString()} / {r.outputTokens.toLocaleString()}</td></tr>
              ))}</tbody>
            </table>
          </div>
          <div style={card}>
            <h2 style={{ fontSize: 16, color: C.brown, margin: "0 0 10px" }}>Sign-ins ({(d.signins || []).length})</h2>
            {!(d.signins || []).length ? <div style={{ color: C.muted, fontSize: 14 }}>None yet.</div> : (
              <table style={{ borderCollapse: "collapse", minWidth: "100%" }}>
                <thead><tr>{["When", "Lead", "Email typed", "Where", "Result", "Place (from internet address)", "Device and browser"].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
                <tbody>{d.signins.map((s, i) => (
                  <tr key={i}><td style={td}>{when(s.t)}</td><td style={td}>{s.rep ? name(s.rep) : "-"}</td><td style={td}>{s.email || "-"}</td><td style={td}>{s.how === "connector" ? "Claude / ChatGPT" : "My account page"}</td><td style={{ ...td, color: s.ok ? "#2f7a3d" : C.rust, fontWeight: 600 }}>{s.ok ? "Signed in" : "Failed"}</td><td style={td}>{s.place || "-"}{s.ip ? <div style={{ color: C.muted, fontSize: 12 }}>{s.ip}</div> : null}</td><td style={{ ...td, maxWidth: 260 }}>{deviceOf(s)}</td></tr>
                ))}</tbody>
              </table>)}
          </div>
          <div style={card}>
            <h2 style={{ fontSize: 16, color: C.brown, margin: "0 0 10px" }}>"This looks wrong" and "Helpful" notes ({d.feedback.length})</h2>
            {d.feedback.length === 0 ? <div style={{ color: C.muted, fontSize: 14 }}>None yet.</div> : (
              <table style={{ borderCollapse: "collapse", minWidth: "100%" }}>
                <thead><tr>{["When", "Rep", "Flag", "Question", "Their note", "The answer they saw"].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
                <tbody>{d.feedback.map((f, i) => (
                  <tr key={i}><td style={td}>{when(f.t)}</td><td style={td}>{name(f.rep)}</td><td style={{ ...td, color: f.kind === "wrong" ? C.rust : "#2f7a3d", fontWeight: 600 }}>{f.kind === "wrong" ? "Looks wrong" : "Helpful"}</td><td style={td}>{f.question}</td><td style={td}>{f.note || "-"}</td><td style={{ ...td, maxWidth: 420, whiteSpace: "pre-wrap" }}>{f.answer}</td></tr>
                ))}</tbody>
              </table>)}
          </div>
          <div style={card}>
            <h2 style={{ fontSize: 16, color: C.brown, margin: "0 0 10px" }}>Latest questions</h2>
            <table style={{ borderCollapse: "collapse", minWidth: "100%" }}>
              <thead><tr>{["When", "Lead", "Question and answer", "Looked up", "Result", "Seconds", "Place", "Device and browser"].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>{d.usage.map((u, i) => (
                <tr key={i}><td style={td}>{when(u.t)}</td><td style={td}>{name(u.rep)}</td><td style={{ ...td, maxWidth: 420 }}>{u.question}{u.answer ? <details style={{ marginTop: 4 }}><summary style={{ cursor: "pointer", color: C.brown }}>Show the answer</summary><div style={{ whiteSpace: "pre-wrap", fontSize: 13, marginTop: 4 }}>{u.answer}</div></details> : null}</td><td style={td}>{(u.calls && u.calls.length ? u.calls.map((c) => [c.tool, c.person, c.about].filter(Boolean).join(": ")) : (u.tools || [])).join(", ") || "-"}</td><td style={{ ...td, color: u.ok ? "#2f7a3d" : C.rust }}>{u.ok ? "Answered" : `Failed${u.why ? `: ${u.why}` : ""}`}</td><td style={td}>{u.ms ? Math.round(u.ms / 100) / 10 : "-"}</td><td style={td}>{u.place || "-"}{u.ip ? <div style={{ color: C.muted, fontSize: 12 }}>{u.ip}</div> : null}</td><td style={td}>{deviceOf(u)}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </>)}
      </div>
    </div>
  );
}
