"use client";
// Auto-fix (private): paste an issue link, an agent fixes it in your fork, you review and open the pull request.
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { DataTable } from "@/components/DataTable";
import { FixStatus, Note, dollars } from "@/components/fixes";
import { useStatus, useT, useToast } from "@/components/providers";
import { CardHead, Dash, ErrorNotice, ExtLink, Loading, PageHead, TimeAgo } from "@/components/ui";
import { api, useApi } from "@/lib/client";

function Step({ ok, optional, children }) {
  return (
    <li>
      <span className={`step-mark${ok ? " ok" : optional ? " opt" : ""}`} aria-hidden="true">{ok ? "✓" : optional ? "–" : "!"}</span>
      <div>{children}</div>
    </li>
  );
}

function Setup({ setup, onDone }) {
  const { t, rich } = useT();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const host = typeof window !== "undefined" ? window.location.origin : "";
  async function run() {
    setBusy(true);
    try { await api("/api/fixes/setup", { body: {} }); toast(t("Auto-fix agent is ready")); onDone(); } catch (err) { toast(err.message, true); } finally { setBusy(false); }
  }
  const agentOk = !!setup.agent && setup.agent.current;
  return (
    <section className="card" style={{ marginBottom: 16 }}>
      <CardHead title={t("Setup")} sub={setup.ready && agentOk ? t("ready") : t("a few one-time steps")} />
      <ul className="steps">
        <Step ok={setup.anthropic}>
          {rich("<b>Claude API key</b>: create one in the Claude Console and add it as {name} in Vercel → Settings → Environment Variables. Usage is billed by Anthropic, separately from a Claude subscription.",
            { b: (c) => <b>{c}</b>, name: <code>ANTHROPIC_API_KEY</code> })}
        </Step>
        <Step ok={setup.writeToken}>
          {rich("<b>GitHub token with write access</b>: a classic token with the {scopes} scopes, added as {name}. It forks repositories, pushes the fix branch and opens pull requests in your name.",
            { b: (c) => <b>{c}</b>, scopes: <><code>public_repo</code>, <code>workflow</code></>, name: <code>GITHUB_WRITE_TOKEN</code> })}
        </Step>
        <Step ok={agentOk}>
          <div>{setup.agent && !setup.agent.current ? t("The agent definition changed. Update it so new runs use the latest instructions.")
            : t("Create the agent and its sandbox environment on Claude Managed Agents (once).")}</div>
          <button type="button" className="btn btn-sm" style={{ marginTop: 6 }} onClick={run} disabled={busy || !setup.anthropic || !setup.writeToken}>
            {busy ? t("Working…") : setup.agent ? t("Update agent") : t("Create agent")}
          </button>
        </Step>
        <Step ok={setup.webhook} optional>
          {rich("Optional, for faster updates: in the Claude Console open Manage → Webhooks, add {url}, subscribe to the session status events and save the signing secret as {name}.",
            { url: <code>{`${host}/api/webhooks/anthropic`}</code>, name: <code>ANTHROPIC_WEBHOOK_SIGNING_KEY</code> })}
        </Step>
        <Step ok={setup.cron} optional>
          {rich("Optional, to be notified while this page is closed: set {secret} in Vercel and as a GitHub Actions secret, and {url} as a GitHub Actions variable. The repository's watch workflow then checks every 15 minutes.",
            { secret: <code>CRON_SECRET</code>, url: <code>APP_URL</code> })}
        </Step>
      </ul>
      <p className="muted small" style={{ marginTop: 10 }}>
        {t("Spending cap per run: {amount} (FIX_BUDGET_CENTS). Each run is stopped when it reaches the cap.", { amount: dollars(setup.budgetCents) })}
      </p>
    </section>
  );
}

function FixesView() {
  const { t, rich } = useT();
  const toast = useToast();
  const router = useRouter();
  const params = useSearchParams();
  const { status, canEdit } = useStatus();
  const { data, error, reload } = useApi(canEdit ? "/api/fixes" : null, []);
  const [url, setUrl] = useState(params.get("url") || "");
  const [busy, setBusy] = useState(false);
  const running = data?.fixes.some((f) => f.status === "running");

  useEffect(() => {   // keep running jobs fresh
    if (!running) return undefined;
    const timer = setInterval(reload, 15000);
    return () => clearInterval(timer);
  }, [running, reload]);

  const head = <PageHead title={t("Auto-fix")} lede={t("Paste an issue link. An agent fixes it in your fork and runs the tests; you review the change and open the pull request. Private: only visible after signing in.")} />;
  if (!status) return <>{head}<Loading /></>;
  if (!canEdit) return <>{head}<section className="card"><p className="muted">{rich("Sign in on the <link>Settings</link> page to use auto-fix.", { link: (c) => <Link href="/settings">{c}</Link> })}</p></section></>;
  if (!data) return <>{head}<ErrorNotice error={error} />{error ? null : <Loading />}</>;
  const { setup, fixes } = data;

  async function start(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const fix = await api("/api/fixes", { body: { url } });
      setUrl("");
      toast(fix.status === "blocked" ? t("The pre-check found problems. Nothing was started.") : t("The agent started. You will get a notification when it finishes."), fix.status === "blocked");
      router.push(`/fixes/${encodeURIComponent(fix.id)}`);
    } catch (err) { toast(err.message, true); } finally { setBusy(false); }
  }

  const columns = [
    {
      key: "title", label: t("Issue"), sortValue: (f) => f.issue.title,
      render: (f) => (
        <div style={{ minWidth: 240 }}>
          <div className="cell-title"><Link href={`/fixes/${encodeURIComponent(f.id)}`}>{f.issue.title}</Link></div>
          <div className="cell-sub">{f.issue.owner}/{f.issue.repo} #{f.issue.number}{f.lastNote ? <> · <Note note={f.lastNote} /></> : null}</div>
        </div>
      ),
    },
    { key: "company", label: t("Company"), render: (f) => (f.company ? <Link href={`/companies/${f.companyId}`}>{f.company}</Link> : <Dash />) },
    { key: "status", label: t("Status"), render: (f) => <FixStatus status={f.status} phase={f.phase} /> },
    { key: "tests", label: t("Tests"), render: (f) => (f.tests == null ? <Dash /> : f.tests ? <span className="chip chip-plus">{t("Passed")}</span> : <span className="chip chip-minus">{t("Failing")}</span>) },
    { key: "pr", label: t("Pull request"), sortValue: (f) => f.pr?.number ?? null, render: (f) => (f.pr ? <ExtLink href={f.pr.url}>#{f.pr.number}</ExtLink> : <Dash />) },
    { key: "costCents", label: t("Cost"), num: true, render: (f) => dollars(f.costCents) },
    { key: "updatedAt", label: t("Updated"), className: "nowrap", firstDir: "desc", render: (f) => <TimeAgo iso={f.updatedAt} /> },
  ];

  return (
    <>
      {head}
      {!setup.ready || !setup.agent?.current ? <Setup setup={setup} onDone={reload} /> : null}
      <section className="card" style={{ marginBottom: 16 }}>
        <CardHead title={t("New auto-fix")} sub={t("checks the issue first; nothing is published until you approve")} />
        <form className="row" onSubmit={start}>
          <input type="url" required placeholder="https://github.com/owner/repo/issues/123" aria-label={t("GitHub issue link")} value={url}
            onChange={(e) => setUrl(e.target.value)} style={{ flex: "1 1 320px" }} />
          <button type="submit" className="btn btn-primary" disabled={busy || !setup.ready}>{busy ? t("Starting…") : t("Start auto-fix")}</button>
        </form>
        {!setup.ready ? <p className="muted small" style={{ marginTop: 8 }}>{t("Finish the setup above first.")}</p> : null}
      </section>
      <section className="card">
        <CardHead title={t("Your auto-fixes")} sub={running ? t("refreshing every 15 seconds while an agent works") : null} />
        <DataTable columns={columns} rows={fixes} rowKey={(f) => f.id} initialSort={{ key: "updatedAt", dir: "desc" }}
          empty={rich("No auto-fixes yet. Find an issue on the <link>Contribute</link> page and paste its link above.", { link: (c) => <Link href="/contribute">{c}</Link> })} />
      </section>
    </>
  );
}

export default function FixesPage() {
  return <Suspense fallback={<Loading />}><FixesView /></Suspense>;
}
