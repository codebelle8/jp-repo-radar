import { json, route } from "@/lib/http";
import { fixConfig, watchFixes } from "@/lib/fixes";
import { readyStore } from "@/lib/store";
import { HttpError } from "@/lib/util";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Called every 15 minutes by .github/workflows/watch.yml (Vercel's free plan allows only a daily cron):
// refreshes running auto-fix sessions and checks open pull requests for reviews, comments, CI and merges.
export const GET = route(async (request) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) throw new HttpError(401, "Unauthorized");
  const config = fixConfig();
  if (!config.anthropic || !config.writeToken) return json({ skipped: "Auto-fix is not set up" });
  return json(await watchFixes(await readyStore()));
});
