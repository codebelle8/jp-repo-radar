"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BarChart, TooltipRow } from "@/components/charts";
import { usePrefs, useStatus } from "@/components/providers";
import { RepoTable } from "@/components/RepoTable";
import { ArchivedToggle, CardHead, ErrorNotice, ExportLink, Loading, PageHead, RunButton, SegmentSelect, SetupNotice, Tile } from "@/components/ui";
import { useApi } from "@/lib/client";
import { compact, fmt, qs } from "@/lib/format";

const METRICS = [
  ["openIssues", "Open issues"], ["totalIssues", "Total issues"], ["branches", "Branches"], ["repos", "Repositories"], ["stars", "Stars"],
];

export default function OverviewPage() {
  const router = useRouter();
  const { prefs, setPrefs, loaded } = usePrefs();
  const { status, jobVersion, startJob } = useStatus();
  const url = loaded ? `/api/summary?${qs({ includeArchived: prefs.includeArchived ? 1 : 0, segment: prefs.segment })}` : null;
  const { data, error, loading } = useApi(url, [jobVersion]);

  const head = <PageHead title="Overview" lede="Public GitHub repositories of Japanese web-development companies: branches and issues summed per company." />;
  if (!data) return <>{head}<ErrorNotice error={error} />{error ? null : <Loading />}</>;

  const t = data.totals;
  const collected = data.companies.filter((c) => c.lastCollected);
  const metricKey = METRICS.some(([k]) => k === prefs.metric) ? prefs.metric : "openIssues";
  const metricLabel = METRICS.find(([k]) => k === metricKey)[1];
  const ranked = [...collected].sort((a, b) => b[metricKey] - a[metricKey] || a.name.localeCompare(b.name)).slice(0, 15);

  return (
    <div className={loading ? "refreshing" : undefined}>
      {head}
      <SetupNotice />
      {status?.token?.configured && !t.companiesCollected ? (
        <div className="notice">
          <div style={{ flex: 1 }}>
            <h2>No data collected yet</h2>
            <p className="muted">The starter list of companies is loaded. Collect their public repositories to fill the dashboard.</p>
          </div>
          <RunButton onClick={() => startJob("collect")}>Collect data</RunButton>
        </div>
      ) : null}

      <div className="filters">
        <SegmentSelect segments={data.segments} />
        <ArchivedToggle />
        <span className="spacer" />
        <ExportLink kind="companies" />
        <RunButton onClick={() => startJob("collect")}>Collect data</RunButton>
      </div>

      <div className="tiles">
        <Tile label="Companies" value={fmt(t.companies)} note={`${fmt(t.companiesCollected)} collected`} />
        <Tile label="Public repositories" value={compact(t.repos)} note="non-fork" />
        <Tile label="Branches" value={compact(t.branches)} note={t.repos ? `${(t.branches / t.repos).toFixed(1)} per repo` : null} />
        <Tile label="Open issues" value={compact(t.openIssues)} />
        <Tile label="Closed issues" value={compact(t.closedIssues)} note={`${compact(t.totalIssues)} total`} />
        <Tile label="Open pull requests" value={compact(t.openPrs)} />
      </div>

      <div className="grid-2">
        <section className="card">
          <CardHead title={`Top companies by ${metricLabel.toLowerCase()}`}
            sub={collected.length ? `top ${ranked.length} of ${collected.length} collected` : null} />
          <div style={{ marginBottom: 12, overflowX: "auto" }}>
            <div className="seg" role="group" aria-label="Metric">
              {METRICS.map(([k, lbl]) => (
                <button key={k} type="button" aria-pressed={k === metricKey} onClick={() => setPrefs({ metric: k })}>{lbl}</button>
              ))}
            </div>
          </div>
          {ranked.some((c) => c[metricKey] > 0) ? (
            <BarChart label={`Top companies by ${metricLabel}`}
              items={ranked.map((c) => ({ ...c, key: c.id, value: c[metricKey] }))}
              onSelect={(c) => router.push(`/companies/${c.id}`)}
              tooltip={(c) => (<>
                <TooltipRow label={metricLabel} value={fmt(c.value)} keyed />
                <TooltipRow label="Repositories" value={fmt(c.repos)} />
                <TooltipRow label="Branches" value={fmt(c.branches)} />
                <TooltipRow label="Open / closed issues" value={`${fmt(c.openIssues)} / ${fmt(c.closedIssues)}`} />
              </>)} />
          ) : <div className="empty">No collected data yet.</div>}
          <p className="chart-note">Summed over all GitHub organizations each company owns. Select a bar to open the company.</p>
        </section>

        <section className="card">
          <CardHead title="Repositories by primary language" sub={data.languages.length ? `top ${data.languages.length}` : null} />
          {data.languages.length ? (
            <BarChart label="Repositories by primary language"
              items={data.languages.map((l) => ({ key: l.language, name: l.language, value: l.repos }))}
              onSelect={(l) => router.push(`/repos?${qs({ language: l.name })}`)}
              tooltip={(l) => (<>
                <TooltipRow label="Repositories" value={fmt(l.value)} keyed />
                <TooltipRow label="Share" value={`${((l.value / Math.max(1, t.repos)) * 100).toFixed(1)}%`} />
              </>)} />
          ) : <div className="empty">No collected data yet.</div>}
          <p className="chart-note">Select a language to list its repositories.</p>
        </section>
      </div>

      <section className="card" style={{ marginTop: 16 }}>
        <CardHead title="Repositories with the most open issues"><Link href="/repos">All repositories →</Link></CardHead>
        <RepoTable rows={data.topRepos} showCompany />
      </section>
    </div>
  );
}
