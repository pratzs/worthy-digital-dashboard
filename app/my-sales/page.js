"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/app/design/icons";
import css from "./my-sales.module.css";

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
        <div key={blocks.length} className={css.ansTable}>
          <table>
            <thead><tr>{cells(head).map((c, j) => <th key={j}>{inline(c, `h${j}`)}</th>)}</tr></thead>
            <tbody>{rest.map((r, ri) => <tr key={ri}>{cells(r).map((c, j) => <td key={j}>{inline(c, `c${ri}-${j}`)}</td>)}</tr>)}</tbody>
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

  if (rep === undefined) return <div className={`${css.shell} ${css.center}`}><div className={css.loading}>Loading...</div></div>;

  if (!rep) {
    return (
      <div className={`${css.shell} ${css.center}`}>
        <form onSubmit={signIn} className={`${css.card} ${css.signIn}`}>
          <img src="/logo-black.png" alt="Worthy" className={css.signLogo} />
          <h1 className={css.h1}><span className={css.chip}><Icon n="user" size={17} /></span>My account</h1>
          <p className={css.lead}>Type your email and password below, then tap Open. Then you can ask about your own and your team&apos;s sales and customers.</p>
          {signErr && <div role="alert" className={css.alert}><Icon n="alert" size={16} />{signErr}</div>}
          <div className={css.field}>
            <Icon n="mail" size={17} />
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Your email" autoComplete="username" autoFocus required className={css.input} />
          </div>
          <div className={css.field}>
            <Icon n="users" size={17} />
            <input type="password" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Your password" autoComplete="current-password" required className={css.input} />
          </div>
          <button type="submit" disabled={signing || code.trim().length < 10 || !email.includes("@")} className={`${css.primary} ${css.wide}`}>
            {signing ? "Checking..." : "Open"}
          </button>
          <p className={css.small}>Your email and password are on the sheet we gave you. Lost them? Ask Pratham.</p>
        </form>
      </div>
    );
  }

  const fewLeft = quota && quota.remaining <= 5;

  return (
    <div className={css.shell}>
      <header className={css.top}>
        <div className={css.brand}>
          <img src="/logo-black.png" alt="Worthy" className={css.logo} />
          <div className={css.brandName}><Icon n="user" size={16} />My account</div>
        </div>
        <div className={css.me}>
          <div className={css.meText}>Signed in as<br /><strong>{rep.name}</strong>{rep.team ? <span> · Team lead</span> : null}</div>
          <button onClick={signOut} className={css.ghost}><Icon n="out" size={14} />Sign out</button>
        </div>
      </header>

      <main className={css.main}>
        {messages.length > 0 && (
          <div className={css.newRow}>
            <button onClick={newChat} disabled={busy} className={css.ghost}><Icon n="plus" size={14} />New conversation</button>
          </div>
        )}

        {messages.length === 0 && (
          <div className={`${css.card} ${css.welcome}`}>
            <h2 className={css.h2}><span className={css.chip}><Icon n="sparkle" size={17} /></span>Hi {rep.name.split(" ")[0]}, how can I help?</h2>
            <p className={css.lead}>
              {rep.teamMembers && rep.teamMembers.length
                ? <>I am your team helper. I can see {rep.hasOwnSales ? "your own sales and " : ""}the sales, customers and unpaid invoices of your team ({rep.teamMembers.join(", ")}), and nobody else. Ask about the whole team, or about one person by name.</>
                : "I am your sales helper. I can only see your own sales and your own customers, so everything I tell you is about you."}
            </p>
            <ol className={css.steps}>
              <li><span className={css.stepNum}>1</span><span><strong>Tap a question</strong> below, or type your own at the bottom and tap Ask.</span></li>
              <li><span className={css.stepNum}>2</span><span><strong>Wait a few seconds</strong> while I look up your figures.</span></li>
              <li><span className={css.stepNum}>3</span><span><strong>Tap one of the next questions</strong> I suggest, to go deeper.</span></li>
            </ol>
            <div className={css.taps}>
              {(rep.suggestions && rep.suggestions.length ? rep.suggestions : SUGGESTIONS).map((s) => <button key={s} onClick={() => ask(s)} className={css.tap}><Icon n="search" size={15} />{s}</button>)}
            </div>
          </div>
        )}

        {messages.map((m, i) => {
          const isUser = m.role === "user";
          if (m.streaming && !m.content) return null;   // nothing written yet: the progress panel below shows instead
          const text = isUser || m.error ? m.content : (m.streaming ? visibleWhileStreaming(m.content) : splitAnswer(m.content).body);
          const finishedAnswer = !isUser && !m.error && !m.streaming;
          return (
            <div key={i} className={css.msg}>
              <div className={`${css.row} ${isUser ? css.rowUser : ""}`}>
                <div className={`${css.bubble} ${isUser ? css.bubbleUser : css.bubbleBot} ${!isUser && m.error ? css.bubbleErr : ""}`}>
                  {isUser ? text : <Answer text={text} />}
                </div>
              </div>
              {finishedAnswer && (
                <div className={css.fb}>
                  {fb[i] === "sent" ? <span className={css.fbDone}><Icon n="check" size={14} />Thank you. We will check it.</span> : fb[i] === "good" ? <span className={css.fbDone}><Icon n="check" size={14} />Thank you.</span> : fb[i] === "form" ? (
                    <div className={`${css.card} ${css.fbForm}`}>
                      <div className={css.fbAsk}>What looks wrong? (You can leave this blank.)</div>
                      <textarea value={fbNote} onChange={(e) => setFbNote(e.target.value)} rows={3} maxLength={400} className={css.textarea} />
                      <div className={css.fbActions}>
                        <button onClick={() => sendFeedback(i, "wrong", fbNote)} className={css.primary}>Send</button>
                        <button onClick={() => setFb((f) => ({ ...f, [i]: undefined }))} className={css.ghost}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <span className={css.fbBtns}>
                      <button onClick={() => sendFeedback(i, "good", "")} className={css.ghost}><Icon n="heart" size={14} />Helpful</button>
                      <button onClick={() => { setFbNote(""); setFb((f) => ({ ...f, [i]: "form" })); }} className={css.ghost}><Icon n="alert" size={14} />This looks wrong</button>
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {busy && !(streamingNow && last.content) && (
          <div className={`${css.card} ${css.progress}`}>
            <div className={css.progressHead}><span className={css.chip}><Icon n="hourglass" size={16} /></span>{statusText || statusFor(secs)}</div>
            <div className={css.track}><i /></div>
            <div className={css.progressFoot}>Most answers take 10 to 40 seconds. You do not need to do anything.</div>
          </div>
        )}

        {needsRetry && (
          <div className={`${css.card} ${css.retry}`}>
            {last.error ? null : <div>Your last question did not finish.</div>}
            <button onClick={tryAgain} className={css.primary}><Icon n="refresh" size={16} />Try again</button>
          </div>
        )}

        {followUps.length > 0 && (
          <div className={css.next}>
            <div className={css.nextHead}><Icon n="compass" size={13} />Tap to ask next:</div>
            <div className={css.taps}>
              {followUps.map((q) => <button key={q} onClick={() => ask(q)} className={css.tap}><Icon n="search" size={15} />{q}</button>)}
            </div>
          </div>
        )}
        <div ref={endRef} />
      </main>

      <form onSubmit={(e) => { e.preventDefault(); ask(); }} className={css.askBar}>
        <div className={css.askRow}>
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={noneLeft ? "No questions left today" : "Type your question here"} maxLength={2000} aria-label="Your question" disabled={noneLeft}
            className={css.askInput} />
          <button type="submit" disabled={busy || !input.trim() || noneLeft} className={css.primary}>Ask</button>
        </div>
        <div className={css.meta}>
          <span className={`${css.left} ${fewLeft ? css.leftWarn : ""}`}>
            {quota && !quota.carried && quota.limit > 0 && <span className={css.leftBar} aria-hidden="true"><i style={{ width: `${Math.max(0, Math.min(1, quota.remaining / quota.limit)) * 100}%` }} /></span>}
            <span>{quota ? (noneLeft ? `You have used all of today's questions. You get ${quota.limit} more tomorrow.` : `Questions left today: ${quota.remaining}${quota.carried ? ` (${quota.limit} a day + ${quota.carried} saved from earlier days)` : ` of ${quota.limit}`}`) : ""}</span>
          </span>
          <span className={css.saved}><Icon n="folder" size={13} />Your questions are saved so we can improve this.</span>
        </div>
      </form>
    </div>
  );
}
