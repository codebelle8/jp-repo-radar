import { guardWrite, json, readBody, route } from "@/lib/http";
import { postReply } from "@/lib/fixes";
import { readyStore } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Body: { body }. Posts the reviewed reply on the pull request.
export const POST = route(async (request, { params }) => {
  guardWrite(request);
  const { id } = await params;
  const body = await readBody(request);
  return json(await postReply(await readyStore(), decodeURIComponent(id), { body: body.body }));
});
