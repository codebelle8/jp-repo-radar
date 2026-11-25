import { guardWrite, json, readBody, route } from "@/lib/http";
import { readyStore } from "@/lib/store";
import { setApplication } from "@/lib/tracker";

export const dynamic = "force-dynamic";

export const PUT = route(async (request, { params }) => {
  guardWrite(request);
  const { companyId } = await params;
  const body = await readBody(request);
  return json(await setApplication(await readyStore(), companyId, { stage: body.stage, notes: body.notes, careersUrl: body.careersUrl }));
});
