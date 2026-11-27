"use client";

/**
 * One navigation for every dashboard page (left sidebar, 27 Nov 2026; docs/DESIGN-PLAYBOOK.md section 9).
 *
 * Labelled groups with an icon each, only the pages this person's department may open (from /api/auth/me). The Command
 * Center's own tabs live inside the sidebar under Marketing, so there is no second menu bar. Open by default; it collapses
 * to icons (remembered in this browser); on a phone it is a drawer opened from a menu button. Every page keeps a Back
 * button and a trail. Accessibility: Skip to content, labelled nav landmark, aria-current, 3px focus outline, 42px+ targets.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import n from "./nav.module.css";
import { Icon } from "./icons";

export const SECTION_ICONS = { overview: "grid", reps: "trending", margin: "percent", analytics: "bag", credits: "receipt", debtors: "wallet", command: "compass", socialweb: "globe", chat: "sparkle", repusage: "users", products: "bag", movers: "zap", customers: "trophy" };
const GROUP = ["products", "movers", "customers"];   // Categories & Products, Fast & Slow Movers and Customers are one "Analytics" page
const SHORT = { overview: "Overview", reps: "Sales", margin: "Margin", analytics: "Analytics", credits: "Credit notes", debtors: "Debtors", command: "Command Center", socialweb: "Social and web", chat: "Ask a question", repusage: "AI usage" };
/* The Command Center's tabs (app/command/page.js TABS), reached by /command#<tab> */
const CC_TABS = [
  { id: "dashboard", label: "Dashboard", icon: "home" },
  { id: "search", label: "Search", icon: "search" },
  { id: "social", label: "Social and web", icon: "megaphone" },
  { id: "outreach", label: "Outreach", icon: "mail" },
  { id: "listings", label: "Listings", icon: "pin" },
  { id: "pipeline", label: "Pipeline", icon: "flow" },
  { id: "meeting", label: "Ecom x Marketing", icon: "calendar" },
];
/* Groups by relationship, most used first */
const GROUPS = [
  { label: "Performance", ids: ["overview", "reps", "margin"] },
  { label: "Products and stock", ids: ["analytics"] },
  { label: "Money owed", ids: ["credits", "debtors"] },
  { label: "Marketing", ids: ["command", "socialweb"] },
  { label: "Help", ids: ["chat", "repusage"] },
];

/** The pages a department sees, as flat tabs (Analytics standing in for its three parts). */
export function navTabs(sections) {
  const mine = sections || [];
  const grouped = mine.filter((x) => GROUP.includes(x.id));
  const tabs = mine.filter((x) => !GROUP.includes(x.id));
  if (grouped.length) tabs.push({ id: "analytics", path: grouped[0].path, label: "Analytics" });
  return tabs;
}
export const isOn = (tabId, current) => (tabId === "analytics" ? GROUP.includes(current) : tabId === current);

const KEY = "wdd-side-v1";

/**
 * current: the section id of this page (overview, reps, margin, products, chat, command...).
 * sub:     the Command Center tab on screen (dashboard, search, ...), so it is marked in the sidebar.
 * trail:   extra steps after the page, e.g. [{ label: "Social & Web" }].
 * keep:    query text to carry to the other dashboard pages (company, year, view, dates).
 * me:      the /api/auth/me answer if the page already has it (otherwise it is fetched here).
 */
export default function SiteNav({ current, sub = null, trail = [], keep = "", me: meIn = null }) {
  const [meFetched, setMe] = useState(null);
  const [open, setOpen] = useState(true);       // wide sidebar (desktop)
  const [drawer, setDrawer] = useState(false);  // phone drawer
  useEffect(() => {
    try { const v = localStorage.getItem(KEY); if (v === "closed") setOpen(false); } catch { /* private window */ }
  }, []);
  useEffect(() => {
    document.body.dataset.side = open ? "open" : "closed";
    try { localStorage.setItem(KEY, open ? "open" : "closed"); } catch { /* private window */ }
  }, [open]);
  useEffect(() => () => { delete document.body.dataset.side; }, []);
  useEffect(() => {
    if (!drawer) return undefined;
    const esc = (e) => { if (e.key === "Escape") setDrawer(false); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [drawer]);
  useEffect(() => {
    if (meIn) return undefined;
    let stop = false;
    fetch("/api/auth/me", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => { if (!stop && j) setMe(j); }).catch(() => {});
    return () => { stop = true; };
  }, [meIn]);
  const me = meIn || meFetched;
  const tabs = navTabs(me?.sections);
  const byId = new Map(tabs.map((t) => [t.id, t]));
  const here = tabs.find((t) => isOn(t.id, current));
  const home = tabs[0]?.path || "/";
  const initials = (me?.name || me?.label || "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "W";
  const back = () => {
    try { if (document.referrer && new URL(document.referrer).origin === window.location.origin && window.history.length > 1) { window.history.back(); return; } } catch { /* fall through */ }
    window.location.href = home;
  };
  const steps = [{ label: "Dashboard", href: home }, ...(here && here.path !== home ? [{ label: SHORT[here.id] || here.label, href: here.path }] : []), ...trail];
  const hrefOf = (t) => `${t.path}${["overview", "reps", "margin", "analytics", "credits", "debtors"].includes(t.id) && keep ? `#${keep}` : ""}`;
  const wide = open || drawer;

  const list = (
    <nav className={n.groups} aria-label="Dashboard pages">
      {GROUPS.map((g) => {
        const items = g.ids.map((id) => byId.get(id)).filter(Boolean);
        if (!items.length) return null;
        return (
          <div key={g.label} className={n.group}>
            {wide ? <div className={n.groupLabel}>{g.label}</div> : <div className={n.groupRule} aria-hidden="true" />}
            {items.map((t) => {
              const on = isOn(t.id, current);
              return (
                <div key={t.id}>
                  <Link href={hrefOf(t)} className={`${n.item} ${on ? n.on : ""}`} aria-current={on && !(t.id === "command" && sub) ? "page" : undefined}
                    title={wide ? undefined : SHORT[t.id] || t.label} onClick={() => setDrawer(false)}>
                    <Icon n={SECTION_ICONS[t.id] || "grid"} size={18} /><span className={n.itemLabel}>{SHORT[t.id] || t.label}</span>
                  </Link>
                  {t.id === "command" && wide && (
                    <div className={n.subList}>
                      {CC_TABS.map((c) => {
                        const subOn = current === "command" && (sub || "dashboard") === c.id;
                        return (
                          <Link key={c.id} href={`/command#${c.id}`} className={`${n.subItem} ${subOn ? n.subOn : ""}`} aria-current={subOn ? "page" : undefined} onClick={() => setDrawer(false)}>
                            <Icon n={c.icon} size={15} /><span>{c.label}</span>
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </nav>
  );

  return (
    <>
      <a href="#main" className={n.skip}>Skip to content</a>
      <aside className={`${n.side} ${open ? "" : n.sideClosed} ${drawer ? n.sideDrawer : ""}`} aria-label="Menu">
        <div className={n.sideHead}>
          <Link href={home} className={n.brand} aria-label="Worthy dashboard home">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-black.png" alt="Worthy" className={n.logo} width="1069" height="707" />
          </Link>
          <button type="button" className={n.collapse} onClick={() => (drawer ? setDrawer(false) : setOpen((o) => !o))}
            aria-label={drawer ? "Close menu" : open ? "Collapse menu" : "Expand menu"} aria-expanded={wide}>
            <Icon n={drawer ? "close" : "sidebar"} size={18} />
          </button>
        </div>
        {list}
        <div className={n.sideFoot}>
          {me && <span className={n.me} title={me.label}><span className={n.avatar} aria-hidden="true">{initials}</span><span className={n.itemLabel}>{me.name || me.label}</span></span>}
          <button type="button" className={n.out} title={wide ? undefined : "Sign out"} onClick={async () => { await fetch("/api/auth/login", { method: "DELETE" }); window.location.href = "/login"; }}>
            <Icon n="out" size={16} /><span className={n.itemLabel}>Sign out</span>
          </button>
        </div>
      </aside>
      {drawer && <button type="button" className={n.scrim} aria-label="Close menu" onClick={() => setDrawer(false)} />}

      {/* Phone: a slim bar with the menu button */}
      <div className={n.phoneBar}>
        <button type="button" className={n.menuBtn} onClick={() => setDrawer(true)} aria-label="Open menu" aria-expanded={drawer}><Icon n="menu" size={20} /></button>
        <Link href={home} className={n.brand} aria-label="Worthy dashboard home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-black.png" alt="Worthy" className={n.logoSm} width="1069" height="707" />
        </Link>
        <span className={n.avatar} aria-hidden="true">{initials}</span>
      </div>

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
