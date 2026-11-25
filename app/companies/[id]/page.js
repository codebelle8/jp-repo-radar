"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { TrendChart } from "@/components/charts";
import { CompanyForm } from "@/components/CompanyForm";
import { DataTable } from "@/components/DataTable";
import { usePrefs, useStatus, useToast } from "@/components/providers";
import { RepoTable } from "@/components/RepoTable";
import { ArchivedToggle, Avatar, CardHead, Dash, ExtLink, Loading, PageHead, RunButton, Tile } from "@/components/ui";
import { api, useApi } from "@/lib/client";
import { ago, compact, fmt, ghUrl, localTime } from "@/lib/format";

export default function CompanyPage() {
  const { id } = useParams();
  const router = useRouter();
  const toast = useToast();
  const { prefs } = usePrefs();
  const { jobVersion, startJob, canEdit } = useStatus();
  const { data: c, error, loading, reload } = useApi(`/api/companies/${id}`, [jobVersion]);
  const [editing, setEditing] = useState(false);
  const [search, setSearch] = useState("");

  const repos = useMemo(() => {
    if (!c) return [];
    const q = search.trim().toLowerCase();
    return c.repositories.filter((r) => (prefs.includeArchived || !r.archived)
      && (!q || [r.name, r.description, r.language, ...(r.topics || [])].some((v) => v && v.toLowerCase().includes(q))));
  }, [c, search, prefs.includeArchived]);

  if (error && !c) {
    return <div className="empty">{error.message} <Link href="/companies">Back to companies</Link></div>;
  }
  if (!c) return <><PageHead title="Company" /><Loading /></>;

  async function remove() {
    if (!confirm(`Delete ${c.name} and all of its collected data? Its GitHub organizations will no longer be tracked.`)) return;
    try {
      await api(`/api/companies/${c.id}`, { method: "DELETE" });
      toast("Company deleted");
      router.push("/companies");
    } catch (err) { toast(err.message, true); }
  }

  const wa = c.withArchived;
  const firstAvatar = c.orgs.find((o) => o.avatarUrl)?.avatarUrl;
  const orgColumns = [
    { key: "login", label: "Organization", render: (o) => (
      <div className="org-cell"><Avatar src={o.avatarUrl} />
        <div><div className="cell-title"><ExtLink href={ghUrl(o.login)}>{o.login}</ExtLink></div>{o.name ? <div className="cell-sub">{o.name}</div> : null}</div>
      </div>) },
    { key: "description", label: "Description", render: (o) => o.description ? <div className="cell-desc">{o.description}</div> : <Dash /> },
    { key: "location", label: "Location", render: (o) => o.location || <Dash /> },
    { key: "websiteUrl", label: "Website", render: (o) => o.websiteUrl ? <ExtLink href={o.websiteUrl} /> : <Dash /> },
    { key: "isVerified", label: "Verified", render: (o) => o.isVerified ? <span className="status ok">Verified domain</span> : <Dash /> },
    { key: "repoTotal", label: "Public repos", num: true, title: "Public non-fork repositories reported by GitHub" },
    { key: "status", label: "Status", render: (o) => o.status === "ok"
      ? <span className="status ok" title={localTime(o.fetchedAt)}>OK · {ago(o.fetchedAt)}</span>
      : o.status === "pending" ? <span className="status">Not collected</span>
        : <span className="status bad" title={o.error || ""}>{o.status === "not_found" ? "Not found on GitHub" : "Error"}</span> },
  ];

  return (
    <div className={loading ? "refreshing" : undefined}>
      <div className="company-head" style={{ marginBottom: 16 }}>
        {firstAvatar ? <Avatar src={firstAvatar} large /> : null}
        <div className="names">
          <div className="small"><Link href="/companies">← Companies</Link></div>
          <h1>{c.name}</h1>
          <div className="row muted" style={{ marginTop: 4 }}>
            {c.nameJa ? <span>{c.nameJa}</span> : null}
            {c.segment ? <span className="chip">{c.segment}</span> : null}
            {c.website ? <ExtLink href={c.website} /> : null}
            <span className="faint small">{c.lastCollected ? `Collected ${ago(c.lastCollected)}` : "Not collected yet"}</span>
          </div>
        </div>
        <div className="row">
          <button type="button" className="btn" disabled={!canEdit} onClick={() => setEditing((v) => !v)}>Edit</button>
          <button type="button" className="btn btn-ghost btn-danger" disabled={!canEdit} onClick={remove}>Delete</button>
          <RunButton onClick={() => startJob("collect", { companyIds: [c.id] })}>Refresh data</RunButton>
        </div>
      </div>

      {editing ? (
        <CompanyForm company={c} segments={c.segments} onCancel={() => setEditing(false)}
          onSave={async (body) => {
            const { collect, ...patch } = body;
            await api(`/api/companies/${c.id}`, { body: patch, method: "PATCH" });
            toast("Saved");
            setEditing(false);
            reload();
          }} />
      ) : null}

      <div className="tiles">
        <Tile label="Repositories" value={fmt(c.repos)} note={wa.repos !== c.repos ? `${fmt(wa.repos)} incl. archived` : "none archived"} />
        <Tile label="Branches" value={fmt(c.branches)} note={wa.branches !== c.branches ? `${fmt(wa.branches)} incl. archived` : null} />
        <Tile label="Open issues" value={fmt(c.openIssues)} note={wa.openIssues !== c.openIssues ? `${fmt(wa.openIssues)} incl. archived` : null} />
        <Tile label="Closed issues" value={fmt(c.closedIssues)} note={`${fmt(c.totalIssues)} total`} />
        <Tile label="Open pull requests" value={fmt(c.openPrs)} />
        <Tile label="Stars" value={compact(c.stars)} />
      </div>

      <section className="card" style={{ marginBottom: 16 }}>
        <CardHead title="GitHub organizations owned by this company" sub={String(c.orgs.length)} />
        <DataTable columns={orgColumns} rows={c.orgs} initialSort={{ key: "login", dir: "asc" }} rowKey={(o) => o.login} />
      </section>

      {c.snapshots.length ? (
        <div className="grid-trend" style={{ marginBottom: 16 }}>
          {[["branches", "Branches"], ["openIssues", "Open issues"], ["repos", "Repositories"]].map(([k, label]) => (
            <section key={k} className="card">
              <CardHead title={label} sub="excl. archived" />
              <TrendChart label={label} points={c.snapshots.map((s) => ({ t: s.t, v: s[k] }))} />
            </section>
          ))}
        </div>
      ) : null}

      <section className="card">
        <CardHead title="Repositories"><span className="muted small">{repos.length} repositories</span></CardHead>
        <div className="filters">
          <input type="search" placeholder="Filter repositories" aria-label="Filter repositories" value={search} onChange={(e) => setSearch(e.target.value)} />
          <ArchivedToggle />
        </div>
        <RepoTable rows={repos} initialSort={{ key: "openIssues", dir: "desc" }}
          empty={c.lastCollected ? "No repositories match." : "Not collected yet."} />
      </section>
    </div>
  );
}
