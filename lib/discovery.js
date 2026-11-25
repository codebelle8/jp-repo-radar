// Find candidate Japanese web-development companies on GitHub.
//  1. User search `type:org location:"<place>" repos:>=N` for Japanese places (English + Japanese names).
//     Search returns at most 1,000 results per query, so large queries are split by repo count, then date.
//  2. Read each organization's profile through GraphQL (20 per request).
//  3. Score with transparent heuristics; a person approves or rejects each candidate in the dashboard.
import { RateLimitError } from "./github.js";
import { nowIso, sleep, StoppedError } from "./util.js";

export const DEFAULT_LOCATIONS = [
  "Japan", "日本", "Tokyo", "東京", "Osaka", "大阪", "Kyoto", "京都", "Fukuoka", "福岡",
  "Nagoya", "名古屋", "Yokohama", "横浜", "Sapporo", "札幌", "Kobe", "神戸", "Sendai", "仙台",
  "Shibuya", "渋谷",
];

export const CREATED_RANGES = ["<2013-01-01", "2013-01-01..2016-12-31", "2017-01-01..2019-12-31",
  "2020-01-01..2022-12-31", ">2022-12-31"];

export const SEARCH_INTERVAL_MS = 2200;   // search API: 30 requests/minute
const ENRICH_BATCH = 20;

/** Split `repos:>=min` into ranges that each stay under the 1,000-result search cap. */
export function repoRanges(minRepos) {
  const out = [];
  let low = minRepos;
  for (const bound of [5, 10, 20, 50, 100]) {
    if (bound >= low) {
      out.push(`${low}..${bound}`);
      low = bound + 1;
    }
  }
  out.push(`>=${low}`);
  return out;
}

export const ENRICH_FRAGMENT = `
fragment OrgFields on Organization {
  login name description websiteUrl location email isVerified avatarUrl createdAt
  repositories(first: 20, privacy: PUBLIC, isFork: false, orderBy: {field: PUSHED_AT, direction: DESC}) {
    totalCount
    nodes { primaryLanguage { name } pushedAt isArchived }
  }
}`;

export function buildEnrichQuery(n) {
  const declare = Array.from({ length: n }, (_, i) => `$l${i}: String!`).join(", ");
  const fields = Array.from({ length: n }, (_, i) => `  o${i}: organization(login: $l${i}) { ...OrgFields }`).join("\n");
  return `query(${declare}) {\n  rateLimit { limit cost remaining resetAt }\n${fields}\n}\n${ENRICH_FRAGMENT}`;
}

// Languages typical of web development (front end and common web back ends).
const WEB_LANGUAGES = new Set(["JavaScript", "TypeScript", "PHP", "Ruby", "Vue", "HTML", "CSS", "SCSS", "Sass", "Less",
  "Svelte", "Astro", "MDX", "Go", "Elixir", "Python", "Kotlin", "Scala", "Java", "Dart", "Twig", "Blade", "Hack",
  "Crystal", "Clojure"]);
const JAPAN_PLACES = /japan|nippon|日本|tokyo|東京|osaka|大阪|kyoto|京都|fukuoka|福岡|nagoya|名古屋|yokohama|横浜|sapporo|札幌|kobe|神戸|sendai|仙台|shibuya|渋谷|okinawa|沖縄|hiroshima|広島|kanagawa|神奈川|saitama|埼玉|chiba|千葉|shinjuku|新宿|minato|港区/i;
const JAPANESE_TEXT = /[぀-ヿ一-鿿]/;
const COMPANY_MARKERS = /株式会社|合同会社|有限会社|\bco\.,?\s*ltd\b|\binc\b\.?|\bcorp(oration)?\b|\bk\.k\.|\bllc\b|\bltd\b|\bgmbh\b|会社|社の|公式|official/i;
const NON_COMPANY_MARKERS = /community|コミュニティ|勉強会|meetup|user ?group|ユーザー?グループ|university|大学|高専|student|学生|school|学校|club|サークル|hackathon|ハッカソン|研究室|\blab\b|laboratory|conference|カンファレンス|workshop|ワークショップ|handson|ハンズオン|tutorial|教材|personal|個人|hobby|趣味|team for|bootcamp|contest|コンテスト|jam\b/i;
const NON_COMPANY_DOMAINS = /\.(ac|go|ed|lg)\.jp(\/|$)|\.edu(\/|$)|github\.io/i;

function hostOf(url) {
  if (!url) return "";
  return String(url).trim().toLowerCase().replace(/^[a-z]+:\/\//, "").split("/")[0];
}

/** Returns { score 0-100, signals [{label, points}], topLanguages [[name, count]] }. */
export function scoreOrg(org, now = new Date()) {
  const signals = [];
  const add = (points, label) => signals.push({ label, points });
  const text = [org.name, org.description].filter(Boolean).join(" ");
  const location = org.location || "";
  const website = org.websiteUrl || "";
  const host = hostOf(website);
  const repos = (org.repositories?.nodes || []).filter(Boolean);
  const total = org.repositories?.totalCount || 0;

  if (JAPAN_PLACES.test(location) || JAPANESE_TEXT.test(location)) add(15, `Location in Japan (${location.trim().slice(0, 40)})`);
  if (JAPANESE_TEXT.test(text)) add(15, "Japanese text in profile");
  if (host.endsWith(".co.jp")) add(20, `Website on .co.jp (${host})`);
  else if (host.endsWith(".jp") && !NON_COMPANY_DOMAINS.test(website)) add(12, `Website on .jp (${host})`);
  else if (host) add(4, `Has website (${host})`);
  if (org.isVerified) add(10, "Verified domain on GitHub");
  if (COMPANY_MARKERS.test(text)) add(15, "Company wording (株式会社 / Inc. / Co., Ltd.)");

  const languages = new Map();
  for (const r of repos) {
    const lang = r.primaryLanguage?.name;
    if (lang) languages.set(lang, (languages.get(lang) || 0) + 1);
  }
  const withLanguage = [...languages.values()].reduce((a, b) => a + b, 0);
  if (withLanguage) {
    const web = [...languages.entries()].filter(([lang]) => WEB_LANGUAGES.has(lang)).reduce((a, [, n]) => a + n, 0);
    const share = web / withLanguage;
    const points = Math.round(20 * share);
    if (points) add(points, `Web languages in ${Math.round(share * 100)}% of recent repos`);
  }
  if (total >= 10) add(5, `${total} public repositories`);
  const pushes = repos.map((r) => r.pushedAt).filter(Boolean).sort();
  if (pushes.length) {
    const ageDays = (now - new Date(pushes[pushes.length - 1])) / 86400000;
    if (ageDays <= 365) add(5, "Pushed in the last 12 months");
    else if (ageDays > 365 * 3) add(-10, "No pushes for over 3 years");
  }
  if (NON_COMPANY_MARKERS.test(text)) add(-30, "Looks like a community / school / personal account");
  if (NON_COMPANY_DOMAINS.test(website)) add(-25, "Academic, government or GitHub Pages website");

  const score = Math.max(0, Math.min(100, signals.reduce((a, s) => a + s.points, 0)));
  const topLanguages = [...languages.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  return { score, signals, topLanguages };
}

export function planDiscover({ locations, minRepos = 3, maxCandidates = 1500 } = {}) {
  const places = (locations && locations.length ? locations : DEFAULT_LOCATIONS).map((s) => String(s).trim()).filter(Boolean);
  const min = Math.max(1, Number(minRepos) || 3);
  const tasks = places.map((place) => {
    const base = `type:org location:"${place.replace(/"/g, "")}"`;
    return { place, base, query: `${base} repos:>=${min}`, level: 0, page: 1 };
  });
  return {
    phase: "search", tasks, found: {}, enrichQueue: [], known: {}, total: 0, lastSearchAt: 0,
    params: { locations: places, minRepos: min, maxCandidates: Math.max(10, Number(maxCandidates) || 1500) },
    result: { searched: 0, new: 0, updated: 0, skippedTracked: 0 },
  };
}

export async function recountCandidates(store) {
  const all = await store.hgetall("candidates");
  const counts = { pending: 0, approved: 0, rejected: 0 };
  for (const c of Object.values(all)) counts[c.status] = (counts[c.status] || 0) + 1;
  await store.set("candidateCounts", counts);
  return counts;
}

export async function stepDiscover({ store, client, job, latestStart, log, stopped, save,
  sleepImpl = sleep, searchIntervalMs = SEARCH_INTERVAL_MS }) {
  for (;;) {
    if (await stopped()) throw new StoppedError();
    if (Date.now() > latestStart) return;

    if (job.phase === "search") {
      const enough = Object.keys(job.found).length >= job.params.maxCandidates;
      if (!job.tasks.length || enough) {
        const [orgs, candidates] = await Promise.all([store.hgetall("orgs"), store.hgetall("candidates")]);
        const found = Object.keys(job.found);
        job.enrichQueue = found.filter((login) => !orgs[login.toLowerCase()]);
        job.result.searched = found.length;
        job.result.skippedTracked = found.length - job.enrichQueue.length;
        job.known = Object.fromEntries(Object.entries(candidates).map(([key, c]) => [key, { status: c.status,
          companyId: c.companyId ?? null, discoveredAt: c.discoveredAt, foundBy: c.foundBy }]));
        job.phase = "enrich";
        job.done = 0;
        job.total = job.enrichQueue.length;
        log(`Search finished: ${found.length} organizations, ${job.enrichQueue.length} to score (${job.result.skippedTracked} already tracked)`);
        await save();
        continue;
      }
      const task = job.tasks[0];
      const gap = searchIntervalMs - (Date.now() - (job.lastSearchAt || 0));
      if (gap > 0) await sleepImpl(gap);
      job.lastSearchAt = Date.now();
      job.current = `Searching “${task.place}”${task.level ? ` (${task.query.split(task.base)[1].trim()})` : ""}, page ${task.page}`;
      const data = await client.restGet("/search/users", { q: task.query, per_page: 100, page: task.page });
      const total = data.total_count || 0;
      let added = 0;
      for (const item of data.items || []) {
        if (item.type === "Organization" && !(item.login in job.found)) {
          job.found[item.login] = task.place;
          added++;
        }
      }
      job.tasks.shift();
      if (task.page === 1) {
        if (total > 1000 && task.level < 2) {
          const subs = task.level === 0
            ? repoRanges(job.params.minRepos).map((r) => `${task.base} repos:${r}`)
            : CREATED_RANGES.map((c) => `${task.query} created:${c}`);
          job.tasks.unshift(...subs.map((query) => ({ ...task, query, level: task.level + 1, page: 1 })));
          log(`“${task.place}” matches ${total} organizations; splitting into ${subs.length} smaller searches`);
        } else {
          const pages = Math.min(10, Math.ceil(Math.min(total, 1000) / 100));
          const more = [];
          for (let p = 2; p <= pages; p++) more.push({ ...task, page: p });
          job.tasks.unshift(...more);
          if (task.level === 0) log(`“${task.place}”: ${total} organizations`);
        }
      }
      job.done++;
      if (added) job.current += ` · ${Object.keys(job.found).length} found`;
      await save();
      continue;
    }

    if (job.phase === "enrich") {
      if (!job.enrichQueue.length) {
        job.phase = "done";
        await recountCandidates(store);
        await save();
        return;
      }
      if (client.graphqlLow()) throw new RateLimitError("GraphQL points almost used up", client.rate.graphql.reset * 1000);
      const batch = job.enrichQueue.slice(0, ENRICH_BATCH);
      job.current = `Reading organization profiles (${job.done}/${job.total})`;
      const data = await client.graphql(buildEnrichQuery(batch.length), Object.fromEntries(batch.map((l, i) => [`l${i}`, l])));
      const stamp = nowIso();
      const updates = {};
      batch.forEach((login, i) => {
        const org = data[`o${i}`];
        if (!org) return;
        const key = org.login.toLowerCase();
        const { score, signals, topLanguages } = scoreOrg(org);
        const pushes = (org.repositories?.nodes || []).map((r) => r?.pushedAt).filter(Boolean).sort();
        const known = job.known[key];
        updates[key] = {
          login: org.login, name: org.name || null, description: org.description || null, location: org.location || null,
          websiteUrl: org.websiteUrl || null, isVerified: !!org.isVerified, avatarUrl: org.avatarUrl || null,
          repoTotal: org.repositories?.totalCount || 0, topLanguages, lastPush: pushes[pushes.length - 1] || null,
          score, signals, status: known?.status || "pending", companyId: known?.companyId ?? null,
          foundBy: known?.foundBy || job.found[login] || null, discoveredAt: known?.discoveredAt || stamp, updatedAt: stamp,
        };
        if (known) job.result.updated++; else job.result.new++;
      });
      if (Object.keys(updates).length) await store.hset("candidates", updates);
      job.enrichQueue.splice(0, batch.length);
      job.done += batch.length;
      await save();
      continue;
    }
    return;   // phase "done"
  }
}

export const discoverFinished = (job) => job.phase === "done";
