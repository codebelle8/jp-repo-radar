// Small helpers shared by the server code. No Next.js imports, so scripts and tests can use them too.

export const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

/** An error that maps straight to an HTTP status in API responses. */
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Thrown inside a job step when the user asked the job to stop. */
export class StoppedError extends Error {}

/** Redis LRANGE/LTRIM index semantics (inclusive, negative = from the end). */
export function redisRange(list, start, stop) {
  const n = list.length;
  const a = start < 0 ? Math.max(0, n + start) : start;
  const b = stop < 0 ? n + stop : Math.min(stop, n - 1);
  if (a > b || a >= n) return [];
  return list.slice(a, b + 1);
}

export function slugify(text) {
  return String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "company";
}

const LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

export function validLogin(login) {
  return typeof login === "string" && LOGIN_RE.test(login) && !login.includes("--") && !login.endsWith("-");
}

export function parseLogins(input) {
  const list = Array.isArray(input) ? input : String(input || "").split(/[\s,]+/);
  return list.map((s) => String(s).trim()).filter(Boolean);
}

export function cleanText(value, max = 300) {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, max) : null;
}

export function cleanUrl(value) {
  const text = cleanText(value, 500);
  if (!text) return null;
  const withScheme = /^https?:\/\//i.test(text) ? text : `https://${text}`;
  try {
    const url = new URL(withScheme);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}
