import { guardWrite, json, readBody, route } from "@/lib/http";
import { createPullRequest } from "@/lib/fixes";
import { readyStore } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Body: { title, body }. Opens the pull request on the upstream repository (your approval step).
export const POST = route(async (request, { params }) => {
  guardWrite(request);
  const { id } = await params;
  const body = await readBody(request);
  return json(await createPullRequest(await readyStore(), decodeURIComponent(id), { title: body.title, body: body.body }));
});
