import { guardWrite, json, readBody, requireAdmin, route } from "@/lib/http";
import { listNotifications, markRead } from "@/lib/notifications";
import { readyStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export const GET = route(async (request) => {
  requireAdmin(request);
  return json(await listNotifications(await readyStore()));
});

// Body: { ids: [...] } or { all: true }
export const POST = route(async (request) => {
  guardWrite(request);
  const body = await readBody(request);
  const store = await readyStore();
  await markRead(store, body.all ? "all" : Array.isArray(body.ids) ? body.ids.slice(0, 200) : []);
  return json(await listNotifications(store));
});
