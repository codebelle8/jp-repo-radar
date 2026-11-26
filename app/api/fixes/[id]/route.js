import { guardWrite, json, requireAdmin, route } from "@/lib/http";
import { fixDetail, getFix, refreshFix, removeFix } from "@/lib/fixes";
import { readyStore } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = route(async (request, { params }) => {
  requireAdmin(request);
  const { id } = await params;
  const store = await readyStore();
  const fix = await getFix(store, decodeURIComponent(id));
  if (fix.status === "running") await refreshFix(store, fix).catch(() => null);
  return json(await fixDetail(store, fix.id));
});

// Forget the record (nothing on GitHub changes).
export const DELETE = route(async (request, { params }) => {
  guardWrite(request);
  const { id } = await params;
  return json(await removeFix(await readyStore(), decodeURIComponent(id)));
});
