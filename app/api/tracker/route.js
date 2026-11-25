import { guardWrite, json, readBody, requireAdmin, route } from "@/lib/http";
import { readyStore } from "@/lib/store";
import { addIssue, trackerView } from "@/lib/tracker";

export const dynamic = "force-dynamic";

// Private: your tracked issues, pull requests and applications.
export const GET = route(async (request) => {
  requireAdmin(request);
  return json(await trackerView(await readyStore()));
});

export const POST = route(async (request) => {
  guardWrite(request);
  const body = await readBody(request);
  return json(await addIssue(await readyStore(), { url: body.url, title: body.title }), 201);
});
