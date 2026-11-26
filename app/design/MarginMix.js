"use client";
/* What sets the margin, Worthy Products North (lib/marginMix.js, /api/margin-mix). Management only: the route turns
   everyone else away, and then this card shows nothing. Same sales and cost as the headline, split by kind of sale and by
   person, so the reader can see what pulls the company margin down and by how much. */
import React, { useEffect, useState } from "react";
import { Card, CardHead, Mini, Range, Skeleton, money, dLong, COLORS, ui as u } from "@/app/design/ui";
import { Icon } from "@/app/design/icons";

const cacheGet = (k, maxMs) => { try { const v = JSON.parse(localStorage.getItem(k) || "null"); return v && Date.now() - v.t < maxMs ? v.d : null; } catch { return null; } };
const cacheSet = (k, d) => { try { localStorage.setItem(k, JSON.stringify({ t: Date.now(), d })); } catch { /* private window */ } };
const pctTxt = (v) => (v === null || v === undefined ? "-" : `${v}%`);
const pts = (v) => (v === null || v === undefined || v === 0 ? "-" : `${v > 0 ? "" : "+"}${(-v).toFixed(1)} pts`);   // what it does to the company margin

/** month: "YYYY-MM" the dashboard has selected; fy: the financial year (April start). */
export default function MarginMix({ month, fy }) {
  const [mode, setMode] = useState("month");
  const period = mode === "month" ? month : `fy:${fy}`;
  const ck = `wdd-mix-v1:${period}`;
  const [d, setD] = useState(() => (typeof window !== "undefined" ? cacheGet(ck, 15 * 60000) : null));
  const [err, setErr] = useState("");
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    let stop = false;
    const cached = cacheGet(ck, 15 * 60000);
    setD(cached); setErr("");
    fetch(`/api/margin-mix?period=${encodeURIComponent(period)}`, { cache: "no-store" })
      .then(async (r) => { if (r.status === 401 || r.status === 403) { if (!stop) setHidden(true); return null; } const j = await r.json(); if (!r.ok) throw new Error(j.error || `Error ${r.status}`); return j; })
      .then((j) => { if (!stop && j) { setD(j); cacheSet(ck, j); } })
      .catch((e) => { if (!stop) setErr(String(e.message || e)); });
    return () => { stop = true; };
  }, [period]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (hidden || !month) return null;

  const worst = d ? [...d.groups].filter((g) => g.revenue !== 0 && g.pullPts > 0).sort((a, b) => b.pullPts - a.pullPts) : [];
  const maxShare = d ? Math.max(...d.groups.map((g) => g.share), 1) : 1;
  return (
    <Card style={{ marginTop: 16 }} aria-label="What sets the margin">
      <CardHead icon="percent" title="What sets the margin">
        <div className={u.seg} role="group" aria-label="Period">
          <button type="button" className={mode === "month" ? u.segOn : ""} aria-pressed={mode === "month"} onClick={() => setMode("month")}>Selected month</button>
          <button type="button" className={mode === "fy" ? u.segOn : ""} aria-pressed={mode === "fy"} onClick={() => setMode("fy")}>Year so far</button>
        </div>
        {d && <Range>{dLong(d.from)} to {dLong(d.to)}</Range>}
      </CardHead>
      {err && !d && <div className={u.empty}>Could not read Odoo: {err}</div>}
      {!d && !err && <Skeleton height={220} />}
      {d && (
        <>
          {/* headline: same sales and cost as the top of the page */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 18, marginBottom: 22 }}>
            <div><div style={{ fontSize: 30, letterSpacing: "-.02em" }}>{pctTxt(d.marginPct)}</div><div className={u.statLabel}>Company margin · {money(d.grossProfit)} on {money(d.revenue)}</div></div>
            <div><div style={{ fontSize: 30, letterSpacing: "-.02em" }}>{money(d.discount)}</div><div className={u.statLabel}>Discount given on invoice lines</div></div>
            {worst[0] && <div><div style={{ fontSize: 30, letterSpacing: "-.02em", color: "var(--orange)" }}>{pts(worst[0].pullPts)}</div><div className={u.statLabel}>Biggest pull: {worst[0].label.toLowerCase()}</div></div>}
            {d.sisters !== 0 && <div><div style={{ fontSize: 30, letterSpacing: "-.02em" }}>{money(d.sisters)}</div><div className={u.statLabel}>Sold to Dutch Rusk and Oceania, not in these figures</div></div>}
          </div>

          <Mini icon="pie">By kind of sale</Mini>
          <div className={u.tableWrap}>
            <table className={u.table}>
              <thead><tr><th scope="col">Kind of sale</th><th scope="col" style={{ width: "22%" }}>Share of sales</th><th scope="col" className={u.num}>Sales</th><th scope="col" className={u.num}>Cost</th><th scope="col" className={u.num}>Gross profit</th><th scope="col" className={u.num}>Margin</th><th scope="col" className={u.num} title="How much this kind of sale lowers (or lifts) the company margin">Effect on company margin</th></tr></thead>
              <tbody>
                {d.groups.map((g) => (
                  <tr key={g.key}>
                    <td>{g.label}<div className={u.was}>{g.lines.toLocaleString("en-NZ")} invoice lines{g.discount > 0.5 ? ` · ${money(g.discount)} discount` : ""}</div></td>
                    <td><div className={u.barTrack}><div className={`${u.barInk} ${g.pullPts > 0.05 ? u.barAccent : ""}`} style={{ width: `${(Math.max(0, g.share) / maxShare) * 100}%` }} /></div><div className={u.was} style={{ marginTop: 4 }}>{g.share}%</div></td>
                    <td className={u.num}>{money(g.revenue)}</td>
                    <td className={u.num}>{money(g.cost)}</td>
                    <td className={u.num} style={{ color: g.grossProfit < 0 ? "var(--orange)" : undefined }}>{money(g.grossProfit)}</td>
                    <td className={u.num}>{pctTxt(g.marginPct)}</td>
                    <td className={u.num} style={{ color: g.pullPts > 0.05 ? "var(--orange)" : COLORS.ink2 }}>{pts(g.pullPts)}</td>
                  </tr>
                ))}
                <tr><td><strong>Total</strong></td><td /><td className={u.num}><strong>{money(d.revenue)}</strong></td><td className={u.num}><strong>{money(d.cost)}</strong></td><td className={u.num}><strong>{money(d.grossProfit)}</strong></td><td className={u.num}><strong>{pctTxt(d.marginPct)}</strong></td><td /></tr>
              </tbody>
            </table>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 24, marginTop: 24 }}>
            <div>
              <Mini icon="users">By person, everyone who sold</Mini>
              <div className={u.tableWrap}>
                <table className={u.table}>
                  <thead><tr><th scope="col">Person</th><th scope="col" className={u.num}>Sales</th><th scope="col" className={u.num}>Margin</th><th scope="col" className={u.num}>Clearance</th><th scope="col" className={u.num}>Lost below cost</th><th scope="col" className={u.num}>Effect</th></tr></thead>
                  <tbody>
                    {d.people.map((p) => (
                      <tr key={p.name}>
                        <td>{p.name}</td>
                        <td className={u.num}>{money(p.revenue)}</td>
                        <td className={u.num} style={{ color: (p.marginPct ?? 0) < 0 ? "var(--orange)" : undefined }}>{pctTxt(p.marginPct)}</td>
                        <td className={u.num}>{p.clearance ? money(p.clearance) : "-"}</td>
                        <td className={u.num}>{p.belowCostLoss >= 1 ? money(p.belowCostLoss) : "-"}</td>
                        <td className={u.num} style={{ color: p.pullPts > 0.05 ? "var(--orange)" : COLORS.ink2 }}>{pts(p.pullPts)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div>
              <Mini icon="alert">Products that lost the most</Mini>
              {!d.losers.length ? <div className={u.empty}>Nothing sold below cost</div> : (
                <div className={u.tableWrap}>
                  <table className={u.table}>
                    <thead><tr><th scope="col">Product</th><th scope="col" className={u.num}>Sales</th><th scope="col" className={u.num}>Cost</th><th scope="col" className={u.num}>Lost</th></tr></thead>
                    <tbody>
                      {d.losers.map((l) => (
                        <tr key={l.name}>
                          <td style={{ maxWidth: 260 }}>{l.name}<div className={u.was}>{l.people.slice(0, 3).join(", ")}{l.people.length > 3 ? ` +${l.people.length - 3}` : ""}</div></td>
                          <td className={u.num}>{money(l.revenue)}</td>
                          <td className={u.num}>{money(l.cost)}</td>
                          <td className={u.num} style={{ color: "var(--orange)" }}>{money(l.loss)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
          <div className={u.was} style={{ marginTop: 14, display: "flex", gap: 6, alignItems: "center" }}>
            <Icon n="refresh" size={11} />Odoo read {new Date(d.generatedAt).toLocaleTimeString("en-NZ", { timeZone: "Pacific/Auckland", hour: "numeric", minute: "2-digit" })}{d.stale ? ", newer figures are being read" : ""}
          </div>
        </>
      )}
    </Card>
  );
}
