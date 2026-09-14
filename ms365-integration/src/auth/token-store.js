// src/auth/token-store.js — THIN SHIM.
// The implementation lives in main.pjs (a Perchance import pulls in only the
// other generator's main.pjs), so this module just re-exports the matching
// namespace of root.getMs365Api() — the same object importers receive. See
// src/runtime.js and src/README.md. Exported names mirror the original module.
import { ms365Api } from "../runtime.js";
// Constructing this returns an instance of the API's own TokenStore class, so
// save()/load()/clear() behave exactly like the shipped implementation
// (synchronous with a synchronous storage, promise-returning with an async one).
export class TokenStore {
  constructor(storage, opts) {
    return new (ms365Api().tokenStore.TokenStore)(storage, opts);
  }
}
