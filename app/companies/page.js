"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { CompanyForm } from "@/components/CompanyForm";
import { DataTable } from "@/components/DataTable";
import { usePrefs, useStatus, useToast } from "@/components/providers";
import { ArchivedToggle, CardHead, Dash, ErrorNotice, ExportLink, Loading, OrgChips, PageHead, RunButton, SegmentSelect, TimeAgo } from "@/components/ui";
import { api, useApi } from "@/lib/client";
import { ago, localTime, qs } from "@/lib/format";

export default function CompaniesPage() {
  const router = useRouter();
  const toast = useToast();
  const { prefs, loaded } = usePrefs();
  const { jobVersion, startJob, canEdit, onJobStarted } = useStatus();
  const url = loaded ? `/api/companies?${qs({ includeArchived: prefs.includeArchived ? 1 : 0, segment: prefs.segment })}` : null;
  const { data, error, loading } = useApi(url, [jobVersion]);
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);

  const rows = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    if (!q) return data.rows;
    return data.rows.filter((c) => [c.name, c.nameJa, c.segment, ...c.orgs.map((o) => o.login)].some((v) => v && v.toLowerCase().includes(q)));
  }, [data, search]);

  const head = <PageHead title="Companies" lede="Each company can own several GitHub organizations; their repositories are summed into one row." />;
  if (!data) return <>{head}<ErrorNotice error={error} />{error ? null : <Loading />}</>;

  const columns = [
    { key: "name", label: "Company", sortValue: (c) => c.name.toLowerCase(), render: (c) => (
      <div><Link className="cell-title" href={`/companies/${c.id}`}>{c.name}</Link>{c.nameJa ? <div className="cell-sub">{c.nameJa}</div> : null}</div>) },
    { key: "segment", label: "Segment", render: (c) => c.segment || <Dash /> },
    { key: "orgs", label: "GitHub orgs", sortable: false, render: (c) => <div><OrgChips orgs={c.orgs} /></div> },
    { key: "repos", label: "Repos", num: true },
    { key: "branches", label: "Branches", num: true },
    { key: "openIssues", label: "Open issues", num: true },
    { key: "closedIssues", label: "Closed issues", num: true },
    { key: "totalIssues", label: "Total issues", num: true },
    { key: "openPrs", label: "Open PRs", num: true },
    { key: "stars", label: "Stars", num: true },
    { key: "lastPush", label: "Last push", className: "nowrap", firstDir: "desc", render: (c) => <TimeAgo iso={c.lastPush} /> },
    { key: "lastCollected", label: "Collected", className: "nowrap", firstDir: "desc", render: (c) => c.orgErrors
      ? <span className="status bad" title="Some organizations could not be collected">{ago(c.lastCollected)}</span>
      : c.lastCollected ? <span className="status ok" title={localTime(c.lastCollected)}>{ago(c.lastCollected)}</span>
        : <span className="status">never</span> },
  ];

  async function save(body) {
    const res = await api("/api/companies", { body });
    if (res.job) onJobStarted(res.job);
    toast(res.job ? "Company added — collecting now" : "Company added");
    router.push(`/companies/${res.id}`);
  }

  return (
    <div className={loading ? "refreshing" : undefined}>
      {head}
      <div className="filters">
        <input type="search" placeholder="Search company or GitHub org" aria-label="Search companies" value={search} onChange={(e) => setSearch(e.target.value)} />
        <SegmentSelect segments={data.segments} />
        <ArchivedToggle />
        <span className="spacer" />
        <button type="button" className="btn" disabled={!canEdit} title={canEdit ? undefined : "Sign in on the Settings page first"}
          onClick={() => setAdding((v) => !v)}>Add company</button>
        <ExportLink kind="companies" />
        <RunButton onClick={() => startJob("collect")}>Collect all</RunButton>
      </div>
      {adding ? <CompanyForm segments={data.segments} onSave={save} onCancel={() => setAdding(false)} /> : null}
      <section className="card">
        <CardHead title="Tracked companies">
          <span className="muted small">{rows.length === data.rows.length ? `${rows.length} companies` : `${rows.length} of ${data.rows.length} companies`}</span>
        </CardHead>
        <DataTable columns={columns} rows={rows} initialSort={{ key: "openIssues", dir: "desc" }} rowKey={(c) => c.id}
          onRowClick={(c) => router.push(`/companies/${c.id}`)} />
      </section>
    </div>
  );
}
