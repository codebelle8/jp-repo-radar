import { guardWrite, json, requireAdmin, route } from "@/lib/http";
import { setupFixAgent, setupStatus } from "@/lib/fixes";
import { readyStore } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = route(async (request) => {
  requireAdmin(request);
  return json(await setupStatus(await readyStore()));
});

// Creates the Managed Agents agent and environment once; later calls update the agent in place.
export const POST = route(async (request) => {
  guardWrite(request);
  const store = await readyStore();
  await setupFixAgent(store);
  return json(await setupStatus(store));
});
