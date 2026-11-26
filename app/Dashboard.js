"use client";

import SiteNav from "@/app/design/SiteNav";
import MarginMix from "@/app/design/MarginMix";
import ShortDated from "@/app/design/ShortDated";
import StockStates from "@/app/design/StockStates";
import { fyTargetOf } from "@/lib/repTargetMath";
import React, { useState, useEffect, useRef, useReducer } from "react";
import Link from "next/link";
import {
  Area, BarChart, Bar, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ComposedChart, ReferenceLine, Cell
} from "recharts";
import { bankTargetFor } from "@/lib/bankTargets";
import { weekOfMonth } from "@/lib/weekOfMonth";
import { Card, CardHead, Mini, Pill, StatLine, MonthBars, BarList, Ring, Chain, ShareBar, COLORS, ui, moneyShort, usePaged, Paged } from "@/app/design/ui";
import { Icon } from "@/app/design/icons";
import st from "./page.module.css";

/* Worthy design (26 Nov 2026): three colours. Page off-white, ink for text, bars and lines, and the orange accent only
   for the one figure that matters most, the latest period, or a fall / overdue / below-target. No per-company colours. */
const INK = COLORS.ink;
const ORANGE = COLORS.accent;
const inkA = (a) => `rgba(20,22,20,${a})`;

const STORES = [
  { id: "worthy", name: "Worthy Products North", logo: "products", currency: "NZD", odooCompanyId: 4 },
  { id: "luxe",   name: "Worthy Products South", logo: "products", currency: "NZD" },
  { id: "nova",   name: "Worthy Oceania",        logo: "oceania",  currency: "NZD", odooCompanyId: 1 },
];

const ALL_YEARS = [2022, 2023, 2024, 2025, 2026];
// A date lands in financial year Y when it falls between 1 Apr Y and 31 Mar Y+1.
const fyOf = (isoDate) => {
  const [y, m] = String(isoDate).split("-").map(Number);
  return m >= 4 ? y : y - 1;
};
const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const generateEmptyYear = () =>
  MONTH_NAMES.map(m => ({
    month: m, revenue: 0, totalCost: 0, grossProfit: 0, marginPct: null,
    orders: 0, returns: 0, sessions: 0, totalDiscounts: 0, aov: 0,
    convRate: 0, newCustomers: 0, hasCostData: true, marginableRevenue: 0
  }));

// Dutch Rusk / Worthy South financial year: April → March
const FY_MONTHS = ["Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec","Jan","Feb","Mar"];

const calcGrowth = (c, p) => (!p || p === 0) ? null : +((( c - p) / p) * 100).toFixed(1);
const fmt   = (n, cur = "NZD") => new Intl.NumberFormat("en-NZ", { style: "currency", currency: cur, maximumFractionDigits: 0 }).format(n || 0);
const fmtK  = (n, cur = "NZD") => {
  if (n === null || n === undefined) return "-";
  const s = cur === "NZD" ? "NZ$" : "$";
  const sign = (n || 0) < 0 ? "-" : "";
  return `${sign}${s}${Math.abs(Math.round(n || 0)).toLocaleString('en-NZ')}`;
};
// Exact whole-and-cents amount, e.g. NZ$1,277,734.48 - ties to Ostendo to the cent
const fmtExact = (n, cur = "NZD") => {
  if (n === null || n === undefined) return "-";
  const s = cur === "NZD" ? "NZ$" : "$";
  const sign = n < 0 ? "-" : "";
  return `${sign}${s}${Math.abs(n).toLocaleString('en-NZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const round2 = (n) => Math.round(((n || 0) + Number.EPSILON) * 100) / 100;
/* Every margin on this page is quoted to one decimal. Rounding some of them to
   whole numbers put 14% in the monthly footer and 12% on a KPI card beside
   13.8% and 12.1% for the same trading, which reads as two systems disagreeing
   rather than one number formatted two ways. */
const marginPct1 = (num, den) => (den > 0 ? Math.round((num / den) * 1000) / 10 : null);
const fmtPct = (n) => (n === null || n === undefined) ? "-" : `${n > 0 ? "+" : ""}${n}%`;

/* "2026-04-01" -> "1 Apr 2026". Read from the text, never through Date, so a
   timezone can never move a day. */
const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtDay = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  return m ? `${Number(m[3])} ${SHORT_MONTHS[Number(m[2]) - 1]} ${m[1]}` : "";
};
// Date range tag for every card or table that covers a period (the design kit's Range).
const RangeTag = ({ text, style }) => !text ? null : (
  <span className={ui.tag} style={style}><Icon n="calendar" size={11} />{text}</span>
);

/* A change already worked out as a number (12.3 = +12.3%). Up is ink with a drawn triangle, down is the accent.
   `unit` is "%" for growth or " pts" for a change in a margin. Rounded at the point of display, so binary noise such
   as 0.5999999999999996 never reaches the screen. */
const Delta = ({ value, unit = "%" }) => {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return (
    <span className={`${ui.trend} ${value < 0 ? ui.trendDown : ""}`}>
      <Icon n={value < 0 ? "tri-down" : "tri-up"} size={8} />{Math.round(Math.abs(value) * 10) / 10}{unit}
    </span>
  );
};

const GrowthBadge = ({ value }) => {
  if (value === null || value === undefined) return <span style={{ color: COLORS.mute }}>-</span>;
  return <Delta value={value} />;
};

// Margin with a small bar. Below the 20% margin target it is the accent.
const MarginBar = ({ value }) => {
  if (value === null || value === undefined) return <span style={{ color: COLORS.mute }}>-</span>;
  const low = value < 20;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ width: 34, height: 5, borderRadius: 999, background: inkA(0.08), overflow: "hidden" }}>
        <div style={{ width: `${Math.min(Math.max(value, 0), 100)}%`, height: "100%", background: low ? ORANGE : INK, opacity: low ? 1 : 0.78, borderRadius: 999 }} />
      </div>
      <span style={{ color: low ? ORANGE : INK, fontWeight: 500, fontSize: 13 }}>{value}%</span>
    </div>
  );
};

// Chart tooltip: light, on white.
const CustomTooltip = ({ active, payload, label, currency = "NZD" }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "#fff", border: `1px solid ${COLORS.line}`, borderRadius: 14, padding: "10px 14px", fontSize: 13.5, color: INK, boxShadow: "0 12px 30px -18px rgba(40,32,20,0.45)" }}>
      <div style={{ marginBottom: 6, fontSize: 14, fontWeight: 500 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 3 }}>
          <span style={{ width: 8, height: 8, borderRadius: 3, background: p.color, display: "inline-block" }} />
          <span style={{ color: COLORS.mute }}>{p.name}:</span>
          <span style={{ color: INK, fontWeight: 500 }}>
            {["Revenue","AOV","Gross Profit"].includes(p.name) ? fmt(p.value, currency) : p.name === "Growth" ? fmtPct(p.value) : String(p.value?.toLocaleString?.() ?? p.value)}
          </span>
        </div>
      ))}
    </div>
  );
};

/* One cell of the headline strip (the design kit's KpiStrip look), with the count-up kept. */
const KPICard = ({ label, value, growth, icon, sub, animated, currency = "NZD", exact = false, compareText = null, growthUnit = "%" }) => {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    const t = value || 0;
    /* Never animate into a tab nobody is looking at. Browsers throttle
       setInterval to about once a second in a background tab, so a 0.8s count-up
       became a 40s one and the headline figure sat visibly wrong long after the
       page had finished loading. Hidden: show the real number at once. If the
       reader leaves mid-count, snap to it and stop. */
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!animated || t === 0 || (typeof document !== 'undefined' && document.hidden)) { setDisplay(t); return; }
    let cur = 0; const step = t / 40;
    const timer = setInterval(() => { cur += step; if (cur >= t) { setDisplay(t); clearInterval(timer); } else setDisplay(Math.round(cur)); }, 20);
    const settle = () => { if (document.hidden) { clearInterval(timer); setDisplay(t); } };
    document.addEventListener('visibilitychange', settle);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', settle); };
  }, [value, animated]);
  return (
    <div className={ui.kpi}>
      <div className={ui.kpiTop}>
        <div className={ui.kpiNum} style={{ fontSize: "clamp(24px, 2.3vw, 34px)", overflowWrap: "anywhere" }}>
          {value === null ? "-" : sub === "currency" ? (exact ? fmtExact(display, currency) : fmtK(display, currency)) : sub === "pct" ? `${Number(display).toFixed(1)}%` : display.toLocaleString()}
        </div>
        <div className={ui.chip}><Icon n={icon} size={15} /></div>
      </div>
      <div className={ui.kpiLabel}>{label} {value === null ? null : growth === null ? <span className={ui.was}>No comparison</span> : <Delta value={growth} unit={growthUnit} />}</div>
      {compareText && <div className={ui.statLabel} style={{ marginTop: 8 }}>{compareText}</div>}
    </div>
  );
};

// Company switcher button (inside a segmented control). No per-company colours: the name is enough.
const StorePill = ({ store, active, onClick }) => (
  <button type="button" onClick={onClick} className={active ? ui.segOn : ""} aria-pressed={active}>{store.name}</button>
);

// A plain notice: "warn" for figures that did not load or are missing, otherwise neutral.
const Notice = ({ tone = "info", icon = "alert", role, children, style }) => (
  <div role={role} className={`${st.notice} ${tone === "warn" ? st.noticeWarn : ""}`} style={style}>
    <span className={st.noticeIcon}><Icon n={icon} size={15} /></span>
    <div style={{ minWidth: 0, flex: 1 }}>{children}</div>
  </div>
);

// Shared table look: uppercase muted headers, hairline rows, tabular numbers.
const thStyle = (align = "right") => ({ padding: "8px 10px", textAlign: align, color: COLORS.mute, fontSize: 12.5, fontWeight: 400, textTransform: "uppercase", letterSpacing: "0.04em", whiteSpace: "nowrap", borderBottom: `1px solid ${COLORS.line}` });
const tdStyle = { padding: "10px 10px", fontSize: 14, color: INK, borderBottom: `1px solid ${COLORS.line}`, fontVariantNumeric: "tabular-nums" };
const footStyle = (align = "right") => ({ ...tdStyle, textAlign: align, fontWeight: 500, borderBottom: 0, borderTop: `1px solid ${inkA(0.18)}` });
// Inputs and selects in the filter rows.
const SELECT_STYLE = { font: "inherit", fontSize: 14.5, padding: "9px 12px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.95)", background: "rgba(255,255,255,0.75)", color: INK, maxWidth: "100%" };

const WORTHY_CONTEXT = `
You are a senior business analyst embedded at Worthy Products NZ, a wholesale confectionery and beverages distributor based in Auckland.

BUSINESS OVERVIEW:
- Wholesale distributor of confectionery and beverages to the NZ trade market
- Procures locally (NZ) and imports from: USA, Thailand, Korea, Australia, Vietnam, Malaysia, China and other markets
- Customers: Dairies, supermarkets, petrol stations/gas stations, local corner stores, night market vendors, event suppliers
- Also runs a small B2C channel where end customers buy by the carton and pay online directly
- B2B customers are on credit terms; B2C customers pay upfront online
- Currency: NZD. Target gross margin: 20% annually
- Main competitors: DKSH, Gilmours, Geneva, Stock4Shop, Nalsun Imports - all aggressive online

SALES TEAM (5 reps, all via POS/field sales):
- Hari Patel: Auckland East, West, North Shore
- Nayan Patel: Auckland East, West, North Shore (works alongside Hari)
- Rubin Monpara: South Auckland including Pukekohe, Waiuku, Tuakau
- Savan: Waikato Region including Hawke's Bay
- Naitik Trivedi: Northland including Whangārei

CHANNELS:
- POS/Field Sales: Reps visit stores directly, take orders on the spot
- Online Sales: Covers ALL of NZ - rep territories + remote areas reps can't reach. Strategic priority to grow online significantly to compete with DKSH, Gilmours, Geneva, Stock4Shop, Nalsun Imports.

NZ SEASONS (Southern Hemisphere - opposite to northern hemisphere):
- Summer: December, January, February - hottest months, beverages/cold drinks/iced confectionery peak
- Autumn: March, April, May - transitioning, beverage demand tapering, confectionery starting to pick up
- Winter: June, July, August - coldest months, chocolate and warm confectionery peak demand
- Spring: September, October, November - warming up, mixed demand

TODAY'S DATE: ${new Date().toLocaleDateString('en-NZ', { month: 'long', day: 'numeric', year: 'numeric' })}
CURRENT NZ SEASON: ${(() => {
  const m = new Date().getMonth(); // 0-indexed
  if (m <= 1 || m === 11) return "Summer (December–February) - peak beverage and cold drink season";
  if (m <= 4) return "Autumn (March–May) - beverages tapering, confectionery starting to rise";
  if (m <= 7) return "Winter (June–August) - peak chocolate and confectionery season";
  return "Spring (September–November) - mixed demand, beverages beginning to recover";
})()}

STRATEGIC PRIORITIES:
1. Grow online sales aggressively - this is the #1 growth lever right now
2. Defend territory against competitors with strong online presence
3. Maintain 20% gross margin target
4. Identify slow-moving imported stock early (import lead times make overstock costly)
5. Keep B2B credit customers ordering regularly - churn is expensive to recover

When analysing data, always:
- Reference specific rep names and their territories where relevant
- Correctly apply NZ seasonality - summer is Dec–Feb, winter is Jun–Aug
- Flag margin concerns vs the 20% target
- Highlight online channel growth opportunities specifically
- Note if imported product lines are at risk (slow-moving imported stock ties up capital and has long reorder lead times)
- Be direct and actionable - the audience is the owner and sales manager, not an analyst
`;

// ── AI Insights Panel ─────────────────────────────────────────────────────────
const AIInsights = ({ data, context, currency, extraContext }) => {
  const [insight, setInsight]   = useState(null);
  const [loading, setLoading]   = useState(false);
  const [open,    setOpen]      = useState(false);

  const getInsights = async () => {
    if (insight) { setOpen(o => !o); return; }
    setLoading(true); setOpen(true);
    try {
      const prompt = `${WORTHY_CONTEXT}

${extraContext ? extraContext + "\n\n" : ""}Analyse this ${context} data and provide 4-5 specific, actionable insights. Be direct. Reference rep names, territories, and product categories where relevant.

Data (${currency}):
${JSON.stringify(data?.slice?.(0,25) ?? data, null, 2)}

Format your response as:
**[Insight Title]**
1-2 sentences of direct, specific analysis and recommended action.

No generic advice. Every point must reference something specific in the data.`;

      const res  = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const json = await res.json();
      setInsight(json.text || json.error || "No insights available.");
    } catch (e) {
      setInsight("Failed to load insights. Please try again.");
    }
    setLoading(false);
  };

  return (
    <div style={{ marginTop: 14 }}>
      <button type="button" onClick={getInsights} className={`${ui.btn} ${ui.btnSmall}`}>
        <Icon n="sparkle" size={13} />{loading ? "Analysing…" : open ? "Hide AI Insights" : "AI Insights"}
      </button>
      {open && !loading && insight && (
        <div style={{ marginTop: 10, padding: "14px 16px", borderRadius: 16, background: "rgba(255,255,255,0.75)", border: `1px solid ${COLORS.line}`, fontSize: 14, color: COLORS.ink2, lineHeight: 1.75, whiteSpace: "pre-wrap" }}>
          {insight}
        </div>
      )}
      {open && loading && (
        <div style={{ marginTop: 10, padding: "12px 16px", borderRadius: 16, background: "rgba(255,255,255,0.75)", border: `1px solid ${COLORS.line}`, fontSize: 13.5, color: COLORS.mute, display: "flex", alignItems: "center", gap: 6 }}>
          <Icon n="sparkle" size={13} />Analysing Worthy Products data…
        </div>
      )}
    </div>
  );
};

// ── Category Drill-Down Modal ─────────────────────────────────────────────────
const CategoryModal = ({ category, products, currency, onClose }) => {
  if (!category) return null;
  const top      = (products || []).filter(p => p.revenue > 0).slice(0, 10);
  const declining = (products || []).filter(p => p.yoyChange !== null && p.yoyChange < -10).slice(0, 10);
  const rising    = (products || []).filter(p => p.yoyChange !== null && p.yoyChange > 10 && p.revenue > 0).slice(0, 5);
  const row = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "9px 0", borderBottom: `1px solid ${COLORS.line}`, flexWrap: "wrap" };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(20,22,20,0.35)", backdropFilter: "blur(4px)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={onClose}>
      <div style={{ background: COLORS.card, border: "1px solid rgba(40,32,20,0.06)", borderRadius: 26, padding: 24, maxWidth: 800, width: "100%", maxHeight: "80vh", overflowY: "auto", boxShadow: "0 30px 80px -30px rgba(40,32,20,0.45)" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 18 }}>
          <div>
            <h2 className={ui.cardTitle}><span className={ui.titleIcon}><Icon n="folder" size={15} /></span>{category}</h2>
            <div style={{ fontSize: 13.5, color: COLORS.mute, marginTop: 6 }}>{(products||[]).length} products · click outside to close</div>
          </div>
          <button type="button" onClick={onClose} className={ui.chip} style={{ border: 0, cursor: "pointer" }} aria-label="Close"><Icon n="close" size={16} /></button>
        </div>

        {top.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <Mini icon="award">Top Performers</Mini>
            {top.map((p, i) => (
              <div key={i} style={row}>
                <div style={{ fontSize: 14.5, color: INK, flex: 1, minWidth: 160 }}>{p.name}</div>
                <div style={{ display: "flex", gap: 16, fontSize: 13.5, alignItems: "center" }}>
                  <span style={{ color: INK, fontWeight: 500 }}>{p.revenue > 0 ? `NZ$${(p.revenue/1000).toFixed(1)}k` : "-"}</span>
                  <span style={{ color: COLORS.mute }}>{p.qtySold} units</span>
                  {p.yoyChange !== null && <span><Delta value={p.yoyChange} /> <span className={ui.was}>YoY</span></span>}
                </div>
              </div>
            ))}
          </div>
        )}

        {rising.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <Mini icon="trending">Growing Fast</Mini>
            {rising.map((p, i) => (
              <div key={i} style={row}>
                <div style={{ fontSize: 14.5, color: INK }}>{p.name}</div>
                <span><Delta value={p.yoyChange} /> <span className={ui.was}>YoY</span></span>
              </div>
            ))}
          </div>
        )}

        {declining.length > 0 && (
          <div>
            <Mini icon="alert">Declining in This Category</Mini>
            {declining.map((p, i) => (
              <div key={i} style={row}>
                <div style={{ fontSize: 14.5, color: INK, flex: 1, minWidth: 160 }}>{p.name}</div>
                <div style={{ display: "flex", gap: 16, fontSize: 13.5, alignItems: "center" }}>
                  <span style={{ color: COLORS.ink2 }}>{p.revenue > 0 ? `NZ$${(p.revenue/1000).toFixed(1)}k` : "NZ$0"}</span>
                  <span><Delta value={-Math.abs(p.yoyChange)} /> <span className={ui.was}>YoY</span></span>
                </div>
              </div>
            ))}
          </div>
        )}

        {top.length === 0 && declining.length === 0 && (
          <div style={{ textAlign: "center", color: COLORS.mute, padding: 20 }}>No product data for this category in the selected period.</div>
        )}

        <AIInsights data={products} context={`${category} category products`} currency={currency} />
      </div>
    </div>
  );
};

/* CSV export. Writes what the table shows, with a byte-order mark so Excel opens
   it with the right characters. The period is in the file name. */
const csvCell = (v) => {
  if (v === null || v === undefined || typeof v === "object") return "";
  const t = String(v);
  return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};
const slugOf = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const downloadCsv = (fileName, headers, rows) => {
  try {
    const text = [headers, ...rows].map(r => r.map(csvCell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = fileName;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  } catch (e) { console.error("CSV export failed", e); }
};
const ExportButton = ({ title, range, columns, data }) => {
  if (!data || data.length === 0) return null;
  const run = () => downloadCsv(
    `${slugOf(title)}${range ? "_" + slugOf(range) : ""}.csv`,
    columns.map(c => c.label),
    data.map(row => columns.map(c => row[c.key])),
  );
  return (
    <button type="button" onClick={run} title="Download as CSV" aria-label={`Download ${title} as CSV`} className={`${ui.btn} ${ui.btnSmall}`}>
      <Icon n="download" size={13} />CSV
    </button>
  );
};

/* Old per-column colours from before the three-colour design map onto ink, or the accent for a figure that is bad news
   (capital tied up, a fall). Columns may also pass INK / ORANGE / COLORS values directly. */
const WARN_COLOURS = ["#f87171", "#dc2626", "#b91c1c", "#c2410c", "#b45309"];
const tone = (c) => (!c ? INK : WARN_COLOURS.includes(c) ? ORANGE : c.startsWith("#") && c !== INK && c !== ORANGE && c !== COLORS.ink2 && c !== COLORS.mute ? COLORS.ink2 : c);

// Long tables show 25 rows at a time; the CSV and the AI summary still use every row.
const AdvancedTable = ({ title, subtitle, columns, data, loading, currency = "NZD", onRowClick, aiContext, aiExtra, headerExtra, icon, range, visual }) => {
  const pg = usePaged(data, `${title}|${data?.length ?? 0}`);
  return (
  <Card style={{ display: "flex", flexDirection: "column", height: "100%" }}>
    <CardHead icon={icon || "grid"} title={<>{title}{loading && <span style={{ marginLeft: 10, verticalAlign: "middle" }}><Pill>Loading</Pill></span>}</>}>
      {headerExtra}<RangeTag text={range} /><ExportButton title={title} range={range} columns={columns} data={data} />
    </CardHead>
    {subtitle && <div style={{ fontSize: 13.5, color: COLORS.mute, margin: "-6px 0 14px" }}>{subtitle}</div>}
    {visual && !loading && data?.length > 0 && <div style={{ marginBottom: 18 }}>{visual}</div>}
    <div style={{ overflowX: "auto", overflowY: "auto", maxHeight: 350, flex: 1 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
        <thead style={{ position: "sticky", top: 0, background: COLORS.card, zIndex: 1 }}>
          <tr>
            {columns.map((col, i) => (
              <th key={i} style={thStyle(col.align || "left")}>{col.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {!loading && pg.shown.map((row, i) => (
            <tr key={i} onClick={onRowClick ? () => onRowClick(row) : undefined}
              style={{ cursor: onRowClick ? "pointer" : "default", transition: "background 0.15s" }}
              onMouseEnter={e => { if (onRowClick) e.currentTarget.style.background = inkA(0.04); }}
              onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}>
              {columns.map((col, j) => (
                <td key={j} style={{ ...tdStyle, textAlign: col.align || "left", color: tone(col.color), fontWeight: j === 0 ? 500 : 400 }}>
                  {col.format ? col.format(row[col.key], currency, row) : row[col.key]}
                </td>
              ))}
            </tr>
          ))}
          {!loading && (!data || data.length === 0) && (
            <tr><td colSpan={columns.length} style={{ padding: "20px", textAlign: "center", color: COLORS.mute }}>No data available</td></tr>
          )}
        </tbody>
      </table>
    </div>
    {!loading && pg.bar}
    {aiContext && !loading && data?.length > 0 && (
      <AIInsights data={data} context={aiContext} currency={currency} extraContext={aiExtra} />
    )}
  </Card>
  );
};

/* Debtors: what customers owe and how overdue it is, as at today. The figure is
   Odoo's own receivable balance (checked against the ledger to the cent). */
const SectionTitle = ({ icon, children }) => (
  <h2 className={ui.cardTitle} style={{ fontSize: 20, display: "flex", alignItems: "center" }}>
    <span className={ui.titleIcon}><Icon n={icon} size={15} /></span>{children}
  </h2>
);
/* A headline number tile in the three colours: the accent only when `hot` (overdue, a fall, the key figure). */
const Tile = ({ label, value, note, hot, icon }) => (
  <div className={ui.kpi} style={{ background: "transparent" }}>
    <div className={ui.kpiNum} style={{ fontSize: "clamp(21px, 1.7vw, 26px)", whiteSpace: "nowrap", color: hot ? ORANGE : INK }}>{value}</div>
    <div className={ui.kpiLabel}>{icon && <Icon n={icon} size={14} />}{label}</div>
    {note && <div className={ui.statLabel} style={{ marginTop: 6, lineHeight: 1.45 }}>{note}</div>}
  </div>
);
// A run of Tiles in one strip, wrapping on small screens.
const TileStrip = ({ children }) => <section className={`${ui.kpis} ${st.tileStrip}`}>{children}</section>;
/* Debtors for the Odoo companies, built for whoever chases payment: what is owed and how
   late, who to chase first, whose customers they are, every customer (not just the worst
   forty) with search and filters, and each customer's open invoices one click away. */
const DebtorsOdoo = ({ d, currency = "NZD" }) => {
  const [q, setQ] = useState("");
  const [show, setShow] = useState("all");
  const [rep, setRep] = useState("All");
  const [sort, setSort] = useState("overdue");
  const [hideIC, setHideIC] = useState(false);
  const [open, setOpen] = useState(null);
  const money = (v) => fmtExact(v, currency);
  const red = ORANGE;
  const t = d.totals;
  const dash = (v, bold, color) => (!v ? <span style={{ color: COLORS.mute }}>-</span> : <span style={{ fontWeight: bold ? 500 : 400, color }}>{money(v)}</span>);
  const cell = tdStyle;
  const head = thStyle;
  const card = { marginBottom: 14 };
  const title = (icon, text, sub, extra) => (
    <>
      <CardHead icon={icon} title={text}>{extra}</CardHead>
      {sub && <div style={{ fontSize: 13.5, color: COLORS.mute, margin: "-6px 0 14px" }}>{sub}</div>}
    </>);
  const sel = SELECT_STYLE;

  const bands = [
    ["current", "Not yet due", inkA(0.12)], ["d1to30", "1 to 30 days late", inkA(0.3)], ["d31to60", "31 to 60", inkA(0.55)],
    ["d61to90", "61 to 90", inkA(0.85)], ["over90", "Over 90", ORANGE],
  ];
  const pctOf = (v) => (t.outstanding > 0 ? (v / t.outstanding) * 100 : 0);

  const needle = q.trim().toLowerCase();
  const rows = d.customers.filter(c =>
    (!hideIC || !c.intercompany) && (rep === "All" || c.rep === rep) &&
    (show === "all" || (show === "overdue" && c.overdue > 0) || (show === "31" && c.d31to60 + c.d61to90 + c.over90 > 0)
      || (show === "61" && c.d61to90 + c.over90 > 0) || (show === "90" && c.over90 > 0)) &&
    (!needle || c.name.toLowerCase().includes(needle)));
  const order = {
    overdue: (a, b) => b.overdue - a.overdue || b.total - a.total,
    total: (a, b) => b.total - a.total,
    oldest: (a, b) => b.oldestDays - a.oldestDays || b.overdue - a.overdue,
    name: (a, b) => a.name.localeCompare(b.name),
  }[sort];
  rows.sort(order);
  // Totals and the CSV use every matching customer; only the table rows are paged.
  const sum = (k) => rows.reduce((s, c) => s + c[k], 0);
  const pg = usePaged(rows, `${q}|${show}|${rep}|${sort}|${hideIC}`);
  const repPg = usePaged(d.reps);
  const shownRows = pg.shown;
  const filtered = rows.length !== d.customers.length;

  // Chase first: customers with money more than 60 days past due, biggest first.
  const chase = d.customers.filter(c => !c.intercompany && c.d61to90 + c.over90 > 0)
    .sort((a, b) => (b.d61to90 + b.over90) - (a.d61to90 + a.over90)).slice(0, 10);

  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const download = (name, lines) => {
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href);
  };
  const csvCustomers = () => download(`debtors-by-customer-${d.asOf}.csv`, [
    ["Customer", "Sales rep", "Inter-company", "Not yet due", "1 to 30 late", "31 to 60 late", "61 to 90 late", "Over 90 late", "Total owed", "Overdue", "Oldest (days late)", "Open documents"].map(esc).join(","),
    ...rows.map(c => [c.name, c.rep, c.intercompany ? "Yes" : "", c.current, c.d1to30, c.d31to60, c.d61to90, c.over90, c.total, c.overdue, c.oldestDays, c.documents].map(esc).join(","))]);
  const nameOf = new Map(d.customers.map(c => [c.id, c.name]));
  const repOf = new Map(d.customers.map(c => [c.id, c.rep]));
  const csvInvoices = () => download(`debtors-open-invoices-${d.asOf}.csv`, [
    ["Customer", "Sales rep", "Document", "Type", "Invoice date", "Due date", "Days late", "Outstanding"].map(esc).join(","),
    ...d.invoices.slice().sort((a, b) => (nameOf.get(a.c) || "").localeCompare(nameOf.get(b.c) || "") || b.days - a.days)
      .map(i => [nameOf.get(i.c), repOf.get(i.c), i.doc, i.kind, i.inv, i.due, Math.max(i.days, 0), i.amt].map(esc).join(","))]);

  return (
    <div style={{ marginTop: 28 }}>
      <div className={st.sectionHead}>
        <div>
          <SectionTitle icon="wallet">Debtors</SectionTitle>
          <div className={st.sectionSub}>What customers owe us, how late it is, who to chase and whose customers they are. Amounts include GST. Lateness is counted from the due date</div>
        </div>
        <RangeTag text={`As at ${fmtDay(d.asOf)}`} />
      </div>

      <TileStrip>
        <Tile icon="wallet" label="Owed to us" value={money(t.outstanding)} note={`${d.documents.toLocaleString()} open invoices from ${d.customerCount.toLocaleString()} customers${t.intercompany?.total ? `. ${money(t.intercompany.total)} of it is inter-company (${d.intercompanyLabel || "Worthy South and Oceania"})` : ""}`} />
        <Tile icon="alert" label="Overdue" value={money(t.overdue)} note={t.overduePct != null ? `${t.overduePct}% of what is owed` : null} hot={t.overdue > 0} />
        <Tile icon="hourglass" label="Over 60 days late" value={money(t.d61to90 + t.over90)} note="More than 60 days past the due date" />
        <Tile icon="bell" label="Over 90 days late" value={money(t.over90)} note={`${d.customers.filter(c => c.over90 > 0).length} customers`} />
        <Tile icon="check" label="Not yet due" value={money(t.current)} note="Inside payment terms" />
      </TileStrip>

      <div className={ui.grid2} style={{ marginTop: 14, marginBottom: 14 }}>
        <Card>
          {title("hourglass", "How Late The Money Is", "Share of everything owed, by how far past the due date", <RangeTag text={`As at ${fmtDay(d.asOf)}`} />)}
          <div className={ui.shareBar} style={{ height: 16 }}>
            {bands.map(([k, , col]) => <i key={k} title={money(t[k])} style={{ width: `${Math.max(pctOf(t[k]), 0)}%`, background: col }} />)}
          </div>
          <div style={{ display: "grid", gap: 8, marginTop: 16 }}>
            {bands.map(([k, label, col]) => (
              <div key={k} style={{ display: "grid", gridTemplateColumns: "10px minmax(0,1fr) auto auto", gap: 10, alignItems: "center", fontSize: 14.5 }}>
                <i style={{ width: 10, height: 10, borderRadius: 3, background: col, display: "block" }} />
                <span style={{ color: COLORS.ink2 }}>{label}</span>
                <span style={{ fontVariantNumeric: "tabular-nums", color: k === "over90" && t[k] > 0 ? ORANGE : INK }}>{money(t[k])}</span>
                <span className={ui.was} style={{ minWidth: 44, textAlign: "right" }}>{pctOf(t[k]).toFixed(1)}%</span>
              </div>))}
          </div>
        </Card>
        <Card>
          {title("users", "Overdue by Sales Rep", null, <RangeTag text={`As at ${fmtDay(d.asOf)}`} />)}
          <BarList rows={d.reps.filter(r => r.overdue > 0).map(r => ({ name: r.rep, value: r.overdue }))} fmt={money} limit={8} />
        </Card>
      </div>

      {chase.length > 0 && (
        <Card style={card}>
          {title("alert", "Chase First", "Customers with money more than 60 days past due, biggest first (inter-company left out)", <RangeTag text={`As at ${fmtDay(d.asOf)}`} />)}
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr><th style={head("left")}>Customer</th><th style={head("left")}>Sales rep</th><th style={head()}>61 to 90</th><th style={head()}>Over 90</th><th style={head()}>Oldest (days late)</th><th style={head()}>Total owed</th></tr></thead>
              <tbody>{chase.map(c => (
                <tr key={c.id}>
                  <td style={{ ...cell, fontWeight: 500 }}>{c.name}</td>
                  <td style={{ ...cell, whiteSpace: "nowrap", color: COLORS.ink2 }}>{c.rep}</td>
                  <td style={{ ...cell, textAlign: "right" }}>{dash(c.d61to90)}</td>
                  <td style={{ ...cell, textAlign: "right" }}>{dash(c.over90, true, red)}</td>
                  <td style={{ ...cell, textAlign: "right" }}>{c.oldestDays}</td>
                  <td style={{ ...cell, textAlign: "right", fontWeight: 500 }}>{money(c.total)}</td>
                </tr>))}</tbody>
          </table></div>
        </Card>
      )}

      <Card style={card}>
        {title("users", "By Sales Rep", d.system === "Ostendo" ? "Each customer sits with the salesperson assigned to them in Ostendo" : "Each customer sits with the salesperson assigned to them in Odoo", <RangeTag text={`As at ${fmtDay(d.asOf)}`} />)}
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>
              <th style={head("left")}>Sales rep</th><th style={head()}>Customers</th><th style={head()}>Owed</th><th style={head()}>Overdue</th>
              <th style={head()}>31 to 60</th><th style={head()}>61 to 90</th><th style={head()}>Over 90</th>
            </tr></thead>
            <tbody>{repPg.shown.map(r => (
              <tr key={r.rep}>
                <td style={{ ...cell, fontWeight: 500 }}>{r.rep}</td>
                <td style={{ ...cell, textAlign: "right" }}>{r.customers.toLocaleString()} <span style={{ color: COLORS.mute }}>({r.overdueCustomers} late)</span></td>
                <td style={{ ...cell, textAlign: "right" }}>{money(r.total)}</td>
                <td style={{ ...cell, textAlign: "right" }}>{dash(r.overdue, true, red)}</td>
                <td style={{ ...cell, textAlign: "right" }}>{dash(r.d31to60)}</td>
                <td style={{ ...cell, textAlign: "right" }}>{dash(r.d61to90)}</td>
                <td style={{ ...cell, textAlign: "right" }}>{dash(r.over90)}</td>
              </tr>))}</tbody>
            <tfoot><tr>
              <td style={{ ...footStyle("left"), fontSize: 12.5, color: COLORS.mute, letterSpacing: "0.04em" }}>TOTAL</td>
              <td style={footStyle()}>{d.customerCount.toLocaleString()}</td>
              <td style={footStyle()}>{money(t.outstanding)}</td>
              <td style={{ ...footStyle(), color: red }}>{money(t.overdue)}</td>
              <td style={footStyle()}>{money(t.d31to60)}</td>
              <td style={footStyle()}>{money(t.d61to90)}</td>
              <td style={footStyle()}>{money(t.over90)}</td>
            </tr></tfoot>
          </table>
        </div>
        {repPg.bar}
      </Card>

      <Card style={card}>
        {title("receipt", "Every Customer Who Owes Us", "Open invoices less credit notes, aged by days past the due date. Click a customer to see their open invoices", <RangeTag text={`As at ${fmtDay(d.asOf)}`} />)}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
          <input value={q} onChange={e => { setQ(e.target.value); }} placeholder="Search customer" style={{ ...sel, minWidth: 0, flex: "1 1 220px" }} />
          <select value={show} onChange={e => { setShow(e.target.value); }} style={sel}>
            <option value="all">Everyone who owes</option><option value="overdue">Overdue only</option>
            <option value="31">More than 30 days late</option><option value="61">More than 60 days late</option><option value="90">More than 90 days late</option>
          </select>
          <select value={rep} onChange={e => { setRep(e.target.value); }} style={sel}>
            <option value="All">All sales reps</option>{d.reps.map(r => <option key={r.rep} value={r.rep}>{r.rep}</option>)}
          </select>
          <select value={sort} onChange={e => setSort(e.target.value)} style={sel}>
            <option value="overdue">Sort: most overdue</option><option value="total">Sort: largest balance</option>
            <option value="oldest">Sort: oldest late</option><option value="name">Sort: name</option>
          </select>
          <label style={{ fontSize: 14, color: COLORS.ink2, display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
            <input type="checkbox" checked={hideIC} onChange={e => setHideIC(e.target.checked)} style={{ accentColor: INK }} /> Hide inter-company
          </label>
          <span style={{ flex: 1 }} />
          <button type="button" onClick={csvCustomers} className={`${ui.btn} ${ui.btnSmall}`}><Icon n="download" size={13} />Download customers CSV</button>
          <button type="button" onClick={csvInvoices} className={`${ui.btn} ${ui.btnSmall}`}><Icon n="download" size={13} />Download all open invoices CSV</button>
        </div>
        <div style={{ fontSize: 13.5, color: COLORS.mute, marginBottom: 10 }}>
          Showing {shownRows.length.toLocaleString()} of {rows.length.toLocaleString()} customers{filtered ? ` (filtered from ${d.customerCount.toLocaleString()})` : ""}.
        </div>
        <div style={{ overflow: "auto", maxHeight: 640 }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead style={{ position: "sticky", top: 0, background: COLORS.card, zIndex: 1 }}><tr>
              <th style={head("left")}>Customer</th><th style={head("left")}>Sales rep</th><th style={head()}>Not yet due</th>
              <th style={head()}>1 to 30</th><th style={head()}>31 to 60</th><th style={head()}>61 to 90</th><th style={head()}>Over 90</th>
              <th style={head()}>Oldest</th><th style={head()}>Total owed</th>
            </tr></thead>
            <tbody>
              {shownRows.length === 0 && <tr><td colSpan={9} style={{ ...cell, textAlign: "center", padding: 24, color: COLORS.mute }}>No customers match</td></tr>}
              {shownRows.map(c => {
                const isOpen = open === c.id;
                const inv = isOpen ? d.invoices.filter(i => i.c === c.id).sort((a, b) => b.days - a.days) : [];
                return (
                  <React.Fragment key={c.id}>
                    <tr onClick={() => setOpen(isOpen ? null : c.id)} style={{ cursor: "pointer", background: isOpen ? inkA(0.04) : "transparent" }}>
                      <td style={{ ...cell, minWidth: 200 }}>
                        <span style={{ color: COLORS.mute, marginRight: 6, display: "inline-flex", verticalAlign: "-2px" }}><Icon n={isOpen ? "down" : "move"} size={12} /></span>{c.name}
                        {c.intercompany && <span style={{ marginLeft: 8 }}><Pill>inter-company</Pill></span>}
                      </td>
                      <td style={{ ...cell, whiteSpace: "nowrap", color: COLORS.ink2 }}>{c.rep}</td>
                      <td style={{ ...cell, textAlign: "right" }}>{dash(c.current)}</td>
                      <td style={{ ...cell, textAlign: "right" }}>{dash(c.d1to30)}</td>
                      <td style={{ ...cell, textAlign: "right" }}>{dash(c.d31to60)}</td>
                      <td style={{ ...cell, textAlign: "right" }}>{dash(c.d61to90)}</td>
                      <td style={{ ...cell, textAlign: "right" }}>{dash(c.over90, false, red)}</td>
                      <td style={{ ...cell, textAlign: "right", whiteSpace: "nowrap" }}>{c.oldestDays > 0 ? `${c.oldestDays} days` : <span style={{ color: COLORS.mute }}>-</span>}</td>
                      <td style={{ ...cell, textAlign: "right", fontWeight: 500 }}>{money(c.total)}</td>
                    </tr>
                    {isOpen && (
                      <tr><td colSpan={9} style={{ padding: "4px 12px 16px 36px", background: inkA(0.04) }}>
                        <table style={{ width: "100%", borderCollapse: "collapse" }}>
                          <thead><tr><th style={head("left")}>Document</th><th style={head("left")}>Type</th><th style={head("left")}>Invoice date</th><th style={head("left")}>Due date</th><th style={head()}>Days late</th><th style={head()}>Outstanding</th></tr></thead>
                          <tbody>{inv.map(i => (
                            <tr key={i.doc}>
                              <td style={cell}>{i.doc}</td><td style={cell}>{i.kind}</td><td style={cell}>{i.inv ? fmtDay(i.inv) : "-"}</td><td style={cell}>{i.due ? fmtDay(i.due) : "-"}</td>
                              <td style={{ ...cell, textAlign: "right", color: i.days > 0 ? red : COLORS.mute }}>{i.days > 0 ? i.days : "not due"}</td>
                              <td style={{ ...cell, textAlign: "right", fontWeight: 500, color: i.amt < 0 ? COLORS.ink2 : INK }}>{money(i.amt)}</td>
                            </tr>))}</tbody>
                        </table>
                      </td></tr>
                    )}
                  </React.Fragment>);
              })}
            </tbody>
            <tfoot><tr>
              <td style={{ ...footStyle("left"), fontSize: 12.5, color: COLORS.mute, letterSpacing: "0.04em" }} colSpan={2}>{filtered ? "TOTAL OF THESE CUSTOMERS" : "TOTAL"}</td>
              {["current", "d1to30", "d31to60", "d61to90", "over90"].map(k => <td key={k} style={footStyle()}>{money(sum(k))}</td>)}
              <td style={footStyle()} />
              <td style={footStyle()}>{money(sum("total"))}</td>
            </tr></tfoot>
          </table>
        </div>
        {pg.bar}
      </Card>
    </div>
  );
};

const DebtorsPanel = ({ source, currency = "NZD" }) => {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    let live = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setD(null); setErr(null);
    fetch(source, { cache: "no-store" })
      .then(r => r.json())
      .then(j => { if (!live) return; if (j.ok) setD(j); else setErr(j.error || "Could not load debtors"); })
      .catch(e => live && setErr(e.message));
    return () => { live = false; };
  }, [source]);
  if (d?.version === 2) return <DebtorsOdoo d={d} currency={currency} />;
  const t = d?.totals;
  const asAt = d ? `As at ${fmtDay(d.asOf)}` : null;
  /* A nil bucket is a dash, so the buckets that hold money stand out. */
  const owed = (v, bold, hot) => (!v ? <span style={{ color: COLORS.mute }}>-</span> : <span style={{ fontWeight: bold ? 500 : 400, color: hot ? ORANGE : undefined }}>{fmtExact(v, currency)}</span>);
  const bands = [["current", "Not yet due", inkA(0.12)], ["d1to30", "1 to 30", inkA(0.3)], ["d31to60", "31 to 60", inkA(0.55)], ["d61to90", "61 to 90", inkA(0.85)], ["over90", "Over 90", ORANGE]];
  return (
    <div style={{ marginTop: 28 }}>
      <div className={st.sectionHead}>
        <div>
          <SectionTitle icon="wallet">Debtors</SectionTitle>
          <div className={st.sectionSub}>What customers owe us, and how late it is. Amounts include GST. Lateness is counted from the due date</div>
        </div>
        <RangeTag text={asAt} />
      </div>
      {t && (
        <>
          <TileStrip>
            <Tile icon="wallet" label="Owed to us" value={fmtExact(t.outstanding, currency)} note={`${d.documents.toLocaleString()} open invoices${d.unappliedPayments ? `, after ${fmtExact(d.unappliedPayments, currency)} received and not yet applied` : ""}`} />
            <Tile icon="alert" label="Overdue" value={fmtExact(t.overdue, currency)} note={t.overduePct !== null ? `${t.overduePct}% of what is owed` : null} hot={t.overdue > 0} />
            <Tile icon="hourglass" label="Over 60 days late" value={fmtExact(t.d61to90 + t.over90, currency)} note="More than 60 days past the due date" />
            <Tile icon="bell" label="Over 90 days late" value={fmtExact(t.over90, currency)} note="More than 90 days past the due date" />
            <Tile icon="check" label="Not yet due" value={fmtExact(t.current, currency)} note="Inside payment terms" />
          </TileStrip>
          {t.outstanding > 0 && (
            <Card style={{ marginTop: 14 }}>
              <CardHead icon="hourglass" title="How Late The Money Is"><RangeTag text={asAt} /></CardHead>
              <div className={ui.shareBar} style={{ height: 16 }}>
                {bands.map(([k, , col]) => <i key={k} title={fmtExact(t[k], currency)} style={{ width: `${Math.max((t[k] / t.outstanding) * 100, 0)}%`, background: col }} />)}
              </div>
              <div className={ui.shareLegend}>
                {bands.map(([k, label, col]) => <span key={k}><i style={{ background: col }} />{label} {((t[k] / t.outstanding) * 100).toFixed(1)}% · {fmtExact(t[k], currency)}</span>)}
              </div>
            </Card>
          )}
        </>
      )}
      <div style={{ marginTop: 14 }}>
        <AdvancedTable icon="receipt" title="Overdue by Customer" range={asAt}
          subtitle={err ? `Could not load: ${err}` : "Open invoices less credit notes, aged by days past the due date. Largest overdue first"}
          loading={!d && !err} currency={currency} data={d?.customers || []}
          columns={[
            { key: "name", label: "Customer", color: INK },
            { key: "current", label: "Not Yet Due", align: "right", color: INK, format: v => owed(v) },
            { key: "d1to30", label: "1 to 30", align: "right", color: INK, format: v => owed(v) },
            { key: "d31to60", label: "31 to 60", align: "right", color: INK, format: v => owed(v) },
            { key: "d61to90", label: "61 to 90", align: "right", color: INK, format: v => owed(v) },
            { key: "over90", label: "Over 90 Late", align: "right", color: INK, format: v => owed(v, false, true) },
            { key: "total", label: "Total Owed", align: "right", color: INK, format: v => owed(v, true) },
          ]}
        />
      </div>
      {d && d.customerCount > d.customers.length && (
        <div style={{ fontSize: 13.5, color: COLORS.mute, marginTop: 10, lineHeight: 1.5 }}>
          Showing the {d.customers.length} customers with the most overdue, of {d.customerCount.toLocaleString()} who owe us money. The tiles above cover all of them.
        </div>
      )}
    </div>
  );
};

/* Credit notes: who got one, and for how much, for the period on screen.
   Two views of the same documents - every note (who it went to) and the same
   notes rolled up by rep (same shape as Sales by Rep), both with a TOTAL row. */
/* Credit Notes for the Odoo companies. Everything the team needs to see on one page:
   how much was credited and why, month by month, who raised each note, which rep it
   sits under, and the reason the team logged in Odoo. The same two totals as the
   Overview: credits against product sales, and discounts / rebates / adjustments that
   carry no product, which together are the full value of the notes. */
/* The end date when a month bar stops part-way through its month (the month still running), else null. */
const partOfMonth = (ym, endIso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(endIso || "");
  if (!ym || !m || `${m[1]}-${m[2]}` !== String(ym).slice(0, 7)) return null;
  return Number(m[3]) < new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate() ? endIso : null;
};
const CreditsOdoo = ({ d, currency = "NZD", rangeLabel = null }) => {
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("All");
  const [rep, setRep] = useState("All");
  const [month, setMonth] = useState("All");
  const [by, setBy] = useState("All");
  const [open, setOpen] = useState(null);
  const monthLabel = (k) => `${MONTH_NAMES[Number(k.slice(5, 7)) - 1]} ${k.slice(0, 4)}`;
  const money = (v) => fmtExact(v, currency);
  const sys = d.system || "Odoo";
  const otherHead = d.otherLabel || "Discounts & adjustments";
  const reasonWhere = d.reasonNote || `logged in ${sys}`;
  const needle = q.trim().toLowerCase();
  const rows = d.notes.filter(n =>
    (kind === "All" || n.kind === kind) && (rep === "All" || n.rep === rep) &&
    (month === "All" || String(n.date).slice(0, 7) === month) && (by === "All" || n.raisedBy === by) &&
    (!needle || [n.customer, n.docNumber, n.reason, n.about, n.rep, n.raisedBy, n.kind].join(" ").toLowerCase().includes(needle)));
  // The total credited is worked from every matching note; only the table rows are paged.
  const shown = rows.reduce((s, n) => s + n.amount, 0);
  const filtered = rows.length !== d.notes.length;
  const notePg = usePaged(rows, `${q}|${kind}|${rep}|${month}|${by}`);

  const cell = tdStyle;
  const head = thStyle;
  const card = {};
  const title = (icon, text, extra) => <CardHead icon={icon} title={text}>{extra}</CardHead>;
  const red = ORANGE;
  // One small summary table: first column text, then count, product, other, total. `visual` sits above the table.
  const summary = (label, list, keyOf, labelOf, visual) => (
    <Card style={{ ...card, overflowX: "auto" }}>
      {title(label[0], label[1], <RangeTag text={rangeLabel} />)}
      {label[3] && <div style={{ fontSize: 13.5, color: COLORS.mute, margin: "-6px 0 14px" }}>{label[3]}</div>}
      {visual && list.length > 0 && <div style={{ marginBottom: 18 }}>{visual}</div>}
      <Paged rows={list}>{(shownList) => (
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr>
          <th style={head("left")}>{label[2]}</th><th style={head()}>Credit notes</th>
          <th style={head()}>Product credits</th><th style={head()}>{otherHead}</th><th style={head()}>Total</th>
        </tr></thead>
        <tbody>
          {shownList.map(r => (
            <tr key={keyOf(r)}>
              <td style={{ ...cell, fontWeight: 500, whiteSpace: "nowrap" }}>{labelOf(r)}</td>
              <td style={{ ...cell, textAlign: "right" }}>{r.count.toLocaleString()}</td>
              <td style={{ ...cell, textAlign: "right" }}>{money(r.product)}</td>
              <td style={{ ...cell, textAlign: "right" }}>{money(r.other)}</td>
              <td style={{ ...cell, textAlign: "right", fontWeight: 500 }}>{money(r.value)}</td>
            </tr>))}
        </tbody>
        <tfoot><tr>
          <td style={{ ...footStyle("left"), fontSize: 12.5, color: COLORS.mute, letterSpacing: "0.04em" }}>TOTAL</td>
          <td style={footStyle()}>{d.totals.count.toLocaleString()}</td>
          <td style={footStyle()}>{money(d.totals.productValue)}</td>
          <td style={footStyle()}>{money(d.totals.otherValue)}</td>
          <td style={{ ...footStyle(), color: red }}>{money(d.totals.value)}</td>
        </tr></tfoot>
      </table>)}</Paged>
    </Card>);

  const csv = () => {
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const hdr = ["Date", "Credit note", "Customer", "Sales rep", "Raised by", "Type", "About", `Reason (${reasonWhere})`, "Product credit", otherHead, "Total"];
    const lines = rows.map(n => [n.date, n.docNumber, n.customer, n.rep, n.raisedBy, n.kind, n.about, n.reason, n.productAmount.toFixed(2), n.otherAmount.toFixed(2), n.amount.toFixed(2)].map(esc).join(","));
    const blob = new Blob([[hdr.map(esc).join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `credit-notes-${d.range.start}-to-${d.range.end}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };
  const sel = SELECT_STYLE;
  const opts = (all, list) => [<option key="all" value="All">{all}</option>, ...list.map(v => <option key={v} value={v}>{v}</option>)];

  return (
    <div style={{ marginTop: 28 }}>
      <div className={st.sectionHead}>
        <div>
          <SectionTitle icon="receipt">Credit Notes</SectionTitle>
          <div className={st.sectionSub}>Every credit note this financial year: what it was for, who raised it and which sales rep it sits under</div>
        </div>
        <RangeTag text={rangeLabel} />
      </div>

      <TileStrip>
        <Tile icon="receipt" label="Credit notes" value={d.totals.count.toLocaleString()} note={`${d.totals.withReason.toLocaleString()} have a reason: ${reasonWhere}`} />
        <Tile icon="bag" label="Returns & product credits" value={money(d.totals.productValue)}
          note={`Credits against product sales${d.totals.productPctOfSales != null ? `, ${d.totals.productPctOfSales}% of sales` : ""}. This is the figure on the Overview.`} />
        <Tile icon="percent" label={d.otherLabel || "Discounts, rebates & adjustments"} value={money(d.totals.otherValue)} note={d.otherNote || "Credits with no product on them: volume discounts, rebates, rent and sales adjustments"} />
        <Tile icon="wallet" label="Total credited" value={money(d.totals.value)} note="The two above together: the full value of every credit note" hot />
      </TileStrip>

      {d.totals.value > 0 && (
        <Card style={{ marginTop: 14 }}>
          <CardHead icon="pie" title="Product Credits and Other Credits"><RangeTag text={rangeLabel} /></CardHead>
          <ShareBar parts={[{ name: "Returns & product credits", value: d.totals.productValue }, { name: d.otherLabel || "Discounts, rebates & adjustments", value: d.totals.otherValue }]} fmt={money} />
        </Card>
      )}

      <div className={ui.grid2} style={{ margin: "14px 0" }}>
        {summary(["calendar", "By Month", "Month"], d.months, r => r.month, r => monthLabel(r.month),
          <MonthBars rows={d.months.map(m => ({ month: m.month, value: m.value }))} fmt={moneyShort} partialTo={partOfMonth(d.months[d.months.length - 1]?.month, d.range?.end)} />)}
        {summary(["receipt", "What The Credits Were For", "Type", "Product credits are returns and corrections to product sales. The rest carry no product. Each credit note is counted once, under its main type."], d.kinds, r => r.kind, r => r.kind,
          <Ring rows={d.kinds.map(k => ({ name: k.kind, value: k.value }))} fmt={money} />)}
        {summary(["users", "By Sales Rep", "Sales rep"], d.reps, r => r.rep, r => r.rep,
          <BarList rows={d.reps.map(r => ({ name: r.rep, value: r.value }))} fmt={money} limit={6} />)}
        {summary(["user", "Raised By", "Person", `The person who created the credit note in ${sys}`], d.raisers, r => r.person, r => r.person)}
      </div>
      <Card style={{ ...card, overflowX: "auto", marginBottom: 14 }}>
        {title("trophy", "Customers With The Most Credits", <RangeTag text={rangeLabel} />)}
        {d.customers.length > 0 && <div style={{ marginBottom: 18 }}><BarList rows={d.customers.map(r => ({ name: r.customer, value: r.value }))} fmt={money} limit={5} share={false} /></div>}
        <Paged rows={d.customers}>{(shownCustomers) => (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><th style={head("left")}>Customer</th><th style={head()}>Credit notes</th><th style={head()}>Product credits</th><th style={head()}>{otherHead}</th><th style={head()}>Total</th></tr></thead>
          <tbody>{shownCustomers.map(r => (
            <tr key={r.customer}>
              <td style={{ ...cell, fontWeight: 500 }}>{r.customer}</td>
              <td style={{ ...cell, textAlign: "right" }}>{r.count.toLocaleString()}</td>
              <td style={{ ...cell, textAlign: "right" }}>{money(r.product)}</td>
              <td style={{ ...cell, textAlign: "right" }}>{money(r.other)}</td>
              <td style={{ ...cell, textAlign: "right", fontWeight: 500 }}>{money(r.value)}</td>
            </tr>))}</tbody>
        </table>)}</Paged>
      </Card>

      <Card style={card}>
        {title("receipt", "Every Credit Note", <RangeTag text={rangeLabel} />)}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search customer, credit note number or reason"
            style={{ ...sel, minWidth: 0, flex: "1 1 280px" }} />
          <select value={month} onChange={e => setMonth(e.target.value)} style={sel}>{[<option key="all" value="All">All months</option>, ...d.months.map(m => <option key={m.month} value={m.month}>{monthLabel(m.month)}</option>)]}</select>
          <select value={kind} onChange={e => setKind(e.target.value)} style={sel}>{opts("All types", d.kinds.map(k => k.kind))}</select>
          <select value={rep} onChange={e => setRep(e.target.value)} style={sel}>{opts("All sales reps", d.reps.map(r => r.rep))}</select>
          <select value={by} onChange={e => setBy(e.target.value)} style={sel}>{opts("Raised by anyone", d.raisers.map(r => r.person))}</select>
          {(q || kind !== "All" || rep !== "All" || month !== "All" || by !== "All") && (
            <button type="button" onClick={() => { setQ(""); setKind("All"); setRep("All"); setMonth("All"); setBy("All"); }}
              className={`${ui.btn} ${ui.btnSmall}`}><Icon n="close" size={13} />Clear filters</button>)}
          <span style={{ flex: 1 }} />
          <button type="button" onClick={csv} className={`${ui.btn} ${ui.btnSmall}`}><Icon n="download" size={13} />Download CSV</button>
        </div>
        <div style={{ fontSize: 13.5, color: COLORS.mute, marginBottom: 10 }}>
          {filtered ? `${rows.length.toLocaleString()} of ${d.notes.length.toLocaleString()} credit notes match · ${money(shown)} of ${money(d.totals.value)}` : `${d.notes.length.toLocaleString()} credit notes`}. Click a row to read the whole reason.
        </div>
        <div style={{ overflow: "auto", maxHeight: 620 }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead style={{ position: "sticky", top: 0, background: COLORS.card, zIndex: 1 }}><tr>
              <th style={head("left")}>Date</th><th style={head("left")}>Credit note</th><th style={head("left")}>Customer</th>
              <th style={head("left")}>Sales rep</th><th style={head("left")}>Raised by</th><th style={head("left")}>Type</th>
              <th style={head("left")}>Reason</th><th style={head()}>Amount</th>
            </tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={8} style={{ ...cell, textAlign: "center", padding: 24, color: COLORS.mute }}>No credit notes match</td></tr>}
              {notePg.shown.map(n => {
                const isOpen = open === n.docNumber;
                const text = n.reason || n.note || (n.about ? `(${n.about})` : "No reason logged");
                return (
                  <tr key={n.docNumber} onClick={() => setOpen(isOpen ? null : n.docNumber)}
                    style={{ cursor: "pointer", verticalAlign: "top" }}>
                    <td style={{ ...cell, whiteSpace: "nowrap" }}>{n.date}</td>
                    <td style={{ ...cell, whiteSpace: "nowrap", color: COLORS.mute }}>{n.docNumber}</td>
                    <td style={{ ...cell, minWidth: 170, fontWeight: 500 }}>{n.customer}</td>
                    <td style={{ ...cell, whiteSpace: "nowrap", color: COLORS.ink2 }}>{n.rep}</td>
                    <td style={{ ...cell, whiteSpace: "nowrap", color: COLORS.ink2 }}>{n.raisedBy}</td>
                    <td style={{ ...cell, whiteSpace: "nowrap", color: COLORS.ink2 }}>{n.kind}</td>
                    <td style={{ ...cell, minWidth: 260, maxWidth: 420, color: n.reason ? COLORS.ink2 : COLORS.mute, lineHeight: 1.45 }}>
                      {isOpen ? text : (text.length > 120 ? `${text.slice(0, 120)}…` : text)}
                      {isOpen && n.reasonBy && <div style={{ fontSize: 12.5, color: COLORS.mute, marginTop: 4 }}>Logged by {n.reasonBy}{n.about ? ` · ${n.about}` : ""}{n.creditedInvoice ? ` · against ${n.creditedInvoice}` : ""}</div>}
                    </td>
                    <td style={{ ...cell, textAlign: "right", fontWeight: 500, whiteSpace: "nowrap" }}>{money(n.amount)}</td>
                  </tr>);
              })}
            </tbody>
          </table>
        </div>
        {notePg.bar}
        <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "baseline", gap: 8, marginTop: 12, paddingRight: 8, fontSize: 12.5, color: COLORS.mute, letterSpacing: "0.04em" }}>
          {filtered ? "MATCHING" : "TOTAL"}&nbsp;CREDITED<span style={{ color: red, fontSize: 18, fontWeight: 400, letterSpacing: 0 }}>{money(shown)}</span>
        </div>
      </Card>
    </div>
  );
};

const CreditsPanel = ({ source, currency = "NZD", rangeLabel = null }) => {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    let live = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setD(null); setErr(null);
    fetch(source, { cache: "no-store" })
      .then(r => r.json())
      .then(j => { if (!live) return; if (j.ok) setD(j); else setErr(j.error || "Could not load credit notes"); })
      .catch(e => live && setErr(e.message));
    return () => { live = false; };
  }, [source]);
  const headStyle = thStyle;
  const loading = !d && !err;
  if (d?.version === 2) return <CreditsOdoo d={d} currency={currency} rangeLabel={rangeLabel} />;

  return (
    <div style={{ marginTop: 28 }}>
      <div className={st.sectionHead}>
        <div>
          <SectionTitle icon="receipt">Credit Notes</SectionTitle>
          <div className={st.sectionSub}>Every credit note raised this period, who it went to, and the rep it sits under</div>
        </div>
        <RangeTag text={rangeLabel} />
      </div>
      {err && <Notice tone="warn" style={{ marginBottom: 14 }}>Could not load: {err}</Notice>}

      {d?.totals && (
        <div style={{ marginBottom: 14 }}>
          <TileStrip>
            <Tile icon="receipt" label="Credit Notes" value={d.totals.count.toLocaleString()} note="Raised this period" />
            <Tile icon="wallet" label="Total Credited" value={fmtExact(d.totals.value, currency)} note="Across every rep and customer" hot />
          </TileStrip>
        </div>
      )}

      {/* By rep - same shape as the Sales by Rep table, with a TOTAL row */}
      <Card style={{ marginBottom: 14 }}>
        <CardHead icon="users" title={<>By Rep{loading && <span style={{ marginLeft: 10, verticalAlign: "middle" }}><Pill>Loading</Pill></span>}</>}><RangeTag text={rangeLabel} /></CardHead>
        {d?.reps?.length > 0 && <div style={{ marginBottom: 18 }}><BarList rows={d.reps.map(r => ({ name: r.rep, value: r.value }))} fmt={(v) => fmtExact(v, currency)} limit={6} /></div>}
        <div style={{ overflowX: "auto" }}>
          <Paged rows={d?.reps || []}>{(shownReps) => (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr>
                <th style={headStyle("left")}>Sales Rep</th>
                <th style={headStyle()}>Credit Notes</th>
                <th style={headStyle()}>Total Amount</th>
              </tr>
            </thead>
            <tbody>
              {!d?.reps?.length ? (
                <tr><td colSpan={3} style={{ padding: "20px 10px", textAlign: "center", color: COLORS.mute }}>
                  {loading ? "Loading…" : "No credit notes in this period"}
                </td></tr>
              ) : shownReps.map((r, i) => (
                <tr key={i}>
                  <td style={{ ...tdStyle, fontWeight: 500 }}>{r.rep}</td>
                  <td style={{ ...tdStyle, textAlign: "right", color: COLORS.ink2 }}>{r.count.toLocaleString()}</td>
                  <td style={{ ...tdStyle, textAlign: "right", fontWeight: 500 }}>{fmtExact(r.value, currency)}</td>
                </tr>
              ))}
            </tbody>
            {d?.reps?.length > 0 && (
              <tfoot>
                <tr>
                  <td style={{ ...footStyle("left"), fontSize: 12.5, color: COLORS.mute, letterSpacing: "0.04em" }}>TOTAL</td>
                  <td style={footStyle()}>{d.totals.count.toLocaleString()}</td>
                  <td style={{ ...footStyle(), color: ORANGE }}>{fmtExact(d.totals.value, currency)}</td>
                </tr>
              </tfoot>
            )}
          </table>)}</Paged>
        </div>
      </Card>

      {/* Every note - who it went to */}
      <AdvancedTable icon="receipt" title="Every Credit Note" range={rangeLabel}
        subtitle="Most recent first" loading={loading} currency={currency} data={d?.notes || []}
        columns={[
          { key: "date",      label: "Date",     color: COLORS.ink2 },
          { key: "docNumber", label: "Doc #",    color: COLORS.mute },
          { key: "customer",  label: "Customer", color: INK },
          { key: "rep",       label: "Rep",      color: COLORS.ink2 },
          { key: "amount",    label: "Amount",   align: "right", color: INK, format: (v, c) => fmtExact(v, c) },
        ]}
      />
      {d?.notes?.length > 0 && (
        <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "baseline", gap: 8, marginTop: 12, paddingRight: 8, fontSize: 12.5, color: COLORS.mute, letterSpacing: "0.04em" }}>
          TOTAL&nbsp;CREDITED<span style={{ color: ORANGE, fontSize: 18, letterSpacing: 0 }}>{fmtExact(d.totals.value, currency)}</span>
        </div>
      )}
    </div>
  );
};

/* Year-end forecast. One method, stated on the card: sales to date, plus what is
   left of last year's trading at this year's pace against last year. It is a
   projection from last year's shape, not a budget. */
/* Worthy Products only: sales to the sister companies (Dutch Rusk, Worthy Oceania), kept out of every figure above and
   reconciled back to everything invoiced. Same basis as the Sunday email and the chat (docs/SALES-BASIS.md). */
const dateInputStyle = { font: "inherit", fontSize: 14, padding: "6px 9px", borderRadius: 10, border: `1px solid ${COLORS.line}`, background: "#fff", color: COLORS.ink };
const SisterSalesCard = ({ cur, week, weekWp, currency, companyName = "Worthy Products" }) => {
  // Margin to two decimals from the figures themselves, so it reads exactly like the Sunday email.
  const m2 = (costed, cost) => (costed > 0 && cost != null ? Math.round(((costed - cost) / costed) * 10000) / 100 : null);
  /* Any dates (Worthy Products only, management only: /api/sister-sales). The chosen dates are kept in this browser. */
  const canPick = (companyName === "Worthy Products" || companyName === "Worthy Oceania") && !cur?.custom;   // the page's chosen dates already set the period
  const pickCid = companyName === "Worthy Oceania" ? 1 : 4;
  const RKEY = `wdd-sister-range-v1:${pickCid}`;
  const [pick, setPick] = useState(() => { try { return JSON.parse(localStorage.getItem(RKEY) || "null") || { from: "", to: "" }; } catch { return { from: "", to: "" }; } });
  const [picked, setPicked] = useState({ state: "idle" });
  useEffect(() => {
    try { localStorage.setItem(RKEY, JSON.stringify(pick)); } catch { /* private window */ }
    if (!canPick || !pick.from || !pick.to) { setPicked({ state: "idle" }); return; }
    if (pick.from > pick.to) { setPicked({ state: "error", error: "Start date is after the end date" }); return; }
    let stop = false;
    setPicked({ state: "loading" });
    fetch(pickCid === 4 ? `/api/sister-sales?from=${pick.from}&to=${pick.to}` : `/api/margin-mix?company=1&period=${pick.from}:${pick.to}`, { cache: "no-store" })
      .then(async (r) => { if (r.status === 401 || r.status === 403) return { hidden: true }; const j = await r.json(); if (!r.ok) throw new Error(j.error || `Error ${r.status}`); return j; })
      .then((j) => { if (!stop) setPicked(j.hidden ? { state: "hidden" } : { state: "ok", d: j }); })
      .catch((e) => { if (!stop) setPicked({ state: "error", error: String(e.message || e) }); });
    return () => { stop = true; };
  }, [pick.from, pick.to, canPick, pickCid]);
  if (!cur?.sisterSales) return null;
  const month = [...(cur.months || [])].reverse().find((m) => m.started && m.sisters);
  const cols = [
    week && week.sisters ? { label: "Week", range: `${fmtDay(week.start)} to ${fmtDay(week.end)}`, s: week.sisters, wp: { sales: week.revenue, other: week.otherInvoicedLines, margin: weekWp?.margin ?? null, cost: weekWp?.cost, costed: weekWp?.costed } } : null,
    month ? { label: "Month to date", range: `${fmtDay(`${month.key}-01`)} to ${fmtDay(month.through)}`, s: month.sisters, wp: { sales: month.revenue, other: month.otherInvoicedLines, margin: m2(month.costedRevenue, month.cost) ?? month.marginPct, cost: month.cost, costed: month.costedRevenue } } : null,
    { label: cur.custom ? "Chosen dates" : "Financial year to date", range: `${fmtDay(cur.range?.start)} to ${fmtDay(cur.range?.end)}`, s: cur.sisterSales, wp: { sales: cur.totals?.revenue, other: cur.sisterSales.otherInvoicedLines, margin: m2(cur.totals?.costedRevenue, cur.totals?.cost) ?? cur.totals?.marginPct, cost: cur.totals?.cost, costed: cur.totals?.costedRevenue } },
  ].filter(Boolean);
  if (canPick && picked.state === "ok" && pickCid === 1) {
    // Worthy Oceania: the margin reader's own sister split (lib/marginMix.js), same basis as the year figures
    const d = picked.d, ss = d.sisterSales || {};
    cols.push({ label: "Chosen dates", range: `${fmtDay(d.from)} to ${fmtDay(d.to)}`, chosen: true,
      s: { ...Object.fromEntries(Object.entries(ss).filter(([k]) => k !== "total").map(([k, v]) => [k, { sales: v.sales, marginPct: v.marginPct }])),
           total: { sales: ss.total?.sales || 0, marginPct: ss.total?.marginPct ?? null, costedSales: ss.total?.costedSales || 0, cost: ss.total?.cost || 0 } },
      wp: { sales: d.revenue, margin: d.costedRevenue > 0 ? Math.round(((d.costedRevenue - d.cost) / d.costedRevenue) * 10000) / 100 : null, cost: d.cost, costed: d.costedRevenue } });
  } else if (canPick && picked.state === "ok") {
    const d = picked.d, dr = d.sisterCompanies.dutchRusk, oc = d.sisterCompanies.worthyOceania, wp = d.worthyProducts;
    cols.push({ label: "Chosen dates", range: `${fmtDay(d.period.from)} to ${fmtDay(d.period.to)}`, chosen: true,
      s: { dutchRusk: { sales: dr.sales, marginPct: dr.marginPct }, oceania: { sales: oc.sales, marginPct: oc.marginPct },
           total: { sales: d.sisterCompanies.total.sales, marginPct: d.sisterCompanies.total.marginPct,
                    costedSales: dr.grossProfit + dr.cost + oc.grossProfit + oc.cost, cost: dr.cost + oc.cost } },
      wp: { sales: wp.sales, margin: wp.marginPct, cost: wp.cost, costed: wp.grossProfit + wp.cost } });
  }
  const money = (v) => (v == null ? "-" : fmtExact(v, currency));
  const pctTxt = (v) => (v == null ? "-" : `${Number(v).toFixed(2)}%`);
  const th = { ...thStyle("right") };
  const td = { ...tdStyle, textAlign: "right", fontSize: 14.5, whiteSpace: "nowrap" };
  const name = { ...td, textAlign: "left", fontWeight: 500 };
  // Whichever sister companies this business has (lib/salesBasis.js SISTER_SETS), in that order.
  const sisterKeys = Object.keys(cur.sisterSales).filter((k) => cur.sisterSales[k] && cur.sisterSales[k].name);
  const rows = [
    ...sisterKeys.map((k) => [cur.sisterSales[k].name, (c) => c.s[k]?.sales ?? 0, (c) => c.s[k]?.marginPct ?? null]),
    ["Sister companies total", (c) => c.s.total.sales, (c) => c.s.total.marginPct, true],
    [companyName, (c) => c.wp.sales ?? 0, (c) => c.wp.margin],
    ["All product sales", (c) => (c.wp.sales ?? 0) + c.s.total.sales, (c) => {
      const costed = (c.wp.costed ?? 0) + (c.s.total.costedSales ?? 0), cost = (c.wp.cost ?? 0) + (c.s.total.cost ?? 0);
      return c.wp.costed != null && costed > 0 ? Math.round(((costed - cost) / costed) * 10000) / 100 : null;
    }, true],
  ];
  // The share of all product sales, financial year to date: this company first, then each sister.
  const fy = cols.find((c) => c.label === "Financial year to date" || c.label === "Chosen dates");
  const parts = [{ name: companyName, value: fy.wp.sales ?? 0 }, ...sisterKeys.map((k) => ({ name: cur.sisterSales[k].name, value: fy.s[k]?.sales ?? 0 }))];
  return (
    <Card style={{ marginBottom: 14 }}>
      <CardHead icon="building" title="Sister company sales">
        {canPick && picked.state !== "hidden" && (
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }} role="group" aria-label="Chosen dates">
            <input type="date" value={pick.from} max={pick.to || undefined} aria-label="From" onChange={(e) => setPick((p) => ({ ...p, from: e.target.value }))} style={dateInputStyle} />
            <span style={{ color: COLORS.mute, fontSize: 13.5 }}>to</span>
            <input type="date" value={pick.to} min={pick.from || undefined} aria-label="To" onChange={(e) => setPick((p) => ({ ...p, to: e.target.value }))} style={dateInputStyle} />
            {(pick.from || pick.to) && <button type="button" onClick={() => setPick({ from: "", to: "" })} aria-label="Clear the chosen dates" title="Clear" style={{ ...dateInputStyle, cursor: "pointer", display: "inline-flex", alignItems: "center" }}><Icon n="close" size={12} /></button>}
            {picked.state === "loading" && <span style={{ color: COLORS.mute, fontSize: 13.5 }}>Reading Odoo</span>}
            {picked.state === "error" && <span style={{ color: ORANGE, fontSize: 13.5 }}>{picked.error}</span>}
          </div>
        )}
        <RangeTag text={fy.range} />
      </CardHead>
      <Mini icon="pie">Share of all product sales, {cur.custom ? "chosen dates" : "financial year to date"}</Mini>
      <ShareBar parts={parts} fmt={moneyShort} />
      <div style={{ overflowX: "auto", marginTop: 20 }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 640 }}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: "left", borderBottom: 0 }}>Company</th>
              {cols.map((c) => (
                <th key={c.label} colSpan={2} style={{ ...th, borderBottom: 0, verticalAlign: "bottom", ...(c.chosen ? { color: INK } : {}) }}>
                  <div>{c.label}</div>
                  <div style={{ marginTop: 6 }}><RangeTag text={c.range} /></div>
                </th>
              ))}
            </tr>
            <tr>
              <th style={th} />
              {cols.map((c) => [<th key={c.label + "s"} style={th}>Sales</th>, <th key={c.label + "m"} style={th}>Margin</th>])}
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, sales, margin, strong]) => (
              <tr key={label} style={strong ? { background: inkA(0.035) } : undefined}>
                <td style={name}>{label}</td>
                {cols.map((c) => [
                  <td key={c.label + "s"} style={{ ...td, fontWeight: strong ? 500 : 400 }}>{money(sales(c))}</td>,
                  <td key={c.label + "m"} style={{ ...td, color: COLORS.ink2 }}>{pctTxt(margin(c))}</td>,
                ])}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
};

const ForecastCard = ({ cur, prior, currency, fyLabel }) => {
  const t = cur?.totals;
  if (!cur || !t || cur.range?.complete || !t.priorComparable) return null;
  const lastYear = prior?.totals;
  const done = Number(t.revenue) || 0;
  const sameSpan = Number(t.prior?.revenue) || 0;
  const full = Number(lastYear?.revenue) || 0;
  const ready = prior && lastYear && prior.range?.complete && sameSpan > 0 && full > 0;
  const rest = Math.max(0, full - sameSpan);
  const pace = ready ? done / sameSpan : null;
  const projected = ready ? done + rest * pace : null;
  const flat = ready ? done + rest : null;
  const money = (v) => fmtExact(v, currency).replace(/\.\d\d$/, "");
  // "Up 3.2%" / "Down 3.2%" on last year, rounded exactly as before, drawn as a triangle.
  const onLast = (ratio) => { const v = Math.abs(Math.round((ratio - 1) * 1000) / 10); return <><Delta value={ratio >= 1 ? v : -v} /> <span className={ui.was}>on last year</span></>; };
  return (
    <Card style={{ marginBottom: 14 }}>
      <CardHead icon="forecast" title={`Year-end forecast, ${fyLabel}`}>
        <RangeTag text={`${fmtDay(cur.range.start)} to ${fmtDay(cur.range.lastDay)}`} />
      </CardHead>
      {!ready ? (
        <div style={{ fontSize: 14.5, color: COLORS.mute, lineHeight: 1.6 }}>Reading last year&apos;s figures. This can take up to a minute the first time.</div>
      ) : (
        <div className={st.forecast}>
          <div>
            <div className={ui.statNum} style={{ color: ORANGE, fontSize: "clamp(26px, 3vw, 36px)" }}>{money(projected)}</div>
            <div className={ui.statLabel}>At this year&apos;s pace</div>
            <div style={{ marginTop: 4 }}>{onLast(projected / full)}</div>
            <div style={{ marginTop: 18 }}>
              <BarList share={false} fmt={money} rows={[
                { name: "At this year's pace", value: projected },
                { name: "If the rest matches last year", value: flat },
                { name: "Last year, full year", value: full },
                { name: "Sales to date", value: done },
              ]} />
            </div>
          </div>
          {/* Only what the bars above do not already show (27 Nov 2026: the four figures were printed twice) */}
          <div>
            <div className={ui.stat}><div className={ui.statNum} style={{ fontSize: 24 }}>{money(sameSpan)}</div><div className={ui.statLabel}>Same days last year, {fmtDay(`${Number(cur.range.start.slice(0, 4)) - 1}${cur.range.start.slice(4)}`)} to {fmtDay(`${Number(cur.range.end.slice(0, 4)) - 1}${cur.range.end.slice(4)}`)}</div></div>
          </div>
        </div>
      )}
    </Card>
  );
};

/* Worthy Products North: each rep's sales against the annual target set in Odoo.
   Same targets and year-to-date figures as the weekly emails sent by the Odoo
   scheduled actions (ir.cron 107, 110, 111). Calendar year, ex GST, to the last
   completed Sunday. */
/* Whole money to the cent, as the finance sheet prints it: $2,568,000.00 */
const KPI_CENTS = (v) => (v === null || v === undefined ? "-" : `${v < 0 ? "-" : ""}$${Math.abs(v).toLocaleString("en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const KPI_DOLLAR = (v) => (v === null || v === undefined ? "-" : `${v < 0 ? "-" : ""}$${Math.abs(Math.round(v)).toLocaleString("en-NZ")}`);
/* A plain heading for each group on the Analytics page, with an icon that fits it. */
const GROUP_ICONS = { "Categories & Products": "award", "Fast & Slow Movers": "zap", "Customers": "users" };
const GroupTitle = ({ text }) => (
  <div className={st.groupTitle}>
    <span className={ui.titleIcon}><Icon n={GROUP_ICONS[text] || "grid"} size={15} /></span>{text}
  </div>
);

/* Sales vs Target, financial year (April to March), ex GST. The targets are the
   business's own monthly budgets per rep (lib/repTargets.js). Sales are the rep's
   invoiced product lines in the SAME payload as the Sales by Rep table, so the two
   always agree. "vs pace" compares sales with what the budget says should have been
   sold by now: every finished month in full, plus the part of the current month
   that has passed. */
const SalesVsTargetTable = ({ payload, company = "north" }) => {
  const year = payload?.fy;
  // Targets are private: loaded from the dashboard-login-only /api/targets, never built into the page's JavaScript.
  const [allTargets, setAllTargets] = useState([]);
  useEffect(() => { fetch("/api/targets", { cache: "no-store" }).then(r => (r.ok ? r.json() : { targets: [] })).then(j => setAllTargets(Array.isArray(j.targets) ? j.targets : [])).catch(() => setAllTargets([])); }, []);
  const targets = allTargets.filter(t => t.fy === year && (t.company || "north") === company);
  /* Chosen dates (27 Nov 2026): the target is the budget for THOSE dates (each month's budget, pro-rated to the days
     chosen, from whichever financial year the month belongs to), never the whole year's. */
  const custom = payload?.custom || null;
  const dayN = (iso) => Date.parse(`${iso}T00:00:00Z`) / 86400000;
  const budgetOf = (t, key) => {
    if (!custom) return t.monthly[key] || 0;
    const own = allTargets.find(x => x.rep === t.rep && (x.company || "north") === company && x.monthly && x.monthly[key] != null);
    return own ? own.monthly[key] || 0 : 0;
  };
  const rows = !payload ? [] : targets.map(t => {
    const rep = (payload.reps || []).find(r => r.name === t.rep);
    let fyTarget = fyTargetOf(t);
    let pace = 0, monthTarget = 0, monthSales = 0, monthLabel = "";
    if (custom) {
      let period = 0;
      for (const m of payload.months || []) {
        const first = `${m.key}-01` < custom.from ? custom.from : `${m.key}-01`;
        const mEnd = `${m.key}-${String(m.daysInMonth).padStart(2, "0")}`;
        const last = mEnd > custom.to ? custom.to : mEnd;
        period += budgetOf(t, m.key) * ((dayN(last) - dayN(first) + 1) / (m.daysInMonth || 30));
      }
      fyTarget = period;
    }
    for (const m of payload.months || []) {
      const bud = budgetOf(t, m.key);
      if (!m.started) continue;
      const startDay = custom && `${m.key}-01` < custom.from ? Number(custom.from.slice(8, 10)) : 1;
      const frac = m.complete && !custom ? 1 : Math.min(1, Math.max(0, ((Number(String(m.through).slice(8, 10)) || 0) - startDay + 1) / (m.daysInMonth || 30)));
      pace += bud * frac;
      if (!m.complete) {
        monthTarget = bud; monthLabel = m.label;
        monthSales = rep?.months?.find(x => x.key === m.key)?.revenue || 0;
      }
    }
    const ytd = rep?.revenue || 0;
    return {
      rep: t.rep, fyTarget, ytd, pct: fyTarget ? (ytd / fyTarget) * 100 : 0,
      remaining: Math.max(0, fyTarget - ytd), vsPace: ytd - pace,
      monthLabel, monthTarget, monthSales,
      gpPct: rep?.marginPct ?? null, targetGpPct: t.targetGpPct,
      gpYtd: rep?.grossProfit ?? null, gpTarget: custom && fyTargetOf(t) ? t.sheetGp * (fyTarget / fyTargetOf(t)) : t.sheetGp,
    };
  });
  /* Everyone else who sold this year, so the table lists every salesperson (26 Nov 2026): their sales and margin,
     with no target to measure against. */
  const cur = (payload?.months || []).find(m => m.started && !m.complete);
  const noTarget = !payload ? [] : (payload.reps || []).filter(r => r.revenue > 0 && !targets.some(t => t.rep === r.name)).map(r => ({
    rep: r.name, fyTarget: null, ytd: r.revenue, pct: null, remaining: null, vsPace: null,
    monthLabel: cur?.label || "", monthTarget: null, monthSales: r.months?.find(x => x.key === cur?.key)?.revenue || 0,
    gpPct: r.marginPct ?? null, targetGpPct: null, gpYtd: r.grossProfit ?? null, gpTarget: null,
  }));
  const allRows = [...rows, ...noTarget];
  const range = payload?.range ? `${fmtDay(payload.range.start)} to ${fmtDay(payload.range.end)}` : null;
  // Progress to each rep's FY target. The fill is ink, or the accent when the rep is behind budget to date; the thin
  // mark is where the budget says they should be by now (sales less "vs budget to date").
  const visual = (
    <div className={st.targets}>
      {rows.map(r => {
        const behind = r.vsPace < 0;
        const mark = r.fyTarget ? ((r.ytd - r.vsPace) / r.fyTarget) * 100 : null;
        return (
          <div key={r.rep} className={st.targetRow}>
            <span className={st.targetName}>{r.rep}</span>
            <div className={st.targetTrack}>
              <div style={{ width: `${Math.min(100, Math.max(0, r.pct))}%`, background: behind ? ORANGE : INK, opacity: behind ? 1 : 0.82 }} />
              {mark !== null && mark > 0 && mark <= 100 && <b style={{ left: `${mark}%` }} title="Budget to date" />}
            </div>
            <span className={st.targetPct} style={{ color: behind ? ORANGE : INK }}>{r.pct.toFixed(1)}%</span>
          </div>
        );
      })}
    </div>
  );
  return (
    <AdvancedTable icon="target" title="Sales vs Target"
      subtitle={custom ? "Each month's budget, pro-rated to the dates chosen, ex GST. Sales are the same figures as Sales by Rep." : "Financial year targets (April to March), ex GST. Sales are the same figures as Sales by Rep."} range={range}
      loading={!payload} currency="NZD" data={allRows} visual={visual}
      columns={[
        { key: "rep", label: "Rep", color: INK },
        { key: "fyTarget", label: custom ? "Target, these dates" : "FY Target", align: "right", color: COLORS.ink2, format: v => (v == null ? <span style={{ color: COLORS.mute }}>No target</span> : KPI_CENTS(v)) },
        { key: "ytd", label: custom ? "Sales, these dates" : "FY Sales to Date", align: "right", color: INK, format: v => <span style={{ fontWeight: 500 }}>{KPI_CENTS(v)}</span> },
        { key: "pct", label: custom ? "% of target" : "% of FY Target", align: "left", format: (v, _cur, row) => v == null ? "-" : (
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 130 }}>
            <div style={{ flex: 1, height: 6, borderRadius: 999, background: inkA(0.07), overflow: "hidden" }}>
              <div style={{ width: `${Math.min(100, Math.max(0, v))}%`, height: "100%", borderRadius: 999, background: row.vsPace < 0 ? ORANGE : INK, opacity: row.vsPace < 0 ? 1 : 0.8 }} />
            </div>
            <span style={{ color: row.vsPace < 0 ? ORANGE : INK, fontWeight: 500, minWidth: 44, textAlign: "right" }}>{v.toFixed(1)}%</span>
          </div>) },
        { key: "remaining", label: "Remaining", align: "right", color: COLORS.ink2, format: v => (v == null ? "-" : v <= 0 ? "Target met" : KPI_CENTS(v)) },
        { key: "vsPace", label: "vs Budget to Date", align: "right", format: v => v == null ? "-" : (
          <span className={`${ui.trend} ${v < 0 ? ui.trendDown : ""}`} style={{ fontSize: 14 }}><Icon n={v >= 0 ? "tri-up" : "tri-down"} size={8} />{v >= 0 ? "+" : "-"}{KPI_CENTS(Math.abs(v))}</span>) },
        { key: "monthSales", label: "This Month", align: "right", color: INK, format: (v, _cur, row) => row.monthLabel
          ? (row.monthTarget == null ? KPI_CENTS(v) : <span>{KPI_CENTS(v)} <span style={{ color: COLORS.mute }}>of {KPI_CENTS(row.monthTarget)}</span></span>) : "-" },
        { key: "gpPct", label: "GP % (target)", align: "right", color: INK, format: (v, _cur, row) => v == null ? "-"
          : row.targetGpPct == null ? <span style={{ fontWeight: 500, color: v < 0 ? ORANGE : INK }}>{v.toFixed(1)}%</span>
          : <span><span style={{ fontWeight: 500, color: v >= row.targetGpPct ? INK : ORANGE }}>{v.toFixed(1)}%</span> <span style={{ color: COLORS.mute }}>({row.targetGpPct.toFixed(1)}%)</span></span> },
        { key: "gpYtd", label: custom ? "GP $ (target)" : "GP $ to Date (FY target)", align: "right", color: INK, format: (v, _cur, row) => v == null ? "-"
          : row.gpTarget == null ? KPI_CENTS(v) : <span>{KPI_CENTS(v)} <span style={{ color: COLORS.mute }}>({KPI_CENTS(row.gpTarget)})</span></span> },
      ]}
    />
  );
};

// ── Sales Rep Breakdown - ONE table with annual/monthly/weekly toggle ─────────
const SalesRepBreakdown = ({ weekRangeOf = () => "", salespeople, salespeopleMonthly, salespeopleWeekly, repMargins, loading, currency, weeklyMonth, onWeeklyMonthChange, fyMonths = null, rangeLabel = null, monthRangeLabel = null, T, exact = false, partialMonth = null }) => {
  // Merge margin numbers (cost, GP, marginPct) onto each rep by name
  const marginByName = {};
  for (const m of (repMargins || [])) marginByName[m.name] = m;
  // FY month display order: fyMonths is e.g. ["Apr",...,"Mar"]; null = calendar order
  const displayMonths = fyMonths || MONTH_NAMES;
  // Map FY display index → calendar month index (0=Jan..11=Dec)
  /* Look each month column up by its NAME, not by arithmetic on the position.
   * The financial-year payload already arrives in April-to-March order; the old
   * index shift assumed a January-to-December array and so moved every figure
   * three months along - April's total appeared under January. */
  const monthAt = (months, fi) => {
    const label = displayMonths[fi];
    const list  = months || [];
    return list.find(m => m.month === label) || null;
  };
  const [repView, setRepView] = useState("annual");

  // `exact` → show full amounts to the cent (NZ$1,277,734.48) and never round
  // intermediate values, so column totals tie to the source to the cent.
  const money = exact ? fmtExact : fmtK;
  const keep  = (n) => exact ? n : Math.round(n);

  const cellStyle    = (rev) => ({ padding: "10px 12px", textAlign: "right", color: rev < 0 ? ORANGE : rev > 0 ? INK : COLORS.mute, fontSize: 14, whiteSpace: "nowrap", fontWeight: 400, fontVariantNumeric: "tabular-nums" });
  // Margin colour: below the 20% margin target is the accent, otherwise quiet ink.
  const mCol = (v) => (v == null ? COLORS.mute : v >= 20 ? COLORS.ink2 : ORANGE);
  const repCellStyle = { padding: "10px 12px", color: INK, fontSize: 14, fontWeight: 500, whiteSpace: "nowrap" };
  const headStyle    = { ...thStyle(), padding: "10px 12px", background: COLORS.card };
  const numStyle     = () => ({ padding: "10px 12px", textAlign: "right", color: COLORS.ink2, fontSize: 14, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" });

  // Annual rows (summary) - merged with cost/margin when available
  const annualRows = (salespeople || []).map(s => {
    const m = marginByName[s.name];
    return {
      name:    s.name,
      orders:  s.orders,
      revenue: keep(s.revenue),
      aov:     s.orders > 0 ? keep(s.revenue / s.orders) : 0,
      /* `|| 0` would turn a withheld gross profit into a confident NZ$0, which
         reads as "this rep made nothing" rather than "we do not know". A missing
         value stays missing all the way to the cell. */
      cost:    m && m.cost != null ? keep(m.cost) : null,
      grossProfit: m && m.grossProfit != null ? keep(m.grossProfit) : null,
      marginPct:   m ? m.marginPct : null,
    };
  });
  const hasMargin = annualRows.some(r => r.marginPct !== null && r.marginPct !== undefined);
  // Reps whose margin was withheld because the source holds no cost for what they sold.
  const withheld  = (repMargins || []).filter(m => m.marginWithheld);

  const monthlyPivot = salespeopleMonthly || [];

  // Weekly pivot rows for selectedMonth: cols = W1..W5 + Month Total
  const maxWeeks = (salespeopleWeekly || []).some(r => r.weekly.some(x => x.month === weeklyMonth && x.week === 6 && x.revenue !== 0)) ? 6 : 5;
  const weeklyPivot = (salespeopleWeekly || []).map(rep => ({
    name:  rep.name,
    weeks: Array.from({ length: maxWeeks }, (_, wi) => {
      const w = rep.weekly.find(x => x.month === weeklyMonth && x.week === wi + 1);
      return w || { revenue: 0, orders: 0 };
    }),
    monthTotal: rep.weekly.filter(x => x.month === weeklyMonth).reduce((s, x) => s + x.revenue, 0),
  })).filter(rep => rep.monthTotal !== 0 || (salespeopleWeekly || []).length <= 3);

  // Revenue by month across every rep (the same sums as the TOTAL row of the monthly view), months not yet traded left off the end.
  const monthBarRows = (() => {
    const list = displayMonths.map((mn, fi) => ({ label: mn, value: monthlyPivot.reduce((s, rep) => s + (monthAt(rep.months, fi)?.revenue || 0), 0) }));
    while (list.length && !list[list.length - 1].value) list.pop();
    return list;
  })();
  // The month still running (from the page's own month rows) is drawn as part of a month, never as a full one.
  const repBarsPartialTo = partialMonth && monthBarRows.length && monthBarRows[monthBarRows.length - 1].label === partialMonth.label ? partialMonth.to : null;
  // Long rep lists show 25 at a time; every TOTAL row below is still worked from all reps.
  const repPg = usePaged(repView === "annual" ? annualRows : repView === "monthly" ? monthlyPivot : weeklyPivot, `${repView}|${weeklyMonth}`);

  return (
    <Card style={{ marginTop: 14 }}>
      <CardHead icon="users" title={<>Sales by Rep{loading && <span style={{ marginLeft: 10, verticalAlign: "middle" }}><Pill>Loading</Pill></span>}</>}>
        <RangeTag text={repView === "weekly" ? monthRangeLabel : rangeLabel} />
        <div className={ui.seg}>
          <button type="button" onClick={() => setRepView("annual")}  className={repView === "annual" ? ui.segOn : ""}>Annual</button>
          <button type="button" onClick={() => setRepView("monthly")} className={repView === "monthly" ? ui.segOn : ""}>Monthly</button>
          <button type="button" onClick={() => setRepView("weekly")}  className={repView === "weekly" ? ui.segOn : ""}>Weekly</button>
        </div>
      </CardHead>
      <div style={{ fontSize: 13.5, color: COLORS.mute, margin: "-6px 0 14px" }}>
        {repView === "annual"  ? `${fyMonths ? "FY totals" : "Annual totals"} · ${currency}` :
         repView === "monthly" ? `${fyMonths ? "FY monthly" : "Monthly"} breakdown by rep · ${currency}` :
                                 `Weekly breakdown for ${MONTH_NAMES[weeklyMonth]} · ${currency}`}
      </div>
      {repView === "annual" && annualRows.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <Mini icon="bars">Revenue by rep</Mini>
          <BarList rows={annualRows.map(r => ({ name: r.name, value: r.revenue }))} fmt={(v) => money(v, currency)} limit={8} />
        </div>
      )}
      {repView === "monthly" && monthBarRows.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <Mini icon="bars">Revenue by month, all reps</Mini>
          <MonthBars rows={monthBarRows} fmt={moneyShort} partialTo={repBarsPartialTo} />
        </div>
      )}

      {/* Annual view */}
      {repView === "annual" && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
            <thead>
              <tr>
                <th style={{ ...headStyle, textAlign: "left" }}>Sales Rep</th>
                <th style={headStyle}>Orders</th>
                <th style={headStyle}>Revenue</th>
                <th style={headStyle}>Avg Order</th>
                {hasMargin && <th style={headStyle}>Gross Profit</th>}
                {hasMargin && <th style={headStyle}>Margin</th>}
              </tr>
            </thead>
            <tbody>
              {annualRows.length === 0 ? (
                <tr><td colSpan={hasMargin ? 6 : 4} style={{ padding: "20px 10px", textAlign: "center", color: T.textLabel }}>
                  {loading ? "Loading…" : "No sales rep data"}
                </td></tr>
              ) : repPg.shown.map((r, i) => (
                <tr key={i} style={{ borderBottom: `1px solid ${T.borderFaint}` }}>
                  <td style={repCellStyle}>{r.name}</td>
                  <td style={numStyle()}>{r.orders.toLocaleString()}</td>
                  <td style={{ ...cellStyle(r.revenue), color: INK, fontWeight: 500 }}>{money(r.revenue, currency)}</td>
                  <td style={cellStyle(r.aov)}>{money(r.aov, currency)}</td>
                  {hasMargin && (
                    <td style={{ ...cellStyle(r.grossProfit || 0), color: (r.grossProfit ?? 0) >= 0 ? INK : ORANGE, fontWeight: 500 }}>
                      {r.grossProfit !== null ? money(r.grossProfit, currency) : <span style={{ color: T.textLabel }}>-</span>}
                    </td>
                  )}
                  {hasMargin && (
                    <td style={{ ...cellStyle(0), color: mCol(r.marginPct), fontWeight: 500 }}>
                      {r.marginPct !== null && r.marginPct !== undefined ? `${r.marginPct}%` : <span style={{ color: T.textLabel }}>-</span>}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            {annualRows.length > 0 && (() => {
              /* The total is built the way the company figure is: revenue and orders added up,
                 gross profit and margin on the revenue the margins rest on. When every rep has a
                 gross profit it is the sum of the column above, so the column and its total agree
                 to the cent; a rep whose margin is withheld is left out of the column, so then the
                 total is worked from revenue less cost instead and is the company's. */
              const orders  = annualRows.reduce((s, r) => s + (r.orders || 0), 0);
              const revenue = annualRows.reduce((s, r) => s + r.revenue, 0);
              const margRv  = annualRows.reduce((s, r) => s + (marginByName[r.name]?.marginableRevenue ?? r.revenue), 0);
              const cost    = annualRows.reduce((s, r) => s + (marginByName[r.name]?.cost || 0), 0);
              const allGP   = annualRows.every(r => r.grossProfit !== null);
              const gp      = hasMargin ? (allGP ? annualRows.reduce((s, r) => s + r.grossProfit, 0) : margRv - cost) : null;
              const pct     = gp != null && margRv > 0 ? parseFloat(((gp / margRv) * 100).toFixed(1)) : null;
              return (
                <tfoot>
                  <tr style={{ borderTop: `1px solid ${T.border}` }}>
                    <td style={{ ...repCellStyle, color: T.textMuted, fontSize: 11.5 }}>TOTAL</td>
                    <td style={{ ...numStyle(), color: T.textHead, fontWeight: 500 }}>{orders.toLocaleString()}</td>
                    <td style={{ ...cellStyle(revenue), color: INK, fontWeight: 500 }}>{money(keep(revenue), currency)}</td>
                    <td style={{ ...cellStyle(1), fontWeight: 500 }}>{orders > 0 ? money(keep(revenue / orders), currency) : "-"}</td>
                    {hasMargin && <td style={{ ...cellStyle(gp || 0), color: (gp ?? 0) >= 0 ? INK : ORANGE, fontWeight: 500 }}>{gp != null ? money(keep(gp), currency) : "-"}</td>}
                    {hasMargin && <td style={{ ...cellStyle(0), color: mCol(pct), fontWeight: 500 }}>{pct != null ? `${pct}%` : "-"}</td>}
                  </tr>
                </tfoot>
              );
            })()}
          </table>
          {repPg.bar}
        </div>
      )}

      {/* Monthly view */}
      {repView === "monthly" && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
            <thead>
              <tr>
                <th style={{ ...headStyle, textAlign: "left" }}>Rep</th>
                {displayMonths.map(m => <th key={m} style={headStyle}>{m}</th>)}
                <th style={{ ...headStyle, color: INK }}>Year so far</th>
                {hasMargin && <th style={headStyle}>Gross Profit</th>}
                {hasMargin && <th style={headStyle}>Margin</th>}
              </tr>
            </thead>
            <tbody>
              {monthlyPivot.length === 0 ? (
                <tr><td colSpan={hasMargin ? 16 : 14} style={{ padding: "20px 10px", textAlign: "center", color: T.textLabel }}>
                  {loading ? "Loading…" : "No monthly data"}
                </td></tr>
              ) : repPg.shown.map((rep, i) => {
                const total = displayMonths.reduce((s, _, fi) => s + (monthAt(rep.months, fi)?.revenue || 0), 0);
                const marg  = marginByName[rep.name];
                return (
                  <tr key={i} style={{ borderBottom: `1px solid ${T.borderFaint}` }}>
                    <td style={repCellStyle}>{rep.name}</td>
                    {displayMonths.map((mn, fi) => {
                      const m  = monthAt(rep.months, fi) || { revenue: 0, orders: 0 };
                      const mm = monthAt(marginByName[rep.name]?.months, fi);
                      const mColor = mCol(mm?.marginPct);
                      return (
                        <td key={mn} style={{ ...cellStyle(m.revenue), verticalAlign: "top" }}>
                          {/* A month of net returns is a real, negative figure. Printing
                              it as an em dash hid it while the row total still counted
                              it, so the columns stopped adding up to the total beside
                              them. Only a true zero is blank. */}
                          {m.revenue !== 0 ? (
                            <>
                              <div>{money(m.revenue, currency)}</div>
                              {mm?.marginPct != null && <div style={{ fontSize: 12, color: mColor, fontWeight: 500, marginTop: 2 }}>{mm.marginPct}%</div>}
                            </>
                          ) : <span style={{ color: T.textLabel }}>-</span>}
                        </td>
                      );
                    })}
                    <td style={{ ...cellStyle(total), color: INK, fontWeight: 500, verticalAlign: "top" }}>{money(keep(total), currency)}</td>
                    {hasMargin && (
                      <td style={{ ...cellStyle(marg?.grossProfit || 0), color: INK, fontWeight: 500 }}>
                        {marg?.grossProfit != null ? money(marg.grossProfit, currency) : <span style={{ color: T.textLabel }}>-</span>}
                      </td>
                    )}
                    {hasMargin && (
                      <td style={{ ...cellStyle(0), color: mCol(marg?.marginPct), fontWeight: 500 }}>
                        {marg?.marginPct != null ? `${marg.marginPct}%` : <span style={{ color: T.textLabel }}>-</span>}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
            {monthlyPivot.length > 0 && (
              <tfoot>
                <tr style={{ borderTop: `1px solid ${T.border}` }}>
                  <td style={{ ...repCellStyle, color: T.textMuted, fontSize: 11.5 }}>TOTAL</td>
                  {displayMonths.map((mn, fi) => {
                    const colTotal  = monthlyPivot.reduce((s, rep) => s + (monthAt(rep.months, fi)?.revenue || 0), 0);
                    /* Built from revenue and cost, never from the rows' gross profit.
                       A row whose margin was withheld has no gross profit to add, so
                       summing that column would quietly shrink the total away from the
                       company figure printed at the top of the page. */
                    const colCost   = hasMargin ? Object.values(marginByName).reduce((s, r) => s + (monthAt(r.months, fi)?.cost || 0), 0) : 0;
                    const colMargRv = hasMargin ? Object.values(marginByName).reduce((s, r) => s + (monthAt(r.months, fi)?.marginRevenue ?? monthAt(r.months, fi)?.revenue ?? 0), 0) : 0;
                    const colGP     = hasMargin ? colMargRv - colCost : null;
                    const colMargin = colMargRv > 0 && colGP != null ? parseFloat(((colGP / colMargRv) * 100).toFixed(1)) : null;
                    const mColor    = mCol(colMargin);
                    return (
                      <td key={mn} style={{ ...cellStyle(colTotal), color: T.textHead, fontWeight: 500, verticalAlign: "top" }}>
                        {colTotal !== 0 ? (
                          <>
                            <div>{money(keep(colTotal), currency)}</div>
                            {colMargin != null && <div style={{ fontSize: 12, color: mColor, fontWeight: 500, marginTop: 2 }}>{colMargin}%</div>}
                          </>
                        ) : "-"}
                      </td>
                    );
                  })}
                  {(() => {
                    const grandTotal = monthlyPivot.reduce((s, rep) => s + rep.months.reduce((ms, m) => ms + m.revenue, 0), 0);
                    const totalMargRv = hasMargin ? Object.values(marginByName).reduce((s, m) => s + (m.marginableRevenue || m.revenue || 0), 0) : 0;
                    const totalCostF  = hasMargin ? Object.values(marginByName).reduce((s, m) => s + (m.cost || 0), 0) : 0;
                    const gpRows     = Object.values(marginByName);
                    const totalGP    = hasMargin ? (gpRows.every(m => m.grossProfit != null) ? gpRows.reduce((sum, m) => sum + m.grossProfit, 0) : totalMargRv - totalCostF) : null;
                    const totalMarginPct = totalGP != null && totalMargRv > 0 ? parseFloat(((totalGP / totalMargRv) * 100).toFixed(1)) : null;
                    return (
                      <>
                        <td style={{ ...cellStyle(1), color: INK, fontWeight: 500 }}>{money(keep(grandTotal), currency)}</td>
                        {hasMargin && <td style={{ ...cellStyle(totalGP || 0), color: INK, fontWeight: 500 }}>{totalGP != null ? money(totalGP, currency) : "-"}</td>}
                        {hasMargin && <td style={{ ...cellStyle(0), color: mCol(totalMarginPct), fontWeight: 500 }}>{totalMarginPct != null ? `${totalMarginPct}%` : "-"}</td>}
                      </>
                    );
                  })()}
                </tr>
              </tfoot>
            )}
          </table>
          {repPg.bar}
        </div>
      )}

      {/* Weekly view */}
      {repView === "weekly" && (
        <>
          <div className={ui.seg} style={{ marginBottom: 16 }}>
            {MONTH_NAMES.map((mn, mi) => (
              <button type="button" key={mn} onClick={() => onWeeklyMonthChange(mi)} className={weeklyMonth === mi ? ui.segOn : ""}>{mn}</button>
            ))}
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
              <thead>
                <tr>
                  <th style={{ ...headStyle, textAlign: "left" }}>Rep</th>
                  {Array.from({ length: maxWeeks }, (_, i) => <th key={i} style={headStyle}>Week {i + 1}<div style={{ fontSize: 10.5, fontWeight: 500, letterSpacing: 0, textTransform: "none", color: T.textMuted, marginTop: 2 }}>{weekRangeOf(i + 1) || " "}</div></th>)}
                  <th style={{ ...headStyle, color: INK }}>Month Total</th>
                  {hasMargin && <th style={headStyle}>Gross Profit</th>}
                  {hasMargin && <th style={headStyle}>Margin</th>}
                </tr>
              </thead>
              <tbody>
                {weeklyPivot.length === 0 ? (
                  <tr><td colSpan={maxWeeks + (hasMargin ? 4 : 2)} style={{ padding: "20px 10px", textAlign: "center", color: T.textLabel }}>
                    {loading ? "Loading…" : `No data for ${MONTH_NAMES[weeklyMonth]}`}
                  </td></tr>
                ) : repPg.shown.map((rep, i) => {
                  // weeklyMonth is a calendar index (8 = Sep) but the months array
                  // is in financial-year order, so match on the name.
                  const mo   = (marginByName[rep.name]?.months || [])
                                 .find(m => m.month === MONTH_NAMES[weeklyMonth]);
                  const repW = marginByName[rep.name]?.weeks || [];
                  return (
                    <tr key={i} style={{ borderBottom: `1px solid ${T.borderFaint}` }}>
                      <td style={repCellStyle}>{rep.name}</td>
                      {rep.weeks.map((w, wi) => {
                        const wm = repW.find(x => x.month === weeklyMonth && x.week === wi + 1);
                        const wColor = mCol(wm?.marginPct);
                        return (
                          <td key={wi} style={{ ...cellStyle(w.revenue), verticalAlign: "top" }}>
                            {/* Negative weeks are shown, not hidden, see the monthly
                                cells above. A blank cell means no trade at all. */}
                            {w.revenue !== 0 ? (
                              <>
                                <div>{money(w.revenue, currency)}</div>
                                {wm?.marginPct != null && <div style={{ fontSize: 12, color: wColor, fontWeight: 500, marginTop: 2 }}>{wm.marginPct}%</div>}
                              </>
                            ) : <span style={{ color: T.textLabel }}>-</span>}
                          </td>
                        );
                      })}
                      <td style={{ ...cellStyle(rep.monthTotal), color: INK, fontWeight: 500, verticalAlign: "top" }}>
                        {rep.monthTotal !== 0 ? (
                          <>
                            <div>{money(rep.monthTotal, currency)}</div>
                            {mo?.marginPct != null && <div style={{ fontSize: 12, color: mCol(mo.marginPct), fontWeight: 500, marginTop: 2 }}>{mo.marginPct}%</div>}
                          </>
                        ) : "-"}
                      </td>
                      {hasMargin && (
                        <td style={{ ...cellStyle(mo?.grossProfit || 0), color: INK, fontWeight: 500 }}>
                          {mo?.grossProfit != null ? money(mo.grossProfit, currency) : <span style={{ color: T.textLabel }}>-</span>}
                        </td>
                      )}
                      {hasMargin && (
                        <td style={{ ...cellStyle(0), color: mCol(mo?.marginPct), fontWeight: 500 }}>
                          {mo?.marginPct != null ? `${mo.marginPct}%` : <span style={{ color: T.textLabel }}>-</span>}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
              {weeklyPivot.length > 0 && (() => {
                const monthOf = (rep) => (marginByName[rep.name]?.months || []).find(m => m.month === MONTH_NAMES[weeklyMonth]);
                const weekOf  = (rep, wi) => (marginByName[rep.name]?.weeks || []).find(x => x.month === weeklyMonth && x.week === wi + 1);
                const monthRev = weeklyPivot.reduce((s, r) => s + r.monthTotal, 0);
                const mGP  = weeklyPivot.reduce((s, r) => s + (monthOf(r)?.grossProfit ?? 0), 0);
                const mRv  = weeklyPivot.reduce((s, r) => s + (monthOf(r)?.grossProfit != null ? (monthOf(r)?.marginRevenue ?? monthOf(r)?.revenue ?? 0) : 0), 0);
                const mPct = hasMargin && mRv > 0 ? parseFloat(((mGP / mRv) * 100).toFixed(1)) : null;
                const colour = mCol;
                return (
                  <tfoot>
                    <tr style={{ borderTop: `1px solid ${T.border}` }}>
                      <td style={{ ...repCellStyle, color: T.textMuted, fontSize: 11.5 }}>TOTAL</td>
                      {Array.from({ length: maxWeeks }, (_, wi) => {
                        const rev = weeklyPivot.reduce((s, r) => s + (r.weeks[wi]?.revenue || 0), 0);
                        const withM = weeklyPivot.filter(r => weekOf(r, wi)?.grossProfit != null);
                        const gp = withM.reduce((s, r) => s + weekOf(r, wi).grossProfit, 0);
                        const rv = withM.reduce((s, r) => s + (weekOf(r, wi).marginRevenue ?? weekOf(r, wi).revenue ?? 0), 0);
                        const pct = hasMargin && rv > 0 ? parseFloat(((gp / rv) * 100).toFixed(1)) : null;
                        return (
                          <td key={wi} style={{ ...cellStyle(rev), color: T.textHead, fontWeight: 500, verticalAlign: "top" }}>
                            {rev !== 0 ? (
                              <>
                                <div>{money(keep(rev), currency)}</div>
                                {pct != null && <div style={{ fontSize: 12, color: colour(pct), fontWeight: 500, marginTop: 2 }}>{pct}%</div>}
                              </>
                            ) : "-"}
                          </td>
                        );
                      })}
                      <td style={{ ...cellStyle(monthRev), color: INK, fontWeight: 500, verticalAlign: "top" }}>
                        {monthRev !== 0 ? (
                          <>
                            <div>{money(keep(monthRev), currency)}</div>
                            {mPct != null && <div style={{ fontSize: 12, color: colour(mPct), fontWeight: 500, marginTop: 2 }}>{mPct}%</div>}
                          </>
                        ) : "-"}
                      </td>
                      {hasMargin && <td style={{ ...cellStyle(mGP), color: INK, fontWeight: 500 }}>{mRv > 0 ? money(keep(mGP), currency) : "-"}</td>}
                      {hasMargin && <td style={{ ...cellStyle(0), color: colour(mPct), fontWeight: 500 }}>{mPct != null ? `${mPct}%` : "-"}</td>}
                    </tr>
                  </tfoot>
                );
              })()}
            </table>
            {repPg.bar}
          </div>
        </>
      )}

      {/* Say plainly why a margin is blank, and for whom. A blank cell with no
          explanation reads as a broken page; named, it reads as a known gap. */}
      {withheld.length > 0 && (
        <Notice icon="percent" style={{ marginTop: 14 }}>
          <strong style={{ fontWeight: 500 }}>Why some margins are blank.</strong>{" "}
          {withheld.map(w => w.name).join(", ")}{" "}
          {withheld.length === 1 ? "invoices" : "invoice"} mostly things that were never bought:
          pallet rent, freight recharges, expense reimbursements and supplier rebate claims, raised
          without a product on the line. Their invoicing is counted in full
          ({money(keep(withheld.reduce((s, w) => s + (w.revenue || 0), 0)), currency)} in total),
          but there is no cost of sales to set against it, so a margin would have read close to
          100%. It is left blank rather than shown as something it is not.{" "}
          {/* Say what that does to the column, so nobody has to wonder why it is short. */}
          Because of those blanks the Gross Profit column adds up to{" "}
          {money(keep(withheld.reduce((s, w) => s + ((w.revenue || 0) - (w.cost || 0)), 0)), currency)}{" "}
          less than the total beneath it; the total is the company&apos;s, and is right.
        </Notice>
      )}
    </Card>
  );
};

export default function EcommerceDashboard({ section = "overview" }) {
  // Who is signed in and which pages their department may open.
  const [me, setMe] = useState(null);
  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" }).then(r => r.json()).then(j => { if (j.ok) setMe(j); }).catch(() => {});
  }, []);
  const isMgmt = me?.role === "mgmt";
  // A minute clock, so an old copy of the Odoo figures is flagged without a reload.
  const [clock, setClock] = useState(0);
  useEffect(() => {
    const tick = () => setClock(Date.now());
    const first = setTimeout(tick, 0), every = setInterval(tick, 60000);
    return () => { clearTimeout(first); clearInterval(every); };
  }, []);
  const canSeeStock = me?.role === "mgmt" || me?.role === "purch";
  const [activeStore,  setActiveStore]  = useState(STORES[0]);
  const [stockValue,   setStockValue]   = useState(null);
  const [selectedYear, setSelectedYear] = useState(2026);

  const [view,         setView]         = useState("monthly");
  /* Chosen dates (27 Nov 2026): any period the viewer picks. The Year view with a period set reads that period instead of
     the financial year, so every card follows it (the readers take ?from=&to=, lib/odooFy.js and lib/ostendoFy.js). */
  const [period,       setPeriod]       = useState({ from: "", to: "" });
  const [pickOpen,     setPickOpen]     = useState(false);
  const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || "");
  const customOn = view === "yoy" && isDay(period.from) && isDay(period.to) && period.from <= period.to;
  const [animated,     setAnimated]     = useState(true);
  const [activeMetric, setActiveMetric] = useState("revenue");
  const [hoveredMonth, setHoveredMonth] = useState(null);
  const [advancedData, setAdvancedData] = useState({});
  const [advLoading,   setAdvLoading]   = useState(false);
  const [channelTab,     setChannelTab]     = useState("odoo");
  // Which table group is on screen for the active company: reps first, then
  // products/categories, movers, customers, credits, debtors last.
  // Each table group is its own page now; the page decides which one shows.
  const advTab = section === "overview" ? "reps" : section;
  const [categoryModal,  setCategoryModal]  = useState(null);
  const [decliningMode,  setDecliningMode]  = useState("yoy");
  // One light design only (26 Nov 2026): there is no dark mode, and an old dark=1 in the address simply shows the light page.
  const [salespeopleData, setSalespeopleData] = useState([]); // explicit state so re-renders reliably
  const [weeklyMonth,    setWeeklyMonth]    = useState(new Date().getMonth());
  const [selectedWeek,   setSelectedWeek]   = useState(weekOfMonth(new Date()));

  /* ── Keep the view in the address bar ──────────────────────────────────────
   * Without this, refreshing while looking at Worthy Products South dropped you
   * back on Worthy Products North and everything had to be re-fetched. The
   * chosen company, year, tab and week now live in the URL, so a refresh (or a
   * shared link, or the back button) lands exactly where you were.
   * `restored` gates the data loader so we never fetch the default company's
   * data first and then throw it away.                                        */
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    try {
      const p = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const store = STORES.find(s => s.id === p.get("store"));
      if (store) setActiveStore(store);
      const yr = parseInt(p.get("fy") || "", 10);
      if (ALL_YEARS.includes(yr)) setSelectedYear(yr);
      if (["monthly", "weekly", "yoy"].includes(p.get("view"))) setView(p.get("view"));
      const pf = p.get("from") || "", pt = p.get("to") || "";
      if (/^\d{4}-\d{2}-\d{2}$/.test(pf) && /^\d{4}-\d{2}-\d{2}$/.test(pt) && pf <= pt) { setPeriod({ from: pf, to: pt }); setPickOpen(true); }
      if (p.get("tab") === "odoo") setChannelTab("odoo"); // an old tab=pos / tab=online link lands on Odoo Sales
      const mo = parseInt(p.get("m") || "", 10);
      if (mo >= 0 && mo <= 11) setWeeklyMonth(mo);
      const wk = parseInt(p.get("w") || "", 10);
      if (wk >= 1 && wk <= 6) setSelectedWeek(wk);
    } catch { /* a malformed hash should never stop the dashboard loading */ }
    setRestored(true);
  }, []);

  useEffect(() => {
    if (!restored) return;
    const p = new URLSearchParams({
      store: activeStore.id,
      fy:    String(selectedYear),
      view,
      tab:   channelTab,
      m:     String(weeklyMonth),
      w:     String(selectedWeek),
      ...(customOn ? { from: period.from, to: period.to } : {}),
    });
    try {
      window.history.replaceState(null, "", `${window.location.pathname}#${p.toString()}`);
    } catch { /* replaceState can throw in embedded contexts; the view still works */ }
  }, [restored, activeStore.id, selectedYear, view, channelTab, weeklyMonth, selectedWeek, customOn, period.from, period.to]);

  // Advanced table dates auto-sync to the selected view + period
  const _thisYear    = new Date().getFullYear();
  const _todayStr    = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland' }).format(new Date());   // New Zealand today, not UTC
  const advStartDate = view === "weekly"
    ? `${selectedYear}-${String(weeklyMonth + 1).padStart(2, '0')}-01`
    : activeStore.id === "luxe"
    ? `${selectedYear}-04-01`                       // FY starts April 1
    : `${selectedYear}-01-01`;
  const advEndDate = view === "weekly"
    ? new Date(Date.UTC(selectedYear, weeklyMonth + 1, 0)).toISOString().split('T')[0]   // UTC, so a New Zealand clock cannot lose the last day
    : activeStore.id === "luxe"
    ? (selectedYear >= _thisYear ? _todayStr : `${selectedYear + 1}-03-31`) // FY ends March 31 of next cal year
    : (selectedYear === _thisYear ? _todayStr : `${selectedYear}-12-31`);

  const [, forceUpdate] = useReducer(x => x + 1, 0);
  const cacheRef      = useRef({});
  const loadingRef    = useRef({});
  const advStoreRef   = useRef(null); // tracks which store's advanced fetch is active

  const fetchYear = async (storeId, year) => {
    if (storeId !== "worthy") return;
    const key = storeId + ":" + year;
    if (cacheRef.current[key] || loadingRef.current[key]) return;
    loadingRef.current[key] = true;
    forceUpdate();
    try {
      const endpoint = "/api/shopify?year=" + year;   // South is served by /api/ostendo/fy
      const r    = await fetch(endpoint);
      const json = await r.json();
      const convert = (arr) => (arr?.length > 0 ? arr.map(m => ({
        ...m,
        convRate: m.convRate ? +((m.convRate * 100).toFixed(2)) : 0,
      })) : generateEmptyYear());
      cacheRef.current[key] = {
        all:                convert(json.monthly),
        pos:                convert(json.monthlyPos),
        online:             convert(json.monthlyOnline),
        weekly:             json.weekly              || [],
        weeklyPos:          json.weeklyPos           || [],
        weeklyOnline:       json.weeklyOnline        || [],
        salespeople:        json.salespeople         || [],
        salespeopleMonthly: json.salespeopleMonthly  || [],
        salespeopleWeekly:  json.salespeopleWeekly   || [],
      };
      // Explicitly update salespeople state so the table re-renders
      if (year === selectedYear) setSalespeopleData(json.salespeople || []);
    } catch {
      const empty = generateEmptyYear();
      cacheRef.current[key] = { all: empty, pos: empty, online: empty, salespeople: [] };
    }
    loadingRef.current[key] = false;
    forceUpdate();
  };

  /* ── Worthy Products South: one call, one financial year ────────────────────
   * /api/ostendo/fy returns April→March already assembled, with cost, credits
   * and the matching prior-year period for every month. The dashboard used to
   * fetch two calendar years plus a separate cost endpoint and stitch them
   * together here, which is how the revenue column and the margin column ended
   * up describing different periods on the same row.                          */
  /* Which financial-year endpoint serves a company. South is Ostendo; North and
     Oceania are Odoo, and both now report the same April-March year. */
  const FY_SOURCE = {
    luxe:   (y) => `/api/ostendo/fy?fy=${y}`,
    worthy: (y) => `/api/odoo/fy?fy=${y}&company=4`,
    nova:   (y) => `/api/odoo/fy?fy=${y}&company=1`,
  };
  const fyKey = (storeId, year) => (customOn && year === selectedYear ? `fy:${storeId}:${period.from}_${period.to}` : `fy:${storeId}:${year}`);

  const fetchFYFor = async (storeId, year, { fresh = false } = {}) => {
    const key = fyKey(storeId, year);
    if (cacheRef.current[key] || loadingRef.current[key]) return;
    loadingRef.current[key] = true;
    forceUpdate();
    /* One retry. Odoo answers a 502 now and then when several heavy years are
       requested at once; the same request a few seconds later goes through. */
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        /* A retry asks the shared copy again; only the "Try again" button goes to Odoo directly (fresh=1), so a busy
           Odoo never gets one heavy read per visitor (26 Nov 2026). */
        const src = FY_SOURCE[storeId](year) + (customOn && year === selectedYear ? `&from=${period.from}&to=${period.to}` : "") + (fresh && storeId !== "luxe" ? "&fresh=1" : "");
        const r = await fetch(src, { cache: "no-store" });
        const json = await r.json();
        cacheRef.current[key] = json?.error ? { failed: json.error } : json;
      } catch (e) {
        cacheRef.current[key] = { failed: e.message };
      }
      if (!cacheRef.current[key]?.failed) break;
      if (attempt === 0) await new Promise(res => setTimeout(res, 4000));
    }
    loadingRef.current[key] = false;
    forceUpdate();
    /* The server answered with its last good copy (Odoo still reading): ask again in a minute and swap in the new
       figures. The page shows the time Odoo was read, so the copy on screen is never passed off as newer. */
    if (cacheRef.current[key]?.stale) {
      setTimeout(() => {
        if (cacheRef.current[key]?.stale) { delete cacheRef.current[key]; fetchFYFor(storeId, year); }
      }, 60000);
    }
  };

  /* Per-rep weekly margin for the Odoo companies. Week-level cost is too heavy
     to carry for a whole year, so it is fetched a month at a time, only when the
     weekly rep view needs it. */
  const odooWeekKey = (storeId, monthKey) => `odoowk:${storeId}:${monthKey}`;
  const fetchOdooWeeks = async (storeId, monthKey) => {
    const key = odooWeekKey(storeId, monthKey);
    if (cacheRef.current[key] || loadingRef.current[key]) return;
    loadingRef.current[key] = true;
    try {
      const company = storeId === "nova" ? 1 : 4;
      const r = await fetch(`/api/odoo/weeks?company=${company}&month=${monthKey}`, { cache: "no-store" });
      const json = await r.json();
      cacheRef.current[key] = json?.error ? { failed: json.error } : json;
    } catch (e) {
      cacheRef.current[key] = { failed: e.message };
    }
    loadingRef.current[key] = false;
    forceUpdate();
    // A saved copy (Odoo still reading): ask again in a minute and swap in the new figures.
    if (cacheRef.current[key]?.stale) {
      setTimeout(() => { if (cacheRef.current[key]?.stale) { delete cacheRef.current[key]; fetchOdooWeeks(storeId, monthKey); } }, 60000);
    }
  };

  const fetchFY = async (year) => {
    const key = `fy:luxe:${year}`;
    if (cacheRef.current[key] || loadingRef.current[key]) return;
    loadingRef.current[key] = true;
    forceUpdate();
    try {
      const r    = await fetch(`/api/ostendo/fy?fy=${year}`, { cache: "no-store" });
      const json = await r.json();
      cacheRef.current[key] = json?.error ? { failed: json.error } : json;
    } catch (e) {
      cacheRef.current[key] = { failed: e.message };
    }
    loadingRef.current[key] = false;
    forceUpdate();
  };

  const fetchOdoo = async (companyId, year, { fireAdvanced = true } = {}) => {
    const key = `odoo:${companyId}:${year}`;
    if (cacheRef.current[key] || loadingRef.current[key]) return;
    loadingRef.current[key] = true;
    forceUpdate();
    try {
      const r    = await fetch(`/api/odoo?year=${year}&company=${companyId}`);
      const json = await r.json();
      if (json.error) throw new Error(json.error);
      const convert = (arr) => (arr?.length > 0 ? arr : generateEmptyYear());
      const existing = cacheRef.current[key] || {};
      cacheRef.current[key] = {
        ...existing,
        all:                convert(json.monthly),
        weekly:             json.weekly              || [],
        salespeople:        json.salespeople         || [],
        salespeopleMonthly: json.salespeopleMonthly  || [],
        salespeopleWeekly:  json.salespeopleWeekly   || [],
        customers:          json.customers           || [],
        atRisk:             json.atRisk              || [],
        lapsed:             json.lapsed              || [],
      };
    } catch {
      const empty = generateEmptyYear();
      cacheRef.current[key] = { ...(cacheRef.current[key] || {}), all: empty, weekly: [] };
    }
    loadingRef.current[key] = false;
    forceUpdate();

    // Only fetch the heavy advanced payload for the CURRENT year. The prior
    // year is loaded for YoY revenue compare, not for product/category tables.
    if (fireAdvanced) fetchOdooAdvanced(companyId, year);
  };

  const fetchOdooAdvanced = async (companyId, year) => {
    const key    = `odoo:${companyId}:${year}`;
    const advKey = `${key}:adv`;
    if (loadingRef.current[advKey]) return;
    loadingRef.current[advKey] = true;
    forceUpdate();
    try {
      const r    = await fetch(`/api/odoo/advanced?year=${year}&company=${companyId}`);
      const json = await r.json();
      const existing = cacheRef.current[key] || {};

      // Merge per-month cost/GP/margin from advanced into existing monthly buckets
      // (those came from /api/odoo and only have revenue + orders).
      let merged = existing.all;
      if (json.monthlyCost && Array.isArray(json.monthlyCost) && Array.isArray(existing.all)) {
        merged = existing.all.map((m, i) => {
          const c = json.monthlyCost[i] || {};
          return {
            ...m,
            totalCost:         c.totalCost         ?? m.totalCost         ?? 0,
            marginableRevenue: c.marginableRevenue ?? m.marginableRevenue ?? 0,
            grossProfit:       c.grossProfit       ?? m.grossProfit       ?? 0,
            marginPct:         c.marginPct         ?? m.marginPct         ?? null,
            hasCostData:       !!c.hasCostData,
          };
        });
      }

      cacheRef.current[key] = {
        ...existing,
        all:           merged,
        topProducts:   json.topProducts   || [],
        topCategories: json.topCategories || [],
        fastMoving:    json.fastMoving    || [],
        slowMoving:    json.slowMoving    || [],
        monthlyCost:   json.monthlyCost   || [],
        repMargins:    json.repMargins    || [],
        advDiagnostics: json.diagnostics || null,
      };
    } catch (e) {
      console.error('[fetchOdooAdvanced] failed', e);
    }
    loadingRef.current[advKey] = false;
    forceUpdate();
  };

  // FIX 1: Parallel fetching - was sequential (await fetchYear x2 = 2× slower)
  useEffect(() => {
    if (!restored) return; // wait for the URL to be read, or we fetch the wrong company first
    if (activeStore.id !== "worthy" && activeStore.id !== "luxe" && activeStore.id !== "nova") return;
    const storeId = activeStore.id; // capture so async closure stays correct
    advStoreRef.current = storeId;  // mark this store as the active advanced fetch
    const load = async () => {
      const advCacheKey = `adv:${storeId}:${advStartDate}:${advEndDate}:${channelTab}`;

      // Restore from cache immediately - prevents blank tables on view/tab switches
      if (cacheRef.current[advCacheKey]) {
        setAdvancedData(cacheRef.current[advCacheKey]);
        setAdvLoading(false);
      } else {
        setAdvancedData({});
        setAdvLoading(true);
      }

      // Worthy Oceania - financial year only, no advanced analytics.
      if (storeId === "nova") {
        await fetchFYFor("nova", selectedYear);
        if (advStoreRef.current === storeId) setAdvLoading(false);
        // Weekly margin comes from the per-week cost read, same as North.
        if (section === "overview" && advStoreRef.current === storeId) {
          const calYear = weeklyMonth >= 3 ? selectedYear : selectedYear + 1;
          fetchOdooWeeks(storeId, `${calYear}-${String(weeklyMonth + 1).padStart(2, "0")}`);
        }
        return;
      }

      // Apr-Dec belong to the selected financial year, Jan-Mar to the next.
      await Promise.all([
        fetchFYFor(storeId, selectedYear),
        // Worthy North also has Online and POS tabs served by Shopify.
        ...(storeId === "worthy" && channelTab !== "odoo" ? [
          fetchYear(storeId, selectedYear),
          fetchYear(storeId, selectedYear - 1),
        ] : []),
      ]);
      /* The weekly rep cost is a second heavy Odoo read. It waits for the year's own
         figures so the two never compete - the cards on screen come first. */
      if (section === "overview" && storeId !== "luxe" && FY_SOURCE[storeId] && advStoreRef.current === storeId) {
        const calYear = weeklyMonth >= 3 ? selectedYear : selectedYear + 1;
        fetchOdooWeeks(storeId, `${calYear}-${String(weeklyMonth + 1).padStart(2, "0")}`);
      }
      // After main years load, fire non-blocking cost/margin + FY tail year
      // (sequential to avoid hammering Ostendo with concurrent header fetches)
      // South is served entirely by the FY endpoint - no calendar-year stitching,
      // no separate cost fetch, so no way for the two to disagree.
      if (advStoreRef.current !== storeId) return; // user switched store mid-fetch
      // Skip expensive fetch if already cached (set above)
      if (cacheRef.current[advCacheKey]) return;
      try {
        let result;
        if (storeId === "luxe") {
          // One financial year, aggregated inside Firebird. Field names below are
          // the ones the table column definitions expect - both spellings are
          // supplied where two tables read the same list under different keys.
          const res  = await fetch(`/api/ostendo/advanced?fy=${selectedYear}`, { cache: "no-store" });
          const data = await res.json();
          if (advStoreRef.current !== storeId) return; // stale - discard
          if (data.error) throw new Error(data.error);

          const pick = (o, a) => o[a];
          const products = (data.products || []).map(p => ({
            name: p.title, title: p.title, category: p.category || "-",
            qtySold: p.unitsSold, unitsSold: p.unitsSold,
            revenue: p.revenue, cost: p.cost,
            grossProfit: p.revenue - p.cost, margin: p.marginClean,
          }));
          const fastMoving = (data.fastMoving || []).map(p => ({
            name: p.title, title: p.title, category: p.category || "-",
            qtySold: p.unitsSold, unitsSold: p.unitsSold,
            revenue: p.revenue, margin: p.marginClean,
          }));
          const categories = (data.categories || []).map(c => ({
            name: c.category, category: c.category,
            qty: c.unitsSold, unitsSold: c.unitsSold,
            revenue: c.revenue, margin: c.marginClean,
            productCount: c.productCount,
          }));
          const customers = (data.customers || []).map(c => ({
            name: c.customer, orderCount: c.orderCount, revenue: c.revenue,
            status: c.status, email: c.email, aov: c.aov, lastOrderDays: c.lastOrderDays,
          }));
          const asRisk = (c) => ({
            name: c.customer, revenue: c.lifetimeRevenue, orderCount: c.lifetimeOrders,
            daysSince: c.lastOrderDays, lastOrderDate: c.lastOrder || null, status: c.status,
          });
          result = { curr: {
            topProducts:   products,
            topCategories: categories,
            topCustomers:  customers,
            fastMoving,
            slowMoving: (data.slowMoving || []).map(sm => ({
              name: sm.title, category: sm.category, currentStock: sm.stockOnHand,
              qtySold: sm.soldInPeriod, lockedCapital: sm.capitalTied, turnover: sm.turnover,
            })),
            churned: (data.churned || []).map(asRisk),
            atRisk:  (data.atRisk  || []).map(asRisk),
            clv: (data.clv || []).map(c => ({
              name: c.customer, lifetimeRevenue: c.lifetimeRevenue, totalOrders: c.lifetimeOrders,
              avgOrderValue: c.lifetimeOrders > 0 ? Math.round(c.lifetimeRevenue / c.lifetimeOrders) : 0,
              firstOrderDate: c.firstOrder || null,
            })),
            adjustments: (data.adjustments || []).map(a => ({
              name: a.title, count: a.count, value: a.value,
            })),
            declining: [], decliningMoM: [],
            metrics: data.metrics || {},
          }, prev: {} };
        } else {
          const channelParam = channelTab !== "odoo" ? `&channel=${channelTab}` : "";
          const res  = await fetch(`/api/shopify/advanced?startDate=${advStartDate}&endDate=${advEndDate}${channelParam}`, { cache: "no-store" });
          const data = await res.json();
          if (advStoreRef.current !== storeId) return; // stale - discard
          result = { curr: { ...data, slowMoving: data.slowMoving || [], churned: data.churned || [] }, prev: {} };
        }
        // Only cache if result has meaningful data (don't cache empty failures)
        if (result.curr?.topCategories?.length || result.curr?.topProducts?.length || result.curr?.topCustomers?.length) {
          cacheRef.current[advCacheKey] = result;
        }
        setAdvancedData(result);
      } catch (e) {
        console.error(`[${storeId}] Advanced fetch failed:`, e);
        if (advStoreRef.current !== storeId) return;
        // Don't cache failures - let the next load retry
        setAdvancedData({ curr: { topProducts: [], topCategories: [], topCustomers: [], slowMoving: [], churned: [], atRisk: [], clv: [], declining: [], metrics: {} }, prev: {} });
      }
      if (advStoreRef.current === storeId) setAdvLoading(false);
    };
    load();
  }, [restored, activeStore.id, selectedYear, view, weeklyMonth, channelTab, customOn, period.from, period.to]); // eslint-disable-line

  /* Stock valuation is a footer figure. It is read after the year on screen has
     loaded rather than alongside it. */
  useEffect(() => {
    if (!restored) return;
    let live = true;
    setStockValue(null);
    if (!canSeeStock) return;
    (async () => {
      for (let i = 0; i < 120 && live && (!cacheRef.current[fyKey(activeStore.id, selectedYear)]
                                          || loadingRef.current[fyKey(activeStore.id, selectedYear)]); i++) {
        await new Promise((r) => setTimeout(r, 1000));
      }
      if (!live) return;
      fetch(`/api/stock-value?store=${activeStore.id}`, { cache: "no-store" })
        .then(r => r.json())
        .then(j => { if (live && j.ok) setStockValue(j.value); })
        .catch(() => {});
    })();
    return () => { live = false; };
  }, [restored, activeStore.id, canSeeStock, selectedYear]); // eslint-disable-line

  /* YoY: one year at a time. This used to start every year at once - five years of
     Odoo and Shopify reads on top of the page's own data - so the year on screen
     queued behind history nobody had asked to see yet, and Odoo timed out under
     the pile. Now the selected year goes first, once its own figures have landed,
     then last year, then the older ones, each only after the one before is done.
     Leaving the view or the company stops the chain. */
  useEffect(() => {
    if (view !== "yoy" || !restored) return;
    if (activeStore.id !== "worthy" && activeStore.id !== "luxe" && activeStore.id !== "nova") return;
    let live = true;
    const storeId = activeStore.id;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    (async () => {
      // Let the figures for the year on screen finish before any history starts.
      for (let i = 0; i < 120 && live && loadingRef.current[fyKey(storeId, selectedYear)]; i++) await wait(1000);
      const order = [selectedYear, selectedYear - 1,
        ...[...ALL_YEARS].reverse().filter((y) => y < selectedYear - 1)];
      for (const yr of order) {
        if (!live) return;
        if (storeId === "luxe") await fetchFY(yr);
        else if (storeId === "worthy") {
          await fetchYear(storeId, yr);
          if (!live) return;
          await fetchOdoo(4, yr, { fireAdvanced: yr === selectedYear });
        } else await fetchOdoo(1, yr, { fireAdvanced: yr === selectedYear });
      }
    })();
    return () => { live = false; };
  }, [restored, activeStore.id, view, selectedYear]); // eslint-disable-line

  /* ── Adapters ──────────────────────────────────────────────────────────────
   * These translate the FY payload into the row shapes the tables already know
   * how to draw. Every South figure on screen comes from this one payload, so
   * the KPI cards, the monthly table and the rep table cannot contradict
   * each other.                                                               */
  const fyPayload = (year, storeId = activeStore.id) => {
    const d = cacheRef.current[fyKey(storeId, year)];
    return d && !d.failed ? d : null;
  };
  /* Every company is on a financial year now, so one rule decides whether a
     month has happened: the payload says so. */
  const onFY = (storeId = activeStore.id) => Boolean(FY_SOURCE[storeId]);

  /* The summary row needs every company's year, and the forecast needs last
     year's. They are read one at a time after the company on screen has loaded,
     so they never compete with it. Anything already read is not read again. */
  useEffect(() => {
    if (!restored) return;
    let live = true;
    const settled = (key) => new Promise((resolve) => {
      let waited = 0;
      const t = setInterval(() => {
        waited += 1;
        if (!loadingRef.current[key] || waited > 120) { clearInterval(t); resolve(); }
      }, 1000);
    });
    (async () => {
      await settled(fyKey(activeStore.id, selectedYear));
      /* Last year for the business on screen first: the year summary and forecast need it, and the other businesses'
         years (for the summary row) can follow. Same reads as before, in a better order (27 Nov 2026). */
      if (live && !customOn) { await fetchFYFor(activeStore.id, selectedYear - 1); await settled(fyKey(activeStore.id, selectedYear - 1)); }
      for (const st of STORES) {
        if (!live || customOn) return;   // chosen dates: only the business on screen is read, gentle on Odoo
        await fetchFYFor(st.id, selectedYear);
        await settled(fyKey(st.id, selectedYear));
      }
    })();
    return () => { live = false; };
  }, [restored, activeStore.id, selectedYear, customOn, period.from, period.to]); // eslint-disable-line

  /* One set of figures, exactly as Ostendo holds them. Revenue is the product
     lines, which is what Worthy's finance team reports; rebates are shown as
     their own number instead of being netted off sales. */
  const basisOf = (m) => ({ revenue: m.revenue, cost: m.cost,
                            grossProfit: m.grossProfit, marginPct: m.marginPct });

  const fyMonthRow = (m) => ({
    month:             m.label,
    key:               m.key,
    ...basisOf(m),
    totalCost:         m.cost,
    rebates:           m.rebates,
    netSales:          m.netSales,
    orders:            m.invoices,     // credit notes are NOT orders
    returns:           m.credits,      // ...they are reported here instead
    returnValue:       m.creditValue,
    totalDiscounts:    m.discounts,
    sessions:          0,
    convRate:          0,
    newCustomers:      m.newCustomers,
    aov:               m.aov,
    started:           m.started,
    complete:          m.complete,
    through:           m.through,
    priorComparable:   m.priorComparable !== false,
    daysElapsed:       m.daysElapsed,
    daysInMonth:       m.daysInMonth,
    /* The API withholds a margin where too little of the revenue has a cost behind it
       (a month still being costed). The row then carries a cost that covers only part
       of the revenue, so working a margin out of it here gives a number that looks
       real and is not - 25.3% for October against about 12% a month all year. Only the
       single-month figures are withheld: the year as a whole is still costed against
       the API's own totals, which is why marginableRevenue is left alone. */
    marginWithheld:    Boolean(m.marginWithheld),
    costCoverage:      m.costCoverage,
    costedRevenue:     m.costedRevenue,
    hasCostData:       Boolean(m.started && m.cost != null && m.cost !== 0 && !m.marginWithheld),
    marginableRevenue: (m.started && m.cost != null && m.cost !== 0) ? (m.marginRevenue ?? m.costedRevenue ?? basisOf(m).revenue) : 0,
    marginCost:        m.marginCost,
    suspectLines:      m.suspectLines,
    suspectRevenue:    m.suspectRevenue,
    recostedLines:     m.recostedLines,
    recostedRevenue:   m.recostedRevenue,
  });

  // The "previous year" array is the matching slice of last year, day for day  - 
  // so a month that is only half done is never compared against a whole month.
  // Last year has to be measured on the SAME basis as this year, or the growth
  // column compares a cleaned figure against an uncleaned one and understates it.
  const fyPriorRow = (m) => ({
    ...fyMonthRow(m),
    ...basisOf(m.prior),
    totalCost:         m.prior.cost,
    rebates:           m.prior.rebates,
    netSales:          m.prior.netSales,
    orders:            m.prior.invoices,
    returns:           m.prior.credits,
    totalDiscounts:    m.prior.discounts,
    newCustomers:      null,
    aov:               m.prior.aov,
    hasCostData:       Boolean(m.started && m.prior.cost != null && m.prior.cost !== 0 && !m.prior.marginWithheld),
    marginableRevenue: (m.started && m.prior.cost != null && m.prior.cost !== 0) ? (m.prior.marginRevenue ?? m.prior.costedRevenue ?? m.prior.revenue) : 0,
    marginCost:        m.prior.marginCost,
  });

  const MONTH_IDX = Object.fromEntries(MONTH_NAMES.map((m, i) => [m, i]));

  const fyWeekRows = (d) => (d?.weeks || []).map(w => ({
    label:          w.label,
    month:          MONTH_IDX[w.monthLabel],
    week:           w.week,
    dateRange:      w.dateRange,
    days:           w.days,
    expectedDays:   w.expectedDays,
    complete:       w.complete,
    revenue:        w.revenue,
    orders:         w.invoices,
    returns:        w.credits,
    aov:            w.aov,
    totalCost:      w.cost,
    grossProfit:    w.grossProfit,
    marginPct:      w.marginPct,
    hasCostData:    w.cost != null && w.cost !== 0 && !w.marginWithheld,
    marginableRevenue: w.marginRevenue,
    marginCost:     w.marginCost,
    totalDiscounts: 0,
    newCustomers:   0,
  }));

  const getMonthly = (year) => {
    /* Worthy Oceania, and Worthy North on its Odoo tab, are on the same
       April-March financial year as South and read the same way. */
    if (activeStore.id === "nova" || (activeStore.id === "worthy" && channelTab === "odoo")) {
      const emptyFY = FY_MONTHS.map(m => ({ month: m, revenue: 0, totalCost: 0, grossProfit: 0, marginPct: null, orders: 0, returns: 0, sessions: 0, totalDiscounts: 0, aov: 0, newCustomers: null, hasCostData: false, marginableRevenue: 0, started: false }));
      if (view === "yoy") {
        const own = fyPayload(year);
        return own ? own.months.map(fyMonthRow) : emptyFY;
      }
      const d = fyPayload(selectedYear);
      if (!d) return emptyFY;
      return d.months.map(year === selectedYear ? fyMonthRow : fyPriorRow);
    }
    // Worthy Products South - April→March financial year, served whole.
    // year === selectedYear     -> this financial year
    // year === selectedYear - 1 -> the SAME span last year, month for month
    if (activeStore.id === "luxe") {
      const emptyFY = FY_MONTHS.map(m => ({ month: m, revenue: 0, totalCost: 0, grossProfit: 0, marginPct: null, orders: 0, returns: 0, sessions: 0, totalDiscounts: 0, aov: 0, newCustomers: 0, hasCostData: false, marginableRevenue: 0, started: false }));
      // Year-on-year: every financial year is loaded in its own right.
      if (view === "yoy") {
        const own = fyPayload(year);
        return own ? own.months.map(fyMonthRow) : emptyFY;
      }
      const d = fyPayload(selectedYear);
      if (!d) return emptyFY;
      return d.months.map(year === selectedYear ? fyMonthRow : fyPriorRow);
    }
    const cached = cacheRef.current[activeStore.id + ":" + year];
    if (!cached) return generateEmptyYear();
    if (activeStore.id !== "worthy") return cached;
    // Return channel-specific slice for worthy store
    if (channelTab === "pos")    return cached.pos    || generateEmptyYear();
    if (channelTab === "online") return cached.online || generateEmptyYear();
    return cached.all || generateEmptyYear();
  };
  const getWeekly = () => {
    if (onFY() && (activeStore.id !== "worthy" || channelTab === "odoo")) {
      const rows = fyWeekRows(fyPayload(selectedYear));
      if (activeStore.id === "luxe") return rows;
      /* Odoo holds cost per month, so a week's margin comes from the per-rep week costs
         fetched for the selected month: add the reps up for each week. */
      const costRows = odooWeekRows();
      return rows.map(r => {
        if (r.month !== weeklyMonth) return r;
        const hits = costRows.filter(x => x.week === r.week && x.grossProfit != null && x.cost != null);
        if (!hits.length) return r;
        const gp = hits.reduce((a, x) => a + x.grossProfit, 0);
        const cost = hits.reduce((a, x) => a + x.cost, 0);
        const marginRev = gp + cost;
        return { ...r, totalCost: cost, grossProfit: gp, marginableRevenue: marginRev, marginCost: cost,
                 marginPct: marginPct1(gp, marginRev), hasCostData: true };
      });
    }
    const cached = cacheRef.current[activeStore.id + ":" + selectedYear];
    if (!cached) return [];
    if (activeStore.id !== "worthy") return cached.weekly || [];
    if (channelTab === "pos")    return cached.weeklyPos    || [];
    if (channelTab === "online") return cached.weeklyOnline || [];
    return cached.weekly || [];
  };
  const getSalespeople = () => {
    if (activeStore.id === "luxe") {
      // Same payload as the year total, so the rep rows always add up to it.
      // Same cost basis as everything else, or the rep table contradicts the
      // monthly table sitting directly above it.
      return (fyPayload(selectedYear)?.reps || []).map(r => ({
        name: r.name, revenue: basisOf(r).revenue, orders: r.invoices, aov: r.aov,
        returns: r.credits, returnValue: r.creditValue, unnamed: !r.named,
      }));
    }
    const cached = cacheRef.current[activeStore.id + ":" + selectedYear];
    return cached?.salespeople || [];
  };
  // Which Odoo company is the active context? 4 = Worthy North, 1 = Worthy Oceania (nova)
  const currentOdooCid = () => {
    if (activeStore.id === "nova") return 1;
    if (activeStore.id === "worthy" && channelTab === "odoo") return 4;
    return null;
  };
  const odooCacheKey = (year) => {
    const cid = currentOdooCid();
    return cid ? `odoo:${cid}:${year}` : null;
  };
  /* The dates a table actually covers, written out, so no table has to be read
     against the period selector to know what it shows.
       period   the selected period
       asat     customer status (at risk, lapsed): judged on the last day of the period
       lifetime lifetime spend, counted up to the last day of the period
     Odoo companies and Ostendo (luxe) are always a whole financial year here;
     Shopify follows the same start and end dates the page requests. */
  const tableRange = (kind = "period") => {
    const fyBased = (activeStore.id === "worthy" && channelTab === "odoo") || activeStore.id === "nova" || activeStore.id === "luxe";
    const fy = fyBased ? fyPayload(selectedYear)?.range : null;
    const start = fy?.start || (fyBased ? null : advStartDate);
    const rawEnd = fy?.end || (fyBased ? null : advEndDate);
    const end = rawEnd && rawEnd > _todayStr ? _todayStr : rawEnd;   // never show dates that have not happened yet
    if (!start || !end) return null;
    if (fyBased && kind === "asat")     return `As at ${fmtDay(end)}`;
    if (fyBased && kind === "lifetime") return `Lifetime to ${fmtDay(end)}`;
    return `${fmtDay(start)} to ${fmtDay(end)}`;
  };
  /* The calendar month the weekly table covers (a financial year runs Apr to Mar). */
  const monthRange = () => {
    const y = onFYView() ? (weeklyMonth >= 3 ? selectedYear : selectedYear + 1) : selectedYear;
    const mm = String(weeklyMonth + 1).padStart(2, "0");
    const last = new Date(Date.UTC(y, weeklyMonth + 1, 0)).getUTCDate();
    const end = `${y}-${mm}-${String(last).padStart(2, "0")}`;
    return `${fmtDay(`${y}-${mm}-01`)} to ${fmtDay(end > _todayStr ? _todayStr : end)}`;
  };
  /* The whole year the monthly table lists. */
  const yearRange = () => {
    if (onFYView()) {
      const fy = fyPayload(selectedYear)?.range;
      return fy ? `${fmtDay(fy.start)} to ${fmtDay(fy.end)}` : null;   // not shown until the year has loaded
    }
    return `${fmtDay(`${selectedYear}-01-01`)} to ${fmtDay(selectedYear >= _thisYear ? _todayStr : `${selectedYear}-12-31`)}`;
  };

  const getOdooSalespeople = () => (fyPayload(selectedYear)?.reps || []).map(r => ({
    name: r.name, revenue: r.revenue, orders: r.invoices, aov: r.aov,
    returns: r.credits, returnValue: r.creditValue,
  }));
  const getOdooSalespeopleMonthly = () => (fyPayload(selectedYear)?.reps || []).map(r => ({
    name: r.name,
    months: r.months.map(m => ({ month: m.label, revenue: m.revenue, orders: m.invoices, started: m.started })),
  }));
  const getOdooSalespeopleWeekly = () => (fyPayload(selectedYear)?.reps || []).map(r => ({
    name: r.name,
    weekly: (r.weeks || []).map(w => ({
      month: MONTH_IDX[MONTH_NAMES[parseInt(w.monthKey.slice(5, 7), 10) - 1]],
      week: w.week, revenue: w.revenue, orders: w.invoices,
    })),
  }));
  const fyCustomers = () => fyPayload(selectedYear)?.customers || [];
  const asRiskRow = (c) => ({
    name: c.customer, revenue: c.lifetimeRevenue, orderCount: c.lifetimeOrders,
    daysSince: c.lastOrderDays, lastOrderDate: c.lastOrder || null, status: c.status,
  });
  const getOdooCustomers = () => fyCustomers().map(c => ({
    name: c.customer, orderCount: c.orderCount, revenue: c.revenue,
    aov: c.orderCount > 0 ? Math.round(c.revenue / c.orderCount) : 0, status: c.status,
  }));
  const getOdooAtRisk    = () => (fyPayload(selectedYear)?.atRisk  || []).map(asRiskRow);
  const getOdooLapsed    = () => (fyPayload(selectedYear)?.churned || []).map(asRiskRow);
  const getOdooCLV       = () => (fyPayload(selectedYear)?.clv || []).map(c => ({
    name: c.customer, lifetimeRevenue: c.lifetimeRevenue, totalOrders: c.lifetimeOrders,
    avgOrderValue: c.lifetimeOrders > 0 ? Math.round(c.lifetimeRevenue / c.lifetimeOrders) : 0,
    firstOrderDate: c.firstOrder || null,
  }));
  const mapProd = (p) => ({
    name: p.title, title: p.title, category: p.category,
    qtySold: p.unitsSold, unitsSold: p.unitsSold,
    // `currentStock` is the key the On Hand column reads.
    currentStock: p.onHand ?? null,
    revenue: p.revenue, cost: p.cost, margin: p.margin,
  });
  const getOdooTopProducts   = () => (fyPayload(selectedYear)?.products   || []).map(mapProd);
  const getOdooFastMoving    = () => (fyPayload(selectedYear)?.fastMoving || []).map(mapProd);
  const getOdooTopCategories = () => (fyPayload(selectedYear)?.categories || []).map(c => ({
    name: c.category, category: c.category, qty: c.unitsSold, unitsSold: c.unitsSold,
    revenue: c.revenue, margin: c.margin, productCount: c.productCount,
  }));
  // Stock held today against what sold in the financial year, ranked by capital tied up.
  const getOdooSlowMoving = () => (fyPayload(selectedYear)?.slowMoving || []).map(p => ({
    name: p.title, category: p.category, currentStock: p.onHand,
    qtySold: p.unitsSold, lockedCapital: p.lockedCapital,
  }));
  /* Rep margin for the Odoo companies. Odoo does not store the salesperson on
     the invoice line, so the endpoint filters lines through the move to get each
     rep's cost. Weeks carry no margin because Odoo holds cost per month. */
  const odooWeekMonthKey = () => {
    const d = fyPayload(selectedYear);
    return d?.months.find(m => MONTH_IDX[m.label] === weeklyMonth)?.key || null;
  };
  const odooWeekRows = () => {
    const k = odooWeekMonthKey();
    const d = k ? cacheRef.current[odooWeekKey(activeStore.id, k)] : null;
    return d && !d.failed ? d.rows : [];
  };

  const getOdooRepMargins = () => (fyPayload(selectedYear)?.reps || [])
    .filter(r => r.cost != null)
    .map(r => ({
      name: r.name, revenue: r.revenue, cost: r.cost, grossProfit: r.grossProfit,
      marginableRevenue: r.marginRevenue ?? r.costedRevenue ?? r.revenue, marginPct: r.marginPct,
      marginWithheld: r.marginWithheld, costCoverage: r.costCoverage,
      months: r.months.map(m => ({
        month: m.label, revenue: m.revenue, cost: m.marginCost ?? m.cost,
        marginRevenue: m.marginRevenue ?? m.costedRevenue ?? m.revenue,
        grossProfit: m.grossProfit, marginPct: m.marginPct, started: m.started,
        marginWithheld: m.marginWithheld, costCoverage: m.costCoverage,
      })),
      // Weeks carry a margin once the selected month's week costs have loaded.
      weeks: (r.weeks || []).map(w => {
        const mi = MONTH_IDX[MONTH_NAMES[parseInt(w.monthKey.slice(5, 7), 10) - 1]];
        const hit = mi === weeklyMonth
          ? odooWeekRows().find(x => x.name === r.name && x.week === w.week) : null;
        return {
          month: mi, week: w.week, revenue: w.revenue,
          cost: hit?.cost ?? null, grossProfit: hit?.grossProfit ?? null,
          marginRevenue: hit?.grossProfit != null && hit?.cost != null ? hit.grossProfit + hit.cost : null,
          marginPct: hit?.marginPct ?? null,
        };
      }),
    }));
  const isOdooAdvLoading          = () => {
    const cid = currentOdooCid();
    return cid ? !!loadingRef.current[`odoo:${cid}:${selectedYear}:adv`] : false;
  };

  // Rep pivots. Both come straight from the FY payload - no stitching, so the
  // revenue column and the margin column describe the same period by construction.
  const getLuxeSalespeopleMonthlyFY = () =>
    (fyPayload(selectedYear)?.reps || []).map(r => ({
      name: r.name,
      months: r.months.map(m => ({ month: m.label, revenue: basisOf(m).revenue, orders: m.invoices, started: m.started })),
    }));

  const getLuxeSalespeopleWeekly = () =>
    (fyPayload(selectedYear)?.reps || []).map(r => ({
      name: r.name,
      weekly: r.weeks.map(w => ({
        month: MONTH_IDX[MONTH_NAMES[parseInt(w.monthKey.slice(5, 7), 10) - 1]],
        week: w.week, revenue: basisOf(w).revenue, orders: w.invoices,
      })),
    }));

  const getLuxeFYRepMargins = () =>
    (fyPayload(selectedYear)?.reps || []).map(r => ({
      name: r.name,
      ...basisOf(r),
      cost: r.marginCost ?? basisOf(r).cost,
      marginableRevenue: r.marginRevenue ?? r.costedRevenue ?? basisOf(r).revenue,
      priorRevenue: basisOf(r.prior).revenue, growthPct: r.growthPct,
      months: r.months.map(m => ({
        month: m.label, ...basisOf(m), cost: m.marginCost ?? basisOf(m).cost,
        marginRevenue: m.marginRevenue ?? basisOf(m).revenue, started: m.started,
      })),
      weeks: r.weeks.map(w => ({
        month: MONTH_IDX[MONTH_NAMES[parseInt(w.monthKey.slice(5, 7), 10) - 1]],
        week: w.week, ...basisOf(w), cost: w.marginCost ?? basisOf(w).cost,
        marginRevenue: w.marginRevenue ?? basisOf(w).revenue,
      })),
    }));

  const onFYView = () => onFY() && (activeStore.id !== "worthy" || channelTab === "odoo");
  const isLoading = (year) => {
    if (onFYView()) return !!loadingRef.current[fyKey(activeStore.id, selectedYear)];
    return !!loadingRef.current[activeStore.id + ":" + year];
  };
  const hasData = (year) => {
    if (onFYView()) return !!fyPayload(selectedYear);
    return activeStore.id !== "worthy" || !!cacheRef.current[activeStore.id + ":" + year];
  };
  const anyLoading = isLoading(selectedYear) || isLoading(selectedYear - 1);
  // While this year's figures load, show a dash, never a zero that reads as no sales (26 Nov 2026).
  const curLoading = isLoading(selectedYear);

  /* Years worth offering. For South this is derived from the data itself, so
   * financial years that pre-date the first invoice in Ostendo are never shown
   * as if they were years of zero trade. */
  const fyFirst = fyPayload(selectedYear)?.dataAvailable?.first
                 || Object.keys(cacheRef.current)
                      .filter(k => k.startsWith(`fy:${activeStore.id}:`))
                      .map(k => cacheRef.current[k]?.dataAvailable?.first)
                      .find(Boolean);
  const thisFY = (() => { const n = new Date(); return n.getMonth() >= 3 ? n.getFullYear() : n.getFullYear() - 1; })();
  const yearsForStore = onFYView() && fyFirst
    ? Array.from({ length: thisFY - fyOf(fyFirst) + 1 }, (_, i) => fyOf(fyFirst) + i)
    : ALL_YEARS;

  const curr       = getMonthly(selectedYear);
  const prev       = getMonthly(selectedYear - 1);
  const prevLoaded = !customOn && hasData(selectedYear - 1);
  const hasCost    = curr.some(d => d.hasCostData);

  /* Has this month actually happened?
   * South carries the answer in the payload. Worthy North and Oceania report a
   * calendar year, so it is worked out from the date. Without this, a month
   * that has not arrived yet is compared against last year's real trade and
   * reported as a 100% collapse. */
  const nowRef        = new Date();
  const isCurrentYear = selectedYear === nowRef.getFullYear();
  const monthStarted = (i) => {
    if (onFYView()) return curr[i]?.started !== false;
    if (selectedYear < nowRef.getFullYear()) return true;
    if (selectedYear > nowRef.getFullYear()) return false;
    return i <= nowRef.getMonth();
  };
  // The month in progress is real revenue but only a part-month of it, so it is
  // excluded from year-on-year totals for the calendar-year companies, which
  // report monthly and cannot be sliced to the day.
  const monthComparable = (i) =>
    onFYView() ? monthStarted(i)
               : monthStarted(i) && !(isCurrentYear && i === nowRef.getMonth());

  const momData = curr.map((d, i) => {
    /* A month that has not arrived yet carries no figures at all. Reporting it
       as zero drew the revenue line straight down to the axis, which reads as a
       collapse in trade rather than a month that simply has not happened. */
    if (!monthStarted(i)) {
      return {
        ...d, month: d.month, notStarted: true,
        revenue: null, orders: null, totalCost: null, grossProfit: null, marginPct: null,
        aov: null, prevRevenue: null, prevOrders: null, prevMarginPct: null, momGrowth: null,
      };
    }
    const rev       = d.revenue   || 0;
    const cst       = d.totalCost || 0;
    const dynGp     = d.hasCostData ? rev - cst : null;
    const dynMargin = (d.hasCostData && rev > 0) ? marginPct1(dynGp, rev) : null;
    return {
      ...d,
      grossProfit: d.grossProfit !== undefined ? d.grossProfit : dynGp,
      marginPct:   d.marginPct   !== undefined ? d.marginPct   : dynMargin,
      prevRevenue:  prev[i]?.revenue || 0,
      prevOrders:   prev[i]?.orders  || 0,
      prevMarginPct: (() => { const pr = prev[i]?.revenue || 0, pc = prev[i]?.totalCost || 0; return (prev[i]?.hasCostData && pr > 0) ? marginPct1(pr - pc, pr) : null; })(),
      momGrowth:    (prevLoaded && d.priorComparable !== false && monthStarted(i))
                      ? calcGrowth(rev, prev[i]?.revenue || 0) : null,
    };
  });

  const totalRev  = curr.reduce((s, d) => s + (d.revenue        || 0), 0);
  const prevRev   = prev.reduce((s, d, i) => s + (monthComparable(i) ? (d.revenue || 0) : 0), 0);
  const totalOrd  = curr.reduce((s, d) => s + (d.orders         || 0), 0);
  const prevOrd   = prev.reduce((s, d, i) => s + (monthComparable(i) ? (d.orders  || 0) : 0), 0);
  const totalCost = curr.reduce((s, d) => s + (d.totalCost      || 0), 0);
  const newCustUnknown = curr.some(d => d.started !== false && d.revenue > 0 && d.newCustomers === null);
  const totalNewC = newCustUnknown ? null : curr.reduce((s, d) => s + (d.newCustomers || 0), 0);
  const totalDisc = curr.reduce((s, d) => s + (d.totalDiscounts || 0), 0);
  const totalRet  = curr.reduce((s, d) => s + (d.returns        || 0), 0);
  const isOstendo = activeStore.id === "luxe";
  /* Show amounts to the cent wherever the figures ARE cent-accurate - which is
     every financial-year view, not just Ostendo's. Rounding each month to whole
     dollars for display meant the column on screen came to a dollar less than
     the total printed under it, even though the underlying cents reconciled
     exactly. A reader adding up what they can see has to get the printed answer. */
  const exactAmounts = onFYView();
  const avgAOV    = totalOrd ? (exactAmounts ? round2(totalRev / totalOrd) : Math.round(totalRev / totalOrd)) : 0;
  const prevAOV   = prevOrd  ? Math.round(prevRev  / prevOrd)  : 0;

  const totalMargRev = curr.reduce((s, d) => s + (d.marginableRevenue || 0), 0);
  /* The year's gross profit is the sum of the rows printed above it, which the API has
     already settled to the cent, so the total can never differ from its own column. */
  const gpRows = curr.reduce((s, d) => s + ((d.marginableRevenue || 0) > 0 ? (d.grossProfit ?? ((d.marginableRevenue || 0) - (d.marginCost ?? d.totalCost ?? 0))) : 0), 0);
  const totalMarginCost = curr.reduce((s, d) => s + (d.marginCost ?? d.totalCost ?? 0), 0);
  const trueMargin   = totalMargRev > 0 ? (totalMargRev - totalMarginCost) / totalMargRev : null;
  // FIX 3: Fall back to simple rev-cost GP when marginableRevenue is 0
  /* Gross profit and margin rest on the sales that have a sound cost: for North and
     Oceania those with a cost in Odoo, for South those without an impossible cost
     line. Revenue stays the full figure. */
  const costedBasis = onFYView();
  const gp       = trueMargin !== null ? (costedBasis ? (exactAmounts ? round2(gpRows) : Math.round(gpRows))
                                                      : (exactAmounts ? round2(totalRev * trueMargin) : Math.round(totalRev * trueMargin)))
                 : hasCost    ? totalRev - totalCost
                 : null;
  const gpMargin = trueMargin !== null ? Math.round(trueMargin * 1000) / 10 : null;

  // Three colours only: ink does the work, the orange accent is kept for the one figure that matters most.
  const accent  = INK;

  // ── Theme ────────────────────────────────────────────────────────────────
  // One light design for every company (no per-company colours, no dark mode). Values come from the design kit.
  const T = {
    bg:          COLORS.page,
    bgCard:      "var(--card)",
    bgHeader:    "rgba(245,244,239,0.9)",
    bgInput:     "#ffffff",
    bgTableHead: COLORS.card,
    bgModal:     COLORS.card,
    border:      "rgba(40,32,20,0.06)",
    borderFaint: COLORS.line,
    borderAccent:COLORS.line,
    text:        INK,
    textHead:    INK,
    textMuted:   COLORS.mute,
    textSub:     COLORS.mute,
    textRow:     INK,
    textLabel:   COLORS.mute,
    scrollTrack: "transparent",
    scrollThumb: inkA(0.18),
    shadow:      "0 10px 30px -22px rgba(40,32,20,0.25)",
    accent,
  };
  const comparablePrior = activeStore.id !== "luxe"
    || fyPayload(selectedYear)?.totals?.priorComparable !== false;
  const currComparableRev = curr.reduce((s, d, i) => s + (monthComparable(i) ? (d.revenue || 0) : 0), 0);
  const currComparableOrd = curr.reduce((s, d, i) => s + (monthComparable(i) ? (d.orders  || 0) : 0), 0);
  const revG   = (prevLoaded && comparablePrior) ? calcGrowth(currComparableRev, prevRev) : null;
  const ordG   = (prevLoaded && comparablePrior) ? calcGrowth(currComparableOrd, prevOrd) : null;
  const aovG   = (prevLoaded && comparablePrior) ? calcGrowth(avgAOV,   prevAOV) : null;

  // ── Contextual KPIs - update based on active view ─────────────────────────
  // Weekly tab → show selected month totals; Monthly/YoY → show period totals
  const weeklyDataCtx = view === "weekly"
    ? getWeekly().filter(w => w.month === weeklyMonth && w.week === selectedWeek)
    : [];
  // For monthly view: show the latest month with data, not YTD
  const latestMonthIdx    = curr.reduce((max, m, i) => m.revenue > 0 ? i : max, -1);
  const latestMonth       = latestMonthIdx >= 0 ? curr[latestMonthIdx] : null;
  const prevLatestMonth   = latestMonthIdx >= 0 ? (prev[latestMonthIdx] || null) : null;
  const prevLatestRev     = prevLatestMonth?.revenue    || 0;
  const prevLatestOrd     = prevLatestMonth?.orders     || 0;
  const prevLatestCost    = prevLatestMonth?.totalCost  || 0;
  const prevLatestHasCost = prevLatestMonth?.hasCostData || false;
  const prevLatestMargin  = prevLatestHasCost && prevLatestRev > 0
    ? marginPct1(prevLatestRev - prevLatestCost, prevLatestRev) : null;

  const kpiRev  = view === "weekly"  ? weeklyDataCtx.reduce((s, w) => s + (w.revenue   || 0), 0)
                : view === "monthly" ? (latestMonth?.revenue    || 0)
                : totalRev;
  const kpiOrd  = view === "weekly"  ? weeklyDataCtx.reduce((s, w) => s + (w.orders    || 0), 0)
                : view === "monthly" ? (latestMonth?.orders     || 0)
                : totalOrd;
  const kpiCost = view === "weekly"  ? weeklyDataCtx.reduce((s, w) => s + (w.totalCost || 0), 0)
                : view === "monthly" ? (latestMonth?.totalCost  || 0)
                : totalCost;
  const kpiHasCost = view === "weekly"  ? weeklyDataCtx.some(w => w.hasCostData)
                   : view === "monthly" ? (latestMonth?.hasCostData || false)
                   : hasCost;
  const kpiAOV     = kpiOrd ? (exactAmounts ? round2(kpiRev / kpiOrd) : Math.round(kpiRev / kpiOrd)) : 0;
  /* North and Oceania: margin and gross profit rest on the sales that have a cost in
     Odoo, and only those. Dropship and inter-company products carry no cost by
     design; counting their sales at a cost of zero would inflate the margin, and
     leaving the margin blank would hide a real one. Revenue stays the full figure
     and the card says what share of it the margin rests on. */
  const partCost = (() => {
    if (!costedBasis) return null;
    if (view === "monthly" && latestMonth?.marginableRevenue > 0 && latestMonth.totalCost != null)
      return { rev: latestMonth.marginableRevenue, cost: latestMonth.marginCost ?? latestMonth.totalCost, full: latestMonth.revenue };
    if (view === "weekly") {
      const ws = weeklyDataCtx.filter(w => w.marginableRevenue > 0 && w.marginCost != null);
      if (ws.length) return { rev: ws.reduce((a, w) => a + w.marginableRevenue, 0), cost: ws.reduce((a, w) => a + w.marginCost, 0),
                               full: ws.reduce((a, w) => a + (w.revenue || 0), 0) };
    }
    return null;
  })();
  const yearCostedOK = costedBasis && view === "yoy" && gp !== null;
  const kpiGP      = partCost
    ? (exactAmounts ? round2(partCost.rev - partCost.cost) : Math.round(partCost.rev - partCost.cost))
    : yearCostedOK ? gp
    : kpiHasCost
    ? (exactAmounts ? round2(kpiRev - kpiCost) : Math.round(kpiRev - kpiCost))
    : (view === "yoy" ? gp : null);
  const kpiGPMargin = partCost
    ? marginPct1(partCost.rev - partCost.cost, partCost.rev)
    : yearCostedOK ? gpMargin
    : kpiHasCost && kpiRev > 0
    ? marginPct1(kpiRev - kpiCost, kpiRev)
    : (view === "yoy" ? gpMargin : null);
  const kpiGrowth    = customOn ? (fyPayload(selectedYear)?.totals?.growthPct ?? null)
                     : view === "weekly" ? null : view === "monthly" ? (prevLoaded ? calcGrowth(kpiRev, prevLatestRev) : null) : revG;
  const kpiOrdGrowth = customOn ? (() => { const t = fyPayload(selectedYear)?.totals; return t?.priorComparable !== false && t?.prior?.invoices > 0 ? calcGrowth(t.invoices, t.prior.invoices) : null; })()
                     : view === "weekly" ? null : view === "monthly" ? (prevLoaded ? calcGrowth(kpiOrd, prevLatestOrd) : null) : ordG;
  const kpiAovGrowth = view === "weekly" ? null : view === "monthly" ? null : aovG;

  // Period-aware footer metrics
  const kpiNewC = view === "weekly"  ? null   // a week is too short to call a customer new
                : view === "monthly" ? (latestMonth?.newCustomers ?? null)
                : totalNewC;
  const kpiDisc = view === "weekly"  ? weeklyDataCtx.reduce((s, w) => s + (w.totalDiscounts || 0), 0)
                : view === "monthly" ? (latestMonth?.totalDiscounts || 0)
                : totalDisc;

  // Helper: compute week date range string, e.g. "1–7 Jun"
  const weekDateRange = (fyYear, month, week, short = false) => {
    // A financial year runs Apr to Mar, so Jan to Mar fall in the next calendar year.
    const year = onFY() && month < 3 ? fyYear + 1 : fyYear;
    const known = getWeekly().find(w => w.month === month && w.week === week && w.dateRange);
    let range = known?.dateRange;
    if (!range) {
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      const lead  = (new Date(year, month, 1).getDay() + 6) % 7;   // Monday-start weeks, clipped to the month
      const start = week === 1 ? 1 : (week - 1) * 7 - lead + 1;
      const end   = Math.min(week * 7 - lead, daysInMonth);
      if (start > daysInMonth) return "";
      range = `${start}–${end} ${MONTH_NAMES[month]}`;
    }
    return short ? range : `${range} ${year}`;
  };

  const prevCost       = prev.reduce((s, d) => s + (d.totalCost || 0), 0);
  const prevMarginCost = prev.reduce((s, d) => s + (d.marginCost ?? d.totalCost ?? 0), 0);
  const prevMargRev    = prev.reduce((s, d) => s + (d.marginableRevenue || 0), 0);
  const prevTrueMargin = prevMargRev > 0 ? (prevMargRev - prevMarginCost) / prevMargRev : null;
  const prevGPMargin   = prevTrueMargin !== null ? Math.round(prevTrueMargin * 1000) / 10 : null;
  // Absolute percentage-point change in margin vs prior year (e.g. "▲ 2%" = improved 2pp)
  /* Round the DIFFERENCE, not just its parts. Two one-decimal margins subtract
     to binary noise - 12.1 − 11.5 printed as "▲ 0.5999999999999996%" on the card. */
  const ppChange = (a, b) => Math.round((a - b) * 10) / 10;
  const kpiMarginGrowth = view === "yoy" && prevLoaded && kpiGPMargin !== null && prevGPMargin !== null
    ? ppChange(kpiGPMargin, prevGPMargin)
    : view === "monthly" && prevLoaded && kpiGPMargin !== null && prevLatestMargin !== null
    ? ppChange(kpiGPMargin, prevLatestMargin)
    : null;

  // YoY comparison text shown under each KPI card
  const prevHasCost = prev.some(d => d.hasCostData);
  const prevGP      = prevHasCost ? Math.round(prevRev - prevCost) : null;
  const yoyCompare  = view === "yoy" && prevLoaded;
  const cmpYear     = selectedYear - 1;
  const cmpRev      = yoyCompare ? `${cmpYear}: ${fmtK(prevRev, activeStore.currency)}` : null;
  const cmpOrd      = yoyCompare ? `${cmpYear}: ${prevOrd.toLocaleString()} orders` : null;
  // No explanatory notes on the cards (Pratham, 11 Nov 2026): how a figure is worked out lives in docs/, not on the page.
  const cmpMgn      = yoyCompare && prevGPMargin !== null ? `${cmpYear}: ${prevGPMargin}%` : null;
  const cmpGP       = yoyCompare && prevGP !== null ? `${cmpYear}: ${fmtK(prevGP, activeStore.currency)}` : null;

  // Gross profit has its own growth. It was previously showing revenue growth,
  // which moves differently whenever margin changes.
  const kpiGPGrowth = (view === "yoy" && prevLoaded && comparablePrior && kpiHasCost && prevGP !== null && prevGP !== 0)
    ? calcGrowth(kpiGP, prevGP) : null;

  const yoyData = yearsForStore.map(yr => {
    const d   = getMonthly(yr);
    const rev = d.reduce((s, x) => s + (x.revenue   || 0), 0);
    const ord = d.reduce((s, x) => s + (x.orders    || 0), 0);
    const cst = d.reduce((s, x) => s + (x.totalCost || 0), 0);
    /* North and Oceania: profit and margin on the sales that have a cost. */
    const mrev = costedBasis ? d.reduce((s, x) => s + (x.marginableRevenue || 0), 0) : rev;
    const mcst = costedBasis ? d.reduce((s, x) => s + (x.marginCost ?? x.totalCost ?? 0), 0) : cst;
    const gpY = d.some(x => x.hasCostData) ? mrev - mcst : null;
    return {
      year: String(yr), revenue: rev, orders: ord,
      aov: ord ? Math.round(rev / ord) : 0,
      grossProfit: gpY,
      margin: (gpY !== null && mrev > 0) ? marginPct1(gpY, mrev) : null,
      loaded: hasData(yr),
    };
  });

  const metrics = [
    { id: "revenue",   label: "Revenue" },
    { id: "orders",    label: "Orders" },
    { id: "marginPct", label: "Margin %" },
    { id: "grossProfit", label: "Gross Profit" },
  ];

  const renderStatus = (s) => {
    // At Risk is the accent; every other status is a quiet ink pill.
    return <Pill tone={s === "At Risk" ? "accent" : s === "Active" ? "dark" : "grey"}>{s}</Pill>;
  };

  const displayProducts   = (advancedData.curr?.topProducts   || []).slice(0, 20);
  const displayCustomers  = (advancedData.curr?.topCustomers  || []).map(c => ({ ...c, status: c.orderCount > 1 ? "Active" : "New" })).slice(0, 20);
  const displayCategories = (advancedData.curr?.topCategories || []).slice(0, 10);
  const displayAtRisk     = (advancedData.curr?.atRisk        || []).slice(0, 50);
  const displayCLV        = (advancedData.curr?.clv           || []).slice(0, 50);
  const displayDeclining  = (advancedData.curr?.declining     || []).slice(0, 30);

  const productColumns  = [
    { key: "name",    label: "Product",  color: T.text },
    { key: "qtySold", label: "Units",    align: "right" },
    { key: "revenue", label: "Revenue",  align: "right", color: COLORS.ink2, format: (v, c) => fmtK(v, c) },
    { key: "margin",  label: "Margin",   align: "right", format: v => v ? `${v}%` : "-" },
  ];
  const customerColumns = [
    { key: "name",       label: "Customer", color: T.text },
    { key: "orderCount", label: "Orders",   align: "center", color: COLORS.ink2 },
    { key: "revenue",    label: "Spend",    align: "right",  color: accent, format: (v, c) => fmtK(v, c) },
    { key: "status",     label: "Status",   align: "center", format: v => renderStatus(v) },
  ];
  const categoryColumns = [
    { key: "name",    label: "Category",   color: T.text },
    { key: "qty",     label: "Units Sold", align: "right" },
    { key: "revenue", label: "Revenue",    align: "right", color: accent,    format: (v, c) => fmtK(v, c) },
    { key: "margin",  label: "Margin",     align: "right", color: COLORS.ink2, format: v => v != null ? `${v}%` : "-" },
  ];
  const slowMovingColumns = [
    { key: "name",          label: "Product",      color: T.text },
    { key: "currentStock",  label: "Stock",        align: "right", color: accent },
    { key: "qtySold",       label: "Sold",         align: "right", color: COLORS.ink2 },
    { key: "lockedCapital", label: "Value Locked", align: "right", color: ORANGE, format: (v, c) => fmtK(v, c) },
  ];
  const churnedColumns = [
    { key: "name",          label: "Customer",   color: T.text },
    { key: "lastOrderDate", label: "Last Order", align: "right", format: v => v ? new Date(v).toLocaleDateString() : "-" },
    { key: "revenue",       label: "Spend",      align: "right", color: accent, format: (v, c) => fmtK(v, c) },
    { key: "status",        label: "Risk",       align: "center", format: () => <Pill tone="accent">LAPSED</Pill> },
  ];
  const atRiskColumns = [
    { key: "name",          label: "Customer",    color: T.text },
    { key: "daysSince",     label: "Days Silent", align: "center", format: v => <span style={{ color: v >= 75 ? ORANGE : INK, fontWeight: 500 }}>{v}d</span> },
    { key: "lastOrderDate", label: "Last Order",  align: "right",  format: v => v ? new Date(v).toLocaleDateString() : "-" },
    { key: "revenue",       label: "Lifetime $",  align: "right",  color: accent, format: (v, c) => fmtK(v, c) },
    { key: "orderCount",    label: "Orders",      align: "center", color: COLORS.ink2 },
  ];
  const clvColumns = [
    { key: "name",            label: "Customer",    color: T.text },
    { key: "lifetimeRevenue", label: "Lifetime $",  align: "right", color: accent, format: (v, c) => fmtK(v, c) },
    { key: "totalOrders",     label: "Orders",      align: "center", color: COLORS.ink2 },
    { key: "avgOrderValue",   label: "Avg Order",   align: "right",  color: COLORS.ink2, format: (v, c) => fmtK(v, c) },
    { key: "firstOrderDate",  label: "First Order", align: "right",  format: v => v ? new Date(v).toLocaleDateString() : "-" },
  ];
  const decliningColumns = [
    { key: "name",        label: "Product",    color: T.text },
    { key: "revenue",     label: "This Period", align: "right", color: INK,  format: (v, c) => fmtK(v, c) },
    { key: "prevRevenue", label: "Prior Year",  align: "right", color: COLORS.mute,  format: (v, c) => fmtK(v, c) },
    { key: "change",      label: "Change",      align: "center", format: v => v !== null ? <Delta value={-Math.abs(v)} /> : "-" },
    { key: "qtySold",     label: "Units Now",   align: "right", color: COLORS.ink2 },
    { key: "prevQtySold", label: "Units Prev",  align: "right", color: COLORS.mute },
  ];
  const salespersonColumns = [
    { key: "name",    label: "Sales Rep",    color: T.text },
    { key: "orders",  label: "Orders",       align: "right", color: COLORS.ink2 },
    { key: "revenue", label: "Revenue",      align: "right", color: accent, format: (v, c) => fmtK(Math.round(v), c) },
    { key: "aov",     label: "Avg Order",    align: "right", color: COLORS.ink2, format: (v, c) => fmtK(v, c) },
  ];
  const salespeople = salespeopleData.map(s => ({
    ...s,
    revenue: Math.round(s.revenue),
    aov: s.orders > 0 ? Math.round(s.revenue / s.orders) : 0,
  }));

  // FIX 4: was [activeStore, selectedYear] - object reference caused potential infinite loop
  useEffect(() => {
    setAnimated(false);
    setTimeout(() => setAnimated(true), 50);
    // Sync salespeople for newly selected year if already cached
    const cached = cacheRef.current[activeStore.id + ":" + selectedYear];
    if (cached?.salespeople) setSalespeopleData(cached.salespeople);
    else setSalespeopleData([]);
  }, [activeStore.id, selectedYear]);

  /* One pill bar for every per-company table group below. Sales by Rep comes
     first, Debtors always last, Credits sits right before it - the order Pratham
     asked for. Switching company/channel resets to "reps" so nobody lands on an
     empty tab for a group the new company doesn't have. */
  const ADV_TABS = [
    { id: "reps",       label: "Sales by Rep",        icon: "user" },
    { id: "products",   label: "Top Categories & Products", icon: "award" },
    { id: "movers",     label: "Fast & Slow Movers",  icon: "zap" },
    { id: "customers",  label: "Customers",           icon: "trophy" },
    { id: "credits",    label: "Credit Notes",        icon: "receipt" },
    { id: "debtors",    label: "Debtors",             icon: "receipt" },
  ];
  /* Categories & Products, Fast & Slow Movers and Customers are ONE page now (Analytics),
     each group under its own heading, so there are no sub-tabs. A group shows only if
     this login may open it. */
  const isAnalytics = ["products", "movers", "customers"].includes(section);
  const showGroup = (id) => isAnalytics
    ? (me?.sections || [{ id: section }]).some(x => x.id === id)
    : advTab === id;
  const renderAdvTabs = () => {
    if (isAnalytics) return null;
    const subs = (me?.sections || []).filter(x => ["products", "movers", "customers"].includes(x.id));
    if (!["products", "movers", "customers"].includes(section) || subs.length < 2) return null;
    return (
      <div className={ui.seg} style={{ marginBottom: 20, marginTop: 4 }}>
        {subs.map(t => (
          <Link key={t.id} href={t.path} className={st.segLink} data-on={section === t.id ? "1" : undefined}>{t.label}</Link>
        ))}
      </div>
    );
  };
  /* Top Categories/Products can only ever see sales each company invoiced
     directly - a sale from North to South (or any other inter-company trade)
     shows up as revenue on the SELLING company's side and a cost on the buyer's,
     never as a line in either company's product/category breakdown. So these two
     tables are real for what each company sold, but cannot be added across
     companies to get a true group total - same caveat as the figures used to
     carry at the top of the page. */
  const INTERCOMPANY_NOTE = "Doesn't include inter-company sales (e.g. North selling to South or Oceania) for products or categories: those trades aren't visible to either side's product breakdown, so this can't be measured here.";

  // An icon for each page in the navigation, chosen to fit its title.
  const SECTION_ICONS = { overview: "grid", analytics: "bars", credits: "receipt", debtors: "wallet", chat: "sparkle", repusage: "users", socialweb: "megaphone", command: "compass", reps: "users", products: "award", movers: "zap", customers: "trophy" };
  const money0 = (v) => (exactAmounts ? fmtExact(v, activeStore.currency) : fmtK(v, activeStore.currency));
  // Chart axes and grid in the design kit's ink.
  const axisTick = { fontSize: 12.5, fill: COLORS.mute };
  // Sales by month for the year on screen, months that have not started left out. The latest month is the accent.
  const monthBars = momData.filter(r => !r.notStarted).map(r => ({ label: r.month, value: r.revenue || 0 }));
  /* The month still running is drawn as part of a month ("to 26"), so it is not read as a drop. The year payload says
     whether a month is complete and how far it runs; the calendar-year companies use today's NZ date. */
  const lastMonthRow = [...momData].reverse().find(r => !r.notStarted);
  const nzTodayIso = new Date().toLocaleDateString("en-CA", { timeZone: "Pacific/Auckland" });
  const barsPartialTo = !lastMonthRow ? null
    : onFYView() ? (lastMonthRow.complete === false ? (lastMonthRow.through || nzTodayIso) : null)
    : (isCurrentYear && momData.indexOf(lastMonthRow) === nowRef.getMonth() ? nzTodayIso : null);
  const partialMonth = barsPartialTo ? { label: lastMonthRow.month, to: barsPartialTo } : null;
  const initials = (me?.label || "").split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase() || "W";

  return (
    <div className={st.page} style={{ background: T.bg, color: T.text }}>
      <style>{`
        *{box-sizing:border-box;margin:0;padding:0}
        ::-webkit-scrollbar{width:6px;height:6px}::-webkit-scrollbar-track{background:${T.scrollTrack}}::-webkit-scrollbar-thumb{background:${T.scrollThumb};border-radius:6px}
        input[type="date"]::-webkit-calendar-picker-indicator { filter: opacity(0.5); }
      `}</style>

      <div className={st.shell}>
      {/* TOP BAR: logo, the pages this department may open, who is signed in */}
      {(() => {
        // Carry the chosen company, year and view to the other pages, so switching tabs on South stays on South.
        const keep = new URLSearchParams({
          store: activeStore.id, fy: String(selectedYear), view, tab: channelTab,
          m: String(weeklyMonth), w: String(selectedWeek),
        }).toString();
        const SUB = { products: "Categories & Products", movers: "Fast & Slow Movers", customers: "Customers" };
        return <SiteNav current={section} me={me} keep={keep} trail={SUB[section] ? [{ label: SUB[section] }] : []} />;
      })()}

      {/* HEADING: company, source and freshness, then the company and year switchers */}
      <div className={st.head} id="main" tabIndex={-1}>
        <div style={{ minWidth: 0 }}>
          <h1 className={st.title}>{activeStore.name}</h1>
          <div className={st.sub}>
            <span className={st.liveDot} />
            <span>{activeStore.id === "worthy" ? "Live Odoo" : activeStore.id === "luxe" ? "Live Ostendo" : "Live Odoo"} · Performance Overview</span>
            {anyLoading && <Pill>Loading</Pill>}
            {(() => {
              /* Say when these figures were read, so nobody has to wonder how fresh they are. */
              const fp = fyPayload(selectedYear), at = fp?.generatedAt;
              if (!at || activeStore.id === "luxe" || section !== "overview") return null;
              const t = new Date(at).toLocaleTimeString("en-NZ", { timeZone: "Pacific/Auckland", hour: "numeric", minute: "2-digit" });
              // The last good copy (Odoo slow) or figures over 15 minutes old: say so in the accent, one line.
              // Only figures over 15 minutes old are flagged: the copy refreshes every 5 minutes, so a younger one is normal.
              const ageMin = clock > 0 ? (clock - Date.parse(at)) / 60000 : 0;
              const old = ageMin > 15;
              return (<>
                <span>· Odoo figures as of {t} NZ, refreshed every few minutes</span>
                {old && <span style={{ color: "var(--orange)", fontWeight: 500, display: "inline-flex", alignItems: "center", gap: 5 }}><Icon n="hourglass" size={12} />{fp.stale ? `Odoo is slow: figures from ${t}, updating` : `Figures from ${t}, over 15 minutes old, updating`}</span>}
              </>);
            })()}
          </div>
        </div>
        <div className={st.actions}>
          <div className={ui.seg} role="group" aria-label="Company">
            {STORES.map(s => <StorePill key={s.id} store={s} active={activeStore.id === s.id} onClick={() => setActiveStore(s)} />)}
          </div>
          <div className={ui.seg} role="group" aria-label="Year">
            {yearsForStore.map(y => {
              const loaded   = hasData(y);
              const fetching = isLoading(y);
              return (
                <button type="button" key={y} onClick={() => setSelectedYear(y)} className={selectedYear === y ? ui.segOn : ""} style={{ position: "relative" }}>
                  {onFYView() ? `FY${String(y).slice(2)}` : y}
                  {fetching && <span className={st.yearDot} style={{ background: ORANGE }} />}
                  {!fetching && loaded && selectedYear !== y && (activeStore.id === "worthy" || activeStore.id === "luxe") && <span className={st.yearDot} style={{ background: INK, opacity: 0.35 }} />}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* CHANNEL SUB-TABS, shown for Worthy North (Odoo/Online/POS) and Nova (Odoo only) */}
      {(activeStore.id === "worthy" || activeStore.id === "nova") && (
        <div className={st.channelRow}>
          {/* North is Odoo sales only for now: the Online and POS channels are not shown. Their
              code is still here, switched off, in case they come back. */}
          {/* One channel only (Odoo), so no button to press: just say where the figures come from */}
          <span className={st.channelNote}>
            {channelTab === "odoo"   ? "Odoo ERP invoices · ex-tax revenue" :
             channelTab === "pos"    ? "In-person POS orders only" :
                                      "Online store orders · includes sessions & conv rate"}
          </span>
        </div>
      )}

      <div className={st.body}>
        {section === "overview" && (<>
        {/* View toggle, and the period the headline figures cover */}
        <div className={st.viewRow}>
          <div className={ui.seg} role="group" aria-label="View">
            {[["monthly","Month","calendar"],["weekly","Week","bars"],["yoy","Financial year","chart"],["custom","Chosen dates","calendar"]].map(([v, lbl, ic]) => {
              const on = v === "custom" ? (view === "yoy" && pickOpen) : v === "yoy" ? (view === "yoy" && !pickOpen) : view === v;
              return (
                <button type="button" key={v} aria-pressed={on} className={on ? ui.segOn : ""} style={{ display: "inline-flex", alignItems: "center", gap: 7 }}
                  onClick={() => {
                    if (v === "custom") {
                      setView("yoy"); setPickOpen(true);
                      if (!customOn) { const t = _todayStr; setPeriod({ from: `${t.slice(0, 7)}-01`, to: t }); }
                    } else { setView(v); setPickOpen(false); setPeriod({ from: "", to: "" }); }
                  }}><Icon n={ic} size={15} />{lbl}</button>
              );
            })}
          </div>
          {view === "yoy" && pickOpen && (() => {
            const t = _todayStr; const y = Number(t.slice(0, 4)), mo = Number(t.slice(5, 7));
            const ym = (yy, mm) => `${yy}-${String(mm).padStart(2, "0")}`;
            const monthEnd = (yy, mm) => new Date(Date.UTC(yy, mm, 0)).toISOString().slice(0, 10);
            const lm = mo === 1 ? [y - 1, 12] : [y, mo - 1];
            const fyStart = mo >= 4 ? y : y - 1;
            const three = mo > 2 ? [y, mo - 2] : [y - 1, mo + 10];
            const presets = [
              ["This month", `${ym(y, mo)}-01`, t],
              ["Last month", `${ym(lm[0], lm[1])}-01`, monthEnd(lm[0], lm[1])],
              ["Last 3 months", `${ym(three[0], three[1])}-01`, t],
              ["Financial year to date", `${fyStart}-04-01`, t],
              ["Last financial year", `${fyStart - 1}-04-01`, `${fyStart}-03-31`],
            ];
            return (
              <div className={st.rangeBar} role="group" aria-label="Chosen dates">
                <label className={st.rangeField}><span>From</span><input type="date" value={period.from} max={period.to || t} onChange={(e) => setPeriod((p) => ({ ...p, from: e.target.value }))} /></label>
                <label className={st.rangeField}><span>To</span><input type="date" value={period.to} min={period.from || undefined} max={t} onChange={(e) => setPeriod((p) => ({ ...p, to: e.target.value }))} /></label>
                <div className={st.presets}>
                  {presets.map(([lbl, f, to]) => (
                    <button type="button" key={lbl} aria-pressed={period.from === f && period.to === to} className={period.from === f && period.to === to ? st.presetOn : ""} onClick={() => setPeriod({ from: f, to })}>{lbl}</button>
                  ))}
                </div>
              </div>
            );
          })()}
          {view === "weekly" ? (() => {
            const allMonthWeeks = getWeekly().filter(w => w.month === weeklyMonth && w.revenue > 0);
            const weekNums = [...new Set(allMonthWeeks.map(w => w.week))].sort((a,b) => a-b);
            const periodLabel = `Week ${selectedWeek} · ${weekDateRange(selectedYear, weeklyMonth, selectedWeek)}`;
            return (
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <RangeTag text={periodLabel} />
                {weekNums.length > 0 && (
                  <div className={ui.seg}>
                    {weekNums.map(w => (
                      <button type="button" key={w} onClick={() => setSelectedWeek(w)} className={selectedWeek === w ? ui.segOn : ""} style={{ padding: "6px 11px" }}>W{w}</button>
                    ))}
                  </div>
                )}
              </div>
            );
          })() : (
            <RangeTag text={
              customOn ? `${fmtDay(period.from)} to ${fmtDay(fyPayload(selectedYear)?.range?.end || period.to)} vs the same dates a year earlier`
              : view === "yoy" && onFYView() && activeStore.id !== "luxe" && fyPayload(selectedYear)?.range && !fyPayload(selectedYear).range.complete
                ? `FY${String(selectedYear).slice(2)} · 1 Apr to ${fmtDay(fyPayload(selectedYear).range.end)} vs same period FY${String(selectedYear - 1).slice(2)}`
              : view === "yoy" ? `${selectedYear} vs ${selectedYear - 1} · full year`
             : view === "monthly" && latestMonth ? `${latestMonth.month} ${activeStore.id === "luxe" && latestMonthIdx >= 9 ? selectedYear + 1 : selectedYear}`
             : `${selectedYear} · year to date`} />
          )}
        </div>

        {/* Anything the source system could not give us, said plainly, so an
            empty table is never mistaken for a quiet month. */}
        {onFYView() && (fyPayload(selectedYear)?.problems || []).length > 0 && (
          <Notice tone="warn" style={{ marginBottom: 14 }}>
            <strong style={{ fontWeight: 500 }}>Some tables below are empty because Odoo could not return the data.</strong>{" "}
            {fyPayload(selectedYear).problems.some(p => /product/i.test(p))
              ? <>Odoo cannot build a display name for at least one product in this company (a variant with an
                 incomplete attribute) and the error stops the whole product query. Top Products and Top Categories
                 stay empty until that product record is corrected. Sales, customers and every figure above are
                 unaffected.</>
              : fyPayload(selectedYear).problems.join(' ')}
          </Notice>
        )}

        {activeStore.id !== "luxe" && prevLoaded && (() => {
          if (onFYView()) return null;   // financial-year companies explain themselves below
          const lastCmp = [...Array(12).keys()].filter(monthComparable).pop();
          if (lastCmp === undefined || lastCmp === 11) return null;
          return (
            <Notice icon="calendar" style={{ marginBottom: 14 }}>
              <strong style={{ fontWeight: 500 }}>{activeStore.name} · {selectedYear}</strong>{" "}
              reports a calendar year (January to December).{" "}
              &ldquo;Vs last year&rdquo; covers <strong style={{ fontWeight: 500 }}>{MONTH_NAMES[0]} to {MONTH_NAMES[lastCmp]}</strong> on both sides, complete
              months only. {isCurrentYear && `${MONTH_NAMES[nowRef.getMonth()]} is still in progress, so it is shown in the tables but left out of the year-on-year figure.`}
            </Notice>
          );
        })()}

        {onFY() && cacheRef.current[fyKey(activeStore.id, selectedYear)]?.failed && (
          /* A failed read must say so. Without this the cards drew NZ$0.00 and a dash,
             which reads as a quiet month, not as "the figures did not load". */
          <Notice tone="warn" role="alert" style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <span><strong style={{ fontWeight: 500 }}>These figures did not load</strong>: the zeros below are not real. Odoo was too slow to answer.</span>
              <button type="button" onClick={() => { delete cacheRef.current[fyKey(activeStore.id, selectedYear)]; fetchFYFor(activeStore.id, selectedYear, { fresh: true }); }}
                className={`${ui.btn} ${ui.btnSmall} ${ui.btnDark}`}><Icon n="refresh" size={13} />Try again</button>
            </div>
          </Notice>
        )}

        {/* 1. HEADLINE FIGURES */}
        <section className={`${ui.kpis} ${isMgmt ? "" : st.kpis2}`}>
          <KPICard label="Total Revenue"  value={curLoading && !kpiRev ? null : kpiRev} growth={kpiGrowth}    icon="dollar"  sub="currency" animated={animated} currency={activeStore.currency} exact={exactAmounts} compareText={cmpRev} />
          <KPICard label="Total Orders"   value={curLoading && !kpiOrd ? null : kpiOrd} growth={kpiOrdGrowth} icon="bag"     sub="count"    animated={animated} currency={activeStore.currency} compareText={cmpOrd} />
          {isMgmt && <KPICard label="Gross Margin %" value={kpiGPMargin} growth={kpiMarginGrowth} growthUnit=" pts" icon="percent" sub="pct" animated={animated} currency={activeStore.currency} compareText={cmpMgn} />}
          {isMgmt && <KPICard label={(kpiHasCost || partCost) && kpiGPMargin !== null ? `Gross Profit · ${kpiGPMargin}% margin` : "Gross Profit"} value={(kpiHasCost || partCost) ? kpiGP : null} growth={kpiGPGrowth} icon="wallet" sub="currency" animated={animated} currency={activeStore.currency} exact={exactAmounts} compareText={cmpGP} />}
        </section>

        {/* 2. HOW THE HEADLINE FIGURES RELATE, and the year by month */}
        <div className={ui.grid} style={{ marginBottom: 14 }}>
          <Card>
            <CardHead icon="bars" title={customOn ? "Sales by month, chosen dates" : `Sales by month, ${onFYView() ? `FY${String(selectedYear).slice(2)}` : selectedYear}`}><RangeTag text={yearRange()} /></CardHead>
            {monthBars.length > 0 ? <MonthBars rows={monthBars} fmt={moneyShort} partialTo={barsPartialTo} /> : <div className={ui.empty}>{anyLoading ? "Loading" : "No sales recorded yet"}</div>}
          </Card>
          <Card className={st.chainFit}>
            {/* Not a repeat of the headline strip: how the margin moved month by month (management), or orders by month */}
            <CardHead icon={isMgmt ? "percent" : "bag"} title={isMgmt ? "Margin by month" : "Orders by month"} />
            {(() => {
              const ms = (fyPayload(selectedYear)?.months || []).filter((m) => m.started);
              if (!ms.length) return <div className={ui.empty}>{anyLoading ? "Loading" : "No sales yet"}</div>;
              const rows = isMgmt ? ms.filter((m) => m.marginPct != null).map((m) => ({ name: m.label, value: m.marginPct, extra: m.grossProfit }))
                                  : ms.map((m) => ({ name: m.label, value: m.invoices || 0 }));
              const max = Math.max(...rows.map((r) => r.value), 1), avg = rows.reduce((t, r) => t + r.value, 0) / (rows.length || 1);
              return (
                <div className={st.marginList}>
                  {rows.map((r) => (
                    <div key={r.name} className={st.marginRow}>
                      <span className={st.marginName}>{r.name}</span>
                      <div className={st.marginTrack}><i style={{ width: `${Math.max(2, (r.value / max) * 100)}%`, background: isMgmt && r.value < avg - 1 ? "var(--orange)" : "var(--ink)" }} /></div>
                      <span className={st.marginVal}>{isMgmt ? `${r.value.toFixed(1)}%` : r.value.toLocaleString("en-NZ")}</span>
                    </div>
                  ))}
                </div>
              );
            })()}
          </Card>
        </div>

        {isMgmt && ((activeStore.id === "worthy" && channelTab === "odoo") || activeStore.id === "nova") && onFYView() && (() => {
          const cur = fyPayload(selectedYear);
          if (!cur?.sisterSales) return null;
          const done = (cur.weeks || []).filter((w) => w.sisters);
          const picked = view === "weekly"
            ? done.find((w) => MONTH_IDX[w.monthLabel] === weeklyMonth && w.week === selectedWeek)
            : [...done].reverse().find((w) => w.complete);
          // The week's Worthy Products cost comes from the weekly route; load that month's weeks if they are not here yet.
          const wkData = picked ? cacheRef.current[odooWeekKey(activeStore.id, picked.monthKey)] : null;
          if (picked && !wkData) setTimeout(() => fetchOdooWeeks(activeStore.id, picked.monthKey), 0);
          const wk = wkData && !wkData.failed ? (wkData.rows || []).filter((r) => r.week === picked.week) : [];
          const wkCost = wk.reduce((t, r) => t + (r.cost || 0), 0);
          const wkGp = wk.reduce((t, r) => t + (r.grossProfit || 0), 0);
          const weekWp = wk.length && wkGp + wkCost > 0
            ? { margin: Math.round((wkGp / (wkGp + wkCost)) * 10000) / 100, cost: wkCost, costed: wkGp + wkCost } : null;
          return <SisterSalesCard cur={cur} week={picked} weekWp={weekWp} currency={activeStore.currency}
            companyName={activeStore.id === "nova" ? "Worthy Oceania" : "Worthy Products"} />;
        })()}

        {onFYView() && view !== "weekly" && (
          <ForecastCard cur={fyPayload(selectedYear)} prior={fyPayload(selectedYear - 1)} currency={activeStore.currency}
            fyLabel={`FY${String(selectedYear).slice(2)}`} />
        )}

        {view === "monthly" ? (
          <>
            {/* Trend chart: this year in ink, last year faint and dashed */}
            <Card style={{ marginBottom: 14 }}>
              <CardHead icon="chart" title={`Monthly ${metrics.find(m => m.id === activeMetric)?.label} · ${onFYView() ? `FY${String(selectedYear).slice(2)}` : selectedYear}`}>
                <RangeTag text={yearRange()} />
              </CardHead>
              <div className={ui.seg} role="group" aria-label="Measure" style={{ marginBottom: 14 }}>
                {metrics.map(m => (
                  <button type="button" key={m.id} onClick={() => setActiveMetric(m.id)} className={activeMetric === m.id ? ui.segOn : ""}>{m.label}</button>
                ))}
              </div>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 13.5, color: COLORS.mute, margin: "-4px 0 14px" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 20, height: 3, borderRadius: 2, background: INK, display: "inline-block" }} />{selectedYear}</span>
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 20, height: 0, borderTop: `2px dashed ${inkA(0.35)}`, display: "inline-block" }} />{prevLoaded ? `${selectedYear - 1}` : `Loading ${selectedYear - 1}…`}</span>
              </div>
              <ResponsiveContainer width="100%" height={300}>
                <ComposedChart data={momData} margin={{ top: 5, right: 10, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={COLORS.line} vertical={false} />
                  <XAxis dataKey="month" interval={0} tick={axisTick} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11.5, fill: COLORS.mute }} axisLine={false} tickLine={false}
                    tickFormatter={activeMetric === "revenue" || activeMetric === "grossProfit" ? v => `$${(v/1000).toFixed(0)}k` : activeMetric === "marginPct" ? v => `${v}%` : v => v >= 1000 ? `${(v/1000).toFixed(1)}k` : v} />
                  <Tooltip content={<CustomTooltip currency={activeStore.currency} />} cursor={{ stroke: inkA(0.15) }} />
                  <Area type="monotone" dataKey={activeMetric} name={metrics.find(m => m.id === activeMetric)?.label} stroke={INK} strokeWidth={2} fill={INK} fillOpacity={0.05} dot={false} connectNulls={false} activeDot={{ r: 5, fill: ORANGE, stroke: "#fff", strokeWidth: 2 }} />
                  <Line type="monotone" dataKey={activeMetric === "revenue" ? "prevRevenue" : activeMetric === "orders" ? "prevOrders" : activeMetric === "marginPct" ? "prevMarginPct" : activeMetric} name={`${selectedYear - 1}`} stroke={inkA(0.35)} strokeWidth={1.5} strokeDasharray="4 4" dot={false} connectNulls={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </Card>

            {/* Monthly table */}
            <Card style={{ marginBottom: 14 }}>
              <CardHead icon="calendar" title="Monthly Breakdown"><RangeTag text={yearRange()} /></CardHead>
              <div style={{ fontSize: 13.5, color: COLORS.mute, margin: "-6px 0 14px", display: "flex", alignItems: "center", gap: 5 }}>
                {activeStore.id === "luxe"
                  ? <><Icon n="sparkle" size={12} />Sales before rebates, as finance report them · cost as invoiced · {activeStore.currency}</>
                  : onFYView()
                    ? <><Icon n="sparkle" size={12} />{fyPayload(selectedYear)?.costBasis || "cost from Odoo"} · {activeStore.currency}</>
                    : <>{hasCost ? <><Icon n="sparkle" size={12} />Real cost from Shopify</> : "Add read_inventory scope for margin"} · {activeStore.currency}</>}
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                  <thead>
                    <tr>
                      {/* Year views: Sales with a cost, minus Cost (the cost of those sales), equals Gross Profit on every row and in
                          the total, so the table adds up for whoever reads it. Sales without a sound cost are the gap between Revenue
                          and Sales with a cost (26 Nov 2026). */}
                      {(onFYView() ? ["Month","Revenue","Bank Target","Sales with a cost","Cost","Gross Profit","Margin","Orders","AOV","New Cust.","Returns","YoY"]
                                   : ["Month","Revenue","Bank Target","Cost","Gross Profit","Margin","Orders","AOV","New Cust.","Returns","YoY"]).map(h => (
                        <th key={h} style={thStyle("left")}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {momData.map((row, i) => {
                      const has = row.revenue > 0;
                      const monthKey = row.key || `${selectedYear}-${String(i + 1).padStart(2, "0")}`;
                      const target = bankTargetFor(activeStore.id, monthKey);
                      const vsTarget = (target && has) ? Math.round(((row.revenue - target) / target) * 1000) / 10 : null;
                      const c = { ...tdStyle, padding: "9px 10px" };
                      const none = <span style={{ color: COLORS.mute }}>-</span>;
                      return (
                        <tr key={i} style={{ background: hoveredMonth === i ? inkA(0.035) : "transparent", transition: "background 0.15s" }}
                          onMouseEnter={() => setHoveredMonth(i)} onMouseLeave={() => setHoveredMonth(null)}>
                          <td style={{ ...c, color: COLORS.ink2, fontWeight: 500 }}>{row.month}</td>
                          <td style={{ ...c, fontWeight: 500 }}>{has ? (exactAmounts ? fmtExact(row.revenue, activeStore.currency) : fmtK(row.revenue, activeStore.currency)) : none}</td>
                          <td style={{ ...c, color: COLORS.ink2 }}>
                            {target ? (
                              <>
                                <div>{exactAmounts ? fmtExact(target, activeStore.currency) : fmtK(target, activeStore.currency)}</div>
                                {vsTarget !== null && <div style={{ marginTop: 2 }}><Delta value={vsTarget} /></div>}
                              </>
                            ) : none}
                          </td>
                          {onFYView() && <td style={{ ...c, color: COLORS.ink2 }}>{has && (row.marginableRevenue || 0) > 0 ? (exactAmounts ? fmtExact(row.marginableRevenue, activeStore.currency) : fmtK(row.marginableRevenue, activeStore.currency)) : none}</td>}
                          <td style={{ ...c, color: COLORS.ink2 }}>{(() => { const cv = onFYView() ? (row.marginCost ?? row.totalCost) : row.totalCost; return has && cv != null && (!onFYView() || (row.marginableRevenue || 0) > 0) ? (exactAmounts ? fmtExact(cv, activeStore.currency) : fmtK(cv, activeStore.currency)) : none; })()}</td>
                          <td style={c}>{has && row.grossProfit != null ? (exactAmounts ? fmtExact(row.grossProfit, activeStore.currency) : fmtK(row.grossProfit, activeStore.currency)) : none}</td>
                          <td style={c}>{has ? <MarginBar value={row.marginPct} /> : none}</td>
                          <td style={{ ...c, color: COLORS.ink2 }}>{has ? row.orders : none}</td>
                          <td style={{ ...c, color: COLORS.ink2 }}>{has ? (exactAmounts ? fmtExact(row.aov, activeStore.currency) : fmtK(row.aov, activeStore.currency)) : none}</td>
                          <td style={{ ...c, color: COLORS.ink2 }}>{row.newCustomers != null ? row.newCustomers.toLocaleString() : none}</td>
                          <td style={{ ...c, color: COLORS.ink2 }}>{row.returns > 0 ? row.returns : none}</td>
                          <td style={c}><GrowthBadge value={row.momGrowth} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td style={{ ...footStyle("left"), fontSize: 12.5, color: COLORS.mute, letterSpacing: "0.04em" }}>TOTAL</td>
                      <td style={footStyle("left")}>{exactAmounts ? fmtExact(totalRev, activeStore.currency) : fmtK(totalRev, activeStore.currency)}</td>
                      <td style={{ ...footStyle("left"), color: COLORS.ink2 }}>
                        {(() => {
                          const totalTarget = momData.reduce((s, row, i) => {
                            const mk = row.key || `${selectedYear}-${String(i + 1).padStart(2, "0")}`;
                            return s + (bankTargetFor(activeStore.id, mk) || 0);
                          }, 0);
                          return totalTarget > 0 ? (exactAmounts ? fmtExact(totalTarget, activeStore.currency) : fmtK(totalTarget, activeStore.currency)) : "-";
                        })()}
                      </td>
                      {onFYView() && <td style={{ ...footStyle("left"), color: COLORS.ink2 }}>{totalMargRev > 0 ? (exactAmounts ? fmtExact(totalMargRev, activeStore.currency) : fmtK(totalMargRev, activeStore.currency)) : "-"}</td>}
                      <td style={{ ...footStyle("left"), color: COLORS.ink2 }}>{hasCost ? (() => { const cv = onFYView() ? totalMarginCost : totalCost; return exactAmounts ? fmtExact(cv, activeStore.currency) : fmtK(cv, activeStore.currency); })() : "-"}</td>
                      <td style={footStyle("left")}>{gp !== null ? (exactAmounts ? fmtExact(gp, activeStore.currency) : fmtK(gp, activeStore.currency)) : "-"}</td>
                      <td style={footStyle("left")}><MarginBar value={gpMargin} /></td>
                      <td style={footStyle("left")}>{totalOrd}</td>
                      <td style={footStyle("left")}>{exactAmounts ? fmtExact(avgAOV, activeStore.currency) : fmtK(avgAOV, activeStore.currency)}</td>
                      <td style={footStyle("left")}>{totalNewC || "-"}</td>
                      <td style={footStyle("left")}>{totalRet || "-"}</td>
                      <td style={footStyle("left")}><GrowthBadge value={revG} /></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </Card>
          </>
        ) : view === "weekly" ? (
          /* WEEKLY VIEW */
          (() => {
            const allWeekly  = getWeekly();
            const weeklyData = allWeekly.filter(w => w.month === weeklyMonth);
            const wTotalRev  = weeklyData.reduce((s, w) => s + w.revenue, 0);
            const wTotalOrd  = weeklyData.reduce((s, w) => s + w.orders, 0);
            const wTotalDisc = weeklyData.reduce((s, w) => s + (w.totalDiscounts || 0), 0);
            const wTotalNewC = weeklyData.reduce((s, w) => s + (w.newCustomers || 0), 0);
            const wAvgAOV    = wTotalOrd > 0 ? Math.round(wTotalRev / wTotalOrd) : 0;
            const wHasCost   = weeklyData.some(w => w.hasCostData);
            const wTotalCost = weeklyData.reduce((s, w) => s + (w.totalCost || 0), 0);
            /* Total the same figures the rows show (their gross profit and the revenue it was
               measured on), so the month total always agrees with the weeks above it. */
            const wCosted    = weeklyData.filter(w => w.grossProfit != null);
            const wTotalGP   = wHasCost ? (wCosted.length ? wCosted.reduce((s, w) => s + w.grossProfit, 0) : wTotalRev - wTotalCost) : null;
            const wMarginRev = wCosted.length ? wCosted.reduce((s, w) => s + (w.marginableRevenue ?? w.revenue), 0) : wTotalRev;
            const wMarginPct = wHasCost && wMarginRev > 0 ? marginPct1(wTotalGP, wMarginRev) : null;
            return (
              <>
                {/* Month selector */}
                <div className={ui.seg} style={{ marginBottom: 14 }}>
                  {MONTH_NAMES.map((mn, mi) => (
                    <button type="button" key={mn} onClick={() => { setWeeklyMonth(mi); setSelectedWeek(mi === new Date().getMonth() ? weekOfMonth(new Date()) : 1); }}
                      className={weeklyMonth === mi ? ui.segOn : ""}>{mn}</button>
                  ))}
                </div>

                {/* Weekly bar chart: the week on the headline figures is the accent */}
                <Card style={{ marginBottom: 14 }}>
                  <CardHead icon="bars" title={`Weekly Revenue · ${MONTH_NAMES[weeklyMonth]} ${selectedYear}`}>
                    <RangeTag text={monthRange()} />
                  </CardHead>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, flexWrap: "wrap", margin: "-6px 0 12px" }}>
                    <div style={{ fontSize: 13.5, color: COLORS.mute }}>Week-by-week sales breakdown</div>
                    {wTotalRev > 0 && (
                      <div style={{ textAlign: "right" }}>
                        <div className={ui.statNum} style={{ fontSize: 24 }}>{fmtK(wTotalRev, activeStore.currency)}</div>
                        <div className={ui.statLabel}>Month Total</div>
                      </div>
                    )}
                  </div>
                  {weeklyData.length > 0 && wTotalRev > 0 ? (
                    <ResponsiveContainer width="100%" height={260}>
                      <BarChart data={weeklyData} margin={{ top: 5, right: 10, bottom: 0, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={COLORS.line} vertical={false} />
                        <XAxis dataKey="label" interval={0} tick={axisTick} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fontSize: 11.5, fill: COLORS.mute }} axisLine={false} tickLine={false}
                          tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                        <Tooltip content={<CustomTooltip currency={activeStore.currency} />} cursor={{ fill: inkA(0.04) }} />
                        <Bar dataKey="revenue" name="Revenue" fill={INK} radius={[6, 6, 0, 0]} maxBarSize={56}>
                          {weeklyData.map((w, i) => <Cell key={i} fill={w.week === selectedWeek ? ORANGE : INK} fillOpacity={w.week === selectedWeek ? 1 : 0.2} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div style={{ height: 260, display: "flex", alignItems: "center", justifyContent: "center", color: COLORS.mute, fontSize: 14.5 }}>
                      {anyLoading ? "Loading weekly data…" : `No sales recorded in ${MONTH_NAMES[weeklyMonth]} ${selectedYear}`}
                    </div>
                  )}
                </Card>

                {/* Weekly table */}
                <Card style={{ marginBottom: 14 }}>
                  <CardHead icon="calendar" title={`Weekly Breakdown · ${MONTH_NAMES[weeklyMonth]} ${onFYView() ? (weeklyMonth >= 3 ? selectedYear : selectedYear + 1) : selectedYear}`}>
                    <RangeTag text={monthRange()} />
                  </CardHead>
                  <div style={{ fontSize: 13.5, color: COLORS.mute, margin: "-6px 0 14px" }}>{activeStore.currency}</div>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                      <thead>
                        <tr>
                          {["Week","Date Range","Revenue","Gross Profit","Margin","Orders","AOV","Discounts","New Cust.","vs Prev Week"].map(h => (
                            <th key={h} style={thStyle("left")}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {weeklyData.length === 0 ? (
                          <tr>
                            <td colSpan={10} style={{ padding: "28px 8px", color: COLORS.mute, textAlign: "center" }}>
                              {anyLoading ? "Loading…" : "No weekly data available for this month"}
                            </td>
                          </tr>
                        ) : weeklyData.map((row, i) => {
                          const prevW = weeklyData[i - 1];
                          /* Weeks are not all the same length (the first can be a short stub and the current
                             one is still running), so compare revenue per day, not week against week. */
                          const perDay = (w) => (w.days > 0 ? w.revenue / w.days : w.revenue);
                          const wGrowth = prevW ? calcGrowth(perDay(row), perDay(prevW)) : null;
                          const has = row.revenue > 0;
                          const c = tdStyle;
                          const none = <span style={{ color: COLORS.mute }}>-</span>;
                          return (
                            <tr key={i} style={{ background: hoveredMonth === 100 + i ? inkA(0.035) : "transparent", transition: "background 0.15s" }}
                              onMouseEnter={() => setHoveredMonth(100 + i)} onMouseLeave={() => setHoveredMonth(null)}>
                              <td style={{ ...c, fontWeight: 500, color: row.week === selectedWeek ? ORANGE : INK }}>Week {row.week}</td>
                              <td style={{ ...c, color: COLORS.mute, fontSize: 13 }}>{row.dateRange}</td>
                              <td style={{ ...c, fontWeight: 500 }}>{has ? fmtK(row.revenue, activeStore.currency) : none}</td>
                              <td style={c}>{has && row.grossProfit != null ? fmtK(row.grossProfit, activeStore.currency) : none}</td>
                              <td style={c}>{has && row.marginPct != null ? <MarginBar value={row.marginPct} /> : none}</td>
                              <td style={{ ...c, color: COLORS.ink2 }}>{has ? row.orders : none}</td>
                              <td style={{ ...c, color: COLORS.ink2 }}>{has ? fmtK(row.aov, activeStore.currency) : none}</td>
                              <td style={{ ...c, color: COLORS.ink2 }}>{row.totalDiscounts > 0 ? fmtK(row.totalDiscounts, activeStore.currency) : none}</td>
                              <td style={{ ...c, color: COLORS.ink2 }}>{row.newCustomers != null ? row.newCustomers.toLocaleString() : none}</td>
                              <td style={c}><GrowthBadge value={wGrowth} /></td>
                            </tr>
                          );
                        })}
                      </tbody>
                      {weeklyData.length > 0 && wTotalRev > 0 && (
                        <tfoot>
                          <tr>
                            <td colSpan={2} style={{ ...footStyle("left"), fontSize: 12.5, color: COLORS.mute, letterSpacing: "0.04em" }}>MONTH TOTAL</td>
                            <td style={footStyle("left")}>{fmtK(wTotalRev, activeStore.currency)}</td>
                            <td style={footStyle("left")}>{wTotalGP != null ? fmtK(wTotalGP, activeStore.currency) : "-"}</td>
                            <td style={footStyle("left")}>{wMarginPct != null ? <MarginBar value={wMarginPct} /> : <span style={{ color: COLORS.mute }}>-</span>}</td>
                            <td style={footStyle("left")}>{wTotalOrd}</td>
                            <td style={footStyle("left")}>{fmtK(wAvgAOV, activeStore.currency)}</td>
                            <td style={footStyle("left")}>{wTotalDisc > 0 ? fmtK(wTotalDisc, activeStore.currency) : "-"}</td>
                            <td style={footStyle("left")}>{wTotalNewC || "-"}</td>
                            <td style={footStyle("left")} />
                          </tr>
                        </tfoot>
                      )}
                    </table>
                    <div style={{ marginTop: 10, fontSize: 13, color: COLORS.mute }}>Weeks run Monday to Sunday and the first and last are clipped to the month. Vs Prev Week compares revenue per day, so a short or unfinished week is not judged against a full one.</div>
                  </div>
                </Card>
              </>
            );
          })()
        ) : (
          /* YOY VIEW */
          <>
            <div className={ui.grid2} style={{ marginBottom: 14 }}>
              <Card>
                <CardHead icon="bars" title="Annual Revenue" />
                <div style={{ fontSize: 13.5, color: COLORS.mute, margin: "-6px 0 14px" }}>Year-over-Year</div>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={yoyData} margin={{ top: 5, right: 10, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={COLORS.line} vertical={false} />
                    <XAxis dataKey="year" tick={{ fontSize: 13.5, fill: COLORS.mute }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11.5, fill: COLORS.mute }} axisLine={false} tickLine={false} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                    <Tooltip content={<CustomTooltip currency={activeStore.currency} />} cursor={{ fill: inkA(0.04) }} />
                    <Bar dataKey="revenue" name="Revenue" fill={INK} radius={[8, 8, 0, 0]} maxBarSize={64}>
                      {yoyData.map((yr) => <Cell key={yr.year} fill={yr.year === String(selectedYear) ? ORANGE : INK} fillOpacity={yr.year === String(selectedYear) ? 1 : 0.2} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </Card>
              <Card>
                <CardHead icon="trending" title="Orders & AOV Trend" />
                <div style={{ fontSize: 13.5, color: COLORS.mute, margin: "-6px 0 14px" }}>Volume and value evolution</div>
                <ResponsiveContainer width="100%" height={240}>
                  <ComposedChart data={yoyData} margin={{ top: 5, right: 10, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={COLORS.line} vertical={false} />
                    <XAxis dataKey="year" tick={{ fontSize: 13.5, fill: COLORS.mute }} axisLine={false} tickLine={false} />
                    <YAxis yAxisId="l" tick={{ fontSize: 11.5, fill: COLORS.mute }} axisLine={false} tickLine={false} tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v} />
                    <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11.5, fill: COLORS.mute }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} />
                    <Tooltip content={<CustomTooltip currency={activeStore.currency} />} cursor={{ fill: inkA(0.04) }} />
                    <Bar yAxisId="l" dataKey="orders" name="Orders" fill={inkA(0.18)} radius={[6, 6, 0, 0]} maxBarSize={56} />
                    <Line yAxisId="r" type="monotone" dataKey="aov" name="AOV" stroke={INK} strokeWidth={2} dot={{ fill: INK, r: 4, stroke: "#fff", strokeWidth: 2 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </Card>
            </div>

            <Card style={{ marginBottom: 14 }}>
              <CardHead icon="calendar" title="Year-over-Year Summary" />
              <div className={st.yearGrid}>
                {yoyData.map((yr, i) => {
                  const p   = yoyData[i - 1];
                  const isCur = yr.year === String(selectedYear);
                  /* A year still running is compared with the SAME dates a year earlier, never with last year's full twelve
                     months (27 Nov 2026: FY26 to date read as a 9% fall against all of FY25). */
                  const curP = isCur && onFYView() ? fyPayload(selectedYear) : null;
                  const partYear = Boolean(curP?.range && !curP.range.complete);
                  const sameT = curP?.totals;
                  const rg  = partYear ? (sameT?.growthPct ?? null) : p ? calcGrowth(yr.revenue, p.revenue) : null;
                  const og  = partYear ? (sameT?.prior?.invoices > 0 ? calcGrowth(sameT.invoices, sameT.prior.invoices) : null) : p ? calcGrowth(yr.orders, p.orders) : null;
                  const vsTxt = partYear ? `vs the same dates ${p?.year || selectedYear - 1}` : `vs ${p?.year}`;
                  const lab = { fontSize: 12.5, color: COLORS.mute, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 2 };
                  return (
                    <div key={yr.year} className={st.yearTile} style={{ borderColor: isCur ? INK : undefined, opacity: yr.loaded ? 1 : 0.35 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                        <div style={{ fontSize: 20, fontWeight: 300, color: isCur ? ORANGE : INK }}>{yr.year}{partYear && <span className={ui.was} style={{ marginLeft: 8 }}>to {fmtDay(curP.range.end)}</span>}</div>
                        {isLoading(parseInt(yr.year)) && <Pill>Loading</Pill>}
                      </div>
                      <div style={{ marginBottom: 10 }}>
                        <div style={lab}>Revenue</div>
                        <div style={{ fontSize: 15, fontWeight: 500 }}>{fmt(yr.revenue, activeStore.currency)}</div>
                        {rg !== null && <div style={{ marginTop: 2 }}><Delta value={rg} /> <span className={ui.was}>{vsTxt}</span></div>}
                      </div>
                      <div style={{ marginBottom: 10 }}>
                        <div style={lab}>Gross Profit</div>
                        <div style={{ fontSize: 15 }}>
                          {yr.grossProfit !== null ? fmt(yr.grossProfit, activeStore.currency) : <span style={{ color: COLORS.mute }}>-</span>}
                          {yr.margin !== null && <span style={{ fontSize: 12.5, color: COLORS.mute, marginLeft: 5 }}>{yr.margin}%</span>}
                        </div>
                      </div>
                      <div>
                        <div style={lab}>Orders</div>
                        <div style={{ fontSize: 15, color: COLORS.ink2 }}>{yr.orders.toLocaleString()}</div>
                        {og !== null && <div style={{ marginTop: 2 }}><Delta value={og} /> <span className={ui.was}>{vsTxt}</span></div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          </>
        )}
        </>)}

        {/* SALES BY REP on the Overview page, for North, Oceania and South. The same table as
            the Sales by Rep page, fed by the same figures, so the two can never disagree. */}
        {section === "overview" && ((activeStore.id === "worthy" && channelTab === "odoo") || activeStore.id === "nova") && (
          <div style={{ marginTop: 14 }}>
            {activeStore.id === "worthy" && <SalesVsTargetTable payload={fyPayload(selectedYear)} />}
            <SalesRepBreakdown partialMonth={partialMonth} weekRangeOf={(w) => weekDateRange(selectedYear, weeklyMonth, w, true)}
              salespeople={getOdooSalespeople()}
              salespeopleMonthly={getOdooSalespeopleMonthly()}
              salespeopleWeekly={getOdooSalespeopleWeekly()}
              repMargins={getOdooRepMargins()}
              loading={isLoading(selectedYear)}
              currency={activeStore.currency}
              weeklyMonth={weeklyMonth}
              onWeeklyMonthChange={setWeeklyMonth}
              fyMonths={FY_MONTHS}
              rangeLabel={yearRange()} monthRangeLabel={monthRange()}
              T={T}
              exact={exactAmounts}
            />
            {(activeStore.id === "worthy" || activeStore.id === "nova") && (
              <MarginMix company={activeStore.id === "nova" ? 1 : 4} range={customOn ? period : null} fy={selectedYear} month={`${onFYView() ? (weeklyMonth >= 3 ? selectedYear : selectedYear + 1) : selectedYear}-${String(weeklyMonth + 1).padStart(2, "0")}`} />
            )}
          </div>
        )}
        {section === "overview" && activeStore.id === "worthy" && channelTab !== "odoo" && (
          <div style={{ marginTop: 14 }}>
            {channelTab === "pos" ? (
              <AdvancedTable icon="users" title="Sales by Rep" range={yearRange()} subtitle="POS performance by sales representative" loading={isLoading(selectedYear)} currency={activeStore.currency} data={salespeople} columns={salespersonColumns} aiContext="sales rep performance"
                aiExtra="Hari+Nayan=Auckland East/West/North Shore. Rubin=South Auckland (Pukekohe/Waiuku/Tuakau). Savan=Waikato+Hawke's Bay. Naitik=Northland/Whangārei. Flag underperformance vs territory size and whether any rep is losing ground to competitors in their area."
                visual={<BarList rows={salespeople.map(s => ({ name: s.name, value: s.revenue }))} fmt={(v) => fmtK(v, activeStore.currency)} />} />
            ) : (
              <div style={{ fontSize: 14.5, color: COLORS.mute, padding: "20px 0" }}>Online sales aren&apos;t broken down by rep - switch to the POS tab for rep figures.</div>
            )}
          </div>
        )}
        {section === "overview" && activeStore.id === "luxe" && (
          <div style={{ marginTop: 14 }}>
            <SalesVsTargetTable payload={fyPayload(selectedYear)} company="south" />
            <SalesRepBreakdown partialMonth={partialMonth} weekRangeOf={(w) => weekDateRange(selectedYear, weeklyMonth, w, true)}
              salespeople={getSalespeople()}
              salespeopleMonthly={getLuxeSalespeopleMonthlyFY()}
              salespeopleWeekly={getLuxeSalespeopleWeekly()}
              repMargins={getLuxeFYRepMargins()}
              loading={isLoading(selectedYear)}
              currency={activeStore.currency}
              weeklyMonth={weeklyMonth}
              onWeeklyMonthChange={setWeeklyMonth}
              fyMonths={FY_MONTHS}
              rangeLabel={yearRange()} monthRangeLabel={monthRange()}
              T={T}
              exact
            />
          </div>
        )}

        {/* ODOO ADVANCED SECTION, Worthy North (Odoo tab) and Worthy Oceania (nova) - one tab per table group, Sales by Rep first, Debtors last */}
        {section !== "overview" && ((activeStore.id === "worthy" && channelTab === "odoo") || activeStore.id === "nova") && (
          <>
            {renderAdvTabs()}

            {advTab === "reps" && (
              <>
                {/* KPI targets: North only, same targets as the Odoo KPI scheduled actions */}
                {activeStore.id === "worthy" && <SalesVsTargetTable payload={fyPayload(selectedYear)} />}
                <SalesRepBreakdown partialMonth={partialMonth} weekRangeOf={(w) => weekDateRange(selectedYear, weeklyMonth, w, true)}
                  salespeople={getOdooSalespeople()}
                  salespeopleMonthly={getOdooSalespeopleMonthly()}
                  salespeopleWeekly={getOdooSalespeopleWeekly()}
                  repMargins={getOdooRepMargins()}
                  loading={isLoading(selectedYear)}
                  currency={activeStore.currency}
                  weeklyMonth={weeklyMonth}
                  onWeeklyMonthChange={setWeeklyMonth}
                  fyMonths={FY_MONTHS}
                  rangeLabel={yearRange()} monthRangeLabel={monthRange()}
                  T={T}
                  exact={exactAmounts}
                />
                {(activeStore.id === "worthy" || activeStore.id === "nova") && (
                  <MarginMix company={activeStore.id === "nova" ? 1 : 4} range={customOn ? period : null} fy={selectedYear} month={`${onFYView() ? (weeklyMonth >= 3 ? selectedYear : selectedYear + 1) : selectedYear}-${String(weeklyMonth + 1).padStart(2, "0")}`} />
                )}
              </>
            )}

            {showGroup("products") && isAnalytics && <GroupTitle text="Categories & Products" />}
            {showGroup("products") && (
              <>
                <Notice style={{ marginBottom: 14 }}>{INTERCOMPANY_NOTE}</Notice>
                <div className={st.tableGrid}>
                  <AdvancedTable icon="folder" title="Top Categories" range={tableRange()} subtitle="Where the revenue actually comes from"
                    loading={isLoading(selectedYear)} currency={activeStore.currency}
                    data={getOdooTopCategories().slice(0, 15).map(c => ({ name: c.category, revenue: c.revenue, qty: c.unitsSold, margin: c.margin, productCount: c.productCount }))}
                    visual={<BarList rows={getOdooTopCategories().slice(0, 15).map(c => ({ name: c.category, value: c.revenue }))} fmt={(v) => fmtK(v, activeStore.currency)} share={false} />}
                    columns={[
                      { key: "name",         label: "Category",     color: INK },
                      { key: "productCount", label: "# Products",   align: "center", color: COLORS.ink2 },
                      { key: "qty",          label: "Units Sold",   align: "right",  color: COLORS.ink2 },
                      { key: "revenue",      label: "Revenue",      align: "right",  color: INK, format: (v, c) => fmtK(v, c) },
                      { key: "margin",       label: "Margin",       align: "right",  color: COLORS.ink2, format: v => v !== null ? `${v}%` : "-" },
                    ]}
                    aiContext="top Odoo categories"
                    aiExtra="Which categories drive the business? Flag any with margin < 15%, those need a price review."
                  />
                  <AdvancedTable icon="award" title="Top Products" range={tableRange()} subtitle="High performers by net revenue"
                    loading={isLoading(selectedYear)} currency={activeStore.currency}
                    data={getOdooTopProducts().slice(0, 25).map(p => ({ name: p.title, code: p.code, category: p.category, qtySold: p.unitsSold, revenue: p.revenue, margin: p.margin }))}
                    visual={<BarList rows={getOdooTopProducts().slice(0, 25).map(p => ({ name: p.title, value: p.revenue }))} fmt={(v) => fmtK(v, activeStore.currency)} share={false} />}
                    columns={[
                      { key: "name",     label: "Product",  color: INK },
                      { key: "category", label: "Category", color: COLORS.mute },
                      { key: "qtySold",  label: "Units",    align: "right", color: COLORS.ink2 },
                      { key: "revenue",  label: "Revenue",  align: "right", color: INK, format: (v, c) => fmtK(v, c) },
                      { key: "margin",   label: "Margin",   align: "right", color: COLORS.ink2, format: v => v !== null ? `${v}%` : "-" },
                    ]}
                    aiContext="top Odoo products"
                    aiExtra="Are these stocked correctly? Imported lines with long lead times need 60+ days of cover. Flag anything trending down vs prior month."
                  />
                </div>
              </>
            )}

            {showGroup("movers") && isAnalytics && <GroupTitle text="Fast & Slow Movers" />}
            {showGroup("movers") && activeStore.id === "worthy" && <><StockStates /><ShortDated /></>}
            {showGroup("movers") && (
              <div className={st.tableGrid}>
                <AdvancedTable icon="zap" title="Fast-Moving SKUs" range={tableRange()} subtitle="Highest velocity, keep stocked & push wider"
                  loading={isLoading(selectedYear)} currency={activeStore.currency} data={getOdooFastMoving().slice(0, 20)}
                  visual={<BarList rows={getOdooFastMoving().slice(0, 20).map(p => ({ name: p.name, value: p.unitsSold }))} share={false} />}
                  columns={[
                    { key: "name",         label: "Product",     color: INK },
                    { key: "category",     label: "Category",    color: COLORS.mute },
                    { key: "unitsSold",    label: "Units Sold",  align: "right", color: INK },
                    { key: "currentStock", label: "On Hand",     align: "right", color: COLORS.ink2 },
                    { key: "revenue",      label: "Revenue",     align: "right", color: INK, format: (v, c) => fmtK(v, c) },
                    { key: "margin",       label: "Margin",      align: "right", color: COLORS.ink2, format: v => v !== null ? `${v}%` : "-" },
                  ]}
                  aiContext="fast-moving Odoo SKUs"
                  aiExtra="These are your engine. Make sure cover ratio is at least 6 weeks. Are any close to stockout?"
                />
                <AdvancedTable icon="hourglass" title="Slow-Moving SKUs" range={tableRange()} subtitle="Stock held today against sales in the period, ranked by capital sitting idle. Clear, bundle or discontinue"
                  loading={isLoading(selectedYear)} currency={activeStore.currency} data={getOdooSlowMoving().slice(0, 20)}
                  visual={<BarList rows={getOdooSlowMoving().slice(0, 20).map(p => ({ name: p.name, value: p.lockedCapital }))} fmt={(v) => fmtK(v, activeStore.currency)} share={false} />}
                  columns={[
                    { key: "name",          label: "Product",       color: INK },
                    { key: "category",      label: "Category",      color: COLORS.mute },
                    { key: "currentStock",  label: "On Hand",       align: "right", color: COLORS.ink2 },
                    { key: "qtySold",       label: "Units Sold",    align: "right", color: COLORS.mute },
                    { key: "lockedCapital", label: "Capital Tied",  align: "right", color: ORANGE, format: (v, c) => fmtK(v, c) },
                  ]}
                  aiContext="slow-moving Odoo SKUs"
                  aiExtra="Top 3 by capital tied, recommend specific clearance pricing or rep push. Anything with an expiry risk?"
                />
              </div>
            )}

            {showGroup("customers") && isAnalytics && <GroupTitle text="Customers" />}
            {showGroup("customers") && isAnalytics && activeStore.id === "worthy" && (
              <Notice icon="building" style={{ marginBottom: 14 }}>
                Worthy Products South (Dutch Rusk) and Worthy Oceania are inter-company customers of North and appear in this list.
              </Notice>
            )}
            {showGroup("customers") && (
              <div className={st.tableGrid}>
                <AdvancedTable icon="trophy" title="Top Customers" range={tableRange()} subtitle="Ranked by net invoice revenue (customers only, suppliers excluded)"
                  loading={isLoading(selectedYear)} currency={activeStore.currency} data={getOdooCustomers().slice(0, 20)}
                  visual={<BarList rows={getOdooCustomers().slice(0, 20).map(c => ({ name: c.name, value: c.revenue }))} fmt={(v) => fmtK(v, activeStore.currency)} share={false} />}
                  columns={[
                    { key: "name",    label: "Customer", color: INK },
                    /* `orderCount`, not `orders` - the getter's own field name. Reading
                       the wrong key left this column blank on every row. */
                    { key: "orderCount", label: "Orders", align: "center", color: COLORS.ink2 },
                    { key: "revenue", label: "Revenue",  align: "right",  color: INK, format: (v, c) => fmtK(v, c) },
                    { key: "aov",     label: "Avg Order",align: "right",  color: COLORS.ink2, format: (v, c) => fmtK(v, c) },
                    { key: "status",  label: "Status",   align: "center", format: v => renderStatus(v) },
                  ]}
                  aiContext="Odoo top customers"
                  aiExtra="These are B2B wholesale customers on credit terms. Note any dairies, gas stations or corner stores. Flag anyone showing 'At Risk' or 'Lapsed' status, call them this week."
                />
                <AdvancedTable icon="alert" title="At-Risk Customers (45 to 90 days)" range={tableRange("asat")} subtitle="Overdue for reorder, call before they lapse"
                  loading={isLoading(selectedYear)} currency={activeStore.currency}
                  data={getOdooAtRisk().slice(0, 20).map(c => ({ name: c.name, revenue: c.revenue, daysSince: c.daysSince, lastOrderDate: c.lastOrderDate, status: c.status, orderCount: c.orderCount }))}
                  columns={atRiskColumns} aiContext="at-risk Odoo customers"
                  aiExtra="Suggest which rep should phone each customer this week. These reorder windows close fast."
                />
                <AdvancedTable icon="userMinus" title="Lapsed Customers (>90 days)" range={tableRange("asat")} subtitle="Stopped ordering, win-back priority"
                  loading={isLoading(selectedYear)} currency={activeStore.currency}
                  data={getOdooLapsed().slice(0, 20).map(c => ({ name: c.name, revenue: c.revenue, daysSince: c.daysSince, lastOrderDate: c.lastOrderDate, orderCount: c.orderCount }))}
                  columns={churnedColumns} aiContext="lapsed Odoo customers"
                  aiExtra="Likely lost to DKSH, Gilmours, or Stock4Shop. Recommend a visit + offer for the top 5 by revenue."
                />
              </div>
            )}

            {advTab === "credits" && (
              <CreditsPanel source={`/api/odoo/credits?company=${activeStore.odooCompanyId}`} currency={activeStore.currency} rangeLabel={yearRange()} />
            )}

            {advTab === "debtors" && (
              <DebtorsPanel source={`/api/odoo/debtors?company=${activeStore.odooCompanyId}`} currency={activeStore.currency} />
            )}
          </>
        )}

        {/* ADVANCED ANALYTICS, not shown for Odoo tab (Shopify-based) or nova - one tab per table group, Sales by Rep first, Debtors last */}
        {section !== "overview" && (activeStore.id === "luxe" || (activeStore.id === "worthy" && channelTab !== "odoo")) && (
          <>
            {/* Category drill-down modal */}
            <CategoryModal
              category={categoryModal?.name}
              products={categoryModal?.products}
              currency={activeStore.currency}
              onClose={() => setCategoryModal(null)}
            />

            <Card style={{ marginTop: 14, marginBottom: 14 }}>
              <CardHead icon="chart" title={
                view === "weekly"
                  ? `Week ${selectedWeek} · ${weekDateRange(selectedYear, weeklyMonth, selectedWeek)}`
                  : view === "yoy"
                  ? `All Years · Year on Year`
                  : activeStore.id === "luxe"
                  ? `Financial year ${selectedYear}`
                  : latestMonth
                  ? `${latestMonth.month} ${selectedYear}`
                  : `${selectedYear}`}>
                <RangeTag text={tableRange()} />
              </CardHead>
              <div style={{ fontSize: 14, color: COLORS.mute, marginTop: -6 }}>
                {activeStore.id === "luxe" && view !== "weekly"
                  ? "Everything below covers the whole financial year so far, not just the latest month"
                  : "Analytics for the selected period"}
              </div>
            </Card>

            {renderAdvTabs(activeStore.id === "luxe" ? ADV_TABS : ADV_TABS.filter(t => !["credits", "debtors"].includes(t.id)))}

            {advTab === "reps" && (
              activeStore.id === "luxe" ? (
                <>
                <SalesVsTargetTable payload={fyPayload(selectedYear)} company="south" />
                <SalesRepBreakdown partialMonth={partialMonth} weekRangeOf={(w) => weekDateRange(selectedYear, weeklyMonth, w, true)}
                  salespeople={getSalespeople()}
                  salespeopleMonthly={getLuxeSalespeopleMonthlyFY()}
                  salespeopleWeekly={getLuxeSalespeopleWeekly()}
                  repMargins={getLuxeFYRepMargins()}
                  loading={isLoading(selectedYear)}
                  currency={activeStore.currency}
                  weeklyMonth={weeklyMonth}
                  onWeeklyMonthChange={setWeeklyMonth}
                  fyMonths={FY_MONTHS}
                  rangeLabel={yearRange()} monthRangeLabel={monthRange()}
                  T={T}
                  exact
                />
                </>
              ) : channelTab === "pos" ? (
                <AdvancedTable icon="users" title="Sales by Rep" range={yearRange()} subtitle="POS performance by sales representative" loading={isLoading(selectedYear)} currency={activeStore.currency} data={salespeople} columns={salespersonColumns} aiContext="sales rep performance"
                  aiExtra="Hari+Nayan=Auckland East/West/North Shore. Rubin=South Auckland (Pukekohe/Waiuku/Tuakau). Savan=Waikato+Hawke's Bay. Naitik=Northland/Whangārei. Flag underperformance vs territory size and whether any rep is losing ground to competitors in their area."
                  visual={<BarList rows={salespeople.map(s => ({ name: s.name, value: s.revenue }))} fmt={(v) => fmtK(v, activeStore.currency)} />} />
              ) : (
                <div style={{ fontSize: 14.5, color: COLORS.mute, padding: "20px 0" }}>Online sales aren&apos;t broken down by rep - switch to the POS tab for rep figures.</div>
              )
            )}

            {showGroup("products") && isAnalytics && <GroupTitle text="Categories & Products" />}
            {showGroup("products") && (
              <>
                <Notice style={{ marginBottom: 14 }}>{INTERCOMPANY_NOTE}</Notice>
                <div className={st.tableGrid}>
                  <AdvancedTable icon="folder" title="Top Categories" range={tableRange()} subtitle="Click a category to drill down into its products" loading={advLoading} currency={activeStore.currency} data={displayCategories} columns={categoryColumns}
                    onRowClick={row => setCategoryModal({ name: row.name, products: advancedData.curr?.categoryProducts?.[row.name] || [] })}
                    visual={<BarList rows={displayCategories.map(c => ({ name: c.name, value: c.revenue }))} fmt={(v) => fmtK(v, activeStore.currency)} share={false} />}
                    aiContext="top revenue categories"
                    aiExtra="Focus on whether confectionery vs beverages balance aligns with current NZ season. Flag any categories at risk from competitors like DKSH or Gilmours." />
                  <AdvancedTable icon="award" title="Top Products" range={tableRange()}    subtitle="High Performers" loading={advLoading} currency={activeStore.currency} data={displayProducts}   columns={productColumns}  aiContext="top selling products"
                    visual={<BarList rows={displayProducts.map(p => ({ name: p.name, value: p.revenue }))} fmt={(v) => fmtK(v, activeStore.currency)} share={false} />}
                    aiExtra="Note any imported products in the top list, these need healthy stock levels given import lead times. Flag anything that could be pushed harder online." />
                </div>
              </>
            )}

            {showGroup("movers") && isAnalytics && <GroupTitle text="Fast & Slow Movers" />}
            {showGroup("movers") && activeStore.id === "luxe" && <StockStates />}
            {showGroup("movers") && (
              <div className={st.tableGrid}>
                <AdvancedTable icon="zap" title="Fast-Moving SKUs" range={tableRange()} subtitle="Highest velocity by units sold, keep stocked & push wider"
                  loading={advLoading} currency={activeStore.currency}
                  /* Read the fast-moving list the endpoint builds from EVERY product.
                     Re-sorting the top-by-revenue list by units cannot find a fast
                     mover that earns little: nine of these twenty rows were wrong,
                     and the real leader - 4,676 units - was not on the page at all. */
                  data={(advancedData.curr?.fastMoving || []).slice(0, 20).map(p => ({ name: p.title, category: p.category, unitsSold: p.unitsSold, revenue: p.revenue, margin: p.margin }))}
                  visual={<BarList rows={(advancedData.curr?.fastMoving || []).slice(0, 20).map(p => ({ name: p.title, value: p.unitsSold }))} share={false} />}
                  columns={[
                    { key: "name",      label: "Product",    color: INK },
                    { key: "category",  label: "Category",   color: COLORS.mute },
                    { key: "unitsSold", label: "Units Sold", align: "right", color: INK },
                    { key: "revenue",   label: "Revenue",    align: "right", color: INK, format: (v, c) => fmtK(v, c) },
                    { key: "margin",    label: "Margin",     align: "right", color: COLORS.ink2, format: v => v !== null ? `${v}%` : "-" },
                  ]}
                  aiContext="fast-moving SKUs"
                  aiExtra="Ensure 6+ weeks of cover on these. Flag any close to stockout, these drive the business."
                />
                <AdvancedTable icon="hourglass" title="Slow-Moving Inventory" range={tableRange()} subtitle="Capital tied up in low-turnover stock"    loading={advLoading} currency={activeStore.currency} data={advancedData.curr?.slowMoving || []} columns={slowMovingColumns} aiContext="slow-moving inventory"
                  visual={<BarList rows={(advancedData.curr?.slowMoving || []).map(p => ({ name: p.name, value: p.lockedCapital }))} fmt={(v) => fmtK(v, activeStore.currency)} share={false} />}
                  aiExtra="Pay special attention to imported products, slow-moving imports tie up capital for months and risk obsolescence. Suggest clearance pricing, bundle deals, or targeted rep push for specific territories." />
              </div>
            )}

            {showGroup("customers") && isAnalytics && <GroupTitle text="Customers" />}
            {showGroup("customers") && (
              <>
                <div className={st.tableGrid} style={{ marginBottom: 14 }}>
                  <AdvancedTable icon="trophy" title="Top Customers" range={tableRange()}   subtitle="Loyalty & Spend" loading={advLoading} currency={activeStore.currency} data={displayCustomers}  columns={customerColumns} aiContext="top customers by spend"
                    visual={<BarList rows={displayCustomers.map(c => ({ name: c.name, value: c.revenue }))} fmt={(v) => fmtK(v, activeStore.currency)} share={false} />}
                    aiExtra="Consider customer types: dairies, supermarkets, gas stations, night markets. Identify any at risk of switching to competitors. Note credit vs B2C customers if distinguishable." />
                  <AdvancedTable icon="userMinus" title="Lapsed Customers (>90 Days)" range={tableRange("asat")} subtitle="High-value clients who stopped ordering" loading={advLoading} currency={activeStore.currency} data={advancedData.curr?.churned    || []} columns={churnedColumns} aiContext="lapsed customers"
                    aiExtra="These are likely dairies, gas stations or corner stores that may have switched to Gilmours, DKSH or Stock4Shop. Suggest which rep should personally visit and what offer might win them back." />
                </div>
                <div className={st.tableGrid}>
                  <AdvancedTable icon="alert" title="At-Risk Customers (45 to 90 Days)" range={tableRange("asat")} subtitle="Overdue for a reorder, act before they lapse" loading={advLoading} currency={activeStore.currency} data={displayAtRisk} columns={atRiskColumns} aiContext="at-risk customers" />
                  <AdvancedTable icon="gem" title="Customer Lifetime Value" range={tableRange("lifetime")} subtitle="Top accounts by total spend" loading={advLoading} currency={activeStore.currency} data={displayCLV} columns={clvColumns} aiContext="customer lifetime value" />
                </div>
              </>
            )}

            {advTab === "credits" && activeStore.id === "luxe" && (
              <CreditsPanel source="/api/ostendo/credits" currency={activeStore.currency} rangeLabel={yearRange()} />
            )}

            {advTab === "debtors" && activeStore.id === "luxe" && (
              <DebtorsPanel source="/api/ostendo/debtors" currency={activeStore.currency} />
            )}
          </>
        )}

        {/* Footer: the period's other figures, and what the page is showing */}
        <Card style={{ marginTop: 22 }}>
          <div className={st.footer}>
            <div className={st.footStats}>
              {[
                ...(isMgmt && activeStore.id === "luxe" ? [["Rebates (already deducted)", (() => {
                  const r = view === "monthly" ? (latestMonth?.rebates ?? null)
                          : curr.reduce((a, m) => a + (m.rebates || 0), 0);
                  return r ? fmtExact(r, activeStore.currency) : "-";
                })(), "percent"]] : []),
                ["New Customers",   kpiNewC != null ? kpiNewC.toLocaleString() : "-", "user"],
                ...(isMgmt ? [["Total Discounts", kpiDisc != null && kpiDisc !== 0
                                      ? (exactAmounts ? fmtExact(kpiDisc, activeStore.currency) : fmtK(kpiDisc, activeStore.currency))
                                      : "-", "receipt"],
                ["Gross Profit",    kpiGP !== null ? fmtK(kpiGP, activeStore.currency) : "-", "wallet"]] : []),
                ...(canSeeStock ? [["Stock Valuation (today, at cost)", stockValue != null ? fmtExact(stockValue, activeStore.currency) : "-", "store"]] : []),
              ].map(([lbl, val, ic]) => (
                <div key={lbl} className={st.footStat}>
                  <span className={ui.chip}><Icon n={ic} size={14} /></span>
                  <div style={{ minWidth: 0 }}>
                    <div className={ui.statLabel} style={{ marginTop: 0 }}>{lbl}</div>
                    <div style={{ fontSize: 17, fontWeight: 400, overflowWrap: "anywhere" }}>{val}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className={st.scope}>
              {(() => {
                const scope = view === "weekly"  ? `WEEK ${selectedWeek} OF ${MONTH_NAMES[weeklyMonth].toUpperCase()}`
                            : view === "monthly" ? (latestMonth ? `${latestMonth.month.toUpperCase()} ONLY` : "")
                            : activeStore.id === "luxe" ? `FULL FY${String(selectedYear).slice(2)}`
                            : (onFYView() && fyPayload(selectedYear)?.range && !fyPayload(selectedYear).range.complete) ? `FY${String(selectedYear).slice(2)} TO DATE`
                            : `FULL ${selectedYear}`;
                const who = activeStore.id === "luxe"
                  ? `WORTHY PRODUCTS SOUTH · FY${String(selectedYear).slice(2)}`
                  : activeStore.name?.toUpperCase();
                return `${who} · ${scope}`;
              })()}
            </div>
          </div>
        </Card>
      </div>
      </div>
    </div>
  );
}