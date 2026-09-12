/* ============================================================
   RMM-U — command & script execution  (Phase 2 · Task 11)

   The job path, end to end:

     console ──enqueue──▶ queued ──agent check-in──▶ delivered
                                                        │
                                              agent runs the script
                                                        ▼
                        running ──result──▶ succeeded / failed / timed-out
                          │
                    (unsupported on this OS → clear failure, no run)

     • A job targets ONE device or MANY (a whole group/fleet). Every
       target gets its own per-device state and its own captured
       output; the job's aggregate state is derived from its targets.
     • Scripts are PowerShell / cmd / bash / sh / python / binary, each
       with a per-OS compatibility rule. When a job is unsupported on a
       target's OS the agent is never told to run it and the target
       fails immediately with a clear reason (or, when the OS is known
       up front, at enqueue time).
     • The agent receives queued jobs in its heartbeat response and
       returns an authenticated result with exit code + stdout/stderr.
       This is what Task 14/15 mirror server-side.
     • Delivery is at-least-once with a bounded number of attempts: a
       job delivered but never started is re-queued after
       config.rmm.jobDeliveryTimeoutMinutes; one that runs too long is
       marked timed-out; finished jobs are pruned after
       config.rmm.jobRetentionHours.

   Records live in the hidden `jobs` document (rmm-v1-jobs):
     { kind:"job", id, providerId, name, language, script, args,
       timeoutSeconds, workingDir, createdBy, createdAt, updatedAt,
       state, source, expiresAt, maxAttempts, targets[], results{} }

   window.ERP.jobs is the service.
   ============================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  if (!ERP || !ERP.tenancy) return;
  const T = ERP.tenancy;
  const D = ERP.devices;
  const E = ERP.enrollment;
  const J = (ERP.jobs = {});

  J.MODULE = "jobs";

  /* ─────────────────────── helpers ─────────────────────── */

  const cfg = (path, fallback) => { try { return ERP.configVal(path, fallback); } catch (e) { return fallback; } };
  const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
  const asArr = (v) => (Array.isArray(v) ? v.slice() : []);
  const asObj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
  const num = (v, d) => { const n = Number(v); return isFinite(n) ? n : (d == null ? 0 : d); };
  const now = () => new Date().toISOString();
  const S = (v, cap) => String(v == null ? "" : v).slice(0, cap || 200);
  const rid = (p) => p + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  J.DEFAULT_TIMEOUT = () => Math.max(10, num(cfg("rmm.jobTimeoutSeconds", 300), 300));
  J.OUTPUT_BYTES = () => Math.max(1024, num(cfg("rmm.jobOutputBytes", 65536), 65536));
  J.RETENTION_HOURS = () => Math.max(1, num(cfg("rmm.jobRetentionHours", 168), 168));
  J.DELIVERY_TIMEOUT_MIN = () => Math.max(1, num(cfg("rmm.jobDeliveryTimeoutMinutes", 30), 30));
  J.MAX_ATTEMPTS = () => Math.max(1, num(cfg("rmm.jobMaxAttempts", 2), 2));
  J.SCRIPT_MAX_BYTES = () => Math.max(1024, num(cfg("rmm.jobScriptMaxBytes", 262144), 262144));

  /* ── base64 codec ──
     Job scripts/output travel between the collector and the agent as
     base64 so that arbitrary bytes (multi-byte characters, CRLF, NUL)
     survive the JSON round-trip untouched. */

  J.toB64 = function (text) {
    const s = String(text == null ? "" : text);
    try {
      const bytes = new TextEncoder().encode(s);
      let bin = "";
      for (let i = 0; i < bytes.length; i += 0x8000) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      }
      return btoa(bin);
    } catch (e) {
      try { return btoa(unescape(encodeURIComponent(s))); } catch (e2) { return ""; }
    }
  };

  J.fromB64 = function (b64) {
    if (b64 == null || b64 === "") return "";
    const s = String(b64).replace(/\s+/g, "");
    try {
      const bin = atob(s);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new TextDecoder().decode(bytes);
    } catch (e) {
      try { return decodeURIComponent(escape(atob(s))); } catch (e2) { return ""; }
    }
  };

  /* ── per-OS language catalogue ── */
  J.LANGUAGES = [
    { id: "powershell", label: "PowerShell", ext: ".ps1", families: ["Windows"], server: true },
    { id: "cmd", label: "Command prompt (cmd.exe)", ext: ".cmd", families: ["Windows"], server: false },
    { id: "bash", label: "Bash", ext: ".sh", families: ["Linux", "macOS"], server: true },
    { id: "sh", label: "POSIX shell", ext: ".sh", families: ["Linux", "macOS"], server: false },
    { id: "python", label: "Python", ext: ".py", families: ["Windows", "Linux", "macOS"], server: false },
    { id: "binary", label: "Executable / binary", ext: "", families: ["Windows", "Linux", "macOS"], server: false },
  ];
  J.language = (id) => J.LANGUAGES.find((l) => l.id === id) || null;
  J.languageLabel = (id) => (J.language(id) || {}).label || id;
  J.OS_FAMILIES = ["Windows", "Linux", "macOS"];

  /* Normalise a device's OS family. The device record stores it, but be
     forgiving when only a name is present. */
  J.familyOf = function (dev) {
    const fam = String(asObj(dev && dev.os).family || "").trim();
    if (J.OS_FAMILIES.indexOf(fam) !== -1) return fam;
    const name = String(asObj(dev && dev.os).name || "");
    if (/windows/i.test(name)) return "Windows";
    if (/mac ?os|darwin|os x/i.test(name)) return "macOS";
    if (/linux|ubuntu|debian|centos|red ?hat|fedora|suse|alpine|rocky/i.test(name)) return "Linux";
    return fam || "Windows";
  };

  J.compatible = function (language, family) {
    const l = J.language(typeof language === "object" ? language.id : language);
    if (!l) return false;
    if (!family) return true;
    return l.families.indexOf(family) !== -1;
  };

  /* The exact command line the agent runs. Exposed so the generated agent
     and the console show the same thing. */
  J.commandLine = function (job, family) {
    const j = asObj(job);
    const l = J.language(j.language) || {};
    const args = asArr(j.args).map((a) => String(a)).join(" ");
    const file = (l.ext ? "job" + l.ext : "job");
    const win = family === "Windows";
    const dir = j.workingDir || (win ? "%TEMP%" : "/tmp");
    const path = dir.replace(/[\\/]$/, "") + (win ? "\\" : "/") + file;
    if (l.id === "powershell") return 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + path + '"' + (args ? " " + args : "");
    if (l.id === "cmd") return 'cmd.exe /d /s /c "' + path + '"' + (args ? " " + args : "");
    if (l.id === "bash") return '/bin/bash "' + path + '"' + (args ? " " + args : "");
    if (l.id === "sh") return '/bin/sh "' + path + '"' + (args ? " " + args : "");
    if (l.id === "python") return (win ? "python.exe" : "python3") + ' "' + path + '"' + (args ? " " + args : "");
    return '"' + path + '"' + (args ? " " + args : "");
  };

  /* ─────────────────────── change notification ─────────────────────── */

  const listeners = [];
  J.onChange = function (fn) {
    if (typeof fn !== "function") return () => {};
    listeners.push(fn);
    return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
  };
  function notify(type, payload) { listeners.slice().forEach((fn) => { try { fn(type, payload); } catch (e) {} }); }

  async function audit(action, targetId, summary) {
    try { if (ERP.master && typeof ERP.master.audit === "function") await ERP.master.audit({ action, targetType: "job", targetId, summary }); } catch (e) {}
  }

  function actorName() {
    try { if (ERP.team && ERP.team.me) { const me = ERP.team.me(); if (me && me.displayName) return String(me.displayName); } } catch (e) {}
    return ERP.role || "owner";
  }

  /* ─────────────────────── persistence ─────────────────────── */

  async function load() {
    const r = await ERP.store.loadDoc(J.MODULE);
    return asArr(r.error ? [] : r.records);
  }
  async function save(list) { return ERP.store.saveDoc(J.MODULE, list); }
  J.load = load;

  function findJob(records, id) { return records.find((r) => r.kind === "job" && String(r.id) === String(id)) || null; }

  function bound(text) {
    const cap = J.OUTPUT_BYTES();
    const s = String(text == null ? "" : text);
    if (s.length <= cap) return s;
    return s.slice(0, cap) + "\n…[truncated " + (s.length - cap) + " chars]";
  }
  J.bound = bound;

  /* ─────────────────────── state derivation ─────────────────────── */

  const DONE = ["succeeded", "failed", "timed-out", "unsupported", "expired", "cancelled"];
  J.TERMINAL_STATES = DONE.slice();

  J.deriveState = function (job) {
    job = asObj(job);
    if (job.cancelledAt) return "cancelled";
    const targets = asArr(job.targets);
    if (!targets.length) return "queued";
    const results = asObj(job.results);
    const states = targets.map((t) => asObj(results[t]).state || "queued");
    if (states.every((s) => s === "queued")) {
      if (job.expiresAt && Date.parse(job.expiresAt) < Date.now()) return "expired";
      return "queued";
    }
    if (states.every((s) => s === "succeeded")) return "succeeded";
    if (states.some((s) => s === "running")) return "running";
    if (states.some((s) => s === "delivered")) return "delivered";
    if (states.every((s) => DONE.indexOf(s) !== -1)) {
      const ok = states.filter((s) => s === "succeeded").length;
      if (ok > 0) return "partial";
      if (states.every((s) => s === "expired")) return "expired";
      if (states.every((s) => s === "unsupported")) return "unsupported";
      if (states.some((s) => s === "timed-out")) return "timed-out";
      if (states.some((s) => s === "cancelled")) return "cancelled";
      return "failed";
    }
    return "queued";
  };

  J.stateTone = function (s) {
    return s === "succeeded" ? "success" : s === "running" ? "info" : s === "delivered" ? "info"
      : s === "failed" ? "danger" : s === "timed-out" ? "warn" : s === "unsupported" ? "warn"
      : s === "partial" ? "warn" : s === "expired" || s === "cancelled" ? "muted" : "muted";
  };

  /* ─────────────────────── enqueue ─────────────────────── */

  /* opts: { providerId, deviceIds[], name, language, script, args[],
            timeoutSeconds?, workingDir?, source?, maxAttempts?,
            expiresInMinutes?, createdBy? }
     Creates one job for one or many devices, with a per-device state. */
  J.enqueue = async function (opts) {
    opts = opts || {};
    const providerId = opts.providerId;
    if (!providerId) return { error: "no_provider", message: "A job must belong to a provider." };
    const lang = J.language(opts.language);
    if (!lang) return { error: "unknown_language", message: "Choose a supported language." };
    const script = String(opts.script == null ? "" : opts.script);
    if (!script.trim()) return { error: "empty_script", message: "The script is empty." };
    if (script.length > J.SCRIPT_MAX_BYTES()) return { error: "script_too_large", message: "The script exceeds the size limit." };
    let deviceIds = [...new Set(asArr(opts.deviceIds).map(String).filter(Boolean))];
    if (!deviceIds.length) return { error: "no_targets", message: "Select at least one device." };

    const g = await T.get(providerId);
    if (g.error) return { error: g.error, message: g.message };
    const known = new Set(asArr(g.provider.devices).map((d) => String(d.id)));
    deviceIds = deviceIds.filter((id) => known.has(id));
    if (!deviceIds.length) return { error: "no_targets", message: "None of the selected devices exist." };

    const targets = deviceIds;
    const results = {};
    targets.forEach((id) => { results[id] = { state: "queued", attempts: 0, deliveredAt: "", startedAt: "", endedAt: "", exitCode: null }; });

    const timeout = Math.max(10, num(opts.timeoutSeconds, J.DEFAULT_TIMEOUT()));
    const expiresIn = opts.expiresInMinutes == null ? num(cfg("rmm.jobExpiryMinutes", 1440), 1440) : num(opts.expiresInMinutes, 0);
    const job = {
      kind: "job",
      id: rid("job"),
      providerId,
      name: S(opts.name || ("Job " + new Date().toISOString()), 160),
      language: lang.id,
      script,
      args: asArr(opts.args).map((a) => S(a, 200)),
      timeoutSeconds: timeout,
      workingDir: S(opts.workingDir || "", 240),
      createdBy: opts.createdBy || actorName(),
      createdAt: now(),
      updatedAt: now(),
      cancelledAt: "",
      source: S(opts.source || "console", 120),
      expiresAt: expiresIn > 0 ? new Date(Date.now() + expiresIn * 60000).toISOString() : "",
      maxAttempts: Math.max(1, num(opts.maxAttempts, J.MAX_ATTEMPTS())),
      targets,
      results,
      state: "queued",
    };
    job.state = J.deriveState(job);

    const records = await load();
    records.push(job);
    const w = await save(records);
    if (w && w.error) return { error: w.error, message: w.message };
    notify("enqueue", { job: clone(job) });
    await audit("enqueue_job", job.id, "Queued " + J.languageLabel(job.language) + " job \"" + job.name + "\" for " + targets.length + " device(s).");
    return { ok: true, job: clone(job) };
  };

  /* ─────────────────────── claim (agent fetch) ─────────────────────── */

  /* Every check-in is authenticated per device. Returns the queued jobs
     this device should run now, marking each delivered. Jobs that are
     unsupported on the device OS are failed immediately instead of
     being handed over. */
  J.claim = async function (req) {
    req = req || {};
    const deviceId = req.deviceId;
    if (!deviceId) return { ok: false, error: "no_device", jobs: [] };
    const auth = await E.authenticate(deviceId, req.credential);
    if (!auth.ok) return { ok: false, error: auth.reason, jobs: [] };
    const providerId = auth.providerId || req.providerId || "";
    const g = await D.get(providerId, deviceId);
    if (g.error) return { ok: false, error: "unknown_device", jobs: [] };
    const family = J.familyOf(g.device);
    const limit = Math.max(1, num(req.limit, 5));

    const records = await load();
    const at = now();
    const out = [];
    let dirty = false;
    for (const job of records) {
      if (job.kind !== "job" || job.cancelledAt) continue;
      if (String(job.providerId) !== String(providerId)) continue;
      const res = asObj(job.results)[deviceId];
      if (!res || res.state !== "queued") continue;
      if (job.expiresAt && Date.parse(job.expiresAt) < Date.now()) { res.state = "expired"; res.error = "The job expired before it was delivered."; job.updatedAt = at; job.state = J.deriveState(job); dirty = true; continue; }
      if (!J.compatible(job.language, family)) {
        res.state = "unsupported"; res.error = "This " + J.languageLabel(job.language) + " job is not supported on " + family + "."; res.endedAt = at; job.updatedAt = at; job.state = J.deriveState(job); dirty = true;
        notify("unsupported", { jobId: job.id, deviceId, providerId });
        continue;
      }
      if (out.length >= limit) break;
      res.state = "delivered"; res.deliveredAt = at; res.attempts = num(res.attempts, 0) + 1;
      job.updatedAt = at; job.state = J.deriveState(job); dirty = true;
      out.push({
        jobId: job.id, name: job.name, language: job.language, script: job.script,
        scriptB64: J.toB64(job.script), args: asArr(job.args), argsB64: J.toB64(asArr(job.args).join("\n")),
        timeoutSeconds: num(job.timeoutSeconds, J.DEFAULT_TIMEOUT()),
        workingDir: job.workingDir, command: J.commandLine(job, family), attempt: res.attempts, maxAttempts: num(job.maxAttempts, 1),
      });
    }
    if (dirty) { const w = await save(records); if (w && w.error) return { ok: false, error: w.error, jobs: [] }; }
    if (out.length) notify("deliver", { deviceId, providerId, count: out.length });
    return { ok: true, deviceId, providerId, jobs: out, count: out.length };
  };

  /* ─────────────────────── result (agent posts) ─────────────────────── */

  /* req: { jobId, deviceId, credential, ok?, exitCode, stdout, stderr,
            error, startedAt, endedAt, timeoutSeconds }
     Authenticated per device. Captures bounded output and derives the
     job's aggregate state. */
  J.result = async function (req) {
    req = req || {};
    const { jobId, deviceId } = req;
    if (!jobId || !deviceId) return { ok: false, error: "no_job_or_device" };
    const auth = await E.authenticate(deviceId, req.credential);
    if (!auth.ok) return { ok: false, error: auth.reason };
    const records = await load();
    const job = findJob(records, jobId);
    if (!job) return { ok: false, error: "not_found" };
    if (String(job.providerId) !== String(auth.providerId || req.providerId || job.providerId)) return { ok: false, error: "wrong_provider" };
    const res = asObj(job.results)[deviceId];
    if (!res) return { ok: false, error: "not_targeted" };
    if (DONE.indexOf(res.state) !== -1) return { ok: true, job: clone(job), duplicate: true };

    const at = now();
    const endedAt = req.endedAt && isFinite(Date.parse(req.endedAt)) ? new Date(Date.parse(req.endedAt)).toISOString() : at;
    const startedAt = req.startedAt && isFinite(Date.parse(req.startedAt)) ? new Date(Date.parse(req.startedAt)).toISOString() : (res.startedAt || "");
    let state;
    if (req.state === "timed-out" || req.timedOut) state = "timed-out";
    else if (req.ok === true || (req.exitCode != null && num(req.exitCode, -1) === 0)) state = "succeeded";
    else state = "failed";
    res.state = state;
    res.startedAt = startedAt;
    res.endedAt = endedAt;
    res.durationMs = startedAt ? Math.max(0, Date.parse(endedAt) - Date.parse(startedAt)) : num(req.durationMs, 0);
    res.exitCode = req.exitCode == null ? null : num(req.exitCode, 0);
    const stdout = req.stdout == null && req.stdoutB64 ? J.fromB64(req.stdoutB64) : req.stdout;
    const stderr = req.stderr == null && req.stderrB64 ? J.fromB64(req.stderrB64) : req.stderr;
    res.stdout = bound(stdout);
    res.stderr = bound(stderr);
    res.error = S(req.error || "", 400);
    res.authenticatedAt = at;
    job.updatedAt = at;
    job.state = J.deriveState(job);
    const w = await save(records);
    if (w && w.error) return { ok: false, error: w.error, message: w.message };
    notify("result", { jobId, deviceId, state, exitCode: res.exitCode });
    await audit("job_result", jobId, "Job \"" + job.name + "\" on " + deviceId + " → " + state + (res.exitCode == null ? "" : " (exit " + res.exitCode + ")") + ".");
    return { ok: true, job: clone(job), deviceState: state };
  };

  /* ─────────────────────── reads ─────────────────────── */

  J.get = async function (providerId, jobId) {
    const records = await load();
    const job = findJob(records, jobId);
    if (!job) return { error: "not_found" };
    if (providerId && String(job.providerId) !== String(providerId)) return { error: "wrong_provider" };
    return { job: clone(job) };
  };

  J.list = async function (providerId, filter) {
    filter = filter || {};
    const records = await load();
    let list = records.filter((r) => r.kind === "job" && (!providerId || String(r.providerId) === String(providerId)));
    if (filter.deviceId) list = list.filter((j) => asArr(j.targets).some((t) => String(t) === String(filter.deviceId)));
    if (filter.state) list = list.filter((j) => J.deriveState(j) === filter.state);
    if (filter.language) list = list.filter((j) => j.language === filter.language);
    if (filter.search) {
      const q = String(filter.search).toLowerCase();
      list = list.filter((j) => (String(j.name || "") + " " + String(j.id || "") + " " + String(j.createdBy || "")).toLowerCase().indexOf(q) !== -1);
    }
    list.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    if (filter.limit) list = list.slice(0, filter.limit);
    return list.map((j) => Object.assign(clone(j), { state: J.deriveState(j), targetCount: asArr(j.targets).length, succeeded: J.count(j, "succeeded"), failed: J.count(j, ["failed", "timed-out", "unsupported"].filter(Boolean)) }));
  };

  J.count = function (job, states) {
    const list = Array.isArray(states) ? states : [states];
    const results = asObj(asObj(job).results);
    return asArr(asObj(job).targets).filter((t) => list.indexOf(asObj(results[t]).state) !== -1).length;
  };

  J.deviceJobs = async function (providerId, deviceId, limit) {
    return J.list(providerId, { deviceId, limit: limit || 20 });
  };

  J.stats = async function (providerId) {
    const list = await J.list(providerId);
    const byState = {};
    list.forEach((j) => { byState[j.state] = (byState[j.state] || 0) + 1; });
    const rows = list.length;
    let targets = 0, succeeded = 0, failed = 0;
    list.forEach((j) => { targets += j.targetCount; succeeded += j.succeeded; failed += j.failed; });
    return {
      jobs: rows, byState, targets, succeeded, failed,
      queued: byState.queued || 0, running: byState.running || 0, delivered: byState.delivered || 0,
      successRate: targets ? Math.round((succeeded / targets) * 100) : 0,
      bytes: 0,
    };
  };

  /* ─────────────────────── lifecycle ─────────────────────── */

  J.cancel = async function (providerId, jobId, deviceId) {
    const records = await load();
    const job = findJob(records, jobId);
    if (!job) return { error: "not_found" };
    const at = now();
    const results = asObj(job.results);
    asArr(job.targets).forEach((t) => {
      if (deviceId && String(t) !== String(deviceId)) return;
      const res = results[t] || (results[t] = {});
      if (DONE.indexOf(res.state) === -1) { res.state = "cancelled"; res.endedAt = at; res.error = res.error || "Cancelled from the console."; }
    });
    if (!deviceId) job.cancelledAt = at;
    job.updatedAt = at; job.state = J.deriveState(job);
    const w = await save(records);
    if (w && w.error) return { error: w.error, message: w.message };
    notify("cancel", { jobId, deviceId });
    await audit("cancel_job", jobId, "Cancelled job \"" + job.name + "\".");
    return { ok: true, job: clone(job) };
  };

  J.retry = async function (providerId, jobId, deviceId) {
    const records = await load();
    const job = findJob(records, jobId);
    if (!job) return { error: "not_found" };
    const at = now();
    const results = asObj(job.results);
    let n = 0;
    asArr(job.targets).forEach((t) => {
      if (deviceId && String(t) !== String(deviceId)) return;
      const res = results[t];
      if (!res) return;
      if (["failed", "timed-out", "unsupported", "expired", "cancelled"].indexOf(res.state) === -1) return;
      res.state = "queued"; res.deliveredAt = ""; res.startedAt = ""; res.endedAt = ""; res.exitCode = null; res.stdout = ""; res.stderr = ""; res.error = ""; res.retriedAt = at;
      n += 1;
    });
    if (!n) return { error: "nothing_to_retry" };
    job.cancelledAt = "";
    job.expiresAt = new Date(Date.now() + num(cfg("rmm.jobExpiryMinutes", 1440), 1440) * 60000).toISOString();
    job.updatedAt = at; job.state = J.deriveState(job);
    const w = await save(records);
    if (w && w.error) return { error: w.error, message: w.message };
    notify("retry", { jobId, deviceId, count: n });
    return { ok: true, retried: n, job: clone(job) };
  };

  /* Delivery/expiry/retention maintenance — call on the console's poll.
     Re-queues jobs that were delivered but never started, times out
     over-running executions, expires stale queues and prunes old jobs. */
  J.reap = async function (providerId) {
    const records = await load();
    const at = now();
    const atMs = Date.now();
    const deliveryMs = J.DELIVERY_TIMEOUT_MIN() * 60000;
    const retentionMs = J.RETENTION_HOURS() * 3600000;
    const out = { requeued: 0, timedOut: 0, expired: 0, pruned: 0 };
    const kept = [];
    for (const job of records) {
      if (job.kind !== "job") { kept.push(job); continue; }
      if (providerId && String(job.providerId) !== String(providerId)) { kept.push(job); continue; }
      const results = asObj(job.results);
      asArr(job.targets).forEach((t) => {
        const res = results[t];
        if (!res) return;
        if (res.state === "delivered" && res.deliveredAt && atMs - Date.parse(res.deliveredAt) > deliveryMs) {
          if (num(res.attempts, 0) < num(job.maxAttempts, 1)) { res.state = "queued"; res.deliveredAt = ""; out.requeued += 1; }
          else { res.state = "timed-out"; res.endedAt = at; res.error = "The agent did not start the job before the delivery window closed."; out.timedOut += 1; }
        } else if (res.state === "running" && res.startedAt && atMs - Date.parse(res.startedAt) > num(job.timeoutSeconds, J.DEFAULT_TIMEOUT()) * 2000) {
          res.state = "timed-out"; res.endedAt = at; res.error = "The job exceeded its timeout and was abandoned."; out.timedOut += 1;
        } else if (res.state === "queued" && job.expiresAt && Date.parse(job.expiresAt) < atMs) {
          res.state = "expired"; res.endedAt = at; res.error = "The job expired before it was delivered."; out.expired += 1;
        }
      });
      job.state = J.deriveState(job);
      if (DONE.indexOf(job.state) !== -1 && job.updatedAt && atMs - Date.parse(job.updatedAt) > retentionMs) { out.pruned += 1; continue; }
      kept.push(job);
    }
    if (out.requeued || out.timedOut || out.expired || out.pruned) {
      const w = await save(kept);
      if (w && w.error) return { error: w.error, message: w.message };
      notify("reap", out);
    }
    return Object.assign({ ok: true }, out);
  };

  /* ─────────────────────── display ─────────────────────── */

  function kvRows(rows) {
    return '<div class="rmm-kv">' + rows.filter((x) => x[1] !== "" && x[1] != null && x[1] !== "—").map((x) => '<div class="rmm-kv-row"><span>' + ERP.ui.esc(x[0]) + "</span><b>" + x[1] + "</b></div>").join("") + "</div>";
  }

  function durationText(ms) {
    ms = num(ms, 0);
    if (!ms) return "—";
    return ms < 1000 ? ms + " ms" : (ms / 1000).toFixed(1) + " s";
  }

  /* The "Jobs" section appended to the device modal. */
  J.deviceSection = async function (dev, providerId) {
    const ui = ERP.ui, esc = ui.esc;
    const jobs = await J.deviceJobs(providerId, dev.id, 8);
    const head = '<h4 class="rmm-section-title">Jobs &amp; command execution</h4>';
    const family = J.familyOf(dev);
    const body = jobs.length
      ? ui.table([
          { key: "name", label: "Job", render: (r) => "<b>" + esc(r.name) + "</b><div class=\"erp-sub\">" + esc(J.languageLabel(r.language)) + " · " + ui.dateTime(r.createdAt) + "</div>" },
          { key: "state", label: "State", render: (r) => ui.badge(asObj(asObj(r.results)[dev.id]).state || r.state, J.stateTone(asObj(asObj(r.results)[dev.id]).state || r.state)) },
          { key: "exit", label: "Exit", render: (r) => { const x = asObj(asObj(r.results)[dev.id]).exitCode; return x == null ? "—" : String(x); } },
          { key: "dur", label: "Duration", render: (r) => durationText(asObj(asObj(r.results)[dev.id]).durationMs) },
          { key: "view", label: "", render: (r) => ui.btn("Output", { small: true, act: "job-view", arg: r.id }) },
        ], jobs)
      : '<p class="erp-sub">No jobs have been run on this device.</p>';
    return head + body +
      '<div class="erp-btn-row">' + ui.btn("Run a command…", { small: true, primary: true, act: "job-new", arg: dev.id }) + "</div>" +
      '<p class="erp-sub">Commands run on ' + esc(family) + ". Supported: " + J.LANGUAGES.filter((l) => J.compatible(l.id, family)).map((l) => esc(l.label)).join(", ") + ".</p>";
  };

  /* Open the "run a command/script" form for one or many devices. */
  J.openJobForm = async function (opts) {
    opts = opts || {};
    const ui = ERP.ui, esc = ui.esc;
    const providerId = opts.providerId;
    const deviceIds = asArr(opts.deviceIds).map(String);
    const devices = [];
    for (const id of deviceIds) { const g = await D.get(providerId, id); if (!g.error) devices.push(g.device); }
    const families = [...new Set(devices.map((d) => J.familyOf(d)))];
    const langs = J.LANGUAGES.filter((l) => !families.length || families.some((f) => J.compatible(l.id, f)));
    const lang = opts.language || (langs[0] ? langs[0].id : "powershell");
    const who = devices.length === 1 ? (devices[0].hostname || devices[0].displayName || devices[0].id) : deviceIds.length + " device(s)";
    const body = ui.form(
      ui.text("jobName", "Job name", "Ad-hoc command") +
      ui.select("jobLanguage", "Language", langs.map((l) => ({ value: l.id, label: l.label })), lang) +
      ui.textarea("jobScript", "Script", opts.script || (lang === "powershell" ? "Write-Output \"Hello from $env:COMPUTERNAME\"" : lang === "cmd" ? "echo Hello from %COMPUTERNAME%" : "echo \"Hello from $(hostname)\""), 8) +
      ui.text("jobArgs", "Arguments (space-separated)", "") +
      ui.number("jobTimeout", "Timeout (seconds)", J.DEFAULT_TIMEOUT()) +
      ui.text("jobWorkDir", "Working directory (optional)", "") +
      '<p class="erp-sub">Target: <b>' + esc(who) + "</b>. Unsupported combinations fail with a clear result instead of running.</p>",
      ui.btn("Cancel", { small: true, attrs: { "data-ui-close": "1" } }) + " " + ui.btn("Run job", { small: true, primary: true, act: "job-submit" })
    );
    const m = ui.modal({ title: "Run a command or script", size: "lg", body });
    m.querySelector("[data-act=job-submit]").onclick = async () => {
      const v = ui.collect(m, ["jobName", "jobLanguage", "jobScript", "jobArgs", "jobTimeout", "jobWorkDir"]);
      const r = await J.enqueue({
        providerId, deviceIds,
        name: v.jobName || "Ad-hoc command", language: v.jobLanguage, script: v.jobScript,
        args: String(v.jobArgs || "").split(/\s+/).filter(Boolean),
        timeoutSeconds: num(v.jobTimeout, J.DEFAULT_TIMEOUT()), workingDir: v.jobWorkDir || "",
      });
      if (r.error) { (opts.toast || (() => {}))("Could not queue job: " + (r.message || r.error), "error"); return; }
      ui.closeModal();
      (opts.toast || (() => {}))("Job queued for " + deviceIds.length + " device(s) — it runs on the next check-in.", "success");
      if (opts.onDone) opts.onDone(r.job);
    };
  };

  /* Show a job's per-device output. */
  J.openJobView = async function (providerId, jobId, opts) {
    opts = opts || {};
    const ui = ERP.ui, esc = ui.esc;
    const r = await J.get(providerId, jobId);
    if (r.error) { (opts.toast || (() => {}))("Job not found", "error"); return; }
    const job = r.job;
    const blocks = asArr(job.targets).map((t) => {
      const res = asObj(job.results)[t];
      const badge = ui.badge(res.state || "queued", J.stateTone(res.state || "queued"));
      return "<h4 class=\"rmm-section-title\">" + esc(t) + " " + badge + "</h4>" +
        kvRows([
          ["Language", esc(J.languageLabel(job.language))], ["Exit code", res.exitCode == null ? "—" : String(res.exitCode)],
          ["Duration", durationText(res.durationMs)], ["Delivered", res.deliveredAt ? ui.dateTime(res.deliveredAt) : "—"],
          ["Started", res.startedAt ? ui.dateTime(res.startedAt) : "—"], ["Ended", res.endedAt ? ui.dateTime(res.endedAt) : "—"],
          ["Error", esc(res.error || "—")],
        ]) +
        (res.stdout ? '<div class="erp-sub">stdout</div><pre class="rmm-code">' + esc(res.stdout) + "</pre>" : "") +
        (res.stderr ? '<div class="erp-sub">stderr</div><pre class="rmm-code">' + esc(res.stderr) + "</pre>" : "");
    }).join("");
    ui.modal({
      title: job.name, size: "lg",
      body: kvRows([
        ["Job id", "<code>" + esc(job.id) + "</code>"], ["State", ui.badge(J.deriveState(job), J.stateTone(J.deriveState(job)))],
        ["Language", esc(J.languageLabel(job.language))], ["Queued by", esc(job.createdBy || "—")],
        ["Created", ui.dateTime(job.createdAt)], ["Timeout", job.timeoutSeconds + "s"],
        ["Targets", String(asArr(job.targets).length)],
      ]) +
        '<div class="erp-sub">Script</div><pre class="rmm-code">' + esc(job.script) + "</pre>" + blocks,
      foot: ui.btn("Close", { small: true, attrs: { "data-ui-close": "1" } }),
    });
  };

  J.wireDeviceSection = function (rootEl, opts) {
    if (!rootEl) return;
    opts = opts || {};
    const ui = ERP.ui;
    ui.bind(rootEl, "click", "[data-act]", async (t, e, act, arg) => {
      if (act === "job-new") return J.openJobForm({ providerId: opts.providerId, deviceIds: [arg || opts.deviceId], toast: opts.toast, onDone: opts.onDone });
      if (act === "job-view") return J.openJobView(opts.providerId, arg, { toast: opts.toast });
    });
  };

  /* ─────────────────────── Jobs console (Devices tab) ─────────────────────── */

  J.renderJobs = async function (panel, opts) {
    if (!panel) return;
    const ui = ERP.ui, esc = ui.esc;
    const providerId = opts.providerId;
    const provider = opts.provider;
    const toast = opts.toast || (() => {});
    const refresh = opts.refresh || (() => {});
    const state = opts.state || { filter: "all", search: "" };

    try { await J.reap(providerId); } catch (e) {}
    const stats = await J.stats(providerId);
    const jobs = await J.list(providerId, { state: state.filter !== "all" ? state.filter : "", search: state.search, limit: 100 });
    const devices = await D.list(providerId);

    const filterOpts = [{ value: "all", label: "All states" }].concat(["queued", "delivered", "running", "succeeded", "partial", "failed", "timed-out", "unsupported", "expired", "cancelled"].map((s) => ({ value: s, label: s })));

    const rows = jobs.map((j) => ({
      id: "<code>" + esc(j.id) + "</code><div class=\"erp-sub\">" + esc(j.name) + "</div>",
      lang: esc(J.languageLabel(j.language)),
      state: ui.badge(j.state, J.stateTone(j.state)),
      progress: j.targetCount === 1 ? esc(asObj(asObj(j.results)[asArr(j.targets)[0]]).state || j.state) : esc(j.succeeded + "✓ " + j.failed + "✗ of " + j.targetCount),
      created: ui.dateTime(j.createdAt) + '<div class="erp-sub">' + esc(j.createdBy || "—") + "</div>",
      actions: ui.btn("Output", { small: true, act: "job-view", arg: j.id }) + " " +
        (["failed", "partial", "timed-out", "unsupported", "expired", "cancelled"].indexOf(j.state) !== -1 ? ui.btn("Retry", { small: true, act: "job-retry", arg: j.id }) + " " : "") +
        (["queued", "delivered", "running"].indexOf(j.state) !== -1 ? ui.btn("Cancel", { small: true, danger: true, act: "job-cancel", arg: j.id }) : ""),
    }));

    panel.innerHTML =
      ui.grid([
        ui.statCard({ label: "Jobs", value: String(stats.jobs), sub: stats.targets + " device run(s)" }),
        ui.statCard({ label: "Queued / running", value: String(stats.queued + stats.delivered + stats.running), tone: (stats.queued + stats.delivered + stats.running) ? "info" : null, sub: stats.queued + " queued · " + stats.running + " running" }),
        ui.statCard({ label: "Succeeded", value: String(stats.succeeded), tone: "success", sub: stats.successRate + "% of runs" }),
        ui.statCard({ label: "Failed", value: String(stats.failed), tone: stats.failed ? "danger" : null, sub: "failed / timed-out / unsupported" }),
      ], "erp-kpi-grid") +
      '<div class="erp-btn-row">' + ui.btn("Run a command or script…", { primary: true, act: "job-new-all" }) + ui.btn("Run on all online devices…", { act: "job-new-online" }) + "</div>" +
      '<div class="erp-inline-form">' +
        '<div class="field"><label>State</label><select name="jobFilter">' + filterOpts.map((o) => '<option value="' + esc(o.value) + '"' + (state.filter === o.value ? " selected" : "") + ">" + esc(o.label) + "</option>").join("") + "</select></div>" +
        '<div class="field" style="flex:1 1 200px"><label>Search</label><input type="search" name="jobSearch" placeholder="name, id, author…" value="' + esc(state.search) + '"></div>' +
      "</div>" +
      ui.card("Jobs (" + jobs.length + ")",
        ui.table([
          { key: "id", label: "Job", render: (r) => r.id },
          { key: "lang", label: "Language" },
          { key: "state", label: "State", render: (r) => r.state },
          { key: "progress", label: "Progress" },
          { key: "created", label: "Created" },
          { key: "actions", label: "", render: (r) => r.actions },
        ], rows, { scroll: true, emptyText: "No jobs yet — run a command or script to get started." })) +
      '<p class="erp-sub">Jobs are delivered on each agent\'s next check-in (every ' + ERP.configVal("rmm.heartbeatSeconds", 300) + "s). Delivered-but-never-started jobs are re-queued after " + J.DELIVERY_TIMEOUT_MIN() + " minutes; finished jobs are kept for " + J.RETENTION_HOURS() + " hours.</p>";

    ui.bind(panel, "click", "[data-act]", async (t, e, act, arg) => {
      if (act === "job-new-all") return J.openJobForm({ providerId, deviceIds: devices.map((d) => d.id), toast, onDone: refresh });
      if (act === "job-new-online") {
        const online = devices.filter((d) => D.effectiveStatus(d) === "online");
        if (!online.length) { toast("No devices are currently online.", "warn"); return; }
        return J.openJobForm({ providerId, deviceIds: online.map((d) => d.id), toast, onDone: refresh });
      }
      if (act === "job-view") return J.openJobView(providerId, arg, { toast });
      if (act === "job-retry") { const r = await J.retry(providerId, arg); toast(r.error ? "Retry failed: " + r.error : "Re-queued " + r.retried + " run(s).", r.error ? "error" : "success"); return refresh(); }
      if (act === "job-cancel") {
        const ok = await ui.confirm({ title: "Cancel job", message: "Cancel this job? Any run that has not finished is marked cancelled.", okLabel: "Cancel job", danger: true });
        if (!ok) return;
        const r = await J.cancel(providerId, arg);
        toast(r.error ? "Cancel failed: " + r.error : "Job cancelled.", r.error ? "error" : "success");
        return refresh();
      }
    });
    panel.addEventListener("change", (e) => {
      if (e.target && e.target.name === "jobFilter") { state.filter = e.target.value; refresh(); }
    });
    panel.addEventListener("input", (e) => {
      if (e.target && e.target.name === "jobSearch") { state.search = e.target.value; refresh(); }
    });
  };

  /* ─────────────────────── agent-side helper ─────────────────────── */

  /* The payload shape an agent should send to report a finished job —
     exposed so the generated agent and tests agree on the contract. */
  J.resultPayload = function (jobId, deviceId, out) {
    out = out || {};
    const stdout = out.stdout == null ? "" : String(out.stdout);
    const stderr = out.stderr == null ? "" : String(out.stderr);
    return {
      jobId, deviceId,
      ok: out.ok === true,
      exitCode: out.exitCode == null ? null : num(out.exitCode, 0),
      stdout, stdoutB64: J.toB64(stdout),
      stderr, stderrB64: J.toB64(stderr),
      error: out.error ? String(out.error) : "",
      startedAt: out.startedAt || "", endedAt: out.endedAt || "",
      timedOut: !!out.timedOut,
    };
  };

  J.init = function () { return J; };
})();
