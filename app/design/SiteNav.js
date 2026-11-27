"use client";

/**
 * One navigation for every dashboard page (26 Nov 2026): Worthy logo home, the pages this person's department may open
 * (from /api/auth/me, so nobody is shown a page they cannot open), the current page marked, Sign out, then a Back button
 * and a trail (Dashboard / page / part) so there is always a way back.
 * Accessibility: a "Skip to content" link, a labelled nav landmark, aria-current on the page you are on, visible focus
 * rings and 40px or larger targets (styles in nav.module.css).
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import n from "./nav.module.css";
import { Icon } from "./icons";

export const SECTION_ICONS = { margin: "percent", overview: "grid", analytics: "bars", credits: "receipt", debtors: "wallet", chat: "sparkle", repusage: "users", socialweb: "megaphone", command: "compass", reps: "users", products: "award", movers: "zap", customers: "trophy" };
const GROUP = ["products", "movers", "customers"];   // Categories & Products, Fast & Slow Movers and Customers are one "Analytics" tab
const SHORT = { reps: "Sales", margin: "Margin", overview: "Overview", chat: "Ask a Question", repusage: "AI usage", socialweb: "Social and Web", command: "Command Center", credits: "Credit Notes", debtors: "Debtors", analytics: "Analytics" };

/** The tabs a department sees, in order. */
export function navTabs(sections) {
  const mine = sections || [];   // Sales (/reps) and Margin are their own pages again (27 Nov 2026)
  const grouped = mine.filter((x) => GROUP.includes(x.id));
  const tabs = mine.filter((x) => !GROUP.includes(x.id));
  if (grouped.length) {
    const at = tabs.findIndex((x) => x.id === "credits" || x.id === "debtors");
    tabs.splice(at >= 0 ? at : tabs.length, 0, { id: "analytics", path: grouped[0].path, label: "Analytics" });
  }
  return tabs;
}
export const isOn = (tabId, current) => (tabId === "analytics" ? GROUP.includes(current) : tabId === current);

/**
 * current: the section id of this page (overview, products, chat, repusage, socialweb, command...).
 * trail:   extra steps after the page, e.g. [{ label: "Social & Web" }] for a Command Center tab.
 * keep:    query text to carry to the other dashboard pages (company, year, view).
 * me:      the /api/auth/me answer if the page already has it (otherwise it is fetched here).
 */
export default function SiteNav({ current, trail = [], keep = "", me: meIn = null }) {
  const [meFetched, setMe] = useState(null);
  useEffect(() => {
    if (meIn) return undefined;
    let stop = false;
    fetch("/api/auth/me", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => { if (!stop && j) setMe(j); }).catch(() => {});
    return () => { stop = true; };
  }, [meIn]);
  const me = meIn || meFetched;
  const tabs = navTabs(me?.sections);
  const here = tabs.find((t) => isOn(t.id, current));
  const home = tabs[0]?.path || "/";
  const initials = (me?.name || me?.label || "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "W";
  const back = () => {
    // Back within the dashboard when there is somewhere to go back to; otherwise to the first page.
    try { if (document.referrer && new URL(document.referrer).origin === window.location.origin && window.history.length > 1) { window.history.back(); return; } } catch { /* fall through */ }
    window.location.href = home;
  };
  const steps = [{ label: "Dashboard", href: home }, ...(here && here.path !== home ? [{ label: SHORT[here.id] || here.label, href: here.path }] : []), ...trail];
  return (
    <>
      <a href="#main" className={n.skip}>Skip to content</a>
      <header className={n.top}>
        <Link href={home} className={n.brand} aria-label="Worthy dashboard home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-black.png" alt="Worthy" className={n.logo} width="1069" height="707" />
        </Link>
        <nav className={n.nav} aria-label="Dashboard pages">
          {tabs.map((t) => {
            const on = isOn(t.id, current);
            const dash = ["overview", "analytics", "credits", "debtors"].includes(t.id);
            return (
              <Link key={t.id} href={`${t.path}${dash && keep ? `#${keep}` : ""}`} className={`${n.btn} ${on ? n.on : ""}`} aria-current={on ? "page" : undefined}>
                <Icon n={SECTION_ICONS[t.id] || "grid"} size={15} />{SHORT[t.id] || t.label}
              </Link>
            );
          })}
        </nav>
        <div className={n.tools}>
          {me && <span className={n.me} title={me.label}><span className={n.avatar} aria-hidden="true">{initials}</span><span className={n.meLabel}>{me.name || me.label}</span></span>}
          <button type="button" className={n.out} onClick={async () => { await fetch("/api/auth/login", { method: "DELETE" }); window.location.href = "/login"; }}>
            <Icon n="out" size={14} />Sign out
          </button>
        </div>
      </header>
      <div className={n.trailRow}>
        <button type="button" className={n.backBtn} onClick={back} aria-label="Go back"><Icon n="move" size={15} style={{ transform: "rotate(180deg)" }} />Back</button>
        <nav aria-label="You are here" className={n.trail}>
          <ol>
            {steps.map((s, i) => (
              <li key={`${s.label}-${i}`}>
                {i < steps.length - 1 && s.href ? <Link href={s.href}>{s.label}</Link> : <span aria-current={i === steps.length - 1 ? "page" : undefined}>{s.label}</span>}
              </li>
            ))}
          </ol>
        </nav>
      </div>
    </>
  );
}
