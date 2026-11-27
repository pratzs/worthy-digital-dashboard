"use client";
/* Clearance and expired stock, with the warehouse total (lib/stockStates.js, /api/stock-states). Worthy Products North
   split by state; Worthy Products South (Dutch Rusk, Ostendo) shows its total only, as Ostendo keeps no best-before
   dates or clearance location. */
import React, { useEffect, useState } from "react";
import { Fold, Card, CardHead, Mini, Range, Skeleton, money, dLong, ui as u, usePaged } from "@/app/design/ui";
import { Icon } from "@/app/design/icons";

const KEY = "wdd-stock-states-v1";
const cacheGet = () => { try { const v = JSON.parse(localStorage.getItem(KEY) || "null"); return v && Date.now() - v.t < 30 * 60000 ? v.d : null; } catch { return null; } };
const cacheSet = (d) => { try { localStorage.setItem(KEY, JSON.stringify({ t: Date.now(), d })); } catch { /* private window */ } };
const n0 = (v) => Math.round(v || 0).toLocaleString("en-NZ");

export default function StockStates({ store = "worthy" }) {
  const [d, setD] = useState(() => (typeof window !== "undefined" ? cacheGet() : null));
  const [err, setErr] = useState("");
  const [hidden, setHidden] = useState(false);
  const [list, setList] = useState("expired");
  useEffect(() => {
    let stop = false;
    fetch("/api/stock-states", { cache: "no-store" })
      .then(async (r) => { if (r.status === 401 || r.status === 403) { if (!stop) setHidden(true); return null; } const j = await r.json(); if (!r.ok) throw new Error(j.error || `Error ${r.status}`); return j; })
      .then((j) => { if (!stop && j) { setD(j); cacheSet(j); } })
      .catch((e) => { if (!stop) setErr(String(e.message || e)); });
    return () => { stop = true; };
  }, []);
  const rows = d?.north?.[list] || [];
  const pg = usePaged(rows, list);
  if (hidden) return null;
  const n = d?.north, s = d?.south;
  const maxV = n?.states ? Math.max(...n.states.map((x) => x.value), 1) : 1;
  /* Follows the company picked at the top (27 Nov 2026): North shows North only; South (Dutch Rusk) its own warehouse only,
     as Ostendo keeps no best-before dates or clearance location to split it by. */
  if (store === "luxe") return (
    <Card style={{ marginBottom: 14 }} aria-label="Stock in the warehouse">
      <CardHead icon="wallet" title="Stock in the warehouse">{d && <Range>As at {dLong(d.today)}</Range>}</CardHead>
      {err && !d && <div className={u.empty}>Could not read stock: {err}</div>}
      {!d && !err && <Skeleton height={90} />}
      {d && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 18 }}>
            <div><div style={{ fontSize: 30, letterSpacing: "-.02em", color: "var(--orange-ink)" }}>{money(s?.total?.value)}</div><div className={u.statLabel}>Value at cost</div></div>
            <div><div style={{ fontSize: 30, letterSpacing: "-.02em" }}>{n0(s?.total?.units)}</div><div className={u.statLabel}>Units</div></div>
            <div><div style={{ fontSize: 30, letterSpacing: "-.02em" }}>{n0(s?.total?.products)}</div><div className={u.statLabel}>Products in stock</div></div>
          </div>
          <div className={u.was} style={{ marginTop: 14, display: "flex", gap: 6, alignItems: "center" }}><Icon n="refresh" size={11} />Read {new Date(d.generatedAt).toLocaleTimeString("en-NZ", { timeZone: "Pacific/Auckland", hour: "numeric", minute: "2-digit" })}</div>
        </>
      )}
    </Card>
  );
  return (
    <Card style={{ marginBottom: 14 }} aria-label="Clearance and expired stock">
      <CardHead icon="wallet" title="Clearance and expired stock">{d && <Range>As at {dLong(d.today)}</Range>}</CardHead>
      {err && !d && <div className={u.empty}>Could not read stock: {err}</div>}
      {!d && !err && <Skeleton height={220} />}
      {d && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 18, marginBottom: 22 }}>
            <div><div style={{ fontSize: 30, letterSpacing: "-.02em" }}>{money(n?.total?.value)}</div><div className={u.statLabel}>Whole warehouse · {n0(n?.total?.units)} units</div></div>
            <div><div style={{ fontSize: 30, letterSpacing: "-.02em", color: "var(--orange-ink)" }}>{money((n?.states || []).filter((x) => x.key !== "good" && x.key !== "short").reduce((t, x) => t + x.value, 0))}</div><div className={u.statLabel}>Past best-before, damaged and clearance</div></div>
          </div>

          <Mini icon="pie">By state</Mini>
          <div className={u.tableWrap}>
            <table className={u.table}>
              <thead><tr><th scope="col">State</th><th scope="col" style={{ width: "26%" }}>Share of stock value</th><th scope="col" className={u.num}>Products</th><th scope="col" className={u.num}>Units</th><th scope="col" className={u.num}>Value at cost</th></tr></thead>
              <tbody>
                {(n?.states || []).map((x, i) => (
                  <tr key={x.key}>
                    <td>{x.label}</td>
                    <td><div className={u.barTrack}><div className={`${u.barInk} ${i < 3 ? u.barAccent : ""}`} style={{ width: `${(x.value / maxV) * 100}%` }} /></div><div className={u.was} style={{ marginTop: 4 }}>{x.share}%</div></td>
                    <td className={u.num}>{n0(x.products)}</td>
                    <td className={u.num}>{n0(x.units)}</td>
                    <td className={u.num} style={{ color: i < 3 && x.value > 0 ? "var(--orange-ink)" : undefined }}>{money(x.value)}</td>
                  </tr>
                ))}
                <tr><td><strong>Whole warehouse</strong></td><td /><td /><td className={u.num}><strong>{n0(n?.total?.units)}</strong></td><td className={u.num}><strong>{money(n?.total?.value)}</strong></td></tr>
              </tbody>
            </table>
          </div>

          <Fold id="stock-states-items" icon="folder" title="What is in it" summary={`${(n?.expired || []).length} past best-before · ${(n?.damaged || []).length} damaged · ${(n?.clearance || []).length} in clearance`}>
          <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 10, flexWrap: "wrap", margin: "0 0 10px" }}>
            <div className={u.seg} role="group" aria-label="List">
              {[["expired", "Past best-before"], ["damaged", "Damaged Goods"], ["clearance", "Clearance location"]].map(([k, t]) => (
                <button key={k} type="button" className={list === k ? u.segOn : ""} aria-pressed={list === k} onClick={() => setList(k)}>{t}</button>
              ))}
            </div>
          </div>
          {!rows.length ? <div className={u.empty}>Nothing here</div> : (
            <div className={u.tableWrap}>
              <table className={u.table}>
                <thead><tr><th scope="col">Product</th><th scope="col">Best-before</th><th scope="col">Location</th><th scope="col" className={u.num}>Units</th><th scope="col" className={u.num}>Value at cost</th></tr></thead>
                <tbody>
                  {pg.shown.map((r) => (
                    <tr key={`${r.product}|${r.lot}|${r.location}`}>
                      <td style={{ maxWidth: 320 }}>{r.product}{r.lot && <div className={u.was}>Lot {r.lot}</div>}</td>
                      <td style={{ whiteSpace: "nowrap" }}>{r.bestBefore ? dLong(r.bestBefore) : "-"}</td>
                      <td className={u.was}>{r.location}</td>
                      <td className={u.num}>{r.units.toLocaleString("en-NZ")}</td>
                      <td className={u.num}>{money(r.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {pg.bar}
            </div>
          )}
          </Fold>
          <div className={u.was} style={{ marginTop: 14, display: "flex", gap: 6, alignItems: "center" }}><Icon n="refresh" size={11} />Read {new Date(d.generatedAt).toLocaleTimeString("en-NZ", { timeZone: "Pacific/Auckland", hour: "numeric", minute: "2-digit" })}</div>
        </>
      )}
    </Card>
  );
}
