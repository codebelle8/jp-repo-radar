import { checkHost, json, query, route } from "@/lib/http";
import { listCandidates, segments } from "@/lib/queries";
import { readyStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export const GET = route(async (request) => {
  checkHost(request);
  const q = query(request);
  const status = ["pending", "approved", "rejected"].includes(q.status) ? q.status : "pending";
  const store = await readyStore();
  const [all, companies] = await Promise.all([store.hgetall("candidates"), store.hgetall("companies")]);
  const activeMonths = Math.min(120, Math.max(0, Math.floor(Number(q.activeMonths) || 0)));
  const result = listCandidates(all, { status, minScore: Number(q.minScore) || 0, q: q.q, sort: q.sort, dir: q.dir, limit: 500, activeMonths });
  return json({ ...result, segments: segments({ companies }) });
});
