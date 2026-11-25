// Skill match (private): the languages you use on GitHub against each company's public stack.
//   skills : {viewer, syncedAt, detected: [{name, repos, contributed, bytes}], added: [names], removed: [names]}
// "detected" is refreshed by the tracker sync (your own non-fork repositories, plus repositories you committed or
// opened pull requests to). You can add languages GitHub cannot see and hide detected ones.
import { loadContribData, welcoming } from "./queries.js";
import { HttpError, nowIso } from "./util.js";

const YEAR_MS = 365 * 864e5;
const MIN_SHARE = 0.1;                 // a language must be 10%+ of a repository's code to count for it
const MAX_LANGUAGES = 50;
// Build and config files say little about what someone can work on.
const IGNORED = new Set(["Dockerfile", "Makefile", "Batchfile", "Procfile", "Roff"]);
// Knowing one of a pair gets half credit for the other.
const RELATED = [["TypeScript", "JavaScript"], ["Kotlin", "Java"], ["C", "C++"], ["Swift", "Objective-C"], ["CSS", "SCSS"],
  ["Vue", "JavaScript"], ["Vue", "TypeScript"], ["Svelte", "JavaScript"], ["Svelte", "TypeScript"]];
const lower = (s) => String(s).toLowerCase();

/** Fields added under `viewer` in the tracker sync query. */
export const SKILL_FIELDS = `
    repositories(first: 100, ownerAffiliations: [OWNER], isFork: false, orderBy: {field: PUSHED_AT, direction: DESC}) {
      nodes { languages(first: 5, orderBy: {field: SIZE, direction: DESC}) { totalSize edges { size node { name } } } }
    }
    repositoriesContributedTo(first: 50, includeUserRepositories: false, contributionTypes: [COMMIT, PULL_REQUEST]) {
      nodes { primaryLanguage { name } }
    }`;

/** Languages from the viewer's repositories, most used first. */
export function detectLanguages(viewer) {
  const by = new Map();
  const get = (name) => {
    if (!by.has(name)) by.set(name, { name, repos: 0, contributed: 0, bytes: 0 });
    return by.get(name);
  };
  for (const repo of viewer?.repositories?.nodes || []) {
    const total = repo?.languages?.totalSize || 0;
    for (const e of (total && repo.languages.edges) || []) {
      const name = e?.node?.name;
      if (!name || IGNORED.has(name) || e.size / total < MIN_SHARE) continue;
      const l = get(name);
      l.repos++;
      l.bytes += e.size;
    }
  }
  for (const repo of viewer?.repositoriesContributedTo?.nodes || []) {
    const name = repo?.primaryLanguage?.name;
    if (name && !IGNORED.has(name)) get(name).contributed++;
  }
  return [...by.values()].sort((a, b) => b.repos + b.contributed - (a.repos + a.contributed) || b.bytes - a.bytes
    || a.name.localeCompare(b.name));
}

/** Detected plus added, minus hidden. Case-insensitive, first spelling wins. */
export function yourLanguages(record) {
  const removed = new Set((record?.removed || []).map(lower));
  const out = new Map();
  for (const name of [...(record?.detected || []).map((l) => l.name), ...(record?.added || [])]) {
    if (!removed.has(lower(name)) && !out.has(lower(name))) out.set(lower(name), name);
  }
  return [...out.values()];
}

/** Your languages plus related ones (TypeScript -> JavaScript ...), for filtering issues. */
export function withRelated(languages) {
  const set = new Map(languages.map((l) => [lower(l), l]));
  for (const [a, b] of RELATED) {
    if (set.has(lower(a)) && !set.has(lower(b))) set.set(lower(b), b);
    if (set.has(lower(b)) && !set.has(lower(a))) set.set(lower(a), a);
  }
  return [...set.values()];
}

/** Per company: primary languages of its active repositories (pushed in the last 12 months; all repositories if none). */
export function companyStacks(data, now = Date.now()) {
  const counts = {};
  for (const [key, list] of Object.entries(data.reposByOrg)) {
    const id = data.orgs[key]?.companyId;
    if (id == null || !data.companies[id]) continue;
    const c = (counts[id] ||= { active: new Map(), all: new Map() });
    for (const r of list) {
      if (r.archived || !r.language || IGNORED.has(r.language)) continue;
      c.all.set(r.language, (c.all.get(r.language) || 0) + 1);
      if (r.pushedAt && now - Date.parse(r.pushedAt) <= YEAR_MS) c.active.set(r.language, (c.active.get(r.language) || 0) + 1);
    }
  }
  const stacks = {};
  for (const [id, c] of Object.entries(counts)) {
    const m = c.active.size ? c.active : c.all;
    const total = [...m.values()].reduce((a, n) => a + n, 0);
    if (!total) continue;
    stacks[id] = { repos: total, recent: m === c.active,
      langs: [...m].map(([name, repos]) => ({ name, repos, share: repos / total })).sort((a, b) => b.repos - a.repos || a.name.localeCompare(b.name)) };
  }
  return stacks;
}

/** 0–100: share of the company's repositories written in your languages (related languages count half). */
export function matchStack(stack, languages) {
  if (!stack?.repos) return null;
  const mine = new Set(languages.map(lower));
  const related = (name) => RELATED.some(([a, b]) => (lower(a) === lower(name) && mine.has(lower(b))) || (lower(b) === lower(name) && mine.has(lower(a))));
  let score = 0;
  const out = { shared: [], related: [], missing: [] };
  for (const l of stack.langs) {
    if (mine.has(lower(l.name))) { score += l.share; out.shared.push(l.name); } else if (related(l.name)) { score += l.share / 2; out.related.push(l.name); } else out.missing.push(l.name);
  }
  return { score: Math.round(score * 100), repos: stack.repos, recent: stack.recent, ...out, missing: out.missing.slice(0, 3),
    top: stack.langs.slice(0, 4).map((l) => ({ name: l.name, share: Math.round(l.share * 100) })) };
}

const VALID_NAME = /^[\p{L}\p{N} +#.'*-]{1,40}$/u;
function cleanList(list) {
  if (!Array.isArray(list)) throw new HttpError(400, "Send lists of language names");
  const out = new Map();
  for (const v of list) {
    const name = String(v ?? "").trim().replace(/\s+/g, " ");
    if (!name) continue;
    if (!VALID_NAME.test(name)) throw new HttpError(400, `“${name.slice(0, 40)}” is not a language name`);
    if (!out.has(lower(name))) out.set(lower(name), name);
  }
  if (out.size > MAX_LANGUAGES) throw new HttpError(400, `Up to ${MAX_LANGUAGES} languages`);
  return [...out.values()];
}

/** Save what you added and what you hid. */
export async function setSkills(store, { added, removed } = {}) {
  const record = (await store.get("skills")) || { viewer: null, syncedAt: null, detected: [], added: [], removed: [] };
  if (added !== undefined) record.added = cleanList(added);
  if (removed !== undefined) record.removed = cleanList(removed);
  record.updatedAt = nowIso();
  await store.set("skills", record);
  return record;
}

/** Called by the tracker sync with the viewer part of its response. */
export async function saveDetected(store, viewer) {
  const record = (await store.get("skills")) || { added: [], removed: [] };
  const detected = detectLanguages(viewer);
  await store.set("skills", { ...record, viewer: viewer?.login || null, syncedAt: nowIso(), detected });
  return detected;
}

/** Everything the skill views need: your languages, a match per company, and suggested companies to contribute to. */
export async function skillsView(store, { now = Date.now() } = {}) {
  const [record, data] = await Promise.all([store.get("skills"), loadContribData(store)]);
  const languages = yourLanguages(record);
  const stacks = companyStacks(data, now);
  const matches = {};
  if (languages.length) for (const [id, stack] of Object.entries(stacks)) matches[id] = matchStack(stack, languages);
  // Suggestions: companies with issues to pick, ranked by skill match and how welcoming their best repository is.
  const suggestions = languages.length ? welcoming(data).companies
    .filter((c) => matches[c.id]?.score > 0 && c.openIssues > 0)
    .map((c) => ({ ...c, match: matches[c.id].score, shared: matches[c.id].shared, fit: Math.round(matches[c.id].score * 0.6 + c.bestScore * 0.4) }))
    .sort((a, b) => b.fit - a.fit || b.openIssues - a.openIssues || a.name.localeCompare(b.name))
    .slice(0, 30) : [];
  const allLanguages = [...new Set(Object.values(stacks).flatMap((s) => s.langs.map((l) => l.name)))].sort((a, b) => a.localeCompare(b));
  return {
    viewer: record?.viewer || null, syncedAt: record?.syncedAt || null, detected: record?.detected || [],
    added: record?.added || [], removed: record?.removed || [], languages, filterLanguages: withRelated(languages),
    matches, suggestions, allLanguages,
  };
}
