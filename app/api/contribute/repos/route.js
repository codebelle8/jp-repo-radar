import { checkHost, json, route } from "@/lib/http";
import { loadContribData, welcoming } from "@/lib/queries";
import { readyStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export const GET = route(async (request) => {
  checkHost(request);
  return json(welcoming(await loadContribData(await readyStore())));
});
