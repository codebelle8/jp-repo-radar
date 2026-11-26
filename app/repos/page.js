"use client";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { usePrefs, useStatus, useT } from "@/components/providers";
import { RepoTable } from "@/components/RepoTable";
import { ArchivedToggle, CardHead, ErrorNotice, ExportLink, Loading, PageHead, SegmentSelect } from "@/components/ui";
import { useApi } from "@/lib/client";
import { fmt, qs } from "@/lib/format";

const PAGE = 50;

function ReposView() {
  const params = useSearchParams();
  const { t } = useT();
  const { prefs, loaded } = usePrefs();
  const { jobVersion } = useStatus();
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [language, setLanguage] = useState(params.get("language") || "");
  const [companyId, setCompanyId] = useState(params.get("company") || "");
  const [sort, setSort] = useState({ key: "openIssues", dir: "desc" });
  const [offset, setOffset] = useState(0);

  useEffect(() => {   // debounce the search box
    const timer = setTimeout(() => { setQuery(q.trim()); setOffset(0); }, 250);
    return () => clearTimeout(timer);
  }, [q]);
  useEffect(() => { setOffset(0); }, [prefs.includeArchived, prefs.segment]);

  const companies = useApi(loaded ? `/api/companies?${qs({ segment: prefs.segment })}` : null, [jobVersion]);
  const url = loaded ? `/api/repos?${qs({ q: query, language, companyId, includeArchived: prefs.includeArchived ? 1 : 0,
    segment: prefs.segment, sort: sort.key, dir: sort.dir, limit: PAGE, offset })}` : null;
  const { data, error, loading } = useApi(url, [jobVersion]);

  const head = <PageHead title={t("Repositories")} lede={t("Every tracked public repository. Sort by any column; filters apply to all pages.")} />;
  if (!data || !companies.data) return <>{head}<ErrorNotice error={error || companies.error} />{error ? null : <Loading />}</>;

  const from = data.total ? offset + 1 : 0;
  const to = Math.min(data.total, offset + PAGE);
  return (
    <>
      {head}
      <div className="filters">
        <input type="search" placeholder={t("Search name, description, topic")} aria-label={t("Search repositories")} value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label={t("Language")} value={language} onChange={(e) => { setLanguage(e.target.value); setOffset(0); }}>
          <option value="">{t("All languages")}</option>
          {data.languages.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <select aria-label={t("Company")} value={companyId} onChange={(e) => { setCompanyId(e.target.value); setOffset(0); }}>
          <option value="">{t("All companies")}</option>
          {companies.data.rows.map((c) => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
        </select>
        <SegmentSelect segments={companies.data.segments} />
        <ArchivedToggle />
        <span className="spacer" />
        <ExportLink kind="repos" />
      </div>
      <section className="card">
        <CardHead title={t("Repositories")}><span className="muted small">{t("{n} repositories", { n: fmt(data.total) })}</span></CardHead>
        <div className={loading ? "refreshing" : undefined}>
          <RepoTable rows={data.rows} showCompany initialSort={sort} empty={t("No repositories match these filters.")}
            onSort={(key, dir) => { setSort({ key, dir }); setOffset(0); }} />
        </div>
        <div className="pager">
          <span className="muted small">{t("{from}–{to} of {total}", { from: fmt(from), to: fmt(to), total: fmt(data.total) })}</span>
          <button type="button" className="btn btn-sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>{t("← Previous")}</button>
          <button type="button" className="btn btn-sm" disabled={to >= data.total} onClick={() => setOffset(offset + PAGE)}>{t("Next →")}</button>
        </div>
      </section>
    </>
  );
}

export default function ReposPage() {
  return <Suspense fallback={<Loading />}><ReposView /></Suspense>;
}
