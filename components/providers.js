"use client";
// App-wide state: preferences, toasts, the tooltip, and server status (which also drives job steps).
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api, sleep } from "@/lib/client";
import { fmt } from "@/lib/format";
import { plural, rich, setCurrentLang, translate } from "@/lib/i18n";

// ---------------------------------------------------------------- preferences
const PrefsContext = createContext(null);
const DEFAULT_PREFS = { includeArchived: false, segment: "", metric: "openIssues", discoveryActiveOnly: true, lang: "" };

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
  return <PrefsContext.Provider value={value}><I18nProvider prefs={prefs} setPrefs={setPrefs} loaded={loaded}>{children}</I18nProvider></PrefsContext.Provider>;
}
export const usePrefs = () => useContext(PrefsContext);

// ---------------------------------------------------------------- language
const I18nContext = createContext(null);
const browserLang = () => (typeof navigator !== "undefined" && (navigator.languages || [navigator.language]).some((l) => /^ja(-|$)/i.test(l || "")) ? "ja" : "en");

/**
 * English until preferences load (the prerendered HTML is English), then the saved choice or the browser's language.
 * Every component that shows text calls useT(), so switching re-renders the page in the new language.
 */
function I18nProvider({ prefs, setPrefs, loaded, children }) {
  const lang = !loaded ? "en" : prefs.lang === "ja" || prefs.lang === "en" ? prefs.lang : browserLang();
  setCurrentLang(lang);   // for helpers outside React (ago(), API error messages)
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  const value = useMemo(() => ({
    lang,
    setLang: (code) => setPrefs({ lang: code }),
    t: (text, vars) => translate(text, vars, lang),
    tp: (n, one, other, vars) => plural(n, one, other, vars, lang),
    rich: (text, vars) => rich(text, vars, lang),
  }), [lang, setPrefs]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
/** { t, tp, rich, lang, setLang }: see lib/i18n.js. */
export const useT = () => useContext(I18nContext);

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
  const { t } = useT();
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
      const counts = { orgs: r.ok ?? 0, repos: fmt(r.repos ?? 0), problems: (r.errors || 0) + (r.notFound || 0) };
      toast(job.kind === "collect"
        ? ((r.errors || r.notFound)
          ? translate("Collection finished: {orgs} organizations, {repos} repositories ({problems} with problems)", counts)
          : translate("Collection finished: {orgs} organizations, {repos} repositories", counts))
        : translate("Discovery finished: {n} new candidates", { n: r.new ?? 0 }));
    } else if (job.status === "failed") toast(translate("Job failed: {error}", { error: translate(job.error || "") }), true);
    else if (job.status === "stopped") toast(translate("Job stopped"));
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
      toast(kind === "collect" ? translate("Collection started") : translate("Discovery started"));
      return true;
    } catch (err) {
      toast(translate(err.message), true);
      return false;
    }
  }, [toast]);

  const stopJob = useCallback(async () => {
    try {
      await api("/api/jobs/stop", { body: {} });
      refresh();
    } catch (err) { toast(translate(err.message), true); }
  }, [refresh, toast]);

  const running = status?.job?.status === "running";
  const canEdit = !!status?.admin?.ok;
  const canRun = canEdit && !!status?.token?.configured && !running;
  const runBlockedReason = !status ? t("Loading…") : !canEdit ? t("Sign in on the Settings page first")
    : !status.token.configured ? t("Add a GitHub token on the Settings page first") : running ? t("Another job is running") : null;

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
