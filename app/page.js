"use client";

import { useState, useEffect, useRef, useReducer } from "react";
import {
  Area, BarChart, Bar, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ComposedChart, ReferenceLine
} from "recharts";

// Brand palettes
const BRAND = {
  products: { primary: "#2256c2", mid: "#3f7bdd", light: "#7daffe" },   // Worthy Products North & South
  oceania:  { primary: "#b13924", mid: "#f48120", light: "#fcb614",      // Worthy Oceania / Fabrics
              dark: "#66270f" },
};

const STORES = [
  { id: "worthy", name: "Worthy Products North", color: BRAND.products.mid,  accent2: BRAND.products.light, dark: BRAND.products.primary, logo: "products", currency: "NZD", odooCompanyId: 4 },
  { id: "luxe",   name: "Worthy Products South", color: BRAND.products.mid,  accent2: BRAND.products.light, dark: BRAND.products.primary, logo: "products", currency: "NZD" },
  { id: "nova",   name: "Worthy Oceania",         color: BRAND.oceania.mid,   accent2: BRAND.oceania.light,  dark: BRAND.oceania.primary,  logo: "oceania",  currency: "NZD", odooCompanyId: 1 },
];

const ALL_YEARS = [2022, 2023, 2024, 2025, 2026];
const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const seed = (s) => { let x = Math.sin(s) * 10000; return x - Math.floor(x); };
const generateMonthlyData = (storeId, year) => {
  const base  = { worthy: 84000, luxe: 62000, nova: 45000 }[storeId] || 60000;
  const seas   = [0.75,0.72,0.88,0.92,0.95,0.98,1.0,1.05,1.08,1.12,1.35,1.55];
  return MONTH_NAMES.map((m, i) => {
    const yf  = { 2022: 0.65, 2023: 0.78, 2024: 0.91, 2025: 1, 2026: 1.1 }[year] || 1;
    const rev = Math.round(base * seas[i] * yf * (0.92 + seed(i * 7 + storeId.length + year) * 0.16));
    const cst = Math.round(rev * 0.58);
    const ord = Math.round(rev / (85 + seed(i + year) * 30));
    const ret = Math.round(ord * (0.04 + seed(i * 3) * 0.04));
    const ses = Math.round(ord / (0.024 + seed(i * 2) * 0.01));
    return {
      month: m, revenue: rev, totalCost: cst, grossProfit: rev - cst, marginPct: 42,
      orders: ord, returns: ret, sessions: ses, totalDiscounts: Math.round(rev * 0.08),
      aov: Math.round(rev / ord), convRate: +((ord / ses) * 100).toFixed(2),
      newCustomers: Math.round(ord * (0.55 + seed(i * 5) * 0.2)), hasCostData: true,
    };
  });
};

const generateEmptyYear = () =>
  MONTH_NAMES.map(m => ({
    month: m, revenue: 0, totalCost: 0, grossProfit: 0, marginPct: null,
    orders: 0, returns: 0, sessions: 0, totalDiscounts: 0, aov: 0,
    convRate: 0, newCustomers: 0, hasCostData: true, marginableRevenue: 0
  }));

const calcGrowth = (c, p) => (!p || p === 0) ? null : +((( c - p) / p) * 100).toFixed(1);
const fmt   = (n, cur = "NZD") => new Intl.NumberFormat("en-NZ", { style: "currency", currency: cur, maximumFractionDigits: 0 }).format(n || 0);
const fmtK  = (n, cur = "NZD") => {
  if (n === null || n === undefined) return "—";
  const s = cur === "NZD" ? "NZ$" : "$";
  return Math.abs(n) >= 1000 ? `${s}${(n / 1000).toFixed(1)}k` : `${s}${n}`;
};
const fmtPct = (n) => (n === null || n === undefined) ? "—" : `${n > 0 ? "+" : ""}${n}%`;

const GrowthBadge = ({ value }) => {
  if (value === null || value === undefined) return <span style={{ color: "#888" }}>—</span>;
  const pos = value >= 0;
  return <span style={{ color: pos ? "#4ade80" : "#f87171", fontWeight: 700 }}>{pos ? "▲" : "▼"} {Math.abs(value)}%</span>;
};

const MarginBar = ({ value, accent = "#3f7bdd" }) => {
  if (value === null || value === undefined) return <span style={{ color: "#888" }}>—</span>;
  const color = value > 40 ? "#4ade80" : value > 20 ? accent : "#f87171";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
      <div style={{ width: 30, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.07)" }}>
        <div style={{ width: `${Math.min(Math.max(value, 0), 100)}%`, height: "100%", background: color, borderRadius: 2 }} />
      </div>
      <span style={{ color, fontWeight: 700, fontSize: 11 }}>{value}%</span>
    </div>
  );
};

const CustomTooltip = ({ active, payload, label, currency = "NZD", accent = "#3f7bdd" }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "#1e293b", border: `1px solid ${accent}60`, borderRadius: 12, padding: "12px 16px", fontSize: 12, color: "#e2e8f0", boxShadow: "0 8px 32px rgba(0,0,0,0.25)" }}>
      <div style={{ fontFamily: "'DM Sans',sans-serif", color: accent, marginBottom: 8, fontSize: 13, fontWeight: 700 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: p.color, display: "inline-block" }} />
          <span style={{ color: "#94a3b8" }}>{p.name}:</span>
          <span style={{ color: "#f8fafc", fontWeight: 600 }}>
            {["Revenue","AOV","Gross Profit"].includes(p.name) ? fmt(p.value, currency) : p.name === "Growth" ? fmtPct(p.value) : String(p.value?.toLocaleString?.() ?? p.value)}
          </span>
        </div>
      ))}
    </div>
  );
};

const KPICard = ({ label, value, growth, icon, accent, sub, animated, currency = "NZD", darkMode = true }) => {
  const [display, setDisplay] = useState(0);
  const isPos = !growth || growth >= 0;
  const textHead = darkMode ? "#f0e8d8" : "#0f172a";
  const textMuted = darkMode ? "#6b6050" : "#6b7280";
  const cardBg = darkMode ? "linear-gradient(135deg,rgba(255,255,255,0.04),rgba(255,255,255,0.01))" : "#ffffff";
  const cardBorder = darkMode ? "rgba(255,255,255,0.08)" : "rgba(0,30,100,0.12)";
  useEffect(() => {
    const t = value || 0;
    if (!animated || t === 0) { setDisplay(t); return; }
    let cur = 0; const step = t / 40;
    const timer = setInterval(() => { cur += step; if (cur >= t) { setDisplay(t); clearInterval(timer); } else setDisplay(Math.round(cur)); }, 20);
    return () => clearInterval(timer);
  }, [value, animated]);
  return (
    <div style={{ background: cardBg, border: `1px solid ${cardBorder}`, borderRadius: 16, padding: "22px 24px", position: "relative", overflow: "hidden", transition: "transform 0.2s,box-shadow 0.2s", cursor: "default" }}>
      <div style={{ position: "absolute", top: -30, right: -30, width: 120, height: 120, background: `radial-gradient(circle,${accent}20 0%,transparent 70%)`, borderRadius: "50%" }} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ fontSize: 22, marginBottom: 8 }}>{icon}</div>
        <div style={{ fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 20, color: growth === null ? textMuted : isPos ? "#4ade80" : "#f87171", background: growth === null ? (darkMode ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)") : isPos ? "rgba(74,222,128,0.1)" : "rgba(248,113,113,0.1)" }}>
          {growth === null ? "No prior yr" : `${isPos ? "▲" : "▼"} ${Math.abs(growth)}%`}
        </div>
      </div>
      <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 26, fontWeight: 700, color: textHead, letterSpacing: "-0.02em", lineHeight: 1.1, marginBottom: 4 }}>
        {sub === "currency" ? fmtK(display, currency) : sub === "pct" ? `${Number(display).toFixed(1)}%` : display.toLocaleString()}
      </div>
      <div style={{ fontSize: 11, color: textMuted, textTransform: "uppercase", letterSpacing: "0.12em" }}>{label}</div>
    </div>
  );
};

const StorePill = ({ store, active, onClick }) => (
  <button onClick={onClick} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 16px", borderRadius: 40, border: active ? `1px solid ${store.color}` : "1px solid rgba(255,255,255,0.1)", background: active ? `${store.color}18` : "transparent", color: active ? store.color : "#6b6050", cursor: "pointer", fontSize: 12, fontWeight: 600, letterSpacing: "0.05em", transition: "all 0.2s", whiteSpace: "nowrap" }}>
    <span style={{ width: 8, height: 8, borderRadius: "50%", background: store.color, display: "inline-block", flexShrink: 0 }} />
    {store.name}
    {active && <span style={{ width: 6, height: 6, borderRadius: "50%", background: store.color, opacity: 0.6 }} />}
  </button>
);

const WORTHY_CONTEXT = `
You are a senior business analyst embedded at Worthy Products NZ, a wholesale confectionery and beverages distributor based in Auckland.

BUSINESS OVERVIEW:
- Wholesale distributor of confectionery and beverages to the NZ trade market
- Procures locally (NZ) and imports from: USA, Thailand, Korea, Australia, Vietnam, Malaysia, China and other markets
- Customers: Dairies, supermarkets, petrol stations/gas stations, local corner stores, night market vendors, event suppliers
- Also runs a small B2C channel where end customers buy by the carton and pay online directly
- B2B customers are on credit terms; B2C customers pay upfront online
- Currency: NZD. Target gross margin: 20% annually
- Main competitors: DKSH, Gilmours, Geneva, Stock4Shop, Nalsun Imports — all aggressive online

SALES TEAM (5 reps, all via POS/field sales):
- Hari Patel: Auckland East, West, North Shore
- Nayan Patel: Auckland East, West, North Shore (works alongside Hari)
- Rubin Monpara: South Auckland including Pukekohe, Waiuku, Tuakau
- Savan: Waikato Region including Hawke's Bay
- Naitik Trivedi: Northland including Whangārei

CHANNELS:
- POS/Field Sales: Reps visit stores directly, take orders on the spot
- Online Sales: Covers ALL of NZ — rep territories + remote areas reps can't reach. Strategic priority to grow online significantly to compete with DKSH, Gilmours, Geneva, Stock4Shop, Nalsun Imports.

NZ SEASONS (Southern Hemisphere — opposite to northern hemisphere):
- Summer: December, January, February — hottest months, beverages/cold drinks/iced confectionery peak
- Autumn: March, April, May — transitioning, beverage demand tapering, confectionery starting to pick up
- Winter: June, July, August — coldest months, chocolate and warm confectionery peak demand
- Spring: September, October, November — warming up, mixed demand

TODAY'S DATE: ${new Date().toLocaleDateString('en-NZ', { month: 'long', day: 'numeric', year: 'numeric' })}
CURRENT NZ SEASON: ${(() => {
  const m = new Date().getMonth(); // 0-indexed
  if (m <= 1 || m === 11) return "Summer (December–February) — peak beverage and cold drink season";
  if (m <= 4) return "Autumn (March–May) — beverages tapering, confectionery starting to rise";
  if (m <= 7) return "Winter (June–August) — peak chocolate and confectionery season";
  return "Spring (September–November) — mixed demand, beverages beginning to recover";
})()}

STRATEGIC PRIORITIES:
1. Grow online sales aggressively — this is the #1 growth lever right now
2. Defend territory against competitors with strong online presence
3. Maintain 20% gross margin target
4. Identify slow-moving imported stock early (import lead times make overstock costly)
5. Keep B2B credit customers ordering regularly — churn is expensive to recover

When analysing data, always:
- Reference specific rep names and their territories where relevant
- Correctly apply NZ seasonality — summer is Dec–Feb, winter is Jun–Aug
- Flag margin concerns vs the 20% target
- Highlight online channel growth opportunities specifically
- Note if imported product lines are at risk (slow-moving imported stock ties up capital and has long reorder lead times)
- Be direct and actionable — the audience is the owner and sales manager, not an analyst
`;

// ── AI Insights Panel ─────────────────────────────────────────────────────────
const AIInsights = ({ data, context, currency, extraContext, accent = "#3f7bdd" }) => {
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
    <div style={{ marginTop: 12 }}>
      <button onClick={getInsights} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 8, border: `1px solid ${accent}50`, background: `${accent}10`, color: accent, fontSize: 11, fontWeight: 600, cursor: "pointer", letterSpacing: "0.04em" }}>
        <span>✦</span>{loading ? "Analysing…" : open ? "Hide AI Insights" : "✦ AI Insights"}
      </button>
      {open && !loading && insight && (
        <div style={{ marginTop: 10, padding: "14px 16px", borderRadius: 10, background: `${accent}08`, border: `1px solid ${accent}30`, fontSize: 11, color: "#c0a870", lineHeight: 1.8, whiteSpace: "pre-wrap" }}>
          {insight}
        </div>
      )}
      {open && loading && (
        <div style={{ marginTop: 10, padding: "12px 16px", borderRadius: 10, background: `${accent}08`, border: `1px solid ${accent}30`, fontSize: 11, color: "#8a9aaa" }}>
          ✦ Analysing Worthy Products data…
        </div>
      )}
    </div>
  );
};

// ── Category Drill-Down Modal ─────────────────────────────────────────────────
const CategoryModal = ({ category, products, currency, onClose, accent = "#3f7bdd" }) => {
  if (!category) return null;
  const top      = (products || []).filter(p => p.revenue > 0).slice(0, 10);
  const declining = (products || []).filter(p => p.yoyChange !== null && p.yoyChange < -10).slice(0, 10);
  const rising    = (products || []).filter(p => p.yoyChange !== null && p.yoyChange > 10 && p.revenue > 0).slice(0, 5);

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }} onClick={onClose}>
      <div style={{ background: "#0d0f18", border: `1px solid ${accent}50`, borderRadius: 20, padding: 28, maxWidth: 800, width: "100%", maxHeight: "80vh", overflowY: "auto" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div>
            <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 16, color: accent, fontWeight: 700 }}>{category}</div>
            <div style={{ fontSize: 11, color: T.textMuted, marginTop: 4 }}>{(products||[]).length} products · click outside to close</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: T.textMuted, fontSize: 20, cursor: "pointer" }}>✕</button>
        </div>

        {top.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, color: "#4ade80", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 10 }}>▲ Top Performers</div>
            {top.map((p, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                <div style={{ fontSize: 12, color: "#e8e4dc", flex: 1 }}>{p.name}</div>
                <div style={{ display: "flex", gap: 16, fontSize: 11 }}>
                  <span style={{ color: accent }}>{p.revenue > 0 ? `NZ$${(p.revenue/1000).toFixed(1)}k` : "—"}</span>
                  <span style={{ color: "#7C9EC9" }}>{p.qtySold} units</span>
                  {p.yoyChange !== null && <span style={{ color: p.yoyChange >= 0 ? "#4ade80" : "#f87171", fontWeight: 700 }}>{p.yoyChange >= 0 ? "▲" : "▼"}{Math.abs(p.yoyChange)}% YoY</span>}
                </div>
              </div>
            ))}
          </div>
        )}

        {rising.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, color: accent, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 10 }}>📈 Growing Fast</div>
            {rising.map((p, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                <div style={{ fontSize: 12, color: "#e8e4dc" }}>{p.name}</div>
                <span style={{ color: "#4ade80", fontWeight: 700, fontSize: 11 }}>▲{p.yoyChange}% YoY</span>
              </div>
            ))}
          </div>
        )}

        {declining.length > 0 && (
          <div>
            <div style={{ fontSize: 11, color: "#f87171", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 10 }}>▼ Declining in This Category</div>
            {declining.map((p, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                <div style={{ fontSize: 12, color: "#e8e4dc", flex: 1 }}>{p.name}</div>
                <div style={{ display: "flex", gap: 16, fontSize: 11 }}>
                  <span style={{ color: "#8a7860" }}>{p.revenue > 0 ? `NZ$${(p.revenue/1000).toFixed(1)}k` : "NZ$0"}</span>
                  <span style={{ color: "#f87171", fontWeight: 700 }}>▼{Math.abs(p.yoyChange)}% YoY</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {top.length === 0 && declining.length === 0 && (
          <div style={{ textAlign: "center", color: T.textMuted, padding: 20 }}>No product data for this category in the selected period.</div>
        )}

        <AIInsights data={products} context={`${category} category products`} currency={currency} />
      </div>
    </div>
  );
};

const AdvancedTable = ({ title, subtitle, columns, data, loading, currency = "NZD", onRowClick, aiContext, aiExtra, headerExtra, theme }) => {
  const T = theme || {
    bgCard: "linear-gradient(135deg,rgba(255,255,255,0.03),rgba(255,255,255,0.01))",
    border: "rgba(255,255,255,0.07)", bgTableHead: "#0a0c12",
    borderFaint: "rgba(255,255,255,0.05)", textHead: "#f0e8d8",
    textMuted: "#5a4030", textSub: "#5a4030", textRow: "#8a7860", textLabel: "#3a3020",
    accent: "#3f7bdd",
  };
  return (
  <div style={{ background: T.bgCard, border: `1px solid ${T.border}`, borderRadius: 20, padding: 24, display: "flex", flexDirection: "column", height: "100%" }}>
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: T.textHead, fontWeight: 600 }}>
          {title} {loading && <span style={{ fontSize: 10, color: T.accent || "#3f7bdd", marginLeft: 8 }}>Loading...</span>}
        </div>
        {headerExtra}
      </div>
      {subtitle && <div style={{ fontSize: 10, color: T.textSub, marginTop: 4 }}>{subtitle}</div>}
    </div>
    <div style={{ overflowX: "auto", overflowY: "auto", maxHeight: 350, flex: 1 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead style={{ position: "sticky", top: 0, background: T.bgTableHead, zIndex: 1 }}>
          <tr>
            {columns.map((col, i) => (
              <th key={i} style={{ textAlign: col.align || "left", padding: "8px", color: T.textLabel, textTransform: "uppercase", letterSpacing: "0.06em", fontSize: 9, fontWeight: 600, borderBottom: `1px solid ${T.borderFaint}`, whiteSpace: "nowrap" }}>{col.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {!loading && data?.map((row, i) => (
            <tr key={i} onClick={onRowClick ? () => onRowClick(row) : undefined}
              style={{ borderBottom: `1px solid ${T.borderFaint}`, cursor: onRowClick ? "pointer" : "default", transition: "background 0.15s" }}
              onMouseEnter={e => { if (onRowClick) e.currentTarget.style.background = `${T.accent || "#3f7bdd"}15`; }}
              onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}>
              {columns.map((col, j) => (
                <td key={j} style={{ padding: "8px", textAlign: col.align || "left", color: col.color || T.textRow }}>
                  {col.format ? col.format(row[col.key], currency) : row[col.key]}
                </td>
              ))}
            </tr>
          ))}
          {!loading && (!data || data.length === 0) && (
            <tr><td colSpan={columns.length} style={{ padding: "20px", textAlign: "center", color: T.textMuted }}>No data available</td></tr>
          )}
        </tbody>
      </table>
    </div>
    {aiContext && !loading && data?.length > 0 && (
      <AIInsights data={data} context={aiContext} currency={currency} extraContext={aiExtra} accent={theme?.accent || "#3f7bdd"} />
    )}
  </div>
  );
};

// ── Sales Rep Breakdown — ONE table with annual/monthly/weekly toggle ─────────
const SalesRepBreakdown = ({ salespeople, salespeopleMonthly, salespeopleWeekly, loading, currency, weeklyMonth, onWeeklyMonthChange, T, accent }) => {
  const [repView, setRepView] = useState("annual");

  const cellStyle    = (rev) => ({ padding: "10px 12px", textAlign: "right", color: rev > 0 ? "#16a34a" : T.textSub, fontSize: 12, whiteSpace: "nowrap", fontWeight: rev > 0 ? 600 : 400 });
  const repCellStyle = { padding: "10px 12px", color: T.textHead, fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" };
  const headStyle    = { padding: "10px 12px", textAlign: "right", color: T.textLabel, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", whiteSpace: "nowrap", borderBottom: `1px solid ${T.border}`, background: T.bgTableHead };
  const numStyle     = (v) => ({ padding: "10px 12px", textAlign: "right", color: T.textSub, fontSize: 12, whiteSpace: "nowrap" });

  // Annual rows (summary)
  const annualRows = (salespeople || []).map(s => ({
    name:    s.name,
    orders:  s.orders,
    revenue: Math.round(s.revenue),
    aov:     s.orders > 0 ? Math.round(s.revenue / s.orders) : 0,
  }));

  // Monthly pivot rows: cols = Jan..Dec + Total
  const monthlyPivot = salespeopleMonthly || [];

  // Weekly pivot rows for selectedMonth: cols = W1..W5 + Month Total
  const maxWeeks = 5;
  const weeklyPivot = (salespeopleWeekly || []).map(rep => ({
    name:  rep.name,
    weeks: Array.from({ length: maxWeeks }, (_, wi) => {
      const w = rep.weekly.find(x => x.month === weeklyMonth && x.week === wi + 1);
      return w || { revenue: 0, orders: 0 };
    }),
    monthTotal: rep.weekly.filter(x => x.month === weeklyMonth).reduce((s, x) => s + x.revenue, 0),
  })).filter(rep => rep.monthTotal > 0 || (salespeopleWeekly || []).length <= 3);

  const pillBtn = (active) => ({
    padding: "7px 14px", borderRadius: 9, fontSize: 12, fontWeight: 700, cursor: "pointer",
    border: active ? `1.5px solid ${accent}` : `1px solid ${T.border}`,
    background: active ? `${accent}18` : "transparent",
    color: active ? accent : T.textMuted, transition: "all 0.15s",
  });

  return (
    <div style={{ background: T.bgCard, border: `1px solid ${T.border}`, borderRadius: 20, padding: 24, marginTop: 28 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18, flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 15, color: T.textHead, fontWeight: 700 }}>
            👤 Sales by Rep {loading && <span style={{ fontSize: 10, color: accent, marginLeft: 8 }}>Loading…</span>}
          </div>
          <div style={{ fontSize: 11, color: T.textMuted, marginTop: 3 }}>
            {repView === "annual"  ? `Annual totals — ${currency}` :
             repView === "monthly" ? `Monthly breakdown by rep — ${currency}` :
                                     `Weekly breakdown for ${MONTH_NAMES[weeklyMonth]} — ${currency}`}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={() => setRepView("annual")}  style={pillBtn(repView === "annual")}>Annual</button>
          <button onClick={() => setRepView("monthly")} style={pillBtn(repView === "monthly")}>Monthly</button>
          <button onClick={() => setRepView("weekly")}  style={pillBtn(repView === "weekly")}>Weekly</button>
        </div>
      </div>

      {/* Annual view */}
      {repView === "annual" && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr>
                <th style={{ ...headStyle, textAlign: "left" }}>Sales Rep</th>
                <th style={headStyle}>Orders</th>
                <th style={headStyle}>Revenue</th>
                <th style={headStyle}>Avg Order</th>
              </tr>
            </thead>
            <tbody>
              {annualRows.length === 0 ? (
                <tr><td colSpan={4} style={{ padding: "20px 10px", textAlign: "center", color: T.textLabel }}>
                  {loading ? "Loading…" : "No sales rep data"}
                </td></tr>
              ) : annualRows.map((r, i) => (
                <tr key={i} style={{ borderBottom: `1px solid ${T.borderFaint}` }}>
                  <td style={repCellStyle}>{r.name}</td>
                  <td style={numStyle()}>{r.orders.toLocaleString()}</td>
                  <td style={{ ...cellStyle(r.revenue), color: accent, fontWeight: 700 }}>{fmtK(r.revenue, currency)}</td>
                  <td style={cellStyle(r.aov)}>{fmtK(r.aov, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Monthly view */}
      {repView === "monthly" && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr>
                <th style={{ ...headStyle, textAlign: "left" }}>Rep</th>
                {MONTH_NAMES.map(m => <th key={m} style={headStyle}>{m}</th>)}
                <th style={{ ...headStyle, color: accent }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {monthlyPivot.length === 0 ? (
                <tr><td colSpan={14} style={{ padding: "20px 10px", textAlign: "center", color: T.textLabel }}>
                  {loading ? "Loading…" : "No monthly data"}
                </td></tr>
              ) : monthlyPivot.map((rep, i) => {
                const total = rep.months.reduce((s, m) => s + m.revenue, 0);
                return (
                  <tr key={i} style={{ borderBottom: `1px solid ${T.borderFaint}` }}>
                    <td style={repCellStyle}>{rep.name}</td>
                    {rep.months.map((m, mi) => <td key={mi} style={cellStyle(m.revenue)}>{m.revenue > 0 ? fmtK(m.revenue, currency) : <span style={{ color: T.textLabel }}>—</span>}</td>)}
                    <td style={{ ...cellStyle(total), color: accent, fontWeight: 700 }}>{fmtK(Math.round(total), currency)}</td>
                  </tr>
                );
              })}
            </tbody>
            {monthlyPivot.length > 0 && (
              <tfoot>
                <tr style={{ borderTop: `1px solid ${T.border}` }}>
                  <td style={{ ...repCellStyle, color: T.textMuted, fontSize: 10 }}>TOTAL</td>
                  {MONTH_NAMES.map((m, mi) => {
                    const colTotal = monthlyPivot.reduce((s, rep) => s + (rep.months[mi]?.revenue || 0), 0);
                    return <td key={mi} style={{ ...cellStyle(colTotal), color: T.textHead, fontWeight: 700 }}>{colTotal > 0 ? fmtK(Math.round(colTotal), currency) : "—"}</td>;
                  })}
                  <td style={{ ...cellStyle(1), color: accent, fontWeight: 700 }}>{fmtK(Math.round(monthlyPivot.reduce((s, rep) => s + rep.months.reduce((ms, m) => ms + m.revenue, 0), 0)), currency)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      {/* Weekly view */}
      {repView === "weekly" && (
        <>
          <div style={{ display: "flex", gap: 4, marginBottom: 16, flexWrap: "wrap" }}>
            {MONTH_NAMES.map((mn, mi) => (
              <button key={mn} onClick={() => onWeeklyMonthChange(mi)} style={{
                padding: "5px 11px", borderRadius: 7, fontSize: 11, fontWeight: 600, cursor: "pointer",
                border: weeklyMonth === mi ? `1px solid ${accent}60` : `1px solid ${T.border}`,
                background: weeklyMonth === mi ? `${accent}15` : "transparent",
                color: weeklyMonth === mi ? accent : T.textMuted, transition: "all 0.15s",
              }}>{mn}</button>
            ))}
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={{ ...headStyle, textAlign: "left" }}>Rep</th>
                  {Array.from({ length: maxWeeks }, (_, i) => <th key={i} style={headStyle}>Week {i + 1}</th>)}
                  <th style={{ ...headStyle, color: accent }}>Month Total</th>
                </tr>
              </thead>
              <tbody>
                {weeklyPivot.length === 0 ? (
                  <tr><td colSpan={maxWeeks + 2} style={{ padding: "20px 10px", textAlign: "center", color: T.textLabel }}>
                    {loading ? "Loading…" : `No data for ${MONTH_NAMES[weeklyMonth]}`}
                  </td></tr>
                ) : weeklyPivot.map((rep, i) => (
                  <tr key={i} style={{ borderBottom: `1px solid ${T.borderFaint}` }}>
                    <td style={repCellStyle}>{rep.name}</td>
                    {rep.weeks.map((w, wi) => <td key={wi} style={cellStyle(w.revenue)}>{w.revenue > 0 ? fmtK(w.revenue, currency) : <span style={{ color: T.textLabel }}>—</span>}</td>)}
                    <td style={{ ...cellStyle(rep.monthTotal), color: accent, fontWeight: 700 }}>{fmtK(rep.monthTotal, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
};

export default function EcommerceDashboard() {
  const [activeStore,  setActiveStore]  = useState(STORES[0]);
  const [selectedYear, setSelectedYear] = useState(2026);

  const [view,         setView]         = useState("monthly");
  const [animated,     setAnimated]     = useState(true);
  const [activeMetric, setActiveMetric] = useState("revenue");
  const [hoveredMonth, setHoveredMonth] = useState(null);
  const [advancedData, setAdvancedData] = useState({});
  const [advLoading,   setAdvLoading]   = useState(false);
  const [channelTab,     setChannelTab]     = useState("odoo");
  const [categoryModal,  setCategoryModal]  = useState(null);
  const [decliningMode,  setDecliningMode]  = useState("yoy");
  const [darkMode,       setDarkMode]       = useState(false);
  const [salespeopleData, setSalespeopleData] = useState([]); // explicit state so re-renders reliably
  const [weeklyMonth,    setWeeklyMonth]    = useState(new Date().getMonth());

  // Advanced table dates auto-sync to the selected view + period
  const _thisYear    = new Date().getFullYear();
  const _todayStr    = new Date().toISOString().split('T')[0];
  const advStartDate = view === "weekly"
    ? `${selectedYear}-${String(weeklyMonth + 1).padStart(2, '0')}-01`
    : `${selectedYear}-01-01`;
  const advEndDate = view === "weekly"
    ? new Date(selectedYear, weeklyMonth + 1, 0).toISOString().split('T')[0]
    : (selectedYear === _thisYear ? _todayStr : `${selectedYear}-12-31`);

  const [, forceUpdate] = useReducer(x => x + 1, 0);
  const cacheRef      = useRef({});
  const loadingRef    = useRef({});
  const advStoreRef   = useRef(null); // tracks which store's advanced fetch is active

  const fetchYear = async (storeId, year) => {
    if (storeId !== "worthy" && storeId !== "luxe") return;
    const key = storeId + ":" + year;
    if (cacheRef.current[key] || loadingRef.current[key]) return;
    loadingRef.current[key] = true;
    forceUpdate();
    try {
      const endpoint = storeId === "luxe" ? "/api/ostendo?year=" + year : "/api/shopify?year=" + year;
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

  // Fetch monthly/weekly cost (margins) for Ostendo South from dedicated endpoint
  // Runs AFTER the main fetchYear so revenue is never blocked by cost fetch
  const fetchMargins = async (storeId, year) => {
    if (storeId !== "luxe") return;
    const mkey = `margins:${storeId}:${year}`;
    if (cacheRef.current[mkey]) return; // already fetched or in-flight
    cacheRef.current[mkey] = "loading";
    try {
      const r    = await fetch(`/api/ostendo/margins?year=${year}`);
      const json = await r.json();
      if (json.error || (!json.monthly?.length && !json.weekly?.length)) {
        cacheRef.current[mkey] = "error"; return;
      }
      const cached = cacheRef.current[`${storeId}:${year}`];
      if (!cached) { cacheRef.current[mkey] = "error"; return; }

      // Build month-name → cost map
      const mCostMap = {};
      (json.monthly || []).forEach(m => { if (m.hasCostData) mCostMap[m.month] = m.totalCost; });

      // Merge cost into monthly arrays (all / pos / online are same for Ostendo)
      const mergeMonthly = (arr) => arr.map(m => {
        const cost = mCostMap[m.month];
        if (cost == null || cost === 0) return m;
        const gp     = Math.round(m.revenue - cost);
        const margin = m.revenue > 0 ? Math.round((gp / m.revenue) * 100) : 0;
        return { ...m, totalCost: cost, grossProfit: gp, marginPct: margin, hasCostData: true, marginableRevenue: m.revenue };
      });
      cached.all    = mergeMonthly(cached.all    || []);
      cached.pos    = mergeMonthly(cached.pos    || []);
      cached.online = mergeMonthly(cached.online || []);

      // Build week key → cost map
      const wCostMap = {};
      (json.weekly || []).forEach(w => { if (w.hasCostData) wCostMap[`${w.month}_${w.week}`] = w.totalCost; });

      // Merge cost into weekly arrays
      const mergeWeekly = (arr) => arr.map(w => {
        const cost = wCostMap[`${w.month}_${w.week}`];
        if (!cost) return w;
        const gp     = Math.round(w.revenue - cost);
        const margin = w.revenue > 0 ? Math.round((gp / w.revenue) * 100) : 0;
        return { ...w, totalCost: cost, grossProfit: gp, marginPct: margin, hasCostData: true };
      });
      cached.weekly       = mergeWeekly(cached.weekly       || []);
      cached.weeklyPos    = mergeWeekly(cached.weeklyPos    || []);
      cached.weeklyOnline = mergeWeekly(cached.weeklyOnline || []);

      cacheRef.current[mkey] = "done";
      forceUpdate();
    } catch (e) {
      console.warn("[fetchMargins] failed:", e.message);
      cacheRef.current[mkey] = "error";
    }
  };

  const fetchOdoo = async (companyId, year) => {
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

    // Kick off advanced fetch in parallel — fills products/categories/SKUs.
    fetchOdooAdvanced(companyId, year);
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
      cacheRef.current[key] = {
        ...existing,
        topProducts:   json.topProducts   || [],
        topCategories: json.topCategories || [],
        fastMoving:    json.fastMoving    || [],
        slowMoving:    json.slowMoving    || [],
        advDiagnostics: json.diagnostics || null,
      };
    } catch (e) {
      console.error('[fetchOdooAdvanced] failed', e);
    }
    loadingRef.current[advKey] = false;
    forceUpdate();
  };

  // FIX 1: Parallel fetching — was sequential (await fetchYear x2 = 2× slower)
  useEffect(() => {
    if (activeStore.id !== "worthy" && activeStore.id !== "luxe" && activeStore.id !== "nova") return;
    const storeId = activeStore.id; // capture so async closure stays correct
    advStoreRef.current = storeId;  // mark this store as the active advanced fetch
    const load = async () => {
      setAdvancedData({});          // clear old store data immediately
      setAdvLoading(true);

      // Nova store — Odoo only, no advanced analytics
      if (storeId === "nova") {
        const companyId = activeStore.odooCompanyId || 1;
        await Promise.all([
          fetchOdoo(companyId, selectedYear),
          fetchOdoo(companyId, selectedYear - 1),
        ]);
        if (advStoreRef.current === storeId) setAdvLoading(false);
        return;
      }

      await Promise.all([
        fetchYear(storeId, selectedYear),
        fetchYear(storeId, selectedYear - 1),
        // Worthy North also has Odoo Sales tab
        ...(storeId === "worthy" ? [
          fetchOdoo(4, selectedYear),
          fetchOdoo(4, selectedYear - 1),
        ] : []),
      ]);
      // After revenue data is cached, fetch cost/margin data for South (non-blocking)
      if (storeId === "luxe") {
        fetchMargins(storeId, selectedYear);
        fetchMargins(storeId, selectedYear - 1);
      }
      if (advStoreRef.current !== storeId) return; // user switched store mid-fetch
      try {
        if (storeId === "luxe") {
          const res  = await fetch(`/api/ostendo/advanced?startDate=${advStartDate}&endDate=${advEndDate}`, { cache: "no-store" });
          const data = await res.json();
          if (advStoreRef.current !== storeId) return; // stale — discard
          // Map Ostendo field names → Shopify-compatible names used by display columns
          const mappedProducts    = (data.products   || []).map(p => ({ name: p.title, qtySold: p.unitsSold, revenue: p.revenue, margin: p.margin, category: p.category }));
          const mappedCategories  = (data.categories || []).map(c => ({ name: c.category, qty: c.unitsSold, revenue: c.revenue, margin: c.margin, productCount: c.productCount }));
          const mappedCustomers   = (data.customers  || []).map(c => ({ name: c.customer, orderCount: c.orderCount, revenue: c.totalSpend, status: c.status, email: c.email, aov: c.aov, lastOrderDays: c.lastOrderDays }));
          const mappedSlowMoving  = (data.slowMoving || []).map(s => ({ name: s.title, currentStock: s.stockOnHand, qtySold: s.soldInPeriod ?? 0, lockedCapital: s.capitalTied }));
          const mappedChurned     = (data.churned    || []).map(c => ({ name: c.customer, revenue: c.totalSpend, daysSince: c.lastOrderDays, lastOrderDate: c.lastOrder || null, status: c.status, orderCount: c.orderCount }));
          const mappedAtRisk      = (data.atRisk     || []).map(c => ({ name: c.customer, revenue: c.totalSpend, daysSince: c.lastOrderDays, lastOrderDate: c.lastOrder || null, status: c.status, orderCount: c.orderCount }));
          const mappedCLV         = (data.clv        || []).map(c => ({ name: c.customer, lifetimeRevenue: c.totalSpend, totalOrders: c.orderCount, avgOrderValue: c.aov, firstOrderDate: c.firstOrder || null }));
          setAdvancedData({ curr: { topProducts: mappedProducts, topCategories: mappedCategories, topCustomers: mappedCustomers, slowMoving: mappedSlowMoving, churned: mappedChurned, atRisk: mappedAtRisk, clv: mappedCLV, declining: data.declining || [], decliningMoM: data.decliningMoM || [], metrics: data.metrics || {} }, prev: {} });
        } else {
          const channelParam = channelTab !== "odoo" ? `&channel=${channelTab}` : "";
          const res  = await fetch(`/api/shopify/advanced?startDate=${advStartDate}&endDate=${advEndDate}${channelParam}`, { cache: "no-store" });
          const data = await res.json();
          if (advStoreRef.current !== storeId) return; // stale — discard
          setAdvancedData({ curr: { ...data, slowMoving: data.slowMoving || [], churned: data.churned || [] }, prev: {} });
        }
      } catch (e) {
        console.error(`[${storeId}] Advanced fetch failed:`, e);
        if (advStoreRef.current !== storeId) return;
        setAdvancedData({ curr: { topProducts: [], topCategories: [], topCustomers: [], slowMoving: [], churned: [], atRisk: [], clv: [], declining: [], metrics: {} }, prev: {} });
      }
      if (advStoreRef.current === storeId) setAdvLoading(false);
    };
    load();
  }, [activeStore.id, selectedYear, view, weeklyMonth, channelTab]); // eslint-disable-line

  // FIX 2: YoY — parallel load all years
  useEffect(() => {
    if (view === "yoy") {
      if (activeStore.id === "worthy" || activeStore.id === "luxe") {
        Promise.all(ALL_YEARS.map(yr => fetchYear(activeStore.id, yr)));
      }
      if (activeStore.id === "worthy") {
        Promise.all(ALL_YEARS.map(yr => fetchOdoo(4, yr)));
      }
      if (activeStore.id === "nova") {
        Promise.all(ALL_YEARS.map(yr => fetchOdoo(1, yr)));
      }
    }
  }, [activeStore.id, view]); // eslint-disable-line

  const getMonthly = (year) => {
    // Nova store — always Odoo
    if (activeStore.id === "nova") {
      const cached = cacheRef.current[`odoo:1:${year}`];
      return cached?.all || generateEmptyYear();
    }
    // Worthy North — Odoo tab
    if (activeStore.id === "worthy" && channelTab === "odoo") {
      const cached = cacheRef.current[`odoo:4:${year}`];
      return cached?.all || generateEmptyYear();
    }
    const cached = cacheRef.current[activeStore.id + ":" + year];
    if (!cached) {
      if (activeStore.id === "luxe") return generateEmptyYear();
      return generateMonthlyData(activeStore.id, year);
    }
    if (activeStore.id === "luxe") return cached.all || generateEmptyYear();
    if (activeStore.id !== "worthy") return cached;
    // Return channel-specific slice for worthy store
    if (channelTab === "pos")    return cached.pos    || generateEmptyYear();
    if (channelTab === "online") return cached.online || generateEmptyYear();
    return cached.all || generateEmptyYear();
  };
  const getWeekly = () => {
    if (activeStore.id === "nova") {
      return cacheRef.current[`odoo:1:${selectedYear}`]?.weekly || [];
    }
    if (activeStore.id === "worthy" && channelTab === "odoo") {
      return cacheRef.current[`odoo:4:${selectedYear}`]?.weekly || [];
    }
    const cached = cacheRef.current[activeStore.id + ":" + selectedYear];
    if (!cached) return [];
    if (activeStore.id !== "worthy") return cached.weekly || [];
    if (channelTab === "pos")    return cached.weeklyPos    || [];
    if (channelTab === "online") return cached.weeklyOnline || [];
    return cached.weekly || [];
  };
  const getSalespeople = () => {
    const cached = cacheRef.current[activeStore.id + ":" + selectedYear];
    return cached?.salespeople || [];
  };
  const getOdooSalespeople = () => cacheRef.current[`odoo:4:${selectedYear}`]?.salespeople || [];
  const getOdooSalespeopleMonthly = () => cacheRef.current[`odoo:4:${selectedYear}`]?.salespeopleMonthly || [];
  const getOdooSalespeopleWeekly  = () => cacheRef.current[`odoo:4:${selectedYear}`]?.salespeopleWeekly  || [];
  const getOdooCustomers = () => cacheRef.current[`odoo:4:${selectedYear}`]?.customers || [];
  const getOdooAtRisk        = () => cacheRef.current[`odoo:4:${selectedYear}`]?.atRisk        || [];
  const getOdooLapsed        = () => cacheRef.current[`odoo:4:${selectedYear}`]?.lapsed        || [];
  const getOdooTopProducts   = () => cacheRef.current[`odoo:4:${selectedYear}`]?.topProducts   || [];
  const getOdooTopCategories = () => cacheRef.current[`odoo:4:${selectedYear}`]?.topCategories || [];
  const getOdooFastMoving    = () => cacheRef.current[`odoo:4:${selectedYear}`]?.fastMoving    || [];
  const getOdooSlowMoving    = () => cacheRef.current[`odoo:4:${selectedYear}`]?.slowMoving    || [];
  const isOdooAdvLoading     = () => !!loadingRef.current[`odoo:4:${selectedYear}:adv`];
  const getLuxeSalespeopleMonthly = () => cacheRef.current[`luxe:${selectedYear}`]?.salespeopleMonthly || [];
  const getLuxeSalespeopleWeekly  = () => cacheRef.current[`luxe:${selectedYear}`]?.salespeopleWeekly  || [];
  const isLoading = (year) => {
    if (activeStore.id === "nova") return !!loadingRef.current[`odoo:1:${year}`];
    if (activeStore.id === "worthy" && channelTab === "odoo") return !!loadingRef.current[`odoo:4:${year}`];
    return !!loadingRef.current[activeStore.id + ":" + year];
  };
  const hasData = (year) => {
    if (activeStore.id === "nova") return !!cacheRef.current[`odoo:1:${year}`];
    if (activeStore.id === "worthy" && channelTab === "odoo") return !!cacheRef.current[`odoo:4:${year}`];
    return (activeStore.id !== "worthy" && activeStore.id !== "luxe") || !!cacheRef.current[activeStore.id + ":" + year];
  };
  const anyLoading = isLoading(selectedYear) || isLoading(selectedYear - 1);

  const curr       = getMonthly(selectedYear);
  const prev       = getMonthly(selectedYear - 1);
  const prevLoaded = hasData(selectedYear - 1);
  const hasCost    = curr.some(d => d.hasCostData);

  const momData = curr.map((d, i) => {
    const rev       = d.revenue   || 0;
    const cst       = d.totalCost || 0;
    const dynGp     = d.hasCostData ? rev - cst : null;
    const dynMargin = (d.hasCostData && rev > 0) ? Math.round((dynGp / rev) * 100) : null;
    return {
      ...d,
      grossProfit: d.grossProfit !== undefined ? d.grossProfit : dynGp,
      marginPct:   d.marginPct   !== undefined ? d.marginPct   : dynMargin,
      prevRevenue: prev[i]?.revenue || 0,
      prevOrders:  prev[i]?.orders  || 0,
      momGrowth:   prevLoaded ? calcGrowth(rev, prev[i]?.revenue || 0) : null,
    };
  });

  const totalRev  = curr.reduce((s, d) => s + (d.revenue        || 0), 0);
  const prevRev   = prev.reduce((s, d) => s + (d.revenue        || 0), 0);
  const totalOrd  = curr.reduce((s, d) => s + (d.orders         || 0), 0);
  const prevOrd   = prev.reduce((s, d) => s + (d.orders         || 0), 0);
  const totalCost = curr.reduce((s, d) => s + (d.totalCost      || 0), 0);
  const totalNewC = curr.reduce((s, d) => s + (d.newCustomers   || 0), 0);
  const totalDisc = curr.reduce((s, d) => s + (d.totalDiscounts || 0), 0);
  const totalRet  = curr.reduce((s, d) => s + (d.returns        || 0), 0);
  const avgAOV    = totalOrd ? Math.round(totalRev / totalOrd) : 0;
  const prevAOV   = prevOrd  ? Math.round(prevRev  / prevOrd)  : 0;

  const totalMargRev = curr.reduce((s, d) => s + (d.marginableRevenue || 0), 0);
  const trueMargin   = totalMargRev > 0 ? (totalMargRev - totalCost) / totalMargRev : null;
  // FIX 3: Fall back to simple rev-cost GP when marginableRevenue is 0
  const gp       = trueMargin !== null ? Math.round(totalRev * trueMargin)
                 : hasCost    ? totalRev - totalCost
                 : null;
  const gpMargin = trueMargin !== null ? Math.round(trueMargin * 100) : null;

  const accent  = activeStore.color;
  const accent2 = activeStore.accent2 || activeStore.color;
  const accentDark = activeStore.dark || activeStore.color;

  // ── Theme ────────────────────────────────────────────────────────────────
  // Products stores use blue palette; Oceania uses warm orange/red palette
  const isOceania = activeStore.id === "nova";
  const T = darkMode ? {
    bg:          "#080A10",
    bgCard:      "linear-gradient(135deg,rgba(255,255,255,0.03),rgba(255,255,255,0.01))",
    bgHeader:    "rgba(8,10,16,0.92)",
    bgInput:     "#0a0c12",
    bgTableHead: "#0a0c12",
    bgModal:     "#0d0f18",
    border:      "rgba(255,255,255,0.07)",
    borderFaint: "rgba(255,255,255,0.05)",
    borderAccent:"rgba(255,255,255,0.06)",
    text:        "#e8e0d0",
    textHead:    "#f0f4ff",
    textMuted:   isOceania ? "#5a3020" : "#3a4060",
    textSub:     isOceania ? "#4a3020" : "#384060",
    textRow:     isOceania ? "#8a6850" : "#607098",
    textLabel:   isOceania ? "#3a2818" : "#2a3858",
    scrollTrack: "#0d0f18",
    scrollThumb: isOceania ? "#3a1a08" : "#1a2448",
    shadow:      "0 4px 24px rgba(0,0,0,0.4)",
  } : {
    bg:          isOceania ? "#fdf7f4" : "#f6f8ff",
    bgCard:      "#ffffff",
    bgHeader:    "rgba(255,255,255,0.98)",
    bgInput:     isOceania ? "#fdf0e8" : "#eef2ff",
    bgTableHead: isOceania ? "#fdf0e8" : "#f0f4ff",
    bgModal:     "#ffffff",
    border:      isOceania ? "rgba(177,57,36,0.14)" : "rgba(33,86,194,0.14)",
    borderFaint: isOceania ? "rgba(177,57,36,0.07)" : "rgba(33,86,194,0.07)",
    borderAccent:isOceania ? "rgba(177,57,36,0.10)" : "rgba(33,86,194,0.10)",
    text:        "#111827",
    textHead:    "#0f172a",
    textMuted:   "#6b7280",
    textSub:     "#9ca3af",
    textRow:     "#1e293b",
    textLabel:   "#4b5563",
    scrollTrack: isOceania ? "#fceee8" : "#e8edff",
    scrollThumb: isOceania ? "#d97444" : "#6b8ef5",
    shadow:      "0 2px 16px rgba(0,0,50,0.08)",
  };
  // Inject accent into T so sub-components can access it
  T.accent = accent;
  const revG   = prevLoaded ? calcGrowth(totalRev, prevRev) : null;
  const ordG   = prevLoaded ? calcGrowth(totalOrd, prevOrd) : null;
  const aovG   = prevLoaded ? calcGrowth(avgAOV,   prevAOV) : null;

  const yoyData = ALL_YEARS.map(yr => {
    const d   = getMonthly(yr);
    const rev = d.reduce((s, x) => s + (x.revenue   || 0), 0);
    const ord = d.reduce((s, x) => s + (x.orders    || 0), 0);
    const cst = d.reduce((s, x) => s + (x.totalCost || 0), 0);
    const gpY = d.some(x => x.hasCostData) ? rev - cst : null;
    return {
      year: String(yr), revenue: rev, orders: ord,
      aov: ord ? Math.round(rev / ord) : 0,
      grossProfit: gpY,
      margin: (gpY !== null && rev > 0) ? Math.round((gpY / rev) * 100) : null,
      loaded: hasData(yr),
    };
  });

  const metrics = [
    { id: "revenue",  label: "Revenue" },
    { id: "orders",   label: "Orders" },
    { id: "aov",      label: "Avg Order Value" },
    { id: "convRate", label: "Conv. Rate" },
  ];

  const renderStatus = (s) => {
    const c = { "New": "#9EC97C", "Active": accent, "At Risk": "#f87171" }[s] || "#8a9aaa";
    return <span style={{ color: c, fontWeight: 600 }}>{s}</span>;
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
    { key: "revenue", label: "Revenue",  align: "right", color: "#9EC97C", format: (v, c) => fmtK(v, c) },
    { key: "margin",  label: "Margin",   align: "right", format: v => v ? `${v}%` : "—" },
  ];
  const customerColumns = [
    { key: "name",       label: "Customer", color: T.text },
    { key: "orderCount", label: "Orders",   align: "center", color: "#7C9EC9" },
    { key: "revenue",    label: "Spend",    align: "right",  color: accent, format: (v, c) => fmtK(v, c) },
    { key: "status",     label: "Status",   align: "center", format: v => renderStatus(v) },
  ];
  const categoryColumns = [
    { key: "name",    label: "Category",   color: T.text },
    { key: "qty",     label: "Units Sold", align: "right" },
    { key: "revenue", label: "Revenue",    align: "right", color: accent,    format: (v, c) => fmtK(v, c) },
    { key: "margin",  label: "Margin",     align: "right", color: "#C97C9E", format: v => v != null ? `${v}%` : "—" },
  ];
  const slowMovingColumns = [
    { key: "name",          label: "Product",      color: T.text },
    { key: "currentStock",  label: "Stock",        align: "right", color: accent },
    { key: "qtySold",       label: "Sold",         align: "right", color: "#9EC97C" },
    { key: "lockedCapital", label: "Value Locked", align: "right", color: "#f87171", format: (v, c) => fmtK(v, c) },
  ];
  const churnedColumns = [
    { key: "name",          label: "Customer",   color: T.text },
    { key: "lastOrderDate", label: "Last Order", align: "right", format: v => v ? new Date(v).toLocaleDateString() : "—" },
    { key: "revenue",       label: "Spend",      align: "right", color: accent, format: (v, c) => fmtK(v, c) },
    { key: "status",        label: "Risk",       align: "center", format: () => <span style={{ color: "#f87171", fontWeight: 700 }}>LAPSED</span> },
  ];
  const atRiskColumns = [
    { key: "name",          label: "Customer",    color: T.text },
    { key: "daysSince",     label: "Days Silent", align: "center", format: v => <span style={{ color: v >= 75 ? "#f87171" : accent, fontWeight: 700 }}>{v}d</span> },
    { key: "lastOrderDate", label: "Last Order",  align: "right",  format: v => v ? new Date(v).toLocaleDateString() : "—" },
    { key: "revenue",       label: "Lifetime $",  align: "right",  color: accent, format: (v, c) => fmtK(v, c) },
    { key: "orderCount",    label: "Orders",      align: "center", color: "#7C9EC9" },
  ];
  const clvColumns = [
    { key: "name",            label: "Customer",    color: T.text },
    { key: "lifetimeRevenue", label: "Lifetime $",  align: "right", color: accent, format: (v, c) => fmtK(v, c) },
    { key: "totalOrders",     label: "Orders",      align: "center", color: "#7C9EC9" },
    { key: "avgOrderValue",   label: "Avg Order",   align: "right",  color: "#9EC97C", format: (v, c) => fmtK(v, c) },
    { key: "firstOrderDate",  label: "First Order", align: "right",  format: v => v ? new Date(v).toLocaleDateString() : "—" },
  ];
  const decliningColumns = [
    { key: "name",        label: "Product",    color: T.text },
    { key: "revenue",     label: "This Period", align: "right", color: "#f87171",  format: (v, c) => fmtK(v, c) },
    { key: "prevRevenue", label: "Prior Year",  align: "right", color: "#8a9aaa",  format: (v, c) => fmtK(v, c) },
    { key: "change",      label: "Change",      align: "center", format: v => v !== null ? <span style={{ color: "#f87171", fontWeight: 700 }}>▼ {Math.abs(v)}%</span> : "—" },
    { key: "qtySold",     label: "Units Now",   align: "right", color: "#aa8a8a" },
    { key: "prevQtySold", label: "Units Prev",  align: "right", color: "#6a7a8a" },
  ];
  const salespersonColumns = [
    { key: "name",    label: "Sales Rep",    color: T.text },
    { key: "orders",  label: "Orders",       align: "right", color: "#7C9EC9" },
    { key: "revenue", label: "Revenue",      align: "right", color: accent, format: (v, c) => fmtK(Math.round(v), c) },
    { key: "aov",     label: "Avg Order",    align: "right", color: "#9EC97C", format: (v, c) => fmtK(v, c) },
  ];
  const salespeople = salespeopleData.map(s => ({
    ...s,
    revenue: Math.round(s.revenue),
    aov: s.orders > 0 ? Math.round(s.revenue / s.orders) : 0,
  }));

  // FIX 4: was [activeStore, selectedYear] — object reference caused potential infinite loop
  useEffect(() => {
    setAnimated(false);
    setTimeout(() => setAnimated(true), 50);
    // Sync salespeople for newly selected year if already cached
    const cached = cacheRef.current[activeStore.id + ":" + selectedYear];
    if (cached?.salespeople) setSalespeopleData(cached.salespeople);
    else setSalespeopleData([]);
  }, [activeStore.id, selectedYear]);

  return (
    <div style={{ minHeight: "100vh", background: T.bg, fontFamily: "'DM Sans',sans-serif", color: T.text, paddingBottom: 40, transition: "background 0.3s, color 0.3s" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600;9..40,700;9..40,800&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        ::-webkit-scrollbar{width:4px}::-webkit-scrollbar-track{background:${T.scrollTrack}}::-webkit-scrollbar-thumb{background:${T.scrollThumb};border-radius:4px}
        input[type="date"]::-webkit-calendar-picker-indicator { filter: ${darkMode ? "invert(1) opacity(0.4)" : "opacity(0.5)"}; }
      `}</style>

      {/* HEADER */}
      <div style={{ borderBottom: `1px solid ${T.borderAccent}`, padding: "20px 32px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 16, background: T.bgHeader, position: "sticky", top: 0, zIndex: 100, backdropFilter: "blur(12px)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {/* Logo — white on dark, black on light */}
          <img
            src={darkMode ? "/logo-white.png" : "/logo-black.png"}
            alt="Worthy Logo"
            style={{ height: 40, width: "auto", objectFit: "contain", filter: darkMode ? "none" : "none" }}
          />
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 15, fontWeight: 600, color: T.textHead, letterSpacing: "0.05em" }}>{activeStore.name}</div>
              {anyLoading && <div style={{ fontSize: 10, color: accent, background: `${accent}15`, border: `1px solid ${accent}30`, padding: "2px 8px", borderRadius: 20 }}>LOADING…</div>}
            </div>
            <div style={{ fontSize: 11, color: T.textMuted, letterSpacing: "0.04em", marginTop: 2 }}>
              {activeStore.id === "worthy" ? "Live Shopify + Odoo" : activeStore.id === "luxe" ? "Live Ostendo" : "Live Odoo"} · Performance Overview
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {STORES.map(s => <StorePill key={s.id} store={s} active={activeStore.id === s.id} onClick={() => setActiveStore(s)} />)}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {ALL_YEARS.map(y => {
            const loaded   = hasData(y);
            const fetching = isLoading(y);
            return (
              <button key={y} onClick={() => setSelectedYear(y)} style={{ padding: "6px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600, border: selectedYear === y ? `1px solid ${accent}` : `1px solid ${T.border}`, background: selectedYear === y ? `${accent}20` : "transparent", color: selectedYear === y ? accent : loaded ? (darkMode ? "#c0a870" : "#6a5040") : T.textMuted, cursor: "pointer", transition: "all 0.2s", position: "relative" }}>
                {y}
                {fetching && <span style={{ position: "absolute", top: -3, right: -3, width: 7, height: 7, borderRadius: "50%", background: accent }} />}
                {!fetching && loaded && selectedYear !== y && (activeStore.id === "worthy" || activeStore.id === "luxe") && <span style={{ position: "absolute", top: -3, right: -3, width: 7, height: 7, borderRadius: "50%", background: "#4ade80", opacity: 0.7 }} />}
              </button>
            );
          })}
        </div>
      </div>

      {/* CHANNEL SUB-TABS — shown for Worthy North (Odoo/Online/POS) and Nova (Odoo only) */}
      {(activeStore.id === "worthy" || activeStore.id === "nova") && (
        <div style={{ borderBottom: `1px solid ${T.borderFaint}`, padding: "0 32px", background: T.bgHeader, display: "flex", alignItems: "center", gap: 4 }}>
          {(activeStore.id === "worthy"
            ? [
                { id: "odoo",   label: "☁️  Odoo Sales" },
                { id: "online", label: "🌐  Online Sales" },
                { id: "pos",    label: "🏪  POS Sales" },
              ]
            : [
                { id: "odoo",   label: "☁️  Odoo Sales" },
              ]
          ).map(tab => (
            <button key={tab.id} onClick={() => setChannelTab(tab.id)} style={{
              padding: "14px 20px", fontSize: 12, fontWeight: 700, letterSpacing: "0.04em",
              border: "none", borderBottom: channelTab === tab.id ? `2px solid ${accent}` : "2px solid transparent",
              background: "transparent", color: channelTab === tab.id ? accent : T.textSub,
              cursor: "pointer", transition: "all 0.2s", marginBottom: -1,
            }}>
              {tab.label}
            </button>
          ))}
          <div style={{ marginLeft: "auto", fontSize: 10, color: T.textLabel, paddingRight: 8 }}>
            {channelTab === "odoo"   ? "Odoo ERP invoices · ex-tax revenue" :
             channelTab === "pos"    ? "In-person POS orders only" :
                                      "Online store orders · includes sessions & conv rate"}
          </div>
        </div>
      )}

      <div style={{ padding: "32px 32px 0" }}>
        {/* View toggle */}
        <div style={{ display: "flex", gap: 4, marginBottom: 28, background: darkMode ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.04)", borderRadius: 10, padding: 4, border: `1px solid ${T.border}`, width: "fit-content" }}>
          {[["monthly","Monthly Performance"],["weekly","Weekly Breakdown"],["yoy","Year over Year"]].map(([v, lbl]) => (
            <button key={v} onClick={() => setView(v)} style={{ padding: "8px 20px", borderRadius: 7, fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer", transition: "all 0.2s", letterSpacing: "0.04em", background: view === v ? `linear-gradient(135deg,${accent}30,${accent}15)` : "transparent", color: view === v ? accent : T.textMuted, boxShadow: view === v ? `inset 0 0 0 1px ${accent}30` : "none" }}>{lbl}</button>
          ))}
        </div>

        {/* KPIs */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 16, marginBottom: 32 }}>
          <KPICard darkMode={darkMode} label="Total Revenue"   value={totalRev} growth={revG} icon="◎" accent={accent}    sub="currency" animated={animated} currency={activeStore.currency} />
          <KPICard darkMode={darkMode} label="Total Orders"    value={totalOrd} growth={ordG} icon="▣" accent="#7C9EC9"   sub="count"    animated={animated} currency={activeStore.currency} />
          <KPICard darkMode={darkMode} label="Avg Order Value" value={avgAOV}   growth={aovG} icon="◆" accent="#9EC97C"   sub="currency" animated={animated} currency={activeStore.currency} />
          <KPICard darkMode={darkMode} label={hasCost && gpMargin !== null ? `Gross Profit · ${gpMargin}% margin` : "Gross Profit"} value={gp || 0} growth={revG} icon="◈" accent="#C97C9E" sub="currency" animated={animated} currency={activeStore.currency} />
        </div>

        {view === "monthly" ? (
          <>
            {/* Metric tabs */}
            <div style={{ display: "flex", gap: 4, marginBottom: 20, flexWrap: "wrap" }}>
              {metrics.map(m => (
                <button key={m.id} onClick={() => setActiveMetric(m.id)} style={{ padding: "7px 16px", borderRadius: 8, fontSize: 11, fontWeight: 600, border: activeMetric === m.id ? `1px solid ${accent}60` : `1px solid ${T.border}`, background: activeMetric === m.id ? `${accent}15` : (darkMode ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.02)"), color: activeMetric === m.id ? accent : T.textMuted, cursor: "pointer", transition: "all 0.2s", letterSpacing: "0.05em", textTransform: "uppercase" }}>{m.label}</button>
              ))}
            </div>

            {/* Area chart */}
            <div style={{ background: T.bgCard, border: `1px solid ${T.border}`, borderRadius: 20, padding: 24, marginBottom: 24 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
                <div>
                  <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 14, color: T.textHead, fontWeight: 600 }}>Monthly {metrics.find(m => m.id === activeMetric)?.label} — {selectedYear}</div>
                  <div style={{ fontSize: 11, color: T.textSub, marginTop: 3 }}>{prevLoaded ? `vs ${selectedYear - 1}` : `Loading ${selectedYear - 1}…`}</div>
                </div>
                <div style={{ display: "flex", gap: 16, fontSize: 11, color: "#5a5040" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 20, height: 3, borderRadius: 2, background: accent, display: "inline-block" }} />{selectedYear}</span>
                  <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 20, height: 3, borderRadius: 2, background: "rgba(255,255,255,0.2)", display: "inline-block" }} />{selectedYear - 1}</span>
                </div>
              </div>
              <ResponsiveContainer width="100%" height={300}>
                <ComposedChart data={momData} margin={{ top: 5, right: 10, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="ag" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor={accent} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={accent} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={darkMode ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.07)"} />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: T.textMuted }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: T.textLabel }} axisLine={false} tickLine={false}
                    tickFormatter={activeMetric === "revenue" || activeMetric === "aov" ? v => `$${(v/1000).toFixed(0)}k` : activeMetric === "convRate" ? v => `${v}%` : v => v >= 1000 ? `${(v/1000).toFixed(1)}k` : v} />
                  <Tooltip content={<CustomTooltip currency={activeStore.currency} accent={accent} />} />
                  <Area type="monotone" dataKey={activeMetric} name={metrics.find(m => m.id === activeMetric)?.label} stroke={accent} strokeWidth={2.5} fill="url(#ag)" dot={false} activeDot={{ r: 5, fill: accent, stroke: "#080A10", strokeWidth: 2 }} />
                  <Line type="monotone" dataKey={activeMetric === "revenue" ? "prevRevenue" : activeMetric === "orders" ? "prevOrders" : activeMetric} name={`${selectedYear - 1}`} stroke="rgba(255,255,255,0.2)" strokeWidth={1.5} strokeDasharray="4 4" dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 2.2fr", gap: 20, marginBottom: 24 }}>
              {/* YoY bar chart */}
              <div style={{ background: T.bgCard, border: `1px solid ${T.border}`, borderRadius: 20, padding: 24 }}>
                <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: T.textHead, fontWeight: 600, marginBottom: 6 }}>YoY Revenue Growth</div>
                <div style={{ fontSize: 11, color: T.textSub, marginBottom: 18 }}>% vs same month {selectedYear - 1}</div>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={momData} margin={{ top: 5, right: 5, bottom: 0, left: -10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={darkMode ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.07)"} vertical={false} />
                    <XAxis dataKey="month" tick={{ fontSize: 10, fill: "#4a4030" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 9, fill: darkMode ? "#3a3020" : "#9090b0" }} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} />
                    <Tooltip content={<CustomTooltip accent={accent} />} />
                    <ReferenceLine y={0} stroke="rgba(255,255,255,0.15)" strokeWidth={1} />
                    <Bar dataKey="momGrowth" name="Growth" radius={[4, 4, 0, 0]} fill={accent} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Monthly table */}
              <div style={{ background: T.bgCard, border: `1px solid ${T.border}`, borderRadius: 20, padding: 24 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                  <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: T.textHead, fontWeight: 600 }}>Monthly Breakdown</div>
                  <div style={{ fontSize: 10, color: hasCost ? "#C97C9E" : "#5a4030" }}>
                    {hasCost ? "✦ Real cost from Shopify" : "Add read_inventory scope for margin"} · {activeStore.currency}
                  </div>
                </div>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead>
                      <tr>
                        {["Month","Revenue","Cost","Gross Profit","Margin","Orders","AOV","New Cust.","Returns","YoY"].map(h => (
                          <th key={h} style={{ textAlign: "left", padding: "0 8px 10px", color: T.textLabel, textTransform: "uppercase", letterSpacing: "0.06em", fontSize: 9, fontWeight: 600, borderBottom: `1px solid ${T.borderFaint}`, whiteSpace: "nowrap" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {momData.map((row, i) => {
                        const has = row.revenue > 0;
                        return (
                          <tr key={i} style={{ borderBottom: `1px solid ${T.borderFaint}`, background: hoveredMonth === i ? "rgba(255,255,255,0.04)" : "transparent", transition: "background 0.15s" }}
                            onMouseEnter={() => setHoveredMonth(i)} onMouseLeave={() => setHoveredMonth(null)}>
                            <td style={{ padding: "8px", color: "#8a7860", fontWeight: 600 }}>{row.month}</td>
                            <td style={{ padding: "8px", color: T.text, fontWeight: 600 }}>{has ? fmtK(row.revenue, activeStore.currency) : <span style={{ color: T.textLabel }}>—</span>}</td>
                            <td style={{ padding: "8px", color: "#aa8a6a" }}>{has && row.totalCost != null ? fmtK(row.totalCost, activeStore.currency) : <span style={{ color: T.textLabel }}>—</span>}</td>
                            <td style={{ padding: "8px", color: "#C97C9E", fontWeight: 600 }}>{has && row.grossProfit != null ? fmtK(row.grossProfit, activeStore.currency) : <span style={{ color: T.textLabel }}>—</span>}</td>
                            <td style={{ padding: "8px" }}>{has ? <MarginBar value={row.marginPct} accent={accent} /> : <span style={{ color: T.textLabel }}>—</span>}</td>
                            <td style={{ padding: "8px", color: "#8a9aaa" }}>{has ? row.orders : <span style={{ color: T.textLabel }}>—</span>}</td>
                            <td style={{ padding: "8px", color: "#8aaa8a" }}>{has ? fmtK(row.aov, activeStore.currency) : <span style={{ color: T.textLabel }}>—</span>}</td>
                            <td style={{ padding: "8px", color: "#9EC97C" }}>{row.newCustomers > 0 ? row.newCustomers : <span style={{ color: T.textLabel }}>—</span>}</td>
                            <td style={{ padding: "8px", color: "#aa8a8a" }}>{row.returns > 0 ? row.returns : <span style={{ color: T.textLabel }}>—</span>}</td>
                            <td style={{ padding: "8px" }}><GrowthBadge value={row.momGrowth} /></td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr style={{ borderTop: `1px solid ${T.border}` }}>
                        <td style={{ padding: "10px 8px", color: T.textMuted, fontSize: 10, fontWeight: 700 }}>TOTAL</td>
                        <td style={{ padding: "10px 8px", color: T.textHead, fontWeight: 700 }}>{fmtK(totalRev, activeStore.currency)}</td>
                        <td style={{ padding: "10px 8px", color: "#aa8a6a", fontWeight: 700 }}>{hasCost ? fmtK(totalCost, activeStore.currency) : "—"}</td>
                        <td style={{ padding: "10px 8px", color: "#C97C9E", fontWeight: 700 }}>{gp !== null ? fmtK(gp, activeStore.currency) : "—"}</td>
                        <td style={{ padding: "10px 8px" }}><MarginBar value={gpMargin} accent={accent} /></td>
                        <td style={{ padding: "10px 8px", color: "#8a9aaa", fontWeight: 700 }}>{totalOrd}</td>
                        <td style={{ padding: "10px 8px", color: "#8aaa8a", fontWeight: 700 }}>{fmtK(avgAOV, activeStore.currency)}</td>
                        <td style={{ padding: "10px 8px", color: "#9EC97C", fontWeight: 700 }}>{totalNewC || "—"}</td>
                        <td style={{ padding: "10px 8px", color: "#aa8a8a", fontWeight: 700 }}>{totalRet || "—"}</td>
                        <td style={{ padding: "10px 8px" }}><GrowthBadge value={revG} /></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            </div>
          </>
        ) : view === "weekly" ? (
          /* WEEKLY VIEW */
          (() => {
            const allWeekly  = getWeekly();
            const weeklyData = allWeekly.filter(w => w.month === weeklyMonth);
            const wTotalRev  = weeklyData.reduce((s, w) => s + w.revenue, 0);
            const wTotalOrd  = weeklyData.reduce((s, w) => s + w.orders, 0);
            const wTotalDisc = weeklyData.reduce((s, w) => s + w.totalDiscounts, 0);
            const wTotalNewC = weeklyData.reduce((s, w) => s + w.newCustomers, 0);
            const wAvgAOV    = wTotalOrd > 0 ? Math.round(wTotalRev / wTotalOrd) : 0;
            const wHasCost   = weeklyData.some(w => w.hasCostData);
            const wTotalCost = weeklyData.reduce((s, w) => s + (w.totalCost || 0), 0);
            const wTotalGP   = wHasCost ? wTotalRev - wTotalCost : null;
            const wMarginPct = wHasCost && wTotalRev > 0 ? Math.round(((wTotalRev - wTotalCost) / wTotalRev) * 100) : null;
            return (
              <>
                {/* Month selector */}
                <div style={{ display: "flex", gap: 4, marginBottom: 20, flexWrap: "wrap" }}>
                  {MONTH_NAMES.map((mn, mi) => (
                    <button key={mn} onClick={() => setWeeklyMonth(mi)} style={{
                      padding: "7px 14px", borderRadius: 8, fontSize: 11, fontWeight: 600,
                      border: weeklyMonth === mi ? `1px solid ${accent}60` : `1px solid ${T.border}`,
                      background: weeklyMonth === mi ? `${accent}15` : (darkMode ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.02)"),
                      color: weeklyMonth === mi ? accent : T.textMuted,
                      cursor: "pointer", transition: "all 0.2s", letterSpacing: "0.05em", textTransform: "uppercase",
                    }}>{mn}</button>
                  ))}
                </div>

                {/* Weekly bar chart */}
                <div style={{ background: T.bgCard, border: `1px solid ${T.border}`, borderRadius: 20, padding: 24, marginBottom: 24 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                    <div>
                      <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 14, color: T.textHead, fontWeight: 600 }}>
                        Weekly Revenue — {MONTH_NAMES[weeklyMonth]} {selectedYear}
                      </div>
                      <div style={{ fontSize: 11, color: T.textSub, marginTop: 3 }}>Week-by-week sales breakdown</div>
                    </div>
                    {wTotalRev > 0 && (
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: 11, color: T.textLabel }}>Month Total</div>
                        <div style={{ fontSize: 15, fontWeight: 700, color: accent }}>{fmtK(wTotalRev, activeStore.currency)}</div>
                      </div>
                    )}
                  </div>
                  {weeklyData.length > 0 && wTotalRev > 0 ? (
                    <ResponsiveContainer width="100%" height={280}>
                      <BarChart data={weeklyData} margin={{ top: 5, right: 10, bottom: 0, left: 0 }}>
                        <defs>
                          <linearGradient id="wg" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={accent} stopOpacity={0.9} />
                            <stop offset="100%" stopColor={accent} stopOpacity={0.5} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke={darkMode ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.07)"} vertical={false} />
                        <XAxis dataKey="label" tick={{ fontSize: 12, fill: T.textMuted }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fontSize: 10, fill: T.textLabel }} axisLine={false} tickLine={false}
                          tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                        <Tooltip content={<CustomTooltip currency={activeStore.currency} accent={accent} />} />
                        <Bar dataKey="revenue" name="Revenue" fill="url(#wg)" radius={[6, 6, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div style={{ height: 280, display: "flex", alignItems: "center", justifyContent: "center", color: T.textLabel, fontSize: 13 }}>
                      {anyLoading ? "Loading weekly data…" : `No sales recorded in ${MONTH_NAMES[weeklyMonth]} ${selectedYear}`}
                    </div>
                  )}
                </div>

                {/* Weekly table */}
                <div style={{ background: T.bgCard, border: `1px solid ${T.border}`, borderRadius: 20, padding: 24 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                    <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: T.textHead, fontWeight: 600 }}>
                      Weekly Breakdown — {MONTH_NAMES[weeklyMonth]} {selectedYear}
                    </div>
                    <div style={{ fontSize: 10, color: T.textMuted }}>{activeStore.currency}</div>
                  </div>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                      <thead>
                        <tr>
                          {["Week","Date Range","Revenue","Gross Profit","Margin","Orders","AOV","Discounts","New Cust.","vs Prev Week"].map(h => (
                            <th key={h} style={{ textAlign: "left", padding: "0 8px 10px", color: T.textLabel, textTransform: "uppercase", letterSpacing: "0.06em", fontSize: 9, fontWeight: 600, borderBottom: `1px solid ${T.borderFaint}`, whiteSpace: "nowrap" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {weeklyData.length === 0 ? (
                          <tr>
                            <td colSpan={10} style={{ padding: "28px 8px", color: T.textLabel, textAlign: "center" }}>
                              {anyLoading ? "Loading…" : "No weekly data available for this month"}
                            </td>
                          </tr>
                        ) : weeklyData.map((row, i) => {
                          const prevW = weeklyData[i - 1];
                          const wGrowth = prevW ? calcGrowth(row.revenue, prevW.revenue) : null;
                          const has = row.revenue > 0;
                          return (
                            <tr key={i} style={{ borderBottom: `1px solid ${T.borderFaint}`, background: hoveredMonth === 100 + i ? "rgba(255,255,255,0.04)" : "transparent", transition: "background 0.15s" }}
                              onMouseEnter={() => setHoveredMonth(100 + i)} onMouseLeave={() => setHoveredMonth(null)}>
                              <td style={{ padding: "10px 8px", color: accent, fontWeight: 700, fontSize: 12 }}>Week {row.week}</td>
                              <td style={{ padding: "10px 8px", color: T.textSub, fontSize: 10 }}>{row.dateRange}</td>
                              <td style={{ padding: "10px 8px", color: T.text, fontWeight: 600 }}>{has ? fmtK(row.revenue, activeStore.currency) : <span style={{ color: T.textLabel }}>—</span>}</td>
                              <td style={{ padding: "10px 8px", color: "#C97C9E", fontWeight: 600 }}>{has && row.grossProfit != null ? fmtK(row.grossProfit, activeStore.currency) : <span style={{ color: T.textLabel }}>—</span>}</td>
                              <td style={{ padding: "10px 8px" }}>{has && row.marginPct != null ? <MarginBar value={row.marginPct} accent={accent} /> : <span style={{ color: T.textLabel }}>—</span>}</td>
                              <td style={{ padding: "10px 8px", color: "#8a9aaa" }}>{has ? row.orders : <span style={{ color: T.textLabel }}>—</span>}</td>
                              <td style={{ padding: "10px 8px", color: "#8aaa8a" }}>{has ? fmtK(row.aov, activeStore.currency) : <span style={{ color: T.textLabel }}>—</span>}</td>
                              <td style={{ padding: "10px 8px", color: "#aa8a6a" }}>{row.totalDiscounts > 0 ? fmtK(row.totalDiscounts, activeStore.currency) : <span style={{ color: T.textLabel }}>—</span>}</td>
                              <td style={{ padding: "10px 8px", color: "#9EC97C" }}>{row.newCustomers > 0 ? row.newCustomers : <span style={{ color: T.textLabel }}>—</span>}</td>
                              <td style={{ padding: "10px 8px" }}><GrowthBadge value={wGrowth} /></td>
                            </tr>
                          );
                        })}
                      </tbody>
                      {weeklyData.length > 0 && wTotalRev > 0 && (
                        <tfoot>
                          <tr style={{ borderTop: `1px solid ${T.border}` }}>
                            <td colSpan={2} style={{ padding: "10px 8px", color: T.textMuted, fontSize: 10, fontWeight: 700 }}>MONTH TOTAL</td>
                            <td style={{ padding: "10px 8px", color: T.textHead, fontWeight: 700 }}>{fmtK(wTotalRev, activeStore.currency)}</td>
                            <td style={{ padding: "10px 8px", color: "#C97C9E", fontWeight: 700 }}>{wTotalGP != null ? fmtK(wTotalGP, activeStore.currency) : "—"}</td>
                            <td style={{ padding: "10px 8px" }}>{wMarginPct != null ? <MarginBar value={wMarginPct} accent={accent} /> : <span style={{ color: T.textLabel }}>—</span>}</td>
                            <td style={{ padding: "10px 8px", color: "#8a9aaa", fontWeight: 700 }}>{wTotalOrd}</td>
                            <td style={{ padding: "10px 8px", color: "#8aaa8a", fontWeight: 700 }}>{fmtK(wAvgAOV, activeStore.currency)}</td>
                            <td style={{ padding: "10px 8px", color: "#aa8a6a", fontWeight: 700 }}>{wTotalDisc > 0 ? fmtK(wTotalDisc, activeStore.currency) : "—"}</td>
                            <td style={{ padding: "10px 8px", color: "#9EC97C", fontWeight: 700 }}>{wTotalNewC || "—"}</td>
                            <td />
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                </div>
              </>
            );
          })()
        ) : (
          /* YOY VIEW */
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 24 }}>
              <div style={{ background: T.bgCard, border: `1px solid ${T.border}`, borderRadius: 20, padding: 24 }}>
                <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: T.textHead, fontWeight: 600, marginBottom: 4 }}>Annual Revenue</div>
                <div style={{ fontSize: 11, color: T.textSub, marginBottom: 20 }}>Year-over-Year</div>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={yoyData} margin={{ top: 5, right: 10, bottom: 0, left: 0 }}>
                    <defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={accent} stopOpacity={1} /><stop offset="100%" stopColor={accent} stopOpacity={0.5} /></linearGradient></defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={darkMode ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.07)"} vertical={false} />
                    <XAxis dataKey="year" tick={{ fontSize: 12, fill: T.textMuted, fontFamily: "'DM Sans',sans-serif", fontWeight: 600 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: T.textLabel }} axisLine={false} tickLine={false} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                    <Tooltip content={<CustomTooltip currency={activeStore.currency} accent={accent} />} />
                    <Bar dataKey="revenue" name="Revenue" fill="url(#bg)" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div style={{ background: T.bgCard, border: `1px solid ${T.border}`, borderRadius: 20, padding: 24 }}>
                <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: T.textHead, fontWeight: 600, marginBottom: 4 }}>Orders & AOV Trend</div>
                <div style={{ fontSize: 11, color: T.textSub, marginBottom: 20 }}>Volume and value evolution</div>
                <ResponsiveContainer width="100%" height={240}>
                  <ComposedChart data={yoyData} margin={{ top: 5, right: 10, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={darkMode ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.07)"} />
                    <XAxis dataKey="year" tick={{ fontSize: 12, fill: T.textMuted, fontFamily: "'DM Sans',sans-serif", fontWeight: 600 }} axisLine={false} tickLine={false} />
                    <YAxis yAxisId="l" tick={{ fontSize: 10, fill: T.textLabel }} axisLine={false} tickLine={false} tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v} />
                    <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 10, fill: T.textLabel }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} />
                    <Tooltip content={<CustomTooltip currency={activeStore.currency} accent={accent} />} />
                    <Bar yAxisId="l" dataKey="orders" name="Orders" fill="#7C9EC960" radius={[6, 6, 0, 0]} />
                    <Line yAxisId="r" type="monotone" dataKey="aov" name="AOV" stroke="#9EC97C" strokeWidth={3} dot={{ fill: "#9EC97C", r: 6, stroke: "#080A10", strokeWidth: 2 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div style={{ background: T.bgCard, border: `1px solid ${T.border}`, borderRadius: 20, padding: 24 }}>
              <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: T.textHead, fontWeight: 600, marginBottom: 20 }}>Year-over-Year Summary</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 12 }}>
                {yoyData.map((yr, i) => {
                  const p   = yoyData[i - 1];
                  const rg  = p ? calcGrowth(yr.revenue, p.revenue) : null;
                  const og  = p ? calcGrowth(yr.orders,  p.orders)  : null;
                  const isCur = yr.year === String(selectedYear);
                  return (
                    <div key={yr.year} style={{ borderRadius: 14, padding: "18px 20px", border: `1px solid ${isCur ? accent + "40" : "rgba(255,255,255,0.06)"}`, background: isCur ? `${accent}08` : "rgba(255,255,255,0.01)", opacity: yr.loaded ? 1 : 0.3, transition: "opacity 0.4s" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                        <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 18, color: isCur ? accent : "#6a5a40", fontWeight: 700 }}>{yr.year}</div>
                        {isLoading(parseInt(yr.year)) && <span style={{ fontSize: 9, color: accent }}>…</span>}
                      </div>
                      <div style={{ marginBottom: 8 }}>
                        <div style={{ fontSize: 9, color: T.textLabel, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 2 }}>Revenue</div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>{fmt(yr.revenue, activeStore.currency)}</div>
                        {rg !== null && <div style={{ fontSize: 11, color: rg >= 0 ? "#4ade80" : "#f87171", marginTop: 2, fontWeight: 600 }}>{fmtPct(rg)} vs {p.year}</div>}
                      </div>
                      <div style={{ marginBottom: 8 }}>
                        <div style={{ fontSize: 9, color: T.textLabel, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 2 }}>Gross Profit</div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "#C97C9E" }}>
                          {yr.grossProfit !== null ? fmt(yr.grossProfit, activeStore.currency) : <span style={{ color: T.textLabel }}>—</span>}
                          {yr.margin !== null && <span style={{ fontSize: 10, color: "#7a5a6a", marginLeft: 5 }}>{yr.margin}%</span>}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: 9, color: T.textLabel, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 2 }}>Orders</div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "#8a9aaa" }}>{yr.orders.toLocaleString()}</div>
                        {og !== null && <div style={{ fontSize: 11, color: og >= 0 ? "#4ade80" : "#f87171", marginTop: 2, fontWeight: 600 }}>{fmtPct(og)} vs {p.year}</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}

        {/* ODOO ADVANCED SECTION — Worthy North Odoo tab */}
        {activeStore.id === "worthy" && channelTab === "odoo" && (
          <>
            {/* Odoo: top customers, at-risk, lapsed */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 20, marginBottom: 24, marginTop: 28 }}>
              <AdvancedTable theme={T} title="🏆 Top Customers — Odoo" subtitle="Ranked by net invoice revenue (customers only — suppliers excluded)"
                loading={isLoading(selectedYear)} currency={activeStore.currency} data={getOdooCustomers().slice(0, 20)}
                columns={[
                  { key: "name",    label: "Customer", color: T.text },
                  { key: "orders",  label: "Orders",   align: "center", color: "#7C9EC9" },
                  { key: "revenue", label: "Revenue",  align: "right",  color: accent, format: (v, c) => fmtK(v, c) },
                  { key: "aov",     label: "Avg Order",align: "right",  color: "#9EC97C", format: (v, c) => fmtK(v, c) },
                  { key: "status",  label: "Status",   align: "center", format: v => renderStatus(v) },
                ]}
                aiContext="Odoo top customers"
                aiExtra="These are B2B wholesale customers on credit terms. Note any dairies, gas stations or corner stores. Flag anyone showing 'At Risk' or 'Lapsed' status — call them this week."
              />
              <AdvancedTable theme={T} title="🔶 At-Risk Customers (45–90 days)" subtitle="Overdue for reorder — call before they lapse"
                loading={isLoading(selectedYear)} currency={activeStore.currency}
                data={getOdooAtRisk().slice(0, 20).map(c => ({ name: c.name, revenue: c.revenue, daysSince: c.daysSince, lastOrderDate: c.lastOrderDate, status: c.status, orderCount: c.orders }))}
                columns={atRiskColumns} aiContext="at-risk Odoo customers"
                aiExtra="Suggest which rep should phone each customer this week. These reorder windows close fast."
              />
              <AdvancedTable theme={T} title="🛑 Lapsed Customers (>90 days)" subtitle="Stopped ordering — win-back priority"
                loading={isLoading(selectedYear)} currency={activeStore.currency}
                data={getOdooLapsed().slice(0, 20).map(c => ({ name: c.name, revenue: c.revenue, daysSince: c.daysSince, lastOrderDate: c.lastOrderDate, orderCount: c.orders }))}
                columns={churnedColumns} aiContext="lapsed Odoo customers"
                aiExtra="Likely lost to DKSH, Gilmours, or Stock4Shop. Recommend a visit + offer for the top 5 by revenue."
              />
            </div>

            {/* Odoo: top products + top categories */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 20, marginBottom: 24 }}>
              <AdvancedTable theme={T} title="📂 Top Categories — Odoo" subtitle="Where the revenue actually comes from"
                loading={isLoading(selectedYear) || isOdooAdvLoading()} currency={activeStore.currency}
                data={getOdooTopCategories().slice(0, 15).map(c => ({ name: c.category, revenue: c.revenue, qty: c.unitsSold, margin: c.margin, productCount: c.productCount }))}
                columns={[
                  { key: "name",         label: "Category",     color: T.text },
                  { key: "productCount", label: "# Products",   align: "center", color: "#7C9EC9" },
                  { key: "qty",          label: "Units Sold",   align: "right",  color: "#9EC97C" },
                  { key: "revenue",      label: "Revenue",      align: "right",  color: accent, format: (v, c) => fmtK(v, c) },
                  { key: "margin",       label: "Margin",       align: "right",  color: "#C97C9E", format: v => v !== null ? `${v}%` : "—" },
                ]}
                aiContext="top Odoo categories"
                aiExtra="Which categories drive the business? Flag any with margin < 15% — those need a price review."
              />
              <AdvancedTable theme={T} title="🥇 Top Products — Odoo" subtitle="High performers by net revenue"
                loading={isLoading(selectedYear) || isOdooAdvLoading()} currency={activeStore.currency}
                data={getOdooTopProducts().slice(0, 25).map(p => ({ name: p.title, code: p.code, category: p.category, qtySold: p.unitsSold, revenue: p.revenue, margin: p.margin }))}
                columns={[
                  { key: "name",     label: "Product",  color: T.text },
                  { key: "category", label: "Category", color: T.textMuted },
                  { key: "qtySold",  label: "Units",    align: "right", color: "#9EC97C" },
                  { key: "revenue",  label: "Revenue",  align: "right", color: accent, format: (v, c) => fmtK(v, c) },
                  { key: "margin",   label: "Margin",   align: "right", color: "#C97C9E", format: v => v !== null ? `${v}%` : "—" },
                ]}
                aiContext="top Odoo products"
                aiExtra="Are these stocked correctly? Imported lines with long lead times need 60+ days of cover. Flag anything trending down vs prior month."
              />
            </div>

            {/* Odoo: fast & slow movers */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 20, marginBottom: 24 }}>
              <AdvancedTable theme={T} title="🚀 Fast-Moving SKUs — Odoo" subtitle="Highest velocity — keep stocked & push wider"
                loading={isLoading(selectedYear) || isOdooAdvLoading()} currency={activeStore.currency} data={getOdooFastMoving().slice(0, 20)}
                columns={[
                  { key: "name",         label: "Product",     color: T.text },
                  { key: "category",     label: "Category",    color: T.textMuted },
                  { key: "unitsSold",    label: "Units Sold",  align: "right", color: "#16a34a" },
                  { key: "currentStock", label: "On Hand",     align: "right", color: T.textSub },
                  { key: "revenue",      label: "Revenue",     align: "right", color: accent, format: (v, c) => fmtK(v, c) },
                  { key: "margin",       label: "Margin",      align: "right", color: "#C97C9E", format: v => v !== null ? `${v}%` : "—" },
                ]}
                aiContext="fast-moving Odoo SKUs"
                aiExtra="These are your engine. Make sure cover ratio is at least 6 weeks. Are any close to stockout?"
              />
              <AdvancedTable theme={T} title="🐌 Slow-Moving SKUs — Odoo" subtitle="Capital sitting on the shelf — clear, bundle, or discontinue"
                loading={isLoading(selectedYear) || isOdooAdvLoading()} currency={activeStore.currency} data={getOdooSlowMoving().slice(0, 20)}
                columns={[
                  { key: "name",          label: "Product",       color: T.text },
                  { key: "category",      label: "Category",      color: T.textMuted },
                  { key: "currentStock",  label: "On Hand",       align: "right", color: T.textSub },
                  { key: "qtySold",       label: "Units Sold",    align: "right", color: T.textMuted },
                  { key: "lockedCapital", label: "Capital Tied",  align: "right", color: "#f87171", format: (v, c) => fmtK(v, c) },
                ]}
                aiContext="slow-moving Odoo SKUs"
                aiExtra="Top 3 by capital tied — recommend specific clearance pricing or rep push. Anything with an expiry risk?"
              />
            </div>

            {/* Odoo salesperson breakdown — single table with view toggle */}
            <SalesRepBreakdown
              salespeople={getOdooSalespeople()}
              salespeopleMonthly={getOdooSalespeopleMonthly()}
              salespeopleWeekly={getOdooSalespeopleWeekly()}
              loading={isLoading(selectedYear)}
              currency={activeStore.currency}
              weeklyMonth={weeklyMonth}
              onWeeklyMonthChange={setWeeklyMonth}
              T={T} accent={accent}
            />
          </>
        )}

        {/* ADVANCED ANALYTICS — not shown for Odoo tab (Shopify-based) or nova */}
        {(activeStore.id === "luxe" || (activeStore.id === "worthy" && channelTab !== "odoo")) && (
          <>
            {/* Category drill-down modal */}
            <CategoryModal
              category={categoryModal?.name}
              products={categoryModal?.products}
              currency={activeStore.currency}
              onClose={() => setCategoryModal(null)}
              accent={accent}
            />

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 40, marginBottom: 16, padding: "14px 20px", background: T.bgCard, border: `1px solid ${accent}30`, borderRadius: 12, flexWrap: "wrap", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 18 }}>📊</span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: T.textHead }}>
                    {view === "weekly"
                      ? `${MONTH_NAMES[weeklyMonth]} ${selectedYear} — Week by Week`
                      : view === "yoy"
                      ? `All Years — Year on Year`
                      : `${selectedYear} — Jan to ${MONTH_NAMES[new Date().getMonth()]}`}
                  </div>
                  <div style={{ fontSize: 11, color: T.textMuted }}>Advanced analytics auto-synced to selected period</div>
                </div>
              </div>
              <span style={{ fontSize: 11, color: accent, fontWeight: 600, background: `${accent}12`, padding: "4px 12px", borderRadius: 20 }}>
                {advStartDate} → {advEndDate}
              </span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 20, marginBottom: 24 }}>
              <AdvancedTable theme={T} title="Top Categories" subtitle="Click a category to drill down into its products" loading={advLoading} currency={activeStore.currency} data={displayCategories} columns={categoryColumns}
                onRowClick={row => setCategoryModal({ name: row.name, products: advancedData.curr?.categoryProducts?.[row.name] || [] })}
                aiContext="top revenue categories"
                aiExtra="Focus on whether confectionery vs beverages balance aligns with current NZ season. Flag any categories at risk from competitors like DKSH or Gilmours." />
              <AdvancedTable theme={T} title="Top Products"    subtitle="High Performers" loading={advLoading} currency={activeStore.currency} data={displayProducts}   columns={productColumns}  aiContext="top selling products"
                aiExtra="Note any imported products in the top list — these need healthy stock levels given import lead times. Flag anything that could be pushed harder online." />
              <AdvancedTable theme={T} title="Top Customers"   subtitle="Loyalty & Spend" loading={advLoading} currency={activeStore.currency} data={displayCustomers}  columns={customerColumns} aiContext="top customers by spend"
                aiExtra="Consider customer types: dairies, supermarkets, gas stations, night markets. Identify any at risk of switching to competitors. Note credit vs B2C customers if distinguishable." />
            </div>

            {/* Salesperson table — POS only for Worthy North */}
            {activeStore.id !== "luxe" && channelTab === "pos" && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 20, marginBottom: 24 }}>
                <AdvancedTable theme={T} title="👤 Sales by Rep" subtitle="POS performance by sales representative" loading={isLoading(selectedYear)} currency={activeStore.currency} data={salespeople} columns={salespersonColumns} aiContext="sales rep performance"
                  aiExtra="Hari+Nayan=Auckland East/West/North Shore. Rubin=South Auckland (Pukekohe/Waiuku/Tuakau). Savan=Waikato+Hawke's Bay. Naitik=Northland/Whangārei. Flag underperformance vs territory size and whether any rep is losing ground to competitors in their area." />
              </div>
            )}

            {/* Salesperson breakdown — Worthy Products South (Ostendo) */}
            {activeStore.id === "luxe" && (
              <div style={{ marginBottom: 24 }}>
                <SalesRepBreakdown
                  salespeople={getSalespeople()}
                  salespeopleMonthly={getLuxeSalespeopleMonthly()}
                  salespeopleWeekly={getLuxeSalespeopleWeekly()}
                  loading={isLoading(selectedYear)}
                  currency={activeStore.currency}
                  weeklyMonth={weeklyMonth}
                  onWeeklyMonthChange={setWeeklyMonth}
                  T={T} accent={accent}
                />
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 20, marginBottom: 24 }}>
              <AdvancedTable theme={T} title="🚀 Fast-Moving SKUs" subtitle="Highest velocity by units sold — keep stocked & push wider"
                loading={advLoading} currency={activeStore.currency}
                data={(advancedData.curr?.topProducts || []).slice().sort((a, b) => (b.unitsSold || 0) - (a.unitsSold || 0)).slice(0, 20).map(p => ({ name: p.title, category: p.category, unitsSold: p.unitsSold, revenue: p.revenue, margin: p.margin }))}
                columns={[
                  { key: "name",      label: "Product",    color: T.text },
                  { key: "category",  label: "Category",   color: T.textMuted },
                  { key: "unitsSold", label: "Units Sold", align: "right", color: "#16a34a" },
                  { key: "revenue",   label: "Revenue",    align: "right", color: accent, format: (v, c) => fmtK(v, c) },
                  { key: "margin",    label: "Margin",     align: "right", color: "#C97C9E", format: v => v !== null ? `${v}%` : "—" },
                ]}
                aiContext="fast-moving SKUs"
                aiExtra="Ensure 6+ weeks of cover on these. Flag any close to stockout — these drive the business."
              />
              <AdvancedTable theme={T} title="⚠️ Slow-Moving Inventory" subtitle="Capital tied up in low-turnover stock"    loading={advLoading} currency={activeStore.currency} data={advancedData.curr?.slowMoving || []} columns={slowMovingColumns} aiContext="slow-moving inventory"
                aiExtra="Pay special attention to imported products — slow-moving imports tie up capital for months and risk obsolescence. Suggest clearance pricing, bundle deals, or targeted rep push for specific territories." />
              <AdvancedTable theme={T} title="🛑 Lapsed Customers (>90 Days)" subtitle="High-value clients who stopped ordering" loading={advLoading} currency={activeStore.currency} data={advancedData.curr?.churned    || []} columns={churnedColumns} aiContext="lapsed customers"
                aiExtra="These are likely dairies, gas stations or corner stores that may have switched to Gilmours, DKSH or Stock4Shop. Suggest which rep should personally visit and what offer might win them back." />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 20, marginBottom: 24 }}>
              <AdvancedTable theme={T} title="🔶 At-Risk Customers (45–90 Days)" subtitle="Overdue for a reorder — act before they lapse" loading={advLoading} currency={activeStore.currency} data={displayAtRisk} columns={atRiskColumns} aiContext="at-risk customers" />
              <AdvancedTable
                title="📉 Declining Products"
                subtitle={decliningMode === "yoy" ? "Down >20% vs same period last year" : "Down >20% vs prior period"}
                loading={advLoading}
                currency={activeStore.currency}
                data={decliningMode === "yoy" ? displayDeclining : (advancedData.curr?.decliningMoM || []).slice(0, 30)}
                columns={decliningColumns}
                aiContext="declining products"
                headerExtra={
                  <div style={{ display: "flex", gap: 4 }}>
                    {[["yoy","YoY"],["mom","MoM"]].map(([m, lbl]) => (
                      <button key={m} onClick={() => setDecliningMode(m)} style={{ padding: "3px 10px", borderRadius: 6, fontSize: 10, fontWeight: 700, border: `1px solid ${decliningMode === m ? accent : "rgba(255,255,255,0.1)"}`, background: decliningMode === m ? `${accent}25` : "transparent", color: decliningMode === m ? accent : "#4a4030", cursor: "pointer" }}>{lbl}</button>
                    ))}
                  </div>
                }
              />
              <AdvancedTable theme={T} title="💎 Customer Lifetime Value" subtitle="Top accounts by total spend" loading={advLoading} currency={activeStore.currency} data={displayCLV} columns={clvColumns} aiContext="customer lifetime value" />
            </div>
          </>
        )}

        {/* Footer */}
        <div style={{ marginTop: 32, padding: "16px 24px", borderRadius: 14, background: T.bgCard, border: `1px solid ${T.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div style={{ display: "flex", gap: 28, flexWrap: "wrap" }}>
            {[
              ["New Customers",   totalNewC || "—",                                                                                                     "#8aaa8a"],
              ["Total Discounts", fmtK(totalDisc, activeStore.currency),                                                                                accent],
              ["Discount Impact", advancedData.curr?.metrics?.discountImpactRatio ? `${(advancedData.curr.metrics.discountImpactRatio * 100).toFixed(1)}%` : "—", "#f87171"],
              ["Gross Profit",    gp !== null ? fmtK(gp, activeStore.currency) : "—",                                                                   "#C97C9E"],
            ].map(([lbl, val, clr]) => (
              <div key={lbl}>
                <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.12em", color: T.textLabel, marginBottom: 2 }}>{lbl}</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: clr }}>{val}</div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 11, color: T.textMuted, letterSpacing: "0.06em" }}>WORTHY PRODUCTS · FY{selectedYear}</div>
        </div>
      </div>
    </div>
  );
}