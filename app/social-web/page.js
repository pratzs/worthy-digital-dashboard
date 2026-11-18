"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const C = { brown: "#66270F", gold: "#FDB714", orange: "#F58220", rust: "#B13924", green: "#2f7a3d", line: "#E4E0DA", bg: "#FAF8F5", muted: "#7A7168", text: "#2B2420" };
const card = { background: "#fff", border: `1px solid ${C.line}`, borderRadius: 14, padding: 18, marginBottom: 18 };
const th = { textAlign: "left", padding: "8px 10px", borderBottom: `1px solid ${C.line}`, color: C.brown, fontSize: 12, whiteSpace: "nowrap" };
const thR = { ...th, textAlign: "right" };
const td = { padding: "8px 10px", borderBottom: `1px solid ${C.line}`, fontSize: 13, verticalAlign: "top" };
const tdR = { ...td, textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" };
const h2 = { fontSize: 18, color: C.brown, margin: "28px 0 12px" };
const h3 = { fontSize: 14, color: C.brown, margin: "0 0 8px" };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ""); return m ? `${Number(m[3])} ${MONTHS[m[2] - 1]} ${m[1]}` : ""; };
const mon = (ym) => { const m = /^(\d{4})-(\d{2})/.exec(ym || ""); return m ? `${MONTHS[m[2] - 1]} ${m[1].slice(2)}` : ym; };
const n0 = (v) => (v === null || v === undefined ? "-" : Math.round(v).toLocaleString("en-NZ"));
const money = (v) => (v === null || v === undefined ? "-" : `$${Math.round(v).toLocaleString("en-NZ")}`);
const pct = (v) => (v === null || v === undefined ? "-" : `${(v * 100).toFixed(1)}%`);

const Range = ({ text }) => !text ? null : (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 999, color: C.muted, border: `1px solid ${C.line}`, maxWidth: "100%", lineHeight: 1.4 }}>
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>
    {text}
  </span>
);

function Change({ now, before }) {
  if (now === null || now === undefined || !before) return null;
  const d = (now - before) / before;
  if (!Number.isFinite(d)) return null;
  const up = d >= 0;
  return (
    <span style={{ fontSize: 11, fontWeight: 700, color: up ? C.green : C.rust, whiteSpace: "nowrap" }}>
      <svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={{ marginRight: 3 }}>{up ? <path d="M12 4l9 16H3z" /> : <path d="M12 20 3 4h18z" />}</svg>
      {Math.abs(d * 100).toFixed(1)}%
    </span>
  );
}

function Tile({ label, pair, fmt = n0 }) {
  if (!pair) return null;
  return (
    <div style={{ minWidth: 130 }}>
      <div style={{ fontSize: 12, color: C.muted }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: C.brown, lineHeight: 1.3 }}>{fmt(pair[0])}</div>
      <div style={{ display: "flex", gap: 6, alignItems: "baseline", fontSize: 11, color: C.muted }}>
        <Change now={pair[0]} before={pair[1]} /><span>was {fmt(pair[1])}</span>
      </div>
    </div>
  );
}

function Bars({ rows, value, label }) {
  if (!rows?.length) return null;
  const max = Math.max(1, ...rows.map((r) => r[value] || 0));
  return (
    <div>
      <div style={h3}>{label}</div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 120, paddingTop: 16 }}>
        {rows.map((r) => (
          <div key={r.month} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, minWidth: 0 }} title={`${mon(r.month)}: ${n0(r[value])}`}>
            <div style={{ fontSize: 9, color: C.muted, whiteSpace: "nowrap" }}>{(r[value] || 0) >= 1000 ? `${((r[value] || 0) / 1000).toFixed(1)}k` : n0(r[value])}</div>
            <div style={{ width: "100%", maxWidth: 34, height: `${Math.max(2, ((r[value] || 0) / max) * 80)}px`, background: C.orange, borderRadius: "4px 4px 0 0" }} />
            <div style={{ fontSize: 10, color: C.muted, whiteSpace: "nowrap" }}>{mon(r.month).slice(0, 3)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Table({ title, cols, rows }) {
  if (!rows?.length) return null;
  return (
    <div style={{ minWidth: 0, overflowX: "auto" }}>
      <div style={h3}>{title}</div>
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead><tr>{cols.map((c, i) => <th key={c[0]} style={i ? thR : th}>{c[0]}</th>)}</tr></thead>
        <tbody>{rows.map((r, j) => <tr key={j}>{cols.map((c, i) => <td key={c[0]} style={i ? tdR : { ...td, maxWidth: 280, wordBreak: "break-word" }}>{c[1](r)}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

const Status = ({ text }) => <div style={{ color: C.muted, fontSize: 14 }}>{text}</div>;
const grid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 22, marginTop: 18 };

function Site({ s, range }) {
  const head = (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
      <a href={`https://${s.name}`} target="_blank" rel="noreferrer" style={{ fontSize: 17, fontWeight: 700, color: C.brown, textDecoration: "none" }}>{s.name}</a>
      <span style={{ fontSize: 11, color: C.muted, border: `1px solid ${C.line}`, borderRadius: 999, padding: "2px 8px" }}>{s.source === "shopify" ? "Shopify" : "Google Analytics"}</span>
      <Range text={range} />
    </div>
  );
  if (s.status !== "ok") {
    const msg = s.status === "not_connected" ? "Not connected yet" : s.status === "no_property" ? "Waiting for its Google Analytics property" : `Could not load: ${s.error || "error"}`;
    return <div style={card}>{head}<Status text={msg} /></div>;
  }
  const t = s.totals;
  return (
    <div style={card}>
      {head}
      <div style={{ display: "flex", gap: 28, flexWrap: "wrap" }}>
        {s.source === "shopify" ? (<>
          <Tile label="NZ sessions" pair={t.sessions} />
          <Tile label="NZ conversion rate" pair={t.conversion} fmt={pct} />
          <Tile label="Online orders" pair={t.orders} />
          <Tile label="Online net sales" pair={t.revenue} fmt={money} />
        </>) : (<>
          <Tile label="Visitors" pair={t.visitors} />
          <Tile label="New visitors" pair={t.newVisitors} />
          <Tile label="Sessions" pair={t.sessions} />
          <Tile label="Engaged sessions" pair={t.engagedRate} fmt={pct} />
          <Tile label="Page views" pair={t.pageViews} />
          <Tile label="Key events" pair={t.keyEvents} />
          <Tile label="Orders" pair={t.orders} />
          <Tile label="Revenue" pair={t.revenue} fmt={money} />
        </>)}
      </div>
      <div style={grid}>
        <Table title={s.source === "shopify" ? "Where NZ visitors came from" : "Where visitors came from"} cols={[["Source", (r) => r.name], ["Sessions", (r) => n0(r.sessions)], ...(s.source === "ga4" ? [["Key events", (r) => n0(r.keyEvents)]] : [])]} rows={s.sources} />
        {s.pages && <Table title="Most viewed pages" cols={[["Page", (r) => r.name], ["Views", (r) => n0(r.views)], ["Visitors", (r) => n0(r.visitors)]]} rows={s.pages} />}
        {s.channels && <Table title="Sales by channel" cols={[["Channel", (r) => r.name], ["Orders", (r) => n0(r.orders)], ["Net sales", (r) => money(r.revenue)]]} rows={s.channels} />}
        <Table title="Device" cols={[["Device", (r) => r.name], ["Sessions", (r) => n0(r.sessions)]]} rows={s.devices} />
      </div>
      <div style={{ ...grid, marginTop: 22 }}>
        <Bars rows={s.months} value={s.source === "shopify" ? "sessions" : "visitors"} label={s.source === "shopify" ? "NZ sessions by month" : "Visitors by month"} />
        {s.source === "shopify" && <Bars rows={s.months} value="revenue" label="Online net sales by month" />}
      </div>
    </div>
  );
}

const SOCIAL_COLS = [["views", "Views"], ["reach", "Reach"], ["engagements", "Engagements"], ["profileViews", "Profile visits"], ["newFollows", "New followers"]];

function Social({ meta, range }) {
  if (meta.status !== "ok") {
    return <div style={card}><div style={h3}>Facebook and Instagram</div><Status text={meta.status === "not_connected" ? "Not connected yet" : `Could not load: ${meta.error}`} /></div>;
  }
  const cell = (pair) => pair ? <><div>{n0(pair[0])}</div><Change now={pair[0]} before={pair[1]} /></> : "-";
  return (<>
    <div style={{ ...card, overflowX: "auto" }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}><div style={{ ...h3, margin: 0 }}>Facebook and Instagram</div><Range text={range} /></div>
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead><tr><th style={th}>Account</th><th style={thR}>Followers</th>{SOCIAL_COLS.map(([, l]) => <th key={l} style={thR}>{l}</th>)}</tr></thead>
        <tbody>{meta.accounts.map((a) => (
          <tr key={a.platform + a.name}>
            <td style={td}><a href={a.link} target="_blank" rel="noreferrer" style={{ color: C.text, fontWeight: 600, textDecoration: "none" }}>{a.name}</a><div style={{ color: C.muted, fontSize: 12 }}>{a.platform}</div></td>
            <td style={tdR}>{n0(a.followers)}</td>
            {SOCIAL_COLS.map(([k]) => <td key={k} style={tdR}>{cell(a.totals?.[k])}</td>)}
          </tr>
        ))}</tbody>
      </table>
    </div>
    <div style={grid}>
      {meta.accounts.filter((a) => a.posts?.length).map((a) => (
        <div key={a.platform + a.name} style={{ ...card, marginBottom: 0 }}>
          <div style={h3}>Latest posts, {a.name} ({a.platform})</div>
          {a.posts.map((p, i) => (
            <a key={i} href={p.link} target="_blank" rel="noreferrer" style={{ display: "block", padding: "8px 0", borderTop: i ? `1px solid ${C.line}` : "none", textDecoration: "none", color: C.text }}>
              <div style={{ fontSize: 11, color: C.muted }}>{day(p.when)}</div>
              <div style={{ fontSize: 13, margin: "2px 0" }}>{p.text || "(no caption)"}</div>
              <div style={{ fontSize: 12, color: C.brown }}>{n0(p.reactions)} likes, {n0(p.comments)} comments{p.shares !== null ? `, ${n0(p.shares)} shares` : ""}</div>
            </a>
          ))}
        </div>
      ))}
    </div>
  </>);
}

function Manual({ manual, onSaved }) {
  const thisMonth = new Date().toLocaleDateString("en-CA", { timeZone: "Pacific/Auckland" }).slice(0, 7);
  const [form, setForm] = useState({ account: manual.accounts[0]?.id, month: thisMonth, values: {} });
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const months = [...new Set(Object.values(manual.values || {}).flatMap((m) => Object.keys(m)))].sort().reverse().slice(0, 6);
  const pick = (account, month) => setForm({ account, month, values: { ...((manual.values?.[account] || {})[month] || {}) } });
  const save = async () => {
    setBusy(true); setMsg("");
    try {
      const r = await fetch("/api/social-web/manual", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || r.status);
      setMsg("Saved"); onSaved(j.values);
    } catch (e) { setMsg(`Not saved: ${e.message}`); } finally { setBusy(false); }
  };
  const input = { padding: "7px 9px", border: `1px solid ${C.line}`, borderRadius: 8, fontSize: 13, width: "100%", boxSizing: "border-box", marginTop: 4, background: "#fff" };
  return (
    <div style={{ ...card, overflowX: "auto" }}>
      <div style={h3}>LinkedIn and TikTok</div>
      {months.length ? (
        <table style={{ borderCollapse: "collapse", width: "100%", marginBottom: 18 }}>
          <thead><tr><th style={th}>Account</th><th style={th}>Month</th>{manual.fields.map((f) => <th key={f.id} style={thR}>{f.label}</th>)}</tr></thead>
          <tbody>{manual.accounts.flatMap((a) => months.filter((m) => manual.values?.[a.id]?.[m]).map((m) => (
            <tr key={a.id + m} onClick={() => pick(a.id, m)} style={{ cursor: "pointer" }}>
              <td style={td}><span style={{ fontWeight: 600 }}>{a.name}</span><div style={{ color: C.muted, fontSize: 12 }}>{a.platform}</div></td>
              <td style={td}>{mon(m)}</td>
              {manual.fields.map((f) => <td key={f.id} style={tdR}>{n0(manual.values[a.id][m][f.id])}</td>)}
            </tr>
          )))}</tbody>
        </table>
      ) : <div style={{ color: C.muted, fontSize: 14, marginBottom: 14 }}>No figures entered yet.</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, alignItems: "end" }}>
        <label style={{ fontSize: 12, color: C.muted }}>Account
          <select style={input} value={form.account} onChange={(e) => pick(e.target.value, form.month)}>
            {manual.accounts.map((a) => <option key={a.id} value={a.id}>{a.platform}: {a.name}</option>)}
          </select>
        </label>
        <label style={{ fontSize: 12, color: C.muted }}>Month
          <input type="month" style={input} value={form.month} onChange={(e) => pick(form.account, e.target.value)} />
        </label>
        {manual.fields.map((f) => (
          <label key={f.id} style={{ fontSize: 12, color: C.muted }}>{f.label}
            <input inputMode="numeric" style={input} value={form.values[f.id] ?? ""} onChange={(e) => setForm({ ...form, values: { ...form.values, [f.id]: e.target.value } })} />
          </label>
        ))}
        <button onClick={save} disabled={busy} style={{ padding: "9px 14px", borderRadius: 9, border: "none", background: C.brown, color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>{busy ? "Saving..." : "Save"}</button>
      </div>
      {msg && <div style={{ marginTop: 8, fontSize: 13, color: msg === "Saved" ? C.green : C.rust }}>{msg}</div>}
    </div>
  );
}

export default function SocialWeb() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  const fetchData = (fresh) => fetch(`/api/social-web${fresh ? "?fresh=1" : ""}`, { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : Promise.reject(r.status))).then(setD).catch((e) => setErr(String(e))).finally(() => setLoading(false));
  const load = (fresh) => { setLoading(true); setErr(""); fetchData(fresh); };
  useEffect(() => { fetchData(false); }, []);
  const p = d?.web?.periods;
  const range = p ? `${day(p.start)} to ${day(p.end)}, against ${day(p.prevStart)} to ${day(p.prevEnd)}` : "";
  return (
    <div style={{ background: C.bg, minHeight: "100dvh", padding: "20px 16px", color: C.text, fontFamily: "-apple-system, BlinkMacSystemFont, 'DM Sans', 'Segoe UI', sans-serif" }}>
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 4 }}>
          <Link href="/" style={{ fontSize: 13, color: C.muted, textDecoration: "none" }}>Dashboard</Link>
          <span style={{ color: C.line }}>/</span>
          <h1 style={{ color: C.brown, fontSize: 24, margin: 0 }}>Social and Web</h1>
          <span style={{ flex: 1 }} />
          <button onClick={() => load(true)} disabled={loading} style={{ padding: "7px 14px", borderRadius: 9, border: `1px solid ${C.line}`, background: "#fff", color: C.brown, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>{loading ? "Loading..." : "Refresh"}</button>
        </div>
        {err && <div style={{ color: C.rust, margin: "12px 0" }}>Could not load: {err}</div>}
        {!d && !err && <div style={{ color: C.muted, marginTop: 16 }}>Loading...</div>}
        {d && (<>
          <h2 style={h2}>Websites</h2>
          {d.web.sites.map((s) => <Site key={s.id} s={s} range={range} />)}
          <h2 style={h2}>Social media</h2>
          <Social meta={d.meta} range={range} />
          <div style={{ height: 18 }} />
          <Manual manual={d.manual} onSaved={(values) => setD({ ...d, manual: { ...d.manual, values } })} />
        </>)}
      </div>
    </div>
  );
}
