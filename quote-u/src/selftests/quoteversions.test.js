(function () {
  const T = window.QU_SELFTEST;
  const V = window.QU_VERSIONS;
  const LI = window.QU_LINEITEMS;
  const OG = window.QU_OPTIONGROUPS;
  const QS = window.QU_STORE;
  if (!T || !V || !LI || !OG || !QS) return;

  const CAPTURED = "2026-08-10T09:00:00.000Z";
  const ENV_MODULES = [V.DOC_VERSIONS, V.DOC_LINES, V.DOC_GROUPS];

  function throws(fn, code) {
    try {
      fn();
    } catch (err) {
      if (code && err.code !== code) return "threw " + err.code + " instead of " + code;
      return null;
    }
    return "did not throw";
  }

  function makeKv(kvStore) {
    return {
      get: async k => kvStore.get(k),
      set: async (k, v) => { kvStore.set(k, v); },
      delete: async k => { kvStore.delete(k); }
    };
  }

  function makeEditable(files) {
    return {
      get: async name => {
        const f = files.get(name);
        return f ? f.text : null;
      },
      set: async (name, text, o) => {
        o = o || {};
        let f = files.get(name);
        if (!f) {
          f = { text, key: "ek." + name, count: 0 };
          files.set(name, f);
          f.count = 1;
          return { error: null, editKey: f.key, editCount: 1, created: true };
        }
        if (!o.editKey || o.editKey !== f.key) return { error: "invalid or missing edit key", created: false };
        if (f.text === text) return { error: null, editCount: f.count, unchanged: true };
        f.text = text;
        f.count++;
        return { error: null, editCount: f.count, unchanged: false };
      }
    };
  }

  function makeEnv() {
    const kvStore = new Map();
    const files = new Map();
    const ns = "ver" + QS.randHex(6);
    const opts = { ns, kv: makeKv(kvStore), editable: makeEditable(files), modules: ENV_MODULES };
    const store = QS.create(opts);
    const svc = V.createService({ store });
    return { ns, kvStore, files, opts, store, svc };
  }

  // A store over the SAME canonical files with no write guard registered — the
  // shape of an out-of-band writer (another tab, a direct editor) that must
  // still be caught by verify().
  function rawStore(env) {
    return QS.create({ ns: env.ns, kv: makeKv(env.kvStore), editable: makeEditable(env.files), modules: ENV_MODULES });
  }

  function line(overrides) {
    return LI.normalize(Object.assign({
      kind: "one_time",
      description: "line",
      unit_sell_cents: 5000
    }, overrides || {}));
  }

  T.register("quote versions: the model declares its fields and refuses malformed records", () => {
    const bad = [];
    ["id", "quote_id", "quote_number", "version_number", "state", "title", "notes", "expires_at", "frozen_at", "frozen_by", "frozen_state", "frozen_seal", "revised_from", "created_at", "created_by", "updated_at"].forEach(f => {
      if (V.MODEL_FIELD_NAMES.indexOf(f) === -1) bad.push("missing field " + f);
    });
    const v = V.normalize({}, { id: "v-1", clock: () => CAPTURED });
    if (v.id !== "v-1") bad.push("id");
    if (v.state !== "draft") bad.push("state default: " + v.state);
    if (v.version_number !== 1) bad.push("version_number default: " + v.version_number);
    if (v.frozen_at !== null || v.frozen_seal !== null) bad.push("a new version must not be frozen");
    if (v.created_at !== CAPTURED || v.updated_at !== CAPTURED) bad.push("timestamps not stamped by clock");
    if (V.isFrozen(v)) bad.push("draft reported frozen");
    if (!V.isFrozen({ frozen_at: CAPTURED })) bad.push("frozen_at not honoured");
    if (V.isFrozen({ frozen_at: "" })) bad.push("empty frozen_at counted as frozen");

    if (throws(() => V.normalize(null), "bad_version")) bad.push("null input");
    if (throws(() => V.normalize({ state: "frozen" }), "bad_state")) bad.push("unknown state");
    if (throws(() => V.normalize({ version_number: 0 }), "bad_version_number")) bad.push("zero version number");
    if (throws(() => V.normalize({ frozen_at: "not-a-date" }), "bad_frozen_at")) bad.push("bad frozen_at");

    const inconsistent = V.validate({ id: "v-1", frozen_state: "sent" });
    if (inconsistent.ok || !inconsistent.violations.some(x => x.code === "inconsistent_freeze")) bad.push("freeze companions without frozen_at accepted");

    const unfrozen = V.normalize({ id: "v-2", state: "sent" });
    if (V.isFrozen(unfrozen)) bad.push("sent (not yet frozen) reported frozen");
    const frozen = V.freezeVersion(unfrozen, { at: CAPTURED, actor: "rep@example.com" });
    if (frozen.frozen_at !== CAPTURED || frozen.frozen_by !== "rep@example.com" || frozen.frozen_state !== "sent") bad.push("freeze stamping: " + JSON.stringify(frozen));
    if (!V.isFrozen(frozen)) bad.push("frozen result not frozen");
    if (throws(() => V.freezeVersion(frozen), "already_frozen")) bad.push("double freeze");
    if (throws(() => V.freezeVersion(V.normalize({ id: "v-3", state: "approved" }), { at: CAPTURED }), "terminal_version")) bad.push("terminal freeze");
    const stripped = V.stripFreezeFields({ title: "ok", frozen_at: CAPTURED, frozen_by: "x", frozen_seal: "y", frozen_state: "sent" });
    if (stripped.frozen_at !== undefined || stripped.frozen_seal !== undefined || stripped.title !== "ok") bad.push("stripFreezeFields: " + JSON.stringify(stripped));
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "16-field model; defaults + clock stamping; bad state/number/timestamp refused; freeze is the only producer of a frozen record" };
  });

  T.register("quote versions: the freeze seal is deterministic and covers the whole bundle", () => {
    const bad = [];
    const version = V.normalize({ id: "v-1", quote_id: "q-1", version_number: 1, state: "sent" }, { clock: () => CAPTURED });
    const lines = [line({ id: "li-2", description: "B", unit_sell_cents: 200 }), line({ id: "li-1", description: "A", unit_sell_cents: 100 })];
    const groups = [OG.normalize({ id: "og-1", name: "Speed" })];
    const seal = V.sealBundle(version, lines, groups);
    if (typeof seal !== "string" || seal.length < 16) bad.push("no seal");
    if (V.sealBundle(version, lines, groups) !== seal) bad.push("seal not deterministic");
    if (V.sealBundle(version, lines.slice().reverse(), groups.slice().reverse()) !== seal) bad.push("seal depends on record order");
    if (V.sealBundle(version, lines, groups.concat([OG.normalize({ id: "og-2", name: "Extra" })])) === seal) bad.push("seal ignores groups");
    if (V.sealBundle(version, lines.map(l => (l.id === "li-1" ? Object.assign({}, l, { unit_sell_cents: 999 }) : l)), groups) === seal) bad.push("seal ignores line changes");
    const withSeal = Object.assign({}, version, { frozen_seal: "junk" });
    if (V.sealBundle(withSeal, lines, groups) !== seal) bad.push("seal includes its own frozen_seal");
    const summary = V.versionSummary(Object.assign({}, version, { frozen_at: CAPTURED, frozen_state: "sent", revisions: 3 }));
    ["id", "quote_id", "quote_number", "version_number", "state", "title", "frozen_at", "frozen_by", "frozen_state", "revised_from"].forEach(k => {
      if (!Object.prototype.hasOwnProperty.call(summary, k)) bad.push("summary missing " + k);
    });
    if (summary.revisions !== undefined) bad.push("summary should be a concise subset");
    if (V.versionSummary(null) !== null) bad.push("null summary");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "seal is deterministic and order-independent over version+lines+groups; the concise summary carries the freeze fields" };
  });

  T.register("quote versions: immutability reports every change to a frozen record", () => {
    const bad = [];
    const frozenV = { id: "v-1", state: "sent", title: "Sent", frozen_at: CAPTURED, frozen_seal: "s" };
    const draftV = { id: "v-2", state: "draft", title: "Draft", frozen_at: null };
    const base = { module: V.DOC_VERSIONS, previous: [frozenV, draftV], next: [frozenV, draftV] };
    if (!V.immutability(base).ok) bad.push("identical documents flagged");

    const modified = { module: V.DOC_VERSIONS, previous: [frozenV, draftV], next: [Object.assign({}, frozenV, { title: "Hacked" }), draftV] };
    if (V.immutability(modified).code !== "frozen_version_immutable") bad.push("frozen modification not caught");
    const deleted = { module: V.DOC_VERSIONS, previous: [frozenV, draftV], next: [draftV] };
    if (V.immutability(deleted).code !== "frozen_version_deleted") bad.push("frozen deletion not caught");
    const grow = { module: V.DOC_VERSIONS, previous: [frozenV, draftV], next: [frozenV, Object.assign({}, draftV, { title: "Edited" }), { id: "v-3", state: "draft" }] };
    if (!V.immutability(grow).ok) bad.push("editing a draft / adding a version was blocked");

    const frozenLine = { id: "li-1", quote_version_id: "v-1", description: "X", unit_sell_cents: 100 };
    const draftLine = { id: "li-9", quote_version_id: "v-2", description: "Y", unit_sell_cents: 100 };
    const memberBase = { module: V.DOC_LINES, previous: [frozenLine, draftLine], next: [frozenLine, draftLine], frozenVersionIds: ["v-1"] };
    if (!V.immutability(memberBase).ok) bad.push("identical member documents flagged");
    const memberMod = { module: V.DOC_LINES, previous: [frozenLine, draftLine], next: [Object.assign({}, frozenLine, { unit_sell_cents: 1 }), draftLine], frozenVersionIds: ["v-1"] };
    if (V.immutability(memberMod).code !== "frozen_member_immutable") bad.push("frozen member modification not caught");
    const memberDel = { module: V.DOC_LINES, previous: [frozenLine, draftLine], next: [draftLine], frozenVersionIds: ["v-1"] };
    if (V.immutability(memberDel).code !== "frozen_member_deleted") bad.push("frozen member deletion not caught");
    const memberDraftEdit = { module: V.DOC_LINES, previous: [frozenLine, draftLine], next: [frozenLine, Object.assign({}, draftLine, { unit_sell_cents: 999 })], frozenVersionIds: ["v-1"] };
    if (!V.immutability(memberDraftEdit).ok) bad.push("editing an unfrozen version's line was blocked");
    const noFrozen = { module: V.DOC_LINES, previous: [frozenLine], next: [Object.assign({}, frozenLine, { unit_sell_cents: 1 })], frozenVersionIds: [] };
    if (!V.immutability(noFrozen).ok) bad.push("member change blocked with no frozen versions");

    if (!V.immutability({ module: "quotes", previous: [{ id: "q" }], next: [] }).ok) bad.push("unrelated module flagged");
    if (throws(() => V.assertImmutable(modified), "frozen_version_immutable")) bad.push("assertImmutable did not throw");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "modifying/deleting a frozen version or one of its lines is reported; drafts and unrelated documents pass" };
  });

  T.register("quote versions: the store write guard blocks a rogue write to a frozen version", async () => {
    const env = makeEnv();
    const bad = [];
    const created = await env.svc.createVersion({ quote_id: "q-1", quote_number: "Q-0001", title: "Sent quote", actor: "rep" });
    if (!created.ok) return { pass: false, detail: "createVersion: " + JSON.stringify(created) };
    const added = await env.svc.addLine(created.version.id, { kind: "one_time", description: "Server", unit_sell_cents: 50000 });
    if (!added.ok) return { pass: false, detail: "addLine: " + JSON.stringify(added) };
    const frozen = await env.svc.freeze(created.version.id, { at: CAPTURED, actor: "rep" });
    if (!frozen.ok) return { pass: false, detail: "freeze: " + JSON.stringify(frozen) };

    // A writer that never goes through the service: straight to the store.
    const vDoc = await env.store.loadDoc(V.DOC_VERSIONS);
    const vNext = { records: vDoc.content.records.map(r => (r.id === created.version.id ? Object.assign({}, r, { title: "Hacked" }) : r)) };
    const vSave = await env.store.saveChecked(V.DOC_VERSIONS, vNext, { expectedBase: vDoc.revision });
    if (vSave.ok || vSave.code !== "frozen_version_immutable") bad.push("rogue version write not vetoed: " + JSON.stringify(vSave));

    const lDoc = await env.store.loadDoc(V.DOC_LINES);
    const lNext = { records: lDoc.content.records.map(r => (r.id === added.line.id ? Object.assign({}, r, { unit_sell_cents: 1 }) : r)) };
    const lSave = await env.store.saveChecked(V.DOC_LINES, lNext, { expectedBase: lDoc.revision });
    if (lSave.ok || lSave.code !== "frozen_member_immutable") bad.push("rogue line write not vetoed: " + JSON.stringify(lSave));

    // The guard must not block legitimate work on unfrozen data.
    const draft = await env.svc.createVersion({ quote_id: "q-1", title: "Revision draft" });
    if (!draft.ok) bad.push("a new draft version was blocked: " + JSON.stringify(draft));
    const vDoc2 = await env.store.loadDoc(V.DOC_VERSIONS);
    const vOk = { records: vDoc2.content.records.concat([{ id: "v-extra", state: "draft", frozen_at: null }]) };
    const vOkSave = await env.store.saveChecked(V.DOC_VERSIONS, vOk, { expectedBase: vDoc2.revision });
    if (!vOkSave.ok) bad.push("legitimate append blocked: " + JSON.stringify(vOkSave));
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "the storage-layer guard vetoes writes to a frozen version and its lines even from a writer that bypasses the service; drafts still write" };
  });

  T.register("quote versions: create, author and total a version through the service", async () => {
    const env = makeEnv();
    const bad = [];
    const v1 = await env.svc.createVersion({ quote_id: "q-1", quote_number: "Q-0001", title: "First" });
    if (!v1.ok || v1.version.version_number !== 1 || v1.version.state !== "draft") return { pass: false, detail: "createVersion: " + JSON.stringify(v1) };
    const v2 = await env.svc.createVersion({ quote_id: "q-1", title: "Second" });
    if (!v2.ok || v2.version.version_number !== 2) bad.push("auto version_number: " + JSON.stringify(v2.version));

    const oneTime = await env.svc.addLine(v1.version.id, { kind: "one_time", description: "Router", quantity: 2, unit_sell_cents: 15000 });
    const mrr = await env.svc.addLine(v1.version.id, { kind: "mrr", description: "Support", unit_sell_cents: 5000 });
    if (!oneTime.ok || !mrr.ok) bad.push("addLine: " + JSON.stringify(oneTime) + " " + JSON.stringify(mrr));
    if (oneTime.line.quote_version_id !== v1.version.id || oneTime.line.sort_order !== 0) bad.push("line not bound/ordered: " + JSON.stringify(oneTime.line));
    if (mrr.line.sort_order !== 1) bad.push("second line sort order: " + mrr.line.sort_order);

    const group = await env.svc.addGroup(v1.version.id, { name: "Internet speed", selection_type: "single" });
    if (!group.ok || group.group.selection_type !== "single") bad.push("addGroup: " + JSON.stringify(group));
    const upd = await env.svc.updateGroup(v1.version.id, group.group.id, { description: "Pick one" });
    if (!upd.ok || upd.group.description !== "Pick one") bad.push("updateGroup: " + JSON.stringify(upd));

    const optLine = await env.svc.addLine(v1.version.id, { kind: "one_time", description: "1 Gbps", unit_sell_cents: 12000, optional: true, option_group_id: group.group.id, selected_by_default: true });
    if (!optLine.ok) bad.push("optional line: " + JSON.stringify(optLine));

    const totals = await env.svc.totals(v1.version.id);
    if (!totals.ok) bad.push("totals: " + JSON.stringify(totals));
    else {
      if (totals.totals.one_time_cents !== 2 * 15000 + 12000) bad.push("one-time total: " + totals.totals.one_time_cents);
      if (totals.totals.mrr_cents !== 5000) bad.push("mrr total: " + totals.totals.mrr_cents);
    }

    const view = await env.svc.clientView(v1.version.id);
    if (!view.ok || !view.view || view.view.kind !== "quote-portal-view") bad.push("clientView: " + JSON.stringify(view && view.code));
    else if (view.view.totals.one_time_cents !== 2 * 15000 + 12000) bad.push("client view totals diverge");

    const updated = await env.svc.updateVersion(v1.version.id, { title: "Renamed", frozen_at: "2000-01-01T00:00:00.000Z", frozen_by: "sneaky" });
    if (!updated.ok) bad.push("updateVersion: " + JSON.stringify(updated));
    else if (updated.version.title !== "Renamed" || updated.version.frozen_at !== null) bad.push("freeze fields not stripped on update: " + JSON.stringify(updated.version));

    const removed = await env.svc.removeLine(v1.version.id, mrr.line.id);
    if (!removed.ok) bad.push("removeLine: " + JSON.stringify(removed));
    const reordered = await env.svc.reorderLines(v1.version.id, [optLine.line.id, oneTime.line.id]);
    if (!reordered.ok) bad.push("reorderLines: " + JSON.stringify(reordered));
    const linesAfter = await env.svc.listLines(v1.version.id);
    if (!linesAfter.ok || String(linesAfter.lines[0].id) !== String(optLine.line.id)) bad.push("reorder not applied");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "auto-incrementing versions; lines/groups authored and reordered; totals and the client view come from the shared engine; freeze fields stripped on update" };
  });

  T.register("quote versions: freeze locks a version and every mutator refuses it", async () => {
    const env = makeEnv();
    const bad = [];
    const v = await env.svc.createVersion({ quote_id: "q-1", title: "Lock me" });
    const l = await env.svc.addLine(v.version.id, { kind: "one_time", description: "Thing", unit_sell_cents: 10000 });
    const g = await env.svc.addGroup(v.version.id, { name: "Choices" });
    const frozen = await env.svc.freeze(v.version.id, { at: CAPTURED, actor: "rep@example.com" });
    if (!frozen.ok) return { pass: false, detail: "freeze: " + JSON.stringify(frozen) };
    if (!frozen.version.frozen_at || !frozen.version.frozen_seal) bad.push("freeze did not set frozen_at/seal: " + JSON.stringify(frozen.version));
    if (env.svc.frozenVersionIds().indexOf(v.version.id) === -1) bad.push("frozen id not registered");

    const refusals = [
      ["updateVersion", () => env.svc.updateVersion(v.version.id, { title: "nope" })],
      ["addLine", () => env.svc.addLine(v.version.id, { kind: "one_time", description: "nope", unit_sell_cents: 1 })],
      ["updateLine", () => env.svc.updateLine(v.version.id, l.line.id, { unit_sell_cents: 1 })],
      ["removeLine", () => env.svc.removeLine(v.version.id, l.line.id)],
      ["reorderLines", () => env.svc.reorderLines(v.version.id, [l.line.id])],
      ["addGroup", () => env.svc.addGroup(v.version.id, { name: "nope" })],
      ["updateGroup", () => env.svc.updateGroup(v.version.id, g.group.id, { name: "nope" })],
      ["removeGroup", () => env.svc.removeGroup(v.version.id, g.group.id)]
    ];
    for (const [name, fn] of refusals) {
      const res = await fn();
      if (res.ok || res.code !== "frozen_version_immutable") bad.push(name + " not refused: " + JSON.stringify(res));
    }
    const again = await env.svc.freeze(v.version.id, { at: CAPTURED });
    if (again.ok || again.code !== "already_frozen") bad.push("re-freeze: " + JSON.stringify(again));
    const lineStill = await env.svc.listLines(v.version.id);
    if (!lineStill.ok || lineStill.lines[0].unit_sell_cents !== 10000) bad.push("frozen line changed");
    const verify = await env.svc.verify();
    if (!verify.ok || verify.count !== 1 || verify.breaks.length) bad.push("verify: " + JSON.stringify(verify));
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "the only frozen record is produced by freeze(); all eight mutators refuse it; re-freeze refused; the sealed bundle verifies" };
  });

  T.register("quote versions: verify detects an out-of-band tamper of a frozen bundle", async () => {
    const env = makeEnv();
    const bad = [];
    const v = await env.svc.createVersion({ quote_id: "q-1", title: "Sealed" });
    const l = await env.svc.addLine(v.version.id, { kind: "mrr", description: "Seat", unit_sell_cents: 2000 });
    const frozen = await env.svc.freeze(v.version.id, { at: CAPTURED, actor: "rep" });
    if (!frozen.ok) return { pass: false, detail: "freeze: " + JSON.stringify(frozen) };
    if (!(await env.svc.verify()).ok) bad.push("fresh frozen bundle failed verification");

    const raw = rawStore(env);
    const doc = await raw.loadDoc(V.DOC_LINES);
    if (!doc.ok) return { pass: false, detail: "raw load: " + JSON.stringify(doc) };
    const tampered = { records: doc.content.records.map(r => (r.id === l.line.id ? Object.assign({}, r, { unit_sell_cents: 1 }) : r)) };
    const save = await raw.saveChecked(V.DOC_LINES, tampered, { expectedBase: doc.revision });
    if (!save.ok) return { pass: false, detail: "raw tamper write failed: " + JSON.stringify(save) };

    const check = await env.svc.verify();
    if (check.ok) bad.push("tampered bundle still verified");
    else if (!check.breaks.some(b => b.id === v.version.id && b.code === "frozen_changed")) bad.push("wrong break: " + JSON.stringify(check.breaks));
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "a change made outside the service breaks the stored seal and verify() names the version" };
  });

  T.register("quote versions: revise clones a frozen version into a new draft", async () => {
    const env = makeEnv();
    const bad = [];
    const v1 = await env.svc.createVersion({ quote_id: "q-1", quote_number: "Q-0001", title: "Original" });
    await env.svc.addLine(v1.version.id, { kind: "one_time", description: "Router", unit_sell_cents: 15000 });
    const mrr = await env.svc.addLine(v1.version.id, { kind: "mrr", description: "Support", unit_sell_cents: 5000 });
    const g = await env.svc.addGroup(v1.version.id, { name: "Speed", selection_type: "single" });
    const frozen = await env.svc.freeze(v1.version.id, { at: CAPTURED, actor: "rep" });
    if (!frozen.ok) return { pass: false, detail: "freeze: " + JSON.stringify(frozen) };
    const srcTotals = (await env.svc.totals(v1.version.id)).totals;

    const revised = await env.svc.revise(v1.version.id, { actor: "rep" });
    if (!revised.ok) return { pass: false, detail: "revise: " + JSON.stringify(revised) };
    if (revised.version.id === v1.version.id) bad.push("revision reused the source id");
    if (revised.version.version_number !== 2) bad.push("revision version_number: " + revised.version.version_number);
    if (revised.version.state !== "draft" || revised.version.frozen_at !== null) bad.push("revision is not a fresh draft");
    if (revised.version.revised_from !== v1.version.id) bad.push("revised_from: " + revised.version.revised_from);
    if (revised.version.title !== "Original" || revised.version.quote_number !== "Q-0001") bad.push("revision did not carry the quote context");

    const newLines = await env.svc.listLines(revised.version.id);
    if (!newLines.ok || newLines.lines.length !== 2) bad.push("revision lines: " + JSON.stringify(newLines.lines && newLines.lines.length));
    else {
      newLines.lines.forEach(nl => { if (nl.quote_version_id !== revised.version.id) bad.push("cloned line still bound to the source"); });
      if (newLines.lines.some(nl => nl.id === mrr.line.id)) bad.push("cloned line reused the source id");
      const nTot = (await env.svc.totals(revised.version.id)).totals;
      if (nTot.one_time_cents !== srcTotals.one_time_cents || nTot.mrr_cents !== srcTotals.mrr_cents) bad.push("revision totals diverge");
    }
    const newGroups = await env.svc.listGroups(revised.version.id);
    if (!newGroups.ok || newGroups.groups.length !== 1 || newGroups.groups[0].quote_version_id !== revised.version.id || newGroups.groups[0].id === g.group.id) bad.push("revision groups: " + JSON.stringify(newGroups.groups));
    const src = await env.svc.getVersion(v1.version.id);
    if (!src.ok || src.version.title !== "Original" || !src.version.frozen_at) bad.push("source version mutated: " + JSON.stringify(src.version));
    const srcLines = await env.svc.listLines(v1.version.id);
    if (!srcLines.ok || srcLines.lines.length !== 2) bad.push("source lines changed");

    const draftRevise = await env.svc.revise(revised.version.id, { actor: "rep" });
    if (draftRevise.ok || draftRevise.code !== "not_frozen") bad.push("revise of a draft: " + JSON.stringify(draftRevise));
    const ghost = await env.svc.revise("v-ghost", {});
    if (ghost.ok || ghost.code !== "version_not_found") bad.push("revise of a ghost: " + JSON.stringify(ghost));
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "revise creates a new draft version with fresh line/group ids, leaves the frozen source untouched, and only revises frozen versions" };
  });

  T.register("quote versions: the server plugin holds the freeze registry authoritatively (live)", async () => {
    const r = window.root;
    if (!r || typeof r.createServerSocket !== "function") return { pass: true, skip: true, detail: "createServerSocket unavailable" };
    let sock = null;
    try {
      sock = r.createServerSocket();
      await sock.opened;
    } catch (e) {
      return { pass: false, detail: "could not connect to the server plugin: " + ((e && e.message) || e) };
    }
    const bad = [];
    const asText = reply => (typeof reply === "string" ? reply : new TextDecoder().decode(reply));
    const jrpc = async (name, obj) => JSON.parse(asText(await sock.rpc[name](obj === undefined ? "" : JSON.stringify(obj))));
    const regId = "v-live-" + QS.randHex(8);
    const seal = "seal-" + QS.randHex(12);
    try {
      const reg = await jrpc("freezeRegister", { version: { id: regId }, seal });
      if (!reg.ok || !reg.registered) bad.push("register: " + JSON.stringify(reg));
      const reg2 = await jrpc("freezeRegister", { version: { id: regId }, seal });
      if (!reg2.ok || reg2.registered) bad.push("idempotent re-register: " + JSON.stringify(reg2));
      const conflict = await jrpc("freezeRegister", { version: { id: regId }, seal: "different" });
      if (conflict.ok || conflict.code !== "seal_conflict") bad.push("re-seal not refused: " + JSON.stringify(conflict));
      if (!(await jrpc("frozenVerify", { id: regId, seal })).ok) bad.push("verify of a registered seal");
      const tampered = await jrpc("frozenVerify", { id: regId, seal: "tampered" });
      if (tampered.ok || tampered.code !== "seal_mismatch") bad.push("tampered seal accepted: " + JSON.stringify(tampered));
      const ghost = await jrpc("frozenVerify", { id: "v-ghost", seal: "x" });
      if (ghost.ok || ghost.code !== "unregistered") bad.push("unregistered id accepted: " + JSON.stringify(ghost));

      const frozenRec = { id: regId, state: "sent", title: "Sent", frozen_at: CAPTURED, frozen_seal: seal };
      const draftRec = { id: "v-draft", state: "draft", frozen_at: null };
      const legal = await jrpc("immutabilityCheck", { module: "quote_versions", previous: { records: [frozenRec, draftRec] }, next: { records: [frozenRec, Object.assign({}, draftRec, { title: "Edited" })] }, frozen_ids: [regId] });
      if (!legal.ok) bad.push("server refused a legal draft edit: " + JSON.stringify(legal));
      const versionTamper = await jrpc("immutabilityCheck", { module: "quote_versions", previous: { records: [frozenRec] }, next: { records: [Object.assign({}, frozenRec, { title: "Hacked" })] }, frozen_ids: [regId] });
      if (versionTamper.ok || versionTamper.code !== "frozen_version_immutable") bad.push("server allowed a frozen version edit: " + JSON.stringify(versionTamper));
      const memberTamper = await jrpc("immutabilityCheck", { module: "line_items", previous: { records: [{ id: "li-1", quote_version_id: regId, unit_sell_cents: 100 }] }, next: { records: [{ id: "li-1", quote_version_id: regId, unit_sell_cents: 1 }] }, frozen_ids: [regId] });
      if (memberTamper.ok || memberTamper.code !== "frozen_member_immutable") bad.push("server allowed a frozen member edit: " + JSON.stringify(memberTamper));

      // A real local freeze consults the server, and verifyAgainstServer proves
      // the local seal against the server's copy — including a forced mismatch.
      const env = makeEnv();
      env.svc.attachServerRegister(req => jrpc("freezeRegister", req));
      env.svc.attachServerVerify(req => jrpc("frozenVerify", req));
      const v = await env.svc.createVersion({ quote_id: "q-live", title: "Live" });
      await env.svc.addLine(v.version.id, { kind: "one_time", description: "Thing", unit_sell_cents: 4200 });
      const frozen = await env.svc.freeze(v.version.id, { at: CAPTURED, actor: "rep" });
      if (!frozen.ok || frozen.authority !== "server") bad.push("freeze not server-authoritative: " + JSON.stringify(frozen));
      const against = await env.svc.verifyAgainstServer();
      if (!against.ok || against.diffs.length) bad.push("verifyAgainstServer: " + JSON.stringify(against));

      const raw = rawStore(env);
      const vd = await raw.loadDoc(V.DOC_VERSIONS);
      const nextRecords = vd.content.records.map(r => (r.id === v.version.id ? Object.assign({}, r, { frozen_seal: "junk" }) : r));
      const save = await raw.saveChecked(V.DOC_VERSIONS, { records: nextRecords }, { expectedBase: vd.revision });
      if (!save.ok) bad.push("raw seal tamper write failed: " + JSON.stringify(save));
      else {
        const against2 = await env.svc.verifyAgainstServer();
        if (against2.ok || !against2.diffs.some(d => d.code === "seal_mismatch")) bad.push("server seal mismatch not detected: " + JSON.stringify(against2));
      }
    } catch (err) {
      bad.push("live server check threw: " + ((err && err.message) || err));
    } finally {
      try { sock.close(1000); } catch (e) {}
    }
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "the server registry refuses re-sealing and tampered seals; immutabilityCheck mirrors the client rule; a live freeze is server-registered and a forced seal mismatch is caught" };
  });

  T.register("quote versions: create → author → freeze → revise on the real workspace store (live)", async () => {
    const r = window.root;
    if (!r || !r.uploadPlugin) return { pass: true, skip: true, detail: "upload-plugin unavailable" };
    const ns = "ver" + Date.now().toString(36) + QS.randHex(4);
    let store;
    try {
      store = QS.createDefault({ ns, modules: ENV_MODULES });
    } catch (e) {
      return { pass: true, skip: true, detail: e.message };
    }
    const svc = V.createService({ store });
    const created = await svc.createVersion({ quote_id: "live-1", title: "Live version" });
    if (created.code === "requires_saved_generator") return { pass: true, skip: true, detail: "editable uploads need a saved generator" };
    if (created.code === "over_daily_allowance") return { pass: true, skip: true, detail: "upload daily allowance exhausted — live version check skipped" };
    if (!created.ok) return { pass: false, detail: "create failed: " + JSON.stringify(created) };
    const res = await svc.freeze(created.version.id, { at: CAPTURED, actor: "rep" });
    const folder = r.kv.qu;
    const entries = await folder.entries().catch(() => []);
    for (const pair of entries) {
      const k = pair[0];
      if ((k.indexOf("doc:") === 0 || k.indexOf("sync:") === 0) && k.indexOf(":" + ns + ":") !== -1) await folder.delete(k);
    }
    if (!res.ok) return { pass: false, detail: "freeze failed: " + JSON.stringify(res) };
    const check = await svc.verify();
    if (!check.ok || check.count !== 1) return { pass: false, detail: "verify: " + JSON.stringify(check) };
    return { pass: true, detail: "created, froze and re-verified a sealed version on the canonical store" };
  });

  T.register("quote versions: freeze mints price provenance for hand-priced lines (task 17)", async () => {
    const ns = "mint" + QS.randHex(6);
    const store = QS.create({ ns, kv: makeKv(new Map()), editable: makeEditable(new Map()), modules: QS.DEFAULT_MODULES });
    const prices = window.QU_PRICESNAPSHOTS.createService({ store });
    const svc = V.createService({ store, priceSnapshots: prices });
    const bad = [];

    const v1 = await svc.createVersion({ quote_id: "q-1", title: "Mint me" });
    if (!v1.ok) return { pass: false, detail: "createVersion: " + JSON.stringify(v1) };
    const hand = await svc.addLine(v1.version.id, { kind: "one_time", description: "Hand-priced router", quantity: 2, unit_cost_cents: 9000, unit_sell_cents: 15000 });
    const bound = await svc.addLine(v1.version.id, { kind: "one_time", description: "Already sourced", quantity: 1, unit_cost_cents: 1000, unit_sell_cents: 2000 });
    if (!hand.ok || !bound.ok) return { pass: false, detail: "addLine: " + JSON.stringify(hand) + " " + JSON.stringify(bound) };
    const pre = await prices.capture({ source: "distributor", distributor_sku: "SKU-9", unit_cost_cents: 1000, list_price_cents: 2000, captured_at: CAPTURED });
    if (!pre.ok) return { pass: false, detail: "pre capture: " + JSON.stringify(pre) };
    const bind = await svc.updateLine(v1.version.id, bound.line.id, { price_snapshot_ref: pre.snapshot.id, pricing_mode: "snapshot" });
    if (!bind.ok) return { pass: false, detail: "bind: " + JSON.stringify(bind) };

    const mint1 = await svc.mintSnapshots(v1.version.id);
    if (!mint1.ok || mint1.count !== 1) bad.push("first mint: " + JSON.stringify(mint1));
    if (!mint1.minted || mint1.minted[0].line_id !== hand.line.id) bad.push("minted the wrong line");
    const lines1 = await svc.listLines(v1.version.id);
    const handAfter = lines1.lines.find(l => l.id === hand.line.id);
    const boundAfter = lines1.lines.find(l => l.id === bound.line.id);
    if (!handAfter.price_snapshot_ref || handAfter.pricing_mode !== "snapshot") bad.push("hand-priced line not backfilled: " + JSON.stringify(handAfter));
    if (boundAfter.price_snapshot_ref !== pre.snapshot.id) bad.push("the pre-bound snapshot was overwritten");
    const snap = await prices.get(handAfter.price_snapshot_ref);
    if (!snap.ok || !snap.snapshot || snap.snapshot.source !== "manual") bad.push("minted snapshot: " + JSON.stringify(snap && snap.snapshot));
    else if (snap.snapshot.unit_cost_cents !== 9000 || snap.snapshot.list_price_cents !== 15000 || snap.snapshot.quantity_available !== 2) bad.push("minted snapshot content: " + JSON.stringify(snap.snapshot));
    else if (!snap.snapshot.raw_response || snap.snapshot.raw_response.note === undefined) bad.push("minted snapshot lost its raw provenance");

    const mint2 = await svc.mintSnapshots(v1.version.id);
    if (!mint2.ok || mint2.count !== 0) bad.push("mint is not idempotent: " + JSON.stringify(mint2));

    // freeze is the point of no return: it completes provenance before sealing.
    const v2 = await svc.createVersion({ quote_id: "q-1", title: "Freeze mints" });
    await svc.addLine(v2.version.id, { kind: "mrr", description: "Support", unit_cost_cents: 3000, unit_sell_cents: 5000 });
    const frozen = await svc.freeze(v2.version.id, { at: CAPTURED, actor: "rep" });
    if (!frozen.ok) bad.push("freeze: " + JSON.stringify(frozen));
    else {
      if (!frozen.mint || frozen.mint.count !== 1) bad.push("freeze did not report the mint: " + JSON.stringify(frozen.mint));
      const fl = await svc.listLines(v2.version.id);
      if (!fl.lines[0].price_snapshot_ref) bad.push("frozen hand-priced line has no provenance");
    }
    const afterFreeze = await svc.mintSnapshots(v2.version.id);
    if (afterFreeze.ok || afterFreeze.code !== "frozen") bad.push("minting into a frozen version: " + JSON.stringify(afterFreeze));

    // A service without the snapshot service still freezes, just without minting.
    const ns2 = "mint" + QS.randHex(6);
    const store2 = QS.create({ ns: ns2, kv: makeKv(new Map()), editable: makeEditable(new Map()), modules: [V.DOC_VERSIONS, V.DOC_LINES, V.DOC_GROUPS] });
    const svc2 = V.createService({ store: store2 });
    const v3 = await svc2.createVersion({ quote_id: "q-2", title: "No snapshots" });
    await svc2.addLine(v3.version.id, { kind: "one_time", description: "Thing", unit_sell_cents: 100 });
    const frozen3 = await svc2.freeze(v3.version.id, { at: CAPTURED });
    if (!frozen3.ok || frozen3.mint !== null) bad.push("freeze without a snapshot service: " + JSON.stringify(frozen3));
    const missing = await svc2.mintSnapshots(v3.version.id);
    if (missing.ok || missing.code !== "no_pricesnapshots") bad.push("mint without a service: " + JSON.stringify(missing));
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "freeze mints a manual snapshot for every hand-priced line, backfills the line, leaves pre-bound snapshots alone, is idempotent, refuses a frozen version, and degrades gracefully without a snapshot service" };
  });
})();
