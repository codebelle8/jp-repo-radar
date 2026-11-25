// Run: npm test
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { SEED_COMPANIES } from "../seed/companies.js";
import { createCompany, deleteCompany, importSeed, updateCompany } from "../lib/companies.js";
import { ORG_QUERY } from "../lib/collector.js";
import { buildEnrichQuery, repoRanges, scoreOrg } from "../lib/discovery.js";
import { createGitHubClient, AuthError, GitHubError } from "../lib/github.js";
import { getJob, recentRuns, requestStop, startJob, stepJob } from "../lib/jobs.js";
import { companiesCsv, companyDetail, companyStats, listCandidates, loadContribData, loadData, searchIssues, searchRepos, summary, welcoming } from "../lib/queries.js";
import { activeRepos, buildContribQuery, issuesOf, repoStats } from "../lib/contrib.js";
import { addIssue, buildSyncQuery, setApplication, syncTracker, trackerView, updateItem } from "../lib/tracker.js";
import { detectLanguages, matchStack, setSkills, skillsView, withRelated, yourLanguages } from "../lib/skills.js";
import { createRedisStore } from "../lib/store-redis.js";
import { createPostgresStore } from "../lib/store-postgres.js";
import { validLogin } from "../lib/util.js";
import { contribNode, FakeGitHub, makeRepo, profile, startFakeUpstash, tempStore } from "./helpers.mjs";

process.env.GITHUB_TOKEN = "test-token";
const noSleep = async () => {};
const step = (store, fake, extra = {}) => stepJob(store, { budgetMs: 60000, fetchImpl: fake.fetch, sleepImpl: noSleep, searchIntervalMs: 0, ...extra });
async function runToEnd(store, fake, extra) {
  for (let i = 0; i < 200; i++) {
    const r = await step(store, fake, extra);
    if (!r.job || r.job.status !== "running" || r.waiting) return r;
  }
  throw new Error("job did not finish");
}

// ---------------------------------------------------------------- seed & companies
describe("seed and companies", () => {
  let store;
  beforeEach(() => { store = tempStore(); });
  afterEach(() => store.cleanup());

  it("seed list has unique, valid logins and slugs", () => {
    const logins = SEED_COMPANIES.flatMap((c) => c.orgs.map((o) => o.toLowerCase()));
    assert.equal(new Set(logins).size, logins.length);
    assert.ok(logins.every(validLogin));
    assert.equal(new Set(SEED_COMPANIES.map((c) => c.slug)).size, SEED_COMPANIES.length);
  });

  it("imports the seed once and never duplicates", async () => {
    const first = await importSeed(store);
    assert.equal(first.companiesAdded, SEED_COMPANIES.length);
    assert.ok(first.orgsAdded > first.companiesAdded);
    assert.deepEqual(await importSeed(store), { companiesAdded: 0, orgsAdded: 0 });
    const ly = companyStats(await loadData(store)).find((c) => c.slug === "ly-corporation");
    assert.deepEqual(ly.orgs.map((o) => o.login).sort(), ["line", "lycorp-jp", "yahoojapan"]);
  });

  it("validates logins and refuses an org owned by another company", async () => {
    const a = await createCompany(store, { name: "A KK", orgs: "a-org, a-org2" });
    await assert.rejects(createCompany(store, { name: "B", orgs: ["a-org"] }), /already assigned to A KK/);
    await assert.rejects(createCompany(store, { name: "C", orgs: ["not a login!"] }), /not a valid GitHub login/);
    await assert.rejects(createCompany(store, { name: "  ", orgs: [] }), /name is required/);
    await updateCompany(store, a.id, { orgs: ["a-org"], nameJa: "テスト株式会社", website: "javascript:alert(1)" });
    const data = await loadData(store);
    assert.deepEqual(Object.keys(data.orgs), ["a-org"]);
    assert.equal(data.companies[a.id].nameJa, "テスト株式会社");
    assert.equal(data.companies[a.id].website, null, "non-http URLs are dropped");
    await deleteCompany(store, a.id);
    assert.deepEqual(await store.hgetall("orgs"), {});
  });
});

// ---------------------------------------------------------------- collection
describe("collection", () => {
  let store, fake, acme;
  beforeEach(async () => {
    store = tempStore();
    fake = new FakeGitHub();
    acme = await createCompany(store, { name: "Acme", orgs: ["acme", "acme-oss", "ghost-org"], segment: "SaaS" });
    const repos = Array.from({ length: 60 }, (_, i) => makeRepo(i + 1, "acme", `r${i + 1}`,
      { branches: i + 1, openIssues: 2, closedIssues: 3, prs: 1, stars: 10 }));
    repos.push(makeRepo(999, "acme", "old", { branches: 7, openIssues: 5, archived: true }));
    fake.addOrg("acme", repos, { websiteUrl: "https://acme.co.jp" });
    fake.addOrg("acme-oss", [makeRepo(1001, "acme-oss", "lib", { branches: 4, openIssues: 1, lang: "Go" })]);
  });
  afterEach(() => store.cleanup());

  it("sums branches and issues across all orgs of a company", async () => {
    await startJob(store, "collect");
    const { job } = await runToEnd(store, fake);
    assert.equal(job.status, "done");
    // No contribution data in the fake for these repositories: checked but nothing found.
    assert.deepEqual(job.result, { orgs: 3, ok: 2, notFound: 1, errors: 0, repos: 62, issues: 0, checkedRepos: 0 });
    const data = await loadData(store);
    const s = companyStats(data)[0];
    assert.equal(s.repos, 61);   // archived excluded by default
    assert.equal(s.branches, (60 * 61) / 2 + 4);
    assert.equal(s.openIssues, 121);
    assert.equal(s.closedIssues, 180);
    assert.equal(s.openPrs, 60);
    const all = companyStats(data, { includeArchived: true })[0];
    assert.equal(all.repos, 62);
    assert.equal(all.branches, s.branches + 7);
    assert.equal(data.orgs["ghost-org"].status, "not_found");
    assert.equal(data.orgs.acme.websiteUrl, "https://acme.co.jp");
    const detail = await companyDetail(store, data, acme.id);
    assert.equal(detail.snapshots.length, 1);
    assert.equal(detail.snapshots[0].openIssues, 121);
    assert.equal((await recentRuns(store))[0].status, "done");
  });

  it("splits work across steps when the time budget is short", async () => {
    await startJob(store, "collect");
    // latestStart = start + 1 s and each GitHub call takes 1.1 s, so the step stops after one org.
    const slowFetch = async (...args) => { await new Promise((r) => setTimeout(r, 1100)); return fake.fetch(...args); };
    const first = await stepJob(store, { budgetMs: 20001, fetchImpl: slowFetch, sleepImpl: noSleep });
    assert.equal(first.job.status, "running");
    assert.ok(first.job.done >= 1 && first.job.done < 3);
    const { job } = await runToEnd(store, fake);
    assert.equal(job.status, "done");
    assert.equal(job.result.ok, 2);
  });

  it("removes repositories that disappeared since the last run", async () => {
    await startJob(store, "collect");
    await runToEnd(store, fake);
    fake.orgs.get("acme").repos.splice(10);
    await startJob(store, "collect");
    await runToEnd(store, fake);
    const data = await loadData(store);
    assert.equal(data.reposByOrg.acme.length, 10);
    assert.equal((await store.lrange(`snapshots:${acme.id}`, 0, -1)).length, 2);
  });

  it("shrinks the page size when GitHub times out", async () => {
    fake.failSizes = { 50: 4 };
    await startJob(store, "collect");
    const { job } = await runToEnd(store, fake);
    assert.equal(job.result.ok, 2);
    assert.equal(companyStats(await loadData(store))[0].repos, 61);
  });

  it("pauses for a long rate limit and resumes later", async () => {
    await startJob(store, "collect");
    fake.rateLimitSeconds = 600;
    const paused = await step(store, fake);
    assert.equal(paused.job.status, "running");
    assert.ok(paused.job.waitUntil > Date.now() + 500000);
    assert.ok((await step(store, fake)).waiting);
    const job = await getJob(store);
    job.waitUntil = Date.now() - 1;   // pretend the reset time passed
    await store.set("job", job);
    const done = await runToEnd(store, fake);
    assert.equal(done.job.status, "done");
  });

  it("refuses a second job and can be stopped", async () => {
    await startJob(store, "collect");
    await assert.rejects(startJob(store, "collect"), /already running/);
    assert.deepEqual(await requestStop(store), { stopping: true });
    assert.equal((await getJob(store)).status, "stopped");
  });

  it("only one step runs at a time", async () => {
    await startJob(store, "collect");
    assert.ok(await store.lock("step", 60000));
    assert.ok((await step(store, fake)).busy);
    await store.unlock("step");
  });

  it("collects a single company when asked", async () => {
    const other = await createCompany(store, { name: "Other", orgs: ["other-org"] });
    await startJob(store, "collect", { companyIds: [other.id] });
    await runToEnd(store, fake);
    const data = await loadData(store);
    assert.equal(data.orgs.acme.status, "pending");
    assert.equal(data.orgs["other-org"].status, "not_found");
  });
});

// ---------------------------------------------------------------- contribution data
describe("contribution data", () => {
  const NOW = Date.parse("2026-11-26T00:00:00Z");
  const user = (login) => ({ __typename: "User", login });
  const pr = (created, merged, assoc, author) => ({ createdAt: `${created}T00:00:00Z`, mergedAt: `${merged}T00:00:00Z`, authorAssociation: assoc, author });
  const issue = (created, assoc, author, comments = []) => ({ createdAt: created, authorAssociation: assoc, author: user(author),
    comments: { nodes: comments.map(([at, by]) => ({ createdAt: at, author: typeof by === "string" ? user(by) : by })) } });
  const welcomingNode = contribNode("web", {
    contributing: true,
    issues: [{ title: "ログイン画面の表示崩れ", labels: ["good first issue"] }, { labels: ["help wanted"], assigned: true },
      { labels: ["bug"], linkedPr: true, assoc: "MEMBER" }],
    merged: [
      pr("2026-10-01", "2026-10-03", "CONTRIBUTOR", user("alice")), pr("2026-09-01", "2026-09-05", "CONTRIBUTOR", user("bob")),
      pr("2026-08-01", "2026-08-02", "FIRST_TIME_CONTRIBUTOR", user("carol")), pr("2026-07-01", "2026-07-02", "CONTRIBUTOR", user("alice")),
      pr("2026-10-01", "2026-10-01", "NONE", { __typename: "Bot", login: "dependabot" }),   // bot: ignored
      pr("2026-10-01", "2026-10-02", "MEMBER", user("dave")),                               // team: not outside
      pr("2025-05-01", "2025-06-01", "CONTRIBUTOR", user("erin")),                          // older than a year
    ],
    recent: [
      issue("2026-11-01T00:00:00Z", "NONE", "x1", [["2026-11-01T10:00:00Z", "maint"]]),                      // reply after 10 h
      issue("2026-10-01T00:00:00Z", "CONTRIBUTOR", "x2", [["2026-10-01T01:00:00Z", "x2"], ["2026-10-03T02:00:00Z", "maint"]]), // 50 h (own comment ignored)
      issue("2026-09-01T00:00:00Z", "NONE", "x3"),                                                            // never answered
      issue("2026-11-24T00:00:00Z", "NONE", "x4"),                                                            // too new to judge: skipped
      issue("2026-10-10T00:00:00Z", "MEMBER", "staff"),                                                       // team issue: skipped
      issue("2026-10-15T00:00:00Z", "NONE", "x6", [["2026-10-15T00:01:00Z", { __typename: "Bot", login: "github-actions" }]]), // bot is not a reply
    ],
  });

  it("scores how welcoming a repository is from outside PRs, replies and setup", () => {
    const s = repoStats(welcomingNode, { license: "MIT", pushedAt: "2026-11-20T00:00:00Z" }, NOW);
    assert.equal(s.outsideMerged, 4);
    assert.equal(s.outsideAuthors, 3);
    assert.equal(s.lastOutsideMerge, "2026-10-03T00:00:00Z");
    assert.equal(s.medianMergeDays, 1.5);
    assert.equal(s.humanMergedYear, 5);
    assert.equal(s.outsideIssues, 4);
    assert.equal(s.replyRate, 0.5);
    assert.equal(s.medianReplyHours, 30);
    assert.equal(s.beginnerIssues, 1);
    assert.equal(s.openIssues, 3);
    assert.equal(s.hasContributing, true);
    // 25 (4 outside PRs) + 8 (3 people) + 8 (50% replies) + 5 (reply ~1 d) + 10 CONTRIBUTING + 5 license + 10 beginner + 5 recent push
    assert.equal(s.score, 76);
    assert.equal(s.signals.length, 8);
  });

  it("penalises repositories that only merge their own team's pull requests", () => {
    const team = contribNode("internal", { merged: Array.from({ length: 12 }, (_, i) => pr("2026-10-01", "2026-10-02", "MEMBER", user(`s${i}`))) });
    const s = repoStats(team, { license: "MIT", pushedAt: "2025-01-01T00:00:00Z" }, NOW);
    assert.equal(s.outsideMerged, 0);
    assert.equal(s.score, 0);   // -10 + 5, clamped
    assert.ok(s.signals.some((x) => x.points === -10));
  });

  it("describes open issues: Japanese, beginner labels, assignment, linked PRs", () => {
    const [a, b, c] = issuesOf(welcomingNode);
    assert.deepEqual([a.ja, a.beginner, a.assigned, a.linkedPr, a.byOutsider], [true, true, false, false, true]);
    assert.deepEqual([b.ja, b.beginner, b.assigned], [false, true, true]);
    assert.deepEqual([c.linkedPr, c.byOutsider], [true, false]);
  });

  it("checks only active repositories and builds one aliased request per batch", () => {
    const repos = [makeRepo(1, "o", "new"), makeRepo(2, "o", "arch", { archived: true }), makeRepo(3, "o", "stale", { pushed: "2024-01-01T00:00:00Z" })]
      .map((n) => ({ name: n.name, archived: n.isArchived, pushedAt: n.pushedAt }));
    assert.deepEqual(activeRepos(repos, NOW).map((r) => r.name), ["new"]);
    const q = buildContribQuery(3);
    assert.ok(q.includes("$owner: String!") && q.includes("$n2: String!") && q.includes("r2: repository(owner: $owner, name: $n2)"));
    assert.ok(!q.includes("r3:"));
  });

  it("runs as the second phase of a collection and feeds the Contribute views", async () => {
    const store = tempStore();
    try {
      const fake = new FakeGitHub();
      const acme = await createCompany(store, { name: "Acme", orgs: ["acme"] });
      const beta = await createCompany(store, { name: "Beta", orgs: ["beta"] });
      fake.addOrg("acme", [...Array.from({ length: 12 }, (_, i) => makeRepo(i + 1, "acme", `r${i + 1}`)),
        makeRepo(50, "acme", "old", { archived: true }), makeRepo(51, "acme", "stale", { pushed: "2024-01-01T00:00:00Z" })]);
      fake.addOrg("beta", [makeRepo(60, "beta", "app")]);
      fake.contrib["acme/r1"] = { ...welcomingNode, name: "r1" };
      fake.contrib["acme/r2"] = contribNode("r2", { issues: [{ title: "Old question", updatedAt: "2024-01-01T00:00:00Z" }, { title: "Typo in README" }] });
      fake.contrib["beta/app"] = contribNode("app", { issues: [{ title: "Crash on start", labels: ["bug"] }] });
      fake.contribMaxBatch = 5;   // batches of 10 time out -> the job retries with 5

      await startJob(store, "collect");
      const { job } = await runToEnd(store, fake);
      assert.equal(job.status, "done");
      assert.equal(job.result.checkedRepos, 3);
      assert.equal(job.result.issues, 6);
      assert.ok(!fake.contribRequested.includes("old") && !fake.contribRequested.includes("stale"));
      assert.equal(fake.contribRequested.filter((n) => n === "r1").length, 1);
      assert.equal(await store.get("contrib-wip:acme"), null);
      assert.ok((await recentRuns(store))[0].detail.includes("6 open issues"));

      const data = await loadContribData(store);
      // Defaults hide the assigned issue, the one with a linked PR and the one not updated for 6 months.
      const def = searchIssues(data, {});
      assert.deepEqual(def.rows.map((i) => i.title).sort(), ["Crash on start", "Typo in README", "ログイン画面の表示崩れ"].sort());
      assert.equal(def.all, 6);
      assert.equal(searchIssues(data, { unassigned: false, noPr: false, activeMonths: 0 }).total, 6);
      assert.deepEqual(searchIssues(data, { beginner: true }).rows.map((i) => i.title), ["ログイン画面の表示崩れ"]);
      assert.deepEqual(searchIssues(data, { issueLang: "ja" }).rows.map((i) => i.title), ["ログイン画面の表示崩れ"]);
      assert.equal(searchIssues(data, { companyId: beta.id }).total, 1);
      const byWelcome = searchIssues(data, { sort: "welcome" }).rows;
      assert.equal(byWelcome[0].fullName, "acme/r1");
      assert.equal(byWelcome[0].url, "https://github.com/acme/r1/issues/1");

      const w = welcoming(data);
      assert.equal(w.repos[0].fullName, "acme/r1");
      assert.ok(w.repos[0].score >= 40);
      const acmeRow = w.companies.find((c) => c.id === acme.id);
      assert.deepEqual([acmeRow.checkedRepos, acmeRow.welcomingRepos, acmeRow.bestRepo, acmeRow.openIssues], [2, 1, "acme/r1", 3]);
      assert.equal(w.companies[0].id, acme.id);
    } finally {
      store.cleanup();
    }
  });
});

// ---------------------------------------------------------------- personal tracker
describe("tracker", () => {
  let store, fake, acme;
  beforeEach(async () => {
    store = tempStore();
    fake = new FakeGitHub();
    acme = await createCompany(store, { name: "Acme", orgs: ["acme"] });
  });
  afterEach(() => store.cleanup());
  const iss = (n) => `https://github.com/acme/web/issues/${n}`;
  const pr = (n, state, repo, closes = [], merged = state === "MERGED") => ({
    url: `https://github.com/${repo}/pull/${n}`, title: `PR ${n}`, state: merged ? "MERGED" : state, merged,
    createdAt: "2026-11-01T00:00:00Z", mergedAt: merged ? "2026-11-05T00:00:00Z" : null, closedAt: null,
    repository: { name: repo.split("/")[1], owner: { login: repo.split("/")[0] } },
    closingIssuesReferences: { nodes: closes.map((url) => ({ url })) },
  });

  it("tracks issues by link once, maps them to companies and rejects other links", async () => {
    const a = await addIssue(store, { url: "https://github.com/Acme/web/issues/12#issuecomment-1", title: "Fix login" });
    assert.equal(a.id, "acme:web:12");
    assert.equal(a.url, "https://github.com/Acme/web/issues/12");
    assert.equal(a.companyId, acme.id);
    assert.equal(a.stage, "watching");
    assert.equal((await addIssue(store, { url: "https://github.com/acme/web/issues/12" })).title, "Fix login");   // same issue
    await assert.rejects(addIssue(store, { url: "https://github.com/acme/web/pull/3" }), /pull request/);
    await assert.rejects(addIssue(store, { url: "https://example.com/acme/web/issues/1" }), /GitHub issue link/);
    const other = await addIssue(store, { url: "https://github.com/someone/lib/issues/1" });
    assert.deepEqual([other.companyId, other.title], [null, "someone/lib#1"]);
    await assert.rejects(updateItem(store, a.id, { stage: "won" }), /Unknown stage/);
    assert.equal((await updateItem(store, a.id, { notes: "  asked in Japanese  " })).notes, "asked in Japanese");
  });

  it("sync moves issues forward from your PRs and comments, never backwards", async () => {
    for (let n = 1; n <= 6; n++) await addIssue(store, { url: iss(n) });
    await updateItem(store, "acme:web:4", { stage: "dropped" });
    await updateItem(store, "acme:web:6", { stage: "merged" });   // set by hand
    fake.viewerData = {
      login: "tester",
      pullRequests: { nodes: [
        pr(1, "MERGED", "acme/web", [iss(1), iss(4)]), pr(2, "OPEN", "acme/web", [iss(3)]), pr(3, "MERGED", "acme/api"),
        pr(4, "OPEN", "tester/dotfiles"), pr(5, "MERGED", "other-org/x"),
      ] },
      issueComments: { nodes: [{ createdAt: "2026-11-02T00:00:00Z", issue: { url: iss(2) } }] },
    };
    fake.resources[iss(5)] = { url: iss(5), title: "Real title from GitHub", state: "CLOSED", closedAt: "2026-11-10T00:00:00Z" };
    const r = await syncTracker(store, { fetchImpl: fake.fetch, sleepImpl: noSleep });
    assert.deepEqual([r.viewer, r.prs], ["tester", 3]);

    const v = await trackerView(store);
    const stage = Object.fromEntries(v.items.map((i) => [i.number, i.stage]));
    assert.deepEqual(stage, { 1: "merged", 2: "commented", 3: "pr_open", 4: "dropped", 5: "watching", 6: "merged" });
    const five = v.items.find((i) => i.number === 5);
    assert.deepEqual([five.title, five.issueState], ["Real title from GitHub", "CLOSED"]);
    assert.equal(v.items.find((i) => i.number === 1).prState, "MERGED");
    assert.equal(v.items.find((i) => i.number === 4).prUrl, "https://github.com/acme/web/pull/1");   // linked, but stays dropped

    const row = v.companies.find((c) => c.id === acme.id);
    assert.deepEqual([row.mergedPrs, row.openPrs, row.trackedIssues, row.ready], [2, 1, 5, true]);
    assert.deepEqual([v.counts.mergedPrs, v.counts.openPrs, v.counts.ready], [2, 1, 1]);
    assert.ok(v.prs.every((p) => p.owner !== "tester" && p.owner !== "other-org"));

    await setApplication(store, acme.id, { stage: "applied", careersUrl: "acme.co.jp/careers" });
    const after = await trackerView(store);
    const row2 = after.companies.find((c) => c.id === acme.id);
    assert.deepEqual([row2.stage, row2.ready, row2.careersUrl, after.counts.activeApplications], ["applied", false, "https://acme.co.jp/careers", 1]);
    await assert.rejects(setApplication(store, acme.id, { stage: "hired?" }), /Unknown stage/);
    await assert.rejects(setApplication(store, acme.id, { careersUrl: "javascript:alert(1)" }), /http/);
    await assert.rejects(setApplication(store, 9999, { stage: "applied" }), /not found/);
  });

  it("syncs with nothing tracked and builds the lookup query", async () => {
    assert.deepEqual(await syncTracker(store, { fetchImpl: fake.fetch, sleepImpl: noSleep }).then((r) => [r.prs, r.updated]), [0, 0]);
    const q = buildSyncQuery(2);
    assert.ok(q.startsWith("query TrackerSync($u0: URI!, $u1: URI!)") && q.includes("u1: resource(url: $u1)"));
    assert.ok(buildSyncQuery(0).startsWith("query TrackerSync {"));
  });
});

// ---------------------------------------------------------------- skill match
describe("skill match", () => {
  let store, fake;
  beforeEach(() => { store = tempStore(); fake = new FakeGitHub(); });
  afterEach(() => store.cleanup());
  const langs = (total, ...pairs) => ({ languages: { totalSize: total, edges: pairs.map(([name, size]) => ({ size, node: { name } })) } });
  const repo = (name, language, o = {}) => ({ name, fullName: `x/${name}`, url: `https://github.com/x/${name}`, language, stars: 0,
    pushedAt: o.pushed || "2026-10-01T00:00:00Z", archived: !!o.archived, branches: 1, openIssues: 0, closedIssues: 0, openPrs: 0 });

  it("detects languages that make up 10%+ of a repository, plus repositories you contributed to", () => {
    const d = detectLanguages({
      repositories: { nodes: [langs(1000, ["TypeScript", 800], ["CSS", 150], ["Dockerfile", 50]), langs(100, ["Go", 95], ["Shell", 5]), langs(0)] },
      repositoriesContributedTo: { nodes: [{ primaryLanguage: { name: "Ruby" } }, { primaryLanguage: { name: "TypeScript" } }, { primaryLanguage: null }] },
    });
    assert.deepEqual(d.map((l) => [l.name, l.repos, l.contributed]), [["TypeScript", 1, 1], ["CSS", 1, 0], ["Go", 1, 0], ["Ruby", 0, 1]]);
    assert.deepEqual(yourLanguages({ detected: d, added: ["Kotlin", "go"], removed: ["css"] }), ["TypeScript", "Go", "Ruby", "Kotlin"]);
    assert.deepEqual(withRelated(["TypeScript", "Kotlin"]).sort(), ["Java", "JavaScript", "Kotlin", "Svelte", "TypeScript", "Vue"]);
  });

  it("scores a company's stack: your languages count fully, related ones half", () => {
    const stack = { repos: 10, recent: true, langs: [{ name: "TypeScript", repos: 5, share: 0.5 }, { name: "JavaScript", repos: 2, share: 0.2 },
      { name: "Go", repos: 2, share: 0.2 }, { name: "Rust", repos: 1, share: 0.1 }] };
    const m = matchStack(stack, ["typescript", "Python"]);
    assert.deepEqual([m.score, m.shared, m.related, m.missing], [60, ["TypeScript"], ["JavaScript"], ["Go", "Rust"]]);
    assert.equal(matchStack({ repos: 0, langs: [] }, ["Go"]), null);
  });

  it("syncs your languages, matches companies and suggests where to contribute", async () => {
    const now = Date.parse("2026-11-20T00:00:00Z");
    const acme = await createCompany(store, { name: "Acme", orgs: ["acme"] });
    const beta = await createCompany(store, { name: "Beta", orgs: ["beta"] });
    const gamma = await createCompany(store, { name: "Gamma", orgs: ["gamma"] });
    await store.set("repos:acme", [repo("web", "TypeScript"), repo("api", "Go"), repo("old", "Perl", { pushed: "2019-01-01T00:00:00Z" }), repo("app", "JavaScript")]);
    await store.set("repos:beta", [repo("core", "Rust"), repo("site", "TypeScript", { archived: true })]);
    await store.set("repos:gamma", [repo("legacy", "Go", { pushed: "2020-01-01T00:00:00Z" })]);   // nothing recent: all repositories count
    const issue = (repoName, n) => ({ repo: repoName, number: n, title: `Issue ${n}`, labels: [], assigned: false, linkedPr: false, beginner: false, ja: false,
      createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z", comments: 0 });
    const stats = (score) => ({ score, outsideMerged: 1, outsideAuthors: 1, beginnerIssues: 0, openIssues: 1, signals: [] });
    await store.set("contrib:acme", { fetchedAt: "2026-11-19T00:00:00Z", repos: { web: stats(70), api: stats(20), app: stats(10) },
      issues: [issue("web", 1), issue("api", 2), issue("app", 3)] });
    await store.set("contrib:beta", { fetchedAt: "2026-11-19T00:00:00Z", repos: { core: stats(90) }, issues: [issue("core", 1)] });

    assert.deepEqual((await skillsView(store, { now })).suggestions, [], "nothing to match before languages are known");
    fake.viewerData = { ...fake.viewerData, repositories: { nodes: [langs(100, ["TypeScript", 90])] }, repositoriesContributedTo: { nodes: [] } };
    const r = await syncTracker(store, { fetchImpl: fake.fetch, sleepImpl: noSleep });
    assert.equal(r.languages, 1);
    let v = await skillsView(store, { now });
    assert.deepEqual([v.viewer, v.languages, v.filterLanguages], ["tester", ["TypeScript"], ["TypeScript", "JavaScript", "Vue", "Svelte"]]);
    // Acme: TypeScript 1/3 + JavaScript (related) 1/6 = 50%; Perl is not recent. Beta: archived TypeScript ignored.
    assert.deepEqual([v.matches[acme.id].score, v.matches[beta.id].score, v.matches[gamma.id].score], [50, 0, 0]);
    assert.deepEqual(v.suggestions.map((s) => [s.name, s.match, s.fit, s.openIssues]), [["Acme", 50, 58, 3]]);

    v = await skillsView(await setSkills(store, { added: ["Go", "rust"], removed: ["TypeScript"] }).then(() => store), { now });
    assert.deepEqual(v.languages, ["Go", "rust"]);
    assert.deepEqual([v.matches[acme.id].score, v.matches[beta.id].score, v.matches[gamma.id].score], [33, 100, 100]);
    assert.deepEqual(v.suggestions.map((s) => s.name), ["Beta", "Acme"], "Gamma has no checked issues");
    await assert.rejects(setSkills(store, { added: ["<script>"] }), /not a language name/);
    await assert.rejects(setSkills(store, { added: "Go" }), /lists/);

    const data = await loadContribData(store);
    const found = searchIssues(data, { inLanguages: ["go", "Rust"], activeMonths: 0, now });
    assert.deepEqual(found.rows.map((i) => i.fullName).sort(), ["x/api", "x/core"]);
  });
});

// ---------------------------------------------------------------- queries
describe("queries", () => {
  let store;
  beforeEach(async () => {
    store = tempStore();
    const fake = new FakeGitHub();
    await createCompany(store, { name: "クックパッド Cookpad", nameJa: "クックパッド株式会社", orgs: ["cookpad"], segment: "Web" });
    fake.addOrg("cookpad", [makeRepo(1, "cookpad", "a", { branches: 3, openIssues: 4, lang: "Ruby" }),
      makeRepo(2, "cookpad", "b, with comma", { branches: 2, openIssues: 1, lang: "Swift" })]);
    await startJob(store, "collect");
    await runToEnd(store, fake);
  });
  afterEach(() => store.cleanup());

  it("summary, search and CSV", async () => {
    const data = await loadData(store);
    const s = summary(data);
    assert.equal(s.totals.repos, 2);
    assert.equal(s.totals.branches, 5);
    assert.equal(s.totals.companiesCollected, 1);
    assert.deepEqual(s.languages.map((l) => l.language), ["Ruby", "Swift"]);
    const r = searchRepos(data, { language: "Ruby", sort: "branches", dir: "asc" });
    assert.equal(r.total, 1);
    assert.equal(r.rows[0].fullName, "cookpad/a");
    assert.equal(searchRepos(data, { q: "COMMA" }).total, 1);
    const csv = companiesCsv(data, {});
    assert.ok(csv.startsWith("﻿"));
    assert.ok(csv.includes("クックパッド株式会社"));
  });
});

describe("candidate sorting", () => {
  const sig = (...points) => points.map((p, i) => ({ label: `s${i}`, points: p }));
  const all = {
    a: { login: "a", name: "Beta 株式会社", status: "pending", score: 90, repoTotal: 3, topLanguages: [["PHP", 2]], signals: sig(15, 15), lastPush: "2026-01-01T00:00:00Z" },
    b: { login: "b", name: "alpha", status: "pending", score: 60, repoTotal: 40, topLanguages: [["Go", 5]], signals: sig(15, 15, 20, -10), lastPush: "2026-11-01T00:00:00Z" },
    c: { login: "c", name: "", status: "pending", score: 75, repoTotal: 8, topLanguages: [], signals: sig(20), lastPush: null },
    d: { login: "d", name: "Gamma", status: "rejected", score: 99, repoTotal: 1, topLanguages: [["Ruby", 1]], signals: sig(5), lastPush: null },
    e: { login: "e", name: "  Delta", status: "pending", score: 10, repoTotal: 3, topLanguages: [["Astro", 1]], signals: sig(5), lastPush: "2025-05-01T00:00:00Z" },
  };
  const order = (opts) => listCandidates(all, opts).rows.map((r) => r.login);

  it("sorts every column both ways, keeps empty values last and breaks ties by score", () => {
    assert.deepEqual(order({}), ["a", "c", "b", "e"]);                                 // score desc by default
    assert.deepEqual(order({ sort: "score", dir: "asc" }), ["e", "b", "c", "a"]);
    assert.deepEqual(order({ sort: "name" }), ["b", "a", "c", "e"]);                   // asc first; "c" has no name → login
    assert.deepEqual(order({ sort: "repos" }), ["b", "c", "a", "e"]);                  // desc first; tie a/e → higher score first
    assert.deepEqual(order({ sort: "repos", dir: "asc" }), ["a", "e", "c", "b"]);
    assert.deepEqual(order({ sort: "language" }), ["e", "b", "a", "c"]);               // no language stays last
    assert.deepEqual(order({ sort: "language", dir: "desc" }), ["a", "b", "e", "c"]);
    assert.deepEqual(order({ sort: "signals" }), ["b", "a", "c", "e"]);                // positive signals only
    assert.deepEqual(order({ sort: "lastPush" }), ["b", "a", "e", "c"]);               // never pushed stays last
    assert.deepEqual(order({ sort: "lastPush", dir: "asc" }), ["e", "a", "b", "c"]);
    assert.deepEqual(order({ sort: "bogus", dir: "sideways" }), order({}));
  });

  it("filters before capping and reports totals", () => {
    const r = listCandidates(all, { sort: "lastPush", limit: 2 });
    assert.deepEqual(r.rows.map((x) => x.login), ["b", "a"]);
    assert.equal(r.total, 4);
    assert.deepEqual(r.counts, { pending: 4, approved: 0, rejected: 1 });
    assert.equal(r.dir, "desc");
    assert.deepEqual(order({ q: "ALPHA" }), ["b"]);
    assert.deepEqual(order({ status: "rejected" }), ["d"]);
    assert.deepEqual(order({ minScore: 70 }), ["a", "c"]);
  });

  it("hides organizations with no push in the last N months", () => {
    const now = Date.parse("2026-11-26T12:00:00Z");
    const r = listCandidates(all, { activeMonths: 6, now });                          // cutoff 2026-05-26T12:00Z
    assert.deepEqual(r.rows.map((x) => x.login), ["b"]);                              // a, e too old; c never pushed
    assert.equal(r.total, 1);
    assert.equal(r.hiddenInactive, 3);
    assert.deepEqual(order({ activeMonths: 12, now }), ["a", "b"]);
    assert.equal(listCandidates(all, { activeMonths: 0, now }).hiddenInactive, 0);
    // Exactly 6 months ago counts as "6 months or more" → hidden; one second later → shown.
    const edge = { x: { login: "x", status: "pending", score: 50, lastPush: "2026-05-26T12:00:00Z", signals: [] },
      y: { login: "y", status: "pending", score: 40, lastPush: "2026-05-26T12:00:01Z", signals: [] } };
    assert.deepEqual(listCandidates(edge, { activeMonths: 6, now }).rows.map((x) => x.login), ["y"]);
  });
});

// ---------------------------------------------------------------- discovery
describe("discovery", () => {
  const now = new Date("2026-11-25T00:00:00Z");
  let store, fake;
  beforeEach(() => { store = tempStore(); fake = new FakeGitHub(); });
  afterEach(() => store.cleanup());

  it("scores companies above communities and academic sites", () => {
    const company = scoreOrg(profile("webco", { name: "株式会社ウェブコ", websiteUrl: "https://webco.co.jp", isVerified: true }), now);
    const community = scoreOrg(profile("js-meetup", { description: "Tokyo JavaScript community 勉強会", langs: ["JavaScript"], total: 4 }), now);
    const lab = scoreOrg(profile("lab", { websiteUrl: "https://x.u-tokyo.ac.jp" }), now);
    assert.ok(company.score >= 80, `company scored ${company.score}`);
    assert.ok(community.score < 40, `community scored ${community.score}`);
    assert.ok(lab.signals.some((s) => s.label.startsWith("Academic")));
  });

  it("repo ranges cover everything from the minimum", () => {
    assert.deepEqual(repoRanges(3), ["3..5", "6..10", "11..20", "21..50", "51..100", ">=101"]);
    assert.deepEqual(repoRanges(8), ["8..10", "11..20", "21..50", "51..100", ">=101"]);
  });

  it("finds, scores and keeps decisions across runs", async () => {
    await createCompany(store, { name: "Tracked", orgs: ["tracked-co"] });
    fake.search = { Tokyo: ["webco", "tracked-co", "js-meetup"], Japan: ["webco"] };
    fake.profiles = { webco: profile("webco", { name: "株式会社ウェブコ", websiteUrl: "https://webco.co.jp" }),
      "js-meetup": profile("js-meetup", { description: "community" }) };
    await startJob(store, "discover", { locations: ["Tokyo", "Japan"] });
    const { job } = await runToEnd(store, fake);
    assert.equal(job.status, "done");
    assert.equal(job.result.new, 2);
    assert.equal(job.result.skippedTracked, 1);
    const cands = await store.hgetall("candidates");
    assert.ok(cands.webco.score > cands["js-meetup"].score);
    assert.deepEqual(await store.get("candidateCounts"), { pending: 2, approved: 0, rejected: 0 });

    await store.hset("candidates", { "js-meetup": { ...cands["js-meetup"], status: "rejected" } });
    await startJob(store, "discover", { locations: ["Tokyo"] });
    const again = await runToEnd(store, fake);
    assert.equal(again.job.result.updated, 2);
    assert.equal((await store.hget("candidates", "js-meetup")).status, "rejected");
  });

  it("splits searches over the 1,000-result cap", async () => {
    fake.search = { Tokyo: ["a-co"] };
    fake.searchTotals = { 'type:org location:"Tokyo" repos:>=3': 2500 };
    fake.profiles = { "a-co": profile("a-co") };
    await startJob(store, "discover", { locations: ["Tokyo"] });
    await runToEnd(store, fake);
    const searches = fake.calls.filter((u) => u.includes("/search/users")).map((u) => new URL(u).searchParams.get("q"));
    assert.ok(searches.some((q) => q.endsWith("repos:3..5")));
    assert.ok(searches.some((q) => q.endsWith("repos:>=101")));
  });
});

// ---------------------------------------------------------------- GitHub client
describe("GitHub client", () => {
  it("rejects a bad token and surfaces GraphQL errors", async () => {
    const bad = createGitHubClient({ token: "x", fetchImpl: async () => new Response('{"message":"Bad credentials"}', { status: 401 }) });
    await assert.rejects(bad.viewer(), AuthError);
    const broken = createGitHubClient({ token: "x", fetchImpl: async () =>
      new Response(JSON.stringify({ errors: [{ type: "INVALID", message: "Field 'x' doesn't exist" }] }), { status: 200 }) });
    await assert.rejects(broken.graphql("query { x }"), GitHubError);
    assert.throws(() => createGitHubClient({ token: "" }), AuthError);
  });

  it("builds the queries the schema check validated", () => {
    assert.ok(ORG_QUERY.includes('refs(refPrefix: "refs/heads/", first: 1)'));
    assert.ok(buildEnrichQuery(2).includes("o1: organization(login: $l1)"));
  });
});

// ---------------------------------------------------------------- Postgres driver (real Postgres engine via PGlite)
describe("Postgres driver", () => {
  it("supports every store operation and a full collection", async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    const db = new PGlite();
    const store = createPostgresStore({ query: async (text, params) => (await db.query(text, params)).rows });
    try {
      assert.equal(await store.get("missing"), null);
      await store.set("k", { a: 1, ja: "日本語" });
      assert.deepEqual(await store.get("k"), { a: 1, ja: "日本語" });
      assert.deepEqual(await store.mget(["k", "nope"]), [{ a: 1, ja: "日本語" }, null]);
      assert.equal(await store.incr("seq"), 1);
      assert.equal(await store.incr("seq"), 2);
      await store.hset("h", { x: { n: 1 }, y: [1, 2] });
      await store.hset("h", { x: { n: 2 } });
      assert.deepEqual(await store.hgetall("h"), { x: { n: 2 }, y: [1, 2] });
      assert.deepEqual(await store.hget("h", "y"), [1, 2]);
      await store.hdel("h", "y");
      assert.deepEqual(Object.keys(await store.hgetall("h")), ["x"]);
      assert.equal(await store.rpush("l", { t: 1 }, { t: 2 }), 2);
      assert.equal(await store.rpush("l", { t: 3 }), 3);
      await store.ltrim("l", -2, -1);
      assert.deepEqual(await store.lrange("l", 0, -1), [{ t: 2 }, { t: 3 }]);
      assert.ok(await store.lock("step", 60000));
      assert.equal(await store.lock("step", 60000), false);
      await store.unlock("step");
      assert.ok(await store.lock("step", 1));
      await new Promise((r) => setTimeout(r, 5));
      assert.ok(await store.lock("step", 1000), "expired lock can be taken over");
      await store.unlock("step");
      await store.del("k", "h");
      assert.equal(await store.get("k"), null);
      assert.deepEqual(await store.hgetall("h"), {});

      const fake = new FakeGitHub();
      fake.addOrg("cookpad", [makeRepo(1, "cookpad", "a", { branches: 3, openIssues: 4 }), makeRepo(2, "cookpad", "b", { branches: 2 })]);
      await importSeed(store, [{ slug: "cookpad", name: "Cookpad Inc.", nameJa: "クックパッド株式会社", orgs: ["cookpad", "ghost-org"] }]);
      await startJob(store, "collect");
      const { job } = await runToEnd(store, fake);
      assert.equal(job.status, "done");
      const stats = companyStats(await loadData(store))[0];
      assert.equal(stats.branches, 5);
      assert.equal(stats.openIssues, 4);
      assert.equal(stats.orgErrors, 1);
    } finally {
      await db.close();
    }
  });
});

// ---------------------------------------------------------------- Redis driver
describe("Upstash Redis driver", () => {
  it("runs a full collection against a Redis REST endpoint", async () => {
    const upstash = await startFakeUpstash();
    try {
      const store = createRedisStore({ url: upstash.url, token: upstash.token, prefix: "t:" });
      const fake = new FakeGitHub();
      fake.addOrg("cookpad", [makeRepo(1, "cookpad", "a", { branches: 3, openIssues: 4 })]);
      const c = await createCompany(store, { name: "Cookpad", orgs: ["cookpad"] });
      await store.rpush("l", 1, 2, 3, 4);
      await store.ltrim("l", -2, -1);
      assert.deepEqual(await store.lrange("l", 0, -1), [3, 4]);
      assert.ok(await store.lock("x", 1000));
      assert.equal(await store.lock("x", 1000), false);
      await startJob(store, "collect");
      const { job } = await runToEnd(store, fake);
      assert.equal(job.status, "done");
      const stats = companyStats(await loadData(store))[0];
      assert.equal(stats.id, c.id);
      assert.equal(stats.branches, 3);
      assert.ok([...upstash.kv.keys()].every((k) => k.startsWith("t:")));
    } finally {
      await upstash.close();
    }
  });
});
