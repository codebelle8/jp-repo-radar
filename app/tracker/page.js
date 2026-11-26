"use client";
// Private tracker: issues you picked, your pull requests to tracked companies, where you stand with each company,
// and which companies fit the languages you use.
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { DataTable } from "@/components/DataTable";
import { HiringLinks, SkillMatch, SkillsEditor, useSkills } from "@/components/skills";
import { useStatus, useT, useToast } from "@/components/providers";
import { CardHead, Dash, ErrorNotice, ExtLink, Loading, PageHead, TimeAgo, Tile } from "@/components/ui";
import { api, useApi } from "@/lib/client";
import { ago, fmt, qs } from "@/lib/format";
import { msg } from "@/lib/i18n";

const SYNC_AFTER_MS = 30 * 60 * 1000;   // auto-sync when the last sync is older than this
const PR_CHIP = { OPEN: [msg("Open"), "chip-plus"], MERGED: [msg("Merged"), "chip-plus"], CLOSED: [msg("Closed"), "chip-minus"] };

function Bar({ value, title }) {
  return (
    <div className="score" title={title}>
      <strong className="num" style={{ minWidth: 24 }}>{value}</strong>
      <div className="score-bar" aria-hidden="true"><div className="score-fill" style={{ width: `${value}%` }} /></div>
    </div>
  );
}

function PrState({ state }) {
  const { t } = useT();
  if (!state) return <Dash />;
  const [label, cls] = PR_CHIP[state] || [state, ""];
  return <span className={`chip ${cls}`}>{t(label)}</span>;
}

/** Text shown with an Edit button; editing happens in place. */
function InlineText({ value, placeholder, onSave, multiline = false, render }) {
  const { t } = useT();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value || "");
  const [busy, setBusy] = useState(false);
  if (!editing) {
    return (
      <div className="row" style={{ gap: 6, flexWrap: "nowrap", alignItems: "flex-start" }}>
        <span className={value ? "note-text" : "faint"} title={value || undefined}>{value ? (render ? render(value) : value) : placeholder}</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setText(value || ""); setEditing(true); }}>{t("Edit")}</button>
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
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>{t("Save")}</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>{t("Cancel")}</button>
      </div>
    </form>
  );
}

export default function TrackerPage() {
  const { t, tp, rich } = useT();
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
      if (!quiet) {
        toast(t("Synced as @{user}: {prs}, {issues}, {langs}", {
          user: r.viewer,
          prs: tp(r.prs, "{n} pull request to tracked companies", "{n} pull requests to tracked companies"),
          issues: tp(r.updated, "{n} issue updated", "{n} issues updated"),
          langs: tp(r.languages, "{n} language found", "{n} languages found"),
        }));
      }
      reload();
      skills.reload();
    } catch (err) {
      if (!quiet) toast(t(err.message), true);
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

  const head = <PageHead title={t("Tracker")} lede={t("Issues you are working on, your pull requests to tracked companies, and your applications. Private: only visible after signing in.")} />;
  if (!status) return <>{head}<Loading /></>;
  if (!canEdit) {
    return (
      <>{head}
        <section className="card"><p className="muted">{rich("Sign in on the <link>Settings</link> page to see your tracker.", { link: (c) => <Link href="/settings">{c}</Link> })}</p></section>
      </>
    );
  }
  if (!data) return <>{head}<ErrorNotice error={error} />{error ? null : <Loading />}</>;

  async function act(fn, success) {
    try { await fn(); if (success) toast(success); reload(); } catch (err) { toast(t(err.message), true); throw err; }
  }
  const patchItem = (id, body) => act(() => api(`/api/tracker/${encodeURIComponent(id)}`, { method: "PATCH", body }));
  const removeIssue = (i) => { if (confirm(t("Stop tracking “{title}”?", { title: i.title }))) act(() => api(`/api/tracker/${encodeURIComponent(i.id)}`, { method: "DELETE" }), t("Removed")); };
  const putApp = (companyId, body) => act(() => api(`/api/tracker/applications/${companyId}`, { method: "PUT", body }));
  async function addByUrl(e) {
    e.preventDefault();
    try {
      const item = await api("/api/tracker", { body: { url } });
      setUrl("");
      toast(t("Tracking {issue}", { issue: `${item.owner}/${item.repo}#${item.number}` }));
      reload();
      sync(true);   // fills in the title and state
    } catch (err) { toast(t(err.message), true); }
  }

  const c = data.counts;
  const sk = skills.data;
  const matches = sk?.matches || {};
  const companyCols = [
    {
      key: "name", label: t("Company"),
      render: (r) => (
        <div>
          <div className="cell-title"><Link href={`/companies/${r.id}`}>{r.name}</Link></div>
          {r.ready ? <span className="chip chip-plus" title={t("{n}+ merged pull requests and no application yet", { n: data.readyMerged })}>{t("Ready to approach")}</span> : null}
        </div>
      ),
    },
    { key: "match", label: t("Skill match"), firstDir: "desc", title: t("Share of the company's active repositories written in your languages"),
      sortValue: (r) => matches[r.id]?.score ?? null, render: (r) => <SkillMatch m={matches[r.id]} /> },
    { key: "mergedPrs", label: t("Merged PRs"), num: true },
    { key: "openPrs", label: t("Open PRs"), num: true },
    { key: "trackedIssues", label: t("Tracked issues"), num: true },
    {
      key: "stage", label: t("Application"), sortValue: (r) => data.appStages.findIndex(([k]) => k === r.stage),
      render: (r) => (
        <select aria-label={t("Application stage for {name}", { name: r.name })} value={r.stage} onChange={(e) => putApp(r.id, { stage: e.target.value }).catch(() => {})}>
          {data.appStages.map(([k, label]) => <option key={k} value={k}>{t(label)}</option>)}
        </select>
      ),
    },
    {
      key: "careersUrl", label: t("Careers / casual interview link"), sortable: false,
      render: (r) => (
        <div>
          <InlineText value={r.careersUrl} placeholder={t("Add link")} onSave={(v) => putApp(r.id, { careersUrl: v })} render={(v) => <ExtLink href={v} />} />
          {r.careersUrl ? null : <HiringLinks name={r.name} />}
        </div>
      ),
    },
    { key: "notes", label: t("Notes"), sortable: false, render: (r) => <InlineText value={r.notes} placeholder={t("Add note")} multiline onSave={(v) => putApp(r.id, { notes: v })} /> },
  ];
  const issueCols = [
    {
      key: "title", label: t("Issue"),
      render: (i) => (
        <div style={{ minWidth: 240 }}>
          <div className="cell-title"><ExtLink href={i.url}>{i.title}</ExtLink></div>
          <div className="cell-sub">{i.owner}/{i.repo} #{i.number}{i.issueState === "CLOSED" ? ` · ${t("closed on GitHub")}` : ""}</div>
        </div>
      ),
    },
    { key: "company", label: t("Company"), render: (i) => (i.companyId != null && i.company ? <Link href={`/companies/${i.companyId}`}>{i.company}</Link> : <Dash />) },
    {
      key: "stage", label: t("Stage"), sortValue: (i) => data.stages.findIndex(([k]) => k === i.stage),
      render: (i) => (
        <select aria-label={t("Stage for {title}", { title: i.title })} value={i.stage} onChange={(e) => patchItem(i.id, { stage: e.target.value }).catch(() => {})}>
          {data.stages.map(([k, label]) => <option key={k} value={k}>{t(label)}</option>)}
        </select>
      ),
    },
    { key: "prState", label: t("Your PR"), render: (i) => (i.prUrl ? <a href={i.prUrl} target="_blank" rel="noopener noreferrer"><PrState state={i.prState} /></a> : <Dash />) },
    { key: "notes", label: t("Notes"), sortable: false, render: (i) => <InlineText value={i.notes} placeholder={t("Add note")} multiline onSave={(v) => patchItem(i.id, { notes: v })} /> },
    { key: "updatedAt", label: t("Updated"), className: "nowrap", firstDir: "desc", render: (i) => <TimeAgo iso={i.updatedAt} /> },
    { key: "remove", label: "", sortable: false, render: (i) => <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeIssue(i)} aria-label={t("Stop tracking {title}", { title: i.title })}>{t("Remove")}</button> },
  ];
  const inPipeline = new Set(data.companies.map((r) => r.id));
  const suggestions = (sk?.suggestions || []).filter((s) => !inPipeline.has(s.id)).slice(0, 10);
  const suggestCols = [
    {
      key: "name", label: t("Company"),
      render: (s) => (
        <div>
          <div className="cell-title"><Link href={`/companies/${s.id}`}>{s.name}</Link></div>
          <div className="cell-sub">{s.shared.length ? t("uses {langs}", { langs: s.shared.slice(0, 3).join(", ") }) : t("related languages only")}</div>
        </div>
      ),
    },
    { key: "match", label: t("Skill match"), firstDir: "desc", render: (s) => <SkillMatch m={matches[s.id]} /> },
    { key: "bestScore", label: t("Best repo"), firstDir: "desc", title: t("Welcome score of the company's most welcoming repository (see Contribute)"),
      render: (s) => <Bar value={s.bestScore} title={s.bestRepo ? t("{repo}: welcomes outside contributions {score}/100", { repo: s.bestRepo, score: s.bestScore }) : undefined} /> },
    {
      key: "openIssues", label: t("Issues to pick"), num: true, title: t("Unassigned issues with no linked pull request, in your languages first"),
      render: (s) => <Link href={`/contribute?${qs({ view: "issues", company: s.id, mine: 1 })}`}>{fmt(s.openIssues)}</Link>,
    },
    { key: "beginnerIssues", label: t("Beginner issues"), num: true },
    { key: "hiring", label: t("Hiring"), sortable: false, render: (s) => <HiringLinks name={s.name} /> },
  ];
  const prCols = [
    {
      key: "title", label: t("Pull request"),
      render: (p) => (
        <div style={{ minWidth: 240 }}>
          <div className="cell-title"><ExtLink href={p.url}>{p.title}</ExtLink></div>
          <div className="cell-sub">{p.owner}/{p.repo}</div>
        </div>
      ),
    },
    { key: "company", label: t("Company"), render: (p) => (p.company ? <Link href={`/companies/${p.companyId}`}>{p.company}</Link> : <Dash />) },
    { key: "state", label: t("State"), render: (p) => <PrState state={p.state} /> },
    { key: "createdAt", label: t("Opened"), className: "nowrap", firstDir: "desc", render: (p) => <TimeAgo iso={p.createdAt} /> },
    { key: "mergedAt", label: t("Merged"), className: "nowrap", firstDir: "desc", render: (p) => (p.mergedAt ? <TimeAgo iso={p.mergedAt} /> : <Dash />) },
  ];
  const viewerLink = data.viewer ? <ExtLink href={`https://github.com/${data.viewer}`}>@{data.viewer}</ExtLink> : null;

  return (
    <>
      {head}
      <div className="row" style={{ marginBottom: 12 }}>
        <button type="button" className="btn" onClick={() => sync(false)} disabled={syncing || !status.token.configured}
          title={status.token.configured ? undefined : t("Add a GitHub token on the Settings page first")}>{syncing ? t("Syncing…") : t("Sync with GitHub")}</button>
        <span className="muted small">
          {data.syncedAt
            ? (viewerLink ? rich("Last synced {when} as {user}.", { when: ago(data.syncedAt), user: viewerLink }) : t("Last synced {when}.", { when: ago(data.syncedAt) }))
            : t("Not synced yet.")}{" "}
          {t("Reads the pull requests and comments of the GitHub account that owns the token.")}
        </span>
      </div>
      <div className="tiles">
        <Tile label={t("Tracked issues")} value={fmt(data.items.length - c.dropped)} note={t("{watching} watching · {commented} commented", { watching: fmt(c.watching), commented: fmt(c.commented) })} />
        <Tile label={t("Open pull requests")} value={fmt(c.openPrs)} note={t("to tracked companies")} />
        <Tile label={t("Merged pull requests")} value={fmt(c.mergedPrs)} note={t("to tracked companies")} />
        <Tile label={t("Ready to approach")} value={fmt(c.ready)} note={t("{n}+ merged, not applied yet", { n: data.readyMerged })} />
        <Tile label={t("Active applications")} value={fmt(c.activeApplications)} note={t("applied → offer")} />
      </div>

      <section className="card" style={{ marginBottom: 16 }}>
        <CardHead title={t("Companies")} sub={t("where you have issues, pull requests or an application")} />
        <DataTable columns={companyCols} rows={data.companies} rowKey={(r) => r.id}
          empty={rich("Nothing yet. Track an issue on the <link>Contribute</link> page, or open a pull request to a tracked company and sync.", { link: (txt) => <Link href="/contribute">{txt}</Link> })} />
      </section>

      <section className="card" style={{ marginBottom: 16 }}>
        <CardHead title={t("Where your skills fit")} sub={t("skill match × how welcoming the company's repositories are, for companies not in your list yet")} />
        {sk ? (
          <>
            <div style={{ marginBottom: 12 }}>
              <div className="small muted" style={{ marginBottom: 6 }}>
                {sk.viewer
                  ? rich("Your languages: found in {user}'s repositories when you sync. Add ones GitHub can't see, remove ones you don't want to work in.", { user: <ExtLink href={`https://github.com/${sk.viewer}`}>@{sk.viewer}</ExtLink> })
                  : t("Your languages: sync with GitHub to detect them, or add them here.")}
              </div>
              <SkillsEditor skills={sk} onSaved={(v) => skills.setData(v)} />
            </div>
            <DataTable columns={suggestCols} rows={suggestions} rowKey={(s) => s.id}
              empty={!sk.languages.length ? t("Add your languages to see which companies fit.")
                : sk.suggestions.length ? t("Every matching company is already in your list above.")
                  : rich("No matching companies with open issues yet. Contribution data comes from <link>Collect data</link>.", { link: (txt) => <Link href="/contribute">{txt}</Link> })} />
          </>
        ) : <><ErrorNotice error={skills.error} />{skills.error ? null : <Loading />}</>}
      </section>

      <section className="card" style={{ marginBottom: 16 }}>
        <CardHead title={t("Tracked issues")} sub={t("moves to Commented, PR open and Merged automatically when you sync")} />
        <form className="row" onSubmit={addByUrl} style={{ marginBottom: 10 }}>
          <input type="url" placeholder="https://github.com/owner/repo/issues/123" aria-label={t("GitHub issue link")} value={url}
            onChange={(e) => setUrl(e.target.value)} style={{ flex: "1 1 320px" }} required />
          <button type="submit" className="btn btn-primary">{t("Track issue")}</button>
        </form>
        <DataTable columns={issueCols} rows={data.items} rowKey={(i) => i.id}
          empty={rich("No tracked issues. Use “Track” on the <link>Contribute</link> page or paste an issue link above.", { link: (txt) => <Link href="/contribute">{txt}</Link> })} />
      </section>

      <section className="card">
        <CardHead title={t("Your pull requests")} sub={t("to tracked companies' repositories, from your last 100 pull requests")} />
        <DataTable columns={prCols} rows={data.prs} rowKey={(p) => p.url} initialSort={{ key: "createdAt", dir: "desc" }}
          empty={data.syncedAt ? t("No pull requests to tracked companies yet.") : t("Sync with GitHub to load your pull requests.")} />
      </section>
    </>
  );
}
