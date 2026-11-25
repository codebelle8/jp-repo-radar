import { guardWrite, json, route } from "@/lib/http";
import { readyStore } from "@/lib/store";
import { syncTracker } from "@/lib/tracker";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Reads your pull requests and issue comments from GitHub and moves tracked issues forward.
export const POST = route(async (request) => {
  guardWrite(request);
  return json(await syncTracker(await readyStore()));
});
