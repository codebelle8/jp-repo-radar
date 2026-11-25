// Helpers for API route handlers: JSON responses, error mapping, request guards.
import { adminRequired, isAdmin, onVercel, passwordSet } from "./auth.js";
import { AuthError, GitHubError } from "./github.js";
import { HttpError } from "./util.js";

export function json(data, status = 200, headers = {}) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

/** Wrap a route handler so thrown HttpErrors (and GitHub failures) become JSON error responses. */
export function route(fn) {
  return async (request, ctx) => {
    try {
      return await fn(request, ctx);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      if (err instanceof AuthError) return json({ error: "GitHub rejected the token. Check it on the Settings page." }, 400);
      if (err instanceof GitHubError) return json({ error: `GitHub: ${err.message}` }, 502);
      console.error(err);
      return json({ error: `Server error: ${err.message}` }, 500);
    }
  };
}

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

function hostName(hostHeader) {
  return String(hostHeader || "").replace(/:\d+$/, "").toLowerCase();
}

/** Locally, refuse requests addressed to other host names (blocks DNS-rebinding attacks). */
export function checkHost(request) {
  if (onVercel()) return;
  if (!LOCAL_HOSTS.has(hostName(request.headers.get("host")))) throw new HttpError(403, "Host not allowed");
}

/** For anything that changes data: same-origin JSON request from an allowed user. */
export function guardWrite(request, { requireAdmin = true } = {}) {
  checkHost(request);
  const origin = request.headers.get("origin");
  if (origin) {
    let originHost = "";
    try { originHost = new URL(origin).host.toLowerCase(); } catch { /* invalid */ }
    if (originHost !== String(request.headers.get("host") || "").toLowerCase()) {
      throw new HttpError(403, "Cross-origin request blocked");
    }
  }
  if (request.method !== "DELETE" && !(request.headers.get("content-type") || "").startsWith("application/json")) {
    throw new HttpError(415, "Use Content-Type: application/json");
  }
  if (requireAdmin && !isAdmin(request)) {
    throw new HttpError(401, onVercel() && !passwordSet()
      ? "Editing is disabled: set ADMIN_PASSWORD in the Vercel project settings."
      : "Sign in on the Settings page to make changes.");
  }
}

/** For private reads (the personal tracker): same checks as writes, minus the JSON requirement. */
export function requireAdmin(request) {
  checkHost(request);
  if (!isAdmin(request)) throw new HttpError(401, "Sign in on the Settings page to see your tracker.");
}

export async function readBody(request) {
  const text = await request.text();
  if (text.length > 1_000_000) throw new HttpError(413, "Request too large");
  if (!text) return {};
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new HttpError(400, "Body is not valid JSON");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "JSON body must be an object");
  return body;
}

export function query(request) {
  return Object.fromEntries(new URL(request.url).searchParams.entries());
}

export const truthy = (v) => ["1", "true", "yes", "on"].includes(String(v).toLowerCase());

export function adminState(request) {
  return { required: adminRequired(), passwordSet: passwordSet(), ok: isAdmin(request) };
}
