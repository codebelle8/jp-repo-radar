import { checkHost, guardWrite, json, readBody, route } from "@/lib/http";
import { getJob, publicJob, startJob } from "@/lib/jobs";
import { readyStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export const GET = route(async (request) => {
  checkHost(request);
  return json({ job: publicJob(await getJob(await readyStore())) });
});

// POST { kind: "collect", companyIds?: number[] } | { kind: "discover", minRepos?, locations? }
export const POST = route(async (request) => {
  guardWrite(request);
  const body = await readBody(request);
  const store = await readyStore();
  let locations = body.locations;
  if (typeof locations === "string") locations = locations.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
  const job = await startJob(store, body.kind, {
    companyIds: Array.isArray(body.companyIds) ? body.companyIds : [],
    minRepos: body.minRepos, locations: locations && locations.length ? locations : null, maxCandidates: body.maxCandidates,
  });
  return json({ job: publicJob(job) });
});
