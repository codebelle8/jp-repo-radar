import { checkHost, json, query, route, truthy } from "@/lib/http";
import { loadData, summary } from "@/lib/queries";
import { readyStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export const GET = route(async (request) => {
  checkHost(request);
  const q = query(request);
  const data = await loadData(await readyStore());
  return json(summary(data, { includeArchived: truthy(q.includeArchived), segment: q.segment || null }));
});
