// src/framework/categories.js — category tree data provider.
//
// The shell only needs "give me the category tree, async". The concrete
// loader is injected by src/app.js (currently the seed tree from the `kb`
// config in main.pjs; later phases swap in a store-backed loader). The
// provider caches successful loads and never caches failures, so a retry
// after an error actually re-fetches.

export function createCategoriesProvider(loadTree) {
  let cache = null;
  let inflight = null;
  return {
    async getTree() {
      if (cache) return cache;
      if (!inflight) {
        inflight = (async () => {
          try {
            cache = await loadTree();
            return cache;
          } finally {
            inflight = null;
          }
        })();
      }
      return inflight;
    },
    invalidate() {
      cache = null;
    },
  };
}
