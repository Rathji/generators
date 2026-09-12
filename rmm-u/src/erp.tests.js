/* ============================================================
   RMM-U — Task 1 validation tests (console shell & navigation)
   Run via page_eval:  await window.RMMShellTest()
   Returns { passed, failed, results:[{name, ok, detail}] }.
   Tests cover: registration of all 13 console stations, nav
   rendering + grouping, the hash router, role-aware visibility +
   route guard, consistent loading/empty/error states, responsive
   drawer behaviour, and the module framework API.
   ============================================================ */

(function () {
  "use strict";

  const results = [];
  function check(name, ok, detail) {
    results.push({ name, ok: !!ok, detail: detail || "" });
  }

  window.RMMShellTest = async function (opts) {
    opts = opts || {};
    results.length = 0;
    const ERP = window.ERP;
    const $ = (s) => document.querySelector(s);
    const $$ = (s) => Array.from(document.querySelectorAll(s));
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    const STATIONS = ["dashboard", "devices", "groups", "policies", "monitors", "alerts", "automations", "patches", "software", "security", "reports", "integrations", "admin"];

    try {
      /* ── 0. Boot state ── */
      ERP.role = "owner";
      await sleep(350);
      check("boot: nav rendered all 13 stations", $$(".erp-nav-link").length === 13, "got " + $$(".erp-nav-link").length);
      check("boot: initial route is a real station", $(".erp-content").getAttribute("data-module") !== "");

      /* ── 1. Station registration ── */
      check("all 13 stations registered", STATIONS.every((x) => ERP.getModule(x)), "missing: " + STATIONS.filter((x) => !ERP.getModule(x)).join(","));
      check("stations carry label/icon/group/roles", STATIONS.every((x) => {
        const m = ERP.getModule(x);
        return m && m.label && m.icon && (m.group === null || typeof m.group === "string") && Array.isArray(m.roles);
      }));
      check("nav shows 13 station links", $$(".erp-nav-link").length === 13, "got " + $$(".erp-nav-link").length);
      check("nav grouped into labelled sections", $$(".erp-nav-group").length >= 6 && $$(".erp-nav-group-label").length === 5, "groups " + $$(".erp-nav-group").length + " labels " + $$(".erp-nav-group-label").length);
      const sections = ["endpoints", "monitoring", "deploy", "insight", "system"];
      check("station groups are the RMM sections", sections.every((g) => ERP.modules.some((m) => m.group === g && !m.hidden)));

      /* ── 2. Router renders every station ── */
      for (const id of STATIONS) {
        await ERP.navigate(id);
        const el = $(".erp-content");
        check("navigate -> " + id, el && el.getAttribute("data-module") === id && $("#pageTitle").textContent === ERP.getModule(id).label);
        const hasController = typeof ERP.getModule(id).render === "function";
        if (hasController) {
          check(id + " renders its controller without an error state", el && !el.querySelector(".erp-state[data-state='error']"));
        } else {
          check(id + " shows its phase empty-state", el && el.querySelector(".erp-state[data-state='empty']") && el.querySelector(".erp-state[data-state='empty'] .erp-phase-note"));
        }
      }

      /* ── 3. Role-aware visibility + route guard ── */
      const roleId = "tmp_role_" + Math.floor(Math.random() * 1e6);
      ERP.registerModule({ id: roleId, label: "Restricted", group: "system", icon: "admin", roles: ["owner", "manager"], render(ctx) { ctx.el.innerHTML = '<div class="restricted-station"></div>'; } });
      ERP.role = "staff";
      await sleep(60);
      check("staff cannot access a restricted station", !ERP.canAccess(roleId));
      check("staff nav hides the restricted station", $$(".erp-nav-link[data-module-link='" + roleId + "']").length === 0);
      await ERP.navigate(roleId);
      check("route guard redirects staff off restricted station", $(".erp-content").getAttribute("data-module") !== roleId);
      ERP.role = "manager";
      await ERP.navigate(roleId);
      check("manager renders the restricted station", $(".erp-content").getAttribute("data-module") === roleId && $(".erp-content").querySelector(".restricted-station"));
      ERP.role = "owner";
      check("owner can access every visible station", STATIONS.every((m) => ERP.canAccess(m)));
      ERP.modules.splice(ERP.modules.indexOf(ERP.getModule(roleId)), 1);
      await ERP.navigate("dashboard");

      /* ── 4. Consistent states ── */
      const probe = document.createElement("main");
      probe.className = "erp-content";
      document.body.appendChild(probe);
      ERP.states.loading(probe, "Testing");
      check("loading state markup", probe.querySelector("[data-state='loading']") && probe.querySelector(".spinner"));
      ERP.states.empty(probe, { icon: "devices", title: "Empty here", message: "Nothing yet", phase: "Phase 4 · Task 18" });
      check("empty state markup", probe.querySelector("[data-state='empty']") && probe.querySelector(".erp-phase-note"));
      ERP.states.error(probe, { title: "Boom", message: "It failed", retry: { label: "Retry", onClick: () => {} } });
      check("error state markup", probe.querySelector("[data-state='error']") && probe.querySelector("[data-error-retry]"));
      probe.remove();
      await ERP.navigate("does-not-exist");
      check("unknown route -> error state", $(".erp-content").querySelector("[data-state='error']") && $(".erp-content").querySelector("[data-error-retry]"));
      await ERP.navigate("dashboard");

      /* ── 5. Responsive drawer ── */
      const sb = $("#sidebar");
      const hb = $("#hamburgerBtn");
      const isDesktop = window.innerWidth >= 1024;
      check("hamburger present", !!hb);
      if (isDesktop) {
        check("desktop: sidebar visible", sb.getBoundingClientRect().width > 200);
        check("desktop: hamburger hidden", getComputedStyle(hb).display === "none");
      } else {
        check("mobile: hamburger visible", getComputedStyle(hb).display !== "none");
        hb.click();
        await sleep(300);
        check("mobile: drawer opens", sb.classList.contains("open") && !$("#overlay").hidden);
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        await sleep(300);
        check("mobile: Escape closes drawer", !sb.classList.contains("open"));
      }

      /* ── 6. Module framework API ── */
      const testId = "tmp_station_" + Math.floor(Math.random() * 1e6);
      const sentinel = "sentinel-" + Math.floor(Math.random() * 1e6);
      ERP.registerModule({ id: testId, label: "Test Station", group: "system", icon: "devices", roles: [], render(ctx) { ctx.el.innerHTML = '<div class="' + sentinel + '"></div>'; } });
      await ERP.navigate(testId);
      check("registerModule + render hook", $(".erp-content").querySelector("." + sentinel));
      await ERP.navigate("dashboard");
      const before = ERP.modules.length;
      let threw = false;
      try { ERP.registerModule({ id: testId, label: "Dup" }); } catch (e) { threw = true; }
      check("duplicate station id rejected", threw);
      ERP.modules.splice(ERP.modules.indexOf(ERP.getModule(testId)), 1);
      check("unregister via registry splice", ERP.modules.length === before - 1);
      await ERP.navigate("dashboard");
    } catch (e) {
      check("test harness did not crash", false, (e && e.stack) || String(e));
    }

    const passed = results.filter((r) => r.ok).length;
    const failed = results.length - passed;
    return { passed, failed, results };
  };

  /* ============================================================
     Task 2 validation tests — tenancy & data storage
     Run via page_eval:  await window.RMMTenancyTest()
     Covers: the config-driven rmm namespace, the versioned provider
     aggregate document + its summary registry, the full tenancy CRUD
     surface (providers + sites / device groups / devices / policies /
     monitor definitions / alerts / script library / automation rules),
     the locally cached edit key and fast local cache, cross-device
     survival via the canonical editable copy, compare-and-set conflict
     protection, archive/remove recovery, aggregate stats and the
     idempotent first-run demo seed. Runs against a stub backend so the
     real canonical documents are never touched.
     ============================================================ */

  window.RMMTenancyTest = async function (opts) {
    opts = opts || {};
    results.length = 0;
    const ERP = window.ERP;
    const store = ERP.store;
    const T = ERP.tenancy;
    const uid = Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    function makeServer() {
      const files = {};
      return {
        files,
        async get(name) { return Object.prototype.hasOwnProperty.call(files, name) ? files[name] : null; },
        async set(name, json) {
          const prev = files[name];
          const created = prev === undefined;
          files[name] = json;
          return { created, unchanged: prev === json, editKey: "k_" + name, superseded: false, error: null };
        },
      };
    }

    if (!T) { check("tenancy: ERP.tenancy exposed", false); return { passed: 0, failed: 1, results }; }

    try {
      /* ── 1. Surface + namespace ── */
      check("tenancy: ERP.tenancy exposed", typeof T.create === "function" && typeof T.update === "function" && typeof T.get === "function");
      check("tenancy: store namespace is config-driven 'rmm'", store.namespace === "rmm", "got " + store.namespace);
      check("tenancy: provider doc name is rmm-v1-provider-<id>", T.providerDocName("abc") === "rmm-v1-provider-abc", T.providerDocName("abc"));
      check("tenancy: registry doc name is rmm-v1-providers", T.registryDocName() === "rmm-v1-providers", T.registryDocName());
      check("tenancy: logical doc name drops the store prefix", T.providerLogicalName("abc") === "provider-abc", T.providerLogicalName("abc"));
      const pd = store.docConfig("providers");
      check("tenancy: 'providers' registry module is declared non-year-split", !!pd && pd.name === "providers" && pd.splitByYear === false, JSON.stringify(pd));
      check("tenancy: record-collection contract is complete", T.COLLECTIONS.length === 8 && ["sites", "deviceGroups", "devices", "policies", "monitorDefinitions", "alerts", "scriptLibrary", "automationRules"].every((c) => T.COLLECTIONS.indexOf(c) !== -1), JSON.stringify(T.COLLECTIONS));
      check("tenancy: object-collection contract is complete", T.OBJECT_COLLECTIONS.length === 5 && T.OBJECT_COLLECTIONS.indexOf("patchState") !== -1 && T.OBJECT_COLLECTIONS.indexOf("softwareState") !== -1 && T.OBJECT_COLLECTIONS.indexOf("securityState") !== -1 && T.OBJECT_COLLECTIONS.indexOf("remoteState") !== -1 && T.OBJECT_COLLECTIONS.indexOf("integrationsState") !== -1, JSON.stringify(T.OBJECT_COLLECTIONS));

      const srv = makeServer();
      store.useBackend(srv);
      store.resetAllLocal();
      T.reload();

      /* ── 2. Create a tenant ── */
      const created = await T.create({ name: "Tenant " + uid, legalName: "Tenant Ltd", tags: ["gold"] });
      check("tenancy: create returns a provider with a prefixed id", !created.error && !!created.provider && /^prov-/.test(created.provider.id), JSON.stringify(created && created.error));
      check("tenancy: create commits at revision 1", created.rev === 1, "rev=" + created.rev);
      const id = created.provider.id;
      const docName = T.providerDocName(id);
      check("tenancy: create reports the canonical file as newly created", created.created === true, JSON.stringify({ created: created.created }));
      const canon = JSON.parse(srv.files[docName] || "null");
      check("tenancy: canonical file is a versioned rmm document", !!canon && canon.schema === "rmm-doc" && canon.schemaVersion === 1 && canon.doc === "provider-" + id, JSON.stringify(canon && { schema: canon.schema, doc: canon.doc }));
      check("tenancy: canonical file carries the provider aggregate", !!canon && canon.records && canon.records.length === 1 && canon.records[0].id === id);
      check("tenancy: new provider validates against the schema", T.validate(created.provider).valid, JSON.stringify(T.validate(created.provider).errors));
      check("tenancy: provider aggregate has every collection", T.COLLECTIONS.every((c) => Array.isArray(created.provider[c])) && T.OBJECT_COLLECTIONS.every((c) => created.provider[c] && typeof created.provider[c] === "object" && !Array.isArray(created.provider[c])));
      check("tenancy: edit key is cached locally", !!localStorage.getItem("rmm.store.v1.keys." + docName), "key=" + localStorage.getItem("rmm.store.v1.keys." + docName));
      check("tenancy: document is cached locally", !!localStorage.getItem("rmm.store.v1.cache." + docName));

      /* ── 3. Registry + stats ── */
      let list = await T.list({ force: true });
      const rec = list.find((x) => x.id === id);
      check("tenancy: tenant appears in the registry", !!rec && rec.name === created.provider.name, JSON.stringify(list.map((x) => x.id)));
      check("tenancy: registry record carries summary counts", !!rec && typeof rec.siteCount === "number" && typeof rec.groupCount === "number" && typeof rec.deviceCount === "number", JSON.stringify(rec));
      const st0 = await T.stats();
      check("tenancy: stats count this tenant and its bytes", st0.providers >= 1 && st0.bytes > 0, JSON.stringify(st0));

      /* ── 4. Fast local cache (offline read) ── */
      store.useBackend({ async get() { return null; }, async set() { return { error: "offline" }; } });
      const offline = await T.get(id);
      check("tenancy: offline read is served from the local cache", !offline.error && offline.source === "cache" && offline.provider.id === id, JSON.stringify({ source: offline.source, error: offline.error }));
      store.useBackend(srv);

      /* ── 5. Cross-device survival ── */
      store.resetAllLocal();
      T.reload();
      const fresh = await T.get(id);
      check("tenancy: fresh device re-reads the tenant from canonical", !fresh.error && fresh.provider.id === id && fresh.source === "canonical", JSON.stringify({ source: fresh.source, error: fresh.error }));
      check("tenancy: fresh device adopts the canonical revision", fresh.rev === 1, "rev=" + fresh.rev);

      /* ── 6. Update a tenant ── */
      const upd = await T.update(id, (p) => { p.name = "Renamed " + uid; p.contact.email = "ops@example.com"; });
      check("tenancy: update increments the revision", !upd.error && upd.rev === 2, JSON.stringify({ rev: upd.rev, error: upd.error }));
      check("tenancy: update persists to canonical", JSON.parse(srv.files[docName]).records[0].name === "Renamed " + uid);
      list = await T.list({ force: true });
      check("tenancy: registry follows a rename", (list.find((x) => x.id === id) || {}).name === "Renamed " + uid);

      /* ── 7. Collection helpers ── */
      const addSite = await T.addItem(id, "sites", { name: "HQ", timezone: "UTC" });
      const siteId = addSite.item && addSite.item.id;
      check("tenancy: addItem appends to a collection", !addSite.error && /^site-/.test(siteId), JSON.stringify({ error: addSite.error, id: siteId }));
      const addGroup = await T.addItem(id, "deviceGroups", { name: "Servers", kind: "static", siteId });
      check("tenancy: addItem prefixes the id per collection", !addGroup.error && /^grp-/.test(addGroup.item.id), JSON.stringify(addGroup.item && addGroup.item.id));
      list = await T.list({ force: true });
      check("tenancy: registry summary reflects new sites & groups", (list.find((x) => x.id === id) || {}).siteCount === 1 && (list.find((x) => x.id === id) || {}).groupCount === 1, JSON.stringify(list.find((x) => x.id === id)));
      await T.updateItem(id, "sites", siteId, { name: "Head Office" });
      const gotSite = await T.item(id, "sites", siteId);
      check("tenancy: updateItem patches a record", !gotSite.error && gotSite.item.name === "Head Office", JSON.stringify(gotSite.error || gotSite.item));
      await T.removeItem(id, "sites", siteId);
      const goneSite = await T.item(id, "sites", siteId);
      check("tenancy: removeItem deletes a record", goneSite.error === "not_found", JSON.stringify(goneSite));
      const badCol = await T.addItem(id, "nonsense", { name: "x" });
      check("tenancy: unknown collections are rejected", badCol.error === "unknown_collection", JSON.stringify(badCol));
      const badItem = await T.updateItem(id, "devices", "does-not-exist", { name: "x" });
      check("tenancy: patching a missing record reports not_found", badItem.error === "not_found", JSON.stringify(badItem));

      /* ── 8. Archive / restore / remove ── */
      await T.archive(id);
      check("tenancy: archive flips the status", (await T.get(id)).provider.status === "archived");
      await T.restore(id);
      check("tenancy: restore reactivates the tenant", (await T.get(id)).provider.status === "active");
      const rem = await T.remove(id);
      list = await T.list({ force: true });
      check("tenancy: remove drops the tenant from the registry", rem.removed === id && !list.some((x) => x.id === id), JSON.stringify(rem));
      const afterRemove = JSON.parse(srv.files[docName]).records[0];
      check("tenancy: removed tenant document is retained (archived)", afterRemove.status === "archived" && afterRemove.id === id);

      /* ── 9. Change notification ── */
      let events = [];
      const off = T.onChange((type) => events.push(type));
      await T.create({ name: "Notified " + uid });
      off();
      check("tenancy: onChange notifies on create/update", events.indexOf("create") !== -1, JSON.stringify(events));

      /* ── 10. Conflict protection (compare-and-set) ── */
      const c2 = await T.create({ name: "Conflict " + uid });
      const id2 = c2.provider.id;
      const doc2 = T.providerDocName(id2);
      await T.get(id2);      // warm the cache-read throttle so no background adopt races the write
      await sleep(40);
      const behind = JSON.parse(srv.files[doc2]);
      behind.rev = (behind.rev || 0) + 1;
      behind.records[0].name = "Changed elsewhere";
      srv.files[doc2] = JSON.stringify(behind);
      const conflict = await T.update(id2, (p) => { p.name = "Local edit"; });
      check("tenancy: concurrent edit is refused as a conflict", conflict.error === "conflict" && conflict.conflict === true, JSON.stringify({ error: conflict.error }));
      check("tenancy: conflicted local work is never discarded", (await T.get(id2)).provider.name === "Local edit");
      const kept = await store.resolveConflict(doc2, "keep_mine");
      check("tenancy: keep-mine resolves and commits the local edit", kept.applied === true && !(kept.result && kept.result.error), JSON.stringify(kept.result && kept.result.error));
      check("tenancy: canonical now holds the kept version", JSON.parse(srv.files[doc2]).records[0].name === "Local edit");

      /* ── 11. First-run demo seed (idempotent) ── */
      const seeded1 = await T.seed();
      check("tenancy: seed is a no-op when the registry is populated", seeded1.skipped === true && seeded1.reason === "registry_not_empty", JSON.stringify(seeded1));
      await store.saveDoc("providers", []);
      T.reload();
      const seeded2 = await T.seed();
      check("tenancy: seed creates the demo tenant on first run", !seeded2.error && !!seeded2.created && seeded2.created.length === 1, JSON.stringify(seeded2));
      T.reload();
      const demo = (await T.list({ force: true })).find((x) => x.id === (seeded2.created || [])[0]);
      check("tenancy: seeded tenant is marked demo and carries a site", !!demo && demo.demo === true && demo.siteCount >= 1, JSON.stringify(demo));
      const seeded3 = await T.seed();
      check("tenancy: seed is idempotent", seeded3.skipped === true, JSON.stringify(seeded3));

      /* ── 12. Storage hygiene ── */
      check("tenancy: every canonical file lives in the rmm-v1 namespace", Object.keys(srv.files).every((n) => n.indexOf("rmm-v1-") === 0), JSON.stringify(Object.keys(srv.files)));
    } catch (e) {
      check("tenancy: test harness did not crash", false, (e && e.stack) || String(e));
    } finally {
      try { store.useBackend(null); } catch (e) {}
      try { store.resetAllLocal(); } catch (e) {}
      try { T.reload(); } catch (e) {}
    }

    const passed = results.filter((r) => r.ok).length;
    const failed = results.length - passed;
    return { passed, failed, results };
  };

  /* ============================================================
     Task 3 validation tests — device hierarchy & inventory record
     Run via page_eval:  await window.RMMDevicesTest()
     Covers: the provider → site → device-group → device hierarchy,
     the rich device inventory record (identity, OS, hardware, disks,
     network, users, tags, warranty/support, agent & last-seen,
     documentation link), filtering, the tree/ancestry projections,
     stats, derived attributes & liveness, group/site membership,
     agent check-in, validation, and the idempotent demo-fleet seed.
     Runs against a stub backend so real documents stay untouched.
     ============================================================ */

  window.RMMDevicesTest = async function (opts) {
    opts = opts || {};
    results.length = 0;
    const ERP = window.ERP;
    const store = ERP.store;
    const T = ERP.tenancy;
    const D = ERP.devices;
    const uid = Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
    const GiB = 1024 * 1024 * 1024;
    const ago = (mins) => new Date(Date.now() - mins * 60000).toISOString();

    function makeServer() {
      const files = {};
      return {
        files,
        async get(name) { return Object.prototype.hasOwnProperty.call(files, name) ? files[name] : null; },
        async set(name, json) {
          const prev = files[name];
          const created = prev === undefined;
          files[name] = json;
          return { created, unchanged: prev === json, editKey: "k_" + name, superseded: false, error: null };
        },
      };
    }

    if (!D) { check("devices: ERP.devices exposed", false); return { passed: 0, failed: 1, results }; }

    try {
      check("devices: ERP.devices exposed", typeof D.add === "function" && typeof D.update === "function" && typeof D.tree === "function");
      check("devices: taxonomy constants are complete", D.STATUSES.length === 6 && D.ROLES.indexOf("server") !== -1 && D.FORM_FACTORS.indexOf("rack") !== -1 && D.OS_FAMILIES.indexOf("Windows") !== -1 && D.OS_FAMILIES.indexOf("Linux") !== -1 && D.OS_FAMILIES.indexOf("macOS") !== -1, JSON.stringify({ s: D.STATUSES.length, r: D.ROLES.length }));

      /* ── newDevice normalisation ── */
      const full = D.newDevice({
        hostname: "TMP-01", role: "server", status: "online", os: { name: "Windows Server 2022", version: "21H2" },
        cpu: { model: "Xeon", cores: 8 }, ramBytes: 16 * GiB, tags: ["a", "b"],
        disks: [{ label: "C:", sizeBytes: 100 * GiB, freeBytes: 40 * GiB, kind: "nvme" }],
        interfaces: [{ name: "eth0", mac: "AA:BB:CC:DD:EE:01", ip4: ["10.0.0.5"] }],
        documentation: { refId: "cfg-1" },
      });
      check("devices: newDevice fills every schema field", D.deviceFields().every((k) => k in full), "missing: " + D.deviceFields().filter((k) => !(k in full)).join(","));
      check("devices: newDevice derives the OS family", full.os.family === "Windows", full.os.family);
      check("devices: newDevice normalises sub-records (mac lower-cased)", full.interfaces[0].mac === "aa:bb:cc:dd:ee:01" && full.disks[0].kind === "nvme");
      check("devices: a well-formed device validates", D.validateDevice(full).valid, JSON.stringify(D.validateDevice(full).errors));
      const bad = Object.assign(D.newDevice({ hostname: "X" }), { hostname: "", status: "bogus", role: "nope", lastSeenAt: "not-a-date" });
      const badV = D.validateDevice(bad);
      check("devices: validateDevice rejects the malformed", !badV.valid && badV.errors.length >= 3, JSON.stringify(badV.errors));

      /* ── fixture tenant ── */
      const srv = makeServer();
      store.useBackend(srv);
      store.resetAllLocal();
      T.reload();
      const prov = await T.create({ name: "Devices " + uid });
      const pid = prov.provider.id;
      const siteHq = (await T.addItem(pid, "sites", { name: "HQ" })).item;
      const siteBr = (await T.addItem(pid, "sites", { name: "Branch" })).item;
      const grpSrv = (await T.addItem(pid, "deviceGroups", { name: "Servers", kind: "static", siteId: siteHq.id })).item;
      const grpWs = (await T.addItem(pid, "deviceGroups", { name: "All Windows", kind: "static", siteId: null })).item;

      /* ── add devices ── */
      const d1 = await D.add(pid, {
        hostname: "SRV-01", displayName: "Primary server", role: "server", siteId: siteHq.id, groupIds: [grpSrv.id],
        status: "online", lastSeenAt: ago(1), tags: ["server", "gold"], serial: "SN-123", manufacturer: "Dell", model: "PowerEdge R650",
        domain: "ad.example", domainRole: "member", os: { name: "Windows Server 2022", version: "21H2" },
        cpu: { model: "Xeon Silver", cores: 8, threads: 16, speedMhz: 2400 }, ramBytes: 32 * GiB,
        disks: [{ label: "C:", kind: "nvme", sizeBytes: 500 * GiB, freeBytes: 100 * GiB, filesystem: "NTFS" },
                { label: "D:", kind: "ssd", sizeBytes: 1000 * GiB, freeBytes: 400 * GiB, filesystem: "NTFS" }],
        interfaces: [{ name: "eth0", mac: "AA:BB:CC:DD:EE:01", ip4: ["10.0.0.5"], gateway: "10.0.0.1", speedMbps: 1000 }],
        agentVersion: "1.0.0", documentation: { refId: "cfg-srv-01" },
      });
      check("devices: add creates a dev- record owned by the provider", !d1.error && /^dev-/.test(d1.device.id) && d1.device.providerId === pid, JSON.stringify(d1.error || d1.device.id));
      check("devices: add persists into the provider aggregate", (await T.get(pid)).provider.devices.length === 1);
      const d2 = await D.add(pid, { hostname: "WS-02", role: "workstation", siteId: siteBr.id, groupIds: [grpWs.id], status: "offline", lastSeenAt: ago(60 * 48), os: { name: "Windows 11 Pro", version: "23H2" }, cpu: { model: "Core i5" }, ramBytes: 16 * GiB, interfaces: [{ name: "eth0", mac: "AA:BB:CC:DD:EE:02", ip4: ["10.1.0.5"] }] });
      const d3 = await D.add(pid, { hostname: "LNX-03", role: "server", siteId: null, status: "stale", lastSeenAt: ago(45), os: { name: "Ubuntu 22.04", version: "22.04" }, ramBytes: 8 * GiB, interfaces: [{ name: "ens3", mac: "AA:BB:CC:DD:EE:03", ip4: ["192.168.1.9"] }] });
      check("devices: three devices are stored", !d2.error && !d3.error && (await T.get(pid)).provider.devices.length === 3);
      check("devices: unknown site is rejected", (await D.add(pid, { hostname: "X", siteId: "site-nope" })).error === "unknown_site");
      const dirty = await D.add(pid, { hostname: "CLEAN-04", groupIds: ["grp-nope", grpSrv.id] });
      check("devices: unknown group ids are stripped on add", dirty.device.groupIds.length === 1 && dirty.device.groupIds[0] === grpSrv.id, JSON.stringify(dirty.device.groupIds));

      /* ── get + registry ── */
      const got = await D.get(pid, d1.device.id);
      check("devices: get returns the device and its provider", !got.error && got.device.hostname === "SRV-01" && got.provider.id === pid);
      check("devices: get reports not_found for a stranger", (await D.get(pid, "dev-nope")).error === "not_found");
      const regRec = (await T.list({ force: true })).find((p) => p.id === pid);
      check("devices: the registry device count follows the fleet", regRec.deviceCount === 4, JSON.stringify(regRec));

      /* ── filtering ── */
      const list = (f) => D.list(pid, f);
      check("devices: filter by site", (await list({ siteId: siteHq.id })).length === 1, "HQ should have SRV-01");
      check("devices: filter by group", (await list({ groupId: grpWs.id })).length === 1 && (await list({ groupId: grpWs.id }))[0].hostname === "WS-02");
      check("devices: filter by role", (await list({ role: "server" })).length === 2);
      check("devices: filter by os family", (await list({ osFamily: "Linux" })).length === 1 && (await list({ osFamily: "Windows" })).length === 2);
      check("devices: filter by tag", (await list({ tag: "GOLD" })).length === 1);
      check("devices: search matches serial", (await list({ search: "SN-123" })).length === 1);
      check("devices: search matches an IP", (await list({ search: "10.0.0.5" })).length === 1);
      const all = await D.listAll({});
      check("devices: listAll spans the tenant", all.length === 4, "got " + all.length);

      /* ── derived attributes ── */
      const g1 = got.device;
      check("devices: primary IP/MAC derive from interfaces", D.primaryIp(g1) === "10.0.0.5" && D.primaryMac(g1) === "aa:bb:cc:dd:ee:01");
      check("devices: allIps / allMacs collect every interface", D.allIps(g1).length === 1 && D.allMacs(g1).length === 1);
      check("devices: disk totals derive from the disk list", D.totalDiskBytes(g1) === 1500 * GiB && D.freeDiskBytes(g1) === 500 * GiB && D.diskUsedPct(g1) === 67, JSON.stringify({ t: D.totalDiskBytes(g1), u: D.diskUsedPct(g1) }));
      check("devices: ram/bytes format human-readably", D.ramHuman(g1) === "32.0 GiB" && D.bytesHuman(1500 * GiB) === "1.5 TiB", D.ramHuman(g1));

      /* ── liveness ── */
      check("devices: liveness — recent check-in is online", D.liveness(g1) === "online");
      check("devices: liveness — 45 min without a check-in is stale", D.liveness(d3.device) === "stale");
      check("devices: liveness — 2 days without a check-in is offline", D.liveness(d2.device) === "offline");
      check("devices: maintenance/retired override liveness", D.liveness({ status: "maintenance", lastSeenAt: ago(600) }) === "maintenance" && D.liveness({ status: "retired" }) === "retired");

      /* ── tree + ancestry + stats ── */
      const tree = await D.tree(pid);
      const hq = tree.sites.find((s) => s.site.id === siteHq.id);
      const br = tree.sites.find((s) => s.site.id === siteBr.id);
      check("devices: tree groups devices under their site", hq.count === 1 && hq.groups.length === 1 && hq.groups[0].group.id === grpSrv.id && hq.groups[0].devices.length === 1);
      check("devices: tree keeps site groups scoped to the site", br.groups.length === 0 && br.ungrouped.length === 1);
      check("devices: tree carries provider-wide groups separately", tree.providerGroups.length === 1 && tree.providerGroups[0].devices.length === 1);
      check("devices: tree collects unassigned devices", tree.unassigned.length === 2 && tree.deviceCount === 4, "unassigned=" + tree.unassigned.length);
      const anc = await D.ancestry(pid, g1.id);
      check("devices: ancestry resolves provider + site + groups", anc.provider.id === pid && anc.site.id === siteHq.id && anc.groups.length === 1 && anc.groups[0].id === grpSrv.id);
      const st = await D.stats(pid);
      check("devices: stats bucket by status/role/os", st.total === 4 && st.online === 1 && st.offline === 1 && st.stale === 1 && st.unknown === 1 && st.byRole.server === 2, JSON.stringify(st.byStatus));
      const fs = await D.fleetStats();
      check("devices: fleet stats aggregate across tenants", fs.total === 4 && fs.byProvider[pid] && fs.byProvider[pid].total === 4, JSON.stringify(fs.byProvider));

      /* ── update ── */
      const upd = await D.update(pid, g1.id, { displayName: "Renamed server", ramBytes: 64 * GiB, os: { version: "23H2" } });
      check("devices: update patches fields and keeps identity", !upd.error && upd.device.id === g1.id && upd.device.createdAt === g1.createdAt && upd.device.displayName === "Renamed server");
      check("devices: update deep-merges sub-objects (OS name kept, version changed)", upd.device.os.name === "Windows Server 2022" && upd.device.os.version === "23H2", JSON.stringify(upd.device.os));
      check("devices: update keeps group membership", upd.device.groupIds.length === 1 && upd.device.groupIds[0] === grpSrv.id);
      check("devices: update rejects an unknown site", (await D.update(pid, g1.id, { siteId: "site-nope" })).error === "unknown_site");

      /* ── group + site membership ── */
      const asg = await D.assignGroup(pid, d2.device.id, grpSrv.id);
      check("devices: assignGroup adds membership", !asg.error && asg.device.groupIds.indexOf(grpSrv.id) !== -1);
      check("devices: assignGroup is idempotent", (await D.assignGroup(pid, d2.device.id, grpSrv.id)).noop === true);
      check("devices: assignGroup rejects an unknown group", (await D.assignGroup(pid, d2.device.id, "grp-nope")).error === "unknown_group");
      const un = await D.unassignGroup(pid, d2.device.id, grpSrv.id);
      check("devices: unassignGroup removes membership", !un.error && un.device.groupIds.indexOf(grpSrv.id) === -1);
      const ss = await D.setSite(pid, d3.device.id, siteHq.id);
      check("devices: setSite moves a device into a site", !ss.error && ss.device.siteId === siteHq.id);
      const sc = await D.setSite(pid, d3.device.id, null);
      check("devices: setSite null unassigns", !sc.error && sc.device.siteId === null);
      check("devices: forSite / forGroup projections work", (await D.forSite(pid, siteBr.id)).length === 1 && (await D.forGroup(pid, grpWs.id)).length === 1);

      /* ── agent check-in ── */
      const seen = await D.markSeen(pid, d2.device.id, { agentVersion: "1.2.0" });
      check("devices: markSeen stamps last-seen and marks online", !seen.error && seen.device.status === "online" && !!seen.device.lastSeenAt && seen.device.agentVersion === "1.2.0");
      check("devices: markSeen records first-seen/enrolment once", !!seen.device.firstSeenAt && !!seen.device.enrolledAt && seen.device.agent.version === "1.2.0");
      const seen2 = await D.markSeen(pid, d2.device.id, {});
      check("devices: re-check-in keeps the original first-seen", seen2.device.firstSeenAt === seen.device.firstSeenAt);

      /* ── removal ── */
      const rm = await D.remove(pid, dirty.device.id);
      check("devices: remove deletes the record", !rm.error && (await D.get(pid, dirty.device.id)).error === "not_found");
      check("devices: the registry count drops after removal", (await T.list({ force: true })).find((p) => p.id === pid).deviceCount === 3);

      /* ── change notification ── */
      let events = [];
      const off = D.onChange((type) => events.push(type));
      await D.add(pid, { hostname: "EVT-05" });
      off();
      check("devices: onChange emits add/update/remove", events.indexOf("add") !== -1, JSON.stringify(events));

      /* ── demo fleet seed ── */
      const demo = await T.create({
        name: "Demo " + uid, demo: true,
        sites: [{ id: "site-demo-hq", name: "Head Office" }, { id: "site-demo-branch", name: "Branch Office" }],
        deviceGroups: [{ id: "grp-demo-servers", name: "Servers", kind: "static", siteId: "site-demo-hq" }, { id: "grp-demo-workstations", name: "Workstations", kind: "static", siteId: null }],
      });
      const seeded = await D.seedDemo();
      check("devices: seedDemo populates the demo tenant", !seeded.error && seeded.created && seeded.created.length === 6, JSON.stringify(seeded));
      check("devices: seeded fleet reads back", (await T.get(demo.provider.id)).provider.devices.length === 6);
      check("devices: seed is idempotent", (await D.seedDemo()).skipped === true);

      /* ── hygiene ── */
      check("devices: every canonical file stays in the rmm-v1 namespace", Object.keys(srv.files).every((n) => n.indexOf("rmm-v1-") === 0), JSON.stringify(Object.keys(srv.files)));
    } catch (e) {
      check("devices: test harness did not crash", false, (e && e.stack) || String(e));
    } finally {
      try { store.useBackend(null); } catch (e) {}
      try { store.resetAllLocal(); } catch (e) {}
      try { T.reload(); } catch (e) {}
    }

    const passed = results.filter((r) => r.ok).length;
    const failed = results.length - passed;
    return { passed, failed, results };
  };

  /* ============================================================
     Task 4 validation tests — master configuration
     Run via page_eval:  await window.RMMMasterConfigTest()
     Covers the 11-section catalogue (severity levels, monitor
     types, notification channels, schedules, business-hours
     calendars, maintenance windows, patch classifications,
     software / tag / group / script taxonomies), the schema-driven
     normalise/validate pipeline, CRUD + reorder + single-default
     enforcement, the system defaults, every lookup and resolver
     later phases read (severity / monitor-type / channel /
     schedule / calendar lookups, business-hours and maintenance
     window resolution, the tag vocabulary), the attributed change
     history, persistence to the canonical rmm-v1-config document,
     and the editable/read-only Admin console render.
     Runs against a stub backend so real documents stay untouched.
     ============================================================ */

  window.RMMMasterConfigTest = async function (opts) {
    opts = opts || {};
    results.length = 0;
    const ERP = window.ERP;
    const store = ERP.store;
    const M = ERP.masterConfig;
    const uid = Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);

    function makeServer() {
      const files = {};
      return {
        files,
        async get(name) { return Object.prototype.hasOwnProperty.call(files, name) ? files[name] : null; },
        async set(name, json) {
          const prev = files[name];
          const created = prev === undefined;
          files[name] = json;
          return { created, unchanged: prev === json, editKey: "k_" + name, superseded: false, error: null };
        },
      };
    }

    if (!M) { check("master: ERP.masterConfig exposed", false); return { passed: 0, failed: 1, results }; }

    const SECTIONS = ["severities", "monitorTypes", "channels", "schedules", "calendars", "maintenanceWindows", "patchClassifications", "softwareCategories", "tagTaxonomy", "groupTaxonomy", "scriptCategories"];

    try {
      /* ── exposure & catalogue ── */
      check("master: ERP.masterConfig exposed", typeof M.add === "function" && typeof M.update === "function" && typeof M.all === "function" && typeof M.current === "function" && typeof M.render === "function");
      check("master: 11 sections declared", M.SECTIONS.length === 11 && SECTIONS.every((s) => M.SECTION_DEFS[s]), JSON.stringify(M.SECTIONS));
      check("master: every section is fully described", SECTIONS.every((s) => {
        const d = M.SECTION_DEFS[s];
        return d.tab && d.singular && d.idPrefix && d.labelKey && Array.isArray(d.fields) && d.fields.length >= 4 && Array.isArray(d.columns);
      }));
      check("master: field defs carry key/type/label", SECTIONS.every((s) => M.SECTION_DEFS[s].fields.every((f) => f.key && f.type && f.label)));
      check("master: 9 system defaults declared", M.SETTINGS_DEFS.length === 9 && M.SETTINGS_DEFS.every((f) => f.key && f.type && "default" in f));

      /* ── stub backend + force seed ── */
      const srv = makeServer();
      store.useBackend(srv);
      store.resetAllLocal();

      const seed = await M.seed({ force: true });
      check("master: force seed writes the config", seed.seeded === true && seed.sections === 11 && seed.records > 60, JSON.stringify({ s: seed.sections, r: seed.records }));
      const stats = await M.stats();
      check("master: stats counts every section", stats.sections === 11 && stats.records === seed.records && SECTIONS.every((s) => stats.bySection[s] > 0), JSON.stringify(stats.bySection));
      check("master: persists to the canonical rmm-v1-config doc", stats.docName === "rmm-v1-config" && typeof srv.files["rmm-v1-config"] === "string");
      check("master: seeded config validates cleanly", (await M.validate()).valid);
      check("master: seed is idempotent without force", (await M.seed()).skipped === true);
      const stored = JSON.parse(srv.files["rmm-v1-config"]);
      check("master: the stored doc keeps its envelope", stored.doc === "config" && Array.isArray(stored.records) && stored.records[0] && stored.records[0].kind === "rmm-config", JSON.stringify({ doc: stored.doc, n: (stored.records || []).length }));

      let idOk = true, idBad = "";
      for (const s of SECTIONS) {
        const list = await M.section(s);
        const prefix = M.SECTION_DEFS[s].idPrefix;
        const bad = list.filter((r) => !new RegExp("^" + prefix + "-").test(r.id));
        if (!list.length || bad.length) { idOk = false; idBad = s + ":" + list.length; }
      }
      check("master: every section is seeded with id-prefixed records", idOk, idBad);

      /* ── normalise / validate primitives ── */
      const norm = M.normalizeRecord("severities", { label: "Custom" });
      check("master: normalizeRecord generates a prefixed id and coerces defaults", /^sev-/.test(norm.id) && norm.tone === "info" && norm.rank === 100 && norm.notify === true, JSON.stringify({ id: norm.id, rank: norm.rank }));
      check("master: normalizeRecord honours an explicit id", M.normalizeRecord("tagTaxonomy", { id: "tag-keep", name: "keep" }).id === "tag-keep");
      check("master: coerce splits tag strings", JSON.stringify(M.coerce(M.fieldDef("calendars", "workdays"), "mon, tue")) === '["mon","tue"]');
      check("master: validateRecord rejects a blank required field", M.validateRecord("severities", M.normalizeRecord("severities", { label: "" })).valid === false);
      check("master: validateRecord rejects a bad select value", M.validateRecord("monitorTypes", Object.assign(M.normalizeRecord("monitorTypes", { label: "x" }), { category: "nope" })).valid === false);
      check("master: normalizeConfig fills all 11 sections", Object.keys(M.normalizeConfig({}).sections).length === 11);

      /* ── settings ── */
      const settings = await M.settings();
      check("master: settings expose all defaults", M.SETTINGS_DEFS.every((f) => settings[f.key] === f.default || settings[f.key] != null));
      const saved = await M.saveSettings({ alertDedupeMinutes: 45, defaultTimezone: "Europe/London" });
      const s2 = await M.settings();
      check("master: saveSettings persists a patch", !saved.error && s2.alertDedupeMinutes === 45 && s2.defaultTimezone === "Europe/London");
      check("master: saveSettings coerces numbers", typeof s2.alertDedupeMinutes === "number");
      check("master: settings survive a forced reload", (await M.all({ force: true })).settings.alertDedupeMinutes === 45);
      await M.saveSettings({ alertDedupeMinutes: 30, defaultTimezone: "UTC" });

      /* ── CRUD ── */
      const added = await M.add("tagTaxonomy", { name: "test-tag-" + uid, category: "custom" });
      const tid = added.entry && added.entry.itemId;
      check("master: add creates a prefixed record", !added.error && /^tag-/.test(tid), JSON.stringify(added.error || tid));
      check("master: add persists the record", (await M.item("tagTaxonomy", tid)).name === "test-tag-" + uid);
      check("master: add records history newest-first", (await M.history())[0].action === "add" && (await M.history())[0].itemId === tid);
      check("master: duplicate id is rejected", (await M.add("tagTaxonomy", { id: tid, name: "dupe" })).error === "duplicate_id");
      check("master: missing required field is rejected", (await M.add("tagTaxonomy", { category: "custom" })).error === "invalid_record");
      check("master: unknown section is rejected", (await M.add("nope", {})).error === "unknown_section");
      const upd = await M.update("tagTaxonomy", tid, { name: "test-tag-renamed", color: "#123456" });
      check("master: update patches and keeps identity", !upd.error && (await M.item("tagTaxonomy", tid)).name === "test-tag-renamed" && (await M.item("tagTaxonomy", tid)).color === "#123456");
      const held = await M.item("tagTaxonomy", tid);
      check("master: update keeps createdAt and refreshes updatedAt", !!held.createdAt && held.updatedAt >= held.createdAt);
      check("master: update reports not_found", (await M.update("tagTaxonomy", "tag-nope", { name: "x" })).error === "not_found");
      check("master: update rejects an invalid patch", (await M.update("tagTaxonomy", tid, { name: "" })).error === "invalid_record");
      check("master: toggle flips enabled", !(await M.toggle("tagTaxonomy", tid)).error && (await M.item("tagTaxonomy", tid)).enabled === false);
      check("master: setEnabled sets explicitly", !(await M.setEnabled("tagTaxonomy", tid, true)).error && (await M.item("tagTaxonomy", tid)).enabled === true);

      /* ── ordering ── */
      const first = (await M.section("tagTaxonomy"))[0].id;
      const second = (await M.section("tagTaxonomy"))[1].id;
      check("master: move swaps adjacent records", !(await M.move("tagTaxonomy", second, -1)).error && (await M.section("tagTaxonomy"))[0].id === second);
      check("master: move reports out_of_range at the edge", (await M.move("tagTaxonomy", second, -1)).error === "out_of_range");
      check("master: reorder accepts an explicit order", !(await M.reorder("tagTaxonomy", [first, second])).error && (await M.section("tagTaxonomy"))[0].id === first);

      /* ── single-default enforcement ── */
      await M.setDefault("calendars", "cal-24x7");
      const defaults = (await M.section("calendars")).filter((c) => c.isDefault);
      check("master: setDefault enforces a single default", defaults.length === 1 && defaults[0].id === "cal-24x7");
      check("master: setDefault rejects a section without a default field", (await M.setDefault("tagTaxonomy", tid)).error === "no_default_field");
      await M.setDefault("calendars", "cal-default");

      /* ── lookups ── */
      check("master: severity lookup", (await M.severity("sev-critical")).label === "Critical" && (await M.severity("nope")) === null);
      check("master: monitorType lookup", (await M.monitorType("mon-cpu")).category === "performance");
      check("master: channel lookup", (await M.channel("ch-email")).type === "email");
      check("master: schedule lookup", (await M.schedule("sched-5m")).kind === "interval");
      check("master: calendar lookup", (await M.calendar("cal-default")).timezone === "UTC");
      check("master: patchClass lookup", (await M.patchClass("pc-critical")).autoApprove === true);
      check("master: softwareCategory lookup", (await M.softwareCategory("sc-security")).label === "Security");
      check("master: scriptCategory lookup", (await M.scriptCategory("scr-diagnostics")).requiresApproval === false);
      check("master: severityTone maps to a UI tone", (await M.severityTone("sev-critical")) === "danger" && (await M.severityTone("nope")) === "muted");
      check("master: tags returns enabled names", (await M.tags()).indexOf("production") !== -1 && (await M.tags()).indexOf("test-tag-renamed") !== -1);
      check("master: label resolves a record name", (await M.label("severities", "sev-warning")) === "Warning");
      const refs = await M.refOptions("severities");
      check("master: refOptions yields value/label pairs", refs.length >= 4 && refs.every((o) => o.value && o.label) && refs.some((o) => o.value === "sev-info"));
      const en = await M.enabled("schedules");
      check("master: enabled() hides disabled records", en.every((r) => r.id !== "sched-1m") && en.length === 7, "got " + en.length);

      /* ── time resolvers ── */
      const zp = M.zonedParts(new Date("2026-09-14T12:00:00Z"), "UTC");
      check("master: zonedParts resolves weekday/time/minutes", zp.weekday === "mon" && zp.time === "12:00" && zp.minutes === 720, JSON.stringify(zp));
      check("master: business hours — Monday midday is in hours", (await M.inBusinessHours(new Date("2026-09-14T12:00:00Z"), "cal-default")) === true);
      check("master: business hours — Sunday is out", (await M.inBusinessHours(new Date("2026-09-13T12:00:00Z"), "cal-default")) === false);
      check("master: business hours — after close is out", (await M.inBusinessHours(new Date("2026-09-14T20:00:00Z"), "cal-default")) === false);
      check("master: business hours — 24×7 is always in hours", (await M.inBusinessHours(new Date("2026-09-13T03:00:00Z"), "cal-24x7")) === true);
      check("master: business hours — default calendar used when unnamed", (await M.inBusinessHours(new Date("2026-09-14T12:00:00Z"))) === true);

      check("master: nightly window is active at 02:00", (await M.activeMaintenance(new Date("2026-09-14T02:00:00Z"))).some((w) => w.id === "mw-nightly"));
      check("master: nightly window is inactive at midday", !(await M.activeMaintenance(new Date("2026-09-14T12:00:00Z"))).some((w) => w.id === "mw-nightly"));
      check("master: weekly window only fires on its days", (await M.activeMaintenance(new Date("2026-09-12T12:00:00Z"))).some((w) => w.id === "mw-weekend") && !(await M.activeMaintenance(new Date("2026-09-14T12:00:00Z"))).some((w) => w.id === "mw-weekend"));
      check("master: monthly window only fires on its day", (await M.activeMaintenance(new Date("2026-09-01T22:30:00Z"))).some((w) => w.id === "mw-month-end") && !(await M.activeMaintenance(new Date("2026-09-15T22:30:00Z"))).some((w) => w.id === "mw-month-end"));

      const siteWin = await M.add("maintenanceWindows", { label: "Site window", recurrence: "daily", startTime: "00:00", endTime: "23:59", scope: "site", scopeId: "site-x" });
      check("master: activeMaintenance filters by scope", !siteWin.error && (await M.activeMaintenance(new Date("2026-09-14T12:00:00Z"), { type: "site", id: "site-x" })).some((w) => w.scopeId === "site-x") && (await M.activeMaintenance(new Date("2026-09-14T12:00:00Z"), { type: "site", id: "site-y" })).every((w) => w.scopeId !== "site-x"));
      check("master: global windows still apply to any scope", (await M.activeMaintenance(new Date("2026-09-14T02:00:00Z"), { type: "site", id: "site-y" })).some((w) => w.id === "mw-nightly"));
      const supp = await M.isSuppressed(new Date("2026-09-14T02:00:00Z"), { type: "site", id: "site-y" });
      check("master: isSuppressed reports suppression + windows", supp.suppressed === true && supp.windows.length >= 1);

      /* ── history & notification ── */
      const hist = await M.history();
      check("master: history is attributed and newest-first", hist.length > 0 && hist[0].ts >= hist[hist.length - 1].ts && hist.every((h) => h.actor && h.action && h.section));
      check("master: history filters by section", (await M.history({ section: "tagTaxonomy" })).every((h) => h.section === "tagTaxonomy"));
      check("master: history honours a limit", (await M.history({ limit: 3 })).length === 3);
      let changes = 0;
      const off = M.onChange(() => { changes++; });
      await M.update("tagTaxonomy", tid, { name: "test-tag-notify" });
      off();
      check("master: onChange notifies subscribers", changes >= 1);
      const cleared = await M.clearHistory();
      check("master: clearHistory empties the log", !cleared.error && (await M.history()).length === 1 && (await M.history())[0].action === "clear-history");

      /* ── cross-record validation ── */
      await M.add("channels", { label: "Bad ref", type: "email", target: "x", minSeverity: "sev-missing" });
      const vBad = await M.validate();
      check("master: validate catches a dangling reference", vBad.errors.some((e) => /missing severities record/.test(e)), JSON.stringify(vBad.errors.slice(0, 3)));
      const cfg = await M.all({ force: true });
      const badCfg = JSON.parse(JSON.stringify(cfg));
      badCfg.sections.severities.push(Object.assign({}, badCfg.sections.severities[0]));
      const saveBad = await store.saveDoc("config", [badCfg]);
      await M.all({ force: true });
      const vDup = await M.validate();
      check("master: validate catches a duplicate id", !saveBad.error ? vDup.errors.some((e) => /duplicate id/.test(e)) : true, JSON.stringify(vDup.errors.slice(0, 3)));
      await M.reseed();
      check("master: reseed restores a clean config", (await M.validate()).valid && (await M.tags()).indexOf("test-tag-renamed") === -1);

      /* ── Admin console render ── */
      const probe = document.createElement("div");
      document.body.appendChild(probe);
      const prevRole = ERP.role;
      ERP.role = "owner";
      const ctx = { el: probe, module: ERP.getModule("admin"), navigate: () => {}, toast: () => {}, empty: () => {}, error: () => {} };
      await M.render(ctx);
      check("master: Admin renders all 14 panels", probe.querySelectorAll("[data-panel]").length === 14, "got " + probe.querySelectorAll("[data-panel]").length);
      check("master: Admin renders a page head + tab bar", !!probe.querySelector(".erp-page-head") && probe.querySelectorAll("[data-tab]").length === 14);
      check("master: Admin exposes the roles & access panel", !!probe.querySelector('[data-tab="access"]') && !!probe.querySelector('[data-panel="access"]'));
      check("master: Admin defaults panel shows the settings form", !!probe.querySelector('[data-panel="defaults"] form') && !!probe.querySelector('[data-panel="defaults"] [name="alertDedupeMinutes"]'));
      check("master: Admin section panel shows a table + add action", !!probe.querySelector('[data-panel="severities"] .erp-table') && !!probe.querySelector('[data-panel="severities"] [data-act="mc-add"]'));
      check("master: Admin severity table lists the seeded rows", probe.querySelectorAll('[data-panel="severities"] .erp-table tbody tr').length >= 4);
      check("master: Admin shows the change-history panel", !!probe.querySelector('[data-panel="history"] .erp-table'));
      ERP.role = "staff";
      await M.render(ctx);
      check("master: staff see a read-only console", !!probe.querySelector(".erp-alert") && !probe.querySelector('[data-act="mc-add"]') && probe.querySelectorAll('[data-act="mc-del"]').length === 0);
      ERP.role = prevRole;
      probe.remove();

      /* ── hygiene ── */
      check("master: every canonical file stays in the rmm-v1 namespace", Object.keys(srv.files).every((n) => n.indexOf("rmm-v1-") === 0), JSON.stringify(Object.keys(srv.files)));
    } catch (e) {
      check("master: test harness did not crash", false, (e && e.stack) || String(e));
    } finally {
      try { store.useBackend(null); } catch (e) {}
      try { store.resetAllLocal(); } catch (e) {}
    }

    const passed = results.filter((r) => r.ok).length;
    const failed = results.length - passed;
    return { passed, failed, results };
  };

  /* ============================================================
     Task 5 validation tests — sync, conflict, backup & versioning
     Run via page_eval:  await window.RMMContinuityTest()
     Covers the version-history engine (capture, de-duplication,
     the bounded ring, filter, compare, restore-with-pre-snapshot,
     prune, clear), the reconciliation report, capacity accounting
     across every document (including tenant aggregates), guided
     archival candidates, full tenant archive + restore, the backup
     engine integration (bundles carry the history), and the Data &
     continuity console (tabs, tables, backup actions, deep-link).
     Runs against a stub backend so the real documents are never
     touched.
     ============================================================ */
  window.RMMContinuityTest = async function (opts) {
    opts = opts || {};
    results.length = 0;
    const ERP = window.ERP;
    const store = ERP.store;
    const T = ERP.tenancy;
    const DC = ERP.continuity;
    const backup = ERP.backup;
    const uid = Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);

    function makeServer() {
      const files = {};
      return {
        files,
        async get(name) { return Object.prototype.hasOwnProperty.call(files, name) ? files[name] : null; },
        async set(name, json) {
          const prev = files[name];
          const created = prev === undefined;
          files[name] = json;
          return { created, unchanged: prev === json, editKey: "k_" + name, superseded: false, error: null };
        },
      };
    }

    if (!DC) { check("continuity: ERP.continuity exposed", false); return { passed: 0, failed: 1, results }; }
    let tmpMod = null;

    try {
      /* ── exposure ── */
      check("continuity: ERP.continuity exposed", typeof DC.capture === "function" && typeof DC.captureChanged === "function" && typeof DC.list === "function" && typeof DC.restore === "function" && typeof DC.capacity === "function" && typeof DC.render === "function");
      check("continuity: history lives in the rmm namespace", DC.HISTORY_MODULE === "versions" && DC.HISTORY_DOC === "rmm-v1-versions", DC.HISTORY_DOC);
      check("continuity: history/backup/index are excluded", DC.EXCLUDED.has(DC.HISTORY_DOC) && DC.EXCLUDED.has(DC.BACKUP_DOC) && DC.EXCLUDED.has(store.indexName));
      check("continuity: auto-capture installation is idempotent", DC.installed() === true && DC.install() === false);
      const lim = DC.configure({ perDoc: 3, totalBytes: 4 * 1024 * 1024, snapshotBytes: 512 * 1024 });
      check("continuity: configure overrides the ring limits", lim.perDoc === 3 && lim.snapshotBytes === 512 * 1024);

      /* ── stub backend ── */
      const srv = makeServer();
      store.useBackend(srv);
      store.resetAllLocal();
      T.reload();

      /* ── capture ── */
      tmpMod = "tmpdc" + uid;
      ERP.registerModule({ id: tmpMod, label: "Test Doc", group: null, icon: "reports", roles: [], hidden: true, doc: { name: "tmpdc" + uid, splitByYear: false } });
      const nA = store.docName(tmpMod);
      await store.set(nA, [{ id: 1, name: "Acme" }, { id: 2, name: "Globex" }]);
      const c1 = await DC.capture(nA, { reason: "manual" });
      check("continuity: capture stores a snapshot", !!c1.entry && c1.entry.rev === 1 && c1.entry.count === 2 && c1.entry.bytes > 0, JSON.stringify(c1));
      check("continuity: the snapshot lands in the rmm-v1-versions doc", typeof srv.files["rmm-v1-versions"] === "string");
      const dup = await DC.capture(nA, { reason: "manual" });
      check("continuity: an unchanged capture is de-duplicated", dup.skipped === true && dup.reason === "unchanged", JSON.stringify(dup));
      const skip = await DC.capture(store.indexName);
      check("continuity: history/backup/index are never snapshotted", skip.skipped === true && skip.reason === "excluded");

      await store.set(nA, [{ id: 1, name: "Acme" }, { id: 2, name: "Globex" }, { id: 3, name: "Initech" }]);
      const scan = await DC.captureChanged({ reason: "auto" });
      check("continuity: captureChanged snapshots the moved revision", scan.captured.indexOf(nA) !== -1, JSON.stringify(scan.captured));
      const listA = await DC.list({ doc: nA });
      check("continuity: history lists newest-first", listA.length === 2 && listA[0].rev === 2 && listA[1].rev === 1, JSON.stringify(listA.map((e) => e.rev)));
      check("continuity: list omits the record payload by default", listA[0].records === undefined);
      const full = await DC.get(listA[1].id);
      check("continuity: get returns the full snapshot", !!full && Array.isArray(full.records) && full.records.length === 2);
      check("continuity: snapshots are attributed + labelled", !!full.actor && full.label === store.humanDocName(nA), full.label);
      check("continuity: stats summarise the ring", (await DC.stats()).snapshots === 2 && (await DC.stats()).byDoc[nA] === 2);

      /* ── bounded ring ── */
      for (let i = 0; i < 4; i++) { await store.set(nA, [{ id: 1, name: "v" + i }]); await DC.capture(nA, { reason: "manual", force: true }); }
      check("continuity: the per-document ring is bounded", (await DC.list({ doc: nA })).length === 3, "len=" + (await DC.list({ doc: nA })).length);
      const pruned = await DC.prune();
      check("continuity: prune reports what it dropped", typeof pruned.removed === "number" && pruned.kept <= 3);

      /* ── compare ── */
      const head = await DC.get((await DC.list({ doc: nA }))[0].id);
      const cmpSame = await DC.compare(head.id);
      check("continuity: compare finds no drift at the head", cmpSame.added.length === 0 && cmpSame.removed.length === 0 && cmpSame.changed.length === 0, JSON.stringify(cmpSame));
      await store.set(nA, [{ id: 1, name: "v0" }, { id: 2, name: "new" }, { id: 4, name: "added" }]);
      const cmp = await DC.compare(head.id);
      check("continuity: compare reports added + changed record ids", cmp.added.indexOf("id:4") !== -1 && cmp.added.indexOf("id:2") !== -1 && cmp.changed.indexOf("id:1") !== -1, JSON.stringify({ a: cmp.added, c: cmp.changed }));

      /* ── restore (reversible) ── */
      const rEntry = await DC.get(head.id);
      const rest = await DC.restore(head.id);
      check("continuity: restore writes the snapshot back", rest.ok === true && rest.restored === rEntry.records.length, JSON.stringify(rest));
      const live = await store.get(nA);
      check("continuity: the restored records are live again", live.doc.records.length === rEntry.records.length && live.doc.records[0].name === rEntry.records[0].name, JSON.stringify(live.doc.records));
      check("continuity: restore snapshots the pre-restore state first", (await DC.list({ doc: nA, reason: "pre-restore" })).length >= 1);

      /* ── clear ── */
      const cleared = await DC.clear({ doc: nA });
      check("continuity: clear(doc) drops one document's history", cleared.cleared >= 1 && (await DC.list({ doc: nA })).length === 0, JSON.stringify(cleared));

      /* ── reconcile ── */
      const rep = await DC.reconcile({ capture: false });
      check("continuity: reconcile returns a sync report", rep && Array.isArray(rep.results) && typeof rep.at === "string", JSON.stringify({ n: (rep.results || []).length }));
      check("continuity: reconcile records the run", typeof DC.lastReconciledAt === "string" && DC.lastReport !== null);

      /* ── backup integration ── */
      await DC.capture(nA, { reason: "manual" });
      const bundle = await backup.backupBundle();
      check("continuity: the backup bundle carries the version history", !!bundle.docs["rmm-v1-versions"] && bundle.docs["rmm-v1-versions"].records.length >= 1);

      /* ── capacity across every document ── */
      const prov = await T.create({ name: "Continuity " + uid });
      const pid = prov.provider.id;
      await T.addItem(pid, "sites", { name: "HQ" });
      const cap = await DC.capacity();
      check("continuity: capacity spans every document", cap.rows.length >= 2 && cap.total > 0 && cap.ceiling === store.maxDocBytes, JSON.stringify({ rows: cap.rows.length, total: cap.total }));
      const pRow = cap.rows.find((r) => r.doc === T.providerDocName(pid));
      check("continuity: tenant aggregates appear in capacity", !!pRow && pRow.isProvider === true && !!pRow.advice, JSON.stringify(pRow && { b: pRow.bytes, a: pRow.advice }));
      check("continuity: every capacity row carries size + advice", cap.rows.every((r) => typeof r.bytes === "number" && !!r.advice && !!r.tone));
      const docs = await DC.documents();
      check("continuity: documents() merges capacity with snapshot counts", docs.some((d) => d.doc === T.providerDocName(pid)) && docs.every((d) => "snapshots" in d && "pct" in d));

      /* ── guided archival candidates ── */
      const cands = await DC.archiveCandidates();
      check("continuity: an active, small tenant is not an archival candidate", !cands.some((c) => c.doc === T.providerDocName(pid) && c.actionable));

      /* ── tenant archive + restore ── */
      const docNameP = T.providerDocName(pid);
      const arch = await DC.archiveTenant(docNameP);
      check("continuity: archiveTenant moves the aggregate to the archive", arch.ok === true && arch.providerId === pid, JSON.stringify(arch));
      check("continuity: the live tenant document is emptied", (await T.get(pid)).error === "not_found");
      check("continuity: the archived tenant leaves the registry", !(await T.list({ force: true })).some((p) => p.id === pid));
      const archList = await backup.archivedDocs();
      check("continuity: the read-only archive holds the tenant", archList.some((e) => e.kind === "tenant" && e.providerId === pid));
      const rsta = await DC.restoreTenantArchive(arch.archiveId);
      check("continuity: the archived tenant restores in full", rsta.ok === true && rsta.providerId === pid, JSON.stringify(rsta));
      const back = await T.get(pid);
      check("continuity: the restored tenant is active with its data", !back.error && back.provider.status === "active" && back.provider.sites.length === 1, JSON.stringify(back.error || back.provider && back.provider.status));
      check("continuity: the archive entry is removed after restore", !(await backup.archivedDocs()).some((e) => String(e.id) === String(arch.archiveId)));

      /* ── console ── */
      check("continuity: the Reports station is wired to the console", typeof ERP.getModule("reports").render === "function");
      const probe = document.createElement("div");
      probe.className = "erp-content";
      document.body.appendChild(probe);
      const prevRole = ERP.role;
      ERP.role = "owner";
      const ctx = { el: probe, module: ERP.getModule("reports"), navigate: () => {}, toast: () => {}, empty: () => {}, error: (o) => { probe.innerHTML = '<div class="erp-state" data-state="error">' + ((o && o.message) || "") + "</div>"; } };
      await DC.render(ctx);
      check("continuity: console renders a page head + every tabs", !!probe.querySelector(".erp-page-head") && probe.querySelectorAll("[data-tab]").length === 8 && ["sync", "versions", "backup", "capacity", "reports", "schedules", "deliveries", "quality"].every((t) => probe.querySelector('[data-tab="' + t + '"]')), "tabs=" + probe.querySelectorAll("[data-tab]").length);
      check("continuity: console renders every panel", probe.querySelectorAll("[data-panel]").length === 8, "panels=" + probe.querySelectorAll("[data-panel]").length);
      check("continuity: sync panel explains reconciliation", /canonical/i.test(probe.querySelector('[data-panel="sync"]').textContent));
      check("continuity: sync panel offers reconcile + sync-center actions", !!probe.querySelector('[data-act="dc-reconcile"]') && !!probe.querySelector('[data-act="dc-open-sync"]'));
      check("continuity: version panel lists snapshots with actions", !!probe.querySelector('[data-panel="versions"] .erp-table') && probe.querySelectorAll('[data-panel="versions"] [data-act="dc-view-version"]').length >= 1 && probe.querySelectorAll('[data-panel="versions"] [data-act="dc-restore-version"]').length >= 1);
      check("continuity: version panel has a document filter", !!probe.querySelector('[data-panel="versions"] [data-dc-filter]'));
      check("continuity: backup panel offers every backup action", ["dc-backup-download", "dc-backup-publish", "dc-restore-published", "dc-restore-file"].every((a) => !!probe.querySelector('[data-panel="backup"] [data-act="' + a + '"]')));
      check("continuity: capacity panel renders size bars against the ceiling", !!probe.querySelector('[data-panel="capacity"] .erp-table') && probe.querySelectorAll('[data-panel="capacity"] .erp-cap-bar').length >= 1);
      check("continuity: capacity panel shows guided archival", /guided archival/i.test(probe.textContent));
      probe.__tab = "capacity";
      await DC.render(ctx);
      check("continuity: deep-link opens the capacity tab", probe.querySelector('[data-tab="capacity"]').classList.contains("active") && probe.querySelector('[data-panel="capacity"]').classList.contains("active"));
      ERP.role = prevRole;
      probe.remove();

      /* ── hygiene ── */
      check("continuity: every canonical file stays in the rmm-v1 namespace", Object.keys(srv.files).every((n) => n.indexOf("rmm-v1-") === 0), JSON.stringify(Object.keys(srv.files)));
    } catch (e) {
      check("continuity: test harness did not crash", false, (e && e.stack) || String(e));
    } finally {
      try { DC.configure({ perDoc: 25, totalBytes: 3 * 1024 * 1024, snapshotBytes: 1536 * 1024 }); } catch (e) {}
      try { const m = ERP.getModule(tmpMod); if (m) ERP.modules.splice(ERP.modules.indexOf(m), 1); } catch (e) {}
      try { store.useBackend(null); } catch (e) {}
      try { store.resetAllLocal(); } catch (e) {}
      try { T.reload(); } catch (e) {}
    }

    const passed = results.filter((r) => r.ok).length;
    const failed = results.length - passed;
    return { passed, failed, results };
  };

  /* ============================================================
     Task 7 validation tests — enrollment & device identity
     Run via page_eval:  await window.RMMEnrollmentTest()
     Covers: the SHA-256 hashing primitive, high-entropy one-time
     tokens that are stored only as a hash, the enroll handshake
     (token -> durable per-device credential, stored only as a hash),
     single-use / expired / revoked tokens, credential rotation, a
     revoked device being refused, device-bound re-enrollment that
     reuses the record, identity/stats reads and namespace hygiene.
     Runs against a stub backend so the real documents are untouched.
     ============================================================ */
  window.RMMEnrollmentTest = async function (opts) {
    opts = opts || {};
    results.length = 0;
    const ERP = window.ERP;
    const store = ERP.store;
    const T = ERP.tenancy;
    const D = ERP.devices;
    const E = ERP.enrollment;
    const uid = Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);

    function makeServer() {
      const files = {};
      return {
        files,
        async get(name) { return Object.prototype.hasOwnProperty.call(files, name) ? files[name] : null; },
        async set(name, json) {
          const prev = files[name];
          const created = prev === undefined;
          files[name] = json;
          return { created, unchanged: prev === json, editKey: "k_" + name, superseded: false, error: null };
        },
      };
    }

    if (!E) { check("enrollment: ERP.enrollment exposed", false); return { passed: 0, failed: 1, results }; }

    try {
      /* ── exposure + primitives ── */
      check("enrollment: ERP.enrollment exposed", typeof E.enroll === "function" && typeof E.issueToken === "function" && typeof E.authenticate === "function" && typeof E.rotateCredential === "function" && typeof E.revokeDevice === "function" && typeof E.identity === "function");
      check("enrollment: SHA-256 matches the known vector", E.sha256Hex("abc") === "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", E.sha256Hex("abc"));
      check("enrollment: constant-time compare rejects mismatch + length", E.constantTimeEqual("abc", "abc") === true && E.constantTimeEqual("abc", "abd") === false && E.constantTimeEqual("ab", "abc") === false);
      const t1 = E.newToken(), t2 = E.newToken();
      check("enrollment: tokens are high-entropy and unique", /^rmm_[A-Z2-9]{32}$/.test(t1) && t1 !== t2 && E.newCredential().indexOf("cred_") === 0, t1);

      /* ── stub backend ── */
      const srv = makeServer();
      store.useBackend(srv);
      store.resetAllLocal();
      T.reload();

      const prov = await T.create({ name: "Enrol " + uid, sites: [{ id: "site-" + uid, name: "HQ" }], deviceGroups: [{ id: "grp-" + uid, name: "Workstations", siteId: "site-" + uid }] });
      const pid = prov.provider.id;
      const docName = store.docName("enrollment");

      /* ── tokens ── */
      check("enrollment: a token must belong to a provider", !!((await E.issueToken({})).error));
      const issued = await E.issueToken({ providerId: pid, siteId: "site-" + uid, groupIds: ["grp-" + uid], label: "test" });
      check("enrollment: issueToken returns the plaintext once", issued.ok === true && /^rmm_/.test(issued.token));
      check("enrollment: the returned record carries no hash", issued.record && issued.record.tokenHash === undefined);
      const raw0 = srv.files[docName] || "";
      check("enrollment: only the token hash is persisted", raw0.indexOf(issued.token) === -1 && raw0.indexOf(E.sha256Hex(issued.token)) !== -1);
      check("enrollment: tokens are listed without their hash", (await E.listTokens({ providerId: pid })).every((t) => t.tokenHash === undefined));
      check("enrollment: a fresh token is active", (await E.getToken(issued.record.id)).status === "active");

      /* ── enroll ── */
      const en = await E.enroll({ token: issued.token, hostname: "WS-ENROLL", os: { name: "Windows 11 Pro" }, device: { role: "workstation", manufacturer: "Dell" } });
      check("enrollment: enroll exchanges the token for a credential", en.ok === true && /^cred_/.test(en.credential) && !!en.deviceId, JSON.stringify({ e: en.error, d: en.deviceId }));
      const raw1 = srv.files[docName] || "";
      check("enrollment: only the credential hash is persisted", raw1.indexOf(en.credential) === -1 && raw1.indexOf(E.sha256Hex(en.credential)) !== -1);
      const dev = (await D.get(pid, en.deviceId)).device;
      check("enrollment: the token's site and group are applied", dev.siteId === "site-" + uid && dev.groupIds.indexOf("grp-" + uid) !== -1, JSON.stringify({ s: dev.siteId, g: dev.groupIds }));
      check("enrollment: the device is stamped enrolled and online", !!dev.enrolledAt && dev.status === "online");
      check("enrollment: the token is burned after use", (await E.getToken(issued.record.id)).status === "used");
      check("enrollment: the token is single-use", (await E.enroll({ token: issued.token, hostname: "WS-2" })).error === "used_token");

      /* ── authenticate ── */
      check("enrollment: a valid credential authenticates", (await E.authenticate(en.deviceId, en.credential)).ok === true);
      check("enrollment: a wrong credential is refused", (await E.authenticate(en.deviceId, "cred_WRONG")).reason === "invalid_credential");
      check("enrollment: an unknown device has no credential", (await E.authenticate("dev-nope", "cred_X")).reason === "no_credential");

      /* ── expired / revoked / unknown tokens ── */
      const exp = await E.issueToken({ providerId: pid, expiresInMinutes: -5 });
      check("enrollment: an expired token is refused", (await E.enroll({ token: exp.token, hostname: "WS-EXP" })).error === "expired_token");
      const rvk = await E.issueToken({ providerId: pid });
      await E.revokeToken(rvk.record.id);
      check("enrollment: a revoked token is refused", (await E.enroll({ token: rvk.token, hostname: "WS-RVK" })).error === "revoked_token");
      check("enrollment: an unrecognised token is refused", (await E.enroll({ token: "rmm_NOPE", hostname: "WS-X" })).error === "invalid_token");

      /* ── rotation ── */
      const rot = await E.rotateCredential(en.deviceId, { credential: en.credential, providerId: pid });
      check("enrollment: rotating issues a fresh credential", rot.ok === true && /^cred_/.test(rot.credential) && rot.credential !== en.credential);
      check("enrollment: the new credential authenticates", (await E.authenticate(en.deviceId, rot.credential)).ok === true);
      check("enrollment: the previous credential is refused", (await E.authenticate(en.deviceId, en.credential)).ok === false);
      const id1 = await E.identity(en.deviceId);
      check("enrollment: the identity shows the rotation", id1.credentials.length === 2 && !!id1.active && id1.active.id === rot.credentialId, JSON.stringify(id1));
      check("enrollment: rotating without a valid credential is refused", !!(await E.rotateCredential(en.deviceId, { credential: "cred_BAD" })).error);

      /* ── revocation ── */
      const rev = await E.revokeDevice(en.deviceId, { providerId: pid });
      check("enrollment: revoke invalidates the credential", rev.ok === true && rev.revoked >= 1);
      check("enrollment: a revoked device is refused on reconnect", (await E.authenticate(en.deviceId, rot.credential)).reason === "revoked");
      check("enrollment: the identity reports revocation", (await E.identity(en.deviceId)).revoked === true);

      /* ── re-enrollment (legitimate reinstall) ── */
      const re = await E.beginReenroll(en.deviceId, { providerId: pid, hostname: "WS-ENROLL" });
      check("enrollment: re-enroll issues a device-bound token", re.ok === true && /^rmm_/.test(re.token));
      const beforeCount = (await T.get(pid)).provider.devices.length;
      const re2 = await E.enroll({ token: re.token, hostname: "WS-ENROLL" });
      check("enrollment: re-enroll reuses the device (no duplicate)", re2.ok === true && re2.deviceId === en.deviceId && re2.reenrolled === true && (await T.get(pid)).provider.devices.length === beforeCount, JSON.stringify({ ok: re2.ok, same: re2.deviceId === en.deviceId, n: beforeCount }));
      check("enrollment: re-enroll mints a working credential", (await E.authenticate(en.deviceId, re2.credential)).ok === true);
      check("enrollment: re-enroll clears the revoked state", (await E.identity(en.deviceId)).revoked === false);

      /* ── stats + hygiene ── */
      const st = await E.stats({ providerId: pid });
      check("enrollment: stats summarise tokens and credentials", st.tokens >= 4 && st.credentials >= 3 && st.devices === 1, JSON.stringify(st));
      check("enrollment: every canonical file stays in the rmm namespace", Object.keys(srv.files).every((n) => n.indexOf("rmm-v1-") === 0), JSON.stringify(Object.keys(srv.files)));
    } catch (e) {
      check("enrollment: harness did not crash", false, (e && e.stack) || String(e));
    } finally {
      try { store.useBackend(null); } catch (e) {}
      try { store.resetAllLocal(); } catch (e) {}
      try { T.reload(); } catch (e) {}
    }

    const passed = results.filter((r) => r.ok).length;
    const failed = results.length - passed;
    return { passed, failed, results };
  };

  /* ============================================================
     Task 8 validation tests — heartbeat, presence & capabilities
     Run via page_eval:  await window.RMMHeartbeatTest()
     Covers: the configurable + clamped heartbeat interval, network
     fingerprinting, an authenticated check-in (server time, next
     interval, clock skew, agent-version + normalised capabilities),
     the baseline-vs-change network logic and its bounded history,
     the presence summary / device section, a suite-wide sweep that
     records presence transitions, and a revoked device being refused.
     Runs against a stub backend so the real documents are untouched.
     ============================================================ */
  window.RMMHeartbeatTest = async function (opts) {
    opts = opts || {};
    results.length = 0;
    const ERP = window.ERP;
    const store = ERP.store;
    const T = ERP.tenancy;
    const D = ERP.devices;
    const E = ERP.enrollment;
    const H = ERP.heartbeat;
    const AG = ERP.agent;
    const uid = Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);

    function makeServer() {
      const files = {};
      return {
        files,
        async get(name) { return Object.prototype.hasOwnProperty.call(files, name) ? files[name] : null; },
        async set(name, json) {
          const prev = files[name];
          const created = prev === undefined;
          files[name] = json;
          return { created, unchanged: prev === json, editKey: "k_" + name, superseded: false, error: null };
        },
      };
    }

    if (!H) { check("heartbeat: ERP.heartbeat exposed", false); return { passed: 0, failed: 1, results }; }

    try {
      check("heartbeat: ERP.heartbeat exposed", typeof H.heartbeat === "function" && typeof H.sweep === "function" && typeof H.summary === "function" && typeof H.fingerprint === "function");
      check("heartbeat: the interval comes from config and cannot be silly", H.intervalSeconds({}) === Math.max(30, Number(ERP.configVal("rmm.heartbeatSeconds", 300)) || 300) && H.intervalSeconds({ intervalSeconds: 5 }) === 30, String(H.intervalSeconds({})));
      check("heartbeat: fingerprints are order-independent", H.fingerprint({ interfaces: [{ mac: "B", ip4: ["2"], gateway: "g" }, { mac: "A", ip4: ["1"], gateway: "g" }] }) === H.fingerprint({ interfaces: [{ mac: "A", ip4: ["1"], gateway: "g" }, { mac: "B", ip4: ["2"], gateway: "g" }] }));

      const srv = makeServer();
      store.useBackend(srv);
      store.resetAllLocal();
      T.reload();

      const prov = await T.create({ name: "HB " + uid, sites: [{ id: "site-" + uid, name: "HQ" }] });
      const pid = prov.provider.id;
      const tok = await E.issueToken({ providerId: pid });
      const en = await E.enroll({ token: tok.token, hostname: "WS-HB", device: { role: "workstation", os: { name: "Windows 11" } } });
      const deviceId = en.deviceId;

      /* ── a normal check-in ── */
      const t0 = Date.now();
      const hb = await H.heartbeat({ deviceId, credential: en.credential, payload: {
        agentVersion: "1.2.0", capabilities: ["inventory", "jobs", "bogus", "metrics"],
        clientTime: new Date(t0 + 90000).toISOString(), intervalSeconds: 60, hostname: "WS-HB",
      } });
      check("heartbeat: a valid check-in succeeds", hb.ok === true, JSON.stringify({ e: hb.error }));
      check("heartbeat: the server answers with time + next interval", !!Date.parse(hb.serverTime) && hb.intervalSeconds === 60 && !!Date.parse(hb.nextHeartbeatAt));
      check("heartbeat: clock skew is reported", Math.abs(hb.clockSkewSeconds - 90) <= 3, String(hb.clockSkewSeconds));
      check("heartbeat: the device reads online", hb.liveness === "online" && hb.status === "online");
      const d1 = (await D.get(pid, deviceId)).device;
      check("heartbeat: last-seen is stamped", !!d1.lastSeenAt && Date.parse(d1.lastSeenAt) >= t0 - 5000);
      check("heartbeat: the agent version is recorded", d1.agentVersion === "1.2.0" && d1.agent.version === "1.2.0");
      check("heartbeat: capabilities are normalised", d1.agent.capabilities.indexOf("jobs") !== -1 && d1.agent.capabilities.indexOf("inventory") !== -1 && d1.agent.capabilities.indexOf("bogus") === -1, JSON.stringify(d1.agent.capabilities));
      check("heartbeat: interval + report time are stored", d1.agent.intervalSeconds === 60 && !!d1.agent.reportedAt);

      /* ── refused check-ins ── */
      check("heartbeat: a bad credential is refused", (await H.heartbeat({ deviceId, credential: "cred_BAD", payload: {} })).error === "invalid_credential");
      check("heartbeat: an unknown device is refused", (await H.heartbeat({ deviceId: "dev-nope", credential: "cred_X", payload: {} })).error === "no_credential");

      /* ── network change detection ── */
      const nicA = [{ name: "eth0", mac: "AA:AA:AA:AA:AA:AA", ip4: ["10.0.0.5"], gateway: "10.0.0.1" }];
      const nicB = [{ name: "eth0", mac: "AA:AA:AA:AA:AA:AA", ip4: ["10.9.0.5"], gateway: "10.9.0.1" }];
      const h1 = await H.heartbeat({ deviceId, credential: en.credential, payload: { interfaces: nicA } });
      check("heartbeat: the first network report is a baseline, not a change", h1.networkChanged === false);
      check("heartbeat: reported interfaces are stored", (await D.get(pid, deviceId)).device.interfaces.length === 1);
      const h2 = await H.heartbeat({ deviceId, credential: en.credential, payload: { interfaces: nicB } });
      check("heartbeat: a network move is detected", h2.networkChanged === true);
      const d2 = (await D.get(pid, deviceId)).device;
      check("heartbeat: a network move is recorded in history", (d2.custom.networkHistory || []).length === 1 && d2.custom.networkHistory[0].from.ips.indexOf("10.0.0.5") !== -1, JSON.stringify(d2.custom.networkHistory));
      const h3 = await H.heartbeat({ deviceId, credential: en.credential, payload: { interfaces: nicB } });
      check("heartbeat: a repeat report is not a change", h3.networkChanged === false && ((await D.get(pid, deviceId)).device.custom.networkHistory || []).length === 1);

      /* ── presence summary ── */
      const sum = H.summary((await D.get(pid, deviceId)).device);
      check("heartbeat: the summary reports presence + capabilities", sum.state === "online" && sum.capabilities.length >= 2 && sum.networkChanges === 1, JSON.stringify(sum));
      check("heartbeat: the device section names presence", /Heartbeat/.test(H.deviceSection((await D.get(pid, deviceId)).device)));

      /* ── sweep ── */
      await D.update(pid, deviceId, { lastSeenAt: new Date(Date.now() - 6 * 3600000).toISOString() });
      const sweep = await H.sweep(pid);
      check("heartbeat: the sweep derives offline presence", sweep.offline >= 1 && sweep.transitions.some((t) => t.deviceId === deviceId && t.to === "offline"), JSON.stringify({ o: sweep.offline, t: sweep.transitions }));
      check("heartbeat: the sweep records the new presence", H.summary((await D.get(pid, deviceId)).device).state === "offline");

      /* ── revoked device ── */
      await E.revokeDevice(deviceId, { providerId: pid });
      check("heartbeat: a revoked device is refused", (await H.heartbeat({ deviceId, credential: en.credential, payload: {} })).error === "revoked");

      check("heartbeat: every canonical file stays in the rmm namespace", Object.keys(srv.files).every((n) => n.indexOf("rmm-v1-") === 0), JSON.stringify(Object.keys(srv.files)));
      check("heartbeat: the capability catalogue is available for adaptation", !!AG && AG.CAPABILITY_IDS.length >= 8);
    } catch (e) {
      check("heartbeat: harness did not crash", false, (e && e.stack) || String(e));
    } finally {
      try { store.useBackend(null); } catch (e) {}
      try { store.resetAllLocal(); } catch (e) {}
      try { T.reload(); } catch (e) {}
    }

    const passed = results.filter((r) => r.ok).length;
    const failed = results.length - passed;
    return { passed, failed, results };
  };

  /* ============================================================
     Task 6 validation tests — agent packaging & installer generator
     Run via page_eval:  await RMMAgentTest()
     Covers: the platform + capability catalogues, family mapping,
     capability normalisation, the collector-address default, the
     generated Windows PowerShell and macOS/Linux shell installers
     (embedded collector/provider/site/token, boot service, enroll +
     heartbeat, success/failure output with the device id), the
     provider-scoped generator that issues a hashed one-time token,
     the device "Agent, enrollment & presence" section, and the
     Devices -> Deploy console (stats, installer form, token + agent
     tables, rotate/re-enroll/revoke actions).
     Runs against a stub backend so the real documents are untouched.
     ============================================================ */
  window.RMMAgentTest = async function (opts) {
    opts = opts || {};
    results.length = 0;
    const ERP = window.ERP;
    const store = ERP.store;
    const T = ERP.tenancy;
    const D = ERP.devices;
    const E = ERP.enrollment;
    const H = ERP.heartbeat;
    const AG = ERP.agent;
    const uid = Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);

    function makeServer() {
      const files = {};
      return {
        files,
        async get(name) { return Object.prototype.hasOwnProperty.call(files, name) ? files[name] : null; },
        async set(name, json) {
          const prev = files[name];
          const created = prev === undefined;
          files[name] = json;
          return { created, unchanged: prev === json, editKey: "k_" + name, superseded: false, error: null };
        },
      };
    }

    if (!AG) { check("agent: ERP.agent exposed", false); return { passed: 0, failed: 1, results }; }

    try {
      check("agent: ERP.agent exposed", typeof AG.installer === "function" && typeof AG.installerForProvider === "function" && typeof AG.renderDeploy === "function" && typeof AG.deviceAgentHtml === "function");
      check("agent: three platforms are catalogued", AG.PLATFORMS.length === 3 && AG.platform("windows").service === "Scheduled Task" && AG.platform("linux").service === "systemd" && AG.platform("macos").service === "launchd");
      check("agent: platforms map from OS family", AG.platformForFamily("Windows") === "windows" && AG.platformForFamily("macOS") === "macos" && AG.platformForFamily("Linux") === "linux" && AG.platformForFamily("") === null);
      check("agent: the capability catalogue is populated", AG.CAPABILITY_IDS.length >= 8 && AG.capabilitiesFor("windows").indexOf("jobs") !== -1);
      check("agent: capabilities normalise in catalogue order", JSON.stringify(AG.normalizeCapabilities(["jobs", "bogus", "inventory", "jobs"])) === JSON.stringify(["inventory", "jobs"]));
      check("agent: supports()", AG.supports(["inventory"], "inventory") === true && AG.supports(["inventory"], "jobs") === false);
      check("agent: a default collector address is derived", /^https?:/.test(AG.defaultCollectorUrl()), AG.defaultCollectorUrl());

      const base = { collectorUrl: "https://collect.example/x", providerId: "prov-acme", providerName: "Acme MSP", token: "rmm_TESTTOKEN42", siteId: "site-1", siteName: "HQ", groupIds: ["grp-1"], groupNames: ["Workstations"] };
      const win = AG.installer(Object.assign({}, base, { platform: "windows" }));
      check("agent: a windows installer is a PowerShell script", win.ok === true && win.language === "powershell" && /\.ps1$/.test(win.filename), win.filename);
      check("agent: the installer embeds the collector address + identity", win.script.indexOf("https://collect.example/x") !== -1 && win.script.indexOf("prov-acme") !== -1 && win.script.indexOf("Acme MSP") !== -1);
      check("agent: the installer embeds the one-time token", win.script.indexOf("rmm_TESTTOKEN42") !== -1);
      check("agent: windows registers a boot service", win.script.indexOf("New-ScheduledTaskAction") !== -1 && win.script.indexOf("Register-ScheduledTask") !== -1 && win.script.indexOf("AtStartup") !== -1);
      check("agent: the installer prints success/failure with the device id", win.script.indexOf("installed successfully") !== -1 && win.script.indexOf("Device id") !== -1 && win.script.indexOf("install FAILED") !== -1);
      check("agent: the installer enrolls and heartbeats", win.script.indexOf("/enroll") !== -1 && win.script.indexOf("/heartbeat") !== -1 && win.script.indexOf("credential") !== -1);
      check("agent: no unresolved template placeholders remain", ["head.provider", "configJson", "unitKind", "isMac"].every((k) => win.script.indexOf(k) === -1));
      check("agent: the embedded config is machine-readable", win.config.collectorUrl === "https://collect.example/x" && win.config.capabilities.indexOf("jobs") !== -1 && win.config.heartbeatSeconds >= 30);
      check("agent: the installer script is substantial", win.lines > 100, "lines=" + win.lines);

      const lin = AG.installer(Object.assign({}, base, { platform: "linux" }));
      check("agent: a linux installer is a shell script using systemd", lin.ok === true && lin.language === "sh" && /\.sh$/.test(lin.filename) && lin.script.indexOf("systemd") !== -1 && lin.script.indexOf("rmm_TESTTOKEN42") !== -1);
      const mac = AG.installer(Object.assign({}, base, { platform: "macos" }));
      check("agent: a macOS installer uses launchd", mac.ok === true && mac.script.indexOf("launchd") !== -1 && mac.script.indexOf("StartInterval") !== -1 && mac.script.indexOf("RunAtLoad") !== -1);
      check("agent: an unknown platform is refused", !!AG.installer(Object.assign({}, base, { platform: "solaris" })).error);
      check("agent: a missing token is refused", !!AG.installer(Object.assign({}, base, { token: "" })).error);

      /* ── agent runtime: inventory (Task 9), metrics (Task 10), jobs (Task 11) ── */
      check("agent: the embedded config carries the metrics cadence", win.config.metricsSampleSeconds >= 10 && lin.config.metricsSampleSeconds >= 10);
      check("agent: the runtime collects inventory (Task 9)", win.script.indexOf("/inventory") !== -1 && win.script.indexOf("Get-AgentInventory") !== -1 && win.script.indexOf("Send-AgentInventory") !== -1);
      check("agent: the runtime samples metrics (Task 10)", win.script.indexOf("/metrics") !== -1 && win.script.indexOf("Get-AgentMetrics") !== -1 && win.script.indexOf("Send-AgentMetrics") !== -1 && win.script.indexOf("$Cfg.metricsSampleSeconds") !== -1);
      check("agent: the runtime executes claimed jobs (Task 11)", win.script.indexOf("/job-result") !== -1 && win.script.indexOf("Invoke-OneJob") !== -1 && win.script.indexOf("Invoke-PendingJobs") !== -1 && win.script.indexOf("WaitForExit") !== -1);
      check("agent: job payloads are binary-safe via base64", win.script.indexOf("FromBase64String") !== -1 && win.script.indexOf("To-B64") !== -1 && lin.script.indexOf("base64 -d") !== -1);
      check("agent: windows gathers OS / software / patch / security telemetry", win.script.indexOf("Win32_OperatingSystem") !== -1 && win.script.indexOf("Win32_LogicalDisk") !== -1 && win.script.indexOf("Get-HotFix") !== -1 && win.script.indexOf("Get-MpComputerStatus") !== -1 && win.script.indexOf("Get-BitLockerVolume") !== -1);
      check("agent: the heartbeat drives collection + job execution", win.script.indexOf("$res.collectInventory") !== -1 && win.script.indexOf("$res.collectMetrics") !== -1 && win.script.indexOf("$res.jobs") !== -1);
      check("agent: the posix runtime collects inventory/metrics and runs jobs", lin.script.indexOf("/inventory") !== -1 && lin.script.indexOf("/metrics") !== -1 && lin.script.indexOf("/job-result") !== -1 && lin.script.indexOf("send_inventory") !== -1 && lin.script.indexOf("metrics_sample") !== -1 && lin.script.indexOf("run_one_job") !== -1);
      check("agent: the posix runtime is substantial and self-consistent", lin.script.split("\n").length > 400 && (lin.script.match(/\bcase\b/g) || []).length === (lin.script.match(/\besac\b/g) || []).length && lin.script.indexOf("install_linux") !== -1 && lin.script.indexOf("install_macos") !== -1);
      check("agent: the installer scripts contain no unresolved placeholders", [win, lin, mac].every((x) => ["head.provider", "configJson", "unitKind", "isMac"].every((k) => x.script.indexOf(k) === -1)));

      /* ── provider-scoped generator ── */
      const srv = makeServer();
      store.useBackend(srv);
      store.resetAllLocal();
      T.reload();

      const prov = await T.create({ name: "Agent " + uid, sites: [{ id: "site-" + uid, name: "Head Office" }], deviceGroups: [{ id: "grp-" + uid, name: "Servers", siteId: "site-" + uid }] });
      const pid = prov.provider.id;
      const built = await AG.installerForProvider({ providerId: pid, platform: "windows", siteId: "site-" + uid, groupIds: ["grp-" + uid], collectorUrl: "https://c.example/rmm" });
      check("agent: installerForProvider resolves provider/site/group", built.ok === true && built.config.providerId === pid && built.config.siteName === "Head Office" && built.config.groupNames.indexOf("Servers") !== -1, JSON.stringify({ s: built.config && built.config.siteName, g: built.config && built.config.groupNames }));
      check("agent: it issues exactly one one-time token", /^rmm_/.test(built.token) && !!built.tokenRecord && (await E.listTokens({ providerId: pid })).length === 1);
      const rawInst = srv.files[store.docName("enrollment")] || "";
      check("agent: the issued token is only stored hashed", rawInst.indexOf(built.token) === -1 && rawInst.indexOf(E.sha256Hex(built.token)) !== -1);

      /* ── enrollment + heartbeat flow into the device section ── */
      const en = await E.enroll({ token: built.token, hostname: "SRV-01", device: { role: "server", os: { name: "Windows Server 2022" } } });
      await H.heartbeat({ deviceId: en.deviceId, credential: en.credential, payload: { agentVersion: "1.0.0", capabilities: ["inventory", "jobs"] } });
      const dev = (await D.get(pid, en.deviceId)).device;
      const html = await AG.deviceAgentHtml(dev, pid);
      check("agent: the device modal shows enrollment, identity & presence", /Agent, enrollment/.test(html) && /Credential/.test(html) && /Presence/.test(html) && /Last heartbeat/.test(html));

      /* ── deploy console ── */
      await E.issueToken({ providerId: pid, label: "pending installer" });
      const provider = (await T.get(pid)).provider;
      const probe = document.createElement("div");
      document.body.appendChild(probe);
      await AG.renderDeploy(probe, { provider, providerId: pid, toast: function () {}, refresh: function () {} });
      check("agent: the deploy console renders stats + the installer form", probe.querySelectorAll(".erp-stat").length >= 4 && !!probe.querySelector('[name="agPlatform"]') && !!probe.querySelector('[name="agCollector"]') && !!probe.querySelector('[data-act="ag-gen"]'));
      check("agent: the deploy console lists tokens with revoke", !!probe.querySelector('[data-act="ag-revoke-token"]'));
      check("agent: the deploy console lists agents with rotate/re-enroll/revoke", !!probe.querySelector('[data-act="ag-rotate"]') && !!probe.querySelector('[data-act="ag-reenroll"]') && !!probe.querySelector('[data-act="ag-revoke-device"]'));
      check("agent: the Devices station is wired with a Deploy tab", typeof ERP.getModule("devices").render === "function");
      check("agent: the download helper is a real Blob download", AG.downloadScript(win.script, "x.ps1") === true);
      probe.remove();

      check("agent: every canonical file stays in the rmm namespace", Object.keys(srv.files).every((n) => n.indexOf("rmm-v1-") === 0), JSON.stringify(Object.keys(srv.files)));
    } catch (e) {
      check("agent: harness did not crash", false, (e && e.stack) || String(e));
    } finally {
      try { store.useBackend(null); } catch (e) {}
      try { store.resetAllLocal(); } catch (e) {}
      try { T.reload(); } catch (e) {}
    }

    const passed = results.filter((r) => r.ok).length;
    const failed = results.length - passed;
    return { passed, failed, results };
  };

  /* ============================================================
     Task 9 validation tests — system inventory collection
     Run via page_eval:  await window.RMMInventoryTest()
     Covers: normalisation + deterministic ordering, the FNV hash,
     the per-section delta (added/removed/changed), apply() round-trip,
     the bounded per-device delta log, the software cap, an
     authenticated full submit (snapshot + delta + compact device
     summary + asset reconciliation), a no-op revision, a delta submit,
     the tenant software/patch/security roll-ups, collection requests
     (with capability gating), stats and the agent-side payload helper.
     Runs against a stub backend so the real documents are untouched.
     ============================================================ */
  window.RMMInventoryTest = async function (opts) {
    opts = opts || {};
    results.length = 0;
    const ERP = window.ERP;
    const store = ERP.store;
    const T = ERP.tenancy;
    const D = ERP.devices;
    const E = ERP.enrollment;
    const INV = ERP.rmmInventory;
    const uid = Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
    const clone = (v) => JSON.parse(JSON.stringify(v));

    function makeServer() {
      const files = {};
      return {
        files,
        async get(name) { return Object.prototype.hasOwnProperty.call(files, name) ? files[name] : null; },
        async set(name, json) {
          const prev = files[name];
          const created = prev === undefined;
          files[name] = json;
          return { created, unchanged: prev === json, editKey: "k_" + name, superseded: false, error: null };
        },
      };
    }

    if (!INV) { check("inventory: ERP.rmmInventory exposed", false); return { passed: 0, failed: 1, results }; }

    try {
      check("inventory: ERP.rmmInventory exposed", typeof INV.normalize === "function" && typeof INV.diff === "function" && typeof INV.apply === "function" && typeof INV.submit === "function" && typeof INV.softwareIndex === "function" && typeof INV.requestCollection === "function");

      const winRaw = {
        hardware: { manufacturer: "Dell", model: "OptiPlex 7090", serial: "SN-" + uid, formFactor: "desktop", cpu: { model: "Core i7-11700", cores: 8, threads: 16, speedMhz: 2500 }, ramBytes: 17179869184, gpus: [{ model: "Intel UHD 750", memoryBytes: 0 }] },
        os: { family: "Windows", name: "Windows 11 Pro", version: "23H2", build: "22631", arch: "x64" },
        software: [
          { name: "Google Chrome", version: "122.0.0", publisher: "Google LLC", installDate: "2024-01-08", sizeBytes: 500000000 },
          { name: "Common", version: "4.2", publisher: "Shared" },
          { name: "Bar", version: "1.0", publisher: "Acme" },
        ],
        services: [{ name: "WinDefend", displayName: "Microsoft Defender", state: "running", startType: "Automatic" }],
        patches: [{ id: "KB5034765", title: "Cumulative update", classification: "Security Updates", installedOn: "2024-02-14" }],
        disks: [{ label: "C:", kind: "ssd", sizeBytes: 512000000000, freeBytes: 210000000000, filesystem: "NTFS" }],
        interfaces: [{ name: "Ethernet", mac: "AA:BB:CC:DD:EE:01", ip4: ["10.0.0.5"], gateway: "10.0.0.1", dhcp: true }],
        users: [{ name: "Administrator", domain: "CORP", enabled: true, admin: true, lastLogon: "2024-02-25T09:14:00Z" }],
        groups: [{ name: "Administrators", members: ["Administrator"], admin: true }],
        security: { antivirus: [{ name: "Microsoft Defender Antivirus", enabled: true, upToDate: true }], firewall: { enabled: true }, encryption: { systemDrive: true, method: "BitLocker", percentEncrypted: 100 }, secureBoot: true, pendingReboot: false },
        backup: { status: "ok", lastRunAt: "2024-02-25T02:00:00Z", lastResult: "Success", provider: "Veeam Agent" },
      };
      const linuxRaw = {
        hardware: { manufacturer: "Dell", model: "PowerEdge R650", serial: "SRV-" + uid, formFactor: "rack", cpu: { model: "Xeon Silver 4310", cores: 12, threads: 24, speedMhz: 2100 }, ramBytes: 68719476736, gpus: [] },
        os: { family: "Linux", name: "Ubuntu 22.04", version: "22.04.4", arch: "x64" },
        software: [
          { name: "Common", version: "4.1", publisher: "Shared" },
          { name: "nginx", version: "1.18.0", publisher: "Ubuntu" },
        ],
        services: [{ name: "nginx.service", displayName: "nginx", state: "running", startType: "enabled" }],
        patches: [{ id: "USN-6666-1", title: "linux-image security update", classification: "Security", installedOn: "2024-02-22" }],
        disks: [{ label: "/", kind: "ssd", sizeBytes: 1000000000000, freeBytes: 400000000000, filesystem: "ext4" }],
        interfaces: [{ name: "ens192", mac: "AA:BB:CC:DD:EE:02", ip4: ["10.0.0.9"], gateway: "10.0.0.1", dhcp: false }],
        users: [{ name: "root", domain: "", enabled: true, admin: true, lastLogon: "2024-02-25T03:00:00Z" }],
        groups: [{ name: "sudo", members: ["root"], admin: true }],
        security: { antivirus: [{ name: "ClamAV", enabled: true, upToDate: false }], firewall: { enabled: true }, encryption: { systemDrive: false }, secureBoot: true, pendingReboot: true },
        backup: { status: "failed", lastRunAt: "2024-02-24T23:00:00Z", lastResult: "Backup target offline", provider: "restic" },
      };

      /* ── pure helpers ── */
      const a1 = INV.normalize(winRaw);
      const a2 = INV.normalize(clone(winRaw));
      check("inventory: normalisation is deterministic", INV.stableStringify(a1) === INV.stableStringify(a2));
      check("inventory: identical inventories hash equal", INV.hashOf(a1) === INV.hashOf(a2));
      check("inventory: array sections are sorted by key", a1.software.map((s) => INV.keyFor("software", s)).join("|") === a1.software.map((s) => INV.keyFor("software", s)).slice().sort().join("|"));
      check("inventory: stableStringify ignores key order", INV.stableStringify({ a: 1, b: 2 }) === INV.stableStringify({ b: 2, a: 1 }));
      check("inventory: the software cap is enforced", INV.normalize({ software: Array.from({ length: INV.SOFTWARE_CAP() + 120 }, (_, i) => ({ name: "App" + i })) }).software.length === INV.SOFTWARE_CAP());
      check("inventory: keyFor uses publisher|name for software", INV.keyFor("software", { publisher: "Acme", name: "Foo" }) === "acme|foo");
      check("inventory: keyFor scopes a local user by domain", INV.keyFor("users", { domain: "CORP", name: "joe" }) === "corp\\joe");
      check("inventory: itemLabel shows a title and version", INV.itemLabel("software", { name: "Foo", version: "1.2" }) === "Foo 1.2");

      const d0 = INV.diff(winRaw, winRaw);
      check("inventory: an unchanged compare reports no changes", d0.changed === false && d0.counts.added === 0 && d0.counts.removed === 0 && d0.counts.changed === 0);
      const dNull = INV.diff(null, winRaw);
      check("inventory: the first compare reports everything added", dNull.changed === true && dNull.counts.added > 0);

      const mod = clone(winRaw);
      mod.software[0].version = "99.0";
      mod.software = mod.software.filter((s) => s.name !== "Bar");
      mod.software.push({ name: "NewApp", version: "2.0", publisher: "Zed" });
      const dMod = INV.diff(winRaw, mod);
      const sw = dMod.sections.software;
      check("inventory: diff classifies added/removed/changed", !!sw && sw.counts.added === 1 && sw.counts.removed === 1 && sw.counts.changed === 1, JSON.stringify(sw && sw.counts));
      check("inventory: a changed item records before/after", sw.changed.length === 1 && sw.changed[0].before.version !== sw.changed[0].after.version);
      check("inventory: apply(prev, diff) round-trips", INV.stableStringify(INV.apply(winRaw, dMod)) === INV.stableStringify(INV.normalize(mod)));
      check("inventory: scalar field changes are captured per-field", (function () { const m2 = clone(winRaw); m2.backup.status = "failed"; const dd = INV.diff(winRaw, m2); return !!dd.sections.backup && dd.sections.backup.fields.indexOf("status") !== -1; })());

      /* ── backend ── */
      const srv = makeServer();
      store.useBackend(srv);
      store.resetAllLocal();
      T.reload();

      const prov = await T.create({ name: "Inv " + uid, sites: [{ id: "site-" + uid, name: "HQ" }], deviceGroups: [{ id: "grp-" + uid, name: "Workstations", siteId: "site-" + uid }] });
      const pid = prov.provider.id;
      const t1 = await E.issueToken({ providerId: pid });
      const en1 = await E.enroll({ token: t1.token, hostname: "INV-WS1", os: { name: "Windows 11 Pro" }, device: { role: "workstation", manufacturer: "Dell" } });
      const dev1 = en1.deviceId, cred1 = en1.credential;
      const t2 = await E.issueToken({ providerId: pid });
      const en2 = await E.enroll({ token: t2.token, hostname: "INV-SRV2", os: { name: "Ubuntu 22.04" }, device: { role: "server" } });
      const dev2 = en2.deviceId, cred2 = en2.credential;

      check("inventory: submit requires a device", (await INV.submit({})).error === "no_device");
      check("inventory: submit refuses a bad credential", (await INV.submit({ deviceId: dev1, credential: "cred_BAD", payload: { mode: "full", inventory: winRaw } })).error === "invalid_credential");
      check("inventory: a delta before a baseline is refused", (await INV.submit({ deviceId: dev1, credential: cred1, payload: { mode: "delta", delta: { sections: {} } } })).error === "no_baseline");

      const r1 = await INV.submit({ deviceId: dev1, credential: cred1, payload: { mode: "full", inventory: winRaw, collectedAt: "2024-03-01T10:00:00Z" } });
      check("inventory: the first full submit creates revision 1", r1.ok === true && r1.revision === 1 && r1.changed === true, JSON.stringify({ ok: r1.ok, rev: r1.revision, err: r1.error }));
      check("inventory: the snapshot is stored", (await INV.snapshot(dev1)).revision === 1);
      check("inventory: the delta log records the first change", (await INV.deltas(dev1)).length === 1);
      const g1 = await D.get(pid, dev1);
      check("inventory: the device carries a compact summary", !!g1.device.custom.inventory && g1.device.custom.inventory.revision === 1, JSON.stringify(g1.device.custom.inventory && g1.device.custom.inventory.security));
      check("inventory: the device's asset fields are reconciled", g1.device.manufacturer === "Dell" && g1.device.model === "OptiPlex 7090" && g1.device.serial === "SN-" + uid);
      check("inventory: the summary carries AV/backup posture", g1.device.custom.inventory.security.avEnabled === true && g1.device.custom.inventory.backup.status === "ok");

      const r2 = await INV.submit({ deviceId: dev1, credential: cred1, payload: { mode: "full", inventory: clone(winRaw), collectedAt: "2024-03-01T11:00:00Z" } });
      check("inventory: an unchanged full collection is a no-op revision", r2.ok === true && r2.noChange === true && r2.revision === 1, JSON.stringify(r2));
      check("inventory: the no-op still moves the collected stamp", r2.collectedAt === "2024-03-01T11:00:00.000Z");
      check("inventory: delta mode requires a delta payload", (await INV.submit({ deviceId: dev1, credential: cred1, payload: { mode: "delta" } })).error === "no_delta");

      const dMod2 = INV.diff(winRaw, mod);
      const r3 = await INV.submit({ deviceId: dev1, credential: cred1, payload: { mode: "delta", delta: { sections: dMod2.sections, counts: dMod2.counts, changed: dMod2.changed }, collectedAt: "2024-03-02T10:00:00Z" } });
      check("inventory: a delta bumps the revision", r3.ok === true && r3.revision === 2, JSON.stringify({ ok: r3.ok, rev: r3.revision, err: r3.error }));
      const snap3 = await INV.snapshot(dev1);
      check("inventory: a delta is applied to the snapshot", snap3.sections.software.some((s) => s.name === "NewApp") && !snap3.sections.software.some((s) => s.name === "Bar"));

      const r4 = await INV.submit({ deviceId: dev2, credential: cred2, payload: { mode: "full", inventory: linuxRaw, collectedAt: "2024-03-02T09:00:00Z" } });
      check("inventory: a second device keeps its own snapshot", r4.ok === true && (await INV.listSnapshots(pid)).length === 2);

      const limit = INV.DELTA_LIMIT();
      const swBase = mod.software.slice();
      for (let i = 0; i < limit + 3; i++) {
        const inv2 = clone(winRaw);
        inv2.software = swBase.concat([{ name: "Rollup" + i, version: "1", publisher: "Test", installDate: "2024-03-03" }]);
        await INV.submit({ deviceId: dev1, credential: cred1, payload: { mode: "full", inventory: inv2, collectedAt: new Date(Date.UTC(2024, 2, 3, 0, i)).toISOString() } });
      }
      const deltasAfter = await INV.deltas(dev1);
      check("inventory: the delta log is bounded", deltasAfter.length === limit, "deltas=" + deltasAfter.length + " limit=" + limit);

      const si = await INV.softwareIndex(pid);
      const shared = si.find((r) => r.key === INV.keyFor("software", { publisher: "Shared", name: "Common" }));
      check("inventory: the software index aggregates across devices", !!shared && shared.deviceCount === 2, shared ? "n=" + shared.deviceCount : "missing");
      check("inventory: the software index lists versions + device counts", si.length > 0 && si.every((r) => r.deviceCount >= 1 && Array.isArray(r.versions)));
      const pi = await INV.patchIndex(pid);
      check("inventory: the patch index aggregates patches", pi.length >= 2 && pi.every((r) => r.deviceCount >= 1));
      const sr = await INV.securityRollup(pid);
      check("inventory: the security rollup counts posture", sr.devices === 2 && sr.withInventory === 2 && sr.avProtected === 2 && sr.avOutdated === 1, JSON.stringify({ d: sr.devices, wi: sr.withInventory, avp: sr.avProtected, avo: sr.avOutdated }));
      check("inventory: the rollup covers firewall/encryption/backup", sr.firewallOn === 2 && sr.encrypted === 1 && sr.secureBootOn === 2 && sr.pendingReboot === 1 && sr.backupsOk === 1 && sr.backupsFailed === 1, JSON.stringify(sr));
      check("inventory: the rollup exposes a per-device row", sr.rows.length === 2 && sr.rows.every((r) => r.hostname && r.collectedAt));

      const rc = await INV.requestCollection(pid);
      check("inventory: a collection request is queued for agents", rc.ok === true && rc.requested === 2, JSON.stringify(rc));
      check("inventory: the request is stored on the device", !!(await D.get(pid, dev1)).device.custom.inventoryRequestedAt);
      await D.update(pid, dev2, { agent: Object.assign({}, (await D.get(pid, dev2)).device.agent, { capabilities: ["jobs"] }) });
      const rc2 = await INV.requestCollection(pid, [dev2]);
      check("inventory: a device without the capability is skipped", rc2.unsupported === 1 && rc2.requested === 0, JSON.stringify(rc2));

      const st = await INV.stats(pid);
      check("inventory: stats summarise snapshots + deltas", st.snapshots === 2 && st.deltas >= 2 && st.software > 0, JSON.stringify(st));
      check("inventory: hasSnapshot", (await INV.hasSnapshot(dev1)) === true && (await INV.hasSnapshot("dev-none")) === false);
      const ap1 = INV.agentPayload(null, winRaw);
      check("inventory: the agent sends a full payload first", ap1.mode === "full" && !!ap1.inventory);
      const ap2 = INV.agentPayload(winRaw, clone(mod));
      check("inventory: the agent then sends only a delta", ap2.mode === "delta" && ap2.delta.changed === true && !ap2.inventory);
      const demo = INV.demoInventory((await D.get(pid, dev1)).device);
      check("inventory: the demo inventory is a full snapshot", !!demo.hardware && !!demo.os && demo.software.length > 0 && !!demo.security);

      check("inventory: every canonical file stays in the rmm namespace", Object.keys(srv.files).every((n) => n.indexOf("rmm-v1-") === 0), JSON.stringify(Object.keys(srv.files)));
    } catch (e) {
      check("inventory: harness did not crash", false, (e && e.stack) || String(e));
    } finally {
      try { store.useBackend(null); } catch (e) {}
      try { store.resetAllLocal(); } catch (e) {}
      try { T.reload(); } catch (e) {}
    }

    const passed = results.filter((r) => r.ok).length;
    const failed = results.length - passed;
    return { passed, failed, results };
  };

  /* ============================================================
     Task 10 validation tests — performance metrics collection
     Run via page_eval:  await window.RMMMetricsTest()
     Covers: the metric catalogue, sample normalisation/clamping,
     extraction, incremental aggregation, the tiered raw/hourly/daily
     rings and their bounds, an authenticated batch submit (with the
     per-post cap), the latest/range/fleetSeries reads, fleet pressure,
     stats/retention, sampling requests (with capability gating) and
     the device summary + uptime helpers.
     Runs against a stub backend so the real documents are untouched.
     ============================================================ */
  window.RMMMetricsTest = async function (opts) {
    opts = opts || {};
    results.length = 0;
    const ERP = window.ERP;
    const store = ERP.store;
    const T = ERP.tenancy;
    const D = ERP.devices;
    const E = ERP.enrollment;
    const MET = ERP.metrics;
    const uid = Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);

    function makeServer() {
      const files = {};
      return {
        files,
        async get(name) { return Object.prototype.hasOwnProperty.call(files, name) ? files[name] : null; },
        async set(name, json) {
          const prev = files[name];
          const created = prev === undefined;
          files[name] = json;
          return { created, unchanged: prev === json, editKey: "k_" + name, superseded: false, error: null };
        },
      };
    }

    if (!MET) { check("metrics: ERP.metrics exposed", false); return { passed: 0, failed: 1, results }; }

    try {
      check("metrics: ERP.metrics exposed", typeof MET.submit === "function" && typeof MET.append === "function" && typeof MET.range === "function" && typeof MET.pressure === "function" && typeof MET.requestSample === "function");
      check("metrics: the catalogue covers the core counters", MET.CATALOG.length >= 8 && ["cpuPct", "memPct", "diskPct", "netRxBps", "latencyMs"].every((id) => !!MET.metricMeta(id)));

      const n1 = MET.normalizeSample({ t: "2024-03-01T10:00:00Z", cpuPct: 150, memPct: -5, custom: { q: 3, bad: "x" } });
      check("metrics: a sample is normalised and clamped", !!n1 && n1.cpuPct === 100 && n1.memPct === 0 && n1.at === "2024-03-01T10:00:00.000Z");
      check("metrics: a sample without a timestamp is rejected", MET.normalizeSample({ cpuPct: 10 }) === null);
      check("metrics: custom counters keep numeric extras only", n1.custom.q === 3 && n1.custom.bad === undefined);
      check("metrics: at/t/time/timestamp all supply the time", !!MET.normalizeSample({ at: "2024-01-01T00:00:00Z", cpuPct: 1 }).at && !!MET.normalizeSample({ timestamp: 1700000000000, cpuPct: 1 }).at);
      const ex = MET.extract(n1);
      check("metrics: extract flattens the catalogue + custom", ex.cpuPct === 100 && ex["custom:q"] === 3);

      const agg = MET.rollup([{ at: "2024-03-01T10:00:00Z", cpuPct: 10 }, { at: "2024-03-01T10:01:00Z", cpuPct: 20 }, { at: "2024-03-01T10:02:00Z", cpuPct: 30 }]);
      const av = MET.aggValues(agg).cpuPct;
      check("metrics: rollup computes avg/min/max/last", av.avg === 20 && av.min === 10 && av.max === 30 && av.last === 30 && av.count === 3, JSON.stringify(av));

      const rec = {};
      const base = Date.UTC(2024, 2, 1, 0, 0, 0);
      for (let i = 0; i < MET.RAW_LIMIT() + 6; i++) MET.append(rec, { at: new Date(base + i * 60000).toISOString(), cpuPct: i % 100, memPct: 50 });
      check("metrics: the raw ring is bounded", rec.raw.length === MET.RAW_LIMIT() && rec.sampleCount === MET.RAW_LIMIT() + 6, "raw=" + rec.raw.length);
      check("metrics: samples fold into hourly + daily buckets", rec.hourly.length >= 1 && rec.daily.length === 1, "h=" + rec.hourly.length + " d=" + rec.daily.length);
      check("metrics: appending an invalid sample is refused", !!MET.append({}, { cpuPct: 1 }).error);
      check("metrics: hour/day buckets are UTC-aligned", MET.hourBucket("2024-03-01T10:23:45Z") === "2024-03-01T10:00:00.000Z" && MET.dayBucket("2024-03-01T10:23:45Z") === "2024-03-01");
      const rec2 = {};
      for (let h = 0; h < MET.HOURLY_LIMIT() + 4; h++) MET.append(rec2, { at: new Date(Date.UTC(2024, 0, 1) + h * 3600000).toISOString(), cpuPct: 10 });
      check("metrics: the hourly ring is bounded", rec2.hourly.length === MET.HOURLY_LIMIT(), "h=" + rec2.hourly.length);

      /* ── backend ── */
      const srv = makeServer();
      store.useBackend(srv);
      store.resetAllLocal();
      T.reload();

      const prov = await T.create({ name: "Met " + uid, sites: [{ id: "site-" + uid, name: "HQ" }] });
      const pid = prov.provider.id;
      const t1 = await E.issueToken({ providerId: pid });
      const en1 = await E.enroll({ token: t1.token, hostname: "MET-WS1", os: { name: "Windows 11" }, device: { role: "workstation" } });
      const dev1 = en1.deviceId, cred1 = en1.credential;
      const t2 = await E.issueToken({ providerId: pid });
      const en2 = await E.enroll({ token: t2.token, hostname: "MET-SRV2", os: { name: "Ubuntu 22.04" }, device: { role: "server" } });
      const dev2 = en2.deviceId, cred2 = en2.credential;

      check("metrics: submit requires a device", (await MET.submit({})).error === "no_device");
      check("metrics: submit refuses a bad credential", (await MET.submit({ deviceId: dev1, credential: "cred_BAD", payload: { samples: [{ at: new Date().toISOString(), cpuPct: 1 }] } })).error === "invalid_credential");
      check("metrics: submit rejects an empty batch", (await MET.submit({ deviceId: dev1, credential: cred1, payload: { samples: [] } })).error === "no_samples");

      const nowT = Date.now();
      const many = Array.from({ length: 100 }, (_, i) => ({ at: new Date(nowT - (100 - i) * 60000).toISOString(), cpuPct: 20 + (i % 10), memPct: 40, diskPct: 55, uptimeSeconds: 100000 + i * 60, latencyMs: 12 }));
      const rs = await MET.submit({ deviceId: dev1, credential: cred1, payload: { samples: many } });
      check("metrics: a batch is capped at the per-post limit", rs.ok === true && rs.accepted === MET.MAX_SAMPLES_PER_POST() && rs.clipped === true, JSON.stringify({ a: rs.accepted, c: rs.clipped, e: rs.error }));
      check("metrics: the series holds the latest sample", rs.rawPoints === MET.MAX_SAMPLES_PER_POST() && !!rs.latest && rs.latest.cpuPct != null);
      const g1 = await D.get(pid, dev1);
      check("metrics: the device carries a live metrics summary", !!g1.device.custom.metrics && g1.device.custom.metrics.sampleCount === MET.MAX_SAMPLES_PER_POST() && g1.device.custom.metrics.cpuPct != null, JSON.stringify(g1.device.custom.metrics));
      const lat = await MET.latest(dev1);
      check("metrics: latest() returns the newest sample", !!lat && lat.memPct === 40);

      const rs2 = await MET.submit({ deviceId: dev2, credential: cred2, payload: { samples: [{ at: new Date(nowT).toISOString(), cpuPct: 92, memPct: 70, diskPct: 60 }] } });
      check("metrics: a second device gets its own series", rs2.ok === true && (await MET.listSeries(pid)).length === 2);

      const rec1 = await MET.series(dev1);
      const rangeRaw = MET.range(rec1, "cpuPct", "auto");
      check("metrics: range auto-selects the raw tier for a short window", rangeRaw.length > 0 && rangeRaw.length <= MET.RAW_LIMIT());
      const rangeHour = MET.range(rec1, "cpuPct", "hourly");
      check("metrics: range can read a rollup tier", rangeHour.length >= 1 && rangeHour.every((p) => p.value != null && p.min != null && p.max != null));
      const fleet = MET.fleetSeries(await MET.listSeries(pid), "cpuPct", "hourly");
      check("metrics: fleetSeries averages buckets across devices", fleet.length >= 1 && fleet.every((p) => p.value != null), JSON.stringify(fleet));
      const pr = await MET.pressure(pid);
      check("metrics: pressure flags a hot device", pr.rows.length === 2 && pr.hot >= 1, JSON.stringify({ hot: pr.hot }));
      const st = await MET.stats(pid);
      check("metrics: stats summarise retention + samples", st.reporting === 2 && st.samples >= MET.MAX_SAMPLES_PER_POST() + 1 && st.retention.raw === MET.RAW_LIMIT(), JSON.stringify(st));
      check("metrics: uptime is humanised", MET.uptimeHuman(90061) === "1d 1h 1m");
      check("metrics: the device summary helper reads custom.metrics", !!MET.summary((await D.get(pid, dev1)).device).latestAt);

      const rq = await MET.requestSample(pid);
      check("metrics: a sampling request reaches every capable agent", rq.ok === true && rq.requested === 2, JSON.stringify(rq));
      check("metrics: the request is stored on the device", !!(await D.get(pid, dev1)).device.custom.metricsRequestedAt);
      await D.update(pid, dev2, { agent: Object.assign({}, (await D.get(pid, dev2)).device.agent, { capabilities: ["inventory"] }) });
      const rq2 = await MET.requestSample(pid, [dev2]);
      check("metrics: a device without the capability is skipped", rq2.unsupported === 1 && rq2.requested === 0);

      check("metrics: every canonical file stays in the rmm namespace", Object.keys(srv.files).every((n) => n.indexOf("rmm-v1-") === 0), JSON.stringify(Object.keys(srv.files)));
    } catch (e) {
      check("metrics: harness did not crash", false, (e && e.stack) || String(e));
    } finally {
      try { store.useBackend(null); } catch (e) {}
      try { store.resetAllLocal(); } catch (e) {}
      try { T.reload(); } catch (e) {}
    }

    const passed = results.filter((r) => r.ok).length;
    const failed = results.length - passed;
    return { passed, failed, results };
  };

  /* ============================================================
     Task 11 validation tests — command & script execution (jobs)
     Run via page_eval:  await window.RMMJobsTest()
     Covers: the per-OS language catalogue + compatibility, command
     lines, job enqueue validation, the authenticated claim (delivery,
     one-shot delivery, unsupported-language refusal instead of a run),
     result posting (success/failure/timeout, idempotency, output
     bounding), multi-device aggregate states, state derivation + tones,
     cancel/retry, the reap maintenance (stale-delivery requeue,
     timeout, expiry, retention pruning), stats/reads and the device +
     console UI.  Runs against a stub backend so the real documents are
     untouched.
     ============================================================ */
  window.RMMJobsTest = async function (opts) {
    opts = opts || {};
    results.length = 0;
    const ERP = window.ERP;
    const store = ERP.store;
    const T = ERP.tenancy;
    const D = ERP.devices;
    const E = ERP.enrollment;
    const J = ERP.jobs;
    const uid = Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);

    function makeServer() {
      const files = {};
      return {
        files,
        async get(name) { return Object.prototype.hasOwnProperty.call(files, name) ? files[name] : null; },
        async set(name, json) {
          const prev = files[name];
          const created = prev === undefined;
          files[name] = json;
          return { created, unchanged: prev === json, editKey: "k_" + name, superseded: false, error: null };
        },
      };
    }

    if (!J) { check("jobs: ERP.jobs exposed", false); return { passed: 0, failed: 1, results }; }

    try {
      check("jobs: ERP.jobs exposed", typeof J.enqueue === "function" && typeof J.claim === "function" && typeof J.result === "function" && typeof J.reap === "function" && typeof J.renderJobs === "function");
      check("jobs: the language catalogue spans the platforms", J.LANGUAGES.length >= 5 && !!J.language("powershell") && !!J.language("bash") && !!J.language("python"));
      check("jobs: compatibility is per OS family", J.compatible("powershell", "Windows") === true && J.compatible("powershell", "Linux") === false && J.compatible("bash", "Linux") === true && J.compatible("bash", "Windows") === false && J.compatible("python", "Windows") === true && J.compatible("python", "macOS") === true);
      check("jobs: the OS family is inferred from a device", J.familyOf({ os: { name: "Windows Server 2022" } }) === "Windows" && J.familyOf({ os: { name: "Ubuntu 22.04" } }) === "Linux" && J.familyOf({ os: { family: "macOS" } }) === "macOS");
      check("jobs: the Windows command line is powershell -File", /powershell\.exe[\s\S]*job\.ps1/.test(J.commandLine({ language: "powershell" }, "Windows")));
      check("jobs: the Linux command line is /bin/bash", /\/bin\/bash[\s\S]*job\.sh/.test(J.commandLine({ language: "bash" }, "Linux")));
      check("jobs: arguments are appended to the command", J.commandLine({ language: "bash", args: ["--flag", "x"] }, "Linux").indexOf("--flag x") !== -1);

      /* ── backend ── */
      const srv = makeServer();
      store.useBackend(srv);
      store.resetAllLocal();
      T.reload();

      const prov = await T.create({ name: "Jobs " + uid, sites: [{ id: "site-" + uid, name: "HQ" }] });
      const pid = prov.provider.id;
      const t1 = await E.issueToken({ providerId: pid });
      const en1 = await E.enroll({ token: t1.token, hostname: "JOB-WS1", os: { name: "Windows 11" }, device: { role: "workstation" } });
      const dev1 = en1.deviceId, cred1 = en1.credential;
      const t2 = await E.issueToken({ providerId: pid });
      const en2 = await E.enroll({ token: t2.token, hostname: "JOB-SRV2", os: { name: "Ubuntu 22.04" }, device: { role: "server" } });
      const dev2 = en2.deviceId, cred2 = en2.credential;

      check("jobs: enqueue needs a provider", !!(await J.enqueue({ deviceIds: [dev1], language: "powershell", script: "x" })).error);
      check("jobs: enqueue rejects an unknown language", (await J.enqueue({ providerId: pid, deviceIds: [dev1], language: "cobol", script: "x" })).error === "unknown_language");
      check("jobs: enqueue rejects an empty script", (await J.enqueue({ providerId: pid, deviceIds: [dev1], language: "powershell", script: "  " })).error === "empty_script");
      check("jobs: enqueue needs at least one target", (await J.enqueue({ providerId: pid, language: "powershell", script: "x" })).error === "no_targets");
      check("jobs: enqueue ignores unknown devices", (await J.enqueue({ providerId: pid, deviceIds: ["dev-nope"], language: "powershell", script: "x" })).error === "no_targets");

      const jq = await J.enqueue({ providerId: pid, deviceIds: [dev1], name: "Hello", language: "powershell", script: 'Write-Output "hi"' });
      const jobId = jq.job.id;
      check("jobs: a job is queued for its targets", jq.ok === true && jq.job.state === "queued" && jq.job.targets.length === 1 && jq.job.results[dev1].state === "queued", JSON.stringify({ s: jq.job.state }));

      check("jobs: claim refuses a bad credential", (await J.claim({ deviceId: dev1, credential: "cred_BAD" })).ok === false);
      const c1 = await J.claim({ deviceId: dev1, credential: cred1 });
      check("jobs: claim delivers the queued job with a command", c1.ok === true && c1.count === 1 && c1.jobs[0].jobId === jobId && /job\.ps1/.test(c1.jobs[0].command) && c1.jobs[0].attempt === 1, JSON.stringify({ c: c1.count }));
      check("jobs: a delivered job is not delivered twice", (await J.claim({ deviceId: dev1, credential: cred1 })).count === 0);
      check("jobs: the job is marked delivered", J.deriveState((await J.get(pid, jobId)).job) === "delivered");

      const rr = await J.result({ jobId: jobId, deviceId: dev1, credential: cred1, exitCode: 0, stdout: "hi\n", stderr: "", startedAt: new Date(Date.now() - 2000).toISOString(), endedAt: new Date().toISOString() });
      check("jobs: a zero exit code is a success", rr.ok === true && rr.deviceState === "succeeded" && J.deriveState(rr.job) === "succeeded");
      check("jobs: the result captures output + duration", rr.job.results[dev1].stdout === "hi\n" && rr.job.results[dev1].durationMs >= 0);
      check("jobs: a duplicate result is idempotent", (await J.result({ jobId: jobId, deviceId: dev1, credential: cred1, exitCode: 1 })).duplicate === true);
      check("jobs: the duplicate did not overwrite the result", (await J.get(pid, jobId)).job.results[dev1].exitCode === 0);

      const jf = (await J.enqueue({ providerId: pid, deviceIds: [dev1], name: "Fail", language: "powershell", script: "exit 1" })).job.id;
      await J.claim({ deviceId: dev1, credential: cred1 });
      const rf = await J.result({ jobId: jf, deviceId: dev1, credential: cred1, exitCode: 1, stderr: "boom" });
      check("jobs: a non-zero exit code is a failure", rf.deviceState === "failed" && (await J.get(pid, jf)).job.results[dev1].stderr === "boom");

      const jt = (await J.enqueue({ providerId: pid, deviceIds: [dev1], name: "Timeout", language: "powershell", script: "sleep" })).job.id;
      await J.claim({ deviceId: dev1, credential: cred1 });
      const rt = await J.result({ jobId: jt, deviceId: dev1, credential: cred1, state: "timed-out", error: "killed" });
      check("jobs: a timed-out run is recorded", rt.deviceState === "timed-out" && (await J.get(pid, jt)).job.results[dev1].state === "timed-out");

      const ju = (await J.enqueue({ providerId: pid, deviceIds: [dev1], name: "BadLang", language: "bash", script: "echo hi" })).job.id;
      const cu = await J.claim({ deviceId: dev1, credential: cred1 });
      const juRec = (await J.get(pid, ju)).job;
      check("jobs: an incompatible language fails instead of running", cu.jobs.every((j) => j.jobId !== ju) && juRec.results[dev1].state === "unsupported" && /not supported/.test(juRec.results[dev1].error || ""));
      check("jobs: a wholly-unsupported job derives 'unsupported'", J.deriveState(juRec) === "unsupported");

      const jb = (await J.enqueue({ providerId: pid, deviceIds: [dev1], name: "Big", language: "powershell", script: "noisy" })).job.id;
      await J.claim({ deviceId: dev1, credential: cred1 });
      await J.result({ jobId: jb, deviceId: dev1, credential: cred1, exitCode: 0, stdout: new Array(J.OUTPUT_BYTES() + 5000).join("a") });
      const bigOut = (await J.get(pid, jb)).job.results[dev1].stdout;
      check("jobs: oversized output is truncated + marked", bigOut.length < J.OUTPUT_BYTES() + 200 && /truncated/.test(bigOut), "len=" + bigOut.length);

      const jp = (await J.enqueue({ providerId: pid, deviceIds: [dev1, dev2], name: "Fleet", language: "python", script: "print(1)" })).job.id;
      await J.claim({ deviceId: dev1, credential: cred1 });
      await J.result({ jobId: jp, deviceId: dev1, credential: cred1, exitCode: 0 });
      await J.claim({ deviceId: dev2, credential: cred2 });
      await J.result({ jobId: jp, deviceId: dev2, credential: cred2, exitCode: 1, stderr: "no" });
      const jpRec = (await J.get(pid, jp)).job;
      check("jobs: a mixed fleet derives 'partial'", J.deriveState(jpRec) === "partial" && J.count(jpRec, "succeeded") === 1 && J.count(jpRec, ["failed"]) === 1, JSON.stringify({ s: J.deriveState(jpRec) }));

      const mk = (states) => ({ targets: Object.keys(states), results: Object.fromEntries(Object.entries(states).map((e) => [e[0], { state: e[1] }])) });
      check("jobs: deriveState covers queued/succeeded/failed", J.deriveState(mk({ a: "queued" })) === "queued" && J.deriveState(mk({ a: "succeeded", b: "succeeded" })) === "succeeded" && J.deriveState(mk({ a: "failed", b: "failed" })) === "failed");
      check("jobs: deriveState covers running/delivered", J.deriveState(mk({ a: "running" })) === "running" && J.deriveState(mk({ a: "delivered" })) === "delivered");
      check("jobs: deriveState covers expired + cancelled", J.deriveState(mk({ a: "expired" })) === "expired" && J.deriveState(mk({ a: "cancelled" })) === "cancelled");
      check("jobs: state tones map to badge tones", J.stateTone("succeeded") === "success" && J.stateTone("failed") === "danger" && J.stateTone("running") === "info" && J.stateTone("partial") === "warn");

      const jc = (await J.enqueue({ providerId: pid, deviceIds: [dev1], name: "Cancel me", language: "powershell", script: "x" })).job.id;
      const cj = await J.cancel(pid, jc);
      check("jobs: cancelling marks the run cancelled", cj.ok === true && J.deriveState(cj.job) === "cancelled" && cj.job.results[dev1].state === "cancelled");
      check("jobs: a cancelled job is not delivered", (await J.claim({ deviceId: dev1, credential: cred1 })).jobs.every((j) => j.jobId !== jc));

      const jr = (await J.enqueue({ providerId: pid, deviceIds: [dev1], name: "Retry me", language: "powershell", script: "x" })).job.id;
      await J.claim({ deviceId: dev1, credential: cred1 });
      await J.result({ jobId: jr, deviceId: dev1, credential: cred1, exitCode: 1 });
      const ret = await J.retry(pid, jr);
      check("jobs: retry re-queues a failed run", ret.ok === true && ret.retried === 1 && (await J.get(pid, jr)).job.results[dev1].state === "queued");
      check("jobs: retrying a healthy run is refused", !!(await J.retry(pid, jr)).error);

      const setDeliveredAgo = async (id, dev, ms) => {
        const recs = await J.load();
        const job = recs.find((r) => r.id === id);
        job.results[dev].deliveredAt = new Date(Date.now() - ms).toISOString();
        await store.saveDoc(J.MODULE, recs);
      };
      const jreap = (await J.enqueue({ providerId: pid, deviceIds: [dev1], name: "Stale delivery", language: "powershell", script: "x" })).job.id;
      await J.claim({ deviceId: dev1, credential: cred1 });
      await setDeliveredAgo(jreap, dev1, (J.DELIVERY_TIMEOUT_MIN() + 5) * 60000);
      const rp = await J.reap(pid);
      check("jobs: reap re-queues a stale delivery", rp.requeued >= 1 && (await J.get(pid, jreap)).job.results[dev1].state === "queued", JSON.stringify(rp));
      await J.claim({ deviceId: dev1, credential: cred1 });
      await setDeliveredAgo(jreap, dev1, (J.DELIVERY_TIMEOUT_MIN() + 5) * 60000);
      const rp2 = await J.reap(pid);
      check("jobs: reap times out a delivery that exhausts its attempts", rp2.timedOut >= 1 && (await J.get(pid, jreap)).job.results[dev1].state === "timed-out", JSON.stringify(rp2));

      const jexp = (await J.enqueue({ providerId: pid, deviceIds: [dev1], name: "Expire me", language: "powershell", script: "x" })).job.id;
      { const recs = await J.load(); const job = recs.find((r) => r.id === jexp); job.expiresAt = new Date(Date.now() - 60000).toISOString(); await store.saveDoc(J.MODULE, recs); }
      const rp3 = await J.reap(pid);
      check("jobs: reap expires a stale queue", rp3.expired >= 1 && (await J.get(pid, jexp)).job.results[dev1].state === "expired");

      { const recs = await J.load(); const job = recs.find((r) => r.id === jc); job.updatedAt = new Date(Date.now() - (J.RETENTION_HOURS() + 24) * 3600000).toISOString(); await store.saveDoc(J.MODULE, recs); }
      const rp4 = await J.reap(pid);
      check("jobs: reap prunes finished jobs past retention", rp4.pruned >= 1 && (await J.get(pid, jc)).error === "not_found");

      const st = await J.stats(pid);
      check("jobs: stats count states + success rate", st.jobs >= 6 && st.targets >= 1 && st.succeeded >= 1 && st.failed >= 1, JSON.stringify({ jobs: st.jobs, byState: st.byState }));
      const listed = await J.list(pid, { search: "Hello" });
      check("jobs: list filters by search", listed.length === 1 && listed[0].id === jobId);
      const djl = await J.deviceJobs(pid, dev1, 5);
      check("jobs: deviceJobs scopes to a device", djl.length >= 1 && djl.every((j) => j.targets.indexOf(dev1) !== -1));

      const probe = document.createElement("div");
      document.body.appendChild(probe);
      const dev = (await D.get(pid, dev1)).device;
      const sec = await J.deviceSection(dev, pid);
      check("jobs: the device modal shows the jobs section", /Jobs &amp; command execution/.test(sec) && /job-new/.test(sec));
      const provider = (await T.get(pid)).provider;
      await J.renderJobs(probe, { provider: provider, providerId: pid, state: { filter: "all", search: "" }, toast: function () {}, refresh: function () {} });
      check("jobs: the Jobs console renders stats + the run buttons", probe.querySelectorAll(".erp-stat").length >= 4 && !!probe.querySelector('[data-act="job-new-all"]') && !!probe.querySelector('[data-act="job-new-online"]') && !!probe.querySelector('[name="jobFilter"]'));
      check("jobs: the console lists jobs with an output action", !!probe.querySelector('[data-act="job-view"]'));
      probe.remove();
      check("jobs: resultPayload builds the agent contract", (function () { const p = J.resultPayload("job-1", "dev-1", { exitCode: 2, stdout: "x", stderr: "y" }); return p.jobId === "job-1" && p.deviceId === "dev-1" && p.exitCode === 2 && p.ok === false; })());

      /* ── binary-safe (base64) agent transport ── */
      check("jobs: the base64 codec is UTF-8 safe", J.fromB64(J.toB64("café ✓ 日本")) === "café ✓ 日本" && J.toB64("") === "" && J.fromB64("") === "");
      const j64 = (await J.enqueue({ providerId: pid, deviceIds: [dev1], name: "B64", language: "powershell", script: 'Write-Output "héllo"' })).job.id;
      const c64 = await J.claim({ deviceId: dev1, credential: cred1 });
      const job64 = c64.jobs.find((x) => x.jobId === j64);
      check("jobs: a claimed job carries a base64 script", !!job64 && job64.scriptB64 === J.toB64('Write-Output "héllo"') && J.fromB64(job64.scriptB64) === 'Write-Output "héllo"');
      check("jobs: a claimed job carries base64 args", !!job64 && J.fromB64(job64.argsB64) === "");
      const j64a = (await J.enqueue({ providerId: pid, deviceIds: [dev1], name: "B64 args", language: "powershell", script: "x", args: ["a b", 'q"z'] })).job.id;
      const c64a = await J.claim({ deviceId: dev1, credential: cred1 });
      const job64a = c64a.jobs.find((x) => x.jobId === j64a);
      check("jobs: args survive the base64 round-trip", !!job64a && J.fromB64(job64a.argsB64) === 'a b\nq"z');
      check("jobs: a base64 stdout result is decoded", (await (async () => { const r = await J.result({ jobId: j64a, deviceId: dev1, credential: cred1, exitCode: 0, stdoutB64: J.toB64("out ✓"), stderrB64: J.toB64("err ✓") }); const rec = (await J.get(pid, j64a)).job.results[dev1]; return r.ok === true && rec.stdout === "out ✓" && rec.stderr === "err ✓"; })()));
      check("jobs: the agent contract includes base64 output", (function () { const p = J.resultPayload("j", "d", { stdout: "hi ✓" }); return p.stdout === "hi ✓" && p.stdoutB64 === J.toB64("hi ✓"); })());

      check("jobs: every canonical file stays in the rmm namespace", Object.keys(srv.files).every((n) => n.indexOf("rmm-v1-") === 0));
    } catch (e) {
      check("jobs: harness did not crash", false, (e && e.stack) || String(e));
    } finally {
      try { store.useBackend(null); } catch (e) {}
      try { store.resetAllLocal(); } catch (e) {}
      try { T.reload(); } catch (e) {}
    }

    const passed = results.filter((r) => r.ok).length;
    const failed = results.length - passed;
    return { passed, failed, results };
  };

  /* ============================================================
     Task 12 — agent resilience, safety & self-update
     Run via page_eval:  await window.RMMResilienceTest()
     ============================================================ */
  window.RMMResilienceTest = async function (opts) {
    opts = opts || {};
    results.length = 0;
    const ERP = window.ERP;
    const store = ERP.store;
    const T = ERP.tenancy;
    const D = ERP.devices;
    const E = ERP.enrollment;
    const RS = ERP.resilience;
    const uid = Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);

    function makeServer() {
      const files = {};
      return {
        files,
        async get(name) { return Object.prototype.hasOwnProperty.call(files, name) ? files[name] : null; },
        async set(name, json) {
          const prev = files[name];
          const created = prev === undefined;
          files[name] = json;
          return { created, unchanged: prev === json, editKey: "k_" + name, superseded: false, error: null };
        },
      };
    }

    if (!RS) { check("resilience: ERP.resilience exposed", false); return { passed: 0, failed: 1, results }; }

    try {
      check("resilience: ERP.resilience exposed", typeof RS.policy === "function" && typeof RS.backoffMs === "function" && typeof RS.compareVersions === "function" && typeof RS.publishRelease === "function" && typeof RS.pushUpdate === "function" && typeof RS.rolloutStatus === "function");
      const p = RS.policy();
      check("resilience: the policy spans backoff/spool/caps/tls/self-update", p.version >= 1 && p.backoff.baseSeconds > 0 && p.spool.maxBytes > 0 && p.caps.maxMemMB > 0 && p.caps.logKeep >= 1 && !!p.tls.mode && typeof p.selfUpdate.enabled === "boolean");
      check("resilience: the policy mirrors config.rmm", p.backoff.baseSeconds === Number(ERP.configVal("rmm.backoffBaseSeconds", 5)) && p.spool.maxItems === Number(ERP.configVal("rmm.spoolMaxItems", 5000)));

      check("resilience: backoff grows by the factor then caps", RS.backoffMs(1, { u: 1 }) === p.backoff.baseSeconds * 1000 && RS.backoffMs(2, { u: 1 }) === p.backoff.baseSeconds * 1000 * p.backoff.factor && RS.backoffMs(99, { u: 1 }) === p.backoff.maxSeconds * 1000);
      const sched = RS.backoffSchedule();
      check("resilience: the backoff schedule is bounded + monotonic", sched.length === p.backoff.maxAttempts && sched.every((v, i) => i === 0 || v >= sched[i - 1]) && sched[sched.length - 1] <= p.backoff.maxSeconds * 1000);
      check("resilience: jitter only ever shortens a delay", RS.backoffMs(3, { u: 1 }) >= RS.backoffMs(3, { u: 0 }) && RS.backoffMs(3, { u: 0 }) >= 0);
      check("resilience: shouldRetry stops at maxAttempts", RS.shouldRetry(1) === true && RS.shouldRetry(p.backoff.maxAttempts) === false);

      check("resilience: version compare is numeric-aware", RS.compareVersions("1.10.0", "1.9.0") === 1 && RS.compareVersions("1.0.0", "1.0.0") === 0 && RS.compareVersions("1.2.0", "1.2.1") === -1 && RS.isNewer("2.0.0", "2.0.0-beta") === true);

      const tlsHttps = RS.tlsConfig("https://collector.example.com");
      const tlsHttp = RS.tlsConfig("http://collector.example.com:8080");
      check("resilience: TLS defaults to the system trust store", tlsHttps.mode === "system" && tlsHttps.secure === true && tlsHttps.warnings.length === 0);
      check("resilience: a plain-HTTP collector is flagged insecure", tlsHttp.mode === "insecure" && tlsHttp.secure === false && tlsHttp.warnings.length === 1);

      /* ── backend ── */
      const srv = makeServer();
      store.useBackend(srv);
      store.resetAllLocal();
      T.reload();

      const prov = await T.create({ name: "Resilience " + uid, sites: [{ id: "site-" + uid, name: "HQ" }] });
      const pid = prov.provider.id;
      const t1 = await E.issueToken({ providerId: pid });
      const en1 = await E.enroll({ token: t1.token, hostname: "RES-WS1", os: { name: "Windows 11" }, device: { role: "workstation" } });
      const dev1 = en1.deviceId, cred1 = en1.credential;
      const t2 = await E.issueToken({ providerId: pid });
      const en2 = await E.enroll({ token: t2.token, hostname: "RES-SRV2", os: { name: "Ubuntu 22.04" }, device: { role: "server" } });
      const dev2 = en2.deviceId, cred2 = en2.credential;

      /* ── release registry ── */
      const SHA = "a".repeat(64);
      check("resilience: publish needs a provider", (await RS.publishRelease({ platform: "windows", version: "1.1.0", url: "https://x/y.ps1", sha256: SHA })).error === "no_provider");
      check("resilience: publish rejects an unknown platform", (await RS.publishRelease({ providerId: pid, platform: "amiga", version: "1.1.0", url: "https://x", sha256: SHA })).error === "unknown_platform");
      check("resilience: publish rejects a non-numeric version", (await RS.publishRelease({ providerId: pid, platform: "windows", version: "latest", url: "https://x", sha256: SHA })).error === "bad_version");
      check("resilience: publish requires a source", (await RS.publishRelease({ providerId: pid, platform: "windows", version: "1.1.0" })).error === "no_source");
      check("resilience: publish requires a checksum", (await RS.publishRelease({ providerId: pid, platform: "windows", version: "1.1.0", url: "https://x/y.ps1" })).error === "no_checksum");

      const BUILD = "Write-Host hello";
      const rel = await RS.publishRelease({ providerId: pid, platform: "windows", version: "1.1.0", payload: BUILD, notes: "test build" });
      check("resilience: an inline build publishes with a computed checksum", rel.ok === true && rel.release.sha256 === E.sha256Hex(BUILD) && rel.release.status === "active" && rel.release.sizeBytes > 0, JSON.stringify({ sha: rel.release && rel.release.sha256 }));
      check("resilience: releases list under their provider", (await RS.listReleases({ providerId: pid })).length === 1);
      check("resilience: latestRelease only picks a newer build", (await RS.latestRelease(pid, "windows", "1.0.0")) !== null && (await RS.latestRelease(pid, "windows", "1.1.0")) === null);
      check("resilience: releaseFor finds an exact version", !!(await RS.releaseFor(pid, "windows", "1.1.0")));
      const superseded = await RS.publishRelease({ providerId: pid, platform: "windows", version: "1.1.0", payload: "Write-Host v2" });
      check("resilience: republishing a version supersedes the old record", superseded.ok === true && (await RS.listReleases({ providerId: pid, status: "active" })).length === 1);
      const relId = superseded.release.id;
      const activeRelease = await RS.getRelease(relId);

      /* ── rollout ── */
      check("resilience: push needs a provider", (await RS.pushUpdate({ deviceIds: [dev1] })).error === "no_provider");
      check("resilience: push needs targets", (await RS.pushUpdate({ providerId: pid, deviceIds: [] })).error === "no_targets");
      check("resilience: push without a release is refused", (await RS.pushUpdate({ providerId: pid, deviceIds: [dev1] })).error === "no_release");
      const push = await RS.pushUpdate({ providerId: pid, deviceIds: [dev1, dev2], releaseId: relId });
      check("resilience: push queues the update on every target", push.ok === true && push.queued === 2, JSON.stringify(push));
      const dev1Rec = (await D.get(pid, dev1)).device;
      check("resilience: the device carries a pending update request", !!dev1Rec.custom.updateRequested && dev1Rec.custom.updateRequested.version === "1.1.0" && dev1Rec.agent.updatePending === true);
      check("resilience: pendingCount reflects the request", RS.pendingCount(dev1Rec) === 1);

      const delivered = await RS.deliverUpdate(pid, dev1, dev1Rec);
      check("resilience: the heartbeat contract carries the update", !!delivered && delivered.sha256 === activeRelease.sha256 && delivered.attempt === 1 && !!delivered.caps && delivered.keepVersions >= 1, JSON.stringify(delivered && { a: delivered.attempt }));
      check("resilience: a just-delivered update is not re-sent", (await RS.deliverUpdate(pid, dev1, (await D.get(pid, dev1)).device)) === null);

      const rec1 = await RS.recordUpdate({ deviceId: dev1, credential: cred1, ok: true, version: "1.1.0", fromVersion: "1.0.0" });
      check("resilience: a successful update is recorded", rec1.ok === true && rec1.state === "updated" && (await D.get(pid, dev1)).device.agentVersion === "1.1.0", JSON.stringify(rec1));
      check("resilience: the update history is kept on the device", Array.isArray((await D.get(pid, dev1)).device.agent.updateHistory) && (await D.get(pid, dev1)).device.agent.updatePending === false);
      check("resilience: an unauthenticated update report is refused", (await RS.recordUpdate({ deviceId: dev1, credential: "cred_BAD", ok: true })).ok === false);

      const devForRollback = (await D.get(pid, dev2)).device;
      await RS.deliverUpdate(pid, dev2, devForRollback);
      const rb = await RS.recordUpdate({ deviceId: dev2, credential: cred2, ok: false, version: "1.1.0", fromVersion: "1.0.0", error: "self-test failed" });
      check("resilience: a failed build rolls back automatically", rb.ok === true && rb.state === "rolled-back" && rb.entry.version === "1.0.0", JSON.stringify(rb));
      const dev2After = (await D.get(pid, dev2)).device;
      check("resilience: the rollback is surfaced on the device", dev2After.agent.rolledBack === true && !!dev2After.custom.updateError);

      check("resilience: reapUpdates is a safe no-op on a healthy fleet", (await RS.reapUpdates(pid)).ok === true);

      /* ── offline buffer ── */
      const devSpool = (await D.get(pid, dev1)).device;
      await D.update(pid, dev1, { custom: Object.assign({}, devSpool.custom, { spool: { pending: 7, bytes: 4096, oldestAt: new Date(Date.now() - 3600000).toISOString() } }) });
      const sm = RS.spoolSummary((await D.get(pid, dev1)).device);
      check("resilience: the offline buffer is summarised", sm.pending === 7 && sm.bytes === 4096 && sm.backedUp === true);

      const status = await RS.rolloutStatus(pid);
      check("resilience: rolloutStatus counts devices, versions, pending + buffered", status.devices.length === 2 && status.releases >= 1 && status.backedUp === 1 && typeof status.byVersion === "object", JSON.stringify({ d: status.devices.length, b: status.backedUp }));

      const dev = (await D.get(pid, dev1)).device;
      check("resilience: the device modal shows the resilience section", /Resilience &amp; updates/.test(RS.deviceSection(dev)));

      const probe = document.createElement("div");
      document.body.appendChild(probe);
      const provider = (await T.get(pid)).provider;
      await RS.renderUpdates(probe, { provider: provider, providerId: pid, toast: function () {}, refresh: function () {} });
      check("resilience: the Updates console renders KPIs + the publish form", probe.querySelectorAll(".erp-stat").length >= 4 && !!probe.querySelector('[name="rsPlatform"]') && !!probe.querySelector('[data-act="rs-publish"]'));
      check("resilience: the console lists releases with a roll-out action", !!probe.querySelector('[data-act="rs-push"]') && /1\.1\.0/.test(probe.textContent));
      check("resilience: the policy panel shows caps + collector identity", /Resilience policy/.test(probe.textContent) && /Collector identity/.test(probe.textContent) && /Resource caps/.test(probe.textContent));
      probe.remove();

      const cleanup = await RS.removeRelease(relId);
      check("resilience: a release can be removed", cleanup.ok === true && (await RS.getRelease(relId)) === null);

      check("resilience: every canonical file stays in the rmm namespace", Object.keys(srv.files).every((n) => n.indexOf("rmm-v1-") === 0));
    } catch (e) {
      check("resilience: harness did not crash", false, (e && e.stack) || String(e));
    } finally {
      try { store.useBackend(null); } catch (e) {}
      try { store.resetAllLocal(); } catch (e) {}
      try { T.reload(); } catch (e) {}
    }

    const passed = results.filter((r) => r.ok).length;
    const failed = results.length - passed;
    return { passed, failed, results };
  };

  /* ============================================================
     Task 13 — agent diagnostics & support
     Run via page_eval:  await window.RMMDiagnosticsTest()
     ============================================================ */
  window.RMMDiagnosticsTest = async function (opts) {
    opts = opts || {};
    results.length = 0;
    const ERP = window.ERP;
    const store = ERP.store;
    const T = ERP.tenancy;
    const D = ERP.devices;
    const E = ERP.enrollment;
    const DIAG = ERP.diagnostics;
    const NL = String.fromCharCode(10);
    const uid = Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);

    function makeServer() {
      const files = {};
      return {
        files,
        async get(name) { return Object.prototype.hasOwnProperty.call(files, name) ? files[name] : null; },
        async set(name, json) {
          const prev = files[name];
          const created = prev === undefined;
          files[name] = json;
          return { created, unchanged: prev === json, editKey: "k_" + name, superseded: false, error: null };
        },
      };
    }

    if (!DIAG) { check("diagnostics: ERP.diagnostics exposed", false); return { passed: 0, failed: 1, results }; }

    try {
      check("diagnostics: ERP.diagnostics exposed", typeof DIAG.requestLogs === "function" && typeof DIAG.submitLogs === "function" && typeof DIAG.submitSelfTest === "function" && typeof DIAG.renderDiagnostics === "function");
      const shape = DIAG.selfTestShape();
      check("diagnostics: the self-test contract lists every check", shape.length >= 10 && ["config", "reachable", "tls", "enrolled", "authenticated", "clock", "service", "spool", "disk", "jobs"].every((id) => !!DIAG.selfTestCheck(id)));
      check("diagnostics: the troubleshooting playbook is complete", DIAG.TROUBLESHOOTING.length >= 8 && DIAG.TROUBLESHOOTING.every((t) => t.id && t.symptom && t.cause && t.fix));
      check("diagnostics: the log policy derives from config", DIAG.logPolicy().maxBytes > 0 && DIAG.logPolicy().keep >= 1 && DIAG.requestLines() >= 20);

      const srv = makeServer();
      store.useBackend(srv);
      store.resetAllLocal();
      T.reload();

      const prov = await T.create({ name: "Diag " + uid, sites: [{ id: "site-" + uid, name: "HQ" }] });
      const pid = prov.provider.id;
      const t1 = await E.issueToken({ providerId: pid });
      const en1 = await E.enroll({ token: t1.token, hostname: "DG-WS1", os: { name: "Windows 11" }, device: { role: "workstation" } });
      const dev1 = en1.deviceId, cred1 = en1.credential;
      const t2 = await E.issueToken({ providerId: pid });
      const en2 = await E.enroll({ token: t2.token, hostname: "DG-SRV2", os: { name: "Ubuntu 22.04" }, device: { role: "server" } });
      const dev2 = en2.deviceId;

      check("diagnostics: requestLogs needs a provider", (await DIAG.requestLogs({ deviceIds: [dev1] })).error === "no_provider");
      check("diagnostics: requestLogs needs targets", (await DIAG.requestLogs({ providerId: pid })).error === "no_targets");
      const req = await DIAG.requestLogs({ providerId: pid, deviceIds: [dev1], lines: 250 });
      check("diagnostics: a log request is queued", req.ok === true && req.queued === 1 && (await D.get(pid, dev1)).device.custom.logRequest.lines === 250);

      const delivered = await DIAG.deliver(pid, dev1, (await D.get(pid, dev1)).device);
      check("diagnostics: the heartbeat contract carries the log request", !!delivered && !!delivered.collectLogs && delivered.collectLogs.lines === 250, JSON.stringify(delivered));
      check("diagnostics: a just-delivered request is not re-sent", (await DIAG.deliver(pid, dev1, (await D.get(pid, dev1)).device)) === null);

      check("diagnostics: a log upload needs a valid credential", (await DIAG.submitLogs({ deviceId: dev1, credential: "cred_BAD", text: "x" })).ok === false);
      const LOGTEXT = ["line one", "line two", "line three"].join(NL);
      const logRes = await DIAG.submitLogs({ deviceId: dev1, credential: cred1, requestId: delivered.collectLogs.requestId, text: LOGTEXT, source: "agent" });
      check("diagnostics: an agent log is stored", logRes.ok === true && logRes.bytes > 0 && logRes.lines === 3, JSON.stringify(logRes));
      check("diagnostics: the log request clears on receipt", !(await D.get(pid, dev1)).device.custom.logRequest);

      const listed = await DIAG.listLogs({ providerId: pid });
      check("diagnostics: listed logs expose a preview, not the body", listed.length === 1 && listed[0].text === undefined && typeof listed[0].preview === "string");
      check("diagnostics: the full log can be opened", (await DIAG.getLog(listed[0].id)).text === LOGTEXT);
      check("diagnostics: the last-log summary is stamped on the device", !!(await D.get(pid, dev1)).device.custom.lastLog);

      for (let i = 0; i < DIAG.logKeep() + 3; i++) await DIAG.submitLogs({ deviceId: dev1, credential: cred1, text: "tick " + i });
      check("diagnostics: logs are a bounded per-device ring", (await DIAG.listLogs({ providerId: pid, deviceId: dev1 })).length === DIAG.logKeep());

      const huge = new Array(DIAG.logMaxBytes() + 5000).join("x");
      const trimRes = await DIAG.submitLogs({ deviceId: dev1, credential: cred1, text: huge });
      check("diagnostics: an oversized log is truncated + marked", trimRes.ok === true && trimRes.bytes <= DIAG.logMaxBytes() && trimRes.truncated === true, JSON.stringify(trimRes));

      const stReq = await DIAG.requestSelfTest({ providerId: pid, deviceIds: [dev1, dev2] });
      check("diagnostics: a self-test request is queued on each device", stReq.ok === true && stReq.queued === 2);
      const stDeliver = await DIAG.deliver(pid, dev1, (await D.get(pid, dev1)).device);
      check("diagnostics: the heartbeat contract carries the self-test request", !!stDeliver && !!stDeliver.selfTest);
      const stSub = await DIAG.submitSelfTest({
        deviceId: dev1, credential: cred1, requestId: stDeliver.selfTest.requestId, agentVersion: "1.0.0",
        checks: [{ id: "config", name: "Configuration", ok: true, detail: "ok" }, { id: "reachable", name: "Collector reachable", ok: false, detail: "timed out" }],
        context: { hostname: "DG-WS1", spoolPending: 3, freeDiskBytes: 123456789 },
      });
      check("diagnostics: a self-test report is stored", stSub.ok === true && stSub.passed === false && stSub.checks === 2, JSON.stringify(stSub));
      check("diagnostics: the self-test request clears on receipt", !(await D.get(pid, dev1)).device.custom.selfTestRequest);
      check("diagnostics: the self-test is stamped on the device", !!(await D.get(pid, dev1)).device.custom.diagnostics && (await D.get(pid, dev1)).device.custom.diagnostics.lastSelfTestOk === false);
      check("diagnostics: latestSelfTest returns the newest report", (await DIAG.latestSelfTest(dev1)).id === stSub.id);
      check("diagnostics: a passing self-test reports ok", (await DIAG.submitSelfTest({ deviceId: dev2, credential: en2.credential, checks: [{ id: "config", name: "Configuration", ok: true }] })).passed === true);

      const stats = await DIAG.stats(pid);
      check("diagnostics: stats count logs + self-test outcomes", stats.logs >= 1 && stats.selfTests === 2 && stats.selfTestsPassed === 1 && stats.selfTestsFailed === 1 && stats.devicesDiagnosed === 2, JSON.stringify(stats));

      const dev = (await D.get(pid, dev1)).device;
      check("diagnostics: the device modal shows the diagnostics section", /Diagnostics &amp; support/.test(await DIAG.deviceSection(dev, pid)));

      const probe = document.createElement("div");
      document.body.appendChild(probe);
      await DIAG.renderDiagnostics(probe, { providerId: pid, toast: function () {}, refresh: function () {} });
      check("diagnostics: the console renders KPIs + request buttons", probe.querySelectorAll(".erp-stat").length >= 4 && !!probe.querySelector('[data-act="dg-logs"]') && !!probe.querySelector('[data-act="dg-selftest"]'));
      check("diagnostics: the console lists reports with view actions", !!probe.querySelector('[data-act="dg-log-view"]') && !!probe.querySelector('[data-act="dg-test-view"]'));
      check("diagnostics: the troubleshooting playbook is rendered", probe.querySelectorAll("details.rmm-diag").length >= 8);
      probe.remove();

      check("diagnostics: every canonical file stays in the rmm namespace", Object.keys(srv.files).every((n) => n.indexOf("rmm-v1-") === 0));
    } catch (e) {
      check("diagnostics: harness did not crash", false, (e && e.stack) || String(e));
    } finally {
      try { store.useBackend(null); } catch (e) {}
      try { store.resetAllLocal(); } catch (e) {}
      try { T.reload(); } catch (e) {}
    }

    const passed = results.filter((r) => r.ok).length;
    const failed = results.length - passed;
    return { passed, failed, results };
  };

  /* ============================================================
     Task 14 — collector service (server-plugin hub + shared core)
     Run via page_eval:  await window.RMMCollectorTest()
     ============================================================ */
  window.RMMCollectorTest = async function (opts) {
    opts = opts || {};
    results.length = 0;
    const ERP = window.ERP;
    const store = ERP.store;
    const T = ERP.tenancy;
    const E = ERP.enrollment;
    const COL = ERP.collector;
    const uid = Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);

    function makeServer() {
      const files = {};
      return {
        files,
        async get(name) { return Object.prototype.hasOwnProperty.call(files, name) ? files[name] : null; },
        async set(name, json) {
          const prev = files[name];
          const created = prev === undefined;
          files[name] = json;
          return { created, unchanged: prev === json, editKey: "k_" + name, superseded: false, error: null };
        },
      };
    }

    if (!COL) { check("collector: ERP.collector exposed", false); return { passed: 0, failed: 1, results }; }

    try {
      check("collector: ERP.collector exposed", typeof COL.createCore === "function" && typeof COL.deviceOp === "function" && typeof COL.admin === "function" && typeof COL.adminUnlock === "function");
      check("collector: the protocol lists every device op", COL.DEVICE_OPS.length >= 9 && ["ping", "enroll", "heartbeat", "inventory", "metrics", "job-result", "logs", "diagnostics", "update-result", "uninstall"].every((o) => COL.DEVICE_OPS.indexOf(o) !== -1));
      check("collector: the protocol lists every admin op", COL.ADMIN_OPS.indexOf("registerToken") !== -1 && COL.ADMIN_OPS.indexOf("pushJob") !== -1 && COL.ADMIN_OPS.indexOf("revokeDevice") !== -1 && COL.ADMIN_OPS.indexOf("fleet") !== -1);

      const core = COL.createCore({ entropy: "test-seed-" + uid });
      check("collector: the core implements SHA-256 (known vector)", core.sha256Hex("abc") === "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", core.sha256Hex("abc"));
      check("collector: base64 round-trips UTF-8 (no btoa on the server)", core.b64decode(core.b64encode("caf\u00e9 \u2713 \u65e5\u672c")) === "caf\u00e9 \u2713 \u65e5\u672c" && core.b64encode("") === "");
      check("collector: UTF-8 encode/decode round-trips", core.utf8Decode(core.utf8Encode("na\u00efve")) === "na\u00efve");
      check("collector: ping identifies the core", core.handle("ping").ok === true && core.handle("ping").core === "rmm-collector");
      check("collector: an unknown op is refused", core.handle("nope", {}).ok === false);

      /* adminUnlock over a transport that fails must report, not throw */
      COL.setTransport({ kind: "test", status: () => "closed", ready: async () => { throw new Error("no transport"); }, rpc: async () => { throw new Error("no transport"); }, send() {} });
      const unlock = await COL.adminUnlock("irrelevant");
      check("collector: adminUnlock reports a transport failure", unlock.ok === false && !!unlock.error);
      check("collector: status reflects the transport", COL.status().available === true && COL.status().mode === "test");

      /* the device/admin ops fall back to the local core when the hub is unreachable */
      COL.resetLocal();
      const ping = await COL.deviceOp("ping", {});
      check("collector: deviceOp falls back to the local core", ping.ok === true && ping.core === "rmm-collector");

      const srv = makeServer();
      store.useBackend(srv);
      store.resetAllLocal();
      T.reload();
      const prov = await T.create({ name: "Collector " + uid, sites: [{ id: "site-" + uid, name: "HQ" }] });
      const pid = prov.provider.id;

      const local = COL.localCore();
      const token = "enr-one-time-" + uid;
      const reg = await COL.admin("registerToken", { tokenHash: local.sha256Hex(token), providerId: pid, siteId: "site-" + uid, groupIds: ["g1"], maxUses: 1 });
      check("collector: the console registers a one-time token (hash only)", reg.ok === true && !!reg.tokenId);

      const enrol = await COL.deviceOp("enroll", { token, providerId: pid, hostname: "COL-WS1", agentVersion: "1.0.0", device: { os: { name: "Windows 11" }, interfaces: [{ name: "eth0", ip4: ["10.0.0.5"] }] } });
      check("collector: enroll exchanges a one-time token for a credential", enrol.ok === true && !!enrol.credential && !!enrol.deviceId, JSON.stringify({ ok: enrol.ok, e: enrol.error }));
      const credDump = JSON.stringify(local.state().creds);
      check("collector: credentials are stored only as hashes", credDump.indexOf(enrol.credential) === -1 && /credentialHash/.test(credDump));
      check("collector: a spent one-time token is refused", (await COL.deviceOp("enroll", { token, providerId: pid, hostname: "again" })).ok === false);

      const hb = await COL.deviceOp("heartbeat", { deviceId: enrol.deviceId, credential: enrol.credential, payload: { agentVersion: "1.0.0", intervalSeconds: 120, interfaces: [{ name: "eth0", ip4: ["10.0.0.5"] }], spool: { pending: 2, bytes: 100 } } });
      check("collector: a heartbeat authenticates + answers", hb.ok === true && hb.intervalSeconds === 120 && Array.isArray(hb.jobs));
      check("collector: a bad credential is rejected", (await COL.deviceOp("heartbeat", { deviceId: enrol.deviceId, credential: "cred_BAD" })).ok === false);
      check("collector: the offline buffer rides the heartbeat", (await COL.admin("device", { deviceId: enrol.deviceId })).device.spool.pending === 2);

      const jr = await COL.admin("pushJob", { deviceId: enrol.deviceId, job: { name: "Hello", language: "powershell", script: "Write-Output hi" } });
      check("collector: the console can queue a job", jr.ok === true && !!jr.jobId);
      check("collector: minted ids are well-formed (no undefined)", /^tok-[a-z0-9]+$/.test(reg.tokenId) && /^dev-[a-z0-9]+$/.test(enrol.deviceId) && /^job-[a-z0-9]+$/.test(jr.jobId) && /^cred_[A-Za-z0-9]+$/.test(enrol.credential) && [reg.tokenId, enrol.deviceId, jr.jobId, enrol.credential].every((x) => x.indexOf("undefined") === -1), JSON.stringify([reg.tokenId, enrol.deviceId, jr.jobId]));
      const hb2 = await COL.deviceOp("heartbeat", { deviceId: enrol.deviceId, credential: enrol.credential, payload: {} });
      check("collector: the queued job is delivered on the next check-in", hb2.jobs.length === 1 && hb2.jobs[0].jobId === jr.jobId && hb2.jobs[0].scriptB64 === local.b64encode("Write-Output hi"));
      const jobRes = await COL.deviceOp("job-result", { deviceId: enrol.deviceId, credential: enrol.credential, jobId: jr.jobId, exitCode: 0, stdoutB64: local.b64encode("hi \u2713"), endedAt: new Date().toISOString() });
      check("collector: a job result is accepted", jobRes.ok === true && jobRes.state === "succeeded", JSON.stringify(jobRes));
      check("collector: a duplicate job result is idempotent", (await COL.deviceOp("job-result", { deviceId: enrol.deviceId, credential: enrol.credential, jobId: jr.jobId, exitCode: 0 })).duplicate === true);

      const inv = await COL.deviceOp("inventory", { deviceId: enrol.deviceId, credential: enrol.credential, payload: { mode: "full", inventory: { os: { name: "Windows 11" } }, collectedAt: new Date().toISOString() } });
      check("collector: inventory is versioned", inv.ok === true && inv.revision === 1);
      check("collector: the console reads inventory back", (await COL.admin("inventory", { deviceId: enrol.deviceId })).inventory.revision === 1);
      const met = await COL.deviceOp("metrics", { deviceId: enrol.deviceId, credential: enrol.credential, payload: { samples: [{ at: new Date().toISOString(), cpuPct: 12 }], intervalSeconds: 60 } });
      check("collector: metric samples are accepted", met.ok === true && met.accepted === 1, JSON.stringify(met));

      await COL.admin("requestLogs", { deviceIds: [enrol.deviceId], lines: 100 });
      const hb3 = await COL.deviceOp("heartbeat", { deviceId: enrol.deviceId, credential: enrol.credential, payload: {} });
      check("collector: a log request rides the heartbeat", !!hb3.collectLogs && hb3.collectLogs.lines === 100);
      const lg = await COL.deviceOp("logs", { deviceId: enrol.deviceId, credential: enrol.credential, requestId: hb3.collectLogs.requestId, textB64: local.b64encode("hello log \u2713"), lines: 1 });
      check("collector: an agent log is stored", lg.ok === true);
      check("collector: the console reads the log back", (await COL.admin("logs", { deviceId: enrol.deviceId })).logs.length === 1);

      await COL.admin("requestSelfTest", { deviceIds: [enrol.deviceId] });
      const hb4 = await COL.deviceOp("heartbeat", { deviceId: enrol.deviceId, credential: enrol.credential, payload: {} });
      check("collector: a self-test request rides the heartbeat", !!hb4.selfTest);
      const dg = await COL.deviceOp("diagnostics", { deviceId: enrol.deviceId, credential: enrol.credential, requestId: hb4.selfTest.requestId, checks: [{ id: "config", name: "Configuration", ok: true }] });
      check("collector: a self-test report is stored", dg.ok === true && dg.passed === true);
      check("collector: the console reads diagnostics back", (await COL.admin("diagnostics", { deviceId: enrol.deviceId })).diagnostics.length === 1);

      const fleet = await COL.admin("fleet", { providerId: pid });
      check("collector: the fleet view summarises devices", fleet.ok === true && fleet.counts.total === 1 && fleet.devices.length === 1, JSON.stringify(fleet.counts));
      const rev = await COL.admin("revokeDevice", { deviceId: enrol.deviceId });
      check("collector: a revoked device is refused", rev.ok === true && (await COL.deviceOp("heartbeat", { deviceId: enrol.deviceId, credential: enrol.credential, payload: {} })).ok === false);

      /* ── drift guard: the hub's core must equal this module's core ── */
      const el = document.querySelector('script[type="text/x-server-plugin"]');
      const serverText = el ? el.textContent : "";
      check("collector: the server hub defines the shared core", serverText.indexOf("RMM-COLLECTOR-CORE-START") !== -1 && serverText.indexOf("RMM-COLLECTOR-CORE-END") !== -1);
      check("collector: the hub exposes the collector RPCs", serverText.indexOf("collectorAuth") !== -1 && serverText.indexOf("collectorDevice") !== -1 && serverText.indexOf("collectorAdmin") !== -1);
      check("collector: the hub holds no plaintext admin password", serverText.indexOf("TzIucqLXjk_UwvBQhfSLE51x_gWuih-YMJgBgsFrLDE") === -1);
      check("collector: every device op is handled by the hub", COL.DEVICE_OPS.every((o) => serverText.indexOf('"' + o + '"') !== -1));
      check("collector: every admin action is handled by the hub", COL.ADMIN_OPS.every((a) => serverText.indexOf(a + ":") !== -1 || serverText.indexOf(a + ": function") !== -1));

      const sIdx = serverText.indexOf("RMM-COLLECTOR-CORE-START");
      const eIdx = serverText.indexOf("RMM-COLLECTOR-CORE-END");
      let serverFactory = null, driftDetail = "";
      if (sIdx !== -1 && eIdx !== -1) {
        const start = serverText.lastIndexOf("/*", sIdx);
        const end = serverText.indexOf("*/", eIdx) + 2;
        const block = serverText.slice(start, end);
        try { serverFactory = new Function(block + "\nreturn createCollectorCore;")(); }
        catch (e) { driftDetail = "parse: " + ((e && e.message) || e); }
      }
      if (serverFactory) {
        const norm = (f) => String(f).replace(/\s+/g, " ").trim();
        const a = norm(COL.createCore), b = norm(serverFactory);
        if (a !== b) {
          let i = 0;
          while (i < a.length && i < b.length && a[i] === b[i]) i++;
          driftDetail = "first difference near: module=" + JSON.stringify(a.slice(i, i + 60)) + " hub=" + JSON.stringify(b.slice(i, i + 60));
        }
        check("collector: the hub's core is identical to the module's core (no drift)", a === b, driftDetail);
        const mirrored = serverFactory({ entropy: "drift-" + uid });
        const dToken = "drift-token-" + uid;
        const dReg = mirrored.admin.registerToken({ tokenHash: mirrored.sha256Hex(dToken), providerId: "p-drift", maxUses: 1 });
        const dEnrol = mirrored.handle("enroll", { token: dToken, providerId: "p-drift", hostname: "DRIFT-1", agentVersion: "1.0.0" });
        const dHb = mirrored.handle("heartbeat", { deviceId: dEnrol.deviceId, credential: dEnrol.credential, payload: {} });
        const dJob = mirrored.admin.pushJob({ deviceId: dEnrol.deviceId, job: { language: "sh", script: "echo hi" } });
        const dHb2 = mirrored.handle("heartbeat", { deviceId: dEnrol.deviceId, credential: dEnrol.credential, payload: {} });
        check("collector: the hub's core runs the same device lifecycle", dReg.ok === true && dEnrol.ok === true && dHb.ok === true && dJob.ok === true && dHb2.jobs.length === 1, JSON.stringify({ r: dReg.ok, e: dEnrol.ok, h: dHb.ok, j: dJob.ok }));
      } else {
        check("collector: the hub's core is identical to the module's core (no drift)", false, driftDetail || "core block not found");
      }

      check("collector: every canonical file stays in the rmm namespace", Object.keys(srv.files).every((n) => n.indexOf("rmm-v1-") === 0));
    } catch (e) {
      check("collector: harness did not crash", false, (e && e.stack) || String(e));
    } finally {
      try { COL.setTransport(null); } catch (e) {}
      try { store.useBackend(null); } catch (e) {}
      try { store.resetAllLocal(); } catch (e) {}
      try { T.reload(); } catch (e) {}
    }

    const passed = results.filter((r) => r.ok).length;
    const failed = results.length - passed;
    return { passed, failed, results };
  };

  /* ============================================================
     Tasks 15–17 shared helpers — a mock collector hub that runs a
     real collector core behind the transport API, gated on the
     admin password exactly like the server hub does.
     ============================================================ */
  function rmmMockHub(core, password, getActing) {
    const gate = { authed: false, calls: [] };
    const parse = (v) => {
      if (v == null) return v;
      const s = typeof v === "string" ? v : JSON.stringify(v);
      try { return JSON.parse(s); } catch (e) { return v; }
    };
    const inflate = (b) => (typeof b === "string" ? core.unpackText(b) : b);
    return {
      kind: "socket",
      status: () => "open",
      ready: async () => {},
      authed: () => gate.authed,
      calls: () => gate.calls.slice(),
      async rpc(method, payload) {
        gate.calls.push(method);
        let msg;
        try { msg = JSON.parse(payload); } catch (e) { return JSON.stringify({ ok: false, error: "bad_request" }); }
        if (method === "collectorAuth") {
          const ok = String(msg.password) === String(password);
          gate.authed = ok;
          return JSON.stringify(ok ? { ok: true } : { ok: false, error: "unauthorized", message: "Wrong collector password." });
        }
        if (method === "collectorAdmin") {
          if (!gate.authed) return JSON.stringify({ ok: false, error: "unauthorized", message: "Unlock the collector first." });
          const body = parse(inflate(msg.payload)) || {};
          if (typeof getActing === "function") {
            const acting = getActing();
            if (acting) {
              const guard = core.guardAdmin(acting, msg.action, body);
              if (!guard || !guard.ok) return JSON.stringify(guard || { ok: false, error: "forbidden" });
            }
          }
          const fn = core.admin[msg.action];
          return JSON.stringify(fn ? fn(body) : { ok: false, error: "unknown_action" });
        }
        if (method === "collectorDevice") {
          return JSON.stringify(core.handle(msg.op, parse(inflate(msg.body)) || {}));
        }
        return JSON.stringify({ ok: false, error: "unknown_method" });
      },
      send() {},
    };
  }
  function rmmEnrollCollector(core, providerId, deviceId, hostname) {
    const token = "ctok-" + deviceId + "-" + Math.random().toString(36).slice(2);
    core.admin.registerToken({ tokenHash: core.sha256Hex(token), providerId, deviceId, maxUses: 1 });
    return core.handle("enroll", { token, providerId, hostname: hostname || deviceId, agentVersion: "1.0.0" });
  }

  /* ============================================================
     Task 15 — job queue & dispatch
     Run via page_eval:  await window.RMMDispatchTest()
     Covers: target resolution (device / group / site / tag / all /
     online + unknown-id reporting), the locked-collector gate and
     re-dispatch, enqueue (ERP job + collector job + correlation
     ledger), the full delivered → running → succeeded lifecycle
     with terminal correlation, retry, cancel, reap (requeue +
     expiry), status counts, collector-id mapping and the console +
     device-modal UI.  Runs against a stub backend + mock hub.
     ============================================================ */
  window.RMMDispatchTest = async function (opts) {
    opts = opts || {};
    results.length = 0;
    const ERP = window.ERP;
    const store = ERP.store;
    const T = ERP.tenancy;
    const D = ERP.devices;
    const COL = ERP.collector;
    const DSP = ERP.dispatch;
    const PASSWORD = opts.password || "rmm-dispatch-test-pw";
    const uid = Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
    const ago = (ms) => new Date(Date.now() - ms).toISOString();

    function makeServer() {
      const files = {};
      return {
        files,
        async get(name) { return Object.prototype.hasOwnProperty.call(files, name) ? files[name] : null; },
        async set(name, json) { const prev = files[name]; files[name] = json; return { created: prev === undefined, unchanged: prev === json, editKey: "k_" + name, superseded: false, error: null }; },
      };
    }

    if (!DSP) { check("dispatch: ERP.dispatch exposed", false); return { passed: 0, failed: 1, results }; }

    const srv = makeServer();
    const core = COL.createCore({ entropy: "dispatch-" + uid });
    try {
      check("dispatch: ERP.dispatch exposed", DSP.MODULE === "dispatch" && ["resolveTargets", "enqueue", "sync", "retry", "cancel", "reap", "correlations", "status", "collectorDeviceId", "onTerminal", "redispatch", "unlock"].every((f) => typeof DSP[f] === "function"));
      check("dispatch: the state map mirrors the collector vocabulary", DSP.STATE_MAP.succeeded === "succeeded" && DSP.STATE_MAP["timed-out"] === "timed-out" && DSP.STATE_MAP.running === "running");

      DSP.locked = false;
      store.useBackend(srv);
      store.resetAllLocal();
      T.reload();

      const prov = await T.create({ name: "Dispatch " + uid, sites: [{ id: "site-hq", name: "HQ" }, { id: "site-br", name: "Branch" }], deviceGroups: [{ id: "grp-servers", name: "Servers", siteId: "site-hq" }, { id: "grp-win", name: "Windows", siteId: null }] });
      const pid = prov.provider.id;
      const now = new Date().toISOString();
      const d1 = (await D.add(pid, { hostname: "DSP-SRV1", role: "server", siteId: "site-hq", groupIds: ["grp-servers"], status: "online", lastSeenAt: now, tags: ["prod", "critical"], os: { name: "Ubuntu 22.04" } })).device.id;
      const d2 = (await D.add(pid, { hostname: "DSP-WS2", role: "workstation", siteId: "site-hq", groupIds: ["grp-win"], status: "online", lastSeenAt: now, tags: ["prod"], os: { name: "Windows 11" } })).device.id;
      const d3 = (await D.add(pid, { hostname: "DSP-WS3", role: "workstation", siteId: "site-br", groupIds: [], status: "offline", lastSeenAt: ago(72 * 3600000), tags: [], os: { name: "Windows 11" } })).device.id;
      const d4 = (await D.add(pid, { hostname: "DSP-LNX4", role: "server", siteId: null, groupIds: [], status: "stale", lastSeenAt: ago(45 * 60000), tags: [], os: { name: "Ubuntu 22.04" } })).device.id;

      /* ── target resolution ── */
      const rt = (spec) => DSP.resolveTargets(pid, spec);
      check("dispatch: resolves explicit device ids", (await rt({ deviceId: d1 })).deviceIds.length === 1 && (await rt({ deviceIds: [d1, d2] })).deviceIds.length === 2);
      const skip = await rt({ deviceIds: [d1, "dev-ghost"] });
      check("dispatch: unknown ids are reported, not dispatched", skip.deviceIds.length === 1 && skip.skipped.length === 1 && skip.skipped[0] === "dev-ghost");
      check("dispatch: resolves by device group", (await rt({ groupIds: ["grp-servers"] })).deviceIds.indexOf(d1) !== -1 && (await rt({ groupIds: ["grp-servers"] })).deviceIds.indexOf(d2) === -1);
      check("dispatch: resolves by site", (await rt({ siteIds: ["site-br"] })).deviceIds.length === 1 && (await rt({ siteIds: ["site-br"] })).deviceIds[0] === d3);
      check("dispatch: resolves by tag (case-insensitive)", (await rt({ tags: ["PROD"] })).deviceIds.length === 2);
      check("dispatch: resolves the whole fleet", (await rt({ all: true })).deviceIds.length === 4);
      const online = await rt({ online: true });
      check("dispatch: online-only selects live devices", online.deviceIds.length === 2 && online.deviceIds.indexOf(d1) !== -1 && online.deviceIds.indexOf(d3) === -1);
      check("dispatch: a provider is required", !!(await DSP.resolveTargets("", { all: true })).error);

      /* ── transport / locked gate ── */
      const hub = rmmMockHub(core, PASSWORD);
      COL.setTransport(hub);
      const creds = {};
      [d1, d2, d3, d4].forEach((id) => { creds[id] = rmmEnrollCollector(core, pid, id, id).credential; });
      check("dispatch: the mock hub is reachable over a socket", COL.status().mode === "socket" && hub.authed() === false);

      const lockedEnq = await DSP.enqueue({ providerId: pid, target: { deviceId: d1 }, name: "Locked", language: "bash", script: "echo hi", source: "test" });
      check("dispatch: an enqueue against a locked hub records the block", lockedEnq.ok === true && lockedEnq.dispatch.states[d1] === "blocked" && DSP.locked === true, JSON.stringify(lockedEnq.dispatch && lockedEnq.dispatch.states));
      check("dispatch: status reports the locked mode", (await DSP.status(pid)).mode === "locked");

      check("dispatch: a wrong collector password is refused", (await DSP.unlock("wrong")).ok === false && DSP.locked === true);
      check("dispatch: the right password unlocks", (await DSP.unlock(PASSWORD)).ok === true && DSP.locked === false);
      const red = await DSP.redispatch(pid);
      const dspFor = async (jobId) => (await DSP.correlations({ providerId: pid, jobId }))[0];
      check("dispatch: re-dispatch delivers blocked targets", red.ok === true && red.pushed >= 1 && (await dspFor(lockedEnq.job.id)).states[d1] === "queued", JSON.stringify(red));

      /* ── enqueue + correlation ── */
      check("dispatch: enqueue needs a provider", (await DSP.enqueue({ deviceIds: [d1] })).error === "no_provider");
      check("dispatch: enqueue needs at least one target", (await DSP.enqueue({ providerId: pid, target: { tags: ["nope"] } })).error === "no_targets");

      const r = await DSP.enqueue({ providerId: pid, target: { deviceId: d1 }, name: "Smoke", language: "bash", script: "echo hi", source: "automation", correlation: { kind: "automation", id: "auto-1" } });
      const cjId = r.dispatch.collectorJobIds[d1];
      check("dispatch: enqueue creates an ERP job + a collector job", r.ok === true && !!r.job.id && !!cjId && r.dispatch.states[d1] === "queued");
      check("dispatch: the collector job carries ref + correlation", core.admin.job({ jobId: cjId }).job.ref === r.job.id && core.admin.job({ jobId: cjId }).job.correlation.indexOf("auto-1") !== -1);
      check("dispatch: the ledger records the correlation", (await DSP.correlations({ providerId: pid, correlation: JSON.stringify({ kind: "automation", id: "auto-1" }) })).length === 1);
      check("dispatch: the ERP job mirrors the dispatch", !!(await ERP.jobs.get(pid, r.job.id)).job.dispatch && (await DSP.correlations({ providerId: pid, active: true })).length >= 1);

      /* ── delivery → running → succeeded ── */
      const hb = await COL.deviceOp("heartbeat", { deviceId: d1, credential: creds[d1], payload: {} });
      check("dispatch: the agent receives the dispatched job", hb.ok === true && hb.jobs.some((j) => j.jobId === cjId));
      await DSP.sync(pid);
      check("dispatch: sync maps delivered", (await dspFor(r.job.id)).states[d1] === "delivered" && (await ERP.jobs.get(pid, r.job.id)).job.results[d1].state === "delivered");
      await COL.deviceOp("job-start", { deviceId: d1, credential: creds[d1], jobId: cjId });
      await DSP.sync(pid);
      check("dispatch: job-start makes 'running' observable", (await dspFor(r.job.id)).states[d1] === "running" && (await ERP.jobs.get(pid, r.job.id)).job.state === "running");
      let fired = null;
      const offTerm = DSP.onTerminal((job, dsp) => { fired = { id: job.id, state: job.state, terminal: dsp.terminal }; });
      await COL.deviceOp("job-result", { deviceId: d1, credential: creds[d1], jobId: cjId, exitCode: 0, stdoutB64: core.b64encode("hello"), startedAt: ago(1500) });
      const sr = await DSP.sync(pid);
      check("dispatch: a result flows back to the ERP job", (await dspFor(r.job.id)).states[d1] === "succeeded" && (await ERP.jobs.get(pid, r.job.id)).job.state === "succeeded");
      check("dispatch: sync marks the dispatch terminal", sr.terminals >= 1 && (await dspFor(r.job.id)).terminal === true);
      check("dispatch: onTerminal fires once with the finished job", !!fired && fired.id === r.job.id && fired.state === "succeeded");
      offTerm();
      check("dispatch: a terminal dispatch is excluded from active", (await DSP.correlations({ providerId: pid, active: true })).every((x) => x.jobId !== r.job.id));

      /* ── retry ── */
      const rf = await DSP.enqueue({ providerId: pid, target: { deviceId: d1 }, name: "Fail", language: "bash", script: "exit 1", source: "test", maxAttempts: 2 });
      const cf = rf.dispatch.collectorJobIds[d1];
      await COL.deviceOp("heartbeat", { deviceId: d1, credential: creds[d1], payload: {} });
      await COL.deviceOp("job-start", { deviceId: d1, credential: creds[d1], jobId: cf });
      await COL.deviceOp("job-result", { deviceId: d1, credential: creds[d1], jobId: cf, exitCode: 7, stderrB64: core.b64encode("boom") });
      await DSP.sync(pid);
      check("dispatch: a failed run is recorded", (await ERP.jobs.get(pid, rf.job.id)).job.results[d1].state === "failed" && (await dspFor(rf.job.id)).states[d1] === "failed");
      const rr = await DSP.retry(pid, rf.job.id);
      check("dispatch: retry re-queues on both sides", rr.ok === true && rr.retried >= 1 && (await ERP.jobs.get(pid, rf.job.id)).job.results[d1].state === "queued" && (await dspFor(rf.job.id)).states[d1] === "queued");

      /* ── cancel ── */
      const rc = await DSP.enqueue({ providerId: pid, target: { deviceId: d1 }, name: "Cancel", language: "bash", script: "sleep 5", source: "test" });
      const cc = rc.dispatch.collectorJobIds[d1];
      const cr = await DSP.cancel(pid, rc.job.id);
      check("dispatch: cancel stops the collector job", cr.ok === true && (await COL.job(cc)).job.state === "cancelled");
      check("dispatch: cancel updates the ledger", (await dspFor(rc.job.id)).states[d1] === "cancelled");

      /* ── reap ── */
      const rq = await DSP.enqueue({ providerId: pid, target: { deviceId: d1 }, name: "Stale", language: "bash", script: "echo", source: "test", maxAttempts: 2 });
      const cq = rq.dispatch.collectorJobIds[d1];
      await COL.deviceOp("heartbeat", { deviceId: d1, credential: creds[d1], payload: {} });
      core.admin.job({ jobId: cq }).job.deliveredAt = ago(31 * 60000);
      const reapr = await DSP.reap(pid);
      check("dispatch: reap requeues a stale collector delivery", reapr.collector.requeued >= 1 && core.admin.job({ jobId: cq }).job.state === "queued", JSON.stringify(reapr.collector));
      const rq2 = await DSP.enqueue({ providerId: pid, target: { deviceId: d1 }, name: "Expire", language: "bash", script: "echo", source: "test" });
      const cq2 = rq2.dispatch.collectorJobIds[d1];
      core.admin.job({ jobId: cq2 }).job.expiresAt = ago(60000);
      const reapr2 = await DSP.reap(pid);
      check("dispatch: reap expires a stale collector queue", reapr2.collector.expired >= 1 && core.admin.job({ jobId: cq2 }).job.state === "expired");

      /* ── status / reads ── */
      const st = await DSP.status(pid);
      check("dispatch: status counts dispatches + runs", st.dispatches.total >= 5 && st.dispatches.terminal >= 1 && st.mode === "hub" && st.transport.available === true, JSON.stringify(st.dispatches));
      check("dispatch: collectorDeviceId honours a stored mapping", DSP.collectorDeviceId({ id: "dev-a" }) === "dev-a" && DSP.collectorDeviceId({ id: "dev-a", custom: { collectorDeviceId: "dev-b" } }) === "dev-b" && DSP.collectorDeviceId({ id: "dev-a", agent: { collectorDeviceId: "dev-c" } }) === "dev-c");
      const lim = await DSP.correlations({ providerId: pid, limit: 2 });
      check("dispatch: correlations respects a limit + sorts newest first", lim.length === 2 && (lim[0].createdAt || "") >= (lim[1].createdAt || ""));

      /* ── UI ── */
      const probe = document.createElement("div");
      document.body.appendChild(probe);
      const provider = (await T.get(pid)).provider;
      await DSP.renderJobs(probe, { provider, providerId: pid, state: { filter: "all", search: "" }, toast() {}, refresh() {} });
      check("dispatch: the Jobs console renders the dispatch ledger", !!probe.querySelector("#dspSection") && !!probe.querySelector('[data-act="dsp-sync"]') && !!probe.querySelector('[data-act="dsp-redispatch"]'));
      check("dispatch: the ledger shows KPIs + the correlation view", probe.querySelectorAll(".erp-stat").length >= 4 && /Correlation ledger/.test(probe.textContent));
      probe.remove();
      const dev1 = (await D.get(pid, d1)).device;
      const sec = await DSP.deviceSection(dev1, pid);
      check("dispatch: the device modal shows its dispatches", /Dispatch/.test(sec));

      check("dispatch: every canonical file stays in the rmm namespace", Object.keys(srv.files).every((n) => n.indexOf("rmm-v1-") === 0));
    } catch (e) {
      check("dispatch: harness did not crash", false, (e && e.stack) || String(e));
    } finally {
      try { DSP.locked = false; } catch (e) {}
      try { COL.setTransport(null); } catch (e) {}
      try { store.useBackend(null); } catch (e) {}
      try { store.resetAllLocal(); } catch (e) {}
      try { T.reload(); } catch (e) {}
    }

    const passed = results.filter((r) => r.ok).length;
    const failed = results.length - passed;
    return { passed, failed, results };
  };

  /* ============================================================
     Task 16 — event stream & degraded mode
     Run via page_eval:  await window.RMMEventsTest()
     Covers: the realtime socket transport (live mode + indicator),
     the event bus (kind + wildcard listeners, unsubscribe, emit,
     recent/stats/HISTORY bounds), malformed-message tolerance, the
     offline transition, and the polling fallback that synthesises
     device-state / alert / job events from a snapshot diff.
     ============================================================ */
  window.RMMEventsTest = async function (opts) {
    opts = opts || {};
    results.length = 0;
    const ERP = window.ERP;
    const store = ERP.store;
    const EV = ERP.events;

    if (!EV) { check("events: ERP.events exposed", false); return { passed: 0, failed: 1, results }; }

    try {
      check("events: ERP.events exposed", EV.CHANNEL === "rmm" && EV.KINDS.length === 5 && ["device-state", "job", "alert", "device-op", "admin"].every((k) => EV.KINDS.indexOf(k) !== -1));
      check("events: the bus API is present", ["on", "off", "emit", "recent", "stats", "mode", "modeLabel", "pollOnce", "setTransport", "setSnapshotFn", "start", "stop", "init"].every((f) => typeof EV[f] === "function"));
      check("events: the topbar indicator is wired", !!document.getElementById("rmmStream") && !!document.getElementById("rmmStreamDot") && !!document.getElementById("rmmStreamText"));

      const t = { onopen: null, onmessage: null, onclose: null, open() { if (this.onopen) this.onopen(); }, close() { if (this.onclose) this.onclose(); }, send() {}, fire(o) { this.onmessage(JSON.stringify(o)); } };
      EV.setTransport(t);
      check("events: a socket transport switches to live mode", EV.mode() === "live" && EV.modeLabel() === "live");
      check("events: the indicator shows live", document.getElementById("rmmStreamText").textContent === "live" && /green/.test(document.getElementById("rmmStreamDot").className));

      const devEvents = [], alerts = [], allEvents = [];
      const offDev = EV.on("device-state", (e) => devEvents.push(e));
      const offAlert = EV.on("alert", (e) => alerts.push(e));
      const offAll = EV.on((e) => allEvents.push(e));
      const before = EV.stats().byKind["device-state"] || 0;
      t.fire({ t: "evt", kind: "device-state", deviceId: "dev-e1", hostname: "E1", from: "online", to: "offline" });
      t.fire({ kind: "alert", alert: "agent-offline", severity: "critical", deviceId: "dev-e1" });
      check("events: a realtime message reaches kind listeners", devEvents.length === 1 && devEvents[0].deviceId === "dev-e1" && devEvents[0].from === "online");
      check("events: kind listeners are isolated", alerts.length === 1 && alerts[0].alert === "agent-offline" && devEvents.length === 1);
      check("events: the wildcard listener sees everything", allEvents.length === 2);
      check("events: stats count by kind", (EV.stats().byKind["device-state"] || 0) === before + 1 && EV.stats().total >= 2);
      check("events: recent filters by kind", EV.recent("device-state").some((e) => e.deviceId === "dev-e1") && EV.recent("alert").some((e) => e.alert === "agent-offline"));
      offAlert();
      t.fire({ kind: "alert", alert: "agent-stale", deviceId: "dev-e1" });
      check("events: unsubscribing stops delivery", alerts.length === 1);
      offDev(); offAll();

      const garbage = EV.stats().total;
      t.onmessage("not json at all");
      t.onmessage(JSON.stringify({ hello: "world" }));
      check("events: malformed / unknown messages are ignored", EV.stats().total === garbage);

      const manual = EV.emit({ kind: "admin", action: "unlock" }, true);
      check("events: emit stamps the event + synthetic flag", !!manual && manual.synthetic === true && !!manual.at && EV.recent("admin").some((e) => e.action === "unlock"));
      check("events: HISTORY + poll interval are bounded and configurable", EV.HISTORY() >= 20 && EV.POLL_SECONDS() >= 5);
      check("events: recent respects its limit", EV.recent(null, 3).length === 3);

      t.close();
      check("events: a closed socket degrades to offline", EV.mode() === "offline" && EV.modeLabel() === "offline");

      /* ── polling fallback ── */
      store.useBackend({ async get() { return null; }, async set() { return { error: "offline" }; } });
      EV.setTransport(null);
      check("events: with no transport the mode is offline", EV.mode() === "offline");
      let snap = { devices: [{ deviceId: "dev-p1", status: "online", hostname: "P1" }], jobs: [{ jobId: "job-p1", state: "queued", deviceId: "dev-p1", ref: "ref-1", correlation: "cor-1" }] };
      EV.setSnapshotFn(async () => JSON.parse(JSON.stringify(snap)));
      await EV.pollOnce("prov-poll");
      snap.devices = [{ deviceId: "dev-p1", status: "offline", hostname: "P1" }];
      const p2 = await EV.pollOnce("prov-poll");
      check("events: polling synthesises a device-state change", p2.events >= 2 && EV.recent("device-state").some((e) => e.deviceId === "dev-p1" && e.to === "offline" && e.synthetic === true));
      check("events: a drop to offline raises a critical alert", EV.recent("alert").some((e) => e.alert === "agent-offline" && e.severity === "critical" && e.deviceId === "dev-p1"));
      snap.jobs = [{ jobId: "job-p1", state: "succeeded", deviceId: "dev-p1", ref: "ref-1", correlation: "cor-1" }];
      const p3 = await EV.pollOnce("prov-poll");
      check("events: polling synthesises job transitions", p3.events >= 1 && EV.recent("job").some((e) => e.jobId === "job-p1" && e.state === "succeeded" && e.ref === "ref-1"));
      const p4 = await EV.pollOnce("prov-poll");
      check("events: an unchanged snapshot emits nothing", p4.events === 0);
      EV.setSnapshotFn(null);
      store.useBackend(null);
      EV.stop();
      check("events: stop() returns to offline", EV.mode() === "offline");
    } catch (e) {
      check("events: harness did not crash", false, (e && e.stack) || String(e));
    } finally {
      try { EV.setTransport(null); } catch (e) {}
      try { EV.stop(); } catch (e) {}
      try { store.useBackend(null); } catch (e) {}
    }

    const passed = results.filter((r) => r.ok).length;
    const failed = results.length - passed;
    return { passed, failed, results };
  };

  /* ============================================================
     Task 17 — retention, batching & scale
     Run via page_eval:  await window.RMMRetentionTest()
     Covers: the policy derived from config + the metrics /
     diagnostics limits, the pack/unpack codec (exact round-trip,
     unicode + escapes, non-beneficial passthrough), wireBody +
     codecStats, batch capping, hourly/daily roll-ups, the collector
     applyRetention bounds, the ERP metric + diagnostic pruning, the
     capacity/stats report and the Retention console.
     ============================================================ */
  window.RMMRetentionTest = async function (opts) {
    opts = opts || {};
    results.length = 0;
    const ERP = window.ERP;
    const store = ERP.store;
    const T = ERP.tenancy;
    const D = ERP.devices;
    const MET = ERP.metrics;
    const DIAG = ERP.diagnostics;
    const COL = ERP.collector;
    const DSP = ERP.dispatch;
    const RET = ERP.retention;
    const PASSWORD = opts.password || "rmm-retention-test-pw";
    const uid = Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
    const now = () => new Date().toISOString();

    function makeServer() {
      const files = {};
      return {
        files,
        async get(name) { return Object.prototype.hasOwnProperty.call(files, name) ? files[name] : null; },
        async set(name, json) { const prev = files[name]; files[name] = json; return { created: prev === undefined, unchanged: prev === json, editKey: "k_" + name, superseded: false, error: null }; },
      };
    }

    if (!RET) { check("retention: ERP.retention exposed", false); return { passed: 0, failed: 1, results }; }

    const srv = makeServer();
    const core = COL.createCore({ entropy: "retention-" + uid });
    try {
      check("retention: ERP.retention exposed", ["policy", "pack", "unpack", "wireBody", "codecStats", "batch", "sendBatch", "rollup", "apply", "capacity", "stats", "renderRetention", "human"].every((f) => typeof RET[f] === "function"));

      const p = RET.policy();
      check("retention: the policy mirrors metrics limits", p.metrics.raw === MET.RAW_LIMIT() && p.metrics.hourly === MET.HOURLY_LIMIT() && p.metrics.daily === MET.DAILY_LIMIT() && p.metrics.maxSamplesPerPost === MET.MAX_SAMPLES_PER_POST());
      check("retention: the policy mirrors job + log limits", p.jobs.retentionHours === Number(ERP.configVal("rmm.jobRetentionHours", 168)) && p.logs.keep === DIAG.logKeep() && p.logs.selfTestKeep === DIAG.selfTestKeep());
      check("retention: the policy mirrors collector scale limits", p.scale.deviceOpsPerMinute === COL.createCore({}).limits.deviceOpsPerMinute && p.scale.maxBatchOps === COL.createCore({}).limits.maxBatchOps && p.scale.packThreshold === COL.PACK_THRESHOLD);
      check("retention: the policy mirrors event-stream config", p.events.history === Math.max(20, Number(ERP.configVal("rmm.eventHistory", 200))) && p.events.pollSeconds === Math.max(5, Number(ERP.configVal("rmm.eventPollSeconds", 15))));

      /* ── codec ── */
      const json = JSON.stringify({ device: { deviceId: "dev-1", providerId: "prov-1", hostname: "WS-1" }, samples: Array.from({ length: 40 }, () => ({ at: "2026-01-01T00:00:00.000Z", cpuPct: 12.5, memPct: 66.6, diskPct: 71.1 })), jobs: Array.from({ length: 12 }, (_, i) => ({ jobId: "job-" + i, state: "queued", ref: "ref-1", correlation: "cor-1" })) });
      const packed = RET.pack(json);
      check("retention: the codec shrinks a repetitive payload", packed.length < json.length);
      check("retention: the codec round-trips exactly", RET.unpack(packed) === json);
      check("retention: small / non-repetitive text passes through", RET.pack("tiny") === "tiny" && RET.pack(JSON.stringify({ a: 1, b: 2 })) === JSON.stringify({ a: 1, b: 2 }));
      check("retention: unpack leaves a plain string untouched", RET.unpack("plain text") === "plain text");
      const uni = JSON.stringify({ "na\u00efve key": "caf\u00e9 \u2713 \u65e5\u672c", "quote\"key": "back\\slash", a: "na\u00efve key", b: "na\u00efve key" });
      check("retention: unicode + escapes survive the codec", RET.unpack(RET.pack(uni)) === uni);

      const big = { payload: { samples: Array.from({ length: 140 }, () => ({ at: "2026-01-01T00:00:00.000Z", cpuPct: 1.5, memPct: 2.5, diskPct: 3.5 })) } };
      const w = RET.wireBody(big);
      check("retention: wireBody compresses a large body", typeof w === "string" && RET.unpack(w) === JSON.stringify(big));
      const small = { a: 1 };
      check("retention: wireBody leaves a small body untouched", RET.wireBody(small) === small && RET.wireBody(7) === 7);
      const cs = RET.codecStats(big);
      check("retention: codecStats measures + verifies the round-trip", cs.rawBytes === JSON.stringify(big).length && cs.packedBytes < cs.rawBytes && cs.ratio < 100 && cs.roundTrip === true);

      const batched = RET.batch(Array.from({ length: 40 }, () => ({ op: "ping" })));
      check("retention: batch caps the op count", batched.ops.length === p.scale.maxBatchOps);

      /* ── roll-ups ── */
      const roll = RET.rollup([
        { at: "2026-01-01T00:10:00Z", cpuPct: 10, memPct: 20 },
        { at: "2026-01-01T00:50:00Z", cpuPct: 30, memPct: 40 },
        { at: "2026-01-01T01:10:00Z", cpuPct: 50, memPct: 60 },
        { at: "2026-01-02T00:10:00Z", cpuPct: 70, memPct: 80 },
      ]);
      check("retention: roll-up groups into hourly + daily tiers", roll.hourly.length === 3 && roll.daily.length === 2);
      check("retention: hourly buckets use the metrics aggregator", roll.hourly[0].bucket === "2026-01-01T00:00:00.000Z" && roll.hourly[0].agg.values.cpuPct.count === 2 && Math.round(roll.hourly[0].agg.values.cpuPct.sum / 2) === 20);
      check("retention: daily buckets key by date", roll.daily[0].bucket === "2026-01-01" && roll.daily[0].agg.values.memPct.count === 3);
      check("retention: human formats bytes", RET.human(0) === "0 B" && RET.human(1536) === "1.5 KiB" && RET.human(2 * 1024 * 1024) === "2.00 MiB");

      /* ── backend + hub ── */
      DSP.locked = false;
      store.useBackend(srv);
      store.resetAllLocal();
      T.reload();
      const prov = await T.create({ name: "Retention " + uid, sites: [{ id: "site-hq", name: "HQ" }] });
      const pid = prov.provider.id;
      const d1 = (await D.add(pid, { hostname: "RET-1", siteId: "site-hq", os: { name: "Ubuntu 22.04" }, lastSeenAt: now(), status: "online" })).device.id;
      await D.add(pid, { hostname: "RET-2", siteId: "site-hq", os: { name: "Windows 11" }, lastSeenAt: now(), status: "online" });
      const hub = rmmMockHub(core, PASSWORD);
      COL.setTransport(hub);
      await DSP.unlock(PASSWORD);
      rmmEnrollCollector(core, pid, d1, "RET-1");

      check("retention: a batch round-trips through the collector", (await RET.sendBatch([{ op: "ping" }])).ok === true);

      /* seed the collector's durable regions past the policy */
      const st = core.state();
      st.metrics[d1] = { samples: Array.from({ length: 300 }, () => ({ at: now(), cpuPct: 1 })), hourly: Array.from({ length: 200 }, () => ({ at: "x", n: 1 })), daily: Array.from({ length: 100 }, () => ({ at: "y", n: 1 })), latest: null, updatedAt: now() };
      st.logs[d1] = Array.from({ length: 15 }, () => ({ receivedAt: now(), text: "line" }));
      st.diagnostics[d1] = Array.from({ length: 25 }, () => ({ receivedAt: now(), ok: true }));
      st.devices[d1].jobHistory = Array.from({ length: 80 }, () => ({ jobId: "j", state: "succeeded", at: now() }));
      st.devices[d1].updateHistory = Array.from({ length: 40 }, () => ({ at: now(), ok: true }));
      const historyKeep = Math.max(1, Number(ERP.configVal("rmm.jobHistoryKeep", 50)));
      const updateKeep = Math.max(1, Number(ERP.configVal("rmm.updateHistoryLimit", 20)));
      const cprune = await COL.applyRetention({ rawMax: p.metrics.raw, hourlyMax: p.metrics.hourly, dailyMax: p.metrics.daily, logKeep: p.logs.keep, selfTestKeep: p.logs.selfTestKeep, updateKeep, historyKeep, jobRetentionHours: p.jobs.retentionHours });
      check("retention: COL.applyRetention bounds every per-device region", cprune.ok === true && cprune.metrics >= 1 && cprune.logs >= 5 && cprune.diagnostics >= 5 && cprune.history >= 1, JSON.stringify(cprune));
      check("retention: the collector's metric rings are capped", st.metrics[d1].samples.length === p.metrics.raw && st.metrics[d1].hourly.length === p.metrics.hourly && st.metrics[d1].daily.length === p.metrics.daily);
      check("retention: the collector's log + self-test rings are capped", st.logs[d1].length === p.logs.keep && st.diagnostics[d1].length === p.logs.selfTestKeep);
      check("retention: the collector's job + update history is capped", st.devices[d1].jobHistory.length === historyKeep && st.devices[d1].updateHistory.length === updateKeep);

      /* ERP-side documents */
      await store.saveDoc(MET.MODULE, [{ kind: "series", providerId: pid, deviceId: d1, raw: Array.from({ length: 300 }, () => ({ at: now() })), hourly: Array.from({ length: 200 }, () => ({ bucket: "h" })), daily: Array.from({ length: 100 }, () => ({ bucket: "d" })) }]);
      const diagRecs = [];
      for (let i = 0; i < 15; i++) diagRecs.push({ kind: "log", deviceId: d1, receivedAt: now(), text: "l" + i });
      for (let i = 0; i < 25; i++) diagRecs.push({ kind: "selftest", deviceId: d1, receivedAt: now(), ok: true });
      await store.saveDoc(DIAG.MODULE, diagRecs);

      const rep = await RET.apply(pid);
      check("retention: apply() enforces the policy on every side", !!(rep.collector && rep.collector.ok === true) && rep.metrics.pruned >= 1 && rep.diagnostics.pruned >= 1, JSON.stringify(rep));
      const metRec = (await MET.load()).find((r) => r.kind === "series");
      check("retention: apply() trims the ERP metric rings", !!metRec && metRec.raw.length === p.metrics.raw && metRec.hourly.length === p.metrics.hourly && metRec.daily.length === p.metrics.daily);
      const dgRecs = await DIAG.load();
      check("retention: apply() trims the ERP diagnostic rings", dgRecs.filter((r) => r.kind === "log").length === p.logs.keep && dgRecs.filter((r) => r.kind === "selftest").length === p.logs.selfTestKeep);

      /* capacity + stats */
      const cap = await RET.capacity();
      check("retention: capacity reports every document", Array.isArray(cap.docs) && cap.docs.length >= 1 && cap.docs.every((d) => typeof d.bytes === "number") && typeof cap.collector.bytes === "number", JSON.stringify({ docs: cap.docs.length }));
      check("retention: capacity summarises the collector", !!cap.collector.counts && cap.collector.counts.devices >= 1 && typeof cap.collector.counts.jobs === "number");
      const stats = await RET.stats(pid);
      check("retention: stats combine the policy + capacity", stats.policy.version === 1 && stats.docCount === cap.docs.length && typeof stats.totalBytes === "number");

      /* ── UI ── */
      const probe = document.createElement("div");
      document.body.appendChild(probe);
      await RET.renderRetention(probe, { providerId: pid, toast() {}, refresh() {} });
      check("retention: the UI renders KPIs + the policy table", probe.querySelectorAll(".erp-stat").length >= 4 && /Retention & scale policy/.test(probe.textContent));
      check("retention: the UI offers apply / reaper / codec actions", !!probe.querySelector('[data-act="ret-apply"]') && !!probe.querySelector('[data-act="ret-reap"]') && !!probe.querySelector('[data-act="ret-codec"]'));
      check("retention: the UI lists the capacity documents", /Capacity/.test(probe.textContent) && probe.querySelectorAll("table").length >= 2);
      probe.remove();

      check("retention: every canonical file stays in the rmm namespace", Object.keys(srv.files).every((n) => n.indexOf("rmm-v1-") === 0));
    } catch (e) {
      check("retention: harness did not crash", false, (e && e.stack) || String(e));
    } finally {
      try { DSP.locked = false; } catch (e) {}
      try { COL.setTransport(null); } catch (e) {}
      try { store.useBackend(null); } catch (e) {}
      try { store.resetAllLocal(); } catch (e) {}
      try { T.reload(); } catch (e) {}
    }

    const passed = results.filter((r) => r.ok).length;
    const failed = results.length - passed;
    return { passed, failed, results };
  };

  /* ============================================================
     Task 18 — device groups & tags
     Run via page_eval:  await window.RMMGroupsTest()
     Covers: the field/operator catalogue, condition evaluation for
     every field type, AND/OR rules (and the zero-condition guard),
     static + dynamic membership, the merged membership view,
     group CRUD + validation, explicit membership, the tag
     vocabulary (apply/remove/rename/merge), reconciliation,
     dynamic-group dispatch targeting, and the Groups station UI.
     ============================================================ */
  window.RMMGroupsTest = async function (opts) {
    opts = opts || {};
    results.length = 0;
    const ERP = window.ERP;
    const store = ERP.store;
    const T = ERP.tenancy;
    const D = ERP.devices;
    const G = ERP.groups;
    const uid = Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);

    function makeServer() {
      const files = {};
      return {
        files,
        async get(name) { return Object.prototype.hasOwnProperty.call(files, name) ? files[name] : null; },
        async set(name, json) { const prev = files[name]; files[name] = json; return { created: prev === undefined, unchanged: prev === json, editKey: "k_" + name, superseded: false, error: null }; },
      };
    }

    if (!G) { check("groups: ERP.groups exposed", false); return { passed: 0, failed: 1, results }; }
    const srv = makeServer();
    try {
      check("groups: ERP.groups exposed", Array.isArray(G.FIELDS) && ["field", "operatorsFor", "evaluateCondition", "evaluateRule", "devicesInGroup", "membershipIds", "matchTargets", "add", "update", "remove", "setMembers", "addMember", "removeMember", "reconcile", "tagsOf", "tagDevices", "applyTag", "removeTag", "renameTag", "mergeTags", "render", "seedDemo"].every((f) => typeof G[f] === "function"));
      check("groups: the field catalogue covers OS, identity, hardware, placement, software & agent", G.FIELDS.length >= 18 && !!G.field("os.family") && !!G.field("site") && !!G.field("tag") && !!G.field("software") && !!G.field("service") && !!G.field("agentVersion"));
      check("groups: each field type exposes the right operators", G.operatorsFor("tag").some((o) => o.id === "has_tag") && G.operatorsFor("diskUsedPct").some((o) => o.id === "gte") && G.operatorsFor("software").some((o) => o.id === "installed") && G.operatorsFor("service").some((o) => o.id === "running") && G.operatorsFor("os.family").some((o) => o.id === "is"));

      store.useBackend(srv);
      store.resetAllLocal();
      T.reload();

      const created = await T.create({
        name: "Groups " + uid,
        sites: [{ id: "site-hq", name: "HQ" }, { id: "site-br", name: "Branch" }],
        deviceGroups: [{ id: "grp-servers", name: "Servers", kind: "static", siteId: "site-hq" }],
      });
      const pid = created.provider.id;
      const nowIso = new Date().toISOString();
      const ago = (ms) => new Date(Date.now() - ms).toISOString();
      const d1 = (await D.add(pid, { hostname: "GRP-WIN1", role: "server", siteId: "site-hq", groupIds: ["grp-servers"], status: "online", lastSeenAt: nowIso, ramBytes: 32 * 1024 * 1024 * 1024, tags: ["prod", "critical"], os: { name: "Windows 11", version: "23H2", family: "Windows" }, cpu: { cores: 8 }, manufacturer: "Dell", model: "PowerEdge" })).device.id;
      const d2 = (await D.add(pid, { hostname: "GRP-WIN2", role: "workstation", siteId: "site-hq", groupIds: [], status: "online", lastSeenAt: nowIso, ramBytes: 16 * 1024 * 1024 * 1024, tags: ["prod"], os: { name: "Windows 11", version: "23H2", family: "Windows" }, cpu: { cores: 4 }, manufacturer: "HP", model: "EliteBook" })).device.id;
      const d3 = (await D.add(pid, { hostname: "GRP-LNX3", role: "server", siteId: "site-br", groupIds: [], status: "offline", lastSeenAt: ago(7200000), tags: [], os: { name: "Ubuntu 22.04", family: "Linux" }, cpu: { cores: 16 } })).device.id;
      const p = (await T.get(pid)).provider;
      const devs = p.devices.map(D.normalizeDevice);
      const dOf = (id) => devs.find((d) => String(d.id) === String(id));
      const ctx = { provider: p, soft: { [d1]: ["chrome", "7-zip", "microsoft 365 apps"] }, svc: { [d1]: [{ name: "spooler", state: "running" }, { name: "w3svc", state: "stopped" }], [d2]: [{ name: "spooler", state: "stopped" }] }, patches: {} };

      /* ── condition evaluation ── */
      check("groups: text comparisons", G.evaluateCondition({ field: "os.family", op: "is", value: "Windows" }, dOf(d1), ctx) === true && G.evaluateCondition({ field: "os.name", op: "contains", value: "ubuntu" }, dOf(d1), ctx) === false && G.evaluateCondition({ field: "os.version", op: "starts_with", value: "23" }, dOf(d2), ctx) === true && G.evaluateCondition({ field: "hostname", op: "ends_with", value: "win1" }, dOf(d1), ctx) === true);
      check("groups: number comparisons", G.evaluateCondition({ field: "diskUsedPct", op: "gte", value: 0 }, dOf(d1), ctx) === true && G.evaluateCondition({ field: "cpuCores", op: "gt", value: 8 }, dOf(d1), ctx) === false && G.evaluateCondition({ field: "ramBytes", op: "lt", value: 20 * 1024 * 1024 * 1024 }, dOf(d2), ctx) === true);
      check("groups: tag conditions", G.evaluateCondition({ field: "tag", op: "has_tag", value: "PROD" }, dOf(d1), ctx) === true && G.evaluateCondition({ field: "tag", op: "has_tag", value: "nope" }, dOf(d1), ctx) === false && G.evaluateCondition({ field: "tag", op: "not_has_tag", value: "nope" }, dOf(d3), ctx) === true);
      check("groups: site conditions", G.evaluateCondition({ field: "site", op: "is", value: "site-hq" }, dOf(d1), ctx) === true && G.evaluateCondition({ field: "site", op: "in", value: "site-hq,site-br" }, dOf(d3), ctx) === true && G.evaluateCondition({ field: "site", op: "not_in", value: "site-hq" }, dOf(d3), ctx) === true);
      check("groups: the software condition reads the inventory index", G.evaluateCondition({ field: "software", op: "installed", value: "chrome" }, dOf(d1), ctx) === true && G.evaluateCondition({ field: "software", op: "installed", value: "chrome" }, dOf(d2), ctx) === false && G.evaluateCondition({ field: "software", op: "not_installed", value: "visio" }, dOf(d2), ctx) === true);
      check("groups: the service condition reads service state", G.evaluateCondition({ field: "service", op: "running", value: "spooler" }, dOf(d1), ctx) === true && G.evaluateCondition({ field: "service", op: "running", value: "spooler" }, dOf(d2), ctx) === false && G.evaluateCondition({ field: "service", op: "exists", value: "w3svc" }, dOf(d1), ctx) === true);
      check("groups: an invalid condition normalises to a safe default", (function () { const c = G.normalizeCondition({ field: "nope", op: "nope", value: "x" }); return c.field === "os.family" && c.op === "is"; })());

      /* ── rules ── */
      const winRule = { kind: "dynamic", match: "all", conditions: [{ field: "os.family", op: "is", value: "Windows" }, { field: "os.version", op: "starts_with", value: "23H2" }] };
      check("groups: an ALL rule requires every condition", G.evaluateRule(winRule, dOf(d1), ctx) === true && G.evaluateRule(winRule, dOf(d3), ctx) === false);
      const anyRule = { kind: "dynamic", match: "any", conditions: [{ field: "role", op: "is", value: "server" }, { field: "tag", op: "has_tag", value: "prod" }] };
      check("groups: an ANY rule needs just one condition", G.evaluateRule(anyRule, dOf(d2), ctx) === true && G.evaluateRule({ kind: "dynamic", match: "any", conditions: [{ field: "role", op: "is", value: "router" }] }, dOf(d2), ctx) === false);
      check("groups: a rule with no conditions matches nothing", G.evaluateRule({ kind: "dynamic", match: "all", conditions: [] }, dOf(d1), ctx) === false && G.evaluateRule({ kind: "dynamic", match: "any", conditions: [] }, dOf(d1), ctx) === false);
      check("groups: rule summaries read naturally", /OS family is Windows/.test(G.ruleSummary(winRule, ctx)) && / OR /.test(G.ruleSummary(anyRule, ctx)) && /matches nothing/.test(G.ruleSummary({ conditions: [] }, ctx)));

      /* ── membership ── */
      const servers = G.listOf(p).find((g) => g.id === "grp-servers");
      check("groups: a static group resolves explicit membership", G.devicesInGroup(p, servers).map((d) => d.id).join(",") === d1);
      const winGrp = (await G.add(pid, Object.assign({ name: "Windows 11 fleet" }, winRule))).group;
      check("groups: a dynamic group resolves by rule", G.devicesInGroup(p, winGrp, { ctx }).map((d) => String(d.id)).sort().join(",") === [d1, d2].sort().join(","));
      const prodGrp = (await G.add(pid, { name: "Prod", kind: "dynamic", match: "any", conditions: [{ field: "tag", op: "has_tag", value: "prod" }] })).group;
      const p2 = (await T.get(pid)).provider;
      check("groups: membershipIds merges static and dynamic", G.membershipIds(p2, dOf(d2), ctx).sort().join(",") === [prodGrp.id, winGrp.id].sort().join(","));
      check("groups: groupsForDevice returns every flavour", G.groupsForDevice(p2, dOf(d1), ctx).map((g) => g.id).sort().join(",") === ["grp-servers", winGrp.id, prodGrp.id].sort().join(","));

      /* ── matchTargets ── */
      const mt = G.matchTargets(p2, { tags: ["prod"] }, dOf(d1), ctx);
      check("groups: matchTargets reports the reason and specificity", mt.match === true && mt.matchedBy === "tag" && mt.specificity === 3);
      check("groups: an explicit device target wins over a tag", G.matchTargets(p2, { tags: ["prod"], deviceIds: [d1] }, dOf(d1), ctx).matchedBy === "device");
      check("groups: a group target resolves dynamic membership", G.matchTargets(p2, { groupIds: [winGrp.id] }, dOf(d2), ctx).match === true);
      check("groups: an empty target spec is provider-wide", G.matchTargets(p2, {}, dOf(d1), ctx).matchedBy === "provider");
      check("groups: a non-matching target spec is false", G.matchTargets(p2, { tags: ["nope"] }, dOf(d1), ctx).match === false);
      check("groups: target summaries name groups and tags", /tag/.test(G.targetSummary(p2, { tags: ["prod"] }, ctx)) && /every device/.test(G.targetSummary(p2, {}, ctx)));

      /* ── CRUD + validation ── */
      check("groups: validateGroup rejects a blank name / bad kind", G.validateGroup({ name: "", kind: "bogus" }).valid === false && G.validateGroup({ name: "", kind: "bogus" }).errors.length >= 2);
      check("groups: an unknown site is rejected", (await G.add(pid, { name: "Sites", kind: "dynamic", siteId: "site-nope", match: "all", conditions: [{ field: "role", op: "is", value: "server" }] })).error === "unknown_site");
      const upd = await G.update(pid, winGrp.id, { match: "any" });
      check("groups: update round-trips", upd.group.match === "any" && upd.group.id === winGrp.id);
      check("groups: get returns the group", (await G.get(pid, winGrp.id)).group.name === "Windows 11 fleet");

      /* ── explicit membership ── */
      check("groups: setMembers replaces membership in one write", (await G.setMembers(pid, "grp-servers", [d1, d3])).count === 2);
      check("groups: the new membership is visible", G.devicesInGroup((await T.get(pid)).provider, servers).map((d) => String(d.id)).sort().join(",") === [d1, d3].sort().join(","));
      check("groups: removeMember drops one device", (await G.removeMember(pid, "grp-servers", d3)).ok === true && G.devicesInGroup((await T.get(pid)).provider, servers).map((d) => String(d.id)).join(",") === d1);
      check("groups: addMember adds one device", (await G.addMember(pid, "grp-servers", d3)).ok === true && G.devicesInGroup((await T.get(pid)).provider, servers).map((d) => String(d.id)).sort().join(",") === [d1, d3].sort().join(","));
      check("groups: dynamic membership cannot be assigned", (await G.setMembers(pid, winGrp.id, [d1])).error === "dynamic_membership");

      /* ── tags ── */
      check("groups: the tag vocabulary counts usage", G.tagsOf(p).length >= 2 && (G.tagsOf(p).find((t) => t.name === "prod") || {}).count >= 2);
      check("groups: applyTag adds a tag", (await G.applyTag(pid, "critical", [d2])).ok === true && (await G.tagDevices(pid, "critical")).some((d) => String(d.id) === d2));
      check("groups: removeTag drops a tag", (await G.removeTag(pid, "critical", [d2])).changed === 1 && !(await G.tagDevices(pid, "critical")).some((d) => String(d.id) === d2));
      check("groups: renameTag rewrites every device", (await G.renameTag(pid, "prod", "production")).changed >= 2 && (await G.tagDevices(pid, "production")).length >= 2);
      const merged = await G.mergeTags(pid, "production", "prod");
      const afterMerge = G.tagsOf((await T.get(pid)).provider);
      check("groups: mergeTags folds one tag into another without duplicates", merged.ok === true && (afterMerge.find((t) => t.name === "prod") || {}).count >= 2 && !afterMerge.some((t) => t.name === "production"));
      check("groups: a no-op rename reports noop", (await G.renameTag(pid, "prod", "prod")).noop === true);
      check("groups: suggestTags filters the vocabulary", G.suggestTags(p, "pro").indexOf("prod") !== -1);

      /* ── reconcile ── */
      const rec = await G.reconcile(pid);
      check("groups: reconcile reports every group's live membership", rec.ok === true && rec.groups.length >= 3 && rec.groups.every((r) => typeof r.count === "number") && rec.deviceCount === 3);

      /* ── dispatch integration ── */
      const DSP = ERP.dispatch;
      const dynTargets = await DSP.resolveTargets(pid, { groupIds: [winGrp.id] });
      check("groups: a dynamic group targets its members through dispatch", dynTargets.ok === true && dynTargets.deviceIds.slice().sort().join(",") === [d1, d2].sort().join(","));
      const staticTargets = await DSP.resolveTargets(pid, { groupIds: ["grp-servers"] });
      check("groups: a static group still targets explicit members", staticTargets.deviceIds.slice().sort().join(",") === [d1, d3].sort().join(","));

      /* ── UI ── */
      const probe = document.createElement("div");
      document.body.appendChild(probe);
      await G.render({ el: probe, toast() {}, refresh() {}, empty() {}, error() {} });
      check("groups: the station renders tabs + the groups table", !!probe.querySelector(".rmm-groups") && probe.querySelectorAll(".erp-tabs .tab").length >= 2 && !!probe.querySelector('[data-act="grp-add"]'));
      check("groups: the groups table lists the tenant's groups", probe.querySelectorAll("table tbody tr").length >= 3);
      const tagsTab = probe.querySelector('[data-tab="tags"]');
      if (tagsTab) tagsTab.click();
      check("groups: the tags tab renders the vocabulary table", !!probe.querySelector('[data-panel="tags"]') && probe.querySelectorAll('[data-panel="tags"] table tbody tr').length >= 1);
      probe.remove();

      check("groups: every canonical file stays in the rmm namespace", Object.keys(srv.files).every((n) => n.indexOf("rmm-v1-") === 0));
    } catch (e) {
      check("groups: harness did not crash", false, (e && e.stack) || String(e));
    } finally {
      try { store.useBackend(null); } catch (e) {}
      try { store.resetAllLocal(); } catch (e) {}
      try { T.reload(); } catch (e) {}
    }
    const passed = results.filter((r) => r.ok).length;
    const failed = results.length - passed;
    return { passed, failed, results };
  };

  /* ============================================================
     Task 19 — policy engine
     Run via page_eval:  await window.RMMPoliciesTest()
     Covers: the setting schema (sparse storage + defaults), policy
     validation, applicability + the deterministic precedence order
     (priority → specificity → recency → id), the per-setting
     effective-policy resolution with provenance, group/tag lookups,
     stats, CRUD/duplicate, and the Policies station UI (list +
     effective-policy preview).
     ============================================================ */
  window.RMMPoliciesTest = async function (opts) {
    opts = opts || {};
    results.length = 0;
    const ERP = window.ERP;
    const store = ERP.store;
    const T = ERP.tenancy;
    const D = ERP.devices;
    const P = ERP.policies;
    const uid = Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);

    function makeServer() {
      const files = {};
      return {
        files,
        async get(name) { return Object.prototype.hasOwnProperty.call(files, name) ? files[name] : null; },
        async set(name, json) { const prev = files[name]; files[name] = json; return { created: prev === undefined, unchanged: prev === json, editKey: "k_" + name, superseded: false, error: null }; },
      };
    }

    if (!P) { check("policies: ERP.policies exposed", false); return { passed: 0, failed: 1, results }; }
    const srv = makeServer();
    try {
      check("policies: ERP.policies exposed", ["SCHEMA", "CATEGORIES", "fieldDef", "normalizePolicy", "validate", "applies", "orderForDevice", "effectiveOf", "effective", "get", "list", "add", "update", "remove", "setEnabled", "duplicate", "forGroup", "forTag", "stats", "render", "seedDemo"].every((f) => typeof P[f] === "function" || Array.isArray(P[f]) || typeof P[f] === "object"));
      check("policies: the schema covers monitoring, patch, software & automation", P.CATEGORIES.join(",") === "monitoring,patch,software,automation" && !!P.fieldDef("monitoring", "collectMetrics") && !!P.fieldDef("patch", "rebootPolicy") && !!P.fieldDef("software", "autoUpdate") && !!P.fieldDef("automation", "scriptPolicy"));

      store.useBackend(srv);
      store.resetAllLocal();
      T.reload();

      const created = await T.create({
        name: "Policies " + uid,
        sites: [{ id: "site-hq", name: "HQ" }],
        deviceGroups: [{ id: "grp-srv", name: "Servers", kind: "static" }],
      });
      const pid = created.provider.id;
      const nowIso = new Date().toISOString();
      const d1 = (await D.add(pid, { hostname: "POL-SRV1", role: "server", siteId: "site-hq", groupIds: ["grp-srv"], status: "online", lastSeenAt: nowIso, tags: ["prod"], os: { name: "Ubuntu 22.04" } })).device.id;
      const d2 = (await D.add(pid, { hostname: "POL-WS2", role: "workstation", siteId: "site-hq", groupIds: [], status: "online", lastSeenAt: nowIso, tags: [], os: { name: "Windows 11" } })).device.id;
      const p = (await T.get(pid)).provider;
      const devs = p.devices.map(D.normalizeDevice);
      const dOf = (id) => devs.find((d) => String(d.id) === String(id));

      /* ── schema + normalisation ── */
      const sparse = P.normalizePolicy({ name: "Sparse", settings: { monitoring: { collectMetrics: false }, patch: { rebootPolicy: "always" } } });
      check("policies: settings are stored sparsely (only what is overridden)", Object.keys(sparse.settings).sort().join(",") === "monitoring,patch" && sparse.settings.monitoring.collectMetrics === false && sparse.settings.monitoring.collectInventory === undefined && sparse.settings.patch.rebootPolicy === "always");
      check("policies: a schema default is available per field", P.defaultFor("monitoring", "collectMetrics") === true && P.defaultFor("patch", "rebootPolicy") === "if-required");
      check("policies: validation rejects an unknown category or field", P.validate({ name: "Bad", priority: 1, settings: { nope: { x: 1 }, monitoring: { bogus: 1 } } }).valid === false);
      check("policies: validation rejects a blank name", P.validate({ name: "", priority: 1 }).valid === false);

      /* ── CRUD ── */
      const base = (await P.add(pid, { name: "Baseline", priority: 100, settings: { monitoring: { metricsIntervalSeconds: 120 }, patch: { autoApprove: true } } })).policy;
      const prod = (await P.add(pid, { name: "Production", priority: 200, targets: { tags: ["prod"] }, settings: { monitoring: { metricsIntervalSeconds: 30 } } })).policy;
      const devOnly = (await P.add(pid, { name: "WS2 only", priority: 300, targets: { deviceIds: [d2] }, settings: { software: { autoUpdate: false } } })).policy;
      const tieGroup = (await P.add(pid, { name: "Server tie", priority: 150, targets: { groupIds: ["grp-srv"] }, settings: { monitoring: { inventoryIntervalHours: 6 } } })).policy;
      const tieProvider = (await P.add(pid, { name: "Provider tie", priority: 150, settings: { monitoring: { inventoryIntervalHours: 48 } } })).policy;
      const off = (await P.add(pid, { name: "Disabled high", priority: 999, enabled: false, targets: { deviceIds: [d1] }, settings: { monitoring: { metricsIntervalSeconds: 1 } } })).policy;
      const p2 = (await T.get(pid)).provider;
      const pctx = { provider: p2 };
      check("policies: add stores every policy", (await P.list(pid)).length === 6 && !!base.id && !!prod.id);
      check("policies: a disabled policy is ignored even at high priority", P.applies(p2, off, dOf(d1), pctx).match === false);

      /* ── precedence ── */
      const order = P.orderForDevice(p2, dOf(d1), pctx).map((r) => r.policy.name);
      check("policies: precedence orders by priority then specificity", order.join(" > ") === ["Production", "Server tie", "Provider tie", "Baseline"].join(" > "), order.join(" | "));
      check("policies: a device policy outranks the same-priority provider policy for that device", P.orderForDevice(p2, dOf(d2), pctx).map((r) => r.policy.name)[0] === "WS2 only");

      /* ── effective resolution ── */
      const eff = P.effectiveOf(p2, dOf(d1), pctx);
      check("policies: the highest-precedence setter wins per setting", eff.values["monitoring.metricsIntervalSeconds"].value === 30 && eff.values["monitoring.metricsIntervalSeconds"].policyId === prod.id && eff.values["monitoring.metricsIntervalSeconds"].source === "policy");
      check("policies: specificity breaks a priority tie", eff.values["monitoring.inventoryIntervalHours"].value === 6 && eff.values["monitoring.inventoryIntervalHours"].policyId === tieGroup.id);
      check("policies: an unset field falls back to the schema default", eff.values["software.autoUpdate"].source === "default" && eff.values["software.autoUpdate"].value === true);
      check("policies: a lower-precedence policy still supplies unmatched fields", eff.values["patch.autoApprove"].value === true && eff.values["patch.autoApprove"].policyId === base.id);
      check("policies: the ordered chain is reported with reasons", eff.ordered.map((o) => o.policyId).join(",") === [prod.id, tieGroup.id, tieProvider.id, base.id].join(",") && eff.ordered[0].matchedBy === "tag" && eff.ordered[1].matchedBy === "group");
      check("policies: the device-specific policy resolves for its device", P.effectiveOf(p2, dOf(d2), pctx).values["software.autoUpdate"].value === false);
      const effAsync = await P.effective(pid, d1);
      check("policies: effective(providerId, deviceId) loads the aggregate", effAsync.deviceId === d1 && effAsync.counts.policy >= 3 && effAsync.values["monitoring.metricsIntervalSeconds"].value === 30);

      /* ── lookups / stats ── */
      check("policies: forGroup / forTag find the targeting policies", P.forGroup(p2, "grp-srv").map((x) => x.id).indexOf(tieGroup.id) !== -1 && P.forTag(p2, "prod").map((x) => x.id).indexOf(prod.id) !== -1);
      const st = P.statsOf(p2);
      check("policies: stats summarise coverage", st.total === 6 && st.enabled === 5 && st.disabled === 1 && st.coverage.monitoring >= 3 && typeof st.withPolicy === "number");

      /* ── update / duplicate / remove ── */
      const upd = await P.update(pid, base.id, { priority: 400 });
      const p3 = (await T.get(pid)).provider;
      check("policies: update changes priority and reorders precedence", upd.policy.priority === 400 && P.orderForDevice(p3, dOf(d2), { provider: p3 }).map((r) => r.policy.name)[0] === "Baseline");
      const dup = await P.duplicate(pid, base.id);
      check("policies: duplicate copies with a new id", dup.policy.id !== base.id && dup.policy.name.indexOf("copy") !== -1);
      check("policies: setEnabled toggles", (await P.setEnabled(pid, dup.policy.id, false)).policy.enabled === false);
      check("policies: remove drops the policy", (await P.remove(pid, dup.policy.id)).removed === dup.policy.id && (await P.list(pid)).length === 6);

      /* ── UI ── */
      const probe = document.createElement("div");
      document.body.appendChild(probe);
      await P.render({ el: probe, toast() {}, refresh() {}, empty() {}, error() {} });
      check("policies: the station renders a table + the New policy action", !!probe.querySelector(".rmm-policies") && !!probe.querySelector('[data-act="pol-add"]') && probe.querySelectorAll("table tbody tr").length >= 6);
      const effTab = probe.querySelector('[data-tab="effective"]');
      if (effTab) effTab.click();
      check("policies: the effective preview renders the precedence chain + resolved settings", !!probe.querySelector(".rmm-precedence") && probe.querySelectorAll('[data-panel="effective"] table').length >= 4 && /Precedence chain/.test(probe.textContent));
      probe.remove();

      check("policies: every canonical file stays in the rmm namespace", Object.keys(srv.files).every((n) => n.indexOf("rmm-v1-") === 0));
    } catch (e) {
      check("policies: harness did not crash", false, (e && e.stack) || String(e));
    } finally {
      try { store.useBackend(null); } catch (e) {}
      try { store.resetAllLocal(); } catch (e) {}
      try { T.reload(); } catch (e) {}
    }
    const passed = results.filter((r) => r.ok).length;
    const failed = results.length - passed;
    return { passed, failed, results };
  };

  /* ============================================================
     Task 20 — monitor types
     Run via page_eval:  await window.RMMMonitorsTest()
     Covers: the full type catalogue + defaults, normalisation and
     required-setting validation, evaluation for every monitor family
     (threshold, service, process, event-log, application/port/web,
     script, SNMP, agent, patch, AV, backup), the "for N minutes"
     duration (fire + clear), per-group / per-device overrides,
     targeting, CRUD, simulate/forDevice, and the Monitors station UI.
     ============================================================ */
  window.RMMMonitorsTest = async function (opts) {
    opts = opts || {};
    results.length = 0;
    const ERP = window.ERP;
    const store = ERP.store;
    const T = ERP.tenancy;
    const D = ERP.devices;
    const MON = ERP.monitors;
    const G = ERP.groups;
    const uid = Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);

    function makeServer() {
      const files = {};
      return {
        files,
        async get(name) { return Object.prototype.hasOwnProperty.call(files, name) ? files[name] : null; },
        async set(name, json) { const prev = files[name]; files[name] = json; return { created: prev === undefined, unchanged: prev === json, editKey: "k_" + name, superseded: false, error: null }; },
      };
    }

    if (!MON) { check("monitors: ERP.monitors exposed", false); return { passed: 0, failed: 1, results }; }
    const srv = makeServer();
    try {
      check("monitors: ERP.monitors exposed", ["TYPES", "type", "types", "normalizeMonitor", "validate", "appliesTo", "effective", "effectiveThresholds", "evaluate", "assess", "latestReading", "forDevice", "simulate", "get", "list", "add", "update", "remove", "stats", "render", "seedDemo"].every((f) => typeof MON[f] === "function" || Array.isArray(MON[f])));
      const REQUIRED = ["updown", "cpu", "memory", "disk", "service", "process", "eventlog", "application", "port", "web", "script", "snmp", "agent", "patch", "av", "backup"];
      check("monitors: the catalogue covers every documented type", REQUIRED.every((id) => MON.type(id)) && MON.TYPES.length >= 16, REQUIRED.filter((id) => !MON.type(id)).join(","));
      check("monitors: every type declares settings + thresholds arrays", MON.TYPES.every((t) => Array.isArray(t.settings) && Array.isArray(t.thresholds) && t.category));
      check("monitors: categories match the master-config taxonomy", ["availability", "performance", "service", "process", "eventlog", "application", "network", "script", "snmp", "patch", "security", "backup"].every((c) => MON.CATEGORIES.indexOf(c) !== -1));
      const cpud = MON.typeDefaults("cpu");
      check("monitors: a type seeds its own default thresholds + duration", cpud.thresholds.warning === 85 && cpud.thresholds.critical === 95 && cpud.forMinutes >= 0 && cpud.intervalSeconds >= 10);

      /* ── normalisation + validation ── */
      const svc = MON.normalizeMonitor({ name: "Spooler", type: "service" });
      check("monitors: normalisation seeds settings defaults", svc.settings.expectedState === "running" && svc.enabled === true && svc.severity === "sev-critical");
      check("monitors: a required setting is enforced", MON.validate(svc).valid === false && MON.validate(MON.normalizeMonitor({ name: "Spooler", type: "service", settings: { name: "Spooler" } })).valid === true);
      check("monitors: an unknown type falls back to cpu", MON.normalizeMonitor({ name: "x", type: "nope" }).type === "cpu");
      check("monitors: an override keeps only its scope/id/thresholds", (function () { const m = MON.normalizeMonitor({ name: "o", type: "disk", overrides: [{ scope: "group", id: "grp-1", thresholds: { warning: 70 } }] }); return m.overrides.length === 1 && m.overrides[0].scope === "group" && m.overrides[0].thresholds.warning === 70; })());

      /* ── evaluation: thresholds ── */
      const cpuTh = { warning: 85, critical: 95 };
      check("monitors: CPU thresholds", MON.evaluate("cpu", { metrics: { cpuPct: 50 } }, { thresholds: cpuTh }).state === "ok" && MON.evaluate("cpu", { metrics: { cpuPct: 90 } }, { thresholds: cpuTh }).state === "warning" && MON.evaluate("cpu", { metrics: { cpuPct: 96 } }, { thresholds: cpuTh }).state === "critical");
      check("monitors: memory + disk thresholds", MON.evaluate("memory", { metrics: { memPct: 88 } }, { thresholds: cpuTh }).state === "warning" && MON.evaluate("disk", { metrics: { diskPct: 99 } }, { thresholds: cpuTh }).state === "critical");
      check("monitors: a missing sample is unknown", MON.evaluate("cpu", { metrics: {} }, { thresholds: cpuTh }).state === "unknown");

      /* ── evaluation: state-based ── */
      check("monitors: service state", MON.evaluate("service", { services: [{ name: "Spooler", state: "running" }] }, { settings: { name: "Spooler", expectedState: "running" } }).state === "ok" && MON.evaluate("service", { services: [{ name: "Spooler", state: "stopped" }] }, { settings: { name: "Spooler", expectedState: "running" } }).state === "critical" && MON.evaluate("service", { services: [] }, { settings: { name: "Spooler", expectedState: "running" } }).state === "critical");
      check("monitors: process state", MON.evaluate("process", { processes: [{ name: "chrome" }] }, { settings: { name: "chrome", expected: "present", minCount: 1 } }).state === "ok" && MON.evaluate("process", { processes: [] }, { settings: { name: "chrome", expected: "present", minCount: 1 } }).state === "critical");
      check("monitors: the event-log monitor counts matching events", MON.evaluate("eventlog", { events: [{ log: "System", level: "Error", eventId: "6008" }] }, { settings: { log: "System", level: "Error" }, thresholds: { count: 1 } }).state === "warning" && MON.evaluate("eventlog", { events: [] }, { settings: { log: "System", level: "Error" }, thresholds: { count: 1 } }).state === "ok");
      check("monitors: the application check delegates to service/process/port", MON.evaluate("application", { processes: [{ name: "sqlservr" }] }, { settings: { check: "process", name: "sqlservr" } }).state === "ok");

      /* ── evaluation: probe-based ── */
      check("monitors: a port probe", MON.evaluate("port", {}, { settings: { port: 443 }, probe: { ok: true } }).state === "ok" && MON.evaluate("port", {}, { settings: { port: 443 }, probe: { ok: false } }).state === "critical" && MON.evaluate("port", {}, { settings: { port: 443 } }).state === "unknown");
      check("monitors: a web probe checks status + response time", MON.evaluate("web", {}, { settings: { url: "https://x" }, thresholds: { responseMs: 3000 }, probe: { ok: true, status: 200, responseMs: 500 } }).state === "ok" && MON.evaluate("web", {}, { settings: { url: "https://x" }, thresholds: { responseMs: 3000 }, probe: { ok: true, status: 200, responseMs: 9000 } }).state === "warning");
      check("monitors: a script probe checks the exit code + value thresholds", MON.evaluate("script", {}, { settings: { expectExitCode: 0 }, probe: { exitCode: 1 } }).state === "critical" && MON.evaluate("script", {}, { settings: { expectExitCode: 0 }, thresholds: { warning: 30, critical: 50 }, probe: { exitCode: 0, value: 42 } }).state === "warning" && MON.evaluate("script", {}, { settings: { expectExitCode: 0 }, thresholds: { warning: 30, critical: 50 }, probe: { exitCode: 0, value: 60 } }).state === "critical");
      check("monitors: an SNMP probe compares the OID value", MON.evaluate("snmp", {}, { settings: { operator: ">" }, thresholds: { warning: 10, critical: 20 }, probe: { ok: true, value: 25 } }).state === "critical" && MON.evaluate("snmp", {}, { settings: { operator: "<" }, thresholds: { warning: 10, critical: 20 }, probe: { ok: true, value: 5 } }).state === "critical");

      /* ── evaluation: agent / patch / av / backup ── */
      const nowMs = Date.now();
      check("monitors: the agent monitor uses last-seen age", MON.evaluate("agent", { lastSeenAt: new Date(nowMs - 60000).toISOString() }, { settings: { staleAfterMinutes: 5, offlineAfterMinutes: 15 }, now: nowMs }).state === "ok" && MON.evaluate("agent", { lastSeenAt: new Date(nowMs - 10 * 60000).toISOString() }, { settings: { staleAfterMinutes: 5, offlineAfterMinutes: 15 }, now: nowMs }).state === "warning" && MON.evaluate("agent", { lastSeenAt: new Date(nowMs - 20 * 60000).toISOString() }, { settings: { staleAfterMinutes: 5, offlineAfterMinutes: 15 }, now: nowMs }).state === "critical");
      check("monitors: the up/down monitor maps device status", MON.evaluate("updown", { status: "online" }, {}).state === "ok" && MON.evaluate("updown", { status: "stale" }, {}).state === "warning" && MON.evaluate("updown", { status: "offline" }, {}).state === "critical");
      check("monitors: the patch monitor counts missing patches by classification", MON.evaluate("patch", { patches: [{ classification: "SecurityUpdates" }, { classification: "FeaturePacks" }] }, { settings: { classifications: ["SecurityUpdates"] }, thresholds: { missingCount: 0 } }).state === "warning" && MON.evaluate("patch", { patches: [{ classification: "SecurityUpdates", status: "installed" }] }, { settings: { classifications: ["SecurityUpdates"] }, thresholds: { missingCount: 0 } }).state === "ok");
      check("monitors: the AV monitor checks real-time protection", MON.evaluate("av", { security: { enabled: true, realTimeProtection: false } }, { settings: { requireRealTime: true } }).state === "critical");
      check("monitors: the backup monitor checks age + result", MON.evaluate("backup", { backup: { lastSuccessAt: new Date(nowMs - 30 * 3600000).toISOString(), lastResult: "success" } }, { settings: { requireSuccess: true }, thresholds: { maxAgeHours: 26 } }).state === "critical" && MON.evaluate("backup", { backup: { lastSuccessAt: new Date(nowMs - 3600000).toISOString(), lastResult: "success" } }, { settings: { requireSuccess: true }, thresholds: { maxAgeHours: 26 } }).state === "ok");

      /* ── duration ("for N minutes") ── */
      const durMon = MON.normalizeMonitor({ name: "CPU dur", type: "cpu", forMinutes: 5, thresholds: { warning: 85, critical: 95 } });
      const hot = { metrics: { cpuPct: 90 } };
      const t0 = nowMs;
      const a1 = MON.assess(durMon, hot, null, { now: t0 });
      check("monitors: a breach starts the duration without firing", a1.state === "warning" && a1.fired === false && a1.since === new Date(t0).toISOString());
      const a2 = MON.assess(durMon, hot, a1, { now: t0 + 4 * 60000 });
      check("monitors: within the duration it has not fired", a2.fired === false && a2.changed === false);
      const a3 = MON.assess(durMon, hot, a2, { now: t0 + 6 * 60000 });
      check("monitors: holding past the duration fires", a3.fired === true);
      const a4 = MON.assess(durMon, { metrics: { cpuPct: 10 } }, a3, { now: t0 + 7 * 60000 });
      check("monitors: recovery clears the state", a4.state === "ok" && a4.cleared === true && a4.fired === false);
      check("monitors: a zero duration fires immediately", MON.assess(MON.normalizeMonitor({ name: "Now", type: "cpu", forMinutes: 0, thresholds: { warning: 85, critical: 95 } }), hot, null, { now: t0 }).fired === true);
      check("monitors: an escalation restarts the duration", MON.assess(durMon, { metrics: { cpuPct: 99 } }, a3, { now: t0 + 6 * 60000 + 1000 }).changed === true);

      /* ── overrides ── */
      store.useBackend(srv);
      store.resetAllLocal();
      T.reload();
      const prov = await T.create({ name: "Monitors " + uid, sites: [{ id: "site-hq", name: "HQ" }], deviceGroups: [{ id: "grp-srv", name: "Servers", kind: "static" }] });
      const pid = prov.provider.id;
      const nowIso = new Date().toISOString();
      const d1 = (await D.add(pid, { hostname: "MON-SRV1", role: "server", groupIds: ["grp-srv"], tags: ["prod"], status: "online", lastSeenAt: nowIso, os: { name: "Ubuntu 22.04" } })).device.id;
      const d2 = (await D.add(pid, { hostname: "MON-WS2", role: "workstation", status: "online", lastSeenAt: nowIso, tags: [], os: { name: "Windows 11" } })).device.id;
      const p = (await T.get(pid)).provider;
      const devs = p.devices.map(D.normalizeDevice);
      const dOf = (id) => devs.find((d) => String(d.id) === String(id));
      const ctx = { provider: p, soft: {}, svc: {}, patches: {} };

      const ovMon = MON.normalizeMonitor({ name: "Disk", type: "disk", targets: { tags: ["prod"] }, thresholds: { warning: 85, critical: 95 }, overrides: [{ scope: "group", id: "grp-srv", thresholds: { warning: 70 } }, { scope: "device", id: d1, thresholds: { critical: 80 } }] });
      const eff = MON.effective(ovMon, dOf(d1), p, ctx);
      check("monitors: group + device overrides merge onto the thresholds", eff.thresholds.warning === 70 && eff.thresholds.critical === 80 && eff.sources.thresholds === "device");
      const effOther = MON.effective(ovMon, dOf(d2), p, ctx);
      check("monitors: a device outside the override keeps the monitor value", effOther.thresholds.warning === 85 && effOther.sources.thresholds === "monitor");
      check("monitors: targeting resolves through tags and groups", MON.appliesTo(p, ovMon, dOf(d1), ctx).match === true && MON.appliesTo(p, ovMon, dOf(d2), ctx).match === false);

      /* ── CRUD + simulate + forDevice ── */
      const diskRec = (await MON.add(pid, ovMon)).monitor;
      const agentRec = (await MON.add(pid, { name: "Agent offline", type: "agent", severity: "sev-critical", forMinutes: 0, settings: { staleAfterMinutes: 5, offlineAfterMinutes: 15 } })).monitor;
      check("monitors: add/list round-trips", (await MON.list(pid)).length === 2 && (await MON.get(pid, diskRec.id)).monitor.name === "Disk");
      check("monitors: update normalises the change", (await MON.update(pid, agentRec.id, { forMinutes: 3 })).monitor.forMinutes === 3);
      check("monitors: setEnabled toggles", (await MON.setEnabled(pid, agentRec.id, false)).monitor.enabled === false);
      const sim = await MON.simulate(pid, diskRec.id, d1);
      check("monitors: simulate evaluates a monitor against a device", sim.applies === true && ["ok", "warning", "critical", "unknown"].indexOf(sim.assessment.state) !== -1 && sim.effective.thresholds.warning === 70);
      const simMiss = await MON.simulate(pid, diskRec.id, d2);
      check("monitors: simulate reports a non-target device", simMiss.applies === false);
      const fd = await MON.forDevice(pid, d1, {});
      check("monitors: forDevice assesses each applicable monitor", fd.deviceId === d1 && fd.monitors.length >= 1 && typeof fd.counts.ok === "number");
      const mst = MON.statsOf((await T.get(pid)).provider);
      check("monitors: stats summarise the catalogue usage", mst.total === 2 && mst.enabled === 1 && mst.overrides === 2 && typeof mst.covered === "number");
      check("monitors: remove drops the monitor", (await MON.remove(pid, agentRec.id)).removed === agentRec.id && (await MON.list(pid)).length === 1);

      /* ── UI ── */
      const probe = document.createElement("div");
      document.body.appendChild(probe);
      await MON.render({ el: probe, toast() {}, refresh() {}, empty() {}, error() {} });
      check("monitors: the station renders a table + the New monitor action", !!probe.querySelector(".rmm-monitors") && !!probe.querySelector('[data-act="mon-add"]') && probe.querySelectorAll("table tbody tr").length >= 1);
      const catTab = probe.querySelector('[data-tab="catalogue"]');
      if (catTab) catTab.click();
      check("monitors: the catalogue tab lists every type", probe.querySelectorAll('[data-panel="catalogue"] .rmm-cat-grid .erp-card').length >= 16);
      probe.remove();

      check("monitors: every canonical file stays in the rmm namespace", Object.keys(srv.files).every((n) => n.indexOf("rmm-v1-") === 0));
    } catch (e) {
      check("monitors: harness did not crash", false, (e && e.stack) || String(e));
    } finally {
      try { store.useBackend(null); } catch (e) {}
      try { store.resetAllLocal(); } catch (e) {}
      try { T.reload(); } catch (e) {}
    }
    const passed = results.filter((r) => r.ok).length;
    const failed = results.length - passed;
    return { passed, failed, results };
  };
  /* ============================================================
     Task 21 — schedules & maintenance windows
     Run via page_eval:  await window.RMMSchedulesTest()
     Covers: the cron matcher + next-run resolution, business-hours
     calendars per client, maintenance-window scope matching, the
     severity suppression rule, the suppression audit log, the
     non-essential job deferral gate + release, and the station UI.
     ============================================================ */
  window.RMMSchedulesTest = async function (opts) {
    opts = opts || {};
    results.length = 0;
    const ERP = window.ERP;
    const store = ERP.store;
    const T = ERP.tenancy;
    const M = ERP.masterConfig;
    const SCH = ERP.schedules;
    const uid = Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);

    function makeServer() {
      const files = {};
      return {
        files,
        async get(name) { return Object.prototype.hasOwnProperty.call(files, name) ? files[name] : null; },
        async set(name, json) { const prev = files[name]; files[name] = json; return { created: prev === undefined, unchanged: prev === json, editKey: "k_" + name, superseded: false, error: null }; },
      };
    }

    if (!SCH) { check("schedules: ERP.schedules exposed", false); return { passed: 0, failed: 1, results }; }
    const srv = makeServer();
    const DSP = ERP.dispatch;
    const origEnqueue = DSP ? DSP.enqueue : null;
    try {
      check("schedules: ERP.schedules exposed", ["zoned", "cronMatch", "nextRun", "isDue", "scheduleActive", "scheduleMatches", "isWeekend", "calendarStatus", "inBusinessHours", "windowCovers", "windowsCovering", "isSuppressed", "recordSuppression", "suppressions", "clearSuppressions", "gateJob", "defer", "deferred", "releaseDeferred", "render", "renderInto", "stats"].every((f) => typeof SCH[f] === "function"));
      check("schedules: kinds + weekday vocabulary", SCH.KINDS.join(",") === "interval,daily,weekly,monthly,cron" && SCH.WEEKDAYS.length === 7 && SCH.isWeekend("2026-01-04T10:00:00Z", "UTC") === true && SCH.isWeekend("2026-01-05T10:00:00Z", "UTC") === false);

      /* ── cron ── */
      const at = (m, h, d, mo, w) => ({ minute: m, hour: h, day: d, month: mo, weekday: w });
      check("schedules: cron wildcard/daily match", SCH.cronMatch("0 2 * * *", at(0, 2, 15, 6, 1)) === true && SCH.cronMatch("0 2 * * *", at(0, 3, 15, 6, 1)) === false);
      check("schedules: cron lists, ranges and steps", SCH.cronMatch("*/5 * * * *", at(35, 2, 15, 6, 1)) === true && SCH.cronMatch("*/5 * * * *", at(33, 2, 15, 6, 1)) === false && SCH.cronMatch("0 9-17 * * mon-fri", at(0, 13, 15, 6, 3)) === true && SCH.cronMatch("0 9-17 * * mon-fri", at(0, 13, 15, 6, 6)) === false);
      check("schedules: cron weekday names + day-of-month OR day-of-week", SCH.cronMatch("30 6 * * sun", at(30, 6, 15, 6, 0)) === true && SCH.cronMatch("0 0 1 * mon", at(0, 0, 15, 6, 1)) === true);
      const daily = { kind: "daily", timeOfDay: "02:00", timezone: "UTC" };
      const weekly = { kind: "weekly", daysOfWeek: ["mon"], timeOfDay: "09:30", timezone: "UTC" };
      const interval = { kind: "interval", intervalMinutes: 15, timezone: "UTC" };
      const cron = { kind: "cron", cron: "0 3 * * *", timezone: "UTC" };
      check("schedules: nextRun resolves each kind", SCH.nextRun(daily, "2026-01-05T02:30:00Z", "UTC") === "2026-01-06T02:00:00.000Z" && SCH.nextRun(weekly, "2026-01-05T10:00:00Z", "UTC") === "2026-01-12T09:30:00.000Z" && SCH.nextRun(interval, "2026-01-05T10:07:00Z", "UTC") === "2026-01-05T10:15:00.000Z" && SCH.nextRun(cron, "2026-01-05T10:00:00Z", "UTC") === "2026-01-06T03:00:00.000Z");
      check("schedules: isDue accepts a recent occurrence and rejects an old one", SCH.isDue(daily, "2026-01-05T02:02:00Z", "UTC", 5) === true && SCH.isDue(daily, "2026-01-05T02:30:00Z", "UTC", 5) === false);
      check("schedules: a disabled schedule has no next run", SCH.nextRun(Object.assign({}, daily, { enabled: false }), "2026-01-05T02:30:00Z", "UTC") === null);

      /* ── business hours ── */
      store.useBackend(srv);
      store.resetAllLocal();
      T.reload();
      await M.seed({ force: true });
      const created = await T.create({ name: "Schedules " + uid, deviceGroups: [{ id: "grp-srv", name: "Servers", kind: "static" }] });
      const pid = created.provider.id;
      const d1 = (await ERP.devices.add(pid, { hostname: "SCH-SRV1", role: "server", groupIds: ["grp-srv"], status: "online" })).device.id;
      const p = (await T.get(pid)).provider;
      const MON10 = "2026-01-05T10:00:00Z", MON20 = "2026-01-05T20:00:00Z", MON02 = "2026-01-05T02:00:00Z", SUN10 = "2026-01-04T10:00:00Z", SAT10 = "2026-01-03T10:00:00Z";
      const stWork = await SCH.calendarStatus(p, MON10);
      check("schedules: business hours resolve the default calendar", stWork.inHours === true && stWork.afterHours === false && stWork.calendarId === "cal-default");
      check("schedules: after-hours and weekends are detected", (await SCH.inBusinessHours(p, MON20)) === false && (await SCH.calendarStatus(p, SUN10)).weekend === true && (await SCH.inBusinessHours(p, SUN10)) === false);
      check("schedules: the 24×7 calendar is always in hours", (await SCH.inBusinessHours(p, SUN10, "cal-24x7")) === true);
      const tzCal = await SCH.calendarStatus({ id: "nope", timezone: "America/New_York" }, MON10, "cal-does-not-exist");
      check("schedules: an unknown calendar falls back to the default calendar", tzCal.calendarId === "cal-default" && tzCal.timezone === "UTC" && tzCal.inHours === true);

      /* ── maintenance windows: scope + activity ── */
      check("schedules: the seeded nightly window is active at 02:00", (await SCH.windowsCovering(pid, { deviceId: d1, groupIds: ["grp-srv"] }, MON02)).map((w) => w.id).indexOf("mw-nightly") !== -1);
      check("schedules: it is inactive at 10:00", (await SCH.windowsCovering(pid, { deviceId: d1 }, MON10)).map((w) => w.id).indexOf("mw-nightly") === -1);
      check("schedules: the weekend window is active on a Saturday", (await SCH.windowsCovering(pid, { deviceId: d1 }, SAT10)).map((w) => w.id).indexOf("mw-weekend") !== -1);
      const provWin = (await M.add("maintenanceWindows", { label: "Client night", recurrence: "daily", startTime: "01:00", endTime: "05:00", scope: "provider", scopeId: pid, suppressAlerts: true, allowCritical: true })).config ? null : null;
      const winList = await M.section("maintenanceWindows");
      const clientWin = winList.find((w) => w.label === "Client night");
      check("schedules: a provider-scoped window is created", !!clientWin && clientWin.scopeId === pid);
      check("schedules: a provider-scoped window covers its client only", SCH.windowCovers(clientWin, pid, {}) === true && SCH.windowCovers(clientWin, "other-prov", {}) === false);
      const grpWin = (await M.add("maintenanceWindows", { label: "Group patch", recurrence: "daily", startTime: "22:00", endTime: "23:00", scope: "group", scopeId: "grp-srv", suppressAlerts: true, allowCritical: false })).config;
      const gw = (await M.section("maintenanceWindows")).find((w) => w.label === "Group patch");
      check("schedules: a group-scoped window matches membership", SCH.windowCovers(gw, pid, { groupIds: ["grp-srv"] }) === true && SCH.windowCovers(gw, pid, { groupIds: [] }) === false);

      /* ── suppression rule ── */
      const supWarn = await SCH.isSuppressed(pid, { deviceId: d1, groupIds: ["grp-srv"] }, MON02, "sev-warning");
      check("schedules: a warning is suppressed inside the window", supWarn.suppressed === true && supWarn.windows.indexOf("mw-nightly") !== -1);
      const supCrit = await SCH.isSuppressed(pid, { deviceId: d1 }, MON02, "sev-critical");
      check("schedules: a critical alert passes when the window allows it", supCrit.suppressed === false && supCrit.critical === true);
      const supSat = await SCH.isSuppressed(pid, { deviceId: d1 }, SAT10, "sev-critical");
      check("schedules: a no-critical window suppresses criticals", supSat.suppressed === true);
      const supNone = await SCH.isSuppressed(pid, { deviceId: d1 }, MON10, "sev-warning");
      check("schedules: no window means not suppressed", supNone.suppressed === false);

      /* ── suppression log ── */
      await SCH.recordSuppression({ providerId: pid, deviceId: d1, severityId: "sev-warning", windowIds: ["mw-nightly"], reason: "test", at: MON02, source: "test" });
      const sups = await SCH.suppressions(pid, {});
      check("schedules: suppressions are recorded", sups.length === 1 && sups[0].windowIds[0] === "mw-nightly");
      const sst = await SCH.stats(pid);
      check("schedules: suppression stats aggregate by window", sst.suppressions === 1 && sst.byWindow["mw-nightly"] === 1);

      /* ── job deferral gate + release ── */
      const gate = await SCH.gateJob(pid, { deviceIds: [d1], essential: false, at: MON02 });
      check("schedules: a non-essential job is deferred while a window covers the device", gate.deferredDeviceIds.indexOf(String(d1)) !== -1 && gate.allowed.length === 0);
      const gate2 = await SCH.gateJob(pid, { deviceIds: [d1], essential: true, at: MON02 });
      check("schedules: an essential job is allowed through", gate2.allowed.length === 1 && gate2.deferred.length === 0);
      const gate3 = await SCH.gateJob(pid, { deviceIds: [d1], essential: false, at: MON10 });
      check("schedules: outside the window the job is allowed", gate3.allowed.length === 1);
      await SCH.defer(pid, { deviceIds: [d1], payload: { providerId: pid, name: "deferred test", language: "powershell", script: "echo hi" }, windowIds: ["mw-nightly"], jobKind: "job", refId: "test", at: MON02 });
      const pendingDef = await SCH.deferred(pid, {});
      check("schedules: a deferral is queued", pendingDef.length === 1 && pendingDef[0].status === "pending");
      let releasedCalls = [];
      DSP.enqueue = async (o) => { releasedCalls.push(o); return { ok: true, job: { id: "job-rel-" + releasedCalls.length } }; };
      const rel = await SCH.releaseDeferred(pid, MON10);
      check("schedules: a deferral is released and re-queued once the window ends", rel.released === 1 && rel.jobs === 1 && releasedCalls.length === 1 && releasedCalls[0].deviceIds.indexOf(String(d1)) !== -1);
      check("schedules: the released deferral is marked released", (await SCH.deferred(pid, { all: true }))[0].status === "released");

      /* ── clear + UI ── */
      const clr = await SCH.clearSuppressions(pid);
      check("schedules: the suppression log can be cleared", clr.ok === true && (await SCH.suppressions(pid, {})).length === 0);

      const probe = document.createElement("div");
      document.body.appendChild(probe);
      await SCH.renderInto(probe, { providers: await T.list({ force: true }), providerId: pid, toast() {} });
      check("schedules: the panel renders tabs + the schedules table", !!probe.querySelector(".rmm-schedules") && probe.querySelectorAll(".erp-tabs .tab").length >= 4 && probe.querySelectorAll("table tbody tr").length >= 1);
      const winTab = probe.querySelector('[data-tab="windows"]');
      if (winTab) winTab.click();
      check("schedules: the windows tab renders with live status", !!probe.querySelector('[data-panel="windows"]') && probe.querySelectorAll('[data-panel="windows"] table tbody tr').length >= 1);
      probe.remove();

      check("schedules: every canonical file stays in the rmm namespace", Object.keys(srv.files).every((n) => n.indexOf("rmm-v1-") === 0));
      check("schedules: the suppression doc is declared", store.docName("suppressions") === "rmm-v1-suppressions");
    } catch (e) {
      check("schedules: harness did not crash", false, (e && e.stack) || String(e));
    } finally {
      try { DSP.enqueue = origEnqueue; } catch (e) {}
      try { store.useBackend(null); } catch (e) {}
      try { store.resetAllLocal(); } catch (e) {}
      try { T.reload(); } catch (e) {}
      try { await M.seed(); } catch (e) {}
    }
    const passed = results.filter((r) => r.ok).length;
    const failed = results.length - passed;
    return { passed, failed, results };
  };

  /* ============================================================
     Task 23 — script & component library
     Run via page_eval:  await window.RMMScriptsTest()
     Covers: normalisation + validation, typed parameter validation,
     the safe shell-escaping substitution (the headline safety rule),
     per-OS variant resolution, component includes with cycle
     detection, versioning/restore/diff, run preparation + per-OS
     job grouping, import/export, CRUD and the console UI.
     ============================================================ */
  window.RMMScriptsTest = async function (opts) {
    opts = opts || {};
    results.length = 0;
    const ERP = window.ERP;
    const store = ERP.store;
    const T = ERP.tenancy;
    const D = ERP.devices;
    const J = ERP.jobs;
    const LIB = ERP.scripts;
    const uid = Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);

    function makeServer() {
      const files = {};
      return {
        files,
        async get(name) { return Object.prototype.hasOwnProperty.call(files, name) ? files[name] : null; },
        async set(name, json) { const prev = files[name]; files[name] = json; return { created: prev === undefined, unchanged: prev === json, editKey: "k_" + name, superseded: false, error: null }; },
      };
    }

    if (!LIB) { check("scripts: ERP.scripts exposed", false); return { passed: 0, failed: 1, results }; }
    const srv = makeServer();
    const origEnqueue = J.enqueue;
    const enqueues = [];
    try {
      check("scripts: ERP.scripts exposed", ["normalizeScript", "validateScript", "validateParameters", "safeLiteral", "shellForLanguage", "variantFor", "expandComponents", "prepareRun", "applyParameters", "validateRun", "runOn", "add", "update", "remove", "duplicate", "bumpVersion", "restore", "diffVersions", "exportScript", "importScript", "exportBundle", "importBundle", "stats", "render", "renderInto"].every((f) => typeof LIB[f] === "function"));

      /* ── escaping (the safety core) ── */
      check("scripts: PowerShell escaping neutralises quotes and injection", LIB.safeLiteral("a'; Stop-Computer #", "powershell") === "'a''; Stop-Computer #'");
      check("scripts: POSIX escaping neutralises a quote", LIB.safeLiteral("a'; rm -rf /", "bash") === "'a'\\''; rm -rf /'");
      const inj = LIB.safeLiteral("x\" & del C:\\ /y & \"", "cmd");
      check("scripts: cmd escaping doubles quotes", inj.indexOf('""') !== -1 && inj[0] === '"' && inj[inj.length - 1] === '"');
      check("scripts: a shell is derived from the language", LIB.shellForLanguage("powershell") === "powershell" && LIB.shellForLanguage("bash") === "bash" && LIB.shellForLanguage("cmd") === "cmd");

      /* ── normalisation + validation ── */
      const script = LIB.normalizeScript({
        name: "Restart service",
        parameters: [
          { name: "service", type: "string", required: true, pattern: "^[A-Za-z0-9_.\\- ]+$", label: "Service" },
          { name: "force", type: "bool", default: true },
          { name: "retries", type: "number", min: 0, max: 5, default: 1 },
          { name: "mode", type: "enum", options: ["graceful", "hard"], default: "graceful" },
        ],
        variants: [
          { os: "windows", language: "powershell", script: "Restart-Service -Name {{service}}\nWrite-Output '{{service}} mode {{mode}} retries {{retries}} force {{force}}'" },
          { os: "linux", language: "bash", script: "systemctl restart {{service}}" },
        ],
      });
      check("scripts: normalisation seeds the shape", script.kind === "script" && script.variants.length === 2 && script.parameters.length === 4 && script.version === 1);
      check("scripts: validation catches a missing name / no variant", LIB.validateScript({ name: "", variants: [] }).valid === false && LIB.validateScript({ name: "x", variants: [] }).errors.length >= 1);
      check("scripts: an enum needs options", LIB.validateScript({ name: "x", variants: [{ os: "any", language: "bash", script: "echo" }], parameters: [{ name: "m", type: "enum" }] }).valid === false);
      check("scripts: variantFor picks the OS variant then any", LIB.variantFor(script, "windows").os === "windows" && LIB.variantFor(script, "linux").os === "linux" && LIB.variantFor(script, "macos").os === "windows");

      /* ── parameter validation ── */
      const good = LIB.validateParameters(script, { service: "Spooler" });
      check("scripts: valid parameters coerce defaults", good.valid === true && good.values.force === true && good.values.retries === 1 && good.values.mode === "graceful");
      check("scripts: required is enforced", LIB.validateParameters(script, {}).valid === false && LIB.validateParameters(script, {}).errors.some((e) => /required/.test(e)));
      check("scripts: number bounds are enforced", LIB.validateParameters(script, { service: "x", retries: 9 }).valid === false && LIB.validateParameters(script, { service: "x", retries: 3 }).values.retries === 3);
      check("scripts: enum membership is enforced", LIB.validateParameters(script, { service: "x", mode: "nope" }).valid === false);
      check("scripts: a string pattern is enforced", LIB.validateParameters(script, { service: "bad; rm -rf /" }).valid === false);
      check("scripts: unknown parameters are refused", LIB.validateParameters(script, { service: "x", bogus: "1" }).valid === false && LIB.validateParameters(script, { service: "x", bogus: "1" }).errors.some((e) => /unknown parameter/.test(e)));

      /* ── substitution ── */
      const prep = LIB.prepareRun({ scriptLibrary: [] }, script, { service: "Spooler", mode: "hard", retries: 2 });
      check("scripts: parameters are substituted as quoted literals", prep.error === undefined && /Restart-Service -Name 'Spooler'/.test(prep.script) && /mode 'hard'/.test(prep.script) && /retries '2'/.test(prep.script) && /force 'true'/.test(prep.script));
      const evil = LIB.prepareRun({ scriptLibrary: [] }, script, { service: "x'; Stop-Computer #" });
      check("scripts: a pattern-violating value is rejected before substitution", evil.error === "invalid_parameters");
      const freeScript = LIB.normalizeScript({ name: "Free", variants: [{ os: "any", language: "powershell", script: "echo {{arg}}" }], parameters: [{ name: "arg", type: "string" }] });
      const escaped = LIB.prepareRun({ scriptLibrary: [] }, freeScript, { arg: "x'; Stop-Computer #" });
      check("scripts: an unconstrained value is escaped, not executed", escaped.script === "echo 'x''; Stop-Computer #'");
      const missing = LIB.prepareRun({ scriptLibrary: [] }, script, {});
      check("scripts: prepareRun refuses invalid parameters", missing.error === "invalid_parameters");
      const unknownTok = LIB.prepareRun({ scriptLibrary: [] }, LIB.normalizeScript({ name: "t", variants: [{ os: "any", language: "bash", script: "echo {{nope}}" }] }), {});
      check("scripts: an undeclared token is refused", unknownTok.error === "unknown_token");
      check("scripts: the command line is generated", /powershell/i.test(prep.command));

      /* ── components ── */
      const lib = { id: "p1", scriptLibrary: [
        { id: "cmp-a", kind: "component", name: "Header", variants: [{ os: "any", language: "bash", script: "echo header" }] },
        { id: "cmp-b", kind: "component", name: "Nested", variants: [{ os: "any", language: "bash", script: "{{component:cmp-a}}\necho nested" }] },
        { id: "host", kind: "script", name: "Host", variants: [{ os: "any", language: "bash", script: "{{component:cmp-b}}\necho host" }] },
        { id: "cyc1", kind: "component", name: "C1", variants: [{ os: "any", language: "bash", script: "{{component:cyc2}}" }] },
        { id: "cyc2", kind: "component", name: "C2", variants: [{ os: "any", language: "bash", script: "{{component:cyc1}}" }] },
      ] };
      const exp = LIB.expandComponents(lib, LIB.componentOf(lib, "host"), { os: "linux" });
      check("scripts: components expand recursively", !exp.error && /echo header/.test(exp.script) && /echo nested/.test(exp.script) && /echo host/.test(exp.script));
      const cyc = LIB.expandComponents(lib, LIB.componentOf(lib, "cyc1"), { os: "linux" });
      check("scripts: a component cycle is detected", cyc.error === "component_error" && /cycle/.test((cyc.errors || []).join(",")));
      const miss = LIB.expandComponents(lib, LIB.normalizeScript({ name: "m", variants: [{ os: "any", language: "bash", script: "{{component:nope}}" }] }), { os: "linux" });
      check("scripts: a missing component is reported", miss.error === "component_error" && /missing component/.test((miss.errors || []).join(",")));

      /* ── persistence ── */
      store.useBackend(srv);
      store.resetAllLocal();
      T.reload();
      const created = await T.create({ name: "Scripts " + uid });
      const pid = created.provider.id;
      const winDev = (await D.add(pid, { hostname: "SCR-WIN", status: "online", os: { name: "Windows 11", family: "Windows" } })).device.id;
      const linDev = (await D.add(pid, { hostname: "SCR-LNX", status: "online", os: { name: "Ubuntu 22.04", family: "Linux" } })).device.id;
      const added = await LIB.add(pid, script);
      check("scripts: add/list round-trips with a version snapshot", added.error === undefined && (await LIB.list(pid)).length === 1 && added.script.versions.length === 1);
      const sid = added.script.id;
      check("scripts: validateRun prepares a run for an OS", (await LIB.validateRun(pid, sid, { service: "Spooler" }, "windows")).language === "powershell" && (await LIB.validateRun(pid, sid, { service: "Spooler" }, "linux")).language === "bash");
      check("scripts: validateRun surfaces parameter errors", (await LIB.validateRun(pid, sid, {}, "windows")).error === "invalid_parameters");

      /* ── runOn groups by OS ── */
      J.enqueue = async (o) => { enqueues.push(o); return { ok: true, job: { id: "job-scr-" + enqueues.length } }; };
      const run = await LIB.runOn(pid, [winDev, linDev], sid, { service: "Spooler" }, {});
      check("scripts: runOn groups devices by OS family", run.ok === true && run.jobs.length === 2 && enqueues.length === 2 && enqueues.some((e) => e.language === "powershell") && enqueues.some((e) => e.language === "bash"));
      check("scripts: runOn attaches the right devices to each family", run.jobs.find((j) => j.family === "Windows").deviceIds.indexOf(String(winDev)) !== -1 && run.jobs.find((j) => j.family === "Linux").deviceIds.indexOf(String(linDev)) !== -1);

      /* ── versioning ── */
      const bumped = await LIB.bumpVersion(pid, sid, "tweaked");
      check("scripts: bumpVersion increments and snapshots", bumped.script.version === 2 && bumped.script.versions.length === 2 && bumped.script.versions[0].note === "tweaked");
      const diff = LIB.diffVersions(bumped.script, 1, 2);
      check("scripts: diffVersions summarises two versions", !!diff.summary && typeof diff.linesAdded === "number");
      const restored = await LIB.restore(pid, sid, 1);
      check("scripts: restore brings back an old version and bumps", restored.error === undefined);

      /* ── import / export ── */
      const exported = LIB.exportScript(added.script);
      check("scripts: exportScript tags the schema", exported.schema === LIB.SCHEMA && !!exported.script);
      const imported = await LIB.importScript(pid, JSON.stringify(exported));
      check("scripts: importScript de-duplicates the name", imported.error === undefined && imported.script.name !== added.script.name && (await LIB.list(pid)).length === 2);
      const bundle = await LIB.exportBundle(pid);
      check("scripts: exportBundle lists the library", bundle.schema === LIB.BUNDLE_SCHEMA && bundle.scripts.length === 2);
      const importedIds = await LIB.importBundle(pid, JSON.stringify(bundle));
      check("scripts: importBundle restores a bundle", importedIds.ok === true && importedIds.added.length === 2 && (await LIB.list(pid)).length === 4);

      /* ── CRUD + stats ── */
      const dup = await LIB.duplicate(pid, sid);
      check("scripts: duplicate makes a copy", dup.script.id !== sid && /copy/.test(dup.script.name));
      check("scripts: setEnabled toggles", (await LIB.setEnabled(pid, dup.script.id, false)).script.enabled === false);
      check("scripts: remove drops an entry", (await LIB.remove(pid, dup.script.id)).removed === dup.script.id);
      const st = await LIB.stats(pid);
      check("scripts: stats summarise the library", st.total >= 3 && st.parameters >= 4 && st.osVariants >= 2);

      /* ── UI ── */
      const probe = document.createElement("div");
      document.body.appendChild(probe);
      await LIB.renderInto(probe, { providers: await T.list({ force: true }), providerId: pid, toast() {} });
      check("scripts: the console renders the library table + New action", !!probe.querySelector(".rmm-library") && !!probe.querySelector('[data-act="lib-add"]') && probe.querySelectorAll("table tbody tr").length >= 3);
      probe.remove();

      check("scripts: every canonical file stays in the rmm namespace", Object.keys(srv.files).every((n) => n.indexOf("rmm-v1-") === 0));
    } catch (e) {
      check("scripts: harness did not crash", false, (e && e.stack) || String(e));
    } finally {
      try { J.enqueue = origEnqueue; } catch (e) {}
      try { store.useBackend(null); } catch (e) {}
      try { store.resetAllLocal(); } catch (e) {}
      try { T.reload(); } catch (e) {}
    }
    const passed = results.filter((r) => r.ok).length;
    const failed = results.length - passed;
    return { passed, failed, results };
  };

  /* ============================================================
     Task 22 — automation engine
     Run via page_eval:  await window.RMMAutomationsTest()
     Covers: the trigger/action catalogues, rule normalisation +
     validation, trigger/condition matching, target resolution
     (event-scoped vs provider-wide), dry-run planning, execution
     with job dispatch, approval gating for destructive actions,
     maintenance deferral, per-rule cooldown, event ingest, schedule
     triggers, run history + CRUD and the console UI.
     ============================================================ */
  window.RMMAutomationsTest = async function (opts) {
    opts = opts || {};
    results.length = 0;
    const ERP = window.ERP;
    const store = ERP.store;
    const T = ERP.tenancy;
    const D = ERP.devices;
    const M = ERP.masterConfig;
    const AUTO = ERP.automations;
    const SCH = ERP.schedules;
    const uid = Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);

    function makeServer() {
      const files = {};
      return {
        files,
        async get(name) { return Object.prototype.hasOwnProperty.call(files, name) ? files[name] : null; },
        async set(name, json) { const prev = files[name]; files[name] = json; return { created: prev === undefined, unchanged: prev === json, editKey: "k_" + name, superseded: false, error: null }; },
      };
    }

    if (!AUTO) { check("automations: ERP.automations exposed", false); return { passed: 0, failed: 1, results }; }
    const srv = makeServer();
    const DSP = ERP.dispatch;
    const origEnqueue = DSP ? DSP.enqueue : null;
    const dispatched = [];
    try {
      check("automations: ERP.automations exposed", ["TRIGGERS", "ACTIONS", "normalizeRule", "validateRule", "matches", "resolveTargets", "plan", "run", "dryRun", "ingest", "scheduleDue", "approve", "reject", "add", "update", "remove", "setEnabled", "duplicate", "runs", "pending", "stats", "render", "renderInto"].every((f) => typeof AUTO[f] === "function" || Array.isArray(AUTO[f])));
      check("automations: the trigger catalogue is complete", ["alert.fired", "alert.cleared", "monitor.state", "device.online", "device.offline", "schedule", "manual", "webhook"].every((t) => AUTO.TRIGGER_IDS.indexOf(t) !== -1));
      check("automations: the action catalogue is complete", ["run-script", "run-library-script", "restart-service", "deploy-patch", "deploy-software", "send-notification", "tag-device", "add-to-group", "webhook", "create-ticket"].every((a) => AUTO.ACTION_IDS.indexOf(a) !== -1));
      check("automations: destructive + phased actions are flagged", AUTO.isDestructive("reboot") === true && AUTO.isDestructive("restart-service") === true && AUTO.isDestructive("tag-device") === false && !!(AUTO.action("deploy-patch") || {}).phase);

      /* ── normalisation + validation ── */
      const bad = AUTO.validateRule({ name: "", trigger: { type: "nope" }, actions: [] });
      check("automations: validation requires a name, a trigger and an action", bad.valid === false && bad.errors.length >= 3);
      const norm = AUTO.normalizeRule({ name: "r", trigger: { type: "alert.fired" }, actions: [{ type: "tag-device", params: { tag: "x" } }] });
      check("automations: an unknown action is dropped and defaults applied", norm.actions.length === 1 && norm.actions[0].essential === false && norm.enabled === true && norm.conditions.match === "all");

      /* ── persistence + matching ── */
      store.useBackend(srv);
      store.resetAllLocal();
      T.reload();
      await M.seed({ force: true });
      const created = await T.create({ name: "Automation " + uid, deviceGroups: [{ id: "grp-srv", name: "Servers", kind: "static" }] });
      const pid = created.provider.id;
      const d1 = (await D.add(pid, { hostname: "AUTO-SRV1", role: "server", groupIds: ["grp-srv"], tags: ["prod", "server"], status: "online" })).device.id;
      const d2 = (await D.add(pid, { hostname: "AUTO-WS2", role: "workstation", tags: [], status: "online" })).device.id;
      const p = (await T.get(pid)).provider;
      const ctx1 = await AUTO.loadCtx(p, { deviceId: d1, severityId: "sev-critical" });
      const ruleAlert = AUTO.normalizeRule({ name: "Alert rule", trigger: { type: "alert.fired", filter: { severityAtLeast: "sev-critical" } }, actions: [{ type: "tag-device", params: { tag: "alerted" } }] });
      check("automations: trigger type + severity filter match", AUTO.matches(ruleAlert, { type: "alert.fired", deviceId: d1, severityId: "sev-critical" }, ctx1) === true && AUTO.matches(ruleAlert, { type: "alert.cleared", deviceId: d1, severityId: "sev-critical" }, ctx1) === false && AUTO.matches(ruleAlert, { type: "alert.fired", deviceId: d1, severityId: "sev-warning" }, ctx1) === false);
      const ruleTag = AUTO.normalizeRule({ name: "Tag rule", trigger: { type: "alert.fired", filter: { tag: "prod" } }, actions: [{ type: "tag-device", params: { tag: "x" } }] });
      const ctx2 = await AUTO.loadCtx(p, { deviceId: d2 });
      check("automations: a tag filter matches the event device's tags", AUTO.matches(ruleTag, { type: "alert.fired", deviceId: d1, severityId: "sev-info" }, ctx1) === true && AUTO.matches(ruleTag, { type: "alert.fired", deviceId: d2, severityId: "sev-info" }, ctx2) === false);
      const ruleCond = AUTO.normalizeRule({ name: "Cond rule", trigger: { type: "alert.fired" }, conditions: { match: "all", items: [{ field: "tag", op: "has_tag", value: "prod" }] }, actions: [{ type: "tag-device", params: { tag: "x" } }] });
      check("automations: conditions reuse the group engine", AUTO.matches(ruleCond, { type: "alert.fired", deviceId: d1 }, ctx1) === true && AUTO.matches(ruleCond, { type: "alert.fired", deviceId: d2 }, ctx2) === false);
      check("automations: monitor.state matches any monitor event", AUTO.matches(AUTO.normalizeRule({ name: "m", trigger: { type: "monitor.state" }, actions: [{ type: "tag-device", params: { tag: "x" } }] }), { type: "monitor.state", deviceId: d1 }, ctx1) === true);

      /* ── target resolution ── */
      const evTargets = AUTO.resolveTargets(p, ruleAlert, { deviceId: d1 }, ctx1);
      check("automations: an event-scoped rule targets only the event device", evTargets.length === 1 && String(evTargets[0].device.id) === String(d1));
      const manualRule = AUTO.normalizeRule({ name: "All", trigger: { type: "manual" }, actions: [{ type: "tag-device", params: { tag: "x" } }] });
      check("automations: a manual rule with no target can target the whole fleet", AUTO.resolveTargets(p, manualRule, {}, { provider: p }).length === 2);
      const tagRule = AUTO.normalizeRule({ name: "Prod", trigger: { type: "manual" }, target: { tags: ["prod"] }, actions: [{ type: "tag-device", params: { tag: "x" } }] });
      check("automations: a tag target resolves by tag", AUTO.resolveTargets(p, tagRule, {}, { provider: p, gctx: { provider: p, soft: {}, svc: {} } }).map((t) => String(t.device.id)).join(",") === String(d1));

      /* ── dry run + run ── */
      DSP.enqueue = async (o) => { dispatched.push(o); return { ok: true, job: { id: "job-auto-" + dispatched.length } }; };
      const ruleScript = (await AUTO.add(pid, { name: "Run report", trigger: { type: "alert.fired" }, actions: [{ type: "run-script", params: { language: "powershell", script: "Get-Date", timeoutSeconds: 30 } }] })).rule;
      const dry = await AUTO.dryRun(pid, ruleScript.id, { type: "alert.fired", deviceId: d1, severityId: "sev-critical", at: "2026-03-10T12:00:00Z" });
      check("automations: a dry run plans without dispatching", dry.dryRun === true && dry.targets.length === 1 && dry.targets[0].actions[0].status === "planned" && dry.targets[0].actions[0].params.script === "Get-Date" && dispatched.length === 0);
      const ran = await AUTO.run(pid, ruleScript.id, { event: { type: "alert.fired", deviceId: d1, severityId: "sev-critical", at: "2026-03-10T12:00:00Z" } });
      check("automations: a run dispatches the action and records history", ran.ok === true && ran.run.status === "succeeded" && ran.run.counts.queued === 1 && dispatched.length === 1 && (await AUTO.runs(pid, { ruleId: ruleScript.id })).length === 1);
      check("automations: the dispatched job carries automation provenance", dispatched[0].source === "automation" && !!dispatched[0].correlation && dispatched[0].correlation.ruleId === ruleScript.id);

      /* ── approval gating ── */
      const ruleBoot = (await AUTO.add(pid, { name: "Reboot on crash", trigger: { type: "alert.fired" }, requireApproval: true, actions: [{ type: "reboot", params: {} }] })).rule;
      const pendingRun = await AUTO.run(pid, ruleBoot.id, { event: { type: "alert.fired", deviceId: d1, severityId: "sev-critical", at: "2026-03-10T13:00:00Z" } });
      check("automations: a destructive action is gated behind approval", pendingRun.pending === true && pendingRun.run.status === "pending-approval" && dispatched.length === 1);
      const pending = await AUTO.pending(pid);
      check("automations: the pending run is listed", pending.length === 1 && pending[0].ruleId === ruleBoot.id);
      const approved = await AUTO.approve(pid, ruleBoot.id, pendingRun.run.id, "tester");
      check("automations: approving executes the run", approved.ok === true && approved.run.status === "succeeded" && dispatched.length === 2 && /Restart-Computer|shutdown -r now/.test(dispatched[1].script || ""));
      const ruleBoot2 = (await AUTO.add(pid, { name: "Reboot reject", trigger: { type: "alert.cleared" }, requireApproval: true, actions: [{ type: "reboot", params: {} }] })).rule;
      const pr2 = await AUTO.run(pid, ruleBoot2.id, { event: { type: "alert.cleared", deviceId: d1, at: "2026-03-10T14:00:00Z" } });
      const rej = await AUTO.reject(pid, ruleBoot2.id, pr2.run.id, "tester");
      check("automations: a pending run can be rejected", rej.ok === true && rej.run.status === "rejected");

      /* ── cooldown ── */
      const ruleCool = (await AUTO.add(pid, { name: "Cooldown", cooldownMinutes: 60, trigger: { type: "alert.fired" }, actions: [{ type: "tag-device", params: { tag: "cool" } }] })).rule;
      await AUTO.run(pid, ruleCool.id, { event: { type: "alert.fired", deviceId: d1, at: "2026-03-10T15:00:00Z" } });
      const cooled = await AUTO.run(pid, ruleCool.id, { event: { type: "alert.fired", deviceId: d1, at: "2026-03-10T15:10:00Z" } });
      check("automations: a rule respects its cooldown", cooled.skipped === true && cooled.reason === "cooldown");

      /* ── maintenance deferral ── */
      await M.add("maintenanceWindows", { label: "Blackout test", recurrence: "once", startDate: "2026-03-10", endDate: "2026-03-10", startTime: "00:00", endTime: "23:59", scope: "global", suppressAlerts: true, allowCritical: true, deferJobs: true });
      const ruleBlack = (await AUTO.add(pid, { name: "Blackout rule", trigger: { type: "alert.fired" }, actions: [{ type: "tag-device", params: { tag: "blackout" } }] })).rule;
      const planB = await AUTO.dryRun(pid, ruleBlack.id, { type: "alert.fired", deviceId: d1, at: "2026-03-10T12:00:00Z" });
      check("automations: a non-essential action is deferred during maintenance", planB.targets[0].suppressed === true && planB.targets[0].actions[0].status === "deferred");
      const runB = await AUTO.run(pid, ruleBlack.id, { event: { type: "alert.fired", deviceId: d1, at: "2026-03-10T12:00:00Z" } });
      check("automations: the deferred action is not executed", runB.run.counts.deferred === 1 && runB.run.counts.done === 0);
      check("automations: a suppression reason is recorded for the audit trail", (await SCH.suppressions(pid, {})).length >= 1);
      const ruleEssential = (await AUTO.add(pid, { name: "Essential rule", allowDuringMaintenance: true, trigger: { type: "alert.fired" }, actions: [{ type: "tag-device", params: { tag: "ess" }, essential: true }] })).rule;
      const runE = await AUTO.run(pid, ruleEssential.id, { event: { type: "alert.fired", deviceId: d1, at: "2026-03-10T12:30:00Z" } });
      check("automations: allowDuringMaintenance runs anyway", runE.run.counts.done === 1 && runE.run.targets[0].suppressed === false);

      /* ── ingest ── */
      const ingest = await AUTO.ingest(pid, { type: "alert.fired", deviceId: d1, severityId: "sev-critical", at: "2026-04-01T10:00:00Z" });
      check("automations: ingest routes an event through matching rules", ingest.triggered.length >= 1 && ingest.runs.length >= 1);

      /* ── schedule trigger ── */
      const ruleSched = (await AUTO.add(pid, { name: "Scheduled", allowDuringMaintenance: true, trigger: { type: "schedule", filter: { scheduleId: "sched-bh" } }, actions: [{ type: "tag-device", params: { tag: "sched" }, essential: true }] })).rule;
      const schedDue = await AUTO.scheduleDue(pid, "2026-04-06T09:02:00Z");
      check("automations: a due schedule runs its rule", (schedDue.due || []).indexOf(ruleSched.id) !== -1 && schedDue.runs.length >= 1);
      const schedNot = await AUTO.scheduleDue(pid, "2026-04-06T11:30:00Z");
      check("automations: an undue schedule does not fire", (schedNot.due || []).length === 0);

      /* ── CRUD + stats ── */
      const upd = await AUTO.update(pid, ruleCool.id, { name: "Cooldown renamed", cooldownMinutes: 0 });
      check("automations: update round-trips", upd.error === undefined && upd.rule.name === "Cooldown renamed");
      check("automations: a rule with no actions is rejected", (await AUTO.update(pid, ruleCool.id, { actions: [] })).error === "invalid");
      const dup = await AUTO.duplicate(pid, ruleCool.id);
      check("automations: duplicate makes a copy without history", dup.rule.id !== ruleCool.id && dup.rule.runs.length === 0);
      check("automations: setEnabled toggles", (await AUTO.setEnabled(pid, dup.rule.id, false)).rule.enabled === false);
      check("automations: remove drops the rule", (await AUTO.remove(pid, dup.rule.id)).removed === dup.rule.id);
      const st = AUTO.statsOf((await T.get(pid)).provider);
      check("automations: stats summarise the rule set", st.total >= 5 && st.byTrigger["alert.fired"] >= 1 && st.byAction["tag-device"] >= 1 && st.runs >= 5);

      /* ── UI ── */
      const probe = document.createElement("div");
      document.body.appendChild(probe);
      await AUTO.renderInto(probe, { providers: await T.list({ force: true }), providerId: pid, toast() {} });
      check("automations: the console renders the rules table + New action", !!probe.querySelector(".rmm-automations") && !!probe.querySelector('[data-act="auto-add"]') && probe.querySelectorAll("table tbody tr").length >= 5);
      const runsTab = probe.querySelector('[data-tab="runs"]');
      if (runsTab) runsTab.click();
      await new Promise((r) => setTimeout(r, 250));
      check("automations: the run history tab renders", probe.querySelectorAll('[data-panel="runs"] table tbody tr').length >= 1 || /No automation runs/.test(probe.textContent));
      probe.remove();

      check("automations: every canonical file stays in the rmm namespace", Object.keys(srv.files).every((n) => n.indexOf("rmm-v1-") === 0));
    } catch (e) {
      check("automations: harness did not crash", false, (e && e.stack) || String(e));
    } finally {
      try { DSP.enqueue = origEnqueue; } catch (e) {}
      try { store.useBackend(null); } catch (e) {}
      try { store.resetAllLocal(); } catch (e) {}
      try { T.reload(); } catch (e) {}
      try { await M.seed(); } catch (e) {}
    }
    const passed = results.filter((r) => r.ok).length;
    const failed = results.length - passed;
    return { passed, failed, results };
  };

  /* ============================================================
     Phase 5 · Task 24 validation tests — alert lifecycle
     Run via page_eval:  await window.RMMAlertsTest()
     Covers: alert records + timeline, lifecycle transitions, de-
     duplication, flapping suppression, severity mapping, snooze,
     maintenance suppression, root device/site/group context, the
     assessment-state memory that powers "for N minutes", scan-driven
     fire/auto-clear, reads, retention and the console UI.
     ============================================================ */
  window.RMMAlertsTest = async function (opts) {
    opts = opts || {};
    results.length = 0;
    const ERP = window.ERP;
    const store = ERP.store;
    const T = ERP.tenancy;
    const D = ERP.devices;
    const M = ERP.masterConfig;
    const SCH = ERP.schedules;
    const RT = ERP.routing;
    const PSA = ERP.psa;
    const AUTO = ERP.automations;
    const AL = ERP.alerts;
    const uid = Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);

    function makeServer() {
      const files = {};
      return {
        files,
        async get(name) { return Object.prototype.hasOwnProperty.call(files, name) ? files[name] : null; },
        async set(name, json) { const prev = files[name]; files[name] = json; return { created: prev === undefined, unchanged: prev === json, editKey: "k_" + name, superseded: false, error: null }; },
      };
    }
    if (!AL) { check("alerts: ERP.alerts exposed", false); return { passed: 0, failed: 1, results }; }
    const srv = makeServer();
    const origRoute = RT.routeAlert, origPsa = PSA.onAlert, origIngest = AUTO.ingest;
    const hooks = [];
    let pid = null;
    try {
      check("alerts: the lifecycle API is exposed", ["fire", "acknowledge", "resolve", "autoClear", "snooze", "unsnooze", "isSnoozed", "scan", "ingestAssessment", "list", "get", "active", "counts", "stats", "prune", "render", "renderInto"].every((f) => typeof AL[f] === "function"));
      check("alerts: states are firing/acknowledged/resolved", AL.STATES.join(",") === "firing,acknowledged,resolved" && AL.ACTIVE.join(",") === "firing,acknowledged");

      /* ── identity + severity mapping ── */
      check("alerts: a service monitor's subject is its service name", AL.subjectOf({ type: "service", settings: { name: "Spooler" } }) === "Spooler");
      check("alerts: a port monitor's subject is host:port", AL.subjectOf({ type: "port", settings: { host: "10.0.0.5", port: 443 } }) === "10.0.0.5:443");
      check("alerts: the dedupe key includes monitor, device and subject", AL.dedupeKey({ id: "mon-1", type: "service", settings: { name: "DNS" } }, "dev-9") === "mon-1|dev-9|DNS");
      const sevList = await M.section("severities");
      check("alerts: a critical state is mapped up to sev-critical", AL.severityForState("sev-warning", "critical", sevList) === "sev-critical");
      check("alerts: a monitor already at emergency keeps its higher severity", AL.severityForState("sev-emergency", "critical", sevList) === "sev-emergency");
      check("alerts: a non-critical state keeps the monitor severity", AL.severityForState("sev-warning", "warning", sevList) === "sev-warning");

      /* ── persistence + fire ── */
      store.useBackend(srv);
      store.resetAllLocal();
      T.reload();
      await M.seed({ force: true });
      RT.routeAlert = async () => { hooks.push(["route"]); return { skipped: true }; };
      PSA.onAlert = async (p, a, e) => { hooks.push(["psa", e]); return { skipped: true }; };
      AUTO.ingest = async (p, ev) => { hooks.push(["auto", ev.type]); return { triggered: [] }; };

      const created = await T.create({ name: "Alerts " + uid, sites: [{ id: "site-t", name: "Head Office" }], deviceGroups: [{ id: "grp-a", name: "Servers", kind: "static" }] });
      pid = created.provider.id;
      const dev = (await D.add(pid, { hostname: "AL-SRV1", siteId: "site-t", groupIds: ["grp-a"], role: "server", status: "online" })).device;
      const prov = (await T.get(pid)).provider;

      const f1 = await AL.fire(pid, { monitorId: "mon-disk", monitorName: "System disk free", monitorType: "disk", settings: { volume: "C:" }, deviceId: dev.id, severityId: "sev-warning", severityRank: 20, state: "warning", value: 8, message: "At 8%.", at: "2026-03-10T10:00:00Z" }, { provider: prov, device: dev });
      check("alerts: fire creates a firing alert", f1.created === true && f1.alert.state === "firing" && f1.alert.occurrences === 1);
      check("alerts: the alert snapshots device/site/group context", f1.alert.hostname === "AL-SRV1" && f1.alert.siteName === "Head Office" && f1.alert.groupNames.indexOf("Servers") !== -1);
      check("alerts: the alert records its monitor link", f1.alert.monitorId === "mon-disk" && f1.alert.monitorName === "System disk free" && f1.alert.subject === "C:");
      check("alerts: the alert has a fired timeline entry", f1.alert.history.length === 1 && f1.alert.history[0].action === "fired");
      check("alerts: a new alert runs the routing/psa/automation hooks", hooks.some((h) => h[0] === "route") && hooks.some((h) => h[0] === "psa" && h[1] === "fired") && hooks.some((h) => h[0] === "auto" && h[1] === "alert.fired"));

      /* ── de-duplication ── */
      const f2 = await AL.fire(pid, { monitorId: "mon-disk", monitorName: "System disk free", monitorType: "disk", settings: { volume: "C:" }, deviceId: dev.id, severityId: "sev-warning", severityRank: 20, state: "warning", value: 6, message: "At 6%.", at: "2026-03-10T10:05:00Z" }, { provider: prov, device: dev });
      check("alerts: a repeat breach de-duplicates onto the same alert", f2.deduped === true && f2.alert.id === f1.alert.id && f2.alert.occurrences === 2 && f2.alert.value === 6);
      check("alerts: de-duplication keeps exactly one active alert", (await AL.list(pid, { active: true })).length === 1);
      const up = await AL.fire(pid, { monitorId: "mon-disk", monitorName: "System disk free", monitorType: "disk", settings: { volume: "C:" }, deviceId: dev.id, severityId: "sev-critical", severityRank: 30, state: "critical", value: 3, message: "At 3%.", at: "2026-03-10T10:10:00Z" }, { provider: prov, device: dev });
      check("alerts: a severity rise on a live alert is flagged as an escalation", up.escalated === true && (await AL.get(pid, f1.alert.id)).alert.history.some((h) => h.action === "escalated"));

      /* ── acknowledge / resolve ── */
      const ack = await AL.acknowledge(pid, f1.alert.id, "tester");
      check("alerts: acknowledge moves firing → acknowledged", ack.alert.state === "acknowledged" && ack.alert.acknowledgedBy === "tester");
      const ack2 = await AL.acknowledge(pid, f1.alert.id, "tester");
      check("alerts: acknowledge is idempotent", ack2.alert.history.filter((h) => h.action === "acknowledged").length === 1);
      const res = await AL.resolve(pid, f1.alert.id, { actor: "tester", at: "2026-03-10T11:00:00Z" });
      check("alerts: resolve moves to resolved", res.alert.state === "resolved" && res.alert.resolvedBy === "tester" && res.alert.autoResolved === false);
      const res2 = await AL.resolve(pid, f1.alert.id, {});
      check("alerts: resolve is idempotent", res2.alert.resolvedAt === "2026-03-10T11:00:00Z");

      /* ── flapping suppression ── */
      const flapKey = "mon-flap|" + dev.id;
      const mk = (at) => AL.fire(pid, { monitorId: "mon-flap", monitorName: "Flapper", monitorType: "updown", deviceId: dev.id, severityId: "sev-critical", severityRank: 30, state: "critical", message: "down", dedupeKey: flapKey, at }, { provider: prov, device: dev });
      let fl = await mk("2026-03-10T12:00:00Z");
      await AL.autoClear(pid, fl.alert.id, { at: "2026-03-10T12:01:00Z" });
      fl = await mk("2026-03-10T12:02:00Z");
      check("alerts: a re-fire inside the flap window reopens the same alert", fl.reopened === true && fl.alert.id === f1.alert.id === false && fl.alert.flaps === 1 && fl.alert.flapping === false);
      await AL.autoClear(pid, fl.alert.id, { at: "2026-03-10T12:03:00Z" });
      fl = await mk("2026-03-10T12:04:00Z");
      await AL.autoClear(pid, fl.alert.id, { at: "2026-03-10T12:05:00Z" });
      fl = await mk("2026-03-10T12:06:00Z");
      check("alerts: past the flap threshold the alert is flagged flapping", fl.alert.flaps === 3 && fl.alert.flapping === true);
      check("alerts: the flapping alert reuses one record", (await AL.list(pid, { monitorId: "mon-flap" })).length === 1);

      /* ── snooze ── */
      const sn = await AL.snooze(pid, fl.alert.id, 60, "tester");
      check("alerts: snooze sets a snooze-until", AL.isSnoozed(sn.alert) === true && sn.alert.snoozedBy === "tester");
      check("alerts: isSnoozed respects the supplied instant", AL.isSnoozed(sn.alert, "2035-01-01T00:00:00Z") === false);
      const uns = await AL.unsnooze(pid, fl.alert.id, "tester");
      check("alerts: unsnooze clears it", AL.isSnoozed(uns.alert) === false);

      /* ── maintenance suppression ── */
      await M.add("maintenanceWindows", { label: "Alerts blackout", recurrence: "once", startDate: "2026-03-11", endDate: "2026-03-11", startTime: "00:00", endTime: "23:59", scope: "global", suppressAlerts: true, allowCritical: true, deferJobs: true });
      const sup = await AL.fire(pid, { monitorId: "mon-sup", monitorName: "Suppressed", monitorType: "cpu", deviceId: dev.id, severityId: "sev-warning", severityRank: 20, state: "warning", message: "busy", dedupeKey: "mon-sup|" + dev.id, at: "2026-03-11T12:00:00Z" }, { provider: prov, device: dev });
      check("alerts: a warning alert inside a maintenance window is suppressed", sup.alert.suppressed === true && asArrTest(sup.alert.suppressionWindowIds).length >= 1);
      check("alerts: the suppression is written to the audit log", (await SCH.suppressions(pid, {})).length >= 1);
      const supCrit = await AL.fire(pid, { monitorId: "mon-sup2", monitorName: "Critical", monitorType: "updown", deviceId: dev.id, severityId: "sev-critical", severityRank: 30, state: "critical", message: "down", dedupeKey: "mon-sup2|" + dev.id, at: "2026-03-11T12:30:00Z" }, { provider: prov, device: dev });
      check("alerts: a critical alert is not suppressed by an allowCritical window", supCrit.alert.suppressed === false);

      /* ── assessment state + scan ── */
      await (window.ERP.monitors).add(pid, { name: "Agent offline", type: "agent", severity: "sev-critical", forMinutes: 0, enabled: true, settings: { staleAfterMinutes: 5, offlineAfterMinutes: 15 }, targets: {} });
      const dead = (await D.add(pid, { hostname: "AL-DEAD", role: "server", status: "online", lastSeenAt: "2020-01-01T00:00:00Z" })).device;
      const scan1 = await AL.scan(pid, { at: "2026-03-12T12:00:00Z", prune: false });
      check("alerts: scan evaluates every applicable monitor", scan1.ok === true && scan1.evaluated >= 1);
      const fired = (await AL.list(pid, { deviceId: dead.id, active: true }));
      check("alerts: scan fires an alert for a breached monitor", fired.length === 1 && fired[0].monitorName === "Agent offline" && fired[0].state === "firing");
      const stateRows = await AL.loadState();
      check("alerts: scan records per-monitor assessment state", stateRows.some((r) => r.kind === "assessment" && String(r.deviceId) === String(dead.id)));
      await D.update(pid, dead.id, { lastSeenAt: new Date().toISOString() });
      const scan2 = await AL.scan(pid, { at: new Date().toISOString() });
      const cleared = await AL.list(pid, { deviceId: dead.id, state: "resolved" });
      check("alerts: scan auto-clears the alert on recovery", scan2.cleared >= 1 && cleared.length >= 1 && cleared[0].autoResolved === true);

      /* ── ingestAssessment in isolation ── */
      const isoDev = (await D.add(pid, { hostname: "AL-ISO", role: "workstation", status: "online" })).device;
      const mon = { id: "mon-iso", name: "CPU", type: "cpu", severity: "sev-warning", settings: {}, thresholds: {} };
      const i1 = await AL.ingestAssessment(pid, mon, isoDev, { state: "warning", fired: true, value: 95, message: "95%", since: "2026-03-10T00:00:00Z", at: "2026-03-10T00:05:00Z" }, { at: "2026-03-10T00:05:00Z" });
      check("alerts: ingestAssessment fires from a fired assessment", i1.fire && i1.fire.created === true);
      const i2 = await AL.ingestAssessment(pid, mon, isoDev, { state: "ok", fired: false, cleared: true, at: "2026-03-10T00:20:00Z" }, { at: "2026-03-10T00:20:00Z" });
      check("alerts: ingestAssessment auto-clears on recovery", i2.cleared && i2.cleared.ok === true && i2.cleared.alert.state === "resolved");

      /* ── reads ── */
      const counts = AL.counts((await T.get(pid)).provider);
      check("alerts: counts summarise state + severity", counts.total >= 4 && counts.byState.firing >= 1 && counts.resolved >= 2 && typeof counts.critical === "number");
      check("alerts: list filters by state", (await AL.list(pid, { state: "resolved" })).every((a) => a.state === "resolved"));
      check("alerts: list filters by device", (await AL.list(pid, { deviceId: dead.id })).every((a) => String(a.deviceId) === String(dead.id)));
      check("alerts: history is returned newest-first", (await AL.history(pid, f1.alert.id)).history.length >= 3);
      const parsed = AL.parse ? null : null;
      check("alerts: stats expose the document in the rmm namespace", (await AL.stats(pid)).docName === "rmm-v1-alertstate");

      /* ── retention ── */
      const pr = await AL.prune(pid);
      check("alerts: prune runs and keeps the active alerts", pr.ok === true && (await AL.list(pid, { active: true })).length >= 1);

      /* ── UI ── */
      const probe = document.createElement("div");
      document.body.appendChild(probe);
      await AL.renderInto(probe, { providers: await T.list({ force: true }), providerId: pid, toast() {} });
      check("alerts: the console renders the alert table + Scan action", !!probe.querySelector(".rmm-alerts") && !!probe.querySelector('[data-act="al-scan"]') && probe.querySelectorAll("table tbody tr").length >= 1);
      const routingTab = probe.querySelector('[data-tab="routing"]');
      if (routingTab) routingTab.click();
      await new Promise((r) => setTimeout(r, 200));
      check("alerts: the routing tab renders the routing panel", !!probe.querySelector(".rmm-routing-inner") || !!probe.querySelector('[data-panel="routing"]'));
      probe.remove();

      check("alerts: every canonical file stays in the rmm namespace", Object.keys(srv.files).every((n) => n.indexOf("rmm-v1-") === 0));
      check("alerts: no token/secret leaked into an alert record", (await AL.list(pid, {})).every((a) => !/token|secret|password/i.test(JSON.stringify(a.meta))));
    } catch (e) {
      check("alerts: harness did not crash", false, (e && e.stack) || String(e));
    } finally {
      try { RT.routeAlert = origRoute; } catch (e) {}
      try { PSA.onAlert = origPsa; } catch (e) {}
      try { AUTO.ingest = origIngest; } catch (e) {}
      try { store.useBackend(null); } catch (e) {}
      try { store.resetAllLocal(); } catch (e) {}
      try { T.reload(); } catch (e) {}
      try { await M.seed(); } catch (e) {}
    }
    const passed = results.filter((r) => r.ok).length;
    const failed = results.length - passed;
    return { passed, failed, results };
  };

  function asArrTest(v) { return Array.isArray(v) ? v : []; }

  /* ============================================================
     Phase 5 · Task 25 validation tests — routing & escalation
     Run via page_eval:  await window.RMMRoutingTest()
     Covers: route/recipient/escalation/on-call CRUD + validation,
     severity/site/group matching, quiet hours, digests, on-call
     rotation, strict de-duplication, flapping hold, escalation
     levels + repeats, the severity fallback, the notification log
     and the console UI.
     ============================================================ */
  window.RMMRoutingTest = async function (opts) {
    opts = opts || {};
    results.length = 0;
    const ERP = window.ERP;
    const store = ERP.store;
    const T = ERP.tenancy;
    const D = ERP.devices;
    const M = ERP.masterConfig;
    const RT = ERP.routing;
    const PSA = ERP.psa;
    const AUTO = ERP.automations;
    const AL = ERP.alerts;
    const NOT = ERP.notify;
    const uid = Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);

    function makeServer() {
      const files = {};
      return {
        files,
        async get(name) { return Object.prototype.hasOwnProperty.call(files, name) ? files[name] : null; },
        async set(name, json) { const prev = files[name]; files[name] = json; return { created: prev === undefined, unchanged: prev === json, editKey: "k_" + name, superseded: false, error: null }; },
      };
    }
    if (!RT) { check("routing: ERP.routing exposed", false); return { passed: 0, failed: 1, results }; }
    const srv = makeServer();
    const origPsa = PSA.onAlert, origIngest = AUTO.ingest;
    let pid = null, dev = null;
    try {
      check("routing: the API is exposed", ["add", "update", "remove", "list", "get", "normalize", "validate", "resolveRoute", "routeAlert", "shouldSend", "escalate", "flushDigests", "queueDigest", "onCall", "inQuietHours", "stats", "renderPanel"].every((f) => typeof RT[f] === "function"));

      /* ── time helpers (pure, no I/O) ── */
      const qr = RT.normalize("recipient", { quietHours: { enabled: true, start: "22:00", end: "07:00" } });
      check("routing: quiet hours cover the overnight window", RT.inQuietHours(qr, "2026-03-10T23:30:00Z") === true && RT.inQuietHours(qr, "2026-03-11T06:00:00Z") === true);
      check("routing: quiet hours exclude daytime", RT.inQuietHours(qr, "2026-03-10T12:00:00Z") === false);
      const qrDay = RT.normalize("recipient", { quietHours: { enabled: true, start: "09:00", end: "17:00" } });
      check("routing: a same-day quiet window works", RT.inQuietHours(qrDay, "2026-03-10T12:00:00Z") === true && RT.inQuietHours(qrDay, "2026-03-10T18:00:00Z") === false);

      store.useBackend(srv);
      store.resetAllLocal();
      T.reload();
      await M.seed({ force: true });
      PSA.onAlert = async () => ({ skipped: true });
      AUTO.ingest = async () => ({ triggered: [] });

      const created = await T.create({ name: "Routing " + uid, sites: [{ id: "site-r", name: "Branch" }] });
      pid = created.provider.id;
      dev = (await D.add(pid, { hostname: "RT-SRV1", siteId: "site-r", tags: ["prod"], role: "server", status: "online" })).device;
      const prov = (await T.get(pid)).provider;

      /* ── CRUD + validation ── */
      check("routing: a route with no channel or recipient is rejected", (await RT.add("route", { label: "empty" })).error === "invalid");
      const rcp = (await RT.add("recipient", { providerId: pid, name: "NOC", email: "noc@example.com", channels: ["ch-console"], digest: "immediate" })).record;
      const quiet = (await RT.add("recipient", { providerId: pid, name: "Night owl", channels: ["ch-console"], digest: "immediate", quietHours: { enabled: true, start: "22:00", end: "07:00" } })).record;
      const digestR = (await RT.add("recipient", { providerId: pid, name: "Weekly digest", channels: ["ch-console"], digest: "hourly" })).record;
      const route = (await RT.add("route", { providerId: pid, label: "Console + NOC", priority: 5, channelIds: ["ch-console"], recipients: [rcp.id] })).record;
      const siteRoute = (await RT.add("route", { providerId: pid, label: "Branch only", priority: 5, siteIds: ["site-r"], channelIds: ["ch-console"] })).record;
      check("routing: recipients and routes round-trip", rcp.name === "NOC" && route.channelIds[0] === "ch-console" && siteRoute.siteIds[0] === "site-r");
      check("routing: list is filtered by kind + provider", (await RT.list("route", pid)).length === 2 && (await RT.list("recipient", pid)).length === 3);
      const upd = await RT.update("recipient", rcp.id, { name: "NOC team" });
      check("routing: update round-trips", upd.record.name === "NOC team");
      check("routing: an unknown kind is rejected", (await RT.add("nope", {})).error === "unknown_kind");
      check("routing: a rotation needs a member", (await RT.add("oncall", { providerId: pid, label: "Empty" })).error === "invalid");

      /* ── matching ── */
      const alert = { id: "alrt-x", providerId: pid, dedupeKey: "k1", deviceId: dev.id, hostname: "RT-SRV1", siteId: "site-r", groupIds: [], monitorId: "mon-1", severityId: "sev-warning", severityLabel: "Warning", subject: "CPU", state: "firing" };
      const resolved = await RT.resolveRoute(prov, alert, dev);
      check("routing: a site route is preferred over a broad route at equal priority", resolved && resolved.id === siteRoute.id);
      await RT.update("route", siteRoute.id, { priority: 1 });
      const resolved2 = await RT.resolveRoute(prov, alert, dev);
      check("routing: higher priority wins", resolved2 && resolved2.id === route.id);
      await RT.update("route", siteRoute.id, { priority: 5, severityAtLeast: "sev-critical" });
      const resolved3 = await RT.resolveRoute(prov, alert, dev);
      check("routing: a severity gate excludes a route", resolved3 && resolved3.id === route.id);
      const critical = Object.assign({}, alert, { severityId: "sev-critical" });
      const resolved4 = await RT.resolveRoute(prov, critical, dev);
      check("routing: the specific route matches once severity qualifies", resolved4 && resolved4.id === siteRoute.id);

      /* ── routing an alert ── */
      const fired = await AL.fire(pid, { monitorId: "mon-1", monitorName: "CPU", monitorType: "cpu", deviceId: dev.id, severityId: "sev-warning", severityRank: 20, state: "warning", message: "high", dedupeKey: "k1", at: "2026-01-05T12:00:00Z" }, { provider: prov, device: dev, silent: true });
      const alertObj = (await AL.get(pid, fired.alert.id)).alert;
      const routed = await RT.routeAlert(pid, alertObj, { at: "2026-01-05T12:00:00Z" });
      const sentOne = routed.sent && routed.sent.length >= 1;
      check("routing: routing an alert sends to the matched channels", sentOne && routed.sent[0].status === "sent");
      check("routing: the notification carries the alert id for de-duplication", (await NOT.list(pid, { limit: 5 })).some((n) => n.meta && n.meta.alertId === alertObj.id));
      const routedAgain = await RT.routeAlert(pid, alertObj, { at: "2026-01-05T12:05:00Z" });
      check("routing: a duplicate inside the dedupe window is suppressed", routedAgain.sent.length === 0 && routedAgain.suppressed.some((s) => s.reason === "dedupe"));
      const routedForce = await RT.routeAlert(pid, alertObj, { at: "2026-01-05T12:06:00Z", force: true });
      check("routing: force bypasses de-duplication", routedForce.sent.length >= 1);
      const flapping = Object.assign({}, alertObj, { id: "alrt-flap", flapping: true, dedupeKey: "k2" });
      const routedFlap = await RT.routeAlert(pid, flapping, { at: "2026-01-05T12:10:00Z" });
      check("routing: a flapping alert is never paged", routedFlap.skipped === true && routedFlap.reason === "flapping");
      const suppressedAlert = Object.assign({}, alertObj, { id: "alrt-sup", suppressed: true });
      check("routing: a maintenance-suppressed alert is not routed", (await RT.routeAlert(pid, suppressedAlert, { at: "2026-01-05T12:00:00Z" })).skipped === true);

      /* ── quiet hours + digests ── */
      await RT.update("route", route.id, { recipients: [quiet.id] });
      const quietAlert = Object.assign({}, alertObj, { id: "alrt-quiet", dedupeKey: "kq" });
      const routedQuiet = await RT.routeAlert(pid, quietAlert, { at: "2026-01-05T23:30:00Z" });
      check("routing: a recipient in quiet hours is queued, not paged", routedQuiet.sent.length === 0 && routedQuiet.queued.length >= 1);
      check("routing: the digest is pending", (await RT.pendingDigests(pid)).length >= 1);
      const flushed = await RT.flushDigests(pid, "2026-01-06T07:30:00Z");
      check("routing: flushing delivers the digest and clears the queue", flushed.sent.length >= 1 && (await RT.pendingDigests(pid)).length === 0);
      await RT.update("route", route.id, { recipients: [digestR.id] });
      const dAlert = Object.assign({}, alertObj, { id: "alrt-dgt", dedupeKey: "kd" });
      const routedDgt = await RT.routeAlert(pid, dAlert, { at: "2026-01-05T13:00:00Z" });
      check("routing: a non-immediate recipient is digested immediately", routedDgt.queued.length >= 1);

      /* ── escalation ── */
      await RT.update("route", route.id, { recipients: [rcp.id], channelIds: ["ch-console"] });
      await RT.add("escalation", { providerId: pid, label: "Critical", severityAtLeast: "sev-critical", repeatMinutes: 30, maxRepeats: 1, steps: [
        { afterMinutes: 0, label: "L1", channelIds: ["ch-console"] },
        { afterMinutes: 15, label: "L2", channelIds: ["ch-console"] },
      ] });
      const eAlert = await AL.fire(pid, { monitorId: "mon-esc", monitorName: "Outage", monitorType: "updown", deviceId: dev.id, severityId: "sev-critical", severityRank: 30, state: "critical", message: "down", dedupeKey: "ke", at: "2026-01-05T09:00:00Z" }, { provider: prov, device: dev, silent: true });
      const e1 = await RT.escalate(pid, "2026-01-05T09:00:30Z");
      const e1rec = e1.triggered.find((x) => String(x.alertId) === String(eAlert.alert.id));
      check("routing: escalation sends level 1 immediately", !!e1rec && e1rec.level === 1);
      const e1again = await RT.escalate(pid, "2026-01-05T09:02:00Z");
      check("routing: escalation does not repeat before repeatMinutes", !e1again.triggered.some((x) => String(x.alertId) === String(eAlert.alert.id)));
      const e2 = await RT.escalate(pid, "2026-01-05T09:16:00Z");
      const e2rec = e2.triggered.find((x) => String(x.alertId) === String(eAlert.alert.id));
      check("routing: a higher level fires as the alert ages", !!e2rec && e2rec.level === 2);
      const e3 = await RT.escalate(pid, "2026-01-05T09:47:00Z");
      const e3rec = e3.triggered.find((x) => String(x.alertId) === String(eAlert.alert.id));
      check("routing: the top level repeats after repeatMinutes", !!e3rec && e3rec.repeat === true && e3rec.level === 2);
      const escAlert = (await AL.get(pid, eAlert.alert.id)).alert;
      check("routing: escalations are recorded on the alert", asArrTest(escAlert.escalations).length >= 3 && escAlert.escalationLevel === 2);

      /* ── severity fallback (no policy) ── */
      const wAlert = await AL.fire(pid, { monitorId: "mon-w", monitorName: "Warn", monitorType: "cpu", deviceId: dev.id, severityId: "sev-warning", severityRank: 20, state: "warning", message: "hot", dedupeKey: "kw", at: "2026-01-05T09:00:00Z" }, { provider: prov, device: dev, silent: true });
      const fb0 = await RT.escalate(pid, "2026-01-05T09:30:00Z");
      check("routing: no fallback escalation before the severity delay", !fb0.triggered.some((x) => String(x.alertId) === String(wAlert.alert.id)));
      const fb1 = await RT.escalate(pid, "2026-01-05T10:05:00Z");
      const fbrec = fb1.triggered.find((x) => String(x.alertId) === String(wAlert.alert.id));
      check("routing: the severity escalateAfterMinutes is the fallback", !!fbrec && fbrec.fallback === true && fbrec.level === 1);

      /* ── on-call rotation ── */
      await RT.add("oncall", { providerId: pid, label: "Primary", rotationMinutes: 1440, startsAt: "2026-01-05T00:00:00Z", members: [{ name: "Alex" }, { name: "Priya" }] });
      const c1 = await RT.onCall(pid, "2026-01-05T12:00:00Z");
      const c2 = await RT.onCall(pid, "2026-01-06T12:00:00Z");
      const c3 = await RT.onCall(pid, "2026-01-07T12:00:00Z");
      check("routing: the on-call rota rotates by slot", c1.name === "Alex" && c2.name === "Priya" && c3.name === "Alex");

      /* ── stats + UI ── */
      const st = await RT.stats(pid);
      check("routing: stats summarise the policy", st.routes >= 2 && st.recipients >= 3 && st.escalations >= 1 && st.oncall >= 1);
      const probe = document.createElement("div");
      document.body.appendChild(probe);
      await RT.renderPanel(probe, { provider: (await T.get(pid)).provider, providerId: pid, toast() {} });
      check("routing: the panel renders with sub-tabs", !!probe.querySelector(".rmm-routing-inner") && probe.querySelectorAll(".erp-tabs [data-tab]").length >= 4 && probe.querySelectorAll('[data-panel="routes"] table tbody tr').length >= 1);
      probe.remove();

      check("routing: every canonical file stays in the rmm namespace", Object.keys(srv.files).every((n) => n.indexOf("rmm-v1-") === 0));
    } catch (e) {
      check("routing: harness did not crash", false, (e && e.stack) || String(e));
    } finally {
      try { PSA.onAlert = origPsa; } catch (e) {}
      try { AUTO.ingest = origIngest; } catch (e) {}
      try { store.useBackend(null); } catch (e) {}
      try { store.resetAllLocal(); } catch (e) {}
      try { T.reload(); } catch (e) {}
      try { await M.seed(); } catch (e) {}
    }
    const passed = results.filter((r) => r.ok).length;
    const failed = results.length - passed;
    return { passed, failed, results };
  };

  /* ============================================================
     Phase 5 · Task 26 validation tests — psa-u ticket integration
     Run via page_eval:  await window.RMMPsaTest()
     Covers: connection settings (with an in-memory only token),
     ticket creation from an alert with the device configuration
     record link, de-duplication so a recurring alert updates the
     open ticket, status/priority updates reflected onto the alert,
     the inbound webhook, automation-driven ticket creation, the
     alert lifecycle hook and the console UI.
     ============================================================ */
  window.RMMPsaTest = async function (opts) {
    opts = opts || {};
    results.length = 0;
    const ERP = window.ERP;
    const store = ERP.store;
    const T = ERP.tenancy;
    const D = ERP.devices;
    const M = ERP.masterConfig;
    const RT = ERP.routing;
    const AUTO = ERP.automations;
    const AL = ERP.alerts;
    const PSA = ERP.psa;
    const uid = Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);

    function makeServer() {
      const files = {};
      return {
        files,
        async get(name) { return Object.prototype.hasOwnProperty.call(files, name) ? files[name] : null; },
        async set(name, json) { const prev = files[name]; files[name] = json; return { created: prev === undefined, unchanged: prev === json, editKey: "k_" + name, superseded: false, error: null }; },
      };
    }
    if (!PSA) { check("psa: ERP.psa exposed", false); return { passed: 0, failed: 1, results }; }
    const srv = makeServer();
    const origRoute = RT.routeAlert, origIngest = AUTO.ingest;
    let pid = null, dev = null;
    try {
      check("psa: the API is exposed", ["settings", "saveSettings", "setToken", "linkFor", "createTicket", "updateTicket", "resolveTicket", "syncStatus", "ingest", "onAlert", "createTicketFromEvent", "tickets", "ticket", "forAlert", "stats", "renderPanel"].every((f) => typeof PSA[f] === "function"));

      store.useBackend(srv);
      store.resetAllLocal();
      T.reload();
      await M.seed({ force: true });
      RT.routeAlert = async () => ({ skipped: true });
      AUTO.ingest = async () => ({ triggered: [] });

      const created = await T.create({ name: "PSA " + uid });
      pid = created.provider.id;
      dev = (await D.add(pid, { hostname: "PSA-SRV1", role: "server", status: "online", documentation: { refId: "doc-1", systemId: "Head Office / DC", refUrl: "https://doc.example.com/1" } })).device;
      const prov = (await T.get(pid)).provider;

      /* ── settings + token ── */
      const set = await PSA.saveSettings({ mode: "local", defaultQueue: "Tier 2", priorityMap: { "sev-critical": 1 } });
      check("psa: settings round-trip", set.settings.defaultQueue === "Tier 2" && (await PSA.settings()).mode === "local");
      PSA.setToken("super-secret-token");
      check("psa: the token is held in memory and reported", PSA.hasToken() === true && PSA.getToken() === "super-secret-token");
      const psaDoc = store.cachedDoc("rmm-v1-psa");
      check("psa: the token is NEVER persisted to the document", !JSON.stringify(psaDoc || {}).includes("super-secret-token"));
      check("psa: the configuration-record link comes from the device", PSA.linkFor(dev).configSystemId === "Head Office / DC" && PSA.linkFor(dev).configRefId === "doc-1");

      /* ── create from an alert ── */
      const fired = await AL.fire(pid, { monitorId: "mon-t", monitorName: "Disk", monitorType: "disk", settings: { volume: "C:" }, deviceId: dev.id, severityId: "sev-critical", severityRank: 30, severityLabel: "Critical", state: "critical", message: "At 3%.", dedupeKey: "kt", at: "2026-01-05T10:00:00Z" }, { provider: prov, device: dev, silent: true });
      const alert = (await AL.get(pid, fired.alert.id)).alert;
      const t1 = await PSA.createTicket(pid, alert, { provider: prov });
      check("psa: a ticket is created for the alert", t1.ok === true && !!t1.ticket.externalId && t1.ticket.status === "open");
      check("psa: the ticket links device, alert and configuration record", t1.ticket.alertId === alert.id && t1.ticket.deviceId === dev.id && t1.ticket.configSystemId === "Head Office / DC" && t1.ticket.configUrl === "https://doc.example.com/1");
      check("psa: the alert reflects the ticket", (await AL.get(pid, alert.id)).alert.ticketRef === t1.ticket.externalId && (await AL.get(pid, alert.id)).alert.ticketStatus === "open");
      check("psa: the ticket reference is minted from the prefix", /^PSA-\d+$/.test(t1.ticket.externalId));

      /* ── de-duplication ── */
      const t2 = await PSA.createTicket(pid, alert, { provider: prov });
      check("psa: a recurring alert updates the open ticket instead of opening a second", t2.deduped === true && t2.ticket.id === t1.ticket.id && (await PSA.tickets(pid, {})).length === 1);

      /* ── status + priority + inbound webhook ── */
      const upd = await PSA.updateTicket(pid, t1.ticket.id, { status: "in-progress", priority: 2, note: "Working on it", actor: "tester" });
      check("psa: update moves status and reflects it on the alert", upd.ticket.status === "in-progress" && (await AL.get(pid, alert.id)).alert.ticketStatus === "in-progress");
      const synced = await PSA.syncStatus(pid, t1.ticket.externalId, "pending");
      check("psa: a psa-u status change is reflected onto the alert", synced.ticket.status === "pending" && (await AL.get(pid, alert.id)).alert.ticketStatus === "pending");
      const ing = await PSA.ingest(pid, { externalId: t1.ticket.externalId, status: "in-progress", note: "Inbound webhook" });
      check("psa: the inbound webhook finds the ticket by external id", ing.ok === true && ing.ticket.status === "in-progress");
      const t = await PSA.ticket(t1.ticket.id);
      check("psa: ticket activity is recorded", asArrTest(t.updates).length >= 4);
      check("psa: an unknown status is rejected", (await PSA.syncStatus(pid, t1.ticket.id, "nonsense")).error === "bad_status");

      /* ── resolve ── */
      const resolved = await PSA.resolveTicket(pid, alert, {});
      check("psa: resolving the ticket marks it resolved", resolved.ticket.status === "resolved" && !!resolved.ticket.resolvedAt);
      check("psa: the alert reflects the resolved status", (await AL.get(pid, alert.id)).alert.ticketStatus === "resolved");

      /* ── alert lifecycle hook ── */
      const f2 = await AL.fire(pid, { monitorId: "mon-t2", monitorName: "Outage", monitorType: "updown", deviceId: dev.id, severityId: "sev-critical", severityRank: 30, severityLabel: "Critical", state: "critical", message: "down", dedupeKey: "kt2", at: "2026-01-05T11:00:00Z" }, { provider: prov, device: dev });
      const autoT = await PSA.forAlert(pid, f2.alert.id);
      check("psa: a critical alert auto-opens a ticket via the lifecycle hook", !!autoT && autoT.status === "open");
      await AL.autoClear(pid, f2.alert.id, { at: "2026-01-05T11:30:00Z" });
      check("psa: auto-clearing the alert resolves its ticket", (await PSA.forAlert(pid, f2.alert.id)).status === "resolved");
      const f3 = await AL.fire(pid, { monitorId: "mon-t3", monitorName: "Info", monitorType: "cpu", deviceId: dev.id, severityId: "sev-info", severityRank: 10, state: "warning", message: "meh", dedupeKey: "kt3", at: "2026-01-05T12:00:00Z" }, { provider: prov, device: dev, silent: true });
      check("psa: below-critical alerts do not auto-open a ticket", !(await PSA.forAlert(pid, f3.alert.id)));

      /* ── automation action ── */
      const fromEvent = await PSA.createTicketFromEvent(pid, { deviceId: dev.id, subject: "Created by automation", severityId: "sev-warning" }, { subject: "Created by automation" });
      check("psa: createTicketFromEvent opens a standalone ticket", fromEvent.ok === true && fromEvent.ticket.alertId === null && fromEvent.ticket.subject === "Created by automation");

      /* ── stats + UI ── */
      const st = await PSA.stats(pid);
      check("psa: stats summarise the ticket set", st.total >= 2 && st.open >= 1 && st.docName === "rmm-v1-psa");
      const probe = document.createElement("div");
      document.body.appendChild(probe);
      await PSA.renderPanel(probe, { provider: prov, providerId: pid, toast() {} });
      check("psa: the tickets panel renders", !!probe.querySelector("table tbody tr") && probe.querySelectorAll('[data-act="psa-detail"]').length >= 1);
      probe.remove();

      check("psa: every canonical file stays in the rmm namespace", Object.keys(srv.files).every((n) => n.indexOf("rmm-v1-") === 0));
    } catch (e) {
      check("psa: harness did not crash", false, (e && e.stack) || String(e));
    } finally {
      try { RT.routeAlert = origRoute; } catch (e) {}
      try { AUTO.ingest = origIngest; } catch (e) {}
      try { PSA.setToken(""); } catch (e) {}
      try { store.useBackend(null); } catch (e) {}
      try { store.resetAllLocal(); } catch (e) {}
      try { T.reload(); } catch (e) {}
      try { await M.seed(); } catch (e) {}
    }
    const passed = results.filter((r) => r.ok).length;
    const failed = results.length - passed;
    return { passed, failed, results };
  };

  /* ============================================================
     Phase 5 · Task 27 validation tests — alert triage workspace
     Run via page_eval:  await window.RMMTriageTest()
     Covers: the explainable priority model (deterministic scoring,
     bands, factors, age/snooze/ownership effects), the prioritized
     queue (filters, search, sort), grouping by device/site/monitor/
     assignee, assignment (persisted + timeline + filters + bulk),
     bulk acknowledge/resolve/snooze through the lifecycle, and the
     response-time metrics (volume, MTTA, MTTR, SLA target) computed
     from the alert records' own timestamps, plus the rendered panel.
     ============================================================ */
  window.RMMTriageTest = async function (opts) {
    opts = opts || {};
    results.length = 0;
    const ERP = window.ERP;
    const store = ERP.store;
    const T = ERP.tenancy;
    const D = ERP.devices;
    const AL = ERP.alerts;
    const TR = ERP.triage;
    const uid = Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);

    function makeServer() {
      const files = {};
      return {
        files,
        async get(name) { return Object.prototype.hasOwnProperty.call(files, name) ? files[name] : null; },
        async set(name, json) { const prev = files[name]; files[name] = json; return { created: prev === undefined, unchanged: prev === json, editKey: "k_" + name, superseded: false, error: null }; },
      };
    }
    if (!TR) { check("triage: ERP.triage exposed", false); return { passed: 0, failed: 1, results }; }
    const srv = makeServer();
    const MIN = 60000, HOUR = 3600000, DAY = 86400000;
    const T0 = Date.parse("2026-02-01T00:00:00Z");
    const iso = (ms) => new Date(ms).toISOString();
    const day = (n, h) => iso(T0 + n * DAY + (h || 0) * HOUR);
    let pid = null, devA = null, devB = null;
    let a1 = null, a2 = null, a3 = null;

    try {
      check("triage: the API is exposed", ["priority", "priorityBand", "bandTone", "bandLabel", "priorityBadge", "queue", "group", "groupingIds", "bulk", "metrics", "durationStats", "formatDuration", "assignees", "normalizeAssignee", "countsOf", "barChart", "renderPanel", "renderInto", "render"].every((f) => typeof TR[f] === "function"));

      store.useBackend(srv);
      store.resetAllLocal();
      T.reload();

      /* ── the explainable priority model (pure, deterministic) ── */
      const scoreAlert = { severityRank: 30, severityLabel: "Critical", state: "firing", firstFiredAt: day(0, 0), occurrences: 1 };
      const at = day(0, 1);
      const p1 = TR.priority(scoreAlert, at);
      const p1b = TR.priority(scoreAlert, at);
      check("triage: priority is deterministic for the same alert and instant", p1.score === p1b.score && JSON.stringify(p1) === JSON.stringify(p1b));
      check("triage: a fresh critical unacknowledged alert is P1", p1.band === "P1" && p1.score >= 70);
      check("triage: the score is explained by named factors", p1.factors.length >= 2 && p1.factors.reduce((s, f) => s + f.points, 0) >= 45);
      const lowScore = TR.priority({ severityRank: 10, severityLabel: "Info", state: "acknowledged", firstFiredAt: day(0, 0) }, at);
      check("triage: an acknowledged informational alert ranks low (P4)", lowScore.band === "P4" && lowScore.score < 25);
      const older = TR.priority(scoreAlert, day(5, 0));
      check("triage: priority rises with age", older.score > p1.score);
      const snoozy = TR.priority(Object.assign({}, scoreAlert, { snoozeUntil: day(3, 0) }), at);
      check("triage: a snoozed alert is deprioritised", snoozy.score < p1.score && snoozy.factors.some((f) => f.label === "Snoozed"));
      const owned = TR.priority(Object.assign({}, scoreAlert, { assignedToName: "Alex" }), at);
      check("triage: an owned alert scores below an unowned one", owned.score < p1.score);
      check("triage: bands map score thresholds", TR.priorityBand(70) === "P1" && TR.priorityBand(69) === "P2" && TR.priorityBand(45) === "P2" && TR.priorityBand(25) === "P3" && TR.priorityBand(24) === "P4");
      check("triage: band tones and labels are defined", TR.bandTone("P1") === "danger" && /P1/.test(TR.bandLabel("P1")));

      /* ── fixture provider ── */
      pid = (await T.create({ name: "Triage " + uid })).provider.id;
      await T.addItem(pid, "sites", { id: "site-hq", name: "HQ" });
      await T.addItem(pid, "sites", { id: "site-br", name: "Branch" });
      await T.addItem(pid, "deviceGroups", { id: "grp-srv", name: "Servers" });
      await T.addItem(pid, "deviceGroups", { id: "grp-ws", name: "Workstations" });
      devA = (await D.add(pid, { hostname: "TRI-A", status: "online", siteId: "site-hq", groupIds: ["grp-srv"], os: { family: "Windows" } })).device;
      devB = (await D.add(pid, { hostname: "TRI-B", status: "online", siteId: "site-br", groupIds: ["grp-ws"], os: { family: "Linux" } })).device;

      const fire = async (dev, monId, monName, sevRank, sevId, atIso, key) => {
        const prov = (await T.get(pid)).provider;
        const r = await AL.fire(pid, { monitorId: monId, monitorName: monName, monitorType: "cpu", deviceId: dev.id, severityId: sevId, severityRank: sevRank, severityLabel: sevId, state: "warning", message: "test alert", dedupeKey: key, at: atIso }, { provider: prov, device: dev, silent: true, force: true });
        return r.alert;
      };
      a1 = await fire(devA, "mon-cpu", "CPU", 30, "sev-critical", day(-2, 0), "k1");
      a2 = await fire(devA, "mon-disk", "Disk", 10, "sev-info", day(-1, 0), "k2");
      a3 = await fire(devB, "mon-cpu", "CPU", 20, "sev-warning", day(0, 0), "k3");

      /* ── the prioritized queue ── */
      const q = await TR.queue(pid, { at: day(0, 6) });
      check("triage: the queue returns prioritized rows", q.rows.length === 3 && q.rows.every((r) => typeof r.priorityScore === "number" && !!r.priorityBand));
      check("triage: the queue is sorted by priority", q.rows[0].priorityScore >= q.rows[1].priorityScore && q.rows[1].priorityScore >= q.rows[2].priorityScore);
      check("triage: counts summarise the queue", q.counts.active === 3 && q.counts.firing === 3 && q.counts.critical === 1);
      const byDev = await TR.queue(pid, { deviceId: devA.id, at: day(0, 6) });
      check("triage: filtering by device narrows the queue", byDev.rows.length === 2 && byDev.rows.every((r) => r.deviceId === devA.id));
      const bySite = await TR.queue(pid, { siteId: "site-br", at: day(0, 6) });
      check("triage: filtering by site narrows the queue", bySite.rows.length === 1 && bySite.rows[0].deviceId === devB.id);
      const bySev = await TR.queue(pid, { severityId: "sev-critical", at: day(0, 6) });
      check("triage: filtering by severity narrows the queue", bySev.rows.length === 1 && bySev.rows[0].id === a1.id);
      const search = await TR.queue(pid, { q: "TRI-A", at: day(0, 6) });
      check("triage: search matches the hostname", search.rows.length === 2);
      const oldest = await TR.queue(pid, { sort: "oldest", at: day(0, 6) });
      check("triage: sorting by oldest puts the oldest first", oldest.rows[0].id === a1.id);

      /* ── grouping ── */
      const gDev = TR.group(q.rows, "device");
      check("triage: grouping by device buckets per device", gDev.length === 2 && gDev.some((g) => g.count === 2));
      const gSite = TR.group(q.rows, "site");
      check("triage: grouping by site labels the site", gSite.some((g) => g.label === "HQ") && gSite.some((g) => g.label === "Branch"));
      const gMon = TR.group(q.rows, "monitor");
      check("triage: grouping by monitor buckets by monitor name", gMon.length === 2 && gMon.some((g) => g.label === "CPU" && g.count === 2));
      const gOwner = TR.group(q.rows, "assignee");
      check("triage: unassigned rows form their own group", gOwner.length === 1 && gOwner[0].label === "Unassigned");

      /* ── assignment ── */
      const asg = await AL.assign(pid, a1.id, { id: "u-1", name: "Alex" }, "tester");
      check("triage: assignment persists on the alert", asg.alert.assignedToName === "Alex" && (await AL.get(pid, a1.id)).alert.assignedToName === "Alex");
      check("triage: assignment is recorded in the timeline", (await AL.get(pid, a1.id)).alert.history.some((h) => h.action === "assigned" && h.to === "Alex"));
      const unassigned = await TR.queue(pid, { assignee: "__unassigned__", at: day(0, 6) });
      check("triage: an assigned alert leaves the unassigned filter", unassigned.rows.length === 2);
      const assignedTo = await TR.queue(pid, { assignee: "u-1", at: day(0, 6) });
      check("triage: filtering by assignee works", assignedTo.rows.length === 1 && assignedTo.rows[0].id === a1.id);
      check("triage: the owner just used appears in the assignee list", TR.assignees((await T.get(pid)).provider).some((p) => p.id === "u-1"));

      /* ── bulk actions ── */
      const bulkAssign = await TR.bulk(pid, [a2.id, a3.id], "assign", { assignee: "Dana", actor: "tester" });
      check("triage: bulk assign assigns every selected alert", bulkAssign.ok && bulkAssign.succeeded === 2 && (await AL.get(pid, a3.id)).alert.assignedToName === "Dana");
      const bulkAck = await TR.bulk(pid, [a1.id, a2.id], "acknowledge", { actor: "tester" });
      check("triage: bulk acknowledge moves every alert to acknowledged", bulkAck.succeeded === 2 && (await AL.get(pid, a1.id)).alert.state === "acknowledged" && (await AL.get(pid, a2.id)).alert.state === "acknowledged");
      const bulkResolve = await TR.bulk(pid, [a3.id], "resolve", { actor: "tester" });
      check("triage: bulk resolve resolves the alert", bulkResolve.succeeded === 1 && (await AL.get(pid, a3.id)).alert.state === "resolved");
      const bulkSnooze = await TR.bulk(pid, [a2.id], "snooze", { minutes: 120, actor: "tester" });
      check("triage: bulk snooze opens a snooze window", bulkSnooze.succeeded === 1 && !!(await AL.get(pid, a2.id)).alert.snoozeUntil);
      await TR.bulk(pid, [a2.id], "unsnooze", { actor: "tester" });
      check("triage: bulk unsnooze clears the window", !(await AL.get(pid, a2.id)).alert.snoozeUntil);
      check("triage: an unknown bulk action is rejected", (await TR.bulk(pid, [a1.id], "nonsense")).error === "unknown_action");
      check("triage: bulk assign without a name is rejected", (await TR.bulk(pid, [a1.id], "assign", {})).error === "no_assignee");

      /* ── response-time metrics from exact timestamps ── */
      await AL.mutateAlert(pid, a1.id, (it) => { it.state = "resolved"; it.acknowledgedAt = iso(T0 - 2 * DAY + 30 * MIN); it.resolvedAt = iso(T0 - 2 * DAY + 120 * MIN); });
      await AL.mutateAlert(pid, a2.id, (it) => { it.acknowledgedAt = iso(T0 - 1 * DAY + 10 * MIN); });
      await AL.mutateAlert(pid, a3.id, (it) => { it.resolvedAt = iso(T0 + 60 * MIN); });
      const m = await TR.metrics(pid, { at: day(0, 6), days: 7 });
      check("triage: metrics count the window volume by day", m.volume.total === 3 && m.volume.byDay.length === 3);
      check("triage: MTTA is the mean time to acknowledge", Math.abs(m.mtta.avg - 20 * MIN) < 1000 && m.mtta.count === 2);
      check("triage: MTTR is the mean time to resolve", Math.abs(m.mttr.avg - 90 * MIN) < 1000 && m.mttr.count === 2);
      check("triage: the acknowledge target and SLA share are computed", m.mtta.targetMinutes === 15 && m.mtta.eligible === 2 && m.mtta.slaPercent === 50);
      check("triage: metrics expose the active backlog", m.backlog.total === 3 && m.backlog.active === 1 && m.backlog.oldest && m.backlog.oldest.id === a2.id);
      check("triage: metrics break volume down by severity", m.bySeverity.length === 3);
      const dur = TR.durationStats([1000, 3000, 2000]);
      check("triage: durationStats computes average and median", dur.count === 3 && dur.avg === 2000 && dur.median === 2000);
      check("triage: formatDuration renders human durations", TR.formatDuration(90 * MIN) === "1h 30m" && TR.formatDuration(3 * DAY).indexOf("d") !== -1);
      check("triage: barChart renders bars", /rmm-chart-bar/.test(TR.barChart([{ date: "2026-02-01", count: 2 }, { date: "2026-02-02", count: 0 }])));
      check("triage: priorityBadge renders a band", /P1/.test(TR.priorityBadge({ priorityBand: "P1", priorityScore: 71 })));

      /* ── the rendered workspace ── */
      const probe = document.createElement("div");
      document.body.appendChild(probe);
      await TR.renderInto(probe, { providerId: pid, providers: [{ id: pid }], toast() {} });
      check("triage: the workspace renders the summary and filters", !!probe.querySelector(".rmm-triage-inner") && probe.querySelectorAll("[name^='tri_']").length >= 5);
      check("triage: the queue renders a selectable row per active alert", probe.querySelectorAll("[data-pick]").length >= 1 && !!probe.querySelector(".rmm-tri-bulk"));
      check("triage: the metrics render (chart or empty state)", !!probe.querySelector(".rmm-chart") || !!probe.querySelector(".rmm-chart-empty"));
      probe.remove();

      check("triage: every canonical file stays in the rmm namespace", Object.keys(srv.files).every((n) => n.indexOf("rmm-v1-") === 0));
    } catch (e) {
      check("triage: harness did not crash", false, (e && e.stack) || String(e));
    } finally {
      try { store.useBackend(null); } catch (e) {}
      try { store.resetAllLocal(); } catch (e) {}
      try { T.reload(); } catch (e) {}
    }
    const passed = results.filter((r) => r.ok).length;
    const failed = results.length - passed;
    return { passed, failed, results };
  };

  /* ============================================================
     Phase 6 · Task 28 validation tests — patch policy
     Run via page_eval:  await window.RMMPatchPolicyTest()
     Covers: the clearly stated default (provider-wide, deny-by-
     default with per-classification decisions), normalisation &
     validation, classification matching (exact/contains/__default),
     targeting (OS, site, group, device), precedence ordering
     (priority → OS-specificity → specificity → recency), the
     effective policy with per-classification provenance, and the
     policy CRUD surface (add/update/duplicate/enable/remove) with
     the baseline held read-only.
     ============================================================ */
  window.RMMPatchPolicyTest = async function (opts) {
    opts = opts || {};
    results.length = 0;
    const ERP = window.ERP;
    const store = ERP.store;
    const T = ERP.tenancy;
    const D = ERP.devices;
    const M = ERP.masterConfig;
    const PA = ERP.patch;
    const uid = Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);

    function makeServer() {
      const files = {};
      return {
        files,
        async get(name) { return Object.prototype.hasOwnProperty.call(files, name) ? files[name] : null; },
        async set(name, json) { const prev = files[name]; files[name] = json; return { created: prev === undefined, unchanged: prev === json, editKey: "k_" + name, superseded: false, error: null }; },
      };
    }
    if (!PA) { check("patch policy: ERP.patch exposed", false); return { passed: 0, failed: 1, results }; }
    const srv = makeServer();
    let pid = null, devServ = null, devWs = null, devLin = null;
    const prevRole = ERP.role;

    try {
      ERP.role = "owner";
      check("patch policy: the API is exposed", ["defaultPolicy", "normalizePolicy", "validatePolicy", "classificationRule", "classifications", "classificationFor", "applies", "orderForDevice", "customPolicies", "effectiveOf", "listPolicies", "allPolicies", "getPolicy", "addPolicy", "updatePolicy", "removePolicy", "duplicatePolicy", "setEnabled"].every((f) => typeof PA[f] === "function"));
      check("patch policy: the decision and reboot vocabularies are declared", PA.DECISIONS.join(",") === "inherit,approve,deny,defer" && PA.REBOOT_POLICIES.indexOf("in-window") !== -1);

      store.useBackend(srv);
      store.resetAllLocal();
      T.reload();
      await M.seed({ force: true });
      try { if (ERP.team && ERP.team.setTransport) ERP.team.setTransport(null); } catch (e) {}

      /* ── the clearly stated default ── */
      const dflt = PA.defaultPolicy();
      check("patch policy: the default is the provider-wide baseline", dflt.isDefault === true && dflt.osFamily === "all" && dflt.siteId === null && dflt.priority === 0);
      check("patch policy: unclassified updates are denied by default", dflt.default.decision === "deny");
      check("patch policy: critical & security updates are approved with a deadline", dflt.classifications["pc-critical"].decision === "approve" && dflt.classifications["pc-critical"].deadlineDays === 3 && dflt.classifications["pc-security"].decision === "approve" && dflt.classifications["pc-security"].deadlineDays === 7);
      check("patch policy: definition & rollup updates are approved", dflt.classifications["pc-definition"].decision === "approve" && dflt.classifications["pc-updates"].decision === "approve");
      check("patch policy: drivers are denied while feature/service packs/upgrades defer", dflt.classifications["pc-driver"].decision === "deny" && dflt.classifications["pc-feature"].decision === "defer" && dflt.classifications["pc-servicepack"].decision === "defer" && dflt.classifications["pc-upgrades"].decision === "defer");
      check("patch policy: a reboot happens only when an approved patch requires it", dflt.rebootPolicy === "if-required" && dflt.rebootGraceMinutes === 30 && dflt.enforceDeadline === true);
      check("patch policy: the baseline is read-only", (await PA.updatePolicy("nope", PA.DEFAULT_POLICY_ID, {})).error === "default_is_readonly" && (await PA.removePolicy("nope", PA.DEFAULT_POLICY_ID)).error === "default_is_readonly" && (await PA.setEnabled("nope", PA.DEFAULT_POLICY_ID, false)).error === "default_is_readonly");

      /* ── normalisation & validation ── */
      const np = PA.normalizePolicy({ name: "Ring", osFamily: "WINDOWS", priority: "150", demo: true });
      check("patch policy: normalisation lowercases OS, coerces numbers and keeps the demo flag", np.osFamily === "windows" && np.priority === 150 && np.enabled === true && np.demo === true);
      check("patch policy: unknown enum values fall back", PA.normalizePolicy({ rebootPolicy: "banana", osFamily: "amiga" }).rebootPolicy === "if-required" && PA.normalizePolicy({ osFamily: "amiga" }).osFamily === "all");
      check("patch policy: the default validates cleanly", PA.validatePolicy(PA.defaultPolicy()).valid === true);
      const bad = PA.validatePolicy({ name: "Bad", classifications: { "pc-feature": { decision: "defer", deferralDays: 10, deadlineDays: 5 } } });
      check("patch policy: a deadline before the deferral ends is rejected", bad.valid === false && bad.errors.some((e) => /deadline is before/.test(e)));
      check("patch policy: a negative priority is rejected", (await PA.addPolicy("nope", { name: "Neg", priority: -1 })).error === "invalid");

      /* ── classification matching ── */
      const list = await PA.classifications();
      check("patch policy: the master-config classifications are available", list.length >= 8 && list.some((c) => c.id === "pc-security"));
      check("patch policy: exact / contains classification matching resolves", PA.classificationFor({ classification: "Security Updates" }, list).id === "pc-security" && PA.classificationFor({ classification: "Critical Updates" }, list).id === "pc-critical" && PA.classificationFor({ classification: "Feature Packs" }, list).id === "pc-feature");
      check("patch policy: an unmatched classification falls back to __default", PA.classificationFor({ classification: "Mystery Widgets" }, list).id === "__default");

      /* ── fixture provider ── */
      pid = (await T.create({ name: "PatchPolicy " + uid })).provider.id;
      await T.addItem(pid, "sites", { id: "site-hq", name: "HQ" });
      await T.addItem(pid, "sites", { id: "site-br", name: "Branch" });
      await T.addItem(pid, "deviceGroups", { id: "grp-srv", name: "Servers", kind: "static" });
      await T.addItem(pid, "deviceGroups", { id: "grp-ws", name: "Workstations", kind: "static" });
      devServ = (await D.add(pid, { hostname: "PP-SRV", status: "online", siteId: "site-hq", groupIds: ["grp-srv"], os: { family: "Windows" } })).device;
      devWs = (await D.add(pid, { hostname: "PP-WS", status: "online", siteId: "site-br", groupIds: ["grp-ws"], os: { family: "Windows" } })).device;
      devLin = (await D.add(pid, { hostname: "PP-LNX", status: "online", siteId: "site-br", groupIds: [], os: { family: "Linux" } })).device;

      /* ── targeting ── */
      const wide = PA.normalizePolicy({ id: "pol-wide", name: "Wide", priority: 100 });
      const winOnly = PA.normalizePolicy({ id: "pol-win", name: "Windows only", priority: 100, osFamily: "windows" });
      const hqOnly = PA.normalizePolicy({ id: "pol-site", name: "HQ only", priority: 100, siteId: "site-hq" });
      const grpRule = PA.normalizePolicy({ id: "pol-grp", name: "Servers group", priority: 150, targets: { groupIds: ["grp-srv"] } });
      const devRule = PA.normalizePolicy({ id: "pol-dev", name: "Explicit device", priority: 150, targets: { deviceIds: [devServ.id] } });
      const provider = (await T.get(pid)).provider;
      check("patch policy: a provider-wide policy applies to every device", !!PA.applies(provider, wide, devServ) && !!PA.applies(provider, wide, devLin) && PA.applies(provider, wide, devServ).matchedBy === "provider-wide");
      check("patch policy: an OS-scoped policy only applies to that OS", !!PA.applies(provider, winOnly, devServ) && PA.applies(provider, winOnly, devLin) === null);
      check("patch policy: a site-scoped policy only applies at that site", !!PA.applies(provider, hqOnly, devServ) && PA.applies(provider, hqOnly, devWs) === null);
      check("patch policy: a group target matches membership only", !!PA.applies(provider, grpRule, devServ) && PA.applies(provider, grpRule, devWs) === null);
      check("patch policy: a disabled policy never applies", PA.applies(provider, PA.normalizePolicy({ id: "x", enabled: false }), devServ) === null);

      /* ── precedence ordering ── */
      const override = PA.normalizePolicy({
        id: "pol-override", name: "Servers ring", priority: 200, osFamily: "windows", targets: { groupIds: ["grp-srv"] },
        rebootPolicy: "in-window", rebootGraceMinutes: 15,
        classifications: { "pc-driver": { decision: "approve", deferralDays: 0, deadlineDays: 14, requiresReboot: true }, "pc-feature": { decision: "defer", deferralDays: 30, deadlineDays: 60, requiresReboot: true } },
      });
      await T.update(pid, (p) => { p.patchState = Object.assign({ policies: [], scanRuns: [], approvals: [] }, p.patchState); p.patchState.policies = [grpRule, devRule, winOnly, wide, override]; });
      const prov2 = (await T.get(pid)).provider;
      const chain = PA.orderForDevice(prov2, devServ);
      check("patch policy: the chain is ordered priority -> OS-specificity -> specificity -> default", chain[0].policy.id === "pol-override" && chain[1].policy.id === "pol-dev" && chain[2].policy.id === "pol-grp" && chain[chain.length - 1].policy.isDefault === true);
      check("patch policy: an equal-priority device target beats a group target", chain.find((l) => l.policy.id === "pol-dev").specificity > chain.find((l) => l.policy.id === "pol-grp").specificity);
      const chainLin = PA.orderForDevice(prov2, devLin);
      check("patch policy: a Windows-only rule is absent for a Linux device", !chainLin.some((l) => l.policy.id === "pol-win") && !chainLin.some((l) => l.policy.id === "pol-override"));
      await T.update(pid, (p) => { p.patchState.policies.push(JSON.parse(JSON.stringify(override))); });
      check("patch policy: a duplicated policy id is de-duplicated defensively", (await PA.listPolicies(pid)).filter((x) => x.id === "pol-override").length === 1 && PA.orderForDevice((await T.get(pid)).provider, devServ).filter((l) => l.policy.id === "pol-override").length === 1);

      /* ── effective policy with provenance ── */
      const prov3 = (await T.get(pid)).provider;
      const effServ = await PA.effectiveOf(prov3, devServ);
      const effWs = await PA.effectiveOf(prov3, devWs);
      check("patch policy: the effective policy names the winning policy", effServ.policyId === "pol-override" && effServ.policyName === "Servers ring");
      check("patch policy: an override changes the decision for a classification", effServ.byId["pc-driver"].decision === "approve" && effServ.byId["pc-driver"].source === "Servers ring");
      check("patch policy: an un-overridden classification falls back to the baseline with provenance", effServ.byId["pc-security"].decision === "approve" && effServ.byId["pc-security"].source === "Default patch policy" && effServ.byId["pc-security"].deadlineDays === 7);
      check("patch policy: a device outside the override keeps the baseline decision", effWs.byId["pc-driver"].decision === "deny");
      check("patch policy: top-level settings resolve with provenance", effServ.fields.rebootPolicy.value === "in-window" && effServ.fields.rebootPolicy.source === "Servers ring" && effWs.fields.rebootPolicy.value === "if-required");
      check("patch policy: unclassified updates still resolve to the default block", effServ.byId.__default.decision === "deny" && effServ.byId.__default.classificationId === "__default");
      check("patch policy: the chain reports how each policy matched", effServ.chain[0].matchedBy === "group" && effServ.chain[effServ.chain.length - 1].isDefault === true);

      /* ── CRUD ── */
      const add = await PA.addPolicy(pid, { name: "CRUD ring", priority: 120, osFamily: "windows", classifications: { "pc-tools": { decision: "approve", deadlineDays: 3 } } });
      check("patch policy: add creates a policy and it persists", !!add.policy && (await PA.getPolicy(pid, add.policy.id)).name === "CRUD ring");
      check("patch policy: listing includes it alongside the baseline", (await PA.listPolicies(pid)).some((p) => p.id === add.policy.id) && (await PA.allPolicies(pid))[0].isDefault === true);
      const upd = await PA.updatePolicy(pid, add.policy.id, { name: "CRUD renamed", priority: 130 });
      check("patch policy: update edits fields", upd.policy.name === "CRUD renamed" && upd.policy.priority === 130 && (await PA.getPolicy(pid, add.policy.id)).priority === 130);
      const dup = await PA.duplicatePolicy(pid, add.policy.id);
      check("patch policy: duplicate clones under a fresh id", dup.policy.id !== add.policy.id && /copy/.test(dup.policy.name) && !!(await PA.getPolicy(pid, dup.policy.id)));
      const toggled = await PA.setEnabled(pid, add.policy.id, false);
      check("patch policy: setEnabled toggles the policy", toggled.policy.enabled === false && (await PA.getPolicy(pid, add.policy.id)).enabled === false);
      check("patch policy: removing a policy drops it", !(await PA.removePolicy(pid, dup.policy.id)).error && !(await PA.getPolicy(pid, dup.policy.id)));
      check("patch policy: updating a missing policy reports not_found", (await PA.updatePolicy(pid, "does-not-exist", {})).error === "not_found");

      check("patch policy: every canonical file stays in the rmm namespace", Object.keys(srv.files).every((n) => n.indexOf("rmm-v1-") === 0));
    } catch (e) {
      check("patch policy: harness did not crash", false, (e && e.stack) || String(e));
    } finally {
      try { store.useBackend(null); } catch (e) {}
      try { store.resetAllLocal(); } catch (e) {}
      try { T.reload(); } catch (e) {}
      try { ERP.role = prevRole; } catch (e) {}
      try { await M.seed(); } catch (e) {}
    }
    const passed = results.filter((r) => r.ok).length;
    const failed = results.length - passed;
    return { passed, failed, results };
  };

  /* ============================================================
     Phase 6 · Task 29 validation tests — patch scanning & compliance
     Run via page_eval:  await window.RMMPatchComplianceTest()
     Covers: missing-patch normalisation and OS applicability, the
     missing-set precedence (probe -> persisted report -> derived
     from inventory), a scan that classifies each patch through the
     device's effective policy (required/deferred/denied, deadlines,
     aging), per-device compliance and how long a device has been
     non-compliant (carried forward, then cleared), the device table,
     rollups by group/site/OS, provider stats, scan history, the
     optional alert bridge (gated off), and the rendered console.
     ============================================================ */
  window.RMMPatchComplianceTest = async function (opts) {
    opts = opts || {};
    results.length = 0;
    const ERP = window.ERP;
    const store = ERP.store;
    const T = ERP.tenancy;
    const D = ERP.devices;
    const M = ERP.masterConfig;
    const PA = ERP.patch;
    const uid = Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);

    function makeServer() {
      const files = {};
      return {
        files,
        async get(name) { return Object.prototype.hasOwnProperty.call(files, name) ? files[name] : null; },
        async set(name, json) { const prev = files[name]; files[name] = json; return { created: prev === undefined, unchanged: prev === json, editKey: "k_" + name, superseded: false, error: null }; },
      };
    }
    if (!PA) { check("compliance: ERP.patch exposed", false); return { passed: 0, failed: 1, results }; }
    const srv = makeServer();
    const DAY = 86400000;
    const T0 = Date.parse("2026-03-02T00:00:00Z");
    const iso = (ms) => new Date(ms).toISOString();
    const at = iso(T0);
    let pid = null, devServ = null, devWs = null, devLin = null;

    try {
      check("compliance: the API is exposed", ["normalizeMissing", "applicableToDevice", "deriveMissing", "missingForDevice", "scan", "scanDevice", "scanOf", "scans", "complianceFor", "deviceRows", "rollup", "stats", "scanRuns", "reportScan", "summarizeRows", "syncComplianceAlert"].every((f) => typeof PA[f] === "function"));

      store.useBackend(srv);
      store.resetAllLocal();
      T.reload();
      await M.seed({ force: true });

      pid = (await T.create({ name: "PatchComp " + uid })).provider.id;
      await T.addItem(pid, "sites", { id: "site-hq", name: "HQ" });
      await T.addItem(pid, "sites", { id: "site-br", name: "Branch" });
      await T.addItem(pid, "deviceGroups", { id: "grp-srv", name: "Servers", kind: "static" });
      await T.addItem(pid, "deviceGroups", { id: "grp-ws", name: "Workstations", kind: "static" });
      devServ = (await D.add(pid, { hostname: "PC-SRV", status: "online", siteId: "site-hq", groupIds: ["grp-srv"], os: { family: "Windows" } })).device;
      devWs = (await D.add(pid, { hostname: "PC-WS", status: "online", siteId: "site-br", groupIds: ["grp-ws"], os: { family: "Windows" } })).device;
      devLin = (await D.add(pid, { hostname: "PC-LNX", status: "online", siteId: "site-br", groupIds: [], os: { family: "Linux" } })).device;

      /* a per-group override so some classifications resolve differently */
      await T.update(pid, (p) => {
        p.patchState = Object.assign({ policies: [], scanRuns: [], approvals: [] }, p.patchState);
        p.patchState.policies.push(PA.normalizePolicy({
          id: "pc-pol-srv", name: "Server ring", kind: "patchpolicy", priority: 200, osFamily: "windows", targets: { groupIds: ["grp-srv"] },
          rebootPolicy: "in-window", rebootGraceMinutes: 15, enforceDeadline: true,
          classifications: { "pc-driver": { decision: "approve", deferralDays: 0, deadlineDays: 14, requiresReboot: true }, "pc-feature": { decision: "defer", deferralDays: 30, deadlineDays: 60, requiresReboot: true } },
        }));
      });

      /* ── normalisation & OS applicability ── */
      const nm = PA.normalizeMissing({ kb: "KB5123", title: "Rollup", category: "Security Updates", requiresReboot: false, detectedAt: iso(T0 - 5 * DAY) }, at);
      check("compliance: normalizeMissing fills ids, classification and timestamps", nm.id === "KB5123" && nm.classification === "Security Updates" && nm.requiresReboot === false && nm.detectedAt === iso(T0 - 5 * DAY));
      check("compliance: applicability is decided by OS family", PA.applicableToDevice({ id: "KB1" }, devServ) === true && PA.applicableToDevice({ id: "KB1" }, devLin) === false && PA.applicableToDevice({ id: "USN-1" }, devLin) === true && PA.applicableToDevice({ id: "USN-1" }, devServ) === false && PA.applicableToDevice({ id: "macOS-15" }, devWs) === false);
      const cat = [{ id: "KB1", title: "win" }, { id: "USN-1", title: "lin" }, { id: "macOS-15", title: "mac" }];
      const dWin = await PA.deriveMissing(pid, devServ, { catalogue: cat, at });
      const dLin = await PA.deriveMissing(pid, devLin, { catalogue: cat, at });
      check("compliance: deriveMissing keeps only OS-applicable, not-installed updates", dWin.missing.length === 1 && dWin.missing[0].id === "KB1" && dWin.missing[0].source === "derived" && dLin.missing.length === 1 && dLin.missing[0].id === "USN-1");

      /* ── a scan with explicit probes ── */
      const probes = {};
      probes[String(devServ.id)] = { missing: [
        { id: "KB9001", title: "Security rollup", classification: "Security Updates", requiresReboot: true, detectedAt: iso(T0 - 40 * DAY) },
        { id: "DRV-1", title: "GPU driver", classification: "Drivers", requiresReboot: true, detectedAt: iso(T0 - 20 * DAY) },
        { id: "KB9002", title: "Feature pack", classification: "Feature Packs", requiresReboot: true, detectedAt: iso(T0 - 5 * DAY) },
        { id: "WIDGET-1", title: "Widget update", classification: "Widgets", requiresReboot: false, detectedAt: iso(T0 - 1 * DAY) },
      ] };
      probes[String(devWs.id)] = { missing: [
        { id: "KB9001", title: "Security rollup", classification: "Security Updates", requiresReboot: true, detectedAt: iso(T0 - 2 * DAY) },
      ] };
      probes[String(devLin.id)] = { missing: [] };

      const scan = await PA.scan(pid, { at, probes });
      check("compliance: a scan reports one result per device", scan.scanned === 3 && scan.summary.devices === 3);
      (function () {
        const rec = scan.scans.find((s) => s.deviceId === String(devServ.id));
        const byId = {}; rec.missing.forEach((m) => { byId[m.id] = m; });
        check("compliance: the scan classifies each patch through the effective policy", byId["KB9001"].decision === "approve" && byId["KB9001"].requiredNow === true && byId["KB9001"].overdue === true && byId["DRV-1"].decision === "approve" && byId["DRV-1"].decisionSource === "Server ring" && byId["DRV-1"].overdue === true && byId["KB9002"].decision === "defer" && byId["KB9002"].requiredNow === false && byId["WIDGET-1"].decision === "deny" && byId["WIDGET-1"].denied === true, JSON.stringify(rec.counts));
      })();
      check("compliance: the summary counts compliant / non-compliant and overdue", scan.summary.compliant === 1 && scan.summary.nonCompliant === 2 && scan.summary.missingTotal === 5 && scan.summary.missingRequired === 3 && scan.summary.overdue === 2, JSON.stringify(scan.summary));
      (function () {
        const rec = scan.scans.find((s) => s.deviceId === String(devWs.id));
        check("compliance: a deadline is scheduled from detection + the policy deadline", rec.missing[0].deadlineAt === iso(T0 - 2 * DAY + 7 * DAY) && rec.missing[0].overdue === false);
      })();
      (function () {
        const rec = scan.scans.find((s) => s.deviceId === String(devServ.id));
        check("compliance: non-compliance is dated from the earliest required patch", rec.compliance.nonCompliantSince === iso(T0 - 40 * DAY) && rec.compliance.ageDays === 40 && rec.compliance.withinGrace === false);
      })();

      /* ── persisted scan records & reads ── */
      check("compliance: a scan record is persisted per device", (await PA.scans(pid)).length === 3 && !!(await PA.scanOf(devServ.id)) && (await PA.scanOf(devServ.id)).counts.missingRequired === 2);
      check("compliance: complianceFor reads the persisted scan", (await PA.complianceFor(pid, devServ.id)).source === "scan" && (await PA.complianceFor(pid, devServ.id)).status === "non-compliant");
      const dr = await PA.deviceRows(pid);
      check("compliance: the device table lists every device, non-compliant first", dr.rows.length === 3 && dr.rows[0].complianceStatus === "non-compliant" && dr.rows[dr.rows.length - 1].complianceStatus === "compliant");
      check("compliance: device rows carry counts, policy and scan time", dr.rows.find((r) => r.deviceId === devServ.id).missingRequired === 2 && dr.rows.find((r) => r.deviceId === devServ.id).lastScanAt === at && dr.rows.find((r) => r.deviceId === devServ.id).policyName === "Server ring");
      check("compliance: the row summary folds into a fleet summary", dr.summary.devices === 3 && dr.summary.compliant === 1 && dr.summary.nonCompliant === 2 && dr.summary.missingRequired === 3);
      check("compliance: filtering the table by status works", (await PA.deviceRows(pid, { status: "compliant" })).rows.length === 1 && (await PA.deviceRows(pid, { status: "non-compliant" })).rows.length === 2);
      check("compliance: searching the table matches hostnames", (await PA.deviceRows(pid, { q: "PC-LNX" })).rows.length === 1);

      /* ── rollups ── */
      const byGroup = await PA.rollup(pid, { by: "group" });
      check("compliance: the group rollup buckets per device group", byGroup.buckets.some((b) => b.key === "grp-srv" && b.nonCompliant === 1 && b.missingRequired === 2) && byGroup.buckets.some((b) => b.key === "none"));
      const bySite = await PA.rollup(pid, { by: "site" });
      check("compliance: the site rollup counts devices per site", bySite.buckets.find((b) => b.key === "site-br").devices === 2 && bySite.buckets.find((b) => b.key === "site-hq").devices === 1);
      const byOs = await PA.rollup(pid, { by: "os" });
      check("compliance: the OS rollup splits by family", byOs.buckets.find((b) => b.key === "windows").devices === 2 && byOs.buckets.find((b) => b.key === "linux").devices === 1 && byOs.buckets.find((b) => b.key === "linux").compliancePct === 100);

      /* ── provider stats & scan history ── */
      const stats = await PA.stats(pid);
      check("compliance: provider stats summarise the fleet and the last scan", stats.devices === 3 && stats.compliant === 1 && stats.nonCompliant === 2 && stats.missingRequired === 3 && stats.overdue === 2 && stats.scannedDevices === 3 && stats.lastScanAt === at && stats.policies === 1);
      check("compliance: scan history records a run per device", (await PA.scanRuns(pid)).length === 3 && (await PA.scanRuns(pid))[0].at === at);

      /* ── non-compliant age is carried forward, then cleared ── */
      await PA.scan(pid, { at: iso(T0 + 2 * DAY), probes });
      check("compliance: the non-compliant age is carried forward across scans", (await PA.scanOf(devServ.id)).compliance.nonCompliantSince === iso(T0 - 40 * DAY) && (await PA.scanOf(devServ.id)).compliance.ageDays === 42);
      const cleared = {};
      cleared[String(devServ.id)] = { missing: [] };
      await PA.scan(pid, { at: iso(T0 + 3 * DAY), probes: cleared, deviceId: devServ.id });
      check("compliance: becoming compliant clears the non-compliant age", (await PA.scanOf(devServ.id)).compliance.compliant === true && (await PA.scanOf(devServ.id)).compliance.nonCompliantSince === "");

      /* ── missing-set precedence: probe -> report -> derived ── */
      const dev0 = (await T.get(pid)).provider.devices.find((d) => String(d.id) === String(devWs.id));
      const fromProbe = await PA.missingForDevice(pid, dev0, { probes: { [String(devWs.id)]: { missing: [{ id: "KBX", classification: "Security Updates" }] } }, at });
      check("compliance: an explicit probe is the preferred missing source", fromProbe.source === "probe" && fromProbe.missing.length === 1 && fromProbe.missing[0].id === "KBX");
      const rep = await PA.reportScan(pid, devWs.id, { at, missing: [{ id: "KBREP", classification: "Security Updates", requiresReboot: true }] });
      check("compliance: an agent report persists on the device", rep.ok === true && rep.missing === 1);
      const dev1 = (await T.get(pid)).provider.devices.find((d) => String(d.id) === String(devWs.id));
      const fromReport = await PA.missingForDevice(pid, dev1, { at });
      check("compliance: the persisted report is used when no probe is supplied", fromReport.source === "agent" && fromReport.missing.length === 1 && fromReport.missing[0].id === "KBREP");
      const fresh = (await D.add(pid, { hostname: "PC-FRESH", status: "online", siteId: "site-br", groupIds: [], os: { family: "Windows" } })).device;
      const freshDev = (await T.get(pid)).provider.devices.find((d) => String(d.id) === String(fresh.id));
      const derived = await PA.missingForDevice(pid, freshDev, { catalogue: cat, at });
      check("compliance: with no probe or report the set is derived from inventory", derived.source === "derived" && derived.missing.length === 1 && derived.missing[0].id === "KB1");

      /* ── the optional alert bridge is gated off by default ── */
      check("compliance: the alert bridge is a no-op unless enabled", (await PA.syncComplianceAlert(pid, { compliance: { compliant: false }, counts: {}, deviceId: devServ.id }, at, (await T.get(pid)).provider)) === null);
      check("compliance: summarizeRows folds rows into a fleet summary", PA.summarizeRows(dr.rows).nonCompliant === 2 && PA.summarizeRows(dr.rows).missingRequired === 3);

      /* ── single-device scan ── */
      const one = await PA.scanDevice(pid, devLin.id, { at: iso(T0 + 4 * DAY), probes: { [String(devLin.id)]: { missing: [{ id: "USN-9", classification: "Security", detectedAt: iso(T0 + 4 * DAY) }] } } });
      check("compliance: scanDevice scans exactly one device", one.scanned === 1 && (await PA.scanOf(devLin.id)).counts.missingTotal === 1);

      /* ── the rendered console ── */
      const host = document.createElement("div");
      document.body.appendChild(host);
      await PA.renderInto(host, { providerId: pid, providers: [{ id: pid, name: "Test provider" }], toast() {} });
      check("compliance: the console renders tabs, stat cards and the rollups", !!host.querySelector(".rmm-patch-inner") && host.querySelectorAll("[data-tab]").length === 4 && host.querySelectorAll(".rmm-tri-metrics .erp-stat").length >= 6 && !!host.querySelector(".rmm-patch-rollups") && !!host.querySelector('[name="pa_by"]'));
      check("compliance: the device table renders scan and drill-down actions", host.querySelectorAll("[data-act='pa-scan-device']").length >= 3 && host.querySelectorAll("[data-act='pa-device']").length >= 3);
      const polTab = host.querySelector('[data-tab="policy"]');
      if (polTab) polTab.click();
      await new Promise((r) => setTimeout(r, 700));
      check("compliance: the policy tab renders the effective preview and the policy list", !!host.querySelector(".rmm-patch-preview") && !!host.querySelector("[data-act='pa-policy-new']") && host.textContent.indexOf("Server ring") !== -1);
      const catTab = host.querySelector('[data-tab="catalogue"]');
      if (catTab) catTab.click();
      await new Promise((r) => setTimeout(r, 700));
      check("compliance: the catalogue tab renders scan history", !!host.querySelector(".rmm-patch-catalogue") && host.textContent.indexOf("Scan history") !== -1);
      host.remove();

      check("compliance: every canonical file stays in the rmm namespace", Object.keys(srv.files).every((n) => n.indexOf("rmm-v1-") === 0));
    } catch (e) {
      check("compliance: harness did not crash", false, (e && (e.message + " | " + e.stack)) || String(e));
    } finally {
      try { store.useBackend(null); } catch (e) {}
      try { store.resetAllLocal(); } catch (e) {}
      try { T.reload(); } catch (e) {}
      try { await M.seed(); } catch (e) {}
    }
    const passed = results.filter((r) => r.ok).length;
    const failed = results.length - passed;
    return { passed, failed, results };
  };

  /* ============================================================
     RMM-U — patch deployment & audit (Phase 6 · Task 30)
     Run via page_eval:  await window.RMMPatchDeployTest()
     Covers: the per-OS install script + machine-readable result
     parsing, the deploy plan (approved vs held-back: denied,
     deferred, not approved), deploying approved patches as one
     agent job per device, reconciling real job results into
     installed/failed attribution, automatic retry (backoff + a
     forced retry), before/after compliance capture, reboot
     queueing per policy (if-required / in-window / never),
     scheduling / dispatching / completing / skipping a reboot, the
     auditable per-client compliance report + JSON export, and the
     rendered deployment console.
     ============================================================ */
  window.RMMPatchDeployTest = async function (opts) {
    opts = opts || {};
    results.length = 0;
    const ERP = window.ERP;
    const store = ERP.store;
    const T = ERP.tenancy;
    const D = ERP.devices;
    const E = ERP.enrollment;
    const J = ERP.jobs;
    const M = ERP.masterConfig;
    const PA = ERP.patch;
    const uid = Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);

    function makeServer() {
      const files = {};
      return {
        files,
        async get(name) { return Object.prototype.hasOwnProperty.call(files, name) ? files[name] : null; },
        async set(name, json) { const prev = files[name]; files[name] = json; return { created: prev === undefined, unchanged: prev === json, editKey: "k_" + name, superseded: false, error: null }; },
      };
    }
    if (!PA || !J || !E) { check("deploy: ERP.patch + ERP.jobs + ERP.enrollment exposed", false); return { passed: 0, failed: 1, results }; }
    const srv = makeServer();
    const DAY = 86400000, MIN = 60000;
    const T0 = Date.parse("2026-04-06T00:00:00Z");
    const iso = (ms) => new Date(ms).toISOString();
    const at = iso(T0);
    let pid = null;
    const cred = {};
    let devSrv = null, devDesk = null, devLin = null;
    const arr = (v) => (Array.isArray(v) ? v : []);
    const prevRole = ERP.role;

    const runJob = async (deviceId, stdout, exitCode) => {
      const credential = cred[String(deviceId)];
      const c = await J.claim({ deviceId, credential });
      const job = (c.jobs || [])[0];
      if (!job) return { ok: false, error: "job_not_delivered" };
      return await J.result({ jobId: job.jobId, deviceId, credential, exitCode: exitCode == null ? 0 : exitCode, stdout: stdout || "", stderr: "" });
    };

    try {
      ERP.role = "owner";
      check("deploy: the deployment + audit API is exposed", ["deployScript", "parseResultOutput", "planForDevice", "plan", "deploy", "reconcileDeployment", "reconcileAll", "deployments", "deployment", "summarizeDeployment", "reboots", "scheduleReboot", "performReboot", "completeReboot", "skipReboot", "complianceReport", "exportReport", "renderReport", "download"].every((f) => typeof PA[f] === "function"), ["deployScript", "reconcileDeployment", "complianceReport", "renderReport"].filter((f) => typeof PA[f] !== "function").join(","));

      /* ── the install script + result parsing ── */
      const pscript = PA.deployScript("windows", [{ id: "KB1", title: "Rollup" }, { id: "KB2", title: "Sec" }], { deploymentId: "dep1", hostname: "PC-1" });
      check("deploy: the Windows script installs each update and prints PATCHRESULT", pscript.language === "powershell" && /Install-WindowsUpdate/.test(pscript.script) && /PATCHRESULT/.test(pscript.script) && /KB1/.test(pscript.script) && /KB2/.test(pscript.script));
      const lscript = PA.deployScript("linux", [{ id: "USN-1", title: "sec" }], {});
      check("deploy: the Linux script uses apt-get and prints PATCHRESULT", lscript.language === "bash" && /apt-get/.test(lscript.script) && /PATCHRESULT/.test(lscript.script));
      const mscript = PA.deployScript("macos", [{ id: "macOS-14", title: "os" }], {});
      check("deploy: the macOS script uses softwareupdate", mscript.language === "bash" && /softwareupdate/.test(mscript.script));
      const parsed = PA.parseResultOutput("noise\nPATCHRESULT KB1 ok\nPATCHRESULT KB2 failed install error\nPATCHRESULT KB3 ok all good\n");
      check("deploy: PATCHRESULT lines parse into per-patch states", parsed.length === 3 && parsed[0].ok === true && parsed[0].state === "installed" && parsed[1].ok === false && parsed[1].state === "failed" && parsed[1].message === "install error" && parsed[2].id === "KB3" && PA.parseResultOutput("nothing here").length === 0);

      /* ── fixture ── */
      store.useBackend(srv);
      store.resetAllLocal();
      T.reload();
      await M.seed({ force: true });
      try { if (ERP.team && ERP.team.setTransport) ERP.team.setTransport(null); } catch (e) {}
      pid = (await T.create({ name: "PatchDeploy " + uid })).provider.id;
      await T.addItem(pid, "sites", { id: "site-hq", name: "HQ" });
      await T.addItem(pid, "deviceGroups", { id: "grp-srv", name: "Servers", kind: "static" });
      await T.addItem(pid, "deviceGroups", { id: "grp-desk", name: "Desktops", kind: "static" });

      const enroll = async (hostname, osName) => {
        const t = await E.issueToken({ providerId: pid });
        const en = await E.enroll({ token: t.token, hostname, os: { name: osName } });
        cred[String(en.deviceId)] = en.credential;
        return en.deviceId;
      };
      devSrv = await enroll("DEP-SRV1", "Windows Server 2022");
      devDesk = await enroll("DEP-WS1", "Windows 11");
      devLin = await enroll("DEP-LNX1", "Ubuntu 22.04");
      await D.setSite(pid, devSrv, "site-hq");
      await D.assignGroup(pid, devSrv, "grp-srv");
      await D.assignGroup(pid, devDesk, "grp-desk");

      /* two overrides: an in-window reboot ring, and a never-reboot ring */
      await T.update(pid, (p) => {
        p.patchState = Object.assign({ policies: [], scanRuns: [], approvals: [], deployments: [], reboots: [] }, p.patchState);
        p.patchState.policies.push(PA.normalizePolicy({ id: "pd-srv", name: "Server ring", kind: "patchpolicy", priority: 200, osFamily: "windows", targets: { groupIds: ["grp-srv"] }, rebootPolicy: "in-window", rebootWindowId: "mw-night", rebootGraceMinutes: 15 }));
        p.patchState.policies.push(PA.normalizePolicy({ id: "pd-desk", name: "Desktop ring", kind: "patchpolicy", priority: 150, osFamily: "windows", targets: { groupIds: ["grp-desk"] }, rebootPolicy: "never" }));
      });

      const probes = {};
      probes[String(devSrv)] = { missing: [
        { id: "KB7001", title: "Security rollup", classification: "Security Updates", requiresReboot: true, detectedAt: iso(T0 - 2 * DAY) },
        { id: "KB7002", title: "Servicing stack", classification: "Security Updates", requiresReboot: true, detectedAt: iso(T0 - 1 * DAY) },
        { id: "FEA1", title: "Feature pack", classification: "Feature Packs", requiresReboot: true, detectedAt: iso(T0 - 1 * DAY) },
        { id: "DRV1", title: "GPU driver", classification: "Drivers", requiresReboot: true, detectedAt: iso(T0 - 1 * DAY) },
        { id: "WID1", title: "Widget", classification: "Widgets", requiresReboot: false, detectedAt: iso(T0 - 1 * DAY) },
      ] };
      probes[String(devDesk)] = { missing: [
        { id: "KB7101", title: "Security rollup", classification: "Security Updates", requiresReboot: true, detectedAt: iso(T0 - 1 * DAY) },
        { id: "KB7102", title: "Security rollup 2", classification: "Security Updates", requiresReboot: true, detectedAt: iso(T0 - 1 * DAY) },
      ] };
      probes[String(devLin)] = { missing: [
        { id: "USN-8001-1", title: "kernel security update", classification: "Security Updates", requiresReboot: true, detectedAt: iso(T0 - 1 * DAY) },
        { id: "USN-8002-1", title: "openssl security update", classification: "Security Updates", requiresReboot: true, detectedAt: iso(T0 - 1 * DAY) },
      ] };
      const scan = await PA.scan(pid, { at, probes });
      check("deploy: the seed scan reports every device non-compliant", scan.scanned === 3 && scan.summary.nonCompliant === 3, JSON.stringify(scan.summary));

      /* ── plan ── */
      const plan = await PA.plan(pid, { at });
      const pSrv = plan.devices.find((d) => String(d.deviceId) === String(devSrv));
      check("deploy: the plan approves ready security patches per device", pSrv.patches.length === 2 && pSrv.patches.every((p) => p.decision === "approve") && pSrv.policyName === "Server ring");
      check("deploy: the plan holds back denied, deferred and unapproved patches", pSrv.blocked.length === 3 && pSrv.blocked.some((b) => b.id === "FEA1" && b.reason === "deferred") && pSrv.blocked.some((b) => b.id === "DRV1" && b.reason === "denied") && pSrv.blocked.some((b) => b.id === "WID1" && b.reason === "denied"), JSON.stringify(pSrv.blocked));
      check("deploy: the plan carries the pre-deployment compliance snapshot", !!pSrv.before && pSrv.before.compliant === false && pSrv.before.missingRequired === 2);
      check("deploy: the plan totals count ready devices, patches and held-back patches", plan.totals.devices === 3 && plan.totals.patches === 6 && plan.totals.blocked === 3 && plan.totals.reboots === 3, JSON.stringify(plan.totals));

      /* ── dry run then the real deployment ── */
      const dry = await PA.deploy(pid, { dryRun: true, at });
      check("deploy: a dry run plans without creating a job", dry.dryRun === true && dry.plan.devices.length === 3 && (await PA.deployments(pid)).length === 0);
      const dep = await PA.deploy(pid, { at });
      const depId = dep.deployment.id;
      check("deploy: a deployment creates one agent job per ready device", dep.ok === true && Object.keys(dep.deployment.targets).length === 3 && dep.jobs.length === 3 && Object.keys(dep.deployment.targets).every((k) => !!dep.deployment.targets[k].jobId));
      check("deploy: every target starts running with pending patches", dep.ok && dep.deployment.state === "running" && Object.keys(dep.deployment.targets).every((k) => { const t = dep.deployment.targets[k]; return t.state === "running" && t.patches.every((p) => p.state === "pending"); }));
      const j0 = await J.get(pid, dep.deployment.targets[String(devSrv)].jobId);
      check("deploy: the queued job is tagged with the deployment source", j0.job.language === "powershell" && String(j0.job.source || "").indexOf("patch-deploy:" + depId) === 0, JSON.stringify({ lang: j0.job.language, src: j0.job.source }));
      check("deploy: deployment reads return the run", (await PA.deployments(pid)).length === 1 && (await PA.deployment(pid, depId)).id === depId);

      /* ── reconcile real job results ── */
      await runJob(devSrv, "PATCHRESULT KB7001 ok\nPATCHRESULT KB7002 ok\n", 0);
      await runJob(devDesk, "PATCHRESULT KB7101 ok\nPATCHRESULT KB7102 failed install timeout\n", 1);
      await runJob(devLin, "PATCHRESULT USN-8001-1 ok\nPATCHRESULT USN-8002-1 failed dependency conflict\n", 1);
      const rec = await PA.reconcileDeployment(pid, depId, { at });
      const tSrv = rec.deployment.targets[String(devSrv)];
      const tDesk = rec.deployment.targets[String(devDesk)];
      check("deploy: reconcile attributes installed and failed patches", rec.ok === true && tSrv.state === "succeeded" && tSrv.patches.every((p) => p.state === "installed") && tDesk.state === "partial" && tDesk.patches.find((p) => p.id === "KB7102").state === "failed" && /timeout/.test(tDesk.patches.find((p) => p.id === "KB7102").error));
      check("deploy: reconcile captures before/after compliance per device", tSrv.before && tSrv.before.missingRequired === 2 && tSrv.after && tSrv.after.compliant === true && tDesk.after && tDesk.after.compliant === false && tDesk.after.missingRequired === 1, JSON.stringify({ b: tSrv.before, a: tSrv.after }));
      check("deploy: a same-instant reconcile does not trip the retry backoff", arr(rec.retried).length === 0 && tDesk.attempts === 1);
      check("deploy: the deployment summary folds the run state", rec.deployment.summary.installed === 4 && rec.deployment.summary.failed === 2 && rec.deployment.summary.state === "partial", JSON.stringify(rec.deployment.summary));

      /* ── reboot queue per policy ── */
      const reboots = await PA.reboots(pid);
      const rbSrv = reboots.find((r) => String(r.deviceId) === String(devSrv));
      const rbDesk = reboots.find((r) => String(r.deviceId) === String(devDesk));
      const rbLin = reboots.find((r) => String(r.deviceId) === String(devLin));
      check("deploy: one reboot is queued per device that installed a reboot-requiring patch", reboots.length === 3, JSON.stringify(reboots.map((r) => ({ d: r.deviceId, s: r.state, p: r.policy }))));
      check("deploy: an 'in-window' policy without an active window stays pending", !!rbSrv && rbSrv.state === "pending" && rbSrv.policy === "in-window" && rbSrv.dueAt === "");
      check("deploy: a 'never' reboot policy skips the reboot", !!rbDesk && rbDesk.state === "skipped" && rbDesk.policy === "never", JSON.stringify(rbDesk));
      check("deploy: an 'if-required' policy queues a reboot with a grace deadline", !!rbLin && rbLin.state === "pending" && rbLin.policy === "if-required" && rbLin.dueAt === iso(T0 + 30 * MIN), JSON.stringify(rbLin));

      /* ── automatic retry (forced) ── */
      const recForce = await PA.reconcileDeployment(pid, depId, { at, force: true });
      const rDesk = recForce.deployment.targets[String(devDesk)];
      check("deploy: a forced reconcile retries the failed devices", recForce.ok === true && arr(recForce.retried).length === 2 && arr(recForce.retried).some((r) => String(r.deviceId) === String(devDesk)));
      check("deploy: a retried patch returns to pending with the attempt counted", rDesk.patches.find((p) => p.id === "KB7102").state === "pending" && rDesk.attempts === 2 && rDesk.state === "running");

      /* ── finish the retries ── */
      await runJob(devDesk, "PATCHRESULT KB7102 ok\n", 0);
      await runJob(devLin, "PATCHRESULT USN-8002-1 failed still broken\n", 1);
      const rec3 = await PA.reconcileDeployment(pid, depId, { at });
      const tDesk3 = rec3.deployment.targets[String(devDesk)];
      const tLin3 = rec3.deployment.targets[String(devLin)];
      check("deploy: a successful retry completes the device", tDesk3.state === "succeeded" && tDesk3.patches.every((p) => p.state === "installed"));
      check("deploy: a device that keeps failing settles as partial without a third attempt", tLin3.state === "partial" && tLin3.patches.find((p) => p.id === "USN-8002-1").state === "failed" && tLin3.attempts === 2);
      const latest = await PA.deployment(pid, depId);
      check("deploy: summarizeDeployment folds a run into counts", latest.state === "partial" && latest.summary.patches === 6 && latest.summary.installed === 5 && latest.summary.failed === 1 && latest.summary.state === "partial", JSON.stringify(latest.summary));

      /* ── reboot lifecycle ── */
      const sched = await PA.scheduleReboot(pid, devLin, { at, dueAt: iso(T0 + 10 * MIN) });
      check("deploy: a pending reboot can be scheduled", sched.ok === true && (await PA.reboots(pid)).find((r) => String(r.deviceId) === String(devLin)).state === "scheduled");
      const perf = await PA.performReboot(pid, devLin, { at });
      const perfRec = (await PA.reboots(pid)).find((r) => String(r.deviceId) === String(devLin));
      check("deploy: dispatching a reboot queues a job and marks it rebooting", perf.ok === true && perfRec.state === "rebooting" && !!perfRec.jobId);
      const done = await PA.completeReboot(pid, devLin, { at });
      check("deploy: completing a reboot records it done", done.ok === true && (await PA.reboots(pid)).find((r) => String(r.deviceId) === String(devLin)).state === "done");
      await PA.skipReboot(pid, devSrv, { at });
      check("deploy: a queued reboot can be skipped", (await PA.reboots(pid)).find((r) => String(r.deviceId) === String(devSrv)).state === "skipped");

      /* ── reconcileAll ── */
      const allSkip = await PA.reconcileAll(pid, { at });
      check("deploy: reconcileAll skips terminal runs by default", allSkip.reconciled === 0, JSON.stringify(allSkip.results));
      const all = await PA.reconcileAll(pid, { at, recheck: true });
      check("deploy: reconcileAll re-checks a terminal run on request", all.reconciled === 1 && all.results[0].id === depId);

      /* ── the auditable compliance report ── */
      const rep = await PA.complianceReport(pid, { at });
      check("deploy: the compliance report summarises the window", rep.kind === "patchcompliance" && rep.devices.length === 3 && rep.totals.deployedPatches === 6 && rep.totals.installed === 5 && rep.totals.failed === 1, JSON.stringify(rep.totals));
      const repSrv = rep.devices.find((d) => String(d.deviceId) === String(devSrv));
      check("deploy: the report captures before/after and per-device patch totals", !!repSrv && repSrv.before && repSrv.before.compliant === false && repSrv.after && repSrv.after.compliant === true && repSrv.installed === 2 && repSrv.failed === 0);
      check("deploy: the report carries the patch audit trail", arr(rep.audit).length >= 3 && rep.audit.some((e) => e.action === "patch_deploy") && rep.audit.some((e) => String(e.action).indexOf("patch_reboot") === 0));
      const json = PA.exportReport(rep);
      check("deploy: the report exports as JSON", typeof json === "string" && JSON.parse(json).kind === "patchcompliance");
      const html = PA.renderReport(rep);
      check("deploy: the report renders a per-device table and the audit trail", /rmm-patch-report/.test(html) && html.indexOf("Per-device compliance") !== -1 && html.indexOf("Audit trail") !== -1);

      check("deploy: every canonical file stays in the rmm namespace", Object.keys(srv.files).every((n) => n.indexOf("rmm-v1-") === 0));

      /* ── the rendered deployment console ── */
      const host = document.createElement("div");
      document.body.appendChild(host);
      await PA.renderInto(host, { providerId: pid, providers: [{ id: pid, name: "Test provider" }], toast() {} });
      check("deploy: the console renders four tabs including deployment & audit", !!host.querySelector(".rmm-patch-inner") && host.querySelectorAll("[data-tab]").length === 4 && !!host.querySelector('[data-tab="deploy"]'));
      const dtab = host.querySelector('[data-tab="deploy"]');
      if (dtab) dtab.click();
      await new Promise((r) => setTimeout(r, 800));
      check("deploy: the deployment tab renders the plan, runs, reboot queue and summary", !!host.querySelector('[data-act="pa-deploy-run"]') && host.textContent.indexOf("Ready to deploy") !== -1 && host.textContent.indexOf("Deployments") !== -1 && host.textContent.indexOf("Reboot queue") !== -1 && host.querySelectorAll(".rmm-tri-metrics .erp-stat").length >= 6);
      const genBtn = host.querySelector('[data-act="pa-report-gen"]');
      if (genBtn) genBtn.click();
      await new Promise((r) => setTimeout(r, 800));
      check("deploy: generating the report renders it in the console", !!host.querySelector(".rmm-patch-report") && host.textContent.indexOf("Compliance report") !== -1);
      host.remove();
    } catch (e) {
      check("deploy: harness did not crash", false, (e && (e.message + " | " + e.stack)) || String(e));
    } finally {
      try { store.useBackend(null); } catch (e) {}
      try { store.resetAllLocal(); } catch (e) {}
      try { T.reload(); } catch (e) {}
      try { ERP.role = prevRole; } catch (e) {}
      try { await M.seed(); } catch (e) {}
    }
    const passed = results.filter((r) => r.ok).length;
    const failed = results.length - passed;
    return { passed, failed, results };
  };

  /* ============================================================
     RMM software catalog, deployment & licensing (Phase 7 · Tasks 31–33)

     Covers: version comparison, command-template rendering and
     parameter validation (required / typed / selects / unknown
     keys), inventory-based detection (successive version picking,
     ANY/ALL rules, version operators, present/absent), action
     resolution (install / update / reinstall / uninstall /
     rollback / downgrade / already-current skip), the per-OS
     deployment scripts (Windows PowerShell + Linux/macOS bash) with
     checksum verification + SWSRESULT parsing, package CRUD and the
     package editor (variants only saved for OS with real content,
     add/remove rule rows do not stack handlers), planning that
     skips already-installed / already-current targets, an assigned
     scope, deployment to agent jobs, reconciliation of real agent
     results into installed / failed attribution, failure retry with
     a fresh job, the per-device audit trail, assignment compliance,
     device rows, and licence reconciliation (over-deployment,
     expiry, unused, unsanctioned software) with an exportable
     inventory/licence report and the rendered console.
     ============================================================ */
  window.RMMSoftwareTest = async function (opts) {
    opts = opts || {};
    results.length = 0;
    const ERP = window.ERP;
    const store = ERP.store;
    const T = ERP.tenancy;
    const D = ERP.devices;
    const E = ERP.enrollment;
    const J = ERP.jobs;
    const M = ERP.masterConfig;
    const INV = ERP.rmmInventory;
    const SW = ERP.software;
    const uid = Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
    const STEP = 300;

    function makeServer() {
      const files = {};
      return {
        files,
        async get(name) { return Object.prototype.hasOwnProperty.call(files, name) ? files[name] : null; },
        async set(name, json) { const prev = files[name]; files[name] = json; return { created: prev === undefined, unchanged: prev === json, editKey: "k_" + name, superseded: false, error: null }; },
      };
    }
    if (!SW || !J || !E || !INV || !M) { check("software: ERP.software + jobs + enrollment + inventory exposed", false); return { passed: 0, failed: 1, results }; }
    const srv = makeServer();
    const arr = (v) => (Array.isArray(v) ? v : []);
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    let pid = null;
    const cred = {};
    let devWin = null, devLin = null, devMac = null;

    const runJob = async (deviceId, stdout, exitCode) => {
      const credential = cred[String(deviceId)];
      const c = await J.claim({ deviceId, credential });
      const job = (c.jobs || [])[0];
      if (!job) return { ok: false, error: "job_not_delivered" };
      return await J.result({ jobId: job.jobId, deviceId, credential, exitCode: exitCode == null ? 0 : exitCode, stdout: stdout || "", stderr: "" });
    };

    try {
      /* ── the API surface ── */
      check("software: the catalog + deployment + licensing API is exposed",
        ["normalizePackage", "validatePackage", "validateParameters", "renderTemplate", "variantFor", "supportsOs", "commandFor",
          "compareVersions", "ruleMatches", "matchItem", "findInstalled", "detectIn", "detectForDevice", "resolveAction", "planForDevice",
          "plan", "deployScript", "parseResultOutput", "parseDetectOutput", "deploy", "reconcileDeployment", "reconcileAll", "deployments",
          "assignmentRows", "deviceRows", "listLicenses", "addLicense", "coverage", "reconcile", "inventoryReport", "exportReport", "renderReport", "renderInto"].every((f) => typeof SW[f] === "function"),
        ["commandFor", "findInstalled", "deploy", "reconcile", "inventoryReport"].filter((f) => typeof SW[f] !== "function").join(","));

      /* ── version comparison ── */
      check("software: compareVersions orders dotted versions numerically",
        SW.compareVersions("1.10.0", "1.9.0") === 1 && SW.compareVersions("2.0", "2.0.0") === 0 && SW.compareVersions("1.0.0", "1.0.1") === -1 &&
        SW.compareVersions("126.0.6478.127", "126.0.6478.128") === -1);

      /* ── command templates + parameter validation ── */
      const rt = SW.renderTemplate("run {{installerPath}} /mode {{params.mode}}", { installerPath: "$rmmTarget", params: { mode: "quiet" } });
      check("software: renderTemplate expands placeholders and reports missing keys",
        rt.text === "run $rmmTarget /mode quiet" && rt.missing.length === 0 && SW.renderTemplate("x {{nope}}", {}).missing[0] === "nope");

      const pkgParams = SW.normalizePackage({
        name: "P", version: "1.0", installTemplate: "echo hi",
        parameters: [
          { name: "mode", label: "Mode", type: "select", required: true, options: ["quiet", "loud"] },
          { name: "retries", label: "Retries", type: "number", default: "3" },
        ],
      });
      check("software: validateParameters requires, types and rejects unknown keys",
        SW.validateParameters(pkgParams, {}).valid === false &&
        SW.validateParameters(pkgParams, { mode: "quiet" }).valid === true &&
        SW.validateParameters(pkgParams, { mode: "quiet", retries: "5" }).params.retries === 5 &&
        SW.validateParameters(pkgParams, { mode: "nope" }).valid === false &&
        SW.validateParameters(pkgParams, { mode: "quiet", bogus: "x" }).valid === false &&
        SW.validateParameters(pkgParams, { mode: "quiet", retries: "abc" }).valid === false);

      check("software: validatePackage rejects a nameless or command-less package",
        SW.validatePackage({ name: "", installTemplate: "" }).valid === false &&
        SW.validatePackage({ name: "Ok", installTemplate: "x" }).valid === true &&
        SW.validatePackage({ name: "S", installTemplate: "x", parameters: [{ name: "t", type: "select", options: [] }] }).valid === false);

      /* ── detection rules ── */
      const detAll = { match: "all", rules: [{ field: "name", op: "contains", value: "chrome" }, { field: "publisher", op: "contains", value: "google" }] };
      check("software: ALL detection rules match name + publisher case-insensitively",
        SW.matchItem(detAll, { name: "Google Chrome", publisher: "Google LLC" }) === true &&
        SW.matchItem(detAll, { name: "Google Chrome", publisher: "Mozilla" }) === false);
      const detAny = { match: "any", rules: [{ field: "name", op: "contains", value: "7-Zip" }, { field: "name", op: "contains", value: "VLC" }] };
      check("software: ANY detection matches on either rule",
        SW.matchItem(detAny, { name: "VLC media player" }) === true && SW.matchItem(detAny, { name: "Firefox" }) === false);
      check("software: version and string operators compare as declared",
        SW.ruleMatches({ version: "1.10.0" }, { field: "version", op: "gte", value: "1.9" }) === true &&
        SW.ruleMatches({ version: "1.2" }, { field: "version", op: "lt", value: "1.10" }) === true &&
        SW.ruleMatches({ name: "Chrome" }, { field: "name", op: "regex", value: "^chrom" }) === true &&
        SW.ruleMatches({ name: "" }, { field: "name", op: "absent" }) === true);

      const pkgChrome = SW.normalizePackage({
        name: "Google Chrome", version: "126.0", detection: { match: "any", rules: [{ field: "name", op: "contains", value: "Google Chrome" }] },
        variants: { windows: { install: "x" } },
      });
      const found = SW.findInstalled(pkgChrome, [{ name: "Google Chrome", version: "100.0" }, { name: "Google Chrome", version: "126.0" }, { name: "Firefox", version: "1" }], SW.variantFor(pkgChrome, "windows"));
      check("software: findInstalled picks the highest matching installed version", !!found && found.version === "126.0");

      /* ── action resolution ── */
      check("software: losing an older install resolves to update",
        SW.resolveAction(pkgChrome, { installed: true, version: "100.0" }, { action: "auto", targetVersion: "126.0" }).action === "update");
      check("software: an up-to-date install is skipped by default",
        SW.resolveAction(pkgChrome, { installed: true, version: "126.0" }, { action: "auto" }).state === "skip");
      check("software: a missing install resolves to install",
        SW.resolveAction(pkgChrome, { installed: false }, { action: "auto" }).action === "install");
      check("software: uninstall runs only when present", SW.resolveAction(pkgChrome, { installed: true, version: "1" }, { action: "uninstall" }).state === "run" && SW.resolveAction(pkgChrome, { installed: false }, { action: "uninstall" }).state === "skip");
      const pkgRoll = SW.normalizePackage({ name: "R", version: "2.0", previousVersion: "1.0", supportsRollback: true, installTemplate: "x" });
      check("software: rollback restores the previous version when allowed", SW.resolveAction(pkgRoll, { installed: true, version: "2.0" }, { action: "rollback" }).toVersion === "1.0");
      const pkgDown = SW.normalizePackage({ name: "D", version: "1.0", supportsDowngrade: true, installTemplate: "x" });
      check("software: downgrade runs only when the package allows it", SW.resolveAction(pkgDown, { installed: true, version: "2.0" }, { action: "downgrade", targetVersion: "1.0" }).state === "run" && SW.resolveAction(SW.normalizePackage({ name: "N", version: "1.0", installTemplate: "x" }), { installed: true, version: "2.0" }, { action: "downgrade", targetVersion: "1.0" }).state === "blocked");

      /* ── commandFor + deployment scripts ── */
      const pkgTool = SW.normalizePackage({ name: "Tool", version: "2.0", variants: { windows: { install: "start {{installerPath}} /v{{arguments}}", arguments: "/qn" }, linux: { install: "sh {{installerPath}}" } } });
      const cw = SW.commandFor(pkgTool, "windows", "install", {});
      const cl = SW.commandFor(pkgTool, "linux", "install", {});
      check("software: commandFor expands per-OS templates with the right language",
        cw.language === "powershell" && cw.script.indexOf("$rmmTarget") !== -1 && cw.script.indexOf("/qn") !== -1 &&
        cl.language === "bash" && cl.script.indexOf("$RMM_TARGET") !== -1);
      check("software: commandFor reports placeholders that could not be filled", arr(SW.commandFor(SW.normalizePackage({ name: "M", version: "1", variants: { windows: { install: "x {{source}} {{checksum}}" } } }), "windows", "install", {}).missing).length === 2);

      const wscript = SW.deployScript("windows", [{ packageId: "swpkg-p7", name: "7-Zip", action: "install", command: SW.commandFor(pkgTool, "windows", "install", {}) }], { deploymentId: "dep1", hostname: "PC-1" });
      check("software: the Windows deployment script verifies checksums and prints SWSRESULT",
        wscript.language === "powershell" && /Get-FileHash/.test(wscript.script) && /SWSRESULT/.test(wscript.script) && /swpkg-p7/.test(wscript.script));
      const lscript = SW.deployScript("linux", [{ packageId: "swpkg-p7", name: "7-Zip", action: "install", command: SW.commandFor(pkgTool, "linux", "install", {}) }], {});
      check("software: the Linux deployment script downloads with curl/wget and prints SWSRESULT",
        lscript.language === "bash" && /curl|wget/.test(lscript.script) && /SWSRESULT/.test(lscript.script));
      const parsed = SW.parseResultOutput("noise\nSWSRESULT swpkg-p7 ok\nSWSRESULT swpkg-p8 failed disk full\n");
      check("software: SWSRESULT lines parse into per-package states",
        parsed.length === 2 && parsed[0].ok === true && parsed[0].state === "installed" && parsed[1].ok === false && parsed[1].message === "disk full" && SW.parseResultOutput("nothing").length === 0);
      check("software: SWDETECT lines parse into agent detection results", SW.parseDetectOutput("SWDETECT swpkg-p7 installed 2.0")[0].installed === true);

      /* ── fixture ── */
      store.useBackend(srv);
      store.resetAllLocal();
      T.reload();
      await M.seed({ force: true });
      pid = (await T.create({ name: "Software " + uid })).provider.id;
      await T.addItem(pid, "sites", { id: "site-hq", name: "HQ" });
      await T.addItem(pid, "deviceGroups", { id: "grp-ws", name: "Workstations", kind: "static" });
      await T.addItem(pid, "deviceGroups", { id: "grp-srv", name: "Servers", kind: "static" });

      const enroll = async (hostname, osName) => {
        const t = await E.issueToken({ providerId: pid });
        const en = await E.enroll({ token: t.token, hostname, os: { name: osName } });
        cred[String(en.deviceId)] = en.credential;
        return en.deviceId;
      };
      devWin = await enroll("SW-WS1", "Windows 11");
      devLin = await enroll("SW-LNX1", "Ubuntu 22.04");
      devMac = await enroll("SW-MAC1", "macOS 14");
      await D.setSite(pid, devWin, "site-hq");
      await D.assignGroup(pid, devWin, "grp-ws");

      await INV.seedSnapshot(pid, devWin, { software: [
        { name: "7-Zip 24.09 (x64)", version: "24.09", publisher: "Igor Pavlov" },
        { name: "Google Chrome", version: "100.0.4896.127", publisher: "Google LLC" },
        { name: "Steam", version: "1.0.0", publisher: "Valve" },
      ] });
      await INV.seedSnapshot(pid, devLin, { software: [{ name: "Google Chrome", version: "126.0.6478.127", publisher: "Google LLC" }] });

      /* ── package CRUD ── */
      const p7 = await SW.addPackage(pid, {
        name: "7-Zip", vendor: "Igor Pavlov", categoryId: "sc-utility", version: "24.09", supportsDowngrade: true, supportsRollback: true,
        detection: { match: "any", rules: [{ field: "name", op: "contains", value: "7-Zip" }] },
        variants: { windows: { install: "Start-Process msiexec -ArgumentList '/i {{installerPath}} /qn'" }, linux: { install: "apt-get install -y p7zip-full" }, macos: { install: "brew install p7zip" } },
      });
      check("software: addPackage stores a normalised package with per-OS support",
        !!p7.package && p7.package.name === "7-Zip" && SW.OS_KEYS.every((k) => SW.supportsOs(p7.package, k)) && !!p7.package.variants.windows && !!p7.package.variants.linux && !!p7.package.variants.macos);
      const ch = await SW.addPackage(pid, {
        name: "Google Chrome", vendor: "Google", categoryId: "sc-browser", version: "126.0.6478.127", previousVersion: "100.0.4896.127",
        detection: { match: "any", rules: [{ field: "name", op: "contains", value: "Google Chrome" }] },
        variants: { windows: { install: "Start-Process msiexec -ArgumentList '/i {{installerPath}} /qn'" }, linux: { install: "dpkg -i {{installerPath}}" }, macos: { install: "installer -pkg {{installerPath}} -target /" } },
      });
      check("software: a second package is added and listed alphabetically",
        (await SW.listPackages(pid)).map((p) => p.name).join(",") === "7-Zip,Google Chrome");

      const dup = await SW.duplicatePackage(pid, p7.package.id);
      check("software: duplicatePackage clones under a new id", !!dup.package && dup.package.id !== p7.package.id && /copy/.test(dup.package.name));
      await SW.setPackageEnabled(pid, dup.package.id, false);
      check("software: setPackageEnabled toggles a package", (await SW.getPackage(pid, dup.package.id)).enabled === false);
      check("software: removePackage deletes it from the catalog", (await SW.removePackage(pid, dup.package.id)).removed === dup.package.id && !(await SW.getPackage(pid, dup.package.id)));

      /* ── planning with inventory detection ── */
      const plan7 = await SW.plan(pid, { packageId: p7.package.id, action: "auto", targets: { all: true } });
      const rw7 = plan7.devices.find((d) => String(d.deviceId) === String(devWin));
      const rl7 = plan7.devices.find((d) => String(d.deviceId) === String(devLin));
      const rm7 = plan7.devices.find((d) => String(d.deviceId) === String(devMac));
      check("software: the plan skips an up-to-date install read from the inventory",
        !!rw7 && rw7.items.length === 0 && rw7.skipped.length === 1 && /already/.test(rw7.skipped[0].reason));
      check("software: the plan installs where the package is absent",
        !!rl7 && rl7.items.length === 1 && rl7.items[0].action === "install" && !!rm7 && rm7.items.length === 1 && rm7.items[0].action === "install");
      check("software: the plan totals count ready and skipped work",
        plan7.totals.items === 2 && plan7.totals.skipped === 1 && plan7.totals.withWork === 2, JSON.stringify(plan7.totals));

      const planC = await SW.plan(pid, { packageId: ch.package.id, action: "auto", targets: { all: true } });
      const cw2 = planC.devices.find((d) => String(d.deviceId) === String(devWin));
      const cl2 = planC.devices.find((d) => String(d.deviceId) === String(devLin));
      const cm2 = planC.devices.find((d) => String(d.deviceId) === String(devMac));
      check("software: an older install resolves to an update with from/to versions",
        !!cw2 && cw2.items.length === 1 && cw2.items[0].action === "update" && cw2.items[0].fromVersion === "100.0.4896.127" && cw2.items[0].toVersion === "126.0.6478.127");
      check("software: an install already at the target version is skipped", !!cl2 && cl2.items.length === 0 && cl2.skipped.length === 1);
      check("software: a device without the package installs it", !!cm2 && cm2.items.length === 1 && cm2.items[0].action === "install");

      /* ── assignment ── */
      const asg = await SW.assignPackage(pid, ch.package.id, { targets: { groupIds: ["grp-ws"] }, action: "install", enforcement: "skip-installed" });
      check("software: assignPackage attaches a scoped assignment", asg.ok === true && arr(asg.assignment.targets.groupIds)[0] === "grp-ws");
      const arows = await SW.assignmentRows(pid);
      const arow = asg.ok ? arows.rows.find((r) => String(r.assignmentId) === String(asg.assignment.id)) : null;
      check("software: assignmentRows scope to the group and count compliance", !!arow && arow.devices === 1 && arow.installed === 1 && arow.missing === 0 && arow.compliant === true, JSON.stringify(arow));

      /* ── deployment + reconciliation ── */
      const dry = await SW.deploy(pid, { dryRun: true, plan: planC });
      check("software: a dry run returns the plan without enqueueing jobs", dry.dryRun === true && arr(dry.plan.devices).length === 2);

      const dep = await SW.deploy(pid, { plan: planC, name: "Chrome rollout", createdBy: "test" });
      check("software: deploy enqueues one agent job per device with work", dep.ok === true && dep.jobs.length === 2 && Object.keys(dep.deployment.targets).length === 2, JSON.stringify(dep.error || dep));
      const depId = dep.deployment ? dep.deployment.id : null;

      const jr = await runJob(devWin, "SWSRESULT " + ch.package.id + " ok");
      check("software: the deployed agent job runs and reports success", jr.ok === true && jr.deviceState === "succeeded");

      const failRes = { [String(devMac)]: { state: "failed", stdout: "", error: "installer crashed", exitCode: 1603 } };
      const rec1 = await SW.reconcileDeployment(pid, depId, { results: failRes });
      const tWin = rec1.deployment.targets[String(devWin)], tMac = rec1.deployment.targets[String(devMac)];
      check("software: reconciliation attributes success and failure per device", tWin.state === "succeeded" && tMac.state === "failed" && rec1.deployment.state === "partial");
      const macPkg = arr(tMac.packages).find((p) => String(p.packageId) === String(ch.package.id));
      check("software: a failed package action records its error", !!macPkg && macPkg.state === "failed" && /installer crashed/.test(macPkg.error));

      const rec2 = await SW.reconcileDeployment(pid, depId, { force: true, results: failRes });
      check("software: a failed action is retried with a fresh job", arr(rec2.retried).length === 1 && !!arr(rec2.retried)[0].jobId && arr(rec2.deployment.targets[String(devMac)].packages).find((p) => String(p.packageId) === String(ch.package.id)).state === "pending");

      const rec3 = await SW.reconcileDeployment(pid, depId, { force: true, results: { [String(devMac)]: { state: "succeeded", stdout: "SWSRESULT " + ch.package.id + " ok" } } });
      check("software: the retry succeeds and the run becomes succeeded", rec3.deployment.state === "succeeded" && arr(rec3.deployment.targets[String(devMac)].packages).find((p) => String(p.packageId) === String(ch.package.id)).state === "installed");

      const alog = await ERP.master.auditLog({ all: true });
      check("software: deployment actions are audited on the device trail",
        alog.some((e) => e.action === "software_deploy") && alog.some((e) => e.targetType === "device" && String(e.targetId) === String(devWin) && String(e.action).indexOf("software_") === 0));
      check("software: the deployment history lists the run", (await SW.deployments(pid))[0].id === depId);

      const dr = await SW.deviceRows(pid, {});
      const wr = dr.rows.find((r) => String(r.deviceId) === String(devWin));
      check("software: deviceRows report catalogued install state and deployment status",
        !!wr && wr.installedCount === 2 && wr.missingCount === 0 && wr.failed === 0 && wr.deployState === "succeeded", JSON.stringify(wr));

      /* ── licences + reconciliation ── */
      const lic = await SW.addLicense(pid, { title: "Google Chrome", vendor: "Google", packageId: ch.package.id, metric: "per-device", seats: 1, expiresAt: "2020-01-01T00:00:00Z" });
      await SW.addLicense(pid, { title: "7-Zip", packageId: p7.package.id, metric: "per-device", seats: 100 });
      check("software: addLicense stores a normalised licence", !!lic.license && lic.license.title === "Google Chrome");

      const recon = await SW.reconcile(pid);
      const chromeLic = recon.licenses.find((l) => l.title === "Google Chrome");
      check("software: licence reconciliation flags over-deployment and expiry",
        !!chromeLic && chromeLic.used === 2 && chromeLic.seats === 1 && chromeLic.over === true && chromeLic.expired === true && chromeLic.status === "expired");
      check("software: an unused-but-owned licence stays OK", (recon.licenses.find((l) => l.title === "7-Zip") || {}).status === "ok");
      check("software: uncatalogued software is flagged as unsanctioned",
        recon.totals.unsanctioned >= 1 && recon.unsanctioned.some((u) => /Steam/.test(u.name)));

      const rep = await SW.inventoryReport(pid);
      check("software: the inventory report summarises the client",
        rep.kind === "softwareinventory" && rep.totals.titles >= 3 && rep.totals.unsanctioned >= 1 && arr(rep.devices).length === 3);
      const json = SW.exportReport(recon);
      check("software: the reconciliation report exports as JSON", typeof json === "string" && JSON.parse(json).kind === "softwarelicense");
      const html = SW.renderReport(rep);
      check("software: the report renders licence, package and unsanctioned tables",
        /rmm-software-report/.test(html) && html.indexOf("Unsanctioned software") !== -1 && html.indexOf("Installed software") !== -1 && html.indexOf("Catalogued packages") !== -1);

      /* ── the rendered console ── */
      const host = document.createElement("div");
      document.body.appendChild(host);
      await SW.renderInto(host, { providerId: pid, providers: [{ id: pid, name: "Test provider" }], toast() {} });
      check("software: the console renders four tabs incl. catalog, deployment and licences",
        !!host.querySelector(".rmm-software-inner") && host.querySelectorAll("[data-tab]").length === 4 && !!host.querySelector('[data-tab="licenses"]'));

      const dTab = host.querySelector('[data-tab="deploy"]');
      if (dTab) dTab.click();
      await wait(STEP * 3);
      check("software: the deployment tab renders the picker, plan and run history",
        !!host.querySelector('[name="sw_pick"]') && !!host.querySelector('[data-act="sw-plan"]') && host.textContent.indexOf("Deployment plan") !== -1 && host.textContent.indexOf("Deployments") !== -1);
      const lTab = host.querySelector('[data-tab="licenses"]');
      if (lTab) lTab.click();
      await wait(STEP * 3);
      check("software: the licence tab renders the reconciliation control", !!host.querySelector('[data-act="sw-recon"]') && host.textContent.indexOf("Licences") !== -1);

      /* ── the package editor ── */
      const catTab = host.querySelector('[data-tab="catalog"]');
      if (catTab) catTab.click();
      await wait(STEP * 3);
      const newBtn = host.querySelector('[data-act="sw-pkg-new"]');
      if (newBtn) newBtn.click();
      await wait(STEP);
      const modal = document.querySelector("#uiModal");
      const addRule = modal && modal.querySelector('[data-act="sw-det-add"]');
      if (addRule) { addRule.click(); await wait(120); }
      const addRule2 = modal && modal.querySelector('[data-act="sw-det-add"]');
      if (addRule2) { addRule2.click(); await wait(120); }
      const rowsShown = modal ? modal.querySelectorAll("[data-det-rule]").length : 0;
      check("software: the package editor adds detection rows without stacking handlers", rowsShown === 2, "rows=" + rowsShown);

      const nameInput = modal && modal.querySelector('[name="p_name"]');
      if (nameInput) nameInput.value = "Editor Package";
      const winInstall = modal && modal.querySelector('[name="windows_install"]');
      if (winInstall) winInstall.value = "echo hello";
      const saveBtn = modal && modal.querySelector('[data-act="sw-pkg-save"]');
      if (saveBtn) saveBtn.click();
      await wait(STEP * 3);
      const saved = (await SW.listPackages(pid)).find((p) => p.name === "Editor Package");
      check("software: the package editor saves and keeps only OS variants with content",
        !!saved && Object.keys(saved.variants).length === 1 && !!saved.variants.windows && !saved.variants.linux && !saved.variants.macos, JSON.stringify(saved && Object.keys(saved.variants)));
      host.remove();
    } catch (e) {
      check("software: harness did not crash", false, (e && (e.message + " | " + e.stack)) || String(e));
    } finally {
      try { store.useBackend(null); } catch (e) {}
      try { store.resetAllLocal(); } catch (e) {}
      try { T.reload(); } catch (e) {}
      try { await M.seed(); } catch (e) {}
    }
    const passed = results.filter((r) => r.ok).length;
    const failed = results.length - passed;
    return { passed, failed, results };
  };

  window.RMMSecurityTest = async function (opts) {
    opts = opts || {};
    results.length = 0;
    const ERP = window.ERP;
    const store = ERP.store;
    const T = ERP.tenancy;
    const D = ERP.devices;
    const E = ERP.enrollment;
    const M = ERP.masterConfig;
    const INV = ERP.rmmInventory;
    const AL = ERP.alerts;
    const AUTO = ERP.automations;
    const SEC = ERP.security;
    const uid = Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
    const STEP = 300;

    function makeServer() {
      const files = {};
      return {
        files,
        async get(name) { return Object.prototype.hasOwnProperty.call(files, name) ? files[name] : null; },
        async set(name, json) { const prev = files[name]; files[name] = json; return { created: prev === undefined, unchanged: prev === json, editKey: "k_" + name, superseded: false, error: null }; },
      };
    }
    if (!SEC || !INV || !E || !M || !AL || !AUTO) { check("security: ERP.security + inventory + enrollment + alerts exposed", false); return { passed: 0, failed: 1, results }; }
    const srv = makeServer();
    const arr = (v) => (Array.isArray(v) ? v : []);
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    let pid = null;
    const cred = {};
    let devWin = null, devLin = null, devMac = null;
    const fixHours = (h) => new Date(Date.now() - h * 3600000).toISOString();
    const winInv = (admins) => ({
      users: (admins || ["alice"]).map((n) => ({ name: n, admin: true })).concat([{ name: "bob", admin: false }]),
      services: [{ name: "wuauserv", displayName: "Windows Update", state: "running" }],
      security: {
        antivirus: [{ name: "Microsoft Defender Antivirus", enabled: true, upToDate: true }],
        firewall: { enabled: true, profiles: [] },
        encryption: { systemDrive: true, method: "BitLocker", percentEncrypted: 100 },
        defender: { realtimeEnabled: true, signatureAgeDays: 1, tamperProtection: true },
        secureBoot: true, tpm: { present: true, version: "2.0", enabled: true }, pendingReboot: false,
      },
      backup: { status: "ok", lastRunAt: "2024-02-25T02:00:00Z", lastResult: "Success", provider: "Veeam Agent" },
    });

    try {
      /* ── the API surface ── */
      check("security: the posture + baseline + backup API is exposed",
        ["evaluateCheck", "evaluateDevice", "scan", "postureRows", "postureFor", "rollup", "normalizeBaseline", "effectiveBaseline",
          "addBaseline", "updateBaseline", "removeBaseline", "driftFor", "compliance", "driftHistory", "acceptDeviation", "clearDeviation",
          "remediate", "remediationOptions", "normalizeBackupExpectation", "addExpectation", "reportBackup", "backupRows", "scanBackups",
          "ingestBackups", "requestRecoveryTest", "confirmRecoveryTest", "recoveryTests", "deviceSection", "renderInto"].every((f) => typeof SEC[f] === "function"),
        ["addBaseline", "driftFor", "reportBackup", "remediate"].filter((f) => typeof SEC[f] !== "function").join(","));

      /* ── the check catalogue ── */
      check("security: the check catalogue covers every baseline item",
        SEC.CHECK_CATALOGUE.length >= 12 && ["av-present", "av-up-to-date", "firewall-enabled", "disk-encryption", "secure-boot", "tpm", "os-patch-currency", "local-admins"].every((id) => SEC.CHECK_IDS.indexOf(id) !== -1),
        SEC.CHECK_IDS.join(","));
      check("security: the default check set and categories resolve",
        SEC.DEFAULT_CHECKS().length >= 10 && SEC.DEFAULT_CHECKS().indexOf("encryption-percent") === -1 && SEC.categoryLabel("antimalware") === "Anti-malware");

      /* ── pure check evaluation ── */
      const ctxWin = {
        collected: true,
        device: { os: { family: "Windows" } },
        sections: {
          security: {
            antivirus: [{ name: "Defender", enabled: true, upToDate: true }], firewall: { enabled: true, profiles: [] },
            encryption: { systemDrive: true, method: "BitLocker", percentEncrypted: 100 },
            defender: { realtimeEnabled: true, signatureAgeDays: 1 }, secureBoot: true, tpm: { present: true, version: "2.0", enabled: true }, pendingReboot: false,
          },
          services: [{ name: "wuauserv", state: "running" }], users: [{ name: "alice", admin: true }],
        },
        admins: ["alice"],
      };
      check("security: a fully protected windows device passes every applicable check",
        ["av-present", "av-up-to-date", "av-realtime", "defender-signature-age", "firewall-enabled", "disk-encryption", "secure-boot", "tpm", "pending-reboot"].every((id) => SEC.evaluateCheck(id, ctxWin).state === "pass"),
        ["av-present", "av-up-to-date", "av-realtime", "defender-signature-age", "firewall-enabled", "disk-encryption", "secure-boot", "tpm", "pending-reboot"].filter((id) => SEC.evaluateCheck(id, ctxWin).state !== "pass").join(","));

      const ctxBad = {
        collected: true, device: { os: { family: "Linux" } },
        sections: { security: { antivirus: [{ name: "ClamAV", enabled: false, upToDate: false }], firewall: { enabled: false }, encryption: { systemDrive: false, method: "None", percentEncrypted: 0 }, secureBoot: false, tpm: { present: false }, pendingReboot: true }, services: [], users: [] },
        admins: [],
      };
      check("security: missing anti-malware, firewall, encryption and TPM are failures",
        SEC.evaluateCheck("av-present", ctxBad).state === "fail" && SEC.evaluateCheck("firewall-enabled", ctxBad).state === "fail" &&
        SEC.evaluateCheck("disk-encryption", ctxBad).state === "fail" && SEC.evaluateCheck("secure-boot", ctxBad).state === "fail" &&
        SEC.evaluateCheck("tpm", ctxBad).state === "fail" && SEC.evaluateCheck("pending-reboot", ctxBad).state === "warn");
      check("security: an out-of-date product fails the currency check",
        SEC.evaluateCheck("av-up-to-date", { collected: true, device: { os: { family: "Linux" } }, sections: { security: { antivirus: [{ name: "ClamAV", enabled: true, upToDate: false }] } } }).state === "fail");
      check("security: a platform-specific check is N/A and missing inventory is unknown",
        SEC.evaluateCheck("av-realtime", { collected: true, device: { os: { family: "macOS" } }, sections: { security: { defender: { realtimeEnabled: true } } } }).state === "na" &&
        SEC.evaluateCheck("av-present", { collected: false, device: { os: { family: "Windows" } }, sections: {} }).state === "unknown");
      check("security: the service check honours a configured service name",
        SEC.evaluateCheck({ id: "service-running", params: { serviceName: "wuauserv" } }, ctxWin).state === "pass" &&
        SEC.evaluateCheck({ id: "service-running", params: { serviceName: "nginx.service" } }, ctxWin).state === "warn" &&
        SEC.evaluateCheck("service-running", ctxWin).state === "na");
      check("security: a new local administrator is detected against the last scan",
        SEC.evaluateCheck("local-admins", { collected: true, device: { os: { family: "Windows" } }, sections: { users: [{ name: "alice", admin: true }] }, admins: ["alice"] }).state === "pass" &&
        SEC.evaluateCheck("local-admins", { collected: true, device: { os: { family: "Windows" } }, sections: { users: [{ name: "alice", admin: true }, { name: "carol", admin: true }] }, admins: ["alice", "carol"], prev: { admins: ["alice"] } }).state === "fail");
      check("security: countStates + postureState rank failures first",
        SEC.countStates([{ state: "fail" }, { state: "pass" }, { state: "pass" }]).fail === 1 &&
        SEC.postureState({ fail: 1, pass: 9, warn: 0 }) === "fail" && SEC.postureState({ fail: 0, pass: 0, warn: 0 }) === "unknown");

      /* ── fixture ── */
      store.useBackend(srv);
      store.resetAllLocal();
      T.reload();
      await M.seed({ force: true });
      pid = (await T.create({ name: "Security " + uid })).provider.id;
      await T.addItem(pid, "sites", { id: "site-hq", name: "HQ" });
      await T.addItem(pid, "deviceGroups", { id: "grp-ws", name: "Workstations", kind: "static" });
      await T.addItem(pid, "deviceGroups", { id: "grp-srv", name: "Servers", kind: "static" });
      const enroll = async (hostname, family) => {
        const t = await E.issueToken({ providerId: pid });
        const en = await E.enroll({ token: t.token, hostname, os: { name: family } });
        cred[String(en.deviceId)] = en.credential;
        await D.update(pid, en.deviceId, { os: { family } });
        return en.deviceId;
      };
      devWin = await enroll("SEC-WS1", "Windows");
      devLin = await enroll("SEC-LNX1", "Linux");
      devMac = await enroll("SEC-MAC1", "macOS");
      await D.setSite(pid, devWin, "site-hq");
      await D.assignGroup(pid, devWin, "grp-ws");
      await INV.seedSnapshot(pid, devWin, winInv(["alice"]));
      await INV.seedSnapshot(pid, devLin, { users: [{ name: "root", admin: true }], security: { antivirus: [{ name: "ClamAV", enabled: true, upToDate: false }], firewall: { enabled: false }, encryption: { systemDrive: true, method: "LUKS", percentEncrypted: 100 }, secureBoot: false, tpm: { present: false }, pendingReboot: true } });
      await INV.seedSnapshot(pid, devMac, { users: [{ name: "admin", admin: true }], security: { antivirus: [], firewall: { enabled: true }, encryption: { systemDrive: false }, secureBoot: true, tpm: { present: false }, pendingReboot: false } });

      /* ── posture scan ── */
      const scan = await SEC.scan(pid, { alerts: false });
      check("security: a scan evaluates every device and records a run",
        scan.ok === true && scan.devices === 3 && arr(scan.results).length === 3 && !!scan.scanId, JSON.stringify(scan.error || scan));
      const winP = scan.results.find((r) => String(r.deviceId) === String(devWin));
      check("security: a hardened windows device scans clean", !!winP && winP.state === "pass" && winP.counts.fail === 0, JSON.stringify(winP && winP.counts));
      const linP = scan.results.find((r) => String(r.deviceId) === String(devLin));
      check("security: the linux device's firewall failure is found with its exact check",
        !!linP && linP.findings.some((f) => f.checkId === "firewall-enabled" && f.state === "fail"));
      check("security: the mac's outdated-definition failure is found",
        !!scan.results.find((r) => String(r.deviceId) === String(devMac)).findings.some((f) => f.checkId === "av-up-to-date" && f.state === "fail"));

      const stored = await SEC.storedPosture(pid, devWin);
      check("security: the scan stores posture with the administrator baseline",
        !!stored.deviceId && arr(stored.findings).length > 0 && arr(stored.admins).indexOf("alice") !== -1, JSON.stringify(stored));
      const rows = await SEC.postureRows(pid, {});
      check("security: posture rows summarise the client worst-first",
        rows.rows.length === 3 && rows.rows[0].state === "fail" && rows.summary.fail >= 1 && rows.summary.devices === 3, JSON.stringify(rows.summary));
      const ru = await SEC.rollup(pid, { by: "group" });
      check("security: the rollup buckets devices by group", ru.rows.some((r) => r.key === "grp-ws" && r.devices === 1));

      /* ── baselines ── */
      const base = await SEC.addBaseline(pid, { name: "All devices", priority: 0, checks: ["firewall-enabled", "local-admins"], targets: {} });
      check("security: addBaseline normalises and stores a baseline", !!base.baseline && base.baseline.checks.length === 2 && base.baseline.kind === "securitybaseline", JSON.stringify(base.error || base.errors));
      const wsBase = await SEC.addBaseline(pid, { name: "Workstations", priority: 10, checks: ["av-present", "av-up-to-date", "firewall-enabled", "disk-encryption", "local-admins"], targets: { groupIds: ["grp-ws"] } });
      check("security: a group-targeted baseline is stored", !!wsBase.baseline);
      check("security: validateBaseline rejects an unknown check", SEC.validateBaseline({ name: "x", checks: ["nope"] }).valid === false && SEC.validateBaseline({ name: "x", checks: ["firewall-enabled"] }).valid === true);
      const bl = await SEC.baselines(pid);
      check("security: baselines are ordered by priority", bl[0].id === wsBase.baseline.id);

      let prov = (await T.get(pid)).provider;
      const winDev = prov.devices.map(D.normalizeDevice).find((d) => String(d.id) === String(devWin));
      const linDev = prov.devices.map(D.normalizeDevice).find((d) => String(d.id) === String(devLin));
      const effWin = SEC.effectiveBaseline(prov, winDev, {});
      check("security: the group baseline beats the provider-wide baseline", effWin.baseline.id === wsBase.baseline.id && effWin.matchedBy === "group", JSON.stringify(effWin && effWin.matchedBy));
      const effLin = SEC.effectiveBaseline(prov, linDev, {});
      check("security: an untargeted device falls back to the provider-wide baseline", effLin.baseline.id === base.baseline.id);
      await SEC.updateBaseline(pid, wsBase.baseline.id, { priority: 1 });
      const pin = await SEC.addBaseline(pid, { name: "Pin WS1", priority: 5, checks: ["firewall-enabled"], targets: { deviceIds: [devWin] } });
      prov = (await T.get(pid)).provider;
      const effPin = SEC.effectiveBaseline(prov, prov.devices.map(D.normalizeDevice).find((d) => String(d.id) === String(devWin)), {});
      check("security: a higher priority beats a more specific target", effPin.baseline.id === pin.baseline.id, JSON.stringify(effPin && effPin.baseline.id));
      await SEC.removeBaseline(pid, pin.baseline.id);
      await SEC.updateBaseline(pid, wsBase.baseline.id, { priority: 10 });

      /* ── drift ── */
      const driftWin = await SEC.driftFor(pid, devWin, {});
      check("security: a compliant device reports no failing checks", driftWin.compliant === true && driftWin.failing.length === 0 && driftWin.baseline.id === wsBase.baseline.id, JSON.stringify(driftWin.failing));
      const driftLin = await SEC.driftFor(pid, devLin, {});
      check("security: drift reports the exact failing check", driftLin.compliant === false && driftLin.failing.some((f) => f.checkId === "firewall-enabled"));
      const comp = await SEC.compliance(pid, {});
      check("security: compliance summarises per device with failing checks",
        comp.summary.devices === 3 && comp.summary.nonCompliant >= 1 && comp.rows.some((r) => String(r.deviceId) === String(devLin) && !r.compliant));
      const hist = await SEC.driftHistory(pid, devLin, {});
      check("security: drift history records the run", arr(hist).length >= 1 && arr(hist[0].failing).indexOf("firewall-enabled") !== -1);

      /* ── accepted deviations ── */
      const acc = await SEC.acceptDeviation(pid, { deviceId: devLin, checkId: "firewall-enabled", note: "legacy app requires it" });
      check("security: acceptDeviation stores a record", !!acc.deviation && acc.deviation.checkId === "firewall-enabled");
      const driftLin2 = await SEC.driftFor(pid, devLin, {});
      check("security: an accepted deviation clears the failing check",
        driftLin2.compliant === true && driftLin2.findings.find((f) => f.checkId === "firewall-enabled").accepted === true);
      check("security: deviations lists the accepted record", (await SEC.deviations(pid, { deviceId: devLin })).length === 1);
      const clr = await SEC.clearDeviation(pid, acc.deviation.id);
      check("security: clearDeviation removes it", clr.removed === acc.deviation.id && (await SEC.deviations(pid, { deviceId: devLin })).length === 0);

      /* ── administrator change detection ── */
      await INV.seedSnapshot(pid, devWin, winInv(["alice", "carol"]));
      const scan2 = await SEC.scan(pid, { alerts: false });
      const winP2 = scan2.results.find((r) => String(r.deviceId) === String(devWin));
      check("security: a newly-added local administrator is detected as drift",
        !!winP2 && winP2.findings.some((f) => f.checkId === "local-admins" && f.state === "fail"), JSON.stringify(winP2 && winP2.findings.filter((f) => f.checkId === "local-admins")));

      /* ── remediation through the automation engine ── */
      const rule = await AUTO.add(pid, { name: "Remediate drift", enabled: true, trigger: { type: "compliance.drift" }, target: {}, actions: [{ type: "run-script", params: { script: "echo remediate", language: "powershell" } }] });
      check("security: a compliance.drift automation rule is created", !!rule.rule && AUTO.trigger("compliance.drift") != null, JSON.stringify(rule.error || rule.errors));
      await SEC.updateBaseline(pid, base.baseline.id, { remediationRuleId: rule.rule.id });
      const ro = await SEC.remediationOptions(pid, devLin);
      check("security: remediation options expose the drift rule", ro.some((o) => o.ruleId === rule.rule.id));
      const rem = await SEC.remediate(pid, devLin, {});
      check("security: remediate runs the baseline's rule scoped to the drifting device",
        !!rem.ruleId && ((rem.run && String(rem.run.triggerType) === "compliance.drift") || rem.pending === true), JSON.stringify(rem.error || rem.status || rem));
      if (rem.run) check("security: the remediation run targets only that device", arr(rem.run.targets).length === 1 && String(arr(rem.run.targets)[0].deviceId) === String(devLin), JSON.stringify(arr(rem.run.targets).map((t) => t.deviceId)));

      /* ── backup expectations + jobs ── */
      const expSrv = await SEC.addExpectation(pid, { name: "Nightly server backup", productId: "veeam", maxAgeHours: 26, graceHours: 4, targets: { deviceIds: [devLin] } });
      check("security: addExpectation stores a normalised expectation", !!expSrv.expectation && expSrv.expectation.productId === "veeam" && expSrv.expectation.required === true, JSON.stringify(expSrv.error || expSrv.errors));
      check("security: validateExpectation rejects an unknown product", SEC.validateExpectation({ name: "x", productId: "bogus", maxAgeHours: 1 }).valid === false);
      const expMac = await SEC.addExpectation(pid, { name: "Mac weekly", productId: "other", maxAgeHours: 24, graceHours: 2, targets: { deviceIds: [devMac] } });
      check("security: a second expectation targets another device", !!expMac.expectation);

      prov = (await T.get(pid)).provider;
      const macDev = prov.devices.map(D.normalizeDevice).find((d) => String(d.id) === String(devMac));
      const macNever = await SEC.computeBackupState(prov, macDev, {});
      check("security: a device that has never backed up reports never", macNever.status === "never" && macNever.expected === true, JSON.stringify(macNever.status));

      const rbOk = await SEC.reportBackup(pid, { deviceId: devLin, productId: "veeam", status: "success", at: fixHours(1), jobName: "Nightly", detail: "Success", sizeBytes: 1024 });
      check("security: reportBackup records a job and a healthy state", !!rbOk.job && rbOk.job.status === "success" && rbOk.state.status === "ok", JSON.stringify(rbOk.error || rbOk.state));
      const rbFail = await SEC.reportBackup(pid, { deviceId: devLin, productId: "veeam", status: "failed", at: fixHours(0.5), jobName: "Nightly", detail: "Target offline" });
      check("security: a failed backup flags the device while remembering the last success", rbFail.state.status === "failed" && rbFail.state.lastSuccessAt !== "");
      await SEC.reportBackup(pid, { deviceId: devMac, productId: "other", status: "success", at: fixHours(200), jobName: "Weekly" });
      prov = (await T.get(pid)).provider;
      const macStale = await SEC.computeBackupState(prov, prov.devices.map(D.normalizeDevice).find((d) => String(d.id) === String(devMac)), {});
      check("security: a stale success counts as a missed backup under its expectation", macStale.status === "missed" && macStale.expected === true, JSON.stringify(macStale.status));

      const ing = await SEC.ingestBackups(pid, {});
      check("security: ingestBackups imports inventory-reported jobs", ing.ok === true && ing.ingested >= 1, JSON.stringify(ing.ingested));
      const ing2 = await SEC.ingestBackups(pid, {});
      check("security: ingestBackups is idempotent", ing2.ingested === 0, JSON.stringify(ing2.ingested));
      const bjobs = await SEC.backupJobs(pid, { deviceId: devLin });
      check("security: recent jobs are listed per device", arr(bjobs).length >= 2 && bjobs[0].at >= bjobs[1].at);

      /* ── backup alerts ── */
      const scanB = await SEC.scanBackups(pid, { alerts: true });
      check("security: scanBackups summarises device states", scanB.ok === true && scanB.summary.devices === 3 && scanB.summary.missed >= 1, JSON.stringify(scanB.summary));
      const active = arr(await AL.list(pid, { active: true })).filter((a) => String(a.dedupeKey).indexOf("backup-verify|") === 0);
      check("security: a missed backup escalates to an alert", active.some((a) => String(a.dedupeKey) === "backup-verify|" + devMac), JSON.stringify(active.map((a) => a.dedupeKey)));
      await SEC.reportBackup(pid, { deviceId: devMac, productId: "other", status: "success", at: fixHours(0), jobName: "Weekly" });
      await SEC.scanBackups(pid, { alerts: true });
      const macAlert = arr(await AL.list(pid, {})).find((a) => String(a.dedupeKey) === "backup-verify|" + devMac);
      check("security: a recovered backup auto-clears its alert", !macAlert || macAlert.state === "resolved", JSON.stringify(macAlert && macAlert.state));

      /* ── recovery tests ── */
      const rec = await SEC.ensureRecoveryTests(pid, {});
      check("security: recovery tests are requested for devices with expectations", rec.created >= 2, JSON.stringify(rec.created));
      const rlist = await SEC.recoveryTests(pid, {});
      check("security: recovery tests are listed and start due", rlist.length >= 2 && (await SEC.recoveryDue(pid, {})).length >= 1);
      const conf = await SEC.confirmRecoveryTest(pid, rlist[0].id, { result: "pass", note: "restored to a lab VM" });
      check("security: confirmRecoveryTest records who confirmed and the result", conf.test.status === "confirmed" && !!conf.test.confirmedBy && conf.test.result === "pass");
      check("security: the confirmed test is no longer due", (await SEC.recoveryDue(pid, {})).every((t) => t.id !== rlist[0].id));

      /* ── audit trail ── */
      const alog = await ERP.master.auditLog({ all: true });
      check("security: posture scans, deviations, backup reports and remediation are audited",
        alog.some((e) => e.action === "security_scan") && alog.some((e) => e.action === "security_deviation") &&
        alog.some((e) => e.action === "backup_report") && alog.some((e) => e.action === "security_remediate") && alog.some((e) => e.action === "recovery_test"),
        alog.filter((e) => String(e.action).indexOf("security") === 0 || String(e.action).indexOf("backup") === 0 || e.action === "recovery_test").map((e) => e.action).join(","));

      /* ── the rendered console ── */
      const host = document.createElement("div");
      document.body.appendChild(host);
      await SEC.renderInto(host, { providerId: pid, providers: [{ id: pid, name: "Test provider" }], toast() {} });
      check("security: the console renders three tabs incl. baselines and backup",
        !!host.querySelector(".rmm-security-inner") && host.querySelectorAll("[data-tab]").length === 3 && !!host.querySelector('[data-tab="baselines"]') && !!host.querySelector('[data-tab="backup"]'));
      check("security: the posture tab renders the device table and scan action",
        !!host.querySelector('[data-act="sec-scan"]') && host.textContent.indexOf("Device posture") !== -1);
      const bTab = host.querySelector('[data-tab="baselines"]');
      if (bTab) bTab.click();
      await wait(STEP * 2);
      check("security: the baselines tab renders the drift table and controls",
        !!host.querySelector('[data-act="sec-base-new"]') && !!host.querySelector('[data-act="sec-drift"]') && host.textContent.indexOf("Compliance baselines") !== -1);
      const bkTab = host.querySelector('[data-tab="backup"]');
      if (bkTab) bkTab.click();
      await wait(STEP * 2);
      check("security: the backup tab renders expectations and recovery controls",
        !!host.querySelector('[data-act="sec-exp-new"]') && !!host.querySelector('[data-act="sec-recovery-due"]') && host.textContent.indexOf("Backup verification") !== -1);

      /* ── the baseline editor ── */
      const bTab2 = host.querySelector('[data-tab="baselines"]');
      if (bTab2) bTab2.click();
      await wait(STEP * 2);
      const newBtn = host.querySelector('[data-act="sec-base-new"]');
      if (newBtn) newBtn.click();
      await wait(STEP * 2);
      const modal = document.querySelector("#uiModal");
      const nameInput = modal && modal.querySelector('[name="b_name"]');
      if (nameInput) nameInput.value = "Editor baseline";
      const chk = modal && modal.querySelector('[name="b_check_firewall-enabled"]');
      if (chk) chk.checked = true;
      const saveBtn = modal && modal.querySelector('[data-act="sec-base-save"]');
      if (saveBtn) saveBtn.click();
      await wait(STEP * 3);
      check("security: the baseline editor saves a new baseline with the checked items",
        (await SEC.baselines(pid, { includeDisabled: true })).some((b) => b.name === "Editor baseline" && b.checks.indexOf("firewall-enabled") !== -1));
      host.remove();
    } catch (e) {
      check("security: harness did not crash", false, (e && (e.message + " | " + e.stack)) || String(e));
    } finally {
      try { store.useBackend(null); } catch (e) {}
      try { store.resetAllLocal(); } catch (e) {}
      try { T.reload(); } catch (e) {}
      try { await M.seed(); } catch (e) {}
    }
    const passed = results.filter((r) => r.ok).length;
    const failed = results.length - passed;
    return { passed, failed, results };
  };

  /* ============================================================
     Tasks 37–39 — remote shell, remote tools & file transfer
     Run via page_eval:  await window.RMMRemoteTest()
     Exercises the deny-list, the role gate, shell sessions that
     dispatch real agent jobs (claim → result → fold), tool launch
     and handoff sessions, and push/pull transfers with the SHA-256
     integrity trailer + upload quarantine. Runs against a stub
     backend so the real canonical documents are never touched.
     ============================================================ */
  window.RMMRemoteTest = async function (opts) {
    opts = opts || {};
    results.length = 0;
    const ERP = window.ERP;
    const store = ERP.store;
    const T = ERP.tenancy;
    const D = ERP.devices;
    const E = ERP.enrollment;
    const M = ERP.masterConfig;
    const J = ERP.jobs;
    const REM = ERP.remote;
    const uid = Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
    const STEP = 200;

    function makeServer() {
      const files = {};
      return {
        files,
        async get(name) { return Object.prototype.hasOwnProperty.call(files, name) ? files[name] : null; },
        async set(name, json) { const prev = files[name]; files[name] = json; return { created: prev === undefined, unchanged: prev === json, editKey: "k_" + name, superseded: false, error: null }; },
      };
    }
    if (!REM || !J || !E || !M) { check("remote: ERP.remote + jobs + enrollment + master exposed", false); return { passed: 0, failed: 1, results }; }
    const srv = makeServer();
    const arr = (v) => (Array.isArray(v) ? v : []);
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const prevRole = ERP.role;
    const cfgRmm = (window.root && window.root.config && window.root.config.rmm) || null;
    let pid = null, devWin = null, devLin = null;
    const cred = {};

    const answer = async (deviceId, jobId, out) => {
      out = out || {};
      const c = await J.claim({ deviceId, credential: cred[deviceId] });
      const job = arr(c.jobs).find((x) => x.jobId === jobId);
      if (!job) return false;
      await J.result({ jobId, deviceId, credential: cred[deviceId], exitCode: out.exitCode == null ? 0 : out.exitCode, stdout: out.stdout || "", stderr: out.stderr || "" });
      return true;
    };

    try {
      ERP.role = "owner";
      window.confirm = () => true;

      /* ── surface ── */
      check("remote: the console API is exposed",
        ["canRemote", "canShell", "canTransfer", "inspectCommand", "openShell", "getShell", "listShells", "runCommand", "syncShell", "closeShell",
          "listTools", "getTool", "addTool", "updateTool", "removeTool", "setToolEnabled", "renderTemplate", "launch", "redeemHandoff", "endSession", "listSessions",
          "pushFile", "pullFile", "releaseTransfer", "rejectTransfer", "cancelTransfer", "retryTransfer", "syncTransfers", "listTransfers", "getTransfer",
          "parseTrailer", "pushScript", "pullScript", "sha256", "transferChunks", "rollup", "activity", "renderRemote", "deviceSection", "wireDeviceSection"].every((f) => typeof REM[f] === "function"),
        ["addTool", "launch", "pushFile", "renderRemote"].filter((f) => typeof REM[f] !== "function").join(","));
      check("remote: the deny catalogue, tool kinds and presets are exposed",
        REM.DENY.length >= 8 && REM.TOOL_KINDS.length >= 5 && REM.PRESETS.length >= 4 && REM.DANGEROUS_EXTENSIONS.indexOf("exe") !== -1);

      /* ── deny-list ── */
      check("remote: catastrophic commands are blocked",
        ["rm -rf /", "mkfs.ext4 /dev/sda1", "dd if=/dev/zero of=/dev/sda", "format c:", "diskpart", "wipefs -a /dev/sdb"].every((c) => REM.inspectCommand(c).level === "block"),
        ["rm -rf /", "mkfs.ext4 /dev/sda1"].map((c) => c + "=" + REM.inspectCommand(c).level).join(","));
      check("remote: destructive commands require confirmation",
        ["shutdown /r", "del /s /q C:\\temp", "taskkill /f /im x.exe", "netsh advfirewall set allprofiles state off", "curl http://x/s | sh", "Remove-Item -Recurse -Force C:\\x"].every((c) => REM.inspectCommand(c).level === "confirm"),
        ["shutdown /r", "del /s /q C:\\temp"].map((c) => c + "=" + REM.inspectCommand(c).level).join(","));
      check("remote: ordinary commands are allowed",
        ["ls -la", "Get-Process", "ipconfig /all", "cat /etc/hosts"].every((c) => REM.inspectCommand(c).level === "allow"));
      check("remote: an empty command is refused", REM.inspectCommand("   ").level === "block" && REM.inspectCommand("   ").reason === "empty_command");
      check("remote: a blocked command names its rule", REM.inspectCommand("rm -rf /").matches.some((m) => m.id === "rm-root") && REM.inspectCommand("rm -rf /").reason === "command_blocked");
      if (cfgRmm) {
        cfgRmm.remoteDenyExtra = "\\bsecret-tool\\b";
        check("remote: an operator pattern escalates a command to confirm",
          REM.extraDenyPatterns().length === 1 && REM.inspectCommand("run secret-tool now").level === "confirm" && REM.inspectCommand("echo hello").level === "allow");
        cfgRmm.remoteDenyExtra = "";
      }

      /* ── fixture ── */
      store.useBackend(srv);
      store.resetAllLocal();
      T.reload();
      await M.seed({ force: true });
      pid = (await T.create({ name: "Remote " + uid })).provider.id;
      const enroll = async (hostname, family, osName) => {
        const t = await E.issueToken({ providerId: pid });
        const en = await E.enroll({ token: t.token, hostname, os: { name: osName || family, family } });
        cred[String(en.deviceId)] = en.credential;
        await D.update(pid, en.deviceId, { os: { name: osName || family, family } });
        return en.deviceId;
      };
      devWin = await enroll("REM-WS1", "Windows", "Windows 11");
      devLin = await enroll("REM-LNX1", "Linux", "Ubuntu 22.04");

      /* ── permission gate ──
         Exercise the role selector's local mode, so a hub connection made
         elsewhere in the page cannot override the role under test. */
      try { if (ERP.team && ERP.team.setTransport) ERP.team.setTransport(null); } catch (e) {}
      check("remote: owner may run remote actions", REM.canShell().ok === true && REM.canTransfer().ok === true);
      ERP.role = "staff";
      check("remote: staff are refused by default", REM.canShell().ok === false && REM.canShell().reason === "forbidden_role" && (await REM.openShell(pid, devLin)).reason === "forbidden_role");
      check("remote: staff are refused a transfer and a tool launch",
        (await REM.pushFile(pid, devLin, { path: "/tmp/x", content: "x" })).reason === "forbidden_role" && (await REM.addTool(pid, { name: "x", urlTemplate: "x://{deviceId}" })).reason === "forbidden_role");
      if (cfgRmm) {
        cfgRmm.remoteAllowStaff = true;
        check("remote: remoteAllowStaff relaxes the gate for staff", REM.canShell().ok === true && REM.canShell().role === "staff");
        cfgRmm.remoteAllowStaff = false;
      }
      ERP.role = "owner";
      if (cfgRmm) {
        cfgRmm.remoteEnabled = false;
        check("remote: remoteEnabled=false disables the whole console", REM.canRemote("shell").reason === "remote_disabled");
        cfgRmm.remoteEnabled = true;
      }

      /* ── tools ── */
      const addTool = async (name, kind, url) => (await REM.addTool(pid, { name, kind, urlTemplate: url, notes: name + " note" }));
      const t1 = await addTool("RustDesk", "remote-control", "rustdesk://{deviceId}");
      const toolId = t1.tool.id;
      check("remote: a tool is added with a generated id", t1.ok === true && /^rtool-/.test(toolId));
      check("remote: addTool requires a URL template", (await REM.addTool(pid, { name: "Empty" })).error === "empty_url");
      check("remote: the tool list resolves the new tool", (await REM.listTools(pid)).some((t) => t.id === toolId));
      const upd = await REM.updateTool(pid, toolId, { name: "RustDesk (unattended)" });
      check("remote: a tool can be edited", upd.ok === true && upd.tool.name === "RustDesk (unattended)" && upd.tool.createdAt === t1.tool.createdAt);
      await addTool("SSH console", "ssh", "ssh://{user}@{ip}");
      check("remote: the template renders device placeholders",
        REM.renderTemplate("rdp://{hostname} · {deviceId}", { id: "dev-1", hostname: "PC1", interfaces: [{ ip4: ["10.0.0.5"] }] }).text === "rdp://PC1 · dev-1");
      check("remote: unfilled placeholders are reported",
        REM.renderTemplate("ssh://{user}@{ip}", { id: "d", hostname: "PC1", interfaces: [] }).missing.sort().join(",") === "ip,user" &&
        REM.renderTemplate("x://{bogus}", {}).missing.join(",") === "bogus");
      check("remote: the launch URL is built from the template", REM.toolUrl({ urlTemplate: "rustdesk://{deviceId}" }, { id: "dev-9" }).url === "rustdesk://dev-9");

      const lc = await REM.launch(pid, toolId, devLin);
      check("remote: launching records a session against the device", lc.ok === true && lc.session.deviceId === devLin && lc.session.mode === "launch" && lc.session.status === "active" && lc.url === "rustdesk://" + devLin);
      const hand = await REM.launch(pid, toolId, devWin, { mode: "handoff", by: "bob" });
      check("remote: a handoff link carries a token and a share URL",
        hand.ok === true && !!hand.session.handoffToken && hand.session.handoffUrl.indexOf("rmm-remote-handoff=" + hand.session.id + ".") !== -1 && hand.session.startedBy === "bob");
      const red = await REM.redeemHandoff(pid, hand.session.handoffUrl, { by: "carol" });
      check("remote: redeeming the handoff activates + stamps the session", red.ok === true && !!red.session.redeemedAt && red.session.redeemedBy === "carol");
      check("remote: an unknown handoff token is refused", (await REM.redeemHandoff(pid, "rhand-nope.deadbeef")).error === "handoff_not_found");
      const sess = await REM.listSessions(pid);
      check("remote: sessions are listed newest-first with a kind label", sess.length === 2 && sess[0].kindLabel === "Remote control");
      check("remote: sessionsForDevice scopes to a device", (await REM.sessionsForDevice(pid, devLin)).length === 1);
      const end = await REM.endSession(pid, lc.session.id);
      check("remote: ending a session records who + when", end.ok === true && end.session.status === "ended" && !!end.session.endedAt);
      await REM.setToolEnabled(pid, toolId, false);
      check("remote: a disabled tool cannot launch", (await REM.launch(pid, toolId, devLin)).error === "tool_disabled");
      await REM.setToolEnabled(pid, toolId, true);
      check("remote: removing a missing tool reports not_found", (await REM.removeTool(pid, uid + "-missing")).error === "not_found");

      /* ── remote shell ── */
      const os1 = await REM.openShell(pid, devLin);
      const shellId = os1.shell.id;
      check("remote: opening a shell picks the device's language", os1.ok === true && os1.shell.language === "bash" && os1.shell.deviceId === devLin && os1.shell.status === "active");
      const osw = await REM.openShell(pid, devWin);
      check("remote: a Windows device gets powershell", osw.shell.language === "powershell");
      check("remote: listShells reports command counts + pending", (await REM.listShells(pid)).length === 2);

      const rc1 = await REM.runCommand(pid, shellId, "whoami");
      check("remote: a command becomes an agent job + a transcript entry", rc1.ok === true && !!rc1.entry.jobId && rc1.entry.state === "queued" && rc1.entry.matches.length === 0);
      check("remote: the agent claim delivers the command", await answer(devLin, rc1.entry.jobId, { stdout: "root\n" }));
      await REM.syncShell(pid, shellId);
      let shell = await REM.getShell(pid, shellId);
      check("remote: the agent's output is folded back into the transcript",
        shell.entries[0].state === "succeeded" && shell.entries[0].stdout === "root\n" && shell.entries[0].exitCode === 0, JSON.stringify(shell.entries[0] && { s: shell.entries[0].state }));
      check("remote: the terminal renders the command + its output", REM.terminalHtml(shell).indexOf("whoami") !== -1 && REM.terminalHtml(shell).indexOf("root") !== -1);

      const rc0 = await REM.runCommand(pid, shellId, "true");
      await answer(devLin, rc0.entry.jobId, { stdout: "" });
      await REM.syncShell(pid, shellId);
      shell = await REM.getShell(pid, shellId);
      check("remote: a command with no output still succeeds", shell.entries[shell.entries.length - 1].state === "succeeded" && /no output/.test(REM.terminalHtml(shell)));

      const rc2 = await REM.runCommand(pid, shellId, "false");
      await answer(devLin, rc2.entry.jobId, { exitCode: 1, stderr: "boom" });
      await REM.syncShell(pid, shellId);
      shell = await REM.getShell(pid, shellId);
      check("remote: a non-zero exit is folded as failed with stderr", shell.entries[shell.entries.length - 1].state === "failed" && shell.entries[shell.entries.length - 1].stderr === "boom");

      const rc3 = await REM.runCommand(pid, shellId, "sleep 9999");
      await REM.writeState(pid, (s) => {
        const sh = arr(s.shells).find((x) => x.id === shellId);
        const en = arr(sh.entries)[arr(sh.entries).length - 1];
        en.queuedAt = new Date(Date.now() - 999999).toISOString();
      });
      await REM.syncShell(pid, shellId);
      shell = await REM.getShell(pid, shellId);
      check("remote: a command the agent never answers times out", shell.entries[shell.entries.length - 1].state === "timed-out" && /did not answer/.test(shell.entries[shell.entries.length - 1].error));

      const jobsBefore = (await J.list(pid)).length;
      const rcB = await REM.runCommand(pid, shellId, "rm -rf /");
      check("remote: the deny-list refuses a blocked command and creates no job",
        rcB.error === "command_blocked" && (await J.list(pid)).length === jobsBefore && rcB.matches.some((m) => m.level === "block"));
      const rcC = await REM.runCommand(pid, shellId, "shutdown /r");
      check("remote: a confirm-level command needs opts.confirm", rcC.error === "confirmation_required" && rcC.matches.length >= 1);
      const rcC2 = await REM.runCommand(pid, shellId, "shutdown /r", { confirm: true });
      check("remote: a confirmed destructive command is dispatched + flagged", rcC2.ok === true && rcC2.entry.confirmed === true && rcC2.entry.dangerous === true);
      await J.cancel(pid, rcC2.entry.jobId);
      check("remote: runCommand refuses an empty command", (await REM.runCommand(pid, shellId, "  ")).error === "empty_command");
      check("remote: runCommand refuses a closed shell", (await REM.closeShell(pid, shellId)).ok === true && (await REM.runCommand(pid, shellId, "ls")).error === "shell_closed");
      check("remote: a closed shell leaves the active list", (await REM.listShells(pid, { status: "active" })).every((s) => s.id !== shellId));

      /* ── file transfer ── */
      check("remote: push validates its arguments",
        (await REM.pushFile(pid, devLin, { content: "x" })).error === "no_path" && (await REM.pushFile(pid, devLin, { path: "/tmp/x" })).error === "empty_file" &&
        (await REM.pushFile(pid, "dev-nope", { path: "/tmp/x", content: "x" })).error === "device_not_found");
      check("remote: the chunker splits a payload by the configured size", REM.transferChunks("a".repeat(70000), "utf8").length === 2 && REM.transferChunks("hi", "utf8").length === 1);
      check("remote: push rejects a payload over the size limit",
        (await REM.pushFile(pid, devLin, { path: "/tmp/big.bin", content: "a".repeat(1048577) })).error === "file_too_large");

      const content = "hello world\n";
      const p1 = await REM.pushFile(pid, devLin, { path: "/tmp/hello.txt", content });
      check("remote: an upload is quarantined for review by default", p1.ok === true && p1.transfer.state === "quarantined" && !!p1.transfer.quarantine.scannedAt);
      const rel = await REM.releaseTransfer(pid, p1.transfer.id);
      check("remote: releasing a clean upload starts the transfer", rel.ok === true && rel.transfer.state === "in-progress" && rel.transfer.chunks.length === 1);
      check("remote: the agent claim delivers the push chunk", await answer(devLin, rel.transfer.chunks[0].jobId, { stdout: "@@RMMFILE sha256 " + REM.sha256(content) + " " + content.length + "\n" }));
      await REM.syncTransfers(pid);
      let tr = await REM.getTransfer(pid, p1.transfer.id);
      check("remote: a verified push completes + is stamped verified", tr.state === "succeeded" && tr.verified === true && tr.sizeBytes === content.length, JSON.stringify({ s: tr.state, v: tr.verified }));
      check("remote: the transfer's download URL round-trips the payload", REM.transferDownloadUrl(tr).indexOf("base64,") !== -1);

      const p2 = await REM.pushFile(pid, devLin, { path: "/tmp/bad.txt", content: "abc", skipQuarantine: true });
      check("remote: skipQuarantine bypasses the review step", p2.transfer.state === "in-progress");
      await answer(devLin, p2.transfer.chunks[0].jobId, { stdout: "@@RMMFILE sha256 deadbeef 3\n" });
      await REM.syncTransfers(pid);
      let tr2 = await REM.getTransfer(pid, p2.transfer.id);
      check("remote: a checksum mismatch fails the transfer", tr2.state === "failed" && /mismatch/i.test(tr2.error), tr2.error);
      const rt = await REM.retryTransfer(pid, p2.transfer.id);
      check("remote: a failed push can be retried", rt.ok === true && rt.transfer.id !== p2.transfer.id && rt.transfer.state === "in-progress");

      const p3 = await REM.pushFile(pid, devLin, { path: "/tmp/tool.exe", content: "MZ" });
      check("remote: an executable upload is flagged at the quarantine step", p3.transfer.state === "quarantined" && arr(p3.transfer.quarantine.flags).some((f) => /executable/.test(f)));
      const blockedRel = await REM.releaseTransfer(pid, p3.transfer.id);
      check("remote: a flagged upload cannot be released without force", blockedRel.error === "quarantine_blocked" && arr(blockedRel.flags).length >= 1);
      const forced = await REM.releaseTransfer(pid, p3.transfer.id, { force: true });
      check("remote: force releases the flagged upload", forced.ok === true && forced.transfer.quarantine.forced === true);
      await answer(devLin, forced.transfer.chunks[0].jobId, { stdout: "@@RMMFILE sha256 " + REM.sha256("MZ") + " 2\n" });
      await REM.syncTransfers(pid);

      const p4 = await REM.pushFile(pid, devLin, { path: "/tmp/rej.txt", content: "reject me" });
      const rej = await REM.rejectTransfer(pid, p4.transfer.id, { reason: "not approved" });
      check("remote: a quarantined upload can be rejected", rej.ok === true && rej.transfer.state === "rejected" && rej.transfer.error === "not approved");

      const p5 = await REM.pushFile(pid, devLin, { path: "/tmp/cancel.txt", content: "cancel me", skipQuarantine: true });
      const cx = await REM.cancelTransfer(pid, p5.transfer.id);
      check("remote: an in-flight transfer can be cancelled", cx.ok === true && cx.transfer.state === "cancelled");

      const pullContent = "127.0.0.1 localhost\n";
      const pu = await REM.pullFile(pid, devLin, { path: "/etc/hosts" });
      check("remote: pull enqueues an agent job", pu.ok === true && !!pu.transfer.jobId && pu.transfer.direction === "pull" && pu.transfer.state === "in-progress");
      await answer(devLin, pu.transfer.jobId, { stdout: REM.b64encode(pullContent) + "\n@@RMMFILE sha256 " + REM.sha256(pullContent) + " " + pullContent.length + "\n" });
      await REM.syncTransfers(pid);
      const trp = await REM.getTransfer(pid, pu.transfer.id);
      check("remote: a verified pull decodes + verifies the payload", trp.state === "succeeded" && trp.verified === true && REM.b64decode(trp.payload) === pullContent);
      const ptrail = REM.parseTrailer(REM.b64encode("abc") + "\n@@RMMFILE sha256 " + REM.sha256("abc") + " 3\n");
      check("remote: the integrity trailer parser extracts payload + hash", ptrail.found === true && ptrail.payload === "abc" && ptrail.size === 3 && ptrail.checksum === REM.sha256("abc"));
      check("remote: the push script writes + hashes, the pull script reads + hashes",
        /@@RMMFILE/.test(REM.pushScript("Linux", "/tmp/x", "aGk=", {})) && /base64 -d/.test(REM.pushScript("Linux", "/tmp/x", "aGk=", {})) &&
        /Get-FileHash/.test(REM.pullScript("Windows", "C:\\x")) && /sha256sum/.test(REM.pullScript("Linux", "/etc/hosts")));
      check("remote: the SHA-256 + base64 codecs are UTF-8 safe", REM.sha256("a") !== REM.sha256("b") && REM.b64decode(REM.b64encode("héllo ✓")) === "héllo ✓");
      check("remote: transfers list + filter by device and direction",
        (await REM.transfersForDevice(pid, devLin)).length >= 5 && (await REM.listTransfers(pid, { direction: "pull" })).every((t) => t.direction === "pull"));
      check("remote: a rejected transfer is not retryable", (await REM.retryTransfer(pid, p4.transfer.id)).error === "not_retryable");

      /* ── rollup + activity ── */
      const roll = await REM.rollup(pid);
      check("remote: the rollup summarises shells, sessions and transfers",
        roll.shells >= 2 && roll.commands >= 4 && roll.sessions >= 2 && roll.transfers >= 5, JSON.stringify(roll));
      const act = await REM.activity(pid);
      check("remote: the activity feed unifies commands, sessions and transfers",
        act.some((x) => x.kind === "command") && act.some((x) => x.kind === "session") && act.some((x) => x.kind === "transfer"));

      /* ── device modal + console UI ── */
      const dev = (await D.get(pid, devLin)).device;
      const sec = await REM.deviceSection(dev, pid);
      check("remote: the device modal shows remote actions", /Remote access/.test(sec) && /rm-dev-shell/.test(sec) && /rm-dev-tool/.test(sec) && /rm-dev-push/.test(sec));
      const modalEl = document.createElement("div");
      modalEl.innerHTML = '<button data-act="rm-dev-shell"></button>';
      document.body.appendChild(modalEl);
      let openedShellId = null;
      REM.wireDeviceSection(modalEl, { deviceId: devLin, providerId: pid, toast: function () {}, onOpenShell: function (id) { openedShellId = id; } });
      modalEl.querySelector('[data-act="rm-dev-shell"]').click();
      for (let i = 0; i < 25 && !openedShellId; i++) await wait(STEP);
      check("remote: the device-modal action opens a real shell session", !!openedShellId && !!(await REM.getShell(pid, openedShellId)));
      modalEl.remove();

      const host = document.createElement("div");
      document.body.appendChild(host);
      const st = { tab: "shell", shellId: null };
      const inst = await REM.renderRemote(host, { providerId: pid, toast: function () {}, state: st });
      check("remote: the console renders stat cards + sub-tabs",
        host.querySelectorAll(".erp-stat").length >= 6 && !!host.querySelector('[data-tab="tools"]') && !!host.querySelector('[data-tab="files"]'));
      check("remote: the shell sub-tab renders the terminal + controls",
        !!host.querySelector(".rmm-term") && !!host.querySelector('[data-act="rm-shell-new"]') && !!host.querySelector('[name="rm_shell"]'));
      st.tab = "tools";
      await inst.paint();
      check("remote: the tools sub-tab renders the tool table + actions",
        !!host.querySelector('[data-act="rm-tool-new"]') && !!host.querySelector('[data-act="rm-tool-launch"]') && !!host.querySelector('[data-act="rm-tool-handoff"]'));
      st.tab = "files";
      await inst.paint();
      check("remote: the files sub-tab renders push/pull + the transfer table",
        !!host.querySelector('[data-act="rm-xfer-push"]') && !!host.querySelector('[data-act="rm-xfer-pull"]') && host.textContent.indexOf("Transfers") !== -1);
      check("remote: a transfer offers a details action", !!host.querySelector('[data-act="rm-xfer-view"]'));
      inst.destroy();
      host.remove();

      /* ── integration: the station's tab delegation must not hijack the
         nested Remote sub-tabs (regression: clicking a sub-tab used to
         deactivate the whole Remote panel). ── */
      const devHost = document.createElement("main");
      devHost.className = "erp-content";
      document.body.appendChild(devHost);
      const prevPid = D.currentProviderId;
      D.currentProviderId = pid;
      await D.render({ el: devHost, navigate: function () {}, toast: function () {}, empty: function () {}, error: function () {} });
      const outerRemote = devHost.querySelector('[data-tab="remote"]');
      check("remote: the Devices station exposes a Remote tab", !!outerRemote);
      if (outerRemote) {
        outerRemote.click();
        for (let i = 0; i < 40 && !devHost.querySelector('[data-panel="remote"] .rmm-remote-inner'); i++) await wait(STEP);
        const remotePanel = devHost.querySelector('[data-panel="remote"]');
        check("remote: deep-linking the Remote tab renders it active",
          !!remotePanel && remotePanel.classList.contains("active") && !!remotePanel.querySelector(".rmm-remote-inner"));
        const sub = remotePanel && remotePanel.querySelector('.rmm-remote-inner [data-tab="files"]');
        if (sub) {
          sub.click();
          for (let i = 0; i < 25 && !remotePanel.querySelector('[data-act="rm-xfer-push"]'); i++) await wait(STEP);
          check("remote: a nested sub-tab keeps the Remote panel open (no station-tab hijack)",
            remotePanel.classList.contains("active") && !!remotePanel.querySelector('[data-act="rm-xfer-push"]'));
        } else {
          check("remote: a nested sub-tab keeps the Remote panel open (no station-tab hijack)", false, "no files sub-tab");
        }
      }
      D.currentProviderId = prevPid;
      devHost.remove();

      /* ── demo seed ── */
      const demo = await T.create({ name: "RemoteDemo " + uid, demo: true });
      await T.reload(); /* drop any snapshot cached before the stub backend was installed */
      const seed = await REM.seedDemo({ force: true });
      check("remote: the demo seed installs the default remote tools", !seed.error && (await REM.listTools(demo.provider.id)).length >= 3, JSON.stringify(seed));

      check("remote: every canonical file stays in the rmm namespace", Object.keys(srv.files).every((n) => n.indexOf("rmm-v1-") === 0));
    } catch (e) {
      check("remote: harness did not crash", false, (e && e.stack) || String(e));
    } finally {
      try { store.useBackend(null); } catch (e) {}
      try { store.resetAllLocal(); } catch (e) {}
      try { T.reload(); } catch (e) {}
      try { await M.seed(); } catch (e) {}
      ERP.role = prevRole;
      try { if (cfgRmm) { cfgRmm.remoteDenyExtra = ""; cfgRmm.remoteAllowStaff = false; cfgRmm.remoteEnabled = true; } } catch (e) {}
    }

    const passed = results.filter((r) => r.ok).length;
    const failed = results.length - passed;
    return { passed, failed, results };
  };

  /* ═══════════════════════════════════════════════════════════════
     Task 40 — operational dashboards
     ═══════════════════════════════════════════════════════════════ */

  window.RMMDashboardTest = async function (opts) {
    opts = opts || {};
    results.length = 0;
    const ERP = window.ERP;
    const store = ERP.store;
    const T = ERP.tenancy;
    const D = ERP.devices;
    const M = ERP.masterConfig;
    const FL = ERP.fleet;
    const AL = ERP.alerts;
    const uid = Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
    const STEP = 150;

    function makeServer() {
      const files = {};
      return {
        files,
        async get(name) { return Object.prototype.hasOwnProperty.call(files, name) ? files[name] : null; },
        async set(name, json) { const prev = files[name]; files[name] = json; return { created: prev === undefined, unchanged: prev === json, editKey: "k_" + name, superseded: false, error: null }; },
      };
    }
    if (!FL || !D || !M || !AL) { check("dashboard: ERP.fleet + devices + alerts exposed", false); return { passed: 0, failed: 1, results }; }
    const srv = makeServer();
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const iso = (h) => new Date(Date.now() - h * 3600000).toISOString();
    const cfgRmm = (window.root && window.root.config && window.root.config.rmm) || null;
    let pid = null, d1 = null, d2 = null, d3 = null, d4 = null;

    try {
      store.useBackend(srv);
      store.resetAllLocal();
      T.reload();
      await M.seed({ force: true });

      /* ── surface ── */
      check("dashboard: the console API is exposed",
        ["snapshot", "tiles", "agentHealth", "alertStats", "affected", "renderInto", "render", "compareVersions", "latestAgentVersion", "agentVersionOf", "patchSummary", "securitySummary", "jobSummary"].every((f) => typeof FL[f] === "function"),
        ["snapshot", "tiles", "affected"].filter((f) => typeof FL[f] !== "function").join(","));
      check("dashboard: version comparison orders dotted versions",
        FL.compareVersions("1.2.10", "1.2.9") === 1 && FL.compareVersions("1.0.0", "1.0.0") === 0 && FL.compareVersions("0.9.0", "1.0.0") === -1);

      /* ── fixture ── */
      pid = (await T.create({ name: "Dash " + uid })).provider.id;
      d1 = (await D.add(pid, { hostname: "DASH-A", os: { family: "Windows", name: "Windows 11" }, agent: { version: "1.0.0" }, lastSeenAt: iso(0.05) })).device;
      d2 = (await D.add(pid, { hostname: "DASH-B", os: { family: "Windows", name: "Windows Server" }, agent: { version: "1.0.0" }, lastSeenAt: iso(6) })).device;
      d3 = (await D.add(pid, { hostname: "DASH-C", os: { family: "Linux", name: "Ubuntu" }, agent: { version: "0.9.0", updatePending: true }, lastSeenAt: iso(0.5) })).device;
      d4 = (await D.add(pid, { hostname: "DASH-D", os: { family: "macOS", name: "macOS" }, agent: { version: "" }, lastSeenAt: iso(0.1) })).device;
      check("dashboard: the fixture enrols four devices", [d1, d2, d3, d4].every((d) => d && d.id));

      /* ── agent health ── */
      const prov = (await T.get(pid)).provider;
      const ag = FL.agentHealth(prov);
      check("dashboard: agent version spread counts each version",
        ag.devices === 4 && ag.versions.length >= 3 && ag.latest === "1.0.0", JSON.stringify(ag.versions));
      check("dashboard: an older agent is flagged outdated and a missing version unknown",
        ag.outdated === 1 && ag.unknownVersion === 1 && ag.pending === 1);
      check("dashboard: the outdated list names the device", ag.outdatedList.some((d) => d.deviceId === d3.id));

      /* ── alerts by severity & age ── */
      const fired = async (deviceId, subject, severityId, severityRank, hoursAgo) => {
        const r = await AL.fire(pid, { monitorId: "mon-dash-" + subject, monitorName: subject, monitorType: "disk", deviceId, severityId, severityRank, state: "warning", subject, value: 1, at: iso(hoursAgo) }, { silent: true });
        return r.alert;
      };
      await fired(d1.id, "Disk", "sev-critical", 30, 0.5);
      await fired(d2.id, "Memory", "sev-warning", 20, 3);
      await fired(d3.id, "CPU", "sev-warning", 20, 216);
      const prov2 = (await T.get(pid)).provider;
      const as = FL.alertStats(prov2);
      check("dashboard: alert counts split by severity", as.active === 3 && as.critical === 1 && as.bySeverity.some((s) => s.id === "sev-critical" && s.count === 1), JSON.stringify(as.bySeverity));
      const byAge = {};
      as.byAge.forEach((b) => { byAge[b.id] = b.count; });
      check("dashboard: active alerts are bucketed by age", byAge["0-1h"] === 1 && byAge["1-24h"] === 1 && byAge["7d+"] === 1, JSON.stringify(byAge));

      /* ── tiles ── */
      const snap = await FL.snapshot(pid, {});
      check("dashboard: the snapshot gathers every engine", !snap.error && snap.devices.total === 4 && snap.agent && snap.alerts && !!snap.patch && !!snap.security && !!snap.jobs, JSON.stringify(snap.error || ""));
      const tiles = FL.tiles(snap);
      check("dashboard: the tile set covers devices, agents, alerts, compliance and jobs",
        ["devices", "online", "offline", "agent-outdated", "alerts-active", "alerts-critical", "patch", "security", "backup", "jobs"].every((id) => tiles.some((t) => t.id === id)),
        tiles.map((t) => t.id).join(","));
      check("dashboard: tile values reflect the fleet", tiles.find((t) => t.id === "devices").value === 4 && tiles.find((t) => t.id === "agent-outdated").value === 1 && tiles.find((t) => t.id === "alerts-active").value === 3);

      /* ── drill-down ── */
      const all = await FL.affected(pid, "status", "");
      check("dashboard: the devices drill-down returns the whole fleet", all.rows.length === 4);
      const offline = await FL.affected(pid, "status", "offline");
      check("dashboard: the offline drill-down returns only offline devices", offline.rows.length === 1 && offline.rows[0].deviceId === d2.id, JSON.stringify(offline.rows));
      const out = await FL.affected(pid, "agent-outdated", "");
      check("dashboard: the outdated drill-down returns the old agent", out.rows.some((r) => r.deviceId === d3.id));
      const crit = await FL.affected(pid, "alert-severity", "sev-critical");
      check("dashboard: the alert drill-down maps alerts to their device", crit.rows.some((r) => r.deviceId === d1.id));
      const aged = await FL.affected(pid, "alert-age", "7d+");
      check("dashboard: the age drill-down maps old alerts to their device", aged.rows.some((r) => r.deviceId === d3.id));

      /* ── config gate ── */
      if (cfgRmm) {
        cfgRmm.dashboardEnabled = false;
        const off = await FL.snapshot(pid, {});
        check("dashboard: dashboardEnabled=false disables the snapshot", off.error === "dashboard_disabled");
        cfgRmm.dashboardEnabled = true;
      }

      /* ── the rendered console ── */
      const host = document.createElement("div");
      document.body.appendChild(host);
      const inst = await FL.renderInto(host, { providerId: pid, providers: [{ id: pid, name: "Dash client" }], toast() {} });
      check("dashboard: the console renders the tile grid and two tabs",
        host.querySelectorAll(".rmm-tile").length >= 12 && host.querySelectorAll("[data-tab]").length === 2 && !!host.querySelector('[data-tab="agents"]'));
      const agentsTab = host.querySelector('[data-tab="agents"]');
      if (agentsTab) agentsTab.click();
      await wait(STEP * 4);
      check("dashboard: the agent-health tab renders the version spread table",
        !!host.querySelector(".rmm-dash-body") && host.textContent.indexOf("Agent version spread") !== -1);

      const overviewTab = host.querySelector('[data-tab="overview"]');
      if (overviewTab) overviewTab.click();
      await wait(STEP * 4);
      const tilesBtn = host.querySelector('.rmm-tile[data-act="dash-drill"]');
      check("dashboard: tiles expose a drill-down action", !!tilesBtn);
      if (tilesBtn) {
        tilesBtn.click();
        await wait(STEP * 4);
        const modal = document.querySelector("#uiModal");
        check("dashboard: a tile drill-down opens a device list", !!modal && modal.classList.contains("open") && !!modal.querySelector(".erp-table") && modal.querySelectorAll("tbody tr").length === 4, modal ? String(modal.querySelectorAll("tbody tr").length) : "no modal");
        ERP.ui.closeModal();
      }
      if (inst && inst.destroy) inst.destroy();
      host.remove();

      /* ── demo seed ── */
      const demo = await T.create({ name: "DashDemo " + uid, demo: true });
      await T.reload();
      await D.add(demo.provider.id, { hostname: "DEMO-1", os: { family: "Windows", name: "Windows 10" }, agent: { version: "1.0.0" }, lastSeenAt: iso(0.05) });
      const dsnap = await FL.snapshot(demo.provider.id, {});
      check("dashboard: a demo provider snapshots cleanly", !dsnap.error && dsnap.devices.total === 1);

      check("dashboard: every canonical file stays in the rmm namespace", Object.keys(srv.files).every((n) => n.indexOf("rmm-v1-") === 0));
    } catch (e) {
      check("dashboard: harness did not crash", false, (e && e.stack) || String(e));
    } finally {
      try { store.useBackend(null); } catch (e) {}
      try { store.resetAllLocal(); } catch (e) {}
      try { T.reload(); } catch (e) {}
      try { await M.seed(); } catch (e) {}
      try { if (cfgRmm) cfgRmm.dashboardEnabled = true; } catch (e) {}
    }

    const passed = results.filter((r) => r.ok).length;
    const failed = results.length - passed;
    return { passed, failed, results };
  };

  /* ═══════════════════════════════════════════════════════════════
     Task 41 — reporting
     ═══════════════════════════════════════════════════════════════ */

  window.RMMReportsTest = async function (opts) {
    opts = opts || {};
    results.length = 0;
    const ERP = window.ERP;
    const store = ERP.store;
    const T = ERP.tenancy;
    const D = ERP.devices;
    const M = ERP.masterConfig;
    const AL = ERP.alerts;
    const RP = ERP.rmmReports;
    const uid = Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
    const STEP = 150;

    function makeServer() {
      const files = {};
      return {
        files,
        async get(name) { return Object.prototype.hasOwnProperty.call(files, name) ? files[name] : null; },
        async set(name, json) { const prev = files[name]; files[name] = json; return { created: prev === undefined, unchanged: prev === json, editKey: "k_" + name, superseded: false, error: null }; },
      };
    }
    if (!RP || !D || !M) { check("reports: ERP.rmmReports + devices + master exposed", false); return { passed: 0, failed: 1, results }; }
    const srv = makeServer();
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const iso = (h) => new Date(Date.now() - h * 3600000).toISOString();
    const cfgRmm = (window.root && window.root.config && window.root.config.rmm) || null;
    let pid = null;

    try {
      store.useBackend(srv);
      store.resetAllLocal();
      T.reload();
      await M.seed({ force: true });

      /* ── surface ── */
      check("reports: the console API is exposed",
        ["run", "toCsv", "toJson", "export", "download", "nextRun", "addSchedule", "updateSchedule", "removeSchedule", "listSchedules", "dueSchedules", "runSchedule", "runDue", "deliver", "deliverReport", "listDeliveries", "renderLibrary", "renderSchedules", "renderDeliveries", "renderInto"].every((f) => typeof RP[f] === "function"));
      check("reports: the library defines the required reports",
        ["device-health", "patch-compliance", "monitor-compliance", "alert-summary", "asset-inventory", "backup-status"].every((id) => !!RP.report(id)), RP.REPORT_IDS.join(","));

      /* ── fixture ── */
      pid = (await T.create({ name: "Rep " + uid })).provider.id;
      const dv = (await D.add(pid, { hostname: "REP-A", os: { family: "Windows", name: "Windows 11" }, agent: { version: "1.0.0" }, lastSeenAt: iso(0.05), manufacturer: "Dell", model: "XPS", serial: "SN1", ramBytes: 8589934592 })).device;
      await D.add(pid, { hostname: "REP-B", os: { family: "Linux", name: "Ubuntu" }, agent: { version: "1.0.0" }, lastSeenAt: iso(5) });
      await AL.fire(pid, { monitorId: "mon-rep", monitorName: "Disk", monitorType: "disk", deviceId: dv.id, severityId: "sev-critical", severityRank: 30, state: "warning", subject: "Disk full", value: 2, at: iso(2) }, { silent: true });

      /* ── run every report ── */
      for (const def of RP.REPORTS) {
        const rep = await RP.run(pid, def.id, {});
        check("reports: " + def.id + " runs and returns a stable report object",
          !rep.error && rep.schema === "rmm.report" && rep.version === 1 && Array.isArray(rep.columns) && Array.isArray(rep.rows) && rep.reportId === def.id,
          JSON.stringify(rep.error || ""));
      }
      const dh = await RP.run(pid, "device-health", {});
      check("reports: device-health has one row per device", dh.rows.length === 2 && dh.rows.some((r) => r.hostname === "REP-A"));
      const inv = await RP.run(pid, "asset-inventory", {});
      check("reports: asset-inventory carries the hardware record", inv.rows.some((r) => r.serial === "SN1" && r.manufacturer === "Dell"));
      const al = await RP.run(pid, "alert-summary", {});
      check("reports: alert-summary computes response times from the alert record", al.rows.length >= 1 && "mttaMinutes" in al.rows[0] && "mttrMinutes" in al.rows[0]);

      /* ── stable export ── */
      const csv = RP.export(dh, "csv");
      const lines = csv.trim().split("\n");
      check("reports: CSV export writes a stable header", lines[0].indexOf("Device") !== -1 && lines[0].indexOf("Status") !== -1 && lines.length === dh.rows.length + 1);
      const js = RP.export(dh, "json");
      check("reports: JSON export round-trips", JSON.parse(js).reportId === "device-health");
      check("reports: CSV cells with commas are quoted", RP.toCsv({ columns: [{ key: "a", label: "A" }], rows: [{ a: "x,y" }] }) .indexOf('"x,y"') !== -1);

      /* ── schedule cadence ── */
      const base = Date.UTC(2026, 0, 1, 8, 0, 0); // 2026-01-01 08:00Z (Thursday)
      const daily = RP.nextRun({ frequency: "daily", timeOfDay: "07:00" }, base);
      check("reports: a daily schedule after its time rolls to the next day", daily === new Date(Date.UTC(2026, 0, 2, 7, 0, 0)).toISOString(), daily);
      const weekly = RP.nextRun({ frequency: "weekly", timeOfDay: "09:00", daysOfWeek: ["mon"] }, base);
      check("reports: a weekly schedule finds the next weekday", new Date(weekly).getUTCDay() === 1 && Date.parse(weekly) > base, weekly);
      const monthly = RP.nextRun({ frequency: "monthly", timeOfDay: "06:00", dayOfMonth: 15 }, base);
      check("reports: a monthly schedule lands on the chosen day", new Date(monthly).getUTCDate() === 15 && Date.parse(monthly) > base, monthly);

      /* ── schedules CRUD ── */
      const add = await RP.addSchedule(pid, { name: "Weekly health", reportIds: ["device-health"], frequency: "weekly", timeOfDay: "07:00", daysOfWeek: ["mon"], delivery: "link" });
      check("reports: a schedule is created with a computed next run", add.ok && !!add.schedule.nextRunAt && add.schedule.reportIds.indexOf("device-health") !== -1);
      check("reports: a schedule without reports is refused", (await RP.addSchedule(pid, { name: "Empty", reportIds: [] })).error === "no_reports");
      const schedId = add.schedule.id;
      check("reports: the schedule list resolves it", (await RP.listSchedules(pid, {})).some((s) => s.id === schedId));
      const upd = await RP.updateSchedule(pid, schedId, { name: "Weekly health (v2)" });
      check("reports: a schedule can be edited", upd.ok && upd.schedule.name === "Weekly health (v2)" && upd.schedule.createdAt === add.schedule.createdAt);

      /* ── run + deliver ── */
      const run = await RP.runSchedule(pid, schedId, {});
      check("reports: running a schedule delivers its reports", !run.error && run.reports === 1 && run.delivery && run.delivery.status !== "failed", JSON.stringify(run));
      const after = await RP.getSchedule(schedId);
      check("reports: a run stamps lastRunAt and advances nextRunAt", !!after.lastRunAt && Date.parse(after.nextRunAt) > Date.parse(after.lastRunAt));
      const dels = await RP.listDeliveries(pid, {});
      check("reports: the delivery is recorded with the reports it carried", dels.length >= 1 && dels[0].reportIds.indexOf("device-health") !== -1 && !!dels[0].link);
      const onDemand = await RP.deliverReport(pid, "asset-inventory", {});
      check("reports: an on-demand delivery is recorded", !onDemand.error && (await RP.listDeliveries(pid, {})).length >= 2);

      /* ── due sweep ── */
      await RP.updateSchedule(pid, schedId, { nextRunAt: iso(1) });
      const due = await RP.runDue(pid, {});
      check("reports: the due sweep runs a past-due schedule", due.ran >= 1);
      const removed = await RP.removeSchedule(pid, schedId);
      check("reports: a schedule can be deleted", removed.ok && !(await RP.getSchedule(schedId)));

      /* ── config gate ── */
      if (cfgRmm) {
        cfgRmm.reportsEnabled = false;
        check("reports: reportsEnabled=false disables running", (await RP.run(pid, "device-health", {})).error === "reports_disabled");
        cfgRmm.reportsEnabled = true;
      }

      /* ── the rendered console ── */
      const host = document.createElement("div");
      document.body.appendChild(host);
      const inst = await RP.renderInto(host, { providerId: pid, providers: [{ id: pid, name: "Rep client" }], toast() {} });
      check("reports: the console renders three tabs with the library",
        host.querySelectorAll("[data-tab]").length === 3 && host.textContent.indexOf("Report library") !== -1 && host.querySelectorAll('[data-act="rp-run"]').length === RP.REPORTS.length);
      const schedTab = host.querySelector('[data-tab="schedules"]');
      if (schedTab) schedTab.click();
      await wait(STEP * 4);
      check("reports: the schedules tab renders a create control", !!host.querySelector('[data-act="rp-sched-new"]'));
      const newBtn = host.querySelector('[data-act="rp-sched-new"]');
      if (newBtn) {
        newBtn.click();
        await wait(STEP * 4);
        const modal = document.querySelector("#uiModal");
        const nameInput = modal && modal.querySelector('[name="s_name"]');
        check("reports: the schedule editor opens with a report picker", !!modal && !!nameInput && modal.querySelectorAll(".rmm-check-list .erp-check").length === RP.REPORTS.length);
        if (nameInput) {
          nameInput.value = "Editor schedule";
          const save = modal.querySelector('[data-act="rp-sched-save"]');
          if (save) save.click();
          await wait(STEP * 5);
          check("reports: the schedule editor saves", (await RP.listSchedules(pid, {})).some((s) => s.name === "Editor schedule"));
        }
        ERP.ui.closeModal();
      }
      const delTab = host.querySelector('[data-tab="deliveries"]');
      if (delTab) delTab.click();
      await wait(STEP * 4);
      check("reports: the deliveries tab renders the delivery history", host.textContent.indexOf("Deliveries") !== -1);
      host.remove();

      check("reports: every canonical file stays in the rmm namespace", Object.keys(srv.files).every((n) => n.indexOf("rmm-v1-") === 0));
    } catch (e) {
      check("reports: harness did not crash", false, (e && e.stack) || String(e));
    } finally {
      try { store.useBackend(null); } catch (e) {}
      try { store.resetAllLocal(); } catch (e) {}
      try { T.reload(); } catch (e) {}
      try { await M.seed(); } catch (e) {}
      try { if (cfgRmm) cfgRmm.reportsEnabled = true; } catch (e) {}
    }

    const passed = results.filter((r) => r.ok).length;
    const failed = results.length - passed;
    return { passed, failed, results };
  };

  /* ═══════════════════════════════════════════════════════════════
     Task 42 — integrations & bus publication
     ═══════════════════════════════════════════════════════════════ */

  window.RMMIntegrationsTest = async function (opts) {
    opts = opts || {};
    results.length = 0;
    const ERP = window.ERP;
    const store = ERP.store;
    const T = ERP.tenancy;
    const D = ERP.devices;
    const M = ERP.masterConfig;
    const INT = ERP.integrations;
    const uid = Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
    const STEP = 150;

    function makeServer() {
      const files = {};
      return {
        files,
        async get(name) { return Object.prototype.hasOwnProperty.call(files, name) ? files[name] : null; },
        async set(name, json) { const prev = files[name]; files[name] = json; return { created: prev === undefined, unchanged: prev === json, editKey: "k_" + name, superseded: false, error: null }; },
      };
    }
    if (!INT || !D || !M) { check("integrations: ERP.integrations + devices + master exposed", false); return { passed: 0, failed: 1, results }; }
    const srv = makeServer();
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const iso = (h) => new Date(Date.now() - h * 3600000).toISOString();
    const cfgRmm = (window.root && window.root.config && window.root.config.rmm) || null;
    const origSender = INT.sender;
    let pid = null;

    try {
      store.useBackend(srv);
      store.resetAllLocal();
      T.reload();
      await M.seed({ force: true });

      /* ── surface ── */
      check("integrations: the console API is exposed",
        ["ingest", "records", "getRecord", "drift", "driftCount", "resolve", "resolveAll", "setRmmField", "setOwnership", "ownershipMap", "envelope", "publish", "publications", "dispatch", "addWebhook", "listWebhooks", "updateWebhook", "removeWebhook", "testWebhook", "analyticsExtract", "exportAnalytics", "renderInto", "render"].every((f) => typeof INT[f] === "function"),
        ["ingest", "publish", "analyticsExtract"].filter((f) => typeof INT[f] !== "function").join(","));
      check("integrations: the shared constants are exposed",
        INT.ENVELOPE_VERSION === 1 && INT.ENVELOPE_SCHEMA === "rmm.event.v1" && INT.ANALYTICS_VERSION === 1 && INT.ANALYTICS_SCHEMA === "rmm.analytics.v1" && INT.SOURCES.length === 2 && INT.ENTITY_TYPES.length === 3);

      /* ── fixture ── */
      pid = (await T.create({ name: "Int " + uid })).provider.id;
      const dev = (await D.add(pid, { hostname: "INT-A", os: { family: "Windows", name: "Windows 11" }, agent: { version: "1.0.0" }, lastSeenAt: iso(0.05) })).device;

      /* ── ingest & field ownership ── */
      const ing = await INT.ingest(pid, "psa-u", { entityType: "company", externalId: "co-1", fields: { name: "Acme Ltd", servicePlan: "Gold", phone: "+15550000", tags: "vip" } }, {});
      check("integrations: an external record is ingested", ing.ok && ing.ingested === 1 && ing.created === 1, JSON.stringify(ing));
      const recs = await INT.records(pid, {});
      check("integrations: the record stores both copies", recs.length === 1 && recs[0].external.name === "Acme Ltd" && recs[0].agreed.name === "Acme Ltd");
      check("integrations: no drift is raised on a clean first ingest", (await INT.drift(pid, {})).length === 0);
      const own = await INT.ownershipMap(pid);
      check("integrations: ownership is published per entity type", own.length === 3 && own.every((g) => g.fields && Object.keys(g.fields).length > 0));

      /* ── drift: an RMM-owned field the source also sets ── */
      const recordId = recs[0].id;
      const setRmm = await INT.setRmmField(pid, recordId, "notes", "RMM canonical note");
      check("integrations: setRmmField stores the RMM value", setRmm.ok && (await INT.getRecord(pid, recordId)).rmm.notes === "RMM canonical note");
      const ing2 = await INT.ingest(pid, "psa-u", { entityType: "company", externalId: "co-1", fields: { notes: "psa wants this note" } }, {});
      const open = await INT.drift(pid, {});
      check("integrations: an RMM-owned field that the source changes raises drift", open.length === 1 && open[0].field === "notes" && open[0].owner === "rmm" && open[0].mode === "rmm-owned", JSON.stringify(open));
      const resolved = await INT.resolve(pid, open[0].id, { keep: "rmm" });
      check("integrations: drift can be resolved keeping the RMM value", resolved.ok && resolved.entry.status === "resolved" && (await INT.drift(pid, {})).length === 0);
      check("integrations: the RMM value survives the resolution", (await INT.getRecord(pid, recordId)).rmm.notes === "RMM canonical note");

      /* ── ownership change governs future writes ── */
      await INT.setOwnership(pid, "company", "notes", "external");
      const ing3 = await INT.ingest(pid, "psa-u", { entityType: "company", externalId: "co-1", fields: { notes: "RMM canonical note" } }, {});
      const rec3 = await INT.getRecord(pid, recordId);
      check("integrations: an ownership change re-attributes the field without raising drift for an agreed value", ing3.drift === 0 && rec3.agreed.notes === "RMM canonical note", JSON.stringify({ d: ing3.drift, n: rec3.agreed.notes }));
      await INT.setOwnership(pid, "company", "notes", "rmm");

      /* ── external-owned overwrite drift ── */
      await INT.ingest(pid, "psa-u", { entityType: "company", externalId: "co-1", fields: { name: "Acme Renamed" } }, {});
      const ov = (await INT.drift(pid, {}));
      check("integrations: an external edit is recorded as drift against the previous agreement", ov.length === 1 && ov[0].field === "name" && ov[0].mode === "external-overwrite" && ov[0].rmmValue === "Acme Ltd" && ov[0].externalValue === "Acme Renamed");
      const keepExt = await INT.resolve(pid, ov[0].id, { keep: "external" });
      check("integrations: drift can be resolved taking the external value", keepExt.ok && (await INT.getRecord(pid, recordId)).agreed.name === "Acme Renamed");

      /* ── envelope & publication ── */
      const env = INT.envelope({ kind: "device-state", deviceId: dev.id, from: "online", to: "offline", providerId: pid });
      check("integrations: the envelope is the shared versioned shape",
        env.v === 1 && env.schema === "rmm.event.v1" && env.source === "rmm-u" && env.type === "device.health" && env.subject === dev.id && !!env.id && !!env.time,
        JSON.stringify(env));
      check("integrations: alert and job events map to stable types",
        INT.envelope({ kind: "alert" }).type === "alert" && INT.envelope({ kind: "job" }).type === "job.result");

      const stub = { calls: [] };
      INT.sender = async (d) => { stub.calls.push(d); return { ok: true, status: 200 }; };
      const pub = await INT.publish(pid, { kind: "device-state", deviceId: dev.id, to: "offline", providerId: pid }, {});
      check("integrations: publishing logs the envelope", pub.ok && (await INT.publications(pid, {})).length === 1 && (await INT.publications(pid, {}))[0].type === "device.health");
      check("integrations: publishing with no webhooks delivers nowhere", pub.deliveries.length === 0);

      /* ── webhooks ── */
      const bad = await INT.addWebhook(pid, { name: "Bad", url: "not-a-url" });
      check("integrations: a webhook without an http URL is refused", bad.error === "invalid_url");
      const wh = await INT.addWebhook(pid, { name: "NOC", url: "https://hooks.example.com/rmm", events: ["*"], secret: "s3cret" });
      check("integrations: a webhook is created", wh.ok && /^wh-/.test(wh.webhook.id));
      const pub2 = await INT.publish(pid, { kind: "alert", alertId: "a1", providerId: pid }, {});
      check("integrations: a published event is delivered to a matching webhook", pub2.deliveries.length === 1 && pub2.deliveries[0].ok && stub.calls.length >= 1);
      check("integrations: the webhook is signed when a secret is set", stub.calls[0].headers["X-RMM-Signature"] !== undefined);
      const whList = await INT.listWebhooks(pid);
      check("integrations: the webhook delivery is recorded", whList[0].deliveries.length >= 1 && whList[0].lastStatus === "ok");
      const tested = await INT.testWebhook(pid, wh.webhook.id);
      check("integrations: a webhook can be tested", tested.ok && tested.deliveries.length === 1);
      const upd = await INT.updateWebhook(pid, wh.webhook.id, { name: "NOC v2", events: ["alert"] });
      check("integrations: a webhook can be edited", upd.ok && upd.webhook.name === "NOC v2");
      const pub3 = await INT.publish(pid, { kind: "device-state", deviceId: "x", providerId: pid }, {});
      check("integrations: a non-matching event is not delivered", pub3.deliveries.length === 0);
      const rm = await INT.removeWebhook(pid, wh.webhook.id);
      check("integrations: a webhook can be deleted", rm.ok && (await INT.listWebhooks(pid)).length === 0);
      INT.sender = origSender;

      /* ── analytics extract ── */
      const an = await INT.analyticsExtract(pid, {});
      check("integrations: the analytics extract is schema-stable",
        an.schema === "rmm.analytics.v1" && an.version === 1 && ["devices", "alerts", "patchCompliance", "securityPosture", "backupStatus", "jobs"].every((t) => an.tables[t]),
        Object.keys(an.tables || {}).join(","));
      check("integrations: the extract carries one row per device", an.tables.devices.rows.length === 1 && an.tables.devices.rows[0].hostname === "INT-A");
      check("integrations: every table declares its columns", Object.keys(an.tables).every((t) => Array.isArray(an.tables[t].columns) && an.tables[t].columns.length > 0));
      const json = INT.exportAnalytics(an, "json");
      check("integrations: the extract exports as JSON", JSON.parse(json).schema === "rmm.analytics.v1");
      const nd = INT.exportAnalytics(an, "ndjson").trim().split("\n");
      const totalRows = Object.keys(an.tables).reduce((a, k) => a + an.tables[k].rows.length, 0);
      check("integrations: the extract exports as NDJSON",
        nd.length === totalRows && JSON.parse(nd[0]).table === "devices" && nd.some((l) => JSON.parse(l).table === "backupStatus"),
        JSON.stringify({ lines: nd.length, totalRows }));

      /* ── API facade ── */
      check("integrations: ERP.api is exposed with the read API", ERP.api === INT.api && ERP.api.version === 1);
      const apiDevices = await ERP.api.devices(pid);
      check("integrations: api.devices lists the fleet", apiDevices.length === 1 && apiDevices[0].hostname === "INT-A");
      check("integrations: api.alerts and api.compliance answer", Array.isArray(await ERP.api.alerts(pid)) && !!(await ERP.api.compliance(pid)).patch !== false);
      check("integrations: api.analytics returns the extract", (await ERP.api.analytics(pid)).schema === "rmm.analytics.v1");

      /* ── config gate ── */
      if (cfgRmm) {
        cfgRmm.integrationsEnabled = false;
        check("integrations: integrationsEnabled=false disables ingest", (await INT.ingest(pid, "psa-u", { entityType: "company", externalId: "x", fields: { name: "x" } }, {})).error === "integrations_disabled");
        cfgRmm.integrationsEnabled = true;
      }

      /* ── the rendered console ── */
      const host = document.createElement("div");
      document.body.appendChild(host);
      const inst = await INT.renderInto(host, { providerId: pid, providers: [{ id: pid, name: "Int client" }], toast() {} });
      check("integrations: the console renders three tabs",
        host.querySelectorAll("[data-tab]").length === 3 && !!host.querySelector('[data-tab="webhooks"]') && !!host.querySelector('[data-tab="analytics"]'));
      check("integrations: the sources tab renders ownership, records and drift", host.textContent.indexOf("Field ownership") !== -1 && host.textContent.indexOf("External records") !== -1);
      const simBtn = host.querySelector('[data-act="int-sim"]');
      if (simBtn) {
        simBtn.click();
        await wait(STEP * 5);
        check("integrations: simulating an ingest adds a record", (await INT.records(pid, {})).length >= 2);
      }
      const whTab = host.querySelector('[data-tab="webhooks"]');
      if (whTab) whTab.click();
      await wait(STEP * 4);
      check("integrations: the webhooks tab renders the webhook table", host.textContent.indexOf("Outbound webhooks") !== -1 && host.textContent.indexOf("Recent publications") !== -1);
      const anTab = host.querySelector('[data-tab="analytics"]');
      if (anTab) anTab.click();
      await wait(STEP * 5);
      check("integrations: the analytics tab renders the extract tables", host.textContent.indexOf("Analytics extract") !== -1 && host.textContent.indexOf("rmm.analytics.v1") !== -1);
      host.remove();

      check("integrations: every canonical file stays in the rmm namespace", Object.keys(srv.files).every((n) => n.indexOf("rmm-v1-") === 0));
    } catch (e) {
      check("integrations: harness did not crash", false, (e && e.stack) || String(e));
    } finally {
      try { INT.sender = origSender; } catch (e) {}
      try { store.useBackend(null); } catch (e) {}
      try { store.resetAllLocal(); } catch (e) {}
      try { T.reload(); } catch (e) {}
      try { await M.seed(); } catch (e) {}
      try { if (cfgRmm) cfgRmm.integrationsEnabled = true; } catch (e) {}
    }

    const passed = results.filter((r) => r.ok).length;
    const failed = results.length - passed;
    return { passed, failed, results };
  };

  /* ═══════════════════════════════════════════════════════════════
     Task 43 — data-quality linter
     ═══════════════════════════════════════════════════════════════ */

  window.RMMDataQualityTest = async function (opts) {
    opts = opts || {};
    results.length = 0;
    const ERP = window.ERP;
    const store = ERP.store;
    const T = ERP.tenancy;
    const D = ERP.devices;
    const MON = ERP.monitors;
    const LIB = ERP.scripts;
    const G = ERP.groups;
    const AL = ERP.alerts;
    const M = ERP.masterConfig;
    const DQ = ERP.dataQuality;
    const uid = Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
    const STEP = 150;

    function makeServer() {
      const files = {};
      return {
        files,
        async get(name) { return Object.prototype.hasOwnProperty.call(files, name) ? files[name] : null; },
        async set(name, json) { const prev = files[name]; files[name] = json; return { created: prev === undefined, unchanged: prev === json, editKey: "k_" + name, superseded: false, error: null }; },
      };
    }
    if (!DQ || !D || !M || !MON || !LIB || !G || !AL) { check("dataquality: ERP.dataQuality + engines exposed", false); return { passed: 0, failed: 1, results }; }
    const srv = makeServer();
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const iso = (h) => new Date(Date.now() - h * 3600000).toISOString();
    const agoMin = (m) => new Date(Date.now() - m * 60000).toISOString();
    const cfgRmm = (window.root && window.root.config && window.root.config.rmm) || null;
    let pid = null;

    try {
      store.useBackend(srv);
      store.resetAllLocal();
      T.reload();
      await M.seed({ force: true });

      /* ── surface ── */
      check("dataquality: the linter API is exposed",
        ["scan", "scanProvider", "scanAll", "duplicateGroups", "monitorRouted", "alertStuck", "unsafeParameters", "isUnsafeParameter", "ownerOf", "renderPanel", "renderInto", "summaryText"].every((f) => typeof DQ[f] === "function"),
        ["scan", "scanProvider", "renderPanel"].filter((f) => typeof DQ[f] !== "function").join(","));
      check("dataquality: eight checks are catalogued with severity + category",
        DQ.CHECKS.length === 8 && DQ.CHECKS.every((c) => c.id && c.label && c.category && DQ.SEVERITY_WEIGHT[c.severity]) &&
        DQ.CHECKS.map((c) => c.id).join(",") === "agent-stale,device-unassigned,no-policy,duplicate-device,orphan-group,unrouted-monitor,alert-stuck,unsafe-script");
      check("dataquality: stations are mapped for the record types",
        DQ.stationFor("device").route === "#/devices" && DQ.stationFor("monitor").route === "#/monitors" &&
        DQ.stationFor("script").route === "#/automations:library" && DQ.stationFor("nope") === null);

      /* ── pure helpers ── */
      check("dataquality: ownerOf reads custom.owner and owner",
        DQ.ownerOf({ custom: { owner: "Ops" } }) === "Ops" && DQ.ownerOf({ owner: "Sam" }) === "Sam" && DQ.ownerOf({}) === "");
      check("dataquality: an unbounded string parameter is unsafe",
        DQ.isUnsafeParameter({ type: "string", pattern: "", maxLength: null }).code === "unbounded-string");
      check("dataquality: a pattern or maxLength bounds a string",
        DQ.isUnsafeParameter({ type: "string", pattern: "^[a-z]+$" }) === null && DQ.isUnsafeParameter({ type: "string", maxLength: 40 }) === null);
      check("dataquality: a string default with shell metacharacters is flagged for review",
        DQ.isUnsafeParameter({ type: "string", pattern: "^.*$", default: "a;rm -rf /" }).code === "metachar-default");
      check("dataquality: an empty enum and an unbounded number are unsafe",
        DQ.isUnsafeParameter({ type: "enum", options: [] }).code === "empty-enum" &&
        DQ.isUnsafeParameter({ type: "number", min: null, max: null }).code === "unbounded-number");
      check("dataquality: a bool and a bounded number are safe",
        DQ.isUnsafeParameter({ type: "bool" }) === null && DQ.isUnsafeParameter({ type: "number", min: 0, max: 5 }) === null);
      check("dataquality: unsafeParameters reports each offending parameter",
        (() => { const l = DQ.unsafeParameters({ parameters: [{ name: "a", type: "string" }, { name: "b", type: "string", pattern: "^x$" }, { name: "c", type: "enum", options: [] }] }); return l.length === 2 && l[0].name === "a" && l[1].name === "c"; })());
      check("dataquality: humanDur renders minutes, hours and days",
        DQ.humanDur(30 * 60000) === "30m" && DQ.humanDur(5 * 3600000) === "5h" && DQ.humanDur(72 * 3600000).indexOf("d") !== -1);

      const dupGroups = DQ.duplicateGroups([
        { id: "a", hostname: "WEB", serial: "S1" }, { id: "b", hostname: "web", serial: "S2" }, { id: "c", hostname: "DB", serial: "S2" },
      ], ["hostname", "serial"]);
      check("dataquality: duplicateGroups normalises case and groups by field",
        dupGroups.length === 2 && dupGroups.some((g) => g.field === "hostname" && g.value === "web" && g.devices.length === 2) &&
        dupGroups.some((g) => g.field === "serial" && g.value === "s2" && g.devices.length === 2),
        JSON.stringify(dupGroups.map((g) => g.field + ":" + g.value)));
      check("dataquality: duplicateGroups ignores blank values",
        DQ.duplicateGroups([{ id: "a", hostname: "" }, { id: "b", hostname: "  " }], ["hostname"]).length === 0);

      /* ── monitor → route coverage ── */
      const rnk = (id) => (DQ.DEFAULT_RANKS[id] == null ? null : DQ.DEFAULT_RANKS[id]);
      const mDevices = [{ id: "d1", tags: ["prod"], status: "online", siteId: "s1", groupIds: [] }];
      const mProvider = { id: "p", devices: mDevices };
      const monProd = { id: "m1", name: "CPU", severity: "sev-warning", targets: { tags: ["prod"] } };
      check("dataquality: a route with matching targets and severity covers a monitor",
        DQ.monitorRouted(monProd, [{ id: "r1", label: "R", enabled: true, tags: ["prod"] }], { provider: mProvider, devices: mDevices, rankOf: rnk }).routed === true);
      check("dataquality: a route whose severity window excludes the monitor does not cover it",
        DQ.monitorRouted(monProd, [{ id: "r1", label: "R", enabled: true, tags: ["prod"], severityAtMost: "sev-info" }], { provider: mProvider, devices: mDevices, rankOf: rnk }).routed === false);
      check("dataquality: a disabled matching route is reported separately",
        (() => { const r = DQ.monitorRouted(monProd, [{ id: "r1", label: "R", enabled: false, tags: ["prod"] }], { provider: mProvider, devices: mDevices, rankOf: rnk }); return r.routed === false && r.disabledMatches.length === 1; })());
      check("dataquality: a monitor that targets nothing is not covered",
        (() => { const r = DQ.monitorRouted({ id: "m2", name: "Ghost", severity: "sev-warning", targets: { tags: ["ghost"] } }, [{ id: "r1", label: "R", enabled: true }], { provider: mProvider, devices: mDevices, rankOf: rnk }); return r.routed === false && r.covered === 0; })());
      check("dataquality: an explicit monitorId targets the monitor",
        DQ.monitorRouted(monProd, [{ id: "r1", label: "R", enabled: true, monitorIds: ["m1"] }], { provider: mProvider, devices: mDevices, rankOf: rnk }).routed === true);
      check("dataquality: a route for a different monitor id does not cover it",
        DQ.monitorRouted(monProd, [{ id: "r1", label: "R", enabled: true, monitorIds: ["other"] }], { provider: mProvider, devices: mDevices, rankOf: rnk }).routed === false);

      /* ── stuck alerts ── */
      const aMap = { m1: { id: "m1", name: "CPU", enabled: true }, m2: { id: "m2", name: "Off", enabled: false } };
      const dMap = { d1: { id: "d1" } };
      const codes = (a) => DQ.alertStuck(a, { monitorsById: aMap, devicesById: dMap }).map((r) => r.code);
      check("dataquality: an active alert whose monitor is gone is stuck",
        codes({ id: "a", state: "firing", monitorId: "gone", deviceId: "d1" }).indexOf("monitor-missing") !== -1);
      check("dataquality: an active alert whose monitor is disabled is stuck",
        codes({ id: "a", state: "acknowledged", monitorId: "m2", deviceId: "d1" }).indexOf("monitor-disabled") !== -1);
      check("dataquality: an active alert whose device is gone is stuck",
        codes({ id: "a", state: "firing", monitorId: "m1", deviceId: "gone" }).indexOf("device-missing") !== -1);
      check("dataquality: a manual alert open past the threshold is flagged",
        DQ.alertStuck({ id: "a", state: "firing", monitorId: "", firstFiredAt: iso(24 * 40) }, { monitorsById: aMap, devicesById: dMap, manualDays: 30 }).map((r) => r.code).indexOf("manual-stale") !== -1);
      check("dataquality: a healthy active alert is not flagged", codes({ id: "a", state: "firing", monitorId: "m1", deviceId: "d1" }).length === 0);

      /* ── a pure provider exercising all eight checks ── */
      const pdev = (o) => Object.assign({ status: "online", lastSeenAt: agoMin(3), os: { family: "Windows" } }, o);
      const prov = {
        id: "dq-pure", name: "Pure DQ",
        sites: [{ id: "site-1", name: "HQ" }],
        devices: [
          pdev({ id: "dev-on", hostname: "DQ-ON", siteId: "site-1", custom: { owner: "Ops" }, tags: ["prod"], groupIds: ["grp-ok"] }),
          pdev({ id: "dev-off", hostname: "DQ-OFF", siteId: "site-1", custom: { owner: "Ops" }, lastSeenAt: iso(3), groupIds: ["grp-ok"] }),
          pdev({ id: "dev-crit", hostname: "DQ-CRIT", siteId: "site-1", custom: { owner: "Ops" }, status: "offline", lastSeenAt: iso(24 * 10) }),
          pdev({ id: "dev-stale", hostname: "DQ-STALE", siteId: "site-1", custom: { owner: "Ops" }, lastSeenAt: agoMin(30) }),
          { id: "dev-unk", hostname: "DQ-UNK", status: "online", siteId: "site-1", custom: { owner: "Ops" }, tags: ["db"], os: { family: "Windows" } },
          pdev({ id: "dev-un", hostname: "DQ-UN", siteId: null }),
          pdev({ id: "dev-dup1", hostname: "DQ-DUP", siteId: "site-1", custom: { owner: "Ops" }, serial: "SN-DUP" }),
          pdev({ id: "dev-dup2", hostname: "DQ-DUP", siteId: "site-1", custom: { owner: "Ops" }, serial: "SN-DUP" }),
        ],
        deviceGroups: [
          { id: "grp-ok", name: "OK", kind: "static", siteId: "site-1" },
          { id: "grp-dangling", name: "Dangling", kind: "static", siteId: "site-missing" },
          { id: "grp-empty", name: "Empty", kind: "static" },
        ],
        policies: [{ id: "pol-prod", name: "Prod only", enabled: true, targets: { tags: ["prod"] }, settings: {} }],
        monitorDefinitions: [
          { id: "mon-ok", name: "OK", type: "cpu", enabled: true, severity: "sev-warning", targets: { tags: ["prod"] } },
          { id: "mon-uncovered", name: "Ghost", type: "cpu", enabled: true, severity: "sev-warning", targets: { tags: ["ghost"] } },
          { id: "mon-noroute", name: "Emergency", type: "cpu", enabled: true, severity: "sev-emergency", targets: { tags: ["prod"] } },
          { id: "mon-disabledroute", name: "Db", type: "cpu", enabled: true, severity: "sev-warning", targets: { tags: ["db"] } },
          { id: "mon-off", name: "Off", type: "cpu", enabled: false, severity: "sev-warning", targets: { tags: ["prod"] } },
        ],
        scriptLibrary: [
          { id: "scr-bad", name: "Bad", enabled: true, parameters: [{ name: "svc", type: "string" }, { name: "n", type: "number", min: null, max: null }, { name: "mode", type: "enum", options: [] }] },
          { id: "scr-ok", name: "Good", enabled: true, parameters: [{ name: "svc", type: "string", pattern: "^[a-z]+$" }, { name: "n", type: "number", min: 1, max: 9 }, { name: "flag", type: "bool" }, { name: "mode", type: "enum", options: ["a"] }] },
          { id: "scr-meta", name: "Meta", enabled: true, parameters: [{ name: "cmd", type: "string", pattern: "^.*$", default: "a;rm -rf /" }] },
        ],
        alerts: [
          { id: "al-gone", state: "firing", monitorId: "mon-gone", deviceId: "dev-on", severityId: "sev-warning", subject: "Gone" },
          { id: "al-disabled", state: "acknowledged", monitorId: "mon-off", deviceId: "dev-gone", severityId: "sev-warning", subject: "Off" },
          { id: "al-manual", state: "firing", monitorId: "", deviceId: "dev-on", firstFiredAt: iso(24 * 40), severityId: "sev-warning", subject: "Manual" },
          { id: "al-ok", state: "firing", monitorId: "mon-ok", deviceId: "dev-on", severityId: "sev-warning", subject: "OK" },
          { id: "al-resolved", state: "resolved", monitorId: "mon-gone", subject: "Done" },
        ],
      };
      const routes = [
        { id: "rt-prod", label: "Prod", enabled: true, severityAtMost: "sev-warning", tags: ["prod"] },
        { id: "rt-db-off", label: "DB (off)", enabled: false, tags: ["db"] },
      ];
      const pure = DQ.scanProvider(prov, { routes, rankOf: rnk });

      check("dataquality: the pure scan counts every finding",
        pure.counts.total === 27 && pure.counts.bySeverity.critical === 1 && pure.counts.bySeverity.warning === 14 && pure.counts.bySeverity.info === 12,
        JSON.stringify(pure.counts.bySeverity) + " total " + pure.counts.total);
      check("dataquality: findings are grouped by check",
        pure.counts.byCheck["agent-stale"] === 4 && pure.counts.byCheck["device-unassigned"] === 1 && pure.counts.byCheck["no-policy"] === 7 &&
        pure.counts.byCheck["duplicate-device"] === 4 && pure.counts.byCheck["orphan-group"] === 3 && pure.counts.byCheck["unrouted-monitor"] === 3 &&
        pure.counts.byCheck["alert-stuck"] === 3 && pure.counts.byCheck["unsafe-script"] === 2,
        JSON.stringify(pure.counts.byCheck));
      check("dataquality: scanned counts reflect the aggregate",
        pure.scanned.devices === 8 && pure.scanned.groups === 3 && pure.scanned.monitors === 5 && pure.scanned.routes === 2 && pure.scanned.alerts === 5 && pure.scanned.scripts === 3,
        JSON.stringify(pure.scanned));
      check("dataquality: every finding carries the offending record and a station",
        pure.findings.every((f) => f.record && f.entity && f.entity.type && f.entity.id && f.station && f.hint));

      const find = (chk, id) => pure.findings.filter((f) => f.check === chk && String(f.entity.id) === String(id));
      check("dataquality: agent-stale grades offline by age and never-seen separately",
        find("agent-stale", "dev-crit")[0].severity === "critical" && find("agent-stale", "dev-off")[0].severity === "warning" &&
        find("agent-stale", "dev-stale")[0].severity === "info" && find("agent-stale", "dev-unk")[0].severity === "warning" && find("agent-stale", "dev-on").length === 0);
      check("dataquality: the finding names the offending device record", find("agent-stale", "dev-crit")[0].record.hostname === "DQ-CRIT");
      check("dataquality: device-unassigned flags the site-less, owner-less device",
        find("device-unassigned", "dev-un").length === 1 && find("device-unassigned", "dev-on").length === 0);
      check("dataquality: no-policy flags only devices no policy targets",
        find("no-policy", "dev-on").length === 0 && find("no-policy", "dev-off").length === 1);
      check("dataquality: duplicate-device flags both records on every shared field",
        find("duplicate-device", "dev-dup1").length === 2 && find("duplicate-device", "dev-dup2").length === 2);
      check("dataquality: orphan-group flags a dangling site and an empty group",
        find("orphan-group", "grp-dangling").some((f) => f.severity === "warning") && find("orphan-group", "grp-dangling").some((f) => f.severity === "info") &&
        find("orphan-group", "grp-empty").length === 1);
      check("dataquality: unrouted-monitor separates covered, uncovered and disabled-route cases",
        find("unrouted-monitor", "mon-ok").length === 0 && find("unrouted-monitor", "mon-uncovered").length === 1 &&
        find("unrouted-monitor", "mon-noroute").length === 1 && find("unrouted-monitor", "mon-disabledroute").length === 1 && find("unrouted-monitor", "mon-off").length === 0);
      check("dataquality: a disabled matching route is named in the finding",
        find("unrouted-monitor", "mon-disabledroute")[0].message.indexOf("DB (off)") !== -1);
      check("dataquality: alert-stuck flags missing monitor, missing device and stale manual alerts",
        find("alert-stuck", "al-gone").length === 1 && find("alert-stuck", "al-disabled").length === 1 && find("alert-stuck", "al-manual")[0].severity === "info" &&
        find("alert-stuck", "al-ok").length === 0 && find("alert-stuck", "al-resolved").length === 0);
      check("dataquality: unsafe-script flags unbounded parameters and the metachar default",
        find("unsafe-script", "scr-bad").length === 1 && find("unsafe-script", "scr-bad")[0].severity === "warning" &&
        find("unsafe-script", "scr-meta")[0].severity === "info" && find("unsafe-script", "scr-ok").length === 0);
      check("dataquality: the worst findings sort first",
        (() => { const w = pure.findings.map((f) => DQ.SEVERITY_WEIGHT[f.severity]); return w[0] === 3 && w.every((x, i) => i === 0 || w[i - 1] >= x); })());
      check("dataquality: summaryText describes the scan", DQ.summaryText(pure).indexOf("27 finding") !== -1);

      /* ── a real provider, scanned through the store ── */
      pid = (await T.create({ name: "DQ " + uid })).provider.id;
      const devA = (await D.add(pid, { hostname: "DQ-A", status: "online", lastSeenAt: agoMin(2), custom: { owner: "Ops" } })).device;
      const devB = (await D.add(pid, { hostname: "DQ-B", status: "offline", lastSeenAt: iso(24 * 10) })).device;
      const devP = (await D.add(pid, { hostname: "DQ-PROD", status: "online", lastSeenAt: agoMin(2), tags: ["prod"], custom: { owner: "Ops" } })).device;
      const monReal = (await MON.add(pid, { name: "DQ Monitor", type: "cpu", severity: "sev-warning", targets: { tags: ["prod"] } })).monitor;
      const grpReal = (await G.add(pid, { name: "DQ Empty" })).group;
      const scrReal = (await LIB.add(pid, { name: "DQ Bad", variants: [{ os: "windows", language: "powershell", script: "echo hi" }], parameters: [{ name: "thing", type: "string" }] })).script;
      const alReal = (await AL.fire(pid, { monitorId: "mon-deleted", monitorName: "Deleted", monitorType: "cpu", deviceId: devA.id, severityId: "sev-warning", severityRank: 20, subject: "Stuck", state: "warning", value: 1 })).alert;

      const scan = await DQ.scan(pid, {});
      check("dataquality: scanning a stored provider finds rot in every engine",
        !scan.error && scan.counts.byCheck["agent-stale"] >= 1 && scan.counts.byCheck["device-unassigned"] >= 1 && scan.counts.byCheck["no-policy"] >= 3 &&
        scan.counts.byCheck["orphan-group"] >= 1 && scan.counts.byCheck["unrouted-monitor"] >= 1 && scan.counts.byCheck["unsafe-script"] >= 1 && scan.counts.byCheck["alert-stuck"] >= 1,
        JSON.stringify(scan.counts ? scan.counts.byCheck : scan));
      check("dataquality: the offline device is the critical finding",
        scan.counts.bySeverity.critical >= 1 && scan.findings.some((f) => f.check === "agent-stale" && f.entity.id === devB.id && f.severity === "critical"));
      check("dataquality: the uncovered monitor is flagged by name",
        scan.findings.some((f) => f.check === "unrouted-monitor" && f.entity.id === monReal.id && f.message.indexOf("No enabled route") !== -1));
      check("dataquality: the unsafe script is flagged with its parameter",
        scan.findings.some((f) => f.check === "unsafe-script" && f.entity.id === scrReal.id && f.message.indexOf("thing") !== -1));
      check("dataquality: the stuck alert is flagged", scan.findings.some((f) => f.check === "alert-stuck" && f.entity.id === alReal.id));
      check("dataquality: the empty group is flagged", scan.findings.some((f) => f.check === "orphan-group" && f.entity.id === grpReal.id));
      check("dataquality: scanned counts match the aggregate", scan.scanned.devices === 3 && scan.scanned.monitors >= 1 && scan.scanned.scripts >= 1);

      /* ── scanAll ── */
      const all = await DQ.scanAll({ providers: [{ id: pid, name: "DQ " + uid }] });
      check("dataquality: scanAll rolls the findings up across the given clients",
        all.providers === 1 && all.total === scan.counts.total && all.bySeverity.critical >= 1, JSON.stringify({ providers: all.providers, total: all.total }));

      /* ── config gate ── */
      if (cfgRmm) {
        cfgRmm.dataQualityEnabled = false;
        check("dataquality: dataQualityEnabled=false disables the scan", (await DQ.scan(pid, {})).error === "data_quality_disabled");
        const h2 = document.createElement("div");
        document.body.appendChild(h2);
        await DQ.renderInto(h2, { providerId: pid, providers: [{ id: pid, name: "x" }] });
        check("dataquality: the console explains when the linter is disabled", h2.textContent.indexOf("turned off") !== -1);
        h2.remove();
        cfgRmm.dataQualityEnabled = true;
      }

      /* ── the rendered console ── */
      const host = document.createElement("div");
      document.body.appendChild(host);
      const inst = await DQ.renderInto(host, { providerId: pid, providers: [{ id: pid, name: "DQ client" }], toast() {} });
      check("dataquality: renderInto returns a live handle", !!(inst && inst.paint && inst.reload));
      const viewBtns = () => host.querySelectorAll('[data-act="dq-view"]').length;
      check("dataquality: the console renders KPI cards, controls and the checks reference",
        host.querySelectorAll(".erp-stat").length === 6 && !!host.querySelector("[data-dq-sev]") && !!host.querySelector("[data-dq-check]") &&
        !!host.querySelector('[data-act="dq-rescan"]') && host.textContent.indexOf("Scripts with unsafe parameters") !== -1);
      check("dataquality: the findings table lists every finding", viewBtns() === scan.counts.total, viewBtns() + " of " + scan.counts.total);
      check("dataquality: the checks reference lists all eight checks", host.querySelectorAll(".erp-table").length >= 2 && host.textContent.indexOf("Unrouted monitors") !== -1 && host.textContent.indexOf("Alerts that can never clear") !== -1);

      const sevSel = host.querySelector("[data-dq-sev]");
      sevSel.value = "critical";
      sevSel.dispatchEvent(new Event("change", { bubbles: true }));
      await wait(20);
      check("dataquality: the severity filter narrows the table", viewBtns() === scan.counts.bySeverity.critical, viewBtns() + " vs " + scan.counts.bySeverity.critical);
      sevSel.value = "all";
      sevSel.dispatchEvent(new Event("change", { bubbles: true }));
      await wait(20);
      check("dataquality: clearing the filter restores every finding", viewBtns() === scan.counts.total);

      const ckSel = host.querySelector("[data-dq-check]");
      ckSel.value = "unsafe-script";
      ckSel.dispatchEvent(new Event("change", { bubbles: true }));
      await wait(20);
      check("dataquality: the check filter narrows to one check", viewBtns() === scan.counts.byCheck["unsafe-script"], viewBtns() + " vs " + scan.counts.byCheck["unsafe-script"]);
      ckSel.value = "all";
      ckSel.dispatchEvent(new Event("change", { bubbles: true }));
      await wait(20);

      const vb = host.querySelector('[data-act="dq-view"]');
      if (vb) {
        vb.click();
        await wait(20);
        const modal = document.querySelector("#uiModal");
        check("dataquality: View opens the offending record with a jump-to-station action",
          !!modal && modal.classList.contains("open") && !!modal.querySelector("pre") && !!modal.querySelector('[data-act="dq-goto"]') && modal.textContent.indexOf("Offending record") !== -1);
        ERP.ui.closeModal();
      } else {
        check("dataquality: View opens the offending record with a jump-to-station action", false, "no view button");
      }

      const rbtn = host.querySelector('[data-act="dq-rescan"]');
      if (rbtn) { rbtn.click(); await wait(STEP * 3); }
      check("dataquality: Rescan re-runs the linter", viewBtns() === scan.counts.total, viewBtns() + " of " + scan.counts.total);
      host.remove();

      check("dataquality: every canonical file stays in the rmm namespace", Object.keys(srv.files).every((n) => n.indexOf("rmm-v1-") === 0));
    } catch (e) {
      check("dataquality: harness did not crash", false, (e && e.stack) || String(e));
    } finally {
      try { store.useBackend(null); } catch (e) {}
      try { store.resetAllLocal(); } catch (e) {}
      try { T.reload(); } catch (e) {}
      try { await M.seed(); } catch (e) {}
      try { if (cfgRmm) cfgRmm.dataQualityEnabled = true; } catch (e) {}
    }

    const passed = results.filter((r) => r.ok).length;
    const failed = results.length - passed;
    return { passed, failed, results };
  };

  /* ============================================================
     Task 44 — agent simulator
     Run via page_eval:  await window.RMMSimulatorTest()
     Covers: the deterministic agent identity, the profile and
     temperament catalogues, enrolment through the real one-time
     token → per-device credential exchange, authenticated heartbeat,
     inventory (full then delta) with asset reconciliation, metric
     sampling, job claim + answer (success, failure and un-enrolled
     paths), fleet fixtures (sites + groups + enrolled devices), the
     shared stats roll-up and the simulator console panel.
     Runs against a stub backend so the real documents are untouched.
     ============================================================ */
  window.RMMSimulatorTest = async function (opts) {
    opts = opts || {};
    results.length = 0;
    const ERP = window.ERP;
    const store = ERP.store;
    const T = ERP.tenancy;
    const D = ERP.devices;
    const E = ERP.enrollment;
    const J = ERP.jobs;
    const INV = ERP.rmmInventory;
    const MET = ERP.metrics;
    const SIM = ERP.simulator;
    const COL = ERP.collector;
    const uid = Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);

    function makeServer() {
      const files = {};
      return {
        files,
        async get(name) { return Object.prototype.hasOwnProperty.call(files, name) ? files[name] : null; },
        async set(name, json) { const prev = files[name]; files[name] = json; return { created: prev === undefined, unchanged: prev === json, editKey: "k_" + name, superseded: false, error: null }; },
      };
    }

    if (!SIM || !J || !INV || !MET) { check("simulator: ERP.simulator + engines exposed", false); return { passed: 0, failed: 1, results }; }
    const srv = makeServer();
    try {
      check("simulator: ERP.simulator exposed", ["createAgent", "enrollAgent", "heartbeat", "sendInventory", "sendMetrics", "answerJob", "cycle", "run", "runAll", "fixtures", "fullLoop", "stats", "renderPanel", "renderInto", "newSeed", "rng", "defaultFleet", "profile", "temperament"].every((f) => typeof SIM[f] === "function"));
      check("simulator: the profile catalogue spans the platforms", SIM.PROFILES.length >= 4 && SIM.PROFILES.map((p) => p.platform).indexOf("windows") !== -1 && SIM.PROFILES.map((p) => p.platform).indexOf("linux") !== -1 && SIM.PROFILES.map((p) => p.platform).indexOf("macos") !== -1);
      check("simulator: every profile carries an identity + capabilities", SIM.PROFILES.every((p) => p.id && p.label && p.os && p.os.family && p.role && asArrTest(p.capabilities).length && p.language));
      check("simulator: the temperament catalogue reaches past common thresholds", SIM.TEMPERAMENTS.length >= 5 && SIM.temperament("hot").cpu[0] >= 90 && SIM.temperament("leak").mem[0] >= 85 && SIM.temperament("full").disk[0] >= 90);
      const r1 = SIM.rng(42), r2 = SIM.rng(42);
      check("simulator: the RNG is deterministic for a seed", r1() === r2() && r1() === r2() && r1() === r2());

      /* ── agent identity ── */
      const a1 = SIM.createAgent({ profileId: "win-server", index: 0, seed: 1001 });
      const a2 = SIM.createAgent({ profileId: "win-server", index: 0, seed: 1001 });
      const a3 = SIM.createAgent({ profileId: "linux-server", index: 1, seed: 1002 });
      check("simulator: an agent carries a profile-derived identity", a1.profileId === "win-server" && a1.role === "server" && /^SRV-/.test(a1.hostname) && a1.os.family === "Windows" && a1.capabilities.indexOf("inventory") !== -1);
      check("simulator: the same seed makes the same agent", a1.id === a2.id && a1.hostname === a2.hostname && JSON.stringify(a1.interfaces) === JSON.stringify(a2.interfaces));
      check("simulator: a different profile differs", a3.platform === "linux" && a3.hostname !== a1.hostname);
      check("simulator: an agent is un-enrolled until enrolled", a1.deviceId === "" && a1.credential === "");

      /* ── fixtures: a provider with sites + devices ── */
      store.useBackend(srv);
      store.resetAllLocal();
      T.reload();
      const f = await SIM.fixtures({ name: "Sim " + uid, fleet: 5, seed: 777 });
      check("simulator: fixtures build a provider", f.ok === true && !!f.providerId, JSON.stringify(f.error || ""));
      check("simulator: fixtures create sites and groups", f.sites.length === 3 && f.groups.length === 2);
      check("simulator: fixtures enrol the whole fleet", f.agents.length === 5 && f.errors.length === 0 && f.agents.every((a) => !!a.deviceId && !!a.credential));
      const pid = f.providerId;
      const prov = (await T.get(pid)).provider;
      check("simulator: the provider owns the enrolled devices", asArrTest(prov.devices).length === 5);
      check("simulator: devices inherit their site + group bindings", asArrTest(prov.devices).every((d) => asArrTest(f.sites).some((s) => String(s.id) === String(d.siteId)) && asArrTest(d.groupIds).length === 1));
      check("simulator: the fleet spans both groups", new Set(f.agents.map((a) => asArrTest(a.groupIds)[0])).size === 2);
      check("simulator: the enrollment token is single-use", (await E.enroll({ token: f.agents[0].token, hostname: "again" })).error === "used_token");

      /* ── heartbeat ── */
      const agent = f.agents[0];
      const hb = await SIM.heartbeat(agent);
      check("simulator: a heartbeat authenticates", hb.ok === true && hb.deviceId === agent.deviceId);
      const hbDev = (await D.get(pid, agent.deviceId)).device;
      check("simulator: the heartbeat lands on the device record", !!hbDev.lastSeenAt && hbDev.agentVersion === agent.agentVersion && asArrTest(hbDev.agent.capabilities).indexOf("inventory") !== -1);
      check("simulator: the heartbeat returns the command channel", Array.isArray(hb.jobs) && typeof hb.collectInventory === "boolean");
      const goodCred = agent.credential;
      agent.credential = "cred_BAD_" + uid;
      const bad = await SIM.heartbeat(agent);
      agent.credential = goodCred;
      check("simulator: a bad credential is refused", bad.ok === false && !!bad.error);

      /* ── inventory: full then delta ── */
      const inv1 = await SIM.sendInventory(agent);
      check("simulator: the first inventory is a full snapshot", inv1.ok === true && inv1.revision === 1, JSON.stringify(inv1));
      const snap1 = await INV.snapshot(agent.deviceId);
      check("simulator: inventory is stored with its sections", !!snap1 && asArrTest(snap1.sections.software).length > 0 && !!snap1.sections.hardware);
      check("simulator: inventory reconciles the device asset fields", !!(await D.get(pid, agent.deviceId)).device.custom.inventory);
      agent.software.push({ name: "SIM Agent Tool", version: "1.0.0", publisher: "Simulator" });
      const inv2 = await SIM.sendInventory(agent);
      check("simulator: a later inventory is a delta and bumps the revision", inv2.ok === true && inv2.revision === 2 && inv2.changed === true, JSON.stringify(inv2));

      /* ── metrics ── */
      const met = await SIM.sendMetrics(agent);
      check("simulator: metric samples are accepted", met.ok === true && met.accepted >= 1);
      const latest = await MET.latest(agent.deviceId);
      check("simulator: the latest sample is readable", !!latest && typeof latest.cpuPct === "number" && typeof latest.memPct === "number");
      agent.temperamentId = "hot";
      const hotMet = await SIM.sendMetrics(agent);
      const hotLatest = await MET.latest(agent.deviceId);
      check("simulator: the hot temperament crosses the critical CPU threshold", hotMet.ok === true && hotLatest.cpuPct >= 90, "cpu=" + (hotLatest && hotLatest.cpuPct));
      agent.temperamentId = "normal";

      /* ── jobs: claim + answer ── */
      const enq = await J.enqueue({ providerId: pid, deviceIds: [agent.deviceId], language: agent.language, script: "echo sim", name: "Sim job", createdBy: "test" });
      check("simulator: a job can be queued for an agent", enq.ok === true && !!enq.job.id);
      const cyc = await SIM.cycle(agent, { metrics: false, inventoryEvery: 0 });
      check("simulator: a cycle claims + answers the queued job", cyc.jobs.length === 1 && cyc.jobs[0].ok === true, JSON.stringify(cyc.jobs[0] || {}));
      const done = await J.get(pid, enq.job.id);
      check("simulator: the job reaches a terminal succeeded state", done.job.state === "succeeded" && done.job.results[agent.deviceId].state === "succeeded");
      check("simulator: the job captures the agent's output", /ok/.test(done.job.results[agent.deviceId].stdout || ""));
      check("simulator: the activity counters advance", agent.cycles >= 1 && agent.jobsAnswered >= 1 && agent.samples >= 2, JSON.stringify({ cycles: agent.cycles, samples: agent.samples, jobs: agent.jobsAnswered }));

      agent.jobPolicy = { ok: false, exitCode: 1, stderr: "boom" };
      const enq2 = await J.enqueue({ providerId: pid, deviceIds: [agent.deviceId], language: agent.language, script: "exit 1", name: "Fail job", createdBy: "test" });
      await SIM.cycle(agent, { metrics: false, inventoryEvery: 0 });
      const failedJob = await J.get(pid, enq2.job.id);
      agent.jobPolicy = null;
      check("simulator: a failing job is reported failed", failedJob.job.state === "failed" && failedJob.job.results[agent.deviceId].stderr === "boom");

      const loner = SIM.createAgent({ index: 9, seed: 4242 });
      const cyc2 = await SIM.cycle(loner);
      check("simulator: an un-enrolled agent cannot check in", cyc2.error === "not_enrolled" || (cyc2.heartbeat && cyc2.heartbeat.error === "not_enrolled"));

      /* ── stats ── */
      await SIM.runAll(f.agents, 1, { inventory: true });
      const st = await SIM.stats(pid);
      check("simulator: stats summarise the fixture", st.devices === 5 && st.online === 5 && typeof st.jobs === "number", JSON.stringify(st));

      /* ── console panel ── */
      const probe = document.createElement("div");
      document.body.appendChild(probe);
      await SIM.renderPanel(probe, { providerId: pid });
      check("simulator: the panel renders the fleet builder", !!probe.querySelector('[name="simFleet"]') && !!probe.querySelector('[data-act="sim-seed"]') && !!probe.querySelector('[data-act="sim-loop"]'));
      check("simulator: the panel shows KPI cards", probe.querySelectorAll(".erp-stat").length >= 4);
      probe.remove();
      const host = document.createElement("div");
      document.body.appendChild(host);
      await SIM.renderInto(host, { providerId: pid });
      check("simulator: renderInto wraps the panel", !!host.querySelector(".rmm-simulator"));
      host.remove();

      check("simulator: every canonical file stays in the rmm namespace", Object.keys(srv.files).every((n) => n.indexOf("rmm-v1-") === 0));
    } catch (e) {
      check("simulator: harness did not crash", false, (e && e.stack) || String(e));
    } finally {
      try { store.useBackend(null); } catch (e) {}
      try { store.resetAllLocal(); } catch (e) {}
      try { T.reload(); } catch (e) {}
      try { if (COL) { COL.setTransport(null); COL.resetLocal(); } } catch (e) {}
    }
    const passed = results.filter((r) => r.ok).length;
    const failed = results.length - passed;
    return { passed, failed, results };
  };

  /* ============================================================
     Task 44 — end-to-end suite
     Run via page_eval:  await window.RMMEndToEndTest()
     Drives the canonical loop through the real services, with the
     simulator standing in for the endpoints: a fixture tenant is
     built, the fleet enrols and reports, a monitor breach becomes an
     alert, routing and notifications fire, an automation opens a
     psa-u ticket and queues a remediation job, the agent answers it,
     the breach recovers and the alert auto-clears the ticket. The
     failure path (an agent reporting a failed job) is covered too.
     ============================================================ */
  window.RMMEndToEndTest = async function (opts) {
    opts = opts || {};
    results.length = 0;
    const ERP = window.ERP;
    const store = ERP.store;
    const T = ERP.tenancy;
    const J = ERP.jobs;
    const INV = ERP.rmmInventory;
    const MET = ERP.metrics;
    const MON = ERP.monitors;
    const AL = ERP.alerts;
    const AUTO = ERP.automations;
    const PSA = ERP.psa;
    const M = ERP.masterConfig;
    const SIM = ERP.simulator;
    const COL = ERP.collector;
    const uid = Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);

    function makeServer() {
      const files = {};
      return {
        files,
        async get(name) { return Object.prototype.hasOwnProperty.call(files, name) ? files[name] : null; },
        async set(name, json) { const prev = files[name]; files[name] = json; return { created: prev === undefined, unchanged: prev === json, editKey: "k_" + name, superseded: false, error: null }; },
      };
    }

    if (!SIM || !MON || !AL || !AUTO || !PSA) { check("e2e: the simulator + engines are exposed", false); return { passed: 0, failed: 1, results }; }
    const srv = makeServer();
    try {
      store.useBackend(srv);
      store.resetAllLocal();
      T.reload();
      try { await M.seed({ force: true }); } catch (e) {}
      const channels = await M.section("channels");
      check("e2e: master config exposes notification channels", asArrTest(channels).length >= 1);
      const sev = asArrTest(await M.section("severities")).find((s) => s.id === "sev-critical");
      check("e2e: a critical severity exists at auto-ticket rank", !!sev && Number(sev.rank) >= 30);

      const r = await SIM.fullLoop({ name: "E2E " + uid, fleet: 3, seed: 24680 });
      check("e2e: the full loop completes", r.ok === true, JSON.stringify(r.error || "") + (r.detail ? " " + JSON.stringify(r.detail).slice(0, 200) : ""));
      if (r.ok !== true) throw new Error("fullLoop failed: " + (r.error || "unknown"));

      /* fixture */
      check("e2e: the fixture tenant has sites and devices", r.sites.length === 3 && r.devices === 3);
      check("e2e: every agent enrolled with a credential", r.agents.every((a) => a.deviceId && a.credential && a.cycles >= 1));
      check("e2e: every device is online with inventory + metrics", (await INV.hasSnapshot(r.agents[0].deviceId)) === true && !!(await MET.latest(r.agents[0].deviceId)));

      /* monitor + alert */
      const monitor = (await MON.get(r.providerId, r.monitorId)).monitor;
      check("e2e: the CPU monitor is armed", !!monitor && monitor.type === "cpu" && monitor.thresholds.critical === 95 && monitor.forMinutes === 0);
      check("e2e: an alert fired", !!r.alert && r.alert.state === "firing");
      check("e2e: the alert is critical and names the breached agent", r.alert.severityId === "sev-critical" && r.alert.hostname === r.agents[0].hostname);
      const fired = (await AL.get(r.providerId, r.alert.id)).alert;
      check("e2e: the alert records its fired timeline", asArrTest(fired.history).some((h) => h.action === "fired"));
      check("e2e: the alert snapshots the device/site context", fired.deviceId === r.agents[0].deviceId && !!fired.siteName);
      check("e2e: the alert carries a monitor link + dedupe key", fired.monitorId === r.monitorId && !!fired.dedupeKey);

      /* routing + notification */
      check("e2e: routing/notification recorded the alert", asArrTest(fired.routing).length >= 1 || r.notifications >= 1, JSON.stringify({ routing: asArrTest(fired.routing).length, notifications: r.notifications }));

      /* automation */
      const rule = (await AUTO.get(r.providerId, r.ruleId)).rule;
      check("e2e: the automation rule ran", !!r.automation && r.automation.status === "succeeded", JSON.stringify(r.automation));
      check("e2e: the rule opened a ticket, notified and queued a job", r.automation.counts.done >= 1 && r.automation.counts.queued >= 1 && r.automation.counts.sent >= 1, JSON.stringify(r.automation && r.automation.counts));
      check("e2e: the run is recorded on the rule", asArrTest(rule.runs).length >= 1 && rule.runs[0].status === "succeeded");

      /* the remediation job was delivered and answered by the agent */
      check("e2e: the automation job was answered by the agent", !!r.job && r.job.state === "succeeded", JSON.stringify(r.job));
      const job = r.job ? await J.get(r.providerId, r.job.jobId) : { job: null };
      check("e2e: the job is terminal in the console queue", !!job.job && job.job.state === "succeeded" && job.job.results[r.agents[0].deviceId].state === "succeeded");
      check("e2e: the job's output is captured", !!job.job && /ok/.test(job.job.results[r.agents[0].deviceId].stdout || ""));

      /* psa-u ticket */
      check("e2e: a psa-u ticket was opened from the alert", !!r.ticket && !!r.ticket.externalId);
      const ticket = await PSA.forAlert(r.providerId, r.alert.id);
      check("e2e: the ticket links back to the alert", !!ticket && String(ticket.alertId) === String(r.alert.id));
      check("e2e: the ticket resolved on recovery", ticket.status === "resolved", JSON.stringify({ status: ticket && ticket.status }));

      /* recovery / auto-clear */
      check("e2e: the alert auto-cleared", r.recovery.cleared === true && r.recovery.alertState === "resolved");
      check("e2e: no active alerts remain", (await AL.active(r.providerId)).length === 0);
      const resolved = (await AL.get(r.providerId, r.alert.id)).alert;
      check("e2e: the alert history records the auto-clear", resolved.autoResolved === true && asArrTest(resolved.history).some((h) => h.action === "auto-cleared"));

      /* final tenant state */
      const st = await SIM.stats(r.providerId);
      check("e2e: the fleet ends online", st.online === 3 && st.devices === 3, JSON.stringify(st));
      check("e2e: the loop produced outbound notifications", r.notifications >= 1 || r.routeDeliveries >= 1);
      check("e2e: the loop is traceable in staged steps", asArrTest(r.steps).length >= 6);

      /* ── failure path: an agent reports a failed remediation ── */
      const f2 = await SIM.fixtures({ name: "E2E2 " + uid, fleet: 2, seed: 13579 });
      const victim = f2.agents[0];
      await SIM.cycle(victim, { inventory: true });
      victim.jobPolicy = { ok: false, exitCode: 2, stderr: "cannot remediate" };
      const badJob = await J.enqueue({ providerId: f2.providerId, deviceIds: [victim.deviceId], language: victim.language, script: "exit 2", name: "Bad remediation", createdBy: "test" });
      await SIM.cycle(victim, { metrics: false, inventoryEvery: 0 });
      const bad = await J.get(f2.providerId, badJob.job.id);
      check("e2e: a failing remediation is recorded as failed", bad.job.state === "failed" && /cannot remediate/.test(bad.job.results[victim.deviceId].stderr || ""));

      check("e2e: every canonical file stays in the rmm namespace", Object.keys(srv.files).every((n) => n.indexOf("rmm-v1-") === 0));
    } catch (e) {
      check("e2e: harness did not crash", false, (e && e.stack) || String(e));
    } finally {
      try { store.useBackend(null); } catch (e) {}
      try { store.resetAllLocal(); } catch (e) {}
      try { T.reload(); } catch (e) {}
      try { if (COL) { COL.setTransport(null); COL.resetLocal(); } } catch (e) {}
      try { await M.seed(); } catch (e) {}
    }
    const passed = results.filter((r) => r.ok).length;
    const failed = results.length - passed;
    return { passed, failed, results };
  };

  /* ============================================================
     Task 45 validation tests — agent security
     Run via page_eval:  await window.RMMAgentSecurityTest()
     Covers: the enrolment token as a single-use, provider-bound
     secret; credentials & tokens stored only as hashes; every
     agent-facing service refusing a forged or revoked device; job
     isolation across devices and providers; replayed or tampered
     job results being idempotent-but-not-applied; the collector core
     enforcing the same rules; and the public collector source holding
     no secret material.
     Runs against a stub backend so the real documents are untouched.
     ============================================================ */
  window.RMMAgentSecurityTest = async function (opts) {
    opts = opts || {};
    results.length = 0;
    const ERP = window.ERP;
    const store = ERP.store;
    const T = ERP.tenancy;
    const E = ERP.enrollment;
    const J = ERP.jobs;
    const COL = ERP.collector;
    const H = ERP.heartbeat;
    const INV = ERP.rmmInventory;
    const MET = ERP.metrics;
    const DIAG = ERP.diagnostics;
    const RS = ERP.resilience;
    const uid = Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
    const BAD = "cred_000000000000000000000000000000000000000000";

    function makeServer() {
      const files = {};
      return {
        files,
        async get(name) { return Object.prototype.hasOwnProperty.call(files, name) ? files[name] : null; },
        async set(name, json) { const prev = files[name]; files[name] = json; return { created: prev === undefined, unchanged: prev === json, editKey: "k_" + name, superseded: false, error: null }; },
      };
    }

    if (!E || !J || !COL) { check("security: the enrollment, jobs & collector modules are exposed", false); return { passed: 0, failed: 1, results }; }

    const srv = makeServer();
    try {
      check("security: the enrollment, jobs & collector modules are exposed",
        typeof E.enroll === "function" && typeof E.authenticate === "function" && typeof E.revokeDevice === "function" &&
        typeof J.claim === "function" && typeof J.result === "function" && typeof COL.createCore === "function");
      check("security: SHA-256 matches the known vector", E.sha256Hex("abc") === "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", E.sha256Hex("abc"));
      check("security: credential compare is constant-time (length + byte mismatch fail)", E.constantTimeEqual("abc", "abc") === true && E.constantTimeEqual("abc", "abd") === false && E.constantTimeEqual("ab", "abc") === false);

      store.useBackend(srv);
      store.resetAllLocal();
      T.reload();
      const docName = store.docName("enrollment");
      const p1 = await T.create({ name: "Sec P1 " + uid, sites: [{ id: "s1", name: "HQ" }], deviceGroups: [{ id: "g1", name: "Workstations", siteId: "s1" }] });
      const pid = p1.provider.id;
      const p2 = await T.create({ name: "Sec P2 " + uid, sites: [{ id: "s2", name: "HQ2" }] });
      const pid2 = p2.provider.id;
      const osObj = { name: "Windows 11" };

      /* ── 1 · the enrolment token is a single-use, provider-bound secret ── */
      check("security: a token must belong to a provider or device", !!(await E.issueToken({})).error);
      const issued = await E.issueToken({ providerId: pid, siteId: "s1", groupIds: ["g1"], label: "sec" });
      check("security: the plaintext token is returned exactly once", issued.ok === true && /^rmm_/.test(issued.token));
      check("security: the public token record carries no hash", issued.record && issued.record.tokenHash === undefined);
      const rawTokenDoc = srv.files[docName] || "";
      check("security: only the token hash is persisted", rawTokenDoc.indexOf(issued.token) === -1 && rawTokenDoc.indexOf(E.sha256Hex(issued.token)) !== -1);

      const a = await E.enroll({ token: issued.token, hostname: "SEC-A", os: osObj, device: { os: osObj } });
      check("security: a valid token enrols a device", a.ok === true && !!a.deviceId && /^cred_/.test(a.credential), JSON.stringify({ e: a.error }));
      const gotTok = await E.getToken(issued.record.id);
      check("security: a token read back never exposes its hash", !!gotTok && gotTok.tokenHash === undefined);
      check("security: a spent enrolment token is refused (single-use)", (await E.enroll({ token: issued.token, hostname: "SEC-A2" })).error === "used_token");
      const rawCredDoc = srv.files[docName] || "";
      check("security: only the credential hash is persisted", rawCredDoc.indexOf(a.credential) === -1 && rawCredDoc.indexOf(E.sha256Hex(a.credential)) !== -1);

      const exp = await E.issueToken({ providerId: pid, expiresInMinutes: -5 });
      check("security: an expired token is refused", (await E.enroll({ token: exp.token, hostname: "X" })).error === "expired_token");
      const rvk = await E.issueToken({ providerId: pid });
      await E.revokeToken(rvk.record.id);
      check("security: a revoked token is refused", (await E.enroll({ token: rvk.token, hostname: "X" })).error === "revoked_token");
      check("security: an unrecognised token is refused", (await E.enroll({ token: "rmm_NOPE" + uid, hostname: "X" })).error === "invalid_token");

      const tBind = await E.issueToken({ providerId: pid, siteId: "s1", groupIds: ["g1"] });
      const override = await E.enroll({ token: tBind.token, hostname: "SEC-OVR", siteId: "attacker", groupIds: ["evil"], os: osObj, device: { os: osObj } });
      check("security: the token's site binding wins over the request", override.siteId === "s1", JSON.stringify(override.siteId));
      check("security: the token's group binding wins over the request", asArrTest(override.groupIds).join(",") === "g1", JSON.stringify(override.groupIds));

      /* ── 2 · only a valid credential can post data or fetch jobs ── */
      const servicesUnderTest = (cred, id) => ([
        ["heartbeat", () => H.heartbeat({ deviceId: id, credential: cred, payload: { agentVersion: "1.0.0", intervalSeconds: 60, interfaces: [] } })],
        ["inventory", () => INV.submit({ deviceId: id, credential: cred, payload: { mode: "full", inventory: { os: { name: "Windows 11" } }, collectedAt: new Date().toISOString() } })],
        ["metrics", () => MET.submit({ deviceId: id, credential: cred, payload: { samples: [{ at: new Date().toISOString(), cpuPct: 5 }], intervalSeconds: 60 } })],
        ["jobs.claim", () => J.claim({ deviceId: id, credential: cred })],
        ["diagnostics.logs", () => DIAG.submitLogs({ deviceId: id, credential: cred, text: "hello" })],
        ["diagnostics.selfTest", () => DIAG.submitSelfTest({ deviceId: id, credential: cred, ok: true, checks: [{ id: "c", name: "C", ok: true }] })],
        ["resilience.update", () => RS.recordUpdate({ deviceId: id, credential: cred, ok: true, version: "1.1.0" })],
      ]);

      const goodFail = [];
      for (const [name, run] of servicesUnderTest(a.credential, a.deviceId)) {
        const r = await run();
        if (!(r && r.ok === true)) goodFail.push(name + ":" + String(r && (r.error || r.ok)));
      }
      check("security: a valid, enrolled device can post to every agent-facing service", goodFail.length === 0, goodFail.join(" "));

      const badAllow = [];
      for (const [name, run] of servicesUnderTest(BAD, a.deviceId)) {
        const r = await run();
        if (!r || r.ok !== false) badAllow.push(name);
      }
      check("security: a forged credential is refused by every agent-facing service", badAllow.length === 0, badAllow.join(" "));
      check("security: the refusal reason is a credential failure", (await H.heartbeat({ deviceId: a.deviceId, credential: BAD, payload: {} })).error === "invalid_credential");
      check("security: an unknown device is refused outright", (await H.heartbeat({ deviceId: "dev-nope-" + uid, credential: BAD, payload: {} })).error === "no_credential");

      /* ── 3 · job isolation across devices and providers ── */
      const bTok = await E.issueToken({ providerId: pid });
      const b = await E.enroll({ token: bTok.token, hostname: "SEC-B", os: osObj, device: { os: osObj } });
      const p2Tok = await E.issueToken({ providerId: pid2 });
      const c = await E.enroll({ token: p2Tok.token, hostname: "SEC-C", os: osObj, device: { os: osObj } });
      const job = await J.enqueue({ providerId: pid, deviceIds: [a.deviceId], language: "powershell", script: "Write-Output ok", name: "Sec job " + uid, createdBy: "test" });
      check("security: a job is targeted at exactly one device", asArrTest(job.job.targets).length === 1 && String(job.job.targets[0]) === String(a.deviceId));
      const claimB = await J.claim({ deviceId: b.deviceId, credential: b.credential });
      check("security: another device cannot claim a job it is not targeted by", claimB.ok === true && asArrTest(claimB.jobs).length === 0, JSON.stringify(asArrTest(claimB.jobs).map((j) => j.jobId)));
      const claimA = await J.claim({ deviceId: a.deviceId, credential: a.credential });
      check("security: the targeted device claims the job exactly once", asArrTest(claimA.jobs).length === 1 && String(claimA.jobs[0].jobId) === String(job.job.id));
      check("security: a claimed job is not handed out again", asArrTest((await J.claim({ deviceId: a.deviceId, credential: a.credential })).jobs).length === 0);
      check("security: a stolen credential is bound to its own device", (await J.claim({ deviceId: b.deviceId, credential: a.credential })).error === "invalid_credential");
      check("security: another device cannot post the job's result", (await J.result({ deviceId: b.deviceId, credential: b.credential, jobId: job.job.id, ok: true, exitCode: 0, stdout: "forged" })).error === "not_targeted");
      check("security: a device from another provider cannot post the result", (await J.result({ deviceId: c.deviceId, credential: c.credential, jobId: job.job.id, ok: true, exitCode: 0, stdout: "forged" })).error === "wrong_provider");

      /* ── 4 · replayed / tampered job results are not applied ── */
      const goodRes = await J.result({ deviceId: a.deviceId, credential: a.credential, jobId: job.job.id, ok: true, exitCode: 0, stdout: "ok run", stderr: "" });
      check("security: the genuine result is accepted", goodRes.ok === true && goodRes.deviceState === "succeeded");
      check("security: the job is terminal in the queue", (await J.get(pid, job.job.id)).job.state === "succeeded");
      const replay = await J.result({ deviceId: a.deviceId, credential: a.credential, jobId: job.job.id, ok: false, exitCode: 1, stdout: "TAMPERED", stderr: "boom" });
      check("security: a replayed result is reported as a duplicate", replay.ok === true && replay.duplicate === true);
      const storedRes = (await J.get(pid, job.job.id)).job.results[a.deviceId];
      check("security: a replayed result cannot overwrite the recorded outcome", storedRes.state === "succeeded" && storedRes.exitCode === 0 && storedRes.stdout === "ok run" && storedRes.stderr === "", JSON.stringify({ state: storedRes.state, exit: storedRes.exitCode, out: storedRes.stdout }));
      check("security: a result for an unknown job is refused", (await J.result({ deviceId: a.deviceId, credential: a.credential, jobId: "job-nope-" + uid, ok: true })).error === "not_found");
      check("security: a result without a valid credential is refused", (await J.result({ deviceId: a.deviceId, credential: BAD, jobId: job.job.id, ok: true })).ok === false);

      /* ── 5 · a revoked device is refused everywhere ── */
      const rev = await E.revokeDevice(a.deviceId, { providerId: pid });
      check("security: revoking a device invalidates its credentials", rev.ok === true && rev.revoked >= 1);
      const revAllow = [];
      for (const [name, run] of servicesUnderTest(a.credential, a.deviceId)) {
        const r = await run();
        if (!r || r.ok !== false) revAllow.push(name);
      }
      check("security: a revoked device is refused by every agent-facing service", revAllow.length === 0, revAllow.join(" "));
      check("security: the refusal reason is revocation, not an invalid signature", (await H.heartbeat({ deviceId: a.deviceId, credential: a.credential, payload: {} })).error === "revoked");
      check("security: a revoked device cannot fetch jobs", (await J.claim({ deviceId: a.deviceId, credential: a.credential })).ok === false);

      /* ── 6 · the collector core enforces the same rules ── */
      COL.setTransport(null);
      COL.resetLocal();
      const core = COL.createCore({ entropy: "sec-" + uid });
      const cTok = "enr-" + uid;
      const reg = core.admin.registerToken({ tokenHash: core.sha256Hex(cTok), providerId: "prov-" + uid, siteId: "s1", groupIds: ["g1"], maxUses: 1 });
      check("security: the collector registers a token as a hash only", reg.ok === true && !!reg.tokenId);
      const c1 = core.handle("enroll", { token: cTok, hostname: "CORE-1", device: { os: { name: "Windows 11" } } });
      check("security: the collector exchanges a token for a credential", c1.ok === true && /^cred_/.test(c1.credential) && /^dev-[a-z0-9]+$/.test(c1.deviceId));
      check("security: the collector refuses a spent token", core.handle("enroll", { token: cTok, hostname: "CORE-2" }).error === "used_token");
      const coreState = JSON.stringify(core.state());
      check("security: the collector core stores no plaintext credential or token", coreState.indexOf(c1.credential) === -1 && coreState.indexOf(cTok) === -1 && coreState.indexOf(core.sha256Hex(c1.credential)) !== -1);

      const cTok2 = "enr2-" + uid;
      core.admin.registerToken({ tokenHash: core.sha256Hex(cTok2), providerId: "prov-" + uid, maxUses: 1 });
      const c2 = core.handle("enroll", { token: cTok2, hostname: "CORE-2", device: { os: { name: "Windows 11" } } });
      check("security: the collector enrols a second device for isolation", c2.ok === true && c2.deviceId !== c1.deviceId);
      const pushed = core.admin.pushJob({ deviceId: c1.deviceId, job: { name: "Core job", language: "powershell", script: "Write-Output ok" } });
      const coreJobId = pushed.jobId;
      check("security: the collector queued the job", !!coreJobId);

      const coreOps = ["heartbeat", "inventory", "metrics", "job-result", "job-start", "logs", "diagnostics", "update-result", "uninstall"];
      const badAllow2 = [];
      coreOps.forEach((op) => {
        const r = core.handle(op, { deviceId: c1.deviceId, credential: BAD, jobId: coreJobId, payload: {}, text: "x", checks: [] });
        if (!r || r.ok !== false) badAllow2.push(op);
      });
      check("security: the collector refuses a forged credential on every device op", badAllow2.length === 0, badAllow2.join(" "));

      const coreGood = core.handle("heartbeat", { deviceId: c1.deviceId, credential: c1.credential, payload: {} });
      check("security: the collector authenticates a valid device", coreGood.ok === true);
      check("security: the collector delivers the queued job to its target only", asArrTest(coreGood.jobs).length === 1 && String(coreGood.jobs[0].jobId) === String(coreJobId));
      check("security: the other device's heartbeat carries none of the job", asArrTest(core.handle("heartbeat", { deviceId: c2.deviceId, credential: c2.credential, payload: {} }).jobs).length === 0);
      const coreCross = core.handle("job-result", { deviceId: c2.deviceId, credential: c2.credential, jobId: coreJobId, exitCode: 0, stdout: "forged" });
      check("security: the collector refuses a result from another device", coreCross.error === "wrong_device");
      const coreGoodRes = core.handle("job-result", { deviceId: c1.deviceId, credential: c1.credential, jobId: coreJobId, exitCode: 0, stdout: "ok" });
      check("security: the collector accepts the genuine result", coreGoodRes.ok === true && coreGoodRes.state === "succeeded");
      const coreReplay = core.handle("job-result", { deviceId: c1.deviceId, credential: c1.credential, jobId: coreJobId, exitCode: 1, stdout: "TAMPERED" });
      check("security: the collector treats a replayed result as idempotent", coreReplay.ok === true && coreReplay.duplicate === true);
      check("security: the collector's replay cannot overwrite the outcome", core.state().jobs[coreJobId].state === "succeeded" && core.state().jobs[coreJobId].stdout === "ok");
      core.admin.revokeDevice({ deviceId: c1.deviceId });
      check("security: the collector refuses a revoked device", core.handle("heartbeat", { deviceId: c1.deviceId, credential: c1.credential, payload: {} }).error === "revoked");

      /* ── 7 · the public collector source holds no secret material ── */
      const el = document.querySelector('script[type="text/x-server-plugin"]');
      const serverText = el ? el.textContent : "";
      check("security: the public collector source is present and marked", serverText.length > 1000 && serverText.indexOf("RMM-COLLECTOR-CORE-START") !== -1 && serverText.indexOf("RMM-COLLECTOR-CORE-END") !== -1);
      check("security: the source embeds no plaintext credential or token", /cred_[A-Za-z0-9]{20,}/.test(serverText) === false && /rmm_[A-Z2-9]{20,}/.test(serverText) === false);
      check("security: the source bakes in no credential or token hash", /credentialHash:\s*"[0-9a-f]{64}"/.test(serverText) === false && /tokenHash:\s*"[0-9a-f]{64}"/.test(serverText) === false);
      check("security: the source holds no plaintext admin password (only its hash)", serverText.indexOf("TzIucqLXjk_UwvBQhfSLE51x_gWuih-YMJgBgsFrLDE") === -1 && serverText.indexOf("sha256Hex") !== -1);
      check("security: a minted secret never appears in the public source", serverText.indexOf(c1.credential) === -1 && serverText.indexOf(core.sha256Hex(c1.credential)) === -1 && serverText.indexOf(cTok) === -1);

      check("security: every canonical file stays in the rmm namespace", Object.keys(srv.files).every((n) => n.indexOf("rmm-v1-") === 0), JSON.stringify(Object.keys(srv.files)));
    } catch (e) {
      check("security: harness did not crash", false, (e && e.stack) || String(e));
    } finally {
      try { store.useBackend(null); } catch (e) {}
      try { store.resetAllLocal(); } catch (e) {}
      try { T.reload(); } catch (e) {}
      try { if (COL) { COL.setTransport(null); COL.resetLocal(); } } catch (e) {}
    }

    const passed = results.filter((r) => r.ok).length;
    const failed = results.length - passed;
    return { passed, failed, results };
  };

  /* ============================================================
     Task 46 validation tests — failure, storm & scale
     Run via page_eval:  await window.RMMStormTest()
     Covers: collector + console job timeouts / abandonment / expiry,
     reconnect storms (a fleet-wide check-in burst, the collector's
     per-device rate cap and batch cap, and the console event stream
     under a 2,000-event burst + a dropped/reopened socket), alert
     flapping (de-dup, flap flag, escalation, acknowledged alerts
     surviving prune), large metric payloads (per-post cap, bounded
     rings, roll-ups, codec, collector caps), bulk job dispatch to a
     whole fleet (claimed + answered exactly once each), retention /
     pruning at scale, responsiveness budgets, and the invariants
     that no acknowledged alert or queued job is ever lost.
     Runs against a stub backend + mock hub so real documents are
     untouched.
     ============================================================ */
  window.RMMStormTest = async function (opts) {
    opts = opts || {};
    results.length = 0;
    const ERP = window.ERP;
    const store = ERP.store;
    const T = ERP.tenancy;
    const J = ERP.jobs;
    const MET = ERP.metrics;
    const COL = ERP.collector;
    const DSP = ERP.dispatch;
    const RET = ERP.retention;
    const AL = ERP.alerts;
    const EV = ERP.events;
    const SIM = ERP.simulator;
    const M = ERP.masterConfig;
    const uid = Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
    const iso = (ms) => new Date(ms).toISOString();
    const nowMs = () => Date.now();
    const HOUR = 3600000;
    function numTest(v, d) { const n = Number(v); return isFinite(n) ? n : d; }
    const FLEET = Math.max(6, Math.min(40, numTest(opts.fleet, 24)));
    const BUDGET = Math.max(500, numTest(opts.budgetMs, 8000));

    function makeServer() {
      const files = {};
      return {
        files,
        async get(name) { return Object.prototype.hasOwnProperty.call(files, name) ? files[name] : null; },
        async set(name, json) { const prev = files[name]; files[name] = json; return { created: prev === undefined, unchanged: prev === json, editKey: "k_" + name, superseded: false, error: null }; },
      };
    }
    async function patchJobDoc(jobId, mutate) {
      const loaded = await store.loadDoc(J.MODULE);
      const recs = Array.isArray(loaded && loaded.records) ? loaded.records : [];
      const job = recs.find((r) => r.kind === "job" && String(r.id) === String(jobId));
      if (!job) return null;
      mutate(job);
      await store.saveDoc(J.MODULE, recs);
      return job;
    }

    if (!J || !MET || !COL || !DSP || !RET || !AL || !EV || !SIM) {
      check("storm: the failure/storm/scale modules are exposed", false);
      return { passed: 0, failed: 1, results };
    }

    const srv = makeServer();
    const t0 = nowMs();
    try {
      check("storm: the failure/storm/scale modules are exposed",
        typeof J.reap === "function" && typeof J.claim === "function" && typeof J.enqueue === "function" &&
        typeof COL.createCore === "function" && typeof MET.submit === "function" && typeof AL.fire === "function" &&
        typeof AL.prune === "function" && typeof RET.apply === "function" && typeof DSP.resolveTargets === "function" &&
        typeof EV.pollOnce === "function" && typeof EV.reconnectDelayMs === "function");

      store.useBackend(srv);
      store.resetAllLocal();
      T.reload();
      try { await M.seed({ force: true }); } catch (e) {}

      /* ── fixture: a provider with a fleet of enrolled agents ── */
      const f = await SIM.fixtures({ name: "Storm " + uid, fleet: FLEET, seed: 20260912 });
      check("storm: the fixture fleet enrolled cleanly", f.ok === true && f.agents.length === FLEET && f.errors.length === 0, JSON.stringify(asArrTest(f.errors).slice(0, 3)));
      const pid = f.providerId;
      const agents = f.agents;
      const allIds = agents.map((a) => a.deviceId);
      const cred = (a) => a.credential;
      for (const a of agents) await SIM.cycle(a, { inventory: true, metricsEvery: 1 });
      const st0 = await SIM.stats(pid);
      check("storm: the whole fleet checks in and reads online", st0.online === FLEET && st0.devices === FLEET, JSON.stringify(st0));

      /* ═══════════ bulk job dispatch ═══════════ */
      const bulkStart = nowMs();
      const bulk = await J.enqueue({ providerId: pid, deviceIds: allIds, language: "python", script: "print('ok')", name: "Bulk storm " + uid, maxAttempts: 1, source: "storm-test" });
      const bulkEnqueueMs = nowMs() - bulkStart;
      check("storm: one job enqueues against the whole fleet", bulk.ok === true && asArrTest(bulk.job && bulk.job.targets).length === FLEET, JSON.stringify({ targets: asArrTest(bulk.job && bulk.job.targets).length, err: bulk.error }));
      check("storm: every bulk target starts queued", asArrTest(bulk.job && bulk.job.targets).every((id) => bulk.job.results[id].state === "queued"));
      const resolvedAll = await DSP.resolveTargets(pid, { all: true });
      check("storm: target resolution returns the whole fleet", asArrTest(resolvedAll.deviceIds).length === FLEET);
      const resolvedOnline = await DSP.resolveTargets(pid, { online: true });
      check("storm: an online-only target resolves the reporting fleet", asArrTest(resolvedOnline.deviceIds).length === FLEET);

      const claimStart = nowMs();
      let claimedOnce = 0, claimProblems = 0;
      for (const a of agents) {
        const c = await J.claim({ deviceId: a.deviceId, credential: cred(a), limit: 10 });
        const mine = asArrTest(c.jobs).filter((j) => String(j.jobId) === String(bulk.job.id));
        if (mine.length === 1) claimedOnce++; else claimProblems++;
        const again = await J.claim({ deviceId: a.deviceId, credential: cred(a), limit: 10 });
        if (asArrTest(again.jobs).some((j) => String(j.jobId) === String(bulk.job.id))) claimProblems++;
      }
      const claimMs = nowMs() - claimStart;
      check("storm: every device claims the bulk job exactly once", claimedOnce === FLEET && claimProblems === 0, JSON.stringify({ claimedOnce, claimProblems }));

      const answerStart = nowMs();
      for (const a of agents) await J.result({ deviceId: a.deviceId, credential: cred(a), jobId: bulk.job.id, ok: true, exitCode: 0, stdout: "ok" });
      const answerMs = nowMs() - answerStart;
      const bulkDone = await J.get(pid, bulk.job.id);
      check("storm: the bulk job completes on every target", bulkDone.job.state === "succeeded" && J.count(bulkDone.job, "succeeded") === FLEET, JSON.stringify({ state: bulkDone.job.state, ok: J.count(bulkDone.job, "succeeded") }));
      check("storm: bulk enqueue/claim/answer stay responsive", bulkEnqueueMs < BUDGET && claimMs < BUDGET && answerMs < BUDGET, JSON.stringify({ enqueue: bulkEnqueueMs, claim: claimMs, answer: answerMs }));

      /* ═══════════ collector / console job timeouts ═══════════ */
      const d0 = agents[0].deviceId, c0 = cred(agents[0]);
      const jobA = await J.enqueue({ providerId: pid, deviceIds: [d0], language: agents[0].language, script: "work", name: "Timeout A", timeoutSeconds: 10, maxAttempts: 1 });
      await J.claim({ deviceId: d0, credential: c0 });
      const resA = await J.result({ deviceId: d0, credential: c0, jobId: jobA.job.id, state: "timed-out", timedOut: true, error: "exceeded 10s" });
      check("storm: an agent-reported timeout is recorded", resA.ok === true && resA.deviceState === "timed-out");
      check("storm: the job derives the timed-out state", (await J.get(pid, jobA.job.id)).job.state === "timed-out");

      const jobB = await J.enqueue({ providerId: pid, deviceIds: [d0], language: agents[0].language, script: "work", name: "Timeout B", timeoutSeconds: 10, maxAttempts: 2 });
      await J.claim({ deviceId: d0, credential: c0 });
      await patchJobDoc(jobB.job.id, (job) => { job.results[d0].deliveredAt = iso(nowMs() - 61 * 60000); });
      const reapB = await J.reap(pid);
      check("storm: a never-started delivery is requeued within maxAttempts", numTest(reapB.requeued, 0) >= 1 && (await J.get(pid, jobB.job.id)).job.results[d0].state === "queued", JSON.stringify(reapB));

      const jobC = await J.enqueue({ providerId: pid, deviceIds: [d0], language: agents[0].language, script: "work", name: "Timeout C", timeoutSeconds: 10, maxAttempts: 1 });
      await J.claim({ deviceId: d0, credential: c0 });
      await patchJobDoc(jobC.job.id, (job) => { job.results[d0].state = "running"; job.results[d0].startedAt = iso(nowMs() - 30 * 1000); job.state = "running"; });
      const reapC = await J.reap(pid);
      check("storm: a job that over-runs its timeout is abandoned", numTest(reapC.timedOut, 0) >= 1 && (await J.get(pid, jobC.job.id)).job.results[d0].state === "timed-out", JSON.stringify(reapC));

      const jobD = await J.enqueue({ providerId: pid, deviceIds: [d0], language: agents[0].language, script: "work", name: "Timeout D", maxAttempts: 1 });
      await patchJobDoc(jobD.job.id, (job) => { job.expiresAt = iso(nowMs() - 60000); });
      const reapD = await J.reap(pid);
      check("storm: an undelivered job past its expiry expires", numTest(reapD.expired, 0) >= 1 && (await J.get(pid, jobD.job.id)).job.results[d0].state === "expired", JSON.stringify(reapD));

      /* the collector core enforces the same timeouts, then prunes terminal jobs */
      COL.setTransport(null);
      COL.resetLocal();
      const core = COL.createCore({ entropy: "storm-" + uid });
      const cTok = "stok-" + uid;
      core.admin.registerToken({ tokenHash: core.sha256Hex(cTok), providerId: "prov-core-" + uid, maxUses: 1 });
      const ce1 = core.handle("enroll", { token: cTok, hostname: "STORM-CORE-1", device: { os: { name: "Windows 11" } } });
      const cTok2 = "stok2-" + uid;
      core.admin.registerToken({ tokenHash: core.sha256Hex(cTok2), providerId: "prov-core-" + uid, maxUses: 1 });
      const ce2 = core.handle("enroll", { token: cTok2, hostname: "STORM-CORE-2", device: { os: { name: "Ubuntu 22.04" } } });
      const pj = core.admin.pushJob({ deviceId: ce1.deviceId, job: { name: "Core timeout", language: "powershell", script: "work", timeoutSeconds: 10, maxAttempts: 2 } });
      const hb1 = core.handle("heartbeat", { deviceId: ce1.deviceId, credential: ce1.credential, payload: {} });
      check("storm: the collector delivers the queued job on check-in", asArrTest(hb1.jobs).length === 1);
      core.state().jobs[pj.jobId].deliveredAt = iso(nowMs() - 31 * 60000);
      const creap1 = core.admin.reapJobs({ deliveryTimeoutMinutes: 30 });
      check("storm: the collector requeues an undelivered job", numTest(creap1.requeued, 0) >= 1 && core.state().jobs[pj.jobId].state === "queued", JSON.stringify(creap1));
      core.handle("heartbeat", { deviceId: ce1.deviceId, credential: ce1.credential, payload: {} });
      core.handle("job-start", { deviceId: ce1.deviceId, credential: ce1.credential, jobId: pj.jobId });
      check("storm: the collector marks a started job running", core.state().jobs[pj.jobId].state === "running");
      core.state().jobs[pj.jobId].startedAt = iso(nowMs() - 60 * 1000);
      const creap2 = core.admin.reapJobs({ deliveryTimeoutMinutes: 30 });
      check("storm: the collector abandons an over-running job", numTest(creap2.timedOut, 0) >= 1 && core.state().jobs[pj.jobId].state === "timed-out", JSON.stringify(creap2));
      core.state().jobs[pj.jobId].endedAt = iso(nowMs() - 200 * HOUR);
      const creap3 = core.admin.reapJobs({ retentionHours: 168 });
      check("storm: the collector prunes a terminal job past retention", numTest(creap3.pruned, 0) >= 1 && !core.state().jobs[pj.jobId]);

      /* ═══════════ reconnect storm: fleet check-in burst ═══════════ */
      const burstStart = nowMs();
      for (const a of agents) await SIM.cycle(a, { inventory: false, metricsEvery: 1 });
      const burstMs = nowMs() - burstStart;
      const st1 = await SIM.stats(pid);
      check("storm: a full-fleet check-in burst leaves every agent online", st1.online === FLEET && st1.devices === FLEET, JSON.stringify(st1));
      check("storm: the fleet burst stays responsive", burstMs < BUDGET, burstMs + "ms");

      /* ═══════════ reconnect storm: per-device rate cap ═══════════ */
      const rc = COL.createCore({ entropy: "rate-" + uid, limits: { deviceOpsPerMinute: 5 } });
      const rTok = "rtok-" + uid;
      rc.admin.registerToken({ tokenHash: rc.sha256Hex(rTok), providerId: "prov-rate-" + uid, maxUses: 1 });
      const re1 = rc.handle("enroll", { token: rTok, hostname: "RATE-1", device: { os: { name: "Windows 11" } } });
      const rTok2 = "rtok2-" + uid;
      rc.admin.registerToken({ tokenHash: rc.sha256Hex(rTok2), providerId: "prov-rate-" + uid, maxUses: 1 });
      const re2 = rc.handle("enroll", { token: rTok2, hostname: "RATE-2", device: { os: { name: "Windows 11" } } });
      let allowed = 0, limited = 0;
      for (let i = 0; i < 12; i++) { const r = rc.handle("heartbeat", { deviceId: re1.deviceId, credential: re1.credential, payload: {} }); if (r.ok) allowed++; else if (r.error === "rate_limited") limited++; }
      check("storm: the per-device cap clamps a hammering agent", allowed === 5 && limited === 7, JSON.stringify({ allowed, limited }));
      check("storm: throttling is counted on the collector", numTest(rc.state().counters.rateLimited, 0) === 7, JSON.stringify(rc.state().counters));
      check("storm: a throttled device does not affect its neighbour", rc.handle("heartbeat", { deviceId: re2.deviceId, credential: re2.credential, payload: {} }).ok === true);
      const bigBatch = rc.handle("batch", { deviceId: re1.deviceId, credential: re1.credential, ops: Array.from({ length: 33 }, () => ({ op: "heartbeat", body: { deviceId: re1.deviceId, credential: re1.credential, payload: {} } })) });
      check("storm: an oversized batch is refused as a unit", bigBatch.ok === false && bigBatch.error === "batch_too_large");

      /* ═══════════ reconnect storm: the console event stream ═══════════ */
      const mock = { onopen: null, onmessage: null, onclose: null, open() { if (this.onopen) this.onopen(); }, close() { if (this.onclose) this.onclose(); }, send() {}, fire(o) { this.onmessage(JSON.stringify(o)); } };
      EV.setTransport(mock);
      check("storm: the event stream goes live on a socket", EV.mode() === "live");
      const seen = [];
      const offSeen = EV.on((e) => seen.push(e));
      const BURST = 2000;
      const evStart = nowMs();
      for (let i = 0; i < BURST; i++) mock.fire({ t: "evt", kind: "device-op", deviceId: "dev-storm-" + i });
      const evMs = nowMs() - evStart;
      check("storm: a " + BURST + "-event burst reaches a wildcard listener", seen.length === BURST);
      check("storm: the event ring stays bounded under the burst", EV.recent(null, 1000000).length === EV.HISTORY(), JSON.stringify({ ring: EV.recent(null, 1000000).length, history: EV.HISTORY() }));
      check("storm: the event burst stays responsive", evMs < BUDGET, evMs + "ms");
      offSeen();
      mock.close();
      check("storm: a dropped socket degrades to offline", EV.mode() === "offline");
      const afterReconnect = [];
      const offK = EV.on("device-op", (e) => afterReconnect.push(e));
      mock.open();
      check("storm: a reconnected socket returns to live", EV.mode() === "live");
      mock.fire({ kind: "device-op", deviceId: "dev-after-reconnect" });
      check("storm: events keep flowing after a reconnect", afterReconnect.length === 1 && afterReconnect[0].deviceId === "dev-after-reconnect");
      offK();
      check("storm: reconnect backoff grows then caps", EV.reconnectDelayMs(1, 1) === 1000 && EV.reconnectDelayMs(2, 1) === 2000 && EV.reconnectDelayMs(3, 1) === 4000 && EV.reconnectDelayMs(99, 1) === 20000, JSON.stringify([EV.reconnectDelayMs(1, 1), EV.reconnectDelayMs(2, 1), EV.reconnectDelayMs(99, 1)]));
      check("storm: reconnect jitter only ever shortens the wait", EV.reconnectDelayMs(3, 0) === 2000 && EV.reconnectDelayMs(3, 0) < EV.reconnectDelayMs(3, 1) && EV.reconnectDelayMs(1, 0) >= 1);
      let inRange = true, distinct = false;
      const firstDelay = EV.reconnectDelayMs(1);
      for (let i = 0; i < 64; i++) { const dv = EV.reconnectDelayMs(1); if (dv < 500 || dv > 1000) inRange = false; if (dv !== firstDelay) distinct = true; }
      check("storm: reconnect delays are randomised within [base/2, base]", inRange && distinct, "first=" + firstDelay);

      /* ═══════════ alert flapping ═══════════ */
      const ad0 = agents[0].deviceId;
      const alKey = "storm-cpu|" + ad0;
      const fireAlert = (sevId) => AL.fire(pid, { monitorId: "mon-storm-" + uid, monitorName: "CPU storm", monitorType: "cpu", deviceId: ad0, severityId: sevId || "sev-warning", state: "critical", value: 99, message: "cpu saturated", dedupeKey: alKey, at: iso(nowMs()) }, { force: true });
      const a1 = await fireAlert();
      check("storm: an alert fires for the device", a1.created === true && a1.alert.state === "firing", JSON.stringify({ created: a1.created, e: a1.error }));
      const a2 = await fireAlert();
      check("storm: a repeat breach de-duplicates onto the same alert", a2.deduped === true && String(a2.alert.id) === String(a1.alert.id) && numTest(a2.alert.occurrences, 0) >= 2);
      check("storm: only one non-resolved alert exists for the key", (await AL.forDevice(pid, ad0)).filter((a) => a.state !== "resolved").length === 1);
      const a3 = await fireAlert("sev-critical");
      check("storm: raising severity while active escalates the alert", a3.escalated === true && a3.alert.severityId === "sev-critical" && !!a3.alert.escalatedAt);
      await AL.acknowledge(pid, a1.alert.id, "storm-tester");
      const a4 = await fireAlert("sev-critical");
      const ackRec = (await AL.get(pid, a1.alert.id)).alert;
      check("storm: a repeat breach keeps an acknowledged alert acknowledged", a4.deduped === true && ackRec.state === "acknowledged" && ackRec.acknowledgedBy === "storm-tester");

      const flapThreshold = Math.max(1, numTest(ERP.configVal("rmm.alertFlapThreshold", 3), 3));
      let lastFlap = null;
      for (let i = 0; i < flapThreshold; i++) { await AL.resolve(pid, a1.alert.id, { note: "cleared" }); lastFlap = await fireAlert("sev-critical"); }
      check("storm: re-firing within the flap window flags the alert flapping", lastFlap.reopened === true && lastFlap.flapping === true && numTest(lastFlap.alert.flaps, 0) >= flapThreshold, JSON.stringify({ flaps: lastFlap.alert.flaps, flapping: lastFlap.flapping }));
      check("storm: the flap history records resolves and reopens", asArrTest(lastFlap.alert.history).filter((h) => h.action === "reopened").length >= flapThreshold && asArrTest(lastFlap.alert.history).some((h) => h.action === "resolved"));

      /* an acknowledged alert must survive every retention pass */
      await AL.acknowledge(pid, a1.alert.id, "storm-tester");
      const oldAlert = await AL.fire(pid, { monitorId: "mon-old-" + uid, monitorName: "Old", monitorType: "cpu", deviceId: ad0, severityId: "sev-info", state: "critical", message: "old", dedupeKey: "storm-old|" + ad0, at: iso(nowMs()) }, { force: true });
      await AL.resolve(pid, oldAlert.alert.id, { note: "done" });
      await T.updateItem(pid, "alerts", oldAlert.alert.id, (it) => { it.resolvedAt = iso(nowMs() - 90 * 86400000); it.lastSeenAt = it.resolvedAt; });
      const pr = await AL.prune(pid);
      check("storm: an aged resolved alert is pruned", pr.ok === true && !(await AL.get(pid, oldAlert.alert.id)).alert, JSON.stringify(pr));
      const acked = (await AL.get(pid, a1.alert.id)).alert;
      check("storm: pruning never drops an acknowledged alert", !!acked && acked.state === "acknowledged" && acked.acknowledgedBy === "storm-tester");
      await AL.scan(pid, { prune: true });
      check("storm: an acknowledged alert survives a scan + prune", !!(await AL.get(pid, a1.alert.id)).alert);

      /* ═══════════ large metric payloads ═══════════ */
      const md = agents[1].deviceId, mc = cred(agents[1]);
      const capSamples = MET.MAX_SAMPLES_PER_POST();
      const many = [];
      for (let i = 0; i < capSamples + 500; i++) many.push({ at: iso(nowMs() - (capSamples + 500 - i) * 60000), cpuPct: i % 100, memPct: i % 80, diskPct: i % 60, netRxBps: i * 10 });
      const metStart = nowMs();
      const big = await MET.submit({ deviceId: md, credential: mc, payload: { samples: many, intervalSeconds: 60 } });
      const metMs = nowMs() - metStart;
      check("storm: a huge metric post is accepted", big.ok === true, JSON.stringify({ e: big.error }));
      check("storm: the per-post sample cap is enforced", big.clipped === true && big.accepted === capSamples && big.rejected === 0, JSON.stringify({ accepted: big.accepted, cap: capSamples }));
      check("storm: the huge post stays responsive", metMs < BUDGET, metMs + "ms");
      let lastMet = big;
      for (let k = 0; k < 6; k++) lastMet = await MET.submit({ deviceId: md, credential: mc, payload: { samples: many.slice(0, capSamples) } });
      check("storm: repeated posts keep the raw ring exactly bounded", lastMet.rawPoints === MET.RAW_LIMIT(), JSON.stringify({ raw: lastMet.rawPoints, limit: MET.RAW_LIMIT() }));
      check("storm: roll-ups accumulate across the posts", lastMet.hourlyPoints >= 1 && lastMet.dailyPoints >= 1);
      const invalid = await MET.submit({ deviceId: md, credential: mc, payload: { samples: [{ cpuPct: 50 }, { at: "not-a-date", cpuPct: 1 }] } });
      check("storm: a post with no valid samples is refused, not crashed", invalid.ok === false && invalid.error === "no_valid_samples");
      const roll = RET.rollup(many.slice(0, capSamples));
      check("storm: roll-up folds a large batch into hourly + daily buckets", roll.hourly.length >= 1 && roll.daily.length >= 1);
      const cs = RET.codecStats({ samples: many });
      check("storm: the codec round-trips a huge body and shrinks it", cs.roundTrip === true && cs.packedBytes < cs.rawBytes && cs.ratio < 100, JSON.stringify({ ratio: cs.ratio }));
      const cm = core.handle("metrics", { deviceId: ce2.deviceId, credential: ce2.credential, payload: { samples: Array.from({ length: 3000 }, (_, i) => ({ at: iso(nowMs() - i * 1000), cpuPct: i % 100 })) } });
      check("storm: the collector caps a huge metric payload", cm.ok === true && cm.accepted === core.limits.maxMetricsSamples, JSON.stringify({ accepted: cm.accepted }));

      /* ═══════════ retention & pruning at scale ═══════════ */
      const PRUNE_N = 12;
      for (let i = 0; i < PRUNE_N; i++) {
        const a = agents[i % FLEET];
        const j = await J.enqueue({ providerId: pid, deviceIds: [a.deviceId], language: a.language, script: "work", name: "prune-" + i, maxAttempts: 1 });
        await J.claim({ deviceId: a.deviceId, credential: cred(a) });
        await J.result({ deviceId: a.deviceId, credential: cred(a), jobId: j.job.id, ok: true, exitCode: 0, stdout: "ok" });
        await patchJobDoc(j.job.id, (job) => { job.updatedAt = iso(nowMs() - 200 * HOUR); });
      }
      const survivor = await J.enqueue({ providerId: pid, deviceIds: [allIds[FLEET - 1]], language: agents[FLEET - 1].language, script: "work", name: "survivor-" + uid, maxAttempts: 3 });
      const reapStart = nowMs();
      const reapOld = await J.reap(pid);
      const reapMs = nowMs() - reapStart;
      check("storm: retention prunes terminal jobs past the window", numTest(reapOld.pruned, 0) >= PRUNE_N, JSON.stringify(reapOld));
      check("storm: pruning never drops a queued job", !!((await J.get(pid, survivor.job.id)).job) && (await J.get(pid, survivor.job.id)).job.state === "queued");
      check("storm: a bulk retention pass stays responsive", reapMs < BUDGET, reapMs + "ms");

      const overRaw = Array.from({ length: MET.RAW_LIMIT() + 40 }, (_, i) => ({ at: iso(nowMs() - i * 60000), cpuPct: 1, memPct: 2 }));
      const synthetic = { kind: "series", id: "met-over-" + uid, providerId: pid, deviceId: allIds[0], raw: overRaw, hourly: [], daily: [] };
      let overVisible = false;
      for (let attempt = 0; attempt < 5 && !overVisible; attempt++) {
        await store.saveDoc(MET.MODULE, [synthetic]);
        const persisted = (await MET.load()).find((r) => r.kind === "series");
        overVisible = !!persisted && asArrTest(persisted.raw).length > MET.RAW_LIMIT();
      }
      check("storm: the over-full metric series is persisted before pruning", overVisible);
      const applyStart = nowMs();
      const rep = await RET.apply(pid);
      const applyMs = nowMs() - applyStart;
      check("storm: apply() prunes an over-full metric ring", !!(rep && rep.metrics) && numTest(rep.metrics.pruned, 0) >= 1, JSON.stringify(rep && rep.metrics));
      const metRec = (await MET.load()).find((r) => r.kind === "series");
      check("storm: the metric ring is exactly at the policy limit after pruning", !!metRec && metRec.raw.length === MET.RAW_LIMIT(), JSON.stringify({ raw: metRec && metRec.raw.length }));
      check("storm: a full retention pass stays responsive", applyMs < BUDGET, applyMs + "ms");

      const cst = core.state();
      cst.metrics[ce2.deviceId] = { samples: Array.from({ length: 1500 }, () => ({ at: iso(nowMs()), cpuPct: 1 })), hourly: Array.from({ length: 300 }, () => ({ at: "h", n: 1 })), daily: Array.from({ length: 200 }, () => ({ at: "d", n: 1 })) };
      cst.logs[ce2.deviceId] = Array.from({ length: 40 }, () => ({ receivedAt: iso(nowMs()), text: "x" }));
      cst.diagnostics[ce2.deviceId] = Array.from({ length: 50 }, () => ({ receivedAt: iso(nowMs()), ok: true }));
      const crf = core.admin.applyRetention({ rawMax: 240, hourlyMax: 168, dailyMax: 30, logKeep: 10, selfTestKeep: 20, updateKeep: 20, historyKeep: 50, jobRetentionHours: 168 });
      check("storm: the collector bounds every durable region", crf.ok === true && cst.metrics[ce2.deviceId].samples.length === 240 && cst.metrics[ce2.deviceId].hourly.length === 168 && cst.metrics[ce2.deviceId].daily.length === 30, JSON.stringify(crf));
      check("storm: the collector bounds logs + self-tests", cst.logs[ce2.deviceId].length === 10 && cst.diagnostics[ce2.deviceId].length === 20);

      await J.reap(pid);
      const surv2 = await J.get(pid, survivor.job.id);
      check("storm: a queued job survives reap + apply", !!surv2.job && surv2.job.state === "queued", JSON.stringify({ e: surv2.error }));
      const ackStill = (await AL.get(pid, a1.alert.id)).alert;
      check("storm: the acknowledged alert is still present after retention", !!ackStill && ackStill.state === "acknowledged");

      const cap = await RET.capacity();
      check("storm: capacity reports the document set + collector state", asArrTest(cap.docs).length >= 1 && typeof cap.collector.bytes === "number", JSON.stringify({ docs: asArrTest(cap.docs).length }));
      check("storm: every canonical file stays in the rmm namespace", Object.keys(srv.files).every((n) => n.indexOf("rmm-v1-") === 0), JSON.stringify(Object.keys(srv.files).slice(0, 5)));

      const totalMs = nowMs() - t0;
      check("storm: the whole failure/storm/scale run stays responsive", totalMs < Math.max(30000, BUDGET * 8), totalMs + "ms");
    } catch (e) {
      check("storm: harness did not crash", false, (e && e.stack) || String(e));
    } finally {
      try { EV.setTransport(null); } catch (e) {}
      try { EV.setSnapshotFn(null); } catch (e) {}
      try { EV.stop(); } catch (e) {}
      try { COL.setTransport(null); COL.resetLocal(); } catch (e) {}
      try { DSP.locked = false; } catch (e) {}
      try { store.useBackend(null); } catch (e) {}
      try { store.resetAllLocal(); } catch (e) {}
      try { T.reload(); } catch (e) {}
      try { if (M && M.seed) await M.seed(); } catch (e) {}
    }

    const passed = results.filter((r) => r.ok).length;
    const failed = results.length - passed;
    return { passed, failed, results };
  };

  /* ============================================================
     Task 48 validation tests — role & access model
     Run via page_eval:  await window.RMMAccessTest()
     Covers: catalogue integrity across the core and the client
     mirror; derived roles and the owner override; site and device
     scopes; per-capability allow/deny overrides; `guardAdmin`
     refusing a read-only or technician every destructive action
     while allowing an in-scope technician; job-source → capability
     mapping; the admin ops round-trip; the client gate answering
     from the hub and refusing out-of-scope; the remote-shell and
     patch gates actually wired to it; the console panel rendering;
     and the public server source carrying the enforcement.
     Runs against a stub backend + a mock hub — real docs untouched.
     ============================================================ */
  window.RMMAccessTest = async function (opts) {
    opts = opts || {};
    results.length = 0;
    const ERP = window.ERP;
    const store = ERP.store;
    const T = ERP.team;
    const TEN = ERP.tenancy;
    const COL = ERP.collector;
    const PA = ERP.patch;
    const REM = ERP.remote;
    const A = ERP.access;
    const uid = Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const eqSet = (a, b) => (a || []).slice().sort().join("|") === (b || []).slice().sort().join("|");
    async function waitFor(fn) { for (let i = 0; i < 60; i++) { if (fn()) return true; await sleep(20); } return false; }

    function makeServer() {
      const files = {};
      return {
        files,
        async get(name) { return Object.prototype.hasOwnProperty.call(files, name) ? files[name] : null; },
        async set(name, json) { const prev = files[name]; files[name] = json; return { created: prev === undefined, unchanged: prev === json, editKey: "k_" + name, superseded: false, error: null }; },
      };
    }
    function enroll(core, providerId, deviceId, hostname, siteId) {
      const token = "ctok-" + deviceId + "-" + Math.random().toString(36).slice(2);
      core.admin.registerToken({ tokenHash: core.sha256Hex(token), providerId, deviceId, siteId: siteId || null, maxUses: 1 });
      return core.handle("enroll", { token, providerId, hostname: hostname || deviceId, agentVersion: "1.0.0" });
    }
    /* A team-hub mock that mirrors the server's RMM access RPCs against a
       real collector core (guardAdmin + admin ops), so the client half is
       exercised end-to-end. */
    function teamMock(core, initial) {
      const users = {
        "owner-1": { userId: "owner-1", displayName: "Owner", role: 2 },
        "disp-1": { userId: "disp-1", displayName: "Dispatcher", role: 1 },
        "tech-1": { userId: "tech-1", displayName: "Tech", role: 0 },
        "ro-1": { userId: "ro-1", displayName: "Read only", role: 0 },
      };
      let as = initial || "owner-1";
      const calls = [];
      const acting = () => { const u = users[as]; return u ? { userId: u.userId, teamRole: u.role } : null; };
      const manage = () => {
        const a = acting();
        if (!a) return { error: "hello_first" };
        const r = core.authorize({ userId: a.userId, teamRole: a.teamRole, action: "access.manage" });
        if (!r.ok) return { error: "forbidden", message: core.describeAuth(r) };
        return { acting: a };
      };
      const t = { calls };
      t.open = () => { if (typeof t.onopen === "function") t.onopen(); };
      t.setUser = (u) => { as = u; };
      t.rpc = async (method, dataStr) => {
        calls.push(method);
        const data = JSON.parse(dataStr || "{}");
        const u = users[as];
        let out = { ok: false, err: "no_method" };
        if (method === "hello") out = { ok: true, userId: u.userId, displayName: u.displayName, role: u.role };
        else if (method === "whoami") out = { ok: true, userId: u.userId, displayName: u.displayName, role: u.role, admin: false };
        else if (method === "peers") out = { ok: true, peers: [] };
        else if (method === "index") out = { ok: true, index: [] };
        else if (method === "rmmCatalog") {
          const a = acting();
          const rec = core.state().access[a.userId] || null;
          const role = core.resolveRole(a.userId, a.teamRole, rec);
          const canManage = core.authorize({ userId: a.userId, teamRole: a.teamRole, action: "access.manage" }).ok;
          out = { ok: true, access: canManage ? core.admin.listAccess() : null, catalog: core.admin.accessCatalog(), me: { userId: a.userId, teamRole: a.teamRole, role: role, caps: Object.keys(core.capsFor(role, Number(a.teamRole) === 2 ? null : rec)), scope: core.scopeOf(a.userId, a.teamRole, rec), canManage: canManage } };
        } else if (method === "rmmAuthorize") {
          const a = acting();
          let deviceId = data.deviceId ? String(data.deviceId) : "";
          let siteId = data.siteId ? String(data.siteId) : "";
          if (deviceId && !siteId) { const dev = core.state().devices[deviceId]; if (dev) siteId = dev.siteId || ""; }
          const r = core.authorize({ userId: a.userId, teamRole: a.teamRole, action: String(data.action || ""), deviceId: deviceId, siteId: siteId });
          out = { ok: r.ok, allowed: r.ok, reason: r.reason, message: core.describeAuth(r), role: r.role, requiredRole: r.requiredRole, destructive: r.destructive, action: r.action };
        } else if (method === "rmmListAccess") { const m = manage(); out = m.error ? { ok: false, error: m.error } : { ok: true, access: core.admin.listAccess() }; }
        else if (method === "rmmSetRole") { const m = manage(); out = m.error ? { ok: false, error: m.error, message: m.message } : core.admin.setAccessRole(data); }
        else if (method === "rmmSetScopes") { const m = manage(); out = m.error ? { ok: false, error: m.error, message: m.message } : core.admin.setAccessScopes(data); }
        else if (method === "rmmSetCaps") { const m = manage(); out = m.error ? { ok: false, error: m.error, message: m.message } : core.admin.setAccessCaps(data); }
        else if (method === "rmmRemoveAccess") { const m = manage(); out = m.error ? { ok: false, error: m.error, message: m.message } : core.admin.removeAccess(data); }
        return JSON.stringify(out);
      };
      return t;
    }

    if (!COL || typeof COL.createCore !== "function" || !T) { check("access: collector + tenancy exposed", false); return { passed: 0, failed: 1, results }; }

    const srv = makeServer();
    const core = COL.createCore({ entropy: "access-" + uid });
    try {
      store.useBackend(srv);
      store.resetAllLocal();
      TEN.reload();
      try { T.setTransport(null); } catch (e) {}

      /* ── 1 · catalogue integrity ── */
      check("access: the client access module is exposed", !!A && typeof A.can === "function" && typeof A.require === "function" && typeof A.render === "function");
      check("access: the four roles agree across core and client", eqSet(core.roles, A.roles), JSON.stringify(core.roles) + " vs " + JSON.stringify(A.roles));
      let roleCapsMismatch = [];
      for (const r of core.roles) if (!eqSet(core.roleCaps[r], A.roleCaps[r])) roleCapsMismatch.push(r);
      check("access: each role's capabilities agree", roleCapsMismatch.length === 0, roleCapsMismatch.join(","));
      check("access: the capability list agrees", eqSet(core.capabilities().map((c) => c.id), A.capOrder), A.capOrder.join(","));
      check("access: the destructive set agrees", eqSet(core.destructiveCaps, A.destructive), JSON.stringify(A.destructive));
      check("access: capability metadata agrees", eqSet(Object.keys(core.caps), Object.keys(A.caps)));
      check("access: exactly four destructive capabilities", core.destructiveCaps.length === 4 && core.destructiveCaps.every((c) => core.caps[c] && core.caps[c].destructive === true));
      check("access: only security-admin carries a destructive capability", core.destructiveCaps.every((c) => ["technician", "dispatcher", "read-only"].every((r) => core.roleCaps[r].indexOf(c) === -1)));
      check("access: every destructive capability needs security-admin", core.destructiveCaps.every((c) => core.minRoleFor(c) === "security-admin"));
      check("access: remote.shell and remote.file are separate capabilities", core.destructiveCaps.indexOf("remote.shell") !== -1 && core.destructiveCaps.indexOf("remote.file") !== -1);

      /* ── 2 · derived roles & the owner override ── */
      check("access: derived roles follow the team role", core.resolveRole("x", 0) === "read-only" && core.resolveRole("x", 1) === "dispatcher" && core.resolveRole("x", 2) === "security-admin");
      core.admin.setAccessRole({ userId: "derived-1", role: "technician" });
      check("access: an explicit record role wins over the derived one", core.resolveRole("derived-1", 0) === "technician");
      core.admin.setAccessRole({ userId: "owner-1", role: "read-only" });
      check("access: the owner can never be demoted", core.resolveRole("owner-1", 2) === "security-admin");
      check("access: the owner always has full scope", core.scopeOf("owner-1", 2).all === true);
      core.admin.setAccessRole({ userId: "owner-1", role: null });

      /* ── 3 · scopes ── */
      enroll(core, "prov-1", "dev-hq", "HQ-1", "site-hq");
      enroll(core, "prov-1", "dev-br", "BR-1", "site-br");
      enroll(core, "prov-1", "dev-hq2", "HQ-2", "site-hq");
      core.admin.setAccessRole({ userId: "tech-1", role: "technician" });
      core.admin.setAccessScopes({ userId: "tech-1", scopes: { all: false, sites: ["site-hq"], devices: [] } });
      let a1 = core.authorize({ userId: "tech-1", teamRole: 0, action: "device.diagnose", deviceId: "dev-hq", siteId: "site-hq" });
      let a2 = core.authorize({ userId: "tech-1", teamRole: 0, action: "device.diagnose", deviceId: "dev-br", siteId: "site-br" });
      check("access: a site scope allows an in-site device", a1.ok === true, JSON.stringify(a1));
      check("access: a site scope refuses an out-of-site device", a2.ok === false && a2.reason === "out_of_scope", JSON.stringify(a2));
      core.admin.setAccessScopes({ userId: "tech-1", scopes: { all: false, sites: [], devices: ["dev-br"] } });
      check("access: a device scope allows that device", core.authorize({ userId: "tech-1", teamRole: 0, action: "device.diagnose", deviceId: "dev-br" }).ok === true);
      check("access: a device scope refuses another site's device", core.authorize({ userId: "tech-1", teamRole: 0, action: "device.diagnose", deviceId: "dev-hq", siteId: "site-hq" }).reason === "out_of_scope");
      check("access: an empty scope normalises to full scope", core.admin.setAccessScopes({ userId: "tech-1", scopes: { all: false, sites: [], devices: [] } }).scopes.all === true);

      /* ── 4 · per-capability overrides ── */
      core.admin.setAccessRole({ userId: "tech-1", role: "technician" });
      core.admin.setAccessCaps({ userId: "tech-1", allow: ["script.execute"], deny: [] });
      check("access: an allow override grants a destructive capability", core.authorize({ userId: "tech-1", teamRole: 0, action: "script.execute" }).ok === true);
      core.admin.setAccessCaps({ userId: "tech-1", allow: [], deny: ["patch.deploy"] });
      check("access: a deny override removes a role capability", core.authorize({ userId: "tech-1", teamRole: 0, action: "patch.deploy" }).reason === "forbidden");
      const both = core.admin.setAccessCaps({ userId: "tech-1", allow: ["remote.shell"], deny: ["remote.shell"] });
      check("access: a capability cannot be both allowed and denied", both.allow.length === 1 && both.deny.length === 0, JSON.stringify(both));
      core.admin.setAccessCaps({ userId: "tech-1", allow: [], deny: [] });

      /* ── 5 · guardAdmin — the server-side rule engine ── */
      const admin = (user, teamRole, action, payload) => core.guardAdmin({ userId: user, teamRole: teamRole }, action, payload || {});
      check("access: read-only may view the fleet", admin("ro-1", 0, "fleet").ok === true);
      check("access: read-only may not run diagnostics", admin("ro-1", 0, "requestLogs", { deviceIds: ["dev-hq"] }).ok === false);
      check("access: read-only may not execute a script", admin("ro-1", 0, "pushJob", { deviceId: "dev-hq", job: { source: "console" } }).capability === "script.execute");
      check("access: read-only may not open a remote shell", admin("ro-1", 0, "pushJob", { deviceId: "dev-hq", job: { source: "remote-shell" } }).ok === false);
      check("access: read-only may not transfer files", admin("ro-1", 0, "pushJob", { deviceId: "dev-hq", job: { source: "remote-transfer" } }).ok === false);
      check("access: read-only may not deny a patch", admin("ro-1", 0, "pushJob", { deviceId: "dev-hq", job: { source: "patch-deploy" } }).ok === false);
      check("access: read-only may not revoke a device", admin("ro-1", 0, "revokeDevice", { deviceId: "dev-hq" }).ok === false);
      check("access: a technician may run diagnostics in scope", admin("tech-1", 0, "requestLogs", { deviceIds: ["dev-hq"] }).ok === true);
      check("access: a technician may deploy a patch in scope", admin("tech-1", 0, "pushJob", { deviceId: "dev-hq", job: { source: "patch-deploy:x" } }).ok === true);
      check("access: a technician may not open a remote shell", admin("tech-1", 0, "pushJob", { deviceId: "dev-hq", job: { source: "remote-shell:s1" } }).ok === false);
      check("access: a technician may not transfer files", admin("tech-1", 0, "pushJob", { deviceId: "dev-hq", job: { source: "remote-transfer" } }).ok === false);
      check("access: a technician may not execute an arbitrary script", admin("tech-1", 0, "pushJob", { deviceId: "dev-hq", job: { source: "adhoc" } }).ok === false);
      check("access: a dispatcher may push config but not a shell", admin("disp-1", 1, "pushConfig", { deviceId: "dev-hq", config: {} }).ok === true && admin("disp-1", 1, "pushJob", { deviceId: "dev-hq", job: { source: "remote-shell" } }).ok === false);
      check("access: a security-admin may open a remote shell", admin("owner-1", 2, "pushJob", { deviceId: "dev-hq", job: { source: "remote-shell" } }).ok === true);
      check("access: a security-admin may transfer files", admin("owner-1", 2, "pushJob", { deviceId: "dev-hq", job: { source: "remote-transfer:x" } }).ok === true);
      check("access: a security-admin may revoke a device", admin("owner-1", 2, "revokeDevice", { deviceId: "dev-hq" }).ok === true);
      check("access: an unknown action is refused", admin("owner-1", 2, "dropDatabase", {}).error === "unknown_action");
      core.admin.setAccessRole({ userId: "tech-2", role: "technician" });
      core.admin.setAccessScopes({ userId: "tech-2", scopes: { all: false, sites: ["site-hq"], devices: [] } });
      check("access: a scoped technician is refused on an out-of-scope device", admin("tech-2", 0, "pushJob", { deviceId: "dev-br", job: { source: "patch-deploy" } }).error === "out_of_scope");
      check("access: a scoped technician is allowed in scope", admin("tech-2", 0, "pushJob", { deviceId: "dev-hq", job: { source: "patch-deploy" } }).ok === true);
      core.admin.setAccessCaps({ userId: "tech-2", allow: ["remote.shell"], deny: [] });
      check("access: a granted override unlocks a destructive action for a technician", admin("tech-2", 0, "pushJob", { deviceId: "dev-hq", job: { source: "remote-shell" } }).ok === true);

      /* ── 6 · job-source → capability mapping ── */
      check("access: job sources map to the tightest capability", core.capForJobSource("remote-shell:xyz") === "remote.shell" && core.capForJobSource("remote-transfer") === "remote.file" && core.capForJobSource("patch-deploy:1:retry") === "patch.deploy" && core.capForJobSource("console") === "script.execute" && core.capForJobSource("monitor") === "job.run");
      check("access: an explicit required capability wins", core.capForJobSource("anything", "remote.file") === "remote.file");

      /* ── 7 · admin ops round-trip ── */
      const cat = core.admin.accessCatalog();
      check("access: the catalog exposes four roles and every capability", cat.ok === true && cat.roles.length === 4 && cat.capabilities.length === A.capOrder.length && cat.destructive.length === 4);
      core.admin.setAccessRole({ userId: "ops-1", role: "read-only" });
      const la = core.admin.listAccess();
      check("access: listAccess includes the new record", la.ok === true && la.users.some((u) => u.userId === "ops-1" && u.role === "read-only"));
      check("access: bad roles are refused", core.admin.setAccessRole({ userId: "ops-1", role: "superuser" }).error === "bad_role");
      check("access: removeAccess clears the record", core.admin.removeAccess({ userId: "ops-1" }).removed === true && core.resolveRole("ops-1", 0) === "read-only");
      const chk = core.admin.accessCheck({ userId: "tech-1", teamRole: 0, action: "remote.shell" });
      check("access: accessCheck reports a verdict and a message", chk.ok === false && typeof chk.message === "string" && chk.message.length > 0, chk.message);

      /* ── 8 · the client gate — driven by the hub ── */
      let mock = teamMock(core, "ro-1");
      T.setTransport(mock);
      const roOnline = await waitFor(() => T.me && T.me.userId === "ro-1");
      check("access: the client connects to the hub", roOnline === true, JSON.stringify(T.me));
      A.invalidate();
      await A.load(true);
      check("access: the client resolves the read-only role", A.myRole() === "read-only", A.myRole());
      check("access: the client allows fleet view but not a shell", A.can("fleet.view") === true && A.can("remote.shell") === false);
      check("access: the client's capability mirror matches the core", eqSet(Object.keys(A.effectiveCaps()), core.roleCaps["read-only"]), Object.keys(A.effectiveCaps()).join(","));
      const req = await A.require("remote.shell", "dev-hq");
      check("access: require() asks the hub and is refused", req.ok === false && mock.calls.indexOf("rmmAuthorize") !== -1, JSON.stringify(req));
      const panel = document.createElement("div");
      await A.render(panel, { toast() {} });
      check("access: the console panel renders the role matrix", /Role capabilities/.test(panel.innerHTML) && /script\.execute/.test(panel.innerHTML));
      check("access: a read-only user sees no management table", /Console access/.test(panel.innerHTML) === false && /security-admin role/.test(panel.innerHTML));

      /* technician, site-scoped, via the hub */
      core.admin.setAccessRole({ userId: "tech-1", role: "technician" });
      core.admin.setAccessScopes({ userId: "tech-1", scopes: { all: false, sites: ["site-hq"], devices: [] } });
      mock = teamMock(core, "tech-1");
      T.setTransport(mock);
      await waitFor(() => T.me && T.me.userId === "tech-1");
      A.invalidate();
      await A.load(true);
      check("access: the client resolves a technician's role and scope", A.myRole() === "technician" && A.can("device.diagnose", { deviceId: "dev-hq", siteId: "site-hq" }) === true);
      check("access: the client mirror refuses an out-of-scope device", A.can("device.diagnose", { deviceId: "dev-br", siteId: "site-br" }) === false);
      const reqT = await A.require("remote.file", "dev-hq");
      check("access: a technician is refused a file transfer by the hub", reqT.ok === false && /role/.test(reqT.message || ""), JSON.stringify(reqT));

      /* owner — full management through the client */
      mock = teamMock(core, "owner-1");
      T.setTransport(mock);
      await waitFor(() => T.me && T.me.userId === "owner-1");
      A.invalidate();
      await A.load(true);
      check("access: the owner resolves as a security-admin", A.myRole() === "security-admin");
      check("access: the owner may open a remote shell", A.can("remote.shell", { deviceId: "dev-br", siteId: "site-br" }) === true);
      const setR = await A.setRole("ro-1", "dispatcher");
      check("access: the owner assigns a role through the client", setR.ok === true && core.resolveRole("ro-1", 0) === "dispatcher", JSON.stringify(setR));
      const setS = await A.setScopes("ro-1", { all: false, sites: ["site-hq"] });
      check("access: the owner sets a scope through the client", setS.ok === true && setS.scopes.sites.indexOf("site-hq") !== -1);
      const setC = await A.setCaps("ro-1", ["fleet.view"], []);
      check("access: the owner sets capability overrides through the client", setC.ok === true);
      const remR = await A.remove("ro-1");
      check("access: the owner removes an access record through the client", remR.ok === true && core.state().access["ro-1"] === undefined);
      A.invalidate();
      await A.load(true);
      const panel2 = document.createElement("div");
      await A.render(panel2, { toast() {} });
      check("access: an admin sees the management table and the log", /Console access/.test(panel2.innerHTML) && /Access changes/.test(panel2.innerHTML) && panel2.querySelector('[data-acc="role"]') !== null);

      /* ── 9 · other modules consult the gate ── */
      check("access: the remote shell gate is wired to the model", typeof REM.canShell === "function" && typeof REM.canTool === "function" && typeof REM.canTransfer === "function");
      mock = teamMock(core, "tech-1");
      T.setTransport(mock);
      await waitFor(() => T.me && T.me.userId === "tech-1");
      A.invalidate();
      await A.load(true);
      const shellTech = REM.canShell("dev-hq");
      check("access: a technician's remote shell is refused by the remote module", shellTech.ok === false && shellTech.capability === "remote.shell", JSON.stringify(shellTech));
      mock = teamMock(core, "owner-1");
      T.setTransport(mock);
      await waitFor(() => T.me && T.me.userId === "owner-1");
      A.invalidate();
      await A.load(true);
      check("access: a security-admin's remote shell is allowed", REM.canShell("dev-br").ok === true);
      const policyDeny = await PA.addPolicy("prov-1", { name: "Deny test " + uid, default: { decision: "deny" }, classifications: {} });
      check("access: a patch-denying policy needs patch.deny (owner allowed past the gate)", policyDeny.error !== "forbidden", JSON.stringify(policyDeny));

      /* read-only cannot deny a patch */
      mock = teamMock(core, "ro-1");
      T.setTransport(mock);
      await waitFor(() => T.me && T.me.userId === "ro-1");
      A.invalidate();
      await A.load(true);
      const policyDeny2 = await PA.addPolicy("prov-1", { name: "Deny test 2 " + uid, default: { decision: "deny" }, classifications: {} });
      check("access: a read-only user cannot create a deny policy", policyDeny2.error === "forbidden", JSON.stringify(policyDeny2));

      /* ── 10 · the enforcement lives in the public server source ── */
      const el = document.querySelector('script[type="text/x-server-plugin"]');
      const serverText = el ? el.textContent : "";
      check("access: the server source carries the guard", serverText.indexOf("guardAdmin") !== -1 && serverText.indexOf("ADMIN_CAP") !== -1 && serverText.indexOf("authorize: authorize") !== -1);
      check("access: the server exposes the access RPCs", ["rmmCatalog", "rmmAuthorize", "rmmListAccess", "rmmSetRole", "rmmSetScopes", "rmmSetCaps", "rmmRemoveAccess"].every((m) => serverText.indexOf(m) !== -1));
      check("access: the enforcement is applied to every collector admin op", serverText.indexOf("collectorCore.guardAdmin(") !== -1 || serverText.indexOf("collectorCore.guardAdmin(acting") !== -1);
      check("access: the public source holds no plaintext owner password", serverText.indexOf("TzIucqLXjk_UwvBQhfSLE51x_gWuih-YMJgBgsFrLDE") === -1);
    } catch (e) {
      check("access: harness did not crash", false, (e && e.stack) || String(e));
    } finally {
      try { T.setTransport(null); } catch (e) {}
      try { COL.setTransport(null); COL.resetLocal(); } catch (e) {}
      try { if (A && A.invalidate) A.invalidate(); } catch (e) {}
      try { store.useBackend(null); } catch (e) {}
      try { store.resetAllLocal(); } catch (e) {}
      try { TEN.reload(); } catch (e) {}
    }

    const passed = results.filter((r) => r.ok).length;
    const failed = results.length - passed;
    return { passed, failed, results };
  };

  /* ============================================================
     Task 49 validation tests — realtime console
     Run via page_eval:  await window.RMMLiveTest()
     Covers: the LIVE module & topbar indicator; the realtime mode and
     its polling/offline fallback; watched views re-rendering on device
     state / alert / job events (throttled); console presence — focus
     announcement, viewer fan-out, others(), onViewers(); the realtime
     console panel; and the server-side presence RPCs.
     Uses mock transports (EV + hub) so no real socket/documents are touched.
     ============================================================ */
  window.RMMLiveTest = async function (opts) {
    opts = opts || {};
    results.length = 0;
    const ERP = window.ERP;
    const store = ERP.store;
    const T = ERP.team;
    const EV = ERP.events;
    const LIVE = ERP.live;
    const uid = Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    async function waitFor(fn) { for (let i = 0; i < 60; i++) { if (fn()) return true; await sleep(20); } return false; }

    /* A hub mock that mirrors the server's presence RPCs, so LIVE's presence
       half is exercised end-to-end. */
    function makeHub() {
      const calls = [];
      const viewers = {};
      const focus = { deviceId: "" };
      let user = { userId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", displayName: "Tech", role: 0 };
      const hub = { calls, viewers, focus };
      hub.setUser = (u) => { user = u; };
      hub.open = () => { if (typeof hub.onopen === "function") hub.onopen(); };
      hub.deliver = (o) => { if (typeof hub.onmessage === "function") hub.onmessage(JSON.stringify(o)); };
      hub.rpc = async (method, dataStr) => {
        calls.push(method);
        const data = JSON.parse(dataStr || "{}");
        let out = { ok: false, err: "no_method" };
        if (method === "hello") out = { ok: true, userId: user.userId, displayName: user.displayName, role: user.role };
        else if (method === "index") out = { ok: true, index: [] };
        else if (method === "peers") out = { ok: true, peers: [{ userId: user.userId, displayName: user.displayName, role: user.role }] };
        else if (method === "whoami") out = { ok: true, userId: user.userId, displayName: user.displayName, role: user.role, admin: false };
        else if (method === "rmmFocus") {
          const did = String(data.deviceId || "");
          const prev = focus.deviceId;
          focus.deviceId = did;
          if (prev && prev !== did) hub.deliver({ t: "viewers", d: prev, users: viewers[prev] || [] });
          if (did) hub.deliver({ t: "viewers", d: did, users: viewers[did] || [] });
          out = { ok: true, deviceId: did, viewers: viewers[did] || [] };
        } else if (method === "rmmViewers") {
          const did = String(data.deviceId || "");
          out = { ok: true, deviceId: did, viewers: viewers[did] || [] };
        } else if (method === "rmmPresenceList") {
          out = { ok: true, sessions: [{ userId: user.userId, displayName: user.displayName, role: user.role, focus: focus.deviceId ? { deviceId: focus.deviceId } : null }], online: 1 };
        }
        return JSON.stringify(out);
      };
      return hub;
    }

    const ev = {
      open() { if (this.onopen) this.onopen(); },
      close() { if (this.onclose) this.onclose(); },
      fire(o) { if (this.onmessage) this.onmessage(JSON.stringify(o)); },
    };

    try {
      check("live: the realtime console module is exposed", !!LIVE && ["focus", "blur", "viewers", "others", "watch", "status", "render", "openPanel", "onViewers"].every((f) => typeof LIVE[f] === "function"));
      check("live: the topbar realtime indicator is wired", !!document.getElementById("rmmLive") && !!document.getElementById("rmmLiveDot") && !!document.getElementById("rmmLiveText"));

      /* ── 1 · the stream & mode ── */
      EV.setTransport(ev);
      check("live: a live socket reports live mode", LIVE.mode() === "live" && LIVE.isLive() === true, LIVE.mode());
      ev.close();
      check("live: a closed stream drops out of live mode", LIVE.mode() !== "live", LIVE.mode());

      /* ── 2 · watched views re-render on realtime events (throttled) ── */
      EV.setTransport(ev);
      const origCfg = ERP.configVal;
      ERP.configVal = (p, f) => (p === "rmm.liveAutoRefreshSeconds" ? 1 : origCfg(p, f));
      let hits = 0;
      const off = LIVE.watch(() => { hits++; });
      check("live: watch() registers a live view", LIVE.watchCount() >= 1);
      ev.fire({ t: "evt", kind: "device-state", deviceId: "dev-lv1", to: "offline" });
      await sleep(1300);
      ERP.configVal = origCfg;
      check("live: a device-state event refreshes a watched view", hits >= 1, "hits=" + hits);
      hits = 0;
      LIVE.refreshNow();
      check("live: refreshNow() forces an immediate refresh", hits >= 1, "hits=" + hits);
      off();

      /* ── 3 · presence — who else is on this device ── */
      const hub = makeHub();
      T.setTransport(hub);
      const online = await waitFor(() => T.online === true);
      check("live: the console session connects to the hub", online === true, "online=" + T.online);
      check("live: presence is available while the hub is online", LIVE.presenceAvailable() === true);
      /* regression: peersList/hubIndex must be live getters, not captured values
         (a reconnect reassigns the underlying arrays, which a captured value misses) */
      const pd = Object.getOwnPropertyDescriptor(T, "peersList");
      const hd = Object.getOwnPropertyDescriptor(T, "hubIndex");
      check("live: peersList/hubIndex are live getters, not captured values", !!pd && typeof pd.get === "function" && pd.value === undefined && !!hd && typeof hd.get === "function" && hd.value === undefined, JSON.stringify({ peersGet: !!(pd && pd.get), hubGet: !!(hd && hd.get), peersValue: pd && typeof pd.value }));
      hub.viewers["dev-lv1"] = [{ userId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", displayName: "Other", role: 0 }];
      const fr = await LIVE.focus("dev-lv1", "prov-lv");
      check("live: focus announces the viewed device to the hub", fr && fr.ok === true && hub.calls.indexOf("rmmFocus") !== -1, JSON.stringify(fr));
      check("live: the hub reports the viewers of the device", LIVE.viewers("dev-lv1").length === 1 && LIVE.viewers("dev-lv1")[0].displayName === "Other", JSON.stringify(LIVE.viewers("dev-lv1")));
      const meId = T.me.userId;
      hub.deliver({ t: "viewers", d: "dev-lv1", users: [{ userId: meId, displayName: "Tech", role: 0 }, { userId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", displayName: "Other", role: 0 }] });
      await sleep(30);
      check("live: others() excludes this session", LIVE.others("dev-lv1").length === 1 && LIVE.others("dev-lv1")[0].userId === "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", JSON.stringify(LIVE.others("dev-lv1")));
      let vhits = 0;
      const offV = LIVE.onViewers(() => { vhits++; });
      hub.deliver({ t: "viewers", d: "dev-lv1", users: [] });
      await sleep(30);
      offV();
      check("live: onViewers() notifies subscribers", vhits >= 1, "vhits=" + vhits);

      /* ── 3b · regression: only the realtime panel clears device focus ── */
      const ui = ERP.ui;
      const focusedBefore = LIVE.focused();
      ui.modal({ title: "Unrelated", body: "<p>x</p>" });
      ui.closeModal();
      check("live: closing an unrelated modal keeps the viewed device focused", !!LIVE.focused() && LIVE.focused().deviceId === focusedBefore.deviceId, JSON.stringify(LIVE.focused()));
      LIVE.openPanel();
      await sleep(20);
      ui.closeModal();
      check("live: closing the realtime panel clears the viewed device", LIVE.focused() === null, JSON.stringify(LIVE.focused()));
      await LIVE.focus("dev-lv1", "prov-lv");

      /* ── 4 · the realtime console panel ── */
      const host = document.createElement("div");
      await LIVE.render(host);
      check("live: the panel renders the realtime cards", /Realtime console/.test(host.innerHTML) && /Event stream/.test(host.innerHTML));
      check("live: the panel lists console sessions & the focused device", /Console sessions/.test(host.innerHTML) && /On this device/.test(host.innerHTML), host.innerHTML.length);

      /* ── 5 · graceful fallback to polling / offline ── */
      const stub = { async get() { return null; }, async set() { return { error: "offline" }; } };
      store.useBackend(stub);
      T.setTransport(null);
      EV.setTransport(null);
      check("live: presence is reported unavailable offline", LIVE.presenceAvailable() === false);
      check("live: the mode falls back when the stream is gone", LIVE.mode() === "offline" && LIVE.modeLabel() === "offline", LIVE.mode());
      const offlineFocus = await LIVE.focus("dev-lv9", "prov-lv");
      check("live: focus degrades gracefully without a hub", offlineFocus && offlineFocus.ok === false && offlineFocus.error === "offline", JSON.stringify(offlineFocus));
      const host2 = document.createElement("div");
      await LIVE.render(host2);
      check("live: the panel still renders offline", /Realtime console/.test(host2.innerHTML));
      check("live: status() summarises the fallback", LIVE.status().presence === false && LIVE.status().mode === "offline");

      /* ── 6 · enforcement lives in the public server source ── */
      const el = document.querySelector('script[type="text/x-server-plugin"]');
      const serverText = el ? el.textContent : "";
      check("live: the server tracks focus & publishes viewers", serverText.indexOf("rmmFocus") !== -1 && serverText.indexOf("publishViewers") !== -1 && serverText.indexOf("viewersOf") !== -1);
      check("live: the server exposes the presence RPCs", serverText.indexOf("rmmViewers") !== -1 && serverText.indexOf("rmmPresenceList") !== -1);
      check("live: presence is cleared when a session closes", /if \(e\.focus && e\.focus\.deviceId\) publishViewers/.test(serverText) || serverText.indexOf("publishViewers(e.focus.deviceId)") !== -1);
    } catch (e) {
      check("live: harness did not crash", false, (e && e.stack) || String(e));
    } finally {
      try { EV.setTransport(null); } catch (e) {}
      try { T.setTransport(null); } catch (e) {}
      try { store.useBackend(null); } catch (e) {}
      try { if (LIVE && LIVE.blur) LIVE.blur(); } catch (e) {}
    }

    const passed = results.filter((r) => r.ok).length;
    const failed = results.length - passed;
    return { passed, failed, results };
  };

  /* ============================================================
     Task 50 validation tests — multi-user audit & rate control
     Run via page_eval:  await window.RMMMultiUserTest()
     Covers: the hub-authenticated identity; grouped connection stats &
     the limits in force; document edit claims (claim/release/editGuard);
     the true-actor audit trail (auditRemote + auditTail); conflict
     broadcast handling; the canonical store's refusal to silently
     overwrite another user's change; the panel; and the server RPCs.
     ============================================================ */
  window.RMMMultiUserTest = async function (opts) {
    opts = opts || {};
    results.length = 0;
    const ERP = window.ERP;
    const store = ERP.store;
    const T = ERP.team;
    const MU = ERP.multiuser;
    const uid = Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    async function waitFor(fn) { for (let i = 0; i < 60; i++) { if (fn()) return true; await sleep(20); } return false; }

    function makeHub() {
      const calls = [];
      const claims = {};
      const audit = [];
      let seq = 0;
      let user = { userId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", displayName: "Tech", role: 0 };
      const hub = { calls, claims };
      hub.setUser = (u) => { user = u; };
      hub.seedClaim = (doc, holder) => { claims[doc] = holder; };
      hub.open = () => { if (typeof hub.onopen === "function") hub.onopen(); };
      hub.deliver = (o) => { if (typeof hub.onmessage === "function") hub.onmessage(JSON.stringify(o)); };
      hub.rpc = async (method, dataStr) => {
        calls.push(method);
        const data = JSON.parse(dataStr || "{}");
        let out = { ok: false, err: "no_method" };
        if (method === "hello") out = { ok: true, userId: user.userId, displayName: user.displayName, role: user.role };
        else if (method === "index") out = { ok: true, index: [] };
        else if (method === "peers") out = { ok: true, peers: [{ userId: user.userId, displayName: user.displayName, role: user.role }] };
        else if (method === "whoami") out = { ok: true, userId: user.userId, displayName: user.displayName, role: user.role, admin: false };
        else if (method === "rmmConnStats") out = { ok: true, groups: [{ net: "8172", sessions: 3, users: 2, proxy: false }], cap: 10, sockets: 4, sessions: 2 };
        else if (method === "rmmClaim") {
          const doc = String(data.doc || "");
          const held = claims[doc];
          if (held && held.userId !== user.userId) out = { ok: false, conflict: true, holder: { userId: held.userId, displayName: held.displayName }, message: (held.displayName || "Another user") + " is editing this document." };
          else { claims[doc] = { userId: user.userId, displayName: user.displayName, baseRev: Number(data.baseRev) || 0 }; out = { ok: true, claim: { userId: user.userId, displayName: user.displayName, baseRev: Number(data.baseRev) || 0 } }; }
        } else if (method === "rmmRelease") { const doc = String(data.doc || ""); const had = !!claims[doc]; delete claims[doc]; out = { ok: true, released: had }; }
        else if (method === "rmmClaims") { const list = []; for (const k in claims) list.push({ doc: k, userId: claims[k].userId, displayName: claims[k].displayName, baseRev: claims[k].baseRev, ageSeconds: 3 }); out = { ok: true, claims: list }; }
        else if (method === "rmmAudit") {
          const action = String(data.action || "");
          seq++;
          const entry = { seq: seq, ts: new Date().toISOString(), userId: user.userId, displayName: user.displayName, role: user.role, action: action };
          audit.push(entry);
          out = { ok: true, entry: entry };
        } else if (method === "auditTail") {
          out = { ok: true, entries: audit.map((a) => ({ seq: a.seq, ts: Date.now() / 1000 | 0, role: a.role, user: a.userId, action: a.action })) };
        }
        return JSON.stringify(out);
      };
      return hub;
    }

    try {
      check("multi-user: the module is exposed", !!MU && ["claim", "release", "editGuard", "auditRemote", "connections", "claims", "conflicts", "render", "limits", "identity"].every((f) => typeof MU[f] === "function"));
      check("multi-user: the limits reflect the configuration", MU.limits().sessionsPerNet >= 1 && MU.limits().actionsPerMinute >= 1 && MU.limits().claimsPerMinute >= 1, JSON.stringify(MU.limits()));

      const hub = makeHub();
      T.setTransport(hub);
      const online = await waitFor(() => T.online === true);
      check("multi-user: the session authenticates to the hub with its role", online === true);
      const id = MU.identity();
      check("multi-user: the identity is the hub-authenticated one", id.authenticated === true && id.userId === T.me.userId && id.role === T.me.role, JSON.stringify(id));

      /* ── 1 · grouped connections & rate control ── */
      const conn = await MU.connections();
      check("multi-user: connections are grouped by network", conn.ok === true && conn.groups.length === 1 && conn.groups[0].sessions === 3, JSON.stringify(conn));

      /* ── 2 · document claims ── */
      const doc = "rmm-v1-parties";
      const c1 = await MU.claim(doc, 4);
      check("multi-user: a free document can be claimed", c1 && c1.ok === true && hub.calls.indexOf("rmmClaim") !== -1, JSON.stringify(c1));
      hub.seedClaim(doc, { userId: "cccccccccccccccccccccccccccccccc", displayName: "Other Tech", baseRev: 4 });
      const guard = await MU.editGuard(doc, 4);
      check("multi-user: editGuard refuses a document held by another user", guard && guard.ok === false && guard.conflict === true && /editing/.test(guard.message), JSON.stringify(guard));
      const rel = await MU.release(doc);
      check("multi-user: a claim can be released", rel && rel.ok === true, JSON.stringify(rel));

      /* ── 3 · the true-actor audit trail ── */
      const entry = await MU.auditRemote("patch.deploy");
      check("multi-user: auditRemote stamps the hub-resolved actor", entry && entry.userId === T.me.userId && entry.action === "patch.deploy", JSON.stringify(entry));
      check("multi-user: the audit cursor advances", MU.lastAuditSeq() === entry.seq, "seq=" + MU.lastAuditSeq());
      const tail = await MU.auditTail(50);
      check("multi-user: the audit tail is readable", tail.ok === true && tail.entries.some((a) => a.action === "patch.deploy" && a.user === T.me.userId), JSON.stringify(tail.entries));

      /* ── 4 · conflict broadcast ── */
      let chits = 0;
      const offC = MU.onConflict(() => { chits++; });
      hub.deliver({ t: "conflict", d: "rmm-v1-devices", mine: 3, theirs: 5, u: "dddddddddddddddddddddddddddddddd", n: "Other", ts: Date.now() / 1000 | 0 });
      await sleep(30);
      offC();
      check("multi-user: a conflict broadcast reaches the console", chits >= 1 && T.lastConflict && T.lastConflict.theirs === 5, JSON.stringify(T.lastConflict));
      check("multi-user: conflicts() reports the last broadcast conflict", MU.conflicts().last && MU.conflicts().last.mine === 3);

      /* ── 5 · the panel ── */
      const host = document.createElement("div");
      await MU.render(host);
      check("multi-user: the panel renders every section", /Multi-user &amp; rate control/.test(host.innerHTML) && /Connections &amp; rate control/.test(host.innerHTML) && /Live edit claims/.test(host.innerHTML) && /True-actor audit trail/.test(host.innerHTML) && /Overwrite safety/.test(host.innerHTML));

      /* ── 6 · the canonical store never silently overwrites ── */
      T.setTransport(null);
      const srv = {
        files: {},
        async get(n) { return Object.prototype.hasOwnProperty.call(this.files, n) ? this.files[n] : null; },
        async set(n, json, o) {
          const prev = this.files[n];
          if (prev !== undefined && !(o && o.editKey)) return { created: false, unchanged: false, editKey: null, superseded: false, error: "edit_key_required" };
          const created = prev === undefined;
          this.files[n] = json;
          return { created, unchanged: prev === json, editKey: "k_" + n, superseded: false, error: null };
        },
      };
      store.useBackend(srv);
      store.resetAllLocal();
      const name = "rmm-v1-mu-" + uid;
      const w1 = await store.set(name, [{ id: 1 }]);
      check("multi-user: the first write creates the document", !w1.error && w1.rev >= 1, JSON.stringify(w1));
      const theirs = JSON.parse(srv.files[name]);
      theirs.rev = (theirs.rev || 0) + 1;
      theirs.records = [{ id: 1 }, { id: 2 }];
      srv.files[name] = JSON.stringify(theirs);
      const w2 = await store.set(name, [{ id: 1 }, { id: 9 }]);
      check("multi-user: a stale write is refused, not silently applied", !!w2 && w2.error === "conflict" && w2.conflict === true, JSON.stringify(w2));
      const canon = await store.readCanonical(name);
      const recs = (canon && canon.doc && canon.doc.records) || [];
      check("multi-user: the other user's change is intact", recs.some((r) => r.id === 2) && !recs.some((r) => r.id === 9), JSON.stringify(recs));
      check("multi-user: the conflict is recorded for review", store.conflicts().some((c) => c.name === name));
      check("multi-user: MU surfaces the pending conflict", MU.conflicts().pending.some((c) => c.name === name));
      store.resetAllLocal();

      /* ── 7 · the enforcement lives in the public server source ── */
      const el = document.querySelector('script[type="text/x-server-plugin"]');
      const serverText = el ? el.textContent : "";
      check("multi-user: the server groups connections & caps sessions per network", serverText.indexOf("MAX_SESSIONS_PER_NET") !== -1 && serverText.indexOf("sessionsForNet") !== -1 && serverText.indexOf("netKey") !== -1);
      check("multi-user: the server audits the true actor for remote actions", serverText.indexOf("function auditRemote(") !== -1 && /auditRemote\(acting, action, false\)/.test(serverText) && /auditRemote\(acting, action, !\!/.test(serverText));
      check("multi-user: the server mediates document claims", serverText.indexOf("rmmClaim") !== -1 && serverText.indexOf("docClaims") !== -1 && serverText.indexOf("releaseClaim") !== -1);
      check("multi-user: the server refuses & broadcasts a stale announce", serverText.indexOf("conflict: true") !== -1 && /t: "conflict"/.test(serverText));
      check("multi-user: the server exposes the multi-user RPCs", ["rmmConnStats", "rmmClaims", "rmmAudit", "rmmRelease"].every((m) => serverText.indexOf(m) !== -1));
    } catch (e) {
      check("multi-user: harness did not crash", false, (e && e.stack) || String(e));
    } finally {
      try { T.setTransport(null); } catch (e) {}
      try { store.useBackend(null); } catch (e) {}
      try { store.resetAllLocal(); } catch (e) {}
    }

    const passed = results.filter((r) => r.ok).length;
    const failed = results.length - passed;
    return { passed, failed, results };
  };
})();
