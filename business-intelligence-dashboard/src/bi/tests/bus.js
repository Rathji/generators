/* ============================================================
   BI validation tests — roadmap tasks 6–16 (data integration
   layer: manifest discovery, bundle pulling, caching, health,
   cadence, and failure tolerance).
   Run via: await BI.runTests("bus")  (page_eval harness).

   Hermetic: the suite injects a debug fetcher serving a synthetic
   manifest + bundles and isolates itself under "bi.bus.tX."
   localStorage prefixes. The production bus cache (bi.bus.*) is
   never touched, and the production bus + facts are restored at
   the end.

   Validated:
     - manifest discovery from network and from cache fallback
     - registry built from the manifest (new tools auto-appear)
     - pull caches a valid bundle and marks health ok
     - unchanged editCount → changed:false, cache kept, no re-extract
     - bumped editCount → changed:true, re-extract
     - malformed JSON / bad schema → named error + error health
     - newer schema version → unsupported_schema, source paused
     - older schema version → gap status, read best-effort
     - missing extractor → no_extractor, source skipped
     - HTTP failure → source_http_error; network failure → network_error
     - refresh-all honours each source's cadence; force overrides
     - facts are rebuilt from the cache after pulls
   ============================================================ */
(function () {
  "use strict";

  const BI = window.BI;

  const MANIFEST_URL = "https://x.test/manifest.json";
  const FILES = {
    [MANIFEST_URL]: {
      schema: "bi/manifest/v1",
      tools: [
        { id: "tool-a", name: "Tool A", bundles: [{ type: "ledger", name: "Ledger", url: "https://x.test/a.json" }] },
        { id: "tool-b", name: "Tool B", bundles: [{ type: "xray", name: "Xray", url: "https://x.test/b.json" }] },
        { id: "tool-c", name: "Tool C", bundles: [{ type: "ledger", name: "Ledger", url: "https://x.test/c.json" }] },
        { id: "tool-d", name: "Tool D", bundles: [{ type: "ledger", name: "Ledger", url: "https://x.test/d.json" }] },
      ],
    },
    "https://x.test/a.json": {
      schema: "bi/bundle/v1", schemaVersion: 1, tool: "tool-a", bundleType: "ledger", editCount: 3,
      asOf: "2026-09-30", publishedAt: "2026-09-30T00:00:00Z",
      data: { months: ["2026-09"], revenue: [100], expenses: [40] },
    },
    "https://x.test/c.json": {
      schema: "bi/bundle/v1", schemaVersion: 0, tool: "tool-c", bundleType: "ledger", editCount: 2,
      asOf: "2026-09-30", publishedAt: "2026-09-30T00:00:00Z",
      data: { months: ["2026-09"], revenue: [50], expenses: [20] },
    },
    "https://x.test/b.json": {
      schema: "bi/bundle/v1", schemaVersion: 1, tool: "tool-b", bundleType: "xray", editCount: 1,
      asOf: "2026-09-30", publishedAt: "2026-09-30T00:00:00Z",
      data: { rows: [{ id: 1, value: 7 }] },
    },
  };

  function bundle(url, ec) {
    return JSON.stringify({ ...FILES[url], editCount: ec });
  }

  function makeFetcher(opts) {
    opts = opts || {};
    return (url) => {
      if (opts.failUrls && opts.failUrls[url] === "http") return Promise.reject(new Error("HTTP 500"));
      if (opts.failUrls && opts.failUrls[url] === "network") return Promise.reject(new Error("TypeError: Failed to fetch"));
      if (opts.failUrls && opts.failUrls[url] === "malformed") return Promise.resolve("{ not json");
      if (!(url in FILES)) return Promise.reject(new Error("HTTP 404"));
      return Promise.resolve(JSON.stringify(FILES[url]));
    };
  }

  const healthGet = () => { try { return JSON.parse(localStorage.getItem("bi.bus.tX.health") || "{}"); } catch { return {}; } };
  const setHealth = (tool, type, patch) => {
    const h = healthGet();
    h[tool + "." + type] = Object.assign(h[tool + "." + type] || {}, patch, { tool, type });
    localStorage.setItem("bi.bus.tX.health", JSON.stringify(h));
  };
  const cacheOf = (tool, type) => { try { return JSON.parse(localStorage.getItem("bi.bus.tX.cache." + tool + "." + type) || "null"); } catch { return null; } };

  BI.tests.bus = {
    async run() {
      const results = [];
      const push = (name, pass, detail) => results.push({ name, pass, detail: detail || "" });
      const fresh = () => { BI.bus.debugReset({ lsPrefix: "bi.bus.tX.", wipe: true }); };
      const init = async (opts) => BI.bus.init(Object.assign({ manifestUrl: MANIFEST_URL, cadenceMs: 3600000, stalenessMs: 60000, lsPrefix: "bi.bus.tX." }, opts || {}));

      /* ---------- A: manifest discovery + registry ---------- */
      {
        fresh();
        BI.bus.debugFetcher(makeFetcher());
        const m = await init();
        push("A: manifest discovery from network", m.ok && m.manifest.fromNetwork === true && m.manifest.tools === 4, JSON.stringify(m.manifest));
        push("A: registry built from manifest", BI.bus.tools.length === 4 && BI.bus.tools.map((t) => t.id).join(",") === "tool-a,tool-b,tool-c,tool-d");
        push("A: registry includes bundle defs", BI.bus.tools[0].bundles[0].type === "ledger" && !!BI.bus.tools[0].bundles[0].url);
        push("A: manifest cached for offline", localStorage.getItem("bi.bus.tX.manifest") != null);
      }

      /* ---------- B: cache-fallback manifest (network gone) ---------- */
      {
        BI.bus.debugFetcher(makeFetcher({ failUrls: { [MANIFEST_URL]: "network" } }));
        const m = await init();
        push("B: cached manifest used when network fails", m.ok && m.manifest.fromCache === true && m.manifest.tools === 4, JSON.stringify(m.manifest));
        push("B: registry still built from cache", BI.bus.tools.length === 4);
      }

      /* ---------- C: pull caches + health ok + facts ---------- */
      {
        fresh();
        BI.bus.debugFetcher(makeFetcher());
        const m = await init();
        push("C: pull of valid bundle marks health ok", healthGet()["tool-a.ledger"].status === "ok");
        push("C: valid bundle cached with editCount", cacheOf("tool-a", "ledger") && cacheOf("tool-a", "ledger").bundle.editCount === 3);
        push("C: facts rebuilt from cache", BI.facts.records.length >= 2, BI.facts.records.length + " facts");
        push("C: extractor ran on pulled data", BI.facts.records.some((r) => r.measure === "revenue" && r.value === 100));
        push("C: older-schema bundle flagged as gap", healthGet()["tool-c.ledger"].status === "gap");
      }

      /* ---------- D: unchanged editCount → changed:false, cache kept ---------- */
      {
        fresh();
        BI.bus.debugFetcher(makeFetcher());
        await init();
        /* force the source due again with the SAME editCount */
        setHealth("tool-a", "ledger", { status: "ok", lastPull: "2000-01-01T00:00:00Z", editCount: 3 });
        const r = await BI.bus.refreshAll({ force: false });
        const per = r.tools.find((t) => t.tool === "tool-a");
        const res = per.bundles[0];
        push("D: unchanged editCount re-pulled but not re-extracted", res.ok && res.changed === false, JSON.stringify(res));
        push("D: cache preserved on unchanged", cacheOf("tool-a", "ledger").bundle.editCount === 3);
        push("D: unchanged pull reports zero new facts", res.facts === 0);
      }

      /* ---------- E: bumped editCount → changed:true ---------- */
      {
        fresh();
        BI.bus.debugFetcher(makeFetcher());
        await init();
        FILES["https://x.test/a.json"] = { ...FILES["https://x.test/a.json"], editCount: 4, data: { months: ["2026-09"], revenue: [150], expenses: [60] } };
        setHealth("tool-a", "ledger", { status: "ok", lastPull: "2000-01-01T00:00:00Z", editCount: 3 });
        const r = await BI.bus.refreshAll({ force: false });
        const res = r.tools.find((t) => t.tool === "tool-a").bundles[0];
        push("E: bumped editCount re-extracts", res.ok && res.changed === true && res.facts >= 2, JSON.stringify(res));
        push("E: cache updated to new editCount", cacheOf("tool-a", "ledger").bundle.editCount === 4);
        push("E: health tracks new editCount", healthGet()["tool-a.ledger"].editCount === 4);
        push("E: new value visible in facts", BI.facts.records.some((r) => r.measure === "revenue" && r.value === 150));
        delete FILES["https://x.test/a.json"];
        FILES["https://x.test/a.json"] = {
          schema: "bi/bundle/v1", schemaVersion: 1, tool: "tool-a", bundleType: "ledger", editCount: 3,
          asOf: "2026-09-30", publishedAt: "2026-09-30T00:00:00Z",
          data: { months: ["2026-09"], revenue: [100], expenses: [40] },
        };
      }

      /* ---------- F: failure tolerance ---------- */
      {
        fresh();
        /* tool-b → no extractor; tool-d → http error */
        BI.bus.debugFetcher(makeFetcher({ failUrls: { "https://x.test/d.json": "http" } }));
        const m = await init();
        push("F: missing extractor → no_extractor error", healthGet()["tool-b.xray"].status === "error" && healthGet()["tool-b.xray"].error === "no_extractor");
        push("F: no-extractor source is skipped, not fatal", m.ok && BI.bus.tools.length === 4);
        push("F: http error → source_http_error", healthGet()["tool-d.ledger"].status === "error" && healthGet()["tool-d.ledger"].error === "source_http_error");
        push("F: failed source has no cache entry", !cacheOf("tool-d", "ledger"));

        setHealth("tool-d", "ledger", {});
        BI.bus.debugFetcher(makeFetcher({ failUrls: { "https://x.test/d.json": "network" } }));
        await init();
        push("F: network failure → network_error", healthGet()["tool-d.ledger"].error === "network_error");

        setHealth("tool-d", "ledger", {});
        BI.bus.debugFetcher(makeFetcher({ failUrls: { "https://x.test/d.json": "malformed" } }));
        await init();
        push("F: malformed JSON → malformed_bundle", healthGet()["tool-d.ledger"].error === "malformed_bundle");
      }

      /* ---------- G: unsupported newer schema ---------- */
      {
        fresh();
        const bad = {
          schema: "bi/bundle/v1", schemaVersion: 99, tool: "tool-a", bundleType: "ledger", editCount: 1,
          asOf: "2026-09-30", data: { months: ["2026-09"], revenue: [1], expenses: [1] },
        };
        BI.bus.debugFetcher((url) => url === MANIFEST_URL ? Promise.resolve(JSON.stringify(FILES[url])) : Promise.resolve(JSON.stringify(bad)));
        await init();
        push("G: newer schema → unsupported_schema", healthGet()["tool-a.ledger"].status === "error" && healthGet()["tool-a.ledger"].error === "unsupported_schema");
        push("G: unsupported source not cached", !cacheOf("tool-a", "ledger"));
      }

      /* ---------- H: cadence respect ---------- */
      {
        fresh();
        BI.bus.debugFetcher(makeFetcher());
        await init();
        const r = await BI.bus.refreshAll({ force: false });
        const a = r.tools.find((t) => t.tool === "tool-a").bundles[0];
        push("H: fresh source within cadence is skipped", a.due === false && a.ok === true, JSON.stringify(a));
        push("H: skip does not rewrite cache", cacheOf("tool-a", "ledger").bundle.editCount === 3);
        const f = await BI.bus.refreshAll({ force: true });
        const af = f.tools.find((t) => t.tool === "tool-a").bundles[0];
        push("H: force overrides cadence", af.due !== false && af.changed === false, JSON.stringify(af));
      }

      /* ---------- I: health API + staleness ---------- */
      {
        fresh();
        BI.bus.debugFetcher(makeFetcher());
        const cfg = { manifestUrl: MANIFEST_URL, cadenceMs: 3600000, stalenessMs: 86400000000, lsPrefix: "bi.bus.tX." };
        await init(cfg);
        /* publishedAt 2026-09-30 is recent → not stale */
        push("I: recent source not stale", BI.bus.isStale("tool-a", "ledger") === false);
        push("I: healthOf returns status", BI.bus.healthOf("tool-a", "ledger").status === "ok");
        const t = await init(Object.assign({}, cfg, { stalenessMs: 1 }));
        const aged = JSON.parse(localStorage.getItem("bi.bus.tX.cache.tool-a.ledger"));
        aged.bundle.publishedAt = "2020-01-01T00:00:00Z";
        localStorage.setItem("bi.bus.tX.cache.tool-a.ledger", JSON.stringify(aged));
        push("I: aged source flagged stale", BI.bus.isStale("tool-a", "ledger") === true);
        push("I: toolHealth aggregates per bundle", BI.bus.toolHealth("tool-a").bundles.length === 1);
        push("I: healthAll covers every tool", BI.bus.healthAll().length === 4);
        push("I: bus.status exposes fact count", BI.bus.status().factCount === BI.facts.records.length);
      }

      /* restore the production bus + facts for the running app */
      BI.bus.debugFetcher(null);
      BI.bus.debugReset({ lsPrefix: "bi.bus.", wipe: false });
      await BI.bus.init({ manifestUrl: "src/bi/fixtures/manifest.json", cadenceMs: 21600000, stalenessMs: 108000000 });
      return results;
    },
  };
})();
