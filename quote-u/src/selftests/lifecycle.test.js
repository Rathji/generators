(function () {
  const T = window.QU_SELFTEST;
  const L = window.QU_LIFECYCLE;
  if (!T || !L) return;

  function throws(fn, code) {
    try {
      fn();
    } catch (err) {
      if (code && err.code !== code) return "threw " + err.code + " instead of " + code;
      return null;
    }
    return "did not throw";
  }

  function asText(reply) {
    if (typeof reply === "string") return reply;
    return new TextDecoder().decode(reply);
  }

  const LINEAR = ["draft", "internal_review", "sent", "viewed"];

  T.register("lifecycle: states, initial state and terminal branches", () => {
    const bad = [];
    const expected = ["draft", "internal_review", "sent", "viewed", "approved", "declined", "expired"];
    if (L.STATES.join(",") !== expected.join(",")) bad.push("states = " + L.STATES.join(","));
    if (L.INITIAL_STATE !== "draft") bad.push("initial = " + L.INITIAL_STATE);
    if (L.isState("draft") !== true || L.isState("frozen") !== false) bad.push("isState");
    if (L.TERMINAL_STATES.join(",") !== "approved,declined,expired") bad.push("terminal = " + L.TERMINAL_STATES.join(","));
    for (const s of LINEAR) if (L.isTerminal(s)) bad.push(s + " should not be terminal");
    if (!L.isTerminal("approved")) bad.push("approved should be terminal");
    for (const t of L.TERMINAL_STATES) {
      if (!L.isTerminal(t)) bad.push(t + " should be terminal");
      if (L.allowedFrom(t).length !== 0) bad.push(t + " has outgoing transitions: " + L.allowedFrom(t).join(","));
    }
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "7 states; draft start; approved/declined/expired terminal" };
  });

  T.register("lifecycle: the legal transition map is exact", () => {
    const bad = [];
    const legal = {
      draft: ["internal_review", "sent"],
      internal_review: ["draft", "sent"],
      sent: ["viewed", "approved", "declined", "expired"],
      viewed: ["approved", "declined", "expired"],
      approved: [],
      declined: [],
      expired: []
    };
    for (const from of L.STATES) {
      const got = L.allowedFrom(from).sort().join(",");
      const want = legal[from].sort().join(",");
      if (got !== want) bad.push(`${from}: ${got} (want ${want})`);
    }
    const mustRefuse = [
      ["draft", "viewed"], ["draft", "approved"], ["draft", "declined"], ["draft", "expired"],
      ["internal_review", "viewed"], ["internal_review", "approved"],
      ["sent", "draft"], ["sent", "internal_review"], ["sent", "sent"],
      ["viewed", "draft"], ["viewed", "sent"], ["viewed", "internal_review"],
      ["approved", "sent"], ["approved", "declined"], ["declined", "approved"], ["expired", "viewed"]
    ];
    for (const [from, to] of mustRefuse) {
      if (L.canTransition(from, to)) bad.push(`${from}→${to} should be illegal`);
      if (L.attempt(from, to).ok) bad.push(`${from}→${to} attempt allowed`);
    }
    const e1 = throws(() => L.assertTransition("sent", "draft"), "illegal_transition");
    if (e1) bad.push("assertTransition: " + e1);
    const e2 = throws(() => L.assertTransition("nope", "sent"), "unknown_state");
    if (e2) bad.push("unknown state: " + e2);
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "only the declared transitions are legal; terminal states refuse everything" };
  });

  T.register("lifecycle: each transition emits the right audit event", () => {
    const table = [
      ["draft", "internal_review", "internal_review_started"],
      ["draft", "sent", "sent"],
      ["internal_review", "draft", "internal_review_returned"],
      ["internal_review", "sent", "sent"],
      ["sent", "viewed", "viewed"],
      ["sent", "approved", "approved"],
      ["sent", "declined", "declined"],
      ["sent", "expired", "expired"],
      ["viewed", "approved", "approved"],
      ["viewed", "declined", "declined"],
      ["viewed", "expired", "expired"]
    ];
    const bad = [];
    for (const [from, to, name] of table) {
      const r = L.attempt(from, to);
      if (!r.ok) { bad.push(`${from}→${to} refused`); continue; }
      if (r.event !== name) bad.push(`${from}→${to} → ${r.event} (want ${name})`);
      if (r.state !== to) bad.push(`${from}→${to} state`);
      if (r.terminal !== (to === "approved" || to === "declined" || to === "expired")) bad.push(`${from}→${to} terminal flag`);
    }
    if (L.attempt("draft", "sent", { actor_type: "portal" }).code !== "portal_needs_token") bad.push("portal without token allowed");
    if (L.attempt("draft", "sent", { actor_type: "portal", token_id: "tk1" }).ok !== true) bad.push("portal with token refused");
    if (L.attempt("draft", "sent", { actor_type: "robot" }).code !== "bad_actor") bad.push("bad actor type allowed");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: table.length + " transitions, each with its event name" };
  });

  T.register("lifecycle: apply() is pure and stamps the transition time", () => {
    const bad = [];
    const v0 = { id: "v1", quote_id: "q1", state: "draft", title: "Base" };
    const frozen = JSON.stringify(v0);
    const at = "2026-03-04T05:06:07.000Z";
    const r = L.apply(v0, "sent", { actor_type: "internal", actor: "rep@acme.test", at, ip: "1.2.3.4", user_agent: "UA/1" });
    if (!r.ok) { bad.push("apply refused: " + JSON.stringify(r)); }
    else {
      if (r.state !== "sent" || r.event !== "sent") bad.push("state/event");
      if (r.version.state !== "sent" || r.version.sent_at !== at) bad.push("version not updated: " + JSON.stringify(r.version));
      if (r.version.title !== "Base") bad.push("version fields dropped");
      if (!r.record || r.record.event !== "sent" || r.record.actor_type !== "internal" || r.record.actor !== "rep@acme.test") bad.push("record = " + JSON.stringify(r.record));
      if (r.record.at !== at || r.record.quote_id !== "q1" || r.record.version_id !== "v1") bad.push("record ids/time");
      if (r.record.token_id !== null) bad.push("internal event should have no token id");
    }
    if (JSON.stringify(v0) !== frozen) bad.push("apply() mutated its input version");
    const approved = L.apply({ id: "v1", state: "sent" }, "approved", { at });
    if (approved.version.approved_at !== at || !approved.terminal) bad.push("approved_at/terminal");
    const bad2 = L.apply({ id: "v1", state: "approved" }, "sent", {});
    if (bad2.ok || bad2.code !== "illegal_transition") bad.push("terminal transition allowed: " + JSON.stringify(bad2));
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "pure apply, timestamp stamped once, audit record built" };
  });

  T.register("lifecycle: beginVersion starts a version in draft with a created event", () => {
    const bad = [];
    const r = L.beginVersion({ id: "v9", quote_id: "q9" }, { actor_type: "internal", actor: "rep@acme.test", at: "2026-01-01T00:00:00.000Z" });
    if (!r.ok || r.version.state !== "draft" || r.state !== "draft") bad.push("begin failed: " + JSON.stringify(r));
    if (r.event !== "created") bad.push("event = " + r.event);
    if (r.record.event !== "created" || r.record.version_id !== "v9") bad.push("record = " + JSON.stringify(r.record));
    if (r.version.created_at !== "2026-01-01T00:00:00.000Z") bad.push("created_at not stamped");
    const again = L.beginVersion({ id: "v9", state: "draft" }, {});
    if (again.ok || again.code !== "already_started") bad.push("double begin allowed");
    const fromDraft = L.apply(r.version, "sent", {});
    if (!fromDraft.ok) bad.push("a begun version cannot be sent");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "created → draft → sendable; re-begin refused" };
  });

  T.register("lifecycle: noteView transitions sent → viewed once, then records repeat views", () => {
    const bad = [];
    const sent = { id: "v1", quote_id: "q1", state: "sent" };
    const first = L.noteView(sent, { actor_type: "portal", actor: "client", token_id: "tk1", at: "2026-02-02T00:00:00.000Z" });
    if (!first.ok || !first.transitioned || first.version.state !== "viewed") bad.push("first view: " + JSON.stringify(first));
    if (first.record.event !== "viewed" || first.record.token_id !== "tk1") bad.push("first view record");
    const second = L.noteView(first.version, { actor_type: "portal", actor: "client", token_id: "tk1" });
    if (!second.ok || second.transitioned || second.version.state !== "viewed") bad.push("second view should not transition");
    if (second.record.event !== "viewed") bad.push("second view should still record an event");
    const afterApproval = L.noteView({ id: "v1", state: "approved" }, { actor_type: "portal", actor: "client", token_id: "tk1" });
    if (!afterApproval.ok || afterApproval.transitioned || afterApproval.version.state !== "approved") bad.push("re-open after approval should just record");
    const draft = L.noteView({ id: "v1", state: "draft" }, { actor_type: "portal", actor: "client", token_id: "tk1" });
    if (draft.ok || draft.code !== "not_sent") bad.push("a draft must not be viewable: " + JSON.stringify(draft));
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "sent→viewed once; repeats and post-decision reopens only append events" };
  });

  T.register("lifecycle: audit events are shaped for quote_events and refuse secrets", () => {
    const bad = [];
    const rec = L.createEvent({ quote_id: "q1", version_id: "v1", event: "approved", actor_type: "portal", actor: "J. Client", token_id: "tk1", ip: "9.9.9.9", user_agent: "UA", detail: { selection: ["l1"] } });
    const keys = Object.keys(rec).sort().join(",");
    const want = ["actor", "actor_type", "at", "detail", "event", "ip", "quote_id", "token_id", "user_agent", "version_id"].sort().join(",");
    if (keys !== want) bad.push("record keys = " + keys);
    if (!/^\d{4}-\d{2}-\d{2}T/.test(rec.at)) bad.push("default timestamp missing");
    if (rec.actor_type !== "portal" || rec.token_id !== "tk1") bad.push("portal actor/token");
    const e1 = throws(() => L.createEvent({ event: "sent", actor_type: "portal", actor: "x" }), "portal_needs_token");
    if (e1) bad.push("portal no token: " + e1);
    const e2 = throws(() => L.createEvent({ event: "sent", actor_type: "robot" }), "bad_actor");
    if (e2) bad.push("bad actor: " + e2);
    const e3 = throws(() => L.createEvent({ event: "", actor_type: "system" }), "bad_event");
    if (e3) bad.push("empty event: " + e3);
    const e4 = throws(() => L.createEvent({ event: "sent", actor_type: "internal", actor: "rep", detail: { token: "SECRET-PLAINTEXT" } }), "secret_in_event");
    if (e4) bad.push("token secret: " + e4);
    const e5 = throws(() => L.createEvent({ event: "sent", actor_type: "internal", actor: "rep", detail: { nested: [{ token_secret: "x" }] } }), "secret_in_event");
    if (e5) bad.push("nested secret: " + e5);
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "quote_events shape exact; token secrets never enter the audit log" };
  });

  T.register("lifecycle: applyChecked defers to the server when one is attached", async () => {
    const bad = [];
    const v = { id: "v1", quote_id: "q1", state: "draft" };
    L.detachServerValidator();
    const local = await L.applyChecked(v, "sent", { actor_type: "internal", actor: "rep" });
    if (!local.ok || local.authority !== "local") bad.push("no-validator run: " + JSON.stringify(local));

    L.attachServerValidator(async req => {
      if (req.from === "draft" && req.to === "sent") return { ok: true, event: "sent" };
      return { ok: false, code: "server_refused", detail: "nope" };
    });
    if (!L.hasServerValidator()) bad.push("hasServerValidator false after attach");
    const serverOk = await L.applyChecked(v, "sent", { actor_type: "internal", actor: "rep" });
    if (!serverOk.ok || serverOk.authority !== "server") bad.push("server-agreed run: " + JSON.stringify(serverOk));

    L.attachServerValidator(async () => ({ ok: false, code: "illegal_transition", detail: "server says no" }));
    const vetoed = await L.applyChecked(v, "sent", {});
    if (vetoed.ok || vetoed.authority !== "server" || vetoed.code !== "illegal_transition") bad.push("server veto ignored: " + JSON.stringify(vetoed));

    L.attachServerValidator(async () => ({ ok: true, event: "different_event" }));
    const drifted = await L.applyChecked(v, "sent", {});
    if (drifted.ok || drifted.code !== "server_disagrees") bad.push("server/client event drift not caught: " + JSON.stringify(drifted));

    L.attachServerValidator(async () => ({ ok: true, event: "sent" }));
    const failClosed = await L.applyChecked({ id: "v1", state: "approved" }, "sent", {});
    if (failClosed.ok || !failClosed.server_disagrees || failClosed.authority !== "server") bad.push("client-illegal/server-legal not failed closed: " + JSON.stringify(failClosed));

    L.attachServerValidator(async () => { throw new Error("offline"); });
    const degraded = await L.applyChecked(v, "sent", {});
    if (!degraded.ok || degraded.authority !== "local" || !degraded.degraded) bad.push("offline fallback: " + JSON.stringify(degraded));
    L.detachServerValidator();
    if (L.hasServerValidator()) bad.push("detach failed");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "server is authoritative when attached; vetoes honoured; offline marked degraded" };
  });

  T.register("lifecycle: verifyAgainst detects a drifted server table", () => {
    const bad = [];
    const good = { states: L.STATES.slice(), terminal: { approved: true, declined: true, expired: true }, transitions: JSON.parse(JSON.stringify(L.TRANSITIONS)), actor_types: L.ACTOR_TYPES.slice() };
    const okRes = L.verifyAgainst(good);
    if (!okRes.ok) bad.push("matching table reported drift: " + okRes.diffs.join("; "));
    const drifted = JSON.parse(JSON.stringify(good));
    drifted.transitions.sent.viewed = "opened";
    const d1 = L.verifyAgainst(drifted);
    if (d1.ok) bad.push("event-name drift not detected");
    const drifted2 = JSON.parse(JSON.stringify(good));
    delete drifted2.transitions.viewed.declined;
    const d2 = L.verifyAgainst(drifted2);
    if (d2.ok) bad.push("missing transition not detected");
    const drifted3 = JSON.parse(JSON.stringify(good));
    drifted3.states.push("archived");
    const d3 = L.verifyAgainst(drifted3);
    if (d3.ok) bad.push("extra state not detected");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "identical table passes; event/target/state drift all caught" };
  });

  T.register("lifecycle: the server plugin validates transitions authoritatively (live)", async () => {
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
    try {
      const table = JSON.parse(asText(await sock.rpc.lifecycleTable("")));
      const verify = L.verifyAgainst(table);
      if (!verify.ok) bad.push("client/server table drift: " + verify.diffs.join("; "));

      const legal = JSON.parse(asText(await sock.rpc.lifecycleValidate(JSON.stringify({ from: "draft", to: "sent" }))));
      if (!legal.ok || legal.event !== "sent") bad.push("server refused draft→sent: " + JSON.stringify(legal));
      const legal2 = JSON.parse(asText(await sock.rpc.lifecycleValidate(JSON.stringify({ from: "viewed", to: "approved" }))));
      if (!legal2.ok || legal2.event !== "approved") bad.push("server refused viewed→approved: " + JSON.stringify(legal2));
      const illegal = JSON.parse(asText(await sock.rpc.lifecycleValidate(JSON.stringify({ from: "approved", to: "sent" }))));
      if (illegal.ok || illegal.code !== "illegal_transition") bad.push("server allowed approved→sent: " + JSON.stringify(illegal));
      const unknown = JSON.parse(asText(await sock.rpc.lifecycleValidate(JSON.stringify({ from: "draft", to: "frozen" }))));
      if (unknown.ok || unknown.code !== "unknown_state") bad.push("server allowed unknown target: " + JSON.stringify(unknown));
      const portalNoTok = JSON.parse(asText(await sock.rpc.lifecycleValidate(JSON.stringify({ from: "sent", to: "approved", actor_type: "portal" }))));
      if (portalNoTok.ok || portalNoTok.code !== "portal_needs_token") bad.push("server allowed portal without token: " + JSON.stringify(portalNoTok));

      L.attachServerValidator(async req => JSON.parse(asText(await sock.rpc.lifecycleValidate(JSON.stringify(req)))));
      const applied = await L.applyChecked({ id: "v1", quote_id: "q1", state: "draft" }, "sent", { actor_type: "internal", actor: "rep", at: "2026-06-06T00:00:00.000Z" });
      if (!applied.ok || applied.authority !== "server") bad.push("applyChecked not server-authoritative: " + JSON.stringify(applied));
      const vetoed = await L.applyChecked({ id: "v1", state: "approved" }, "sent", {});
      if (vetoed.ok || vetoed.authority !== "server") bad.push("server did not veto terminal→sent: " + JSON.stringify(vetoed));
      L.detachServerValidator();
    } catch (err) {
      L.detachServerValidator();
      bad.push("live server check threw: " + ((err && err.message) || err));
    } finally {
      try { sock.close(1000); } catch (e) {}
    }
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "server table matches the client; legal/illegal/portal transitions all validated server-side" };
  });
})();
