"use client";
// Private tracker: issues you picked, your pull requests to tracked companies, where you stand with each company,
// and which companies fit the languages you use.
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { DataTable } from "@/components/DataTable";
import { HiringLinks, SkillMatch, SkillsEditor, useSkills } from "@/components/skills";
import { useStatus, useToast } from "@/components/providers";
import { CardHead, Dash, ErrorNotice, ExtLink, Loading, PageHead, TimeAgo, Tile } from "@/components/ui";
import { api, useApi } from "@/lib/client";
import { ago, fmt, qs } from "@/lib/format";

const SYNC_AFTER_MS = 30 * 60 * 1000;   // auto-sync when the last sync is older than this
const PR_CHIP = { OPEN: ["Open", "chip-plus"], MERGED: ["Merged", "chip-plus"], CLOSED: ["Closed", "chip-minus"] };

function Bar({ value, title }) {
  return (
    <div className="score" title={title}>
      <strong className="num" style={{ minWidth: 24 }}>{value}</strong>
      <div className="score-bar" aria-hidden="true"><div className="score-fill" style={{ width: `${value}%` }} /></div>
    </div>
  );
}

function PrState({ state }) {
  if (!state) return <Dash />;
  const [label, cls] = PR_CHIP[state] || [state, ""];
  return <span className={`chip ${cls}`}>{label}</span>;
}

/** Text shown with an Edit button; editing happens in place. */
function InlineText({ value, placeholder, onSave, multiline = false, render }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value || "");
  const [busy, setBusy] = useState(false);
  if (!editing) {
    return (
      <div className="row" style={{ gap: 6, flexWrap: "nowrap", alignItems: "flex-start" }}>
        <span className={value ? "note-text" : "faint"} title={value || undefined}>{value ? (render ? render(value) : value) : placeholder}</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setText(value || ""); setEditing(true); }}>Edit</button>
      </div>
    );
  }
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try { await onSave(text); setEditing(false); } catch { /* the error toast is already shown */ } finally { setBusy(false); }
  }
  const Field = multiline ? "textarea" : "input";
  return (
    <form onSubmit={save} style={{ minWidth: 220 }}>
      <Field {...(multiline ? { rows: 3 } : { type: "text" })} value={text} onChange={(e) => setText(e.target.value)} autoFocus
        placeholder={placeholder} style={{ width: "100%" }} />
      <div className="row" style={{ marginTop: 4, gap: 6 }}>
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>Save</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>Cancel</button>
      </div>
    </form>
  );
}

export default function TrackerPage() {
  const toast = useToast();
  const { status, canEdit } = useStatus();
  const { data, error, reload } = useApi(canEdit ? "/api/tracker" : null, []);
  const skills = useSkills(canEdit);
  const [syncing, setSyncing] = useState(false);
  const [url, setUrl] = useState("");
  const autoSynced = useRef(false);

  async function sync(quiet = false) {
    setSyncing(true);
    try {
      const r = await api("/api/tracker/sync", { body: {} });
      if (!quiet) toast(`Synced as @${r.viewer}: ${r.prs} pull request${r.prs === 1 ? "" : "s"} to tracked companies, ${r.updated} issue${r.updated === 1 ? "" : "s"} updated, ${r.languages} language${r.languages === 1 ? "" : "s"} found`);
      reload();
      skills.reload();
    } catch (err) {
      if (!quiet) toast(err.message, true);
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => {   // keep it fresh without a click
    if (!data || autoSynced.current || !status?.token?.configured) return;
    autoSynced.current = true;
    if (!data.syncedAt || Date.now() - Date.parse(data.syncedAt) > SYNC_AFTER_MS) sync(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, status?.token?.configured]);

  const head = <PageHead title="Tracker" lede="Issues you are working on, your pull requests to tracked companies, and your applications. Private: only visible after signing in." />;
  if (!status) return <>{head}<Loading /></>;
  if (!canEdit) {
    return (
      <>{head}
        <section className="card"><p className="muted">Sign in on the <Link href="/settings">Settings</Link> page to see your tracker.</p></section>
      </>
    );
  }
  if (!data) return <>{head}<ErrorNotice error={error} />{error ? null : <Loading />}</>;

  async function act(fn, success) {
    try { await fn(); if (success) toast(success); reload(); } catch (err) { toast(err.message, true); throw err; }
  }
  const patchItem = (id, body) => act(() => api(`/api/tracker/${encodeURIComponent(id)}`, { method: "PATCH", body }));
  const removeIssue = (i) => { if (confirm(`Stop tracking “${i.title}”?`)) act(() => api(`/api/tracker/${encodeURIComponent(i.id)}`, { method: "DELETE" }), "Removed"); };
  const putApp = (companyId, body) => act(() => api(`/api/tracker/applications/${companyId}`, { method: "PUT", body }));
  async function addByUrl(e) {
    e.preventDefault();
    try {
      const item = await api("/api/tracker", { body: { url } });
      setUrl("");
      toast(`Tracking ${item.owner}/${item.repo}#${item.number}`);
      reload();
      sync(true);   // fills in the title and state
    } catch (err) { toast(err.message, true); }
  }

  const c = data.counts;
  const sk = skills.data;
  const matches = sk?.matches || {};
  const companyCols = [
    {
      key: "name", label: "Company",
      render: (r) => (
        <div>
          <div className="cell-title"><Link href={`/companies/${r.id}`}>{r.name}</Link></div>
          {r.ready ? <span className="chip chip-plus" title={`${data.readyMerged}+ merged pull requests and no application yet`}>Ready to approach</span> : null}
        </div>
      ),
    },
    { key: "match", label: "Skill match", firstDir: "desc", title: "Share of the company's active repositories written in your languages",
      sortValue: (r) => matches[r.id]?.score ?? null, render: (r) => <SkillMatch m={matches[r.id]} /> },
    { key: "mergedPrs", label: "Merged PRs", num: true },
    { key: "openPrs", label: "Open PRs", num: true },
    { key: "trackedIssues", label: "Tracked issues", num: true },
    {
      key: "stage", label: "Application", sortValue: (r) => data.appStages.findIndex(([k]) => k === r.stage),
      render: (r) => (
        <select aria-label={`Application stage for ${r.name}`} value={r.stage} onChange={(e) => putApp(r.id, { stage: e.target.value }).catch(() => {})}>
          {data.appStages.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
      ),
    },
    {
      key: "careersUrl", label: "Careers / casual interview link", sortable: false,
      render: (r) => (
        <div>
          <InlineText value={r.careersUrl} placeholder="Add link" onSave={(v) => putApp(r.id, { careersUrl: v })} render={(v) => <ExtLink href={v} />} />
          {r.careersUrl ? null : <HiringLinks name={r.name} />}
        </div>
      ),
    },
    { key: "notes", label: "Notes", sortable: false, render: (r) => <InlineText value={r.notes} placeholder="Add note" multiline onSave={(v) => putApp(r.id, { notes: v })} /> },
  ];
  const issueCols = [
    {
      key: "title", label: "Issue",
      render: (i) => (
        <div style={{ minWidth: 240 }}>
          <div className="cell-title"><ExtLink href={i.url}>{i.title}</ExtLink></div>
          <div className="cell-sub">{i.owner}/{i.repo} #{i.number}{i.issueState === "CLOSED" ? " · closed on GitHub" : ""}</div>
        </div>
      ),
    },
    { key: "company", label: "Company", render: (i) => (i.companyId != null && i.company ? <Link href={`/companies/${i.companyId}`}>{i.company}</Link> : <Dash />) },
    {
      key: "stage", label: "Stage", sortValue: (i) => data.stages.findIndex(([k]) => k === i.stage),
      render: (i) => (
        <select aria-label={`Stage for ${i.title}`} value={i.stage} onChange={(e) => patchItem(i.id, { stage: e.target.value }).catch(() => {})}>
          {data.stages.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
      ),
    },
    { key: "prState", label: "Your PR", render: (i) => (i.prUrl ? <a href={i.prUrl} target="_blank" rel="noopener noreferrer"><PrState state={i.prState} /></a> : <Dash />) },
    { key: "notes", label: "Notes", sortable: false, render: (i) => <InlineText value={i.notes} placeholder="Add note" multiline onSave={(v) => patchItem(i.id, { notes: v })} /> },
    { key: "updatedAt", label: "Updated", className: "nowrap", firstDir: "desc", render: (i) => <TimeAgo iso={i.updatedAt} /> },
    { key: "remove", label: "", sortable: false, render: (i) => <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeIssue(i)} aria-label={`Stop tracking ${i.title}`}>Remove</button> },
  ];
  const inPipeline = new Set(data.companies.map((r) => r.id));
  const suggestions = (sk?.suggestions || []).filter((s) => !inPipeline.has(s.id)).slice(0, 10);
  const suggestCols = [
    {
      key: "name", label: "Company",
      render: (s) => (
        <div>
          <div className="cell-title"><Link href={`/companies/${s.id}`}>{s.name}</Link></div>
          <div className="cell-sub">{s.shared.length ? `uses ${s.shared.slice(0, 3).join(", ")}` : "related languages only"}</div>
        </div>
      ),
    },
    { key: "match", label: "Skill match", firstDir: "desc", render: (s) => <SkillMatch m={matches[s.id]} /> },
    { key: "bestScore", label: "Best repo", firstDir: "desc", title: "Welcome score of the company's most welcoming repository (see Contribute)",
      render: (s) => <Bar value={s.bestScore} title={s.bestRepo ? `${s.bestRepo}: welcomes outside contributions ${s.bestScore}/100` : undefined} /> },
    {
      key: "openIssues", label: "Issues to pick", num: true, title: "Unassigned issues with no linked pull request, in your languages first",
      render: (s) => <Link href={`/contribute?${qs({ view: "issues", company: s.id, mine: 1 })}`}>{fmt(s.openIssues)}</Link>,
    },
    { key: "beginnerIssues", label: "Beginner issues", num: true },
    { key: "hiring", label: "Hiring", sortable: false, render: (s) => <HiringLinks name={s.name} /> },
  ];
  const prCols = [
    {
      key: "title", label: "Pull request",
      render: (p) => (
        <div style={{ minWidth: 240 }}>
          <div className="cell-title"><ExtLink href={p.url}>{p.title}</ExtLink></div>
          <div className="cell-sub">{p.owner}/{p.repo}</div>
        </div>
      ),
    },
    { key: "company", label: "Company", render: (p) => (p.company ? <Link href={`/companies/${p.companyId}`}>{p.company}</Link> : <Dash />) },
    { key: "state", label: "State", render: (p) => <PrState state={p.state} /> },
    { key: "createdAt", label: "Opened", className: "nowrap", firstDir: "desc", render: (p) => <TimeAgo iso={p.createdAt} /> },
    { key: "mergedAt", label: "Merged", className: "nowrap", firstDir: "desc", render: (p) => (p.mergedAt ? <TimeAgo iso={p.mergedAt} /> : <Dash />) },
  ];

  return (
    <>
      {head}
      <div className="row" style={{ marginBottom: 12 }}>
        <button type="button" className="btn" onClick={() => sync(false)} disabled={syncing || !status.token.configured}
          title={status.token.configured ? undefined : "Add a GitHub token on the Settings page first"}>{syncing ? "Syncing…" : "Sync with GitHub"}</button>
        <span className="muted small">
          {data.syncedAt ? <>Last synced {ago(data.syncedAt)}{data.viewer ? <> as <ExtLink href={`https://github.com/${data.viewer}`}>@{data.viewer}</ExtLink></> : null}. </> : "Not synced yet. "}
          Reads the pull requests and comments of the GitHub account that owns the token.
        </span>
      </div>
      <div className="tiles">
        <Tile label="Tracked issues" value={fmt(data.items.length - c.dropped)} note={`${fmt(c.watching)} watching · ${fmt(c.commented)} commented`} />
        <Tile label="Open pull requests" value={fmt(c.openPrs)} note="to tracked companies" />
        <Tile label="Merged pull requests" value={fmt(c.mergedPrs)} note="to tracked companies" />
        <Tile label="Ready to approach" value={fmt(c.ready)} note={`${data.readyMerged}+ merged, not applied yet`} />
        <Tile label="Active applications" value={fmt(c.activeApplications)} note="applied → offer" />
      </div>

      <section className="card" style={{ marginBottom: 16 }}>
        <CardHead title="Companies" sub="where you have issues, pull requests or an application" />
        <DataTable columns={companyCols} rows={data.companies} rowKey={(r) => r.id}
          empty={<>Nothing yet. Track an issue on the <Link href="/contribute">Contribute</Link> page, or open a pull request to a tracked company and sync.</>} />
      </section>

      <section className="card" style={{ marginBottom: 16 }}>
        <CardHead title="Where your skills fit" sub="skill match × how welcoming the company's repositories are, for companies not in your list yet" />
        {sk ? (
          <>
            <div style={{ marginBottom: 12 }}>
              <div className="small muted" style={{ marginBottom: 6 }}>
                Your languages{sk.viewer ? <>: found in <ExtLink href={`https://github.com/${sk.viewer}`}>@{sk.viewer}</ExtLink>&apos;s repositories when you sync. Add ones GitHub can&apos;t see, remove ones you don&apos;t want to work in.</> : ": sync with GitHub to detect them, or add them here."}
              </div>
              <SkillsEditor skills={sk} onSaved={(v) => skills.setData(v)} />
            </div>
            <DataTable columns={suggestCols} rows={suggestions} rowKey={(s) => s.id}
              empty={!sk.languages.length ? "Add your languages to see which companies fit."
                : sk.suggestions.length ? "Every matching company is already in your list above."
                  : <>No matching companies with open issues yet. Contribution data comes from <Link href="/contribute">Collect data</Link>.</>} />
          </>
        ) : <><ErrorNotice error={skills.error} />{skills.error ? null : <Loading />}</>}
      </section>

      <section className="card" style={{ marginBottom: 16 }}>
        <CardHead title="Tracked issues" sub="moves to Commented, PR open and Merged automatically when you sync" />
        <form className="row" onSubmit={addByUrl} style={{ marginBottom: 10 }}>
          <input type="url" placeholder="https://github.com/owner/repo/issues/123" aria-label="GitHub issue link" value={url}
            onChange={(e) => setUrl(e.target.value)} style={{ flex: "1 1 320px" }} required />
          <button type="submit" className="btn btn-primary">Track issue</button>
        </form>
        <DataTable columns={issueCols} rows={data.items} rowKey={(i) => i.id}
          empty={<>No tracked issues. Use “Track” on the <Link href="/contribute">Contribute</Link> page or paste an issue link above.</>} />
      </section>

      <section className="card">
        <CardHead title="Your pull requests" sub="to tracked companies' repositories, from your last 100 pull requests" />
        <DataTable columns={prCols} rows={data.prs} rowKey={(p) => p.url} initialSort={{ key: "createdAt", dir: "desc" }}
          empty={data.syncedAt ? "No pull requests to tracked companies yet." : "Sync with GitHub to load your pull requests."} />
      </section>
    </>
  );
}
