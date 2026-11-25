// Read-side aggregation for the dashboard. Data volume is small (a few thousand repositories),
// so everything is computed in memory from three reads: companies, orgs, and all repo lists.

export async function loadData(store) {
  const [companies, orgs] = await Promise.all([store.hgetall("companies"), store.hgetall("orgs")]);
  const keys = Object.keys(orgs);
  const lists = await store.mget(keys.map((key) => `repos:${key}`));
  const reposByOrg = {};
  keys.forEach((key, i) => { reposByOrg[key] = lists[i] || []; });
  return { companies, orgs, reposByOrg };
}

const byName = (a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" });

function orgsOf(data, companyId) {
  return Object.entries(data.orgs)
    .filter(([, o]) => o.companyId === companyId)
    .map(([key, o]) => ({ key, ...o }))
    .sort((a, b) => a.login.localeCompare(b.login, "en", { sensitivity: "base" }));
}

export function segments(data) {
  return [...new Set(Object.values(data.companies).map((c) => c.segment).filter(Boolean))].sort();
}

function totalsFor(data, orgs, includeArchived) {
  const t = { repos: 0, branches: 0, openIssues: 0, closedIssues: 0, openPrs: 0, stars: 0, lastPush: null };
  for (const org of orgs) {
    for (const r of data.reposByOrg[org.key] || []) {
      if (!includeArchived && r.archived) continue;
      t.repos++;
      t.branches += r.branches;
      t.openIssues += r.openIssues;
      t.closedIssues += r.closedIssues;
      t.openPrs += r.openPrs;
      t.stars += r.stars;
      if (r.pushedAt && (!t.lastPush || r.pushedAt > t.lastPush)) t.lastPush = r.pushedAt;
    }
  }
  t.totalIssues = t.openIssues + t.closedIssues;
  return t;
}

const publicOrg = ({ key, ...o }) => o;

export function companyStats(data, { includeArchived = false, segment = null, companyId = null } = {}) {
  return Object.values(data.companies)
    .filter((c) => (!segment || c.segment === segment) && (companyId == null || c.id === Number(companyId)))
    .map((c) => {
      const orgs = orgsOf(data, c.id);
      const fetched = orgs.map((o) => o.fetchedAt).filter(Boolean).sort();
      return {
        ...c,
        ...totalsFor(data, orgs, includeArchived),
        orgs: orgs.map(publicOrg),
        lastCollected: fetched[fetched.length - 1] || null,
        orgErrors: orgs.filter((o) => o.status === "error" || o.status === "not_found").length,
      };
    })
    .sort(byName);
}

function reposWithCompany(data, { includeArchived, segment }) {
  const out = [];
  for (const [key, list] of Object.entries(data.reposByOrg)) {
    const org = data.orgs[key];
    const company = org && data.companies[org.companyId];
    if (!company || (segment && company.segment !== segment)) continue;
    for (const r of list) {
      if (!includeArchived && r.archived) continue;
      out.push({ ...r, org: org.login, companyId: company.id, company: company.name });
    }
  }
  return out;
}

export function summary(data, { includeArchived = false, segment = null } = {}) {
  const companies = companyStats(data, { includeArchived, segment });
  const keys = ["repos", "branches", "openIssues", "closedIssues", "openPrs", "stars"];
  const totals = Object.fromEntries(keys.map((k) => [k, companies.reduce((a, c) => a + c[k], 0)]));
  totals.totalIssues = totals.openIssues + totals.closedIssues;
  totals.companies = companies.length;
  totals.companiesCollected = companies.filter((c) => c.lastCollected).length;

  const repos = reposWithCompany(data, { includeArchived, segment });
  const langCounts = new Map();
  for (const r of repos) {
    const lang = r.language || "(none)";
    langCounts.set(lang, (langCounts.get(lang) || 0) + 1);
  }
  const languages = [...langCounts.entries()].map(([language, count]) => ({ language, repos: count }))
    .sort((a, b) => b.repos - a.repos || a.language.localeCompare(b.language)).slice(0, 12);
  const topRepos = repos.sort((a, b) => b.openIssues - a.openIssues || b.stars - a.stars).slice(0, 10);
  return { totals, companies, languages, topRepos, segments: segments(data) };
}

const SORTS = {
  name: (r) => r.fullName.toLowerCase(), company: (r) => r.company.toLowerCase(), language: (r) => (r.language || "").toLowerCase(),
  branches: (r) => r.branches, openIssues: (r) => r.openIssues, closedIssues: (r) => r.closedIssues,
  totalIssues: (r) => r.openIssues + r.closedIssues, openPrs: (r) => r.openPrs, stars: (r) => r.stars,
  pushedAt: (r) => r.pushedAt || "",
};

export function searchRepos(data, { q, language, companyId, includeArchived = false, segment = null,
  sort = "openIssues", dir = "desc", limit = 50, offset = 0 } = {}) {
  const needle = (q || "").trim().toLowerCase();
  let rows = reposWithCompany(data, { includeArchived, segment });
  const languages = [...new Set(rows.map((r) => r.language || "(none)"))].sort((a, b) => a.localeCompare(b));
  if (needle) {
    rows = rows.filter((r) => r.fullName.toLowerCase().includes(needle) || (r.description || "").toLowerCase().includes(needle)
      || r.topics.some((t) => t.toLowerCase().includes(needle)));
  }
  if (language) rows = rows.filter((r) => (r.language || "(none)") === language);
  if (companyId) rows = rows.filter((r) => r.companyId === Number(companyId));
  const key = SORTS[sort] || SORTS.openIssues;
  const sign = dir === "asc" ? 1 : -1;
  rows.sort((a, b) => {
    const va = key(a), vb = key(b);
    const cmp = typeof va === "number" ? va - vb : String(va).localeCompare(String(vb));
    return cmp * sign || a.fullName.localeCompare(b.fullName);
  });
  const lim = Math.max(1, Math.min(Number(limit) || 50, 100000));
  const off = Math.max(0, Number(offset) || 0);
  return { total: rows.length, rows: rows.slice(off, off + lim), languages };
}

// ---------------------------------------------------------------- discovery candidates

const collator = new Intl.Collator("ja", { numeric: true, sensitivity: "base" });
const positives = (c) => (c.signals || []).filter((s) => s.points > 0).length;

/** Sort keys for the candidates table; each column's first click uses `firstDir`. */
export const CANDIDATE_SORTS = {
  score: { value: (c) => c.score ?? 0, firstDir: "desc" },
  name: { value: (c) => (c.name || "").trim() || c.login, firstDir: "asc" },
  repos: { value: (c) => c.repoTotal ?? 0, firstDir: "desc" },
  language: { value: (c) => c.topLanguages?.[0]?.[0] || null, firstDir: "asc" },
  signals: { value: positives, firstDir: "desc" },
  lastPush: { value: (c) => c.lastPush || null, firstDir: "desc" },
};

/** Timestamp (ms) of the same moment `months` calendar months before `now`. */
export function monthsAgo(months, now = Date.now()) {
  const d = new Date(now);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.getTime();
}

/**
 * Filter, sort and cap the candidate list. Empty values (no language, never pushed) stay last in
 * both directions; ties fall back to score, then login, so the order is stable.
 * activeMonths > 0 keeps only organizations that pushed within that many months (never pushed = inactive);
 * `hiddenInactive` reports how many otherwise-matching candidates that removed.
 */
export function listCandidates(all, { status = "pending", minScore = 0, q = "", sort = "score", dir, limit = 500,
  activeMonths = 0, now = Date.now() } = {}) {
  const list = Object.values(all);
  const counts = { pending: 0, approved: 0, rejected: 0 };
  for (const c of list) counts[c.status] = (counts[c.status] || 0) + 1;
  const needle = String(q || "").trim().toLowerCase();
  const matching = list.filter((c) => c.status === status && (c.score || 0) >= minScore
    && (!needle || [c.login, c.name, c.location, c.description, c.websiteUrl].some((v) => v && String(v).toLowerCase().includes(needle))));
  const cutoff = activeMonths > 0 ? monthsAgo(activeMonths, now) : null;
  const rows = cutoff == null ? matching : matching.filter((c) => c.lastPush && Date.parse(c.lastPush) > cutoff);
  const hiddenInactive = matching.length - rows.length;
  const key = CANDIDATE_SORTS[sort] ? sort : "score";
  const { value, firstDir } = CANDIDATE_SORTS[key];
  const sign = (dir === "asc" || dir === "desc" ? dir : firstDir) === "asc" ? 1 : -1;
  rows.sort((a, b) => {
    const va = value(a), vb = value(b);
    if (va == null || vb == null) {
      if (va != null) return -1;
      if (vb != null) return 1;
    } else {
      const cmp = typeof va === "number" && typeof vb === "number" ? va - vb : collator.compare(String(va), String(vb));
      if (cmp) return cmp * sign;
    }
    return (b.score ?? 0) - (a.score ?? 0) || collator.compare(a.login, b.login);
  });
  return { rows: rows.slice(0, Math.max(1, Number(limit) || 500)), total: rows.length, hiddenInactive, counts,
    sort: key, dir: sign > 0 ? "asc" : "desc" };
}

export async function companyDetail(store, data, id) {
  const companyId = Number(id);
  const active = companyStats(data, { companyId })[0];
  if (!active) return null;
  const all = companyStats(data, { companyId, includeArchived: true })[0];
  const orgs = orgsOf(data, companyId);
  const repositories = orgs.flatMap((o) => (data.reposByOrg[o.key] || []).map((r) => ({ ...r, org: o.login })))
    .sort((a, b) => b.openIssues - a.openIssues || b.stars - a.stars);
  return {
    ...active,
    withArchived: { repos: all.repos, branches: all.branches, openIssues: all.openIssues, closedIssues: all.closedIssues,
      openPrs: all.openPrs, stars: all.stars },
    repositories,
    snapshots: await store.lrange(`snapshots:${companyId}`, 0, -1),
    segments: segments(data),
  };
}

// ---------------------------------------------------------------- contribution (issues to work on, welcoming repos)

/** loadData plus every org's contribution record (`contrib:<org>`). */
export async function loadContribData(store) {
  const data = await loadData(store);
  const keys = Object.keys(data.orgs);
  const records = keys.length ? await store.mget(keys.map((key) => `contrib:${key}`)) : [];
  data.contribByOrg = {};
  keys.forEach((key, i) => { if (records[i]) data.contribByOrg[key] = records[i]; });
  return data;
}

/** Every checked repository with its company and contribution stats. */
function contribRepos(data) {
  const out = [];
  for (const [key, record] of Object.entries(data.contribByOrg || {})) {
    const org = data.orgs[key];
    const company = org && data.companies[org.companyId];
    if (!company) continue;
    const repos = new Map((data.reposByOrg[key] || []).map((r) => [r.name.toLowerCase(), r]));
    for (const [name, stats] of Object.entries(record.repos || {})) {
      const repo = repos.get(name.toLowerCase()) || {};
      out.push({ ...stats, name, fullName: repo.fullName || `${org.login}/${name}`, url: repo.url || `https://github.com/${org.login}/${name}`,
        description: repo.description || null, language: repo.language || null, stars: repo.stars || 0, pushedAt: repo.pushedAt || null,
        org: org.login, orgKey: key, companyId: company.id, company: company.name });
    }
  }
  return out;
}

function contribCheckedAt(data) {
  return Object.values(data.contribByOrg || {}).map((r) => r.fetchedAt).filter(Boolean).sort().pop() || null;
}

const ISSUE_SORTS = {
  title: { value: (i) => i.title || "", firstDir: "asc" },
  company: { value: (i) => i.company, firstDir: "asc" },
  language: { value: (i) => i.language || null, firstDir: "asc" },
  welcome: { value: (i) => i.welcome, firstDir: "desc" },
  comments: { value: (i) => i.comments, firstDir: "desc" },
  updatedAt: { value: (i) => i.updatedAt || null, firstDir: "desc" },
  createdAt: { value: (i) => i.createdAt || null, firstDir: "desc" },
  stars: { value: (i) => i.stars, firstDir: "desc" },
};

/**
 * Open issues in checked repositories, filtered for ones a newcomer could pick up.
 * Defaults: unassigned, no linked pull request, updated within 6 months.
 */
export function searchIssues(data, { q = "", companyId = null, language = "", inLanguages = [], issueLang = "", beginner = false,
  unassigned = true, noPr = true, activeMonths = 6, minWelcome = 0, sort = "updatedAt", dir, limit = 50, offset = 0,
  now = Date.now() } = {}) {
  const repos = new Map(contribRepos(data).map((r) => [`${r.orgKey}/${r.name.toLowerCase()}`, r]));
  const all = [];
  for (const [key, record] of Object.entries(data.contribByOrg || {})) {
    for (const issue of record.issues || []) {
      const repo = repos.get(`${key}/${issue.repo.toLowerCase()}`);
      if (!repo) continue;
      all.push({ ...issue, fullName: repo.fullName, url: `${repo.url}/issues/${issue.number}`, org: repo.org,
        companyId: repo.companyId, company: repo.company, language: repo.language, stars: repo.stars, welcome: repo.score ?? 0 });
    }
  }
  const languages = [...new Set(all.map((i) => i.language || "(none)"))].sort((a, b) => a.localeCompare(b));
  const companies = [...new Map(all.map((i) => [i.companyId, i.company])).entries()]
    .map(([id, name]) => ({ id, name })).sort((a, b) => collator.compare(a.name, b.name));
  const needle = String(q || "").trim().toLowerCase();
  const cutoff = activeMonths > 0 ? monthsAgo(activeMonths, now) : null;
  const langSet = inLanguages.length ? new Set(inLanguages.map((l) => String(l).toLowerCase())) : null;
  const rows = all.filter((i) => (!needle || [i.title, i.fullName, ...i.labels].some((v) => v && v.toLowerCase().includes(needle)))
    && (!companyId || i.companyId === Number(companyId))
    && (!language || (i.language || "(none)") === language)
    && (!langSet || langSet.has(String(i.language || "").toLowerCase()))
    && (!issueLang || (issueLang === "ja" ? i.ja : !i.ja))
    && (!beginner || i.beginner)
    && (!unassigned || !i.assigned)
    && (!noPr || !i.linkedPr)
    && (cutoff == null || Date.parse(i.updatedAt) > cutoff)
    && i.welcome >= (Number(minWelcome) || 0));
  const key = ISSUE_SORTS[sort] ? sort : "updatedAt";
  const { value, firstDir } = ISSUE_SORTS[key];
  const sign = (dir === "asc" || dir === "desc" ? dir : firstDir) === "asc" ? 1 : -1;
  rows.sort((a, b) => {
    const va = value(a), vb = value(b);
    if (va == null || vb == null) {
      if (va != null) return -1;
      if (vb != null) return 1;
    } else {
      const cmp = typeof va === "number" && typeof vb === "number" ? va - vb : collator.compare(String(va), String(vb));
      if (cmp) return cmp * sign;
    }
    return (b.updatedAt || "").localeCompare(a.updatedAt || "") || a.url.localeCompare(b.url);
  });
  const lim = Math.max(1, Math.min(Number(limit) || 50, 1000));
  const off = Math.max(0, Number(offset) || 0);
  return { total: rows.length, all: all.length, rows: rows.slice(off, off + lim), languages, companies,
    checkedAt: contribCheckedAt(data), sort: key, dir: sign > 0 ? "asc" : "desc" };
}

/** Checked repositories and per-company roll-ups for the "who welcomes contributions" views. */
export function welcoming(data, { minWelcome = 40 } = {}) {
  const repos = contribRepos(data);
  const byCompany = new Map();
  for (const r of repos) {
    const c = byCompany.get(r.companyId) || { id: r.companyId, name: r.company, checkedRepos: 0, bestScore: 0, bestRepo: null,
      welcomingRepos: 0, outsideMerged: 0, beginnerIssues: 0, openIssues: 0 };
    c.checkedRepos++;
    if (r.score > c.bestScore || !c.bestRepo) { c.bestScore = r.score; c.bestRepo = r.fullName; }
    if (r.score >= minWelcome) c.welcomingRepos++;
    c.outsideMerged += r.outsideMerged;
    c.beginnerIssues += r.beginnerIssues;
    byCompany.set(r.companyId, c);
  }
  // Issues a newcomer could pick up: unassigned and without a linked pull request.
  for (const [key, record] of Object.entries(data.contribByOrg || {})) {
    const company = byCompany.get(data.orgs[key]?.companyId);
    if (company) company.openIssues += (record.issues || []).filter((i) => !i.assigned && !i.linkedPr).length;
  }
  return { repos: repos.sort((a, b) => b.score - a.score), companies: [...byCompany.values()].sort((a, b) => b.bestScore - a.bestScore),
    checkedAt: contribCheckedAt(data), minWelcome };
}

// ---------------------------------------------------------------- CSV

function csvCell(value) {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(header, rows) {
  // BOM so Excel opens Japanese text correctly.
  return "﻿" + [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export function companiesCsv(data, opts) {
  const header = ["company", "company_ja", "segment", "website", "github_orgs", "repos", "branches", "open_issues",
    "closed_issues", "total_issues", "open_prs", "stars", "last_push", "last_collected"];
  const rows = companyStats(data, opts).map((c) => [c.name, c.nameJa, c.segment, c.website, c.orgs.map((o) => o.login).join(" "),
    c.repos, c.branches, c.openIssues, c.closedIssues, c.totalIssues, c.openPrs, c.stars, c.lastPush, c.lastCollected]);
  return toCsv(header, rows);
}

export function reposCsv(data, opts) {
  const header = ["company", "org", "repository", "url", "language", "branches", "open_issues", "closed_issues",
    "open_prs", "stars", "forks", "archived", "pushed_at", "topics"];
  const rows = searchRepos(data, { ...opts, sort: "company", dir: "asc", limit: 1e9 }).rows.map((r) => [r.company, r.org,
    r.name, r.url, r.language, r.branches, r.openIssues, r.closedIssues, r.openPrs, r.stars, r.forks,
    r.archived ? "yes" : "no", r.pushedAt, r.topics.join(" ")]);
  return toCsv(header, rows);
}
