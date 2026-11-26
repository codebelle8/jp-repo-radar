// Run: npm test
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { JA, JA_PATTERNS } from "../lib/i18n/index.js";
import { plural, rich, tokens, translate } from "../lib/i18n.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function sourceFiles(dir) {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) return rel.includes(`${path.sep}api`) ? [] : sourceFiles(rel);
    return /\.(js|jsx|mjs)$/.test(e.name) ? [rel] : [];
  });
}
const STR = String.raw`"((?:[^"\\]|\\.)*)"`;
const unescape = (raw) => JSON.parse(`"${raw.replace(/\\'/g, "'")}"`);

/** English strings passed to t(), rich(), msg() and tp() in the pages and components. */
function usedStrings() {
  const found = [];
  for (const file of [...sourceFiles("app"), ...sourceFiles("components")]) {
    const src = fs.readFileSync(path.join(ROOT, file), "utf8");
    for (const m of src.matchAll(new RegExp(String.raw`\b(?:t|rich|msg)\(\s*${STR}`, "g"))) found.push({ file, text: unescape(m[1]) });
    for (const m of src.matchAll(new RegExp(String.raw`\btp\([^"()]*(?:\([^()]*\)[^"()]*)*,\s*${STR}\s*,\s*${STR}`, "g"))) {
      found.push({ file, text: unescape(m[2]), one: unescape(m[1]) });
    }
    for (const m of src.matchAll(/\b(?:t|rich|tp|msg)\(\s*`/g)) found.push({ file, template: true, text: src.slice(m.index, m.index + 60) });
  }
  return found;
}

describe("i18n", () => {
  it("translates, fills values, picks plurals and falls back to English", () => {
    assert.equal(translate("{n} d ago", { n: 3 }, "ja"), "3 日前");
    assert.equal(translate("{n} d ago", { n: 3 }, "en"), "3 d ago");
    assert.equal(translate("No translation for this sentence", null, "ja"), "No translation for this sentence");
    assert.equal(plural(1, "{n} repository", "{n} repositories", null, "en"), "1 repository");
    assert.equal(plural(2, "{n} repository", "{n} repositories", null, "en"), "2 repositories");
    const nodes = rich("Go to <link>Settings</link> as {who}.", { link: (c) => `[${c}]`, who: "you" }, "en");
    assert.deepEqual(nodes.map((n) => (typeof n === "string" ? n : n.props.children)), ["Go to ", "[Settings]", " as ", "you", "."]);
  });

  it("every translation keeps the placeholders and tags of its English text", () => {
    const bad = Object.entries(JA).filter(([en, ja]) => typeof ja !== "string" || !ja.trim() || tokens(en).join() !== tokens(ja).join());
    assert.deepEqual(bad, []);
    for (const [re] of JA_PATTERNS) assert.ok(re instanceof RegExp && re.source.startsWith("^") && re.source.endsWith("$"), `${re} must be anchored`);
  });

  it("every string the pages pass to t(), tp(), rich() and msg() has a Japanese translation", () => {
    const used = usedStrings();
    assert.ok(used.length > 50, "expected the pages to use the translation helpers");
    assert.deepEqual(used.filter((u) => u.template).map((u) => `${u.file}: ${u.text}`), [], "use {placeholders}, not template literals, in t()");
    const missing = [...new Set(used.filter((u) => !u.template && !Object.hasOwn(JA, u.text)).map((u) => `${u.file}: ${u.text}`))];
    assert.deepEqual(missing, []);
  });
});
