// Picks the storage driver: Upstash Redis or Postgres (Neon) when their env vars exist (Vercel),
// local JSON files otherwise.
import path from "node:path";
import { createFileStore } from "./store-file.js";
import { createNeonStore } from "./store-postgres.js";
import { createRedisStore } from "./store-redis.js";
import { importSeed } from "./companies.js";
import { nowIso } from "./util.js";

export function createStoreFromEnv(env = process.env) {
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) return createRedisStore({ url, token, prefix: env.STORE_PREFIX || "jprr:" });
  const pgUrl = env.DATABASE_URL || env.POSTGRES_URL;
  if (pgUrl) return createNeonStore(pgUrl);
  if (env.VERCEL) {
    // Vercel functions only have a temporary /tmp. It works for a demo but is wiped regularly.
    return createFileStore({ dir: "/tmp/jprr-data", ephemeral: true });
  }
  return createFileStore({ dir: env.DATA_DIR || path.join(process.cwd(), "data") });
}

/** One store per server process (globalThis survives Next.js bundling and hot reloads). */
export function getStore() {
  if (!globalThis.__jprrStore) globalThis.__jprrStore = createStoreFromEnv();
  return globalThis.__jprrStore;
}

/** Load the starter company list the first time the app runs against an empty store. */
export async function ensureSeeded(store) {
  if (globalThis.__jprrSeeded === store) return;
  if (!(await store.get("seeded"))) {
    if (await store.lock("seed", 30000)) {
      try {
        if (!(await store.get("seeded"))) {
          await importSeed(store);
          await store.set("seeded", nowIso());
        }
      } finally {
        await store.unlock("seed");
      }
    }
  }
  globalThis.__jprrSeeded = store;
}

/** Store with seed data guaranteed - what API routes use. */
export async function readyStore() {
  const store = getStore();
  await ensureSeeded(store);
  return store;
}
