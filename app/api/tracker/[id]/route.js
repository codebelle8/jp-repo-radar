import { guardWrite, json, readBody, route } from "@/lib/http";
import { readyStore } from "@/lib/store";
import { removeItem, updateItem } from "@/lib/tracker";

export const dynamic = "force-dynamic";

export const PATCH = route(async (request, { params }) => {
  guardWrite(request);
  const { id } = await params;
  const body = await readBody(request);
  return json(await updateItem(await readyStore(), decodeURIComponent(id), { stage: body.stage, notes: body.notes }));
});

export const DELETE = route(async (request, { params }) => {
  guardWrite(request);
  const { id } = await params;
  await removeItem(await readyStore(), decodeURIComponent(id));
  return json({ ok: true });
});
