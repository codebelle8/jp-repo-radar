// Who may change data or start jobs.
//  - Local (not on Vercel) without ADMIN_PASSWORD: anyone on this machine (the server binds to 127.0.0.1).
//  - ADMIN_PASSWORD set (required on Vercel): only browsers that signed in on the Settings page.
import crypto from "node:crypto";

export const ADMIN_COOKIE = "jprr_admin";

export const onVercel = () => !!process.env.VERCEL;
export const passwordSet = () => !!process.env.ADMIN_PASSWORD;
export const adminRequired = () => passwordSet() || onVercel();

function sessionValue() {
  return crypto.createHmac("sha256", process.env.ADMIN_PASSWORD).update("jp-repo-radar-admin-v1").digest("hex");
}

function safeEqual(a, b) {
  const x = crypto.createHash("sha256").update(String(a)).digest();
  const y = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

export function readCookie(request, name) {
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

export function isAdmin(request) {
  if (!passwordSet()) return !onVercel();
  const cookie = readCookie(request, ADMIN_COOKIE);
  return !!cookie && safeEqual(cookie, sessionValue());
}

export function checkPassword(password) {
  return passwordSet() && typeof password === "string" && safeEqual(password, process.env.ADMIN_PASSWORD);
}

export function sessionCookie(request) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${ADMIN_COOKIE}=${sessionValue()}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000${secure}`;
}

export function clearCookie() {
  return `${ADMIN_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
}
