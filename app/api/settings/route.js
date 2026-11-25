import { createGitHubClient, AuthError, GitHubError } from "@/lib/github";
import { guardWrite, json, readBody, route } from "@/lib/http";
import { getToken } from "@/lib/jobs";
import { readyStore } from "@/lib/store";
import { HttpError, nowIso } from "@/lib/util";

export const dynamic = "force-dynamic";

async function verify(token) {
  try {
    const { login } = await createGitHubClient({ token }).viewer();
    return { login, error: null, checkedAt: nowIso() };
  } catch (err) {
    if (err instanceof AuthError || err instanceof GitHubError) return { login: null, error: err.message, checkedAt: nowIso() };
    throw err;
  }
}

// POST { token }        save a token (local file storage only), verifying it first; "" removes it
// POST { verify: true } check the configured token
export const POST = route(async (request) => {
  guardWrite(request);
  const body = await readBody(request);
  const store = await readyStore();

  if ("token" in body) {
    if (store.ephemeral) {
      throw new HttpError(400, "Storage is temporary on this deployment: set GITHUB_TOKEN in Vercel → Project Settings → Environment Variables instead.");
    }
    const token = String(body.token || "").trim();
    const settings = (await store.get("settings")) || {};
    if (!token) {
      delete settings.githubToken;
      await store.set("settings", settings);
      await store.del("tokenInfo");
      return json({ ok: true });
    }
    const info = await verify(token);
    if (info.error) throw new HttpError(400, info.error);
    await store.set("settings", { ...settings, githubToken: token });
    await store.set("tokenInfo", info);
    return json({ ok: true, login: info.login });
  }

  if (body.verify) {
    const { token } = await getToken(store);
    if (!token) throw new HttpError(400, "No GitHub token configured");
    const info = await verify(token);
    await store.set("tokenInfo", info);
    return json(info);
  }
  throw new HttpError(400, "Nothing to update");
});
