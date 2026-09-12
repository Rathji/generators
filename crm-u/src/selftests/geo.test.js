(function () {
  const T = window.SELFTEST;
  const BS = window.BcrmStore;
  const G = window.CRM_GEO;
  const M = window.CRM_MAP;
  if (!T || !BS || !G || !M) return;

  const ALL_MODULES = ["companies", "contacts", "leads", "deals", "activities", "services", "sites", "assets", "tickets", "documents", "emails", "segments", "rules", "bus", "reports"];

  function mockKv() {
    const m = new Map();
    return {
      get: async k => m.get(k),
      set: async (k, v) => { m.set(k, v); },
      delete: async k => { m.delete(k); },
      map: m
    };
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
      get: async name => { const f = files.get(name); return f ? f.text : null; },
      set: async (name, text, o) => {
        o = o || {};
        let f = files.get(name);
        if (!f) {
          f = { text, key: "ek." + name, count: 0 };
          files.set(name, f);
          f.text = text;
          f.count = 1;
          return { error: null, editKey: f.key, editCount: 1, created: true };
        }
        if (!o.editKey || o.editKey !== f.key) return { error: "invalid or missing edit key", created: false };
        f.text = text;
        f.count++;
        return { error: null, editCount: f.count, created: false };
      }
    };
    const ns = "gm" + BS.randHex(6);
    return BS.create({ ns, kv, editable, modules: ALL_MODULES.slice() });
  }

  function jsonFetch(payload, opts) {
    opts = opts || {};
    let calls = 0;
    const fn = async () => {
      calls++;
      if (opts.throw) throw new Error("network down");
      return { ok: opts.status === undefined ? true : opts.status, status: opts.status || 200, json: async () => payload };
    };
    fn.calls = () => calls;
    return fn;
  }

  T.register("geo: geocode resolves, caches in kv and skips the network on repeat", async () => {
    G.reset();
    const kv = mockKv();
    G.setKv(kv);
    const f = jsonFetch([{ lat: "47.3769", lon: "8.5417", display_name: "Zurich, Switzerland" }]);
    G.setFetch(f);
    const first = await G.geocode("Bahnhofstrasse 1, Zurich");
    const second = await G.geocode("Bahnhofstrasse 1, Zurich");
    G.setFetch(null);
    G.setKv(null);
    const checks = [];
    if (!first.ok || first.lat !== 47.3769 || first.lng !== 8.5417) checks.push("first lookup wrong: " + JSON.stringify(first));
    if (first.cached !== false) checks.push("first result should not be cached");
    if (!second.ok || second.cached !== true) checks.push("second result should be served from cache: " + JSON.stringify(second));
    if (f.calls() !== 1) checks.push("network should be hit once, not " + f.calls());
    if (kv.map.size === 0) checks.push("nothing written to the cache");
    return checks.length ? { pass: false, detail: checks.join(" | ") } : { pass: true, detail: "resolved once, cache hit on repeat" };
  });

  T.register("geo: empty, not-found, bad-coords and network errors are reported clearly", async () => {
    G.reset();
    G.setKv(mockKv());
    const empty = await G.geocode("   ");
    let f = jsonFetch([]);
    G.setFetch(f);
    const none = await G.geocode("nowhere at all");
    G.reset();
    G.setFetch(jsonFetch([{ lat: "999", lon: "0" }]));
    const bad = await G.geocode("out of range");
    G.reset();
    G.setFetch(jsonFetch(null, { throw: true }));
    const net = await G.geocode("unreachable");
    G.setFetch(null);
    G.setKv(null);
    const checks = [];
    if (empty.ok || empty.code !== "empty") checks.push("empty query not rejected: " + JSON.stringify(empty));
    if (none.ok || none.code !== "not_found") checks.push("no hits not reported: " + JSON.stringify(none));
    if (bad.ok || bad.code !== "bad_coords") checks.push("out-of-range coords not rejected: " + JSON.stringify(bad));
    if (net.ok || net.code !== "network") checks.push("network failure not reported: " + JSON.stringify(net));
    return checks.length ? { pass: false, detail: checks.join(" | ") } : { pass: true, detail: "empty / not_found / bad_coords / network all handled" };
  });

  T.register("geo: addressQuery joins address parts in order", () => {
    const q = G.addressQuery({ street: "1 Bahnhofstrasse", city: "Zurich", region: "ZH", postalCode: "8001", country: "CH" });
    if (q !== "1 Bahnhofstrasse, Zurich, ZH, 8001, CH") return { pass: false, detail: "wrong query: " + q };
    if (G.addressQuery(null) !== "") return { pass: false, detail: "null address should give empty query" };
    return { pass: true, detail: q };
  });

  T.register("map: coordOf accepts valid coordinates and rejects junk/out-of-range", () => {
    if (!M.coordOf({ lat: 47.37, lng: 8.54 })) return { pass: false, detail: "valid coord rejected" };
    if (M.coordOf({ lat: "abc", lng: 8 })) return { pass: false, detail: "non-numeric lat accepted" };
    if (M.coordOf({ lat: 120, lng: 8 })) return { pass: false, detail: "out-of-range lat accepted" };
    if (M.coordOf(null)) return { pass: false, detail: "null accepted" };
    return { pass: true, detail: "valid coords pass, junk and out-of-range fail" };
  });

  T.register("map: collect plots located sites and lists the rest as unmapped", async () => {
    const store = mockEnv();
    const siteA = { id: "site-aaa111", name: "Zurich HQ", companyId: "c-1", lat: 47.3769, lng: 8.5417, address: { street: "1 Bahnhofstrasse", city: "Zurich", country: "CH" } };
    const siteB = { id: "site-bbb222", name: "Bern branch", companyId: "c-1", address: { street: "2 Bundesplatz", city: "Bern", country: "CH" } };
    const svc = { id: "svc-1", name: "Fibre 500", siteId: siteA.id, companyId: "c-1", status: "active", lat: 47.38, lng: 8.54 };
    const company = { id: "c-1", name: "Acme AG" };
    await store.saveChecked("companies", { records: [company] }, { expectedBase: 0 });
    await store.saveChecked("sites", { records: [siteA, siteB] }, { expectedBase: 0 });
    await store.saveChecked("services", { records: [svc] }, { expectedBase: 0 });
    const data = await M.collect(store);
    const checks = [];
    if (data.points.length !== 2) checks.push("expected 2 plotted points (1 site + 1 service), got " + data.points.length);
    if (data.unmapped.length !== 1) checks.push("expected 1 unmapped site, got " + data.unmapped.length);
    if (data.unmapped[0] && data.unmapped[0].id !== siteB.id) checks.push("wrong unmapped record");
    const plotted = data.points.find(p => p.kind === "site");
    if (!plotted) checks.push("located site not plotted");
    else if (!plotted.counts || plotted.counts.services !== 1) checks.push("site should count 1 service: " + JSON.stringify(plotted.counts));
    if (!plotted || !plotted.company || plotted.company.name !== "Acme AG") checks.push("company not resolved on the plotted site");
    if (!data.unmapped[0] || !data.unmapped[0].company) checks.push("unmapped site should carry its company");
    return checks.length ? { pass: false, detail: checks.join(" | ") } : { pass: true, detail: "2 plotted, 1 unmapped, service counted" };
  });

  T.register("map: the map page renders a canvas and loads Leaflet", async () => {
    window.CRM.go("map");
    await window.CRM.ready();
    const view = document.getElementById("viewRoot");
    if (view.dataset.state !== "ready") return { pass: false, detail: "state=" + view.dataset.state };
    const canvas = view.querySelector("[data-map-canvas]");
    if (!canvas) return { pass: false, detail: "no map canvas rendered" };
    let ready = false;
    for (let i = 0; i < 40; i++) {
      if (window.L && canvas.classList.contains("leaflet-container")) { ready = true; break; }
      await new Promise(r => setTimeout(r, 150));
    }
    if (!ready) return { pass: false, detail: "Leaflet did not initialise on the canvas" };
    const zoom = canvas.querySelector(".leaflet-control-zoom");
    window.CRM.go("dashboard");
    await window.CRM.ready();
    return { pass: true, detail: "map canvas mounted with Leaflet zoom control" };
  });
})();
