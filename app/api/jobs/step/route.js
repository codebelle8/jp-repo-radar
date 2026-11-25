import { guardWrite, json, route } from "@/lib/http";
import { publicJob, stepJob } from "@/lib/jobs";
import { readyStore } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Advances the running job by up to ~40 seconds. Open dashboards call this in a loop.
// It only continues a job an admin already started, so it does not require sign-in.
export const POST = route(async (request) => {
  guardWrite(request, { requireAdmin: false });
  const result = await stepJob(await readyStore(), { budgetMs: 40000 });
  return json({ ...result, job: publicJob(result.job) });
});
