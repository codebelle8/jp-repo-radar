// Companies and the GitHub organizations they own.
//   companies : hash  id          -> {id, slug, name, nameJa, website, segment, source, createdAt}
//   orgs      : hash  login(lower) -> {login, companyId, status, name, location, ... , fetchedAt}
//   repos:<login(lower)>          -> [repo, ...]   (written by the collector)
//   contrib:<login(lower)>        -> {fetchedAt, repos: {name: stats}, issues: [...]}   (lib/contrib.js)
//   snapshots:<companyId>         -> list of per-collection totals
import { SEED_COMPANIES } from "../seed/companies.js";
import { HttpError, cleanText, cleanUrl, nowIso, parseLogins, slugify, validLogin } from "./util.js";

export function newOrg(login, companyId) {
  return { login, companyId, status: "pending", name: null, description: null, websiteUrl: null, location: null,
    email: null, isVerified: false, avatarUrl: null, url: `https://github.com/${login}`, repoTotal: null,
    error: null, fetchedAt: null };
}

function uniqueSlug(base, companies) {
  const taken = new Set(Object.values(companies).map((c) => c.slug));
  const root = slugify(base);
  let slug = root;
  for (let n = 2; taken.has(slug); n++) slug = `${root}-${n}`;
  return slug;
}

function checkLogins(logins, orgs, companies, ownCompanyId = null) {
  for (const login of logins) {
    if (!validLogin(login)) throw new HttpError(400, `'${login}' is not a valid GitHub login`);
    const owner = orgs[login.toLowerCase()];
    if (owner && owner.companyId !== ownCompanyId) {
      throw new HttpError(400, `GitHub org '${login}' is already assigned to ${companies[owner.companyId]?.name || "another company"}`);
    }
  }
}

export async function createCompany(store, { name, nameJa, website, segment, source = "manual", orgs = [], slug } = {}) {
  const cleanName = cleanText(name, 120);
  if (!cleanName) throw new HttpError(400, "Company name is required");
  const logins = [...new Map(parseLogins(orgs).map((l) => [l.toLowerCase(), l])).values()];
  const [companies, allOrgs] = await Promise.all([store.hgetall("companies"), store.hgetall("orgs")]);
  checkLogins(logins, allOrgs, companies);
  const id = await store.incr("seq:company");
  const company = { id, slug: uniqueSlug(slug || cleanName, companies), name: cleanName, nameJa: cleanText(nameJa, 120),
    website: cleanUrl(website), segment: cleanText(segment, 60), source, createdAt: nowIso() };
  await store.hset("companies", { [id]: company });
  if (logins.length) await store.hset("orgs", Object.fromEntries(logins.map((l) => [l.toLowerCase(), newOrg(l, id)])));
  return company;
}

export async function updateCompany(store, id, patch = {}) {
  const companyId = Number(id);
  const [companies, allOrgs] = await Promise.all([store.hgetall("companies"), store.hgetall("orgs")]);
  const current = companies[companyId];
  if (!current) throw new HttpError(404, "Company not found");
  const next = { ...current };
  if ("name" in patch) {
    next.name = cleanText(patch.name, 120);
    if (!next.name) throw new HttpError(400, "Company name is required");
  }
  if ("nameJa" in patch) next.nameJa = cleanText(patch.nameJa, 120);
  if ("website" in patch) next.website = cleanUrl(patch.website);
  if ("segment" in patch) next.segment = cleanText(patch.segment, 60);

  if ("orgs" in patch) {
    const wanted = new Map(parseLogins(patch.orgs).map((l) => [l.toLowerCase(), l]));
    checkLogins([...wanted.values()], allOrgs, companies, companyId);
    const owned = Object.entries(allOrgs).filter(([, o]) => o.companyId === companyId).map(([key]) => key);
    const removed = owned.filter((key) => !wanted.has(key));
    if (removed.length) {
      await store.hdel("orgs", ...removed);
      await store.del(...removed.flatMap((key) => [`repos:${key}`, `contrib:${key}`]));
    }
    const added = [...wanted.entries()].filter(([key]) => !owned.includes(key));
    if (added.length) await store.hset("orgs", Object.fromEntries(added.map(([key, login]) => [key, newOrg(login, companyId)])));
  }
  await store.hset("companies", { [companyId]: next });
  return next;
}

export async function deleteCompany(store, id) {
  const companyId = Number(id);
  const [companies, allOrgs, candidates] = await Promise.all(
    [store.hgetall("companies"), store.hgetall("orgs"), store.hgetall("candidates")]);
  if (!companies[companyId]) throw new HttpError(404, "Company not found");
  const owned = Object.entries(allOrgs).filter(([, o]) => o.companyId === companyId).map(([key]) => key);
  if (owned.length) {
    await store.hdel("orgs", ...owned);
    await store.del(...owned.flatMap((key) => [`repos:${key}`, `contrib:${key}`]));
  }
  await store.del(`snapshots:${companyId}`);
  await store.hdel("companies", String(companyId));
  // A company that came from discovery goes back to the review list.
  const linked = Object.entries(candidates).filter(([, c]) => c.companyId === companyId);
  if (linked.length) {
    await store.hset("candidates", Object.fromEntries(linked.map(([key, c]) => [key, { ...c, status: "pending", companyId: null }])));
  }
}

/** Add seed companies/orgs that are missing. Never overwrites edits made in the dashboard. */
export async function importSeed(store, seed = SEED_COMPANIES) {
  let companiesAdded = 0;
  let orgsAdded = 0;
  for (const entry of seed) {
    const [companies, allOrgs] = await Promise.all([store.hgetall("companies"), store.hgetall("orgs")]);
    const existing = Object.values(companies).find((c) => c.slug === entry.slug);
    const free = entry.orgs.filter((login) => !allOrgs[login.toLowerCase()]);
    if (!existing) {
      if (!free.length) continue;
      await createCompany(store, { ...entry, orgs: free, source: "seed" });
      companiesAdded++;
      orgsAdded += free.length;
    } else if (free.length) {
      await store.hset("orgs", Object.fromEntries(free.map((l) => [l.toLowerCase(), newOrg(l, existing.id)])));
      orgsAdded += free.length;
    }
  }
  return { companiesAdded, orgsAdded };
}
