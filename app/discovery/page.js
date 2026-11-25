"use client";
import Link from "next/link";
import { Fragment, useEffect, useId, useState } from "react";
import { SortTh } from "@/components/DataTable";
import { usePrefs, useStatus, useToast } from "@/components/providers";
import { Avatar, CardHead, ErrorNotice, ExtLink, Loading, PageHead, RunButton, SetupNotice, TimeAgo } from "@/components/ui";
import { api, useApi } from "@/lib/client";
import { ago, fmt, ghUrl, qs } from "@/lib/format";

const SHORT = [
  [/\s*\(.*\)$/, ""], [/^Website on /, ""], ["Japanese text in profile", "Japanese text"], ["Verified domain on GitHub", "verified"],
  ["Company wording", "company"], [/Web languages in (\d+)% of recent repos/, "web $1%"], ["Pushed in the last 12 months", "active"],
  [/^(\d+) public repositories$/, "$1 repos"], ["Looks like a community / school / personal account", "community?"],
  ["Location in Japan", "Japan"], ["Academic, government or GitHub Pages website", "non-company site"],
  ["No pushes for over 3 years", "inactive"], ["Has website", "website"],
];
const shortSignal = (label) => SHORT.reduce((s, [from, to]) => s.replace(from, to), label);

// Sorting happens on the server (lib/queries.js listCandidates), so the 500-row cap applies after sorting.
const COLUMNS = [
  { key: "score", label: "Score", firstDir: "desc", by: "score", title: "Sort by heuristic score (0–100)" },
  { key: "name", label: "Organization", by: "name", title: "Sort by name (login when there is no name)" },
  { key: "repos", label: "Repos", num: true, by: "public repositories", title: "Sort by number of public repositories" },
  { key: "language", label: "Languages", by: "top language", title: "Sort by the most used language" },
  { key: "signals", label: "Signals", firstDir: "desc", by: "positive signals", title: "Sort by number of positive signals" },
  { key: "lastPush", label: "Last push", firstDir: "desc", by: "last push", title: "Sort by most recent push" },
];
const ACTIVE_MONTHS = 6;

function ApproveForm({ candidate, segmentsId, onDone, onCancel }) {
  const toast = useToast();
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
      toast(`${name} added${res.job ? " — collecting now" : ""}`);
      onDone(res);
    } catch (err) {
      toast(err.message, true);
      setBusy(false);
    }
  }
  return (
    <form className="inline-form" onSubmit={submit}>
      <div className="form-grid">
        <label className="field"><span>Company name</span><input type="text" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></label>
        <label className="field"><span>Japanese name</span><input type="text" placeholder="株式会社…" value={nameJa} onChange={(e) => setNameJa(e.target.value)} /></label>
        <label className="field"><span>Segment</span><input type="text" list={segmentsId} placeholder="e.g. Web services" value={segment} onChange={(e) => setSegment(e.target.value)} /></label>
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <label className="check"><input type="checkbox" checked={collect} onChange={(e) => setCollect(e.target.checked)} />Collect its repositories now</label>
        <span className="spacer" />
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>Add to tracking</button>
      </div>
    </form>
  );
}

export default function DiscoveryPage() {
  const toast = useToast();
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
    const t = setTimeout(() => setQuery(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  const { data, error, loading, setData } = useApi(loaded ? `/api/candidates?${qs({ status: tab, minScore, q: query,
    sort: sort.key, dir: sort.dir, activeMonths: activeOnly ? ACTIVE_MONTHS : 0 })}` : null, [jobVersion]);

  const head = <PageHead title="Discovery" lede="Find Japanese web-development companies on GitHub that are not tracked yet." />;
  if (!data || !status) return <>{head}<ErrorNotice error={error} />{error ? null : <Loading />}</>;

  const rows = data.rows;
  function removeRow(login, counts) {
    setData((d) => ({ ...d, rows: d.rows.filter((x) => x.login !== login), total: Math.max(0, d.total - 1), counts: counts || d.counts }));
    refresh();
  }
  async function act(candidate, action) {
    try {
      const res = await api(`/api/candidates/${encodeURIComponent(candidate.login)}`, { body: { action } });
      if (action === "reset") toast(`${candidate.login} moved back to review`);
      removeRow(candidate.login, res.counts);
    } catch (err) { toast(err.message, true); }
  }

  const counts = data.counts;
  const sortedBy = COLUMNS.find((c) => c.key === sort.key)?.by || "score";
  const shown = `${fmt(rows.length)} shown${data.total > rows.length ? ` of ${fmt(data.total)} · first ${fmt(rows.length)} by ${sortedBy}` : ""}`
    + (data.hiddenInactive ? ` · ${fmt(data.hiddenInactive)} hidden (no push in ${ACTIVE_MONTHS} months)` : "");
  const ld = status.lastDiscover;
  const tabs = [["pending", "To review"], ["approved", "Approved"], ["rejected", "Rejected"]];

  return (
    <>
      {head}
      <SetupNotice />
      <section className="card" style={{ marginBottom: 16 }}>
        <CardHead title="Find more companies" sub={ld ? `last run ${ago(ld.finishedAt || ld.startedAt)} · ${ld.detail || ld.status}` : "never run"} />
        <p className="muted" style={{ marginBottom: 10 }}>
          Searches GitHub for organizations whose profile location is in Japan, reads their profiles, and scores each one: Japanese text,
          .jp website, verified domain, company wording (株式会社 / Inc.), web languages, recent activity. Community, school and personal
          accounts are scored down. Approve the real web-development companies to start tracking them.
        </p>
        <details>
          <summary>Search options</summary>
          <div className="form-grid" style={{ marginTop: 10 }}>
            <label className="field"><span>Minimum public repositories</span>
              <input type="number" min="1" max="100" value={minRepos} onChange={(e) => setMinRepos(e.target.value)} style={{ width: 90 }} /></label>
            <label className="field" style={{ gridColumn: "1 / -1" }}><span>Locations (comma or line separated)</span>
              <textarea rows={2} value={locations} onChange={(e) => setLocations(e.target.value)}
                placeholder="Leave empty for the defaults: Japan, 日本, Tokyo, 東京, Osaka, 大阪, Kyoto, Fukuoka, Nagoya, Yokohama, Sapporo, Kobe, Sendai, Shibuya …" /></label>
          </div>
        </details>
        <div className="row" style={{ marginTop: 12 }}>
          <RunButton onClick={() => startJob("discover", { minRepos: Number(minRepos) || 3, locations })}>Run discovery</RunButton>
          <span className="muted small">Uses the GitHub search API (30 requests/min); a full run takes several minutes.</span>
        </div>
      </section>

      <div className="filters">
        <div className="seg" role="group" aria-label="Candidate status">
          {tabs.map(([k, label]) => (
            <button key={k} type="button" aria-pressed={tab === k} onClick={() => setTab(k)}>{label} ({fmt(counts[k] || 0)})</button>
          ))}
        </div>
        <select aria-label="Minimum score" value={minScore} onChange={(e) => setMinScore(Number(e.target.value))}>
          {[0, 20, 40, 60, 80].map((v) => <option key={v} value={v}>{v ? `Score ≥ ${v}` : "Any score"}</option>)}
        </select>
        <input type="search" placeholder="Filter by name, login, location" aria-label="Filter candidates" value={search} onChange={(e) => setSearch(e.target.value)} />
        <label className="check" title={`Hide organizations whose last push was ${ACTIVE_MONTHS} or more months ago (or that never pushed)`}>
          <input type="checkbox" checked={activeOnly} onChange={(e) => setPrefs({ discoveryActiveOnly: e.target.checked })} />
          Pushed in the last {ACTIVE_MONTHS} months
        </label>
      </div>
      <datalist id={segmentsId}>{data.segments.map((s) => <option key={s} value={s} />)}</datalist>

      <section className="card">
        <CardHead title="Candidates" sub={shown} />
        <div className={`table-wrap${loading ? " refreshing" : ""}`}>
          <table>
            <thead>
              <tr>
                {COLUMNS.map((c) => (
                  <SortTh key={c.key} sortKey={c.key} label={c.label} title={c.title} num={!!c.num} firstDir={c.firstDir}
                    sort={sort} onSort={setSort} />
                ))}
                <th scope="col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={7} className="empty">
                  {data.hiddenInactive ? `No candidates pushed in the last ${ACTIVE_MONTHS} months. Untick “Pushed in the last ${ACTIVE_MONTHS} months” to see ${fmt(data.hiddenInactive)} inactive ones.`
                    : counts[tab] ? "No candidates match these filters." : tab === "pending" ? "Nothing to review. Run discovery to find organizations." : "None yet."}
                </td></tr>
              ) : rows.map((r) => (
                <Fragment key={r.login}>
                  <tr>
                    <td>
                      <div className="score" title="Heuristic score (0–100)">
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
                    <td>{r.topLanguages.map(([lang, n]) => <span key={lang} className="chip" title={`${n} of the 20 most recent repos`}>{lang}</span>)}</td>
                    <td>{r.signals.map((s) => (
                      <span key={s.label} className={`chip ${s.points >= 0 ? "chip-plus" : "chip-minus"}`} title={s.label}>
                        {s.points > 0 ? "+" : ""}{s.points} {shortSignal(s.label)}
                      </span>))}</td>
                    <td className="nowrap"><TimeAgo iso={r.lastPush} /></td>
                    <td className="nowrap">
                      {r.status === "approved" ? (r.companyId ? <Link href={`/companies/${r.companyId}`}>Open company</Link> : "Approved")
                        : r.status === "rejected" ? <button type="button" className="btn btn-sm" disabled={!canEdit} onClick={() => act(r, "reset")}>Undo</button>
                          : (
                            <div className="row" style={{ flexWrap: "nowrap" }}>
                              <button type="button" className="btn btn-sm btn-primary" disabled={!canEdit}
                                onClick={() => setOpenLogin(openLogin === r.login ? null : r.login)}>Approve</button>
                              <button type="button" className="btn btn-sm" disabled={!canEdit} onClick={() => act(r, "reject")}>Reject</button>
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
