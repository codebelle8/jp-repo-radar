// Minimal GitHub API client (GraphQL + REST) built on fetch.
// Short waits (secondary limits, Retry-After) are slept inline; long waits throw RateLimitError so the
// job can pause and continue later - serverless functions must not sleep for an hour.
import { sleep as defaultSleep } from "./util.js";

// GITHUB_API_URL lets tests point the app at a mock server.
export const API_URL = (process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/+$/, "");

export class GitHubError extends Error {}
export class AuthError extends GitHubError {}
export class TransientError extends GitHubError {}
export class NotFoundError extends GitHubError {}
export class RateLimitError extends GitHubError {
  constructor(message, resetAt) {
    super(message);
    this.resetAt = resetAt;
  }
}

function messageOf(text) {
  try {
    return JSON.parse(text).message || text.slice(0, 200);
  } catch {
    return String(text).slice(0, 200);
  }
}

export function createGitHubClient({ token, fetchImpl = fetch, sleep = defaultSleep, log = () => {},
  now = Date.now, maxInlineWaitMs = 20000, timeoutMs = 30000 } = {}) {
  if (!token) throw new AuthError("No GitHub token configured. Add GITHUB_TOKEN (see Settings).");
  const rate = {};
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "jp-repo-radar",
    "Content-Type": "application/json",
  };

  function trackRate(h) {
    const resource = h.get("x-ratelimit-resource");
    const remaining = h.get("x-ratelimit-remaining");
    if (resource && remaining != null) {
      rate[resource] = { limit: Number(h.get("x-ratelimit-limit")), remaining: Number(remaining),
        reset: Number(h.get("x-ratelimit-reset")) };
    }
  }

  function rateLimitWait(status, h, text) {
    const retryAfter = h.get("retry-after");
    if (retryAfter) return Math.max(1000, Number(retryAfter) * 1000 || 60000);
    if (h.get("x-ratelimit-remaining") === "0" && h.get("x-ratelimit-reset")) {
      return Math.max(1000, Number(h.get("x-ratelimit-reset")) * 1000 - now());
    }
    if (/rate limit/i.test(text) || status === 429) return 60000;
    return null;   // a real permission error
  }

  async function request(method, url, body, retries = 2) {
    for (let attempt = 1; ; attempt++) {
      let res;
      try {
        res = await fetchImpl(url, { method, headers, body, cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
      } catch (err) {
        if (attempt <= retries) {
          await sleep(1000 * attempt);
          continue;
        }
        throw new TransientError(`Network error talking to GitHub: ${err.message}`);
      }
      trackRate(res.headers);
      if (res.status === 401) {
        throw new AuthError("GitHub rejected the token (401 Unauthorized). Check that it is valid and not expired.");
      }
      if (res.status === 403 || res.status === 429) {
        const text = await res.text();
        const waitMs = rateLimitWait(res.status, res.headers, text);
        if (waitMs == null) throw new GitHubError(`GitHub refused the request (HTTP ${res.status}): ${messageOf(text)}`);
        if (waitMs <= maxInlineWaitMs) {
          log(`GitHub rate limit; waiting ${Math.ceil(waitMs / 1000)}s`);
          await sleep(waitMs + 500);
          continue;
        }
        throw new RateLimitError("GitHub rate limit reached", now() + waitMs);
      }
      if (res.status >= 500) {
        if (attempt <= retries) {
          await sleep(1000 * attempt);
          continue;
        }
        throw new TransientError(`GitHub returned HTTP ${res.status}`);
      }
      if (res.status === 404) throw new NotFoundError(messageOf(await res.text()));
      if (res.status >= 400) throw new GitHubError(`HTTP ${res.status}: ${messageOf(await res.text())}`);
      return res;
    }
  }

  async function graphql(query, variables = {}, { retries = 2 } = {}) {
    for (;;) {
      const res = await request("POST", `${API_URL}/graphql`, JSON.stringify({ query, variables }), retries);
      let payload;
      try {
        payload = await res.json();
      } catch {
        throw new TransientError("GitHub returned a response that is not JSON");
      }
      const data = payload.data;
      const errors = payload.errors || [];
      if (errors.length) {
        const types = new Set(errors.map((e) => e.type));
        const message = errors.map((e) => e.message).join("; ").slice(0, 500);
        const lower = message.toLowerCase();
        if (types.has("RATE_LIMITED") || lower.includes("rate limit")) {
          const reset = rate.graphql?.reset;
          const waitMs = reset ? Math.max(1000, reset * 1000 - now()) : 60000;
          if (waitMs <= maxInlineWaitMs) {
            await sleep(waitMs);
            continue;
          }
          throw new RateLimitError("GraphQL rate limit reached", now() + waitMs);
        }
        if (lower.includes("timeout") || lower.includes("something went wrong")) {
          throw new TransientError(`GitHub GraphQL timeout: ${message}`);
        }
        const onlyNotFound = types.size === 1 && types.has("NOT_FOUND");
        const hasData = data && Object.entries(data).some(([key, value]) => key !== "rateLimit" && value != null);
        if (!onlyNotFound && !hasData) throw new GitHubError(`GraphQL error: ${message}`);
        if (!onlyNotFound) log(`GraphQL warning (partial data): ${message}`);
      }
      const limit = data?.rateLimit;
      if (limit) {
        rate.graphql = { limit: limit.limit, remaining: limit.remaining, cost: limit.cost,
          reset: limit.resetAt ? Math.floor(Date.parse(limit.resetAt) / 1000) : null };
      }
      return data || {};
    }
  }

  async function restGet(path, params = {}) {
    const url = new URL(API_URL + path);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
    const res = await request("GET", url.href);
    return res.json();
  }

  async function viewer() {
    const data = await graphql("query { viewer { login } rateLimit { limit cost remaining resetAt } }");
    return { login: data.viewer.login };
  }

  /** True when the GraphQL budget is nearly spent; callers pause until `rate.graphql.reset`. */
  const graphqlLow = () => rate.graphql && rate.graphql.remaining != null && rate.graphql.remaining < 50;

  return { graphql, restGet, viewer, rate, graphqlLow };
}
