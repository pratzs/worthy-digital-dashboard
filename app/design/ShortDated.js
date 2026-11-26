"use client";
/* Short-dated stock, Worthy Products (lib/shortDated.js, /api/short-dated): lots that reach best-before within 90 days,
   what they cost, what they bring in at the clearance price, and whether they sell in time at the current pace. */
import React, { useEffect, useState } from "react";
import { Card, CardHead, Mini, Range, Skeleton, money, dLong, COLORS, ui as u, usePaged } from "@/app/design/ui";
import { Icon } from "@/app/design/icons";

const KEY = "wdd-short-dated-v1";
const cacheGet = () => { try { const v = JSON.parse(localStorage.getItem(KEY) || "null"); return v && Date.now() - v.t < 30 * 60000 ? v.d : null; } catch { return null; } };
const cacheSet = (d) => { try { localStorage.setItem(KEY, JSON.stringify({ t: Date.now(), d })); } catch { /* private window */ } };

export default function ShortDated() {
  const [d, setD] = useState(() => (typeof window !== "undefined" ? cacheGet() : null));
  const [err, setErr] = useState("");
  const [hidden, setHidden] = useState(false);
  const [only, setOnly] = useState("risk");
  useEffect(() => {
    let stop = false;
    fetch("/api/short-dated", { cache: "no-store" })
      .then(async (r) => { if (r.status === 401 || r.status === 403) { if (!stop) setHidden(true); return null; } const j = await r.json(); if (!r.ok) throw new Error(j.error || `Error ${r.status}`); return j; })
      .then((j) => { if (!stop && j) { setD(j); cacheSet(j); } })
      .catch((e) => { if (!stop) setErr(String(e.message || e)); });
    return () => { stop = true; };
  }, []);
  const rows = !d ? [] : only === "risk" ? d.rows.filter((r) => !r.sellsInTime) : d.rows;
  const pg = usePaged(rows, only);
  if (hidden) return null;
  const maxBand = d ? Math.max(...d.bands.map((b) => b.cost), 1) : 1;
  return (
    <Card style={{ marginBottom: 16 }} aria-label="Short-dated stock">
      <CardHead icon="hourglass" title="Short-dated stock">
        <div className={u.seg} role="group" aria-label="Show">
          <button type="button" className={only === "risk" ? u.segOn : ""} aria-pressed={only === "risk"} onClick={() => setOnly("risk")}>Won&apos;t sell in time</button>
          <button type="button" className={only === "all" ? u.segOn : ""} aria-pressed={only === "all"} onClick={() => setOnly("all")}>All within 90 days</button>
        </div>
        {d && <Range>Best-before by {dLong(new Date(Date.parse(`${d.today}T00:00:00Z`) + 90 * 86400000).toISOString().slice(0, 10))}</Range>}
      </CardHead>
      {err && !d && <div className={u.empty}>Could not read Odoo: {err}</div>}
      {!d && !err && <Skeleton height={200} />}
      {d && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 18, marginBottom: 22 }}>
            <div><div style={{ fontSize: 30, letterSpacing: "-.02em" }}>{money(d.totals.cost)}</div><div className={u.statLabel}>Cost of {d.totals.lots} lots, {Math.round(d.totals.units).toLocaleString("en-NZ")} units</div></div>
            <div><div style={{ fontSize: 30, letterSpacing: "-.02em", color: "var(--orange)" }}>{money(d.totals.atRisk)}</div><div className={u.statLabel}>Lost if sold at clearance price</div></div>
            <div><div style={{ fontSize: 30, letterSpacing: "-.02em" }}>{d.totals.wontSellLots}</div><div className={u.statLabel}>Lots that won&apos;t sell in time · {money(d.totals.wontSellCost)}</div></div>
          </div>
          <Mini icon="calendar">By time left</Mini>
          <div style={{ display: "grid", gap: 10, marginBottom: 22 }}>
            {d.bands.map((b, i) => (
              <div key={b.label} style={{ display: "grid", gridTemplateColumns: "150px 1fr 110px", gap: 12, alignItems: "center" }}>
                <span style={{ fontSize: 13 }}>{b.label}</span>
                <div className={u.barTrack}><div className={`${u.barInk} ${i < 2 ? u.barAccent : ""}`} style={{ width: `${(b.cost / maxBand) * 100}%` }} /></div>
                <span className={u.num} style={{ fontSize: 13 }}>{money(b.cost)} <span className={u.was}>· {b.lots}</span></span>
              </div>
            ))}
          </div>
          {!rows.length ? <div className={u.empty}>Every short-dated lot sells in time at the current pace</div> : (
            <div className={u.tableWrap}>
              <table className={u.table}>
                <thead><tr><th scope="col">Product</th><th scope="col">Best-before</th><th scope="col" className={u.num}>Units</th><th scope="col" className={u.num}>Sells a day</th><th scope="col" className={u.num}>Cost</th><th scope="col" className={u.num}>At clearance</th><th scope="col" className={u.num}>Lost</th></tr></thead>
                <tbody>
                  {pg.shown.map((r) => (
                    <tr key={`${r.code}|${r.lot}`}>
                      <td style={{ maxWidth: 300 }}>{r.product}<div className={u.was}>Lot {r.lot}{r.inClearance ? (r.locations.some((n) => /damaged/i.test(n)) ? " · in Damaged Goods" : " · in Clearance") : ""}{r.reserved > 0 ? ` · ${r.reserved} reserved` : ""}</div></td>
                      <td style={{ whiteSpace: "nowrap", color: r.daysLeft <= 30 ? "var(--orange)" : undefined }}>{dLong(r.bestBefore)}<div className={u.was}>{r.expired ? "Past date" : `${r.daysLeft} days left`}</div></td>
                      <td className={u.num}>{r.units.toLocaleString("en-NZ")}</td>
                      <td className={u.num}>{r.perDay ? r.perDay.toLocaleString("en-NZ") : "-"}<div className={u.was}>{r.sellsInTime ? "Sells in time" : r.daysToSell ? `${r.daysToSell} days to sell` : "Not selling"}</div></td>
                      <td className={u.num}>{money(r.cost)}</td>
                      <td className={u.num}>{money(r.clearanceValue)}<div className={u.was}>{r.clearanceOff ? `${r.clearanceOff}% off` : "Can't sell"}</div></td>
                      <td className={u.num} style={{ color: r.atRisk > 0 ? "var(--orange)" : undefined }}>{r.atRisk > 0 ? money(r.atRisk) : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {pg.bar}
            </div>
          )}
          <div className={u.was} style={{ marginTop: 14, display: "flex", gap: 6, alignItems: "center" }}><Icon n="refresh" size={11} />Odoo read {new Date(d.generatedAt).toLocaleTimeString("en-NZ", { timeZone: "Pacific/Auckland", hour: "numeric", minute: "2-digit" })}</div>
        </>
      )}
    </Card>
  );
}
