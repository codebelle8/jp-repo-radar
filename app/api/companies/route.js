import { createCompany } from "@/lib/companies";
import { checkHost, guardWrite, json, query, readBody, route, truthy } from "@/lib/http";
import { getJob, getToken, startJob } from "@/lib/jobs";
import { companyStats, loadData, segments } from "@/lib/queries";
import { readyStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export const GET = route(async (request) => {
  checkHost(request);
  const q = query(request);
  const data = await loadData(await readyStore());
  return json({
    rows: companyStats(data, { includeArchived: truthy(q.includeArchived), segment: q.segment || null }),
    segments: segments(data),
  });
});

export const POST = route(async (request) => {
  guardWrite(request);
  const body = await readBody(request);
  const store = await readyStore();
  const company = await createCompany(store, { ...body, source: "manual" });
  const result = { id: company.id };
  if (body.collect && (await getToken(store)).token && (await getJob(store))?.status !== "running") {
    result.job = await startJob(store, "collect", { companyIds: [company.id] });
  }
  return json(result);
});
