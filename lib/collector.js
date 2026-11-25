// Collect repository statistics for tracked GitHub organizations, one organization at a time,
// so a collection can be split across many short serverless invocations.
// Phase "repos" fetches every organization's repositories; phase "contrib" (lib/contrib.js) then checks
// open issues and outside contributions in the active ones.
import { planContrib, stepContrib } from "./contrib.js";
import { AuthError, GitHubError, NotFoundError, RateLimitError, TransientError } from "./github.js";
import { nowIso, StoppedError } from "./util.js";

export { StoppedError };

// Every connection has an explicit `first` (GitHub requires 1-100). Only totalCount is read,
// so `first: 1` keeps the query cheap. Validated against GitHub's published GraphQL schema.
export const ORG_QUERY = `
query($login: String!, $first: Int!, $after: String) {
  rateLimit { limit cost remaining resetAt }
  organization(login: $login) {
    login name description websiteUrl location email isVerified avatarUrl url
    repositories(first: $first, after: $after, privacy: PUBLIC, isFork: false,
                 orderBy: {field: PUSHED_AT, direction: DESC}) {
      totalCount
      pageInfo { hasNextPage endCursor }
      nodes {
        databaseId name nameWithOwner description url homepageUrl
        isArchived isTemplate isMirror
        primaryLanguage { name }
        stargazerCount forkCount
        createdAt pushedAt updatedAt
        licenseInfo { spdxId }
        defaultBranchRef { name }
        repositoryTopics(first: 10) { nodes { topic { name } } }
        branches: refs(refPrefix: "refs/heads/", first: 1) { totalCount }
        openIssues: issues(states: OPEN, first: 1) { totalCount }
        closedIssues: issues(states: CLOSED, first: 1) { totalCount }
        openPullRequests: pullRequests(states: OPEN, first: 1) { totalCount }
      }
    }
  }
}`;

export const PAGE_SIZES = [50, 25, 10];

const count = (node, key) => Number(node?.[key]?.totalCount) || 0;

export function toRepo(n) {
  return {
    id: n.databaseId,
    name: n.name,
    fullName: n.nameWithOwner,
    description: n.description || null,
    url: n.url,
    homepage: n.homepageUrl || null,
    language: n.primaryLanguage?.name || null,
    topics: (n.repositoryTopics?.nodes || []).map((t) => t?.topic?.name).filter(Boolean),
    license: n.licenseInfo?.spdxId || null,
    defaultBranch: n.defaultBranchRef?.name || null,
    stars: n.stargazerCount || 0,
    forks: n.forkCount || 0,
    archived: !!n.isArchived,
    template: !!n.isTemplate,
    branches: count(n, "branches"),
    openIssues: count(n, "openIssues"),
    closedIssues: count(n, "closedIssues"),
    openPrs: count(n, "openPullRequests"),
    createdAt: n.createdAt || null,
    pushedAt: n.pushedAt || null,
  };
}

/** All public, non-fork repositories of one organization. Shrinks the page size when GitHub times out. */
export async function fetchOrg(client, login, { log = () => {} } = {}) {
  let sizeIndex = 0;
  let after = null;
  let org = null;
  const repos = [];
  for (;;) {
    let data;
    try {
      data = await client.graphql(ORG_QUERY, { login, first: PAGE_SIZES[sizeIndex], after }, { retries: 1 });
    } catch (err) {
      if (err instanceof TransientError && sizeIndex + 1 < PAGE_SIZES.length) {
        sizeIndex++;
        log(`${login}: GitHub timed out, retrying with ${PAGE_SIZES[sizeIndex]} repos per page`);
        continue;
      }
      throw err;
    }
    const node = data.organization;
    if (!node) throw new NotFoundError(`No GitHub organization named '${login}'`);
    org = org || node;
    const conn = node.repositories;
    repos.push(...conn.nodes.filter((n) => n && n.databaseId));
    if (!conn.pageInfo.hasNextPage) return { org: { ...org, repoTotal: conn.totalCount }, repos };
    after = conn.pageInfo.endCursor;
  }
}

export function companyTotals(repoLists) {
  const t = { repos: 0, branches: 0, openIssues: 0, closedIssues: 0, openPrs: 0, stars: 0 };
  for (const list of repoLists) {
    for (const r of list || []) {
      if (r.archived) continue;
      t.repos++;
      t.branches += r.branches;
      t.openIssues += r.openIssues;
      t.closedIssues += r.closedIssues;
      t.openPrs += r.openPrs;
      t.stars += r.stars;
    }
  }
  return t;
}

/** Append this company's current totals (archived excluded) to its trend history. */
export async function snapshotCompany(store, companyId) {
  const orgs = await store.hgetall("orgs");
  const keys = Object.entries(orgs).filter(([, o]) => o.companyId === companyId && o.status === "ok").map(([key]) => key);
  if (!keys.length) return;
  const lists = await store.mget(keys.map((key) => `repos:${key}`));
  await store.rpush(`snapshots:${companyId}`, { t: nowIso(), ...companyTotals(lists) });
  await store.ltrim(`snapshots:${companyId}`, -400, -1);
}

export function planCollect(companies, orgs, companyIds = null) {
  const only = companyIds && companyIds.length ? new Set(companyIds.map(Number)) : null;
  const queue = Object.entries(orgs)
    .filter(([, o]) => companies[o.companyId] && (!only || only.has(o.companyId)))
    .map(([key, o]) => ({ key, login: o.login, companyId: o.companyId, company: companies[o.companyId].name }))
    .sort((a, b) => a.company.localeCompare(b.company) || a.login.localeCompare(b.login));
  const pending = {};
  for (const item of queue) pending[item.companyId] = (pending[item.companyId] || 0) + 1;
  return { queue, pending, total: queue.length, phase: "repos", collected: [], contribQueue: [],
    result: { orgs: queue.length, ok: 0, notFound: 0, errors: 0, repos: 0 } };
}

async function updateOrg(store, key, changes) {
  const current = (await store.hget("orgs", key)) || {};
  await store.hset("orgs", { [key]: { ...current, ...changes } });
}

/**
 * Advance a collection job: first the repository queue, then the contribution phase.
 * Jobs started before the contribution phase existed (no `collected` list) finish after phase one.
 */
export async function stepCollect(ctx) {
  const { job } = ctx;
  await stepRepos(ctx);
  if (job.queue.length || !job.collected) return;
  if (job.phase !== "contrib") {
    if (Date.now() > ctx.latestStart) return;
    await planContrib(ctx);
    await ctx.save();
  }
  await stepContrib(ctx);
}

/**
 * Work through job.queue until it is empty or `latestStart` passes (an org is only started while there
 * is enough time left to finish it). Saves progress after every organization.
 */
async function stepRepos({ store, client, job, latestStart, log, stopped, save }) {
  while (job.queue.length) {
    if (await stopped()) throw new StoppedError();
    if (Date.now() > latestStart) return;
    if (client.graphqlLow()) throw new RateLimitError("GraphQL points almost used up", client.rate.graphql.reset * 1000);
    const item = job.queue[0];
    job.current = `${item.company} / ${item.login}`;
    try {
      const { org, repos } = await fetchOrg(client, item.login, { log });
      await store.set(`repos:${item.key}`, repos.map(toRepo));
      await updateOrg(store, item.key, {
        name: org.name || null, description: org.description || null, websiteUrl: org.websiteUrl || null,
        location: org.location || null, email: org.email || null, isVerified: !!org.isVerified,
        avatarUrl: org.avatarUrl || null, url: org.url || null, repoTotal: org.repoTotal,
        status: "ok", error: null, fetchedAt: nowIso(),
      });
      job.result.ok++;
      job.result.repos += repos.length;
      job.collected?.push({ key: item.key, login: item.login, companyId: item.companyId, company: item.company });
      log(`${item.login}: ${repos.length} public repositories`);
    } catch (err) {
      if (err instanceof NotFoundError) {
        await store.del(`repos:${item.key}`, `contrib:${item.key}`, `contrib-wip:${item.key}`);
        await updateOrg(store, item.key, { status: "not_found", error: err.message, fetchedAt: nowIso() });
        job.result.notFound++;
        log(`${item.login}: not found on GitHub`);
      } else if (err instanceof AuthError || err instanceof RateLimitError || err instanceof StoppedError) {
        throw err;   // the org stays at the head of the queue and is retried after the pause
      } else if (err instanceof GitHubError) {
        await updateOrg(store, item.key, { status: "error", error: err.message.slice(0, 300), fetchedAt: nowIso() });
        job.result.errors++;
        log(`${item.login}: failed - ${err.message}`);
      } else {
        throw err;
      }
    }
    job.queue.shift();
    job.done++;
    job.pending[item.companyId]--;
    if (job.pending[item.companyId] === 0) await snapshotCompany(store, item.companyId);
    await save();
  }
}

export const collectFinished = (job) => job.queue.length === 0
  && (!job.collected || (job.phase === "contrib" && !job.contribQueue?.length));
