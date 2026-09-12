import { hash36, slugify } from "../ids.js";
import { OPENRPA_BUNDLES_COLLECTION, OPENRPA_ID, OPENRPA_STUB } from "./constants.js";
import { OPENRPA_FIELD_MODEL, OPENRPA_OWNERSHIP_VERSION, OWNERSHIP_PRIORITIES } from "./ownership.js";
import { OPENRPA_TARGET_TYPE_IDS } from "./linking.js";

export const OPENRPA_BUNDLE_FORMAT = "rpa-u/openrpa-bundle";
export const OPENRPA_BUNDLE_VERSION = 1;
export const OPENRPA_BUNDLE_MIN_VERSION = 1;
export const OPENRPA_BUNDLE_KIND = "openrpa";

export const OPENRPA_BUNDLE_SECTIONS = ["profiles", "ownership", "links", "documents", "assets"];

export const OPENRPA_BUNDLE_DOCUMENT_COLLECTIONS = ["workflows", "openrpa_queue", "openrpa_workitem", "openrpa_robot", "nodered", "companies"];

export const OPENRPA_PROFILE_FIELDS = ["id", "name", "scheme", "host", "port", "path", "url", "organization", "insecure", "restBase", "createdAt", "updatedAt"];

export const OPENRPA_SECRET_KEY_PATTERN = /(pass(word|phrase)?|secret|token|jwt|credential|api[-_]?key|private[-_]?key|bearer|hash)/i;

const SECTION_LABELS = {
  profiles: "Connection profiles",
  ownership: "Field ownership",
  links: "Entity links",
  documents: "OpenRPA documents",
  assets: "Workflow assets",
};

export function sectionLabel(id) {
  return SECTION_LABELS[id] || id;
}

export function isSecretKey(key) {
  return OPENRPA_SECRET_KEY_PATTERN.test(String(key || ""));
}

export function sanitizeProfile(profile) {
  const out = {};
  const excluded = [];
  const secrets = [];
  for (const [key, value] of Object.entries(profile || {})) {
    if (OPENRPA_PROFILE_FIELDS.includes(key)) {
      out[key] = value;
    } else {
      excluded.push(key);
      if (isSecretKey(key)) secrets.push(key);
    }
  }
  return { profile: out, excluded, secrets };
}

function checkSum(value) {
  return `sum_${hash36(typeof value === "string" ? value : JSON.stringify(value))}`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value == null ? null : value));
}

function clean(value) {
  return value == null ? "" : String(value);
}

function countOf(value) {
  return Array.isArray(value) ? value.length : 0;
}

function documentCount(documents) {
  if (!documents || typeof documents !== "object") return 0;
  let total = 0;
  for (const list of Object.values(documents)) total += countOf(list);
  return total;
}

function profileKey(profile) {
  return `${clean(profile.name).toLowerCase()}|${clean(profile.host).toLowerCase()}|${clean(profile.port)}${clean(profile.path || "/")}`;
}

export function parseBundle(text) {
  const source = text == null ? "" : String(text).trim();
  if (!source) return { ok: false, error: { code: "empty", message: "Paste or upload a bundle to continue." } };
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    return { ok: false, error: { code: "invalid-json", message: `The bundle is not valid JSON: ${error.message}` } };
  }
  return { ok: true, bundle: parsed };
}

export function createOpenRpaBundleStore({
  identity = null,
  registry = null,
  profiles = null,
  linking = null,
  documents = null,
  files = null,
  getMode = () => null,
  db = null,
  collection = OPENRPA_BUNDLES_COLLECTION,
  clock = () => Date.now(),
  limit = 25,
} = {}) {
  const stored = new Map();
  const counters = { built: 0, exported: 0, imported: 0, dryRuns: 0, published: 0, failed: 0 };
  let seqCounter = 0;
  let lastAt = null;
  let lastError = null;

  const iso = () => new Date(clock()).toISOString();

  function workflowIdsFrom(documentsSection) {
    const ids = new Set();
    const workflows = documentsSection && documentsSection.workflows;
    if (Array.isArray(workflows)) {
      for (const doc of workflows) if (doc && doc._id) ids.add(doc._id);
    }
    return ids;
  }

  async function collectDocuments(collections) {
    const section = {};
    const warnings = [];
    let total = 0;
    if (!documents) return { documents: section, count: 0, warnings };
    for (const name of collections) {
      const result = await documents.query(name, {});
      if (!result || result.ok === false) {
        warnings.push({ code: "documents-unavailable", message: `The "${name}" collection could not be read${result && result.error ? `: ${result.error.message}` : "."}`, ref: name });
        continue;
      }
      section[name] = (Array.isArray(result) ? result : []).map((record) => clone(record.raw || record));
      total += section[name].length;
    }
    return { documents: section, count: total, warnings };
  }

  async function collectAssets(workflowIds) {
    if (!files) return { assets: [], warnings: [], bytes: 0 };
    const warnings = [];
    const listed = await files.list({});
    if (!listed || listed.ok === false) {
      return { assets: [], warnings: [{ code: "assets-unavailable", message: "The OpenFlow file store could not be read, so workflow assets were not exported." }], bytes: 0 };
    }
    const assets = [];
    let bytes = 0;
    for (const file of listed.files) {
      const refId = file.refId || null;
      const referenced = file.ref === "workflow" || (refId && workflowIds.has(refId));
      if (!referenced) continue;
      if (workflowIds.size && refId && !workflowIds.has(refId)) continue;
      const got = await files.content(file.id);
      const content = got && got.ok !== false ? got.content : "";
      const encoding = got && got.ok !== false && got.file ? got.file.encoding : file.encoding;
      assets.push({
        id: file.id,
        filename: file.filename,
        name: file.name,
        contentType: file.contentType,
        encoding: encoding || "utf8",
        length: file.length,
        checksum: file.checksum,
        ref: file.ref || "workflow",
        refId,
        workflowId: refId,
        content: content == null ? "" : content,
      });
      bytes += Number(file.length) || 0;
    }
    return { assets, warnings, bytes };
  }

  function profileSection(profileIds) {
    const warnings = [];
    const excluded = [];
    if (!profiles) return { profiles: [], warnings, excluded };
    const list = profiles.list().filter((profile) => !profileIds || profileIds.includes(profile.id));
    const out = [];
    for (const profile of list) {
      const { profile: safe, excluded: dropped } = sanitizeProfile(profile);
      out.push(safe);
      for (const key of dropped) {
        excluded.push(`${profile.id}.${key}`);
        warnings.push({ code: "profile-field-excluded", message: `Profile "${profile.name}" field "${key}" was excluded: a bundle carries connection settings only, never credentials.`, ref: profile.id });
      }
    }
    return { profiles: out, warnings, excluded };
  }

  function ownershipSection() {
    const fields = [];
    for (const [entityType, list] of Object.entries(OPENRPA_FIELD_MODEL)) {
      for (const field of list) fields.push({ entityType, ...field });
    }
    return { version: OPENRPA_OWNERSHIP_VERSION, priorities: { ...OWNERSHIP_PRIORITIES }, fields };
  }

  function linkSection() {
    if (!linking) return [];
    return linking.all().map((edge) => ({
      id: edge.id,
      entityType: edge.entityType,
      entityId: edge.entityId,
      entityName: edge.entityName || null,
      targetType: edge.targetType,
      targetId: edge.targetId,
      targetName: edge.targetName || null,
      origin: edge.origin || "manual",
      confidence: edge.confidence == null ? 1 : edge.confidence,
      field: edge.field || null,
      note: edge.note || "",
      createdAt: edge.createdAt || null,
      updatedAt: edge.updatedAt || null,
    }));
  }

  async function build(options = {}) {
    const include = {
      profiles: options.includeProfiles !== false,
      ownership: options.includeOwnership !== false,
      links: options.includeLinks !== false,
      documents: options.includeDocuments !== false,
      assets: options.includeAssets !== false,
    };
    const collections = Array.isArray(options.collections) && options.collections.length ? options.collections.slice() : OPENRPA_BUNDLE_DOCUMENT_COLLECTIONS.slice();
    const warnings = [];

    const profilePart = include.profiles ? profileSection(options.profileIds || null) : { profiles: [], warnings: [], excluded: [] };
    warnings.push(...profilePart.warnings);

    const ownership = include.ownership ? ownershipSection() : null;

    const links = include.links ? linkSection() : [];

    let documentsSection = {};
    let documentTotal = 0;
    if (include.documents) {
      const collected = await collectDocuments(collections);
      documentsSection = collected.documents;
      documentTotal = collected.count;
      warnings.push(...collected.warnings);
    }

    let assets = [];
    let assetBytes = 0;
    if (include.assets) {
      const workflowIds = workflowIdsFrom(documentsSection);
      if (!workflowIds.size) {
        const wf = await collectDocuments(["workflows"]);
        for (const id of workflowIdsFrom(wf.documents)) workflowIds.add(id);
        warnings.push(...wf.warnings);
      }
      const collected = await collectAssets(workflowIds);
      assets = collected.assets;
      assetBytes = collected.bytes;
      warnings.push(...collected.warnings);
    }

    seqCounter += 1;
    const createdAt = iso();
    const seed = `${options.name || "openrpa"}:${createdAt}:${seqCounter}:${profilePart.profiles.length}:${links.length}:${documentTotal}:${assets.length}`;
    const id = `orb_${hash36(seed)}`;
    const manifest = [
      ...profilePart.profiles.map((profile) => ({ section: "profiles", key: profile.id || profileKey(profile), checksum: checkSum(profile) })),
      ...(ownership ? ownership.fields.map((field) => ({ section: "ownership", key: `${field.entityType}.${field.key}`, checksum: checkSum(field) })) : []),
      ...links.map((link) => ({ section: "links", key: link.id, checksum: checkSum(link) })),
      ...Object.entries(documentsSection).flatMap(([name, list]) => list.map((doc) => ({ section: "documents", key: `${name}:${doc._id}`, checksum: checkSum(doc) }))),
      ...assets.map((asset) => ({ section: "assets", key: `${asset.refId || "-"}:${asset.filename}`, checksum: asset.checksum || checkSum(asset.content) })),
    ];

    const bundle = {
      format: OPENRPA_BUNDLE_FORMAT,
      version: OPENRPA_BUNDLE_VERSION,
      kind: OPENRPA_BUNDLE_KIND,
      id,
      seq: seqCounter,
      name: options.name || `OpenRPA bundle ${seqCounter}`,
      description: options.description || "",
      createdAt,
      createdBy: options.createdBy || "operator",
      generator: { name: OPENRPA_STUB, stub: OPENRPA_STUB },
      source: {
        connector: OPENRPA_ID,
        mode: getMode ? getMode() : null,
        collections,
        profileIds: profilePart.profiles.map((profile) => profile.id).filter(Boolean),
      },
      include,
      counts: {
        profiles: countOf(profilePart.profiles),
        ownershipFields: ownership ? ownership.fields.length : 0,
        links: countOf(links),
        documents: documentTotal,
        collections: Object.keys(documentsSection).length,
        assets: countOf(assets),
        assetsBytes: assetBytes,
        warnings: warnings.length,
        excludedSecrets: profilePart.excluded.length,
      },
      profiles: profilePart.profiles,
      ownership,
      links,
      documents: documentsSection,
      assets,
      warnings,
      manifest,
      fingerprint: `ofp_${hash36(manifest.map((entry) => `${entry.section}:${entry.key}:${entry.checksum}`).join("|"))}`,
    };

    counters.built += 1;
    lastAt = createdAt;
    return { ok: true, bundle };
  }

  function validate(input) {
    const errors = [];
    const warnings = [];
    let bundle = input;
    if (typeof input === "string") {
      const parsed = parseBundle(input);
      if (!parsed.ok) return { ok: false, errors: [{ code: parsed.error.code, message: parsed.error.message }], warnings: [] };
      bundle = parsed.bundle;
    }
    if (!bundle || typeof bundle !== "object" || Array.isArray(bundle)) {
      return { ok: false, errors: [{ code: "invalid-bundle", message: "A bundle must be a JSON object." }], warnings: [] };
    }
    if (bundle.format !== OPENRPA_BUNDLE_FORMAT) {
      errors.push({ code: "unknown-format", message: `This file is not an OpenRPA bundle (format "${bundle.format || "unknown"}").` });
    }
    const version = Number(bundle.version);
    if (!Number.isFinite(version)) {
      errors.push({ code: "missing-version", message: "The bundle is missing a format version." });
    } else if (version > OPENRPA_BUNDLE_VERSION) {
      errors.push({ code: "newer-version", message: `This bundle was written by a newer release (version ${version}); this build reads up to version ${OPENRPA_BUNDLE_VERSION}.` });
    } else if (version < OPENRPA_BUNDLE_MIN_VERSION) {
      errors.push({ code: "older-version", message: `Bundle version ${version} is older than the supported minimum (${OPENRPA_BUNDLE_MIN_VERSION}).` });
    }
    for (const section of OPENRPA_BUNDLE_SECTIONS) {
      const value = bundle[section];
      if (value == null) continue;
      if (section === "ownership") {
        if (typeof value !== "object" || Array.isArray(value)) errors.push({ code: "invalid-section", message: "The ownership section must be an object.", ref: section });
        else if (value.fields != null && !Array.isArray(value.fields)) errors.push({ code: "invalid-section", message: "Ownership fields must be an array.", ref: section });
      } else if (section === "documents") {
        if (typeof value !== "object" || Array.isArray(value)) errors.push({ code: "invalid-section", message: "The documents section must be a map of collection name to documents.", ref: section });
        else {
          for (const [name, list] of Object.entries(value)) {
            if (!Array.isArray(list)) errors.push({ code: "invalid-documents", message: `The "${name}" collection must hold an array of documents.`, ref: name });
          }
        }
      } else if (!Array.isArray(value)) {
        errors.push({ code: "invalid-section", message: `The ${sectionLabel(section)} section must be an array.`, ref: section });
      }
    }
    for (const warning of Array.isArray(bundle.warnings) ? bundle.warnings : []) {
      if (warning && warning.code) warnings.push(warning);
    }
    const counts = {
      profiles: countOf(bundle.profiles),
      ownershipFields: bundle.ownership && Array.isArray(bundle.ownership.fields) ? bundle.ownership.fields.length : 0,
      links: countOf(bundle.links),
      documents: documentCount(bundle.documents),
      assets: countOf(bundle.assets),
      warnings: warnings.length,
    };
    return { ok: errors.length === 0, errors, warnings, counts, version: Number.isFinite(version) ? version : null, id: bundle.id || null, name: bundle.name || null, createdAt: bundle.createdAt || null };
  }

  async function existingProfiles() {
    const map = new Map();
    if (!profiles) return map;
    for (const profile of profiles.list()) map.set(profileKey(profile), profile);
    return map;
  }

  async function existingDocuments(collections) {
    const map = new Map();
    if (!documents) return map;
    for (const name of collections) {
      const result = await documents.query(name, {});
      if (!result || result.ok === false) continue;
      const ids = new Set();
      for (const record of Array.isArray(result) ? result : []) if (record.id) ids.add(record.id);
      map.set(name, ids);
    }
    return map;
  }

  async function existingAssets() {
    const map = new Map();
    if (!files) return map;
    const listed = await files.list({});
    if (!listed || listed.ok === false) return map;
    for (const file of listed.files) map.set(`${file.refId || "-"}|${file.filename}`, file);
    return map;
  }

  async function plan(input, options = {}) {
    const report = validate(input);
    if (!report.ok) return { ok: false, errors: report.errors, warnings: report.warnings, plan: null, summary: null };
    const bundle = typeof input === "string" ? parseBundle(input).bundle : input;
    const sections = Array.isArray(options.sections) && options.sections.length ? options.sections : OPENRPA_BUNDLE_SECTIONS.slice();
    const warnings = report.warnings.slice();
    const profileMap = sections.includes("profiles") ? await existingProfiles() : new Map();
    const documentCollections = Object.keys(bundle.documents || {});
    const documentMap = sections.includes("documents") ? await existingDocuments(documentCollections) : new Map();
    const assetMap = sections.includes("assets") ? await existingAssets() : new Map();

    const plan = { profiles: [], links: [], documents: [], assets: [] };

    for (const profile of Array.isArray(bundle.profiles) ? bundle.profiles : []) {
      const key = profileKey(profile);
      const match = profileMap.get(key);
      plan.profiles.push({ profile, action: match ? "skip" : "create", reason: match ? `a profile named "${match.name}" already targets this endpoint` : "new endpoint" });
    }

    for (const link of Array.isArray(bundle.links) ? bundle.links : []) {
      if (!OPENRPA_TARGET_TYPE_IDS.includes(link.targetType)) {
        plan.links.push({ link, action: "skip", reason: `unknown target type "${link.targetType}"` });
        continue;
      }
      const entity = identity ? identity.get(link.entityType, link.entityId) : null;
      if (identity && !entity) {
        plan.links.push({ link, action: "skip", reason: `the ${link.entityType} "${link.entityId}" is not in this hub` });
        warnings.push({ code: "link-entity-missing", message: `Link to ${link.entityType} "${link.entityId}" was skipped: that entity is not in this hub.`, ref: link.id });
        continue;
      }
      plan.links.push({ link, action: "create", reason: "canonical entity found" });
    }

    for (const [name, list] of Object.entries(bundle.documents || {})) {
      const ids = documentMap.get(name) || new Set();
      for (const doc of Array.isArray(list) ? list : []) {
        const id = doc && doc._id;
        plan.documents.push({ collection: name, document: doc, action: id && ids.has(id) ? "update" : "create", reason: id && ids.has(id) ? "already exists in OpenFlow" : "new document" });
      }
    }

    for (const asset of Array.isArray(bundle.assets) ? bundle.assets : []) {
      const key = `${asset.refId || "-"}|${asset.filename}`;
      const match = assetMap.get(key);
      plan.assets.push({ asset, action: match ? "skip" : "create", reason: match ? "this file is already stored" : "new file" });
    }

    const summarise = (entries) => ({
      total: entries.length,
      create: entries.filter((entry) => entry.action === "create").length,
      update: entries.filter((entry) => entry.action === "update").length,
      skip: entries.filter((entry) => entry.action === "skip").length,
    });
    const summary = {
      profiles: summarise(plan.profiles),
      links: summarise(plan.links),
      documents: summarise(plan.documents),
      assets: summarise(plan.assets),
      warnings: warnings.length,
    };
    summary.create = summary.profiles.create + summary.links.create + summary.documents.create + summary.assets.create;
    summary.skip = summary.profiles.skip + summary.links.skip + summary.documents.skip + summary.assets.skip;
    return { ok: true, plan, summary, warnings, bundle };
  }

  async function preview(input, options = {}) {
    const result = await plan(input, options);
    if (!result.ok) return { ok: false, errors: result.errors, warnings: result.warnings || [] };
    counters.dryRuns += 1;
    return { ok: true, dryRun: true, summary: result.summary, warnings: result.warnings, plan: result.plan, name: result.bundle.name || null, id: result.bundle.id || null, version: result.bundle.version };
  }

  async function importBundle(input, options = {}) {
    const result = await plan(input, options);
    if (!result.ok) {
      counters.failed += 1;
      return { ok: false, errors: result.errors, warnings: result.warnings || [], applied: null };
    }
    if (options.dryRun) {
      counters.dryRuns += 1;
      return { ok: true, dryRun: true, summary: result.summary, warnings: result.warnings, plan: result.plan };
    }
    const applied = { profiles: 0, links: 0, documents: 0, assets: 0, skipped: 0 };
    const failed = [];
    const warnings = result.warnings.slice();

    for (const entry of result.plan.profiles) {
      if (entry.action !== "create") { applied.skipped += 1; continue; }
      const created = await profiles.create(entry.profile);
      if (created && created.ok) applied.profiles += 1;
      else failed.push({ section: "profiles", ref: entry.profile.id || entry.profile.name, error: (created && created.errors && created.errors[0] && created.errors[0].message) || "the profile could not be created" });
    }

    for (const entry of result.plan.links) {
      if (entry.action !== "create") { applied.skipped += 1; continue; }
      const link = entry.link;
      const created = await linking.link({ entityType: link.entityType, entityId: link.entityId, targetType: link.targetType, targetId: link.targetId, targetName: link.targetName, origin: link.origin, confidence: link.confidence, field: link.field, note: link.note });
      if (created && created.ok) applied.links += 1;
      else failed.push({ section: "links", ref: link.id, error: (created && created.error) || "the link could not be created" });
    }

    for (const entry of result.plan.documents) {
      if (entry.action !== "create" && entry.action !== "update") { applied.skipped += 1; continue; }
      const doc = entry.document;
      const written = await documents.upsert(entry.collection, doc);
      if (written && written.ok !== false) applied.documents += 1;
      else failed.push({ section: "documents", ref: `${entry.collection}:${doc && doc._id}`, error: (written && written.error && written.error.message) || "the document could not be written" });
    }

    for (const entry of result.plan.assets) {
      if (entry.action !== "create") { applied.skipped += 1; continue; }
      const asset = entry.asset;
      const uploaded = await files.upload({ filename: asset.filename, contentType: asset.contentType, encoding: asset.encoding, content: asset.content, refId: asset.refId, ref: asset.ref || "workflow" });
      if (uploaded && uploaded.ok !== false) applied.assets += 1;
      else failed.push({ section: "assets", ref: asset.filename, error: (uploaded && uploaded.error && uploaded.error.message) || "the file could not be uploaded" });
    }

    counters.imported += 1;
    if (failed.length) counters.failed += 1;
    lastAt = iso();
    lastError = failed.length ? failed[0].error : null;
    return { ok: failed.length === 0, dryRun: false, applied, failed, warnings, summary: result.summary, bundleId: result.bundle.id || null, name: result.bundle.name || null };
  }

  async function register(bundle) {
    stored.set(bundle.id, bundle);
    counters.published += 1;
    if (db) await db.put(collection, bundle.id, bundle);
    await prune();
    lastAt = bundle.createdAt || iso();
    return bundle;
  }

  function compareDesc(a, b) {
    return String(b.createdAt).localeCompare(String(a.createdAt)) || (b.seq || 0) - (a.seq || 0);
  }

  async function prune() {
    if (stored.size <= limit) return 0;
    const ordered = Array.from(stored.values()).sort((a, b) => -compareDesc(a, b));
    let removed = 0;
    while (stored.size > limit && ordered.length) {
      const oldest = ordered.shift();
      stored.delete(oldest.id);
      if (db) await db.remove(collection, oldest.id);
      removed += 1;
    }
    return removed;
  }

  async function exportBundle(options = {}) {
    const built = await build(options);
    if (!built.ok) return built;
    counters.exported += 1;
    if (options.publish !== false) await register(built.bundle);
    const json = JSON.stringify(built.bundle, null, 2);
    const slug = slugify(options.name || built.bundle.name) || "openrpa-bundle";
    return { ok: true, bundle: built.bundle, json, filename: `${slug}-${built.bundle.id}.json`, bytes: json.length };
  }

  function list() {
    return Array.from(stored.values()).sort(compareDesc);
  }

  function get(id) {
    return stored.get(id) || null;
  }

  function latest() {
    return list()[0] || null;
  }

  async function remove(id) {
    if (!stored.has(id)) return false;
    stored.delete(id);
    if (db) await db.remove(collection, id);
    return true;
  }

  function stats() {
    const all = list();
    return {
      total: all.length,
      built: counters.built,
      exported: counters.exported,
      imported: counters.imported,
      dryRuns: counters.dryRuns,
      published: counters.published,
      failed: counters.failed,
      lastAt,
      lastError,
      latest: all[0] ? { id: all[0].id, name: all[0].name, createdAt: all[0].createdAt, counts: all[0].counts } : null,
    };
  }

  async function hydrate() {
    if (!db) return stored.size;
    for (const record of db.all(collection)) {
      if (!record || !record.id) continue;
      stored.set(record.id, record);
    }
    return stored.size;
  }

  async function reset() {
    stored.clear();
    seqCounter = 0;
    lastAt = null;
    lastError = null;
    for (const key of Object.keys(counters)) counters[key] = 0;
    if (db) await db.clear(collection);
  }

  return {
    collection,
    format: OPENRPA_BUNDLE_FORMAT,
    version: OPENRPA_BUNDLE_VERSION,
    sections: OPENRPA_BUNDLE_SECTIONS,
    sectionLabel,
    documentCollections: OPENRPA_BUNDLE_DOCUMENT_COLLECTIONS,
    parse: parseBundle,
    sanitizeProfile,
    build,
    validate,
    plan,
    preview,
    import: importBundle,
    export: exportBundle,
    register,
    list,
    get,
    latest,
    remove,
    stats,
    hydrate,
    reset,
  };
}
