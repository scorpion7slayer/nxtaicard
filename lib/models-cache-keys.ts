// Single source of truth for the schema keys used by the pre-computed models
// cache. Kept dependency-free so the file cache and refresh path share the same
// versioning.
//
// Migration protocol when bumping the schema:
//   1. Prepend a new key (e.g. `"benchsift:models:v2"`) at the top of
//      MODELS_KEYS - that's what writes target.
//   2. Keep the previous key in the list while migrating existing cache files.
//   3. After a couple of refresh runs, drop old keys from the list.
//
// Reads tolerate older entries because every field added to LLMModel is
// optional — missing fields just render as undefined.
export const MODELS_KEYS = [
  "benchsift:models:v2",
  "benchsift:models:v1",
  "nxtaicard:models:v13",
  "nxtaicard:models:v3",
] as const;

export const MODELS_WRITE_KEY = MODELS_KEYS[0];

// Stale-but-readable window for the cache entry. Long enough that a broken job
// doesn't take the site down; short enough to eventually flush truly stale
// shapes.
export const MODELS_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
