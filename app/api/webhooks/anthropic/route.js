import Anthropic from "@anthropic-ai/sdk";
import { json, route } from "@/lib/http";
import { refreshBySession } from "@/lib/fixes";
import { readyStore } from "@/lib/store";
import { HttpError } from "@/lib/util";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Claude Console -> Manage -> Webhooks: point an endpoint here and subscribe to the session.status_* events.
// The signature is checked with ANTHROPIC_WEBHOOK_SIGNING_KEY; the payload only names the session, so the
// fix is refreshed from the session itself (deliveries can repeat or arrive out of order).
export const POST = route(async (request) => {
  if (!process.env.ANTHROPIC_WEBHOOK_SIGNING_KEY) throw new HttpError(503, "Webhook signing key is not configured.");
  const body = await request.text();
  let event;
  try {
    event = new Anthropic().beta.webhooks.unwrap(body, { headers: Object.fromEntries(request.headers.entries()) });
  } catch {
    throw new HttpError(400, "Invalid webhook signature.");
  }
  const type = event?.data?.type || "";
  if (!type.startsWith("session.")) return json({ ignored: type });
  const fix = await refreshBySession(await readyStore(), event.data.id);
  return json({ ok: true, fix: fix ? { id: fix.id, status: fix.status } : null });
});
