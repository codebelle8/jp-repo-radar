"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { TrendChart } from "@/components/charts";
import { CompanyForm } from "@/components/CompanyForm";
import { DataTable } from "@/components/DataTable";
import { usePrefs, useStatus, useT, useToast } from "@/components/providers";
import { RepoTable } from "@/components/RepoTable";
import { ArchivedToggle, Avatar, CardHead, Dash, ExtLink, Loading, PageHead, RunButton, Tile } from "@/components/ui";
import { api, useApi } from "@/lib/client";
import { ago, compact, fmt, ghUrl, localTime } from "@/lib/format";

export default function CompanyPage() {
  const { id } = useParams();
  const router = useRouter();
  const toast = useToast();
  const { t } = useT();
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
    return <div className="empty">{error.message} <Link href="/companies">{t("Back to companies")}</Link></div>;
  }
  if (!c) return <><PageHead title={t("Company")} /><Loading /></>;

  async function remove() {
    if (!confirm(t("Delete {name} and all of its collected data? Its GitHub organizations will no longer be tracked.", { name: c.name }))) return;
    try {
      await api(`/api/companies/${c.id}`, { method: "DELETE" });
      toast(t("Company deleted"));
      router.push("/companies");
    } catch (err) { toast(err.message, true); }
  }

  const wa = c.withArchived;
  const firstAvatar = c.orgs.find((o) => o.avatarUrl)?.avatarUrl;
  const orgColumns = [
    { key: "login", label: t("Organization"), render: (o) => (
      <div className="org-cell"><Avatar src={o.avatarUrl} />
        <div><div className="cell-title"><ExtLink href={ghUrl(o.login)}>{o.login}</ExtLink></div>{o.name ? <div className="cell-sub">{o.name}</div> : null}</div>
      </div>) },
    { key: "description", label: t("Description"), render: (o) => o.description ? <div className="cell-desc">{o.description}</div> : <Dash /> },
    { key: "location", label: t("Location"), render: (o) => o.location || <Dash /> },
    { key: "websiteUrl", label: t("Website"), render: (o) => o.websiteUrl ? <ExtLink href={o.websiteUrl} /> : <Dash /> },
    { key: "isVerified", label: t("Verified"), render: (o) => o.isVerified ? <span className="status ok">{t("Verified domain")}</span> : <Dash /> },
    { key: "repoTotal", label: t("Public repos"), num: true, title: t("Public non-fork repositories reported by GitHub") },
    { key: "status", label: t("Status"), render: (o) => o.status === "ok"
      ? <span className="status ok" title={localTime(o.fetchedAt)}>OK · {ago(o.fetchedAt)}</span>
      : o.status === "pending" ? <span className="status">{t("Not collected")}</span>
        : <span className="status bad" title={o.error ? t(o.error) : ""}>{o.status === "not_found" ? t("Not found on GitHub") : t("Error")}</span> },
  ];

  return (
    <div className={loading ? "refreshing" : undefined}>
      <div className="company-head" style={{ marginBottom: 16 }}>
        {firstAvatar ? <Avatar src={firstAvatar} large /> : null}
        <div className="names">
          <div className="small"><Link href="/companies">{t("← Companies")}</Link></div>
          <h1>{c.name}</h1>
          <div className="row muted" style={{ marginTop: 4 }}>
            {c.nameJa ? <span>{c.nameJa}</span> : null}
            {c.segment ? <span className="chip">{c.segment}</span> : null}
            {c.website ? <ExtLink href={c.website} /> : null}
            <span className="faint small">{c.lastCollected ? t("Collected {when}", { when: ago(c.lastCollected) }) : t("Not collected yet")}</span>
          </div>
        </div>
        <div className="row">
          <button type="button" className="btn" disabled={!canEdit} onClick={() => setEditing((v) => !v)}>{t("Edit")}</button>
          <button type="button" className="btn btn-ghost btn-danger" disabled={!canEdit} onClick={remove}>{t("Delete")}</button>
          <RunButton onClick={() => startJob("collect", { companyIds: [c.id] })}>{t("Refresh data")}</RunButton>
        </div>
      </div>

      {editing ? (
        <CompanyForm company={c} segments={c.segments} onCancel={() => setEditing(false)}
          onSave={async (body) => {
            const { collect, ...patch } = body;
            await api(`/api/companies/${c.id}`, { body: patch, method: "PATCH" });
            toast(t("Saved"));
            setEditing(false);
            reload();
          }} />
      ) : null}

      <div className="tiles">
        <Tile label={t("Repositories")} value={fmt(c.repos)} note={wa.repos !== c.repos ? t("{n} incl. archived", { n: fmt(wa.repos) }) : t("none archived")} />
        <Tile label={t("Branches")} value={fmt(c.branches)} note={wa.branches !== c.branches ? t("{n} incl. archived", { n: fmt(wa.branches) }) : null} />
        <Tile label={t("Open issues")} value={fmt(c.openIssues)} note={wa.openIssues !== c.openIssues ? t("{n} incl. archived", { n: fmt(wa.openIssues) }) : null} />
        <Tile label={t("Closed issues")} value={fmt(c.closedIssues)} note={t("{n} total", { n: fmt(c.totalIssues) })} />
        <Tile label={t("Open pull requests")} value={fmt(c.openPrs)} />
        <Tile label={t("Stars")} value={compact(c.stars)} />
      </div>

      <section className="card" style={{ marginBottom: 16 }}>
        <CardHead title={t("GitHub organizations owned by this company")} sub={String(c.orgs.length)} />
        <DataTable columns={orgColumns} rows={c.orgs} initialSort={{ key: "login", dir: "asc" }} rowKey={(o) => o.login} />
      </section>

      {c.snapshots.length ? (
        <div className="grid-trend" style={{ marginBottom: 16 }}>
          {[["branches", t("Branches")], ["openIssues", t("Open issues")], ["repos", t("Repositories")]].map(([k, label]) => (
            <section key={k} className="card">
              <CardHead title={label} sub={t("excl. archived")} />
              <TrendChart label={label} points={c.snapshots.map((s) => ({ t: s.t, v: s[k] }))} />
            </section>
          ))}
        </div>
      ) : null}

      <section className="card">
        <CardHead title={t("Repositories")}><span className="muted small">{t("{n} repositories", { n: repos.length })}</span></CardHead>
        <div className="filters">
          <input type="search" placeholder={t("Filter repositories")} aria-label={t("Filter repositories")} value={search} onChange={(e) => setSearch(e.target.value)} />
          <ArchivedToggle />
        </div>
        <RepoTable rows={repos} initialSort={{ key: "openIssues", dir: "desc" }}
          empty={c.lastCollected ? t("No repositories match.") : t("Not collected yet.")} />
      </section>
    </div>
  );
}
