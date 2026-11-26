import { guardWrite, json, readBody, route } from "@/lib/http";
import { cancelFix } from "@/lib/fixes";
import { readyStore } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Stops a running session.
export const POST = route(async (request, { params }) => {
  guardWrite(request);
  const { id } = await params;
  const body = await readBody(request);
  return json(await cancelFix(await readyStore(), decodeURIComponent(id)));
});
