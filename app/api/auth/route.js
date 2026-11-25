import { checkPassword, clearCookie, passwordSet, sessionCookie } from "@/lib/auth";
import { guardWrite, json, readBody, route } from "@/lib/http";
import { HttpError, sleep } from "@/lib/util";

export const dynamic = "force-dynamic";

export const POST = route(async (request) => {
  guardWrite(request, { requireAdmin: false });
  if (!passwordSet()) throw new HttpError(400, "No ADMIN_PASSWORD is configured.");
  const { password } = await readBody(request);
  if (!checkPassword(password)) {
    await sleep(800);   // slow down guessing
    throw new HttpError(401, "Wrong password");
  }
  return json({ ok: true }, 200, { "Set-Cookie": sessionCookie(request) });
});

export const DELETE = route(async (request) => {
  guardWrite(request, { requireAdmin: false });
  return json({ ok: true }, 200, { "Set-Cookie": clearCookie() });
});
