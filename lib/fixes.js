// Auto-fix: paste an issue link, a Claude Managed Agents session fixes it in your fork, you review, then this app
// opens the pull request and watches it for reviews, CI and merges (in-app notifications).
//   fixes       : hash  id ("owner:repo:number", lower case) -> fix record
//   fixSessions : hash  session id -> fix id (webhooks name the session)
//   fixAgent    : {agentId, agentVersion, environmentId, revision}   (see fix-agent.js)
//   fixIdentity : {login, id, name, email}   the write token's GitHub account (commit author, noreply email)
// Messages stored on a fix are English templates {text, vars}; the browser translates them.
import Anthropic, { toFile } from "@anthropic-ai/sdk";
import {
  FIX_REVISION, FIX_RUBRIC, REPO_PATH, REVIEW_RUBRIC, ensureFixAgent, fixKickoff, issueFile, reviewFile, reviewKickoff,
} from "./fix-agent.js";
import { NotFoundError, createGitHubClient } from "./github.js";
import { notify } from "./notifications.js";
import { addIssue, parseIssueUrl } from "./tracker.js";
import { HttpError, cleanText, nowIso, sleep as defaultSleep } from "./util.js";

const KEY = "fixes";
const SESSIONS = "fixSessions";
const OPEN_PR = new Set(["pr_open", "reply_ready"]);
const RESTARTABLE = new Set(["blocked", "failed", "needs_attention", "cancelled", "closed"]);
const MAX_PATCH = 20000;
const MAX_FILES = 60;
const PR_GAP_MS = 24 * 3600 * 1000;    // one new pull request per company per day
export const WATCH_EVERY_MS = 2 * 60 * 1000;

const budgetCents = () => Math.max(50, Math.floor(Number(process.env.FIX_BUDGET_CENTS) || 500));
const consoleUrl = (sessionId) => `https://platform.claude.com/workspaces/${process.env.FIX_CONSOLE_WORKSPACE || "default"}/sessions/${sessionId}`;
const msg = (text, vars) => (vars ? { text, vars } : { text });

export function fixConfig() {
  return {
    anthropic: !!process.env.ANTHROPIC_API_KEY,
    writeToken: !!process.env.GITHUB_WRITE_TOKEN,
    webhook: !!process.env.ANTHROPIC_WEBHOOK_SIGNING_KEY,
    cron: !!process.env.CRON_SECRET,
    budgetCents: budgetCents(),
  };
}

export async function setupStatus(store) {
  const config = fixConfig();
  const agent = await store.get("fixAgent");
  return { ...config, agent: agent ? { ...agent, current: agent.revision === FIX_REVISION } : null,
    ready: config.anthropic && config.writeToken && !!agent };
}

function clients(opts = {}) {
  const anthropic = opts.anthropic || new Anthropic();
  const gh = opts.gh || createGitHubClient({ token: process.env.GITHUB_WRITE_TOKEN, ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
    sleep: opts.sleepImpl || defaultSleep });
  return { anthropic, gh, sleep: opts.sleepImpl || defaultSleep };
}

function requireConfig() {
  const c = fixConfig();
  if (!c.anthropic || !c.writeToken) throw new HttpError(400, "Auto-fix is not set up: add ANTHROPIC_API_KEY and GITHUB_WRITE_TOKEN to the environment variables.");
}

export async function setupFixAgent(store, opts = {}) {
  requireConfig();
  return ensureFixAgent(store, clients(opts).anthropic);
}

function touch(fix, status, note) {
  const at = nowIso();
  if (status) fix.status = status;
  fix.updatedAt = at;
  fix.history = [...(fix.history || []), { status: fix.status, at, ...(note ? { note } : {}) }].slice(-40);
  return fix;
}

async function save(store, fix) {
  await store.hset(KEY, { [fix.id]: fix });
  return fix;
}

export async function getFix(store, id) {
  const fix = await store.hget(KEY, id);
  if (!fix) throw new HttpError(404, "Auto-fix not found");
  return fix;
}

async function identity(store, gh) {
  const cached = await store.get("fixIdentity");
  if (cached?.login) return cached;
  const user = await gh.rest("GET", "/user");
  const record = { login: user.login, id: user.id, name: user.name || user.login, email: `${user.id}+${user.login}@users.noreply.github.com` };
  await store.set("fixIdentity", record);
  return record;
}

// ---------------------------------------------------------------- pre-check

export const PRECHECK_QUERY = `query FixPrecheck($owner: String!, $name: String!, $number: Int!) {
  rateLimit { limit cost remaining resetAt }
  repository(owner: $owner, name: $name) {
    nameWithOwner url isArchived stargazerCount
    defaultBranchRef { name }
    primaryLanguage { name }
    licenseInfo { spdxId name }
    contributingGuidelines { body url }
    aiPolicy: object(expression: "HEAD:AI_POLICY.md") { ... on Blob { text } }
    aiPolicyGithub: object(expression: "HEAD:.github/AI_POLICY.md") { ... on Blob { text } }
    issue(number: $number) {
      number title body state url createdAt
      author { login }
      assignees(first: 5) { nodes { login } }
      labels(first: 20) { nodes { name } }
      comments(last: 30) { totalCount nodes { author { login } body createdAt } }
      closedByPullRequestsReferences(first: 5, includeClosedPrs: false) { nodes { url state } }
    }
  }
}`;

const AI_WORDS = [/\bAI\b/, /\bLLMs?\b/, /\b(ChatGPT|Copilot|Claude|Gemini|Cursor)\b/i, /generative|machine[- ]generated|large language model/i, /生成\s*AI|人工知能|AI\s*(生成|ツール)/];
const CLAIM = /\b(I('| a)?m (working|looking) on|I('| wi)ll (take|work on|fix|look into)|I('d| would) like to (work|take)|can I (take|work on)|assign (this |it )?to me|working on (it|this))\b|取り組みます|対応します|やります|担当します|作業中です|着手します/i;

function aiMentions(sources) {
  const found = [];
  for (const [source, text] of sources) {
    if (!text) continue;
    for (const part of String(text).split(/(?<=[.!?。！？])\s+|\n+/)) {
      if (AI_WORDS.some((re) => re.test(part))) found.push({ source, excerpt: part.trim().slice(0, 240) });
      if (found.length >= 5) return found;
    }
  }
  return found;
}

export function evaluatePrecheck(data, { viewer, now = Date.now() } = {}) {
  const repo = data.repository;
  const problems = [];
  const warnings = [];
  if (!repo) return { problems: [msg("Repository not found.")], warnings };
  const issue = repo.issue;
  if (!issue) return { problems: [msg("Issue not found (pull requests cannot be auto-fixed).")], warnings, repo };
  if (repo.isArchived) problems.push(msg("The repository is archived."));
  if (issue.state !== "OPEN") problems.push(msg("The issue is already closed."));
  const assignees = (issue.assignees?.nodes || []).map((a) => a.login).filter((l) => l && l.toLowerCase() !== (viewer || "").toLowerCase());
  if (assignees.length) problems.push(msg("The issue is assigned to {who}.", { who: assignees.map((a) => `@${a}`).join(", ") }));
  const openPr = (issue.closedByPullRequestsReferences?.nodes || []).find((p) => p?.state === "OPEN");
  if (openPr) problems.push(msg("A pull request that closes this issue is already open: {url}", { url: openPr.url }));

  const recent = (issue.comments?.nodes || []).filter((c) => c?.body && now - Date.parse(c.createdAt) < 30 * 864e5
    && (c.author?.login || "").toLowerCase() !== (viewer || "").toLowerCase());
  const claim = [...recent].reverse().find((c) => CLAIM.test(c.body));
  if (claim) warnings.push(msg("Someone may already be working on it: @{who} commented on {date}.", { who: claim.author?.login || "?", date: claim.createdAt.slice(0, 10) }));
  if (!repo.licenseInfo || repo.licenseInfo.spdxId === "NOASSERTION") warnings.push(msg("The repository has no recognised license."));
  if (["Swift", "Objective-C"].includes(repo.primaryLanguage?.name)) warnings.push(msg("Swift and Objective-C projects often need macOS to build, which the sandbox does not have."));
  const mentions = aiMentions([["CONTRIBUTING", repo.contributingGuidelines?.body], ["AI_POLICY.md", repo.aiPolicy?.text], [".github/AI_POLICY.md", repo.aiPolicyGithub?.text]]);
  if (mentions.length) warnings.push(msg("The contribution rules mention AI. Read the excerpts below; the agent stops if AI contributions are forbidden."));
  return { problems, warnings, mentions, repo, issue };
}

// ---------------------------------------------------------------- fork

async function ensureFork(gh, owner, repo, defaultBranch, sleep) {
  const fork = await gh.rest("POST", `/repos/${owner}/${repo}/forks`, { default_branch_only: true });
  const fullName = fork.full_name;
  for (let i = 0; i < 15; i++) {   // forking is asynchronous
    try {
      await gh.rest("GET", `/repos/${fullName}/branches/${encodeURIComponent(defaultBranch)}`);
      break;
    } catch (err) {
      if (!(err instanceof NotFoundError) || i === 14) throw err;
      await sleep(2000);
    }
  }
  let synced = true;
  try {
    await gh.rest("POST", `/repos/${fullName}/merge-upstream`, { branch: defaultBranch });
  } catch {
    synced = false;   // e.g. the fork's default branch has diverged; the agent works from what is there
  }
  return { owner: fork.owner.login, name: fork.name, fullName, url: fork.html_url, synced };
}

async function branchExists(gh, fullName, branch) {
  try {
    await gh.rest("GET", `/repos/${fullName}/branches/${encodeURIComponent(branch)}`);
    return true;
  } catch (err) {
    if (err instanceof NotFoundError) return false;
    throw err;
  }
}

// ---------------------------------------------------------------- start a fix

export async function createFix(store, { url } = {}, opts = {}) {
  const parsed = parseIssueUrl(url);
  requireConfig();
  const agent = await store.get("fixAgent");
  if (!agent) throw new HttpError(400, "Run the auto-fix setup first (button on this page).");
  const existing = await store.hget(KEY, parsed.id);
  if (existing && !RESTARTABLE.has(existing.status)) throw new HttpError(409, "This issue already has an auto-fix in progress.");
  if (!(await store.lock(`fix:${parsed.id}`, 120000))) throw new HttpError(409, "This issue already has an auto-fix in progress.");
  try {
    const { anthropic, gh, sleep } = clients(opts);
    const me = await identity(store, gh);
    const data = await gh.graphql(PRECHECK_QUERY, { owner: parsed.owner, name: parsed.repo, number: parsed.number });
    const check = evaluatePrecheck(data, { viewer: me.login });
    const org = await store.hget("orgs", parsed.owner.toLowerCase());
    const attempt = (existing?.attempt || 0) + 1;
    const fix = {
      id: parsed.id, attempt, createdAt: existing?.createdAt || nowIso(), history: existing?.history || [],
      issue: { url: parsed.url, owner: check.repo?.nameWithOwner?.split("/")[0] || parsed.owner, repo: check.repo?.nameWithOwner?.split("/")[1] || parsed.repo,
        number: parsed.number, title: check.issue?.title || `${parsed.owner}/${parsed.repo}#${parsed.number}` },
      companyId: org?.companyId ?? null, phase: "fix",
      precheck: { problems: check.problems, warnings: check.warnings, mentions: check.mentions || [],
        language: check.repo?.primaryLanguage?.name || null, license: check.repo?.licenseInfo?.spdxId || null,
        defaultBranch: check.repo?.defaultBranchRef?.name || null, stars: check.repo?.stargazerCount ?? null,
        contributingUrl: check.repo?.contributingGuidelines?.url || null },
      result: null, diff: null, pr: null, error: null, session: null,
    };
    if (check.problems.length) return save(store, touch(fix, "blocked", msg("Pre-check found problems; nothing was started.")));

    try {
      const upstream = `${fix.issue.owner}/${fix.issue.repo}`;
      const defaultBranch = fix.precheck.defaultBranch;
      const fork = await ensureFork(gh, fix.issue.owner, fix.issue.repo, defaultBranch, sleep);
      let branch = `fix/issue-${fix.issue.number}`;
      for (let n = 2; await branchExists(gh, fork.fullName, branch); n++) branch = `fix/issue-${fix.issue.number}-${n}`;
      fix.fork = { ...fork, branch };
      const text = issueFile({ upstream, issue: { ...check.issue, author: check.issue.author?.login },
        labels: (check.issue.labels?.nodes || []).map((l) => l.name),
        comments: (check.issue.comments?.nodes || []).map((c) => ({ author: c.author?.login, body: c.body, createdAt: c.createdAt })),
        precheck: { warnings: check.warnings.map((w) => fill(w)) } });
      const file = await anthropic.beta.files.upload({ file: await toFile(Buffer.from(text, "utf8"), "issue.md", { type: "text/markdown" }) });
      const session = await anthropic.beta.sessions.create({
        agent: { type: "agent", id: agent.agentId, version: agent.agentVersion },
        environment_id: agent.environmentId,
        title: `Fix ${upstream}#${fix.issue.number}`,
        resources: [
          { type: "github_repository", url: fork.url, authorization_token: process.env.GITHUB_WRITE_TOKEN, mount_path: REPO_PATH,
            checkout: { type: "branch", name: defaultBranch } },
          { type: "file", file_id: file.id, mount_path: "/workspace/issue.md" },
        ],
        initial_events: [
          { type: "user.message", content: [{ type: "text", text: fixKickoff({ fix, identity: me, upstream, defaultBranch }) }] },
          { type: "user.define_outcome", description: `Issue #${fix.issue.number} of ${upstream} is fixed on branch ${branch} of the fork, tested, and described in the result file.`,
            rubric: { type: "text", content: FIX_RUBRIC }, max_iterations: 3 },
        ],
        budget: { type: "limit", max_list_cost: { amount: String(budgetCents()), currency: "USD" } },
        metadata: { fix_id: fix.id, phase: "fix" },
      });
      fix.session = { id: session.id, startedAt: nowIso(), status: session.status, costCents: 0, url: consoleUrl(session.id) };
      fix.sessions = [...(existing?.sessions || []), session.id];
      await store.hset(SESSIONS, { [session.id]: fix.id });
      return save(store, touch(fix, "running", msg("The agent started working in your fork {fork}.", { fork: fork.fullName })));
    } catch (err) {
      fix.error = msg("Could not start: {error}", { error: err.message });
      return save(store, touch(fix, "failed", fix.error));
    }
  } finally {
    await store.unlock(`fix:${parsed.id}`);
  }
}

const fill = (m) => m.text.replace(/\{(\w+)\}/g, (s, k) => (m.vars?.[k] ?? s));

// ---------------------------------------------------------------- follow a session

async function readResult(anthropic, sessionId) {
  for await (const f of anthropic.beta.files.list({ scope_id: sessionId, betas: ["managed-agents-2026-04-01"] })) {
    if (!/(^|\/)result\.json$/.test(f.filename || "")) continue;
    const res = await anthropic.beta.files.download(f.id);
    try { return JSON.parse(await res.text()); } catch { return { status: "failed", reason: "result.json is not valid JSON" }; }
  }
  return null;
}

/** Latest session.status_idle stop reason and outcome result, newest first. */
async function lastIdle(anthropic, sessionId) {
  let idle = null;
  let outcome = null;
  let message = null;
  for await (const ev of anthropic.beta.sessions.events.list(sessionId, { order: "desc" })) {
    if (!idle && ev.type === "session.status_idle") idle = ev.stop_reason || null;
    if (!outcome && ev.type === "span.outcome_evaluation_end") outcome = ev.result || null;
    if (!message && ev.type === "agent.message") message = (ev.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
    if (idle && outcome && message) break;
  }
  return { stop: idle, outcome, message };
}

function shortResult(r) {
  const s = (v, n) => (typeof v === "string" ? v.slice(0, n) : "");
  return {
    status: ["fixed", "blocked", "failed"].includes(r?.status) ? r.status : "failed",
    reason: s(r?.reason, 2000), summary: s(r?.summary_ja, 2000), explanation: s(r?.explanation_ja, 30000),
    tests: { commands: Array.isArray(r?.tests?.commands) ? r.tests.commands.slice(0, 10).map((c) => s(c, 300)) : [],
      passed: r?.tests?.passed === true, output: s(r?.tests?.output_tail, 8000) },
    prTitle: s(r?.pr_title, 300), prBody: s(r?.pr_body, 20000), aiDisclosure: r?.ai_disclosure_required === true, reply: s(r?.reply, 10000),
  };
}

async function loadDiff(gh, fix) {
  const base = fix.precheck.defaultBranch;
  const cmp = await gh.rest("GET", `/repos/${fix.issue.owner}/${fix.issue.repo}/compare/${encodeURIComponent(base)}...${fix.fork.owner}:${encodeURIComponent(fix.fork.branch)}`);
  const files = (cmp.files || []).slice(0, MAX_FILES).map((f) => ({ filename: f.filename, status: f.status, additions: f.additions, deletions: f.deletions,
    patch: f.patch ? f.patch.slice(0, MAX_PATCH) : null, truncated: !!f.patch && f.patch.length > MAX_PATCH }));
  return { files, totalFiles: (cmp.files || []).length, additions: files.reduce((a, f) => a + f.additions, 0), deletions: files.reduce((a, f) => a + f.deletions, 0),
    commits: cmp.ahead_by ?? (cmp.commits || []).length, compareUrl: cmp.html_url || null };
}

async function finalize(store, fix, { anthropic, gh }, info) {
  const raw = await readResult(anthropic, fix.session.id);
  if (!raw) {
    fix.finalizeAttempts = (fix.finalizeAttempts || 0) + 1;
    if (fix.finalizeAttempts < 3) return save(store, fix);   // output files can lag a few seconds behind
    fix.error = msg("The agent finished without writing its result file.");
    await notify(store, { type: "fix_failed", title: "Auto-fix failed: {issue}", body: fix.error.text, vars: { issue: label(fix) }, link: `/fixes/${enc(fix.id)}`, fixId: fix.id });
    return save(store, touch(fix, "failed", fix.error));
  }
  const result = shortResult(raw);
  result.outcome = info.outcome;
  const review = fix.phase === "review";
  if (result.status === "fixed") {
    if (!(await branchExists(gh, fix.fork.fullName, fix.fork.branch))) {
      fix.result = result;
      fix.error = msg("The agent reported success, but branch {branch} is not on your fork.", { branch: fix.fork.branch });
      await notify(store, { type: "fix_attention", title: "Auto-fix needs your attention: {issue}", body: fix.error.text, vars: { issue: label(fix), branch: fix.fork.branch }, link: `/fixes/${enc(fix.id)}`, fixId: fix.id });
      return save(store, touch(fix, review ? "pr_open" : "needs_attention", fix.error));
    }
    fix.diff = await loadDiff(gh, fix);
  }
  if (review) {
    fix.reviewResult = result;
    if (result.status === "fixed") {
      await notify(store, { type: "reply_ready", title: "Review changes ready: {issue}", body: "New commits are on the pull request. Check the reply and post it.", vars: { issue: label(fix) }, link: `/fixes/${enc(fix.id)}`, fixId: fix.id });
      return save(store, touch(fix, "reply_ready", msg("The requested changes were pushed. A reply is ready to post.")));
    }
    await notify(store, { type: "fix_attention", title: "Auto-fix needs your attention: {issue}", body: "The agent could not make the requested changes: {reason}", vars: { issue: label(fix), reason: result.reason }, link: `/fixes/${enc(fix.id)}`, fixId: fix.id });
    return save(store, touch(fix, "pr_open", msg("The agent could not make the requested changes: {reason}", { reason: result.reason })));
  }
  fix.result = result;
  if (result.status === "fixed" && result.tests.passed) {
    await notify(store, { type: "fix_ready", title: "Fix ready: {issue}", body: "Tests passed. Review the change and create the pull request.", vars: { issue: label(fix) }, link: `/fixes/${enc(fix.id)}`, fixId: fix.id });
    return save(store, touch(fix, "ready", msg("Fixed and tested. Waiting for your review.")));
  }
  const note = result.status === "fixed" ? msg("The change was pushed, but the tests did not pass.") : msg("The agent stopped: {reason}", { reason: result.reason });
  await notify(store, { type: "fix_attention", title: "Auto-fix needs your attention: {issue}", body: note.text, vars: { issue: label(fix), ...(note.vars || {}) }, link: `/fixes/${enc(fix.id)}`, fixId: fix.id });
  return save(store, touch(fix, result.status === "blocked" ? "blocked" : "needs_attention", note));
}

const label = (fix) => `${fix.issue.owner}/${fix.issue.repo}#${fix.pr?.number || fix.issue.number}`;
const enc = encodeURIComponent;

/** Bring a running fix up to date with its session. Safe to call from the webhook, the cron and page loads. */
export async function refreshFix(store, fix, opts = {}) {
  if (fix.status !== "running" || !fix.session?.id) return fix;
  if (!(await store.lock(`fix:${fix.id}`, 60000))) return fix;
  try {
    const c = clients(opts);
    fix = (await store.hget(KEY, fix.id)) || fix;
    if (fix.status !== "running") return fix;
    const session = await c.anthropic.beta.sessions.retrieve(fix.session.id);
    fix.session = { ...fix.session, status: session.status, costCents: Number(session.usage?.list_cost?.amount || fix.session.costCents || 0) };
    if (session.status === "running" || session.status === "rescheduling") return save(store, fix);
    const info = await lastIdle(c.anthropic, fix.session.id);
    if (session.status === "idle") {
      const stop = info.stop?.type;
      if (stop === "requires_action") {
        // Nobody is watching the sandbox: decline the calls the platform could not judge; the agent continues without them.
        const ids = info.stop.event_ids || [];
        if (ids.length) await c.anthropic.beta.sessions.events.send(fix.session.id, { events: ids.map((id) => ({ type: "user.tool_confirmation", tool_use_id: id, result: "deny" })) });
        return save(store, fix);
      }
      if (stop === "budget_reached" || stop === "retries_exhausted" || stop === "refusal") {
        fix.error = stop === "budget_reached" ? msg("Stopped at the spending cap (${amount}).", { amount: (budgetCents() / 100).toFixed(2) })
          : msg("The session stopped ({reason}).", { reason: stop });
        await notify(store, { type: "fix_failed", title: "Auto-fix failed: {issue}", body: fix.error.text, vars: { issue: label(fix), ...(fix.error.vars || {}) }, link: `/fixes/${enc(fix.id)}`, fixId: fix.id });
        return save(store, touch(fix, fix.phase === "review" ? "pr_open" : "failed", fix.error));
      }
      if (!info.stop) return save(store, fix);   // not started yet
    }
    return finalize(store, fix, c, info);   // idle after end_turn, or terminated
  } finally {
    await store.unlock(`fix:${fix.id}`);
  }
}

export async function refreshBySession(store, sessionId, opts = {}) {
  const id = await store.hget(SESSIONS, sessionId);
  if (!id) return null;
  const fix = await store.hget(KEY, id);
  return fix ? refreshFix(store, fix, opts) : null;
}

export async function cancelFix(store, id, opts = {}) {
  const fix = await getFix(store, id);
  if (fix.status !== "running") throw new HttpError(400, "Only a running auto-fix can be stopped.");
  try {
    await clients(opts).anthropic.beta.sessions.events.send(fix.session.id, { events: [{ type: "user.interrupt" }] });
  } catch { /* the session may already be done */ }
  return save(store, touch(fix, fix.phase === "review" ? "pr_open" : "cancelled", msg("Stopped by you.")));
}

export async function removeFix(store, id) {
  const fix = await getFix(store, id);
  if (fix.status === "running") throw new HttpError(400, "Stop the auto-fix before removing it.");
  await store.hdel(KEY, id);
  return { removed: id };
}

// ---------------------------------------------------------------- pull request

const FIXES_LINE = /^(fix(es|ed)?|close[sd]?|resolve[sd]?)\s+#\d+/im;

export async function createPullRequest(store, id, { title, body } = {}, opts = {}) {
  requireConfig();
  const fix = await getFix(store, id);
  if (fix.status !== "ready") throw new HttpError(400, "The fix is not ready for a pull request.");
  const all = Object.values(await store.hgetall(KEY));
  const sameCompany = (f) => (fix.companyId != null ? f.companyId === fix.companyId : f.issue.owner.toLowerCase() === fix.issue.owner.toLowerCase());
  const recent = all.find((f) => f.id !== fix.id && f.pr?.createdAt && sameCompany(f) && Date.now() - Date.parse(f.pr.createdAt) < PR_GAP_MS);
  if (recent) throw new HttpError(429, "You opened a pull request to this company in the last 24 hours. Wait a day so the maintainers are not flooded.");
  const prTitle = cleanText(title, 250) || fix.result?.prTitle || fix.issue.title;
  let prBody = String(body ?? fix.result?.prBody ?? "").slice(0, 60000);
  if (!FIXES_LINE.test(prBody)) prBody = `Fixes #${fix.issue.number}\n\n${prBody}`.trim();
  const { gh } = clients(opts);
  const pr = await gh.rest("POST", `/repos/${fix.issue.owner}/${fix.issue.repo}/pulls`, {
    title: prTitle, body: prBody, head: `${fix.fork.owner}:${fix.fork.branch}`, base: fix.precheck.defaultBranch, maintainer_can_modify: true,
  });
  fix.pr = { number: pr.number, url: pr.html_url, state: "OPEN", createdAt: nowIso(), title: prTitle, ci: null, seen: [], activity: [] };
  await addIssue(store, { url: fix.issue.url, title: fix.issue.title }).catch(() => {});   // shows up in the Tracker too
  return save(store, touch(fix, "pr_open", msg("Pull request #{number} created.", { number: pr.number })));
}

export async function respondToReview(store, id, opts = {}) {
  requireConfig();
  const fix = await getFix(store, id);
  if (!fix.pr || !OPEN_PR.has(fix.status)) throw new HttpError(400, "There is no open pull request to update.");
  const agent = await store.get("fixAgent");
  if (!agent) throw new HttpError(400, "Run the auto-fix setup first (button on this page).");
  const done = new Set(fix.pr.respondedIds || []);
  const activity = (fix.pr.activity || []).filter((a) => !a.mine && !done.has(a.id));
  if (!activity.length) throw new HttpError(400, "There are no new review comments to respond to.");
  const c = clients(opts);
  const me = await identity(store, c.gh);
  const upstream = `${fix.issue.owner}/${fix.issue.repo}`;
  const file = await c.anthropic.beta.files.upload({ file: await toFile(Buffer.from(reviewFile({ upstream, fix, activity }), "utf8"), "review.md", { type: "text/markdown" }) });
  const session = await c.anthropic.beta.sessions.create({
    agent: { type: "agent", id: agent.agentId, version: agent.agentVersion },
    environment_id: agent.environmentId,
    title: `Review ${upstream}#${fix.pr.number}`,
    resources: [
      { type: "github_repository", url: fix.fork.url, authorization_token: process.env.GITHUB_WRITE_TOKEN, mount_path: REPO_PATH,
        checkout: { type: "branch", name: fix.fork.branch } },
      { type: "file", file_id: file.id, mount_path: "/workspace/review.md" },
    ],
    initial_events: [
      { type: "user.message", content: [{ type: "text", text: reviewKickoff({ fix, identity: me, upstream }) }] },
      { type: "user.define_outcome", description: `The review of pull request #${fix.pr.number} on ${upstream} is addressed with new commits on ${fix.fork.branch}, and a reply is written.`,
        rubric: { type: "text", content: REVIEW_RUBRIC }, max_iterations: 3 },
    ],
    budget: { type: "limit", max_list_cost: { amount: String(budgetCents()), currency: "USD" } },
    metadata: { fix_id: fix.id, phase: "review" },
  });
  fix.phase = "review";
  fix.finalizeAttempts = 0;
  fix.pr.respondedAt = nowIso();
  fix.pr.respondedIds = [...done, ...activity.map((a) => a.id)].slice(-400);
  fix.session = { id: session.id, startedAt: nowIso(), status: session.status, costCents: 0, url: consoleUrl(session.id) };
  fix.sessions = [...(fix.sessions || []), session.id];
  await store.hset(SESSIONS, { [session.id]: fix.id });
  return save(store, touch(fix, "running", msg("The agent is addressing {n} review comments.", { n: activity.length })));
}

export async function postReply(store, id, { body } = {}, opts = {}) {
  requireConfig();
  const fix = await getFix(store, id);
  if (fix.status !== "reply_ready") throw new HttpError(400, "There is no reply waiting to be posted.");
  const text = String(body ?? fix.reviewResult?.reply ?? "").trim().slice(0, 60000);
  if (!text) throw new HttpError(400, "The reply is empty.");
  const { gh } = clients(opts);
  const comment = await gh.rest("POST", `/repos/${fix.issue.owner}/${fix.issue.repo}/issues/${fix.pr.number}/comments`, { body: text });
  if (comment?.node_id) fix.pr.seen = [...(fix.pr.seen || []), comment.node_id].slice(-400);
  return save(store, touch(fix, "pr_open", msg("Your reply was posted.")));
}

// ---------------------------------------------------------------- watch pull requests

export const PR_QUERY = `query FixPr($owner: String!, $name: String!, $number: Int!) {
  rateLimit { limit cost remaining resetAt }
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      state merged mergedAt closedAt url reviewDecision
      reviews(last: 20) { nodes { id author { login } state body submittedAt url } }
      comments(last: 30) { nodes { id author { login } body createdAt url } }
      reviewThreads(last: 30) { nodes { comments(last: 10) { nodes { id author { login } body createdAt path url } } } }
      commits(last: 1) { nodes { commit { oid statusCheckRollup { state } } } }
    }
  }
}`;

export function prActivity(pr, viewer) {
  const me = (viewer || "").toLowerCase();
  const items = [];
  for (const r of pr.reviews?.nodes || []) {
    if (r?.state === "PENDING") continue;
    items.push({ id: r.id, kind: "review", state: r.state, author: r.author?.login || "ghost", body: r.body || "", at: r.submittedAt, url: r.url });
  }
  for (const c of pr.comments?.nodes || []) items.push({ id: c.id, kind: "comment", author: c.author?.login || "ghost", body: c.body || "", at: c.createdAt, url: c.url });
  for (const t of pr.reviewThreads?.nodes || []) {
    for (const c of t?.comments?.nodes || []) items.push({ id: c.id, kind: "review comment", author: c.author?.login || "ghost", body: c.body || "", at: c.createdAt, url: c.url, path: c.path });
  }
  return items.filter((i) => i.at).map((i) => ({ ...i, body: i.body.slice(0, 4000), mine: i.author.toLowerCase() === me }))
    .sort((a, b) => a.at.localeCompare(b.at));
}

async function watchPr(store, fix, { gh }, me) {
  const data = await gh.graphql(PR_QUERY, { owner: fix.issue.owner, name: fix.issue.repo, number: fix.pr.number });
  const pr = data.repository?.pullRequest;
  if (!pr) return 0;
  let sent = 0;
  const link = `/fixes/${enc(fix.id)}`;
  const vars = { issue: label(fix) };
  const activity = prActivity(pr, me.login);
  const seen = new Set(fix.pr.seen || []);
  const fresh = activity.filter((a) => !a.mine && !seen.has(a.id));
  for (const a of fresh.slice(0, 5)) {
    if (a.kind === "review") await notify(store, { type: "review", title: "New review on {issue}: {state}", body: a.body.slice(0, 200), vars: { ...vars, state: a.state, author: a.author }, link, fixId: fix.id });
    else await notify(store, { type: "comment", title: "New comment on {issue} from @{author}", body: a.body.slice(0, 200), vars: { ...vars, author: a.author }, link, fixId: fix.id });
    sent++;
  }
  if (fresh.length > 5) {
    await notify(store, { type: "comment", title: "{n} more new comments on {issue}", vars: { ...vars, n: fresh.length - 5 }, link, fixId: fix.id });
    sent++;
  }
  const ci = pr.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state || null;
  if ((ci === "FAILURE" || ci === "ERROR") && fix.pr.ci !== ci) {
    await notify(store, { type: "ci_failed", title: "CI failed on {issue}", body: "Open the pull request to see which check failed.", vars, link, fixId: fix.id });
    sent++;
  }
  fix = (await store.hget(KEY, fix.id)) || fix;   // the page may have changed it meanwhile
  fix.pr = { ...fix.pr, state: pr.merged ? "MERGED" : pr.state, ci, reviewDecision: pr.reviewDecision || null,
    activity: activity.slice(-50), seen: [...new Set([...(fix.pr.seen || []), ...activity.map((a) => a.id)])].slice(-400) };
  if (pr.merged && fix.status !== "merged") {
    await notify(store, { type: "merged", title: "Merged: {issue}", body: "Your pull request was merged. It counts toward the company's Ready to approach flag on the Tracker.", vars, link, fixId: fix.id });
    sent++;
    touch(fix, "merged", msg("Merged by the maintainers."));
  } else if (pr.state === "CLOSED" && !pr.merged && fix.status !== "closed") {
    await notify(store, { type: "closed", title: "Pull request closed without merging: {issue}", vars, link, fixId: fix.id });
    sent++;
    touch(fix, "closed", msg("Closed without merging."));
  } else {
    fix.updatedAt = fresh.length ? nowIso() : fix.updatedAt;
  }
  await save(store, fix);
  return sent;
}

/** Refresh running sessions and open pull requests. Called by the cron route and (throttled) by page loads. */
export async function watchFixes(store, opts = {}) {
  const fixes = Object.values(await store.hgetall(KEY));
  const out = { refreshed: 0, watched: 0, notifications: 0, errors: [] };
  if (!fixes.length) return out;
  const c = clients(opts);
  let me = null;
  for (const fix of fixes) {
    try {
      if (fix.status === "running") {
        await refreshFix(store, fix, { ...opts, anthropic: c.anthropic, gh: c.gh });
        out.refreshed++;
      } else if (fix.pr && (OPEN_PR.has(fix.status))) {
        me = me || (await identity(store, c.gh));
        out.notifications += await watchPr(store, fix, c, me);
        out.watched++;
      }
    } catch (err) {
      out.errors.push(`${fix.id}: ${err.message}`);
    }
  }
  await store.set("fixesWatchedAt", nowIso());
  return out;
}

/** watchFixes at most every WATCH_EVERY_MS (page loads call this). */
export async function watchIfStale(store, opts = {}) {
  if (!fixConfig().anthropic || !fixConfig().writeToken) return null;
  const last = await store.get("fixesWatchedAt");
  if (last && Date.now() - Date.parse(last) < WATCH_EVERY_MS) return null;
  if (!(await store.lock("fix:watch", 60000))) return null;
  try { return await watchFixes(store, opts); } finally { await store.unlock("fix:watch"); }
}

// ---------------------------------------------------------------- views

export async function listFixes(store) {
  const [fixes, companies] = await Promise.all([store.hgetall(KEY), store.hgetall("companies")]);
  return Object.values(fixes).map((f) => ({
    id: f.id, issue: f.issue, status: f.status, phase: f.phase, attempt: f.attempt, company: companies[f.companyId]?.name || null, companyId: f.companyId,
    summary: f.result?.summary || null, tests: f.result ? f.result.tests.passed : null, costCents: f.session?.costCents || 0,
    pr: f.pr ? { number: f.pr.number, url: f.pr.url, state: f.pr.state, ci: f.pr.ci } : null,
    lastNote: f.history?.[f.history.length - 1]?.note || null, createdAt: f.createdAt, updatedAt: f.updatedAt,
  })).sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
}

export async function fixDetail(store, id) {
  const fix = await getFix(store, id);
  const company = fix.companyId != null ? await store.hget("companies", String(fix.companyId)) : null;
  return { ...fix, company: company?.name || null };
}
