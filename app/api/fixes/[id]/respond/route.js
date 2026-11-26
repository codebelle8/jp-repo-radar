import { guardWrite, json, readBody, route } from "@/lib/http";
import { respondToReview } from "@/lib/fixes";
import { readyStore } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Starts an agent session that addresses the new review comments on the same branch.
export const POST = route(async (request, { params }) => {
  guardWrite(request);
  const { id } = await params;
  const body = await readBody(request);
  return json(await respondToReview(await readyStore(), decodeURIComponent(id)));
});
