import { guardWrite, json, readBody, requireAdmin, route } from "@/lib/http";
import { createFix, listFixes, setupStatus, watchIfStale } from "@/lib/fixes";
import { readyStore } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Private: your auto-fix jobs. Loading the list also refreshes running sessions and open pull requests
// (at most every 2 minutes), so the page stays current even without the webhook or the cron.
export const GET = route(async (request) => {
  requireAdmin(request);
  const store = await readyStore();
  await watchIfStale(store).catch(() => null);
  const [fixes, setup] = await Promise.all([listFixes(store), setupStatus(store)]);
  return json({ fixes, setup });
});

// Body: { url } (a GitHub issue link). Runs the pre-check, forks and starts the agent.
export const POST = route(async (request) => {
  guardWrite(request);
  const body = await readBody(request);
  return json(await createFix(await readyStore(), { url: body.url }), 201);
});
