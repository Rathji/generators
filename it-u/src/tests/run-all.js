// src/tests/run-all.js — one-call runner for every test suite.
//
//   await import("./src/tests/run-all.js").then((m) => m.runAll())
//
// Imports each `*.test.js`, calls its `run()`, and aggregates the per-suite
// results (passed / failed / skipped) plus timings. Each import and each suite
// is bounded by `timeoutMs` so a single hung suite can't wedge the sweep.
//
// Pass `{ live: true }` to let store.test.js make its real cloud round-trip
// (otherwise it reports as skipped).

const TEST_FILES = [
  "access.test.js",
  "applications.test.js",
  "ask-ai.test.js",
  "audit.test.js",
  "backup.test.js",
  "billing.test.js",
  "checklist.test.js",
  "circuit-addressing.test.js",
  "circuit-migration.test.js",
  "circuit-provisioning.test.js",
  "circuit.test.js",
  "classification.test.js",
  "collab.test.js",
  "completeness.test.js",
  "configuration.test.js",
  "contact.test.js",
  "credential-tools.test.js",
  "cutover.test.js",
  "docsets.test.js",
  "documents.test.js",
  "email.test.js",
  "field.test.js",
  "flexible.test.js",
  "governance.test.js",
  "help.test.js",
  "idp.test.js",
  "import.test.js",
  "integration.test.js",
  "integrity.test.js",
  "library.test.js",
  "licensing.test.js",
  "lifecycle.test.js",
  "linter-fixes.test.js",
  "linter.test.js",
  "network.test.js",
  "org-templates.test.js",
  "organization.test.js",
  "otp.test.js",
  "packet.test.js",
  "passwords.test.js",
  "playbook.test.js",
  "publication.test.js",
  "relationships.test.js",
  "roles.test.js",
  "runbook.test.js",
  "search.test.js",
  "service-assets.test.js",
  "site-diagrams.test.js",
  "sso.test.js",
  "store.test.js",
  "structured-assets.test.js",
  "sync-backup.test.js",
  "sync.test.js",
  "template-library.test.js",
  "theme.test.js",
  "trackers.test.js",
  "ui-asset-fields.test.js",
  "ui-groups-view.test.js",
  "ui-shared.test.js",
  "ui-station.test.js",
  "ui-std-fields.test.js",
  "versioning.test.js",
  "voice.test.js",
  "voip-coverage.test.js",
  "workflow.test.js",
  // shell last: it drives the live app router (location.hash) and is the
  // environment-coupled suite, so keep it away from the pure suites.
  "shell.test.js",
];

export { TEST_FILES };

function withTimeout(promise, ms, label) {
  if (!ms || ms <= 0) return promise;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms: ${label}`)), ms);
    Promise.resolve(promise).then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

/**
 * @param {object} [opts]
 *   timeoutMs — per-file deadline (default 60000)
 *   live      — forward {live:true} to each suite (store's cloud round-trip)
 *   onProgress— called after each file with { name, index, total, res, ms }
 * @returns {{ok, files, total, passed, failed, skipped, failures, skips, timings}}
 */
export async function runAll(opts = {}) {
  const { timeoutMs = 60000, live = false, onProgress = null } = opts;
  const summary = { ok: false, files: 0, total: 0, passed: 0, failed: 0, skipped: 0, failures: [], skips: [], timings: [] };

  for (let i = 0; i < TEST_FILES.length; i++) {
    const name = TEST_FILES[i];
    const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
    let res;
    try {
      const mod = await withTimeout(import(new URL(name, import.meta.url).href), timeoutMs, "import " + name);
      if (!mod || typeof mod.run !== "function") throw new Error(name + " has no run() export");
      res = await withTimeout(Promise.resolve(mod.run({ live })), timeoutMs, name + ".run()");
    } catch (e) {
      res = { passed: 0, failed: 1, skipped: 0, total: 1, failures: [{ name: "<suite load>", error: String((e && e.message) || e) }], skips: [] };
    }
    if (!res || typeof res !== "object") res = { passed: 0, failed: 1, skipped: 0, total: 1, failures: [{ name: "<bad result>", error: "suite returned " + res }], skips: [] };
    const ms = Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - t0);

    summary.files += 1;
    summary.total += res.total || (res.passed || 0) + (res.failed || 0) + (res.skipped || 0);
    summary.passed += res.passed || 0;
    summary.failed += res.failed || 0;
    summary.skipped += res.skipped || 0;
    for (const f of res.failures || []) summary.failures.push({ file: name, name: f.name, error: f.error });
    for (const s of res.skips || []) summary.skips.push({ file: name, name: s.name, reason: s.reason });
    summary.timings.push({ file: name, ms, passed: res.passed || 0, failed: res.failed || 0, skipped: res.skipped || 0 });
    if (onProgress) onProgress({ name, index: i + 1, total: TEST_FILES.length, res, ms });
  }

  summary.ok = summary.failed === 0;
  return summary;
}

/** A compact one-line human summary (handy for console/UI). */
export function formatSummary(s) {
  const parts = [`${s.files} files`, `${s.passed} passed`, `${s.failed} failed`, `${s.skipped} skipped`, `${s.total} total`];
  if (s.failures && s.failures.length) parts.push(`${s.failures.length} suite(s) with failures`);
  return parts.join(" · ");
}
