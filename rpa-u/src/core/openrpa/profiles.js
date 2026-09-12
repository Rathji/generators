import { makeId } from "../ids.js";
import { OPENRPA_DEFAULT_PORT, OPENRPA_PROFILE_COLLECTION, OPENRPA_SCHEMES, OPENRPA_SCHEME_ALIASES } from "./constants.js";

const HOST_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i;
const IPV4_PATTERN = /^(\d{1,3}\.){3}\d{1,3}$/;

function issue(code, field, message) {
  return { code, field, message };
}

function text(value) {
  return value == null ? "" : String(value).trim();
}

function parseUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed;
  } catch (error) {
    return null;
  }
}

export function parseEndpoint(input = {}) {
  const errors = [];
  const rawUrl = text(input.url);
  let scheme = text(input.scheme).toLowerCase();
  let host = text(input.host).toLowerCase();
  let port = input.port;
  let path = text(input.path) || "/";

  if (rawUrl) {
    const parsed = parseUrl(rawUrl);
    if (!parsed) {
      errors.push(issue("invalid-url", "url", "The WebSocket URL is not a valid URL."));
    } else {
      const rawScheme = parsed.protocol.replace(/:$/, "").toLowerCase();
      const mapped = OPENRPA_SCHEME_ALIASES[rawScheme] || rawScheme;
      if (!OPENRPA_SCHEMES.includes(mapped)) {
        errors.push(issue("invalid-scheme", "url", `The URL scheme "${rawScheme}" is not ws, wss, http or https.`));
      } else {
        scheme = mapped;
        host = parsed.hostname.toLowerCase();
        port = parsed.port ? Number(parsed.port) : Number(OPENRPA_DEFAULT_PORT[mapped]);
        path = `${parsed.pathname || "/"}${parsed.search || ""}`;
      }
    }
  } else {
    if (!scheme) scheme = "wss";
    if (!OPENRPA_SCHEMES.includes(scheme)) {
      errors.push(issue("invalid-scheme", "scheme", `The scheme must be one of: ${OPENRPA_SCHEMES.join(", ")}.`));
      scheme = "wss";
    }
    if (!host) {
      errors.push(issue("required", "host", "A host is required (or supply a full WebSocket URL)."));
    } else if (!HOST_PATTERN.test(host) && !IPV4_PATTERN.test(host)) {
      errors.push(issue("invalid-host", "host", `"${host}" does not look like a hostname or IP address.`));
    }
    if (host.includes("://") || host.includes("/")) {
      errors.push(issue("invalid-host", "host", "The host must not contain a scheme or a path."));
    }
    if (port == null || port === "") {
      port = OPENRPA_DEFAULT_PORT[scheme];
    } else {
      const parsedPort = Number(port);
      if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
        errors.push(issue("invalid-port", "port", "The port must be an integer between 1 and 65535."));
      } else {
        port = parsedPort;
      }
    }
  }

  if (!path.startsWith("/")) path = `/${path}`;

  const restBase = text(input.restBase);
  if (restBase) {
    const parsed = parseUrl(restBase);
    if (!parsed || !/^https?:$/.test(parsed.protocol)) {
      errors.push(issue("invalid-restbase", "restBase", "The REST base must be a valid http or https URL."));
    }
  }

  const ok = errors.length === 0;
  const endpoint = ok
    ? {
        scheme,
        host,
        port,
        path,
        url: `${scheme}://${host}:${port}${path}`,
      }
    : null;

  return { ok, errors, endpoint };
}

export function validateProfile(input = {}) {
  const errors = [];
  const name = text(input.name);
  if (!name) errors.push(issue("required", "name", "A profile name is required."));
  else if (name.length < 2) errors.push(issue("too-short", "name", "The profile name must be at least 2 characters."));
  else if (name.length > 60) errors.push(issue("too-long", "name", "The profile name must be at most 60 characters."));

  const parsed = parseEndpoint(input);
  errors.push(...parsed.errors);

  const organization = text(input.organization);
  if (organization.length > 80) errors.push(issue("too-long", "organization", "The organization must be at most 80 characters."));

  const ok = errors.length === 0;
  const profile = ok
    ? {
        name,
        scheme: parsed.endpoint.scheme,
        host: parsed.endpoint.host,
        port: parsed.endpoint.port,
        path: parsed.endpoint.path,
        url: parsed.endpoint.url,
        organization,
        insecure: !!input.insecure,
        restBase: text(input.restBase),
      }
    : null;

  return { ok, errors, profile };
}

export function endpointOf(profile) {
  if (!profile) return null;
  if (profile.url) return profile.url;
  const scheme = profile.scheme || "wss";
  const port = profile.port || OPENRPA_DEFAULT_PORT[scheme];
  return `${scheme}://${profile.host}:${port}${profile.path || "/"}`;
}

export function createProfileStore({ db = null, clock = () => Date.now(), collection = OPENRPA_PROFILE_COLLECTION } = {}) {
  const records = new Map();
  let activeId = null;
  let counter = 0;

  const iso = () => new Date(clock()).toISOString();

  function list() {
    return Array.from(records.values())
      .slice()
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  function get(id) {
    return records.get(id) || null;
  }

  async function put(record) {
    records.set(record.id, record);
    if (db) {
      try {
        await db.put(collection, record.id, record);
      } catch (error) {}
    }
    return record;
  }

  async function persistActive() {
    if (!db) return;
    try {
      if (activeId) await db.put(collection, "active", { key: "active", id: activeId });
      else await db.remove(collection, "active");
    } catch (error) {}
  }

  async function create(input) {
    const report = validateProfile(input);
    if (!report.ok) return { ok: false, errors: report.errors };
    counter += 1;
    const id = makeId("orp", `${report.profile.host}:${report.profile.port}${report.profile.path}:${clock()}:${counter}`);
    const record = { id, ...report.profile, createdAt: iso(), updatedAt: iso() };
    await put(record);
    if (!activeId) {
      activeId = id;
      await persistActive();
    }
    return { ok: true, profile: record };
  }

  async function update(id, input) {
    const existing = records.get(id);
    if (!existing) return { ok: false, errors: [issue("not-found", "id", `No profile with id "${id}".`)] };
    const report = validateProfile(input);
    if (!report.ok) return { ok: false, errors: report.errors };
    const record = { id, ...report.profile, createdAt: existing.createdAt, updatedAt: iso() };
    await put(record);
    return { ok: true, profile: record };
  }

  async function remove(id) {
    if (!records.has(id)) return false;
    records.delete(id);
    if (db) {
      try {
        await db.remove(collection, id);
      } catch (error) {}
    }
    if (activeId === id) {
      activeId = null;
      await persistActive();
    }
    return true;
  }

  async function setActive(id) {
    if (!records.has(id)) return false;
    activeId = id;
    await persistActive();
    return true;
  }

  function active() {
    return activeId ? records.get(activeId) || null : null;
  }

  async function clearActive() {
    activeId = null;
    await persistActive();
    return true;
  }

  async function ready() {
    if (!db) return { profiles: 0 };
    for (const record of db.all(collection)) {
      if (!record || typeof record !== "object") continue;
      if (record.key === "active") {
        activeId = record.id || null;
      } else if (record.id) {
        records.set(record.id, record);
      }
    }
    if (activeId && !records.has(activeId)) activeId = null;
    return { profiles: records.size };
  }

  async function reset() {
    records.clear();
    activeId = null;
    counter = 0;
    if (db) {
      try {
        await db.clear(collection);
      } catch (error) {}
    }
  }

  function stats() {
    const all = list();
    return {
      total: all.length,
      active: activeId,
      activeName: active() ? active().name : null,
      schemes: {
        ws: all.filter((profile) => profile.scheme === "ws").length,
        wss: all.filter((profile) => profile.scheme === "wss").length,
      },
      insecure: all.filter((profile) => profile.insecure).length,
      organizations: Array.from(new Set(all.map((profile) => profile.organization).filter(Boolean))).length,
    };
  }

  return {
    collection,
    validate: validateProfile,
    endpointOf,
    create,
    update,
    remove,
    setActive,
    active,
    clearActive,
    get,
    list,
    all: list,
    ready,
    hydrate: ready,
    reset,
    stats,
    count: () => records.size,
  };
}
