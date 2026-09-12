window.CRM_GEO = (function () {
  const NOMINATIM = "https://nominatim.openstreetmap.org/search";
  const MIN_GAP = 1100;
  const CACHE_PREFIX = "geo:";
  const CACHE_MAX_AGE = 1000 * 60 * 60 * 24 * 180;

  let kvAdapter = null;
  let fetchImpl = null;
  let lastAt = 0;
  let chain = Promise.resolve();

  function setKv(kv) { kvAdapter = kv || null; }
  function setFetch(fn) { fetchImpl = fn || null; }

  function rootRef() {
    return typeof root !== "undefined" && root ? root : null;
  }

  function kvStore() {
    if (kvAdapter) return kvAdapter;
    const r = rootRef();
    if (r && r.kv && r.kv.bcrm) return r.kv.bcrm;
    return null;
  }

  function normalizeQuery(q) {
    return String(q === undefined || q === null ? "" : q).replace(/\s+/g, " ").trim();
  }

  function cacheKey(q) {
    return CACHE_PREFIX + normalizeQuery(q).toLowerCase();
  }

  function validCoord(lat, lng) {
    return isFinite(lat) && isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
  }

  async function readCache(q) {
    const kv = kvStore();
    if (!kv) return null;
    try {
      const row = await kv.get(cacheKey(q));
      if (!row || typeof row !== "object") return null;
      if (row.at && Date.now() - row.at > CACHE_MAX_AGE) return null;
      if (!validCoord(Number(row.lat), Number(row.lng))) return null;
      return { lat: Number(row.lat), lng: Number(row.lng), label: row.label || "" };
    } catch (e) {
      return null;
    }
  }

  async function writeCache(q, val) {
    const kv = kvStore();
    if (!kv) return;
    try {
      await kv.set(cacheKey(q), { lat: val.lat, lng: val.lng, label: val.label || "", at: Date.now() });
    } catch (e) {}
  }

  function serialize(fn) {
    const run = chain.then(() => fn(), () => fn());
    chain = run.then(() => {}, () => {});
    return run;
  }

  async function pace() {
    const wait = Math.max(0, MIN_GAP - (Date.now() - lastAt));
    if (wait) await new Promise(r => setTimeout(r, wait));
    lastAt = Date.now();
  }

  async function httpJson(url) {
    const opts = { headers: { Accept: "application/json" } };
    if (fetchImpl) {
      const r = await fetchImpl(url, opts);
      if (!r || r.ok === false) return { ok: false, code: "http", detail: "The geocoder replied with status " + ((r && r.status) || "?") + "." };
      try { return { ok: true, data: await r.json() }; }
      catch (e) { return { ok: false, code: "bad_response", detail: "The geocoder returned something that wasn't JSON." }; }
    }
    const r = rootRef();
    if (r && r.superFetch) {
      const res = await r.superFetch(url, opts);
      const text = res && typeof res.text === "function" ? await res.text() : String(res);
      try { return { ok: true, data: JSON.parse(text) }; }
      catch (e) { return { ok: false, code: "bad_response", detail: "The geocoder returned something that wasn't JSON." }; }
    }
    const res = await fetch(url, opts);
    if (!res.ok) return { ok: false, code: "http", detail: "The geocoder replied with status " + res.status + "." };
    try { return { ok: true, data: await res.json() }; }
    catch (e) { return { ok: false, code: "bad_response", detail: "The geocoder returned something that wasn't JSON." }; }
  }

  async function lookup(q) {
    if (fetchImpl === null && rootRef() === null && typeof fetch === "undefined") {
      return { ok: false, code: "network", detail: "Could not reach the geocoder — check your connection and try again." };
    }
    let res;
    try {
      res = await httpJson(NOMINATIM + "?format=jsonv2&limit=1&addressdetails=0&q=" + encodeURIComponent(q));
    } catch (e) {
      return { ok: false, code: "network", detail: "Could not reach the geocoder — check your connection and try again." };
    }
    if (!res.ok) return res;
    const arr = Array.isArray(res.data) ? res.data : [];
    if (!arr.length) return { ok: false, code: "not_found", detail: "No coordinates found for that address." };
    const lat = Number(arr[0].lat);
    const lng = Number(arr[0].lon);
    if (!validCoord(lat, lng)) return { ok: false, code: "bad_coords", detail: "The geocoder returned coordinates outside the valid range." };
    return { ok: true, lat: lat, lng: lng, label: arr[0].display_name || "" };
  }

  function geocode(query, opts) {
    opts = opts || {};
    const q = normalizeQuery(query);
    if (!q) return Promise.resolve({ ok: false, code: "empty", detail: "There is no address to geocode." });
    return serialize(async () => {
      if (opts.useCache !== false) {
        const cached = await readCache(q);
        if (cached) return { ok: true, cached: true, lat: cached.lat, lng: cached.lng, label: cached.label };
      }
      await pace();
      const hit = await lookup(q);
      if (!hit.ok) return hit;
      await writeCache(q, hit);
      return { ok: true, cached: false, lat: hit.lat, lng: hit.lng, label: hit.label };
    });
  }

  function addressQuery(address) {
    if (!address || typeof address !== "object") return "";
    return [address.street, address.city, address.region, address.postalCode, address.country].filter(Boolean).join(", ");
  }

  return {
    geocode,
    addressQuery,
    validCoord,
    normalizeQuery,
    setKv,
    setFetch,
    reset() { lastAt = 0; chain = Promise.resolve(); }
  };
})();
