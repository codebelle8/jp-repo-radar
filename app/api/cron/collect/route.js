import { json, route } from "@/lib/http";
import { getJob, getToken, publicJob, recentRuns, startJob, stepJob } from "@/lib/jobs";
import { readyStore } from "@/lib/store";
import { syncTracker } from "@/lib/tracker";
import { HttpError } from "@/lib/util";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Called by Vercel Cron (see vercel.json). Starts a full collection when the last one is older than
// 20 hours, then keeps stepping it until the time budget runs out. Unfinished work continues on the
// next call or as soon as someone opens the dashboard.
export const GET = route(async (request) => {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) throw new HttpError(401, "Unauthorized");

  const store = await readyStore();
  if (!(await getToken(store)).token) return json({ skipped: "No GITHUB_TOKEN configured" });
  // Refresh the personal tracker (your pull requests and comments) once a day as well.
  const tracker = await syncTracker(store).catch((err) => ({ error: err.message }));

  let started = false;
  const current = await getJob(store);
  if (current?.status !== "running") {
    const last = (await recentRuns(store)).find((r) => r.kind === "collect" && r.status === "done");
    const ageHours = last ? (Date.now() - Date.parse(last.finishedAt)) / 3600000 : Infinity;
    if (ageHours < 20) return json({ skipped: `Last collection finished ${ageHours.toFixed(1)} h ago`, tracker });
    await startJob(store, "collect", {});
    started = true;
  }

  const deadline = Date.now() + 270000;
  let result = { job: await getJob(store) };
  while (Date.now() < deadline - 25000) {
    result = await stepJob(store, { budgetMs: Math.min(60000, deadline - Date.now()) });
    if (result.idle || result.busy || result.waiting || result.job?.status !== "running") break;
  }
  return json({ started, job: publicJob(result.job, 10), tracker });
});
