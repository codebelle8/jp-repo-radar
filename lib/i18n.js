// Tiny i18n: English source text is the key, Japanese comes from lib/i18n/*.js. Missing entries fall back to English.
//   translate("Collect data")                       -> "データ収集" (ja)
//   translate("{n} companies", { n: 3 })            -> "3 社"
//   plural(n, "{n} repository", "{n} repositories")  English picks one/other; Japanese uses the "other" entry
//   rich("Sign in on the <link>Settings</link> page.", { link: (c) => <Link href="/settings">{c}</Link> })
// Server messages with values inside (job progress, signals, errors) are matched with regular expressions (JA_PATTERNS).
import { createElement, Fragment } from "react";
import { JA, JA_PATTERNS } from "./i18n/index.js";

export const LANGS = [
  { code: "en", label: "English", short: "EN", flag: "us" },
  { code: "ja", label: "日本語", short: "日本語", flag: "jp" },
];

let current = "en";
export const currentLang = () => current;
export function setCurrentLang(lang) { current = lang === "ja" ? "ja" : "en"; }

/** Marks a string for translation where it is defined (module-level constants); translate it when rendering. */
export const msg = (text) => text;

function lookup(text, lang) {
  if (lang !== "ja" || typeof text !== "string") return text;
  if (Object.hasOwn(JA, text)) return JA[text];
  for (const [re, out] of JA_PATTERNS) if (re.test(text)) return text.replace(re, out);
  return text;
}

const fill = (s, vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m)) : s);

export function translate(text, vars, lang = current) {
  return fill(lookup(text, lang), vars);
}

export function plural(n, one, other, vars, lang = current) {
  const text = lang === "ja" ? other : Number(n) === 1 ? one : other;
  return translate(text, { n, ...vars }, lang);
}

/** Like translate, but values may be React nodes and <tag>text</tag> calls vars.tag(text). Returns an array of nodes. */
export function rich(text, vars = {}, lang = current) {
  const s = lookup(text, lang);
  const out = [];
  const re = /<(\w+)>(.*?)<\/\1>|\{(\w+)\}/gs;
  let last = 0;
  let m;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    const value = m[1] ? vars[m[1]] : vars[m[3]];
    const node = m[1] ? (typeof value === "function" ? value(fill(m[2], vars)) : m[2]) : (value ?? m[0]);
    out.push(createElement(Fragment, { key: out.length }, node));
    last = re.lastIndex;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

/** Placeholders and tags a translation must keep (used by the tests). */
export function tokens(text) {
  return [...String(text).matchAll(/\{(\w+)\}|<(\/?\w+)>/g)].map((m) => m[0]).sort();
}
