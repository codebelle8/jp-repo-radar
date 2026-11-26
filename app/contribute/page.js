"use client";
// Contribute: open issues you could work on, and which repositories / companies welcome outside contributions.
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { DataTable } from "@/components/DataTable";
import { useStatus, useT, useToast } from "@/components/providers";
import { SkillMatch, useSkills } from "@/components/skills";
import { CardHead, Dash, ErrorNotice, ExtLink, Loading, PageHead, RunButton, SetupNotice, TimeAgo } from "@/components/ui";
import { api, useApi } from "@/lib/client";
import { fmt, qs } from "@/lib/format";
import { msg, translate } from "@/lib/i18n";

const PAGE = 50;
const WELCOMING = 40;
const VIEWS = [["issues", msg("Issues")], ["repos", msg("Repositories")], ["companies", msg("Companies")]];

function Score({ value }) {
  const { t } = useT();
  return (
    <div className="score" title={t("Welcomes-contributions score (0–100)")}>
      <strong className="num" style={{ minWidth: 24 }}>{value}</strong>
      <div className="score-bar" aria-hidden="true"><div className="score-fill" style={{ width: `${value}%` }} /></div>
    </div>
  );
}

const pct = (x) => (x == null ? <Dash /> : `${Math.round(x * 100)}%`);
const hours = (h) => (h == null ? <Dash /> : h < 24 ? translate("{n} h", { n: Math.max(1, Math.round(h)) }) : translate("{n} d", { n: Math.round(h / 24) }));
const days = (d) => (d == null ? <Dash /> : d < 1 ? translate("< 1 d") : translate("{n} d", { n: Math.round(d) }));
const BEGINNER = /good[\s_-]*first|first[\s_-]*timers?|help[\s_-]*wanted|beginner|starter|easy|初心者|初学者|簡単|やさしい|入門/i;

function Check({ checked, onChange, children, title }) {
  return (
    <label className="check" title={title}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />{children}
    </label>
  );
}

// ---------------------------------------------------------------- issues

const normUrl = (u) => String(u || "").trim().toLowerCase().replace(/[#?].*$/, "").replace(/\/+$/, "");

/** "Track" button for signed-in users: adds the issue to the private Tracker. */
function useTracked(canEdit) {
  const toast = useToast();
  const { t } = useT();
  const { data } = useApi(canEdit ? "/api/tracker" : null, []);
  const [added, setAdded] = useState(() => new Set());
  const tracked = useMemo(() => new Set([...(data?.items || []).map((i) => normUrl(i.url)), ...added]), [data, added]);
  async function track(issue) {
    try {
      await api("/api/tracker", { body: { url: issue.url, title: issue.title } });
      setAdded((s) => new Set([...s, normUrl(issue.url)]));
      toast(t("Tracking it: see the Tracker page"));
    } catch (err) { toast(t(err.message), true); }
  }
  return { tracked, track };
}

function IssuesView({ initialCompany, initialMine, jobVersion, skills }) {
  const { t } = useT();
  const { canEdit } = useStatus();
  const { tracked, track } = useTracked(canEdit);
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [companyId, setCompanyId] = useState(initialCompany || "");
  const [language, setLanguage] = useState("");
  const [issueLang, setIssueLang] = useState("");
  const [minWelcome, setMinWelcome] = useState(0);
  const [beginner, setBeginner] = useState(false);
  const [unassigned, setUnassigned] = useState(true);
  const [noPr, setNoPr] = useState(true);
  const [recent, setRecent] = useState(true);
  const [mine, setMine] = useState(!!initialMine);
  const [sort, setSort] = useState({ key: "welcome", dir: "desc" });   // most welcoming repositories first
  const [offset, setOffset] = useState(0);

  useEffect(() => {   // debounce the search box
    const timer = setTimeout(() => { setQuery(q.trim()); setOffset(0); }, 250);
    return () => clearTimeout(timer);
  }, [q]);
  const reset = (fn) => (v) => { fn(v); setOffset(0); };

  const myLanguages = skills.data?.languages.length ? skills.data.filterLanguages : null;
  const waitForSkills = mine && canEdit && !skills.data && !skills.error;
  const url = waitForSkills ? null : `/api/contribute/issues?${qs({ q: query, companyId, language, issueLang, minWelcome, beginner: beginner ? 1 : 0,
    languages: mine && myLanguages ? myLanguages.join(",") : "",
    unassigned: unassigned ? 1 : 0, noPr: noPr ? 1 : 0, activeMonths: recent ? 6 : 0, sort: sort.key, dir: sort.dir, limit: PAGE, offset })}`;
  const { data, error, loading } = useApi(url, [jobVersion]);
  if (!data) return <><ErrorNotice error={error} />{error ? null : <Loading />}</>;

  const columns = [
    {
      key: "title", label: t("Issue"),
      render: (i) => (
        <div style={{ minWidth: 260 }}>
          <div className="cell-title"><ExtLink href={i.url}>{i.title}</ExtLink></div>
          <div className="cell-sub">{i.fullName} #{i.number}{i.ja ? " · 日本語" : ""}{i.byOutsider ? ` · ${t("opened by an outside user")}` : ""}</div>
          {i.labels.length ? (
            <div style={{ marginTop: 4 }}>
              {i.labels.map((l) => <span key={l} className={`chip${BEGINNER.test(l) ? " chip-plus" : ""}`}>{l}</span>)}
            </div>
          ) : null}
        </div>
      ),
    },
    { key: "company", label: t("Company"), render: (i) => <Link href={`/companies/${i.companyId}`}>{i.company}</Link> },
    { key: "language", label: t("Language"), render: (i) => i.language || <Dash /> },
    { key: "welcome", label: t("Repo welcome"), firstDir: "desc", title: t("How welcoming the repository is to outside contributors (0–100)"),
      render: (i) => <Score value={i.welcome} /> },
    { key: "comments", label: t("Comments"), num: true },
    { key: "updatedAt", label: t("Updated"), className: "nowrap", firstDir: "desc", render: (i) => <TimeAgo iso={i.updatedAt} /> },
    { key: "createdAt", label: t("Opened"), className: "nowrap", firstDir: "desc", render: (i) => <TimeAgo iso={i.createdAt} /> },
    ...(canEdit ? [{
      key: "track", label: "", sortable: false,
      render: (i) => (tracked.has(normUrl(i.url))
        ? <Link href="/tracker" className="small">{t("Tracked")}</Link>
        : <button type="button" className="btn btn-sm" onClick={() => track(i)}>{t("Track")}</button>),
    }] : []),
  ];
  const from = data.total ? offset + 1 : 0;
  const to = Math.min(data.total, offset + PAGE);
  return (
    <>
      <div className="filters">
        <input type="search" placeholder={t("Search title, repository, label")} aria-label={t("Search issues")} value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label={t("Company")} value={companyId} onChange={(e) => reset(setCompanyId)(e.target.value)}>
          <option value="">{t("All companies")}</option>
          {data.companies.map((c) => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
        </select>
        <select aria-label={t("Repository language")} value={language} onChange={(e) => reset(setLanguage)(e.target.value)}>
          <option value="">{t("All languages")}</option>
          {data.languages.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <select aria-label={t("Issue language")} value={issueLang} onChange={(e) => reset(setIssueLang)(e.target.value)}>
          <option value="">{t("Japanese or English")}</option>
          <option value="ja">{t("Written in Japanese")}</option>
          <option value="en">{t("Not in Japanese")}</option>
        </select>
        <select aria-label={t("Minimum repository welcome score")} value={minWelcome} onChange={(e) => reset(setMinWelcome)(Number(e.target.value))}>
          {[0, 20, 40, 60].map((v) => <option key={v} value={v}>{v ? t("Repo welcome ≥ {n}", { n: v }) : t("Any repo score")}</option>)}
        </select>
      </div>
      <div className="filters">
        <Check checked={beginner} onChange={reset(setBeginner)} title={t("Labels like good first issue, help wanted, beginner, 初心者")}>{t("Beginner labels only")}</Check>
        <Check checked={unassigned} onChange={reset(setUnassigned)}>{t("Unassigned")}</Check>
        <Check checked={noPr} onChange={reset(setNoPr)} title={t("Hide issues that already have an open pull request that will close them")}>{t("No linked pull request")}</Check>
        <Check checked={recent} onChange={reset(setRecent)}>{t("Updated in the last 6 months")}</Check>
        {myLanguages ? (
          <Check checked={mine} onChange={reset(setMine)}
            title={t("Repositories written in {langs} (your languages and related ones; edit them on the Tracker page)", { langs: myLanguages.join(", ") })}>
            {t("In my languages")}
          </Check>
        ) : null}
      </div>
      <section className="card">
        <CardHead title={t("Open issues")} sub={t("{n} match · {all} open issues checked", { n: fmt(data.total), all: fmt(data.all) })} />
        <div className={loading ? "refreshing" : undefined}>
          <DataTable columns={columns} rows={data.rows} initialSort={sort} rowKey={(i) => i.url}
            onSort={(key, dir) => { setSort({ key, dir }); setOffset(0); }}
            empty={data.all ? t("No issues match these filters. Try unticking a filter above.") : t("No open issues found yet.")} />
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

// ---------------------------------------------------------------- repositories

function SignalChips({ signals }) {
  const { t } = useT();
  return signals.map((s) => (
    <span key={s.label} className={`chip ${s.points >= 0 ? "chip-plus" : "chip-minus"}`} title={t(s.label)}>
      {s.points > 0 ? "+" : ""}{s.points} {t(s.short || s.label)}
    </span>
  ));
}

function ReposView({ data }) {
  const { t } = useT();
  const [q, setQ] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [minScore, setMinScore] = useState(0);
  const companies = useMemo(() => [...new Map(data.repos.map((r) => [r.companyId, r.company])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1], "ja")), [data]);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return data.repos.filter((r) => r.score >= minScore && (!companyId || r.companyId === Number(companyId))
      && (!needle || [r.fullName, r.company, r.description, r.language].some((v) => v && v.toLowerCase().includes(needle))));
  }, [data, q, companyId, minScore]);

  const columns = [
    {
      key: "name", label: t("Repository"), sortValue: (r) => r.fullName.toLowerCase(),
      render: (r) => (
        <div style={{ minWidth: 200 }}>
          <div className="cell-title"><ExtLink href={r.url}>{r.fullName}</ExtLink></div>
          <div className="cell-sub"><Link href={`/companies/${r.companyId}`}>{r.company}</Link>{r.language ? ` · ${r.language}` : ""}</div>
        </div>
      ),
    },
    { key: "score", label: t("Welcome"), firstDir: "desc", render: (r) => <Score value={r.score} /> },
    { key: "outsideMerged", label: t("Outside PRs"), num: true, title: t("Pull requests from outside contributors merged in the last 12 months (bots excluded)") },
    { key: "outsideAuthors", label: t("Outside people"), num: true, title: t("Different outside contributors among those pull requests") },
    { key: "replyRate", label: t("Replies"), num: true, title: t("Share of issues opened by outside users (last 12 months) that got a reply"), render: (r) => pct(r.replyRate) },
    { key: "medianReplyHours", label: t("First reply"), num: true, firstDir: "asc", title: t("Median time to the first reply on outside issues"), render: (r) => hours(r.medianReplyHours) },
    { key: "medianMergeDays", label: t("Time to merge"), num: true, firstDir: "asc", title: t("Median time from opening to merge for outside pull requests"), render: (r) => days(r.medianMergeDays) },
    { key: "beginnerIssues", label: t("Beginner issues"), num: true, title: t("Open, unassigned issues with a beginner label and no linked pull request") },
    { key: "openIssues", label: t("Open issues"), num: true },
    { key: "signals", label: t("Why"), sortable: false, render: (r) => <div style={{ minWidth: 200, maxWidth: 320 }}><SignalChips signals={r.signals} /></div> },
  ];
  return (
    <>
      <div className="filters">
        <input type="search" placeholder={t("Search repository, company, language")} aria-label={t("Search repositories")} value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label={t("Company")} value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
          <option value="">{t("All companies")}</option>
          {companies.map(([id, name]) => <option key={id} value={String(id)}>{name}</option>)}
        </select>
        <select aria-label={t("Minimum welcome score")} value={minScore} onChange={(e) => setMinScore(Number(e.target.value))}>
          {[0, 20, 40, 60].map((v) => <option key={v} value={v}>{v ? t("Welcome ≥ {n}", { n: v }) : t("Any score")}</option>)}
        </select>
      </div>
      <section className="card">
        <CardHead title={t("Repositories")} sub={t("{n} of {total} active repositories", { n: fmt(rows.length), total: fmt(data.repos.length) })} />
        <DataTable columns={columns} rows={rows} initialSort={{ key: "score", dir: "desc" }} rowKey={(r) => r.fullName}
          empty={t("No repositories match these filters.")} />
      </section>
    </>
  );
}

// ---------------------------------------------------------------- companies

function CompaniesView({ data, matches }) {
  const { t } = useT();
  const columns = [
    {
      key: "name", label: t("Company"),
      render: (c) => (
        <div>
          <div className="cell-title"><Link href={`/companies/${c.id}`}>{c.name}</Link></div>
          {c.bestRepo ? <div className="cell-sub">{t("best: {repo}", { repo: c.bestRepo })}</div> : null}
        </div>
      ),
    },
    { key: "bestScore", label: t("Best repo"), firstDir: "desc", title: t("Welcome score of the company's most welcoming repository"), render: (c) => <Score value={c.bestScore} /> },
    ...(matches ? [{ key: "match", label: t("Skill match"), firstDir: "desc", title: t("Share of the company's active repositories written in your languages"),
      sortValue: (c) => matches[c.id]?.score ?? null, render: (c) => <SkillMatch m={matches[c.id]} /> }] : []),
    { key: "welcomingRepos", label: t("Welcoming repos"), num: true, title: t("Repositories scoring {n} or more", { n: WELCOMING }) },
    { key: "outsideMerged", label: t("Outside PRs"), num: true, title: t("Outside pull requests merged in the last 12 months, all repositories") },
    {
      key: "openIssues", label: t("Issues to pick"), num: true, title: t("Open issues with no assignee and no linked pull request"),
      render: (c) => (c.openIssues ? <Link href={`/contribute?${qs({ view: "issues", company: c.id })}`}>{fmt(c.openIssues)}</Link> : "0"),
    },
    { key: "beginnerIssues", label: t("Beginner issues"), num: true },
    { key: "checkedRepos", label: t("Active repos"), num: true, title: t("Repositories pushed in the last 12 months (checked)") },
  ];
  return (
    <section className="card">
      <CardHead title={t("Companies")} sub={t("{n} companies with active public repositories", { n: fmt(data.companies.length) })} />
      <DataTable columns={columns} rows={data.companies} initialSort={{ key: "bestScore", dir: "desc" }} rowKey={(c) => c.id}
        empty={t("No companies yet.")} />
    </section>
  );
}

// ---------------------------------------------------------------- page

function ContributeView() {
  const { t, rich } = useT();
  const params = useSearchParams();
  const { status, jobVersion, startJob, canEdit } = useStatus();
  const [view, setView] = useState(params.get("view") || "issues");
  const company = params.get("company") || "";
  const mine = params.get("mine") === "1";
  const skills = useSkills(canEdit, [jobVersion]);
  useEffect(() => { setView(params.get("view") || "issues"); }, [params]);
  const repos = useApi("/api/contribute/repos", [jobVersion]);

  const head = (
    <PageHead title={t("Contribute")} lede={t("Open issues in Japanese companies' public repositories, and which repositories actually merge outside contributions.")} />
  );
  if (!repos.data || !status) return <>{head}<ErrorNotice error={repos.error} />{repos.error ? null : <Loading />}</>;
  const d = repos.data;
  const when = d.checkedAt ? <TimeAgo iso={d.checkedAt} /> : null;

  return (
    <>
      {head}
      <SetupNotice />
      {!d.checkedAt ? (
        <section className="card" style={{ marginBottom: 16 }}>
          <CardHead title={t("No contribution data yet")} />
          <p className="muted" style={{ marginBottom: 10 }}>
            {t("“Collect data” now also checks every active repository (pushed in the last 12 months) for open issues and outside contributions. Run it once; this step adds a few minutes.")}
          </p>
          <RunButton onClick={() => startJob("collect")}>{t("Collect data")}</RunButton>
        </section>
      ) : null}
      <details className="card" style={{ marginBottom: 16 }}>
        <summary>{t("How the welcome score works")}</summary>
        <div className="muted" style={{ marginTop: 8 }}>
          <p>{t("Each active repository gets 0–100 points from what it did in the last 12 months:")}</p>
          <ul style={{ margin: "6px 0 8px 18px" }}>
            <li>{t("outside pull requests merged: 1+ = 15, 3+ = 25, 10+ = 35 (−10 if only the team's own pull requests were merged)")}</li>
            <li>{t("different outside contributors: 2+ = 8, 5+ = 15")}</li>
            <li>{t("replies to issues opened by outside users: 40%+ = 8, 70%+ = 15 (under 40% = −5); first reply within 3 days = 5")}</li>
            <li>{t("CONTRIBUTING guide = 10, license = 5, open beginner-labelled issue = 10, pushed in the last 3 months = 5")}</li>
          </ul>
          <p>
            {t("“Outside” means not an owner, member or collaborator of the organization; bots are excluded. GitHub shows employees whose organization membership is private as outside contributors, so outside counts can include some staff.")}{" "}
            {status.onVercel
              ? (when ? rich("Data refreshes with every collection (daily at 03:00 JST); last checked {when}.", { when }) : t("Data refreshes with every collection (daily at 03:00 JST)."))
              : (when ? rich("Data refreshes with every collection; last checked {when}.", { when }) : t("Data refreshes with every collection."))}
          </p>
        </div>
      </details>
      <div className="filters">
        <div className="seg" role="group" aria-label={t("View")}>
          {VIEWS.map(([k, label]) => (
            <button key={k} type="button" aria-pressed={view === k} onClick={() => setView(k)}>
              {t(label)}{k === "repos" ? ` (${fmt(d.repos.length)})` : k === "companies" ? ` (${fmt(d.companies.length)})` : ""}
            </button>
          ))}
        </div>
      </div>
      {view === "repos" ? <ReposView data={d} />
        : view === "companies" ? <CompaniesView data={d} matches={skills.data?.languages.length ? skills.data.matches : null} />
          : <IssuesView key={`${company}:${mine}`} initialCompany={company} initialMine={mine} jobVersion={jobVersion} skills={skills} />}
    </>
  );
}

export default function ContributePage() {
  return <Suspense fallback={<Loading />}><ContributeView /></Suspense>;
}
