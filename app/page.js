"use client";

import { useState, useEffect, useRef, useReducer } from "react";
import {
  Area, BarChart, Bar, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ComposedChart, ReferenceLine
} from "recharts";

const STORES = [
  { id: "worthy", name: "Worthy Products North", color: "#C9A84C", icon: "✦", currency: "NZD" },
  { id: "luxe",   name: "Worthy Products South (Coming Soon)",  color: "#7C9EC9", icon: "◈", currency: "NZD" },
  { id: "nova",   name: "Worthy Oceania / Fabrics (Coming Soon)",  color: "#C97C9E", icon: "⬡", currency: "NZD" },
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

const generateEmptyYear = () => {
  return MONTH_NAMES.map(m => ({
    month: m, revenue: 0, totalCost: 0, grossProfit: 0, marginPct: null,
    orders: 0, returns: 0, sessions: 0, totalDiscounts: 0, aov: 0,
    convRate: 0, newCustomers: 0, hasCostData: true, marginableRevenue: 0
  }));
};

const calcGrowth = (c, p) => (!p || p === 0) ? null : +((( c - p) / p) * 100).toFixed(1);
const fmt  = (n, cur = "NZD") => new Intl.NumberFormat("en-NZ", { style: "currency", currency: cur, maximumFractionDigits: 0 }).format(n || 0);
const fmtK = (n, cur = "NZD") => {
  if (n === null || n === undefined) return "—";
  const s = cur === "NZD" ? "NZ$" : "$";
  return Math.abs(n) >= 1000 ? `${s}${(n / 1000).toFixed(1)}k` : `${s}${n}`;
};
const fmtPct = (n) => (n === null || n === undefined) ? "—" : `${n > 0 ? "+" : ""}${n}%`;

const GrowthBadge = ({ value }) => {
  if (value === null || value === undefined) return <span style={{ color: "#3a3020" }}>—</span>;
  const pos = value >= 0;
  return <span style={{ color: pos ? "#4ade80" : "#f87171", fontWeight: 700 }}>{pos ? "▲" : "▼"} {Math.abs(value)}%</span>;
};

const MarginBar = ({ value }) => {
  if (value === null || value === undefined) return <span style={{ color: "#3a3020" }}>—</span>;
  const color = value > 40 ? "#4ade80" : value > 20 ? "#C9A84C" : "#f87171";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
      <div style={{ width: 30, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.07)" }}>
        <div style={{ width: `${Math.min(Math.max(value, 0), 100)}%`, height: "100%", background: color, borderRadius: 2 }} />
      </div>
      <span style={{ color, fontWeight: 700, fontSize: 11 }}>{value}%</span>
    </div>
  );
};

const CustomTooltip = ({ active, payload, label, currency = "NZD" }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "rgba(10,12,18,0.97)", border: "1px solid rgba(201,168,76,0.3)", borderRadius: 10, padding: "12px 16px", fontSize: 12, color: "#e8e0d0", boxShadow: "0 8px 32px rgba(0,0,0,0.5)" }}>
      <div style={{ fontFamily: "'Cinzel',serif", color: "#C9A84C", marginBottom: 8, fontSize: 13 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: p.color, display: "inline-block" }} />
          <span style={{ color: "#a09070" }}>{p.name}:</span>
          <span style={{ color: "#f0e8d8", fontWeight: 600 }}>
            {["Revenue","AOV","Gross Profit"].includes(p.name) ? fmt(p.value, currency) : p.name === "Growth" ? fmtPct(p.value) : String(p.value?.toLocaleString?.() ?? p.value)}
          </span>
        </div>
      ))}
    </div>
  );
};

const KPICard = ({ label, value, growth, icon, accent, sub, animated, currency = "NZD" }) => {
  const [display, setDisplay] = useState(0);
  const isPos = !growth || growth >= 0;
  useEffect(() => {
    const t = value || 0;
    if (!animated || t === 0) { setDisplay(t); return; }
    let cur = 0; const step = t / 40;
    const timer = setInterval(() => { cur += step; if (cur >= t) { setDisplay(t); clearInterval(timer); } else setDisplay(Math.round(cur)); }, 20);
    return () => clearInterval(timer);
  }, [value, animated]);
  return (
    <div style={{ background: "linear-gradient(135deg,rgba(255,255,255,0.04),rgba(255,255,255,0.01))", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, padding: "22px 24px", position: "relative", overflow: "hidden", transition: "transform 0.2s,box-shadow 0.2s", cursor: "default" }}>
      <div style={{ position: "absolute", top: -30, right: -30, width: 120, height: 120, background: `radial-gradient(circle,${accent}20 0%,transparent 70%)`, borderRadius: "50%" }} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ fontSize: 22, marginBottom: 8 }}>{icon}</div>
        <div style={{ fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 20, color: growth === null ? "#4a4030" : isPos ? "#4ade80" : "#f87171", background: growth === null ? "rgba(255,255,255,0.04)" : isPos ? "rgba(74,222,128,0.1)" : "rgba(248,113,113,0.1)" }}>
          {growth === null ? "No prior yr" : `${isPos ? "▲" : "▼"} ${Math.abs(growth)}%`}
        </div>
      </div>
      <div style={{ fontFamily: "'Cinzel',serif", fontSize: 26, fontWeight: 700, color: "#f0e8d8", letterSpacing: "-0.02em", lineHeight: 1.1, marginBottom: 4 }}>
        {sub === "currency" ? fmtK(display, currency) : sub === "pct" ? `${Number(display).toFixed(1)}%` : display.toLocaleString()}
      </div>
      <div style={{ fontSize: 11, color: "#6b6050", textTransform: "uppercase", letterSpacing: "0.12em" }}>{label}</div>
    </div>
  );
};

const StorePill = ({ store, active, onClick }) => (
  <button onClick={onClick} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 16px", borderRadius: 40, border: active ? `1px solid ${store.color}` : "1px solid rgba(255,255,255,0.1)", background: active ? `${store.color}18` : "transparent", color: active ? store.color : "#6b6050", cursor: "pointer", fontSize: 12, fontWeight: 600, letterSpacing: "0.05em", transition: "all 0.2s", whiteSpace: "nowrap" }}>
    <span style={{ fontSize: 14 }}>{store.icon}</span>{store.name}
    {active && <span style={{ width: 6, height: 6, borderRadius: "50%", background: store.color }} />}
  </button>
);

const AdvancedTable = ({ title, subtitle, columns, data, loading, currency = "NZD", topRightElement }) => (
  <div style={{ background: "linear-gradient(135deg,rgba(255,255,255,0.03),rgba(255,255,255,0.01))", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 20, padding: 24, display: "flex", flexDirection: "column", height: "100%" }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
      <div>
        <div style={{ fontFamily: "'Cinzel',serif", fontSize: 13, color: "#f0e8d8", fontWeight: 600 }}>
          {title} {loading && <span style={{ fontSize: 10, color: "#C9A84C", marginLeft: 8 }}>Loading...</span>}
        </div>
        {subtitle && <div style={{ fontSize: 10, color: "#5a4030", marginTop: 4 }}>{subtitle}</div>}
      </div>
      {topRightElement}
    </div>
    <div style={{ overflowX: "auto", overflowY: "auto", maxHeight: 350, flex: 1 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
        <thead style={{ position: "sticky", top: 0, background: "#0a0c12", zIndex: 1 }}>
          <tr>
            {columns.map((col, i) => (
              <th key={i} style={{ textAlign: col.align || "left", padding: "8px", color: "#3a3020", textTransform: "uppercase", letterSpacing: "0.06em", fontSize: 9, fontWeight: 600, borderBottom: "1px solid rgba(255,255,255,0.05)", whiteSpace: "nowrap" }}>{col.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {!loading && data?.map((row, i) => (
            <tr key={i} style={{ borderBottom: "1px solid rgba(255,255,255,0.03)", transition: "background 0.15s" }}>
              {columns.map((col, j) => (
                <td key={j} style={{ padding: "8px", textAlign: col.align || "left", color: col.color || "#8a7860" }}>
                  {col.format ? col.format(row[col.key], currency) : row[col.key]}
                </td>
              ))}
            </tr>
          ))}
          {!loading && (!data || data.length === 0) && (
            <tr><td colSpan={columns.length} style={{ padding: "20px", textAlign: "center", color: "#5a4030" }}>No data available</td></tr>
          )}
        </tbody>
      </table>
    </div>
  </div>
);

export default function EcommerceDashboard() {
  const [activeStore, setActiveStore]   = useState(STORES[0]);
  const [selectedYear, setSelectedYear] = useState(2026);
  
  // --- NEW DATE STATES FOR ADVANCED FETCH ---
  const todayStr = new Date().toISOString().split('T')[0];
  const firstOfYear = `${new Date().getFullYear()}-01-01`;
  const [startDate, setStartDate] = useState(firstOfYear);
  const [endDate, setEndDate] = useState(todayStr);

  const [view, setView]                 = useState("monthly");
  const [animated, setAnimated]         = useState(true);
  const [activeMetric, setActiveMetric] = useState("revenue");
  const [hoveredMonth, setHoveredMonth] = useState(null);
  
  const [advancedData, setAdvancedData] = useState({});
  const [advLoading, setAdvLoading] = useState(false);
  const [tableMonth, setTableMonth] = useState("all");

  const [, forceUpdate] = useReducer(x => x + 1, 0);
  const cacheRef   = useRef({});
  const loadingRef = useRef({});

  const fetchYear = async (storeId, year) => {
    if (storeId !== "worthy") return;
    const key = storeId + ":" + year;
    if (cacheRef.current[key] || loadingRef.current[key]) return;

    loadingRef.current[key] = true;
    forceUpdate();

    try {
      const r = await fetch("/api/shopify?year=" + year);
      const json = await r.json();
      if (json.monthly && json.monthly.length > 0) {
        cacheRef.current[key] = json.monthly;
      } else {
        cacheRef.current[key] = generateEmptyYear();
      }
    } catch (err) {
      cacheRef.current[key] = generateEmptyYear();
    }
    
    loadingRef.current[key] = false;
    forceUpdate(); 
  };

  useEffect(() => {
    if (activeStore.id !== "worthy") return;

    const loadDashboardData = async () => {
      // 1. Fetch main charts sequentially (Still respects selectedYear UI)
      await fetchYear(activeStore.id, selectedYear);
      await fetchYear(activeStore.id, selectedYear - 1);

      // 2. Fetch advanced tables using Custom Dates
      setAdvLoading(true);
      try {
        const currResponse = await fetch(`/api/shopify/advanced?startDate=${startDate}&endDate=${endDate}`);
        const curr = await currResponse.json();
        
        console.log("API RAW DATA:", curr);

        setAdvancedData({ 
          curr: {
            ...curr,
            slowMoving: curr.slowMoving || [],
            churned: curr.churned || []
          }, 
          // Previous period fetch disabled for now to respect custom date logic without breaking YoY arrays
          prev: {} 
        });
      } catch(e) {
        console.error("Advanced fetch failed", e);
      }
      setAdvLoading(false);
    };

    loadDashboardData();
  }, [activeStore.id, selectedYear, startDate, endDate]); // Added date dependencies here!

  useEffect(() => {
    if (view === "yoy" && activeStore.id === "worthy") {
      const loadAllYears = async () => {
        for (const yr of ALL_YEARS) {
          await fetchYear(activeStore.id, yr);
        }
      };
      loadAllYears();
    }
  }, [activeStore.id, view]); 

  const getMonthly = (year) => {
    const key = activeStore.id + ":" + year;
    return cacheRef.current[key] || generateMonthlyData(activeStore.id, year);
  };
  const isLoading = (year) => !!loadingRef.current[activeStore.id + ":" + year];
  const hasData   = (year) => activeStore.id !== "worthy" || !!cacheRef.current[activeStore.id + ":" + year];
  const anyLoading = isLoading(selectedYear) || isLoading(selectedYear - 1);

  const curr = getMonthly(selectedYear);
  const prev = getMonthly(selectedYear - 1);
  const prevLoaded = hasData(selectedYear - 1);
  const hasCost    = curr.some(d => d.hasCostData);

  const momData = curr.map((d, i) => {
    const rev = d.revenue || 0;
    const cst = d.totalCost || 0;
    const dynamicGp = d.hasCostData ? rev - cst : null;
    const dynamicMargin = (d.hasCostData && rev > 0) ? Math.round((dynamicGp / rev) * 100) : null;

    return {
      ...d,
      grossProfit: d.grossProfit !== undefined ? d.grossProfit : dynamicGp,
      marginPct: d.marginPct !== undefined ? d.marginPct : dynamicMargin,
      prevRevenue: prev[i]?.revenue || 0,
      prevOrders:  prev[i]?.orders  || 0,
      momGrowth:   prevLoaded ? calcGrowth(rev, prev[i]?.revenue || 0) : null,
    };
  });

  const totalRev  = curr.reduce((s, d) => s + (d.revenue       || 0), 0);
  const prevRev   = prev.reduce((s, d) => s + (d.revenue       || 0), 0);
  const totalOrd  = curr.reduce((s, d) => s + (d.orders        || 0), 0);
  const prevOrd   = prev.reduce((s, d) => s + (d.orders        || 0), 0);
  const totalCost = curr.reduce((s, d) => s + (d.totalCost     || 0), 0);
  const totalNewC = curr.reduce((s, d) => s + (d.newCustomers  || 0), 0);
  const totalDisc = curr.reduce((s, d) => s + (d.totalDiscounts|| 0), 0);
  const totalRet  = curr.reduce((s, d) => s + (d.returns       || 0), 0);
  const avgAOV    = totalOrd ? Math.round(totalRev / totalOrd) : 0;
  const prevAOV   = prevOrd  ? Math.round(prevRev  / prevOrd)  : 0;
  
  const totalMarginableRev = curr.reduce((s, d) => s + (d.marginableRevenue || 0), 0);
  const trueOverallMargin  = (totalMarginableRev > 0) ? ((totalMarginableRev - totalCost) / totalMarginableRev) : null;
  const gp         = trueOverallMargin !== null ? Math.round(totalRev * trueOverallMargin) : null;
  const gpMargin = trueOverallMargin !== null ? Math.round(trueOverallMargin * 100) : null;
  const accent   = activeStore.color;

  const revG = prevLoaded ? calcGrowth(totalRev, prevRev) : null;
  const ordG = prevLoaded ? calcGrowth(totalOrd, prevOrd) : null;
  const aovG = prevLoaded ? calcGrowth(avgAOV,   prevAOV) : null;

  const yoyData = ALL_YEARS.map(yr => {
    const d   = getMonthly(yr);
    const rev = d.reduce((s, x) => s + (x.revenue   || 0), 0);
    const ord = d.reduce((s, x) => s + (x.orders    || 0), 0);
    const cst = d.reduce((s, x) => s + (x.totalCost || 0), 0);
    const gpY = d.some(x => x.hasCostData) ? rev - cst : null;
    return {
      year: String(yr), revenue: rev, orders: ord,
      aov:  ord ? Math.round(rev / ord) : 0,
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

 // ── DYNAMIC TABLE DATA ──────────────────────────────────────────────
  let displayProducts = [];
  let displayCustomers = [];
  let displayCategories = [];
  let productColumns = [];
  let customerColumns = [];
  let categoryColumns = [];

  const slowMovingColumns = [
    { key: "name", label: "Product", color: "#d8c8a8" },
    { key: "currentStock", label: "Stock", align: "right", color: "#C9A84C" },
    { key: "qtySold", label: "Sold", align: "right", color: "#9EC97C" },
    { key: "lockedCapital", label: "Value Locked", align: "right", color: "#f87171", format: (v, c) => fmtK(v, c) },
  ];

  const churnedColumns = [
    { key: "name", label: "Customer", color: "#d8c8a8" },
    { key: "lastOrderDate", label: "Last Order", align: "right", format: v => new Date(v).toLocaleDateString() },
    { key: "revenue", label: "Total Spend", align: "right", color: "#C9A84C", format: (v, c) => fmtK(v, c) },
    { key: "status", label: "Risk", align: "center", format: () => <span style={{color: "#f87171", fontWeight: 700}}>LAPSED</span> },
  ];

  const renderStatus = (status) => {
    const colors = { "New": "#9EC97C", "Active": "#C9A84C", "At Risk": "#f87171" };
    return <span style={{ color: colors[status] || "#8a9aaa", fontWeight: 600 }}>{status}</span>;
  };

  if (view === "monthly") {
    displayProducts = advancedData.curr?.topProducts?.map(p => {
      if (tableMonth === "all") return { ...p, margin: p.revenue ? Math.round(((p.revenue - p.cost)/p.revenue)*100) : 0 };
      const mData = p.monthly?.[parseInt(tableMonth)] || { revenue: 0, cost: 0, qty: 0 };
      return { ...p, ...mData, margin: mData.revenue ? Math.round(((mData.revenue - mData.cost)/mData.revenue)*100) : 0 };
    }).filter(p => p.revenue > 0).sort((a,b) => b.revenue - a.revenue).slice(0, 20);

    displayCustomers = advancedData.curr?.topCustomers?.map(c => {
      if (tableMonth === "all") return c;
      const mData = c.monthly?.[parseInt(tableMonth)] || { revenue: 0, cost: 0 };
      return { ...c, ...mData };
    }).filter(c => c.revenue > 0).sort((a,b) => b.revenue - a.revenue).slice(0, 20);

    displayCategories = advancedData.curr?.topCategories?.map(c => {
      if (tableMonth === "all") return c;
      const mData = c.monthly?.[parseInt(tableMonth)] || { revenue: 0, qty: 0 };
      return { ...c, ...mData };
    }).filter(c => c.revenue > 0).sort((a,b) => b.revenue - a.revenue).slice(0, 10);

    productColumns = [
      { key: "name", label: "Product", color: "#d8c8a8" },
      { key: "qty", label: "Units", align: "right" },
      { key: "revenue", label: "Revenue", align: "right", color: "#9EC97C", format: (v, c) => fmtK(v, c) },
      { key: "margin", label: "Margin", align: "right", format: v => v > 0 ? `${v}%` : "—" },
    ];
    customerColumns = [
      { key: "name", label: "Customer", color: "#d8c8a8" },
      { key: "lifetimeOrders", label: "LTV Orders", align: "center", color: "#7C9EC9" },
      { key: "revenue", label: "Spend", align: "right", color: "#C9A84C", format: (v, c) => fmtK(v, c) },
      { key: "status", label: "Status", align: "center", format: v => renderStatus(v) },
    ];
    categoryColumns = [
      { key: "name", label: "Category", color: "#d8c8a8" },
      { key: "qty", label: "Units Sold", align: "right" },
      { key: "revenue", label: "Revenue", align: "right", color: "#C9A84C", format: (v, c) => fmtK(v, c) },
    ];
  } else {
    displayProducts = advancedData.curr?.topProducts?.map(p => {
      const prevP = advancedData.prev?.topProducts?.find(x => x.name === p.name);
      const prevRev = prevP ? prevP.revenue : 0;
      return { ...p, prevRevenue: prevRev, yoy: prevRev ? Math.round(((p.revenue - prevRev)/prevRev)*100) : null };
    }).sort((a,b) => b.revenue - a.revenue).slice(0, 20);

    displayCustomers = advancedData.curr?.topCustomers?.map(c => {
      const prevC = advancedData.prev?.topCustomers?.find(x => x.name === c.name);
      const prevRev = prevC ? prevC.revenue : 0;
      return { ...c, prevRevenue: prevRev, yoy: prevRev ? Math.round(((c.revenue - prevRev)/prevRev)*100) : null };
    }).sort((a,b) => b.revenue - a.revenue).slice(0, 20);

    displayCategories = advancedData.curr?.topCategories?.map(c => {
      const prevC = advancedData.prev?.topCategories?.find(x => x.name === c.name);
      const prevRev = prevC ? prevC.revenue : 0;
      return { ...c, prevRevenue: prevRev, yoy: prevRev ? Math.round(((c.revenue - prevRev)/prevRev)*100) : null };
    }).sort((a,b) => b.revenue - a.revenue).slice(0, 10);

    productColumns = [
      { key: "name", label: "Product", color: "#d8c8a8" },
      { key: "prevRevenue", label: `Prev Range`, align: "right", color: "#8a9aaa", format: (v, c) => fmtK(v, c) },
      { key: "revenue", label: `Current`, align: "right", color: "#9EC97C", format: (v, c) => fmtK(v, c) },
      { key: "yoy", label: "Growth", align: "right", format: v => <GrowthBadge value={v} /> },
    ];
    customerColumns = [
      { key: "name", label: "Customer", color: "#d8c8a8" },
      { key: "prevRevenue", label: `Prev Range`, align: "right", color: "#8a9aaa", format: (v, c) => fmtK(v, c) },
      { key: "revenue", label: `Current`, align: "right", color: "#C9A84C", format: (v, c) => fmtK(v, c) },
      { key: "yoy", label: "Growth", align: "right", format: v => <GrowthBadge value={v} /> },
    ];
    categoryColumns = [
      { key: "name", label: "Category", color: "#d8c8a8" },
      { key: "prevRevenue", label: `Prev Range`, align: "right", color: "#8a9aaa", format: (v, c) => fmtK(v, c) },
      { key: "revenue", label: `Current`, align: "right", color: "#C9A84C", format: (v, c) => fmtK(v, c) },
      { key: "yoy", label: "Growth", align: "right", format: v => <GrowthBadge value={v} /> },
    ];
  }

  const TopRightFilter = () => view === "monthly" && (
    <select 
      value={tableMonth} 
      onChange={e => setTableMonth(e.target.value)}
      style={{ background: "#0a0c12", color: "#c0a870", border: "1px solid rgba(201,168,76,0.3)", padding: "4px 8px", borderRadius: 6, fontSize: 11, outline: "none", cursor: "pointer" }}
    >
      <option value="all">Full Year</option>
      {MONTH_NAMES.map((m, i) => <option key={i} value={i}>{m}</option>)}
    </select>
  );

  return (
    <div style={{ minHeight: "100vh", background: "#080A10", fontFamily: "'DM Sans',sans-serif", color: "#e8e0d0", paddingBottom: 40 }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&family=DM+Sans:wght@300;400;500;600;700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        ::-webkit-scrollbar{width:4px}::-webkit-scrollbar-track{background:#0d0f18}::-webkit-scrollbar-thumb{background:#2a2416;border-radius:4px}
      `}</style>

      {/* HEADER */}
      <div style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", padding: "20px 32px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 16, background: "rgba(255,255,255,0.015)", position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: `linear-gradient(135deg,${accent},${accent}80)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 700, boxShadow: `0 4px 16px ${accent}40` }}>{activeStore.icon}</div>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ fontFamily: "'Cinzel',serif", fontSize: 15, fontWeight: 600, color: "#f0e8d8", letterSpacing: "0.05em" }}>{activeStore.name}</div>
              {anyLoading && <div style={{ fontSize: 10, color: accent, background: `${accent}15`, border: `1px solid ${accent}30`, padding: "2px 8px", borderRadius: 20 }}>LOADING…</div>}
            </div>
            <div style={{ fontSize: 10, color: "#4a4030", textTransform: "uppercase", letterSpacing: "0.15em" }}>
              {activeStore.id === "worthy" ? "Live Shopify Data" : "Sample Data"} · Performance Overview
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {STORES.map(s => <StorePill key={s.id} store={s} active={activeStore.id === s.id} onClick={() => setActiveStore(s)} />)}
        </div>

        <div style={{ display: "flex", gap: 6 }}>
          {ALL_YEARS.map(y => {
            const loaded   = hasData(y);
            const fetching = isLoading(y);
            return (
              <button key={y} onClick={() => setSelectedYear(y)} style={{ padding: "6px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600, border: selectedYear === y ? `1px solid ${accent}` : "1px solid rgba(255,255,255,0.1)", background: selectedYear === y ? `${accent}20` : "transparent", color: selectedYear === y ? accent : loaded ? "#c0a870" : "#5a5040", cursor: "pointer", transition: "all 0.2s", position: "relative" }}>
                {y}
                {fetching && <span style={{ position: "absolute", top: -3, right: -3, width: 7, height: 7, borderRadius: "50%", background: accent }} />}
                {!fetching && loaded && selectedYear !== y && activeStore.id === "worthy" && <span style={{ position: "absolute", top: -3, right: -3, width: 7, height: 7, borderRadius: "50%", background: "#4ade80", opacity: 0.7 }} />}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ padding: "32px 32px 0" }}>
        {/* View toggle */}
        <div style={{ display: "flex", gap: 4, marginBottom: 28, background: "rgba(255,255,255,0.03)", borderRadius: 10, padding: 4, border: "1px solid rgba(255,255,255,0.06)", width: "fit-content" }}>
          {[["monthly","Monthly Performance"],["yoy","Year over Year"]].map(([v, lbl]) => (
            <button key={v} onClick={() => setView(v)} style={{ padding: "8px 20px", borderRadius: 7, fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer", transition: "all 0.2s", letterSpacing: "0.04em", background: view === v ? `linear-gradient(135deg,${accent}30,${accent}15)` : "transparent", color: view === v ? accent : "#5a5040", boxShadow: view === v ? `inset 0 0 0 1px ${accent}30` : "none" }}>{lbl}</button>
          ))}
        </div>

        {/* KPI Row */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 16, marginBottom: 32 }}>
          <KPICard label="Total Revenue"   value={totalRev} growth={revG} icon="◎" accent={accent}    sub="currency" animated={animated} currency={activeStore.currency} />
          <KPICard label="Total Orders"    value={totalOrd} growth={ordG} icon="▣" accent="#7C9EC9"  sub="count"    animated={animated} currency={activeStore.currency} />
          <KPICard label="Avg Order Value" value={avgAOV}   growth={aovG} icon="◆" accent="#9EC97C"  sub="currency" animated={animated} currency={activeStore.currency} />
          <KPICard label={hasCost && gpMargin !== null ? `Gross Profit · ${gpMargin}% margin` : "Gross Profit"} value={gp || 0} growth={revG} icon="◈" accent="#C97C9E" sub="currency" animated={animated} currency={activeStore.currency} />
        </div>

        {/* MONTHLY VIEW */}
        {view === "monthly" ? (
          <>
            <div style={{ display: "flex", gap: 4, marginBottom: 20, flexWrap: "wrap" }}>
              {metrics.map(m => (
                <button key={m.id} onClick={() => setActiveMetric(m.id)} style={{ padding: "7px 16px", borderRadius: 8, fontSize: 11, fontWeight: 600, border: activeMetric === m.id ? `1px solid ${accent}60` : "1px solid rgba(255,255,255,0.07)", background: activeMetric === m.id ? `${accent}15` : "rgba(255,255,255,0.02)", color: activeMetric === m.id ? accent : "#5a5040", cursor: "pointer", transition: "all 0.2s", letterSpacing: "0.05em", textTransform: "uppercase" }}>{m.label}</button>
              ))}
            </div>

            <div style={{ background: "linear-gradient(135deg,rgba(255,255,255,0.03),rgba(255,255,255,0.01))", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 20, padding: 24, marginBottom: 24 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
                <div>
                  <div style={{ fontFamily: "'Cinzel',serif", fontSize: 14, color: "#f0e8d8", fontWeight: 600 }}>Monthly {metrics.find(m => m.id === activeMetric)?.label} — {selectedYear}</div>
                  <div style={{ fontSize: 11, color: "#4a4030", marginTop: 3 }}>{prevLoaded ? `vs ${selectedYear - 1}` : `Loading ${selectedYear - 1}…`}</div>
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
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#4a4030" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: "#3a3020" }} axisLine={false} tickLine={false}
                    tickFormatter={activeMetric === "revenue" || activeMetric === "aov" ? v => `$${(v/1000).toFixed(0)}k` : activeMetric === "convRate" ? v => `${v}%` : v => v >= 1000 ? `${(v/1000).toFixed(1)}k` : v} />
                  <Tooltip content={<CustomTooltip currency={activeStore.currency} />} />
                  <Area type="monotone" dataKey={activeMetric} name={metrics.find(m => m.id === activeMetric)?.label} stroke={accent} strokeWidth={2.5} fill="url(#ag)" dot={false} activeDot={{ r: 5, fill: accent, stroke: "#080A10", strokeWidth: 2 }} />
                  <Line type="monotone" dataKey={activeMetric === "revenue" ? "prevRevenue" : activeMetric === "orders" ? "prevOrders" : activeMetric} name={`${selectedYear - 1}`} stroke="rgba(255,255,255,0.2)" strokeWidth={1.5} strokeDasharray="4 4" dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 2.2fr", gap: 20, marginBottom: 24 }}>
              <div style={{ background: "linear-gradient(135deg,rgba(255,255,255,0.03),rgba(255,255,255,0.01))", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 20, padding: 24 }}>
                <div style={{ fontFamily: "'Cinzel',serif", fontSize: 13, color: "#f0e8d8", fontWeight: 600, marginBottom: 6 }}>YoY Revenue Growth</div>
                <div style={{ fontSize: 11, color: "#4a4030", marginBottom: 18 }}>% vs same month {selectedYear - 1}</div>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={momData} margin={{ top: 5, right: 5, bottom: 0, left: -10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                    <XAxis dataKey="month" tick={{ fontSize: 10, fill: "#4a4030" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 9, fill: "#3a3020" }} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} />
                    <Tooltip content={<CustomTooltip />} />
                    <ReferenceLine y={0} stroke="rgba(255,255,255,0.15)" strokeWidth={1} />
                    <Bar dataKey="momGrowth" name="Growth" radius={[4, 4, 0, 0]} fill={accent} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Table */}
              <div style={{ background: "linear-gradient(135deg,rgba(255,255,255,0.03),rgba(255,255,255,0.01))", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 20, padding: 24 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                  <div style={{ fontFamily: "'Cinzel',serif", fontSize: 13, color: "#f0e8d8", fontWeight: 600 }}>Monthly Breakdown</div>
                  <div style={{ fontSize: 10, color: hasCost ? "#C97C9E" : "#5a4030" }}>
                    {hasCost ? "✦ Real cost from Shopify" : "Add read_inventory scope for margin"} · {activeStore.currency}
                  </div>
                </div>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                    <thead>
                      <tr>
                        {["Month","Revenue","Cost","Gross Profit","Margin","Orders","AOV","New Cust.","Returns","YoY"].map(h => (
                          <th key={h} style={{ textAlign: "left", padding: "0 8px 10px", color: "#3a3020", textTransform: "uppercase", letterSpacing: "0.06em", fontSize: 9, fontWeight: 600, borderBottom: "1px solid rgba(255,255,255,0.05)", whiteSpace: "nowrap" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {momData.map((row, i) => {
                        const has = row.revenue > 0;
                        return (
                          <tr key={i} style={{ borderBottom: "1px solid rgba(255,255,255,0.03)", background: hoveredMonth === i ? "rgba(255,255,255,0.04)" : "transparent", transition: "background 0.15s" }}
                            onMouseEnter={() => setHoveredMonth(i)} onMouseLeave={() => setHoveredMonth(null)}>
                            <td style={{ padding: "8px 8px", color: "#8a7860", fontWeight: 600 }}>{row.month}</td>
                            <td style={{ padding: "8px 8px", color: "#d8c8a8", fontWeight: 600 }}>{has ? fmtK(row.revenue, activeStore.currency) : <span style={{ color: "#2a2416" }}>—</span>}</td>
                            <td style={{ padding: "8px 8px", color: "#aa8a6a" }}>{has && row.totalCost !== null ? fmtK(row.totalCost, activeStore.currency) : <span style={{ color: "#2a2416" }}>—</span>}</td>
                            <td style={{ padding: "8px 8px", color: "#C97C9E", fontWeight: 600 }}>{has && row.grossProfit !== null ? fmtK(row.grossProfit, activeStore.currency) : <span style={{ color: "#2a2416" }}>—</span>}</td>
                            <td style={{ padding: "8px 8px" }}>{has ? <MarginBar value={row.marginPct} /> : <span style={{ color: "#2a2416" }}>—</span>}</td>
                            <td style={{ padding: "8px 8px", color: "#8a9aaa" }}>{has ? row.orders : <span style={{ color: "#2a2416" }}>—</span>}</td>
                            <td style={{ padding: "8px 8px", color: "#8aaa8a" }}>{has ? fmtK(row.aov, activeStore.currency) : <span style={{ color: "#2a2416" }}>—</span>}</td>
                            <td style={{ padding: "8px 8px", color: "#9EC97C" }}>{row.newCustomers > 0 ? row.newCustomers : <span style={{ color: "#2a2416" }}>—</span>}</td>
                            <td style={{ padding: "8px 8px", color: "#aa8a8a" }}>{row.returns > 0 ? row.returns : <span style={{ color: "#2a2416" }}>—</span>}</td>
                            <td style={{ padding: "8px 8px" }}><GrowthBadge value={row.momGrowth} /></td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr style={{ borderTop: "1px solid rgba(255,255,255,0.1)" }}>
                        <td style={{ padding: "10px 8px", color: "#6a5a40", fontSize: 10, fontWeight: 700 }}>TOTAL</td>
                        <td style={{ padding: "10px 8px", color: "#f0e8d8", fontWeight: 700 }}>{fmtK(totalRev, activeStore.currency)}</td>
                        <td style={{ padding: "10px 8px", color: "#aa8a6a", fontWeight: 700 }}>{hasCost ? fmtK(totalCost, activeStore.currency) : "—"}</td>
                        <td style={{ padding: "10px 8px", color: "#C97C9E", fontWeight: 700 }}>{gp !== null ? fmtK(gp, activeStore.currency) : "—"}</td>
                        <td style={{ padding: "10px 8px" }}><MarginBar value={gpMargin} /></td>
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

        ) : (
          /* YOY VIEW */
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 24 }}>
              <div style={{ background: "linear-gradient(135deg,rgba(255,255,255,0.03),rgba(255,255,255,0.01))", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 20, padding: 24 }}>
                <div style={{ fontFamily: "'Cinzel',serif", fontSize: 13, color: "#f0e8d8", fontWeight: 600, marginBottom: 4 }}>Annual Revenue</div>
                <div style={{ fontSize: 11, color: "#4a4030", marginBottom: 20 }}>Year-over-Year</div>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={yoyData} margin={{ top: 5, right: 10, bottom: 0, left: 0 }}>
                    <defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={accent} stopOpacity={1} /><stop offset="100%" stopColor={accent} stopOpacity={0.5} /></linearGradient></defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                    <XAxis dataKey="year" tick={{ fontSize: 12, fill: "#6a5a40", fontFamily: "'Cinzel',serif" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: "#3a3020" }} axisLine={false} tickLine={false} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                    <Tooltip content={<CustomTooltip currency={activeStore.currency} />} />
                    <Bar dataKey="revenue" name="Revenue" fill="url(#bg)" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div style={{ background: "linear-gradient(135deg,rgba(255,255,255,0.03),rgba(255,255,255,0.01))", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 20, padding: 24 }}>
                <div style={{ fontFamily: "'Cinzel',serif", fontSize: 13, color: "#f0e8d8", fontWeight: 600, marginBottom: 4 }}>Orders & AOV Trend</div>
                <div style={{ fontSize: 11, color: "#4a4030", marginBottom: 20 }}>Volume and value evolution</div>
                <ResponsiveContainer width="100%" height={240}>
                  <ComposedChart data={yoyData} margin={{ top: 5, right: 10, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                    <XAxis dataKey="year" tick={{ fontSize: 12, fill: "#6a5a40", fontFamily: "'Cinzel',serif" }} axisLine={false} tickLine={false} />
                    <YAxis yAxisId="l" tick={{ fontSize: 10, fill: "#3a3020" }} axisLine={false} tickLine={false} tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v} />
                    <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 10, fill: "#3a3020" }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} />
                    <Tooltip content={<CustomTooltip currency={activeStore.currency} />} />
                    <Bar yAxisId="l" dataKey="orders" name="Orders" fill="#7C9EC960" radius={[6, 6, 0, 0]} />
                    <Line yAxisId="r" type="monotone" dataKey="aov" name="AOV" stroke="#9EC97C" strokeWidth={3} dot={{ fill: "#9EC97C", r: 6, stroke: "#080A10", strokeWidth: 2 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div style={{ background: "linear-gradient(135deg,rgba(255,255,255,0.03),rgba(255,255,255,0.01))", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 20, padding: 24 }}>
              <div style={{ fontFamily: "'Cinzel',serif", fontSize: 13, color: "#f0e8d8", fontWeight: 600, marginBottom: 20 }}>Year-over-Year Summary</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 12 }}>
                {yoyData.map((yr, i) => {
                  const p  = yoyData[i - 1];
                  const rg = p ? calcGrowth(yr.revenue, p.revenue) : null;
                  const og = p ? calcGrowth(yr.orders,  p.orders)  : null;
                  const isCur = yr.year === String(selectedYear);
                  return (
                    <div key={yr.year} style={{ borderRadius: 14, padding: "18px 20px", border: `1px solid ${isCur ? accent + "40" : "rgba(255,255,255,0.06)"}`, background: isCur ? `${accent}08` : "rgba(255,255,255,0.01)", opacity: yr.loaded ? 1 : 0.3, transition: "opacity 0.4s" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                        <div style={{ fontFamily: "'Cinzel',serif", fontSize: 18, color: isCur ? accent : "#6a5a40", fontWeight: 700 }}>{yr.year}</div>
                        {isLoading(parseInt(yr.year)) && <span style={{ fontSize: 9, color: accent }}>…</span>}
                      </div>
                      <div style={{ marginBottom: 8 }}>
                        <div style={{ fontSize: 9, color: "#3a3020", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 2 }}>Revenue</div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: "#d8c8a8" }}>{fmt(yr.revenue, activeStore.currency)}</div>
                        {rg !== null && <div style={{ fontSize: 11, color: rg >= 0 ? "#4ade80" : "#f87171", marginTop: 2, fontWeight: 600 }}>{fmtPct(rg)} vs {p.year}</div>}
                      </div>
                      {yr.grossProfit !== null && (
                        <div style={{ marginBottom: 8 }}>
                          <div style={{ fontSize: 9, color: "#3a3020", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 2 }}>Gross Profit</div>
                          <div style={{ fontSize: 13, fontWeight: 600, color: "#C97C9E" }}>
                            {fmt(yr.grossProfit, activeStore.currency)}
                            {yr.margin !== null && <span style={{ fontSize: 10, color: "#7a5a6a", marginLeft: 5 }}>{yr.margin}%</span>}
                          </div>
                        </div>
                      )}
                      <div>
                        <div style={{ fontSize: 9, color: "#3a3020", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 2 }}>Orders</div>
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

        {/* ADVANCED ANALYTICS GRID */}
        {activeStore.id === "worthy" && (
          <>
            {/* --- NEW DATE RANGE PICKER UI --- */}
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 40, marginBottom: 16, padding: "16px 24px", background: "linear-gradient(135deg,rgba(255,255,255,0.03),rgba(255,255,255,0.01))", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 16 }}>
              <span style={{ fontFamily: "'Cinzel',serif", fontSize: 14, color: "#f0e8d8", fontWeight: 600 }}>Advanced Table Date Filter:</span>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input 
                  type="date" 
                  value={startDate} 
                  onChange={(e) => setStartDate(e.target.value)}
                  style={{ background: "#0a0c12", color: "#c0a870", border: "1px solid rgba(201,168,76,0.3)", padding: "6px 12px", borderRadius: 6, fontSize: 12, outline: "none", cursor: "pointer", fontFamily: "'DM Sans',sans-serif" }}
                />
                <span style={{ color: "#5a5040", fontSize: 12 }}>to</span>
                <input 
                  type="date" 
                  value={endDate} 
                  onChange={(e) => setEndDate(e.target.value)}
                  style={{ background: "#0a0c12", color: "#c0a870", border: "1px solid rgba(201,168,76,0.3)", padding: "6px 12px", borderRadius: 6, fontSize: 12, outline: "none", cursor: "pointer", fontFamily: "'DM Sans',sans-serif" }}
                />
              </div>
              <div style={{ fontSize: 10, color: "#4a4030", marginLeft: "auto" }}>
                Filters Top Products, Customers, Categories & Inventory below.
              </div>
            </div>

            {/* Row 1: Products, Customers, Categories */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 20, marginBottom: 24 }}>
              <AdvancedTable 
                title="Top Categories" 
                subtitle="By Revenue"
                loading={advLoading}
                currency={activeStore.currency}
                data={displayCategories}
                columns={categoryColumns}
                topRightElement={<TopRightFilter />}
              />
              <AdvancedTable 
                title="Top Products" 
                subtitle="High Performers"
                loading={advLoading}
                currency={activeStore.currency}
                data={displayProducts}
                columns={productColumns}
                topRightElement={<TopRightFilter />}
              />
              <AdvancedTable 
                title="Top Customers" 
                subtitle="Loyalty & Spend"
                loading={advLoading}
                currency={activeStore.currency}
                data={displayCustomers}
                columns={customerColumns}
                topRightElement={<TopRightFilter />}
              />
            </div>

            {/* Row 2: NEW ANALYTICS (Slow Moving & Churn) */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 24 }}>
              <AdvancedTable 
                title="⚠️ Slow-Moving Inventory" 
                subtitle="Capital tied up in low-turnover stock"
                loading={advLoading}
                currency={activeStore.currency}
                data={advancedData.curr?.slowMoving || []}
                columns={slowMovingColumns}
              />
              <AdvancedTable 
                title="🛑 Lapsed Customers (>90 Days)" 
                subtitle="High-value clients who stopped ordering"
                loading={advLoading}
                currency={activeStore.currency}
                data={advancedData.curr?.churned || []}
                columns={churnedColumns}
              />
            </div>
          </>
        )}

        {/* Footer */}
        <div style={{ marginTop: 32, padding: "16px 24px", borderRadius: 14, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div style={{ display: "flex", gap: 28, flexWrap: "wrap" }}>
            {[
              ["New Customers",   totalNewC || "—",                                         "#8aaa8a"],
              ["Total Discounts", fmtK(totalDisc, activeStore.currency),                    "#C9A84C"],
              ["Discount Impact", advancedData.curr?.metrics?.discountImpactRatio ? `${(advancedData.curr.metrics.discountImpactRatio * 100).toFixed(1)}%` : "—", "#f87171"],
              ["Gross Profit",    gp !== null ? fmtK(gp, activeStore.currency) : "—",       "#C97C9E"],
            ].map(([lbl, val, clr]) => (
              <div key={lbl}>
                <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.12em", color: "#3a3020", marginBottom: 2 }}>{lbl}</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: clr }}>{val}</div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 10, color: "#2a2416", letterSpacing: "0.08em" }}>OFFICE · SHOPIFY ANALYTICS · FY{selectedYear}</div>
        </div>
      </div>
    </div>
  );
}