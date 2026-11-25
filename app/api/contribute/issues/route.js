import { checkHost, json, query, route, truthy } from "@/lib/http";
import { loadContribData, searchIssues } from "@/lib/queries";
import { readyStore } from "@/lib/store";

export const dynamic = "force-dynamic";

// Checkbox filters default to on; the page sends 0 to turn one off.
const flag = (value, fallback) => (value == null || value === "" ? fallback : truthy(value));

export const GET = route(async (request) => {
  checkHost(request);
  const q = query(request);
  const data = await loadContribData(await readyStore());
  return json(searchIssues(data, {
    q: q.q, companyId: q.companyId || null, language: q.language || "",
    inLanguages: String(q.languages || "").split(",").map((l) => l.trim()).filter(Boolean).slice(0, 60),
    issueLang: ["ja", "en"].includes(q.issueLang) ? q.issueLang : "",
    beginner: flag(q.beginner, false), unassigned: flag(q.unassigned, true), noPr: flag(q.noPr, true),
    activeMonths: Math.min(120, Math.max(0, Math.floor(Number(q.activeMonths ?? 6)) || 0)),
    minWelcome: Number(q.minWelcome) || 0, sort: q.sort, dir: q.dir, limit: Math.min(Number(q.limit) || 50, 200), offset: q.offset,
  }));
});
