"use client";

/**
 * Worthy design kit: the parts every page is built from (26 Nov 2026). Same look as the Command Center.
 *
 * Rules (Pratham, 26 Nov 2026):
 * - Three colours only: off-white page (about 60%), ink (about 30%), orange accent (about 10%). No green, red, violet or
 *   brand blues. Rising figures are ink with a drawn triangle, falling ones are the accent.
 * - Infographics first, numbers always beside them. Order by importance and by how figures relate (visits, then orders,
 *   then sales).
 * - Every card title has an icon from app/design/icons.js that fits it.
 * - Every table or card that covers a period shows its dates (Range).
 * - No explanation notes, no emoji, no arrow characters, no em dashes.
 * - Only show what is verified: never add figures that are measured differently, say "none recorded before" rather than
 *   "was 0" when there was no data, leave out what cannot be added up honestly.
 */
import u from "./ui.module.css";
import { Icon } from "./icons";

export { Icon };
export const ui = u;

// Colours for charts (recharts takes plain values, not CSS variables)
export const COLORS = { page: "#f5f4ef", card: "#fbfaf7", ink: "#141614", ink2: "#4a4f4b", mute: "#8b918c", line: "rgba(30,25,15,0.08)", accent: "#f2892a", inkSoft: "rgba(20,22,20,0.28)", inkFaint: "rgba(20,22,20,0.12)" };

// ── formatting ──
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const n0 = (v) => (v === null || v === undefined || Number.isNaN(v) ? "-" : Math.round(v).toLocaleString("en-NZ"));
export const money = (v) => (v === null || v === undefined ? "-" : `${v < 0 ? "-" : ""}$${Math.abs(Math.round(v)).toLocaleString("en-NZ")}`);
export const moneyShort = (v) => {
  if (v === null || v === undefined) return "-";
  const a = Math.abs(v), sign = v < 0 ? "-" : "";
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(2)}m`;
  if (a >= 1e4) return `${sign}$${(a / 1e3).toFixed(1)}k`;
  return `${sign}$${Math.round(a).toLocaleString("en-NZ")}`;
};
export const short = (v) => (v === null || v === undefined ? "-" : Math.abs(v) >= 10000 ? `${(v / 1000).toFixed(1)}k` : n0(v));
export const pct = (v, dp = 1) => (v === null || v === undefined || !Number.isFinite(v) ? "-" : `${(v * 100).toFixed(dp)}%`);
export const monthLabel = (ym) => { const [y, m] = String(ym).split("-"); return `${MONTHS[Number(m) - 1]} ${String(y).slice(2)}`; };
export const dShort = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ""); return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}` : ""; };
export const dLong = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ""); return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : ""; };

// ── structure ──
export const Card = ({ children, className = "", style, ...rest }) => <section className={`${u.card} ${className}`} style={style} {...rest}>{children}</section>;
export const CardHead = ({ icon, title, children }) => (
  <div className={u.cardHead}>
    <h2 className={u.cardTitle}>{icon && <span className={u.titleIcon}><Icon n={icon} size={15} /></span>}{title}</h2>
    {children && <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>{children}</div>}
  </div>
);
export const Mini = ({ icon, children }) => <div className={u.miniHead}>{icon && <Icon n={icon} size={13} />}{children}</div>;
export const Range = ({ children }) => (children ? <span className={u.tag}><Icon n="calendar" size={11} />{children}</span> : null);
export const Pill = ({ children, tone = "grey" }) => <span className={`${u.pill} ${tone === "dark" ? u.pillDark : tone === "accent" ? u.pillAccent : u.pillGrey}`}>{children}</span>;
export const Empty = ({ children = "None in this period" }) => <div className={u.empty}>{children}</div>;
export const Skeleton = ({ height = 160 }) => <div className={u.skeleton} style={{ height }} />;

// ── numbers ──
/** Change against the earlier figure. Up = ink, down = accent. `points` for rates (difference in percentage points). */
export function Trend({ now, before, points = false, invert = false }) {
  if (now === null || now === undefined || before === null || before === undefined) return null;
  let d, txt;
  if (points) { d = now - before; txt = `${Math.abs(d * 100).toFixed(1)} pts`; }
  else { if (!before) return null; d = (now - before) / before; if (!Number.isFinite(d)) return null; txt = `${Math.abs(d * 100).toFixed(1)}%`; }
  if (Math.abs(d) < 0.0005) return <span className={u.trend}>no change</span>;
  const bad = invert ? d > 0 : d < 0;
  return <span className={`${u.trend} ${bad ? u.trendDown : ""}`}><Icon n={d < 0 ? "tri-down" : "tri-up"} size={8} />{txt}</span>;
}
/** Same as Trend for a change already worked out as a percentage number (e.g. 12.3 for +12.3%). */
export function TrendPct({ value, invert = false }) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  if (Math.abs(value) < 0.05) return <span className={u.trend}>no change</span>;
  const bad = invert ? value > 0 : value < 0;
  return <span className={`${u.trend} ${bad ? u.trendDown : ""}`}><Icon n={value < 0 ? "tri-down" : "tri-up"} size={8} />{Math.abs(Math.round(value * 10) / 10)}%</span>;
}

/** Headline strip: up to four big figures. items = [{ label, value, icon, trend }] */
export const KpiStrip = ({ items }) => (
  <section className={u.kpis}>
    {items.map((k) => (
      <div key={k.label} className={u.kpi} onClick={k.onClick} role={k.onClick ? "button" : undefined} style={k.onClick ? { cursor: "pointer" } : undefined}>
        <div className={u.kpiTop}><div className={u.kpiNum} style={k.accent ? { color: "var(--orange)" } : undefined}>{k.value ?? "-"}</div>{k.icon && <div className={u.chip}><Icon n={k.icon} size={15} /></div>}</div>
        <div className={u.kpiLabel}>{k.label} {k.trend}</div>
        {k.foot && <div className={u.statLabel} style={{ marginTop: 10 }}>{k.foot}</div>}
      </div>
    ))}
  </section>
);

/** A big number with its label and change. pair = [now, before]. */
export function Big({ value, label, pair, fmt = n0, points, accent, invert }) {
  return (
    <div className={u.stat}>
      <div className={u.statNum} style={accent ? { color: "var(--orange)" } : undefined}>{value ?? (pair ? fmt(pair[0]) : "-")}</div>
      <div className={u.statLabel}>{label}</div>
      {pair && (pair[1] === 0 && pair[0] > 0
        ? <div style={{ marginTop: 4 }}><span className={u.was}>none recorded before</span></div>
        : pair[1] !== null && pair[1] !== undefined && <div style={{ marginTop: 4 }}><Trend now={pair[0]} before={pair[1]} points={points} invert={invert} /> <span className={u.was}>was {fmt(pair[1])}</span></div>)}
    </div>
  );
}
export const StatLine = ({ children, tight }) => <div className={`${u.statLine} ${tight ? u.statTight : ""}`}>{children}</div>;

// ── infographics ──
/** Bars by month (or any period). rows = [{ month: "2026-11" | label, value }]. The last bar is the accent. */
export function MonthBars({ rows, k = "value", fmt = n0, labelOf }) {
  if (!rows?.length) return null;
  const max = Math.max(1, ...rows.map((r) => Math.max(0, r[k] || 0)));
  return (
    <div className={u.monthBars}>
      {rows.map((r, i) => {
        const lab = labelOf ? labelOf(r) : /^\d{4}-\d{2}/.test(String(r.month)) ? monthLabel(r.month).slice(0, 3) : String(r.month ?? r.label ?? "");
        return (
          <div key={`${r.month ?? r.label}-${i}`} title={`${lab}: ${fmt(r[k])}`}>
            <b>{fmt === money || fmt === moneyShort ? moneyShort(r[k]) : short(r[k])}</b>
            <i className={i === rows.length - 1 ? u.hot : ""} style={{ height: `${Math.max(3, (Math.max(0, r[k] || 0) / max) * 100)}%` }} />
            <span>{lab}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Ranked horizontal bars with value and share. The top row is the accent. */
export function BarList({ rows, k = "value", fmt = n0, limit = 6, caps = false, share = true, labelKey = "name" }) {
  if (!rows?.length) return <Empty />;
  const list = rows.slice(0, limit);
  const total = rows.reduce((t, r) => t + Math.max(0, r[k] || 0), 0) || 1;
  const max = Math.max(1, ...list.map((r) => Math.max(0, r[k] || 0)));
  return (
    <div className={u.bars}>
      {list.map((r, i) => (
        <div key={`${r[labelKey]}-${i}`} className={u.barRow}>
          <span style={{ overflowWrap: "anywhere", textTransform: caps ? "capitalize" : "none" }}>{r[labelKey]}</span>
          <div className={u.barTrack}><div className={`${u.barInk} ${i === 0 ? u.barAccent : ""}`} style={{ width: `${(Math.max(0, r[k] || 0) / max) * 100}%` }} /></div>
          <span className={u.num}>{fmt(r[k])}{share && <> <span className={u.was}>{Math.round((Math.max(0, r[k] || 0) / total) * 100)}%</span></>}</span>
        </div>
      ))}
    </div>
  );
}

/** Ring split: the biggest part in the accent, the rest in ink at falling strength. */
export function Ring({ rows, k = "value", labelKey = "name", fmt = n0, size = 120 }) {
  const list = (rows || []).filter((r) => (r[k] || 0) > 0);
  const total = list.reduce((t, r) => t + r[k], 0);
  if (!total) return <Empty />;
  const R = 34, C = 2 * Math.PI * R;
  const lens = list.map((r) => (r[k] / total) * C);
  const offs = lens.map((_, i) => lens.slice(0, i).reduce((t, v) => t + v, 0));
  const shades = [1, 0.75, 0.4, 0.2, 0.1];
  return (
    <div className={u.ringWrap}>
      <svg viewBox="0 0 90 90" className={u.ring} style={{ width: size, height: size }} role="img" aria-label="Split">
        <circle cx="45" cy="45" r={R} fill="none" stroke="rgba(0,0,0,.05)" strokeWidth="11" />
        {list.map((r, i) => (
          <circle key={r[labelKey]} cx="45" cy="45" r={R} fill="none" stroke={i === 0 ? "var(--orange)" : "var(--ink)"} strokeOpacity={i === 0 ? 1 : shades[i] ?? 0.1}
            strokeWidth="11" strokeDasharray={`${lens[i]} ${C - lens[i]}`} strokeDashoffset={-offs[i]} transform="rotate(-90 45 45)" />
        ))}
        <text x="45" y="49" textAnchor="middle" fontSize="13" fontWeight="300" fill="var(--ink)">{Math.round((list[0][k] / total) * 100)}%</text>
      </svg>
      <div className={u.ringLegend}>
        {list.map((r, i) => (
          <div key={r[labelKey]}><i style={{ background: i === 0 ? "var(--orange)" : "var(--ink)", opacity: i === 0 ? 1 : shades[i] ?? 0.1 }} /><span>{r[labelKey]}</span><b>{fmt(r[k])}</b></div>
        ))}
      </div>
    </div>
  );
}

/** Figures that follow from each other, with what links each step (a rate, an average). steps = [{ label, value, pair, link, accent }] */
export function Chain({ steps, compact = false }) {
  return (
    <div className={`${u.chain} ${compact ? u.chainCompact : ""}`}>
      {steps.map((st, i) => (
        <div key={st.label} className={u.chainStep}>
          {i > 0 && <div className={u.chainLink}><span>{st.link}</span><span className={u.chainArrow}><Icon n="move" size={16} /></span></div>}
          <div className={u.chainBox}>
            <div className={u.chainNum} style={st.accent ? { color: "var(--orange)" } : undefined}>{st.value}</div>
            <div className={u.statLabel}>{st.label}</div>
            {st.pair && <div style={{ marginTop: 4 }}><Trend now={st.pair[0]} before={st.pair[1]} invert={st.invert} /></div>}
          </div>
        </div>
      ))}
    </div>
  );
}

/** One bar split into parts (share of a total). parts = [{ name, value }] */
export function ShareBar({ parts, fmt = moneyShort }) {
  const total = parts.reduce((t, p) => t + Math.max(0, p.value || 0), 0);
  if (!total) return null;
  const tone = (i) => (i === 0 ? "var(--orange)" : `rgba(20,22,20,${[0.85, 0.5, 0.25, 0.12][i - 1] ?? 0.1})`);
  return (
    <div>
      <div className={u.shareBar}>{parts.map((p, i) => <i key={p.name} style={{ width: `${(Math.max(0, p.value || 0) / total) * 100}%`, background: tone(i) }} title={`${p.name}: ${fmt(p.value)}`} />)}</div>
      <div className={u.shareLegend}>{parts.map((p, i) => <span key={p.name}><i style={{ background: tone(i) }} />{p.name} {Math.round((Math.max(0, p.value || 0) / total) * 100)}% · {fmt(p.value)}</span>)}</div>
    </div>
  );
}

/** Progress towards a target: a thick track with the accent fill and the figures beside it. */
export function Progress({ value, target, fmt = moneyShort, label }) {
  const p = target > 0 ? Math.max(0, Math.min(1, value / target)) : 0;
  return (
    <div>
      {label && <div className={u.statLabel} style={{ marginBottom: 6 }}>{label}</div>}
      <div className={u.barTrack} style={{ height: 10 }}><div className={u.barAccent} style={{ height: "100%", width: `${p * 100}%`, borderRadius: 999 }} /></div>
      <div className={u.was} style={{ marginTop: 6 }}>{fmt(value)} of {fmt(target)} · {Math.round((target > 0 ? value / target : 0) * 100)}%</div>
    </div>
  );
}

/** Small sparkline of bars (no labels), last `hot` bars in ink at full strength. */
export function Spark({ values, hot = 0 }) {
  const max = Math.max(1, ...values.map((v) => Math.max(0, v || 0)));
  return <div className={u.spark}>{values.map((v, i) => <i key={i} className={i >= values.length - hot ? u.hot : ""} style={{ height: `${Math.max(6, (Math.max(0, v || 0) / max) * 100)}%` }} />)}</div>;
}
