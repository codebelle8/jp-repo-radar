import { checkHost, json, query, route, truthy } from "@/lib/http";
import { loadData, searchRepos } from "@/lib/queries";
import { readyStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export const GET = route(async (request) => {
  checkHost(request);
  const q = query(request);
  const data = await loadData(await readyStore());
  return json(searchRepos(data, {
    q: q.q, language: q.language, companyId: q.companyId, includeArchived: truthy(q.includeArchived),
    segment: q.segment || null, sort: q.sort, dir: q.dir, limit: Math.min(Number(q.limit) || 50, 500), offset: q.offset,
  }));
});
