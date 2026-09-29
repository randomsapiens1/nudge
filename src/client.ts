import type { Config } from "./config.js";

/** POST to the local daemon. Returns null on any failure so callers can fall back silently. */
export async function callDaemon<T = unknown>(
  config: Config,
  path: string,
  body: unknown,
  timeoutMs = 5_000,
): Promise<T | null> {
  try {
    const res = await fetch(`http://127.0.0.1:${config.port}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-nudge-secret": config.secret },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}
