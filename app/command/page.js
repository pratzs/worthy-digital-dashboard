"use client";

/**
 * Worthy Command Center (management only). Search rankings, indexing, traffic against sales, live visitors and the
 * team's own pipeline, outreach, listings and Thursday meeting actions, for worthy.nz, worthyproducts.nz and
 * dutchrusk.co.nz. Data: app/api/command (lib/command.js).
 */
import SiteNav from "@/app/design/SiteNav";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import s from "./command.module.css";
import { Icon } from "../design/icons";
import { Win } from "@/app/design/ui";

// ── constants ───────────────────────────────────────────────────────────────────────────────────────
const SITES = [
  { id: "worthy", name: "worthy.nz", short: "Worthy", url: "https://worthy.nz", gsc: "sc-domain:worthy.nz", ga: "459697422" },
  { id: "worthyproducts", name: "worthyproducts.nz", short: "Worthy Products", url: "https://worthyproducts.nz", gsc: "sc-domain:worthyproducts.nz", ga: "390549744" },
  { id: "dutchrusk", name: "dutchrusk.co.nz", short: "Dutch Rusk", url: "https://dutchrusk.co.nz", gsc: "https://dutchrusk.co.nz/", ga: "554865794" },
];
const siteName = (id) => SITES.find((x) => x.id === id)?.name || (id === "all" ? "All sites" : id || "");

const KINDS = {
  pipeline: { label: "Pipeline", one: "Pipeline item", statuses: ["next", "in progress", "done"], title: "Task",
    fields: ["title", "site", "area", "status", "owner", "due", "link", "notes"] },
  outreach: { label: "Outreach", one: "Outreach contact", statuses: ["prospect", "contacted", "replied", "won", "lost"], title: "Website",
    fields: ["title", "contact", "site", "status", "owner", "due", "link", "notes"] },
  listing: { label: "Listings", one: "Listing", statuses: ["to submit", "submitted", "live", "needs fixing"], title: "Listing",
    fields: ["title", "site", "status", "link", "notes"] },
  meeting: { label: "Meeting", one: "Action point", statuses: ["open", "done"], title: "Action point",
    fields: ["title", "owner", "site", "due", "status", "notes"] },
  authority: { label: "Authority", one: "Authority score", statuses: ["recorded"], title: "Measure",
    fields: ["title", "site", "score", "month", "link", "notes"] },
  spend: { label: "Spend", one: "Marketing spend", statuses: ["recorded"], title: "Channel",
    fields: ["title", "site", "amount", "month", "notes"] },
};
// What the listing statuses mean, in plain words
const STATUS_WORDS = { listing: { "to submit": "To add", submitted: "Waiting on site", live: "Correct", "needs fixing": "Wrong details" } };
const stLabel = (kind, st) => STATUS_WORDS[kind]?.[st] || cap(st);
const FIELD_LABEL = { site: "Site", area: "Area", status: "Status", owner: "Owner", due: "Due", link: "Link", notes: "Notes",
  contact: "Contact", score: "Score", amount: "Amount (NZ$)", month: "Month" };

const TABS = [
  { id: "dashboard", label: "Dashboard", icon: "grid" },
  { id: "search", label: "Search", icon: "search" },
  { id: "social", label: "Social & Web", icon: "megaphone" },
  { id: "outreach", label: "Outreach", icon: "mail" },
  { id: "listings", label: "Listings", icon: "pin" },
  { id: "pipeline", label: "Pipeline", icon: "flow" },
  { id: "meeting", label: "Ecom x Marketing", icon: "calendar" },
];

// ── formatting ──────────────────────────────────────────────────────────────────────────────────────
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const d0 = (iso) => new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
const isoOf = (d) => d.toISOString().slice(0, 10);
const addDays = (iso, n) => isoOf(new Date(d0(iso).getTime() + n * 86400000));
const dShort = (iso) => { if (!iso) return ""; const d = d0(iso); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };
const dLong = (iso) => { if (!iso) return ""; const d = d0(iso); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
const monthLabel = (ym) => { const [y, m] = String(ym).split("-"); return `${MONTHS[Number(m) - 1]} ${String(y).slice(2)}`; };
const n0 = (v) => (v === null || v === undefined || Number.isNaN(v) ? "-" : Math.round(v).toLocaleString("en-NZ"));
const n1 = (v) => (v === null || v === undefined || Number.isNaN(v) ? "-" : (Math.round(v * 10) / 10).toLocaleString("en-NZ", { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
const money = (v) => (v === null || v === undefined ? "-" : `$${Math.round(v).toLocaleString("en-NZ")}`);
const moneyShort = (v) => {
  if (v === null || v === undefined) return "-";
  const a = Math.abs(v);
  if (a >= 1e6) return `$${(v / 1e6).toFixed(2)}m`;
  if (a >= 1e4) return `$${(v / 1e3).toFixed(1)}k`;
  return `$${Math.round(v).toLocaleString("en-NZ")}`;
};
const pct = (v, dp = 1) => (v === null || v === undefined || !Number.isFinite(v) ? "-" : `${(v * 100).toFixed(dp)}%`);
const ago = (iso, now) => {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return dShort(new Date(iso).toISOString());
};
const nzNow = () => new Date(new Date().toLocaleString("en-US", { timeZone: "Pacific/Auckland" }));
const nzTodayIso = () => { const d = nzNow(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const nzTime = (iso) => new Date(iso).toLocaleTimeString("en-NZ", { timeZone: "Pacific/Auckland", hour: "numeric", minute: "2-digit" });
const cap = (t) => String(t || "").charAt(0).toUpperCase() + String(t || "").slice(1);

// ── browser cache ───────────────────────────────────────────────────────────────────────────────────
/* What the page keeps in this browser, so a refresh never loses anything:
     cc-view-v1      the view (tab, dates, site, chart mode, feed filter), until changed
     cc-data-v1      the last Command Center data, shown at once on reload (up to 24 h old) while fresh figures load
     cc-social-v1:*  Social & Web figures per date range, reused for 30 minutes (the server's own cache time)
     cc-draft-v1     an editor that was open with unsaved text, reopened after a refresh
   Saved work (tasks, outreach, listings, Asana, ClickUp) lives on the server, never only here. */
const HOUR = 3600000;
const cache = {
  entry(k, maxAge) {
    try { const v = JSON.parse(localStorage.getItem(k) || "null"); if (!v || (maxAge && Date.now() - v.at > maxAge)) return null; return v; } catch { return null; }
  },
  get(k, maxAge) { return this.entry(k, maxAge)?.data ?? null; },
  set(k, data) { try { localStorage.setItem(k, JSON.stringify({ at: Date.now(), data })); } catch { /* storage full or blocked: the page still works */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* fine */ } },
};

const ASANA_PROJECT = "1219139073710791";
const statusCls = (st) => (/done/i.test(st || "") ? s.pillDark : /progress/i.test(st || "") ? s.pillInk : /review|waiting|approved/i.test(st || "") ? s.pillSoft : s.pillGrey);
const initialsOf = (n) => String(n || "?").replace(/@.*/, "").split(/[\s.]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
const KIND_ICON = { pipeline: "flow", outreach: "mail", listing: "pin", meeting: "calendar", authority: "star", spend: "dollar", asana: "calendar", clickup: "flow" };
const SRC_LABEL = { asana: "Asana", clickup: "ClickUp" };

// ── small pieces ────────────────────────────────────────────────────────────────────────────────────
function Delta({ now, before, points = false, invert = false }) {
  if (now === null || now === undefined || before === null || before === undefined) return null;
  let d, txt;
  if (points) { d = now - before; txt = `${Math.abs(d * 100).toFixed(1)} pts`; }
  else { if (!before) return null; d = (now - before) / before; if (!Number.isFinite(d)) return null; txt = `${Math.abs(d * 100).toFixed(1)}%`; }
  const good = invert ? d < 0 : d > 0;
  // Rising or falling is drawn as a triangle; ink when the change is good, the accent when it is not
  if (Math.abs(d) < 0.0005) return <span className={`${s.delta} ${s.deltaFlat}`}>{txt}</span>;
  return <span className={`${s.delta} ${good ? "" : s.deltaBad}`}><Icon n={d >= 0 ? "tri-up" : "tri-down"} size={8} />{txt}</span>;
}

function Spark({ values, hotLast = 0, accent = false }) {
  const max = Math.max(1, ...values);
  return (
    <div className={`${s.spark} ${accent ? s.sparkAccent : ""}`}>
      {values.map((v, i) => <i key={i} className={i >= values.length - hotLast ? s.hot : ""} style={{ height: `${Math.max(6, (v / max) * 100)}%` }} />)}
    </div>
  );
}

function Gauge({ value, label, accent = false, text }) {
  const v = Math.max(0, Math.min(1, value || 0));
  const R = 34, cx = 46, cy = 44, a0 = Math.PI * 1.1, a1 = -Math.PI * 0.1;
  const pt = (a) => [cx + R * Math.cos(a), cy - R * Math.sin(a)];
  const arc = (from, to) => { const [x0, y0] = pt(from), [x1, y1] = pt(to); const large = from - to > Math.PI ? 1 : 0; return `M${x0} ${y0} A${R} ${R} 0 ${large} 1 ${x1} ${y1}`; };
  const end = a0 - (a0 - a1) * v;
  return (
    <div className={s.gauge}>
      <svg viewBox="0 0 92 60" role="img" aria-label={`${label} ${text}`}>
        <path d={arc(a0, a1)} stroke="rgba(0,0,0,.07)" strokeWidth="4" fill="none" strokeLinecap="round" />
        {v > 0.003 && <path d={arc(a0, end)} stroke={accent ? "var(--orange-ink)" : "var(--ink)"} strokeOpacity={accent ? 1 : 0.78} strokeWidth="4" fill="none" strokeLinecap="round" />}
        <text x="46" y="48" textAnchor="middle" fontSize="15" fontWeight="300" fill={accent ? "var(--orange-ink)" : "var(--ink)"}>{text}</text>
      </svg>
      <div className={s.gaugeLabel}>{label}</div>
    </div>
  );
}

const Range = ({ children }) => <span className={s.tag}><Icon n="calendar" size={11} />{children}</span>;
/** Card title with its icon chip, same as the Social & Web tab. */
const Title = ({ icon, children, as: H = "h2", className = s.cardTitle, style }) => <H className={`${className} ${s.titleRow}`} style={style}><span className={s.titleIcon}><Icon n={icon} size={15} /></span><span style={{ minWidth: 0 }}>{children}</span></H>;
/** A thin bar for a value against the largest in its list (drawn from the figure beside it, adds no number). */
const RowBar = ({ value, max, accent = false }) => <div className={s.rowBar}><i className={accent ? s.meterAccent : ""} style={{ width: `${max ? Math.max(0, Math.min(1, (value || 0) / max)) * 100 : 0}%` }} /></div>;
const Meter = ({ value, max, accent = false }) => <div className={s.meter}><i className={accent ? s.meterAccent : ""} style={{ width: `${max ? Math.max(0, Math.min(1, (value || 0) / max)) * 100 : 0}%` }} /></div>;

// ── data shaping ────────────────────────────────────────────────────────────────────────────────────
const pick = (arr, site) => (arr || []).filter((x) => x.status === "ok" && (site === "all" || x.id === site));

/** One combined daily series (visits, conversions, sales) for the chosen sites. */
const SHOPS = ["worthyproducts", "dutchrusk"];   // worthy.nz is the company site: enquiries, no online sales
function combineTraffic(traffic, site, only = null) {
  const m = new Map();
  pick(traffic, site).filter((t) => !only || only.includes(t.id)).forEach((t) => (t.daily || []).forEach((r) => {
    const o = m.get(r.date) || { date: r.date, sessions: 0, conversions: 0, orders: 0, revenue: 0 };
    // orders: every online channel (shops); for worthy.nz the enquiries. conversions: what the conversion rate rests on.
    o.sessions += r.sessions || 0; o.conversions += r.conversions || 0; o.orders += (r.orders ?? r.conversions) || 0; o.revenue += r.revenue || 0;
    m.set(r.date, o);
  }));
  return [...m.values()].sort((a, b) => a.date.localeCompare(b.date));
}
const sumOf = (rows, k) => rows.reduce((a, r) => a + (r[k] || 0), 0);
function windowed(daily, end, days) {
  const a = addDays(end, -(days - 1)), pa = addDays(a, -days), pb = addDays(a, -1);
  return { cur: daily.filter((r) => r.date >= a && r.date <= end), prev: daily.filter((r) => r.date >= pa && r.date <= pb), start: a };
}
/** The chosen period and the same number of days straight before it. */
function rangeWin(daily, start, end) {
  const days = Math.round((d0(end) - d0(start)) / 86400000) + 1;
  const pe = addDays(start, -1), ps = addDays(pe, -(days - 1));
  return { cur: daily.filter((r) => r.date >= start && r.date <= end), prev: daily.filter((r) => r.date >= ps && r.date <= pe), days, prevStart: ps, prevEnd: pe };
}
const PRESETS = [["7d", "Last 7 days"], ["30d", "Last 30 days"], ["90d", "Last 90 days"], ["mtd", "This month"], ["lm", "Last month"], ["12m", "Last 12 months"], ["custom", "Custom dates"]];
function rangeFor(preset, from, to, yesterday) {
  const first = (iso) => `${iso.slice(0, 7)}-01`;
  if (preset === "7d") return [addDays(yesterday, -6), yesterday];
  if (preset === "90d") return [addDays(yesterday, -89), yesterday];
  if (preset === "12m") return [addDays(yesterday, -364), yesterday];
  if (preset === "mtd") return [first(yesterday), yesterday];
  if (preset === "lm") { const e = addDays(first(yesterday), -1); return [first(e), e]; }
  if (preset === "custom" && from && to) { const a = from <= to ? from : to, b = from <= to ? to : from; return [a, b > yesterday ? yesterday : b]; }
  return [addDays(yesterday, -29), yesterday];
}
const mondayOf = (iso) => { const d = d0(iso); const wd = (d.getUTCDay() + 6) % 7; return addDays(iso, -wd); };

function chartSeries(allDaily, mode, start, end) {
  if (!allDaily.length) return [];
  const win = rangeWin(allDaily, start, end);
  const daily = win.cur, prevDaily = win.prev;
  if (mode === "daily") {
    const last = daily, before = prevDaily;
    return last.map((r, i) => ({ key: r.date, label: dShort(r.date), long: `${DAYS_LONG[d0(r.date).getUTCDay()]} ${dLong(r.date)}`, weekend: [0, 6].includes(d0(r.date).getUTCDay()), a: r.sessions, b: r.revenue, c: before[i]?.sessions ?? null, conv: r.orders ?? r.conversions }));
  }
  const keyOf = mode === "weekly" ? (iso) => mondayOf(iso) : (iso) => iso.slice(0, 7);
  const group = (list) => {
    const g = new Map();
    list.forEach((r) => { const k = keyOf(r.date); const o = g.get(k) || { key: k, sessions: 0, revenue: 0, conversions: 0, days: 0 }; o.sessions += r.sessions; o.revenue += r.revenue; o.conversions += (r.orders ?? r.conversions); o.days += 1; g.set(k, o); });
    let out = [...g.values()].sort((a, b) => a.key.localeCompare(b.key));
    if (mode === "weekly" && out.some((r) => r.days === 7)) out = out.filter((r) => r.days === 7);   // a part week would look like a drop
    return out;
  };
  const rows = group(daily), before = group(prevDaily);
  const last = rows;
  return last.map((r, i) => ({
    key: r.key,
    label: mode === "weekly" ? dShort(r.key) : monthLabel(r.key),
    long: mode === "weekly" ? `Week of ${dLong(r.key)}${r.days < 7 ? " (part)" : ""}` : `${MONTHS_LONG[Number(r.key.slice(5)) - 1]} ${r.key.slice(0, 4)}${r.days < new Date(Date.UTC(Number(r.key.slice(0, 4)), Number(r.key.slice(5)), 0)).getUTCDate() ? " (part)" : ""}`,
    a: r.sessions, b: r.revenue, c: before[i]?.sessions ?? null, conv: r.conversions,
  }));
}

/** Monotone cubic path (no overshoot), so the line never dips below zero or above a real peak. */
function smoothPath(pts) {
  const p = pts.filter((x) => x && Number.isFinite(x[1]));
  if (p.length < 2) return "";
  const n = p.length, dx = [], m = [], t = [];
  for (let i = 0; i < n - 1; i++) { dx[i] = p[i + 1][0] - p[i][0]; m[i] = (p[i + 1][1] - p[i][1]) / dx[i]; }
  t[0] = m[0]; t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (3 * (dx[i - 1] + dx[i])) / ((2 * dx[i] + dx[i - 1]) / m[i - 1] + (dx[i] + 2 * dx[i - 1]) / m[i]);
  let d = `M${p[0][0]},${p[0][1]}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += ` C${p[i][0] + h},${p[i][1] + t[i] * h} ${p[i + 1][0] - h},${p[i + 1][1] - t[i + 1] * h} ${p[i + 1][0]},${p[i + 1][1]}`;
  }
  return d;
}
const niceMax = (v) => { if (v <= 0) return 4; const e = 10 ** Math.floor(Math.log10(v)); const f = v / e; const n = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10; return n * e; };
const axisNum = (v) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}m` : v >= 1000 ? `${(v / 1000).toFixed(v % 1000 ? 1 : 0)}k` : String(Math.round(v)));

// ── traffic vs sales chart ──────────────────────────────────────────────────────────────────────────
function TrafficChart({ rows, mode, lead }) {
  const wrap = useRef(null);
  const [w, setW] = useState(720);
  const [hover, setHover] = useState(null);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const el = wrap.current; if (!el) return;
    const ro = new ResizeObserver(() => { setW(el.clientWidth || 720); setNarrow(window.innerWidth < 760); });
    ro.observe(el);   // fires once straight away with the real width return () => ro.disconnect();
  }, [rows.length > 0]);   // eslint-disable-line react-hooks/exhaustive-deps
  const H = narrow ? 230 : 300, padL = 40, padR = 48, padT = 14, padB = 28;
  const iw = Math.max(10, w - padL - padR), ih = H - padT - padB;
  const maxA = niceMax(Math.max(1, ...rows.map((r) => Math.max(r.a || 0, r.c || 0))));
  const maxB = niceMax(Math.max(1, ...rows.map((r) => r.b || 0)));
  const x = (i) => padL + (rows.length <= 1 ? iw / 2 : (i / (rows.length - 1)) * iw);
  const yA = (v) => padT + ih - (v / maxA) * ih;
  const yB = (v) => padT + ih - (v / maxB) * ih;
  const step = rows.length > 1 ? iw / (rows.length - 1) : iw;
  const every = Math.max(1, Math.ceil(rows.length / (narrow ? 5 : 8)));
  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
    const i = Math.round(((px - padL) / iw) * (rows.length - 1));
    setHover(i >= 0 && i < rows.length ? i : null);
  };
  const h = hover !== null ? rows[hover] : null;
  const change = h && h.c ? (h.a - h.c) / h.c : null;
  if (!rows.length) return <div className={s.skeleton} style={{ height: H }} />;
  return (
    <div className={s.chartWrap} ref={wrap}>
      <svg className={s.chartSvg} style={{ height: H }} viewBox={`0 0 ${w} ${H}`} onMouseMove={onMove} onMouseLeave={() => setHover(null)} onTouchStart={onMove} onTouchMove={onMove} role="img" aria-label="Visits and online sales over time">
        <defs>
          <pattern id="cc-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" stroke="rgba(20,22,20,.07)" strokeWidth="2" />
          </pattern>
          <linearGradient id="cc-fadeA" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#141614" stopOpacity=".08" /><stop offset="1" stopColor="#141614" stopOpacity="0" /></linearGradient>
        </defs>
        {rows.map((r, i) => r.weekend ? <rect key={`w${i}`} x={x(i) - step / 2} y={padT} width={step} height={ih} fill="url(#cc-hatch)" rx="3" /> : null)}
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <g key={f}>
            <line x1={padL} x2={padL + iw} y1={padT + ih - f * ih} y2={padT + ih - f * ih} stroke="rgba(20,22,20,.16)" strokeDasharray="5 5" />
            <text x={padL - 8} y={padT + ih - f * ih + 4} textAnchor="end" fontSize="11" fill="#676d68">{axisNum(maxA * f)}</text>
            <text x={padL + iw + 8} y={padT + ih - f * ih + 4} textAnchor="start" fontSize="11" fill="#4B5BD6" opacity=".85">{f ? `${lead ? "" : "$"}${axisNum(maxB * f)}` : ""}</text>
          </g>
        ))}
        {rows.map((r, i) => (i % every === 0 || i === rows.length - 1) && (i === rows.length - 1 || rows.length - 1 - i >= every / 2) ? <text key={`l${i}`} x={x(i)} y={H - 8} textAnchor="middle" fontSize="11" fill="#676d68">{r.label}</text> : null)}
        {hover !== null && <rect x={x(hover) - Math.max(step, 14) / 2} y={padT} width={Math.max(step, 14)} height={ih} fill="url(#cc-hatch)" rx="4" />}
        <path d={`${smoothPath(rows.map((r, i) => [x(i), yA(r.a)]))} L${x(rows.length - 1)},${padT + ih} L${x(0)},${padT + ih} Z`} fill="url(#cc-fadeA)" />
        <path d={smoothPath(rows.map((r, i) => (r.c === null ? null : [x(i), yA(r.c)])))} stroke="#141614" strokeOpacity=".22" strokeWidth="1.6" strokeDasharray="4 4" fill="none" />
        <path d={smoothPath(rows.map((r, i) => [x(i), yA(r.a)]))} stroke="#141614" strokeWidth="2.4" fill="none" />
        <path d={smoothPath(rows.map((r, i) => [x(i), yB(r.b)]))} stroke="#4B5BD6" strokeWidth="2.6" fill="none" />
        {h && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={padT + 4} y2={padT + ih} stroke="#141614" strokeOpacity=".5" strokeWidth="1.5" />
            <circle cx={x(hover)} cy={padT + 4} r="4" fill="#141614" />
            <circle cx={x(hover)} cy={yB(h.b)} r="5.5" fill="#4B5BD6" stroke="#fff" strokeWidth="2" />
            <circle cx={x(hover)} cy={yA(h.a)} r="4.5" fill="#fff" stroke="#141614" strokeWidth="2" />
          </g>
        )}
      </svg>
      {h && (
        <div className={s.tip} style={{ left: Math.min(Math.max(x(hover), 90), w - 90), top: Math.max(yA(h.a), 70) }}>
          <div><b>{h.long}</b></div>
          {change !== null && <div className={s.tipRow}><span>Change</span><b style={{ color: change >= 0 ? "#141614" : "#4B5BD6", display: "inline-flex", alignItems: "center", gap: 3 }}><Icon n={change >= 0 ? "tri-up" : "tri-down"} size={8} />{change >= 0 ? "+" : ""}{(change * 100).toFixed(2)}%</b></div>}
          <div className={s.tipRow}><span>Visits</span><b>{n0(h.a)}</b></div>
          {lead
            ? <div className={s.tipRow}><span style={{ color: "#4B5BD6" }}>Enquiries</span><b>{n0(h.conv)}</b></div>
            : <><div className={s.tipRow}><span style={{ color: "#4B5BD6" }}>Online sales</span><b>{money(h.b)}</b></div>
              <div className={s.tipRow}><span>Orders</span><b>{n0(h.conv)}</b></div></>}
          {h.c !== null && <div className={s.tipRow}><span>Previous</span><b>{n0(h.c)}</b></div>}
        </div>
      )}
    </div>
  );
}

// ── board editor ────────────────────────────────────────────────────────────────────────────────────
function Editor({ item, onClose, onSave, onDelete, busy, error }) {
  const [f, setF] = useState(item);
  useEffect(() => { cache.set("cc-draft-v1", f); }, [f]);
  const k = KINDS[f.kind];
  const set = (key) => (e) => setF({ ...f, [key]: e.target.value });
  const input = (key) => {
    if (key === "site") return <select value={f.site || ""} onChange={set("site")}><option value="">All of Worthy</option>{SITES.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>;
    if (key === "status") return <select value={f.status || k.statuses[0]} onChange={set("status")}>{k.statuses.map((x) => <option key={x} value={x}>{stLabel(f.kind, x)}</option>)}</select>;
    if (key === "notes") return <textarea value={f.notes || ""} onChange={set("notes")} />;
    if (key === "due") return <input type="date" value={f.due || ""} onChange={set("due")} />;
    if (key === "month") return <input type="month" value={f.month || ""} onChange={set("month")} />;
    if (key === "amount" || key === "score") return <input type="number" inputMode="decimal" step="any" value={f[key] || ""} onChange={set(key)} />;
    if (key === "link") return <input type="url" placeholder="https://" value={f.link || ""} onChange={set("link")} />;
    return <input value={f[key] || ""} onChange={set(key)} />;
  };
  return (
    <div className={s.scrim} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form className={`${s.modal} ${s.fade}`} onSubmit={(e) => { e.preventDefault(); onSave(f); }}>
        <Title as="h3" className={s.modalTitle} icon={item.id ? "edit" : KIND_ICON[f.kind] || "plus"}>{item.id ? `Edit ${k.one.toLowerCase()}` : `New ${k.one.toLowerCase()}`}</Title>
        <div className={s.fields}>
          {!item.id && (
            <label className={`${s.field} ${s.fieldWide}`}>Type
              <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value, status: KINDS[e.target.value].statuses[0] })}>
                {Object.entries(KINDS).filter(([id]) => id !== "meeting").map(([id, x]) => <option key={id} value={id}>{x.one}</option>)}
              </select>
            </label>
          )}
          <label className={`${s.field} ${s.fieldWide}`}>{k.title}<input required autoFocus value={f.title || ""} onChange={set("title")} /></label>
          {k.fields.filter((x) => x !== "title").map((key) => (
            <label key={key} className={`${s.field} ${key === "notes" || key === "link" ? s.fieldWide : ""}`}>{FIELD_LABEL[key]}{input(key)}</label>
          ))}
        </div>
        {error && <div className={s.err}>{error}</div>}
        <div className={s.modalFoot}>
          <div>{item.id && <button type="button" className={`${s.btn} ${s.btnDanger}`} onClick={() => onDelete(f)} disabled={busy}><Icon n="trash" size={14} />Delete</button>}</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className={s.btn} onClick={onClose}>Cancel</button>
            <button type="submit" className={`${s.btn} ${s.btnDark}`} disabled={busy}>{busy ? "Saving" : "Save"}</button>
          </div>
        </div>
      </form>
    </div>
  );
}

// ── page ────────────────────────────────────────────────────────────────────────────────────────────
export default function CommandCenter() {
  const [tab, setTab] = useState("dashboard");
  const [site, setSite] = useState("all");
  const [data, setData] = useState(null);
  const [live, setLive] = useState(null);
  const [board, setBoard] = useState(null);
  const [asana, setAsana] = useState(null);
  const [clickup, setClickup] = useState(null);
  const [log, setLog] = useState([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState("");
  const [mode, setMode] = useState("daily");
  const [feedTab, setFeedTab] = useState("all");
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [liveAt, setLiveAt] = useState(null);
  const [todayNow, setTodayNow] = useState(null);
  const [loadedAt, setLoadedAt] = useState(null);
  // Thursday in NZ is meeting day: the whole page refreshes every minute, live figures every 15 seconds
  const [meeting] = useState(() => new Date().toLocaleDateString("en-NZ", { timeZone: "Pacific/Auckland", weekday: "long" }) === "Thursday");
  const [preset, setPreset] = useState("30d");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [rangeSearch, setRangeSearch] = useState(null);
  const [events, setEvents] = useState(null);

  const [restored, setRestored] = useState(false);
  useEffect(() => {
    const fromHash = () => { const h = window.location.hash.slice(1); if (TABS.some((t) => t.id === h)) { setTab(h); return true; } return false; };
    const restore = () => {
      const v = cache.get("cc-view-v1");
      const hashTab = fromHash();
      if (v) {
        if (!hashTab && TABS.some((t) => t.id === v.tab)) setTab(v.tab);
        if (PRESETS.some(([id]) => id === v.preset)) setPreset(v.preset);
        if (v.preset === "custom") { setFrom(v.from || ""); setTo(v.to || ""); }
        if (["daily", "weekly", "monthly"].includes(v.mode)) setMode(v.mode);
        if (v.feedTab) setFeedTab(v.feedTab);
      }
      const snap = cache.get("cc-data-v3", 24 * HOUR);
      if (snap) { setData(snap); setLive(snap.live); setAsana(snap.asana); setClickup(snap.clickup); setBoard(snap.board); setLog(snap.log || []); setLiveAt(snap.liveAt || snap.builtAt); setTodayNow(snap.todayNow); setLoadedAt(snap.builtAt); }
      const draft = cache.get("cc-draft-v1", 7 * 24 * HOUR);
      if (draft?.kind && KINDS[draft.kind]) setEditing(draft);
      setRestored(true);
    };
    restore();
    try { const sv = localStorage.getItem("cc-site"); if (sv) setSite(sv); } catch { /* fine */ }
    window.addEventListener("hashchange", fromHash);
    window.addEventListener("popstate", fromHash);   // Back and Forward between tabs too
    return () => { window.removeEventListener("hashchange", fromHash); window.removeEventListener("popstate", fromHash); };
  }, []);
  useEffect(() => {
    if (restored) cache.set("cc-view-v1", { tab, preset, from, to, mode, feedTab });
  }, [restored, tab, preset, from, to, mode, feedTab]);
  const go = (t) => { setTab(t); try { history.replaceState(null, "", `#${t}`); } catch { /* fine */ } window.scrollTo({ top: 0, behavior: "smooth" }); };
  const chooseSite = (v) => { setSite(v); try { localStorage.setItem("cc-site", v); } catch { /* fine */ } };

  const load = useCallback(async (fresh = false) => {
    setLoading(true);
    try {
      const r = await fetch(`/api/command${fresh ? "?fresh=1" : ""}`, { cache: "no-store" });
      if (r.status === 401 || r.status === 403) { window.location.href = "/login"; return; }
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
      setData(j); setLive(j.live); setAsana(j.asana); setClickup(j.clickup); setBoard(j.board); setLog(j.log || []); setLiveAt(j.liveAt || j.builtAt); setTodayNow(j.todayNow); setLoadedAt(j.builtAt); setFailed("");
      cache.set("cc-data-v3", j);
    } catch (e) { setFailed(String(e.message || e)); }
    finally { setLoading(false); }
  }, []);
  const loadLive = useCallback(async (fresh = false) => {
    try {
      const r = await fetch(`/api/command?live=1${fresh ? "&fresh=1" : ""}`, { cache: "no-store" });
      if (!r.ok) return;
      const j = await r.json(); setLive(j.live); if (j.asana) setAsana(j.asana); if (j.clickup) setClickup(j.clickup); if (j.todayNow) setTodayNow(j.todayNow); setLog(j.log || []); setLiveAt(j.at);
    } catch { /* next tick */ }
  }, []);
  useEffect(() => {
    load();
    const a = setInterval(() => { if (!document.hidden) loadLive(); }, meeting ? 15000 : 30000);
    const b = setInterval(() => { if (!document.hidden) load(); }, meeting ? 60000 : 5 * 60000);
    const c = setInterval(() => setNow(Date.now()), 1000);
    const vis = () => { if (!document.hidden) loadLive(); };
    document.addEventListener("visibilitychange", vis);
    return () => { clearInterval(a); clearInterval(b); clearInterval(c); document.removeEventListener("visibilitychange", vis); };
  }, [load, loadLive, meeting]);

  const save = async (item, action = "save") => {
    setSaving(true); setSaveErr("");
    try {
      const r = await fetch("/api/command", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, item }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Could not save");
      setBoard(j.board); setLog(j.log || []); setEditing(null); cache.del("cc-draft-v1");
      setData((cur) => { if (cur) cache.set("cc-data-v1", { ...cur, board: j.board, log: j.log || [] }); return cur; });
    } catch (e) { setSaveErr(String(e.message || e)); }
    finally { setSaving(false); }
  };
  const quickStatus = (item, status) => save({ ...item, status });
  /** Change a task in Asana or ClickUp itself. The page updates from what the tool sends back. */
  const ext = async (src, id, op, value, title) => {
    if ((op === "done" || op === "reopen") && !window.confirm(`${op === "done" ? "Mark done" : "Reopen"} in ${SRC_LABEL[src]}?\n\n${title}`)) return false;
    setSaving(true); setSaveErr("");
    try {
      const r = await fetch("/api/command", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "external", source: src, id, op, value, title }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Could not save");
      if (j.asana) setAsana(j.asana); if (j.clickup) setClickup(j.clickup); setLog(j.log || []);
      return true;
    } catch (e) { setSaveErr(String(e.message || e)); alert(String(e.message || e)); return false; }
    finally { setSaving(false); }
  };
  const person = data?.person || "";
  const newItem = (kind, extra = {}) => { setSaveErr(""); setEditing({ kind, status: KINDS[kind].statuses[0], site: site === "all" ? "" : site, owner: person ? cap(person) : "", ...extra }); };
  const defaultKind = { dashboard: "pipeline", search: "authority", social: "pipeline", outreach: "outreach", listings: "listing", pipeline: "pipeline", meeting: "pipeline" }[tab];

  // ── derived numbers ──
  const today = data?.today || nzTodayIso();
  const yesterday = addDays(today, -1);
  const lead = site === "worthy";
  const daily = useMemo(() => combineTraffic(data?.traffic, site), [data, site]);
  const shopDaily = useMemo(() => (site === "all" ? combineTraffic(data?.traffic, site, SHOPS) : daily), [data, site, daily]);
  const [rStart, rEnd] = rangeFor(preset, from, to, today);   // periods run up to today (real time), like the shops' own reports
  const sw30 = useMemo(() => rangeWin(shopDaily, rStart, rEnd), [shopDaily, rStart, rEnd]);
  const w30 = useMemo(() => rangeWin(daily, rStart, rEnd), [daily, rStart, rEnd]);
  const rangeText = `${dShort(rStart)}${rStart.slice(0, 4) !== rEnd.slice(0, 4) ? ` ${rStart.slice(0, 4)}` : ""} to ${dShort(rEnd)} ${rEnd.slice(0, 4)}`;
  // Search Console runs about 3 days behind, so its period ends 3 days ago at the latest
  const gscEnd = rEnd > addDays(today, -3) ? addDays(today, -3) : rEnd;
  const gscStart = rStart > gscEnd ? gscEnd : rStart;
  useEffect(() => {
    if (preset === "30d") { setRangeSearch(null); return; }
    let stop = false;
    fetch(`/api/command?search=1&start=${gscStart}&end=${gscEnd}`, { cache: "no-store" }).then((r) => r.json()).then((j) => { if (!stop && j.search) setRangeSearch(j.search); }).catch(() => {});
    return () => { stop = true; };
  }, [preset, gscStart, gscEnd]);
  const openEvents = async (siteId, a = rStart, b = rEnd) => {
    const ids = siteId === "all" ? SITES.map((x) => x.id) : [siteId];
    setEvents({ loading: true, site: siteId, start: a, end: b, rows: [] });
    const [parts, forms] = await Promise.all([
      Promise.all(ids.map((id) => fetch(`/api/command?events=${id}&start=${a}&end=${b}`, { cache: "no-store" }).then((r) => r.json()).then((j) => (j.rows || []).map((x) => ({ ...x, site: id }))).catch(() => []))),
      ids.includes("worthy") ? fetch(`/api/command?enquiries=1&start=${a}&end=${b}`, { cache: "no-store" }).then((r) => r.json()).catch(() => null) : null,
    ]);
    setEvents({ loading: false, site: siteId, start: a, end: b, rows: parts.flat().sort((a, b) => b.at.localeCompare(a.at)), forms });
  };
  const searchSites = pick(rangeSearch || data?.search, site);
  const liveSites = (live || []).filter((x) => x.status === "ok" && (site === "all" || x.id === site));
  const liveNow = liveSites.length ? liveSites.reduce((a, x) => a + x.now, 0) : null;
  const liveMinutes = new Array(30).fill(0).map((_, i) => liveSites.reduce((a, x) => a + (x.byMinute?.[i] || 0), 0));
  const T = (k, i) => searchSites.reduce((a, x) => a + (x.totals?.[k]?.[i] || 0), 0);
  const nbClicks = searchSites.length ? [T("nonBrandedClicks", 0), T("nonBrandedClicks", 1)] : [null, null];
  const searchRange = searchSites[0]?.range;
  const nbDaily = useMemo(() => {
    const m = new Map(); searchSites.forEach((x) => (x.daily || []).forEach((r) => m.set(r.date, (m.get(r.date) || 0) + (r.nbClicks || 0))));
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).filter((e) => e[0] >= gscStart && e[0] <= gscEnd).map((e) => e[1]);
  }, [searchSites, gscStart, gscEnd]);
  const rev = [sumOf(w30.cur, "revenue"), sumOf(w30.prev, "revenue")];
  const sess = [sumOf(w30.cur, "sessions"), sumOf(w30.prev, "sessions")];
  const conv = [sumOf(sw30.cur, "conversions"), sumOf(sw30.prev, "conversions")];
  const shopSess = [sumOf(sw30.cur, "sessions"), sumOf(sw30.prev, "sessions")];
  const cr = [shopSess[0] ? conv[0] / shopSess[0] : null, shopSess[1] ? conv[1] / shopSess[1] : null];
  const chartMode = (mode === "monthly" && w30.days < 85) || (mode === "weekly" && w30.days < 21) ? (w30.days >= 21 && mode === "monthly" ? "weekly" : "daily") : mode;
  const rows = useMemo(() => chartSeries(daily, chartMode, rStart, rEnd).map((x) => (lead ? { ...x, b: x.conv } : x)), [daily, chartMode, lead, rStart, rEnd]);

  const items = useMemo(() => board || [], [board]);
  const inSite = (x) => site === "all" || !x.site || x.site === site;
  const upcoming = items.filter((x) => inSite(x) && ((x.kind === "pipeline" && x.status !== "done") || (x.kind === "meeting" && x.status === "open") || (x.kind === "outreach" && ["prospect", "contacted", "replied"].includes(x.status) && x.due)))
    .sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999"));
  const asanaTasks = (asana?.tasks || []).filter((t) => site === "all" || !t.sites?.length || t.sites.includes(site));
  const asanaOpen = asanaTasks.filter((t) => !t.done).map((t) => ({ id: `as_${t.id}`, src: "asana", rid: t.id, kind: "asana", title: t.name, due: t.due, owner: t.owner, site: t.sites?.length === 1 ? t.sites[0] : "", url: t.url, status: t.status }));
  const external = useMemo(() => {
    const inS = (t) => site === "all" || !t.sites?.length || t.sites.includes(site);
    const st = (t, map) => (t.done ? "done" : map(t));
    const one = (t) => (t.sites?.length === 1 ? t.sites[0] : "");
    const fromAsana = (asana?.tasks || []).filter(inS).filter((t) => !t.done || (t.doneAt && t.doneAt.slice(0, 10) >= addDays(today, -14)))
      .map((t) => ({ id: `as_${t.id}`, src: "asana", rid: t.id, kind: "pipeline", source: "Asana", title: t.name, url: t.url, owner: t.owner, due: t.due, site: one(t), sites: t.sites,
        status: st(t, (x) => (/progress|review/i.test(x.status || "") ? "in progress" : "next")), label: t.done ? "Done" : t.status || "Open", doneAt: t.doneAt ? t.doneAt.slice(0, 10) : null }));
    const fromClickup = (clickup?.tasks || []).filter(inS)
      .map((t) => ({ id: `cu_${t.id}`, src: "clickup", rid: t.id, rawStatus: t.status, kind: "pipeline", source: "ClickUp", title: t.name, url: t.url, owner: t.owner, due: t.due, site: one(t), sites: t.sites,
        status: st(t, (x) => (/progress|review/i.test(x.status) ? "in progress" : "next")), label: cap(t.status), doneAt: t.doneAt }));
    void fromAsana;   // Asana is the Ecom x Marketing tab's, not the department pipeline
    return fromClickup;
  }, [asana, clickup, site, today]);
  const cuOpen = external.filter((x) => x.source === "ClickUp" && x.status !== "done").map((x) => ({ ...x, kind: "asana", status: x.label }));
  void asanaOpen;
  const upcomingAll = [...upcoming, ...cuOpen].sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999"));
  const overdue = upcomingAll.filter((x) => x.due && x.due < today).length;

  const feed = useMemo(() => {
    const ev = (log || []).map((e) => ({ ...e, type: /done|won|live/.test(e.what) ? "done" : /moved/.test(e.what) ? "moved" : e.what === "added" ? "added" : "updated" }));
    const logged = new Set(ev.filter((e) => e.type === "done").map((e) => e.title));
    items.filter((x) => x.doneAt && !logged.has(x.title)).forEach((x) => ev.push({ what: x.kind === "listing" ? "live" : "done", kind: x.kind, title: x.title, at: `${x.doneAt}T00:00:00Z`, dateOnly: x.doneAt, type: "done", site: x.site }));
    return ev.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  }, [log, items]);
  const feedShown = feed.filter((e) => feedTab === "all" || e.type === feedTab).slice(0, 30);

  const updatedText = loadedAt ? `Refreshed ${nzTime(loadedAt)}, live ${ago(liveAt || loadedAt, now)}` : "Connecting";
  const [nonce, setNonce] = useState(0);
  const refreshAll = () => { load(true); setNonce((n) => n + 1); };
  // Typing a date switches to your own dates, keeping the other end where it was
  const pickDates = (a, b) => { setPreset("custom"); setFrom(a); setTo(b); };
  const initials = person ? person.slice(0, 2).toUpperCase() : "WO";

  return (
    <div className={s.page}>
      <div className={s.shell}>
        {/* top bar */}
        {/* The Command Center's tabs are in the left sidebar, under Marketing (27 Nov 2026): no second menu bar */}
        <SiteNav current="command" sub={tab} trail={tab !== "dashboard" ? [{ label: TABS.find((t) => t.id === tab)?.label }] : []} />

        {/* heading */}
        <div className={s.head} id="main" tabIndex={-1}>
          <div>
            <h1 className={s.title}>{tab === "dashboard" ? "Command Center" : TABS.find((t) => t.id === tab).label}</h1>
            <div className={s.sub}><span className={s.liveDot} />{updatedText}<span>·</span><span>{siteName(site)}</span><span>·</span><span>{rangeText}</span></div>
          </div>
          <div className={s.actions}>
            <button type="button" className={s.btn} onClick={refreshAll} disabled={loading}><Icon n="refresh" size={15} className={loading ? s.spin : ""} />{loading ? "Refreshing" : <Win win="Get the latest wins">Refresh</Win>}</button>
            <select className={s.select} value={preset} onChange={(e) => { setPreset(e.target.value); if (e.target.value === "custom" && !from) { setFrom(rStart); setTo(rEnd); } }} aria-label="Date range">
              {PRESETS.map(([id, l]) => <option key={id} value={id}>{l}</option>)}
            </select>
            <DatePair start={rStart} end={rEnd} max={today} onChange={pickDates} />
            <select className={s.select} value={site} onChange={(e) => chooseSite(e.target.value)} aria-label="Site">
              <option value="all">All sites</option>
              {SITES.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
            {tab === "meeting"
              ? <a className={`${s.btn} ${s.btnDark}`} href={`https://app.asana.com/0/${ASANA_PROJECT}/list`} target="_blank" rel="noreferrer"><Icon n="plus" size={15} stroke={2} /><Win win="Get it moving">New task in Asana</Win></a>
              : <button type="button" className={`${s.btn} ${s.btnDark}`} onClick={() => newItem(defaultKind)}><Icon n="plus" size={15} stroke={2} /><Win win="Line up the next win">{`Add ${KINDS[defaultKind].one.toLowerCase()}`}</Win></button>}
          </div>
        </div>

        <Freshness data={data} liveAt={liveAt} todayNow={todayNow} asana={asana} clickup={clickup} meeting={meeting} now={now} />
        {failed && !data && <div className={s.card}><div className={s.err}>Could not load: {failed}</div></div>}

        {tab === "dashboard" && (
          <div className={s.fade}>
            {/* KPI strip */}
            <section className={s.kpis}>
              <div className={s.kpi}>
                <div className={s.kpiTop}><div className={s.kpiNum}>{n0(liveNow)}</div><div className={s.chip}><Icon n="eye" size={15} /></div></div>
                <div className={s.kpiLabel}>Visitors right now</div>
                <Spark values={liveMinutes} hotLast={5} />
              </div>
              <div className={s.kpi}>
                <div className={s.kpiTop}><div className={s.kpiNum}>{searchSites.length ? n0(nbClicks[0]) : "-"}</div><div className={s.chip}><Icon n="search" size={15} /></div></div>
                <div className={s.kpiLabel}>Non-branded search clicks {searchSites.length > 0 && <Delta now={nbClicks[0]} before={nbClicks[1]} />}</div>
                <Spark values={nbDaily.length ? nbDaily : new Array(28).fill(0)} hotLast={7} />
              </div>
              <div className={`${s.kpi} ${s.kpiClick}`} onClick={() => openEvents(site)} role="button" tabIndex={0}>
                <div className={s.kpiTop}><div className={s.kpiNum}>{cr[0] === null ? "-" : (cr[0] * 100).toFixed(2)}<small>%</small></div><div className={s.chip}><Icon n="funnel" size={15} /></div></div>
                <div className={s.kpiLabel}>{lead ? "Enquiry rate" : "Conversion rate"} <Delta now={cr[0]} before={cr[1]} points /></div>
                <Spark values={w30.cur.map((r) => r.conversions)} hotLast={7} />
              </div>
              <div className={`${s.kpi} ${lead ? s.kpiClick : ""}`} onClick={lead ? () => openEvents(site) : undefined} role={lead ? "button" : undefined} tabIndex={lead ? 0 : undefined}>
                <div className={s.kpiTop}><div className={s.kpiNum}>{data ? (lead ? n0(conv[0]) : moneyShort(rev[0])) : "-"}</div><div className={`${s.chip} ${s.chipOrange}`}><Icon n={lead ? "mail" : "bag"} size={15} /></div></div>
                <div className={s.kpiLabel}>{lead ? "Enquiries" : "Online sales"} {lead ? <Delta now={conv[0]} before={conv[1]} /> : <Delta now={rev[0]} before={rev[1]} />}</div>
                <Spark values={w30.cur.map((r) => (lead ? r.conversions : r.revenue))} hotLast={7} accent />
              </div>
            </section>
            {todayNow && <section className={`${s.card} ${s.todayCard}`}><TodaySoFar todayNow={todayNow} site={site} bar /></section>}
            <WeeklySummary />

            <div className={s.grid}>
              <div className={s.stack}>
                <section className={s.card}>
                  <div className={s.cardHead}>
                    <Title icon="chart">{lead ? "Traffic vs enquiries" : "Traffic vs sales"}</Title>
                    <div className={s.seg}>
                      {["daily", "weekly", "monthly"].map((m) => { const off = (m === "weekly" && w30.days < 21) || (m === "monthly" && w30.days < 85); return <button key={m} type="button" className={chartMode === m ? s.segOn : ""} disabled={off} title={off ? "Pick a longer period" : undefined} style={off ? { opacity: 0.4, cursor: "not-allowed" } : undefined} onClick={() => setMode(m)}>{cap(m)}</button>; })}
                    </div>
                  </div>
                  <div className={s.cardHead} style={{ marginBottom: 6 }}>
                    <div className={s.legend}>
                      <span><i style={{ background: "var(--ink)" }} />Visits</span>
                      <span><i style={{ background: "var(--orange)" }} />{lead ? "Enquiries" : "Online sales"}</span>
                      <span><i style={{ background: "var(--ink)", opacity: 0.22 }} />Previous</span>
                    </div>
                    <Range>{rangeText}</Range>
                  </div>
                  <TrafficChart rows={rows} mode={chartMode} lead={lead} />
                </section>

                <div className={s.grid2}>
                  <section className={s.card}>
                    <div className={s.cardHead}><Title icon="zap">Live activity</Title></div>
                    <div className={s.seg} style={{ marginBottom: 12 }}>
                      {[["all", "All"], ["done", "Done"], ["moved", "Moved"], ["added", "Added"]].map(([id, l]) => <button key={id} type="button" className={feedTab === id ? s.segOn : ""} onClick={() => setFeedTab(id)}>{l}</button>)}
                    </div>
                    <div className={s.feed}>
                      {feedShown.length === 0 && <div className={s.empty}>Nothing yet</div>}
                      {feedShown.map((e, i) => (
                        <div key={i} className={s.feedItem}>
                          <div className={s.feedIcon}><Icon n={KIND_ICON[e.kind] || "flow"} size={15} /></div>
                          <div style={{ minWidth: 0 }}>
                            <div className={s.feedTitle}>{String(e.title).replace(/Google AI: (\w+)/, (m, id) => `Google AI figures, ${siteName(id)}`)}</div>
                            <div className={s.feedMeta}>{[KINDS[e.kind]?.label || SRC_LABEL[e.kind] || (e.kind === "search" ? "Search" : ""), e.person ? cap(e.person) : ""].filter(Boolean).join(" · ")} · {e.dateOnly ? dShort(e.dateOnly) : ago(e.at, now)}</div>
                          </div>
                          <span className={`${s.pill} ${e.type === "done" ? s.pillDark : e.type === "moved" ? s.pillInk : e.type === "added" ? s.pillSoft : s.pillGrey}`}>{e.type === "done" ? cap(e.what === "live" ? "live" : "done") : cap(e.type)}</span>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className={s.card}>
                    <div className={s.cardHead}>
                      <Title icon="hourglass">Next up{overdue > 0 && <span className={s.accentNum} style={{ fontSize: 14.5, marginLeft: 8 }}>{overdue} overdue</span>}</Title>
                      <button type="button" className={`${s.btn} ${s.btnSmall}`} onClick={() => go("pipeline")}>All work</button>
                    </div>
                    {upcomingAll.length === 0 && <div className={s.empty}>All clear</div>}
                    {upcomingAll.slice(0, 9).map((x) => (
                      <div key={x.id} className={s.row}>
                        <div style={{ minWidth: 0, cursor: "pointer" }} onClick={() => { if (x.kind === "asana") window.open(x.url, "_blank", "noopener"); else { setSaveErr(""); setEditing(x); } }}>
                          <div className={s.rowTitle}>{x.title}</div>
                          <div className={s.rowMeta}>
                            {x.due && <span className={x.due < today ? s.overdue : ""}>{x.due < today ? "Overdue, " : "Due "}{dShort(x.due)}</span>}
                            {x.site ? ` · ${siteName(x.site)}` : ""}{x.owner ? ` · ${x.owner}` : ""}
                          </div>
                        </div>
                        {x.kind === "asana"
                          ? <button type="button" className={s.toggle} aria-label={`Mark ${x.title} done`} title={`Done in ${SRC_LABEL[x.src]}`} onClick={() => ext(x.src, x.rid, "done", null, x.title)} disabled={saving} />
                          : x.kind !== "outreach"
                          ? <button type="button" className={s.toggle} aria-label={`Mark ${x.title} done`} onClick={() => quickStatus(x, "done")} disabled={saving} />
                          : <span className={`${s.pill} ${s.pillSoft}`}>{cap(x.status)}</span>}
                      </div>
                    ))}
                  </section>
                </div>
              </div>

              {/* sites column, like the server cards */}
              <aside className={`${s.stack} ${s.sitesCol}`}>
                {SITES.map((x) => {
                  const sr = (data?.search || []).find((r) => r.id === x.id);
                  const lv = (live || []).find((r) => r.id === x.id);
                  const tr = (data?.traffic || []).find((r) => r.id === x.id);
                  const tw = tr?.status === "ok" ? rangeWin(tr.daily || [], rStart, rEnd).cur : [];
                  const ts = sumOf(tw, "sessions"), tc = sumOf(tw, "conversions");
                  const okS = sr?.status === "ok";
                  const p1 = okS && sr.totals.queries[0] ? sr.totals.pageOne[0] / sr.totals.queries[0] : 0;
                  const ctr = okS && sr.totals.impressions[0] ? sr.totals.clicks[0] / sr.totals.impressions[0] : 0;
                  const crt = ts ? tc / ts : 0;
                  const dim = site !== "all" && site !== x.id;
                  return (
                    <section key={x.id} className={s.site} style={{ opacity: dim ? 0.45 : 1, cursor: "pointer" }} onClick={() => chooseSite(site === x.id ? "all" : x.id)}>
                      <div className={s.siteHead}>
                        <div className={`${s.siteName} ${s.titleRow}`}><span className={s.titleIcon}><Icon n={x.id === "worthy" ? "building" : "store"} size={14} /></span>{x.name}</div>
                        {lv?.status === "ok"
                          ? <span className={`${s.pill} ${lv.now > 0 ? s.pillDark : s.pillGrey}`}>{lv.now > 0 ? `${lv.now} live` : "Quiet"}</span>
                          : <span className={`${s.pill} ${data ? s.pillAccent : s.pillGrey}`}>{data ? "Not connected" : "Loading"}</span>}
                      </div>
                      <div className={s.siteSub}>{okS ? `Avg position ${n1(sr.totals.nonBrandedPosition[0])} · ${n0(sr.totals.queries[0])} search terms` : sr?.status === "error" ? "Offline" : ""}</div>
                      <div className={s.gauges}>
                        <Gauge value={p1} label="Page 1 terms" text={okS ? `${Math.round(p1 * 100)}%` : "-"} />
                        <Gauge value={Math.min(1, ctr * 5)} label="Search CTR" text={okS ? `${(ctr * 100).toFixed(1)}%` : "-"} />
                        <Gauge value={Math.min(1, crt * 10)} accent label={x.id === "worthy" ? "Enquiry rate" : "Conversion"} text={ts ? `${(crt * 100).toFixed(1)}%` : "-"} />
                      </div>
                      <div className={s.siteBtns} onClick={(e) => e.stopPropagation()}>
                        <a href={x.url} target="_blank" rel="noreferrer"><Icon n="globe" size={13} />Visit</a>
                        <a href={`https://search.google.com/search-console/performance/search-analytics?resource_id=${encodeURIComponent(x.gsc)}`} target="_blank" rel="noreferrer"><Icon n="search" size={13} />Search</a>
                        <a href={`https://analytics.google.com/analytics/web/#/p${x.ga}/reports/intelligenthome`} target="_blank" rel="noreferrer"><Icon n="chart" size={13} />Analytics</a>
                      </div>
                    </section>
                  );
                })}
              </aside>
            </div>
          </div>
        )}

        {tab === "search" && <SearchTab data={rangeSearch ? { ...data, search: rangeSearch } : data} site={site} items={items} start={rStart} end={rEnd} today={today} onEdit={(x) => { setSaveErr(""); setEditing(x); }} onAdd={newItem} />}
        {tab === "social" && <SocialTab site={site} start={rStart} end={rEnd} nonce={nonce} />}
        {tab === "outreach" && <BoardTab kind="outreach" items={items} site={site} today={today} onEdit={(x) => { setSaveErr(""); setEditing(x); }} onAdd={newItem} onMove={quickStatus} />}
        {tab === "listings" && <BoardTab kind="listing" items={items} site={site} today={today} onEdit={(x) => { setSaveErr(""); setEditing(x); }} onAdd={newItem} onMove={quickStatus} />}
        {tab === "pipeline" && <BoardTab kind="pipeline" onExt={ext} items={[...items, ...external]} site={site} today={today} onEdit={(x) => { setSaveErr(""); setEditing(x); }} onAdd={newItem} onMove={quickStatus} />}
        {tab === "meeting" && (
          <MeetingTab todayNow={todayNow} data={data} onEvents={openEvents} onExt={ext} external={external} asanaTasks={asanaTasks} asana={asana} site={site} items={items} today={today} w30={w30} start={rStart} end={rEnd} daily={daily} nbClicks={nbClicks} searchRange={searchRange} liveNow={liveNow}
            onEdit={(x) => { setSaveErr(""); setEditing(x); }} onAdd={newItem} onDone={(x) => quickStatus(x, "done")} saving={saving} />
        )}

      </div>

      {events && <EventsModal ev={events} onClose={() => setEvents(null)} />}
      {editing && <Editor key={editing.id || "new"} item={editing} busy={saving} error={saveErr} onClose={() => { setEditing(null); cache.del("cc-draft-v1"); }} onSave={(f) => save(f)} onDelete={(f) => save(f, "delete")} />}
    </div>
  );
}

const posClass = (p) => (p <= 3 ? s.pos1 : p <= 10 ? s.pos2 : p <= 20 ? s.pos3 : s.pos4);
// The same bands as the rankings filter: top 3, rest of page 1, page 2, beyond
const POS_BANDS = [["top3", "Top 3", (p) => p <= 3], ["page1", "Rest of page 1", (p) => p > 3 && p <= 10], ["page2", "Page 2", (p) => p > 10 && p <= 20], ["beyond", "Beyond", (p) => p > 20]];
const BAND_SHADE = [1, 0.78, 0.35, 0.14];

// ── Search tab ──────────────────────────────────────────────────────────────────────────────────────
function SearchTab(props) {
  const [mode, setMode] = useState("google");
  return (
    <>
      <div className={s.seg} style={{ marginBottom: 14 }}>
        {[["google", "Google", "search"], ["ai", "AI search", "sparkle"], ["shopping", "Google Shopping", "bag"]].map(([id, l, ic]) => <button key={id} type="button" className={mode === id ? s.segOn : ""} onClick={() => setMode(id)} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Icon n={ic} size={13} />{l}</button>)}
      </div>
      {mode === "google" ? <GoogleSearch {...props} /> : mode === "ai" ? <AiSearch {...props} /> : <ShoppingSearch {...props} />}
    </>
  );
}

function GoogleSearch({ data, site, items, onEdit, onAdd }) {
  const [band, setBand] = useState("all");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState({ k: "impressions", dir: -1 });
  const sites = pick(data?.search, site);
  const T = (k, i) => sites.reduce((a, x) => a + (x.totals?.[k]?.[i] || 0), 0);
  const wpos = (i) => { const imp = T("nonBrandedImpressions", i); return imp ? sites.reduce((a, x) => a + (x.totals.nonBrandedPosition[i] || 0) * x.totals.nonBrandedImpressions[i], 0) / imp : null; };
  const all = sites.flatMap((x) => x.queries.map((r) => ({ ...r, site: x.id })));
  const inBand = (p) => band === "all" || (band === "top3" ? p <= 3 : band === "page1" ? p <= 10 : band === "page2" ? p > 10 && p <= 20 : p > 20);
  const shown = all.filter((r) => inBand(r.position) && (!q || r.query.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => { const k = sort.k; const av = k === "move" ? (a.prevPosition ? a.prevPosition - a.position : -999) : a[k]; const bv = k === "move" ? (b.prevPosition ? b.prevPosition - b.position : -999) : b[k]; return typeof av === "string" ? av.localeCompare(bv) * sort.dir : (av - bv) * sort.dir; })
    .slice(0, 200);
  const th = (k, label, num) => <th className={num ? s.num : ""} onClick={() => setSort({ k, dir: sort.k === k ? -sort.dir : k === "position" || k === "query" ? 1 : -1 })} aria-sort={sort.k === k ? (sort.dir > 0 ? "ascending" : "descending") : undefined}><span className={s.thSort}>{label}{sort.k === k && <Icon n={sort.dir > 0 ? "tri-up" : "tri-down"} size={7} />}</span></th>;
  const posCls = posClass;
  const range = sites[0]?.range;
  const pages = sites.flatMap((x) => x.pages.map((p) => ({ ...p, site: x.id }))).sort((a, b) => b.clicks - a.clicks).slice(0, 10);
  const idx = pick(data?.indexing, site);
  const auth = items.filter((x) => x.kind === "authority" && (site === "all" || x.site === site)).sort((a, b) => String(b.month || "").localeCompare(String(a.month || "")));
  const winners = all.filter((r) => r.prevPosition && r.impressions >= 10).map((r) => ({ ...r, move: r.prevPosition - r.position })).sort((a, b) => b.move - a.move);
  return (
    <div className={s.fade}>
      <section className={s.kpis}>
        <div className={s.kpi}><div className={s.kpiTop}><div className={s.kpiNum}>{data ? n0(T("nonBrandedImpressions", 0)) : "-"}</div><div className={s.chip}><Icon n="eye" size={15} /></div></div><div className={s.kpiLabel}>Impressions <Delta now={T("nonBrandedImpressions", 0)} before={T("nonBrandedImpressions", 1)} /></div></div>
        <div className={s.kpi}><div className={s.kpiTop}><div className={`${s.kpiNum} ${s.accentNum}`}>{data ? n0(T("nonBrandedClicks", 0)) : "-"}</div><div className={`${s.chip} ${s.chipOrange}`}><Icon n="click" size={15} /></div></div><div className={s.kpiLabel}>Non-branded clicks <Delta now={T("nonBrandedClicks", 0)} before={T("nonBrandedClicks", 1)} /></div></div>
        <div className={s.kpi}><div className={s.kpiTop}><div className={s.kpiNum}>{data ? n0(T("pageOne", 0)) : "-"}</div><div className={s.chip}><Icon n="trophy" size={15} /></div></div><div className={s.kpiLabel}>Terms on page 1 <Delta now={T("pageOne", 0)} before={T("pageOne", 1)} /></div></div>
        <div className={s.kpi}><div className={s.kpiTop}><div className={s.kpiNum}>{data ? n1(wpos(0)) : "-"}</div><div className={s.chip}><Icon n="target" size={15} /></div></div><div className={s.kpiLabel}>Average position <Delta now={wpos(0)} before={wpos(1)} invert /></div></div>
      </section>
      <div className={s.grid}>
        <section className={s.card}>
          <div className={s.cardHead}>
            <Title icon="trophy">Non-branded rankings</Title>
            {range && <Range>{`${dShort(range.start)} to ${dShort(range.end)}`}</Range>}
          </div>
          {all.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div className={s.shareBar}>
                {POS_BANDS.map(([id, , test], i) => { const n = all.filter((r) => test(r.position)).length; return n ? <i key={id} style={{ width: `${(n / all.length) * 100}%`, background: i === 0 ? "var(--orange-ink)" : "var(--ink)", opacity: BAND_SHADE[i] }} /> : null; })}
              </div>
              <div className={s.shareLegend}>
                {POS_BANDS.map(([id, l, test], i) => <span key={id}><i style={{ background: i === 0 ? "var(--orange-ink)" : "var(--ink)", opacity: BAND_SHADE[i] }} />{l} {n0(all.filter((r) => test(r.position)).length)}</span>)}
              </div>
            </div>
          )}
          <div className={s.cardHead}>
            <div className={s.seg}>{[["all", "All"], ["top3", "Top 3"], ["page1", "Page 1"], ["page2", "Page 2"], ["beyond", "Beyond"]].map(([id, l]) => <button key={id} type="button" className={band === id ? s.segOn : ""} onClick={() => setBand(id)}>{l}</button>)}</div>
            <input className={s.search} placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead><tr>{th("query", "Search term")}{site === "all" && <th className={s.hideSm}>Site</th>}{th("position", "Position", true)}{th("move", "Move", true)}{th("clicks", "Clicks", true)}{th("impressions", "Shown", true)}<th className={`${s.num} ${s.hideSm}`}>CTR</th></tr></thead>
              <tbody>
                {!data && [0, 1, 2, 3, 4].map((i) => <tr key={i}><td colSpan={7}><div className={s.skeleton} style={{ height: 16 }} /></td></tr>)}
                {data && shown.length === 0 && <tr><td colSpan={7} className={s.empty}>No matches</td></tr>}
                {shown.map((r) => {
                  const mv = r.prevPosition ? r.prevPosition - r.position : null;
                  return (
                    <tr key={`${r.site}-${r.query}`}>
                      <td style={{ overflowWrap: "anywhere" }}>{r.query}</td>
                      {site === "all" && <td className={s.hideSm}><span className={s.siteTag}>{siteName(r.site)}</span></td>}
                      <td className={s.num}><span className={`${s.posBadge} ${posCls(r.position)}`}>{n1(r.position)}</span></td>
                      <td className={s.num}><span className={`${s.move} ${mv === null ? s.moveFlat : mv > 0.05 ? s.moveUp : mv < -0.05 ? s.moveDown : s.moveFlat}`}>{mv === null ? "New" : Math.abs(mv) < 0.05 ? "Same" : <><Icon n={mv > 0 ? "tri-up" : "tri-down"} size={8} />{n1(Math.abs(mv))}</>}</span></td>
                      <td className={s.num}>{n0(r.clicks)}</td>
                      <td className={s.num}>{n0(r.impressions)}</td>
                      <td className={`${s.num} ${s.hideSm}`}>{pct(r.ctr)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
        <div className={s.stack}>
          <section className={s.card}>
            <div className={s.cardHead}><Title icon="trending">Biggest climbers</Title></div>
            {winners.length === 0 && <div className={s.empty}>{data ? "None yet" : ""}</div>}
            {winners.filter((r) => r.move > 0).slice(0, 6).map((r) => (
              <div key={`${r.site}-${r.query}`} className={s.row}>
                <div style={{ minWidth: 0 }}><div className={s.rowTitle}>{r.query}</div><div className={s.rowMeta}>{siteName(r.site)} · {n1(r.prevPosition)} to {n1(r.position)}</div></div>
                <span className={`${s.pill} ${s.pillDark} ${s.pillPlain}`}><Icon n="tri-up" size={8} />+{n1(r.move)}</span>
              </div>
            ))}
          </section>
          <section className={s.card}>
            <div className={s.cardHead}><Title icon="folder">Indexing</Title></div>
            {idx.length === 0 && <div className={s.empty}>{data ? "Offline" : ""}</div>}
            {idx.map((x) => x.sitemaps.map((m) => (
              <div key={m.path} className={s.row}>
                <div style={{ minWidth: 0 }}>
                  <div className={s.rowTitle}>{siteName(x.id)}</div>
                  <div className={s.rowMeta}>{n0(m.submitted)} pages · read {m.lastDownloaded ? dShort(m.lastDownloaded) : "-"}</div>
                </div>
                <span className={`${s.pill} ${m.errors ? s.pillAccent : m.pending ? s.pillSoft : s.pillInk}`}>{m.errors ? `${m.errors} errors` : m.pending ? "Pending" : "Read"}</span>
              </div>
            )))}
          </section>
          <section className={s.card}>
            <div className={s.cardHead}>
              <Title icon="award">Authority</Title>
              <button type="button" className={`${s.btn} ${s.btnSmall}`} onClick={() => onAdd("authority", { month: new Date().toISOString().slice(0, 7) })}><Icon n="plus" size={13} />Record</button>
            </div>
            {auth.length === 0 && <div className={s.empty}>Nothing yet</div>}
            {auth.slice(0, 8).map((x) => (
              <div key={x.id} className={s.row} style={{ cursor: "pointer" }} onClick={() => onEdit(x)}>
                <div style={{ minWidth: 0 }}><div className={s.rowTitle}>{x.title}</div><div className={s.rowMeta}>{siteName(x.site)}{x.month ? ` · ${monthLabel(x.month)}` : ""}</div></div>
                <div className={s.rowNum} style={{ fontSize: 22 }}>{x.score || "-"}</div>
              </div>
            ))}
          </section>
          <section className={s.card}>
            <div className={s.cardHead}><Title icon="star">Top pages</Title><span className={s.tag}><Icon n="click" size={11} />Clicks</span></div>
            {pages.map((p, i) => (
              <div key={p.page} className={s.row}>
                <div style={{ minWidth: 0 }}><div className={s.rowTitle}>{p.page.replace(/^https?:\/\/(www\.)?/, "")}</div><div className={s.rowMeta}>{n0(p.impressions)} shown · position {n1(p.position)}</div></div>
                <div className={`${s.rowNum} ${i === 0 ? s.rowNumAccent : ""}`}>{n0(p.clicks)}</div>
                <RowBar value={p.clicks} max={pages[0]?.clicks} accent={i === 0} />
              </div>
            ))}
          </section>
        </div>
      </div>
    </div>
  );
}

// Status steps in ink strength: earliest lightest, the finished step full ink, lost faint, wrong details in the accent
const statusTone = (kind, st) => {
  if (st === "needs fixing") return { background: "var(--orange)", opacity: 1 };
  if (st === "lost") return { background: "var(--ink)", opacity: 0.08 };
  if (["done", "won", "live"].includes(st)) return { background: "var(--ink)", opacity: 0.85 };
  return { background: "var(--ink)", opacity: [0.18, 0.4, 0.62][KINDS[kind].statuses.indexOf(st)] ?? 0.4 };
};

// ── Outreach / Listings / Pipeline ──────────────────────────────────────────────────────────────────
function BoardTab({ kind, items, site, today, onEdit, onAdd, onMove, onExt }) {
  const k = KINDS[kind];
  const mine = items.filter((x) => x.kind === kind && (site === "all" || !x.site || x.site === site));
  const by = (st) => mine.filter((x) => x.status === st).sort((a, b) => st === "done" || st === "won" || st === "live" ? String(b.doneAt || b.updatedAt || "").localeCompare(String(a.doneAt || a.updatedAt || "")) : String(a.due || "9999").localeCompare(String(b.due || "9999")));
  const doneWord = { pipeline: "done", outreach: "won", listing: "live" }[kind];
  const overdue = mine.filter((x) => x.due && x.due < today && !["done", "won", "lost", "live"].includes(x.status)).length;
  return (
    <div className={s.fade}>
      <section className={s.card} style={{ marginBottom: 14 }}>
        <div className={s.cardHead}><Title icon={KIND_ICON[kind] || "flow"}>{k.label} by status</Title></div>
        <div className={s.statLine}>
          {k.statuses.map((st) => <div key={st} className={s.stat}><div className={s.statNum}>{by(st).length}</div><div className={s.statLabel} style={{ display: "flex", alignItems: "center", gap: 6 }}><span className={s.colDot} style={statusTone(kind, st)} />{stLabel(kind, st)}</div></div>)}
          <div className={s.stat}><div className={`${s.statNum} ${overdue ? s.accentNum : ""}`}>{overdue}</div><div className={s.statLabel} style={{ display: "flex", alignItems: "center", gap: 6 }}><Icon n="alert" size={12} />Overdue</div></div>
        </div>
        {mine.length > 0 && (
          <div className={`${s.shareBar} ${s.statusBar}`}>
            {k.statuses.map((st) => (by(st).length ? <i key={st} title={`${stLabel(kind, st)}: ${by(st).length}`} style={{ width: `${(by(st).length / mine.length) * 100}%`, ...statusTone(kind, st) }} /> : null))}
          </div>
        )}
      </section>
      <div className={s.board}>
        {k.statuses.map((st) => (
          <section key={st} className={s.col}>
            <div className={s.colHead}><span><span className={s.colDot} style={statusTone(kind, st)} />{stLabel(kind, st)}</span><span className={s.count}>{by(st).length}</span></div>
            {by(st).map((x) => {
              const i = k.statuses.indexOf(st);
              const next = k.statuses[i + 1];
              return (
                <div key={x.id} className={s.item} onClick={() => (x.source ? window.open(x.url, "_blank", "noopener") : onEdit(x))}>
                  <div className={s.itemTitle}>{x.title}</div>
                  {x.contact && <div className={s.rowMeta}>{x.contact}</div>}
                                    <div className={s.itemMeta}>
                    {x.source && <span className={`${s.siteTag} ${s.srcTag}`}>{x.source}</span>}
                    {x.source ? x.sites?.map((y) => <span key={y} className={s.siteTag}>{siteName(y)}</span>) : x.site && <span className={s.siteTag}>{siteName(x.site)}</span>}
                    {x.area && <span className={s.siteTag}>{x.area}</span>}
                    {x.source && x.label && st !== doneWord && <span className={s.siteTag}>{x.label}</span>}
                    {x.due && st !== doneWord && <span className={x.due < today ? s.overdue : ""}>{x.due < today ? "Overdue " : "Due "}{dShort(x.due)}</span>}
                    {x.doneAt && st === doneWord && <span>{cap(doneWord)} {dShort(x.doneAt)}</span>}
                    {x.owner && <span>· {x.owner}</span>}
                    {x.link && <a href={x.link} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} style={{ color: "var(--ink)", display: "inline-flex" }} aria-label="Open link"><Icon n="link" size={13} /></a>}
                    {x.src && st !== "done" && (
                      <button type="button" className={`${s.btn} ${s.btnSmall}`} style={{ marginLeft: "auto", padding: "4px 9px" }}
                        onClick={(e) => { e.stopPropagation(); if (x.src === "clickup" && st === "next") onExt("clickup", x.rid, "status", "in progress", x.title); else onExt(x.src, x.rid, "done", null, x.title); }}>
                        {x.src === "clickup" && st === "next" ? "Start" : "Done"}<Icon n={st === "next" && x.src === "clickup" ? "move" : "check"} size={12} />
                      </button>
                    )}
                    {next && next !== "lost" && !x.source && !(kind === "listing" && st === "live") && (
                      <button type="button" className={`${s.btn} ${s.btnSmall}`} style={{ marginLeft: "auto", padding: "4px 9px" }} onClick={(e) => { e.stopPropagation(); onMove(x, next); }}>
                        {stLabel(kind, next)}<Icon n="move" size={12} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
            <button type="button" className={`${s.btn} ${s.btnSmall}`} style={{ width: "100%", justifyContent: "center", background: "transparent", borderStyle: "dashed", borderColor: "rgba(0,0,0,.12)" }} onClick={() => onAdd(kind, { status: st })}>
              <Icon n="plus" size={13} />Add
            </button>
          </section>
        ))}
      </div>
    </div>
  );
}

// ── Thursday meeting ────────────────────────────────────────────────────────────────────────────────
// ── Meeting notes: type, read into points and actions, send to Asana, carry forward (lib/meeting.js) ─────────────
function MeetingNotes({ asanaTasks, today, onAsana }) {
  const [m, setM] = useState(null);
  const [date, setDate] = useState(null);
  const [text, setText] = useState(null);
  const [saveState, setSaveState] = useState("saved");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const timer = useRef(null);
  const post = async (body) => {
    const r = await fetch("/api/command", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
    return j;
  };
  useEffect(() => {
    let stop = false;
    fetch("/api/command?meeting=1", { cache: "no-store" }).then((r) => r.json()).then((j) => {
      if (stop) return;
      if (j.error) { setErr(j.error); return; }
      setM(j); setDate(j.current);
      // Unsaved typing from this browser comes back first, then the saved notes
      const draft = cache.get("cc-meet-draft-v1", 7 * 24 * HOUR);
      setText(draft && draft.date === j.current && draft.text !== (j.meetings?.[j.current]?.notes || "") ? draft.text : (j.meetings?.[j.current]?.notes || ""));
      if (draft && draft.date === j.current && draft.text !== (j.meetings?.[j.current]?.notes || "")) setSaveState("unsaved");
    }).catch((e) => { if (!stop) setErr(String(e.message || e)); });
    return () => { stop = true; };
  }, []);
  const isCurrent = m && date === m.current;
  const saveNow = async (value) => {
    setSaveState("saving");
    try { await post({ action: "meeting-notes", date: m.current, notes: value }); setSaveState("saved"); cache.del("cc-meet-draft-v1"); }
    catch (e) { setSaveState("unsaved"); setErr(String(e.message || e)); }
  };
  const type = (v) => {
    setText(v); setSaveState("unsaved");
    cache.set("cc-meet-draft-v1", { date: m.current, text: v });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => saveNow(v), 1200);
  };
  const act = async (label, body, after) => {
    setBusy(label); setErr(""); setNote("");
    try { const j = await post(body); setM((cur) => ({ ...cur, ...j })); if (after) after(j); }
    catch (e) { setErr(String(e.message || e)); }
    finally { setBusy(""); }
  };
  const readNotes = async () => {
    clearTimeout(timer.current);
    if (saveState !== "saved") await saveNow(text);
    await act("read", { action: "meeting-read", date: m.current });
  };
  if (err && !m) return <section className={s.card} style={{ marginTop: 14 }}><div className={s.err}>Meeting notes could not load: {err}</div></section>;
  if (!m) return <section className={s.card} style={{ marginTop: 14 }}><div className={s.skeleton} style={{ height: 160 }} /></section>;

  const members = m.members || [];
  const proposed = m.actions.filter((a) => a.status === "proposed" && a.meeting === m.current);
  const sent = m.actions.filter((a) => a.status === "sent");
  const byGid = new Map((asanaTasks || []).map((t) => [t.id, t]));
  const live = sent.map((a) => ({ ...a, t: byGid.get(a.asanaGid) }));
  const openActions = live.filter((a) => !a.t?.done);
  const lastMeeting = Object.keys(m.meetings).filter((d) => d < m.current).sort().pop() || null;
  const doneSince = live.filter((a) => a.t?.done && (!lastMeeting || (a.t.doneAt || "") >= lastMeeting));
  const openPoints = m.points.filter((p) => p.status === "open");
  const past = Object.keys(m.meetings).filter((d) => d !== m.current).sort().reverse();
  const shown = isCurrent ? text : (m.meetings[date]?.notes || "");
  const fmtDay = (iso) => `${DAYS_LONG[d0(iso).getUTCDay()]} ${dLong(iso)}`;

  return (
    <section className={s.card} style={{ marginTop: 14 }}>
      <div className={s.cardHead}>
        <Title icon="edit">Meeting notes, {fmtDay(date)}</Title>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {isCurrent && <span className={`${s.pill} ${saveState === "saved" ? s.pillGrey : s.pillWarn}`}>{saveState === "saved" ? "Saved" : saveState === "saving" ? "Saving" : "Not saved yet"}</span>}
          {past.length > 0 && (
            <select className={s.select} value={date} onChange={(e) => setDate(e.target.value)} aria-label="Meeting">
              <option value={m.current}>This meeting</option>
              {past.map((d) => <option key={d} value={d}>{fmtDay(d)}</option>)}
            </select>
          )}
        </div>
      </div>

      <div className={s.grid2} style={{ alignItems: "start" }}>
        {/* notes */}
        <div>
          <textarea className={s.notes} value={shown || ""} readOnly={!isCurrent} onChange={(e) => type(e.target.value)} aria-label="Meeting notes"
            placeholder={"Type as you normally would, for example:\nAnu to send the December email plan by Friday\nVishva: brand page for Calypso next week\nDiscuss: Google Ads budget for January"} />
          {isCurrent && (
            <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
              <button type="button" className={`${s.btn} ${s.btnDark}`} onClick={readNotes} disabled={!!busy || !(text || "").trim()}>
                <Icon n="sparkle" size={14} />{busy === "read" ? "Reading" : <Win win="Turn talk into action">Read notes into actions</Win>}
              </button>
              {m.meetings[m.current]?.readAt && <span className={s.rowMeta}>Last read {nzTime(m.meetings[m.current].readAt)}</span>}
            </div>
          )}
          {err && <div className={s.err}>{err}</div>}
          {note && <div className={s.rowMeta} style={{ marginTop: 8 }}>{note}</div>}
        </div>

        {/* what the notes say: actions to send, and the agenda that carries forward */}
        <div>
          {proposed.length > 0 && (
            <div style={{ marginBottom: 18 }}>
              <div className={s.miniHead}><Icon n="flow" size={13} />Actions from these notes</div>
              {proposed.map((a) => (
                <div key={a.id} className={s.actionRow}>
                  <input className={s.actionTitle} defaultValue={a.title} aria-label="Action"
                    onBlur={(e) => { if (e.target.value !== a.title) act("edit", { action: "meeting-edit", id: a.id, patch: { title: e.target.value } }); }} />
                  <div className={s.actionMeta}>
                    <select value={a.ownerGid || ""} aria-label="Owner" onChange={(e) => act("edit", { action: "meeting-edit", id: a.id, patch: { ownerGid: e.target.value } })}>
                      <option value="">No owner</option>
                      {members.map((p) => <option key={p.gid} value={p.gid}>{p.name}</option>)}
                    </select>
                    <input type="date" value={a.due || ""} aria-label="Due" onChange={(e) => act("edit", { action: "meeting-edit", id: a.id, patch: { due: e.target.value } })} />
                    <button type="button" className={s.iconBtn} style={{ width: 32, height: 32 }} aria-label={`Remove ${a.title}`} title="Remove"
                      onClick={() => act("edit", { action: "meeting-edit", id: a.id, patch: { drop: true } })}><Icon n="close" size={14} /></button>
                  </div>
                  {!a.ownerGid && <div className={s.rowMeta} style={{ color: "var(--orange-ink)" }}>Pick who does this</div>}
                </div>
              ))}
              <button type="button" className={`${s.btn} ${s.btnDark}`} style={{ marginTop: 10 }} disabled={!!busy}
                onClick={() => {
                  const ready = proposed.filter((a) => a.ownerGid);
                  if (!ready.length) { setErr("Pick an owner for each action first"); return; }
                  if (!window.confirm(`Create ${ready.length} task${ready.length > 1 ? "s" : ""} in Asana and tell each person?\n\n${ready.map((a) => `${a.title} (${a.owner}${a.due ? `, due ${dShort(a.due)}` : ""})`).join("\n")}`)) return;
                  act("send", { action: "meeting-send", ids: ready.map((a) => a.id) }, (j) => { setNote(`${j.created} sent to Asana${j.failed?.length ? `, ${j.failed.length} failed: ${j.failed.map((f) => f.error).join("; ")}` : ""}`); if (j.asana && onAsana) onAsana(j.asana); });
                }}>
                <Icon n="out" size={14} />{busy === "send" ? "Sending" : <Win win="Get everyone moving">{`Send ${proposed.filter((a) => a.ownerGid).length} to Asana`}</Win>}
              </button>
            </div>
          )}

          <div className={s.miniHead}><Icon n="calendar" size={13} />Next meeting</div>
          {openPoints.length === 0 && openActions.length === 0 && <div className={s.empty}>Nothing carried forward</div>}
          {openPoints.map((p) => (
            <div key={p.id} className={s.row}>
              <div style={{ minWidth: 0 }}><div className={s.rowTitle} style={{ fontWeight: 400 }}>{p.text}</div><div className={s.rowMeta}>To discuss · from {dShort(p.meeting)}</div></div>
              <button type="button" className={s.toggle} aria-label={`Mark discussed: ${p.text}`} title="Discussed" onClick={() => act("point", { action: "meeting-point", id: p.id, status: "resolved" })} disabled={!!busy} />
            </div>
          ))}
          {openActions.map((a) => {
            const due = a.t?.due || a.due; const late = due && due < today;
            return (
              <div key={a.id} className={s.row}>
                <div style={{ minWidth: 0 }}>
                  <a className={s.rowTitle} href={a.url} target="_blank" rel="noreferrer" style={{ color: "inherit", textDecoration: "none" }}>{a.t?.name || a.title}</a>
                  <div className={s.rowMeta}>{a.t?.owner || a.owner || "No owner"}{due ? <> · <span className={late ? s.overdue : ""}>{late ? "Overdue, " : "Due "}{dShort(due)}</span></> : ""} · from {dShort(a.meeting)}</div>
                </div>
                <span className={`${s.pill} ${s.pillGrey}`}>Open</span>
              </div>
            );
          })}
          {doneSince.length > 0 && (
            <>
              <div className={s.miniHead} style={{ marginTop: 16 }}><Icon n="check" size={13} />Done since {lastMeeting ? dShort(lastMeeting) : "the last meeting"}</div>
              {doneSince.map((a) => (
                <div key={a.id} className={s.row}>
                  <div style={{ minWidth: 0 }}><div className={s.rowTitle} style={{ fontWeight: 400 }}>{a.t?.name || a.title}</div><div className={s.rowMeta}>{a.t?.owner || a.owner} · done {a.t?.doneAt ? dShort(a.t.doneAt) : ""}</div></div>
                  <span className={`${s.pill} ${s.pillDark} ${s.pillPlain}`}><Icon n="check" size={11} stroke={2.4} /></span>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function MeetingTab({ todayNow, data, onEvents, onExt, asana, asanaTasks, external, site, items, today, w30, daily, nbClicks, searchRange, liveNow, onEdit, onAdd, onDone, saving, start, end }) {
  const t = d0(today); const wd = t.getUTCDay();
  const nextThu = addDays(today, (4 - wd + 7) % 7);
  const lastThu = addDays(nextThu, -7);
  const inSite = (x) => site === "all" || !x.site || x.site === site;
  const asanaDone = asanaTasks.filter((t) => t.done && t.doneAt && t.doneAt.slice(0, 10) >= lastThu)
    .map((t) => ({ id: `as_${t.id}`, kind: "asana", title: t.name, doneAt: t.doneAt.slice(0, 10), owner: t.owner, url: t.url, site: t.sites?.length === 1 ? t.sites[0] : "" }));
  const doneSince = [...asanaDone].sort((a, b) => b.doneAt.localeCompare(a.doneAt));
  const nextUp = [...items.filter((x) => x.kind === "pipeline" && x.status !== "done" && inSite(x)), ...external.filter((x) => x.source === "ClickUp" && x.status !== "done")]
    .sort((a, b) => String(a.due || "9999").localeCompare(String(b.due || "9999"))).slice(0, 8);
  // Every figure follows the page's date range, compared with the same number of days just before it.
  const v = [sumOf(w30.cur, "sessions"), sumOf(w30.prev, "sessions")];
  const r = [sumOf(w30.cur, "revenue"), sumOf(w30.prev, "revenue")];
  const lead = site === "worthy";
  const sd = site === "all" ? combineTraffic(data?.traffic, site, SHOPS) : daily;
  const sw = rangeWin(sd, start, end);
  const c = [sumOf(sw.cur, "conversions"), sumOf(sw.prev, "conversions")];   // conversion rate: online store orders from visits
  const ord = [sumOf(sw.cur, "orders"), sumOf(sw.prev, "orders")];           // orders shown: every online channel
  const sv = [sumOf(sw.cur, "sessions"), sumOf(sw.prev, "sessions")];
  const ew = rangeWin(combineTraffic(data?.traffic, "worthy"), start, end);
  const e = [sumOf(ew.cur, "conversions"), sumOf(ew.prev, "conversions")];
  // spend and return by month
  const spend = items.filter((x) => x.kind === "spend" && (site === "all" || x.site === site));
  /* Ad spend read automatically: Google Ads through Google Analytics, Meta ads from Meta (lib/adSpend.js), the last
     six months, added to anything typed in. Meta ads are not tied to one site, so they count under All sites only. */
  const [auto, setAuto] = useState(null);
  const spendFrom = `${addDays(`${today.slice(0, 7)}-01`, -160).slice(0, 7)}-01`;
  useEffect(() => {
    let stop = false;
    fetch(`/api/command?spend=1&start=${spendFrom}&end=${today}`, { cache: "no-store" }).then((r) => r.json()).then((j) => { if (!stop) setAuto(j); }).catch(() => {});
    return () => { stop = true; };
  }, [spendFrom, today]);
  const autoRows = [...(auto?.google?.rows || []), ...(auto?.meta?.rows || [])].filter((r) => (r.site ? site === "all" || r.site === site : site === "all"));
  const spendOf = (ym) => spend.filter((x) => x.month === ym).reduce((a, x) => a + (Number(x.amount) || 0), 0) + autoRows.filter((r) => r.month === ym).reduce((a, r) => a + r.amount, 0);
  const months = [...new Set([...spend.map((x) => x.month).filter(Boolean), ...autoRows.map((r) => r.month)])].sort().reverse().slice(0, 6);
  const byChannel = (() => { const m = new Map(); autoRows.filter((r) => r.month === months[0]).forEach((r) => m.set(r.channel, (m.get(r.channel) || 0) + r.amount)); return [...m.entries()]; })();
  /* Only what the ads themselves delivered (27 Nov 2026). The card used to divide ALL online sales by ad spend, which
     read as a $15 boosted post earning 45,470 times its cost. Visits and sales here are the ad platform's own counts. */
  const adVisits = (ym) => { const rs = autoRows.filter((r) => r.month === ym && r.visits != null); return rs.length ? rs.reduce((a, r) => a + r.visits, 0) : null; };
  const adSpendWithVisits = (ym) => autoRows.filter((r) => r.month === ym && r.visits != null).reduce((a, r) => a + r.amount, 0);
  const adSales = (ym) => { const rs = autoRows.filter((r) => r.month === ym && r.sales != null); return rs.length ? rs.reduce((a, r) => a + r.sales, 0) : null; };
  const channels = (() => {
    const m = new Map();
    pick(data?.traffic, site).forEach((t2) => (t2.channels || []).forEach((ch) => { const o = m.get(ch.name) || { name: ch.name, sessions: 0 }; o.sessions += ch.sessions; m.set(ch.name, o); }));
    return [...m.values()].sort((a, b) => b.sessions - a.sessions).slice(0, 7);
  })();
  const chMax = Math.max(1, ...channels.map((x) => x.sessions));
  return (
    <div className={s.fade}>
      <section className={s.card} style={{ marginBottom: 14 }}>
        <div className={s.cardHead}>
          <Title icon="calendar">Ecom x Marketing, {DAYS_LONG[d0(nextThu).getUTCDay()]} {dLong(nextThu)}</Title>
          <Range>{`${dShort(start)} to ${dShort(end)}`}</Range>
        </div>
        <div className={s.miniHead}><Icon n="funnel" size={13} />Visit to sale</div>
        <div className={s.statLine}>
          {/* Visit to sale: with all sites, the shops' own NZ visits, the same visits the conversion rate is worked out on (worthy.nz visits are counted with its enquiries). */}<div className={s.stat}><div className={s.statNum}>{n0(site === "all" ? sv[0] : v[0])}</div><div className={s.statLabel}>{site === "all" ? "Shop visits, NZ" : "Visits"} <Delta now={site === "all" ? sv[0] : v[0]} before={site === "all" ? sv[1] : v[1]} /></div></div>
          <div className={s.stat}><div className={s.statNum}>{sv[0] ? `${((c[0] / sv[0]) * 100).toFixed(2)}%` : "-"}</div><div className={s.statLabel}>{lead ? "Enquiry rate" : "Conversion"} <Delta now={sv[0] ? c[0] / sv[0] : null} before={sv[1] ? c[1] / sv[1] : null} points /></div></div>
          <div className={`${s.stat} ${s.kpiClick}`} onClick={() => onEvents(site === "all" ? "all" : site, start, end)}><div className={`${s.statNum} ${lead ? s.accentNum : ""}`}>{n0(lead ? c[0] : ord[0])}</div><div className={s.statLabel}>{lead ? "Enquiries" : "Orders"} <Delta now={lead ? c[0] : ord[0]} before={lead ? c[1] : ord[1]} /></div></div>
          {!lead && <div className={s.stat}><div className={`${s.statNum} ${s.accentNum}`}>{money(r[0])}</div><div className={s.statLabel}>Online sales <Delta now={r[0]} before={r[1]} /></div></div>}
          {!lead && <OnlineProfit site={site} start={start} end={end} />}
        </div>
        <div className={s.miniHead} style={{ marginTop: 20 }}><Icon n="globe" size={13} />Search, enquiries and live</div>
        <div className={s.statLine}>
          <div className={s.stat}><div className={s.statNum}>{n0(nbClicks[0])}</div><div className={s.statLabel}>Non-branded clicks <Delta now={nbClicks[0]} before={nbClicks[1]} /></div></div>
          {site === "all" && <div className={`${s.stat} ${s.kpiClick}`} onClick={() => onEvents("worthy", start, end)}><div className={s.statNum}>{n0(e[0])}</div><div className={s.statLabel}>worthy.nz enquiries <Delta now={e[0]} before={e[1]} /></div></div>}
          <div className={s.stat}><div className={s.statNum}>{n0(liveNow)}</div><div className={s.statLabel}>Live now</div></div>
        </div>
        <TodaySoFar todayNow={todayNow} site={site} />
      </section>

      <MeetingNotes asanaTasks={asanaTasks} today={today} />

      <AsanaCard asana={asana} tasks={asanaTasks} site={site} today={today} lastThu={lastThu} onExt={onExt} saving={saving} />

      <div style={{ marginTop: 14 }}>
        <section className={s.card}>
          <div className={s.cardHead}>
            <Title icon="check">Done this week</Title>
            <Range>{`Since ${dShort(lastThu)}`}</Range>
          </div>
          {doneSince.length === 0 && <div className={s.empty}>Nothing yet</div>}
          {doneSince.map((x) => (
            <div key={x.id} className={s.row} style={{ cursor: "pointer" }} onClick={() => (x.kind === "asana" ? window.open(x.url, "_blank", "noopener") : onEdit(x))}>
              <div style={{ minWidth: 0 }}><div className={s.rowTitle}>{x.title}</div><div className={s.rowMeta}>{x.kind === "asana" ? `Asana${x.owner ? ` · ${x.owner}` : ""}` : KINDS[x.kind].label}{x.site ? ` · ${siteName(x.site)}` : ""} · {dShort(x.doneAt)}</div></div>
              <span className={`${s.pill} ${s.pillDark} ${s.pillPlain}`}><Icon n="check" size={11} stroke={2.4} /></span>
            </div>
          ))}
        </section>
      </div>

      <div className={s.grid2} style={{ marginTop: 14 }}>
        <section className={s.card}>
          <div className={s.cardHead}>
            <Title icon="wallet">Ad spend and results</Title>
            <button type="button" className={`${s.btn} ${s.btnSmall}`} onClick={() => onAdd("spend", { month: today.slice(0, 7) })}><Icon n="plus" size={13} /><Win win="Track what pays off">Add spend</Win></button>
          </div>
          <div className={s.rowMeta} style={{ marginBottom: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
            {!auto && <span>Reading ad spend</span>}
            {auto && <span className={`${s.pill} ${auto.google?.linked?.length ? s.pillGrey : s.pillWarn}`}>Google Ads: {auto.google?.linked?.length ? `automatic, ${auto.google.linked.map(siteName).join(", ")}` : auto.google?.status === "ok" ? "no spend linked in Analytics" : "not read"}</span>}
            {auto && <span className={`${s.pill} ${auto.meta?.status === "ok" ? s.pillGrey : s.pillWarn}`}>Meta ads: {auto.meta?.status === "ok" ? "automatic" : (auto.meta?.reason || "not connected")}</span>}
          </div>
          {months.length === 0 && <div className={s.empty}>Nothing yet</div>}
          {months.length > 0 && (
            <div className={s.tableWrap}>
              <table className={s.table}>
                <thead><tr><th>Month</th><th className={s.num}>Spend</th><th className={s.num}>Visits from ads</th><th className={s.num}>Cost a visit</th><th className={s.num}>Sales from ads</th></tr></thead>
                <tbody>
                  {months.map((ym) => {
                    const sp = spendOf(ym), vis = adVisits(ym), sw = adSpendWithVisits(ym), sl = adSales(ym);
                    return (
                      <tr key={ym}>
                        <td>{monthLabel(ym)}</td>
                        <td className={s.num}>{money(sp)}</td>
                        <td className={s.num}>{vis != null ? n0(vis) : "-"}</td>
                        <td className={s.num}>{vis ? `$${(sw / vis).toFixed(2)}` : "-"}</td>
                        <td className={s.num}>{sl ? `${money(sl)} · ${(sl / sp).toFixed(1)}x` : "None tracked"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {byChannel.length > 0 && <div style={{ marginTop: 12 }}>{byChannel.map(([ch, amt]) => (
            <div key={ch} className={s.row}>
              <div style={{ minWidth: 0 }}><div className={s.rowTitle}>{ch}</div><div className={s.rowMeta}>Automatic · {monthLabel(months[0])}</div></div>
              <div className={s.rowNum} style={{ fontSize: 17 }}>{money(amt)}</div>
            </div>
          ))}</div>}
          {spend.length > 0 && <div style={{ marginTop: 12 }}>{spend.slice(0, 6).map((x) => (
            <div key={x.id} className={s.row} style={{ cursor: "pointer" }} onClick={() => onEdit(x)}>
              <div style={{ minWidth: 0 }}><div className={s.rowTitle}>{x.title}</div><div className={s.rowMeta}>{siteName(x.site) || "All of Worthy"}{x.month ? ` · ${monthLabel(x.month)}` : ""}</div></div>
              <div className={s.rowNum} style={{ fontSize: 17 }}>{money(Number(x.amount) || 0)}</div>
            </div>
          ))}</div>}
        </section>

        <section className={s.card}>
          <div className={s.cardHead}>
            <Title icon="compass">Where visits come from</Title>
            <Range>30 days</Range>
          </div>
          {channels.length === 0 && <div className={s.empty}>{site === "worthyproducts" ? "No data" : data ? "No data" : ""}</div>}
          <div className={s.bars}>
            {channels.map((ch, i) => (
              <div key={ch.name} className={s.barRow}>
                <span style={{ overflowWrap: "anywhere" }}>{ch.name}</span>
                <div className={s.barTrack}><div className={`${s.barInk} ${i === 0 ? s.barAccent : ""}`} style={{ width: `${(ch.sessions / chMax) * 100}%` }} /></div>
                <span className={s.num}>{n0(ch.sessions)}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

// ── Asana: Ecom x Marketing ─────────────────────────────────────────────────────────────────────────
function AsanaCard({ asana, tasks, site, today, lastThu, onExt, saving }) {
  const [editDue, setEditDue] = useState(null);
  const [noteFor, setNoteFor] = useState(null);
  const [note, setNote] = useState("");
  const [view, setView] = useState("open");
  const [person, setPerson] = useState("all");
  const [openIds, setOpenIds] = useState({});
  const ok = asana?.status === "ok";
  const open = tasks.filter((t) => !t.done);
  const late = open.filter((t) => t.due && t.due < today);
  const doneWk = tasks.filter((t) => t.done && t.doneAt && t.doneAt.slice(0, 10) >= lastThu);
  const who = (t) => t.owner || "Unassigned";
  const people = [...new Set(open.map(who))].map((n) => ({
    name: n, open: open.filter((t) => who(t) === n).length, late: late.filter((t) => who(t) === n).length,
  })).sort((a, b) => b.open - a.open);
  const base = view === "open" ? open : view === "late" ? late : view === "done" ? doneWk : tasks;
  const shown = base.filter((t) => person === "all" || who(t) === person)
    .sort((a, b) => (a.done - b.done) || String(a.due || "9999").localeCompare(String(b.due || "9999")));
  return (
    <section className={s.card} style={{ marginTop: 14 }}>   {/* 14px like every card (docs/DESIGN-PLAYBOOK.md) */}
      <div className={s.cardHead}>
        <Title icon="users">Meeting tasks</Title>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {ok && <span className={`${s.pill} ${asana.stale ? s.pillAccent : s.pillInk}`}>{asana.stale ? "Delayed" : "Live from Asana"}</span>}
          {asana && !ok && <span className={`${s.pill} ${s.pillAccent}`}>{asana.status === "not_connected" ? "Asana not connected" : "Asana offline"}</span>}
          <a className={`${s.btn} ${s.btnSmall}`} href={`https://app.asana.com/0/${ASANA_PROJECT}/list`} target="_blank" rel="noreferrer"><Icon n="out" size={13} />Asana</a>
        </div>
      </div>
      {!asana && <div className={s.skeleton} style={{ height: 120 }} />}
      {ok && (
        <>
          <div className={s.people}>
            <button type="button" className={`${s.person} ${person === "all" ? s.personOn : ""}`} onClick={() => setPerson("all")}>
              <span className={s.personAv}>All</span><span><span className={s.personName}>Everyone</span><br /><b>{open.length}</b> open</span>
            </button>
            {people.map((p) => (
              <button key={p.name} type="button" className={`${s.person} ${person === p.name ? s.personOn : ""}`} onClick={() => setPerson(person === p.name ? "all" : p.name)}>
                <span className={s.personAv}>{initialsOf(p.name)}</span>
                <span><span className={s.personName}>{p.name.replace(/@.*/, "")}</span><br /><b>{p.open}</b> open{p.late ? <span className={s.overdue}> · {p.late} late</span> : null}</span>
              </button>
            ))}
          </div>
          {open.length + doneWk.length > 0 && (
            <div className={s.shareBar} style={{ marginTop: 14 }} role="img" aria-label="Overdue, open and done this week">

              {late.length > 0 && <i style={{ width: `${(late.length / (open.length + doneWk.length)) * 100}%`, background: "var(--orange)" }} />}
              {open.length - late.length > 0 && <i style={{ width: `${((open.length - late.length) / (open.length + doneWk.length)) * 100}%`, background: "var(--ink)", opacity: 0.35 }} />}
              {doneWk.length > 0 && <i style={{ width: `${(doneWk.length / (open.length + doneWk.length)) * 100}%`, background: "var(--ink)", opacity: 0.85 }} />}
            </div>
          )}
          <div className={s.seg} style={{ margin: "14px 0 6px" }}>
            {[["open", `Open ${open.length}`], ["late", `Overdue ${late.length}`], ["done", `Done this week ${doneWk.length}`], ["all", "All"]].map(([id, l]) => <button key={id} type="button" className={view === id ? s.segOn : ""} onClick={() => setView(id)}>{l}</button>)}
          </div>
          {shown.length === 0 && <div className={s.empty}>Nothing here</div>}
          {shown.slice(0, 60).map((t) => {
            const subDone = t.subtasks.filter((x) => x.done).length;
            const isOpen = openIds[t.id];
            return (
              <div key={t.id} className={s.task}>
                <div className={s.taskMain}>
                  <button type="button" className={`${s.check} ${t.done ? s.checkOn : ""}`} disabled={saving} title={t.done ? "Reopen in Asana" : "Mark done in Asana"} aria-label={t.done ? `Reopen ${t.name}` : `Mark ${t.name} done`} onClick={() => onExt("asana", t.id, t.done ? "reopen" : "done", null, t.name)}>{t.done && <Icon n="check" size={11} stroke={2.6} />}</button>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <a className={s.taskName} href={t.url} target="_blank" rel="noreferrer">{t.name}</a>
                    <div className={s.itemMeta} style={{ marginTop: 6 }}>
                      <span className={s.ownerChip}><span className={s.personAvSm}>{initialsOf(t.owner || "?")}</span>{t.owner ? t.owner.replace(/@.*/, "") : "Unassigned"}</span>
                      {t.done ? <span>Done {dShort(t.doneAt)}</span> : editDue === t.id
                        ? <input type="date" className={s.dateIn} autoFocus defaultValue={t.due || ""} onBlur={() => setEditDue(null)} onChange={async (e) => { const v = e.target.value; setEditDue(null); if (v !== t.due) await onExt("asana", t.id, "due", v, t.name); }} />
                        : <button type="button" className={`${s.linkBtn} ${t.due && t.due < today ? s.overdue : ""}`} title="Change due date in Asana" onClick={() => setEditDue(t.id)}>{t.due ? `${t.due < today ? "Overdue " : "Due "}${dShort(t.due)}` : "Set due date"}</button>}
                      <button type="button" className={s.linkBtn} onClick={() => { setNoteFor(noteFor === t.id ? null : t.id); setNote(""); }}>Note</button>
                      {site === "all" && t.sites?.map((x) => <span key={x} className={s.siteTag}>{siteName(x)}</span>)}
                      {t.priority && <span className={s.siteTag}>{t.priority}</span>}
                    </div>
                  </div>
                  <span className={`${s.pill} ${statusCls(t.done ? "Done" : t.status)}`}>{t.done ? "Done" : t.status || "Open"}</span>
                </div>
                {noteFor === t.id && (
                  <form className={s.noteRow} onSubmit={async (e) => { e.preventDefault(); if (!note.trim()) return; if (await onExt("asana", t.id, "comment", note.trim(), t.name)) { setNoteFor(null); setNote(""); } }}>
                    <input autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note to this task in Asana" />
                    <button type="submit" className={`${s.btn} ${s.btnSmall} ${s.btnDark}`} disabled={saving}>Send</button>
                  </form>
                )}
                {t.subtaskCount > 0 && (
                  <button type="button" className={s.subToggle} onClick={() => setOpenIds({ ...openIds, [t.id]: !isOpen })}>
                    <span className={s.barTrack} style={{ width: 80, display: "inline-block" }}><span className={s.barInk} style={{ display: "block", width: `${t.subtasks.length ? (subDone / t.subtasks.length) * 100 : 0}%` }} /></span>
                    {t.subtasks.length ? `${subDone} of ${t.subtasks.length} subtasks` : `${t.subtaskCount} subtasks`}
                    <Icon n={isOpen ? "up" : "down"} size={12} />
                  </button>
                )}
                {isOpen && t.subtasks.map((x) => (
                  <div key={x.id} className={s.subRow}>
                    <button type="button" className={`${s.check} ${x.done ? s.checkOn : ""}`} disabled={saving} aria-label={x.done ? `Reopen ${x.name}` : `Mark ${x.name} done`} onClick={() => onExt("asana", x.id, x.done ? "reopen" : "done", null, x.name)}>{x.done && <Icon n="check" size={10} stroke={2.6} />}</button>
                    <a href={x.url} target="_blank" rel="noreferrer" className={s.subName} style={{ textDecoration: x.done ? "line-through" : "none" }}>{x.name}</a>
                    <span className={s.rowMeta} style={{ marginTop: 0, whiteSpace: "nowrap" }}>{x.owner ? x.owner.replace(/@.*/, "") : ""}{x.due && !x.done ? ` · ${dShort(x.due)}` : ""}</span>
                  </div>
                ))}
              </div>
            );
          })}
        </>
      )}
    </section>
  );
}

// ── who converted: every enquiry or order GA4 recorded ───────────────────────────────────────────────
const EVENT_LABEL = { contact: "Contact form", purchase: "Order", generate_lead: "Enquiry", form_submit: "Form", shop_click: "Shop click", sign_up: "Sign-up", phone_click: "Phone call", email_click: "Email click" };
function EventsModal({ ev, onClose }) {
  const [kind, setKind] = useState("all");
  const [openEntry, setOpenEntry] = useState(null);
  const kinds = [...new Set(ev.rows.map((r) => r.event))];
  const rows = ev.rows.filter((r) => kind === "all" || r.event === kind);
  const when = (at) => { const d = d0(at.slice(0, 10)); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}, ${at.slice(11, 16)}`; };
  const pages = Object.entries(rows.reduce((m, r) => ({ ...m, [r.page]: (m[r.page] || 0) + r.count }), {})).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const gaTotal = rows.reduce((a, r) => a + r.count, 0);
  const label = (e) => EVENT_LABEL[e] || cap(String(e).replace(/_/g, " "));

  /* worthy.nz: the form entries are the record of who enquired. Each entry is paired with the nearest Google Analytics
     event within 3 minutes, one to one (closest pairs first), so two people a few minutes apart are never given the same
     visit and no visit is used twice (26 Nov 2026: the old first-match rule showed one person against another's entry). */
  const entries = ev.forms?.status === "ok" ? ev.forms.entries : [];
  const showForms = ev.site === "worthy" || ev.site === "all";
  const mins = (t) => Date.parse(`${String(t).replace(" ", "T").slice(0, 16)}:00Z`) / 60000;
  const match = (() => {
    const gaRows = ev.rows.map((r, i) => ({ ...r, i })).filter((r) => r.site === "worthy");
    const pairs = [];
    entries.forEach((e) => gaRows.forEach((r) => { const gap = Math.abs(mins(e.at) - mins(r.at)); if (gap <= 3) pairs.push({ e: e.id, r: r.i, gap }); }));
    pairs.sort((a, b) => a.gap - b.gap);
    const byEntry = new Map(), used = new Map();
    for (const p of pairs) {
      if (byEntry.has(p.e)) continue;
      const cap1 = ev.rows[p.r].count || 1;
      if ((used.get(p.r) || 0) >= cap1) continue;
      byEntry.set(p.e, ev.rows[p.r]); used.set(p.r, (used.get(p.r) || 0) + 1);
    }
    const leftover = ev.rows.filter((r, i) => r.site === "worthy" && (used.get(i) || 0) < (r.count || 1))
      .map((r) => ({ ...r, left: (r.count || 1) - (used.get(ev.rows.indexOf(r)) || 0) }));
    return { byEntry, leftover };
  })();
  /* Why the two counts differ, worked out every time (Pratham, 26 Nov 2026: "it should automatically explain what and
     why and what to do"). An entry is called likely spam only when Google Analytics saw no visit for it AND it carries a
     clear sign (mostly non-Latin script, the same text in name, surname and company, or several links), so a real
     person is never marked as spam. */
  const spamSigns = (e) => {
    const f = e.fields || {};
    const text = Object.values(f).map(String).join(" ");
    const letters = text.replace(/[^A-Za-z\u0400-\u04FF\u0600-\u06FF\u4E00-\u9FFF]/g, "");
    const foreign = letters ? letters.replace(/[A-Za-z]/g, "").length / letters.length : 0;
    const names = [f["first-name"], f["last-name"], f["company-name"]].filter(Boolean).map((x) => String(x).trim().toLowerCase());
    const links = (text.match(/https?:\/\//gi) || []).length;
    const signs = [];
    if (foreign > 0.3) signs.push("written mostly in another script");
    if (names.length >= 3 && new Set(names).size === 1) signs.push("same text in name, surname and company");
    if (links >= 2) signs.push(`${links} links in the message`);
    return signs;
  };
  const unmatched = entries.filter((e) => !match.byEntry.has(e.id)).map((e) => ({ e, signs: spamSigns(e) }));
  const spamIds = new Set(unmatched.filter((x) => x.signs.length).map((x) => x.e.id));
  const missed = unmatched.filter((x) => !x.signs.length);
  const extraGa = match.leftover.reduce((t, r) => t + (r.left || 1), 0);
  const realCount = entries.length - spamIds.size;
  const showGaTable = !showForms || ev.site === "all";
  const gaRowsShown = ev.site === "all" ? rows.filter((r) => r.site !== "worthy") : rows;

  return (
    <div className={s.scrim} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`${s.modal} ${s.modalWide} ${s.fade}`} role="dialog" aria-modal="true" aria-label={ev.site === "worthy" ? "Enquiries" : "Conversions"}>
        <div className={s.cardHead}>
          <Title as="h3" className={s.modalTitle} style={{ margin: 0 }} icon={ev.site === "worthy" ? "mail" : "target"}>{ev.site === "worthy" ? "Enquiries" : "Conversions"} · {siteName(ev.site)}</Title>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}><Range>{`${dShort(ev.start)} to ${dLong(ev.end)}`}</Range><button type="button" className={s.iconBtn} onClick={onClose} aria-label="Close" style={{ width: 34, height: 34 }}><Icon n="close" size={16} /></button></div>
        </div>
        {ev.loading && <div className={s.skeleton} style={{ height: 160 }} />}
        {!ev.loading && (
          <>
            {/* headline: the record first, Google Analytics beside it, then the pages */}
            <div className={s.grid2} style={{ marginBottom: 22, alignItems: "start" }}>
              <div className={s.statLine}>
                {showForms && ev.forms?.status === "ok" && (
                  <>
                    <div className={s.stat}><div className={`${s.statNum} ${s.accentNum}`} style={{ fontSize: 40 }}>{n0(realCount)}</div><div className={s.statLabel}>Real enquiries</div></div>
                    <div className={s.stat}><div className={s.statNum}>{n0(entries.length)}</div><div className={s.statLabel}>Form entries{spamIds.size ? `, ${spamIds.size} likely spam` : ""}</div></div>
                  </>
                )}
                <div className={s.stat}><div className={s.statNum} style={showForms && ev.forms?.status === "ok" ? undefined : { fontSize: 40, color: "var(--orange-ink)" }}>{n0(gaTotal)}</div><div className={s.statLabel}>{ev.site === "worthy" ? "Recorded by Google Analytics" : "Conversions recorded by Google Analytics"}</div></div>
              </div>
              {pages.length > 0 && (
                <div>
                  <div className={s.miniHead}><Icon n="eye" size={13} />Pages they used</div>
                  <div className={s.bars}>
                    {pages.map(([pg, n], i) => (
                      <div key={pg} className={s.barRow}>
                        <span style={{ overflowWrap: "anywhere" }}>{pg}</span>
                        <div className={s.barTrack}><div className={`${s.barInk} ${i === 0 ? s.barAccent : ""}`} style={{ width: `${(n / pages[0][1]) * 100}%` }} /></div>
                        <span className={s.num}>{n}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {showForms && (
              <section style={{ marginBottom: 22 }}>
                <div className={s.cardHead} style={{ marginBottom: 8 }}>
                  <Title as="h3" icon="users">Enquiries, one row per person</Title>
                  {ev.forms?.status !== "ok" && <span className={`${s.pill} ${s.pillGrey}`}>{ev.forms?.status === "not_connected" ? "Not connected yet" : "worthy.nz offline"}</span>}
                </div>
                {ev.forms?.status === "ok" && entries.length === 0 && <div className={s.empty}>None in this period</div>}
                {ev.forms?.status === "ok" && (unmatched.length > 0 || extraGa > 0) && (
                  <div className={s.explain}>
                    <div className={s.explainHead}><Icon n="alert" size={15} />Why the counts differ: {n0(entries.length)} form entries, {n0(gaTotal)} in Google Analytics</div>
                    {spamIds.size > 0 && (
                      <div className={s.explainItem}>
                        <b>{spamIds.size} likely spam</b> ({unmatched.filter((x) => x.signs.length).map((x) => `${x.e.name || x.e.email}, ${when(x.e.at.replace(" ", "T"))}: ${x.signs.join(", ")}`).join("; ")}).
                        {" "}Bots post straight to the form without opening the page, so Google Analytics never sees them, and they are not counted as real enquiries.
                        <div className={s.explainDo}><Icon n="check" size={12} />To stop them: add a spam check to the worthy.nz forms (a hidden honeypot field or Cloudflare Turnstile).</div>
                      </div>
                    )}
                    {missed.length > 0 && (
                      <div className={s.explainItem}>
                        <b>{missed.length} real {missed.length === 1 ? "person" : "people"} Google Analytics missed</b> ({missed.map((x) => `${x.e.name || x.e.email}, ${when(x.e.at.replace(" ", "T"))}`).join("; ")}). Usually the browser blocked Google Analytics: an ad blocker, private browsing, or cookies declined.
                        <div className={s.explainDo}><Icon n="check" size={12} />To record every enquiry: send it to Google Analytics from the website when the form is saved (server side), not from the visitor&apos;s browser.</div>
                      </div>
                    )}
                    {extraGa > 0 && (
                      <div className={s.explainItem}>
                        <b>{extraGa} in Google Analytics with no saved form entry</b> (listed below the table). The form may have failed to save, or it was a test.
                        <div className={s.explainDo}><Icon n="check" size={12} />Check the worthy.nz form log for those times.</div>
                      </div>
                    )}
                  </div>
                )}
                {entries.length > 0 && (
                  <div className={s.tableWrap}>
                    <table className={s.table}>
                      <thead><tr><th>When</th><th>Person</th><th>Form</th><th className={s.hideSm}>Page</th><th className={s.hideSm}>Came from</th><th className={s.hideSm}>Town, device</th><th className={s.hideSm}>Emailed to</th></tr></thead>
                      <tbody>{entries.map((e) => {
                        const g = match.byEntry.get(e.id);
                        const open = openEntry === e.id;
                        return (
                          <Fragment key={e.id}>
                            <tr style={{ cursor: "pointer", opacity: spamIds.has(e.id) ? 0.55 : 1 }} onClick={() => setOpenEntry(open ? null : e.id)} aria-expanded={open}>
                              <td style={{ whiteSpace: "nowrap" }}>{when(e.at.replace(" ", "T"))}</td>
                              <td style={{ minWidth: 190 }}>
                                <div style={{ fontWeight: 500 }}>{e.name || "-"}{spamIds.has(e.id) && <span className={`${s.pill} ${s.pillGrey}`} style={{ marginLeft: 8 }}>Likely spam</span>}</div>
                                {e.business && <div className={s.rowMeta} style={{ marginTop: 2 }}>{e.business}</div>}
                                {e.email && <a href={`mailto:${e.email}`} onClick={(x) => x.stopPropagation()} style={{ fontSize: 13.5, color: "var(--ink2)", textDecoration: "underline", textDecorationColor: "rgba(20,22,20,.3)", textUnderlineOffset: 3, wordBreak: "break-all" }}>{e.email}</a>}
                              </td>
                              <td style={{ minWidth: 130 }}>{e.form}</td>
                              <td className={s.hideSm} style={{ whiteSpace: "nowrap" }}>{g ? g.page : "-"}</td>
                              <td className={s.hideSm}>{g ? g.source : "-"}</td>
                              <td className={s.hideSm} style={{ whiteSpace: "nowrap" }}>{g ? [g.city !== "(not set)" ? g.city : "", cap(g.device)].filter(Boolean).join(", ") : "-"}</td>
                              <td className={s.hideSm} style={{ fontSize: 13.5, color: "var(--ink2)" }}>{e.to}{e.cc ? `, cc ${e.cc}` : ""}</td>
                            </tr>
                            {open && (
                              <tr><td colSpan={7} style={{ paddingTop: 0 }}>
                                <div className={s.entryBox}>{Object.entries(e.fields).map(([k, v]) => <div key={k}><b>{cap(k.replace(/[-_]/g, " "))}</b> {String(v)}</div>)}</div>
                              </td></tr>
                            )}
                          </Fragment>
                        );
                      })}</tbody>
                    </table>
                  </div>
                )}
                {ev.forms?.status === "ok" && match.leftover.length > 0 && (
                  <div style={{ marginTop: 18 }}>
                    <div className={s.miniHead}><Icon n="alert" size={13} />In Google Analytics, no form entry</div>
                    <div className={s.tableWrap}>
                      <table className={s.table}>
                        <thead><tr><th>When</th><th>What</th><th>Page</th><th className={s.hideSm}>Came from</th><th className={s.hideSm}>Town</th><th className={s.hideSm}>Device</th></tr></thead>
                        <tbody>{match.leftover.map((r, i) => (
                          <tr key={i}><td style={{ whiteSpace: "nowrap" }}>{when(r.at)}</td><td>{label(r.event)}{r.left > 1 ? ` x${r.left}` : ""}</td><td style={{ overflowWrap: "anywhere" }}>{r.page}</td><td className={s.hideSm}>{r.source}</td><td className={s.hideSm}>{r.city === "(not set)" ? "-" : r.city}</td><td className={s.hideSm}>{cap(r.device)}</td></tr>
                        ))}</tbody>
                      </table>
                    </div>
                  </div>
                )}
              </section>
            )}

            {showGaTable && (
              <section>
                <div className={s.cardHead} style={{ marginBottom: 8 }}>
                  <Title as="h3" icon="target">{ev.site === "all" ? "Shop conversions recorded by Google Analytics" : "Conversions recorded by Google Analytics"}</Title>
                </div>
                {kinds.length > 1 && <div className={s.seg} style={{ marginBottom: 10 }}>{[["all", "All"], ...kinds.map((k) => [k, label(k)])].map(([id, l]) => <button key={id} type="button" className={kind === id ? s.segOn : ""} onClick={() => setKind(id)}>{l}</button>)}</div>}
                {gaRowsShown.length === 0 && <div className={s.empty}>None in this period</div>}
                {gaRowsShown.length > 0 && (
                  <div className={s.tableWrap}>
                    <table className={s.table}>
                      <thead><tr><th>When</th><th>What</th>{ev.site === "all" && <th>Site</th>}<th>Page</th><th className={s.hideSm}>Came from</th><th className={s.hideSm}>Town</th><th className={s.hideSm}>Device</th></tr></thead>
                      <tbody>{gaRowsShown.map((r, i) => (
                        <tr key={i}>
                          <td style={{ whiteSpace: "nowrap" }}>{when(r.at)}</td>
                          <td>{label(r.event)}{r.count > 1 ? ` x${r.count}` : ""}</td>
                          {ev.site === "all" && <td><span className={s.siteTag}>{siteName(r.site)}</span></td>}
                          <td style={{ overflowWrap: "anywhere" }}>{r.page}</td>
                          <td className={s.hideSm}>{r.source}</td>
                          <td className={s.hideSm}>{r.city === "(not set)" ? "-" : r.city}</td>
                          <td className={s.hideSm}>{cap(r.device)}</td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── AI search: how each AI assistant shows the sites ────────────────────────────────────────────────
const AI_ENGINES = [["claude", "Claude"], ["chatgpt", "ChatGPT"], ["gemini", "Gemini"], ["perplexity", "Perplexity"], ["copilot", "Copilot"]];
const engCell = (r) => {
  if (!r || r.status === "no_key") return { cls: s.pillGrey, t: "Add key" };
  if (r.status === "error") return { cls: s.pillGrey, t: "Failed" };
  if (r.status === "refused") return { cls: s.pillGrey, t: "No answer" };
  if (r.mentioned && r.cited) return { cls: s.pillDark, t: "Named, linked" };
  if (r.mentioned) return { cls: s.pillInk, t: "Named" };
  if (r.cited) return { cls: s.pillInk, t: "Linked" };
  return { cls: s.pillAccent, t: "Not shown" };
};

function AiSearch({ site, start, end, onAdd, data }) {
  const [ai, setAi] = useState(null);
  const [shop, setShop] = useState(null);
  const [checking, setChecking] = useState(false);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState(null);
  const [now] = useState(() => Date.now());
  const check = useCallback(async (force) => {
    setChecking(true); setErr("");
    try {
      const r = await fetch("/api/command", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "ai-check", force }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Check failed");
      setAi((x) => ({ ...(x || {}), latest: j.latest, history: j.history }));
    } catch (e) { setErr(String(e.message || e)); }
    finally { setChecking(false); }
  }, []);
  useEffect(() => {
    let stop = false;
    fetch(`/api/command?ai=1&start=${start}&end=${end}`, { cache: "no-store" }).then((r) => r.json()).then((j) => {
      if (stop) return;
      setAi(j);
      if (!j.latest?.at || now - Date.parse(j.latest.at) > 24 * 3600000) check(false);   // ask again when over a day old
    }).catch((e) => setErr(String(e.message || e)));
    fetch(`/api/command?shopping=1&start=${start}&end=${end}&gscStart=${start}&gscEnd=${end}`, { cache: "no-store" }).then((r) => r.json()).then((j) => { if (!stop) setShop(j); }).catch(() => {});
    return () => { stop = true; };
  }, [start, end, check, now]);

  const inSite = (x) => site === "all" || x.id === site || x.site === site;
  const refs = (ai?.referrals || []).filter((x) => x.status === "ok" && inSite(x));
  const visitsBy = {};
  refs.forEach((x) => x.assistants.forEach((a) => { const o = visitsBy[a.name] || { sessions: 0, conversions: 0 }; o.sessions += a.sessions; o.conversions += a.conversions; visitsBy[a.name] = o; }));
  const pages = refs.flatMap((x) => x.pages.map((p) => ({ ...p, site: x.id }))).sort((a, b) => b.sessions - a.sessions).slice(0, 12);
  const results = (ai?.latest?.results || []).filter((x) => site === "all" || x.site === site);
  const chatgptChannel = (shop?.channels?.channels || []).filter((c) => /chatgpt|openai/i.test(c.name));
  const cgOrders = chatgptChannel.reduce((a, c) => a + c.orders, 0), cgSales = chatgptChannel.reduce((a, c) => a + c.sales, 0);
  const showChannel = site === "all" || site === "worthyproducts";

  // One card per assistant: answers that show us, visits it sent, what they did
  const engines = AI_ENGINES.map(([id, name]) => {
    const rs = results.map((x) => x.engines?.[id]).filter(Boolean);
    const ok = rs.filter((r) => r.status === "ok");
    const v = visitsBy[name] || { sessions: 0, conversions: 0 };
    return { id, name, asked: ok.length, named: ok.filter((r) => r.mentioned).length, linked: ok.filter((r) => r.cited).length, connected: id !== "copilot" && rs.some((r) => r.status !== "no_key"), visits: v.sessions, conversions: v.conversions };
  });

  const questions = pick(data?.search, site).flatMap((x) => x.queries.map((q) => ({ ...q, site: x.id })))
    .filter((q) => /^(how|what|where|who|which|why|when|best|can|is|are|does|do)\b|\?/i.test(q.query)).sort((a, b) => b.impressions - a.impressions).slice(0, 10);

  // What to work on, worked out from the above
  const actions = [];
  results.forEach((x) => {
    const missing = AI_ENGINES.filter(([id]) => x.engines?.[id]?.status === "ok" && !x.engines[id].mentioned && !x.engines[id].cited).map(([, n]) => n);
    if (missing.length) {
      const others = [...new Set(AI_ENGINES.flatMap(([id]) => x.engines?.[id]?.others || []))].slice(0, 3);
      actions.push({ key: `nm-${x.id}`, site: x.site, title: `Not shown by ${missing.join(", ")} for "${x.q}"`, detail: `${others.length ? `They point to ${others.join(", ")}. ` : ""}Answer this question clearly on ${siteName(x.site)} (a page or FAQ).` });
    }
    if (AI_ENGINES.some(([id]) => x.engines?.[id]?.staleNelson)) actions.push({ key: `ne-${x.id}`, site: x.site, title: "AI still says Dutch Rusk is in Nelson", detail: `For "${x.q}". The old Nelson listings feed this; see Listings.` });
  });
  pages.filter((p) => p.sessions >= 5 && p.conversions === 0).slice(0, 4).forEach((p) => actions.push({ key: `lp-${p.site}-${p.page}`, site: p.site, title: `${p.sessions} visits from ${p.assistant} to ${p.page}, nothing came of it`, detail: "Make the next step obvious on that page (trade sign-up, enquiry or shop button)." }));
  questions.filter((q) => q.position > 10 && q.impressions >= 20).slice(0, 3).forEach((q) => actions.push({ key: `gq-${q.site}-${q.query}`, site: q.site, title: `People ask "${q.query}" and we sit at ${n1(q.position)}`, detail: `${n0(q.impressions)} searches. Answer it plainly on ${siteName(q.site)}; AI assistants read the same pages.` }));

  const doneAt = ai?.latest?.at;
  // Google AI Overviews / AI Mode, from Search Console's Generative AI report
  const gai = Object.entries(ai?.googleAi || {}).filter(([id]) => site === "all" || id === site).map(([id, v]) => ({ id, ...v }));
  const gaiTotal = gai.reduce((a, x) => a + x.impressions, 0);
  const gaiPages = gai.flatMap((x) => x.pages.map((p) => ({ ...p, site: x.id }))).sort((a, b) => b.impressions - a.impressions).slice(0, 12);
  return (
    <div className={s.fade}>
      <div className={s.engineGrid}>
        <section className={s.card}>
          <div className={s.cardHead} style={{ marginBottom: 8 }}><Title icon="search">Google AI</Title><span className={`${s.pill} ${gai.length ? s.pillInk : s.pillGrey}`}>{gai.length ? "Search Console" : "No figures yet"}</span></div>
          <div className={`${s.statLine} ${s.statTight}`}>
            <div className={s.stat}><div className={s.statNum}>{gai.length ? (gai.length === 1 ? gai[0].shown : n0(gaiTotal)) : "-"}</div><div className={s.statLabel}>Times shown in AI Overviews and AI Mode</div></div>
            {gai[0] && <div className={s.stat}><div className={s.statNum} style={{ fontSize: 14, fontWeight: 400 }}>{dShort(gai[0].start)} to {dShort(gai[0].end)}</div><div className={s.statLabel}>Period</div></div>}
          </div>
        </section>
        {engines.map((e) => (
          <section key={e.id} className={s.card}>
            <div className={s.cardHead} style={{ marginBottom: 8 }}><Title icon="sparkle">{e.name}</Title>
              {e.id === "copilot" ? <span className={`${s.pill} ${s.pillGrey}`}>Visits only</span> : e.connected ? <span className={`${s.pill} ${s.pillInk}`}>Asked</span> : <span className={`${s.pill} ${s.pillGrey}`}>Add key</span>}
            </div>
            <div className={`${s.statLine} ${s.statTight}`}>
              <div className={s.stat}><div className={`${s.statNum} ${e.asked ? s.accentNum : ""}`}>{e.asked ? `${e.named}/${e.asked}` : "-"}</div><div className={s.statLabel}>Answers name us</div>{e.asked > 0 && <Meter value={e.named} max={e.asked} accent />}</div>
              <div className={s.stat}><div className={s.statNum}>{e.asked ? `${e.linked}/${e.asked}` : "-"}</div><div className={s.statLabel}>Link our site</div>{e.asked > 0 && <Meter value={e.linked} max={e.asked} />}</div>
              <div className={s.stat}><div className={s.statNum}>{ai ? n0(e.visits) : "-"}</div><div className={s.statLabel}>Visits{e.conversions ? `, ${n0(e.conversions)} converted` : ""}</div></div>
              {e.id === "chatgpt" && showChannel && <div className={s.stat}><div className={s.statNum}>{shop ? n0(cgOrders) : "-"}</div><div className={s.statLabel}>ChatGPT orders{cgSales ? `, ${money(cgSales)}` : ""}</div></div>}
            </div>
          </section>
        ))}
      </div>
      {err && <div className={s.err} style={{ margin: "10px 4px" }}>{err}</div>}
      <div className={s.grid}>
        <div className={s.stack}>
          <section className={s.card}>
            <div className={s.cardHead}>
              <Title icon="sparkle">What each AI tells customers</Title>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                {doneAt && <Range>{`Checked ${dShort(new Date(doneAt).toLocaleDateString("en-CA", { timeZone: "Pacific/Auckland" }))}, ${nzTime(doneAt)}`}</Range>}
                <button type="button" className={`${s.btn} ${s.btnSmall}`} onClick={() => check(true)} disabled={checking}><Icon n="refresh" size={13} className={checking ? s.spin : ""} />{checking ? "Checking" : "Check now"}</button>
              </div>
            </div>
            {!ai && <div className={s.skeleton} style={{ height: 200 }} />}
            {ai && results.length === 0 && <div className={s.empty}>{checking ? "Asking now, about a minute" : "No checks yet"}</div>}
            {results.length > 0 && (
              <div className={s.tableWrap}>
                <table className={s.table}>
                  <thead><tr><th>Question</th>{site === "all" && <th className={s.hideSm}>Site</th>}{AI_ENGINES.filter(([id]) => id !== "copilot").map(([id, n]) => <th key={id}>{n}</th>)}</tr></thead>
                  <tbody>{results.map((x) => (
                    <tr key={x.id}>
                      <td style={{ overflowWrap: "anywhere", minWidth: 180 }}>{x.q}</td>
                      {site === "all" && <td className={s.hideSm}><span className={s.siteTag}>{siteName(x.site)}</span></td>}
                      {AI_ENGINES.filter(([id]) => id !== "copilot").map(([id, n]) => {
                        const r = x.engines?.[id]; const c = engCell(r);
                        return <td key={id}><button type="button" className={`${s.pill} ${c.cls}`} style={{ border: 0, cursor: r?.status === "ok" ? "pointer" : "default", font: "inherit", fontSize: 12.5 }} onClick={() => r?.status === "ok" && setOpen({ q: x.q, site: x.site, engine: n, ...r })}>{c.t}</button>{r?.staleNelson && <span className={`${s.pill} ${s.pillAccent}`} style={{ marginLeft: 4 }}>Nelson</span>}</td>;
                      })}
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </section>
          <section className={s.card}>
            <div className={s.cardHead}><Title icon="target">What to work on</Title></div>
            {actions.length === 0 && <div className={s.empty}>{results.length ? "Nothing stands out" : "Shows once the first check is in"}</div>}
            {actions.slice(0, 14).map((a) => (
              <div key={a.key} className={s.row}>
                <div style={{ minWidth: 0 }}><div className={s.rowTitle}>{a.title}</div><div className={s.rowMeta}>{siteName(a.site)} · {a.detail}</div></div>
                <button type="button" className={`${s.btn} ${s.btnSmall}`} onClick={() => onAdd("pipeline", { title: a.title, site: a.site, area: "AI search", notes: a.detail })}><Icon n="plus" size={12} />Pipeline</button>
              </div>
            ))}
          </section>
        </div>
        <div className={s.stack}>
          {gaiPages.length > 0 && (
            <section className={s.card}>
              <div className={s.cardHead}><Title icon="eye">Pages Google&rsquo;s AI shows</Title><Range>{`${dShort(gai[0].start)} to ${dShort(gai[0].end)}`}</Range></div>
              {gaiPages.map((p, i) => (
                <div key={p.url} className={s.row}>
                  <div style={{ minWidth: 0 }}><div className={s.rowTitle}>{p.url.replace(/^https?:\/\/(www\.)?/, "")}</div><div className={s.rowMeta}>{siteName(p.site)}</div></div>
                  <div className={`${s.rowNum} ${i === 0 ? s.rowNumAccent : ""}`}>{n0(p.impressions)}</div>
                  <RowBar value={p.impressions} max={gaiPages[0]?.impressions} accent={i === 0} />
                </div>
              ))}
            </section>
          )}
          <section className={s.card}>
            <div className={s.cardHead}><Title icon="link">Pages AI sends people to</Title><Range>{`${dShort(start)} to ${dShort(end)}`}</Range></div>
            {ai && pages.length === 0 && <div className={s.empty}>None in this period</div>}
            {pages.map((p, i) => (
              <div key={i} className={s.row}>
                <div style={{ minWidth: 0 }}><div className={s.rowTitle}>{p.page}</div><div className={s.rowMeta}>{siteName(p.site)} · {p.assistant}{p.conversions ? ` · ${n0(p.conversions)} converted` : ""}</div></div>
                <div className={`${s.rowNum} ${i === 0 ? s.rowNumAccent : ""}`}>{n0(p.sessions)}</div>
                <RowBar value={p.sessions} max={pages[0]?.sessions} accent={i === 0} />
              </div>
            ))}
          </section>
          <section className={s.card}>
            <div className={s.cardHead}><Title icon="search">Questions people ask Google</Title></div>
            {questions.length === 0 && <div className={s.empty}>None in this period</div>}
            {questions.map((q) => (
              <div key={`${q.site}-${q.query}`} className={s.row}>
                <div style={{ minWidth: 0 }}><div className={s.rowTitle}>{q.query}</div><div className={s.rowMeta}>{siteName(q.site)} · {n0(q.impressions)} searches · {n0(q.clicks)} clicks</div></div>
                <span className={`${s.posBadge} ${posClass(q.position)}`}>
{n1(q.position)}</span>
              </div>
            ))}
          </section>
        </div>
      </div>
      {open && (
        <div className={s.scrim} onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(null); }}>
          <div className={`${s.modal} ${s.modalWide} ${s.fade}`}>
            <div className={s.cardHead}>
              <Title as="h3" className={s.modalTitle} style={{ margin: 0 }} icon="sparkle">{open.engine}: {open.q}</Title>
              <button type="button" className={s.iconBtn} onClick={() => setOpen(null)} aria-label="Close" style={{ width: 34, height: 34 }}><Icon n="close" size={16} /></button>
            </div>
            <div className={s.itemMeta} style={{ marginBottom: 12 }}>
              <span className={s.siteTag}>{siteName(open.site)}</span>
              <span className={`${s.pill} ${open.mentioned ? s.pillDark : s.pillAccent}`}>{open.mentioned ? "Names us" : "Does not name us"}</span>
              <span className={`${s.pill} ${open.cited ? s.pillDark : s.pillGrey}`}>{open.cited ? "Links our site" : "No link to us"}</span>
            </div>
            <div style={{ whiteSpace: "pre-wrap", fontSize: 14, lineHeight: 1.6, color: "#2a2d2a" }}>{open.answer || "No answer"}</div>
            {open.ourCited?.length > 0 && <div className={s.rowMeta} style={{ marginTop: 14 }}>Our pages cited: {open.ourCited.map((c) => c.url).join(", ")}</div>}
            {open.others?.length > 0 && <div className={s.rowMeta} style={{ marginTop: 6 }}>Also cited: {open.others.join(", ")}</div>}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Google Shopping: free listings, Shopping ads, product results, sales channels ────────────────────
function ShoppingSearch({ site, start, end, today }) {
  const [d, setD] = useState(null);
  const gscEnd = end > addDays(today, -3) ? addDays(today, -3) : end;
  const gscStart = start > gscEnd ? gscEnd : start;
  useEffect(() => {
    let stop = false;
    fetch(`/api/command?shopping=1&start=${start}&end=${end}&gscStart=${gscStart}&gscEnd=${gscEnd}`, { cache: "no-store" }).then((r) => r.json()).then((j) => { if (!stop) setD(j); }).catch(() => {});
    return () => { stop = true; };
  }, [start, end, gscStart, gscEnd]);
  const inSite = (x) => site === "all" || x.id === site;
  const visits = (d?.visits || []).filter((x) => x.status === "ok" && inSite(x));
  const G = (name, k) => visits.reduce((a, x) => a + (x.groups.find((g) => g.name === name)?.[k] || 0), 0);
  const pages = visits.flatMap((x) => x.pages.map((p) => ({ ...p, site: x.id }))).sort((a, b) => b.sessions - a.sessions).slice(0, 12);
  const google = (d?.google || []).filter((x) => x.status === "ok" && inSite(x));
  const appear = {};
  google.forEach((x) => x.appearances.forEach((a) => { const o = appear[a.searchAppearance] || { name: a.searchAppearance, clicks: 0, impressions: 0 }; o.clicks += a.clicks; o.impressions += a.impressions; appear[a.searchAppearance] = o; }));
  const appearances = Object.values(appear).sort((a, b) => b.impressions - a.impressions);
  const label = (a) => cap(String(a).toLowerCase().replace(/_/g, " "));
  const shopQueries = google.flatMap((x) => x.detail.flatMap((dd) => dd.queries.map((q) => ({ ...q, site: x.id, appearance: dd.appearance })))).sort((a, b) => b.impressions - a.impressions).slice(0, 12);
  return (
    <div className={s.fade}>
      <section className={s.kpis}>
        <div className={s.kpi}><div className={s.kpiTop}><div className={s.kpiNum}>{d ? n0(G("Free listings", "sessions")) : "-"}</div><div className={s.chip}><Icon n="store" size={15} /></div></div><div className={s.kpiLabel}>Visits from free listings</div></div>
        <div className={s.kpi}><div className={s.kpiTop}><div className={s.kpiNum}>{d ? moneyShort(G("Free listings", "revenue")) : "-"}</div><div className={`${s.chip} ${s.chipOrange}`}><Icon n="bag" size={15} /></div></div><div className={s.kpiLabel}>Sales from free listings, {n0(G("Free listings", "orders"))} orders</div></div>
        <div className={s.kpi}><div className={s.kpiTop}><div className={s.kpiNum}>{d ? n0(G("Shopping ads", "sessions")) : "-"}</div><div className={s.chip}><Icon n="megaphone" size={15} /></div></div><div className={s.kpiLabel}>Visits from Shopping ads</div></div>
        <div className={s.kpi}><div className={s.kpiTop}><div className={s.kpiNum}>{d ? moneyShort(G("Shopping ads", "revenue")) : "-"}</div><div className={s.chip}><Icon n="dollar" size={15} /></div></div><div className={s.kpiLabel}>Sales from Shopping ads, {n0(G("Shopping ads", "orders"))} orders</div></div>
      </section>
      <div className={s.grid}>
        <div className={s.stack}>
          <section className={s.card}>
            <div className={s.cardHead}><Title icon="bag">Products people land on from Google Shopping</Title><Range>{`${dShort(start)} to ${dShort(end)}`}</Range></div>
            {!d && <div className={s.skeleton} style={{ height: 160 }} />}
            {d && pages.length === 0 && <div className={s.empty}>None in this period</div>}
            {pages.length > 0 && (
              <div className={s.tableWrap}>
                <table className={s.table}>
                  <thead><tr><th>Page</th>{site === "all" && <th className={s.hideSm}>Site</th>}<th className={s.hideSm}>From</th><th className={s.num}>Visits</th><th className={s.num}>Orders</th><th className={s.num}>Sales</th></tr></thead>
                  <tbody>{pages.map((p, i) => (
                    <tr key={i}><td style={{ overflowWrap: "anywhere" }}>{p.page}</td>{site === "all" && <td className={s.hideSm}><span className={s.siteTag}>{siteName(p.site)}</span></td>}<td className={s.hideSm}>{p.kind}</td><td className={s.num}>{n0(p.sessions)}</td><td className={s.num}>{n0(p.orders)}</td><td className={s.num}>{money(p.revenue)}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </section>
          <section className={s.card}>
            <div className={s.cardHead}><Title icon="search">Searches that show our products</Title><Range>{`${dShort(gscStart)} to ${dShort(gscEnd)}`}</Range></div>
            {d && shopQueries.length === 0 && <div className={s.empty}>None in this period</div>}
            {shopQueries.map((q, i) => (
              <div key={i} className={s.row}>
                <div style={{ minWidth: 0 }}><div className={s.rowTitle}>{q.query}</div><div className={s.rowMeta}>{siteName(q.site)} · {label(q.appearance)} · {n0(q.impressions)} shown · {n0(q.clicks)} clicks</div></div>
                <span className={`${s.posBadge} ${posClass(q.position)}`}>
{n1(q.position)}</span>
              </div>
            ))}
          </section>
        </div>
        <div className={s.stack}>
          <section className={s.card}>
            <div className={s.cardHead}><Title icon="pie">How we show in Google</Title><span className={s.tag}><Icon n="eye" size={11} />Shown</span></div>
            {d && appearances.length === 0 && <div className={s.empty}>None in this period</div>}
            {appearances.map((a, i) => (
              <div key={a.name} className={s.row}>
                <div style={{ minWidth: 0 }}><div className={s.rowTitle}>{label(a.name)}</div><div className={s.rowMeta}>{n0(a.impressions)} shown · {n0(a.clicks)} clicks</div></div>
                <RowBar value={a.impressions} max={appearances[0]?.impressions} accent={i === 0} />
              </div>
            ))}
          </section>
        </div>
      </div>
    </div>
  );
}

// ── Social & Web tab (same figures as /social-web, for the Command Center's dates and site) ─────────────────
/* Three colours only: the off-white page (most), ink (text, bars, rings) and the orange accent (the latest month, a
   drop, the one figure that matters most on a card). Shop figures are Shopify's own (New Zealand sessions, Online
   Store sales); worthy.nz is the company site (Google Analytics, no sales). The two bases are never added together. */
const socialSite = (a) => (/products/i.test(a.name) ? "worthyproducts" : "worthy");
const short = (v) => (v === null || v === undefined ? "-" : Math.abs(v) >= 10000 ? `${(v / 1000).toFixed(1)}k` : n0(v));

const T = ({ icon, children }) => <h2 className={s.cardTitle}><span className={s.titleIcon}><Icon n={icon} size={15} /></span>{children}</h2>;
const Mini = ({ icon, children }) => <div className={s.miniHead}><Icon n={icon} size={13} />{children}</div>;

function Trend({ now, before, points = false }) {
  if (now === null || now === undefined || before === null || before === undefined) return null;
  let d, txt;
  if (points) { d = now - before; txt = `${Math.abs(d * 100).toFixed(1)} pts`; }
  else { if (!before) return null; d = (now - before) / before; if (!Number.isFinite(d)) return null; txt = `${Math.abs(d * 100).toFixed(1)}%`; }
  if (Math.abs(d) < 0.0005) return <span className={s.trend}>no change</span>;
  return <span className={`${s.trend} ${d < 0 ? s.trendDown : ""}`}><svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">{d < 0 ? <path d="M12 20 3 4h18z" /> : <path d="M12 4l9 16H3z" />}</svg>{txt}</span>;
}

function Big({ value, label, pair, fmt = n0, points, accent }) {
  return (
    <div className={s.stat}>
      <div className={s.statNum} style={accent ? { color: "var(--orange-ink)" } : undefined}>{value ?? (pair ? fmt(pair[0]) : "-")}</div>
      <div className={s.statLabel}>{label}</div>
      {pair && (pair[1] === 0 && pair[0] > 0
        ? <div style={{ marginTop: 4 }}><span className={s.was}>none recorded before</span></div>
        : <div style={{ marginTop: 4 }}><Trend now={pair[0]} before={pair[1]} points={points} /> <span className={s.was}>was {fmt(pair[1])}</span></div>)}
    </div>
  );
}

/* The range end when the last month bar stops part-way through its month (the month still running), else null. */
const partOfMonth = (rows, endIso) => {
  const ym = rows?.[rows.length - 1]?.month;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(endIso || "");
  if (!ym || !m || `${m[1]}-${m[2]}` !== String(ym).slice(0, 7)) return null;
  return Number(m[3]) < new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate() ? endIso : null;
};

function MonthBars({ rows, k, fmt = n0, partialTo }) {
  if (!rows?.length) return null;
  const max = Math.max(1, ...rows.map((r) => r[k] || 0));
  const day = partialTo ? Number(String(partialTo).slice(8, 10)) : null;
  return (
    <div className={s.monthBars}>
      {rows.map((r, i) => {
        const last = i === rows.length - 1, part = last && day;
        return (
          <div key={r.month} title={`${monthLabel(r.month)}${part ? `, 1 to ${day}` : ""}: ${fmt(r[k])}`}>
            <b>{fmt === money ? moneyShort(r[k]) : short(r[k])}</b>
            <i className={`${last ? s.hot : ""} ${part ? s.part : ""}`} style={{ height: `${Math.max(3, ((r[k] || 0) / max) * 100)}%` }} />
            <span>{monthLabel(r.month).slice(0, 3)}{part && <em>to {day}</em>}</span>
          </div>
        );
      })}
    </div>
  );
}

function BarList({ rows, k, fmt = n0, limit = 6, caps = false }) {
  if (!rows?.length) return <div className={s.empty}>None in this period</div>;
  const list = rows.slice(0, limit);
  const total = rows.reduce((t, r) => t + (r[k] || 0), 0) || 1;
  const max = Math.max(1, ...list.map((r) => r[k] || 0));
  return (
    <div className={s.bars}>
      {list.map((r, i) => (
        <div key={r.name} className={s.barRow}>
          <span style={{ overflowWrap: "anywhere", textTransform: caps ? "capitalize" : "none" }}>{r.name}</span>
          <div className={s.barTrack}><div className={`${s.barInk} ${i === 0 ? s.barAccent : ""}`} style={{ width: `${((r[k] || 0) / max) * 100}%` }} /></div>
          <span className={s.num}>{fmt(r[k])} <span className={s.was}>{Math.round(((r[k] || 0) / total) * 100)}%</span></span>
        </div>
      ))}
    </div>
  );
}

// Ring split (devices): ink in steps of strength, the biggest part in the accent.
function Ring({ rows, k }) {
  const list = (rows || []).filter((r) => (r[k] || 0) > 0);
  const total = list.reduce((t, r) => t + r[k], 0);
  if (!total) return <div className={s.empty}>None in this period</div>;
  const R = 34, C = 2 * Math.PI * R;
  const lens = list.map((r) => (r[k] / total) * C);
  const offs = lens.map((_, i) => lens.slice(0, i).reduce((t, v) => t + v, 0));
  const shades = [null, 0.75, 0.4, 0.2, 0.1];
  return (
    <div className={s.ringWrap}>
      <svg viewBox="0 0 90 90" className={s.ring} role="img" aria-label="Split by device">
        <circle cx="45" cy="45" r={R} fill="none" stroke="rgba(0,0,0,.05)" strokeWidth="11" />
        {list.map((r, i) => (
          <circle key={r.name} cx="45" cy="45" r={R} fill="none" stroke={i === 0 ? "var(--orange-ink)" : "var(--ink)"} strokeOpacity={i === 0 ? 1 : shades[i] ?? 0.1}
            strokeWidth="11" strokeDasharray={`${lens[i]} ${C - lens[i]}`} strokeDashoffset={-offs[i]} transform="rotate(-90 45 45)" />
        ))}
        <text x="45" y="49" textAnchor="middle" fontSize="13" fontWeight="300" fill="var(--ink)">{Math.round((list[0][k] / total) * 100)}%</text>
      </svg>
      <div className={s.ringLegend}>
        {list.map((r, i) => (
          <div key={r.name}><i style={{ background: i === 0 ? "var(--orange-ink)" : "var(--ink)", opacity: i === 0 ? 1 : shades[i] ?? 0.1 }} /><span style={{ textTransform: "capitalize" }}>{r.name}</span><b>{n0(r[k])}</b></div>
        ))}
      </div>
    </div>
  );
}

// A chain of figures that follow from each other, with what links each step to the next.
function Chain({ steps, compact = false }) {
  return (
    <div className={`${s.chain} ${compact ? s.chainCompact : ""}`}>
      {steps.map((st, i) => (
        <div key={st.label} className={s.chainStep}>
          {i > 0 && <div className={s.chainLink}><span>{st.link}</span><span className={s.chainArrow}><Icon n="move" size={16} /></span></div>}
          <div className={s.chainBox}>
            <div className={s.chainNum} style={st.accent ? { color: "var(--orange-ink)" } : undefined}>{st.value}</div>
            <div className={s.statLabel}>{st.label}</div>
            {st.pair && <div style={{ marginTop: 4 }}><Trend now={st.pair[0]} before={st.pair[1]} /></div>}
          </div>
        </div>
      ))}
    </div>
  );
}

function WebSiteCard({ x, range, end }) {
  const shop = x.source === "shopify";
  const t = x.totals || {};
  return (
    <section className={s.card}>
      <div className={s.cardHead}>
        <T icon={shop ? "store" : "building"}>{x.name}</T>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <span className={`${s.pill} ${s.pillGrey}`}>{shop ? "Shopify, NZ visits" : "Google Analytics"}</span>
          <Range>{range}</Range>
        </div>
      </div>
      {x.status !== "ok"
        ? <div className={s.empty}>{x.status === "not_connected" ? "Not connected yet" : x.status === "no_property" ? "Waiting for its Google Analytics property" : `Could not load: ${x.error || "error"}`}</div>
        : (<>
          <div className={s.statLine}>
            {shop ? (<>
              <Big label="Visits" pair={t.sessions} />
              <Big label="Converted" pair={t.conversion} fmt={(v) => pct(v, 2)} points />
              <Big label="Orders" pair={t.orders} />
              <Big label="Online sales" pair={t.revenue} fmt={moneyShort} accent />
            </>) : (<>
              <Big label="Visitors" pair={t.visitors} />
              <Big label="New visitors" pair={t.newVisitors} />
              <Big label="Page views" pair={t.pageViews} />
              <Big label="Key events" pair={t.keyEvents} accent />
            </>)}
          </div>
          <div className={s.grid2} style={{ marginTop: 24 }}>
            <div>
              <Mini icon="bars">{shop ? "NZ visits by month" : "Visitors by month"}</Mini>
              <MonthBars rows={x.months} k={shop ? "sessions" : "visitors"} partialTo={partOfMonth(x.months, end)} />
            </div>
            {shop
              ? <div><Mini icon="bag">Online sales by month</Mini><MonthBars rows={x.months} k="revenue" fmt={money} partialTo={partOfMonth(x.months, end)} /></div>
              : <div><Mini icon="devices">Device</Mini><Ring rows={x.devices} k="sessions" /></div>}
          </div>
          <div className={s.grid2} style={{ marginTop: 24 }}>
            <div>
              <Mini icon="compass">Where visits came from</Mini>
              <BarList rows={x.sources} k="sessions" caps />
            </div>
            {shop
              ? <div><Mini icon="devices">Device</Mini><Ring rows={x.devices} k="sessions" /></div>
              : <div><Mini icon="eye">Most viewed pages</Mini><BarList rows={(x.pages || []).map((r) => ({ ...r, name: r.name }))} k="views" /></div>}
          </div>

        </>)}
    </section>
  );
}

const SOCIAL_KEYS = [["views", "Views"], ["reach", "Reach"], ["engagements", "Engagements"], ["profileViews", "Profile visits"], ["newFollows", "New followers"]];

function SocialAccount({ a }) {
  const t = a.totals || {};
  const v = t.views?.[0], e = t.engagements?.[0];
  return (
    <section className={s.site}>
      <div className={s.siteHead}>
        <div className={s.siteName} style={{ display: "flex", alignItems: "center", gap: 8 }}><span className={s.titleIcon}><Icon n={a.platform === "Instagram" ? "instagram" : "facebook"} size={15} /></span>{a.name}</div>
        <span className={`${s.pill} ${s.pillGrey}`}>{a.platform}</span>
      </div>
      <div className={s.siteSub}>{n0(a.followers)} followers{a.postsTotal ? ` · ${n0(a.postsTotal)} posts` : ""}</div>
      {v ? (
        <Chain steps={[
          { label: "Views", value: short(v), pair: t.views },
          { label: "Engagements", value: short(e), pair: t.engagements, link: v && e !== undefined ? `${((e / v) * 100).toFixed(1)}% engaged` : "", accent: true },
        ]} compact />
      ) : <div className={s.empty}>No views recorded in this period</div>}
      <div className={`${s.statLine} ${s.statTight}`} style={{ marginTop: 12 }}>
        {SOCIAL_KEYS.filter(([k]) => k !== "views" && k !== "engagements" && t[k]).map(([k, l]) => (
          <div key={k} className={s.stat}>
            <div className={s.statNum} style={{ fontSize: 20 }}>{n0(t[k][0])}</div>
            <div className={s.statLabel}>{l}</div>
            <Trend now={t[k][0]} before={t[k][1]} />
          </div>
        ))}
      </div>
      {a.posts?.length > 0 && (
        <div style={{ marginTop: 12 }}>
          {a.posts.slice(0, 3).map((po, i) => (
            <a key={i} href={po.link} target="_blank" rel="noreferrer" className={s.row} style={{ textDecoration: "none", color: "inherit" }}>
              <div style={{ minWidth: 0 }}>
                <div className={s.rowTitle} style={{ fontWeight: 400 }}>{po.text || "(no caption)"}</div>
                <div className={s.rowMeta}>{dShort(String(po.when).slice(0, 10))} · {n0(po.reactions)} likes · {n0(po.comments)} comments</div>
              </div>
              <Icon n="out" size={14} />
            </a>
          ))}
        </div>
      )}
      <div className={s.siteBtns}><a href={a.link} target="_blank" rel="noreferrer"><Icon n="out" size={13} />Open</a></div>
    </section>
  );
}

function SocialTab({ site, start, end, nonce = 0 }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  const want = `${start}|${end}`;
  const ck = `cc-social-v4:${want}`;
  useEffect(() => {
    let stop = false;
    // Within 30 minutes the server would send the same figures, so the browser's copy is used; Refresh always asks again.
    const fresh = nonce > 0;
    if (!fresh && cache.entry(ck, 0.5 * HOUR)) return () => { stop = true; };
    fetch(`/api/social-web?from=${start}&to=${end}${fresh ? "&fresh=1" : ""}`, { cache: "no-store" })
      .then((r) => r.json().then((j) => (r.ok ? j : Promise.reject(new Error(j.error || r.status)))))
      .then((j) => { if (!stop) { cache.set(ck, j); setD({ ...j, key: `${start}|${end}` }); setErr(""); } })
      .catch((e) => { if (!stop) setErr(`${start}|${end}|${String(e.message || e)}`); });
    return () => { stop = true; };
  }, [start, end, ck, nonce]);
  // Figures for an earlier date range are never shown while the new range loads; this range's saved copy shows at once.
  const saved = useMemo(() => cache.get(ck, 24 * HOUR), [ck]);
  const cur = d && d.key === want ? d : saved ? { ...saved, key: want } : null;
  const errText = err.startsWith(`${want}|`) ? err.slice(want.length + 1) : "";

  const p = cur?.web?.periods;
  const range = p ? `${dShort(p.start)} to ${dShort(p.end)} vs ${dShort(p.prevStart)} to ${dShort(p.prevEnd)}` : `${dShort(start)} to ${dShort(end)}`;
  const sites = (cur?.web?.sites || []).filter((x) => site === "all" || x.id === site);
  const okSites = sites.filter((x) => x.status === "ok");
  const shops = okSites.filter((x) => x.source === "shopify");
  const company = okSites.find((x) => x.id === "worthy");
  const accounts = (cur?.meta?.accounts || []).filter((a) => site === "all" || socialSite(a) === site);
  const pairSum = (list, get) => { let a = 0, b = 0, any = false; list.forEach((x) => { const v = get(x); if (v) { any = true; a += v[0] || 0; b += v[1] || 0; } }); return any ? [a, b] : null; };
  const visits = pairSum(shops, (x) => x.totals?.sessions);
  const orders = pairSum(shops, (x) => x.totals?.orders);
  const sales = pairSum(shops, (x) => x.totals?.revenue);
  // Shopify's conversion rate, weighted by each shop's visits (not orders divided by visits).
  const conv = visits && visits[0] ? shops.reduce((t, x) => t + (x.totals?.conversion?.[0] || 0) * (x.totals?.sessions?.[0] || 0), 0) / visits[0] : null;
  const views = pairSum(accounts, (a) => a.totals?.views);
  const eng = pairSum(accounts, (a) => a.totals?.engagements);
  const followers = accounts.reduce((t, a) => t + (a.followers || 0), 0);
  const shopNames = shops.length === 1 ? shops[0].name : "the shops";
  const shopMonths = (() => {
    const m = {};
    shops.forEach((x) => (x.months || []).forEach((r) => { const o = m[r.month] || { month: r.month, revenue: 0 }; o.revenue += r.revenue || 0; m[r.month] = o; }));
    return Object.values(m).sort((a, b) => (a.month < b.month ? -1 : 1));
  })();
  const manual = cur?.manual;
  const manualMonths = manual ? [...new Set(Object.values(manual.values || {}).flatMap((m) => Object.keys(m)))].sort().reverse() : [];

  return (
    <div className={s.fade}>
      {/* 1. headline */}
      <section className={s.kpis}>
        <div className={s.kpi}>
          <div className={s.kpiTop}><div className={s.kpiNum}>{sales ? moneyShort(sales[0]) : "-"}</div><div className={s.chip}><Icon n="bag" size={15} /></div></div>
          <div className={s.kpiLabel}>Online sales{shops.length === 1 ? `, ${shops[0].name}` : ""} {sales && <Trend now={sales[0]} before={sales[1]} />}</div>
        </div>
        <div className={s.kpi}>
          <div className={s.kpiTop}><div className={s.kpiNum}>{visits ? n0(visits[0]) : "-"}</div><div className={s.chip}><Icon n="store" size={15} /></div></div>
          <div className={s.kpiLabel}>Shop visits, NZ {visits && <Trend now={visits[0]} before={visits[1]} />}</div>
        </div>
        <div className={s.kpi}>
          <div className={s.kpiTop}><div className={s.kpiNum}>{company ? n0(company.totals?.visitors?.[0]) : "-"}</div><div className={s.chip}><Icon n="building" size={15} /></div></div>
          <div className={s.kpiLabel}>worthy.nz visitors {company && <Trend now={company.totals?.visitors?.[0]} before={company.totals?.visitors?.[1]} />}</div>
        </div>
        <div className={s.kpi}>
          <div className={s.kpiTop}><div className={s.kpiNum}>{views ? short(views[0]) : "-"}</div><div className={s.chip}><Icon n="megaphone" size={15} /></div></div>
          <div className={s.kpiLabel}>Social views {views && <Trend now={views[0]} before={views[1]} />}</div>
        </div>
      </section>

      {errText && <section className={s.card} style={{ marginTop: 14 }}><div className={s.err}>Could not load: {errText}</div></section>}
      {!cur && !errText && <div className={s.skeleton} style={{ height: 320, marginTop: 14 }} />}

      {cur && (<>
        {/* 2. how visits turn into sales, and how social turns into attention */}
        <div className={s.grid2} style={{ marginTop: 14 }}>
          {shops.length > 0 && (
            <section className={s.card}>
              <div className={s.cardHead}><T icon="funnel">From visit to sale, {shopNames}</T><Range>{range}</Range></div>
              <Chain steps={[
                { label: "NZ visits", value: n0(visits?.[0]), pair: visits },
                { label: "Orders", value: n0(orders?.[0]), pair: orders, link: conv !== null ? `${(conv * 100).toFixed(2)}% converted` : "" },
                { label: "Online sales", value: moneyShort(sales?.[0]), pair: sales, link: orders?.[0] ? `${money(sales[0] / orders[0])} an order` : "", accent: true },
              ]} />
              {/* One chart per shop (27 Nov 2026): added together, Dutch Rusk customers moving onto the Shopify portal over
                  Jul to Oct read as tenfold growth in online sales. Each shop's own Shopify online store sales, so each trend is true. */}
              {shops.filter((x) => (x.months || []).length > 0).map((x) => (
                <div key={x.id} style={{ marginTop: 20 }}>
                  <Mini icon="bars">Online sales by month, {x.name}{x.liveFrom ? `, since ${monthLabel(x.liveFrom)}` : ""}</Mini>
                  <MonthBars rows={x.months} k="revenue" fmt={money} partialTo={partOfMonth(x.months, p?.end || end)} />
                </div>
              ))}
              {shops.length > 1 && sales?.[0] > 0 && (
                <div style={{ marginTop: 18 }}>
                  <Mini icon="pie">Share of online sales</Mini>
                  <div className={s.shareBar}>
                    {shops.map((x, i) => <i key={x.id} style={{ width: `${((x.totals?.revenue?.[0] || 0) / sales[0]) * 100}%`, background: i === 0 ? "var(--orange-ink)" : "var(--ink)" }} title={`${x.name}: ${money(x.totals?.revenue?.[0])}`} />)}
                  </div>
                  <div className={s.shareLegend}>
                    {shops.map((x, i) => <span key={x.id}><i style={{ background: i === 0 ? "var(--orange-ink)" : "var(--ink)" }} />{x.name} {Math.round(((x.totals?.revenue?.[0] || 0) / sales[0]) * 100)}% · {moneyShort(x.totals?.revenue?.[0])}</span>)}
                  </div>
                </div>
              )}
            </section>
          )}
          {accounts.length > 0 && views && (
            <section className={s.card}>
              <div className={s.cardHead}><T icon="megaphone">Social at a glance</T><span className={s.tag}>{n0(followers)} followers</span></div>
              <Chain steps={[
                { label: "Views", value: short(views[0]), pair: views },
                { label: "Engagements", value: short(eng?.[0]), pair: eng, link: eng && views[0] ? `${((eng[0] / views[0]) * 100).toFixed(1)}% engaged` : "", accent: true },
              ]} />
              <div style={{ marginTop: 18 }}>
                <Mini icon="eye">Views by account</Mini>
                <BarList rows={accounts.map((a) => ({ name: a.name, views: a.totals?.views?.[0] || 0 }))} k="views" />
              </div>
            </section>
          )}
        </div>

        {/* 3. each site, then 4. each social account */}
        <div className={s.grid}>
          <div className={s.stack}>
            {sites.map((x) => <WebSiteCard key={x.id} x={x} range={range} end={p?.end || end} />)}
          </div>
          <aside className={s.stack}>
            {cur.meta?.status !== "ok" && <section className={s.card}><T icon="megaphone">Facebook and Instagram</T><div className={s.empty}>{cur.meta?.status === "not_connected" ? "Not connected yet" : `Could not load: ${cur.meta?.error || ""}`}</div></section>}
            {cur.meta?.status === "ok" && accounts.length === 0 && <section className={s.card}><T icon="megaphone">Social media</T><div className={s.empty}>No social accounts for {siteName(site)}</div></section>}
            {accounts.map((a) => <SocialAccount key={a.platform + a.name} a={a} />)}
            {manual && (
              <section className={s.card}>
                <div className={s.cardHead}><T icon="users">LinkedIn and TikTok</T><Link className={`${s.btn} ${s.btnSmall}`} href="/social-web">Enter figures</Link></div>
                {manualMonths.length === 0 && <div className={s.empty}>No figures entered yet</div>}
                {manual.accounts.map((acc) => {
                  const m = manualMonths.find((mm) => manual.values?.[acc.id]?.[mm]);
                  if (!m) return null;
                  const vals = manual.values[acc.id][m];
                  return (
                    <div key={acc.id} className={s.row}>
                      <div style={{ minWidth: 0 }}>
                        <div className={s.rowTitle}>{acc.name}</div>
                        <div className={s.rowMeta}>{acc.platform} · {monthLabel(m)} · {manual.fields.filter((f) => vals[f.id] !== undefined && vals[f.id] !== "").map((f) => `${f.label} ${n0(Number(vals[f.id]))}`).join(" · ")}</div>
                      </div>
                    </div>
                  );
                })}
              </section>
            )}
          </aside>
        </div>
      </>)}
    </div>
  );
}

// ── Today so far (since midnight NZ) ────────────────────────────────────────────────────────────────
// ── Ecom and Marketing weekly summary (lib/ecomSummary.js): last week against the week before. A draft to copy or open as
//    an email; nothing is sent from here. Company sales, salespeople and stock are the management summary on the Overview. ──
function WeeklySummary() {
  const [d, setD] = useState(() => cache.get("cc-ecom-summary-v1", 10 * 60 * 1000));
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let stop = false;
    fetch("/api/summary?kind=ecom", { cache: "no-store" }).then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error || `Error ${r.status}`); return j; })
      .then((j) => { if (!stop) { setD(j); cache.set("cc-ecom-summary-v1", j); } }).catch((e) => { if (!stop) setErr(String(e.message || e)); });
    return () => { stop = true; };
  }, []);
  const pctT = (v) => (v == null ? "-" : `${(v * 100).toFixed(2)}%`);
  if (err && !d) return <section className={s.card} style={{ marginTop: 14 }}><div className={s.err}>Weekly summary could not load: {err}</div></section>;
  if (!d) return <section className={s.card} style={{ marginTop: 14 }}><div className={s.skeleton} style={{ height: 140 }} /></section>;
  const subject = `Ecom and Marketing, week ${dShort(d.week.start)} to ${dLong(d.week.end)}`;
  const m = d.margin;
  return (
    /* Same 14px gap as every other card on this page */
    <section className={s.card} style={{ marginTop: 14 }}>
      <div className={s.cardHead}>
        <Title icon="mail">Ecom and Marketing this week</Title>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <Range>{dShort(d.week.start)} to {dLong(d.week.end)}</Range>
          <button type="button" className={s.btn} onClick={() => setOpen((o) => !o)} aria-expanded={open}><Icon n="eye" size={14} />{open ? "Hide draft" : "Show draft"}</button>
          <button type="button" className={s.btn} onClick={() => { navigator.clipboard?.writeText(d.text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }); }}><Icon n="check" size={14} />{copied ? "Copied" : <Win win="Copy the wins">Copy</Win>}</button>
          <a className={`${s.btn} ${s.btnDark}`} href={`mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(d.text)}`}><Icon n="out" size={14} /><Win win="Share this week's wins">Open as email draft</Win></a>
        </div>
      </div>

      <div className={s.miniHead}><Icon n="bag" size={13} />Online sales, every channel except Point of Sale</div>
      <div className={s.statLine}>
        <div className={s.stat}><div className={`${s.statNum} ${s.accentNum}`}>{money(d.online.sales[0])}</div><div className={s.statLabel}>Online sales <Delta now={d.online.sales[0]} before={d.online.sales[1]} /></div></div>
        <div className={s.stat}><div className={s.statNum}>{n0(d.online.orders[0])}</div><div className={s.statLabel}>Orders <Delta now={d.online.orders[0]} before={d.online.orders[1]} /></div></div>
        <div className={s.stat}><div className={s.statNum}>{m ? money(m.grossProfit) : "-"}</div><div className={s.statLabel}>Gross profit{m?.marginPct != null ? ` · ${m.marginPct}% margin` : ""}</div>{m && <div className={s.rowMeta}>On {n0(m.invoicedOrders)} of {n0(m.orders)} orders invoiced</div>}</div>
        <div className={s.stat}><div className={s.statNum}>{n0(d.online.visits[0])}</div><div className={s.statLabel}>Shop visits, NZ <Delta now={d.online.visits[0]} before={d.online.visits[1]} /></div></div>
      </div>

      <div className={s.grid2} style={{ marginTop: 18 }}>
        <div>
          <div className={s.miniHead}><Icon n="store" size={13} />By shop</div>
          {d.shops.map((x) => (
            <div key={x.id} className={s.row}>
              <div style={{ minWidth: 0 }}><div className={s.rowTitle}>{x.name}</div><div className={s.rowMeta}>{n0(x.orders[0])} orders · {n0(x.visits[0])} NZ visits · {pctT(x.conversion[0])} converted</div></div>
              <span className={s.rowNum} style={{ whiteSpace: "nowrap" }}>{money(x.sales[0])} <Delta now={x.sales[0]} before={x.sales[1]} /></span>
            </div>
          ))}
        </div>
        <div>
          <div className={s.miniHead}><Icon n="megaphone" size={13} />Marketing</div>
          {d.company && <div className={s.row}><div className={s.rowTitle}>worthy.nz enquiries</div><span className={s.rowNum}>{n0(d.company.enquiries[0])} <Delta now={d.company.enquiries[0]} before={d.company.enquiries[1]} /></span></div>}
          {d.search && <div className={s.row}><div className={s.rowTitle}>Non-branded search clicks</div><span className={s.rowNum}>{n0(d.search[0])} <Delta now={d.search[0]} before={d.search[1]} /></span></div>}
          {d.social && <div className={s.row}><div className={s.rowTitle}>Social views<div className={s.rowMeta}>{n0(d.social.engagements[0])} engagements</div></div><span className={s.rowNum}>{n0(d.social.views[0])} <Delta now={d.social.views[0]} before={d.social.views[1]} /></span></div>}
          <div className={s.row}><div className={s.rowTitle}>Ads, month to date{d.ads.visits != null && <div className={s.rowMeta}>{n0(d.ads.visits)} visits from ads</div>}</div><span className={s.rowNum}>{money(d.ads.spend)}</span></div>
          <div className={s.row}><div className={s.rowTitle}>Meeting<div className={s.rowMeta}>{d.meeting.sent} actions sent to Asana</div></div><span className={s.rowNum}>{d.meeting.points} to discuss</span></div>
        </div>
      </div>
      {open && <pre style={{ whiteSpace: "pre-wrap", font: "inherit", fontSize: 14.5, marginTop: 18, padding: 16, borderRadius: 14, background: "rgba(0,0,0,.03)" }}>{d.text}</pre>}
    </section>
  );
}

// ── Gross profit and margin on online sales, order by order (lib/onlineMargin.js, /api/online-margin) ──
function OnlineProfit({ site, start, end }) {
  const [d, setD] = useState(null);
  const [hidden, setHidden] = useState(false);
  const shop = site === "worthyproducts" || site === "dutchrusk" ? site : "all";
  useEffect(() => {
    if (!start || !end || site === "worthy") return undefined;
    let stop = false;
    const k = `cc-om-v1:${shop}:${start}:${end}`;
    const c = cache.get(k, 30 * 60 * 1000); setD(c || null);
    fetch(`/api/online-margin?site=${shop}&from=${start}&to=${end}`, { cache: "no-store" })
      .then(async (r) => { if (r.status === 401 || r.status === 403) { if (!stop) setHidden(true); return null; } const j = await r.json(); return r.ok ? j : null; })
      .then((j) => { if (!stop && j) { setD(j); cache.set(k, j); } }).catch(() => {});
    return () => { stop = true; };
  }, [shop, start, end, site]);
  if (hidden || site === "worthy") return null;
  return (
    <div className={s.stat}>
      <div className={s.statNum}>{d ? money(d.grossProfit) : "-"}</div>
      <div className={s.statLabel}>Gross profit{d?.marginPct != null ? ` · ${d.marginPct}% margin` : ""}</div>
      {d && <div className={s.rowMeta}>On {n0(d.invoicedOrders)} of {n0(d.orders)} orders invoiced</div>}
    </div>
  );
}

function TodaySoFar({ todayNow, site, bar }) {
  if (!todayNow) return null;
  const rows = todayNow.sites.filter((x) => x.status === "ok" && (site === "all" || x.id === site));
  if (!rows.length) return null;
  const sum = (k, ids) => rows.filter((x) => !ids || ids.includes(x.id)).reduce((a, x) => a + (x[k] || 0), 0);
  const shops = ["worthyproducts", "dutchrusk"];
  if (bar) {
    const items = [[n0(sum("sessions")), "visits"]];
    if (site !== "worthy") items.push([n0(sum("orders", shops)), "orders"], [money(sum("revenue", shops)), "online sales"]);
    if (site === "all" || site === "worthy") items.push([n0(sum("conversions", ["worthy"])), "worthy.nz enquiries"]);
    return (
      <div className={s.todayBar}>
        <div className={s.todayHead}><span className={s.liveDot} />Today so far <span className={s.todayTime}>{nzTime(todayNow.at)}</span></div>
        {items.map(([v, l]) => <span key={l}><span className={`${s.tNum} ${l === "online sales" ? s.accentNum : ""}`}>{v}</span><span className={s.tLab}>{l}</span></span>)}
      </div>
    );
  }
  return (
    <div className={s.today}>
      <div className={s.todayHead}><span className={s.liveDot} />Today so far <span className={s.todayTime}>{nzTime(todayNow.at)}</span></div>
      <div className={s.statLine}>
        <div className={s.stat}><div className={s.statNum}>{n0(sum("sessions"))}</div><div className={s.statLabel}>Visits</div></div>
        {site !== "worthy" && <div className={s.stat}><div className={s.statNum}>{n0(sum("orders", shops))}</div><div className={s.statLabel}>Orders</div></div>}
        {site !== "worthy" && <div className={s.stat}><div className={`${s.statNum} ${s.accentNum}`}>{money(sum("revenue", shops))}</div><div className={s.statLabel}>Online sales</div></div>}
        {(site === "all" || site === "worthy") && <div className={s.stat}><div className={s.statNum}>{n0(sum("conversions", ["worthy"]))}</div><div className={s.statLabel}>worthy.nz enquiries</div></div>}
      </div>
    </div>
  );
}

// ── When each source was last read ─────────────────────────────────────────────────────────────────
function Freshness({ data, liveAt, todayNow, asana, clickup, meeting, now }) {
  const oldest = (arr) => { const t = (arr || []).map((x) => x.fetchedAt || x.savedAt).filter(Boolean).sort()[0]; return t || null; };
  const traffic = oldest(data?.traffic), search = oldest(data?.search);
  const gscTo = (data?.search || []).find((x) => x.range)?.range?.end;
  const items = [
    ["Live visitors", liveAt],
    ["Today so far", todayNow?.at],
    ["Visits and online store sales", traffic],
    [`Search Console${gscTo ? ` (data to ${dShort(gscTo)})` : ""}`, search],
    ["Asana", asana?.at],
    ["ClickUp", clickup?.at],
  ].filter(([, t]) => t);
  if (!items.length) return null;
  const stale = (t) => now - Date.parse(t) > (meeting ? 5 : 30) * 60000;
  return (
    <div className={s.fresh}>
      <span className={s.freshIcon}><Icon n="cloud" size={13} /></span>
      {meeting && <span className={`${s.pill} ${s.pillDark}`}>Meeting day: refreshing every minute</span>}

      {items.map(([label, t]) => <span key={label} className={`${s.freshItem} ${stale(t) ? s.tagStale : ""}`}>{label} <b>{nzTime(t)}</b></span>)}
    </div>
  );
}

// ── From and To dates, always on screen ──────────────────────────────────────────────────────────────
function DatePair({ start, end, max, onChange, small }) {
  return (
    <span className={`${s.dates} ${small ? s.datesSmall : ""}`}>
      <input type="date" value={start} max={end} onChange={(e) => e.target.value && onChange(e.target.value, end)} aria-label="From" />
      <span>to</span>
      <input type="date" value={end} min={start} max={max} onChange={(e) => e.target.value && onChange(start, e.target.value)} aria-label="To" />
    </span>
  );
}
