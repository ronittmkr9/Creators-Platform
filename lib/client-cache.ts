/**
 * lib/client-cache.ts
 *
 * Module-level cache that persists across Next.js client-side navigations.
 * JS module variables survive route changes — they only reset on full page refresh.
 *
 * Behaviour:
 *   - FRESH  (age < TTL)  → return instantly, NO network call
 *   - STALE  (age >= TTL) → return instantly, revalidate in background
 *   - MISS                → fetch, store, return
 *   - Concurrent requests for the same key share one in-flight Promise
 */

interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
}

// The singleton store — lives for the entire browser session
const store = new Map<string, CacheEntry<unknown>>();

// In-flight promise deduplication — prevents parallel callers firing duplicate requests
const inflight = new Map<string, Promise<unknown>>();

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function cachedFetch<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlMs: number = DEFAULT_TTL_MS,
): Promise<T> {
  const entry = store.get(key) as CacheEntry<T> | undefined;

  if (entry) {
    const isStale = Date.now() - entry.fetchedAt >= ttlMs;
    if (isStale) {
      // Stale — return immediately, kick off silent background refresh
      revalidate(key, fetcher);
    }
    // Fresh — return immediately, no network call at all
    return entry.data;
  }

  // Nothing cached — must wait for the fetch
  return revalidate(key, fetcher);
}

/** Fire a background re-fetch, deduplicating concurrent calls for the same key */
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

/** Invalidate one or more keys so the next cachedFetch forces a re-fetch */
export function invalidateCache(...keys: string[]) {
  keys.forEach((k) => {
    store.delete(k);
    inflight.delete(k);
  });
}

/**
 * Invalidate every cached key starting with the given prefix.
 *
 * Use this when a mutation can affect a family of cache entries whose exact
 * keys you don't know at the call site — e.g. saving a creator's note from
 * the creator detail page should invalidate every `notes:...` entry on the
 * Notes page (one per niche/filter/page combination), not just one key.
 */
export function invalidateCacheByPrefix(prefix: string) {
  for (const k of store.keys()) {
    if (k.startsWith(prefix)) store.delete(k);
  }
  for (const k of inflight.keys()) {
    if (k.startsWith(prefix)) inflight.delete(k);
  }
}

/** Read from cache synchronously — returns null if not cached */
export function getCached<T>(key: string): T | null {
  const entry = store.get(key) as CacheEntry<T> | undefined;
  return entry ? entry.data : null;
}

/** Read full cache entry including fetchedAt — for manual staleness checks */
export function getCacheEntry<T>(key: string): CacheEntry<T> | null {
  return (store.get(key) as CacheEntry<T> | undefined) ?? null;
}

/** Write to cache directly (e.g. after an optimistic update) */
export function setCached<T>(key: string, data: T) {
  store.set(key, { data, fetchedAt: Date.now() });
}