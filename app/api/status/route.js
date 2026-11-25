import { onVercel } from "@/lib/auth";
import { adminState, checkHost, json, route } from "@/lib/http";
import { getJob, getToken, publicJob, recentRuns } from "@/lib/jobs";
import { readyStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export const GET = route(async (request) => {
  checkHost(request);
  const store = await readyStore();
  const [job, runs, companies, orgs, rate, candidateCounts, tokenInfo, token] = await Promise.all([
    getJob(store), recentRuns(store), store.hgetall("companies"), store.hgetall("orgs"), store.get("rate"),
    store.get("candidateCounts"), store.get("tokenInfo"), getToken(store),
  ]);
  return json({
    version: "2.0.0",
    onVercel: onVercel(),
    storage: { kind: store.kind, ephemeral: store.ephemeral, location: store.location },
    token: { configured: !!token.token, source: token.source, login: tokenInfo?.login || null,
      error: tokenInfo?.error || null, checkedAt: tokenInfo?.checkedAt || null },
    canSaveToken: !store.ephemeral,
    admin: adminState(request),
    job: publicJob(job),
    lastCollect: runs.find((r) => r.kind === "collect") || null,
    lastDiscover: runs.find((r) => r.kind === "discover") || null,
    counts: { companies: Object.keys(companies).length, orgs: Object.keys(orgs).length,
      candidatesPending: candidateCounts?.pending || 0 },
    rate,
  });
});
