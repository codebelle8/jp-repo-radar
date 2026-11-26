"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { CompanyForm } from "@/components/CompanyForm";
import { DataTable } from "@/components/DataTable";
import { usePrefs, useStatus, useT, useToast } from "@/components/providers";
import { ArchivedToggle, CardHead, Dash, ErrorNotice, ExportLink, Loading, OrgChips, PageHead, RunButton, SegmentSelect, TimeAgo } from "@/components/ui";
import { api, useApi } from "@/lib/client";
import { ago, localTime, qs } from "@/lib/format";

export default function CompaniesPage() {
  const router = useRouter();
  const toast = useToast();
  const { t } = useT();
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

  const head = <PageHead title={t("Companies")} lede={t("Each company can own several GitHub organizations; their repositories are summed into one row.")} />;
  if (!data) return <>{head}<ErrorNotice error={error} />{error ? null : <Loading />}</>;

  const columns = [
    { key: "name", label: t("Company"), sortValue: (c) => c.name.toLowerCase(), render: (c) => (
      <div><Link className="cell-title" href={`/companies/${c.id}`}>{c.name}</Link>{c.nameJa ? <div className="cell-sub">{c.nameJa}</div> : null}</div>) },
    { key: "segment", label: t("Segment"), render: (c) => c.segment || <Dash /> },
    { key: "orgs", label: t("GitHub orgs"), sortable: false, render: (c) => <div><OrgChips orgs={c.orgs} /></div> },
    { key: "repos", label: t("Repos"), num: true },
    { key: "branches", label: t("Branches"), num: true },
    { key: "openIssues", label: t("Open issues"), num: true },
    { key: "closedIssues", label: t("Closed issues"), num: true },
    { key: "totalIssues", label: t("Total issues"), num: true },
    { key: "openPrs", label: t("Open PRs"), num: true },
    { key: "stars", label: t("Stars"), num: true },
    { key: "lastPush", label: t("Last push"), className: "nowrap", firstDir: "desc", render: (c) => <TimeAgo iso={c.lastPush} /> },
    { key: "lastCollected", label: t("Collected"), className: "nowrap", firstDir: "desc", render: (c) => c.orgErrors
      ? <span className="status bad" title={t("Some organizations could not be collected")}>{ago(c.lastCollected)}</span>
      : c.lastCollected ? <span className="status ok" title={localTime(c.lastCollected)}>{ago(c.lastCollected)}</span>
        : <span className="status">{t("never")}</span> },
  ];

  async function save(body) {
    const res = await api("/api/companies", { body });
    if (res.job) onJobStarted(res.job);
    toast(res.job ? t("Company added — collecting now") : t("Company added"));
    router.push(`/companies/${res.id}`);
  }

  return (
    <div className={loading ? "refreshing" : undefined}>
      {head}
      <div className="filters">
        <input type="search" placeholder={t("Search company or GitHub org")} aria-label={t("Search companies")} value={search} onChange={(e) => setSearch(e.target.value)} />
        <SegmentSelect segments={data.segments} />
        <ArchivedToggle />
        <span className="spacer" />
        <button type="button" className="btn" disabled={!canEdit} title={canEdit ? undefined : t("Sign in on the Settings page first")}
          onClick={() => setAdding((v) => !v)}>{t("Add company")}</button>
        <ExportLink kind="companies" />
        <RunButton onClick={() => startJob("collect")}>{t("Collect all")}</RunButton>
      </div>
      {adding ? <CompanyForm segments={data.segments} onSave={save} onCancel={() => setAdding(false)} /> : null}
      <section className="card">
        <CardHead title={t("Tracked companies")}>
          <span className="muted small">{rows.length === data.rows.length ? t("{n} companies", { n: rows.length }) : t("{n} of {total} companies", { n: rows.length, total: data.rows.length })}</span>
        </CardHead>
        <DataTable columns={columns} rows={rows} initialSort={{ key: "openIssues", dir: "desc" }} rowKey={(c) => c.id}
          onRowClick={(c) => router.push(`/companies/${c.id}`)} />
      </section>
    </div>
  );
}
