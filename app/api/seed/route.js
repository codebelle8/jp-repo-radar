import { importSeed } from "@/lib/companies";
import { guardWrite, json, route } from "@/lib/http";
import { readyStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export const POST = route(async (request) => {
  guardWrite(request);
  return json(await importSeed(await readyStore()));
});
