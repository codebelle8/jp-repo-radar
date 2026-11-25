// Run a collection or discovery to completion from the command line (e.g. from Windows Task Scheduler).
//   npm run collect                         all companies
//   npm run collect -- --company cookpad    one company (repeatable)
//   npm run discover -- --min-repos 5 --location Tokyo
// Uses the same storage as the dashboard (data/ folder, or Upstash Redis if its env vars are set).
import fs from "node:fs";

for (const file of [".env.local", ".env"]) {
  if (fs.existsSync(file)) process.loadEnvFile(file);
}

const { getStore, ensureSeeded } = await import("../lib/store.js");
const { getJob, startJob, stepJob } = await import("../lib/jobs.js");
const { sleep } = await import("../lib/util.js");

const [kind, ...rest] = process.argv.slice(2);
if (kind !== "collect" && kind !== "discover") {
  console.error("Usage: node scripts/run-job.mjs collect|discover [--company slug] [--min-repos N] [--location X]");
  process.exit(2);
}
const opts = { company: [], location: [], minRepos: 3 };
for (let i = 0; i < rest.length; i++) {
  if (rest[i] === "--company") opts.company.push(rest[++i]);
  else if (rest[i] === "--location") opts.location.push(rest[++i]);
  else if (rest[i] === "--min-repos") opts.minRepos = Number(rest[++i]);
}

const store = getStore();
await ensureSeeded(store);

let job = await getJob(store);
if (job?.status === "running") {
  console.log(`Continuing the job that is already running: ${job.label}`);
} else {
  const params = { minRepos: opts.minRepos, locations: opts.location.length ? opts.location : null };
  if (opts.company.length) {
    const companies = Object.values(await store.hgetall("companies"));
    params.companyIds = opts.company.map((slug) => {
      const found = companies.find((c) => c.slug === slug);
      if (!found) { console.error(`Unknown company slug: ${slug}`); process.exit(2); }
      return found.id;
    });
  }
  try {
    job = await startJob(store, kind, params);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

let lastLine = null;
function printNewLogs(logs = []) {
  const start = lastLine == null ? 0 : logs.lastIndexOf(lastLine) + 1;
  for (const line of logs.slice(start)) console.log(line);
  if (logs.length) lastLine = logs[logs.length - 1];
}

printNewLogs(job.logs);
for (;;) {
  const result = await stepJob(store, { budgetMs: 120000 });
  job = result.job;
  printNewLogs(job?.logs);
  if (!job || job.status !== "running") break;
  if (result.busy) { console.log("Another process is running a step; waiting…"); await sleep(5000); }
  if (result.waiting) {
    const ms = Math.max(1000, job.waitUntil - Date.now());
    console.log(`Waiting ${Math.ceil(ms / 1000)}s for GitHub's rate limit…`);
    await sleep(ms + 1000);
  }
}
console.log(`Job ${job?.status}${job?.error ? `: ${job.error}` : ""}`);
process.exit(job?.status === "done" ? 0 : 1);
