(function () {
  const T = window.QU_SELFTEST;
  const H = window.QU_HUB;
  const R = window.QU_ROLES;
  if (!T || !H || !R) return;

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function memKv(seed) {
    const m = new Map(Object.entries(seed || {}));
    return { map: m, get: async k => m.get(k), set: async (k, v) => { m.set(k, v); }, delete: async k => { m.delete(k); } };
  }

  // A WebSocket-shaped fake with an rpc table. `impl(name, obj)` returns a plain
  // object that is serialized to a JSON string exactly like the real server.
  function makeFakeSocket(impl) {
    const listeners = {};
    function fire(ev, payload) { (listeners[ev] || []).slice().forEach(fn => { try { fn(payload); } catch (e) {} }); }
    const sock = {
      rpc: {},
      binaryType: "arraybuffer",
      addEventListener(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
      close(code) { fire("close", { code: code || 1000 }); },
      _open() { fire("open", {}); },
      _msg(m) { fire("message", { data: JSON.stringify(m) }); }
    };
    const names = ["hubInfo", "hubAuth", "hubSetupOwner", "hubSignout", "hubMemberAdd", "hubMemberRemove",
      "hubMemberRole", "hubMemberResetPw", "hubTeam", "hubReportWrite", "hubContext", "hubPresence", "hubAuditTail"];
    names.forEach(n => {
      sock.rpc[n] = async data => JSON.stringify(impl(n, data ? JSON.parse(data) : {}) || {});
    });
    return sock;
  }

  function makeStore(recs) {
    const state = { recs: (recs || []).slice(), stale: (recs || []).slice(), loads: [] };
    return {
      state,
      loadDoc: async (m, o) => {
        const refresh = !!(o && o.refresh);
        state.loads.push({ module: m, refresh: refresh });
        // A non-refresh read is the (possibly stale) local cache; a refresh read
        // is the canonical copy the server just told us about.
        return { ok: true, content: { records: (refresh ? state.recs : state.stale).slice() }, revision: refresh ? 9 : 1, state: "canonical" };
      },
      saveChecked: async () => ({ ok: true, revision: 5 }),
      saveDoc: async () => ({ ok: true, revision: 5 })
    };
  }

  // Boot a hub against a fake socket and drive the sign-in handshake. Returns the
  // live service, the fake socket, and the call log the impl recorded.
  async function signInHub(opts) {
    opts = opts || {};
    const log = { auth: [], context: [], writes: [], signout: 0 };
    let lastSock = null;
    const meRole = opts.role || "manager";
    const impl = (name, obj) => {
      if (name === "hubInfo") return { ok: true, setup: true, online: [], my: null, roles: ["owner", "manager", "viewer"] };
      if (name === "hubAuth") { log.auth.push(obj); return { ok: true, me: { id: 1, name: obj.name, role: meRole } }; }
      if (name === "hubContext") { log.context.push(obj); return { ok: true }; }
      if (name === "hubReportWrite") { log.writes.push(obj); return { ok: true, index: { module: obj.module, rev: obj.rev } }; }
      if (name === "hubSignout") { log.signout++; return { ok: true }; }
      if (name === "hubMemberAdd") return { ok: true, id: 2, name: obj.name, role: obj.role };
      if (name === "hubTeam") return { ok: true, members: [{ id: 1, name: "Dana", role: meRole }], index: [], online: [] };
      if (name === "hubAuditTail") return { ok: true, audit: [{ at: 1, actorName: "Dana", action: "write", target: "quotes", detail: "revision 5" }] };
      return { ok: true };
    };
    const store = opts.store || makeStore();
    const roles = R.createService({ policy: opts.policy || { default_role: "owner", discount_floor_bp: 1500, members: [] }, scope: "*" });
    const kv = memKv(opts.kvSeed);
    const svc = H.createService({
      store, roles, kv, pollMs: opts.pollMs || 60000,
      socketFactory: opts.socketFactory || (() => { lastSock = makeFakeSocket(impl); return lastSock; })
    });
    await svc.boot(store);
    const p = svc.enable({ name: "Dana", password: "correcthorsebattery", confirm: "correcthorsebattery" });
    for (let i = 0; i < 100 && !lastSock; i++) await sleep(2);
    if (lastSock && lastSock._open) lastSock._open();
    const res = await p;
    return { svc, roles, store, kv, log, sock: lastSock, res };
  }

  T.register("hub: sign-in mirrors the server's role and reports writes as the authenticated member", async () => {
    const bad = [];
    const h = await signInHub({ role: "manager" });
    if (!h.res.ok) bad.push("enable failed: " + JSON.stringify(h.res));
    if (h.svc.state !== "open") bad.push("state = " + h.svc.state);
    if (!h.svc.me || h.svc.me.role !== "manager") bad.push("me = " + JSON.stringify(h.svc.me));
    if (!h.log.auth.length || h.log.auth.some(a => a.password !== "correcthorsebattery")) bad.push("auth was not sent with the password: " + JSON.stringify(h.log.auth));

    // the server's verdict is mirrored into the access model
    if (h.roles.current().role !== "manager" || h.roles.current().source !== "hub") bad.push("role model not mirrored: " + JSON.stringify(h.roles.current()));
    if (!h.roles.can("send") || h.roles.can("manage_policy")) bad.push("mirrored manager capabilities are wrong");

    // a successful local write is reported to the server (which re-attributes it)
    await h.store.saveChecked("quotes", { records: [] }, { expectedBase: 0 });
    await sleep(30);
    if (h.log.writes.length !== 1) bad.push("write not reported: " + h.log.writes.length);
    else if (h.log.writes[0].module !== "quotes" || h.log.writes[0].rev !== 5) bad.push("write report = " + JSON.stringify(h.log.writes[0]));

    // signing out of an ENABLED hub drops to least privilege (viewer), never the
    // owner default — a viewer must not be promoted by signing out.
    await h.svc.signout();
    if (h.svc.me) bad.push("still signed in after signout");
    const after = h.roles.current();
    if (after.source !== "local" || after.role !== "viewer") bad.push("signed-out hub identity should be a local viewer, got: " + JSON.stringify(after));
    if (h.roles.can("edit_draft")) bad.push("a signed-out hub client may still edit");

    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "auth carries the password, the server role is mirrored into QU_ROLES, a store write is reported, and signout drops to a local viewer" };
  });

  T.register("hub: a document change is streamed, re-read, and attributed to its actor", async () => {
    const bad = [];
    const store = makeStore([{ id: "q1" }]);
    const h = await signInHub({ role: "manager", store: store });
    if (!h.res.ok) bad.push("enable failed");

    const changes = [];
    h.svc.on("change", ev => changes.push(ev));

    // the canonical copy advances on the server; our local (cache) copy is stale
    store.state.recs = [{ id: "q1" }, { id: "q2" }];
    h.sock._msg({ t: "chg", module: "quotes", rev: 7, at: 123, actorId: 2, actorName: "Sam" });
    await sleep(40);
    if (changes.length !== 1) bad.push("expected 1 change, got " + changes.length);
    else {
      const ev = changes[0];
      if (ev.actorName !== "Sam") bad.push("actor = " + ev.actorName);
      if (ev.changedIds.indexOf("q2") === -1) bad.push("changed ids = " + JSON.stringify(ev.changedIds));
      if (ev.via !== "hub") bad.push("via = " + ev.via);
    }
    if (!store.state.loads.some(l => l.module === "quotes" && l.refresh)) bad.push("the change did not trigger a refresh read");

    // our OWN change (same actor id) must be ignored to avoid an echo loop
    h.sock._msg({ t: "chg", module: "quotes", rev: 8, actorId: 1, actorName: "Dana" });
    await sleep(30);
    if (changes.length !== 1) bad.push("an own-actor change was not ignored (" + changes.length + " changes)");

    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "a remote change is re-read, diffed, attributed to Sam, and a same-actor echo is ignored" };
  });

  T.register("hub: presence marks collaborators editing the same record", async () => {
    const bad = [];
    const h = await signInHub({ role: "owner" });
    h.sock._msg({ t: "pres", online: 2, people: [
      { id: 1, name: "Dana", role: "owner", module: "quotes", recordId: "q9", page: "Quote builder" },
      { id: 2, name: "Sam", role: "manager", module: "quotes", recordId: "q9", page: "Quote builder" },
      { id: 3, name: "Vic", role: "viewer", module: "quotes", recordId: "q3", page: "Quote builder" }
    ] });
    await sleep(10);
    if (h.svc.online !== 2) bad.push("online = " + h.svc.online);
    h.svc.setContext({ module: "quotes", recordId: "q9" });
    const here = h.svc.presenceFor("quotes", "q9");
    if (here.length !== 1 || here[0].name !== "Sam") bad.push("presenceFor = " + JSON.stringify(here.map(p => p.name)));
    if (h.svc.presenceFor("quotes", "q3").length !== 1) bad.push("a different record's collaborator leaked");
    const marker = h.svc.renderPresenceMarker("quotes", "q9");
    if (!marker) bad.push("no marker rendered");
    else if (marker.textContent.indexOf("Sam") === -1) bad.push("marker text = " + marker.textContent);
    if (h.svc.renderPresenceMarker("quotes", "q1") !== null) bad.push("a marker rendered where no one else is");

    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "presence is scoped to the record: Sam shows on q9, nobody on an unshared record" };
  });

  T.register("hub: an unreachable hub degrades to polling and still surfaces changes", async () => {
    const bad = [];
    const store = makeStore([{ id: "q1" }]);
    const roles = R.createService({ policy: { default_role: "owner", discount_floor_bp: 1500, members: [] }, scope: "*" });
    const svc = H.createService({
      store: store, roles: roles, kv: memKv({ "hub:cfg": { enabled: true, name: "Dana" } }),
      pollMs: 60000, socketFactory: () => null
    });
    await svc.boot(store);
    if (svc.state !== "degraded") bad.push("state = " + svc.state);
    if (svc.me) bad.push("a member is shown as signed in while degraded");

    const changes = [];
    svc.on("change", ev => changes.push(ev));
    svc.setContext({ module: "quotes", recordId: "q1" });
    await svc.pollOnce();
    store.state.recs = [{ id: "q1" }, { id: "q2" }];
    const r = await svc.pollOnce();
    if (!r.ok || !r.changed || r.changed.indexOf("q2") === -1) bad.push("pollOnce did not detect the change: " + JSON.stringify(r));
    if (changes.length !== 1 || changes[0].via !== "poll") bad.push("poll change not emitted: " + JSON.stringify(changes));

    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "with no socket the hub reports degraded and a polled refresh still broadcasts the change" };
  });

  T.register("hub: the poll fallback notices in-place edits and deletes, not only new ids", async () => {
    const bad = [];
    const store = makeStore([{ id: "q1", title: "A" }, { id: "q2", title: "B" }]);
    const roles = R.createService({ policy: { default_role: "owner", discount_floor_bp: 1500, members: [] }, scope: "*" });
    const svc = H.createService({ store, roles, kv: memKv({ "hub:cfg": { enabled: true, name: "Dana" } }), pollMs: 60000, socketFactory: () => null });
    await svc.boot(store);
    svc.setContext({ module: "quotes" });
    await svc.pollOnce(); // baseline from the local cache copy
    const changes = [];
    svc.on("change", ev => changes.push(ev));

    // q1 is edited in place and q2 is deleted — the id set shrinks and no new id appears
    store.state.recs = [{ id: "q1", title: "A-edited" }];
    const r = await svc.pollOnce();
    if (!r.ok) bad.push("poll failed: " + JSON.stringify(r));
    if (changes.length !== 1) bad.push("expected 1 edit/delete change, got " + changes.length);
    else {
      const ids = changes[0].changedIds;
      if (ids.indexOf("q1") === -1) bad.push("in-place edit missed: " + JSON.stringify(ids));
      if (ids.indexOf("q2") === -1) bad.push("delete missed: " + JSON.stringify(ids));
    }
    // a poll with no movement must stay quiet
    const again = await svc.pollOnce();
    if (again.changed && again.changed.length) bad.push("an unchanged poll reported changes: " + JSON.stringify(again));
    if (changes.length !== 1) bad.push("an unchanged poll emitted an event");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "the poller detects an in-place edit and a delete by revision + record bodies, and stays quiet when nothing moved" };
  });

  T.register("hub: the live server plugin answers hubInfo (skipped when unavailable)", async () => {
    if (!window.root || typeof window.root.createServerSocket !== "function") return { pass: true, skip: true, detail: "no server socket in this environment" };
    let sock = null;
    try { sock = window.root.createServerSocket(); } catch (e) { return { pass: true, skip: true, detail: "socket unavailable: " + ((e && e.message) || e) }; }
    if (!sock) return { pass: true, skip: true, detail: "no socket" };
    try {
      if (sock.opened && typeof sock.opened.then === "function") await Promise.race([sock.opened, sleep(4000)]);
      const raw = await Promise.race([sock.rpc.hubInfo(""), sleep(4000).then(() => null)]);
      if (raw === null) return { pass: true, skip: true, detail: "the hub did not answer in time" };
      const info = JSON.parse(String(raw));
      if (!info || info.ok !== true) return { pass: false, detail: "hubInfo = " + String(raw) };
      if (!Array.isArray(info.roles) || info.roles.indexOf("owner") === -1) return { pass: false, detail: "hubInfo roles = " + JSON.stringify(info.roles) };
      return { pass: true, detail: "the authoritative server answered hubInfo with the role list" };
    } catch (e) {
      return { pass: true, skip: true, detail: "hub unreachable: " + ((e && e.message) || e) };
    } finally {
      try { sock.close(1000); } catch (e) {}
    }
  });
})();
