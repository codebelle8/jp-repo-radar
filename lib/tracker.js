// Personal contribution & job-search tracker. Private: every route that reads it requires sign-in.
//   tracker      : hash  id -> tracked issue {id, url, owner, repo, number, title, companyId, stage, notes, prUrl, prState, ...}
//   applications : hash  companyId -> {stage, notes, careersUrl, updatedAt, history}
//   myPrs        : {syncedAt, viewer, prs: [...]}   your pull requests to tracked companies (from GitHub)
// The same sync refreshes the languages you use (see skills.js).
// "Sync" reads the token owner's pull requests and issue comments from GitHub and moves tracked issues forward
// automatically (watching -> commented -> PR open -> merged). It never moves an issue backwards or out of "dropped".
import { createGitHubClient } from "./github.js";
import { getToken } from "./jobs.js";
import { SKILL_FIELDS, saveDetected } from "./skills.js";
import { HttpError, cleanText, cleanUrl, nowIso } from "./util.js";

export const STAGES = [["watching", "Watching"], ["commented", "Commented"], ["pr_open", "PR open"], ["merged", "Merged"], ["dropped", "Dropped"]];
export const APP_STAGES = [["none", "Not started"], ["preparing", "Preparing"], ["applied", "Applied"], ["casual", "Casual interview"],
  ["interviewing", "Interviewing"], ["offer", "Offer"], ["closed", "Not this time"]];
export const READY_MERGED = 2;        // merged PRs at a company before it is flagged "ready to approach"
const MAX_ITEMS = 300;
const MAX_LOOKUPS = 60;               // tracked issues refreshed per sync (most recently updated first)
const RANK = { watching: 0, commented: 1, pr_open: 2, merged: 3 };
const ACTIVE_APPS = new Set(["applied", "casual", "interviewing", "offer"]);

export const normUrl = (u) => String(u || "").trim().toLowerCase().replace(/[#?].*$/, "").replace(/\/+$/, "");

/** Parse a GitHub issue URL. Throws a 400 for pull requests and anything else. */
export function parseIssueUrl(url) {
  const m = String(url || "").trim().match(/^https:\/\/github\.com\/([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})\/(issues|pull)\/(\d{1,9})\/?(?:[#?].*)?$/);
  if (!m) throw new HttpError(400, "Paste a GitHub issue link like https://github.com/owner/repo/issues/123");
  if (m[3] === "pull") throw new HttpError(400, "That is a pull request. Track the issue it fixes instead; pull requests are picked up automatically.");
  const [, owner, repo, , number] = m;
  return { owner, repo, number: Number(number), url: `https://github.com/${owner}/${repo}/issues/${number}`,
    id: `${owner}:${repo}:${number}`.toLowerCase() };
}

function pushHistory(record, stage) {
  record.history = [...(record.history || []), { stage, at: nowIso() }].slice(-30);
}

export async function addIssue(store, { url, title } = {}) {
  const p = parseIssueUrl(url);
  const existing = await store.hget("tracker", p.id);
  if (existing) return existing;
  const all = await store.hgetall("tracker");
  if (Object.keys(all).length >= MAX_ITEMS) throw new HttpError(400, `You can track up to ${MAX_ITEMS} issues. Remove some first.`);
  const org = await store.hget("orgs", p.owner.toLowerCase());
  const item = { ...p, title: cleanText(title, 300) || `${p.owner}/${p.repo}#${p.number}`, companyId: org?.companyId ?? null,
    stage: "watching", notes: "", prUrl: null, prState: null, issueState: null, addedAt: nowIso(), updatedAt: nowIso() };
  pushHistory(item, "watching");
  await store.hset("tracker", { [p.id]: item });
  return item;
}

export async function updateItem(store, id, { stage, notes } = {}) {
  const item = await store.hget("tracker", id);
  if (!item) throw new HttpError(404, "Not tracked");
  if (stage !== undefined) {
    if (!STAGES.some(([k]) => k === stage)) throw new HttpError(400, "Unknown stage");
    if (stage !== item.stage) { item.stage = stage; pushHistory(item, stage); }
  }
  if (notes !== undefined) item.notes = cleanText(notes, 2000) || "";
  item.updatedAt = nowIso();
  await store.hset("tracker", { [id]: item });
  return item;
}

export async function removeItem(store, id) {
  await store.hdel("tracker", id);
}

export async function setApplication(store, companyId, { stage, notes, careersUrl } = {}) {
  const id = Number(companyId);
  if (!(await store.hget("companies", String(id)))) throw new HttpError(404, "Company not found");
  const app = (await store.hget("applications", String(id))) || { companyId: id, stage: "none", notes: "", careersUrl: null, history: [] };
  if (stage !== undefined) {
    if (!APP_STAGES.some(([k]) => k === stage)) throw new HttpError(400, "Unknown stage");
    if (stage !== app.stage) { app.stage = stage; pushHistory(app, stage); }
  }
  if (notes !== undefined) app.notes = cleanText(notes, 2000) || "";
  if (careersUrl !== undefined) {
    const clean = careersUrl ? cleanUrl(careersUrl) : null;
    if (careersUrl && !clean) throw new HttpError(400, "Careers link must start with http:// or https://");
    app.careersUrl = clean;
  }
  app.updatedAt = nowIso();
  await store.hset("applications", { [String(id)]: app });
  return app;
}

// ---------------------------------------------------------------- sync with GitHub

/** Your PRs, issue comments and languages, plus the current state of up to `n` tracked issues (aliases u0..). */
export function buildSyncQuery(n) {
  const vars = Array.from({ length: n }, (_, i) => `$u${i}: URI!`).join(", ");
  const lookups = Array.from({ length: n }, (_, i) =>
    `  u${i}: resource(url: $u${i}) { ... on Issue { url title state closedAt } }`).join("\n");
  return `query TrackerSync${n ? `(${vars})` : ""} {
  rateLimit { limit cost remaining resetAt }
  viewer {
    login
    pullRequests(first: 100, orderBy: {field: CREATED_AT, direction: DESC}) {
      nodes {
        url title state merged mergedAt createdAt closedAt
        repository { name owner { login } }
        closingIssuesReferences(first: 5) { nodes { url } }
      }
    }
    issueComments(first: 100, orderBy: {field: UPDATED_AT, direction: DESC}) { nodes { createdAt issue { url } } }${SKILL_FIELDS}
  }
${lookups}
}`;
}

/** Apply GitHub's view to the tracked issues. Pure: returns { items (changed only), prs }. */
export function applySync(items, orgs, data) {
  const viewer = data.viewer || {};
  const allPrs = (viewer.pullRequests?.nodes || []).filter(Boolean).map((p) => ({
    url: p.url, title: p.title, state: p.merged ? "MERGED" : p.state, createdAt: p.createdAt, mergedAt: p.mergedAt || null,
    closedAt: p.closedAt || null, owner: p.repository?.owner?.login || "", repo: p.repository?.name || "",
    linkedIssues: (p.closingIssuesReferences?.nodes || []).map((n) => normUrl(n?.url)).filter(Boolean),
  }));
  const trackedUrls = new Set(Object.values(items).map((i) => normUrl(i.url)));
  const myLogin = (viewer.login || "").toLowerCase();
  // Keep PRs to tracked companies' organizations, and any PR that fixes a tracked issue.
  const prs = allPrs.filter((p) => p.owner.toLowerCase() !== myLogin
    && (orgs[p.owner.toLowerCase()] || p.linkedIssues.some((u) => trackedUrls.has(u))));
  const commented = new Set((viewer.issueComments?.nodes || []).map((c) => normUrl(c?.issue?.url)).filter(Boolean));
  const lookups = new Map(Object.entries(data).filter(([k, v]) => /^u\d+$/.test(k) && v?.url).map(([, v]) => [normUrl(v.url), v]));

  const changed = {};
  for (const item of Object.values(items)) {
    const key = normUrl(item.url);
    const next = { ...item };
    const live = lookups.get(key);
    if (live) {
      if (live.title) next.title = live.title;
      next.issueState = live.state || null;
      next.closedAt = live.closedAt || null;
    }
    const linked = prs.filter((p) => p.linkedIssues.includes(key));
    const best = linked.find((p) => p.state === "MERGED") || linked.find((p) => p.state === "OPEN") || linked[0];
    if (best) { next.prUrl = best.url; next.prState = best.state; }
    const derived = linked.some((p) => p.state === "MERGED") ? "merged" : linked.some((p) => p.state === "OPEN") ? "pr_open"
      : commented.has(key) ? "commented" : "watching";
    if (next.stage !== "dropped" && RANK[derived] > (RANK[next.stage] ?? 0)) { next.stage = derived; pushHistory(next, derived); }
    if (JSON.stringify(next) !== JSON.stringify(item)) { next.updatedAt = nowIso(); changed[item.id] = next; }
  }
  return { items: changed, prs, viewer: viewer.login || null };
}

export async function syncTracker(store, { fetchImpl, sleepImpl } = {}) {
  const { token } = await getToken(store);
  if (!token) throw new HttpError(400, "Add a GitHub token first (see Settings).");
  const client = createGitHubClient({ token, ...(fetchImpl ? { fetchImpl } : {}), ...(sleepImpl ? { sleep: sleepImpl } : {}) });
  const [items, orgs] = await Promise.all([store.hgetall("tracker"), store.hgetall("orgs")]);
  const lookup = Object.values(items).filter((i) => i.stage !== "dropped")
    .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || "")).slice(0, MAX_LOOKUPS);
  const variables = Object.fromEntries(lookup.map((i, n) => [`u${n}`, i.url]));
  const data = await client.graphql(buildSyncQuery(lookup.length), variables);
  const result = applySync(items, orgs, data);
  if (Object.keys(result.items).length) await store.hset("tracker", result.items);
  const record = { syncedAt: nowIso(), viewer: result.viewer, prs: result.prs };
  await store.set("myPrs", record);
  const detected = await saveDetected(store, data.viewer);
  return { syncedAt: record.syncedAt, viewer: result.viewer, prs: result.prs.length, updated: Object.keys(result.items).length,
    languages: detected.length };
}

// ---------------------------------------------------------------- view

export async function trackerView(store) {
  const [items, applications, companies, orgs, mine] = await Promise.all([store.hgetall("tracker"), store.hgetall("applications"),
    store.hgetall("companies"), store.hgetall("orgs"), store.get("myPrs")]);
  const companyName = (id) => companies[id]?.name || null;
  const prs = (mine?.prs || []).map((p) => {
    const companyId = orgs[p.owner.toLowerCase()]?.companyId ?? null;
    return { ...p, companyId, company: companyName(companyId) };
  });
  const list = Object.values(items).map((i) => ({ ...i, company: companyName(i.companyId) }))
    .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));

  const rows = new Map();
  const row = (id) => {
    if (!rows.has(id)) {
      const app = applications[id] || null;
      rows.set(id, { id: Number(id), name: companyName(id), trackedIssues: 0, openPrs: 0, mergedPrs: 0, lastMergedAt: null,
        stage: app?.stage || "none", notes: app?.notes || "", careersUrl: app?.careersUrl || null, appUpdatedAt: app?.updatedAt || null });
    }
    return rows.get(id);
  };
  for (const i of list) if (i.companyId != null && companies[i.companyId] && i.stage !== "dropped") row(String(i.companyId)).trackedIssues++;
  for (const p of prs) {
    if (p.companyId == null || !companies[p.companyId]) continue;
    const r = row(String(p.companyId));
    if (p.state === "OPEN") r.openPrs++;
    if (p.state === "MERGED") { r.mergedPrs++; if (!r.lastMergedAt || p.mergedAt > r.lastMergedAt) r.lastMergedAt = p.mergedAt; }
  }
  for (const id of Object.keys(applications)) if (companies[id]) row(id);
  const pipeline = [...rows.values()].map((r) => ({ ...r, ready: r.mergedPrs >= READY_MERGED && (r.stage === "none" || r.stage === "preparing") }))
    .sort((a, b) => Number(b.ready) - Number(a.ready) || b.mergedPrs - a.mergedPrs || b.openPrs - a.openPrs || (a.name || "").localeCompare(b.name || ""));

  const byStage = Object.fromEntries(STAGES.map(([k]) => [k, list.filter((i) => i.stage === k).length]));
  return {
    items: list, prs, companies: pipeline, stages: STAGES, appStages: APP_STAGES, readyMerged: READY_MERGED,
    counts: { ...byStage, openPrs: prs.filter((p) => p.state === "OPEN").length, mergedPrs: prs.filter((p) => p.state === "MERGED").length,
      ready: pipeline.filter((r) => r.ready).length, activeApplications: pipeline.filter((r) => ACTIVE_APPS.has(r.stage)).length },
    syncedAt: mine?.syncedAt || null, viewer: mine?.viewer || null,
  };
}
