/* ============================================================
   RMM-U — job queue & dispatch  (Phase 3 · Task 15)

   This is the bridge between the console's job record (Task 11,
   `window.ERP.jobs` in the rmm-v1-jobs document) and the collector hub
   (Task 14), which is what an actual enrolled agent checks in with.

     console / automation
            │  DSP.enqueue({ target, script, correlation, … })
            ▼
     ERP job record  ──pushJob──▶  collector queue (per device)
            ▲                              │ agent check-in
            │        DSP.sync()            ▼
     per-device state  ◀──state──  delivered → running → succeeded/failed
                                    (job-start makes `running` real)

   • One console action or automation enqueues for one device OR many
     (explicit ids, groups, sites, tags, the whole fleet or just the
     online devices). Each target becomes its own collector job, all
     carrying `ref` = the ERP job id and the caller's `correlation`.
   • Every dispatch is recorded in the hidden `rmm-v1-dispatch` document
     (jobId ↔ collector job ids, source, correlation, per-target state,
     terminal flag), so a result can be correlated back to the action or
     automation that asked for it — `DSP.onTerminal(fn)` fires when a
     dispatch completes.
   • Retry / expiry / reap are applied on BOTH sides: the collector owns
     delivery, the ERP record mirrors it through `DSP.sync`.

   When the hub is unreachable the collector client falls back to its
   in-page core, so dispatch still works (degraded, single-console mode).
   ============================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  if (!ERP || !ERP.jobs) return;
  const J = ERP.jobs;
  const T = ERP.tenancy;
  const D = ERP.devices;
  const COL = ERP.collector;
  const DSP = (ERP.dispatch = {});

  DSP.MODULE = "dispatch";

  const cfg = (path, fallback) => { try { return ERP.configVal(path, fallback); } catch (e) { return fallback; } };
  const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
  const asArr = (v) => (Array.isArray(v) ? v.slice() : []);
  const asObj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
  const num = (v, d) => { const n = Number(v); return isFinite(n) ? n : (d == null ? 0 : d); };
  const now = () => new Date().toISOString();
  const str = (v, cap) => String(v == null ? "" : v).slice(0, cap || 200);
  const rid = (p) => p + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  /* Collector job state → the console's per-device state vocabulary. */
  const STATE_MAP = {
    queued: "queued", delivered: "delivered", running: "running",
    succeeded: "succeeded", failed: "failed", "timed-out": "timed-out",
    expired: "expired", cancelled: "cancelled", unsupported: "unsupported",
  };
  DSP.STATE_MAP = STATE_MAP;
  const ACTIVE = ["queued", "delivered", "running"];
  const TERMINAL = J.TERMINAL_STATES;

  /* ─────────────────────── change notification ─────────────────────── */

  const listeners = [];
  DSP.onChange = function (fn) { if (typeof fn !== "function") return () => {}; listeners.push(fn); return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }; };
  function notify(type, payload) { listeners.slice().forEach((fn) => { try { fn(type, payload); } catch (e) {} }); }

  const terminalFns = [];
  DSP.onTerminal = function (fn) { if (typeof fn !== "function") return () => {}; terminalFns.push(fn); return () => { const i = terminalFns.indexOf(fn); if (i >= 0) terminalFns.splice(i, 1); }; };
  function fireTerminal(job, dispatch) { terminalFns.slice().forEach((fn) => { try { fn(clone(job), clone(dispatch)); } catch (e) {} }); }

  function actorName() {
    try { if (ERP.team && ERP.team.me) { const me = ERP.team.me(); if (me && me.displayName) return String(me.displayName); } } catch (e) {}
    return ERP.role || "owner";
  }

  /* ─────────────────────── persistence ─────────────────────── */

  async function loadRows(doc) { const r = await ERP.store.loadDoc(doc); return asArr(r.error ? [] : r.records); }
  async function saveRows(doc, list) { return ERP.store.saveDoc(doc, list); }

  async function loadDispatches() { return loadRows(DSP.MODULE); }
  async function saveDispatches(list) { return saveRows(DSP.MODULE, list); }

  async function getDispatch(jobId) {
    const rows = await loadDispatches();
    return rows.find((r) => r.kind === "dispatch" && String(r.jobId) === String(jobId)) || null;
  }

  DSP.load = loadDispatches;

  async function patchJob(providerId, jobId, patch) {
    const list = await loadRows(J.MODULE);
    const job = list.find((r) => r.kind === "job" && String(r.id) === String(jobId));
    if (!job) return { error: "not_found" };
    if (providerId && String(job.providerId) !== String(providerId)) return { error: "wrong_provider" };
    Object.assign(job, patch);
    job.updatedAt = now();
    const w = await saveRows(J.MODULE, list);
    if (w && w.error) return { error: w.error, message: w.message };
    return { ok: true, job };
  }
  DSP.patchJob = patchJob;

  /* ─────────────────────── target resolution ─────────────────────── */

  /* spec: { deviceId, deviceIds[], groupIds[], siteIds[], tags[], all, online } */
  DSP.resolveTargets = async function (providerId, spec) {
    spec = spec || {};
    if (!providerId) return { error: "no_provider", message: "A dispatch must belong to a provider." };
    const all = await D.list(providerId);
    let ids = [];
    const explicit = asArr(spec.deviceIds).concat(spec.deviceId ? [spec.deviceId] : []).map(String).filter(Boolean);
    if (explicit.length) ids = explicit;
    else if (asArr(spec.groupIds).length || asArr(spec.siteIds).length || asArr(spec.tags).length || spec.all || spec.online) {
      const groupIds = asArr(spec.groupIds).map(String);
      /* Dynamic groups resolve from a rule (which may read inventory), so
         load the provider + inventory index once and reuse it for the fleet. */
      let ctx = null;
      if (groupIds.length) {
        const g = await T.get(providerId);
        if (!g.error) {
          const idx = (ERP.groups && typeof ERP.groups.loadIndex === "function") ? await ERP.groups.loadIndex(providerId) : { soft: {}, svc: {}, patches: {} };
          ctx = { provider: g.provider, soft: idx.soft || {}, svc: idx.svc || {}, patches: idx.patches || {} };
        }
      }
      const set = new Set();
      for (const d of all) {
        const dev = D.normalizeDevice ? D.normalizeDevice(d) : d;
        let hit = false;
        if (spec.all || spec.online) hit = true;
        if (!hit && groupIds.length) {
          if (ctx && ERP.groups && typeof ERP.groups.matchTargets === "function") hit = ERP.groups.matchTargets(ctx.provider, { groupIds }, dev, ctx).match;
          else hit = asArr(dev.groupIds).some((g) => groupIds.indexOf(String(g)) !== -1);
        }
        if (!hit && asArr(spec.siteIds).length) hit = String(dev.siteId || "") && spec.siteIds.map(String).indexOf(String(dev.siteId)) !== -1;
        if (!hit && asArr(spec.tags).length) hit = asArr(dev.tags).some((tg) => spec.tags.map((x) => String(x).toLowerCase()).indexOf(String(tg).toLowerCase()) !== -1);
        if (spec.online) hit = hit && D.effectiveStatus(dev) === "online";
        if (hit) set.add(String(dev.id));
      }
      ids = [...set];
    }
    const known = new Set(all.map((d) => String(d.id)));
    const kept = [], skipped = [];
    ids.forEach((id) => { if (known.has(id)) kept.push(id); else skipped.push(id); });
    return { ok: true, deviceIds: kept, skipped };
  };

  /* ─────────────────────── dispatch to the collector ─────────────────────── */

  function transportMode() {
    if (DSP.locked) return "locked";
    let st = { available: false, mode: "none", state: "unavailable" };
    try { st = COL.status(); } catch (e) {}
    if (!st.available) return "local";
    return st.mode === "socket" ? "hub" : String(st.mode || "local");
  }

  /* The id the collector knows a device by. Enrollment links the two: a
     token bound to a console (ERP) device id makes the collector adopt it,
     so they normally agree. A stored mapping wins if one was recorded. */
  DSP.collectorDeviceId = function (dev) {
    const d = dev || {};
    return String((d.custom && d.custom.collectorDeviceId) || (d.agent && d.agent.collectorDeviceId) || d.id || "");
  };

  async function pushTarget(job, deviceId, collectorId, dispatch) {
    const payload = {
      name: job.name, language: job.language, script: job.script,
      args: asArr(job.args), timeoutSeconds: job.timeoutSeconds, workingDir: job.workingDir,
      maxAttempts: job.maxAttempts, expiresAt: job.expiresAt, source: job.source,
      ref: job.id, correlation: dispatch.correlation,
    };
    const res = await COL.admin("pushJob", { deviceId: collectorId || deviceId, job: payload });
    if (res && res.ok && res.jobId) {
      dispatch.collectorJobIds[deviceId] = res.jobId;
      dispatch.states[deviceId] = "queued";
      DSP.locked = false;
      return { ok: true, jobId: res.jobId };
    }
    if (res && res.error === "unauthorized") {
      DSP.locked = true;
      dispatch.states[deviceId] = "blocked";
      dispatch.lastError = "Collector locked — unlock it to deliver jobs.";
      return { ok: false, error: "locked" };
    }
    dispatch.states[deviceId] = "undelivered";
    dispatch.lastError = str((res && (res.message || res.error)) || "collector refused", 200);
    return { ok: false, error: (res && res.error) || "push_failed" };
  }

  /* The collector hub is populated only while the console is unlocked with
     the collector password. `DSP.locked` remembers a rejected admin call so
     the UI can prompt once instead of failing on every target. */
  DSP.locked = false;
  DSP.unlock = async function (password) {
    const r = await COL.adminUnlock(password);
    if (r && r.ok) { DSP.locked = false; notify("unlock", { ok: true }); }
    return r;
  };

  /* Re-dispatch targets that were blocked because the collector was locked
     or briefly unreachable. */
  DSP.redispatch = async function (providerId) {
    const jobs = await loadRows(J.MODULE);
    const rows = await loadDispatches();
    let pushed = 0;
    for (const d of rows) {
      if (d.kind !== "dispatch" || d.terminal) continue;
      if (providerId && String(d.providerId) !== String(providerId)) continue;
      const job = jobs.find((j) => String(j.id) === String(d.jobId));
      if (!job) continue;
      for (const devId of asArr(d.targets)) {
        const s = asObj(d.states)[devId];
        if (s !== "blocked" && s !== "undelivered") continue;
        if (DSP.locked) continue;
        const g = await D.get(d.providerId, devId);
        const cid = g && !g.error ? DSP.collectorDeviceId(g.device) : devId;
        const r = await pushTarget(job, devId, cid, d);
        if (r.ok) pushed++;
      }
      d.mode = transportMode();
    }
    if (pushed) { await saveDispatches(rows); notify("redispatch", { pushed }); }
    return { ok: true, pushed, locked: DSP.locked };
  };

  /* ─────────────────────── enqueue ─────────────────────── */

  /* opts: { providerId, target|deviceId|deviceIds, name, language, script,
            args, timeoutSeconds, workingDir, source, correlation,
            maxAttempts, expiresInMinutes, createdBy }
     `correlation` may be a string or any JSON value (recorded verbatim). */
  DSP.enqueue = async function (opts) {
    opts = opts || {};
    const providerId = opts.providerId;
    if (!providerId) return { error: "no_provider", message: "A dispatch must belong to a provider." };
    const t = await DSP.resolveTargets(providerId, opts.target || { deviceId: opts.deviceId, deviceIds: opts.deviceIds });
    if (t.error) return t;
    if (!t.deviceIds.length) return { error: "no_targets", message: "No devices matched the target selection." };

    const r = await J.enqueue({
      providerId, deviceIds: t.deviceIds, name: opts.name, language: opts.language, script: opts.script,
      args: opts.args, timeoutSeconds: opts.timeoutSeconds, workingDir: opts.workingDir,
      source: opts.source || "console", maxAttempts: opts.maxAttempts, expiresInMinutes: opts.expiresInMinutes,
      createdBy: opts.createdBy || actorName(),
    });
    if (r.error) return r;
    const job = r.job;

    const corrText = typeof opts.correlation === "string" ? opts.correlation : (opts.correlation ? JSON.stringify(opts.correlation) : "");
    const dispatch = {
      kind: "dispatch", id: rid("dsp"), jobId: job.id, providerId,
      name: job.name, language: job.language,
      source: str(opts.source || "console", 120),
      correlation: str(corrText, 400),
      correlationRef: opts.correlation && typeof opts.correlation === "object" ? opts.correlation : null,
      targets: t.deviceIds.slice(), collectorJobIds: {}, states: {},
      mode: "", createdAt: now(), updatedAt: now(), terminal: false, terminalAt: "", lastError: "",
    };
    for (const deviceId of t.deviceIds) {
      const g = await D.get(providerId, deviceId);
      const cid = g && !g.error ? DSP.collectorDeviceId(g.device) : deviceId;
      await pushTarget(job, deviceId, cid, dispatch);
    }
    dispatch.mode = transportMode();

    const jobPatch = {
      dispatch: {
        mode: dispatch.mode, source: dispatch.source, correlation: dispatch.correlation,
        collectorJobIds: Object.assign({}, dispatch.collectorJobIds), dispatchedAt: now(),
      },
    };
    await patchJob(providerId, job.id, jobPatch);
    job.dispatch = jobPatch.dispatch;

    const rows = await loadDispatches();
    rows.push(dispatch);
    await saveDispatches(rows);

    notify("enqueue", { job: clone(job), dispatch: clone(dispatch) });
    return { ok: true, job, dispatch };
  };

  /* ─────────────────────── sync (result correlation) ─────────────────────── */

  /* Pull the collector's job states back into the console's job record and
     the dispatch ledger. This is how a job enqueued here shows `delivered`,
     `running`, `succeeded` … exactly as the agent reports it. */
  DSP.sync = async function (providerId) {
    if (!COL || typeof COL.jobs !== "function") return { ok: true, updated: 0, jobs: 0 };
    let cjobs = [];
    try { const res = await COL.jobs(providerId ? { providerId } : {}); cjobs = asArr(res.jobs); } catch (e) {}
    if (!cjobs.length) return { ok: true, updated: 0, jobs: 0 };

    const byRef = {};
    cjobs.forEach((cj) => { if (cj.ref) (byRef[cj.ref] = byRef[cj.ref] || []).push(cj); });

    const jobs = await loadRows(J.MODULE);
    let updated = 0;
    const terminals = [];
    for (const job of jobs) {
      if (job.kind !== "job") continue;
      const list = byRef[job.id];
      if (!list) continue;
      const res = asObj(job.results);
      let changed = false;
      for (const cj of list) {
        const devId = String(cj.deviceId);
        const r = res[devId];
        if (!r) continue;
        const mapped = STATE_MAP[cj.state] || cj.state;
        if (r.state !== mapped || r.collectorJobId !== cj.id) { r.state = mapped; r.collectorJobId = cj.id; changed = true; }
        if (cj.exitCode !== undefined && cj.exitCode !== r.exitCode) { r.exitCode = cj.exitCode; changed = true; }
        if (cj.stdout && cj.stdout !== r.stdout) { r.stdout = cj.stdout; changed = true; }
        if (cj.stderr && cj.stderr !== r.stderr) { r.stderr = cj.stderr; changed = true; }
        if (cj.error && cj.error !== r.error) { r.error = cj.error; changed = true; }
        if (cj.startedAt && cj.startedAt !== r.startedAt) { r.startedAt = cj.startedAt; changed = true; }
        if (cj.endedAt && cj.endedAt !== r.endedAt) { r.endedAt = cj.endedAt; changed = true; }
        if (cj.durationMs != null && cj.durationMs !== r.durationMs) { r.durationMs = cj.durationMs; changed = true; }
        const att = num(cj.attempts, 0);
        if (att > num(r.attempts, 0)) { r.attempts = att; changed = true; }
      }
      const before = job.state;
      job.state = J.deriveState(job);
      if (changed || before !== job.state) { job.updatedAt = now(); updated++; }
      if (before !== job.state && TERMINAL.indexOf(job.state) !== -1) terminals.push(job);
    }
    if (updated) { const w = await saveRows(J.MODULE, jobs); if (w && w.error) return { ok: false, error: w.error, message: w.message }; }

    const rows = await loadDispatches();
    let touched = 0;
    const fired = [];
    for (const d of rows) {
      if (d.kind !== "dispatch") continue;
      const job = jobs.find((j) => String(j.id) === String(d.jobId));
      if (!job) continue;
      let changed = false;
      const res = asObj(job.results);
      for (const devId of d.targets) {
        const r = res[devId];
        if (r && r.state && d.states[devId] !== r.state) { d.states[devId] = r.state; changed = true; }
      }
      const isTerminal = TERMINAL.indexOf(job.state) !== -1;
      if (isTerminal && !d.terminal) { d.terminal = true; d.terminalAt = now(); d.updatedAt = now(); changed = true; fired.push({ job, dispatch: d }); }
      if (changed) touched++;
    }
    if (touched) await saveDispatches(rows);
    fired.forEach((x) => fireTerminal(x.job, x.dispatch));
    if (terminals.length) notify("terminal", { jobs: terminals.map((j) => j.id), count: terminals.length });
    notify("sync", { updated, dispatches: touched });
    return { ok: true, updated, jobs: Object.keys(byRef).length, terminals: terminals.length, dispatches: touched };
  };

  /* ─────────────────────── retry / cancel / reap ─────────────────────── */

  /* Re-queue the failed runs of a job (respecting maxAttempts) on both the
     console record and the collector, pushing a fresh collector job when the
     original has already been pruned. */
  DSP.retry = async function (providerId, jobId, deviceId) {
    const r = await J.retry(providerId, jobId, deviceId);
    if (r.error) return r;
    const dispatch = await getDispatch(jobId);
    if (dispatch) {
      const job = r.job;
      for (const devId of asArr(job.targets)) {
        if (deviceId && String(devId) !== String(deviceId)) continue;
        const res = asObj(job.results)[devId];
        if (!res || res.state !== "queued") continue;
        const cid = dispatch.collectorJobIds[devId];
        let one = cid ? await COL.retryJob(cid) : null;
        if (!one || !one.ok) {
          const g = await D.get(providerId, devId);
          const collectorId = g && !g.error ? DSP.collectorDeviceId(g.device) : devId;
          one = await pushTarget(job, devId, collectorId, dispatch);
        }
        dispatch.states[devId] = "queued";
      }
      dispatch.mode = transportMode();
      dispatch.terminal = false; dispatch.terminalAt = ""; dispatch.updatedAt = now();
      const rows = await loadDispatches();
      const i = rows.findIndex((x) => x.id === dispatch.id);
      if (i >= 0) rows[i] = dispatch; else rows.push(dispatch);
      await saveDispatches(rows);
    }
    notify("retry", { jobId, deviceId });
    return r;
  };

  DSP.cancel = async function (providerId, jobId, deviceId) {
    const r = await J.cancel(providerId, jobId, deviceId);
    if (r.error) return r;
    const dispatch = await getDispatch(jobId);
    if (dispatch) {
      const targets = deviceId ? [deviceId] : asArr(r.job.targets);
      for (const devId of targets) {
        const cid = dispatch.collectorJobIds[devId];
        if (cid) await COL.cancelJob(cid);
        dispatch.states[devId] = "cancelled";
      }
      dispatch.updatedAt = now();
      const rows = await loadDispatches();
      const i = rows.findIndex((x) => x.id === dispatch.id);
      if (i >= 0) rows[i] = dispatch; else rows.push(dispatch);
      await saveDispatches(rows);
    }
    notify("cancel", { jobId, deviceId });
    return r;
  };

  DSP.reap = async function (providerId) {
    let collector = { ok: false };
    try {
      collector = await COL.reapJobs({
        providerId,
        deliveryTimeoutMinutes: num(cfg("rmm.jobDeliveryTimeoutMinutes", 30), 30),
        retentionHours: num(cfg("rmm.jobRetentionHours", 168), 168),
      });
    } catch (e) {}
    const erp = await J.reap(providerId);
    const sync = await DSP.sync(providerId);
    notify("reap", { collector, erp });
    return { ok: true, collector, erp, sync };
  };

  /* ─────────────────────── reads ─────────────────────── */

  DSP.correlations = async function (filter) {
    filter = filter || {};
    let rows = await loadDispatches();
    rows = rows.filter((r) => r.kind === "dispatch");
    if (filter.providerId) rows = rows.filter((r) => String(r.providerId) === String(filter.providerId));
    if (filter.source) rows = rows.filter((r) => r.source === filter.source);
    if (filter.correlation) rows = rows.filter((r) => String(r.correlation) === String(filter.correlation));
    if (filter.jobId) rows = rows.filter((r) => String(r.jobId) === String(filter.jobId));
    if (filter.active) rows = rows.filter((r) => !r.terminal);
    rows.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    if (filter.limit) rows = rows.slice(0, filter.limit);
    return rows.map(clone);
  };

  DSP.status = async function (providerId) {
    let transport = { available: false, mode: "none", state: "unavailable" };
    try { transport = COL.status(); } catch (e) {}
    const rows = (await DSP.correlations(providerId ? { providerId } : {})).filter((r) => r.kind === "dispatch");
    const counts = { total: rows.length, queued: 0, delivered: 0, running: 0, succeeded: 0, failed: 0, terminal: 0, undelivered: 0 };
    let queue = 0;
    rows.forEach((d) => {
      if (d.terminal) counts.terminal++;
      Object.keys(asObj(d.states)).forEach((dev) => {
        const s = d.states[dev];
        if (counts[s] != null) counts[s]++;
        if (ACTIVE.indexOf(s) !== -1) queue++;
      });
    });
    return { transport, dispatches: counts, queue, mode: transportMode() };
  };

  /* ─────────────────────── display ─────────────────────── */

  function stateTone(s) {
    if (J.stateTone) return J.stateTone(s);
    return s === "succeeded" ? "success" : s === "failed" ? "danger" : s === "running" || s === "delivered" ? "info" : "muted";
  }

  function modeBadge(status) {
    if (status.mode === "locked") return ERP.ui.badge("collector locked", "warn");
    const on = status.transport && status.transport.available;
    const live = on && status.mode === "hub";
    const tone = live ? "success" : on ? "info" : "muted";
    const label = live ? "hub · live" : on ? status.mode : "in-page (degraded)";
    return ERP.ui.badge(label, tone);
  }

  /* The dispatch-aware Jobs console: the Task 11 job UI plus the live
     collector queue and the correlation ledger beneath it. */
  DSP.renderJobs = async function (panel, opts) {
    if (!panel) return;
    opts = opts || {};
    const ui = ERP.ui, esc = ui.esc;
    await J.renderJobs(panel, opts);
    let status;
    try { await DSP.sync(opts.providerId); } catch (e) {}
    status = await DSP.status(opts.providerId);
    const dispatches = await DSP.correlations({ providerId: opts.providerId, limit: 60 });

    const rows = dispatches.map((d) => {
      const states = asObj(d.states);
      const targets = asArr(d.targets);
      const okCount = targets.filter((t) => states[t] === "succeeded").length;
      const doneCount = targets.filter((t) => TERMINAL.indexOf(states[t]) !== -1).length;
      return {
        job: "<code>" + esc(d.jobId) + "</code><div class=\"erp-sub\">" + esc(d.name || "") + " · " + esc(d.language || "") + "</div>",
        source: esc(d.source || "console") + (d.correlation ? "<div class=\"erp-sub\">" + esc(d.correlation) + "</div>" : ""),
        targets: esc(String(targets.length)),
        progress: esc(okCount + "✓ " + doneCount + "/" + targets.length),
        state: ui.badge(d.terminal ? "terminal" : (Object.values(states).find((s) => ACTIVE.indexOf(s) !== -1) || "queued"), d.terminal ? "success" : "info"),
        mode: esc(d.mode || "—"),
        actions: ui.btn("Sync", { small: true, act: "dsp-sync" }) + " " +
          (d.terminal ? ui.btn("Retry", { small: true, act: "dsp-retry", arg: d.jobId }) + " " : "") +
          (!d.terminal ? ui.btn("Cancel", { small: true, danger: true, act: "dsp-cancel", arg: d.jobId }) : ""),
      };
    });

    const html =
      '<h4 class="rmm-section-title">Dispatch &amp; correlation</h4>' +
      ui.grid([
        ui.statCard({ label: "Collector", value: status.mode, sub: status.transport.available ? "transport available" : "no transport" }),
        ui.statCard({ label: "In flight", value: String(status.queue), tone: status.queue ? "info" : null, sub: "queued / delivered / running" }),
        ui.statCard({ label: "Dispatches", value: String(status.dispatches.total), sub: status.dispatches.terminal + " terminal" }),
        ui.statCard({ label: "Succeeded runs", value: String(status.dispatches.succeeded), tone: "success", sub: status.dispatches.failed + " failed" }),
      ], "erp-kpi-grid") +
      '<div class="erp-btn-row">' +
        (status.mode === "locked" ? ui.btn("Unlock collector…", { primary: true, act: "dsp-unlock" }) + " " : "") +
        ui.btn("Re-dispatch blocked", { act: "dsp-redispatch" }) +
        ui.btn("Sync now", { act: "dsp-sync" }) +
      "</div>" +
      ui.card("Correlation ledger (" + dispatches.length + ")",
        ui.table([
          { key: "job", label: "Job" },
          { key: "source", label: "Source / correlation" },
          { key: "targets", label: "Targets" },
          { key: "progress", label: "Runs" },
          { key: "state", label: "State" },
          { key: "mode", label: "Transport" },
          { key: "actions", label: "", render: (r) => r.actions },
        ], rows, { scroll: true, emptyText: "No dispatches yet — queue a command from the Jobs tab." })) +
      '<p class="erp-sub">Dispatch sends each target its own collector job carrying <code>ref</code> = the console job id and the caller\'s correlation, so a result can be traced back to the action or automation that requested it. ' + modeBadge(status) + "</p>";

    const wrap = document.createElement("div");
    wrap.id = "dspSection";
    wrap.innerHTML = html;
    panel.appendChild(wrap);

    ui.bind(wrap, "click", "[data-act]", async (t, e, act, arg) => {
      if (act === "dsp-sync") { const r = await DSP.sync(opts.providerId); (opts.toast || (() => {}))("Reconciled " + (r.updated || 0) + " job record(s).", "success"); return opts.refresh ? opts.refresh() : undefined; }
      if (act === "dsp-redispatch") { const r = await DSP.redispatch(opts.providerId); (opts.toast || (() => {}))(r.locked ? "Collector is locked — unlock it first." : "Re-dispatched " + r.pushed + " target(s).", r.locked ? "warn" : "success"); return opts.refresh ? opts.refresh() : undefined; }
      if (act === "dsp-unlock") {
        const m = ui.modal({
          title: "Unlock collector", size: "sm",
          body: '<div class="field"><label for="dspPwInput">Collector password</label><input type="password" id="dspPwInput" autocomplete="off"></div>' +
            '<p class="erp-sub">The collector hub is authoritative and requires the password chosen when it was created. It is never stored in the console.</p>',
          foot: ui.btn("Cancel", { small: true, attrs: { "data-ui-close": "1" } }) + ' <button class="btn btn-sm btn-primary" data-dsp-go>Unlock</button>',
        });
        const input = m.querySelector("#dspPwInput");
        const go = async () => {
          const r = await DSP.unlock(input.value);
          if (r && r.ok) {
            ui.closeModal();
            const rr = await DSP.redispatch(opts.providerId);
            (opts.toast || (() => {}))("Collector unlocked" + (rr.pushed ? " — re-dispatched " + rr.pushed + " target(s)" : "") + ".", "success");
            if (opts.refresh) opts.refresh();
          } else (opts.toast || (() => {}))("Unlock failed: " + ((r && (r.message || r.error)) || "wrong password"), "error");
        };
        m.querySelector("[data-dsp-go]").onclick = go;
        if (input) { input.focus(); input.addEventListener("keydown", (ev) => { if (ev.key === "Enter") go(); }); }
        return;
      }
      if (act === "dsp-retry") { const r = await DSP.retry(opts.providerId, arg); (opts.toast || (() => {}))(r.error ? "Retry failed: " + r.error : "Re-queued " + r.retried + " run(s).", r.error ? "error" : "success"); return opts.refresh ? opts.refresh() : undefined; }
      if (act === "dsp-cancel") {
        const ok = await ui.confirm({ title: "Cancel dispatch", message: "Cancel this dispatch? Any run that has not finished is marked cancelled on the collector.", okLabel: "Cancel", danger: true });
        if (!ok) return;
        const r = await DSP.cancel(opts.providerId, arg);
        (opts.toast || (() => {}))(r.error ? "Cancel failed: " + r.error : "Dispatch cancelled.", r.error ? "error" : "success");
        return opts.refresh ? opts.refresh() : undefined;
      }
    });
  };

  DSP.deviceSection = async function (dev, providerId) {
    const ui = ERP.ui, esc = ui.esc;
    const rows = (await DSP.correlations({ providerId })).filter((d) => asArr(d.targets).indexOf(String(dev.id)) !== -1).slice(0, 6);
    const body = rows.length
      ? ui.table([
          { key: "job", label: "Job", render: (r) => "<code>" + esc(r.jobId) + "</code>" },
          { key: "state", label: "State", render: (r) => ui.badge(asObj(r.states)[dev.id] || "—", stateTone(asObj(r.states)[dev.id])) },
          { key: "source", label: "Source", render: (r) => esc(r.source || "—") },
        ], rows)
      : '<p class="erp-sub">No dispatched jobs for this device.</p>';
    return '<h4 class="rmm-section-title">Dispatch &amp; correlation</h4>' + body;
  };

  DSP.init = function () { return DSP; };
})();
