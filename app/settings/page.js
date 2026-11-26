"use client";
import { useState } from "react";
import { useStatus, useT, useToast } from "@/components/providers";
import { CardHead, ExportLink, ExtLink, Loading, PageHead } from "@/components/ui";
import { api, useApi } from "@/lib/client";
import { fmt, localClock, localTime } from "@/lib/format";

const code = (c) => <code>{c}</code>;
const bold = (c) => <b>{c}</b>;

function TokenCard({ status, refresh }) {
  const toast = useToast();
  const { t, rich } = useT();
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const tok = status.token;
  const badge = !tok.configured ? <span className="status warn">{t("Not configured")}</span>
    : tok.error ? <span className="status bad" title={t(tok.error)}>{t("GitHub rejected it: {error}", { error: t(tok.error) })}</span>
      : tok.login ? <span className="status ok">{t("Connected as @{login}", { login: tok.login })}</span>
        : <span className="status ok">{t("Configured")}{tok.source === "env" ? " (GITHUB_TOKEN)" : ""}</span>;

  async function save(e) {
    e.preventDefault();
    if (!token.trim()) return;
    setBusy(true);
    try {
      const res = await api("/api/settings", { body: { token: token.trim() } });
      toast(t("Token saved — connected as @{login}", { login: res.login }));
      setToken("");
      refresh();
    } catch (err) { toast(err.message, true); }
    setBusy(false);
  }
  async function verify() {
    setBusy(true);
    try {
      const res = await api("/api/settings", { body: { verify: true } });
      toast(res.error ? t("GitHub rejected the token: {error}", { error: t(res.error) }) : t("Connected as @{login}", { login: res.login }), !!res.error);
      refresh();
    } catch (err) { toast(err.message, true); }
    setBusy(false);
  }
  async function remove() {
    if (!confirm(t("Remove the saved GitHub token?"))) return;
    try { await api("/api/settings", { body: { token: "" } }); toast(t("Token removed")); refresh(); } catch (err) { toast(err.message, true); }
  }

  return (
    <section className="card">
      <CardHead title={t("GitHub token")}>{badge}</CardHead>
      <p className="muted" style={{ marginBottom: 10 }}>
        {rich("GitHub's GraphQL API needs a token even for public data. Create a fine-grained token at {link} with “Public repositories (read-only)” — no other permissions. A classic token with no scopes also works.", {
          link: <ExtLink href="https://github.com/settings/personal-access-tokens/new">github.com/settings/personal-access-tokens/new</ExtLink>,
        })}
      </p>
      {status.canSaveToken ? (
        <>
          <form className="row" onSubmit={save}>
            <input type="password" autoComplete="off" spellCheck={false} style={{ flex: "1 1 320px" }} aria-label={t("GitHub token")}
              placeholder={tok.configured ? t("Paste a new token to replace the current one") : t("github_pat_… or ghp_…")}
              value={token} onChange={(e) => setToken(e.target.value)} disabled={!status.admin.ok} />
            <button type="submit" className="btn btn-primary" disabled={busy || !status.admin.ok}>{t("Save & verify")}</button>
          </form>
          <p className="muted small" style={{ marginTop: 8 }}>
            {status.storage.kind === "file" ? rich("Stored in this project's <code>data/</code> folder (git-ignored).", { code }) : t("Stored in the app's database; it is never sent to the browser.")}
            {" "}{rich("A <code>GITHUB_TOKEN</code> environment variable takes precedence.", { code })}
          </p>
        </>
      ) : (
        <p className="muted">
          {rich("On Vercel: add <code>GITHUB_TOKEN</code> in <b>Project Settings → Environment Variables</b>, then redeploy.", { code, b: bold })}
        </p>
      )}
      <div className="row" style={{ marginTop: 10 }}>
        {tok.configured ? <button type="button" className="btn" disabled={busy || !status.admin.ok} onClick={verify}>{t("Check token")}</button> : null}
        {tok.configured && tok.source === "settings" ? <button type="button" className="btn btn-ghost btn-danger" disabled={!status.admin.ok} onClick={remove}>{t("Remove token")}</button> : null}
      </div>
      {status.rate?.graphql ? (
        <p className="muted small" style={{ marginTop: 10 }}>
          {status.rate.graphql.reset
            ? t("GraphQL rate limit: {remaining} of {limit} points left, resets {time}", { remaining: fmt(status.rate.graphql.remaining), limit: fmt(status.rate.graphql.limit), time: localClock(status.rate.graphql.reset * 1000) })
            : t("GraphQL rate limit: {remaining} of {limit} points left", { remaining: fmt(status.rate.graphql.remaining), limit: fmt(status.rate.graphql.limit) })}
        </p>
      ) : null}
    </section>
  );
}

function AdminCard({ status, refresh }) {
  const toast = useToast();
  const { t, rich } = useT();
  const [password, setPassword] = useState("");
  const a = status.admin;
  if (!a.required) {
    return (
      <section className="card">
        <CardHead title={t("Editing")}><span className="status ok">{t("Open on this computer")}</span></CardHead>
        <p className="muted">{rich("Running locally without <code>ADMIN_PASSWORD</code>: anyone using this computer can edit. Set <code>ADMIN_PASSWORD</code> in <code>.env.local</code> to require sign-in.", { code })}</p>
      </section>
    );
  }
  if (!a.passwordSet) {
    return (
      <section className="card">
        <CardHead title={t("Editing")}><span className="status warn">{t("Disabled")}</span></CardHead>
        <p className="muted">{rich("This deployment is read-only. To edit companies and run jobs from the browser, add <code>ADMIN_PASSWORD</code> in Vercel → Project Settings → Environment Variables and redeploy.", { code })}</p>
      </section>
    );
  }
  async function login(e) {
    e.preventDefault();
    try { await api("/api/auth", { body: { password } }); setPassword(""); toast(t("Signed in")); refresh(); }
    catch (err) { toast(err.message, true); }
  }
  async function logout() {
    try { await api("/api/auth", { method: "DELETE" }); toast(t("Signed out")); refresh(); } catch (err) { toast(err.message, true); }
  }
  return (
    <section className="card">
      <CardHead title={t("Editing")}>{a.ok ? <span className="status ok">{t("Signed in")}</span> : <span className="status warn">{t("Read-only")}</span>}</CardHead>
      {a.ok ? (
        <div className="row"><p className="muted">{t("You can edit companies, approve candidates and run jobs.")}</p><span className="spacer" />
          <button type="button" className="btn" onClick={logout}>{t("Sign out")}</button></div>
      ) : (
        <form className="row" onSubmit={login}>
          <input type="password" autoComplete="current-password" placeholder={t("Admin password")} aria-label={t("Admin password")}
            value={password} onChange={(e) => setPassword(e.target.value)} style={{ flex: "1 1 260px" }} />
          <button type="submit" className="btn btn-primary">{t("Sign in")}</button>
        </form>
      )}
    </section>
  );
}

export default function SettingsPage() {
  const toast = useToast();
  const { t, rich } = useT();
  const { status, refresh, jobVersion } = useStatus();
  const runs = useApi("/api/jobs", [jobVersion]);
  if (!status) return <><PageHead title={t("Settings")} /><Loading /></>;
  const s = status.storage;
  // Log lines are "HH:MM:SS  message": translate the message, keep the time.
  const logLine = (line) => {
    const m = /^(\S+ {2})([\s\S]*)$/.exec(line);
    return m ? m[1] + t(m[2]) : t(line);
  };

  async function reseed() {
    try {
      const r = await api("/api/seed", { body: {} });
      toast(t("Added {companies} companies and {orgs} organizations", { companies: r.companiesAdded, orgs: r.orgsAdded }));
      refresh();
    } catch (err) { toast(err.message, true); }
  }

  return (
    <>
      <PageHead title={t("Settings")} />
      <div className="stack">
        <TokenCard status={status} refresh={refresh} />
        <AdminCard status={status} refresh={refresh} />
        <section className="card">
          <CardHead title={t("Storage")}>
            {s.ephemeral ? <span className="status warn">{t("Temporary")}</span>
              : <span className="status ok">{s.kind === "redis" ? "Upstash Redis" : s.kind === "postgres" ? "Postgres" : t("Local files")}</span>}
          </CardHead>
          <dl className="kv">
            <dt>{t("Driver")}</dt><dd>{s.kind === "redis" ? "Upstash Redis (REST)" : s.kind === "postgres" ? "Postgres (Neon, HTTP)" : t("JSON files")}</dd>
            <dt>{t("Location")}</dt><dd><code>{s.location}</code></dd>
            <dt>{t("Companies")}</dt><dd>{fmt(status.counts.companies)}</dd>
            <dt>{t("GitHub organizations")}</dt><dd>{fmt(status.counts.orgs)}</dd>
            <dt>{t("Last collection")}</dt><dd>{status.lastCollect ? `${localTime(status.lastCollect.finishedAt || status.lastCollect.startedAt)} — ${t(status.lastCollect.status)} (${t(status.lastCollect.detail)})` : t("never")}</dd>
            <dt>{t("Automatic refresh")}</dt><dd>{status.onVercel ? t("Daily at 03:00 JST via Vercel Cron (vercel.json)") : t("Run `npm run collect` from Task Scheduler, or deploy to Vercel for the daily cron")}</dd>
          </dl>
          {s.ephemeral ? <p className="muted" style={{ marginTop: 10 }}>{rich("Connect a database in Vercel → Storage (<b>Neon</b> Postgres or <b>Upstash for Redis</b>) so data survives between requests.", { b: bold })}</p> : null}
          <div className="row" style={{ marginTop: 12 }}>
            <ExportLink kind="companies" label={t("Export companies")} />
            <ExportLink kind="repos" label={t("Export all repositories")} all />
            <button type="button" className="btn" disabled={!status.admin.ok} onClick={reseed}>{t("Re-import starter list")}</button>
          </div>
        </section>
        {runs.data?.job ? (
          <section className="card">
            <CardHead title={t("Latest job")} sub={`${t(runs.data.job.label)} · ${t(runs.data.job.status)}`} />
            <pre className="joblog">{(runs.data.job.logs || []).map(logLine).join("\n") || t("No log lines.")}</pre>
          </section>
        ) : null}
      </div>
    </>
  );
}
