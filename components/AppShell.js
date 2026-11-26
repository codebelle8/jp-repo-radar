"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { LanguageSwitch } from "@/components/LanguageSwitch";
import { NotificationBell } from "@/components/NotificationBell";
import { useStatus, useT } from "@/components/providers";
import { ago, localClock } from "@/lib/format";
import { msg } from "@/lib/i18n";

const TABS = [
  { href: "/", label: msg("Overview"), match: (p) => p === "/" },
  { href: "/companies", label: msg("Companies"), match: (p) => p.startsWith("/companies") },
  { href: "/repos", label: msg("Repositories"), match: (p) => p.startsWith("/repos") },
  { href: "/contribute", label: msg("Contribute"), match: (p) => p.startsWith("/contribute") },
  { href: "/discovery", label: msg("Discovery"), match: (p) => p.startsWith("/discovery") },
  { href: "/tracker", label: msg("Tracker"), match: (p) => p.startsWith("/tracker"), private: true },   // only when signed in
  { href: "/fixes", label: msg("Auto-fix"), match: (p) => p.startsWith("/fixes"), private: true },
  { href: "/settings", label: msg("Settings"), match: (p) => p.startsWith("/settings") },
];

function JobBar() {
  const { status, stopJob, canEdit } = useStatus();
  const { t } = useT();
  const [logOpen, setLogOpen] = useState(false);
  const logRef = useRef(null);
  const job = status?.job;
  const running = job?.status === "running";
  useEffect(() => {
    const el = logRef.current;
    if (el && logOpen) el.scrollTop = el.scrollHeight;
  }, [job?.logs?.length, logOpen]);
  if (!running) return null;
  const waiting = job.waitUntil && Date.now() < job.waitUntil;
  const pct = job.total ? (job.done / job.total) * 100 : 0;
  const label = waiting ? t("Paused for GitHub's rate limit until {time}", { time: localClock(job.waitUntil) })
    : t(job.current);
  return (
    <div className="jobbar">
      <div className="wrap jobbar-inner">
        <div className="jobbar-text"><span className="spinner" aria-hidden="true" /><span>{t(job.label)} — {label}</span></div>
        <div className="meter" aria-hidden="true">
          <div className={`meter-fill${!job.total ? " indeterminate" : ""}`} style={job.total ? { width: `${pct.toFixed(1)}%` } : undefined} />
        </div>
        <span className="muted small">{job.total ? `${job.done} / ${job.total}` : job.foundCount != null ? t("{n} found", { n: job.foundCount }) : ""}</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setLogOpen((v) => !v)}>{t("Log")}</button>
        {canEdit ? <button type="button" className="btn btn-ghost btn-sm" onClick={stopJob}>{t("Stop")}</button> : null}
      </div>
      {logOpen ? <div className="wrap"><pre className="joblog" ref={logRef}>{(job.logs || []).map((line) => t(line)).join("\n")}</pre></div> : null}
      <div className="wrap jobbar-hint small muted">{status.onVercel
        ? t("Runs in short steps while this page is open (and daily via Vercel Cron). You can close it and continue later.")
        : t("Runs in short steps while this page is open. You can close it and continue later.")}</div>
    </div>
  );
}

function ThemeButton() {
  const { t } = useT();
  function toggle() {
    const root = document.documentElement;
    const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    root.dataset.theme = dark ? "light" : "dark";
    try { localStorage.setItem("jprr-theme", root.dataset.theme); } catch { /* ignore */ }
  }
  return (
    <button className="icon-btn" type="button" title={t("Switch theme")} aria-label={t("Switch theme")} onClick={toggle}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9z" /></svg>
    </button>
  );
}

export function AppShell({ children }) {
  const pathname = usePathname() || "/";
  const { status, statusError } = useStatus();
  const { t, rich, lang } = useT();
  const pending = status?.counts?.candidatesPending || 0;
  const lc = status?.lastCollect;
  const gap = lang === "ja" ? "" : " ";   // Japanese sentences are not separated by spaces
  return (
    <>
      <header className="topbar">
        <div className="wrap topbar-inner">
          <Link className="brand" href="/">
            <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="14" /><circle cx="16" cy="16" r="6" className="brand-dot" /></svg>
            <span><strong>JP Repo Radar</strong><span className="brand-sub">{t("Japanese web-dev companies on GitHub")}</span></span>
          </Link>
          <nav className="tabs" aria-label={t("Sections")}>
            {TABS.filter((tab) => !tab.private || status?.admin?.ok).map((tab) => (
              <Link key={tab.href} href={tab.href} className={tab.match(pathname) ? "active" : undefined}>
                {t(tab.label)}
                {tab.href === "/discovery" && pending ? <span className="badge">{pending > 999 ? "999+" : pending}</span> : null}
              </Link>
            ))}
          </nav>
          <NotificationBell />
          <LanguageSwitch />
          <ThemeButton />
        </div>
      </header>
      {status?.storage?.ephemeral ? (
        <div className="banner warn"><div className="wrap">
          {rich("Storage is not connected: data on this deployment is temporary. In Vercel, open <b>Storage</b>, create a <b>Neon</b> (Postgres) or <b>Upstash for Redis</b> database, connect it to this project and redeploy.",
            { b: (c) => <b>{c}</b> })}
        </div></div>
      ) : null}
      {statusError && !status ? (
        <div className="banner warn"><div className="wrap">{t("Cannot reach the server: {message}", { message: t(statusError.message) })}</div></div>
      ) : null}
      <JobBar />
      <main className="wrap">{children}</main>
      <footer className="wrap footer muted small">
        {t("Counts cover public, non-fork repositories only. Data from the GitHub API.")}
        {status ? (lc ? `${gap}${t("Last collection: {when} ({status}).", { when: ago(lc.finishedAt || lc.startedAt), status: t(lc.status) })}`
          : `${gap}${t("Not collected yet.")}`) : ""}
      </footer>
    </>
  );
}
