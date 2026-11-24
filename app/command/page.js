"use client";

/**
 * Worthy Command Center (management only). Search rankings, indexing, traffic against sales, live visitors and the
 * team's own pipeline, outreach, listings and Thursday meeting actions, for worthy.nz, worthyproducts.nz and
 * dutchrusk.co.nz. Data: app/api/command (lib/command.js).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import s from "./command.module.css";

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
const FIELD_LABEL = { site: "Site", area: "Area", status: "Status", owner: "Owner", due: "Due", link: "Link", notes: "Notes",
  contact: "Contact", score: "Score", amount: "Amount (NZ$)", month: "Month" };

const TABS = [
  { id: "dashboard", label: "Dashboard", icon: "grid" },
  { id: "search", label: "Search", icon: "search" },
  { id: "outreach", label: "Outreach", icon: "mail" },
  { id: "listings", label: "Listings", icon: "pin" },
  { id: "pipeline", label: "Pipeline", icon: "flow" },
  { id: "meeting", label: "Meeting", icon: "calendar" },
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

// ── icons ───────────────────────────────────────────────────────────────────────────────────────────
const PATHS = {
  grid: <><rect x="3" y="3" width="7.5" height="7.5" rx="2" /><rect x="13.5" y="3" width="7.5" height="7.5" rx="2" /><rect x="3" y="13.5" width="7.5" height="7.5" rx="2" /><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="m4 7 8 6 8-6" /></>,
  pin: <><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21Z" /><circle cx="12" cy="9.5" r="2.5" /></>,
  flow: <><circle cx="5" cy="6" r="2.2" /><circle cx="5" cy="18" r="2.2" /><circle cx="19" cy="12" r="2.2" /><path d="M7.2 6H11a3 3 0 0 1 3 3v0a3 3 0 0 0 3 3M7.2 18H11a3 3 0 0 0 3-3v0a3 3 0 0 1 3-3" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
  refresh: <><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  bell: <><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15Z" /><path d="M10 20a2 2 0 0 0 4 0" /></>,
  home: <><path d="M4 11 12 4l8 7" /><path d="M6 10v10h12V10" /></>,
  eye: <><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>,
  click: <><path d="m9 9 11 4-5 2-2 5Z" /><path d="M5 3v3M3 5h3M3.5 9.5 5.5 8M9.5 3.5 8 5.5" /></>,
  cart: <><path d="M3 4h2.5l2.2 11h10.6L20.5 7H7" /><circle cx="9.5" cy="19.5" r="1.5" /><circle cx="17" cy="19.5" r="1.5" /></>,
  target: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4" /><circle cx="12" cy="12" r="0.8" fill="currentColor" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.6 3.7 5.6 3.7 9s-1.2 6.4-3.7 9c-2.5-2.6-3.7-5.6-3.7-9S9.5 5.6 12 3Z" /></>,
  chart: <><path d="M4 20V4M4 20h16" /><path d="m7 15 4-4 3 3 5-6" /></>,
  out: <><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></>,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  move: <><path d="M5 12h14M13 6l6 6-6 6" /></>,
  edit: <><path d="M4 20h4L19 9l-4-4L4 16Z" /></>,
  trash: <><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></>,
  up: <path d="M12 19V5M6 11l6-6 6 6" />,
  down: <path d="M12 5v14M6 13l6 6 6-6" />,
  link: <><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></>,
  star: <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9Z" />,
  dollar: <><path d="M12 3v18" /><path d="M16.5 7.5C16 6 14.3 5 12 5 9.5 5 8 6.3 8 8c0 4 8.5 2.5 8.5 7 0 1.8-1.7 3-4.5 3-2.4 0-4.1-1-4.6-2.6" /></>,
};
const Icon = ({ n, size = 16, stroke = 1.6, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>{PATHS[n]}</svg>
);
const ASANA_PROJECT = "1219139073710791";
const statusCls = (st) => (/done/i.test(st || "") ? s.pillGreen : /progress/i.test(st || "") ? s.pillViolet : /review|waiting|approved/i.test(st || "") ? s.pillAmber : s.pillGrey);
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
  const cls = Math.abs(d) < 0.0005 ? s.flat : good ? s.up : s.down;
  return <span className={`${s.delta} ${cls}`}>{d >= 0 ? "+" : "-"}{txt}</span>;
}

function Spark({ values, hotLast = 0 }) {
  const max = Math.max(1, ...values);
  return (
    <div className={s.spark}>
      {values.map((v, i) => <i key={i} className={i >= values.length - hotLast ? s.hot : ""} style={{ height: `${Math.max(6, (v / max) * 100)}%` }} />)}
    </div>
  );
}

function Gauge({ value, label, color, text }) {
  const v = Math.max(0, Math.min(1, value || 0));
  const R = 34, cx = 46, cy = 44, a0 = Math.PI * 1.1, a1 = -Math.PI * 0.1;
  const pt = (a) => [cx + R * Math.cos(a), cy - R * Math.sin(a)];
  const arc = (from, to) => { const [x0, y0] = pt(from), [x1, y1] = pt(to); const large = from - to > Math.PI ? 1 : 0; return `M${x0} ${y0} A${R} ${R} 0 ${large} 1 ${x1} ${y1}`; };
  const end = a0 - (a0 - a1) * v;
  return (
    <div className={s.gauge}>
      <svg viewBox="0 0 92 60" role="img" aria-label={`${label} ${text}`}>
        <path d={arc(a0, a1)} stroke="rgba(0,0,0,.07)" strokeWidth="4" fill="none" strokeLinecap="round" />
        {v > 0.003 && <path d={arc(a0, end)} stroke={color} strokeWidth="4" fill="none" strokeLinecap="round" />}
        <text x="46" y="48" textAnchor="middle" fontSize="15" fontWeight="300" fill="#141614">{text}</text>
      </svg>
      <div className={s.gaugeLabel}>{label}</div>
    </div>
  );
}

const Range = ({ children }) => <span className={s.tag}><Icon n="calendar" size={11} />{children}</span>;

// ── data shaping ────────────────────────────────────────────────────────────────────────────────────
const pick = (arr, site) => (arr || []).filter((x) => x.status === "ok" && (site === "all" || x.id === site));

/** One combined daily series (visits, conversions, sales) for the chosen sites. */
const SHOPS = ["worthyproducts", "dutchrusk"];   // worthy.nz is the company site: enquiries, no online sales
function combineTraffic(traffic, site, only = null) {
  const m = new Map();
  pick(traffic, site).filter((t) => !only || only.includes(t.id)).forEach((t) => (t.daily || []).forEach((r) => {
    const o = m.get(r.date) || { date: r.date, sessions: 0, conversions: 0, revenue: 0 };
    o.sessions += r.sessions || 0; o.conversions += r.conversions || 0; o.revenue += r.revenue || 0;
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
    return last.map((r, i) => ({ key: r.date, label: dShort(r.date), long: `${DAYS_LONG[d0(r.date).getUTCDay()]} ${dLong(r.date)}`, weekend: [0, 6].includes(d0(r.date).getUTCDay()), a: r.sessions, b: r.revenue, c: before[i]?.sessions ?? null, conv: r.conversions }));
  }
  const keyOf = mode === "weekly" ? (iso) => mondayOf(iso) : (iso) => iso.slice(0, 7);
  const group = (list) => {
    const g = new Map();
    list.forEach((r) => { const k = keyOf(r.date); const o = g.get(k) || { key: k, sessions: 0, revenue: 0, conversions: 0, days: 0 }; o.sessions += r.sessions; o.revenue += r.revenue; o.conversions += r.conversions; o.days += 1; g.set(k, o); });
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
          <linearGradient id="cc-fadeA" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#f2892a" stopOpacity=".16" /><stop offset="1" stopColor="#f2892a" stopOpacity="0" /></linearGradient>
        </defs>
        {rows.map((r, i) => r.weekend ? <rect key={`w${i}`} x={x(i) - step / 2} y={padT} width={step} height={ih} fill="url(#cc-hatch)" rx="3" /> : null)}
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <g key={f}>
            <line x1={padL} x2={padL + iw} y1={padT + ih - f * ih} y2={padT + ih - f * ih} stroke="rgba(20,22,20,.16)" strokeDasharray="5 5" />
            <text x={padL - 8} y={padT + ih - f * ih + 4} textAnchor="end" fontSize="11" fill="#8b918c">{axisNum(maxA * f)}</text>
            <text x={padL + iw + 8} y={padT + ih - f * ih + 4} textAnchor="start" fontSize="11" fill="#5536e6" opacity=".7">{f ? `${lead ? "" : "$"}${axisNum(maxB * f)}` : ""}</text>
          </g>
        ))}
        {rows.map((r, i) => (i % every === 0 || i === rows.length - 1) && (i === rows.length - 1 || rows.length - 1 - i >= every / 2) ? <text key={`l${i}`} x={x(i)} y={H - 8} textAnchor="middle" fontSize="11" fill="#8b918c">{r.label}</text> : null)}
        {hover !== null && <rect x={x(hover) - Math.max(step, 14) / 2} y={padT} width={Math.max(step, 14)} height={ih} fill="url(#cc-hatch)" rx="4" />}
        <path d={`${smoothPath(rows.map((r, i) => [x(i), yA(r.a)]))} L${x(rows.length - 1)},${padT + ih} L${x(0)},${padT + ih} Z`} fill="url(#cc-fadeA)" />
        <path d={smoothPath(rows.map((r, i) => (r.c === null ? null : [x(i), yA(r.c)])))} stroke="#a9adaa" strokeWidth="1.6" fill="none" />
        <path d={smoothPath(rows.map((r, i) => [x(i), yB(r.b)]))} stroke="#5536e6" strokeWidth="2.4" fill="none" />
        <path d={smoothPath(rows.map((r, i) => [x(i), yA(r.a)]))} stroke="#f2892a" strokeWidth="2.6" fill="none" />
        {h && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={padT + 4} y2={padT + ih} stroke="#f2892a" strokeWidth="2" />
            <circle cx={x(hover)} cy={padT + 4} r="6" fill="#f2892a" />
            <circle cx={x(hover)} cy={yB(h.b)} r="4.5" fill="#fff" stroke="#5536e6" strokeWidth="2" />
            <circle cx={x(hover)} cy={yA(h.a)} r="5.5" fill="#f2892a" stroke="#fff" strokeWidth="2" />
          </g>
        )}
      </svg>
      {h && (
        <div className={s.tip} style={{ left: Math.min(Math.max(x(hover), 90), w - 90), top: Math.max(yA(h.a), 70) }}>
          <div><b>{h.long}</b></div>
          {change !== null && <div className={s.tipRow}><span>Change</span><b style={{ color: change >= 0 ? "#1f9d47" : "#e5413c" }}>{change >= 0 ? "+" : ""}{(change * 100).toFixed(2)}%</b></div>}
          <div className={s.tipRow}><span style={{ color: "#f2892a" }}>Visits</span><b>{n0(h.a)}</b></div>
          {lead
            ? <div className={s.tipRow}><span style={{ color: "#5536e6" }}>Enquiries</span><b>{n0(h.conv)}</b></div>
            : <><div className={s.tipRow}><span style={{ color: "#5536e6" }}>Online sales</span><b>{money(h.b)}</b></div>
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
  const k = KINDS[f.kind];
  const set = (key) => (e) => setF({ ...f, [key]: e.target.value });
  const input = (key) => {
    if (key === "site") return <select value={f.site || ""} onChange={set("site")}><option value="">All of Worthy</option>{SITES.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>;
    if (key === "status") return <select value={f.status || k.statuses[0]} onChange={set("status")}>{k.statuses.map((x) => <option key={x} value={x}>{cap(x)}</option>)}</select>;
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
        <h3 className={s.modalTitle}>{item.id ? `Edit ${k.one.toLowerCase()}` : `New ${k.one.toLowerCase()}`}</h3>
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
  const [preset, setPreset] = useState("30d");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [rangeSearch, setRangeSearch] = useState(null);
  const [events, setEvents] = useState(null);

  useEffect(() => {
    const fromHash = () => { const h = window.location.hash.slice(1); if (TABS.some((t) => t.id === h)) setTab(h); };
    fromHash();
    try { const sv = localStorage.getItem("cc-site"); if (sv) setSite(sv); } catch { /* fine */ }
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, []);
  const go = (t) => { setTab(t); try { history.replaceState(null, "", `#${t}`); } catch { /* fine */ } window.scrollTo({ top: 0, behavior: "smooth" }); };
  const chooseSite = (v) => { setSite(v); try { localStorage.setItem("cc-site", v); } catch { /* fine */ } };

  const load = useCallback(async (fresh = false) => {
    setLoading(true);
    try {
      const r = await fetch(`/api/command${fresh ? "?fresh=1" : ""}`, { cache: "no-store" });
      if (r.status === 401 || r.status === 403) { window.location.href = "/login"; return; }
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
      setData(j); setLive(j.live); setAsana(j.asana); setClickup(j.clickup); setBoard(j.board); setLog(j.log || []); setLiveAt(j.builtAt); setFailed("");
    } catch (e) { setFailed(String(e.message || e)); }
    finally { setLoading(false); }
  }, []);
  const loadLive = useCallback(async () => {
    try {
      const r = await fetch("/api/command?live=1", { cache: "no-store" });
      if (!r.ok) return;
      const j = await r.json(); setLive(j.live); if (j.asana) setAsana(j.asana); if (j.clickup) setClickup(j.clickup); setLog(j.log || []); setLiveAt(j.at);
    } catch { /* next tick */ }
  }, []);
  useEffect(() => {
    load();
    const a = setInterval(() => { if (!document.hidden) loadLive(); }, 30000);
    const b = setInterval(() => { if (!document.hidden) load(); }, 5 * 60000);
    const c = setInterval(() => setNow(Date.now()), 1000);
    const vis = () => { if (!document.hidden) loadLive(); };
    document.addEventListener("visibilitychange", vis);
    return () => { clearInterval(a); clearInterval(b); clearInterval(c); document.removeEventListener("visibilitychange", vis); };
  }, [load, loadLive]);

  const save = async (item, action = "save") => {
    setSaving(true); setSaveErr("");
    try {
      const r = await fetch("/api/command", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, item }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Could not save");
      setBoard(j.board); setLog(j.log || []); setEditing(null);
    } catch (e) { setSaveErr(String(e.message || e)); }
    finally { setSaving(false); }
  };
  const quickStatus = (item, status) => save({ ...item, status });
  /** Change a task in Asana or ClickUp itself. The page updates from what the tool sends back. */
  const ext = async (src, id, op, value, title) => {
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
  const defaultKind = { dashboard: "pipeline", search: "authority", outreach: "outreach", listings: "listing", pipeline: "pipeline", meeting: "pipeline" }[tab];

  // ── derived numbers ──
  const today = data?.today || nzTodayIso();
  const yesterday = addDays(today, -1);
  const lead = site === "worthy";
  const daily = useMemo(() => combineTraffic(data?.traffic, site), [data, site]);
  const shopDaily = useMemo(() => (site === "all" ? combineTraffic(data?.traffic, site, SHOPS) : daily), [data, site, daily]);
  const [rStart, rEnd] = rangeFor(preset, from, to, yesterday);
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
    const parts = await Promise.all(ids.map((id) => fetch(`/api/command?events=${id}&start=${a}&end=${b}`, { cache: "no-store" }).then((r) => r.json()).then((j) => (j.rows || []).map((x) => ({ ...x, site: id }))).catch(() => [])));
    setEvents({ loading: false, site: siteId, start: a, end: b, rows: parts.flat().sort((a, b) => b.at.localeCompare(a.at)) });
  };
  const w7 = useMemo(() => windowed(daily, yesterday, 7), [daily, yesterday]);
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
  const rows = useMemo(() => chartSeries(daily, mode, rStart, rEnd).map((x) => (lead ? { ...x, b: x.conv } : x)), [daily, mode, lead, rStart, rEnd]);

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
    return [...fromAsana, ...fromClickup];
  }, [asana, clickup, site, today]);
  const cuOpen = external.filter((x) => x.source === "ClickUp" && x.status !== "done").map((x) => ({ ...x, kind: "asana", status: x.label }));
  const upcomingAll = [...upcoming, ...asanaOpen, ...cuOpen].sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999"));
  const overdue = upcomingAll.filter((x) => x.due && x.due < today).length;

  const feed = useMemo(() => {
    const ev = (log || []).map((e) => ({ ...e, type: /done|won|live/.test(e.what) ? "done" : /moved/.test(e.what) ? "moved" : e.what === "added" ? "added" : "updated" }));
    const logged = new Set(ev.filter((e) => e.type === "done").map((e) => e.title));
    items.filter((x) => x.doneAt && !logged.has(x.title)).forEach((x) => ev.push({ what: x.kind === "listing" ? "live" : "done", kind: x.kind, title: x.title, at: `${x.doneAt}T00:00:00Z`, dateOnly: x.doneAt, type: "done", site: x.site }));
    return ev.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  }, [log, items]);
  const feedShown = feed.filter((e) => feedTab === "all" || e.type === feedTab).slice(0, 30);

  const updatedText = liveAt ? `Live, updated ${ago(liveAt, now)}` : "Connecting";
  const initials = person ? person.slice(0, 2).toUpperCase() : "WO";

  return (
    <div className={s.page}>
      <div className={s.shell}>
        {/* top bar */}
        <header className={s.top}>
          <div className={s.brand}>
            <div className={s.logo}><span>W</span></div>
            <span>Worthy</span>
          </div>
          <nav className={s.nav} aria-label="Command Center sections">
            {TABS.map((t) => (
              <button key={t.id} type="button" className={`${s.navBtn} ${tab === t.id ? s.navOn : ""}`} onClick={() => go(t.id)} aria-current={tab === t.id ? "page" : undefined}>
                <Icon n={t.icon} size={15} />{t.label}
              </button>
            ))}
          </nav>
          <div className={s.tools}>
            <Link className={s.iconBtn} href="/" title="Back to the dashboard"><Icon n="home" size={18} /></Link>
            <button type="button" className={s.iconBtn} title={overdue ? `${overdue} overdue` : "Nothing overdue"} onClick={() => go("meeting")}>
              <Icon n="bell" size={18} />{overdue > 0 && <span className={s.dot} />}
            </button>
            <div className={s.avatar} title={cap(person)}>{initials}</div>
          </div>
        </header>

        {/* heading */}
        <div className={s.head}>
          <div>
            <h1 className={s.title}>{tab === "dashboard" ? "Command Center" : TABS.find((t) => t.id === tab).label === "Meeting" ? "Thursday meeting" : TABS.find((t) => t.id === tab).label}</h1>
            <div className={s.sub}><span className={s.liveDot} />{updatedText}<span>·</span><span>{siteName(site)}</span><span>·</span><span>{rangeText}</span></div>
          </div>
          <div className={s.actions}>
            <button type="button" className={s.btn} onClick={() => load(true)} disabled={loading}><Icon n="refresh" size={15} className={loading ? s.spin : ""} />Refresh</button>
            <select className={s.select} value={preset} onChange={(e) => { setPreset(e.target.value); if (e.target.value === "custom" && !from) { setFrom(rStart); setTo(rEnd); } }} aria-label="Date range">
              {PRESETS.map(([id, l]) => <option key={id} value={id}>{l}</option>)}
            </select>
            {preset === "custom" && (
              <span className={s.dates}>
                <input type="date" value={from} max={yesterday} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
                <span>to</span>
                <input type="date" value={to} max={yesterday} onChange={(e) => setTo(e.target.value)} aria-label="To" />
              </span>
            )}
            <select className={s.select} value={site} onChange={(e) => chooseSite(e.target.value)} aria-label="Site">
              <option value="all">All sites</option>
              {SITES.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
            {tab === "meeting"
              ? <a className={`${s.btn} ${s.btnDark}`} href={`https://app.asana.com/0/${ASANA_PROJECT}/list`} target="_blank" rel="noreferrer"><Icon n="plus" size={15} stroke={2} />New task in Asana</a>
              : <button type="button" className={`${s.btn} ${s.btnDark}`} onClick={() => newItem(defaultKind)}><Icon n="plus" size={15} stroke={2} />Add {KINDS[defaultKind].one.toLowerCase()}</button>}
          </div>
        </div>

        {failed && !data && <div className={s.card}><div className={s.err}>Could not load: {failed}</div></div>}

        {tab === "dashboard" && (
          <div className={s.fade}>
            {/* KPI strip */}
            <section className={s.kpis}>
              <div className={s.kpi}>
                <div className={s.kpiTop}><div className={s.kpiNum}>{n0(liveNow)}</div><div className={`${s.chip} ${s.chipGreen}`}><Icon n="eye" size={15} /></div></div>
                <div className={s.kpiLabel}>Visitors right now</div>
                <Spark values={liveMinutes} hotLast={5} />
              </div>
              <div className={s.kpi}>
                <div className={s.kpiTop}><div className={s.kpiNum}>{searchSites.length ? n0(nbClicks[0]) : "-"}</div><div className={`${s.chip} ${s.chipOrange}`}><Icon n="click" size={15} /></div></div>
                <div className={s.kpiLabel}>Non-branded search clicks {searchSites.length > 0 && <Delta now={nbClicks[0]} before={nbClicks[1]} />}</div>
                <Spark values={nbDaily.length ? nbDaily : new Array(28).fill(0)} hotLast={7} />
              </div>
              <div className={`${s.kpi} ${lead ? s.kpiClick : ""}`} onClick={lead ? () => openEvents(site) : undefined} role={lead ? "button" : undefined} tabIndex={lead ? 0 : undefined}>
                <div className={s.kpiTop}><div className={s.kpiNum}>{data ? (lead ? n0(conv[0]) : moneyShort(rev[0])) : "-"}</div><div className={`${s.chip} ${s.chipViolet}`}><Icon n={lead ? "mail" : "cart"} size={15} /></div></div>
                <div className={s.kpiLabel}>{lead ? "Enquiries" : "Online sales"} {lead ? <Delta now={conv[0]} before={conv[1]} /> : <Delta now={rev[0]} before={rev[1]} />}</div>
                <Spark values={w30.cur.map((r) => (lead ? r.conversions : r.revenue))} hotLast={7} />
              </div>
              <div className={`${s.kpi} ${s.kpiClick}`} onClick={() => openEvents(site)} role="button" tabIndex={0}>
                <div className={s.kpiTop}><div className={s.kpiNum}>{cr[0] === null ? "-" : (cr[0] * 100).toFixed(2)}<small>%</small></div><div className={s.chip}><Icon n="target" size={15} /></div></div>
                <div className={s.kpiLabel}>{lead ? "Enquiry rate" : "Conversion rate"} <Delta now={cr[0]} before={cr[1]} points /></div>
                <Spark values={w30.cur.map((r) => r.conversions)} hotLast={7} />
              </div>
            </section>

            <div className={s.grid}>
              <div className={s.stack}>
                <section className={s.card}>
                  <div className={s.cardHead}>
                    <h2 className={s.cardTitle}>{lead ? "Traffic vs enquiries" : "Traffic vs sales"}</h2>
                    <div className={s.seg}>
                      {["daily", "weekly", "monthly"].map((m) => <button key={m} type="button" className={mode === m ? s.segOn : ""} onClick={() => setMode(m)}>{cap(m)}</button>)}
                    </div>
                  </div>
                  <div className={s.cardHead} style={{ marginBottom: 6 }}>
                    <div className={s.legend}>
                      <span><i style={{ background: "#f2892a" }} />Visits</span>
                      <span><i style={{ background: "#5536e6" }} />{lead ? "Enquiries" : "Online sales"}</span>
                      <span><i style={{ background: "#a9adaa" }} />Previous</span>
                    </div>
                    <Range>{rangeText}</Range>
                  </div>
                  <TrafficChart rows={rows} mode={mode} lead={lead} />
                </section>

                <div className={s.grid2}>
                  <section className={s.card}>
                    <div className={s.cardHead}><h2 className={s.cardTitle}>Live activity</h2></div>
                    <div className={s.seg} style={{ marginBottom: 12 }}>
                      {[["all", "All"], ["done", "Done"], ["moved", "Moved"], ["added", "Added"]].map(([id, l]) => <button key={id} type="button" className={feedTab === id ? s.segOn : ""} onClick={() => setFeedTab(id)}>{l}</button>)}
                    </div>
                    <div className={s.feed}>
                      {feedShown.length === 0 && <div className={s.empty}>Nothing yet</div>}
                      {feedShown.map((e, i) => (
                        <div key={i} className={s.feedItem}>
                          <div className={s.feedIcon}><Icon n={KIND_ICON[e.kind] || "flow"} size={15} /></div>
                          <div style={{ minWidth: 0 }}>
                            <div className={s.feedTitle}>{e.title}</div>
                            <div className={s.feedMeta}>{KINDS[e.kind]?.label || SRC_LABEL[e.kind] || ""}{e.person ? ` · ${cap(e.person)}` : ""} · {e.dateOnly ? dShort(e.dateOnly) : ago(e.at, now)}</div>
                          </div>
                          <span className={`${s.pill} ${e.type === "done" ? s.pillGreen : e.type === "moved" ? s.pillViolet : e.type === "added" ? s.pillAmber : s.pillGrey}`}>{e.type === "done" ? cap(e.what === "live" ? "live" : "done") : cap(e.type)}</span>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className={s.card}>
                    <div className={s.cardHead}>
                      <h2 className={s.cardTitle}>Next up</h2>
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
                          : <span className={`${s.pill} ${s.pillAmber}`}>{cap(x.status)}</span>}
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
                  const tw = tr?.status === "ok" ? windowed(tr.daily || [], yesterday, 30).cur : [];
                  const ts = sumOf(tw, "sessions"), tc = sumOf(tw, "conversions");
                  const okS = sr?.status === "ok";
                  const p1 = okS && sr.totals.queries[0] ? sr.totals.pageOne[0] / sr.totals.queries[0] : 0;
                  const ctr = okS && sr.totals.impressions[0] ? sr.totals.clicks[0] / sr.totals.impressions[0] : 0;
                  const crt = ts ? tc / ts : 0;
                  const dim = site !== "all" && site !== x.id;
                  return (
                    <section key={x.id} className={s.site} style={{ opacity: dim ? 0.45 : 1, cursor: "pointer" }} onClick={() => chooseSite(site === x.id ? "all" : x.id)}>
                      <div className={s.siteHead}>
                        <div className={s.siteName}>{x.name}</div>
                        {lv?.status === "ok"
                          ? <span className={`${s.pill} ${lv.now > 0 ? s.pillGreen : s.pillGrey}`}>{lv.now > 0 ? `${lv.now} live` : "Quiet"}</span>
                          : <span className={`${s.pill} ${data ? s.pillRed : s.pillGrey}`}>{data ? "Not connected" : "Loading"}</span>}
                      </div>
                      <div className={s.siteSub}>{okS ? `Avg position ${n1(sr.totals.nonBrandedPosition[0])} · ${n0(sr.totals.queries[0])} search terms` : sr?.status === "error" ? "Offline" : ""}</div>
                      <div className={s.gauges}>
                        <Gauge value={p1} color="#e5413c" label="Page 1 terms" text={okS ? `${Math.round(p1 * 100)}%` : "-"} />
                        <Gauge value={Math.min(1, ctr * 5)} color="#f2892a" label="Search CTR" text={okS ? `${(ctr * 100).toFixed(1)}%` : "-"} />
                        <Gauge value={Math.min(1, crt * 10)} color="#5536e6" label={x.id === "worthy" ? "Enquiry rate" : "Conversion"} text={ts ? `${(crt * 100).toFixed(1)}%` : "-"} />
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

        {tab === "search" && <SearchTab data={data} site={site} items={items} onEdit={(x) => { setSaveErr(""); setEditing(x); }} onAdd={newItem} />}
        {tab === "outreach" && <BoardTab kind="outreach" items={items} site={site} today={today} onEdit={(x) => { setSaveErr(""); setEditing(x); }} onAdd={newItem} onMove={quickStatus} />}
        {tab === "listings" && <BoardTab kind="listing" items={items} site={site} today={today} onEdit={(x) => { setSaveErr(""); setEditing(x); }} onAdd={newItem} onMove={quickStatus} />}
        {tab === "pipeline" && <BoardTab kind="pipeline" onExt={ext} items={[...items, ...external]} site={site} today={today} onEdit={(x) => { setSaveErr(""); setEditing(x); }} onAdd={newItem} onMove={quickStatus} />}
        {tab === "meeting" && (
          <MeetingTab data={data} onEvents={openEvents} onExt={ext} external={external} asanaTasks={asanaTasks} asana={asana} site={site} items={items} today={today} w7={w7} w30={w30} daily={daily} nbClicks={nbClicks} searchRange={searchRange} liveNow={liveNow}
            onEdit={(x) => { setSaveErr(""); setEditing(x); }} onAdd={newItem} onDone={(x) => quickStatus(x, "done")} saving={saving} />
        )}

      </div>

      {events && <EventsModal ev={events} onClose={() => setEvents(null)} />}
      {editing && <Editor key={editing.id || "new"} item={editing} busy={saving} error={saveErr} onClose={() => setEditing(null)} onSave={(f) => save(f)} onDelete={(f) => save(f, "delete")} />}
    </div>
  );
}

// ── Search tab ──────────────────────────────────────────────────────────────────────────────────────
function SearchTab({ data, site, items, onEdit, onAdd }) {
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
  const th = (k, label, num) => <th className={num ? s.num : ""} onClick={() => setSort({ k, dir: sort.k === k ? -sort.dir : k === "position" || k === "query" ? 1 : -1 })}>{label}{sort.k === k ? (sort.dir > 0 ? " ↑" : " ↓") : ""}</th>;
  const posCls = (p) => (p <= 3 ? s.pos1 : p <= 10 ? s.pos2 : p <= 20 ? s.pos3 : s.pos4);
  const range = sites[0]?.range;
  const pages = sites.flatMap((x) => x.pages.map((p) => ({ ...p, site: x.id }))).sort((a, b) => b.clicks - a.clicks).slice(0, 10);
  const idx = pick(data?.indexing, site);
  const auth = items.filter((x) => x.kind === "authority" && (site === "all" || x.site === site)).sort((a, b) => String(b.month || "").localeCompare(String(a.month || "")));
  const winners = all.filter((r) => r.prevPosition && r.impressions >= 10).map((r) => ({ ...r, move: r.prevPosition - r.position })).sort((a, b) => b.move - a.move);
  return (
    <div className={s.fade}>
      <section className={s.kpis}>
        <div className={s.kpi}><div className={s.kpiNum}>{data ? n0(T("nonBrandedClicks", 0)) : "-"}</div><div className={s.kpiLabel}>Non-branded clicks <Delta now={T("nonBrandedClicks", 0)} before={T("nonBrandedClicks", 1)} /></div></div>
        <div className={s.kpi}><div className={s.kpiNum}>{data ? n0(T("nonBrandedImpressions", 0)) : "-"}</div><div className={s.kpiLabel}>Impressions <Delta now={T("nonBrandedImpressions", 0)} before={T("nonBrandedImpressions", 1)} /></div></div>
        <div className={s.kpi}><div className={s.kpiNum}>{data ? n0(T("pageOne", 0)) : "-"}</div><div className={s.kpiLabel}>Terms on page 1 <Delta now={T("pageOne", 0)} before={T("pageOne", 1)} /></div></div>
        <div className={s.kpi}><div className={s.kpiNum}>{data ? n1(wpos(0)) : "-"}</div><div className={s.kpiLabel}>Average position <Delta now={wpos(0)} before={wpos(1)} invert /></div></div>
      </section>
      <div className={s.grid}>
        <section className={s.card}>
          <div className={s.cardHead}>
            <h2 className={s.cardTitle}>Non-branded rankings</h2>
            {range && <Range>{`${dShort(range.start)} to ${dShort(range.end)}`}</Range>}
          </div>
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
                      <td className={s.num} style={{ color: mv === null ? "#8b918c" : mv > 0.05 ? "#1f9d47" : mv < -0.05 ? "#e5413c" : "#8b918c" }}>{mv === null ? "New" : Math.abs(mv) < 0.05 ? "Same" : <>{mv > 0 ? "▲" : "▼"} {n1(Math.abs(mv))}</>}</td>
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
            <div className={s.cardHead}><h2 className={s.cardTitle}>Biggest climbers</h2></div>
            {winners.length === 0 && <div className={s.empty}>{data ? "None yet" : ""}</div>}
            {winners.filter((r) => r.move > 0).slice(0, 6).map((r) => (
              <div key={`${r.site}-${r.query}`} className={s.row}>
                <div style={{ minWidth: 0 }}><div className={s.rowTitle}>{r.query}</div><div className={s.rowMeta}>{siteName(r.site)} · {n1(r.prevPosition)} to {n1(r.position)}</div></div>
                <span className={`${s.pill} ${s.pillGreen}`}>+{n1(r.move)}</span>
              </div>
            ))}
          </section>
          <section className={s.card}>
            <div className={s.cardHead}><h2 className={s.cardTitle}>Indexing</h2></div>
            {idx.length === 0 && <div className={s.empty}>{data ? "Offline" : ""}</div>}
            {idx.map((x) => x.sitemaps.map((m) => (
              <div key={m.path} className={s.row}>
                <div style={{ minWidth: 0 }}>
                  <div className={s.rowTitle}>{siteName(x.id)}</div>
                  <div className={s.rowMeta}>{n0(m.submitted)} pages · read {m.lastDownloaded ? dShort(m.lastDownloaded) : "-"}</div>
                </div>
                <span className={`${s.pill} ${m.errors ? s.pillRed : m.pending ? s.pillAmber : s.pillGreen}`}>{m.errors ? `${m.errors} errors` : m.pending ? "Pending" : "Read"}</span>
              </div>
            )))}
          </section>
          <section className={s.card}>
            <div className={s.cardHead}>
              <h2 className={s.cardTitle}>Authority</h2>
              <button type="button" className={`${s.btn} ${s.btnSmall}`} onClick={() => onAdd("authority", { month: new Date().toISOString().slice(0, 7) })}><Icon n="plus" size={13} />Record</button>
            </div>
            {auth.length === 0 && <div className={s.empty}>Nothing yet</div>}
            {auth.slice(0, 8).map((x) => (
              <div key={x.id} className={s.row} style={{ cursor: "pointer" }} onClick={() => onEdit(x)}>
                <div style={{ minWidth: 0 }}><div className={s.rowTitle}>{x.title}</div><div className={s.rowMeta}>{siteName(x.site)}{x.month ? ` · ${monthLabel(x.month)}` : ""}</div></div>
                <div className={s.statNum} style={{ fontSize: 22 }}>{x.score || "-"}</div>
              </div>
            ))}
          </section>
          <section className={s.card}>
            <div className={s.cardHead}><h2 className={s.cardTitle}>Top pages</h2></div>
            {pages.map((p) => (
              <div key={p.page} className={s.row}>
                <div style={{ minWidth: 0 }}><div className={s.rowTitle}>{p.page.replace(/^https?:\/\/(www\.)?/, "")}</div><div className={s.rowMeta}>{n0(p.impressions)} shown · position {n1(p.position)}</div></div>
                <div className={s.statNum} style={{ fontSize: 20 }}>{n0(p.clicks)}</div>
              </div>
            ))}
          </section>
        </div>
      </div>
    </div>
  );
}

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
        <div className={s.statLine}>
          {k.statuses.map((st) => <div key={st} className={s.stat}><div className={s.statNum}>{by(st).length}</div><div className={s.statLabel}>{cap(st)}</div></div>)}
          <div className={s.stat}><div className={s.statNum} style={{ color: overdue ? "#e5413c" : undefined }}>{overdue}</div><div className={s.statLabel}>Overdue</div></div>
        </div>
      </section>
      <div className={s.board}>
        {k.statuses.map((st) => (
          <section key={st} className={s.col}>
            <div className={s.colHead}><span>{st}</span><span className={s.count}>{by(st).length}</span></div>
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
                    {x.link && <a href={x.link} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} style={{ color: "#5536e6", display: "inline-flex" }} aria-label="Open link"><Icon n="link" size={13} /></a>}
                    {x.src && st !== "done" && (
                      <button type="button" className={`${s.btn} ${s.btnSmall}`} style={{ marginLeft: "auto", padding: "4px 9px" }}
                        onClick={(e) => { e.stopPropagation(); if (x.src === "clickup" && st === "next") onExt("clickup", x.rid, "status", "in progress", x.title); else onExt(x.src, x.rid, "done", null, x.title); }}>
                        {x.src === "clickup" && st === "next" ? "Start" : "Done"}<Icon n={st === "next" && x.src === "clickup" ? "move" : "check"} size={12} />
                      </button>
                    )}
                    {next && next !== "lost" && !x.source && (
                      <button type="button" className={`${s.btn} ${s.btnSmall}`} style={{ marginLeft: "auto", padding: "4px 9px" }} onClick={(e) => { e.stopPropagation(); onMove(x, next); }}>
                        {cap(next)}<Icon n="move" size={12} />
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
function MeetingTab({ data, onEvents, onExt, asana, asanaTasks, external, site, items, today, w7, w30, daily, nbClicks, searchRange, liveNow, onEdit, onAdd, onDone, saving }) {
  const t = d0(today); const wd = t.getUTCDay();
  const nextThu = addDays(today, (4 - wd + 7) % 7);
  const lastThu = addDays(nextThu, -7);
  const inSite = (x) => site === "all" || !x.site || x.site === site;
  const asanaDone = asanaTasks.filter((t) => t.done && t.doneAt && t.doneAt.slice(0, 10) >= lastThu)
    .map((t) => ({ id: `as_${t.id}`, kind: "asana", title: t.name, doneAt: t.doneAt.slice(0, 10), owner: t.owner, url: t.url, site: t.sites?.length === 1 ? t.sites[0] : "" }));
  const doneSince = [...items.filter((x) => x.doneAt && x.doneAt >= lastThu && inSite(x)), ...asanaDone].sort((a, b) => b.doneAt.localeCompare(a.doneAt));
  const nextUp = [...items.filter((x) => x.kind === "pipeline" && x.status !== "done" && inSite(x)), ...external.filter((x) => x.source === "ClickUp" && x.status !== "done")]
    .sort((a, b) => String(a.due || "9999").localeCompare(String(b.due || "9999"))).slice(0, 8);
  const v = [sumOf(w7.cur, "sessions"), sumOf(w7.prev, "sessions")];
  const r = [sumOf(w7.cur, "revenue"), sumOf(w7.prev, "revenue")];
  const lead = site === "worthy";
  const sd = site === "all" ? combineTraffic(data?.traffic, site, SHOPS) : daily;
  const sw = windowed(sd, addDays(today, -1), 7);
  const c = [sumOf(sw.cur, "conversions"), sumOf(sw.prev, "conversions")];
  const sv = [sumOf(sw.cur, "sessions"), sumOf(sw.prev, "sessions")];
  const ew = windowed(combineTraffic(data?.traffic, "worthy"), addDays(today, -1), 7);
  const e = [sumOf(ew.cur, "conversions"), sumOf(ew.prev, "conversions")];
  // spend and return by month
  const spend = items.filter((x) => x.kind === "spend" && (site === "all" || x.site === site));
  const months = [...new Set([...spend.map((x) => x.month).filter(Boolean)])].sort().reverse().slice(0, 6);
  const revByMonth = (ym) => daily.filter((d) => d.date.startsWith(ym)).reduce((a, d) => a + d.revenue, 0);
  const leadsByMonth = (ym) => daily.filter((d) => d.date.startsWith(ym)).reduce((a, d) => a + d.conversions, 0);
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
          <h2 className={s.cardTitle}>Ecom x Marketing, {DAYS_LONG[d0(nextThu).getUTCDay()]} {dLong(nextThu)}</h2>
          <Range>{`${dShort(addDays(today, -7))} to ${dShort(addDays(today, -1))}`}</Range>
        </div>
        <div className={s.statLine}>
          <div className={s.stat}><div className={s.statNum}>{n0(v[0])}</div><div className={s.statLabel}>Visits <Delta now={v[0]} before={v[1]} /></div></div>
          {!lead && <div className={s.stat}><div className={s.statNum}>{money(r[0])}</div><div className={s.statLabel}>Online sales <Delta now={r[0]} before={r[1]} /></div></div>}
          <div className={`${s.stat} ${s.kpiClick}`} onClick={() => onEvents(site === "all" ? "all" : site, addDays(today, -7), addDays(today, -1))}><div className={s.statNum}>{n0(c[0])}</div><div className={s.statLabel}>{lead ? "Enquiries" : "Orders"} <Delta now={c[0]} before={c[1]} /></div></div>
          <div className={s.stat}><div className={s.statNum}>{sv[0] ? `${((c[0] / sv[0]) * 100).toFixed(2)}%` : "-"}</div><div className={s.statLabel}>{lead ? "Enquiry rate" : "Conversion"} <Delta now={sv[0] ? c[0] / sv[0] : null} before={sv[1] ? c[1] / sv[1] : null} points /></div></div>
          {site === "all" && <div className={`${s.stat} ${s.kpiClick}`} onClick={() => onEvents("worthy", addDays(today, -7), addDays(today, -1))}><div className={s.statNum}>{n0(e[0])}</div><div className={s.statLabel}>worthy.nz enquiries <Delta now={e[0]} before={e[1]} /></div></div>}
          <div className={s.stat}><div className={s.statNum}>{n0(nbClicks[0])}</div><div className={s.statLabel}>Non-branded clicks <Delta now={nbClicks[0]} before={nbClicks[1]} /></div></div>
          <div className={s.stat}><div className={s.statNum}>{n0(liveNow)}</div><div className={s.statLabel}>Live now</div></div>
        </div>
      </section>

      <AsanaCard asana={asana} tasks={asanaTasks} site={site} today={today} lastThu={lastThu} onExt={onExt} saving={saving} />

      <div className={s.grid2} style={{ marginTop: 14 }}>
        <section className={s.card}>
          {nextUp.length === 0 && <><div className={s.cardHead}><h2 className={s.cardTitle}>Up next</h2></div><div className={s.empty}>All clear</div></>}
          {nextUp.length > 0 && <>
            <div className={s.cardHead}><h2 className={s.cardTitle}>Up next</h2></div>
            {nextUp.map((x) => (
              <div key={x.id} className={s.row} style={{ cursor: "pointer" }} onClick={() => (x.source ? window.open(x.url, "_blank", "noopener") : onEdit(x))}>
                <div style={{ minWidth: 0 }}><div className={s.rowTitle}>{x.title}</div><div className={s.rowMeta}>{x.source ? `${x.source} · ${x.label}` : cap(x.status)}{x.due ? ` · ${dShort(x.due)}` : ""}{x.site ? ` · ${siteName(x.site)}` : ""}</div></div>
                <span className={`${s.pill} ${x.status === "in progress" ? s.pillViolet : s.pillGrey}`}>{cap(x.status)}</span>
              </div>
            ))}
          </>}
        </section>

        <section className={s.card}>
          <div className={s.cardHead}>
            <h2 className={s.cardTitle}>Done this week</h2>
            <Range>{`Since ${dShort(lastThu)}`}</Range>
          </div>
          {doneSince.length === 0 && <div className={s.empty}>Nothing yet</div>}
          {doneSince.map((x) => (
            <div key={x.id} className={s.row} style={{ cursor: "pointer" }} onClick={() => (x.kind === "asana" ? window.open(x.url, "_blank", "noopener") : onEdit(x))}>
              <div style={{ minWidth: 0 }}><div className={s.rowTitle}>{x.title}</div><div className={s.rowMeta}>{x.kind === "asana" ? `Asana${x.owner ? ` · ${x.owner}` : ""}` : KINDS[x.kind].label}{x.site ? ` · ${siteName(x.site)}` : ""} · {dShort(x.doneAt)}</div></div>
              <span className={`${s.pill} ${s.pillGreen}`}><Icon n="check" size={11} stroke={2.4} /></span>
            </div>
          ))}
        </section>
      </div>

      <div className={s.grid2} style={{ marginTop: 14 }}>
        <section className={s.card}>
          <div className={s.cardHead}>
            <h2 className={s.cardTitle}>Spend and return</h2>
            <button type="button" className={`${s.btn} ${s.btnSmall}`} onClick={() => onAdd("spend", { month: today.slice(0, 7) })}><Icon n="plus" size={13} />Add spend</button>
          </div>
          {months.length === 0 && <div className={s.empty}>Nothing yet</div>}
          {months.length > 0 && (
            <div className={s.tableWrap}>
              <table className={s.table}>
                <thead><tr><th>Month</th><th className={s.num}>Spend</th><th className={s.num}>{lead ? "Enquiries" : "Online sales"}</th><th className={s.num}>{lead ? "Cost each" : "Return"}</th></tr></thead>
                <tbody>
                  {months.map((ym) => {
                    const sp = spend.filter((x) => x.month === ym).reduce((a, x) => a + (Number(x.amount) || 0), 0);
                    if (lead) { const ld = leadsByMonth(ym); return <tr key={ym}><td>{monthLabel(ym)}</td><td className={s.num}>{money(sp)}</td><td className={s.num}>{n0(ld)}</td><td className={s.num}>{ld ? money(sp / ld) : "-"}</td></tr>; }
                    const rv = revByMonth(ym);
                    return <tr key={ym}><td>{monthLabel(ym)}</td><td className={s.num}>{money(sp)}</td><td className={s.num}>{money(rv)}</td><td className={s.num}>{sp ? `${(rv / sp).toFixed(1)}x` : "-"}</td></tr>;
                  })}
                </tbody>
              </table>
            </div>
          )}
          {spend.length > 0 && <div style={{ marginTop: 12 }}>{spend.slice(0, 6).map((x) => (
            <div key={x.id} className={s.row} style={{ cursor: "pointer" }} onClick={() => onEdit(x)}>
              <div style={{ minWidth: 0 }}><div className={s.rowTitle}>{x.title}</div><div className={s.rowMeta}>{siteName(x.site) || "All of Worthy"}{x.month ? ` · ${monthLabel(x.month)}` : ""}</div></div>
              <div>{money(Number(x.amount) || 0)}</div>
            </div>
          ))}</div>}
        </section>

        <section className={s.card}>
          <div className={s.cardHead}>
            <h2 className={s.cardTitle}>Where visits come from</h2>
            <Range>30 days</Range>
          </div>
          {channels.length === 0 && <div className={s.empty}>{site === "worthyproducts" ? "No data" : data ? "No data" : ""}</div>}
          <div className={s.bars}>
            {channels.map((ch, i) => (
              <div key={ch.name} className={s.barRow}>
                <span style={{ overflowWrap: "anywhere" }}>{ch.name}</span>
                <div className={s.barTrack}><div className={`${s.barFill} ${i % 2 ? s.barFillV : ""}`} style={{ width: `${(ch.sessions / chMax) * 100}%` }} /></div>
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
    <section className={s.card}>
      <div className={s.cardHead}>
        <h2 className={s.cardTitle}>Meeting tasks</h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {ok && <span className={`${s.pill} ${asana.stale ? s.pillAmber : s.pillGreen}`}>{asana.stale ? "Delayed" : "Live from Asana"}</span>}
          {asana && !ok && <span className={`${s.pill} ${s.pillRed}`}>{asana.status === "not_connected" ? "Asana not connected" : "Asana offline"}</span>}
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
                    <span className={s.barTrack} style={{ width: 80, display: "inline-block" }}><span className={s.barFill} style={{ display: "block", width: `${t.subtasks.length ? (subDone / t.subtasks.length) * 100 : 0}%` }} /></span>
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
  const kinds = [...new Set(ev.rows.map((r) => r.event))];
  const rows = ev.rows.filter((r) => kind === "all" || r.event === kind);
  const when = (at) => { const d = d0(at.slice(0, 10)); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}, ${at.slice(11, 16)}`; };
  const pages = Object.entries(rows.reduce((m, r) => ({ ...m, [r.page]: (m[r.page] || 0) + r.count }), {})).sort((a, b) => b[1] - a[1]).slice(0, 5);
  return (
    <div className={s.scrim} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`${s.modal} ${s.modalWide} ${s.fade}`}>
        <div className={s.cardHead}>
          <h3 className={s.modalTitle} style={{ margin: 0 }}>{ev.site === "worthy" ? "Enquiries" : "Conversions"} · {siteName(ev.site)}</h3>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}><Range>{`${dShort(ev.start)} to ${dLong(ev.end)}`}</Range><button type="button" className={s.iconBtn} onClick={onClose} aria-label="Close" style={{ width: 34, height: 34 }}><Icon n="plus" size={16} className={s.rot45} /></button></div>
        </div>
        {ev.loading && <div className={s.skeleton} style={{ height: 160 }} />}
        {!ev.loading && (
          <>
            <div className={s.statLine} style={{ marginBottom: 14 }}>
              <div className={s.stat}><div className={s.statNum}>{n0(rows.reduce((a, r) => a + r.count, 0))}</div><div className={s.statLabel}>Total</div></div>
              {pages.map(([pg, n]) => <div key={pg} className={s.stat}><div className={s.statNum}>{n}</div><div className={s.statLabel}>{pg}</div></div>)}
            </div>
            {kinds.length > 1 && <div className={s.seg} style={{ marginBottom: 10 }}>{[["all", "All"], ...kinds.map((k) => [k, EVENT_LABEL[k] || cap(k.replace(/_/g, " "))])].map(([id, l]) => <button key={id} type="button" className={kind === id ? s.segOn : ""} onClick={() => setKind(id)}>{l}</button>)}</div>}
            {rows.length === 0 && <div className={s.empty}>None in this period</div>}
            {rows.length > 0 && (
              <div className={s.tableWrap} style={{ maxHeight: "55vh", overflowY: "auto" }}>
                <table className={s.table}>
                  <thead><tr><th>When</th><th>What</th>{ev.site === "all" && <th>Site</th>}<th>Page</th><th className={s.hideSm}>Came from</th><th className={s.hideSm}>Town</th><th className={s.hideSm}>Device</th></tr></thead>
                  <tbody>{rows.map((r, i) => (
                    <tr key={i}>
                      <td style={{ whiteSpace: "nowrap" }}>{when(r.at)}</td>
                      <td>{EVENT_LABEL[r.event] || cap(r.event.replace(/_/g, " "))}{r.count > 1 ? ` x${r.count}` : ""}</td>
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
          </>
        )}
      </div>
    </div>
  );
}
