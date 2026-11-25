"use client";
// Browser-side API access.
import { useCallback, useEffect, useState } from "react";

export async function api(path, { body, method } = {}) {
  const init = { headers: {}, cache: "no-store" };
  if (body !== undefined) {
    init.method = method || "POST";
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  } else if (method) {
    init.method = method;
  }
  const res = await fetch(path, init);
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* not JSON */
  }
  if (!res.ok) throw new Error((data && data.error) || `Request failed (HTTP ${res.status})`);
  return data;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetch JSON from `url` (skipped while url is null). Keeps the previous data while reloading,
 * so charts and tables hold their frame instead of flashing.
 */
export function useApi(url, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: !!url });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!url) return undefined;
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    api(url)
      .then((data) => { if (alive) setState({ data, error: null, loading: false }); })
      .catch((error) => { if (alive) setState((s) => ({ data: s.data, error, loading: false })); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, tick, ...deps]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload, setData: (fn) => setState((s) => ({ ...s, data: typeof fn === "function" ? fn(s.data) : fn })) };
}
