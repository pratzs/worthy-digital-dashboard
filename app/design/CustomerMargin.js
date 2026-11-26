"use client";
/* Customer margin (27 Nov 2026), all three businesses: which customers make or lose money once their discounts are
   counted, on exactly the headline's basis (/api/customer-margin). Management only: the route turns everyone else away
   and then this card shows nothing. Follows the page's chosen dates when they are set. */
import React, { useEffect, useMemo, useState } from "react";
import { Card, CardHead, Range, Skeleton, money, dLong, COLORS, ui as u, usePaged } from "@/app/design/ui";
import { Icon } from "@/app/design/icons";

const cacheGet = (k) => { try { const v = JSON.parse(localStorage.getItem(k) || "null"); return v && Date.now() - v.t < 15 * 60000 ? v.d : null; } catch { return null; } };
const cacheSet = (k, d) => { try { localStorage.setItem(k, JSON.stringify({ t: Date.now(), d })); } catch { /* private window */ } };
const pctTxt = (v) => (v === null || v === undefined ? "-" : `${v}%`);
const pts = (v) => (v === null || v === undefined || Math.abs(v) < 0.05 ? "-" : `${v > 0 ? "-" : "+"}${Math.abs(v).toFixed(1)} pts`);
const SORTS = [
  ["sales", "Biggest sales", (a, b) => b.revenue - a.revenue],
  ["low", "Lowest margin", (a, b) => (a.marginPct ?? 999) - (b.marginPct ?? 999)],
  ["discount", "Most discount", (a, b) => b.discount - a.discount],
  ["pull", "Pulls margin down most", (a, b) => (b.pullPts ?? -99) - (a.pullPts ?? -99)],
];
const MIN_FOR_LOW = 1000;   // "Lowest margin" leaves out customers under $1,000 of sales, where one line swings the margin

/** company: 4, 1 or "south"; month "YYYY-MM"; fy; range {from,to} when the page has chosen dates. */
export default function CustomerMargin({ company = 4, month, fy, range = null }) {
  const [mode, setMode] = useState("month");
  const period = range ? `${range.from}:${range.to}` : mode === "month" ? month : `fy:${fy}`;
  const key = `wdd-cust-v1:${company}:${period}`;
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  const [hidden, setHidden] = useState(false);
  const [sort, setSort] = useState("sales");
  const [find, setFind] = useState("");
  useEffect(() => {
    let stop = false, timer = null;
    const load = () => fetch(`/api/customer-margin?company=${company}&period=${encodeURIComponent(period)}`, { cache: "no-store" })
      .then(async (r) => { if (r.status === 401 || r.status === 403) { if (!stop) setHidden(true); return null; } const j = await r.json(); if (!r.ok) throw new Error(j.error || `Error ${r.status}`); return j; })
      .then((j) => { if (stop || !j) return; setD(j); if (!j.building) cacheSet(key, j); else timer = setTimeout(load, 60000); })
      .catch((e) => { if (!stop) setErr(String(e.message || e)); });
    setD(cacheGet(key)); setErr(""); load();
    return () => { stop = true; clearTimeout(timer); };
  }, [company, period]);   // eslint-disable-line react-hooks/exhaustive-deps
  const rows = useMemo(() => {
    let list = d?.customers || [];
    const f = find.trim().toLowerCase();
    if (f) list = list.filter((c) => c.name.toLowerCase().includes(f) || c.people.some((p) => p.toLowerCase().includes(f)));
    if (sort === "low") list = list.filter((c) => c.revenue >= MIN_FOR_LOW && c.marginPct != null);
    return [...list].sort(SORTS.find((s) => s[0] === sort)[2]);
  }, [d, sort, find]);
  const pg = usePaged(rows, `${sort}|${find}|${period}`);
  if (hidden || !period) return null;
  const avg = d?.marginPct;
  return (
    <Card style={{ marginTop: 14 }} aria-label="Customer margin">
      <CardHead icon="building" title="Customer margin">
        {!range && (
          <div className={u.seg} role="group" aria-label="Period">
            <button type="button" className={mode === "month" ? u.segOn : ""} aria-pressed={mode === "month"} onClick={() => setMode("month")}>Selected month</button>
            <button type="button" className={mode === "fy" ? u.segOn : ""} aria-pressed={mode === "fy"} onClick={() => setMode("fy")}>Year so far</button>
          </div>
        )}
        {d && <Range>{dLong(d.from)} to {dLong(d.to)}</Range>}
      </CardHead>
      {err && !d && <div className={u.empty}>Could not read the figures: {err}</div>}
      {!d && !err && <Skeleton height={240} />}
      {d?.building && <div className={u.empty}><Icon n="refresh" size={13} /> Preparing customer figures for these dates</div>}
      {d && !d.building && (
        <>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
            <div className={u.seg} role="group" aria-label="Sort customers">
              {SORTS.map(([k, label]) => <button key={k} type="button" className={sort === k ? u.segOn : ""} aria-pressed={sort === k} onClick={() => setSort(k)}>{label}</button>)}
            </div>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 8, flex: "1 1 220px", maxWidth: 340 }}>
              <span className="sr-only">Find a customer or salesperson</span>
              <input type="search" value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find a customer or salesperson"
                style={{ font: "inherit", fontSize: 15, padding: "10px 14px", borderRadius: 12, border: `1px solid ${COLORS.line}`, background: "#fff", width: "100%", minHeight: 44 }} />
            </label>
          </div>
          {!rows.length ? <div className={u.empty}>No customers match</div> : (
            <div className={u.tableWrap}>
              <table className={u.table}>
                <caption className="sr-only">Customer margin, {dLong(d.from)} to {dLong(d.to)}</caption>
                <thead><tr>
                  <th scope="col">Customer</th><th scope="col" className={u.num}>Sales</th><th scope="col" className={u.num}>Discount given</th>
                  <th scope="col" className={u.num}>Margin</th><th scope="col" className={u.num}>Gross profit</th>
                  <th scope="col" className={u.num} title="How much this customer lowers (or lifts) the company margin">Effect on margin</th>
                </tr></thead>
                <tbody>
                  {pg.shown.map((c) => {
                    const low = c.marginPct != null && avg != null && c.marginPct < avg - 3;
                    return (
                      <tr key={c.name}>
                        <td style={{ maxWidth: 320 }}>{c.name}<div className={u.was}>{c.people.slice(0, 2).join(", ")}{c.people.length > 2 ? ` +${c.people.length - 2}` : ""}</div></td>
                        <td className={u.num}>{money(c.revenue)}</td>
                        <td className={u.num}>{c.discount >= 1 ? money(c.discount) : "-"}</td>
                        <td className={u.num} style={{ color: low ? "var(--orange)" : undefined, fontWeight: low ? 500 : 400 }}>{pctTxt(c.marginPct)}</td>
                        <td className={u.num} style={{ color: c.grossProfit < 0 ? "var(--orange)" : undefined }}>{money(c.grossProfit)}</td>
                        <td className={u.num} style={{ color: c.pullPts > 0.05 ? "var(--orange)" : COLORS.ink2 }}>{pts(c.pullPts)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {pg.bar}
            </div>
          )}
          <div className={u.was} style={{ marginTop: 12 }}>{(d.customers || []).length.toLocaleString("en-NZ")} customers · company margin {pctTxt(d.marginPct)}</div>
        </>
      )}
    </Card>
  );
}
