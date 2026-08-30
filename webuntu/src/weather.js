// Webuntu OS — Weather app (POST-52, Task 59)
// Real forecasts from the Open-Meteo API (no key, CORS-open) for a curated
// city list plus "use my location". Shows current conditions, an hourly
// strip, a 7-day list, a stylized precipitation radar and derived alerts.
// The last forecast is cached per city+unit so the app keeps working offline
// (banner notes the data is stale). Units (°C/°F) and the chosen city persist
// in webuntu.settings. Replaces the original Accessories stub.

(function () {
  "use strict";

  const SETTINGS_KEY = "webuntu.settings";
  const CACHE_KEY = "webuntu.weather.cache";
  const API = "https://api.open-meteo.com/v1/forecast";

  const CITIES = [
    { name: "London",       country: "UK",           lat: 51.51, lon: -0.13 },
    { name: "New York",     country: "USA",          lat: 40.71, lon: -74.01 },
    { name: "Tokyo",        country: "Japan",        lat: 35.68, lon: 139.69 },
    { name: "Paris",        country: "France",       lat: 48.86, lon: 2.35 },
    { name: "Sydney",       country: "Australia",    lat: -33.87, lon: 151.21 },
    { name: "Moscow",       country: "Russia",       lat: 55.76, lon: 37.62 },
    { name: "Mumbai",       country: "India",        lat: 19.08, lon: 72.88 },
    { name: "Cairo",        country: "Egypt",        lat: 30.04, lon: 31.24 },
    { name: "Rio de Janeiro", country: "Brazil",     lat: -22.91, lon: -43.17 },
    { name: "Cape Town",    country: "South Africa", lat: -33.92, lon: 18.42 },
    { name: "Los Angeles",  country: "USA",          lat: 34.05, lon: -118.24 },
    { name: "Beijing",      country: "China",        lat: 39.90, lon: 116.41 },
    { name: "Berlin",       country: "Germany",      lat: 52.52, lon: 13.41 },
    { name: "Madrid",       country: "Spain",        lat: 40.42, lon: -3.70 },
    { name: "Rome",         country: "Italy",        lat: 41.90, lon: 12.50 },
    { name: "Toronto",      country: "Canada",       lat: 43.65, lon: -79.38 },
    { name: "Mexico City",  country: "Mexico",       lat: 19.43, lon: -99.13 },
    { name: "Singapore",    country: "Singapore",    lat: 1.35,  lon: 103.82 },
    { name: "Istanbul",     country: "Turkey",       lat: 41.01, lon: 28.98 },
    { name: "Seoul",        country: "South Korea",  lat: 37.57, lon: 126.98 },
    { name: "Chicago",      country: "USA",          lat: 41.88, lon: -87.63 },
    { name: "Lagos",        country: "Nigeria",      lat: 6.52,  lon: 3.38 },
    { name: "Buenos Aires", country: "Argentina",    lat: -34.60, lon: -58.38 },
    { name: "New Delhi",    country: "India",        lat: 28.61, lon: 77.21 },
    { name: "Amsterdam",    country: "Netherlands",  lat: 52.37, lon: 4.90 },
    { name: "Dubai",        country: "UAE",          lat: 25.20, lon: 55.27 },
    { name: "San Francisco", country: "USA",         lat: 37.77, lon: -122.42 },
    { name: "Bangkok",      country: "Thailand",     lat: 13.76, lon: 100.50 },
  ];

  // WMO weather codes → human label + day/night emoji + condition gradient.
  const CODES = {
    0:  { label: "Clear sky",      day: "☀️", night: "🌙", g: "sun" },
    1:  { label: "Mostly clear",   day: "🌤️", night: "🌙", g: "sun" },
    2:  { label: "Partly cloudy",  day: "⛅",  night: "☁️", g: "cloud" },
    3:  { label: "Overcast",       day: "☁️",  night: "☁️", g: "cloud" },
    45: { label: "Fog",            day: "🌫️", night: "🌫️", g: "fog" },
    48: { label: "Rime fog",       day: "🌫️", night: "🌫️", g: "fog" },
    51: { label: "Light drizzle",  day: "🌦️", night: "🌧️", g: "rain" },
    53: { label: "Drizzle",        day: "🌦️", night: "🌧️", g: "rain" },
    55: { label: "Heavy drizzle",  day: "🌧️", night: "🌧️", g: "rain" },
    56: { label: "Freezing drizzle", day: "🌧️", night: "🌧️", g: "rain" },
    57: { label: "Freezing drizzle", day: "🌧️", night: "🌧️", g: "rain" },
    61: { label: "Light rain",     day: "🌦️", night: "🌧️", g: "rain" },
    63: { label: "Rain",           day: "🌧️", night: "🌧️", g: "rain" },
    65: { label: "Heavy rain",     day: "🌧️", night: "🌧️", g: "rain" },
    66: { label: "Freezing rain",  day: "🌧️", night: "🌧️", g: "rain" },
    67: { label: "Freezing rain",  day: "🌧️", night: "🌧️", g: "rain" },
    71: { label: "Light snow",     day: "🌨️", night: "🌨️", g: "snow" },
    73: { label: "Snow",           day: "🌨️", night: "🌨️", g: "snow" },
    75: { label: "Heavy snow",     day: "❄️",  night: "❄️", g: "snow" },
    77: { label: "Snow grains",    day: "🌨️", night: "🌨️", g: "snow" },
    80: { label: "Light showers",  day: "🌦️", night: "🌧️", g: "rain" },
    81: { label: "Showers",        day: "🌦️", night: "🌧️", g: "rain" },
    82: { label: "Heavy showers",  day: "🌧️", night: "🌧️", g: "rain" },
    85: { label: "Snow showers",   day: "🌨️", night: "🌨️", g: "snow" },
    86: { label: "Snow showers",   day: "🌨️", night: "🌨️", g: "snow" },
    95: { label: "Thunderstorm",   day: "⛈️",  night: "⛈️", g: "thunder" },
    96: { label: "Thunder + hail", day: "⛈️",  night: "⛈️", g: "thunder" },
    99: { label: "Thunder + hail", day: "⛈️",  night: "⛈️", g: "thunder" },
  };
  function codeInfo(code, isDay) {
    const c = CODES[code] || CODES[0];
    return { label: c.label, emoji: isDay ? c.day : c.night, g: c.g };
  }

  function loadSettings() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"); }
    catch (e) { return {}; }
  }
  function saveSettings(patch) {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(Object.assign(loadSettings(), patch))); }
    catch (e) {}
  }
  function tempUnit() { return loadSettings().tempUnit === "f" ? "f" : "c"; }

  let city = loadSettings().weatherCity || CITIES[0];
  let unit = tempUnit();
  let data = null;

  function cacheKey() { return city.lat.toFixed(3) + "," + city.lon.toFixed(3) + "|" + unit; }
  function readCache() {
    try {
      const c = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
      return c && c.key === cacheKey() ? c : null;
    } catch (e) { return null; }
  }
  function writeCache() {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ key: cacheKey(), at: Date.now(), data })); }
    catch (e) {}
  }

  // ---------- API ----------
  async function fetchForecast() {
    const f = unit === "f" ? "&temperature_unit=fahrenheit&wind_speed_unit=mph" : "&wind_speed_unit=kmh";
    const u = API +
      "?latitude=" + city.lat + "&longitude=" + city.lon +
      "&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m,wind_direction_10m,pressure_msl,cloud_cover" +
      "&hourly=temperature_2m,weather_code,precipitation_probability,is_day" +
      "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,uv_index_max,wind_speed_10m_max,sunrise,sunset" +
      "&timezone=auto&forecast_days=7" + f;
    const r = await fetch(u);
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.json();
  }

  // ---------- helpers ----------
  function fmtT(v) { return Math.round(Number(v)) + "°"; }
  function deg(v) { return Math.round(Number(v)); }
  function compass(degV) {
    const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
    return dirs[Math.round(Number(degV) / 45) % 8];
  }
  function hourLabel(iso, i) {
    return i === 0 ? "Now" : String(iso || "").slice(11, 16);
  }
  function dayName(dateStr, i) {
    const d = new Date(String(dateStr).slice(0, 10) + "T12:00:00");
    return i === 0 ? "Today" : d.toLocaleDateString(undefined, { weekday: "short" });
  }
  function timeHM(iso) { return String(iso || "").slice(11, 16); }

  // ---------- DOM builders ----------
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  const RADAR_BLOBS = [
    [34, 30, 7, 0.9], [62, 26, 9, 0.7], [68, 55, 6, 0.6], [30, 62, 8, 0.8],
    [52, 68, 5, 0.4], [22, 44, 4, 0.3], [78, 40, 4, 0.2],
  ];

  function buildRadar() {
    const wrap = el("div", "wx-card wx-radar");
    wrap.appendChild(el("div", "wx-card-title", "Precipitation radar"));
    const fig = el("div", "wx-radar-fig");
    const disc = el("div", "wx-radar-disc");
    disc.innerHTML = '<svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden="true">' +
      '<circle cx="50" cy="50" r="48" fill="rgba(34,211,238,.05)"/>' +
      '<circle cx="50" cy="50" r="36" fill="none" stroke="rgba(148,163,184,.28)" stroke-width=".7"/>' +
      '<circle cx="50" cy="50" r="24" fill="none" stroke="rgba(148,163,184,.28)" stroke-width=".7"/>' +
      '<circle cx="50" cy="50" r="12" fill="none" stroke="rgba(148,163,184,.28)" stroke-width=".7"/>' +
      '<path d="M50 2 L50 98 M2 50 L98 50" stroke="rgba(148,163,184,.18)" stroke-width=".7"/>' +
      '<circle cx="50" cy="50" r="2" fill="#22d3ee"/>' +
      "</svg>";
    disc.appendChild(el("div", "wx-radar-sweep"));
    for (const [l, t, s, o] of RADAR_BLOBS) {
      const d = el("span", "wx-radar-blob");
      d.style.cssText = "left:" + l + "%;top:" + t + "%;width:" + s + "%;height:" + s + "%;opacity:" + o + ";";
      disc.appendChild(d);
    }
    fig.appendChild(disc);
    const tag = el("div", "wx-radar-tag", "Dry");
    wrap.append(fig, tag);
    return { el: wrap, tag };
  }

  function updateRadar(radar, precip) {
    const p = Number(precip) || 0;
    const word = p <= 0 ? "Dry" : p < 0.5 ? "Light" : p < 2.5 ? "Moderate" : "Heavy";
    radar.tag.textContent = word + " · " + p.toFixed(1) + " mm/h now";
    const show = Math.min(RADAR_BLOBS.length, 1 + Math.ceil(p));
    const blobs = radar.el.querySelectorAll(".wx-radar-blob");
    blobs.forEach((b, i) => { b.style.opacity = i < show ? RADAR_BLOBS[i][3] : 0; });
  }

  function deriveAlerts(d) {
    const out = [];
    const cur = d.current || {};
    const daily = d.daily || {};
    const code = Number(cur.weather_code);
    if (code >= 95) out.push({ icon: "⛈️", txt: "Severe thunderstorm in progress" });
    const tmax = daily.temperature_2m_max || [], tmin = daily.temperature_2m_min || [];
    const wind = daily.wind_speed_10m_max || [];
    const pp = daily.precipitation_probability_max || [];
    const topWind = Math.max(0, ...wind.slice(0, 7).map(Number));
    const topHeat = Math.max(0, ...tmax.slice(0, 7).map(Number));
    const lowCold = Math.min(0, ...tmin.slice(0, 7).map(Number));
    if (topWind >= 40) out.push({ icon: "🌬️", txt: "Wind advisory — gusts over " + Math.round(topWind) + (unit === "f" ? " mph" : " km/h") + " in the next 7 days" });
    if (topHeat >= 35) out.push({ icon: "🥵", txt: "Heat advisory — up to " + fmtT(topHeat) });
    if (lowCold <= -15) out.push({ icon: "🥶", txt: "Cold warning — down to " + fmtT(lowCold) });
    if (pp[0] >= 70) out.push({ icon: "🌧️", txt: "Rain likely today (" + deg(pp[0]) + "%)" });
    return out.slice(0, 3);
  }

  // ---------- render ----------
  function renderHero(hero, d) {
    const cur = d.current || {};
    const daily = d.daily || {};
    const isDay = Number(cur.is_day);
    const info = codeInfo(Number(cur.weather_code), isDay);
    const g = (!isDay && info.g === "sun") ? "night" : info.g;
    hero.classList.remove("wx-bg-sun", "wx-bg-cloud", "wx-bg-rain", "wx-bg-snow", "wx-bg-thunder", "wx-bg-fog", "wx-bg-night");
    hero.classList.add("wx-bg-" + g);
    hero.querySelector(".wx-hero-ico").textContent = info.emoji;
    hero.querySelector(".wx-hero-temp").textContent = fmtT(cur.temperature_2m);
    hero.querySelector(".wx-hero-cond").textContent = info.label;
    const feels = fmtT(cur.apparent_temperature);
    const hi = daily.temperature_2m_max && daily.temperature_2m_max[0] != null ? fmtT(daily.temperature_2m_max[0]) : "—";
    const lo = daily.temperature_2m_min && daily.temperature_2m_min[0] != null ? fmtT(daily.temperature_2m_min[0]) : "—";
    hero.querySelector(".wx-hero-sub").textContent = "Feels like " + feels + " · H " + hi + " / L " + lo;
  }

  function renderDetails(grid, d) {
    const cur = d.current || {};
    const daily = d.daily || {};
    grid.textContent = "";
    const items = [
      ["Humidity", deg(cur.relative_humidity_2m) + "%", "💧"],
      ["Wind", deg(cur.wind_speed_10m) + " " + (unit === "f" ? "mph" : "km/h") + " " + compass(cur.wind_direction_10m), "🌬️"],
      ["Pressure", deg(cur.pressure_msl) + " hPa", "🧭"],
      ["UV index", daily.uv_index_max && daily.uv_index_max[0] != null ? deg(daily.uv_index_max[0]) : "—", "🌞"],
      ["Precipitation", Number(cur.precipitation || 0).toFixed(1) + " mm", "🌧️"],
      ["Cloud cover", deg(cur.cloud_cover) + "%", "☁️"],
      ["Sunrise", daily.sunrise && daily.sunrise[0] ? timeHM(daily.sunrise[0]) : "—", "🌅"],
      ["Sunset", daily.sunset && daily.sunset[0] ? timeHM(daily.sunset[0]) : "—", "🌇"],
    ];
    for (const [k, v, ico] of items) {
      const cell = el("div", "wx-detail");
      cell.appendChild(el("span", "wx-detail-ico", ico));
      const body = el("div", "wx-detail-body");
      body.appendChild(el("span", "wx-detail-k", k));
      body.appendChild(el("span", "wx-detail-v", v));
      cell.appendChild(body);
      grid.appendChild(cell);
    }
  }

  function renderHourly(strip, d) {
    strip.textContent = "";
    const h = d.hourly || {};
    const times = h.time || [], temps = h.temperature_2m || [], codes = h.weather_code || [];
    const probs = h.precipitation_probability || [], days = h.is_day || [];
    const now = Date.now();
    let start = 0;
    for (let i = 0; i < times.length; i++) {
      const t = new Date(String(times[i]).replace("T", "T")).getTime();
      if (t >= now - 3600e3) { start = i; break; }
    }
    for (let i = start; i < Math.min(start + 24, times.length); i++) {
      const info = codeInfo(Number(codes[i]), Number(days[i]));
      const cell = el("div", "wx-hly-cell" + (i === start ? " now" : ""));
      cell.appendChild(el("div", "wx-hly-time", hourLabel(times[i], i - start)));
      cell.appendChild(el("div", "wx-hly-ico", info.emoji));
      cell.appendChild(el("div", "wx-hly-temp", fmtT(temps[i])));
      const pr = probs[i];
      if (pr != null && Number(pr) > 0) cell.appendChild(el("div", "wx-hly-pp", deg(pr) + "%"));
      strip.appendChild(cell);
    }
  }

  function renderDaily(list, d) {
    list.textContent = "";
    const da = d.daily || {};
    const times = da.time || [], codes = da.weather_code || [], tmax = da.temperature_2m_max || [];
    const tmin = da.temperature_2m_min || [], pp = da.precipitation_probability_max || [];
    let loV = 0, hiV = 0;
    try {
      loV = Math.min(...tmin.slice(0, 7).map(Number));
      hiV = Math.max(...tmax.slice(0, 7).map(Number));
    } catch (e) {}
    for (let i = 0; i < Math.min(7, codes.length); i++) {
      const info = codeInfo(Number(codes[i]), true);
      const row = el("div", "wx-day");
      row.appendChild(el("div", "wx-day-name", dayName(times[i], i)));
      const ico = el("div", "wx-day-ico", info.emoji);
      ico.title = info.label;
      row.appendChild(ico);
      const pbar = el("div", "wx-day-pp");
      if (pp[i] != null && Number(pp[i]) >= 15) {
        pbar.appendChild(el("span", "wx-day-pp-ico", "💧"));
        pbar.appendChild(el("span", "wx-day-pp-txt", deg(pp[i]) + "%"));
      }
      row.appendChild(pbar);
      row.appendChild(el("div", "wx-day-lo", fmtT(tmin[i])));
      const span = el("div", "wx-day-bar");
      const spanFill = el("div", "wx-day-bar-fill");
      const w = hiV === loV ? 50 : 30 + 70 * ((Number(tmax[i]) - loV) / (hiV - loV));
      spanFill.style.width = Math.round(w) + "%";
      span.appendChild(spanFill);
      row.appendChild(span);
      row.appendChild(el("div", "wx-day-hi", fmtT(tmax[i])));
      list.appendChild(row);
    }
  }

  function renderAlerts(banner, d) {
    banner.textContent = "";
    const alerts = deriveAlerts(d);
    banner.hidden = alerts.length === 0;
    for (const a of alerts) {
      const row = el("div", "wx-alert");
      row.appendChild(el("span", "wx-alert-ico", a.icon));
      row.appendChild(el("span", "wx-alert-txt", a.txt));
      banner.appendChild(row);
    }
  }

  // ---------- city picker ----------
  function buildCityPicker(btn, onPick) {
    const list = el("div", "wx-city-list");
    list.hidden = true;
    const search = el("input", "wx-city-search");
    search.type = "text";
    search.placeholder = "Search cities…";
    search.setAttribute("aria-label", "Search cities");
    const results = el("div", "wx-city-results");
    list.append(search, results);

    function renderResults(q) {
      results.textContent = "";
      const ql = String(q || "").toLowerCase();
      const opts = CITIES.filter((c) => !ql || c.name.toLowerCase().includes(ql) || c.country.toLowerCase().includes(ql));
      for (const c of opts) {
        const b = el("button", "wx-city-opt" + (c === city ? " sel" : ""), "");
        b.type = "button";
        b.appendChild(el("span", "wx-city-name", c.name));
        b.appendChild(el("span", "wx-city-cty", c.country));
        b.addEventListener("click", () => { close(); onPick(c); });
        results.appendChild(b);
      }
    }
    function open() { list.hidden = false; search.value = ""; renderResults(""); search.focus(); }
    function close() { list.hidden = true; }
    btn.addEventListener("click", () => { if (list.hidden) open(); else close(); });
    search.addEventListener("input", () => renderResults(search.value));
    search.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") { const o = results.querySelector(".wx-city-opt"); if (o) o.click(); }
      if (ev.key === "Escape") close();
    });
    document.addEventListener("mousedown", (ev) => {
      if (!list.hidden && !ev.target.closest(".wx-city-btn") && !ev.target.closest(".wx-city-list")) close();
    });
    return { el: list, close };
  }

  // ---------- app window ----------
  function buildApp() {
    const rootEl = el("div", "wx");
    const body = el("div", "wx-body");
    const head = el("div", "wx-head");

    const cityWrap = el("div", "wx-city-wrap");
    const cityBtn = el("button", "wx-city-btn wx-btn", "📍 " + city.name + " ▾");
    cityBtn.type = "button";
    cityBtn.title = "Change city";
    const picker = buildCityPicker(cityBtn, (c) => {
      city = c;
      saveSettings({ weatherCity: c });
      cityBtn.textContent = "📍 " + c.name + " ▾";
      load();
    });
    cityWrap.append(cityBtn, picker.el);

    const units = el("div", "wx-units");
    for (const [v, l] of [["c", "°C"], ["f", "°F"]]) {
      const b = el("button", "wx-unit" + (unit === v ? " sel" : ""), l);
      b.type = "button";
      b.addEventListener("click", () => {
        if (unit === v) return;
        unit = v;
        saveSettings({ tempUnit: v });
        load();
      });
      units.appendChild(b);
    }
    const refreshBtn = el("button", "wx-btn wx-ico-btn", "⟳");
    refreshBtn.type = "button";
    refreshBtn.title = "Refresh forecast";
    refreshBtn.addEventListener("click", load);
    const locateBtn = el("button", "wx-btn wx-ico-btn", "📡");
    locateBtn.type = "button";
    locateBtn.title = "Use my location";
    locateBtn.addEventListener("click", () => {
      if (!navigator.geolocation) { setStatus("Location not supported by this browser."); return; }
      setStatus("Locating…");
      navigator.geolocation.getCurrentPosition((pos) => {
        city = { name: "My location", country: "", lat: +pos.coords.latitude.toFixed(3), lon: +pos.coords.longitude.toFixed(3) };
        saveSettings({ weatherCity: city });
        cityBtn.textContent = "📍 My location ▾";
        load();
      }, () => setStatus("Couldn't get your location — the page may need permission."), { timeout: 9000 });
    });
    head.append(cityWrap, units, el("div", "wx-flex"), refreshBtn, locateBtn);

    const status = el("div", "wx-status", "Loading…");
    status.classList.add("loading");
    const alerts = el("div", "wx-alerts");
    alerts.hidden = true;
    const hero = el("div", "wx-hero");
    hero.appendChild(el("div", "wx-hero-ico", "⛅"));
    hero.appendChild(el("div", "wx-hero-temp", "—"));
    hero.appendChild(el("div", "wx-hero-cond", "Loading forecast"));
    hero.appendChild(el("div", "wx-hero-sub", ""));
    const grid = el("div", "wx-details");
    const hlyTitle = el("div", "wx-section-title", "Next 24 hours");
    const hly = el("div", "wx-hly");
    const dlyTitle = el("div", "wx-section-title", "7-day forecast");
    const dly = el("div", "wx-days");
    const radar = buildRadar();

    body.append(head, status, alerts, hero, grid, hlyTitle, hly, dlyTitle, dly, radar.el);
    rootEl.appendChild(body);

    function setStatus(txt, cls) {
      status.textContent = txt;
      status.className = "wx-status" + (cls ? " " + cls : "");
    }

    function renderForecast(d) {
      renderHero(hero, d);
      renderDetails(grid, d);
      renderHourly(hly, d);
      renderDaily(dly, d);
      renderAlerts(alerts, d);
      const cur = d.current || {};
      updateRadar(radar, cur.precipitation);
      const updated = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      setStatus("Updated " + updated, "ok");
    }

    function renderEmpty() {
      alerts.hidden = true;
      alerts.textContent = "";
      hero.className = "wx-hero wx-bg-cloud";
      hero.querySelector(".wx-hero-ico").textContent = "🌐";
      hero.querySelector(".wx-hero-temp").textContent = "—";
      hero.querySelector(".wx-hero-cond").textContent = "No forecast";
      hero.querySelector(".wx-hero-sub").textContent = "Weather data unavailable for " + city.name + ".";
      grid.textContent = "";
      hly.textContent = "";
      dly.textContent = "";
      radar.tag.textContent = "No data";
    }

    async function load() {
      const cache = readCache();
      if (cache && cache.data) {
        data = cache.data;
        renderForecast(data);
        const ago = Math.max(0, Math.round((Date.now() - cache.at) / 60000));
        setStatus("Offline — showing forecast from " + ago + " min ago", "warn");
      }
      try {
        const fresh = await fetchForecast();
        data = fresh;
        writeCache();
        renderForecast(fresh);
      } catch (e) {
        if (!(cache && cache.data)) {
          renderEmpty();
          setStatus("Couldn't reach the weather service. Check the network and retry.", "err");
        }
      }
    }

    load();
    return { root: rootEl, onCloseRequest: () => picker.close() };
  }

  window.AppContent = window.AppContent || {};
  window.AppContent["weather"] = function () {
    const built = buildApp();
    return { content: built.root, w: 780, h: 600, minW: 620, minH: 460, onCloseRequest: built.onCloseRequest };
  };
})();
