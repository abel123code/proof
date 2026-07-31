/**
 * Protection for the repo-listing endpoint.
 *
 * Anyone's public repos are listable on purpose: contributors, employees and agencies all
 * legitimately want a video about work in a repo they do not personally own, and locking the field
 * to your own handle blocked more real users than it protected. See DECISIONS.md.
 *
 * The genuine risk was never authorisation, it was RATE. The picker runs on ONE shared server token
 * (GitHub gives 5000 req/hr for the entire app), and unlike analyze-repo, which costs credits and is
 * therefore self-limiting, listing was free and uncapped. One buggy client loop could drain the
 * quota for every user at once.
 *
 * Two cheap layers, no new infrastructure:
 *  1. a short shared cache, so repeated lookups of the same handle cost ZERO GitHub quota
 *  2. a per-user cap, so a single account cannot spend the shared quota on cache misses
 *
 * Both are per-instance. On serverless that means a determined attacker gets the limit times the
 * number of warm instances, so this is a speed bump rather than a wall. It is sized for the real
 * failure mode (a runaway loop or one over-curious user), and the durable version belongs in
 * Postgres if abuse ever actually shows up.
 */

export const REPO_LIST_CACHE_TTL_MS = 60_000;
export const REPO_LIST_MAX_PER_WINDOW = 30;
export const REPO_LIST_WINDOW_MS = 60_000;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();
const hits = new Map<string, number[]>();

/** Cached lookup keyed by GitHub handle. `now` is injectable so tests never sleep. */
export async function withRepoListCache<T>(
  key: string,
  now: number,
  load: () => Promise<T>,
): Promise<T> {
  const entry = cache.get(key);
  if (entry && entry.expiresAt > now) return entry.value as T;
  const value = await load();
  cache.set(key, { value, expiresAt: now + REPO_LIST_CACHE_TTL_MS });
  // Keep the map from growing without bound on a long-lived instance.
  if (cache.size > 500) {
    for (const [k, v] of cache) if (v.expiresAt <= now) cache.delete(k);
  }
  return value;
}

/**
 * Sliding-window cap per user. Returns false when the caller has exceeded it.
 * Only called on a cache MISS, so normal use (revisiting the picker) never counts against it.
 */
export function allowRepoList(userId: string, now: number): boolean {
  const windowStart = now - REPO_LIST_WINDOW_MS;
  const recent = (hits.get(userId) ?? []).filter((t) => t > windowStart);
  if (recent.length >= REPO_LIST_MAX_PER_WINDOW) {
    hits.set(userId, recent);
    return false;
  }
  recent.push(now);
  hits.set(userId, recent);
  return true;
}

/** Test-only reset so cases don't leak into each other. */
export function __resetRepoListGuard(): void {
  cache.clear();
  hits.clear();
}
