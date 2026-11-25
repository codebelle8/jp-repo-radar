"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useStatus } from "@/components/providers";
import { ago } from "@/lib/format";

const TABS = [
  { href: "/", label: "Overview", match: (p) => p === "/" },
  { href: "/companies", label: "Companies", match: (p) => p.startsWith("/companies") },
  { href: "/repos", label: "Repositories", match: (p) => p.startsWith("/repos") },
  { href: "/contribute", label: "Contribute", match: (p) => p.startsWith("/contribute") },
  { href: "/discovery", label: "Discovery", match: (p) => p.startsWith("/discovery") },
  { href: "/tracker", label: "Tracker", match: (p) => p.startsWith("/tracker"), private: true },   // only when signed in
  { href: "/settings", label: "Settings", match: (p) => p.startsWith("/settings") },
];

function JobBar() {
  const { status, stopJob, canEdit } = useStatus();
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
  const label = waiting ? `Paused for GitHub's rate limit until ${new Date(job.waitUntil).toLocaleTimeString()}`
    : job.phase === "search" ? `${job.current}` : job.current;
  return (
    <div className="jobbar">
      <div className="wrap jobbar-inner">
        <div className="jobbar-text"><span className="spinner" aria-hidden="true" /><span>{job.label} — {label}</span></div>
        <div className="meter" aria-hidden="true">
          <div className={`meter-fill${!job.total ? " indeterminate" : ""}`} style={job.total ? { width: `${pct.toFixed(1)}%` } : undefined} />
        </div>
        <span className="muted small">{job.total ? `${job.done} / ${job.total}` : job.foundCount != null ? `${job.foundCount} found` : ""}</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setLogOpen((v) => !v)}>Log</button>
        {canEdit ? <button type="button" className="btn btn-ghost btn-sm" onClick={stopJob}>Stop</button> : null}
      </div>
      {logOpen ? <div className="wrap"><pre className="joblog" ref={logRef}>{(job.logs || []).join("\n")}</pre></div> : null}
      <div className="wrap jobbar-hint small muted">Runs in short steps while this page is open{status.onVercel ? " (and daily via Vercel Cron)" : ""}. You can close it and continue later.</div>
    </div>
  );
}

function ThemeButton() {
  function toggle() {
    const root = document.documentElement;
    const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    root.dataset.theme = dark ? "light" : "dark";
    try { localStorage.setItem("jprr-theme", root.dataset.theme); } catch { /* ignore */ }
  }
  return (
    <button className="icon-btn" type="button" title="Switch theme" aria-label="Switch theme" onClick={toggle}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9z" /></svg>
    </button>
  );
}

export function AppShell({ children }) {
  const pathname = usePathname() || "/";
  const { status, statusError } = useStatus();
  const pending = status?.counts?.candidatesPending || 0;
  const lc = status?.lastCollect;
  return (
    <>
      <header className="topbar">
        <div className="wrap topbar-inner">
          <Link className="brand" href="/">
            <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="14" /><circle cx="16" cy="16" r="6" className="brand-dot" /></svg>
            <span><strong>JP Repo Radar</strong><span className="brand-sub">Japanese web-dev companies on GitHub</span></span>
          </Link>
          <nav className="tabs" aria-label="Sections">
            {TABS.filter((t) => !t.private || status?.admin?.ok).map((t) => (
              <Link key={t.href} href={t.href} className={t.match(pathname) ? "active" : undefined}>
                {t.label}
                {t.href === "/discovery" && pending ? <span className="badge">{pending > 999 ? "999+" : pending}</span> : null}
              </Link>
            ))}
          </nav>
          <ThemeButton />
        </div>
      </header>
      {status?.storage?.ephemeral ? (
        <div className="banner warn"><div className="wrap">
          Storage is not connected: data on this deployment is temporary. In Vercel, open <b>Storage</b>, create a <b>Neon</b> (Postgres)
          or <b>Upstash for Redis</b> database, connect it to this project and redeploy.
        </div></div>
      ) : null}
      {statusError && !status ? (
        <div className="banner warn"><div className="wrap">Cannot reach the server: {statusError.message}</div></div>
      ) : null}
      <JobBar />
      <main className="wrap">{children}</main>
      <footer className="wrap footer muted small">
        Counts cover public, non-fork repositories only. Data from the GitHub API.
        {status ? (lc ? ` Last collection: ${ago(lc.finishedAt || lc.startedAt)} (${lc.status}).` : " Not collected yet.") : ""}
      </footer>
    </>
  );
}
