import { deleteCompany, updateCompany } from "@/lib/companies";
import { recountCandidates } from "@/lib/discovery";
import { checkHost, guardWrite, json, readBody, route } from "@/lib/http";
import { companyDetail, loadData } from "@/lib/queries";
import { readyStore } from "@/lib/store";
import { HttpError } from "@/lib/util";

export const dynamic = "force-dynamic";

export const GET = route(async (request, { params }) => {
  checkHost(request);
  const { id } = await params;
  const store = await readyStore();
  const detail = await companyDetail(store, await loadData(store), id);
  if (!detail) throw new HttpError(404, "Company not found");
  return json(detail);
});

export const PATCH = route(async (request, { params }) => {
  guardWrite(request);
  const { id } = await params;
  const body = await readBody(request);
  const allowed = Object.fromEntries(Object.entries(body).filter(([k]) => ["name", "nameJa", "website", "segment", "orgs"].includes(k)));
  return json(await updateCompany(await readyStore(), id, allowed));
});

export const DELETE = route(async (request, { params }) => {
  guardWrite(request);
  const { id } = await params;
  const store = await readyStore();
  await deleteCompany(store, id);
  await recountCandidates(store);
  return json({ ok: true });
});
