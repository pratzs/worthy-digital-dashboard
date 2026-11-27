"use client";
/* Weekly summary for management (lib/weeklySummary.js, /api/summary), the same card as on the Command Center, built from
   the dashboard kit so it sits in the Overview with the page's own spacing (14px gaps). A draft to copy or open as an
   email; nothing is sent from here. Management only: the route turns everyone else away and the card then shows nothing. */
import React, { useEffect, useState } from "react";
import { Win, Card, CardHead, Mini, Range, Skeleton, money, dShort, dLong, ui as u } from "@/app/design/ui";
import { Icon } from "@/app/design/icons";

const KEY = "wdd-summary-v1";
const cacheGet = () => { try { const v = JSON.parse(localStorage.getItem(KEY) || "null"); return v && Date.now() - v.t < 10 * 60000 ? v.d : null; } catch { return null; } };
const cacheSet = (d) => { try { localStorage.setItem(KEY, JSON.stringify({ t: Date.now(), d })); } catch { /* private window */ } };
const pctT = (v) => (v == null ? "-" : `${Number(v).toFixed(1)}%`);

export default function WeeklySummary({ style }) {
  const [d, setD] = useState(() => (typeof window !== "undefined" ? cacheGet() : null));
  const [err, setErr] = useState("");
  const [hidden, setHidden] = useState(false);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let stop = false;
    fetch("/api/summary", { cache: "no-store" })
      .then(async (r) => { if (r.status === 401 || r.status === 403) { if (!stop) setHidden(true); return null; } const j = await r.json(); if (!r.ok) throw new Error(j.error || `Error ${r.status}`); return j; })
      .then((j) => { if (!stop && j) { setD(j); cacheSet(j); } })
      .catch((e) => { if (!stop) setErr(String(e.message || e)); });
    return () => { stop = true; };
  }, []);
  if (hidden) return null;
  if (err && !d) return <Card style={style}><div className={u.empty}>Weekly summary could not load: {err}</div></Card>;
  if (!d) return <Card style={style}><Skeleton height={160} /></Card>;
  const subject = `Weekly summary, ${dShort(d.week.start)} to ${dLong(d.week.end)}`;
  return (
    <Card style={style} aria-label="Weekly summary">
      <CardHead icon="mail" title="Weekly summary">
        <Range>{dShort(d.week.start)} to {dLong(d.week.end)}</Range>
        <button type="button" className={`${u.btn} ${u.btnSmall}`} onClick={() => setOpen((o) => !o)} aria-expanded={open}><Icon n="eye" size={14} />{open ? "Hide draft" : "Show draft"}</button>
        <button type="button" className={`${u.btn} ${u.btnSmall}`} onClick={() => { navigator.clipboard?.writeText(d.text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }); }}><Icon n="check" size={14} />{copied ? "Copied" : <Win win="Copy the wins">Copy</Win>}</button>
        <a className={`${u.btn} ${u.btnSmall} ${u.btnDark}`} href={`mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(d.text)}`}><Icon n="out" size={14} /><Win win="Share this week's wins">Open as email draft</Win></a>
      </CardHead>
      <div className={u.grid3}>
        {d.business.map((b) => (
          <div key={b.name} className={u.stat}>
            <Mini icon="building">{b.name}</Mini>
            <div className={u.statNum}>{money(b.week?.sales ?? b.month?.sales)}</div>
            <div className={u.statLabel}>{b.week ? `Last week at ${pctT(b.week.margin)}` : b.month ? `${b.month.label} so far at ${pctT(b.month.margin)}` : "-"}</div>
            {b.week && b.month && <div className={u.rowMeta}>{b.month.label} so far {money(b.month.sales)} at {pctT(b.month.margin)}</div>}
            {b.lastMonth && <div className={u.rowMeta}>{b.lastMonth.label} {money(b.lastMonth.sales)} at {pctT(b.lastMonth.margin)}</div>}
          </div>
        ))}
      </div>
      <div className={u.grid2} style={{ marginTop: 22 }}>
        <div>
          <Mini icon="alert">Margin watch</Mini>
          {d.pulls?.length > 0 && <div className={u.rowMeta} style={{ marginBottom: 8 }}>Worthy Products last week, biggest pulls: {d.pulls.map((g) => `${g.label.toLowerCase()} ${g.pts.toFixed(1)} pts`).join(", ")}</div>}
          {!d.watch.length ? <div className={u.empty}>No salesperson is 2 points or more under their usual margin</div> : d.watch.slice(0, 8).map((w) => (
            <div key={`${w.business}|${w.rep}|${w.month}`} className={u.row}>
              <div style={{ minWidth: 0 }}><div className={u.rowTitle}>{w.rep}</div><div className={u.rowMeta}>{w.business} · {w.month}{w.through ? " so far" : ""} · {money(w.sales)}</div></div>
              <span style={{ color: "var(--orange-ink)", fontSize: 15, whiteSpace: "nowrap" }}>{pctT(w.margin)} <span className={u.rowMeta}>vs {pctT(w.usual)}</span></span>
            </div>
          ))}
        </div>
        <div>
          <Mini icon="hourglass">Short-dated stock, Worthy Products</Mini>
          {d.shortDated ? (
            <>
              <div className={u.row}><div className={u.rowTitle}>Past best-before</div><span>{money(d.shortDated.past?.cost)} <span className={u.rowMeta}>· {d.shortDated.past?.lots || 0} lots</span></span></div>
              <div className={u.row}><div className={u.rowTitle}>Won&apos;t sell in time</div><span>{money(d.shortDated.wontSellCost)} <span className={u.rowMeta}>· {d.shortDated.wontSellLots} lots</span></span></div>
              <div className={u.row}><div className={u.rowTitle}>Within 90 days, all</div><span>{money(d.shortDated.cost)} <span className={u.rowMeta}>· {d.shortDated.lots} lots</span></span></div>
            </>
          ) : <div className={u.empty}>Not available</div>}
        </div>
      </div>
      {open && <pre style={{ whiteSpace: "pre-wrap", font: "inherit", fontSize: 14.5, marginTop: 18, padding: 16, borderRadius: 14, background: "rgba(0,0,0,.03)" }}>{d.text}</pre>}
    </Card>
  );
}
