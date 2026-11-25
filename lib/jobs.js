// Jobs (collection / discovery) are stored state machines advanced by short "steps".
// Anything can drive a step: an open dashboard tab, the Vercel cron route, or `npm run collect`.
// A lock makes sure only one step runs at a time; the job resumes exactly where it stopped.
import { collectFinished, planCollect, stepCollect } from "./collector.js";
import { discoverFinished, planDiscover, stepDiscover } from "./discovery.js";
import { AuthError, createGitHubClient, RateLimitError } from "./github.js";
import { HttpError, nowIso, StoppedError } from "./util.js";

const JOB = "job";
const STOP = "job:stop";
const RUNS = "runs";
const MAX_LOGS = 200;

export async function getToken(store) {
  if (process.env.GITHUB_TOKEN) return { token: process.env.GITHUB_TOKEN, source: "env" };
  if (!store.ephemeral) {
    const settings = (await store.get("settings")) || {};
    if (settings.githubToken) return { token: settings.githubToken, source: "settings" };
  }
  return { token: null, source: null };
}

function addLog(job, message) {
  const time = new Date().toLocaleTimeString("en-GB", { hour12: false });
  job.logs.push(`${time}  ${message}`);
  if (job.logs.length > MAX_LOGS) job.logs.splice(0, job.logs.length - MAX_LOGS);
}

export async function getJob(store) {
  return store.get(JOB);
}

export async function startJob(store, kind, params = {}) {
  const current = await getJob(store);
  if (current?.status === "running") throw new HttpError(409, `A job is already running: ${current.label}`);
  const { token } = await getToken(store);
  if (!token) throw new HttpError(400, "Add a GitHub token first (see Settings).");

  const job = { id: Math.random().toString(36).slice(2, 10), kind, status: "running", startedAt: nowIso(),
    finishedAt: null, done: 0, total: 0, current: "Starting", logs: [], error: null, waitUntil: null };
  if (kind === "collect") {
    const [companies, orgs] = await Promise.all([store.hgetall("companies"), store.hgetall("orgs")]);
    const ids = (params.companyIds || []).map(Number).filter(Boolean);
    Object.assign(job, planCollect(companies, orgs, ids));
    const names = ids.map((id) => companies[id]?.name).filter(Boolean);
    job.label = ids.length ? `Collect: ${names.slice(0, 3).join(", ")}${names.length > 3 ? " …" : ""}` : "Collect: all companies";
    addLog(job, `Collecting ${job.total} GitHub organizations`);
  } else if (kind === "discover") {
    Object.assign(job, planDiscover(params));
    job.label = "Discover Japanese organizations";
    addLog(job, `Searching ${job.params.locations.length} locations for organizations with >= ${job.params.minRepos} public repos`);
  } else {
    throw new HttpError(400, `Unknown job kind '${kind}'`);
  }
  await store.del(STOP);
  await store.set(JOB, job);
  return job;
}

async function finishJob(store, job, status) {
  job.status = status;
  job.finishedAt = nowIso();
  job.current = status === "done" ? "Finished" : status === "stopped" ? "Stopped" : "Failed";
  const r = job.result || {};
  const issues = r.issues != null ? `, ${r.issues} open issues` : "";
  const detail = job.kind === "collect"
    ? `${r.ok}/${r.orgs} orgs ok, ${r.repos} repos${issues}`
    : `${r.new} new, ${r.updated} updated`;
  if (status === "done") addLog(job, job.kind === "collect"
    ? `Finished: ${r.ok} ok, ${r.notFound} not found, ${r.errors} failed, ${r.repos} repositories${issues}`
    : `Discovery finished: ${r.new} new candidates, ${r.updated} re-scored`);
  if (status === "stopped") addLog(job, "Stopped by user");
  // Large working sets are not needed after the job ends.
  delete job.found;
  delete job.known;
  delete job.tasks;
  delete job.enrichQueue;
  delete job.contribQueue;
  delete job.collected;
  await store.rpush(RUNS, { id: job.id, kind: job.kind, label: job.label, status, startedAt: job.startedAt,
    finishedAt: job.finishedAt, detail, error: job.error });
  await store.ltrim(RUNS, -50, -1);
}

/**
 * Advance the running job for at most ~budgetMs. Returns { job, idle | busy | waiting }.
 * `latestStart` leaves headroom: no new organization / batch starts in the last 20 seconds.
 */
export async function stepJob(store, { budgetMs = 40000, fetchImpl, sleepImpl, searchIntervalMs } = {}) {
  let job = await getJob(store);
  if (!job || job.status !== "running") return { job, idle: true };
  if (job.waitUntil && Date.now() < job.waitUntil) return { job, waiting: true };
  if (!(await store.lock("step", budgetMs + 60000))) return { job, busy: true };

  let client = null;
  try {
    job = await getJob(store);   // re-read under the lock
    if (!job || job.status !== "running") return { job, idle: true };
    job.waitUntil = null;
    const started = Date.now();
    const { token } = await getToken(store);
    if (!token) throw new AuthError("No GitHub token configured");
    const log = (message) => addLog(job, message);
    client = createGitHubClient({ token, log, ...(fetchImpl ? { fetchImpl } : {}), ...(sleepImpl ? { sleep: sleepImpl } : {}) });
    const ctx = {
      store, client, job, log,
      latestStart: started + Math.max(1000, budgetMs - 20000),
      stopped: async () => (await store.get(STOP)) === job.id,
      save: () => store.set(JOB, job),
      ...(sleepImpl ? { sleepImpl } : {}),
      ...(searchIntervalMs != null ? { searchIntervalMs } : {}),
    };
    if (job.kind === "collect") {
      await stepCollect(ctx);
      if (collectFinished(job)) await finishJob(store, job, "done");
    } else {
      await stepDiscover(ctx);
      if (discoverFinished(job)) await finishJob(store, job, "done");
    }
  } catch (err) {
    if (err instanceof StoppedError) {
      await finishJob(store, job, "stopped");
    } else if (err instanceof RateLimitError) {
      job.waitUntil = err.resetAt;
      addLog(job, `GitHub rate limit reached; the job continues after ${new Date(err.resetAt).toLocaleTimeString("en-GB")}`);
    } else {
      job.error = err.message || String(err);
      addLog(job, `ERROR: ${job.error}`);
      await finishJob(store, job, "failed");
    }
  } finally {
    if (job) {
      job.lastStepAt = nowIso();
      await store.set(JOB, job);
    }
    if (client?.rate?.graphql || client?.rate?.search) await store.set("rate", { ...client.rate, at: nowIso() });
    await store.unlock("step");
  }
  return { job };
}

export async function requestStop(store) {
  const job = await getJob(store);
  if (!job || job.status !== "running") return { stopping: false };
  await store.set(STOP, job.id);
  // If no step is running right now (e.g. paused for a rate limit), stop immediately.
  if (await store.lock("step", 30000)) {
    try {
      const fresh = await getJob(store);
      if (fresh?.status === "running") {
        await finishJob(store, fresh, "stopped");
        await store.set(JOB, fresh);
      }
    } finally {
      await store.unlock("step");
    }
  }
  return { stopping: true };
}

export async function recentRuns(store) {
  return (await store.lrange(RUNS, -50, -1)).reverse();
}

/** The job as the dashboard sees it (without the large work queues). */
export function publicJob(job, logLines = 60) {
  if (!job) return null;
  const { queue, pending, tasks, found, known, enrichQueue, contribQueue, collected, ...rest } = job;
  return { ...rest, logs: (job.logs || []).slice(-logLines), foundCount: found ? Object.keys(found).length : undefined };
}
