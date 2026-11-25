// Contribution data, collected as the second phase of a collection job:
//  - open issues in each tracked organization's active repositories (candidates for you to work on), and
//  - how welcoming each repository is to outside contributors (recent outside PRs merged, replies to
//    outside issues, CONTRIBUTING guide, beginner-labelled issues).
// Several repositories are fetched per GraphQL request (aliases); the batch shrinks when GitHub times out.
// Results for an org are built in `contrib-wip:<org>` and moved to `contrib:<org>` when complete, so readers
// never see half an organization.
import { AuthError, GitHubError, RateLimitError, TransientError } from "./github.js";
import { nowIso, StoppedError } from "./util.js";

export const ACTIVE_DAYS = 365;       // repositories pushed within this window are checked
export const MAX_REPOS_PER_ORG = 60;  // most recently pushed first
export const ISSUES_PER_REPO = 30;    // most recently updated open issues
export const BATCH_SIZES = [10, 5, 2, 1];
const DAY = 86400000;

// Validated against GitHub's published GraphQL schema. Every connection has an explicit `first`.
export const CONTRIB_FRAGMENT = `
fragment RepoContrib on Repository {
  name
  contributingGuidelines { url }
  openIssues: issues(states: OPEN, first: ${ISSUES_PER_REPO}, orderBy: {field: UPDATED_AT, direction: DESC}) {
    totalCount
    nodes {
      number title createdAt updatedAt authorAssociation
      labels(first: 10) { nodes { name } }
      assignees(first: 1) { totalCount }
      comments(first: 1) { totalCount }
      linkedPrs: closedByPullRequestsReferences(first: 1, includeClosedPrs: false) { totalCount }
    }
  }
  recentIssues: issues(first: 20, orderBy: {field: CREATED_AT, direction: DESC}) {
    nodes {
      createdAt authorAssociation
      author { __typename login }
      comments(first: 3) { nodes { createdAt author { __typename login } } }
    }
  }
  mergedPrs: pullRequests(states: MERGED, first: 30, orderBy: {field: UPDATED_AT, direction: DESC}) {
    nodes { createdAt mergedAt authorAssociation author { __typename login } }
  }
}`;

/** One request for `n` repositories of the same owner: variables $owner, $n0..$n{n-1}; aliases r0..r{n-1}. */
export function buildContribQuery(n) {
  const vars = ["$owner: String!", ...Array.from({ length: n }, (_, i) => `$n${i}: String!`)].join(", ");
  const fields = Array.from({ length: n }, (_, i) => `  r${i}: repository(owner: $owner, name: $n${i}) { ...RepoContrib }`).join("\n");
  return `query(${vars}) {\n  rateLimit { limit cost remaining resetAt }\n${fields}\n}\n${CONTRIB_FRAGMENT}`;
}

// ---------------------------------------------------------------- parsing & scoring

const TEAM = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
const OUTSIDE = new Set(["CONTRIBUTOR", "FIRST_TIMER", "FIRST_TIME_CONTRIBUTOR", "NONE"]);
const BOT_LOGIN = /\[bot\]$|^(dependabot|renovate|github-actions|imgbot|snyk-bot|greenkeeper|mergify|codecov|allcontributors)/i;
export const BEGINNER_LABEL = /good[\s_-]*first|first[\s_-]*timers?|help[\s_-]*wanted|beginner|starter|easy|初心者|初学者|簡単|やさしい|入門/i;
const JAPANESE = /[぀-ヿ㐀-鿿]/;

export const isBot = (author) => !!author && (author.__typename === "Bot" || BOT_LOGIN.test(author.login || ""));
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const round1 = (x) => (x == null ? null : Math.round(x * 10) / 10);

export function issuesOf(node) {
  return (node.openIssues?.nodes || []).filter(Boolean).map((i) => {
    const labels = (i.labels?.nodes || []).map((l) => l?.name).filter(Boolean);
    return {
      repo: node.name, number: i.number, title: i.title, createdAt: i.createdAt, updatedAt: i.updatedAt,
      labels, comments: i.comments?.totalCount || 0,
      assigned: (i.assignees?.totalCount || 0) > 0,
      linkedPr: (i.linkedPrs?.totalCount || 0) > 0,
      byOutsider: !TEAM.has(i.authorAssociation),
      beginner: labels.some((l) => BEGINNER_LABEL.test(l)),
      ja: JAPANESE.test(i.title || ""),
    };
  });
}

/** Contribution statistics for one repository (GraphQL node + the stored repo record for license / push date). */
export function repoStats(node, repo = {}, now = Date.now()) {
  const yearAgo = now - 365 * DAY;
  const merged = (node.mergedPrs?.nodes || []).filter((p) => p && p.mergedAt);
  const outside = merged.filter((p) => OUTSIDE.has(p.authorAssociation) && p.author && !isBot(p.author)
    && Date.parse(p.mergedAt) > yearAgo);
  const humanMergedYear = merged.filter((p) => !isBot(p.author) && Date.parse(p.mergedAt) > yearAgo).length;

  // Replies to issues opened by outsiders in the last year (skip unanswered issues younger than 7 days).
  const replyHours = [];
  let considered = 0;
  for (const i of node.recentIssues?.nodes || []) {
    if (!i || TEAM.has(i.authorAssociation) || isBot(i.author) || Date.parse(i.createdAt) < yearAgo) continue;
    const author = (i.author?.login || "").toLowerCase();
    const reply = (i.comments?.nodes || []).find((c) => c?.author && !isBot(c.author) && c.author.login.toLowerCase() !== author);
    if (!reply && now - Date.parse(i.createdAt) < 7 * DAY) continue;
    considered++;
    if (reply) replyHours.push(Math.max(0, (Date.parse(reply.createdAt) - Date.parse(i.createdAt)) / 3600000));
  }

  const issues = issuesOf(node);
  const stats = {
    openIssues: node.openIssues?.totalCount || 0,
    beginnerIssues: issues.filter((i) => i.beginner && !i.assigned && !i.linkedPr).length,
    outsideMerged: outside.length,
    outsideAuthors: new Set(outside.map((p) => p.author.login.toLowerCase())).size,
    lastOutsideMerge: outside.map((p) => p.mergedAt).sort().pop() || null,
    medianMergeDays: round1(median(outside.map((p) => (Date.parse(p.mergedAt) - Date.parse(p.createdAt)) / DAY))),
    humanMergedYear,
    outsideIssues: considered,
    replyRate: considered ? round1(replyHours.length / considered) : null,
    medianReplyHours: round1(median(replyHours)),
    hasContributing: !!node.contributingGuidelines,
    license: repo.license || null,
  };
  return { ...stats, ...welcomeScore(stats, repo, now) };
}

/** 0-100 "welcomes outside contributions" score with the signals that produced it. */
export function welcomeScore(s, repo = {}, now = Date.now()) {
  const signals = [];
  const add = (points, label, short) => signals.push({ label, short, points });   // short: chip text, label: tooltip
  const prs = `${s.outsideMerged} outside PR${s.outsideMerged === 1 ? "" : "s"} merged in 12 months`;
  if (s.outsideMerged >= 10) add(35, prs, `${s.outsideMerged} outside PRs`);
  else if (s.outsideMerged >= 3) add(25, prs, `${s.outsideMerged} outside PRs`);
  else if (s.outsideMerged >= 1) add(15, prs, `${s.outsideMerged} outside PR${s.outsideMerged === 1 ? "" : "s"}`);
  else if (s.humanMergedYear >= 10) add(-10, "Only team PRs merged in 12 months", "team PRs only");
  if (s.outsideAuthors >= 5) add(15, `${s.outsideAuthors} outside contributors`, `${s.outsideAuthors} people`);
  else if (s.outsideAuthors >= 2) add(8, `${s.outsideAuthors} outside contributors`, `${s.outsideAuthors} people`);
  if (s.outsideIssues >= 2 && s.replyRate != null) {
    const pct = Math.round(s.replyRate * 100);
    if (s.replyRate >= 0.7) add(15, `Replies to ${pct}% of outside issues`, `${pct}% replied`);
    else if (s.replyRate >= 0.4) add(8, `Replies to ${pct}% of outside issues`, `${pct}% replied`);
    else add(-5, `Replies to only ${pct}% of outside issues`, `${pct}% replied`);
    if (s.medianReplyHours != null && s.medianReplyHours <= 72) {
      const t = s.medianReplyHours < 24 ? `${Math.max(1, Math.round(s.medianReplyHours))} h` : `${Math.round(s.medianReplyHours / 24)} d`;
      add(5, `First reply in ~${t} (median)`, `reply ~${t}`);
    }
  }
  if (s.hasContributing) add(10, "CONTRIBUTING guide", "CONTRIBUTING");
  if (s.license && s.license !== "NOASSERTION") add(5, `License ${s.license}`, s.license);
  if (s.beginnerIssues >= 1) add(10, `${s.beginnerIssues} open beginner issue${s.beginnerIssues > 1 ? "s" : ""}`, `${s.beginnerIssues} beginner`);
  if (repo.pushedAt && now - Date.parse(repo.pushedAt) < 90 * DAY) add(5, "Pushed in the last 3 months", "active");
  const score = Math.max(0, Math.min(100, signals.reduce((a, x) => a + x.points, 0)));
  return { score, signals };
}

// ---------------------------------------------------------------- job phase

/** Repositories worth checking: not archived, pushed within ACTIVE_DAYS; most recent first, capped. */
export function activeRepos(repos, now = Date.now()) {
  return (repos || [])
    .filter((r) => !r.archived && r.pushedAt && now - Date.parse(r.pushedAt) < ACTIVE_DAYS * DAY)
    .sort((a, b) => (b.pushedAt || "").localeCompare(a.pushedAt || ""))
    .slice(0, MAX_REPOS_PER_ORG);
}

/** Switch a collection job to its contribution phase (for the orgs collected successfully in phase 1). */
export async function planContrib({ store, job, log, now = Date.now() }) {
  const items = job.collected || [];
  const lists = items.length ? await store.mget(items.map((i) => `repos:${i.key}`)) : [];
  job.contribQueue = [];
  for (const [n, item] of items.entries()) {
    const names = activeRepos(lists[n], now).map((r) => r.name);
    if (names.length) job.contribQueue.push({ ...item, repos: names, pos: 0, size: 0 });
    else await store.set(`contrib:${item.key}`, { fetchedAt: nowIso(), repos: {}, issues: [] });
  }
  job.phase = "contrib";
  job.done = 0;
  job.total = job.contribQueue.reduce((a, i) => a + i.repos.length, 0);
  job.result.issues = 0;
  job.result.checkedRepos = 0;
  log(`Checking open issues and outside contributions in ${job.total} active repositories`);
}

/** Work through job.contribQueue in batches until it is empty or `latestStart` passes. */
export async function stepContrib({ store, client, job, latestStart, log, stopped, save }) {
  while (job.contribQueue.length) {
    if (await stopped()) throw new StoppedError();
    if (Date.now() > latestStart) return;
    if (client.graphqlLow()) throw new RateLimitError("GraphQL points almost used up", client.rate.graphql.reset * 1000);
    const item = job.contribQueue[0];
    job.current = `Issues & contributions: ${item.company} / ${item.login}`;
    const names = item.repos.slice(item.pos, item.pos + BATCH_SIZES[item.size]);
    let data = null;
    try {
      const variables = { owner: item.login };
      names.forEach((name, i) => { variables[`n${i}`] = name; });
      data = await client.graphql(buildContribQuery(names.length), variables, { retries: 1 });
    } catch (err) {
      if (err instanceof AuthError || err instanceof RateLimitError) throw err;
      if (err instanceof TransientError && item.size + 1 < BATCH_SIZES.length) {
        item.size++;
        log(`${item.login}: GitHub timed out, retrying with ${BATCH_SIZES[item.size]} repositories per request`);
        continue;
      }
      if (!(err instanceof GitHubError)) throw err;
      log(`${item.login}: skipped ${names.join(", ")} - ${err.message}`);
    }

    const wipKey = `contrib-wip:${item.key}`;
    const wip = (item.pos > 0 && (await store.get(wipKey))) || { startedAt: nowIso(), repos: {}, issues: [] };
    if (data) {
      const repoList = (await store.get(`repos:${item.key}`)) || [];
      const byName = new Map(repoList.map((r) => [r.name.toLowerCase(), r]));
      names.forEach((name, i) => {
        const node = data[`r${i}`];
        if (!node) return;
        wip.repos[node.name] = repoStats(node, byName.get(node.name.toLowerCase()) || {});
        wip.issues.push(...issuesOf(node));
      });
    }
    item.pos += names.length;
    job.done += names.length;
    if (item.pos >= item.repos.length) {
      wip.fetchedAt = nowIso();
      await store.set(`contrib:${item.key}`, wip);
      await store.del(wipKey);
      job.contribQueue.shift();
      job.result.issues += wip.issues.length;
      job.result.checkedRepos += Object.keys(wip.repos).length;
      log(`${item.login}: ${Object.keys(wip.repos).length} active repositories checked, ${wip.issues.length} open issues`);
    } else {
      await store.set(wipKey, wip);
    }
    await save();
  }
}
