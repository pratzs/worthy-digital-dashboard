"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BarList, Big, Card, CardHead, Empty, Icon, Mini, MonthBars, Pill, Range, Ring, Skeleton, StatLine, Trend, dLong as day, money, monthLabel as mon, n0, pct, ui } from "@/app/design/ui";
import css from "./social-web.module.css";

const tbl = `${ui.table} ${css.plain}`;

function Table({ title, icon, cols, rows }) {
  if (!rows?.length) return null;
  return (
    <div style={{ minWidth: 0 }}>
      <Mini icon={icon}>{title}</Mini>
      <div className={ui.tableWrap}>
        <table className={tbl}>
          <thead><tr>{cols.map((c, i) => <th key={c[0]} className={i ? ui.num : undefined}>{c[0]}</th>)}</tr></thead>
          <tbody>{rows.map((r, j) => <tr key={j}>{cols.map((c, i) => <td key={c[0]} className={i ? ui.num : css.nameCell}>{c[1](r)}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}

function Site({ s, range }) {
  const shop = s.source === "shopify";
  const head = (
    <CardHead icon={shop ? "store" : "building"} title={<a href={`https://${s.name}`} target="_blank" rel="noreferrer" className={css.siteLink}>{s.name}<Icon n="out" size={13} /></a>}>
      <Pill>{shop ? "Shopify" : "Google Analytics"}</Pill>
      <span className={css.rangeWrap}><Range>{range}</Range></span>
    </CardHead>
  );
  if (s.status !== "ok") {
    const msg = s.status === "not_connected" ? "Not connected yet" : s.status === "no_property" ? "Waiting for its Google Analytics property" : `Could not load: ${s.error || "error"}`;
    return <Card>{head}<Empty>{msg}</Empty></Card>;
  }
  const t = s.totals;
  return (
    <Card>
      {head}
      <StatLine>
        {shop ? (<>
          {t.sessions && <Big label="NZ sessions" pair={t.sessions} />}
          {t.conversion && <Big label="NZ conversion rate" pair={t.conversion} fmt={pct} />}
          {t.orders && <Big label="Online orders" pair={t.orders} />}
          {t.revenue && <Big label="Online net sales" pair={t.revenue} fmt={money} accent />}
        </>) : (<>
          {t.visitors && <Big label="Visitors" pair={t.visitors} />}
          {t.newVisitors && <Big label="New visitors" pair={t.newVisitors} />}
          {t.sessions && <Big label="Sessions" pair={t.sessions} />}
          {t.engagedRate && <Big label="Engaged sessions" pair={t.engagedRate} fmt={pct} />}
          {t.pageViews && <Big label="Page views" pair={t.pageViews} />}
          {t.keyEvents && <Big label="Key events" pair={t.keyEvents} accent />}
          {t.orders && <Big label="Orders" pair={t.orders} />}
          {t.revenue && <Big label="Revenue" pair={t.revenue} fmt={money} />}
        </>)}
      </StatLine>

      <div className={`${ui.grid2} ${css.block}`}>
        {s.months?.length > 0 && (
          <div>
            <Mini icon="bars">{shop ? "NZ sessions by month" : "Visitors by month"}</Mini>
            <MonthBars rows={s.months} k={shop ? "sessions" : "visitors"} />
          </div>
        )}
        {shop
          ? s.months?.length > 0 && <div><Mini icon="bag">Online net sales by month</Mini><MonthBars rows={s.months} k="revenue" fmt={money} /></div>
          : s.devices?.length > 0 && <div><Mini icon="devices">Device</Mini><Ring rows={s.devices} k="sessions" /></div>}
      </div>
      <div className={`${ui.grid2} ${css.block}`}>
        {s.sources?.length > 0 && (
          <div>
            <Mini icon="compass">{shop ? "Where NZ visitors came from" : "Where visitors came from"}</Mini>
            <BarList rows={s.sources} k="sessions" caps />
          </div>
        )}
        {shop
          ? s.devices?.length > 0 && <div><Mini icon="devices">Device</Mini><Ring rows={s.devices} k="sessions" /></div>
          : s.pages?.length > 0 && <div><Mini icon="eye">Most viewed pages</Mini><BarList rows={s.pages} k="views" /></div>}
      </div>

      <div className={`${css.details} ${css.tables}`}>
        <Table icon="compass" title={shop ? "Where NZ visitors came from" : "Where visitors came from"} cols={[["Source", (r) => r.name], ["Sessions", (r) => n0(r.sessions)], ...(s.source === "ga4" ? [["Key events", (r) => n0(r.keyEvents)]] : [])]} rows={s.sources} />
        {s.pages && <Table icon="eye" title="Most viewed pages" cols={[["Page", (r) => r.name], ["Views", (r) => n0(r.views)], ["Visitors", (r) => n0(r.visitors)]]} rows={s.pages} />}
        {s.channels && <Table icon="cart" title="Sales by channel" cols={[["Channel", (r) => r.name], ["Orders", (r) => n0(r.orders)], ["Net sales", (r) => money(r.revenue)]]} rows={s.channels} />}
        <Table icon="devices" title="Device" cols={[["Device", (r) => r.name], ["Sessions", (r) => n0(r.sessions)]]} rows={s.devices} />
      </div>
    </Card>
  );
}

const SOCIAL_COLS = [["views", "Views"], ["reach", "Reach"], ["engagements", "Engagements"], ["profileViews", "Profile visits"], ["newFollows", "New followers"]];

function Social({ meta, range }) {
  if (meta.status !== "ok") {
    return <Card><CardHead icon="megaphone" title="Facebook and Instagram" /><Empty>{meta.status === "not_connected" ? "Not connected yet" : `Could not load: ${meta.error}`}</Empty></Card>;
  }
  const cell = (pair) => pair ? <><div>{n0(pair[0])}</div><div className={css.chg}><Trend now={pair[0]} before={pair[1]} /></div></> : "-";
  const views = meta.accounts.map((a) => ({ name: a.name, views: a.totals?.views?.[0] || 0 })).sort((a, b) => b.views - a.views);
  return (<>
    <Card>
      <CardHead icon="megaphone" title="Facebook and Instagram"><span className={css.rangeWrap}><Range>{range}</Range></span></CardHead>
      {views.some((v) => v.views > 0) && (
        <div style={{ marginBottom: 22 }}>
          <Mini icon="eye">Views by account</Mini>
          <BarList rows={views} k="views" limit={views.length} />
        </div>
      )}
      <div className={ui.tableWrap}>
        <table className={tbl}>
          <thead><tr><th>Account</th><th className={ui.num}>Followers</th>{SOCIAL_COLS.map(([, l]) => <th key={l} className={ui.num}>{l}</th>)}</tr></thead>
          <tbody>{meta.accounts.map((a) => (
            <tr key={a.platform + a.name}>
              <td><a href={a.link} target="_blank" rel="noreferrer" className={css.acctLink}>{a.name}</a><div className={css.small}>{a.platform}</div></td>
              <td className={ui.num}>{n0(a.followers)}</td>
              {SOCIAL_COLS.map(([k]) => <td key={k} className={ui.num}>{cell(a.totals?.[k])}</td>)}
            </tr>
          ))}</tbody>
        </table>
      </div>
    </Card>
    <div className={css.posts}>
      {meta.accounts.filter((a) => a.posts?.length).map((a) => (
        <Card key={a.platform + a.name}>
          <CardHead icon={a.platform === "Instagram" ? "instagram" : "facebook"} title={`Latest posts, ${a.name} (${a.platform})`} />
          {a.posts.map((p, i) => (
            <a key={i} href={p.link} target="_blank" rel="noreferrer" className={css.post}>
              <div style={{ minWidth: 0 }}>
                <div className={css.postMeta}>{day(p.when)}</div>
                <div className={css.postText}>{p.text || "(no caption)"}</div>
                <div className={css.postStats}>{n0(p.reactions)} likes, {n0(p.comments)} comments{p.shares !== null ? `, ${n0(p.shares)} shares` : ""}</div>
              </div>
              <Icon n="out" size={14} />
            </a>
          ))}
        </Card>
      ))}
    </div>
  </>);
}

function Manual({ manual, onSaved }) {
  const thisMonth = new Date().toLocaleDateString("en-CA", { timeZone: "Pacific/Auckland" }).slice(0, 7);
  const [form, setForm] = useState({ account: manual.accounts[0]?.id, month: thisMonth, values: {} });
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const months = [...new Set(Object.values(manual.values || {}).flatMap((m) => Object.keys(m)))].sort().reverse().slice(0, 6);
  const pick = (account, month) => setForm({ account, month, values: { ...((manual.values?.[account] || {})[month] || {}) } });
  const save = async () => {
    setBusy(true); setMsg("");
    try {
      const r = await fetch("/api/social-web/manual", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || r.status);
      setMsg("Saved"); onSaved(j.values);
    } catch (e) { setMsg(`Not saved: ${e.message}`); } finally { setBusy(false); }
  };
  return (
    <Card>
      <CardHead icon="users" title="LinkedIn and TikTok" />
      {months.length ? (
        <div className={ui.tableWrap}>
          <table className={tbl}>
            <thead><tr><th>Account</th><th>Month</th>{manual.fields.map((f) => <th key={f.id} className={ui.num}>{f.label}</th>)}</tr></thead>
            <tbody>{manual.accounts.flatMap((a) => months.filter((m) => manual.values?.[a.id]?.[m]).map((m) => (
              <tr key={a.id + m} onClick={() => pick(a.id, m)} className={css.clickRow}>
                <td><span style={{ fontWeight: 500 }}>{a.name}</span><div className={css.small}>{a.platform}</div></td>
                <td style={{ whiteSpace: "nowrap" }}>{mon(m)}</td>
                {manual.fields.map((f) => <td key={f.id} className={ui.num}>{n0(manual.values[a.id][m][f.id])}</td>)}
              </tr>
            )))}</tbody>
          </table>
        </div>
      ) : <Empty>No figures entered yet.</Empty>}
      <div className={css.form}>
        <label className={css.field}>Account
          <select value={form.account} onChange={(e) => pick(e.target.value, form.month)}>
            {manual.accounts.map((a) => <option key={a.id} value={a.id}>{a.platform}: {a.name}</option>)}
          </select>
        </label>
        <label className={css.field}>Month
          <input type="month" value={form.month} onChange={(e) => pick(form.account, e.target.value)} />
        </label>
        {manual.fields.map((f) => (
          <label key={f.id} className={css.field}>{f.label}
            <input inputMode="numeric" value={form.values[f.id] ?? ""} onChange={(e) => setForm({ ...form, values: { ...form.values, [f.id]: e.target.value } })} />
          </label>
        ))}
        <button onClick={save} disabled={busy} className={`${ui.btn} ${ui.btnDark} ${css.save}`}><Icon n="check" size={14} />{busy ? "Saving..." : "Save"}</button>
      </div>
      {msg && <div className={css.msg}>{msg === "Saved" ? <span className={css.ok}><Icon n="check" size={14} />{msg}</span> : <span className={css.warn}><Icon n="alert" size={14} />{msg}</span>}</div>}
    </Card>
  );
}

export default function SocialWeb() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  const fetchData = (fresh) => fetch(`/api/social-web${fresh ? "?fresh=1" : ""}`, { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : Promise.reject(r.status))).then(setD).catch((e) => setErr(String(e))).finally(() => setLoading(false));
  const load = (fresh) => { setLoading(true); setErr(""); fetchData(fresh); };
  useEffect(() => { fetchData(false); }, []);
  const p = d?.web?.periods;
  const range = p ? `${day(p.start)} to ${day(p.end)}, against ${day(p.prevStart)} to ${day(p.prevEnd)}` : "";
  return (
    <div className={css.page}>
      <div className={css.wrap}>
        <div className={css.head}>
          <Link href="/" className={css.crumb}><Icon n="home" size={13} />Dashboard</Link>
          <span className={css.slash}>/</span>
          <h1 className={css.h1}><span className={css.chip}><Icon n="globe" size={18} /></span>Social and Web</h1>
          <span className={css.spacer} />
          <button onClick={() => load(true)} disabled={loading} className={`${ui.btn} ${ui.btnSmall}`}><Icon n="refresh" size={13} />{loading ? "Loading..." : "Refresh"}</button>
        </div>
        {err && <Card style={{ marginTop: 12 }}><div className={css.warn}><Icon n="alert" size={15} />Could not load: {err}</div></Card>}
        {!d && !err && <div style={{ marginTop: 16 }}><Skeleton height={320} /></div>}
        {d && (<>
          <h2 className={css.section}><span className={css.sectionChip}><Icon n="globe" size={15} /></span>Websites</h2>
          <div className={css.stack}>
            {d.web.sites.map((s) => <Site key={s.id} s={s} range={range} />)}
          </div>
          <h2 className={css.section}><span className={css.sectionChip}><Icon n="megaphone" size={15} /></span>Social media</h2>
          <Social meta={d.meta} range={range} />
          <div style={{ height: 14 }} />
          <Manual manual={d.manual} onSaved={(values) => setD({ ...d, manual: { ...d.manual, values } })} />
        </>)}
      </div>
    </div>
  );
}
