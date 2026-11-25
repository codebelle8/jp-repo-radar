// Local storage driver: one JSON file per key under data/kv/. Used when no Redis is configured.
// Reads always hit the disk, so the dashboard and the CLI script can share the same data folder.
import fs from "node:fs";
import path from "node:path";
import { redisRange } from "./util.js";

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function createFileStore({ dir, ephemeral = false }) {
  const kvDir = path.join(dir, "kv");
  const lockDir = path.join(dir, "locks");
  fs.mkdirSync(kvDir, { recursive: true });
  fs.mkdirSync(lockDir, { recursive: true });

  const fileOf = (key) => path.join(kvDir, `${encodeURIComponent(key)}.json`);

  function read(key) {
    try {
      return JSON.parse(fs.readFileSync(fileOf(key), "utf8"));
    } catch (err) {
      if (err.code === "ENOENT") return null;
      throw err;
    }
  }

  function write(key, value) {
    const target = fileOf(key);
    const tmp = `${target}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value));
    // Windows can briefly refuse the rename while another process reads the file; retry a few times.
    for (let attempt = 0; ; attempt++) {
      try {
        fs.renameSync(tmp, target);
        return;
      } catch (err) {
        if (attempt >= 8 || !["EPERM", "EBUSY", "EACCES"].includes(err.code)) {
          try { fs.unlinkSync(tmp); } catch { /* ignore */ }
          throw err;
        }
        sleepSync(25 * (attempt + 1));
      }
    }
  }

  function remove(key) {
    try {
      fs.unlinkSync(fileOf(key));
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }
  }

  return {
    kind: "file",
    ephemeral,
    location: dir,
    async get(key) { return read(key); },
    async set(key, value) { write(key, value); },
    async del(...keys) { keys.forEach(remove); },
    async mget(keys) { return keys.map(read); },
    async hget(key, field) { return (read(key) || {})[field] ?? null; },
    async hgetall(key) { return read(key) || {}; },
    async hset(key, fields) {
      const hash = read(key) || {};
      Object.assign(hash, fields);
      write(key, hash);
    },
    async hdel(key, ...fields) {
      const hash = read(key) || {};
      for (const f of fields) delete hash[f];
      write(key, hash);
    },
    async rpush(key, ...values) {
      const list = read(key) || [];
      list.push(...values);
      write(key, list);
      return list.length;
    },
    async lrange(key, start, stop) { return redisRange(read(key) || [], start, stop); },
    async ltrim(key, start, stop) { write(key, redisRange(read(key) || [], start, stop)); },
    async incr(key) {
      const value = (Number(read(key)) || 0) + 1;
      write(key, value);
      return value;
    },
    async lock(name, ttlMs) {
      const file = path.join(lockDir, `${encodeURIComponent(name)}.lock`);
      const until = Date.now() + ttlMs;
      try {
        fs.writeFileSync(file, String(until), { flag: "wx" });
        return true;
      } catch (err) {
        if (err.code !== "EEXIST") throw err;
        const held = Number(fs.readFileSync(file, "utf8")) || 0;
        if (held > Date.now()) return false;
        fs.writeFileSync(file, String(until));   // expired lock: take it over
        return true;
      }
    },
    async unlock(name) {
      try { fs.unlinkSync(path.join(lockDir, `${encodeURIComponent(name)}.lock`)); } catch { /* already gone */ }
    },
  };
}
