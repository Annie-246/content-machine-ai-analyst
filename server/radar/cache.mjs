// A small in-process TTL cache, same shape as the one server/handlers.mjs
// already uses for video fetches. Deliberately not Redis: the app has no such
// dependency and the Radar does not justify introducing one.
//
// Scope is one server process. That is enough to stop the common, expensive
// mistake - the same scan fired twice within minutes - without pretending to be
// shared infrastructure.

const store = new Map();

// Keeps a long-running server from growing without bound.
const MAX_ENTRIES = 200;

export const cacheGet = (key) => {
  const hit = store.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    store.delete(key);
    return null;
  }
  return hit.value;
};

export const cacheSet = (key, value, ttlMs) => {
  if (store.size >= MAX_ENTRIES) {
    // Map preserves insertion order, so the first key is the oldest write.
    const oldest = store.keys().next().value;
    if (oldest !== undefined) store.delete(oldest);
  }
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
};

export const cacheClear = () => store.clear();

// ---------------------------------------------------------------------------
// In-flight de-duplication.
//
// Disabling the button stops a double click, but two requests can still race
// each other into the gap before the first one fills the cache - and each would
// be a separately billed actor run. Identical concurrent work shares one promise.

const inflight = new Map();

export const withInflight = (key, fn) => {
  const running = inflight.get(key);
  if (running) return running;

  const promise = (async () => fn())().finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
};
