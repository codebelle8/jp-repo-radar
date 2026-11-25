"use client";
// Contribute: open issues you could work on, and which repositories / companies welcome outside contributions.
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { DataTable } from "@/components/DataTable";
import { useStatus, useToast } from "@/components/providers";
import { SkillMatch, useSkills } from "@/components/skills";
import { CardHead, Dash, ErrorNotice, ExtLink, Loading, PageHead, RunButton, SetupNotice, TimeAgo } from "@/components/ui";
import { api, useApi } from "@/lib/client";
import { fmt, qs } from "@/lib/format";

const PAGE = 50;
const WELCOMING = 40;
const VIEWS = [["issues", "Issues"], ["repos", "Repositories"], ["companies", "Companies"]];

function Score({ value }) {
  return (
    <div className="score" title="Welcomes-contributions score (0–100)">
      <strong className="num" style={{ minWidth: 24 }}>{value}</strong>
      <div className="score-bar" aria-hidden="true"><div className="score-fill" style={{ width: `${value}%` }} /></div>
    </div>
  );
}

const pct = (x) => (x == null ? <Dash /> : `${Math.round(x * 100)}%`);
const hours = (h) => (h == null ? <Dash /> : h < 24 ? `${Math.max(1, Math.round(h))} h` : `${Math.round(h / 24)} d`);
const days = (d) => (d == null ? <Dash /> : d < 1 ? "< 1 d" : `${Math.round(d)} d`);
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
  const { data } = useApi(canEdit ? "/api/tracker" : null, []);
  const [added, setAdded] = useState(() => new Set());
  const tracked = useMemo(() => new Set([...(data?.items || []).map((i) => normUrl(i.url)), ...added]), [data, added]);
  async function track(issue) {
    try {
      await api("/api/tracker", { body: { url: issue.url, title: issue.title } });
      setAdded((s) => new Set([...s, normUrl(issue.url)]));
      toast("Tracking it: see the Tracker page");
    } catch (err) { toast(err.message, true); }
  }
  return { tracked, track };
}

function IssuesView({ initialCompany, initialMine, jobVersion, skills }) {
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
    const t = setTimeout(() => { setQuery(q.trim()); setOffset(0); }, 250);
    return () => clearTimeout(t);
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
      key: "title", label: "Issue",
      render: (i) => (
        <div style={{ minWidth: 260 }}>
          <div className="cell-title"><ExtLink href={i.url}>{i.title}</ExtLink></div>
          <div className="cell-sub">{i.fullName} #{i.number}{i.ja ? " · 日本語" : ""}{i.byOutsider ? " · opened by an outside user" : ""}</div>
          {i.labels.length ? (
            <div style={{ marginTop: 4 }}>
              {i.labels.map((l) => <span key={l} className={`chip${BEGINNER.test(l) ? " chip-plus" : ""}`}>{l}</span>)}
            </div>
          ) : null}
        </div>
      ),
    },
    { key: "company", label: "Company", render: (i) => <Link href={`/companies/${i.companyId}`}>{i.company}</Link> },
    { key: "language", label: "Language", render: (i) => i.language || <Dash /> },
    { key: "welcome", label: "Repo welcome", firstDir: "desc", title: "How welcoming the repository is to outside contributors (0–100)",
      render: (i) => <Score value={i.welcome} /> },
    { key: "comments", label: "Comments", num: true },
    { key: "updatedAt", label: "Updated", className: "nowrap", firstDir: "desc", render: (i) => <TimeAgo iso={i.updatedAt} /> },
    { key: "createdAt", label: "Opened", className: "nowrap", firstDir: "desc", render: (i) => <TimeAgo iso={i.createdAt} /> },
    ...(canEdit ? [{
      key: "track", label: "", sortable: false,
      render: (i) => (tracked.has(normUrl(i.url))
        ? <Link href="/tracker" className="small">Tracked</Link>
        : <button type="button" className="btn btn-sm" onClick={() => track(i)}>Track</button>),
    }] : []),
  ];
  const from = data.total ? offset + 1 : 0;
  const to = Math.min(data.total, offset + PAGE);
  return (
    <>
      <div className="filters">
        <input type="search" placeholder="Search title, repository, label" aria-label="Search issues" value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label="Company" value={companyId} onChange={(e) => reset(setCompanyId)(e.target.value)}>
          <option value="">All companies</option>
          {data.companies.map((c) => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
        </select>
        <select aria-label="Repository language" value={language} onChange={(e) => reset(setLanguage)(e.target.value)}>
          <option value="">All languages</option>
          {data.languages.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <select aria-label="Issue language" value={issueLang} onChange={(e) => reset(setIssueLang)(e.target.value)}>
          <option value="">Japanese or English</option>
          <option value="ja">Written in Japanese</option>
          <option value="en">Not in Japanese</option>
        </select>
        <select aria-label="Minimum repository welcome score" value={minWelcome} onChange={(e) => reset(setMinWelcome)(Number(e.target.value))}>
          {[0, 20, 40, 60].map((v) => <option key={v} value={v}>{v ? `Repo welcome ≥ ${v}` : "Any repo score"}</option>)}
        </select>
      </div>
      <div className="filters">
        <Check checked={beginner} onChange={reset(setBeginner)} title="Labels like good first issue, help wanted, beginner, 初心者">Beginner labels only</Check>
        <Check checked={unassigned} onChange={reset(setUnassigned)}>Unassigned</Check>
        <Check checked={noPr} onChange={reset(setNoPr)} title="Hide issues that already have an open pull request that will close them">No linked pull request</Check>
        <Check checked={recent} onChange={reset(setRecent)}>Updated in the last 6 months</Check>
        {myLanguages ? (
          <Check checked={mine} onChange={reset(setMine)} title={`Repositories written in ${myLanguages.join(", ")} (your languages and related ones; edit them on the Tracker page)`}>
            In my languages
          </Check>
        ) : null}
      </div>
      <section className="card">
        <CardHead title="Open issues" sub={`${fmt(data.total)} match · ${fmt(data.all)} open issues checked`} />
        <div className={loading ? "refreshing" : undefined}>
          <DataTable columns={columns} rows={data.rows} initialSort={sort} rowKey={(i) => i.url}
            onSort={(key, dir) => { setSort({ key, dir }); setOffset(0); }}
            empty={data.all ? "No issues match these filters. Try unticking a filter above." : "No open issues found yet."} />
        </div>
        <div className="pager">
          <span className="muted small">{fmt(from)}–{fmt(to)} of {fmt(data.total)}</span>
          <button type="button" className="btn btn-sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>← Previous</button>
          <button type="button" className="btn btn-sm" disabled={to >= data.total} onClick={() => setOffset(offset + PAGE)}>Next →</button>
        </div>
      </section>
    </>
  );
}

// ---------------------------------------------------------------- repositories

function SignalChips({ signals }) {
  return signals.map((s) => (
    <span key={s.label} className={`chip ${s.points >= 0 ? "chip-plus" : "chip-minus"}`} title={s.label}>
      {s.points > 0 ? "+" : ""}{s.points} {s.short || s.label}
    </span>
  ));
}

function ReposView({ data }) {
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
      key: "name", label: "Repository", sortValue: (r) => r.fullName.toLowerCase(),
      render: (r) => (
        <div style={{ minWidth: 200 }}>
          <div className="cell-title"><ExtLink href={r.url}>{r.fullName}</ExtLink></div>
          <div className="cell-sub"><Link href={`/companies/${r.companyId}`}>{r.company}</Link>{r.language ? ` · ${r.language}` : ""}</div>
        </div>
      ),
    },
    { key: "score", label: "Welcome", firstDir: "desc", render: (r) => <Score value={r.score} /> },
    { key: "outsideMerged", label: "Outside PRs", num: true, title: "Pull requests from outside contributors merged in the last 12 months (bots excluded)" },
    { key: "outsideAuthors", label: "Outside people", num: true, title: "Different outside contributors among those pull requests" },
    { key: "replyRate", label: "Replies", num: true, title: "Share of issues opened by outside users (last 12 months) that got a reply", render: (r) => pct(r.replyRate) },
    { key: "medianReplyHours", label: "First reply", num: true, firstDir: "asc", title: "Median time to the first reply on outside issues", render: (r) => hours(r.medianReplyHours) },
    { key: "medianMergeDays", label: "Time to merge", num: true, firstDir: "asc", title: "Median time from opening to merge for outside pull requests", render: (r) => days(r.medianMergeDays) },
    { key: "beginnerIssues", label: "Beginner issues", num: true, title: "Open, unassigned issues with a beginner label and no linked pull request" },
    { key: "openIssues", label: "Open issues", num: true },
    { key: "signals", label: "Why", sortable: false, render: (r) => <div style={{ minWidth: 200, maxWidth: 320 }}><SignalChips signals={r.signals} /></div> },
  ];
  return (
    <>
      <div className="filters">
        <input type="search" placeholder="Search repository, company, language" aria-label="Search repositories" value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label="Company" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
          <option value="">All companies</option>
          {companies.map(([id, name]) => <option key={id} value={String(id)}>{name}</option>)}
        </select>
        <select aria-label="Minimum welcome score" value={minScore} onChange={(e) => setMinScore(Number(e.target.value))}>
          {[0, 20, 40, 60].map((v) => <option key={v} value={v}>{v ? `Welcome ≥ ${v}` : "Any score"}</option>)}
        </select>
      </div>
      <section className="card">
        <CardHead title="Repositories" sub={`${fmt(rows.length)} of ${fmt(data.repos.length)} active repositories`} />
        <DataTable columns={columns} rows={rows} initialSort={{ key: "score", dir: "desc" }} rowKey={(r) => r.fullName}
          empty="No repositories match these filters." />
      </section>
    </>
  );
}

// ---------------------------------------------------------------- companies

function CompaniesView({ data, matches }) {
  const columns = [
    {
      key: "name", label: "Company",
      render: (c) => (
        <div>
          <div className="cell-title"><Link href={`/companies/${c.id}`}>{c.name}</Link></div>
          {c.bestRepo ? <div className="cell-sub">best: {c.bestRepo}</div> : null}
        </div>
      ),
    },
    { key: "bestScore", label: "Best repo", firstDir: "desc", title: "Welcome score of the company's most welcoming repository", render: (c) => <Score value={c.bestScore} /> },
    ...(matches ? [{ key: "match", label: "Skill match", firstDir: "desc", title: "Share of the company's active repositories written in your languages",
      sortValue: (c) => matches[c.id]?.score ?? null, render: (c) => <SkillMatch m={matches[c.id]} /> }] : []),
    { key: "welcomingRepos", label: "Welcoming repos", num: true, title: `Repositories scoring ${WELCOMING} or more` },
    { key: "outsideMerged", label: "Outside PRs", num: true, title: "Outside pull requests merged in the last 12 months, all repositories" },
    {
      key: "openIssues", label: "Issues to pick", num: true, title: "Open issues with no assignee and no linked pull request",
      render: (c) => (c.openIssues ? <Link href={`/contribute?${qs({ view: "issues", company: c.id })}`}>{fmt(c.openIssues)}</Link> : "0"),
    },
    { key: "beginnerIssues", label: "Beginner issues", num: true },
    { key: "checkedRepos", label: "Active repos", num: true, title: "Repositories pushed in the last 12 months (checked)" },
  ];
  return (
    <section className="card">
      <CardHead title="Companies" sub={`${fmt(data.companies.length)} companies with active public repositories`} />
      <DataTable columns={columns} rows={data.companies} initialSort={{ key: "bestScore", dir: "desc" }} rowKey={(c) => c.id}
        empty="No companies yet." />
    </section>
  );
}

// ---------------------------------------------------------------- page

function ContributeView() {
  const params = useSearchParams();
  const { status, jobVersion, startJob, canEdit } = useStatus();
  const [view, setView] = useState(params.get("view") || "issues");
  const company = params.get("company") || "";
  const mine = params.get("mine") === "1";
  const skills = useSkills(canEdit, [jobVersion]);
  useEffect(() => { setView(params.get("view") || "issues"); }, [params]);
  const repos = useApi("/api/contribute/repos", [jobVersion]);

  const head = (
    <PageHead title="Contribute" lede="Open issues in Japanese companies' public repositories, and which repositories actually merge outside contributions." />
  );
  if (!repos.data || !status) return <>{head}<ErrorNotice error={repos.error} />{repos.error ? null : <Loading />}</>;
  const d = repos.data;

  return (
    <>
      {head}
      <SetupNotice />
      {!d.checkedAt ? (
        <section className="card" style={{ marginBottom: 16 }}>
          <CardHead title="No contribution data yet" />
          <p className="muted" style={{ marginBottom: 10 }}>
            “Collect data” now also checks every active repository (pushed in the last 12 months) for open issues and outside
            contributions. Run it once; this step adds a few minutes.
          </p>
          <RunButton onClick={() => startJob("collect")}>Collect data</RunButton>
        </section>
      ) : null}
      <details className="card" style={{ marginBottom: 16 }}>
        <summary>How the welcome score works</summary>
        <div className="muted" style={{ marginTop: 8 }}>
          <p>Each active repository gets 0–100 points from what it did in the last 12 months:</p>
          <ul style={{ margin: "6px 0 8px 18px" }}>
            <li>outside pull requests merged: 1+ = 15, 3+ = 25, 10+ = 35 (−10 if only the team&apos;s own pull requests were merged)</li>
            <li>different outside contributors: 2+ = 8, 5+ = 15</li>
            <li>replies to issues opened by outside users: 40%+ = 8, 70%+ = 15 (under 40% = −5); first reply within 3 days = 5</li>
            <li>CONTRIBUTING guide = 10, license = 5, open beginner-labelled issue = 10, pushed in the last 3 months = 5</li>
          </ul>
          <p>
            “Outside” means not an owner, member or collaborator of the organization; bots are excluded. GitHub shows employees whose
            organization membership is private as outside contributors, so outside counts can include some staff. Data refreshes with
            every collection{status.onVercel ? " (daily at 03:00 JST)" : ""}{d.checkedAt ? <>; last checked <TimeAgo iso={d.checkedAt} /></> : null}.
          </p>
        </div>
      </details>
      <div className="filters">
        <div className="seg" role="group" aria-label="View">
          {VIEWS.map(([k, label]) => (
            <button key={k} type="button" aria-pressed={view === k} onClick={() => setView(k)}>
              {label}{k === "repos" ? ` (${fmt(d.repos.length)})` : k === "companies" ? ` (${fmt(d.companies.length)})` : ""}
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
