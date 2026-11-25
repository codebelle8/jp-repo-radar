import { guardWrite, json, route } from "@/lib/http";
import { requestStop } from "@/lib/jobs";
import { readyStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export const POST = route(async (request) => {
  guardWrite(request);
  return json(await requestStop(await readyStore()));
});
