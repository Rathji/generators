(function () {
  const T = window.SELFTEST;
  const H = window.CRM_HUB;
  const BS = window.BcrmStore;
  const EV = window.CRM_EVENTS;
  if (!T || !H || !BS || !EV) return;

  const OWNER = { name: "Owner One", pw: "owner-test-pass-1" };
  const VIEWER = { name: "Vera Viewer", pw: "viewer-test-pass-1" };
  const MANAGER = { name: "Mia Manager", pw: "manager-test-pass-1" };

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  async function until(fn, timeoutMs, stepMs) {
    const t0 = Date.now();
    const limit = timeoutMs || 5000;
    const step = stepMs || 200;
    for (;;) {
      const v = await fn();
      if (v) return v;
      if (Date.now() - t0 > limit) return null;
      await sleep(step);
    }
  }

  function openSocket(s) {
    return new Promise((resolve, reject) => {
      if (s.readyState === 1) { resolve(); return; }
      const to = setTimeout(() => reject(new Error("socket open timeout")), 5000);
      s.addEventListener("open", () => { clearTimeout(to); resolve(); });
      s.addEventListener("error", () => { clearTimeout(to); reject(new Error("socket error before open")); });
    });
  }

  async function rawSocket() {
    const s = window.root.createServerSocket();
    s.binaryType = "arraybuffer";
    await openSocket(s);
    return s;
  }

  async function rpc(s, name, data) {
    const raw = await s.rpc[name](data === undefined ? "" : JSON.stringify(data));
    return JSON.parse(String(raw));
  }

  function drop(s) { try { s.close(1000); } catch (e) {} }

  function waitMsg(s, pred, timeoutMs) {
    return new Promise(resolve => {
      const t0 = Date.now();
      const iv = setInterval(() => {
        if (Date.now() - t0 > (timeoutMs || 5000)) { cleanup(); resolve(null); }
      }, 200);
      function onMsg(e) {
        let m = null;
        try { m = JSON.parse(String(e.data)); } catch (err) {}
        if (m && pred(m)) { cleanup(); resolve(m); }
      }
      function cleanup() { clearInterval(iv); s.removeEventListener("message", onMsg); }
      s.addEventListener("message", onMsg);
    });
  }

  function mockEnv() {
    const kvStore = new Map();
    const files = new Map();
    const kv = {
      get: async k => kvStore.get(k),
      set: async (k, v) => { kvStore.set(k, v); },
      delete: async k => { kvStore.delete(k); }
    };
    const editable = {
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
          f.text = text;
          f.count = 1;
          return { error: null, editKey: f.key, editCount: 1, created: true, unchanged: false, superseded: false };
        }
        if (!o.editKey || o.editKey !== f.key) return { error: "invalid or missing edit key", created: false };
        if (f.text === text) return { error: null, editCount: f.count, created: false, unchanged: true, superseded: false };
        f.text = text;
        f.count++;
        return { error: null, editCount: f.count, created: false, unchanged: false, superseded: false };
      },
      files
    };
    const store = BS.create({
      ns: "h" + BS.randHex(6),
      kv,
      editable,
      modules: ["companies", "contacts", "leads", "deals", "activities", "emails", "segments", "rules", "bus", "reports"]
    });
    return { kv, kvStore, editable, store };
  }

  function content() { return { records: [], settings: { nextNumber: 1 } }; }

  async function guard() {
    if (!window.generatorIsUnsaved || !window.root || typeof window.root.createServerSocket !== "function") {
      return { skip: true, reason: "hub tests run against the unsaved-preview server emulator (they create a throwaway owner). On a saved generator the real hub is left untouched." };
    }
    const s = await rawSocket();
    try {
      const info = await rpc(s, "hubInfo");
      if (!info || !info.ok) return { skip: true, reason: "hubInfo failed." };
      if (info.setup) {
        const a = await rpc(s, "auth", { name: OWNER.name, password: OWNER.pw });
        if (!a.ok) return { skip: true, reason: "the hub owner is not the test owner — hub tests need owner access (reload the preview for a fresh emulator)." };
      }
      return { ok: true };
    } catch (e) {
      return { skip: true, reason: "hub unreachable: " + ((e && e.message) || e) };
    } finally {
      drop(s);
    }
  }

  async function ownerConn() {
    const s = await rawSocket();
    const info = await rpc(s, "hubInfo");
    if (!info.setup) {
      const r = await rpc(s, "setupOwner", { name: OWNER.name, password: OWNER.pw });
      if (!r.ok) throw new Error("setupOwner: " + JSON.stringify(r));
    } else {
      const a = await rpc(s, "auth", { name: OWNER.name, password: OWNER.pw });
      if (!a.ok) throw new Error("owner auth: " + JSON.stringify(a));
    }
    return s;
  }

  async function ensureMember(s, name, role, pw) {
    const r = await rpc(s, "memberAdd", { name, role, password: pw });
    if (r.ok) return r.id;
    if (r.code === "exists") {
      const t = await rpc(s, "team");
      const m = t.members.find(x => x.name === name);
      if (!m) throw new Error("member listed but not found: " + name);
      await rpc(s, "memberResetPw", { id: m.id, password: pw });
      await rpc(s, "memberRole", { id: m.id, role });
      return m.id;
    }
    throw new Error("memberAdd: " + JSON.stringify(r));
  }

  T.register("hub: owner setup, auth, duplicate-setup and bad-password handling", async () => {
    const g = await guard();
    if (g.skip) return { skip: true, detail: g.reason };
    const s = await rawSocket();
    try {
      const info = await rpc(s, "hubInfo");
      let me;
      if (!info.setup) {
        const r = await rpc(s, "setupOwner", { name: OWNER.name, password: OWNER.pw });
        if (!r.ok || r.me.role !== "owner") return { pass: false, detail: "setupOwner: " + JSON.stringify(r) };
        me = r.me;
        const dup = await rpc(s, "setupOwner", { name: "Sneaky", password: "sneaky-password-1" });
        if (!dup.ok && dup.code !== "exists") return { pass: false, detail: "dup setup: " + JSON.stringify(dup) };
      } else {
        const a = await rpc(s, "auth", { name: OWNER.name, password: OWNER.pw });
        if (!a.ok) return { pass: false, detail: "owner auth: " + JSON.stringify(a) };
        me = a.me;
      }
      const bad = await rpc(s, "auth", { name: OWNER.name, password: "wrong-password-1" });
      if (!bad.ok && bad.code !== "denied") return { pass: false, detail: "bad auth: " + JSON.stringify(bad) };
      if (me.role !== "owner") return { pass: false, detail: "me.role=" + me.role };
      return { pass: true, detail: "owner id " + me.id + (info.setup ? " (re-auth)" : " (fresh setup)") };
    } finally { drop(s); }
  });

  T.register("hub: repeated bad sign-ins are rate-limited", async () => {
    const g = await guard();
    if (g.skip) return { skip: true, detail: g.reason };
    const s = await rawSocket();
    try {
      let last = null;
      for (let i = 0; i < 8; i++) last = await rpc(s, "auth", { name: OWNER.name, password: "wrong-password-" + i });
      if (last.code !== "rate_limited") return { pass: false, detail: "expected rate_limited, got " + JSON.stringify(last) };
      return { pass: true, detail: "8th attempt blocked" };
    } finally { drop(s); }
  });

  T.register("hub: role gates — viewer read-only, manager writes, only owner manages the team", async () => {
    const g = await guard();
    if (g.skip) return { skip: true, detail: g.reason };
    const o = await ownerConn();
    try {
      await ensureMember(o, VIEWER.name, "viewer", VIEWER.pw);
      await ensureMember(o, MANAGER.name, "manager", MANAGER.pw);
    } finally { drop(o); }
    const v = await rawSocket();
    const m = await rawSocket();
    try {
      const av = await rpc(v, "auth", { name: VIEWER.name, password: VIEWER.pw });
      if (!av.ok) return { pass: false, detail: "viewer auth: " + JSON.stringify(av) };
      const rw = await rpc(v, "reportWrite", { module: "bus", rev: 3 });
      if (rw.ok || rw.code !== "forbidden") return { pass: false, detail: "viewer reportWrite: " + JSON.stringify(rw) };
      const ra = await rpc(v, "memberAdd", { name: "Nope", role: "manager", password: "nope-nope-nope-1" });
      if (ra.ok || ra.code !== "forbidden") return { pass: false, detail: "viewer memberAdd: " + JSON.stringify(ra) };
      const au = await rpc(v, "auditTail", 5);
      if (au.ok || au.code !== "forbidden") return { pass: false, detail: "viewer auditTail: " + JSON.stringify(au) };
      const tm = await rpc(v, "team");
      if (!tm.ok || !tm.members.some(x => x.name === VIEWER.name)) return { pass: false, detail: "viewer team: " + JSON.stringify(tm) };
      const am = await rpc(m, "auth", { name: MANAGER.name, password: MANAGER.pw });
      if (!am.ok) return { pass: false, detail: "manager auth: " + JSON.stringify(am) };
      const mg = await rpc(m, "reportWrite", { module: "bus", rev: 4 });
      if (!mg.ok) return { pass: false, detail: "manager reportWrite: " + JSON.stringify(mg) };
      const mgA = await rpc(m, "memberAdd", { name: "Nope2", role: "viewer", password: "nope2-nope2-1" });
      if (mgA.ok || mgA.code !== "forbidden") return { pass: false, detail: "manager memberAdd: " + JSON.stringify(mgA) };
      const mgT = await rpc(m, "auditTail", 3);
      if (!mgT.ok || !Array.isArray(mgT.audit)) return { pass: false, detail: "manager auditTail: " + JSON.stringify(mgT) };
      return { pass: true, detail: "viewer/manager boundaries hold" };
    } finally { drop(v); drop(m); }
  });

  T.register("hub: a reported write broadcasts to other sessions", async () => {
    const g = await guard();
    if (g.skip) return { skip: true, detail: g.reason };
    const o = await ownerConn();
    const l = await rawSocket();
    try {
      const info = await rpc(l, "hubInfo");
      if (!info.ok) return { pass: false, detail: "listener hubInfo failed" };
      const waitP = waitMsg(l, m => m.t === "chg" && m.module === "deals" && m.rev === 7);
      const r = await rpc(o, "reportWrite", { module: "deals", rev: 7 });
      if (!r.ok) return { pass: false, detail: "reportWrite: " + JSON.stringify(r) };
      const m = await waitP;
      if (!m) return { pass: false, detail: "listener never saw the chg broadcast" };
      if (!m.actorName) return { pass: false, detail: "chg missing actorName" };
      if (r.index.rev !== 7) return { pass: false, detail: "index rev not updated: " + JSON.stringify(r.index) };
      return { pass: true, detail: "deals rev 7 broadcast by " + m.actorName };
    } finally { drop(o); drop(l); }
  });

  T.register("hub: client reports its own local writes to the hub", async () => {
    const g = await guard();
    if (g.skip) return { skip: true, detail: g.reason };
    const o = await ownerConn();
    drop(o);
    const realStore = window.CRM.store;
    const env = mockEnv();
    const l = await rawSocket();
    try {
      await rpc(l, "hubInfo");
      H._setStore(env.store);
      const en = await H.enable({ name: OWNER.name, password: OWNER.pw, confirm: OWNER.pw });
      if (!en.ok || H.state !== "open" || !H.me || H.me.role !== "owner") return { pass: false, detail: "enable: " + JSON.stringify(en) + " state=" + H.state };
      const waitP = waitMsg(l, m => m.t === "chg" && m.module === "companies" && m.rev === 42);
      EV.fire("moduleWrite", { module: "companies", res: { ok: true, noop: false, revision: 42 }, changes: [], store: env.store });
      const m = await waitP;
      if (!m) return { pass: false, detail: "no broadcast followed the local write" };
      if (m.actorName !== OWNER.name) return { pass: false, detail: "unexpected actor " + m.actorName };
      return { pass: true, detail: "local write rev 42 broadcast as " + m.actorName };
    } finally {
      H._setStore(realStore);
      await H.disable(true);
      drop(l);
    }
  });

  T.register("hub: viewer sessions are read-only at the store", async () => {
    const g = await guard();
    if (g.skip) return { skip: true, detail: g.reason };
    const o = await ownerConn();
    try { await ensureMember(o, VIEWER.name, "viewer", VIEWER.pw); } finally { drop(o); }
    const realStore = window.CRM.store;
    const env = mockEnv();
    try {
      H._setStore(env.store);
      const en = await H.enable({ name: VIEWER.name, password: VIEWER.pw, confirm: VIEWER.pw });
      if (!en.ok) return { pass: false, detail: "enable viewer: " + JSON.stringify(en) };
      if (!H.me || H.me.role !== "viewer") return { pass: false, detail: "role=" + (H.me && H.me.role) };
      if (!document.body.classList.contains("role-viewer")) return { pass: false, detail: "role-viewer class missing" };
      const g1 = await env.store.saveChecked("companies", content());
      if (g1.ok || g1.code !== "read_only") return { pass: false, detail: "saveChecked not gated: " + JSON.stringify(g1) };
      const g2 = await env.store.saveDoc("companies", content());
      if (g2.ok || g2.code !== "read_only") return { pass: false, detail: "saveDoc not gated: " + JSON.stringify(g2) };
      await H.signout();
      const free1 = await env.store.saveDoc("companies", content());
      if (!free1.ok) return { pass: false, detail: "gate not removed after sign-out: " + JSON.stringify(free1) };
      if (document.body.classList.contains("role-viewer")) return { pass: false, detail: "role-viewer class lingered after sign-out" };
      return { pass: true, detail: "viewer writes blocked, writes allowed again after sign-out" };
    } finally {
      H._setStore(realStore);
      await H.disable(true);
      document.body.classList.remove("role-viewer");
      const pill = document.getElementById("hubRolePill");
      if (pill) pill.remove();
    }
  });

  T.register("hub: member management and the audit trail", async () => {
    const g = await guard();
    if (g.skip) return { skip: true, detail: g.reason };
    const o = await ownerConn();
    const v = await rawSocket();
    try {
      const name = "Temp Manager";
      const pw = "temp-manager-pass-1";
      let id;
      const r = await rpc(o, "memberAdd", { name, role: "manager", password: pw });
      if (r.ok) id = r.id;
      else if (r.code === "exists") {
        const t = await rpc(o, "team");
        const m = t.members.find(x => x.name === name);
        id = m.id;
        await rpc(o, "memberResetPw", { id, password: pw });
      } else return { pass: false, detail: "memberAdd: " + JSON.stringify(r) };
      const dup = await rpc(o, "memberAdd", { name, role: "viewer", password: pw });
      if (dup.ok || dup.code !== "exists") return { pass: false, detail: "duplicate add: " + JSON.stringify(dup) };
      const rr = await rpc(o, "memberRole", { id, role: "viewer" });
      if (!rr.ok) return { pass: false, detail: "memberRole: " + JSON.stringify(rr) };
      const a1 = await rpc(v, "auth", { name, password: pw });
      if (!a1.ok || a1.me.role !== "viewer") return { pass: false, detail: "auth after demotion: " + JSON.stringify(a1) };
      const t = await rpc(o, "team");
      const ownerId = t.members.find(x => x.role === "owner").id;
      const bad = await rpc(o, "memberRole", { id: ownerId, role: "viewer" });
      if (bad.ok || bad.code !== "owner_fixed") return { pass: false, detail: "owner demotion: " + JSON.stringify(bad) };
      const mm = t.members.find(x => x.name === name);
      if (!mm || mm.role !== "viewer") return { pass: false, detail: "team not updated" };
      const au = await rpc(o, "auditTail", 40);
      if (!au.audit.some(x => x.action === "role_changed")) return { pass: false, detail: "audit missing role_changed" };
      const times = au.audit.slice(0, 10).map(x => x.at);
      for (let i = 1; i < times.length; i++) if (times[i - 1] < times[i]) return { pass: false, detail: "audit is not newest-first" };
      const rm = await rpc(o, "memberRemove", { id });
      if (!rm.ok) return { pass: false, detail: "memberRemove: " + JSON.stringify(rm) };
      const rmSelf = await rpc(o, "memberRemove", { id: ownerId });
      if (rmSelf.ok || (rmSelf.code !== "owner_fixed" && rmSelf.code !== "self")) return { pass: false, detail: "owner self-remove: " + JSON.stringify(rmSelf) };
      const t2 = await rpc(o, "team");
      if (t2.members.some(x => x.name === name)) return { pass: false, detail: "member still present after removal" };
      return { pass: true, detail: "add → demote → audit → remove cycle ok" };
    } finally { drop(o); drop(v); }
  });

  T.register("hub: password reset invalidates the old password", async () => {
    const g = await guard();
    if (g.skip) return { skip: true, detail: g.reason };
    const o = await ownerConn();
    try {
      const id = await ensureMember(o, MANAGER.name, "manager", MANAGER.pw);
      const fresh = "manager-reset-pass-2";
      const rs = await rpc(o, "memberResetPw", { id, password: fresh });
      if (!rs.ok) return { pass: false, detail: "memberResetPw: " + JSON.stringify(rs) };
      const aNew = await rpc(o, "auth", { name: MANAGER.name, password: fresh });
      if (!aNew.ok || aNew.me.role !== "manager") return { pass: false, detail: "auth with new pw: " + JSON.stringify(aNew) };
      const aOld = await rpc(o, "auth", { name: MANAGER.name, password: MANAGER.pw });
      if (aOld.ok || aOld.code !== "denied") return { pass: false, detail: "old pw still works: " + JSON.stringify(aOld) };
      await rpc(o, "memberResetPw", { id, password: MANAGER.pw });
      return { pass: true, detail: "old password rejected after reset" };
    } finally { drop(o); }
  });

  T.register("hub: client teardown leaves the app disabled and clean", async () => {
    await H.disable(true);
    if (H.state !== "off") return { pass: false, detail: "state=" + H.state };
    if (H.cfg.enabled) return { pass: false, detail: "cfg still enabled" };
    if (H.me) return { pass: false, detail: "still signed in as " + H.me.name };
    if (document.body.classList.contains("role-viewer")) return { pass: false, detail: "role-viewer class lingered" };
    const pill = document.getElementById("hubRolePill");
    if (pill) return { pass: false, detail: "role pill lingered" };
    const bar = document.querySelector("[data-hubbar]");
    if (bar && !bar.hidden) return { pass: false, detail: "change bar lingered" };
    return { pass: true, detail: "hub client fully disabled" };
  });
})();
