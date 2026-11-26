// Test doubles: a fake GitHub API (fetch-compatible) and a fake Upstash Redis REST server.
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createFileStore } from "../lib/store-file.js";

export const RATE = { limit: 5000, cost: 1, remaining: 4900, resetAt: "2030-01-01T00:00:00Z" };

function respond(status, payload, headers = {}) {
  if (status === 204) return new Response(null, { status, headers });
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  return new Response(body, { status, headers: { "content-type": "application/json", ...headers } });
}

export function makeRepo(id, owner, name, o = {}) {
  const pushed = o.pushed || "2026-11-01T00:00:00Z";
  return {
    databaseId: id, name, nameWithOwner: `${owner}/${name}`, description: `${name} repo`, url: `https://github.com/${owner}/${name}`,
    homepageUrl: "", isArchived: !!o.archived, isTemplate: false, isMirror: false,
    primaryLanguage: o.lang === null ? null : { name: o.lang || "TypeScript" }, stargazerCount: o.stars || 0, forkCount: 0,
    createdAt: "2020-01-01T00:00:00Z", pushedAt: pushed, updatedAt: pushed, licenseInfo: { spdxId: "MIT" },
    defaultBranchRef: { name: "main" }, repositoryTopics: { nodes: [{ topic: { name: "web" } }] },
    branches: { totalCount: o.branches ?? 1 }, openIssues: { totalCount: o.openIssues || 0 },
    closedIssues: { totalCount: o.closedIssues || 0 }, openPullRequests: { totalCount: o.prs || 0 },
  };
}

/** A repository node as returned for the RepoContrib fragment. issues: [{title, labels, assigned, linkedPr, updatedAt, assoc}] */
export function contribNode(name, o = {}) {
  return {
    name,
    contributingGuidelines: o.contributing ? { url: `https://github.com/x/${name}/blob/main/CONTRIBUTING.md` } : null,
    openIssues: {
      totalCount: (o.issues || []).length,
      nodes: (o.issues || []).map((i, n) => ({
        number: n + 1, title: i.title || `Issue ${n + 1}`, createdAt: i.createdAt || "2026-10-01T00:00:00Z",
        updatedAt: i.updatedAt || "2026-11-01T00:00:00Z", authorAssociation: i.assoc || "NONE",
        labels: { nodes: (i.labels || []).map((label) => ({ name: label })) },
        assignees: { totalCount: i.assigned ? 1 : 0 }, comments: { totalCount: i.comments || 0 },
        linkedPrs: { totalCount: i.linkedPr ? 1 : 0 },
      })),
    },
    recentIssues: { nodes: o.recent || [] },
    mergedPrs: { nodes: o.merged || [] },
  };
}

export function profile(login, o = {}) {
  const langs = o.langs || ["TypeScript", "Ruby", "Go"];
  return {
    login, name: o.name ?? login, description: o.description || "", websiteUrl: o.websiteUrl || null,
    location: o.location ?? "Tokyo, Japan", email: "", isVerified: !!o.isVerified, avatarUrl: "", createdAt: "2015-01-01T00:00:00Z",
    repositories: { totalCount: o.total ?? 25, nodes: langs.map((lang) => ({ primaryLanguage: { name: lang }, pushedAt: "2026-10-01T00:00:00Z", isArchived: false })) },
  };
}

export class FakeGitHub {
  constructor() {
    this.orgs = new Map();
    this.failSizes = {};       // page size -> number of 502 responses to return
    this.search = {};          // location -> [logins]
    this.searchTotals = {};    // query -> total_count override
    this.profiles = {};        // login -> enrichment profile
    this.contrib = {};         // "owner/name" (lower case) -> RepoContrib node
    this.contribMaxBatch = Infinity;   // contribution requests for more repositories answer 502
    this.contribRequested = [];        // repository names asked for
    this.viewerData = { login: "tester", pullRequests: { nodes: [] }, issueComments: { nodes: [] } };   // tracker sync
    this.resources = {};               // issue URL (lower case) -> {url, title, state, closedAt}
    this.calls = [];
    this.restHandlers = [];            // [method, RegExp on the path, (match, body, url) => [status, payload]]
    this.restCalls = [];               // {method, path, body}
    this.graphqlHandlers = [];         // [substring of the query, (variables) => data]
    this.rateLimitSeconds = 0; // > 0: next request answers 403 rate limited
    this.fetch = this.fetch.bind(this);
  }

  onRest(method, re, fn) { this.restHandlers.push([method, re, fn]); return this; }
  onGraphql(marker, fn) { this.graphqlHandlers.push([marker, fn]); return this; }

  addOrg(login, repos, info = {}) {
    this.orgs.set(login.toLowerCase(), {
      info: { login, name: info.name || login, description: "", websiteUrl: info.websiteUrl || null, location: "Tokyo, Japan",
        email: "", isVerified: true, avatarUrl: `https://avatars.example/${login}`, url: `https://github.com/${login}` },
      repos,
    });
  }

  async fetch(url, init = {}) {
    this.calls.push(url);
    if (!String(init.headers?.Authorization || "").startsWith("Bearer ")) return respond(401, { message: "Requires authentication" });
    if (this.rateLimitSeconds) {
      const reset = Math.floor(Date.now() / 1000) + this.rateLimitSeconds;
      this.rateLimitSeconds = 0;
      return respond(403, { message: "API rate limit exceeded" }, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(reset) });
    }
    if (url.endsWith("/graphql")) {
      const { query, variables } = JSON.parse(init.body);
      const custom = this.graphqlHandlers.find(([marker]) => query.includes(marker));
      if (custom) return respond(200, { data: { rateLimit: RATE, ...custom[1](variables) } });
      if (query.includes("query TrackerSync")) {
        const data = { rateLimit: RATE, viewer: this.viewerData };
        for (const [k, url] of Object.entries(variables || {})) data[k] = this.resources[url.toLowerCase()] || null;
        return respond(200, { data });
      }
      if (query.includes("viewer")) return respond(200, { data: { viewer: { login: "tester" }, rateLimit: RATE } });
      if (query.includes("fragment OrgFields")) {
        const data = { rateLimit: RATE };
        for (const [key, login] of Object.entries(variables)) data[`o${key.slice(1)}`] = this.profiles[login] || null;
        return respond(200, { data });
      }
      if (query.includes("fragment RepoContrib")) return this.contribPage(variables);
      return this.orgPage(variables);
    }
    const method = init.method || "GET";
    const path = new URL(url).pathname;
    for (const [m, re, fn] of this.restHandlers) {
      const match = m === method && path.match(re);
      if (!match) continue;
      const body = init.body ? JSON.parse(init.body) : undefined;
      this.restCalls.push({ method, path, body });
      const [status, payload] = fn(match, body, new URL(url));
      return respond(status, payload ?? (status >= 400 ? { message: "Not Found" } : {}));
    }
    if (url.includes("/search/users")) {
      const u = new URL(url);
      const q = u.searchParams.get("q");
      const place = q.split('location:"')[1].split('"')[0];
      const logins = this.search[place] || [];
      const page = Number(u.searchParams.get("page") || 1);
      const per = Number(u.searchParams.get("per_page") || 30);
      const items = logins.slice((page - 1) * per, page * per).map((login) => ({ login, type: "Organization" }));
      return respond(200, { total_count: this.searchTotals[q] ?? logins.length, items });
    }
    return respond(404, { message: "Not Found" });
  }

  contribPage(v) {
    const keys = Object.keys(v).filter((k) => /^n\d+$/.test(k));
    if (keys.length > this.contribMaxBatch) return respond(502, "Bad Gateway");
    const data = { rateLimit: RATE };
    const errors = [];
    for (const k of keys) {
      this.contribRequested.push(v[k]);
      const node = this.contrib[`${v.owner}/${v[k]}`.toLowerCase()] || null;
      data[`r${k.slice(1)}`] = node;
      if (!node) errors.push({ type: "NOT_FOUND", message: `Could not resolve to a Repository with the name '${v.owner}/${v[k]}'.` });
    }
    return respond(200, errors.length ? { data, errors } : { data });
  }

  orgPage(v) {
    if (this.failSizes[v.first]) {
      this.failSizes[v.first]--;
      return respond(502, "Bad Gateway");
    }
    const org = this.orgs.get(v.login.toLowerCase());
    if (!org) {
      return respond(200, { data: { rateLimit: RATE, organization: null },
        errors: [{ type: "NOT_FOUND", message: `Could not resolve to an Organization with the login of '${v.login}'.` }] });
    }
    const start = Number(v.after || 0);
    const nodes = org.repos.slice(start, start + v.first);
    const hasNext = start + v.first < org.repos.length;
    return respond(200, { data: { rateLimit: RATE, organization: { ...org.info, repositories: {
      totalCount: org.repos.length, nodes, pageInfo: { hasNextPage: hasNext, endCursor: hasNext ? String(start + v.first) : null } } } } });
  }
}

export function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jprr-test-"));
  const store = createFileStore({ dir });
  store.cleanup = () => fs.rmSync(dir, { recursive: true, force: true });
  return store;
}

/** Minimal Upstash-compatible REST server (single commands and /pipeline) backed by memory. */
export async function startFakeUpstash(token = "secret") {
  const kv = new Map();
  const range = (list, a, b) => {
    const n = list.length;
    const s = a < 0 ? Math.max(0, n + a) : a;
    const e = b < 0 ? n + b : Math.min(b, n - 1);
    return s > e || s >= n ? [] : list.slice(s, e + 1);
  };
  function run([cmd, ...args]) {
    switch (cmd.toUpperCase()) {
      case "GET": return kv.get(args[0]) ?? null;
      case "SET": {
        const nx = args.includes("NX");
        if (nx && kv.has(args[0])) return null;
        kv.set(args[0], args[1]);
        return "OK";
      }
      case "DEL": { let n = 0; for (const k of args) if (kv.delete(k)) n++; return n; }
      case "MGET": return args.map((k) => kv.get(k) ?? null);
      case "INCR": { const v = Number(kv.get(args[0]) || 0) + 1; kv.set(args[0], String(v)); return v; }
      case "HSET": {
        const h = kv.get(args[0]) || new Map();
        for (let i = 1; i < args.length; i += 2) h.set(args[i], args[i + 1]);
        kv.set(args[0], h);
        return (args.length - 1) / 2;
      }
      case "HGET": return kv.get(args[0])?.get(args[1]) ?? null;
      case "HGETALL": return [...(kv.get(args[0]) || new Map()).entries()].flat();
      case "HDEL": { const h = kv.get(args[0]); let n = 0; for (const f of args.slice(1)) if (h?.delete(f)) n++; return n; }
      case "RPUSH": { const l = kv.get(args[0]) || []; l.push(...args.slice(1)); kv.set(args[0], l); return l.length; }
      case "LRANGE": return range(kv.get(args[0]) || [], Number(args[1]), Number(args[2]));
      case "LTRIM": kv.set(args[0], range(kv.get(args[0]) || [], Number(args[1]), Number(args[2]))); return "OK";
      default: throw new Error(`ERR unknown command '${cmd}'`);
    }
  }
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.headers.authorization !== `Bearer ${token}`) { res.statusCode = 401; res.end(JSON.stringify({ error: "Unauthorized" })); return; }
      const parsed = JSON.parse(body);
      const exec = (c) => { try { return { result: run(c) }; } catch (e) { return { error: e.message }; } };
      if (req.url === "/pipeline") { res.end(JSON.stringify(parsed.map(exec))); return; }
      const out = exec(parsed);
      if (out.error) res.statusCode = 400;
      res.end(JSON.stringify(out));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${server.address().port}`, token, kv, close: () => new Promise((r) => server.close(r)) };
}

/** Stand-in for the Anthropic client's Managed Agents surface (agents, environments, sessions, events, files). */
export class FakeAnthropic {
  constructor() {
    this.agents = [];
    this.created = [];        // session create params
    this.sent = [];           // {sessionId, events}
    this.uploads = [];        // {id, name, text}
    this.sessions = {};       // id -> {status, usage, events: [...asc], files: [{id, filename, content}]}
    const iter = (items) => ({ data: items, [Symbol.asyncIterator]: async function* () { yield* items; } });
    const self = this;
    this.beta = {
      environments: { create: async (p) => ({ id: "env_1", ...p }) },
      agents: {
        create: async (p) => { const a = { id: "agent_1", version: 1, ...p }; self.agents.push(["create", p]); return a; },
        update: async (id, p) => { self.agents.push(["update", p]); return { id, version: self.agents.length, ...p }; },
      },
      files: {
        upload: async ({ file }) => {
          const id = `file_${self.uploads.length + 1}`;
          self.uploads.push({ id, name: file.name, text: await file.text() });
          return { id, filename: file.name };
        },
        list: ({ scope_id }) => iter((self.sessions[scope_id]?.files || []).map((f) => ({ id: f.id, filename: f.filename }))),
        download: async (id) => {
          const f = Object.values(self.sessions).flatMap((x) => x.files || []).find((x) => x.id === id);
          return { text: async () => f.content };
        },
      },
      sessions: {
        create: async (p) => {
          const id = `sesn_${self.created.length + 1}`;
          self.created.push(p);
          self.sessions[id] = { status: "running", usage: { list_cost: { amount: "0", currency: "USD" } }, events: [], files: [] };
          return { id, status: "running" };
        },
        retrieve: async (id) => ({ id, ...self.sessions[id] }),
        events: {
          list: (id, params = {}) => {
            const events = [...(self.sessions[id]?.events || [])];
            return iter(params.order === "desc" ? events.reverse() : events);
          },
          send: async (sessionId, { events }) => { self.sent.push({ sessionId, events }); return {}; },
        },
      },
    };
  }

  /** Finish a session: idle after end_turn with a result.json in its outputs. */
  finish(id, result, { cost = "180", outcome = "satisfied" } = {}) {
    Object.assign(this.sessions[id], {
      status: "idle", usage: { list_cost: { amount: cost, currency: "USD" } },
      events: [{ type: "span.outcome_evaluation_end", result: outcome }, { type: "session.status_idle", stop_reason: { type: "end_turn" } }],
      files: [{ id: `out_${id}`, filename: "result.json", content: JSON.stringify(result) }],
    });
  }
}
