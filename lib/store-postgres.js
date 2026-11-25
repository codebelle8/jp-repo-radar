// Postgres storage driver (used with Neon on Vercel). Three small tables emulate the key/value, hash, list
// and lock operations the other drivers provide, so the rest of the app does not know which one it uses.
// `query(text, params)` must resolve to an array of row objects.
import { neon } from "@neondatabase/serverless";
import { redisRange } from "./util.js";

const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS jprr_kv (key text PRIMARY KEY, value jsonb NOT NULL)",
  "CREATE TABLE IF NOT EXISTS jprr_hash (key text NOT NULL, field text NOT NULL, value jsonb NOT NULL, PRIMARY KEY (key, field))",
  "CREATE TABLE IF NOT EXISTS jprr_lock (name text PRIMARY KEY, until bigint NOT NULL)",
];

export function createPostgresStore({ query, location = "postgres" }) {
  let ready = null;
  const init = () => {
    if (!ready) {
      ready = (async () => { for (const stmt of SCHEMA) await query(stmt, []); })();
      ready.catch(() => { ready = null; });   // retry on the next call if the database was unreachable
    }
    return ready;
  };
  const q = async (text, params = []) => {
    await init();
    return query(text, params);
  };
  const json = (value) => JSON.stringify(value);

  async function get(key) {
    const rows = await q("SELECT value FROM jprr_kv WHERE key = $1", [key]);
    return rows.length ? rows[0].value : null;
  }
  async function set(key, value) {
    await q("INSERT INTO jprr_kv (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
      [key, json(value)]);
  }

  return {
    kind: "postgres",
    ephemeral: false,
    location,
    get,
    set,
    async del(...keys) {
      if (!keys.length) return;
      await q("DELETE FROM jprr_kv WHERE key = ANY($1::text[])", [keys]);
      await q("DELETE FROM jprr_hash WHERE key = ANY($1::text[])", [keys]);
    },
    async mget(keys) {
      if (!keys.length) return [];
      const rows = await q("SELECT key, value FROM jprr_kv WHERE key = ANY($1::text[])", [keys]);
      const found = new Map(rows.map((r) => [r.key, r.value]));
      return keys.map((k) => (found.has(k) ? found.get(k) : null));
    },
    async hget(key, field) {
      const rows = await q("SELECT value FROM jprr_hash WHERE key = $1 AND field = $2", [key, String(field)]);
      return rows.length ? rows[0].value : null;
    },
    async hgetall(key) {
      const rows = await q("SELECT field, value FROM jprr_hash WHERE key = $1", [key]);
      return Object.fromEntries(rows.map((r) => [r.field, r.value]));
    },
    async hset(key, fields) {
      const entries = Object.entries(fields);
      if (!entries.length) return;
      await q(
        "INSERT INTO jprr_hash (key, field, value) SELECT $1, f, v::jsonb FROM unnest($2::text[], $3::text[]) AS t(f, v) "
        + "ON CONFLICT (key, field) DO UPDATE SET value = EXCLUDED.value",
        [key, entries.map(([f]) => String(f)), entries.map(([, v]) => json(v))]);
    },
    async hdel(key, ...fields) {
      if (!fields.length) return;
      await q("DELETE FROM jprr_hash WHERE key = $1 AND field = ANY($2::text[])", [key, fields.map(String)]);
    },
    async rpush(key, ...values) {
      const rows = await q(
        "INSERT INTO jprr_kv (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = jprr_kv.value || EXCLUDED.value "
        + "RETURNING jsonb_array_length(value) AS n", [key, json(values)]);
      return Number(rows[0].n);
    },
    async lrange(key, start, stop) { return redisRange((await get(key)) || [], start, stop); },
    async ltrim(key, start, stop) { await set(key, redisRange((await get(key)) || [], start, stop)); },
    async incr(key) {
      const rows = await q(
        "INSERT INTO jprr_kv (key, value) VALUES ($1, '1'::jsonb) ON CONFLICT (key) DO UPDATE "
        + "SET value = to_jsonb((jprr_kv.value #>> '{}')::bigint + 1) RETURNING value", [key]);
      return Number(rows[0].value);
    },
    async lock(name, ttlMs) {
      const now = Date.now();
      const rows = await q(
        "INSERT INTO jprr_lock (name, until) VALUES ($1, $2) ON CONFLICT (name) DO UPDATE SET until = EXCLUDED.until "
        + "WHERE jprr_lock.until < $3 RETURNING name", [name, now + ttlMs, now]);
      return rows.length > 0;
    },
    async unlock(name) { await q("DELETE FROM jprr_lock WHERE name = $1", [name]); },
  };
}

/** Postgres store over Neon's HTTP driver (works in Vercel functions without connection pooling). */
export function createNeonStore(url) {
  const sql = neon(url);
  let host = "postgres";
  try { host = new URL(url).host; } catch { /* keep default */ }
  return createPostgresStore({ query: (text, params) => sql.query(text, params), location: `Postgres · ${host}` });
}
