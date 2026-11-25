"use client";

import SiteNav from "@/app/design/SiteNav";
import { useEffect, useState } from "react";
import { BarList, Card, CardHead, Icon, KpiStrip, Pill, Skeleton, ui } from "@/app/design/ui";
import css from "./rep-usage.module.css";

const when = (iso) => { try { return new Date(iso).toLocaleString("en-NZ", { timeZone: "Pacific/Auckland", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }); } catch { return iso; } };

const deviceOf = (x) => [x.device, x.system, x.browser].filter(Boolean).join(", ") || x.ua || "-";
const usd = (v) => `US$${v.toFixed(2)}`;
const tbl = `${ui.table} ${css.plain}`;

export default function RepUsage() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    fetch("/api/rep-usage", { cache: "no-store" }).then((r) => (r.ok ? r.json() : Promise.reject(r.status))).then(setD).catch((e) => setErr(String(e)));
  }, []);
  const name = (k) => d?.reps.find((r) => r.key === k)?.name || k;
  const signins = d?.signins || [];
  // The two bar charts show the same per-person figures as the table, largest first.
  const byQuestions = d ? d.reps.map((r) => ({ name: r.name, value: r.month.questions })).sort((a, b) => b.value - a.value) : [];
  const byCost = d ? d.reps.map((r) => ({ name: r.name, value: r.month.usd })).sort((a, b) => b.value - a.value) : [];
  const count = (list, test) => list.filter(test).length;
  return (
    <div className={css.page}>
      <div className={css.wrap}>
        <SiteNav current="repusage" />
        <div className={css.head} id="main" tabIndex={-1}>
          <span className={css.chip}><Icon n="sparkle" size={18} /></span>
          <h1 className={css.h1}>AI assistant usage and cost</h1>
        </div>
        {err && <Card><div className={css.warn}><Icon n="alert" size={16} />Could not load: {err}</div></Card>}
        {d?.note && <Card><div className={css.warn}><Icon n="alert" size={16} />{d.note}</div></Card>}
        {!d && !err && <Skeleton height={220} />}
        {d && (<>
          {d.cost && (
            <KpiStrip items={[
              { label: "AI cost this month", value: usd(d.cost.thisMonthUsd), icon: "dollar", accent: true },
              { label: "Last month", value: usd(d.cost.lastMonthUsd), icon: "calendar" },
              { label: "Questions this month", value: d.cost.thisMonthQuestions.toLocaleString(), icon: "search" },
              { label: "Questions the allowance permits per 30 days", value: d.cost.mostQuestionsPerCycle.toLocaleString("en-NZ"), icon: "hourglass" },
            ]} />
          )}

          <div className={ui.grid2}>
            <Card>
              <CardHead icon="bars" title="Questions this month by person" />
              <BarList rows={byQuestions} limit={byQuestions.length} />
            </Card>
            <Card>
              <CardHead icon="dollar" title="Cost this month by person" />
              <BarList rows={byCost} fmt={usd} limit={byCost.length} />
            </Card>
          </div>

          <Card>
            <CardHead icon="users" title="Questions and cost by person" />
            <div className={ui.tableWrap}>
              <table className={tbl}>
                <thead><tr>{["Person", "Where", "Email", "Today", "Last 7 days", "Left now", "This month", "Cost this month", "Answered", "Failed", "Average seconds"].map((h, i) => <th key={h} className={i > 2 ? ui.num : undefined}>{h}</th>)}</tr></thead>
                <tbody>{d.reps.map((r) => (
                  <tr key={r.key}><td className={css.strong}>{r.name}</td><td>{r.where}<div className={css.small}>{r.system}</div></td><td>{r.email || "-"}</td><td className={ui.num}>{r.today}</td><td className={ui.num}>{r.last7Days}</td><td className={ui.num}>{r.questionsLeft ?? "-"}</td><td className={ui.num}>{r.month.questions}</td><td className={`${ui.num} ${css.strong}`}>US${r.month.usd.toFixed(2)}</td><td className={ui.num}>{r.answered}</td><td className={ui.num}>{r.failed ? <Pill tone="accent">{r.failed}</Pill> : r.failed}</td><td className={ui.num}>{r.avgSeconds ?? "-"}</td></tr>
                ))}</tbody>
              </table>
            </div>
          </Card>

          <Card>
            <CardHead icon="user" title={`Sign-ins (${signins.length})`}>
              {signins.length > 0 && <><Pill tone="dark">{count(signins, (s) => s.ok)} signed in</Pill><Pill tone={count(signins, (s) => !s.ok) ? "accent" : "grey"}>{count(signins, (s) => !s.ok)} failed</Pill></>}
            </CardHead>
            {!signins.length ? <div className={css.mute}>None yet.</div> : (
              <div className={ui.tableWrap}>
                <table className={tbl}>
                  <thead><tr>{["When", "Lead", "Email typed", "Where", "Result", "Place (from internet address)", "Device and browser"].map((h) => <th key={h}>{h}</th>)}</tr></thead>
                  <tbody>{d.signins.map((s, i) => (
                    <tr key={i}><td style={{ whiteSpace: "nowrap" }}>{when(s.t)}</td><td>{s.rep ? name(s.rep) : "-"}</td><td>{s.email || "-"}</td><td>{s.how === "connector" ? "Claude / ChatGPT" : "My account page"}</td><td>{s.ok ? <Pill tone="dark">Signed in</Pill> : <Pill tone="accent">Failed</Pill>}</td><td>{s.place || "-"}{s.ip ? <div className={css.small}>{s.ip}</div> : null}</td><td style={{ maxWidth: 260 }}>{deviceOf(s)}</td></tr>
                  ))}</tbody>
                </table>
              </div>)}
          </Card>

          <Card>
            <CardHead icon="star" title={`"This looks wrong" and "Helpful" notes (${d.feedback.length})`}>
              {d.feedback.length > 0 && <><Pill tone={count(d.feedback, (f) => f.kind === "wrong") ? "accent" : "grey"}>{count(d.feedback, (f) => f.kind === "wrong")} looks wrong</Pill><Pill tone="dark">{count(d.feedback, (f) => f.kind !== "wrong")} helpful</Pill></>}
            </CardHead>
            {d.feedback.length === 0 ? <div className={css.mute}>None yet.</div> : (
              <div className={ui.tableWrap}>
                <table className={tbl}>
                  <thead><tr>{["When", "Rep", "Flag", "Question", "Their note", "The answer they saw"].map((h) => <th key={h}>{h}</th>)}</tr></thead>
                  <tbody>{d.feedback.map((f, i) => (
                    <tr key={i}><td style={{ whiteSpace: "nowrap" }}>{when(f.t)}</td><td>{name(f.rep)}</td><td>{f.kind === "wrong" ? <Pill tone="accent">Looks wrong</Pill> : <Pill tone="dark">Helpful</Pill>}</td><td>{f.question}</td><td>{f.note || "-"}</td><td className={css.wrapText} style={{ maxWidth: 420 }}>{f.answer}</td></tr>
                  ))}</tbody>
                </table>
              </div>)}
          </Card>

          <Card>
            <CardHead icon="search" title="Latest questions">
              {d.usage.length > 0 && <><Pill tone="dark">{count(d.usage, (u) => u.ok)} answered</Pill><Pill tone={count(d.usage, (u) => !u.ok) ? "accent" : "grey"}>{count(d.usage, (u) => !u.ok)} failed</Pill></>}
            </CardHead>
            <div className={ui.tableWrap}>
              <table className={tbl}>
                <thead><tr>{["When", "Lead", "Question and answer", "Looked up", "Result", "Seconds", "Place", "Device and browser"].map((h) => <th key={h}>{h}</th>)}</tr></thead>
                <tbody>{d.usage.map((u, i) => (
                  <tr key={i}><td style={{ whiteSpace: "nowrap" }}>{when(u.t)}</td><td>{name(u.rep)}</td><td style={{ maxWidth: 420, minWidth: 220 }}>{u.question || (u.where === "dashboard chat" ? <span className={css.mute}>(dashboard chat question, not kept)</span> : "")}{u.answer ? <details className={css.details}><summary><Icon n="eye" size={12} />Show the answer</summary><div className={css.answer}>{u.answer}</div></details> : null}</td><td>{(u.calls && u.calls.length ? u.calls.map((c) => [c.tool, c.person, c.about].filter(Boolean).join(": ")) : (u.tools || [])).join(", ") || "-"}</td><td>{u.ok ? <Pill tone="dark">Answered</Pill> : <Pill tone="accent">{`Failed${u.why ? `: ${u.why}` : ""}`}</Pill>}</td><td className={ui.num}>{u.ms ? Math.round(u.ms / 100) / 10 : "-"}</td><td>{u.place || "-"}{u.ip ? <div className={css.small}>{u.ip}</div> : null}</td><td>{deviceOf(u)}</td></tr>
                ))}</tbody>
              </table>
            </div>
          </Card>
        </>)}
      </div>
    </div>
  );
}
