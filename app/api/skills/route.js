import { guardWrite, json, readBody, requireAdmin, route } from "@/lib/http";
import { readyStore } from "@/lib/store";
import { setSkills, skillsView } from "@/lib/skills";

export const dynamic = "force-dynamic";

// Private: your languages, the skill match per company, and suggested companies.
export const GET = route(async (request) => {
  requireAdmin(request);
  return json(await skillsView(await readyStore()));
});

// Body: { added?: [names], removed?: [names] }
export const PUT = route(async (request) => {
  guardWrite(request);
  const body = await readBody(request);
  const store = await readyStore();
  await setSkills(store, { added: body.added, removed: body.removed });
  return json(await skillsView(store));
});
