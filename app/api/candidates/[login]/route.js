import { createCompany } from "@/lib/companies";
import { recountCandidates } from "@/lib/discovery";
import { guardWrite, json, readBody, route } from "@/lib/http";
import { getJob, getToken, startJob } from "@/lib/jobs";
import { readyStore } from "@/lib/store";
import { HttpError, nowIso } from "@/lib/util";

export const dynamic = "force-dynamic";

// POST { action: "approve" | "reject" | "reset", name?, nameJa?, segment?, collect? }
export const POST = route(async (request, { params }) => {
  guardWrite(request);
  const { login } = await params;
  const key = String(login).toLowerCase();
  const body = await readBody(request);
  const store = await readyStore();
  const candidate = await store.hget("candidates", key);
  if (!candidate) throw new HttpError(404, "Candidate not found");
  const result = { ok: true };

  if (body.action === "approve") {
    const company = await createCompany(store, {
      name: body.name || candidate.name || candidate.login, nameJa: body.nameJa, segment: body.segment,
      website: body.website || candidate.websiteUrl, source: "discovered", orgs: [candidate.login],
    });
    await store.hset("candidates", { [key]: { ...candidate, status: "approved", companyId: company.id, updatedAt: nowIso() } });
    result.id = company.id;
    if (body.collect && (await getToken(store)).token && (await getJob(store))?.status !== "running") {
      result.job = await startJob(store, "collect", { companyIds: [company.id] });
    }
  } else if (body.action === "reject" || body.action === "reset") {
    await store.hset("candidates", { [key]: { ...candidate, status: body.action === "reject" ? "rejected" : "pending",
      updatedAt: nowIso() } });
  } else {
    throw new HttpError(400, "action must be approve, reject or reset");
  }
  result.counts = await recountCandidates(store);
  return json(result);
});
