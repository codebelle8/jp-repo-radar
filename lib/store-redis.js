// Redis storage driver over the Upstash REST API (what Vercel's "Upstash for Redis" integration provides).
// No SDK needed: every command is a JSON array POSTed to the REST endpoint.

export function createRedisStore({ url, token, prefix = "jprr:", fetchImpl = fetch }) {
  const base = url.replace(/\/+$/, "");
  const k = (key) => prefix + key;
  const enc = (value) => JSON.stringify(value);
  const dec = (raw) => (raw == null ? null : JSON.parse(raw));

  async function post(body, suffix = "") {
    const res = await fetchImpl(base + suffix, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    let data;
    try {
      data = await res.json();
    } catch {
      throw new Error(`Redis REST returned HTTP ${res.status}`);
    }
    if (!res.ok && !Array.isArray(data)) throw new Error(`Redis: ${data?.error || `HTTP ${res.status}`}`);
    return data;
  }

  async function cmd(...args) {
    const data = await post(args.map(String));
    if (data.error) throw new Error(`Redis: ${data.error}`);
    return data.result;
  }

  return {
    kind: "redis",
    ephemeral: false,
    location: base.replace(/^https?:\/\//, ""),
    async get(key) { return dec(await cmd("GET", k(key))); },
    async set(key, value) { await cmd("SET", k(key), enc(value)); },
    async del(...keys) { if (keys.length) await cmd("DEL", ...keys.map(k)); },
    async mget(keys) {
      if (!keys.length) return [];
      return (await cmd("MGET", ...keys.map(k))).map(dec);
    },
    async hget(key, field) { return dec(await cmd("HGET", k(key), field)); },
    async hgetall(key) {
      const flat = (await cmd("HGETALL", k(key))) || [];
      const out = {};
      for (let i = 0; i < flat.length; i += 2) out[flat[i]] = dec(flat[i + 1]);
      return out;
    },
    async hset(key, fields) {
      const args = Object.entries(fields).flatMap(([field, value]) => [field, enc(value)]);
      if (args.length) await cmd("HSET", k(key), ...args);
    },
    async hdel(key, ...fields) { if (fields.length) await cmd("HDEL", k(key), ...fields); },
    async rpush(key, ...values) { return Number(await cmd("RPUSH", k(key), ...values.map(enc))); },
    async lrange(key, start, stop) { return ((await cmd("LRANGE", k(key), start, stop)) || []).map(dec); },
    async ltrim(key, start, stop) { await cmd("LTRIM", k(key), start, stop); },
    async incr(key) { return Number(await cmd("INCR", k(key))); },
    async lock(name, ttlMs) { return (await cmd("SET", k(`lock:${name}`), "1", "NX", "PX", ttlMs)) === "OK"; },
    async unlock(name) { await cmd("DEL", k(`lock:${name}`)); },
  };
}
