"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BarChart, TooltipRow } from "@/components/charts";
import { usePrefs, useStatus, useT } from "@/components/providers";
import { RepoTable } from "@/components/RepoTable";
import { ArchivedToggle, CardHead, ErrorNotice, ExportLink, Loading, PageHead, RunButton, SegmentSelect, SetupNotice, Tile } from "@/components/ui";
import { useApi } from "@/lib/client";
import { compact, fmt, qs } from "@/lib/format";
import { msg } from "@/lib/i18n";

const METRICS = [
  ["openIssues", msg("Open issues")], ["totalIssues", msg("Total issues")], ["branches", msg("Branches")], ["repos", msg("Repositories")], ["stars", msg("Stars")],
];

export default function OverviewPage() {
  const router = useRouter();
  const { t, lang } = useT();
  const { prefs, setPrefs, loaded } = usePrefs();
  const { status, jobVersion, startJob } = useStatus();
  const url = loaded ? `/api/summary?${qs({ includeArchived: prefs.includeArchived ? 1 : 0, segment: prefs.segment })}` : null;
  const { data, error, loading } = useApi(url, [jobVersion]);

  const head = <PageHead title={t("Overview")} lede={t("Public GitHub repositories of Japanese web-development companies: branches and issues summed per company.")} />;
  if (!data) return <>{head}<ErrorNotice error={error} />{error ? null : <Loading />}</>;

  const totals = data.totals;
  const collected = data.companies.filter((c) => c.lastCollected);
  const metricKey = METRICS.some(([k]) => k === prefs.metric) ? prefs.metric : "openIssues";
  const metricLabel = t(METRICS.find(([k]) => k === metricKey)[1]);
  const ranked = [...collected].sort((a, b) => b[metricKey] - a[metricKey] || a.name.localeCompare(b.name)).slice(0, 15);

  return (
    <div className={loading ? "refreshing" : undefined}>
      {head}
      <SetupNotice />
      {status?.token?.configured && !totals.companiesCollected ? (
        <div className="notice">
          <div style={{ flex: 1 }}>
            <h2>{t("No data collected yet")}</h2>
            <p className="muted">{t("The starter list of companies is loaded. Collect their public repositories to fill the dashboard.")}</p>
          </div>
          <RunButton onClick={() => startJob("collect")}>{t("Collect data")}</RunButton>
        </div>
      ) : null}

      <div className="filters">
        <SegmentSelect segments={data.segments} />
        <ArchivedToggle />
        <span className="spacer" />
        <ExportLink kind="companies" />
        <RunButton onClick={() => startJob("collect")}>{t("Collect data")}</RunButton>
      </div>

      <div className="tiles">
        <Tile label={t("Companies")} value={fmt(totals.companies)} note={t("{n} collected", { n: fmt(totals.companiesCollected) })} />
        <Tile label={t("Public repositories")} value={compact(totals.repos)} note={t("non-fork")} />
        <Tile label={t("Branches")} value={compact(totals.branches)} note={totals.repos ? t("{n} per repo", { n: (totals.branches / totals.repos).toFixed(1) }) : null} />
        <Tile label={t("Open issues")} value={compact(totals.openIssues)} />
        <Tile label={t("Closed issues")} value={compact(totals.closedIssues)} note={t("{n} total", { n: compact(totals.totalIssues) })} />
        <Tile label={t("Open pull requests")} value={compact(totals.openPrs)} />
      </div>

      <div className="grid-2">
        <section className="card">
          <CardHead title={t("Top companies by {metric}", { metric: lang === "ja" ? metricLabel : metricLabel.toLowerCase() })}
            sub={collected.length ? t("top {n} of {total} collected", { n: ranked.length, total: collected.length }) : null} />
          <div style={{ marginBottom: 12, overflowX: "auto" }}>
            <div className="seg" role="group" aria-label={t("Metric")}>
              {METRICS.map(([k, lbl]) => (
                <button key={k} type="button" aria-pressed={k === metricKey} onClick={() => setPrefs({ metric: k })}>{t(lbl)}</button>
              ))}
            </div>
          </div>
          {ranked.some((c) => c[metricKey] > 0) ? (
            <BarChart label={t("Top companies by {metric}", { metric: metricLabel })}
              items={ranked.map((c) => ({ ...c, key: c.id, value: c[metricKey] }))}
              onSelect={(c) => router.push(`/companies/${c.id}`)}
              tooltip={(c) => (<>
                <TooltipRow label={metricLabel} value={fmt(c.value)} keyed />
                <TooltipRow label={t("Repositories")} value={fmt(c.repos)} />
                <TooltipRow label={t("Branches")} value={fmt(c.branches)} />
                <TooltipRow label={t("Open / closed issues")} value={`${fmt(c.openIssues)} / ${fmt(c.closedIssues)}`} />
              </>)} />
          ) : <div className="empty">{t("No collected data yet.")}</div>}
          <p className="chart-note">{t("Summed over all GitHub organizations each company owns. Select a bar to open the company.")}</p>
        </section>

        <section className="card">
          <CardHead title={t("Repositories by primary language")} sub={data.languages.length ? t("top {n}", { n: data.languages.length }) : null} />
          {data.languages.length ? (
            <BarChart label={t("Repositories by primary language")}
              items={data.languages.map((l) => ({ key: l.language, name: l.language, value: l.repos }))}
              onSelect={(l) => router.push(`/repos?${qs({ language: l.name })}`)}
              tooltip={(l) => (<>
                <TooltipRow label={t("Repositories")} value={fmt(l.value)} keyed />
                <TooltipRow label={t("Share")} value={`${((l.value / Math.max(1, totals.repos)) * 100).toFixed(1)}%`} />
              </>)} />
          ) : <div className="empty">{t("No collected data yet.")}</div>}
          <p className="chart-note">{t("Select a language to list its repositories.")}</p>
        </section>
      </div>

      <section className="card" style={{ marginTop: 16 }}>
        <CardHead title={t("Repositories with the most open issues")}><Link href="/repos">{t("All repositories →")}</Link></CardHead>
        <RepoTable rows={data.topRepos} showCompany />
      </section>
    </div>
  );
}
