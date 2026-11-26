"use client";
import Link from "next/link";
import { Fragment, useEffect, useId, useState } from "react";
import { SortTh } from "@/components/DataTable";
import { usePrefs, useStatus, useT, useToast } from "@/components/providers";
import { Avatar, CardHead, ErrorNotice, ExtLink, Loading, PageHead, RunButton, SetupNotice, TimeAgo } from "@/components/ui";
import { api, useApi } from "@/lib/client";
import { ago, fmt, ghUrl, qs } from "@/lib/format";
import { msg } from "@/lib/i18n";

const SHORT = [
  [/\s*\(.*\)$/, ""], [/^Website on /, ""], ["Japanese text in profile", msg("Japanese text")], ["Verified domain on GitHub", msg("verified")],
  ["Company wording", msg("company")], [/Web languages in (\d+)% of recent repos/, msg("web $1%")], ["Pushed in the last 12 months", msg("active")],
  [/^(\d+) public repositories$/, msg("$1 repos")], ["Looks like a community / school / personal account", msg("community?")],
  ["Location in Japan", msg("Japan")], ["Academic, government or GitHub Pages website", msg("non-company site")],
  ["No pushes for over 3 years", msg("inactive")], ["Has website", msg("website")],
];
/** Short chip text for a server signal label; `t` translates the short forms ("$1" is filled by replace). */
const shortSignal = (label, t) => SHORT.reduce((s, [from, to]) => s.replace(from, to ? t(to) : to), label);

// Sorting happens on the server (lib/queries.js listCandidates), so the 500-row cap applies after sorting.
const COLUMNS = [
  { key: "score", label: msg("Score"), firstDir: "desc", by: msg("score"), title: msg("Sort by heuristic score (0–100)") },
  { key: "name", label: msg("Organization"), by: msg("name"), title: msg("Sort by name (login when there is no name)") },
  { key: "repos", label: msg("Repos"), num: true, by: msg("public repositories"), title: msg("Sort by number of public repositories") },
  { key: "language", label: msg("Languages"), by: msg("top language"), title: msg("Sort by the most used language") },
  { key: "signals", label: msg("Signals"), firstDir: "desc", by: msg("positive signals"), title: msg("Sort by number of positive signals") },
  { key: "lastPush", label: msg("Last push"), firstDir: "desc", by: msg("last push"), title: msg("Sort by most recent push") },
];
const ACTIVE_MONTHS = 6;

function ApproveForm({ candidate, segmentsId, onDone, onCancel }) {
  const toast = useToast();
  const { t } = useT();
  const { running, onJobStarted } = useStatus();
  const [name, setName] = useState(candidate.name || candidate.login);
  const [nameJa, setNameJa] = useState("");
  const [segment, setSegment] = useState("");
  const [collect, setCollect] = useState(!running);
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api(`/api/candidates/${encodeURIComponent(candidate.login)}`, { body: { action: "approve", name, nameJa, segment, collect } });
      if (res.job) onJobStarted(res.job);
      toast(res.job ? t("{name} added — collecting now", { name }) : t("{name} added", { name }));
      onDone(res);
    } catch (err) {
      toast(err.message, true);
      setBusy(false);
    }
  }
  return (
    <form className="inline-form" onSubmit={submit}>
      <div className="form-grid">
        <label className="field"><span>{t("Company name")}</span><input type="text" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></label>
        <label className="field"><span>{t("Japanese name")}</span><input type="text" placeholder="株式会社…" value={nameJa} onChange={(e) => setNameJa(e.target.value)} /></label>
        <label className="field"><span>{t("Segment")}</span><input type="text" list={segmentsId} placeholder={t("e.g. Web services")} value={segment} onChange={(e) => setSegment(e.target.value)} /></label>
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <label className="check"><input type="checkbox" checked={collect} onChange={(e) => setCollect(e.target.checked)} />{t("Collect its repositories now")}</label>
        <span className="spacer" />
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>{t("Cancel")}</button>
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>{t("Add to tracking")}</button>
      </div>
    </form>
  );
}

export default function DiscoveryPage() {
  const toast = useToast();
  const { t } = useT();
  const segmentsId = useId();
  const { status, jobVersion, startJob, canEdit, refresh } = useStatus();
  const { prefs, setPrefs, loaded } = usePrefs();
  const activeOnly = prefs.discoveryActiveOnly !== false;
  const [tab, setTab] = useState("pending");
  const [minScore, setMinScore] = useState(40);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState({ key: "score", dir: "desc" });
  const [openLogin, setOpenLogin] = useState(null);
  const [minRepos, setMinRepos] = useState(3);
  const [locations, setLocations] = useState("");

  useEffect(() => {   // debounce the filter box; filtering runs on the server over all candidates
    const timer = setTimeout(() => setQuery(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const { data, error, loading, setData } = useApi(loaded ? `/api/candidates?${qs({ status: tab, minScore, q: query,
    sort: sort.key, dir: sort.dir, activeMonths: activeOnly ? ACTIVE_MONTHS : 0 })}` : null, [jobVersion]);

  const head = <PageHead title={t("Discovery")} lede={t("Find Japanese web-development companies on GitHub that are not tracked yet.")} />;
  if (!data || !status) return <>{head}<ErrorNotice error={error} />{error ? null : <Loading />}</>;

  const rows = data.rows;
  function removeRow(login, counts) {
    setData((d) => ({ ...d, rows: d.rows.filter((x) => x.login !== login), total: Math.max(0, d.total - 1), counts: counts || d.counts }));
    refresh();
  }
  async function act(candidate, action) {
    try {
      const res = await api(`/api/candidates/${encodeURIComponent(candidate.login)}`, { body: { action } });
      if (action === "reset") toast(t("{login} moved back to review", { login: candidate.login }));
      removeRow(candidate.login, res.counts);
    } catch (err) { toast(err.message, true); }
  }

  const counts = data.counts;
  const sortedBy = t(COLUMNS.find((c) => c.key === sort.key)?.by || "score");
  const shown = (data.total > rows.length
    ? t("{n} shown of {total} · first {n} by {by}", { n: fmt(rows.length), total: fmt(data.total), by: sortedBy })
    : t("{n} shown", { n: fmt(rows.length) }))
    + (data.hiddenInactive ? ` · ${t("{n} hidden (no push in {months} months)", { n: fmt(data.hiddenInactive), months: ACTIVE_MONTHS })}` : "");
  const ld = status.lastDiscover;
  const tabs = [["pending", t("To review")], ["approved", t("Approved")], ["rejected", t("Rejected")]];

  return (
    <>
      {head}
      <SetupNotice />
      <section className="card" style={{ marginBottom: 16 }}>
        <CardHead title={t("Find more companies")} sub={ld ? t("last run {when} · {detail}", { when: ago(ld.finishedAt || ld.startedAt), detail: t(ld.detail || ld.status) }) : t("never run")} />
        <p className="muted" style={{ marginBottom: 10 }}>
          {t("Searches GitHub for organizations whose profile location is in Japan, reads their profiles, and scores each one: Japanese text, .jp website, verified domain, company wording (株式会社 / Inc.), web languages, recent activity. Community, school and personal accounts are scored down. Approve the real web-development companies to start tracking them.")}
        </p>
        <details>
          <summary>{t("Search options")}</summary>
          <div className="form-grid" style={{ marginTop: 10 }}>
            <label className="field"><span>{t("Minimum public repositories")}</span>
              <input type="number" min="1" max="100" value={minRepos} onChange={(e) => setMinRepos(e.target.value)} style={{ width: 90 }} /></label>
            <label className="field" style={{ gridColumn: "1 / -1" }}><span>{t("Locations (comma or line separated)")}</span>
              <textarea rows={2} value={locations} onChange={(e) => setLocations(e.target.value)}
                placeholder={t("Leave empty for the defaults: Japan, 日本, Tokyo, 東京, Osaka, 大阪, Kyoto, Fukuoka, Nagoya, Yokohama, Sapporo, Kobe, Sendai, Shibuya …")} /></label>
          </div>
        </details>
        <div className="row" style={{ marginTop: 12 }}>
          <RunButton onClick={() => startJob("discover", { minRepos: Number(minRepos) || 3, locations })}>{t("Run discovery")}</RunButton>
          <span className="muted small">{t("Uses the GitHub search API (30 requests/min); a full run takes several minutes.")}</span>
        </div>
      </section>

      <div className="filters">
        <div className="seg" role="group" aria-label={t("Candidate status")}>
          {tabs.map(([k, label]) => (
            <button key={k} type="button" aria-pressed={tab === k} onClick={() => setTab(k)}>{label} ({fmt(counts[k] || 0)})</button>
          ))}
        </div>
        <select aria-label={t("Minimum score")} value={minScore} onChange={(e) => setMinScore(Number(e.target.value))}>
          {[0, 20, 40, 60, 80].map((v) => <option key={v} value={v}>{v ? t("Score ≥ {n}", { n: v }) : t("Any score")}</option>)}
        </select>
        <input type="search" placeholder={t("Filter by name, login, location")} aria-label={t("Filter candidates")} value={search} onChange={(e) => setSearch(e.target.value)} />
        <label className="check" title={t("Hide organizations whose last push was {n} or more months ago (or that never pushed)", { n: ACTIVE_MONTHS })}>
          <input type="checkbox" checked={activeOnly} onChange={(e) => setPrefs({ discoveryActiveOnly: e.target.checked })} />
          {t("Pushed in the last {n} months", { n: ACTIVE_MONTHS })}
        </label>
      </div>
      <datalist id={segmentsId}>{data.segments.map((s) => <option key={s} value={s} />)}</datalist>

      <section className="card">
        <CardHead title={t("Candidates")} sub={shown} />
        <div className={`table-wrap${loading ? " refreshing" : ""}`}>
          <table>
            <thead>
              <tr>
                {COLUMNS.map((c) => (
                  <SortTh key={c.key} sortKey={c.key} label={t(c.label)} title={t(c.title)} num={!!c.num} firstDir={c.firstDir}
                    sort={sort} onSort={setSort} />
                ))}
                <th scope="col"><span className="sr-only">{t("Actions")}</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={7} className="empty">
                  {data.hiddenInactive ? t("No candidates pushed in the last {months} months. Untick “Pushed in the last {months} months” to see {n} inactive ones.", { months: ACTIVE_MONTHS, n: fmt(data.hiddenInactive) })
                    : counts[tab] ? t("No candidates match these filters.") : tab === "pending" ? t("Nothing to review. Run discovery to find organizations.") : t("None yet.")}
                </td></tr>
              ) : rows.map((r) => (
                <Fragment key={r.login}>
                  <tr>
                    <td>
                      <div className="score" title={t("Heuristic score (0–100)")}>
                        <strong className="num" style={{ minWidth: 24 }}>{r.score}</strong>
                        <div className="score-bar" aria-hidden="true"><div className="score-fill" style={{ width: `${r.score}%` }} /></div>
                      </div>
                    </td>
                    <td>
                      <div className="org-cell">
                        <Avatar src={r.avatarUrl} />
                        <div>
                          <div className="cell-title">{r.name || r.login} <span className="faint small">· </span><ExtLink href={ghUrl(r.login)}>{r.login}</ExtLink></div>
                          {r.description ? <div className="cell-desc" title={r.description}>{r.description}</div> : null}
                          <div className="cell-sub">{r.location}{r.location && r.websiteUrl ? " · " : null}{r.websiteUrl ? <ExtLink href={r.websiteUrl} /> : null}</div>
                        </div>
                      </div>
                    </td>
                    <td className="num">{fmt(r.repoTotal)}</td>
                    <td>{r.topLanguages.map(([lang, n]) => <span key={lang} className="chip" title={t("{n} of the 20 most recent repos", { n })}>{lang}</span>)}</td>
                    <td>{r.signals.map((s) => (
                      <span key={s.label} className={`chip ${s.points >= 0 ? "chip-plus" : "chip-minus"}`} title={t(s.label)}>
                        {s.points > 0 ? "+" : ""}{s.points} {shortSignal(s.label, t)}
                      </span>))}</td>
                    <td className="nowrap"><TimeAgo iso={r.lastPush} /></td>
                    <td className="nowrap">
                      {r.status === "approved" ? (r.companyId ? <Link href={`/companies/${r.companyId}`}>{t("Open company")}</Link> : t("Approved"))
                        : r.status === "rejected" ? <button type="button" className="btn btn-sm" disabled={!canEdit} onClick={() => act(r, "reset")}>{t("Undo")}</button>
                          : (
                            <div className="row" style={{ flexWrap: "nowrap" }}>
                              <button type="button" className="btn btn-sm btn-primary" disabled={!canEdit}
                                onClick={() => setOpenLogin(openLogin === r.login ? null : r.login)}>{t("Approve")}</button>
                              <button type="button" className="btn btn-sm" disabled={!canEdit} onClick={() => act(r, "reject")}>{t("Reject")}</button>
                            </div>
                          )}
                    </td>
                  </tr>
                  {openLogin === r.login ? (
                    <tr className="form-row"><td colSpan={7}>
                      <ApproveForm candidate={r} segmentsId={segmentsId} onCancel={() => setOpenLogin(null)}
                        onDone={(res) => { setOpenLogin(null); removeRow(r.login, res.counts); }} />
                    </td></tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
