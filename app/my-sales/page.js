"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const BRAND = { rust: "#B13924", gold: "#FDB714", brown: "#66270F", bg: "#FAF8F5", line: "#E4E0DA", muted: "#7A7168", ink: "#2b2622" };

const STORE_KEY = "worthy_my_account_chat_v1";   // kept on this device only, per rep
const KEEP_FOR_MS = 24 * 60 * 60 * 1000;
const storeKey = (name) => `${STORE_KEY}:${name}`;
const validMsg = (m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string";

const SUGGESTIONS = [
  "How are my sales this month?",
  "Will I hit my target this month?",
  "Which customers should I call this week?",
  "What are my best sellers?",
  "What else could I sell to my customers?",
  "Which of my customers owe me money?",
  "How am I doing compared with last year?",
  "Give me my Monday summary",
];
const DEFAULT_FOLLOW_UPS = ["What should I do next?", "Which customers should I call this week?", "Show me my best sellers"];

/* Every answer ends with a line "Next questions: a | b | c". Pull it off so it can be shown as tap buttons. */
function splitAnswer(text) {
  const t = String(text || "");
  const m = /\n?\s*Next questions?:\s*(.+)\s*$/i.exec(t);
  if (!m) return { body: t.trim(), next: [] };
  const next = m[1].split("|").map((x) => x.replace(/^[\s"'-]+|[\s"']+$/g, "")).filter((x) => x.length > 3 && x.length < 90).slice(0, 3);
  return { body: t.slice(0, m.index).trim(), next };
}

// While an answer is still being written, never show the half-written "Next questions:" line.
const visibleWhileStreaming = (t) => String(t || "").replace(/\n?\s*Next questions?:[\s\S]*$/i, "").trim();

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
          <table style={{ borderCollapse: "collapse", fontSize: 14, minWidth: "100%" }}>
            <thead><tr>{cells(head).map((c, j) => <th key={j} style={{ textAlign: "left", padding: "6px 10px", borderBottom: `1px solid ${BRAND.line}`, color: BRAND.brown, whiteSpace: "nowrap" }}>{inline(c, `h${j}`)}</th>)}</tr></thead>
            <tbody>{rest.map((r, ri) => <tr key={ri}>{cells(r).map((c, j) => <td key={j} style={{ padding: "6px 10px", borderBottom: `1px solid ${BRAND.line}`, whiteSpace: "nowrap" }}>{inline(c, `c${ri}-${j}`)}</td>)}</tr>)}</tbody>
          </table>
        </div>);
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*[-*]\s+/, "")); i++; }
      blocks.push(<ul key={blocks.length} style={{ margin: "6px 0", paddingLeft: 20 }}>{items.map((it, j) => <li key={j} style={{ margin: "4px 0" }}>{inline(it, `l${j}`)}</li>)}</ul>);
      continue;
    }
    blocks.push(<p key={blocks.length} style={{ margin: "6px 0", lineHeight: 1.55 }}>{inline(line.replace(/^#+\s*/, ""), `p${blocks.length}`)}</p>);
    i++;
  }
  return <div>{blocks}</div>;
}

const STATUS = [
  [0, "Got your question. Looking up your figures..."],
  [4, "Checking your sales and customers..."],
  [12, "Working out the best answer for you..."],
  [30, "Nearly there. The first question can take a little longer."],
  [60, "Still working. If nothing appears soon, tap Try again."],
];
const statusFor = (secs) => [...STATUS].reverse().find(([s]) => secs >= s)[1];

const tapBtn = { minHeight: 44, textAlign: "left", fontSize: 15, padding: "10px 14px", background: "#fff", border: `1px solid ${BRAND.line}`, borderRadius: 12, cursor: "pointer", color: BRAND.ink, maxWidth: "100%" };

export default function MySales() {
  const [rep, setRep] = useState(undefined);   // undefined = checking, null = signed out
  const [code, setCode] = useState("");
  const [email, setEmail] = useState("");
  const [signErr, setSignErr] = useState("");
  const [signing, setSigning] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [secs, setSecs] = useState(0);
  const [statusText, setStatusText] = useState("");
  const [quota, setQuota] = useState(null);        // { used, limit, remaining } for today
  const [fb, setFb] = useState({});                // feedback state per message: "form" | "sent" | "good"
  const [fbNote, setFbNote] = useState("");
  const loadedFor = useRef(null);   // the rep whose saved conversation has been loaded on this device
  const endRef = useRef(null);

  // Signed in: show the rep, pick up their saved conversation from this device (if under a day old),
  // and quietly start loading their figures so the first answer is quicker.
  const enter = useCallback((who) => {
    let saved = [];
    try {
      const raw = localStorage.getItem(storeKey(who.name));
      if (raw) {
        const o = JSON.parse(raw);
        if (o && Date.now() - o.t < KEEP_FOR_MS && Array.isArray(o.m)) saved = o.m.filter(validMsg);
        else localStorage.removeItem(storeKey(who.name));
      }
    } catch { /* storage unavailable: start fresh */ }
    loadedFor.current = who.name;
    setMessages(saved.filter((m) => !m.streaming));   // an answer that was cut off by a refresh is not kept
    setQuota(who.quota || null);
    setRep(who);
    fetch("/api/my-sales/warm", { method: "POST" }).catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/my-sales/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => (j ? enter(j) : setRep(null)))
      .catch(() => setRep(null));
  }, [enter]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages, busy]);

  // Keep the conversation on this device only, so a refresh (or an accidental close) carries on where the rep was.
  useEffect(() => {
    if (!rep || loadedFor.current !== rep.name) return;
    try {
      if (messages.length) localStorage.setItem(storeKey(rep.name), JSON.stringify({ t: Date.now(), m: messages.slice(-40) }));
      else localStorage.removeItem(storeKey(rep.name));
    } catch { /* storage unavailable: it just will not survive a refresh */ }
  }, [messages, rep]);

  // A running clock while an answer is being worked out, so the progress message can change.
  useEffect(() => {
    if (!busy) return undefined;
    const t0 = Date.now();
    const id = setInterval(() => setSecs(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(id);
  }, [busy]);

  async function signIn(e) {
    e.preventDefault();
    setSigning(true); setSignErr("");
    try {
      const r = await fetch("/api/my-sales/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, code }) });
      const j = await r.json();
      if (!r.ok) { setSignErr(j.error || "Could not sign in."); }
      else {
        setCode(""); setEmail(""); enter({ name: j.name, system: j.system });
        fetch("/api/my-sales/me", { cache: "no-store" }).then((x) => (x.ok ? x.json() : null)).then((m) => { if (m) { setQuota(m.quota || null); setRep((r) => (r ? { ...r, ...m } : r)); } }).catch(() => {});
      }
    } catch { setSignErr("Could not connect. Check your internet and try again."); }
    setSigning(false);
  }

  async function signOut() {
    await fetch("/api/my-sales/logout", { method: "POST" }).catch(() => {});
    try { if (rep) localStorage.removeItem(storeKey(rep.name)); } catch { /* ignore */ }
    loadedFor.current = null; setRep(null); setMessages([]);
  }

  async function run(next) {
    setMessages([...next, { role: "assistant", content: "", streaming: true }]);
    setSecs(0); setStatusText(""); setFb({}); setBusy(true);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 115000);
    const fail = (text) => setMessages([...next, { role: "assistant", content: text, error: true }]);
    try {
      // Only real exchanges go to the server: not the error notes this page added itself.
      const history = next.filter((m) => !m.error).map(({ role, content }) => ({ role, content }));
      const r = await fetch("/api/my-sales/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: history }), signal: ctl.signal });
      if (r.status === 401) { loadedFor.current = null; setRep(null); setSignErr("Your session ended. Please sign in again, and your conversation will still be here."); setMessages(next); }
      else if (!r.ok || !r.body) {
        const j = await r.json().catch(() => ({}));
        if (j.quota) setQuota(j.quota);
        fail(j.error || "Something went wrong.");
      } else {
        const reader = r.body.getReader(); const dec = new TextDecoder();
        let buf = "", acc = "", finished = false;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
            if (!line) continue;
            let ev; try { ev = JSON.parse(line); } catch { continue; }
            if (ev.type === "status") setStatusText(ev.text || "");
            else if (ev.type === "reset") { acc = ""; setMessages([...next, { role: "assistant", content: "", streaming: true }]); }
            else if (ev.type === "delta") { acc += ev.text || ""; setMessages([...next, { role: "assistant", content: acc, streaming: true }]); }
            else if (ev.type === "done") { finished = true; if (ev.quota) setQuota(ev.quota); setMessages([...next, { role: "assistant", content: acc || "Sorry, I could not put an answer together. Tap Try again.", error: !acc }]); }
            else if (ev.type === "error") { finished = true; if (ev.quota) setQuota(ev.quota); fail(ev.message || "Something went wrong."); }
          }
        }
        if (!finished) fail("The answer was cut off. Please tap Try again.");
      }
    } catch (e) {
      const slow = e && e.name === "AbortError";
      fail(slow ? "That took longer than it should. Please tap Try again." : "Could not connect. Check your internet, then tap Try again.");
    }
    clearTimeout(timer);
    setBusy(false);
  }

  async function sendFeedback(idx, kind, note) {
    const answer = messages[idx]; const question = [...messages.slice(0, idx)].reverse().find((m) => m.role === "user");
    setFb((f) => ({ ...f, [idx]: kind === "good" ? "good" : "sent" }));
    try {
      await fetch("/api/my-sales/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, question: question ? question.content : "", answer: splitAnswer(answer.content).body, note }) });
    } catch { /* the thank you still shows; a lost note is not worth worrying a rep */ }
    setFbNote("");
  }

  function ask(text) {
    const q = (text ?? input).trim();
    if (!q || busy) return;
    setInput("");
    run([...messages, { role: "user", content: q }]);
  }

  function tryAgain() {
    if (busy) return;
    const last = messages[messages.length - 1];
    run(last && last.error ? messages.slice(0, -1) : messages);
  }

  function newChat() {
    if (busy) return;
    if (messages.length && !window.confirm("Start a new conversation? This one will be cleared.")) return;
    setMessages([]); setInput("");
  }

  const last = messages[messages.length - 1];
  const streamingNow = busy && last && last.streaming;
  const needsRetry = !busy && last && (last.role === "user" || last.error);
  const noneLeft = quota && quota.remaining <= 0;   // refreshed mid-question, or it failed
  const lastAnswer = !busy && last && last.role === "assistant" && !last.error ? splitAnswer(last.content) : null;
  const followUps = lastAnswer ? (lastAnswer.next.length ? lastAnswer.next : DEFAULT_FOLLOW_UPS) : [];

  const shell = { minHeight: "100dvh", background: BRAND.bg, color: BRAND.ink, fontFamily: "-apple-system, BlinkMacSystemFont, 'DM Sans', 'Segoe UI', sans-serif", display: "flex", flexDirection: "column" };

  if (rep === undefined) return <div style={{ ...shell, alignItems: "center", justifyContent: "center", color: BRAND.muted, fontSize: 16 }}>Loading...</div>;

  if (!rep) {
    return (
      <div style={{ ...shell, alignItems: "center", justifyContent: "center", padding: 16 }}>
        <form onSubmit={signIn} style={{ boxSizing: "border-box", background: "#fff", border: `1px solid ${BRAND.line}`, borderRadius: 16, padding: 28, width: "100%", maxWidth: 400 }}>
          <img src="/logo-black.png" alt="Worthy" style={{ height: 56, width: "auto", display: "block", marginBottom: 14 }} />
          <h1 style={{ fontSize: 22, margin: "0 0 6px", color: BRAND.brown }}>My account</h1>
          <p style={{ fontSize: 16, color: BRAND.muted, margin: "0 0 18px", lineHeight: 1.45 }}>Type your email and password below, then tap Open. Then you can ask about your own and your team's sales and customers.</p>
          {signErr && <div role="alert" style={{ color: BRAND.rust, fontSize: 15, marginBottom: 12, lineHeight: 1.4 }}>{signErr}</div>}
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Your email" autoComplete="username" autoFocus required
            style={{ width: "100%", boxSizing: "border-box", padding: "14px", fontSize: 16, borderRadius: 10, border: `1px solid ${BRAND.line}`, marginBottom: 12 }} />
          <input type="password" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Your password" autoComplete="current-password" required
            style={{ width: "100%", boxSizing: "border-box", padding: "14px", fontSize: 16, borderRadius: 10, border: `1px solid ${BRAND.line}`, marginBottom: 12 }} />
          <button type="submit" disabled={signing || code.trim().length < 10 || !email.includes("@")}
            style={{ width: "100%", minHeight: 48, fontSize: 17, fontWeight: 700, color: "#fff", background: BRAND.rust, border: "none", borderRadius: 10, cursor: "pointer", opacity: signing || code.trim().length < 10 || !email.includes("@") ? 0.6 : 1 }}>
            {signing ? "Checking..." : "Open"}
          </button>
          <p style={{ fontSize: 14, color: BRAND.muted, margin: "14px 0 0", lineHeight: 1.4 }}>Your email and password are on the sheet we gave you. Lost them? Ask Pratham.</p>
        </form>
      </div>
    );
  }

  return (
    <div style={shell}>
      <style>{"@keyframes wslide{0%{transform:translateX(-100%)}100%{transform:translateX(350%)}}"}</style>
      <header style={{ background: "#fff", borderBottom: `1px solid ${BRAND.line}`, padding: "10px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <img src="/logo-black.png" alt="Worthy" style={{ height: 40, width: "auto", display: "block" }} />
          <div style={{ fontWeight: 700, fontSize: 17, color: BRAND.brown }}>My account</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginLeft: "auto" }}>
          <div style={{ fontSize: 13, color: BRAND.muted, textAlign: "right", lineHeight: 1.3 }}>Signed in as<br /><strong style={{ color: BRAND.brown, fontWeight: 600 }}>{rep.name}</strong>{rep.team ? <span> · Team lead</span> : null}</div>
          <button onClick={signOut} style={{ minHeight: 40, fontSize: 14, color: BRAND.rust, background: "none", border: `1px solid ${BRAND.line}`, borderRadius: 8, padding: "7px 12px", cursor: "pointer", whiteSpace: "nowrap" }}>Sign out</button>
        </div>
      </header>

      <main style={{ flex: 1, width: "100%", maxWidth: 760, margin: "0 auto", padding: "16px 16px 8px", boxSizing: "border-box" }}>
        {messages.length > 0 && (
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 4 }}>
            <button onClick={newChat} disabled={busy} style={{ minHeight: 40, fontSize: 14, color: BRAND.brown, background: "#fff", border: `1px solid ${BRAND.line}`, borderRadius: 8, padding: "7px 12px", cursor: "pointer", opacity: busy ? 0.6 : 1 }}>New conversation</button>
          </div>
        )}

        {messages.length === 0 && (
          <div>
            <h2 style={{ fontSize: 22, color: BRAND.brown, margin: "8px 0 6px" }}>Hi {rep.name.split(" ")[0]}, how can I help?</h2>
            <p style={{ fontSize: 16, color: BRAND.muted, margin: "0 0 14px", lineHeight: 1.5 }}>
              {rep.teamMembers && rep.teamMembers.length
                ? <>I am your team helper. I can see {rep.hasOwnSales ? "your own sales and " : ""}the sales, customers and unpaid invoices of your team ({rep.teamMembers.join(", ")}), and nobody else. Ask about the whole team, or about one person by name.</>
                : "I am your sales helper. I can only see your own sales and your own customers, so everything I tell you is about you."}
            </p>
            <ol style={{ fontSize: 16, lineHeight: 1.6, margin: "0 0 16px", paddingLeft: 22 }}>
              <li><strong>Tap a question</strong> below, or type your own at the bottom and tap Ask.</li>
              <li><strong>Wait a few seconds</strong> while I look up your figures.</li>
              <li><strong>Tap one of the next questions</strong> I suggest, to go deeper.</li>
            </ol>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {(rep.suggestions && rep.suggestions.length ? rep.suggestions : SUGGESTIONS).map((s) => <button key={s} onClick={() => ask(s)} style={tapBtn}>{s}</button>)}
            </div>
          </div>
        )}

        {messages.map((m, i) => {
          const isUser = m.role === "user";
          if (m.streaming && !m.content) return null;   // nothing written yet: the progress panel below shows instead
          const text = isUser || m.error ? m.content : (m.streaming ? visibleWhileStreaming(m.content) : splitAnswer(m.content).body);
          const finishedAnswer = !isUser && !m.error && !m.streaming;
          const btn = { minHeight: 40, fontSize: 14, background: "none", border: `1px solid ${BRAND.line}`, borderRadius: 8, padding: "6px 12px", cursor: "pointer" };
          return (
            <div key={i} style={{ margin: "10px 0" }}>
              <div style={{ display: "flex", justifyContent: isUser ? "flex-end" : "flex-start" }}>
                <div style={{ maxWidth: "92%", minWidth: 0, overflowWrap: "anywhere", padding: "11px 15px", borderRadius: 14, fontSize: 16, lineHeight: 1.5, background: isUser ? BRAND.rust : "#fff", color: isUser ? "#fff" : (m.error ? BRAND.rust : BRAND.ink), border: isUser ? "none" : `1px solid ${BRAND.line}` }}>
                  {isUser ? text : <Answer text={text} />}
                </div>
              </div>
              {finishedAnswer && (
                <div style={{ marginTop: 6, fontSize: 14, color: BRAND.muted }}>
                  {fb[i] === "sent" ? "Thank you. We will check it." : fb[i] === "good" ? "Thank you." : fb[i] === "form" ? (
                    <div style={{ background: "#fff", border: `1px solid ${BRAND.line}`, borderRadius: 12, padding: 12, maxWidth: 420 }}>
                      <div style={{ marginBottom: 6, color: BRAND.ink }}>What looks wrong? (You can leave this blank.)</div>
                      <textarea value={fbNote} onChange={(e) => setFbNote(e.target.value)} rows={3} maxLength={400} style={{ width: "100%", boxSizing: "border-box", fontSize: 16, padding: 8, borderRadius: 8, border: `1px solid ${BRAND.line}` }} />
                      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                        <button onClick={() => sendFeedback(i, "wrong", fbNote)} style={{ minHeight: 44, padding: "0 16px", fontSize: 15, fontWeight: 700, color: "#fff", background: BRAND.rust, border: "none", borderRadius: 10, cursor: "pointer" }}>Send</button>
                        <button onClick={() => setFb((f) => ({ ...f, [i]: undefined }))} style={{ minHeight: 44, padding: "0 16px", fontSize: 15, color: BRAND.ink, background: "#fff", border: `1px solid ${BRAND.line}`, borderRadius: 10, cursor: "pointer" }}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <span>
                      <button onClick={() => sendFeedback(i, "good", "")} style={{ ...btn, color: BRAND.brown, marginRight: 8 }}>Helpful</button>
                      <button onClick={() => { setFbNote(""); setFb((f) => ({ ...f, [i]: "form" })); }} style={{ ...btn, color: BRAND.rust }}>This looks wrong</button>
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {busy && !(streamingNow && last.content) && (
          <div style={{ margin: "12px 0", padding: "14px 16px", background: "#fff", border: `1px solid ${BRAND.line}`, borderRadius: 14 }}>
            <div style={{ fontSize: 16, color: BRAND.ink, marginBottom: 10 }}>{statusText || statusFor(secs)}</div>
            <div style={{ height: 6, background: "#F1ECE6", borderRadius: 3, overflow: "hidden" }}>
              <div style={{ height: "100%", width: "30%", background: BRAND.gold, borderRadius: 3, animation: "wslide 1.6s ease-in-out infinite" }} />
            </div>
            <div style={{ fontSize: 14, color: BRAND.muted, marginTop: 8 }}>Most answers take 10 to 40 seconds. You do not need to do anything.</div>
          </div>
        )}

        {needsRetry && (
          <div style={{ margin: "12px 0", padding: "12px 14px", background: "#fff", border: `1px solid ${BRAND.line}`, borderRadius: 12, fontSize: 16, lineHeight: 1.45 }}>
            {last.error ? null : <div>Your last question did not finish.</div>}
            <button onClick={tryAgain} style={{ minHeight: 44, marginTop: last.error ? 0 : 6, display: "block", color: "#fff", background: BRAND.rust, border: "none", borderRadius: 10, padding: "10px 18px", fontSize: 16, fontWeight: 700, cursor: "pointer" }}>Try again</button>
          </div>
        )}

        {followUps.length > 0 && (
          <div style={{ margin: "12px 0" }}>
            <div style={{ fontSize: 14, color: BRAND.muted, marginBottom: 8 }}>Tap to ask next:</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {followUps.map((q) => <button key={q} onClick={() => ask(q)} style={tapBtn}>{q}</button>)}
            </div>
          </div>
        )}
        <div ref={endRef} />
      </main>

      <form onSubmit={(e) => { e.preventDefault(); ask(); }} style={{ position: "sticky", bottom: 0, background: BRAND.bg, borderTop: `1px solid ${BRAND.line}`, padding: "10px 16px calc(10px + env(safe-area-inset-bottom))" }}>
        <div style={{ display: "flex", gap: 8, maxWidth: 760, margin: "0 auto" }}>
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={noneLeft ? "No questions left today" : "Type your question here"} maxLength={2000} aria-label="Your question" disabled={noneLeft}
            style={{ flex: 1, minWidth: 0, minHeight: 48, padding: "0 14px", fontSize: 16, borderRadius: 12, border: `1px solid ${BRAND.line}`, background: "#fff" }} />
          <button type="submit" disabled={busy || !input.trim() || noneLeft}
            style={{ flexShrink: 0, minHeight: 48, padding: "0 22px", fontSize: 16, fontWeight: 700, color: "#fff", background: BRAND.rust, border: "none", borderRadius: 12, cursor: "pointer", opacity: busy || !input.trim() ? 0.6 : 1 }}>Ask</button>
        </div>
        <div style={{ maxWidth: 760, margin: "6px auto 0", fontSize: 13, color: noneLeft ? BRAND.rust : (quota && quota.remaining <= 5 ? "#B26A00" : BRAND.muted), display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <span>{quota ? (noneLeft ? `You have used all of today's questions. You get ${quota.limit} more tomorrow.` : `Questions left today: ${quota.remaining}${quota.carried ? ` (${quota.limit} a day + ${quota.carried} saved from earlier days)` : ` of ${quota.limit}`}`) : ""}</span>
          <span>Your questions are saved so we can improve this.</span>
        </div>
      </form>
    </div>
  );
}
