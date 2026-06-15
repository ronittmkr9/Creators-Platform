/**
 * Module-level cache that persists across Next.js client-side navigations.
 * JS module variables survive route changes — they only reset on full page refresh.
 *
 * Usage:
 *   const data = await cachedFetch("lists", () => fetch("/api/lists").then(r => r.json()));
 *   invalidateCache("lists");  // force next call to re-fetch
 */

interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
}

// The singleton store — lives for the entire browser session
const store = new Map<string, CacheEntry<unknown>>();

// In-flight promise deduplication — prevents parallel mounts from firing duplicate requests
const inflight = new Map<string, Promise<unknown>>();

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch with stale-while-revalidate semantics:
 * - If cached and fresh → return instantly, revalidate in background
 * - If cached but stale → return stale instantly, revalidate in background
 * - If not cached → fetch, store, return
 * - Deduplicates concurrent requests for the same key
 */
export async function cachedFetch<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlMs: number = DEFAULT_TTL_MS,
): Promise<T> {
  const entry = store.get(key) as CacheEntry<T> | undefined;
  const now = Date.now();
  const isFresh = entry && (now - entry.fetchedAt) < ttlMs;

  if (isFresh) {
    // Fresh cache hit — revalidate silently in background
    revalidate(key, fetcher);
    return entry.data;
  }

  if (entry) {
    // Stale — return stale immediately and revalidate in background
    revalidate(key, fetcher);
    return entry.data;
  }

  // No cache — must wait for the fetch
  return revalidate(key, fetcher);
}

/** Force a background re-fetch without waiting, deduplicating concurrent calls */
function revalidate<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key) as Promise<T> | undefined;
  if (existing) return existing;

  const promise = fetcher()
    .then((data) => {
      store.set(key, { data, fetchedAt: Date.now() });
      inflight.delete(key);
      return data;
    })
    .catch((err) => {
      inflight.delete(key);
      throw err;
    });

  inflight.set(key, promise as Promise<unknown>);
  return promise;
}

/** Invalidate a key so the next cachedFetch is forced to re-fetch */
export function invalidateCache(...keys: string[]) {
  keys.forEach((k) => store.delete(k));
}

/** Read from cache synchronously (returns null if not cached) */
export function getCached<T>(key: string): T | null {
  const entry = store.get(key) as CacheEntry<T> | undefined;
  return entry ? entry.data : null;
}

/** Write to cache directly (e.g. after a mutation) */
export function setCached<T>(key: string, data: T) {
  store.set(key, { data, fetchedAt: Date.now() });
}