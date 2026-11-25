"use client";
// App-wide state: preferences, toasts, the tooltip, and server status (which also drives job steps).
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api, sleep } from "@/lib/client";
import { fmt } from "@/lib/format";

// ---------------------------------------------------------------- preferences
const PrefsContext = createContext(null);
const DEFAULT_PREFS = { includeArchived: false, segment: "", metric: "openIssues", discoveryActiveOnly: true };

function PrefsProvider({ children }) {
  const [prefs, setPrefsState] = useState(DEFAULT_PREFS);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("jprr-prefs") || "null");
      if (saved && typeof saved === "object") setPrefsState({ ...DEFAULT_PREFS, ...saved });
    } catch { /* storage unavailable */ }
    setLoaded(true);
  }, []);
  const setPrefs = useCallback((patch) => {
    setPrefsState((p) => {
      const next = { ...p, ...patch };
      try { localStorage.setItem("jprr-prefs", JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);
  const value = useMemo(() => ({ prefs, setPrefs, loaded }), [prefs, setPrefs, loaded]);
  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
}
export const usePrefs = () => useContext(PrefsContext);

// ---------------------------------------------------------------- toasts
const ToastContext = createContext(() => {});

function ToastProvider({ children }) {
  const [toast, setToast] = useState(null);
  const timer = useRef(null);
  const show = useCallback((message, isError = false) => {
    clearTimeout(timer.current);
    setToast({ message, isError });
    timer.current = setTimeout(() => setToast(null), isError ? 7000 : 3500);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className={`toast${toast?.isError ? " error" : ""}`} role="status" aria-live="polite" hidden={!toast}>
        {toast?.message}
      </div>
    </ToastContext.Provider>
  );
}
export const useToast = () => useContext(ToastContext);

// ---------------------------------------------------------------- tooltip
const TooltipContext = createContext(null);

function TooltipProvider({ children }) {
  const [tip, setTip] = useState(null);
  const ref = useRef(null);
  const show = useCallback((source, content) => {
    let x, y;
    if (source && source.clientX != null) { x = source.clientX + 14; y = source.clientY + 14; }
    else if (source?.getBoundingClientRect) {
      const r = source.getBoundingClientRect();
      x = r.left + Math.min(r.width / 2, 160); y = r.bottom + 6;
    } else return;
    setTip({ x, y, content });
  }, []);
  const hide = useCallback(() => setTip(null), []);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !tip) return;
    let { x, y } = tip;
    if (x + el.offsetWidth > window.innerWidth - 8) x = Math.max(8, x - el.offsetWidth - 28);
    if (y + el.offsetHeight > window.innerHeight - 8) y = Math.max(8, y - el.offsetHeight - 28);
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  }, [tip]);
  const value = useMemo(() => ({ show, hide }), [show, hide]);
  return (
    <TooltipContext.Provider value={value}>
      {children}
      <div ref={ref} className="tooltip" role="tooltip" hidden={!tip}>{tip?.content}</div>
    </TooltipContext.Provider>
  );
}
export const useTooltip = () => useContext(TooltipContext);

// ---------------------------------------------------------------- status + job runner
const StatusContext = createContext(null);

function StatusProvider({ children }) {
  const toast = useToast();
  const [status, setStatus] = useState(null);
  const [statusError, setStatusError] = useState(null);
  const [jobVersion, setJobVersion] = useState(0);
  const lastJob = useRef(null);
  const statusRef = useRef(null);
  useEffect(() => { statusRef.current = status; }, [status]);

  const applyJob = useCallback((job) => {
    const prev = lastJob.current;
    lastJob.current = job;
    if (!prev || !job || prev.id !== job.id || prev.status !== "running" || job.status === "running") return;
    setJobVersion((v) => v + 1);
    const r = job.result || {};
    if (job.status === "done") {
      toast(job.kind === "collect"
        ? `Collection finished: ${r.ok ?? 0} organizations, ${fmt(r.repos ?? 0)} repositories${(r.errors || r.notFound) ? ` (${(r.errors || 0) + (r.notFound || 0)} with problems)` : ""}`
        : `Discovery finished: ${r.new ?? 0} new candidates`);
    } else if (job.status === "failed") toast(`Job failed: ${job.error}`, true);
    else if (job.status === "stopped") toast("Job stopped");
  }, [toast]);

  const refresh = useCallback(async () => {
    try {
      const s = await api("/api/status");
      setStatus(s);
      setStatusError(null);
      applyJob(s.job);
      return s;
    } catch (err) {
      setStatusError(err);
      return null;
    }
  }, [applyJob]);

  // Poll status every 3 s while a job runs (so progress shows during a long step), every 20 s otherwise.
  // Checking the ref on each tick means a job started from this tab speeds polling up immediately.
  useEffect(() => {
    let alive = true;
    let last = 0;
    let timer;
    const tick = async () => {
      if (statusRef.current?.job?.status === "running" || Date.now() - last >= 20000) {
        last = Date.now();
        await refresh();
      }
      if (alive) timer = setTimeout(tick, 3000);
    };
    timer = setTimeout(tick, 0);
    return () => { alive = false; clearTimeout(timer); };
  }, [refresh]);

  // Drive the running job forward. Each step call works for up to ~40 s on the server.
  useEffect(() => {
    let alive = true;
    (async () => {
      while (alive) {
        const job = statusRef.current?.job;
        if (job?.status !== "running") { await sleep(1000); continue; }
        if (job.waitUntil && Date.now() < job.waitUntil) { await sleep(Math.min(30000, job.waitUntil - Date.now() + 500)); }
        try {
          const r = await api("/api/jobs/step", { body: {} });
          if (!alive) break;
          setStatus((s) => (s ? { ...s, job: r.job } : s));
          applyJob(r.job);
          if (r.busy) await sleep(3000);
          if (r.waiting) await sleep(15000);
        } catch {
          await sleep(5000);
        }
      }
    })();
    return () => { alive = false; };
  }, [applyJob]);

  const startJob = useCallback(async (kind, params = {}) => {
    try {
      const r = await api("/api/jobs", { body: { kind, ...params } });
      lastJob.current = r.job;
      setStatus((s) => (s ? { ...s, job: r.job } : s));
      toast(kind === "collect" ? "Collection started" : "Discovery started");
      return true;
    } catch (err) {
      toast(err.message, true);
      return false;
    }
  }, [toast]);

  const stopJob = useCallback(async () => {
    try {
      await api("/api/jobs/stop", { body: {} });
      refresh();
    } catch (err) { toast(err.message, true); }
  }, [refresh, toast]);

  const running = status?.job?.status === "running";
  const canEdit = !!status?.admin?.ok;
  const canRun = canEdit && !!status?.token?.configured && !running;
  const runBlockedReason = !status ? "Loading…" : !canEdit ? "Sign in on the Settings page first"
    : !status.token.configured ? "Add a GitHub token on the Settings page first" : running ? "Another job is running" : null;

  const value = useMemo(() => ({ status, statusError, refresh, jobVersion, startJob, stopJob, running, canEdit, canRun,
    runBlockedReason, onJobStarted: (job) => { lastJob.current = job; setStatus((s) => (s ? { ...s, job } : s)); } }),
  [status, statusError, refresh, jobVersion, startJob, stopJob, running, canEdit, canRun, runBlockedReason]);
  return <StatusContext.Provider value={value}>{children}</StatusContext.Provider>;
}
export const useStatus = () => useContext(StatusContext);

export function Providers({ children }) {
  return (
    <PrefsProvider>
      <ToastProvider>
        <TooltipProvider>
          <StatusProvider>{children}</StatusProvider>
        </TooltipProvider>
      </ToastProvider>
    </PrefsProvider>
  );
}
