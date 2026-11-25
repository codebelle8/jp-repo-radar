"use client";
import { useState } from "react";
import { useStatus, useToast } from "@/components/providers";
import { CardHead, ExportLink, ExtLink, Loading, PageHead } from "@/components/ui";
import { api, useApi } from "@/lib/client";
import { fmt, localTime } from "@/lib/format";

function TokenCard({ status, refresh }) {
  const toast = useToast();
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const t = status.token;
  const badge = !t.configured ? <span className="status warn">Not configured</span>
    : t.error ? <span className="status bad" title={t.error}>GitHub rejected it: {t.error}</span>
      : t.login ? <span className="status ok">Connected as @{t.login}</span>
        : <span className="status ok">Configured{t.source === "env" ? " (GITHUB_TOKEN)" : ""}</span>;

  async function save(e) {
    e.preventDefault();
    if (!token.trim()) return;
    setBusy(true);
    try {
      const res = await api("/api/settings", { body: { token: token.trim() } });
      toast(`Token saved — connected as @${res.login}`);
      setToken("");
      refresh();
    } catch (err) { toast(err.message, true); }
    setBusy(false);
  }
  async function verify() {
    setBusy(true);
    try {
      const res = await api("/api/settings", { body: { verify: true } });
      toast(res.error ? `GitHub rejected the token: ${res.error}` : `Connected as @${res.login}`, !!res.error);
      refresh();
    } catch (err) { toast(err.message, true); }
    setBusy(false);
  }
  async function remove() {
    if (!confirm("Remove the saved GitHub token?")) return;
    try { await api("/api/settings", { body: { token: "" } }); toast("Token removed"); refresh(); } catch (err) { toast(err.message, true); }
  }

  return (
    <section className="card">
      <CardHead title="GitHub token">{badge}</CardHead>
      <p className="muted" style={{ marginBottom: 10 }}>
        GitHub&apos;s GraphQL API needs a token even for public data. Create a fine-grained token at{" "}
        <ExtLink href="https://github.com/settings/personal-access-tokens/new">github.com/settings/personal-access-tokens/new</ExtLink>{" "}
        with “Public repositories (read-only)” — no other permissions. A classic token with no scopes also works.
      </p>
      {status.canSaveToken ? (
        <>
          <form className="row" onSubmit={save}>
            <input type="password" autoComplete="off" spellCheck={false} style={{ flex: "1 1 320px" }} aria-label="GitHub token"
              placeholder={t.configured ? "Paste a new token to replace the current one" : "github_pat_… or ghp_…"}
              value={token} onChange={(e) => setToken(e.target.value)} disabled={!status.admin.ok} />
            <button type="submit" className="btn btn-primary" disabled={busy || !status.admin.ok}>Save & verify</button>
          </form>
          <p className="muted small" style={{ marginTop: 8 }}>
            {status.storage.kind === "file" ? <>Stored in this project&apos;s <code>data/</code> folder (git-ignored).</> : <>Stored in the app&apos;s database; it is never sent to the browser.</>}
            {" "}A <code>GITHUB_TOKEN</code> environment variable takes precedence.
          </p>
        </>
      ) : (
        <p className="muted">
          On Vercel: add <code>GITHUB_TOKEN</code> in <b>Project Settings → Environment Variables</b>, then redeploy.
        </p>
      )}
      <div className="row" style={{ marginTop: 10 }}>
        {t.configured ? <button type="button" className="btn" disabled={busy || !status.admin.ok} onClick={verify}>Check token</button> : null}
        {t.configured && t.source === "settings" ? <button type="button" className="btn btn-ghost btn-danger" disabled={!status.admin.ok} onClick={remove}>Remove token</button> : null}
      </div>
      {status.rate?.graphql ? (
        <p className="muted small" style={{ marginTop: 10 }}>
          GraphQL rate limit: {fmt(status.rate.graphql.remaining)} of {fmt(status.rate.graphql.limit)} points left
          {status.rate.graphql.reset ? `, resets ${new Date(status.rate.graphql.reset * 1000).toLocaleTimeString()}` : ""}
        </p>
      ) : null}
    </section>
  );
}

function AdminCard({ status, refresh }) {
  const toast = useToast();
  const [password, setPassword] = useState("");
  const a = status.admin;
  if (!a.required) {
    return (
      <section className="card">
        <CardHead title="Editing"><span className="status ok">Open on this computer</span></CardHead>
        <p className="muted">Running locally without <code>ADMIN_PASSWORD</code>: anyone using this computer can edit. Set <code>ADMIN_PASSWORD</code> in <code>.env.local</code> to require sign-in.</p>
      </section>
    );
  }
  if (!a.passwordSet) {
    return (
      <section className="card">
        <CardHead title="Editing"><span className="status warn">Disabled</span></CardHead>
        <p className="muted">This deployment is read-only. To edit companies and run jobs from the browser, add <code>ADMIN_PASSWORD</code> in
          Vercel → Project Settings → Environment Variables and redeploy.</p>
      </section>
    );
  }
  async function login(e) {
    e.preventDefault();
    try { await api("/api/auth", { body: { password } }); setPassword(""); toast("Signed in"); refresh(); }
    catch (err) { toast(err.message, true); }
  }
  async function logout() {
    try { await api("/api/auth", { method: "DELETE" }); toast("Signed out"); refresh(); } catch (err) { toast(err.message, true); }
  }
  return (
    <section className="card">
      <CardHead title="Editing">{a.ok ? <span className="status ok">Signed in</span> : <span className="status warn">Read-only</span>}</CardHead>
      {a.ok ? (
        <div className="row"><p className="muted">You can edit companies, approve candidates and run jobs.</p><span className="spacer" />
          <button type="button" className="btn" onClick={logout}>Sign out</button></div>
      ) : (
        <form className="row" onSubmit={login}>
          <input type="password" autoComplete="current-password" placeholder="Admin password" aria-label="Admin password"
            value={password} onChange={(e) => setPassword(e.target.value)} style={{ flex: "1 1 260px" }} />
          <button type="submit" className="btn btn-primary">Sign in</button>
        </form>
      )}
    </section>
  );
}

export default function SettingsPage() {
  const toast = useToast();
  const { status, refresh, jobVersion } = useStatus();
  const runs = useApi("/api/jobs", [jobVersion]);
  if (!status) return <><PageHead title="Settings" /><Loading /></>;
  const s = status.storage;

  async function reseed() {
    try {
      const r = await api("/api/seed", { body: {} });
      toast(`Added ${r.companiesAdded} companies and ${r.orgsAdded} organizations`);
      refresh();
    } catch (err) { toast(err.message, true); }
  }

  return (
    <>
      <PageHead title="Settings" />
      <div className="stack">
        <TokenCard status={status} refresh={refresh} />
        <AdminCard status={status} refresh={refresh} />
        <section className="card">
          <CardHead title="Storage">
            {s.ephemeral ? <span className="status warn">Temporary</span>
              : <span className="status ok">{s.kind === "redis" ? "Upstash Redis" : s.kind === "postgres" ? "Postgres" : "Local files"}</span>}
          </CardHead>
          <dl className="kv">
            <dt>Driver</dt><dd>{s.kind === "redis" ? "Upstash Redis (REST)" : s.kind === "postgres" ? "Postgres (Neon, HTTP)" : "JSON files"}</dd>
            <dt>Location</dt><dd><code>{s.location}</code></dd>
            <dt>Companies</dt><dd>{fmt(status.counts.companies)}</dd>
            <dt>GitHub organizations</dt><dd>{fmt(status.counts.orgs)}</dd>
            <dt>Last collection</dt><dd>{status.lastCollect ? `${localTime(status.lastCollect.finishedAt || status.lastCollect.startedAt)} — ${status.lastCollect.status} (${status.lastCollect.detail})` : "never"}</dd>
            <dt>Automatic refresh</dt><dd>{status.onVercel ? "Daily at 03:00 JST via Vercel Cron (vercel.json)" : "Run `npm run collect` from Task Scheduler, or deploy to Vercel for the daily cron"}</dd>
          </dl>
          {s.ephemeral ? <p className="muted" style={{ marginTop: 10 }}>Connect a database in Vercel → Storage (<b>Neon</b> Postgres or <b>Upstash for Redis</b>) so data survives between requests.</p> : null}
          <div className="row" style={{ marginTop: 12 }}>
            <ExportLink kind="companies" label="Export companies" />
            <ExportLink kind="repos" label="Export all repositories" all />
            <button type="button" className="btn" disabled={!status.admin.ok} onClick={reseed}>Re-import starter list</button>
          </div>
        </section>
        {runs.data?.job ? (
          <section className="card">
            <CardHead title="Latest job" sub={`${runs.data.job.label} · ${runs.data.job.status}`} />
            <pre className="joblog">{(runs.data.job.logs || []).join("\n") || "No log lines."}</pre>
          </section>
        ) : null}
      </div>
    </>
  );
}
