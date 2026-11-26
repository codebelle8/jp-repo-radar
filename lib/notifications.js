// In-app notifications for the signed-in owner (auto-fix results, pull request reviews, CI, merges).
//   notifications : hash  id -> {id, type, title, body, vars, link, fixId, at, read}
// `title` and `body` are English templates with {placeholders}; the browser translates them, so a notification
// reads correctly after switching languages.
import { nowIso } from "./util.js";

const KEY = "notifications";
const MAX = 200;

export async function notify(store, { type, title, body = "", vars = {}, link = null, fixId = null }) {
  const at = nowIso();
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const item = { id, type, title, body, vars, link, fixId, at, read: false };
  await store.hset(KEY, { [id]: item });
  const all = await store.hgetall(KEY);
  const ids = Object.values(all).sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id)).map((n) => n.id);
  if (ids.length > MAX) await store.hdel(KEY, ...ids.slice(MAX));
  return item;
}

export async function listNotifications(store, { limit = 50 } = {}) {
  const all = Object.values(await store.hgetall(KEY)).sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));
  return { items: all.slice(0, limit), unread: all.filter((n) => !n.read).length, total: all.length };
}

export async function unreadCount(store) {
  return Object.values(await store.hgetall(KEY)).filter((n) => !n.read).length;
}

/** Mark the given ids, or everything with "all", as read. */
export async function markRead(store, ids) {
  const all = await store.hgetall(KEY);
  const pick = ids === "all" ? Object.keys(all) : (Array.isArray(ids) ? ids : []).filter((id) => all[id]);
  const changed = {};
  for (const id of pick) if (!all[id].read) changed[id] = { ...all[id], read: true };
  if (Object.keys(changed).length) await store.hset(KEY, changed);
  return { marked: Object.keys(changed).length };
}
