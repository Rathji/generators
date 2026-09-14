// src/runtime.js
// Thin accessor onto the plugin's single-file API.
//
// A Perchance import pulls in only the other generator's main.pjs — never its
// index.html or its src/ files. So the whole implementation lives in main.pjs
// and every module under src/ is a thin shim onto root.getMs365Api(): exactly
// the API object importers get as root.<handle>. That way the validation suites
// in src/*.test.js exercise the code that actually ships.

let cached = null;

export function ms365Api() {
  if (!cached) {
    const r = (typeof root !== "undefined" && root) ? root : window.root;
    cached = r.getMs365Api();
  }
  return cached;
}
