import { checkHost, query, route, truthy } from "@/lib/http";
import { companiesCsv, loadData, reposCsv } from "@/lib/queries";
import { readyStore } from "@/lib/store";
import { HttpError } from "@/lib/util";

export const dynamic = "force-dynamic";

// GET /api/export/companies  or  /api/export/repos
export const GET = route(async (request, { params }) => {
  checkHost(request);
  const { kind } = await params;
  if (kind !== "companies" && kind !== "repos") throw new HttpError(404, "Unknown export");
  const q = query(request);
  const opts = { includeArchived: truthy(q.includeArchived), segment: q.segment || null };
  const data = await loadData(await readyStore());
  const csv = kind === "companies" ? companiesCsv(data, opts) : reposCsv(data, opts);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${kind === "companies" ? "companies" : "repositories"}.csv"`,
      "Cache-Control": "no-store",
    },
  });
});
