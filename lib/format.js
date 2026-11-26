// Formatting helpers used by React components (browser-safe, no Node imports).
import { currentLang, translate as tr } from "./i18n.js";

const nf = new Intl.NumberFormat("en-US");
const cf = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

export const fmt = (n) => (n == null ? "–" : nf.format(n));
/** Full number below 100,000, compact above (12.9K style only kicks in for big values). */
export const compact = (n) => (n == null ? "–" : Math.abs(n) >= 100000 ? cf.format(n) : nf.format(n));

/** "3 d ago" / "3 日前", in the current language. */
export function ago(iso) {
  if (!iso) return tr("never");
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return tr("just now");
  const m = s / 60;
  if (m < 60) return tr("{n} min ago", { n: Math.round(m) });
  const h = m / 60;
  if (h < 24) return tr("{n} h ago", { n: Math.round(h) });
  const d = h / 24;
  if (d < 30) return tr("{n} d ago", { n: Math.round(d) });
  const mo = d / 30.4;
  if (mo < 12) return tr("{n} mo ago", { n: Math.round(mo) });
  return tr("{n} y ago", { n: (d / 365).toFixed(1) });
}

const locale = () => (currentLang() === "ja" ? "ja-JP" : undefined);
export const localTime = (iso) => (iso ? new Date(iso).toLocaleString(locale()) : "");
export const localClock = (ms) => new Date(ms).toLocaleTimeString(locale());

export function safeUrl(u) {
  if (!u) return null;
  let s = String(u).trim();
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const url = new URL(s);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

export function hostOf(u) {
  try {
    return new URL(u).host.replace(/^www\./, "");
  } catch {
    return u;
  }
}

export const ghUrl = (login) => `https://github.com/${encodeURIComponent(login)}`;

export function qs(obj) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  return p.toString();
}
