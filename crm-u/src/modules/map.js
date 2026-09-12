window.CRM_RENDERERS = window.CRM_RENDERERS || {};

window.CRM_MAP = (function () {
  const R = window.CRM_RECORDS;
  const el = R.el;
  const U = window.RECORDUI;
  const D = window.CRM_DOMAIN;
  const GEO = window.CRM_GEO;
  const MOD = "map";

  const ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>';

  const KIND_MODULE = { site: "sites", service: "services", asset: "assets" };
  const KIND_LABEL = { site: "site", service: "service", asset: "asset" };
  const KIND_TAG = { site: "S", service: "sv", asset: "a" };

  const BASEMAPS = {
    light: { url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", attr: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>', maxZoom: 20 },
    osm: { url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", attr: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', maxZoom: 19 }
  };

  let leafletPromise = null;

  function loadLeaflet() {
    if (typeof window.L !== "undefined") return Promise.resolve(window.L);
    if (leafletPromise) return leafletPromise;
    leafletPromise = new Promise((resolve, reject) => {
      if (!document.querySelector('link[data-leaflet]')) {
        const css = document.createElement("link");
        css.rel = "stylesheet";
        css.href = "src/lib/leaflet.css";
        css.dataset.leaflet = "1";
        document.head.appendChild(css);
      }
      const s = document.createElement("script");
      s.src = "src/lib/leaflet.js";
      s.onload = () => (window.L ? resolve(window.L) : reject(new Error("Leaflet did not attach to the page.")));
      s.onerror = () => reject(new Error("The map library could not be loaded."));
      document.head.appendChild(s);
    });
    return leafletPromise;
  }

  function whenConnected(node, cb, tries) {
    if (node.isConnected) { cb(); return; }
    if ((tries || 0) > 600) return;
    requestAnimationFrame(() => whenConnected(node, cb, (tries || 0) + 1));
  }

  function round6(n) {
    return Math.round(n * 1e6) / 1e6;
  }

  function coordOf(rec) {
    if (!rec) return null;
    const lat = Number(rec.lat);
    const lng = Number(rec.lng);
    if (GEO && GEO.validCoord(lat, lng)) return { lat: lat, lng: lng };
    return null;
  }

  function hasCoord(rec) {
    return !!coordOf(rec);
  }

  async function collect(store) {
    const docs = {};
    for (const m of ["sites", "services", "assets", "tickets", "companies"]) {
      try { docs[m] = await store.loadDoc(m); } catch (e) { docs[m] = null; }
    }
    const rec = m => R.recordsOf(docs[m] && docs[m].content);
    const sites = rec("sites");
    const services = rec("services");
    const assets = rec("assets");
    const tickets = rec("tickets");
    const cmap = new Map(rec("companies").map(c => [String(c.id), c]));

    const bySite = { services: {}, assets: {}, tickets: {} };
    services.forEach(s => { if (s && s.siteId) (bySite.services[String(s.siteId)] = bySite.services[String(s.siteId)] || []).push(s); });
    assets.forEach(a => { if (a && a.siteId) (bySite.assets[String(a.siteId)] = bySite.assets[String(a.siteId)] || []).push(a); });
    tickets.forEach(t => { if (t && t.siteId) (bySite.tickets[String(t.siteId)] = bySite.tickets[String(t.siteId)] || []).push(t); });

    const points = [];
    const unmapped = [];

    sites.forEach(s => {
      if (!s) return;
      const c = coordOf(s);
      const address = D.siteAddressOf(s);
      if (c) {
        points.push({
          kind: "site", id: s.id, name: s.name || "(unnamed site)", lat: c.lat, lng: c.lng, record: s,
          company: s.companyId ? cmap.get(String(s.companyId)) : null, address: address,
          counts: { services: (bySite.services[String(s.id)] || []).length, assets: (bySite.assets[String(s.id)] || []).length, tickets: (bySite.tickets[String(s.id)] || []).length }
        });
      } else if (address) {
        unmapped.push({ kind: "site", id: s.id, name: s.name || "(unnamed site)", address: address, record: s, company: s.companyId ? cmap.get(String(s.companyId)) : null });
      }
    });

    services.forEach(s => {
      if (!s) return;
      const c = coordOf(s);
      if (c) points.push({ kind: "service", id: s.id, name: s.name || "(unnamed service)", lat: c.lat, lng: c.lng, record: s, company: s.companyId ? cmap.get(String(s.companyId)) : null, address: D.tenantOf(s) });
    });
    assets.forEach(a => {
      if (!a) return;
      const c = coordOf(a);
      if (c) points.push({ kind: "asset", id: a.id, name: window.CRM_ASSETS ? window.CRM_ASSETS.assetName(a) : (a.name || a.identifier || a.id), lat: c.lat, lng: c.lng, record: a, company: a.companyId ? cmap.get(String(a.companyId)) : null, address: D.siteAddressOf(a) });
    });

    return { points: points, unmapped: unmapped, cmap: cmap, sites: sites, services: services, assets: assets };
  }

  function popupHtml(point) {
    const bits = [];
    bits.push('<div class="map-pop-title">' + R.esc(point.name) + '</div>');
    bits.push('<div class="map-pop-kind">' + R.esc(KIND_LABEL[point.kind]) + "</div>");
    if (point.address) bits.push('<div class="map-pop-line">' + R.esc(point.address) + "</div>");
    if (point.company) bits.push('<div class="map-pop-line">' + R.esc(point.company.name) + "</div>");
    if (point.counts) {
      const c = [];
      if (point.counts.services) c.push(point.counts.services + " service" + (point.counts.services === 1 ? "" : "s"));
      if (point.counts.assets) c.push(point.counts.assets + " asset" + (point.counts.assets === 1 ? "" : "s"));
      if (point.counts.tickets) c.push(point.counts.tickets + " ticket" + (point.counts.tickets === 1 ? "" : "s"));
      if (c.length) bits.push('<div class="map-pop-line">' + R.esc(c.join(" · ")) + "</div>");
    }
    bits.push('<div class="map-pop-acts"><a href="#/' + KIND_MODULE[point.kind] + "/" + encodeURIComponent(point.id) + '">Open record</a>' +
      '<a href="https://www.openstreetmap.org/?mlat=' + point.lat + '&mlon=' + point.lng + '#map=17/' + point.lat + '/' + point.lng + '" target="_blank" rel="noopener">Directions</a></div>');
    return bits.join("");
  }

  function pinIcon(L, kind, active) {
    return L.divIcon({
      className: "map-pin-wrap",
      html: '<span class="map-pin map-pin--' + kind + (active ? " is-active" : "") + '"><span class="map-pin-tag">' + KIND_TAG[kind] + "</span></span>",
      iconSize: [26, 30],
      iconAnchor: [13, 28],
      popupAnchor: [0, -26]
    });
  }

  async function setCoords(store, kind, id, lat, lng) {
    const mod = KIND_MODULE[kind];
    return R.persistUpdate(store, mod, content => {
      const r = R.getRecord(content, id);
      if (!r) return { changed: false };
      r.lat = round6(lat);
      r.lng = round6(lng);
      r.updatedAt = R.nowISO();
      return { changed: true, content: content };
    });
  }

  async function renderMap(ctx) {
    const store = ctx.store;
    if (!store) return U.storeCard("map", { detail: "The document store isn't ready yet." });

    const data = await collect(store);

    const wrap = el("div", "map-view");
    const card = el("section", "card map-card");
    const titleRow = el("div", "card-title-row");
    const tBox = el("div");
    tBox.appendChild(el("h2", null, "Service map"));
    const hint = el("p", "hint", "Every site, service and asset you've placed on a map. Click a pin for details, or drop a pin for an address that hasn't been located yet.");
    hint.style.marginTop = "3px";
    tBox.appendChild(hint);
    titleRow.appendChild(tBox);
    card.appendChild(titleRow);

    const toolbar = el("div", "rec-toolbar map-toolbar");
    const search = document.createElement("input");
    search.className = "inp rec-search";
    search.type = "search";
    search.placeholder = "Filter pins by name, city, account…";
    search.dataset.mapQ = "1";
    const kindSel = document.createElement("select");
    kindSel.className = "sel";
    kindSel.dataset.mapKind = "1";
    [["all", "All kinds"], ["site", "Sites"], ["service", "Services"], ["asset", "Assets"]].forEach(k => {
      const o = document.createElement("option");
      o.value = k[0];
      o.textContent = k[1];
      kindSel.appendChild(o);
    });
    const baseSel = document.createElement("select");
    baseSel.className = "sel";
    baseSel.dataset.mapBase = "1";
    [["light", "Light basemap"], ["osm", "Street basemap"]].forEach(k => {
      const o = document.createElement("option");
      o.value = k[0];
      o.textContent = k[1];
      baseSel.appendChild(o);
    });
    const geoAll = document.createElement("button");
    geoAll.type = "button";
    geoAll.className = "btn btn-ghost btn-sm";
    geoAll.dataset.mapGeoAll = "1";
    geoAll.textContent = "Locate all addresses";
    toolbar.appendChild(search);
    toolbar.appendChild(kindSel);
    toolbar.appendChild(baseSel);
    toolbar.appendChild(geoAll);
    card.appendChild(toolbar);

    const banner = el("div", "map-placing bkp-msg warn");
    banner.hidden = true;
    card.appendChild(banner);

    const layout = el("div", "map-layout");
    const canvas = el("div", "map-canvas");
    canvas.dataset.mapCanvas = "1";
    const side = el("aside", "map-side");
    const plottedBox = el("div", "map-side-box");
    const unmappedBox = el("div", "map-side-box");
    side.appendChild(plottedBox);
    side.appendChild(unmappedBox);
    layout.appendChild(canvas);
    layout.appendChild(side);
    card.appendChild(layout);
    wrap.appendChild(card);

    let L = null;
    try {
      L = await loadLeaflet();
    } catch (err) {
      canvas.innerHTML = "";
      canvas.appendChild(el("div", "map-fallback", (err && err.message) || "The map library could not be loaded."));
      canvas.appendChild(el("a", "btn btn-ghost btn-sm", "Open sites instead")).href = "#/sites";
      return wrap;
    }

    let map = null;
    let tileLayer = null;
    let points = data.points.slice();
    let unmapped = data.unmapped.slice();
    let placing = null;
    let q = "";
    let kindFilter = "all";
    let lastFitCount = -1;
    const markers = new Map();
    const layerGroup = L.layerGroup();

    function visiblePoints() {
      const query = q.trim().toLowerCase();
      return points.filter(p => {
        if (kindFilter !== "all" && p.kind !== kindFilter) return false;
        if (!query) return true;
        const hay = [p.name, p.address, p.company && p.company.name].filter(Boolean).join(" ").toLowerCase();
        return hay.indexOf(query) !== -1;
      });
    }

    function rebuildMarkers() {
      layerGroup.clearLayers();
      markers.clear();
      visiblePoints().forEach(p => {
        const marker = L.marker([p.lat, p.lng], { icon: pinIcon(L, p.kind, false), title: p.name });
        marker.bindPopup(popupHtml(p), { closeButton: true, maxWidth: 300 });
        marker.on("click", () => setActive(p));
        marker.addTo(layerGroup);
        markers.set(String(p.kind) + ":" + String(p.id), marker);
      });
    }

    function setActive(p) {
      plottedBox.querySelectorAll("[data-point]").forEach(n => n.classList.toggle("is-active", n.dataset.point === p.kind + ":" + p.id));
    }

    function focusPoint(p) {
      if (!map) return;
      map.setView([p.lat, p.lng], Math.max(map.getZoom(), 14), { animate: true });
      const marker = markers.get(p.kind + ":" + p.id);
      if (marker) marker.openPopup();
      setActive(p);
    }

    function plottedList() {
      plottedBox.innerHTML = "";
      const tr = el("div", "card-title-row");
      const list = visiblePoints();
      tr.appendChild(el("h2", null, "On the map"));
      tr.appendChild(el("span", "chip", list.length + " pin" + (list.length === 1 ? "" : "s")));
      plottedBox.appendChild(tr);
      if (!list.length) {
        plottedBox.appendChild(el("p", "hint muted-line", points.length ? "No pins match the filter." : "Nothing is on the map yet — locate an address below to drop the first pin."));
        return;
      }
      const box = el("div", "map-list");
      list.slice(0, 200).forEach(p => {
        const row = el("button", "map-list-row");
        row.type = "button";
        row.dataset.point = p.kind + ":" + p.id;
        row.appendChild(el("span", "map-list-tag map-list-tag--" + p.kind, KIND_TAG[p.kind]));
        const main = el("span", "map-list-main");
        main.appendChild(el("span", "map-list-name", p.name));
        const sub = [p.address, p.company && p.company.name].filter(Boolean).join(" · ");
        if (sub) main.appendChild(el("span", "map-list-sub", sub));
        row.appendChild(main);
        row.addEventListener("click", () => focusPoint(p));
        box.appendChild(row);
      });
      plottedBox.appendChild(box);
    }

    function showPlacing() {
      if (!placing) {
        banner.hidden = true;
        return;
      }
      banner.className = "map-placing bkp-msg warn";
      banner.innerHTML = "Click the map to place <strong></strong>. ";
      banner.querySelector("strong").textContent = placing.name;
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "btn btn-ghost btn-sm";
      cancel.textContent = "Cancel";
      cancel.addEventListener("click", () => { placing = null; showPlacing(); });
      banner.appendChild(cancel);
      banner.hidden = false;
    }

    async function locate(point) {
      placing = point;
      showPlacing();
      if (map) map.getContainer().classList.add("is-placing");
    }

    function endPlacing() {
      placing = null;
      showPlacing();
      if (map) map.getContainer().classList.remove("is-placing");
    }

    async function placeAt(lat, lng) {
      if (!placing) return;
      const target = placing;
      endPlacing();
      const res = await setCoords(store, target.kind, target.id, lat, lng);
      if (!res || !res.ok) {
        window.CRM.toast(U.describeError(res, KIND_MODULE[target.kind]));
        return;
      }
      target.record.lat = round6(lat);
      target.record.lng = round6(lng);
      unmapped = unmapped.filter(u => !(u.kind === target.kind && String(u.id) === String(target.id)));
      points.push({
        kind: target.kind, id: target.id, name: target.name, lat: round6(lat), lng: round6(lng), record: target.record,
        address: target.address, company: target.company || null,
        counts: target.kind === "site" ? { services: 0, assets: 0, tickets: 0 } : undefined
      });
      refresh();
      window.CRM.toast("Location saved.");
    }

    async function geocodeOne(entry, quiet) {
      const res = await GEO.geocode(entry.address, {});
      if (!res || !res.ok) {
        if (!quiet) window.CRM.toast((res && res.detail) || "Could not locate that address.");
        return false;
      }
      const saved = await setCoords(store, entry.kind, entry.id, res.lat, res.lng);
      if (!saved || !saved.ok) {
        if (!quiet) window.CRM.toast(U.describeError(saved, KIND_MODULE[entry.kind]));
        return false;
      }
      entry.record.lat = round6(res.lat);
      entry.record.lng = round6(res.lng);
      unmapped = unmapped.filter(u => !(u.kind === entry.kind && String(u.id) === String(entry.id)));
      points.push({
        kind: entry.kind, id: entry.id, name: entry.name, lat: round6(res.lat), lng: round6(res.lng), record: entry.record,
        address: entry.address, company: entry.company || null,
        counts: entry.kind === "site" ? { services: 0, assets: 0, tickets: 0 } : undefined
      });
      return true;
    }

    async function geocodeAll() {
      if (!unmapped.length) return;
      geoAll.disabled = true;
      const total = unmapped.length;
      const queue = unmapped.slice();
      let done = 0;
      let located = 0;
      for (const entry of queue) {
        geoAll.textContent = "Locating " + (done + 1) + "/" + total + "…";
        const ok = await geocodeOne(entry, true);
        if (ok) located++;
        done++;
        refresh();
      }
      geoAll.disabled = false;
      geoAll.textContent = "Locate all addresses";
      window.CRM.toast(located ? "Located " + located + " of " + total + " address" + (total === 1 ? "" : "es") + "." : "No addresses could be located automatically — place them by hand.");
      refresh();
    }

    function unmappedList() {
      unmappedBox.innerHTML = "";
      const tr = el("div", "card-title-row");
      tr.appendChild(el("h2", null, "Not on the map"));
      tr.appendChild(el("span", "chip", unmapped.length + " address" + (unmapped.length === 1 ? "" : "es")));
      unmappedBox.appendChild(tr);
      if (!unmapped.length) {
        unmappedBox.appendChild(el("p", "hint muted-line", "Every site with an address has a location."));
        return;
      }
      const box = el("div", "map-list");
      unmapped.slice(0, 200).forEach(entry => {
        const row = el("div", "map-list-row map-list-row--todo");
        row.appendChild(el("span", "map-list-tag map-list-tag--" + entry.kind, KIND_TAG[entry.kind]));
        const main = el("span", "map-list-main");
        main.appendChild(el("span", "map-list-name", entry.name));
        main.appendChild(el("span", "map-list-sub", entry.address));
        row.appendChild(main);
        const acts = el("span", "map-list-acts");
        const geo = el("button", "btn btn-ghost btn-sm", "Locate");
        geo.type = "button";
        geo.addEventListener("click", async () => {
          geo.disabled = true;
          geo.textContent = "…";
          const ok = await geocodeOne(entry, false);
          if (!ok) { geo.disabled = false; geo.textContent = "Locate"; }
          refresh();
        });
        const place = el("button", "btn btn-ghost btn-sm", "Place");
        place.type = "button";
        place.title = "Click the map to place this record";
        place.addEventListener("click", () => locate(entry));
        acts.appendChild(geo);
        acts.appendChild(place);
        row.appendChild(acts);
        box.appendChild(row);
      });
      unmappedBox.appendChild(box);
    }

    function refresh() {
      rebuildMarkers();
      plottedList();
      unmappedList();
      geoAll.hidden = unmapped.length === 0;
      if (map && points.length && points.length !== lastFitCount) {
        lastFitCount = points.length;
        try {
          const bounds = L.latLngBounds(points.map(p => [p.lat, p.lng]));
          map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
        } catch (e) {}
      }
    }

    whenConnected(canvas, function () {
      map = L.map(canvas, { zoomControl: true, attributionControl: true });
      map.setView([30, 0], 2);
      tileLayer = L.tileLayer(BASEMAPS.light.url, { attribution: BASEMAPS.light.attr, maxZoom: BASEMAPS.light.maxZoom });
      tileLayer.addTo(map);
      layerGroup.addTo(map);
      map.on("click", e => placeAt(e.latlng.lat, e.latlng.lng));
      setTimeout(() => { if (map) map.invalidateSize(); }, 60);
      refresh();
    });

    search.addEventListener("input", () => { q = search.value; refresh(); });
    kindSel.addEventListener("change", () => { kindFilter = kindSel.value; refresh(); });
    baseSel.addEventListener("change", () => {
      if (!map || !tileLayer) return;
      const def = BASEMAPS[baseSel.value] || BASEMAPS.light;
      map.removeLayer(tileLayer);
      tileLayer = L.tileLayer(def.url, { attribution: def.attr, maxZoom: def.maxZoom });
      tileLayer.addTo(map);
    });
    geoAll.addEventListener("click", geocodeAll);

    plottedList();
    unmappedList();
    geoAll.hidden = unmapped.length === 0;
    return wrap;
  }

  function view(ctx) {
    return renderMap(ctx);
  }

  return {
    MOD,
    view,
    collect,
    coordOf,
    hasCoord
  };
})();

window.CRM_RENDERERS.map = function (ctx) {
  return window.CRM_MAP.view(Object.assign({}, ctx, {
    store: (window.CRM && window.CRM.store) || null,
    rerender: (window.CRM && window.CRM.rerender) ? () => window.CRM.rerender() : null
  }));
};
