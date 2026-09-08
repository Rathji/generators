window.CRM_HUB = (function () {
  const R = window.CRM_RECORDS;
  const el = R.el;
  const EV = window.CRM_EVENTS;
  const U = window.RECORDUI;
  const esc = R.esc;

  const CFG_KEY = "hub:cfg";
  const MODULES = ["companies", "contacts", "leads", "deals", "activities", "emails", "segments", "rules", "bus", "reports"];
  const WRITER_ROLES = { owner: 1, manager: 1 };
  const POLL_MS = 30000;
  const PAGE_PUSH_MS = 4000;

  let store = null;
  let socket = null;
  let state = "off";
  let me = null;
  let online = 0;
  let people = [];
  let cfg = { enabled: false, name: "" };
  let sessionPw = "";
  let backoff = 3000;
  let closedByUs = false;
  let permanentFail = false;
  let pollTimer = null;
  let tickTimer = null;
  let lastRouteSig = "";
  let viewDirty = false;
  let lastPagePush = 0;
  let lastPageLabel = "";
  const snapshots = new Map();
  let gateStore = null;
  let gateOrig = null;
  let bootStore = null;
  let booted = false;
  const changeBar = { el: null };

  const ERR_MAP = {
    exists: "That name is already a team member.",
    weak_pw: "Passwords must be 12-64 printable characters.",
    bad_name: "Use 1-20 letters, numbers, spaces, dots, dashes or apostrophes.",
    denied: "Name and password do not match a team member — or ask the hub owner to add you first.",
    rate_limited: "Too many sign-in attempts. Wait a minute, then try again.",
    forbidden: "Your role does not allow this action.",
    full: "The team is at its member limit.",
    owner_fixed: "The owner role is fixed at setup and cannot be changed or removed."
  };

  function errMsg(code) {
    return ERR_MAP[code] || (code === "no_hub" ? "This generator's live hub has not been set up yet." : "The live hub request failed — try again.");
  }

  function setState(s) {
    state = s;
    if (EV) EV.fire("hubState", snapshot());
  }

  function snapshot() {
    return { state, me: me ? { name: me.name, role: me.role } : null, online, role: me ? me.role : null };
  }

  function kv() {
    return (window.root && window.root.kv && window.root.kv.bcrm) || null;
  }

  async function loadCfg() {
    try {
      const k = kv();
      if (k) cfg = Object.assign({ enabled: false, name: "" }, await k.get(CFG_KEY) || {});
    } catch (e) { cfg = { enabled: false, name: "" }; }
    return cfg;
  }

  async function saveCfg() {
    try {
      const k = kv();
      if (k) await k.set(CFG_KEY, cfg);
    } catch (e) {}
  }

  function parseMsg(text) {
    try { return JSON.parse(text); } catch (e) { return null; }
  }

  async function jrpc(name, obj) {
    if (!socket) throw new Error("hub: no socket");
    const raw = await socket.rpc[name](obj === undefined ? "" : JSON.stringify(obj));
    return parseMsg(String(raw)) || { ok: false, code: "bad_reply", detail: "The hub returned an unreadable reply." };
  }

  function routeSig() {
    let h = (location.hash || "").replace(/^#/, "").replace(/^\//, "");
    const parts = h.split("/").filter(Boolean);
    return { module: (parts[0] || "dashboard").toLowerCase(), recordId: parts[1] ? decodeURIComponent(parts[1]) : null };
  }

  function pageLabel() {
    const sig = routeSig();
    const def = window.CRM && window.CRM.modules ? window.CRM.modules.get(sig.module) : null;
    return def ? def.label : (sig.module === "dashboard" ? "Dashboard" : sig.module);
  }

  function onOpen() {
    if (EV) EV.on("moduleWrite", onModuleWrite);
    document.addEventListener("input", markDirty, true);
    document.addEventListener("change", markDirty, true);
    tickTimer = setInterval(tick, 2000);
  }

  function markDirty(ev) {
    const t = ev && ev.target;
    const vr = document.getElementById("viewRoot");
    if (vr && t && vr.contains(t)) viewDirty = true;
  }

  function onModuleWrite(data) {
    if (!data || !bootStore || data.store !== bootStore) return;
    if (!cfg.enabled || state !== "open" || !me) return;
    if (!WRITER_ROLES[me.role]) return;
    if (!data.res || !data.res.ok || data.res.noop) return;
    const rev = data.res.revision;
    if (!rev) return;
    jrpc("reportWrite", { module: data.module, rev }).catch(() => {});
  }

  async function tick() {
    const sig = routeSig();
    const sigKey = sig.module + "/" + (sig.recordId || "");
    if (sigKey !== lastRouteSig) { lastRouteSig = sigKey; viewDirty = false; }
    if (cfg.enabled && me && (state === "open" || state === "needs_auth")) {
      const label = pageLabel();
      if (label && label !== lastPageLabel && Date.now() - lastPagePush > PAGE_PUSH_MS && state === "open") {
        lastPageLabel = label;
        lastPagePush = Date.now();
        jrpc("page", label).catch(() => {});
      }
    }
  }

  function connect() {
    if (socket || permanentFail) return;
    if (backoff > 3000) {
      setTimeout(() => { if (!socket && !permanentFail) openSocket(); }, backoff);
      return;
    }
    openSocket();
  }

  function openSocket() {
    if (!window.root || typeof window.root.createServerSocket !== "function") {
      setState("degraded");
      startPoller();
      return;
    }
    setState("connecting");
    try {
      const sock = window.root.createServerSocket();
      socket = sock;
      sock.binaryType = "arraybuffer";
      sock.addEventListener("open", () => onSocketOpen(sock));
      sock.addEventListener("message", e => onSocketMessage(sock, e));
      sock.addEventListener("close", e => onSocketClose(sock, e));
      sock.addEventListener("error", () => {});
    } catch (e) {
      socket = null;
      setState("degraded");
      startPoller();
    }
  }

  async function onSocketOpen(sock) {
    if (socket !== sock) return;
    try {
      const info = await jrpc("hubInfo");
      if (!info || !info.ok) throw new Error("hubInfo failed");
      if (cfg.name && sessionPw) {
        const a = await jrpc("auth", { name: cfg.name, password: sessionPw });
        if (a && a.ok) {
          me = a.me;
          lastPageLabel = "";
        } else if (a && (a.code === "rate_limited")) {
          setState("needs_auth");
          startPoller();
          return;
        } else {
          setState("needs_auth");
          startPoller();
          return;
        }
      } else if (cfg.name) {
        setState("needs_auth");
        startPoller();
        return;
      }
      if (socket !== sock) return;
      me = me || null;
      setState("open");
      applyRoleUi();
      lastPageLabel = "";
      startPoller(false);
      refreshCurrentModule();
    } catch (e) {
      if (socket !== sock) return;
      socket = null;
      setState("degraded");
      startPoller();
      scheduleReconnect();
    }
  }

  function onSocketMessage(sock, e) {
    if (socket !== sock) return;
    const m = parseMsg(String(e.data));
    if (!m) return;
    if (m.t === "pres") {
      people = Array.isArray(m.people) ? m.people : [];
      online = m.online || people.length;
      if (me && me.id) {
        const myRow = people.find(p => p.id === me.id);
        if (myRow && myRow.role !== me.role) {
          const oldRole = me.role;
          me.role = myRow.role;
          applyRoleUi();
          if (window.CRM && CRM.toast) CRM.toast("Your hub role changed from " + oldRole + " to " + me.role + ".");
        }
      }
      if (EV) EV.fire("hubPresence", { online, people });
    } else if (m.t === "chg") {
      if (me && m.actorId === me.id) return;
      handleRemoteChange(m);
    }
  }

  function onSocketClose(sock, e) {
    if (socket !== sock) return;
    const code = e && e.code;
    socket = null;
    people = [];
    online = 0;
    if (EV) EV.fire("hubPresence", { online: 0, people: [] });
    if (closedByUs || code === 4403) {
      if (code === 4403) permanentFail = true;
      me = null;
      setState("off");
      applyRoleUi();
      return;
    }
    me = null;
    setState("degraded");
    applyRoleUi();
    startPoller();
    scheduleReconnect();
  }

  function scheduleReconnect() {
    if (permanentFail) return;
    const delay = backoff;
    backoff = Math.min(30000, backoff * 2);
    setTimeout(() => {
      if (!socket && !permanentFail && cfg.enabled) openSocket();
    }, delay);
  }

  function startPoller(want) {
    const should = want === undefined ? true : want;
    if (should && !pollTimer) {
      pollTimer = setInterval(pollCurrent, POLL_MS);
    } else if (!should && pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  async function pollCurrent() {
    if (state === "open" && me) return;
    try {
      const sig = routeSig();
      const doc = await store.loadDoc(sig.module, { refresh: true });
      const changed = doc && doc.ok ? diffChanged(doc.content, sig.module) : [];
      if (changed.length) {
        if (EV) EV.fire("hubChange", { module: sig.module, changedIds: changed, via: "poll", rev: doc.revision });
        if (!viewDirty && (!sig.recordId || changed.indexOf(sig.recordId) !== -1)) {
          if (window.CRM && CRM.rerender) CRM.rerender();
          if (window.CRM && CRM.toast) CRM.toast(cfg.name + " · live updates paused — refreshed from the server.");
        }
      }
    } catch (e) {}
  }

  function contentRecords(content) {
    return (content && Array.isArray(content.records)) ? content.records : [];
  }

  function idsOf(content) {
    return contentRecords(content).map(r => r && r.id).filter(Boolean);
  }

  function diffChanged(content, module) {
    const prev = snapshots.get(module);
    const nowTxt = JSON.stringify(idsOf(content));
    if (prev === undefined) { snapshots.set(module, nowTxt); return []; }
    const prevArr = JSON.parse(prev);
    const nowArr = idsOf(content);
    if (prevArr.length === nowArr.length && prevArr.every((v, i) => v === nowArr[i])) return [];
    snapshots.set(module, nowTxt);
    const oldSet = new Set(prevArr);
    const changed = nowArr.filter(id => !oldSet.has(id));
    return changed.length ? changed : nowArr.slice(0, 20);
  }

  async function refreshCurrentModule() {
    if (!store) return;
    try {
      const sig = routeSig();
      await store.loadDoc(sig.module, { refresh: true });
    } catch (e) {}
  }

  function recordOf(content, id) {
    const recs = contentRecords(content);
    for (let i = 0; i < recs.length; i++) if (recs[i] && recs[i].id === id) return recs[i];
    return null;
  }

  async function handleRemoteChange(m) {
    if (!store) return;
    const sig = routeSig();
    const watchRec = (sig.module === m.module && sig.recordId) ? sig.recordId : null;
    let preIdsTxt = "";
    let preRec = null;
    try {
      const pre = await store.loadDoc(m.module);
      preIdsTxt = JSON.stringify(idsOf(pre.content));
      if (watchRec) preRec = JSON.stringify(recordOf(pre.content, watchRec));
    } catch (e) {}
    snapshots.set(m.module, preIdsTxt);
    let added = [];
    let recChanged = false;
    try {
      const doc = await store.loadDoc(m.module, { refresh: true });
      const nowIds = idsOf(doc.content);
      const oldSet = new Set(preIdsTxt ? JSON.parse(preIdsTxt) : []);
      added = nowIds.filter(id => !oldSet.has(id));
      snapshots.set(m.module, JSON.stringify(nowIds));
      if (watchRec) {
        const nowTxt = JSON.stringify(recordOf(doc.content, watchRec));
        if (nowTxt !== preRec) recChanged = true;
      }
    } catch (e) {}
    if (EV) EV.fire("hubChange", { module: m.module, rev: m.rev, at: m.at, actorId: m.actorId, actorName: m.actorName, changedIds: added });
    const actor = m.actorName ? " by " + m.actorName : "";
    if (sig.module !== m.module) return;
    const onRec = !!(watchRec && (added.indexOf(watchRec) !== -1 || recChanged));
    if (onRec) {
      if (viewDirty) showChangeBar(m.module, actor);
      else toastAndRerender("This record was updated" + actor + " — showing the latest.");
    } else if (!sig.recordId) {
      if (viewDirty) {
        if (window.CRM && CRM.toast) CRM.toast("New changes in " + m.module + actor + ".");
      } else {
        toastAndRerender(m.module + " changed" + actor + " — refreshed.");
      }
    }
  }

  function toastAndRerender(msg) {
    if (window.CRM && CRM.toast) CRM.toast(msg);
    if (window.CRM && CRM.rerender) CRM.rerender();
  }

  function showChangeBar(module, actor) {
    if (!document.body) return;
    if (!changeBar.el) {
      const bar = document.createElement("div");
      bar.className = "hub-bar";
      bar.setAttribute("data-hubbar", "1");
      const txt = document.createElement("span");
      txt.className = "hub-bar-txt";
      const reload = document.createElement("button");
      reload.className = "btn btn-primary btn-sm";
      reload.textContent = "Reload record";
      const keep = document.createElement("button");
      keep.className = "btn btn-ghost btn-sm";
      keep.textContent = "Keep editing";
      bar.appendChild(txt);
      bar.appendChild(reload);
      bar.appendChild(keep);
      reload.addEventListener("click", () => { dismissBar(); if (window.CRM && CRM.rerender) CRM.rerender(); });
      keep.addEventListener("click", () => dismissBar());
      document.body.appendChild(bar);
      changeBar.el = bar;
    }
    changeBar.el.querySelector(".hub-bar-txt").textContent = "This " + module + " record was changed elsewhere" + actor + ". Reload to see the latest, or keep editing — saving will check for conflicts first.";
    changeBar.el.hidden = false;
  }

  function dismissBar() {
    if (changeBar.el) changeBar.el.hidden = true;
  }

  function applyRoleUi() {
    const role = me ? me.role : null;
    document.body.classList.toggle("role-viewer", role === "viewer");
    if (role === "viewer") applyWriteGate();
    else removeWriteGate();
    syncRolePill();
    if (EV) EV.fire("hubState", snapshot());
  }

  function syncRolePill() {
    let pill = document.getElementById("hubRolePill");
    if (me) {
      if (!pill) {
        pill = document.createElement("span");
        pill.id = "hubRolePill";
        const tb = document.querySelector(".topbar .topbar-spacer");
        if (!tb) return;
        tb.insertAdjacentElement("afterend", pill);
      }
      pill.className = "env-pill hub-role-pill " + (me.role === "viewer" ? "viewer" : "writer");
      pill.textContent = me.role + " · " + me.name;
      pill.title = "Signed in to the live hub as " + me.name + " (" + me.role + ").";
    } else if (pill) {
      pill.remove();
    }
  }

  function viewerResult() {
    return { ok: false, code: "read_only", detail: "Your role is read-only — ask an owner or manager to make this change." };
  }

  function applyWriteGate() {
    if (!store || gateStore === store) return;
    if (!store.saveDoc && !store.saveChecked) return;
    gateStore = store;
    gateOrig = { saveDoc: store.saveDoc, saveChecked: store.saveChecked };
    if (gateOrig.saveDoc) {
      store.saveDoc = function () { return Promise.resolve(viewerResult()); };
    }
    if (gateOrig.saveChecked) {
      store.saveChecked = function () { return Promise.resolve(viewerResult()); };
    }
  }

  function removeWriteGate() {
    if (gateStore && gateOrig) {
      if (gateOrig.saveDoc) gateStore.saveDoc = gateOrig.saveDoc;
      if (gateOrig.saveChecked) gateStore.saveChecked = gateOrig.saveChecked;
    }
    gateStore = null;
    gateOrig = null;
  }

  async function enable(opts) {
    opts = opts || {};
    const name = String(opts.name || "").trim();
    const password = String(opts.password || "");
    const confirm = String(opts.confirm === undefined ? "" : opts.confirm);
    if (!name) return { ok: false, code: "bad_name", detail: "Enter your name." };
    if (password.length < 12) return { ok: false, code: "weak_pw", detail: errMsg("weak_pw") };
    if (closedByUs) closedByUs = false;
    permanentFail = false;
    backoff = 3000;
    if (socket) { try { socket.close(1000); } catch (e) {} socket = null; }
    cfg.enabled = true;
    cfg.name = name;
    await saveCfg();
    sessionPw = password;
    openSocket();
    try {
      const info = await waitHubInfo();
      if (!info.setup) {
        if (confirm !== password) {
          await disable(true);
          return { ok: false, code: "mismatch", detail: "The two passwords do not match — this is the first sign-in, so your password creates the hub." };
        }
        const r = await jrpc("setupOwner", { name, password });
        if (!r.ok) { await disable(true); return { ok: false, code: r.code, detail: errMsg(r.code) || r.detail }; }
        me = r.me;
      } else {
        const a = await jrpc("auth", { name, password });
        if (!a.ok) { await disable(true); return { ok: false, code: a.code, detail: errMsg(a.code) || a.detail }; }
        me = a.me;
      }
      cfg.name = me.name;
      await saveCfg();
      applyRoleUi();
      setState("open");
      startPoller(false);
      lastPageLabel = "";
      return { ok: true, me };
    } catch (e) {
      await disable(true);
      return { ok: false, code: "connect_failed", detail: "Could not reach the live hub — try again in a moment." };
    }
  }

  function waitHubInfo() {
    return new Promise((resolve, reject) => {
      let tries = 0;
      const iv = setInterval(async () => {
        tries++;
        if (tries > 20) { clearInterval(iv); reject(new Error("timeout")); return; }
        if (state !== "open" && state !== "needs_auth") return;
        if (!socket) return;
        try {
          const info = await jrpc("hubInfo");
          clearInterval(iv);
          resolve(info);
        } catch (e) {}
      }, 150);
    });
  }

  async function signIn(password) {
    if (!cfg.name) return { ok: false, code: "no_name", detail: "Enter your member name first." };
    const pw = String(password || "");
    if (pw.length < 12) return { ok: false, code: "weak_pw", detail: errMsg("weak_pw") };
    if (!socket || state === "off") {
      sessionPw = pw;
      openSocket();
      const ok = await waitForAuth();
      return ok;
    }
    sessionPw = pw;
    const a = await jrpc("auth", { name: cfg.name, password: pw });
    if (!a.ok) return { ok: false, code: a.code, detail: errMsg(a.code) || a.detail };
    me = a.me;
    applyRoleUi();
    setState("open");
    startPoller(false);
    return { ok: true, me };
  }

  function waitForAuth() {
    return new Promise((resolve) => {
      let tries = 0;
      const iv = setInterval(() => {
        tries++;
        if (me) { clearInterval(iv); resolve({ ok: true, me }); return; }
        if (tries > 30) { clearInterval(iv); resolve({ ok: false, code: "timeout", detail: "Sign-in timed out — try again." }); }
      }, 150);
    });
  }

  async function signout() {
    try { if (socket && state === "open") await jrpc("signout"); } catch (e) {}
    me = null;
    sessionPw = "";
    applyRoleUi();
    setState("open");
  }

  async function disable(silent) {
    closedByUs = true;
    cfg.enabled = false;
    cfg.name = "";
    await saveCfg();
    sessionPw = "";
    me = null;
    if (socket) { try { socket.close(1000); } catch (e) {} }
    socket = null;
    people = [];
    online = 0;
    removeWriteGate();
    document.body.classList.remove("role-viewer");
    const pill = document.getElementById("hubRolePill");
    if (pill) pill.remove();
    dismissBar();
    startPoller(false);
    setState("off");
  }

  async function memberAdd(name, role, password) {
    return jrpc("memberAdd", { name, role, password });
  }
  async function memberRemove(id) { return jrpc("memberRemove", { id }); }
  async function memberRole(id, role) { return jrpc("memberRole", { id, role }); }
  async function memberResetPw(id, password) { return jrpc("memberResetPw", { id, password }); }
  async function team() { return jrpc("team"); }
  async function auditTail(n) { return jrpc("auditTail", n || 20); }

  async function boot(s) {
    bootStore = s;
    store = s;
    if (booted) return;
    booted = true;
    onOpen();
    await loadCfg();
    if (cfg.enabled && cfg.name) {
      connect();
    } else {
      setState("off");
    }
  }

  const PASSWORD_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%^&*-_=+?";

  function genPassword() {
    let s = "";
    if (window.crypto && crypto.getRandomValues) {
      const b = new Uint8Array(14);
      crypto.getRandomValues(b);
      for (let i = 0; i < b.length; i++) s += PASSWORD_CHARS[b[i] % PASSWORD_CHARS.length];
    } else {
      for (let i = 0; i < 14; i++) s += PASSWORD_CHARS[Math.floor(Math.random() * PASSWORD_CHARS.length)];
    }
    return s;
  }

  async function card(ctx) {
    const cardEl = el("section", "card hub-card");
    const head = el("div", "card-title-row");
    head.appendChild(el("h2", null, "Team & live hub"));
    const chip = el("span", "chip", "…");
    chip.setAttribute("data-hub-chip", "1");
    head.appendChild(chip);
    cardEl.appendChild(head);
    cardEl.appendChild(el("p", "hint", "The live hub keeps everyone who opens this CRM in the same loop: writes broadcast within seconds, the team list shows who is online (and on which page), owners and managers run the team, and when the hub is unreachable the CRM falls back to silent polling. The hub is optional — everything works without it."));
    const body = el("div");
    body.setAttribute("data-hub-body", "1");
    cardEl.appendChild(body);
    updateChip(chip);
    renderCardBody(body);
    const onState = () => { updateChip(chip); renderCardBody(body); };
    const onPres = () => { const p = body.querySelector("[data-hub-presence]"); if (p) renderPresenceBox(p); };
    EV.on("hubState", onState);
    EV.on("hubPresence", onPres);
    cardEl.addEventListener("DOMNodeRemoved", () => { EV.off("hubState", onState); EV.off("hubPresence", onPres); });
    return cardEl;
  }

  function updateChip(chip) {
    const map = { off: ["chip", "Disabled"], connecting: ["chip pending", "Connecting…"], open: ["chip ok", "Live"], needs_auth: ["chip pending", "Sign-in needed"], degraded: ["chip fail", "Offline · polling"] };
    const m = map[state] || map.off;
    if (!chip) return;
    chip.className = m[0];
    chip.textContent = m[1];
  }

  async function renderCardBody(body) {
    body.innerHTML = "";
    const cfgNow = cfg;
    if (!cfgNow.enabled) {
      body.appendChild(buildDisabled(body));
      return;
    }
    if (state === "needs_auth" || (state === "open" && !me)) {
      body.appendChild(buildNeedsAuth(body));
      return;
    }
    if (state === "connecting") {
      body.appendChild(el("p", "hint", "Connecting to the live hub…"));
      return;
    }
    if (!me) {
      body.appendChild(buildNeedsAuth(body));
      return;
    }
    body.appendChild(buildStatusRow(body));
    const presence = el("div");
    presence.setAttribute("data-hub-presence", "1");
    body.appendChild(presence);
    renderPresenceBox(presence);
    if (me.role === "viewer") {
      body.appendChild(U.banner("warn", "You are signed in as a viewer — the CRM is read-only for you. Owners and managers make the changes."));
    }
    const team = el("div");
    team.setAttribute("data-hub-team", "1");
    body.appendChild(team);
    renderTeamBox(team);
    if (me.role === "owner" || me.role === "manager") {
      const act = el("div");
      act.setAttribute("data-hub-act", "1");
      body.appendChild(act);
      renderActivityBox(act);
    }
  }

  function buildDisabled(body) {
    const wrap = el("div");
    const intro = el("p", "hint", "Sign in as a team member to switch the hub on. The first person to sign in creates the hub and becomes its owner — they then add the rest of the team from this card. Your password is never stored by the CRM; it only ever travels to the hub to prove who you are.");
    wrap.appendChild(intro);
    const form = el("form", "frm");
    form.setAttribute("novalidate", "");
    const nRow = el("div", "fld full");
    const nLab = document.createElement("label");
    nLab.htmlFor = "hub-name";
    nLab.textContent = "Your name";
    nRow.appendChild(nLab);
    const nIn = document.createElement("input");
    nIn.id = "hub-name";
    nIn.className = "inp";
    nIn.type = "text";
    nIn.autocomplete = "off";
    nIn.maxLength = 20;
    nIn.placeholder = "e.g. Dana";
    nRow.appendChild(nIn);
    form.appendChild(nRow);
    const pRow = el("div", "fld full");
    const pLab = document.createElement("label");
    pLab.htmlFor = "hub-pw";
    pLab.textContent = "Password";
    pRow.appendChild(pLab);
    const pIn = document.createElement("input");
    pIn.id = "hub-pw";
    pIn.className = "inp";
    pIn.type = "password";
    pIn.autocomplete = "new-password";
    pIn.placeholder = "12+ characters";
    pRow.appendChild(pIn);
    pRow.appendChild(el("p", "hint", "If this CRM's hub already exists, this password signs you in. If it does not exist yet, this password creates it — so keep it long, and confirm it below."));
    form.appendChild(pRow);
    const cRow = el("div", "fld full");
    const cLab = document.createElement("label");
    cLab.htmlFor = "hub-pw2";
    cLab.textContent = "Confirm password (only needed the first time)";
    cRow.appendChild(cLab);
    const cIn = document.createElement("input");
    cIn.id = "hub-pw2";
    cIn.className = "inp";
    cIn.type = "password";
    cIn.autocomplete = "new-password";
    cRow.appendChild(cIn);
    form.appendChild(cRow);
    const genB = document.createElement("button");
    genB.type = "button";
    genB.className = "btn btn-ghost btn-sm";
    genB.textContent = "Suggest a strong password";
    genB.addEventListener("click", () => { pIn.value = genPassword(); cIn.value = pIn.value; });
    form.appendChild(genB);
    const msg = el("p", "hint");
    msg.setAttribute("data-hub-msg", "1");
    form.appendChild(msg);
    const foot = el("div", "frm-foot full");
    const sb = document.createElement("button");
    sb.type = "submit";
    sb.className = "btn btn-primary";
    sb.textContent = "Sign in / set up hub";
    foot.appendChild(sb);
    form.appendChild(foot);
    form.addEventListener("submit", async ev => {
      ev.preventDefault();
      sb.disabled = true;
      sb.textContent = "Connecting…";
      msg.textContent = "";
      msg.classList.remove("err");
      const res = await enable({ name: nIn.value, password: pIn.value, confirm: cIn.value });
      sb.disabled = false;
      if (!res.ok) {
        sb.textContent = "Sign in / set up hub";
        msg.textContent = res.detail || errMsg(res.code);
        msg.classList.add("err");
        return;
      }
      window.CRM.toast("Signed in to the live hub as " + res.me.name + " (" + res.me.role + ").");
      renderCardBody(body);
    });
    wrap.appendChild(form);
    return wrap;
  }

  function buildNeedsAuth(body) {
    const wrap = el("div");
    wrap.appendChild(el("p", "hint", "You are signed out of the live hub (the CRM remembers your name but never your password). Enter your password to rejoin."));
    const form = el("form", "frm");
    form.setAttribute("novalidate", "");
    const pRow = el("div", "fld full");
    const pLab = document.createElement("label");
    pLab.htmlFor = "hub-rejoin-pw";
    pLab.textContent = "Password for " + (cfg.name || "your member");
    pRow.appendChild(pLab);
    const pIn = document.createElement("input");
    pIn.id = "hub-rejoin-pw";
    pIn.className = "inp";
    pIn.type = "password";
    pIn.autocomplete = "current-password";
    pRow.appendChild(pIn);
    const msg = el("p", "hint");
    msg.setAttribute("data-hub-msg", "1");
    pRow.appendChild(msg);
    form.appendChild(pRow);
    const foot = el("div", "frm-foot full");
    const sb = document.createElement("button");
    sb.className = "btn btn-primary";
    sb.textContent = "Sign in";
    const dis = document.createElement("button");
    dis.type = "button";
    dis.className = "btn btn-ghost";
    dis.textContent = "Disable hub";
    dis.addEventListener("click", async () => { await disable(); renderCardBody(body); });
    foot.appendChild(sb);
    foot.appendChild(dis);
    form.appendChild(foot);
    form.addEventListener("submit", async ev => {
      ev.preventDefault();
      sb.disabled = true;
      const res = await signIn(pIn.value);
      sb.disabled = false;
      if (!res.ok) { msg.textContent = res.detail || errMsg(res.code); msg.classList.add("err"); return; }
      window.CRM.toast("Signed in to the live hub as " + res.me.name + " (" + res.me.role + ").");
      renderCardBody(body);
    });
    wrap.appendChild(form);
    return wrap;
  }

  function buildStatusRow(body) {
    const row = el("div", "hub-status");
    row.appendChild(el("span", "chip " + (me.role === "owner" ? "ok" : me.role === "manager" ? "pending" : ""), me.role));
    row.appendChild(el("strong", null, me.name));
    const can = me.role === "owner" ? "You own this hub — change roles, reset passwords, remove members."
      : me.role === "manager" ? "You can edit records and read the audit log."
        : "Read-only — ask an owner or manager to make changes.";
    row.appendChild(el("span", "hint", can));
    const sig = el("button", "btn btn-ghost btn-sm");
    sig.type = "button";
    sig.textContent = "Sign out";
    sig.addEventListener("click", async () => { await signout(); renderCardBody(body); });
    const dis = el("button", "btn btn-ghost btn-sm");
    dis.type = "button";
    dis.textContent = "Disable hub";
    dis.addEventListener("click", async () => { await disable(); renderCardBody(body); });
    row.appendChild(sig);
    row.appendChild(dis);
    return row;
  }

  function renderPresenceBox(box) {
    box.innerHTML = "";
    box.appendChild(el("p", "hint", "Online now: " + online + (online === 1 ? " person" : " people") + (me ? " (you)" : "") + ". Presence updates live as people move between pages."));
    const list = el("div", "rel-list");
    const rows = people.slice().sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    if (!rows.length) list.appendChild(el("p", "hint", "No one else is connected right now."));
    rows.forEach(p => {
      const row = el("div", "hub-row");
      const dot = el("span", "hub-live-dot on");
      row.appendChild(dot);
      row.appendChild(el("span", "chip " + (p.role === "owner" ? "ok" : p.role === "manager" ? "pending" : ""), p.role));
      const nm = el("span", null, esc(p.name));
      if (me && p.name === me.name) nm.textContent += " (you)";
      row.appendChild(nm);
      if (p.page) row.appendChild(el("span", "hint", "viewing " + esc(p.page)));
      list.appendChild(row);
    });
    box.appendChild(list);
  }

  async function renderTeamBox(box) {
    box.innerHTML = "";
    const head = el("div", "card-title-row");
    head.appendChild(el("h3", null, "Team"));
    box.appendChild(head);
    const t = await team().catch(() => null);
    if (!t || !t.ok) { box.appendChild(el("p", "hint", "The team list is unavailable right now.")); return; }
    const list = el("div", "rel-list");
    t.members.forEach(m => {
      const row = el("div", "hub-row");
      row.appendChild(el("span", "chip " + (m.role === "owner" ? "ok" : m.role === "manager" ? "pending" : ""), m.role));
      row.appendChild(el("span", null, esc(m.name)));
      if (me.role === "owner" && m.role !== "owner") {
        const sel = document.createElement("select");
        sel.className = "inp hub-role-sel";
        sel.innerHTML = '<option value="manager">manager</option><option value="viewer">viewer</option>';
        sel.value = m.role;
        sel.addEventListener("change", async () => { const r = await memberRole(m.id, sel.value); if (!r.ok) window.CRM.toast(r.detail || errMsg(r.code)); else { window.CRM.toast(m.name + " is now a " + sel.value + "."); renderTeamBox(box); } });
        row.appendChild(sel);
        const rp = document.createElement("button");
        rp.type = "button";
        rp.className = "btn btn-ghost btn-sm";
        rp.textContent = "Reset password";
        rp.addEventListener("click", async () => {
          const pw = window.prompt ? window.prompt("New password for " + m.name + " (12+ characters)") : null;
          if (!pw) return;
          const r = await memberResetPw(m.id, pw);
          window.CRM.toast(r.ok ? "Password reset for " + m.name + "." : (r.detail || errMsg(r.code)));
        });
        row.appendChild(rp);
        const rm = document.createElement("button");
        rm.type = "button";
        rm.className = "btn btn-ghost btn-sm hub-danger";
        rm.textContent = "Remove";
        rm.addEventListener("click", async () => {
          if (!window.confirm("Remove " + m.name + " from the team?")) return;
          const r = await memberRemove(m.id);
          if (!r.ok) { window.CRM.toast(r.detail || errMsg(r.code)); return; }
          window.CRM.toast(m.name + " removed from the team.");
          renderTeamBox(box);
        });
        row.appendChild(rm);
      }
      list.appendChild(row);
    });
    box.appendChild(list);
    if (me.role === "owner") {
      const form = el("form", "frm hub-add");
      form.setAttribute("novalidate", "");
      const nIn = document.createElement("input");
      nIn.className = "inp";
      nIn.type = "text";
      nIn.maxLength = 20;
      nIn.placeholder = "New member name";
      const roleSel = document.createElement("select");
      roleSel.className = "inp";
      roleSel.innerHTML = '<option value="manager">manager</option><option value="viewer">viewer</option>';
      const pIn = document.createElement("input");
      pIn.className = "inp";
      pIn.type = "text";
      pIn.placeholder = "One-time password (12+ chars)";
      const msg = el("p", "hint");
      msg.setAttribute("data-hub-msg", "1");
      const add = document.createElement("button");
      add.type = "submit";
      add.className = "btn btn-primary btn-sm";
      add.textContent = "Add member";
      form.appendChild(nIn);
      form.appendChild(roleSel);
      form.appendChild(pIn);
      form.appendChild(add);
      form.appendChild(msg);
      form.addEventListener("submit", async ev => {
        ev.preventDefault();
        const r = await memberAdd(nIn.value.trim(), roleSel.value, pIn.value);
        msg.textContent = "";
        if (!r.ok) { msg.textContent = r.detail || errMsg(r.code); msg.classList.add("err"); return; }
        msg.classList.remove("err");
        window.CRM.toast(nIn.value.trim() + " added as " + roleSel.value + ".");
        nIn.value = ""; pIn.value = "";
        renderTeamBox(box);
      });
      box.appendChild(form);
    }
  }

  async function renderActivityBox(box) {
    box.innerHTML = "";
    const head = el("div", "card-title-row");
    head.appendChild(el("h3", null, "Recent activity"));
    box.appendChild(head);
    const t = await auditTail(12).catch(() => null);
    if (!t || !t.ok) { box.appendChild(el("p", "hint", "The audit log is unavailable right now.")); return; }
    const list = el("div", "rel-list");
    if (!t.audit.length) list.appendChild(el("p", "hint", "No activity recorded yet."));
    t.audit.forEach(a => {
      const row = el("div", "hub-row");
      const when = a.at ? new Date(a.at * 1000).toLocaleString() : "—";
      row.appendChild(el("span", "chip", a.action));
      row.appendChild(el("span", null, esc(a.actorName || "—")));
      if (a.target) row.appendChild(el("span", "hint", esc(a.target)));
      if (a.detail) row.appendChild(el("span", "hint", esc(a.detail)));
      row.appendChild(el("span", "mono", when));
      list.appendChild(row);
    });
    box.appendChild(list);
  }

  function setTestEnv(s) {
    store = s;
    bootStore = s;
  }

  window.CRM_BOOT_HOOKS = window.CRM_BOOT_HOOKS || [];
  window.CRM_BOOT_HOOKS.push(s => { boot(s); });

  return {
    get state() { return state; },
    get me() { return me; },
    get cfg() { return cfg; },
    get online() { return online; },
    get people() { return people; },
    card,
    enable,
    signIn,
    signout,
    disable,
    memberAdd,
    memberRemove,
    memberRole,
    memberResetPw,
    team,
    auditTail,
    genPassword,
    _setStore: setTestEnv,
    _pokeRoleUi: applyRoleUi,
    _snapshots: snapshots,
    _errMsg: errMsg,
    _viewerResult: viewerResult
  };
})();
