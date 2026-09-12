// src/framework/publication.js — bundle publication to the shared bus and the
// knowledge base (roadmap task 49).
//
// IT-U participates in the company's small-business pipeline: it publishes
// documentation and deployment bundles for the company's AI assistants and
// knowledge base in ONE shared envelope format. This module is the pure
// publication engine — it turns a client's documentation set into a bundle,
// applies a STRICT DEFAULT-DENY redaction posture, and validates the result
// before it is ever uploaded. The service wrapper at the bottom adds the hosted
// upload + the export log.
//
// The envelope (`PUBLICATION_SCHEMA` / `PUBLICATION_KIND`) is the shared
// contract: a downstream assistant or the knowledge base reads `records`,
// `relationships` and `sections` without knowing anything about the store.
//
// Redaction is default-deny and non-negotiable at the secrets layer:
//   • credential records (passwords) are OMITTED entirely by default — they are
//     included only as a redacted metadata SUMMARY when the operator explicitly
//     opts in, and even then `secret` / `otpSecret` are never written;
//   • private-key references on certificates are stripped, and any that slipped
//     into free text are scrubbed;
//   • PEM private-key blocks, `otpauth://…secret=…` parameters and labelled
//     secrets in prose are scrubbed wherever they appear;
//   • `publish()` RE-VALIDATES the serialized envelope and refuses to upload it
//     if `secret` / `otpSecret` fields or private-key material are present.
//
// The bundle is never mutated with live credential material: `redactForPublication`
// works on deep copies, so the client's stored documentation is untouched.

import { StoreError, CODES } from "./store/errors.js";
import { RECORD_TYPES, RECORD_TYPE_META, CLASSIFIED_TYPES } from "./docsets.js";
import { SECRET_FIELDS } from "./password.js";

export const PUBLICATION_SCHEMA = "itu-publication/1";
export const PUBLICATION_KIND = "itu-knowledge-bundle";

// The two bundle kinds the pipeline consumes.
export const BUNDLE_TYPES = [
  { id: "documentation", label: "Documentation bundle", description: "One client's whole documentation set — records, relationships, documents and runbooks." },
  { id: "deployment", label: "Deployment bundle", description: "The runbooks, checklists and related records for deploying one service or site." },
];

// Where a bundle is published for the pipeline to pick up.
export const PUBLICATION_TARGETS = [
  { id: "knowledge-base", label: "Knowledge base" },
  { id: "assistants", label: "AI assistants" },
  { id: "both", label: "Knowledge base & AI assistants" },
];

export const DEFAULT_PUBLICATION_TARGET = "both";

// The default-deny posture. `credentialSummaries` and `credentialUsernames` are
// the only deliberate opt-ins; secrets can never be opted into.
export const DEFAULT_REDACTION = {
  credentialSummaries: false,
  credentialUsernames: false,
  embeddedCredentials: false,
  scrubSecrets: true,
};

export const bundleType = (id) => BUNDLE_TYPES.find((b) => b.id === id) || null;
export const publicationTarget = (id) => PUBLICATION_TARGETS.find((t) => t.id === id) || null;
const typeLabel = (t) => (RECORD_TYPE_META[t] || {}).singular || t;

const isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v) => String(v == null ? "" : v).trim();

function clone(value) {
  if (typeof structuredClone === "function") {
    try {
      return structuredClone(value);
    } catch {
      /* fall through to JSON */
    }
  }
  return JSON.parse(JSON.stringify(value));
}

// ---- redaction --------------------------------------------------------------

// A redacted (normalized, frozen) copy of a caller-supplied redaction policy.
export function normalizeRedaction(policy) {
  const p = isObj(policy) ? policy : {};
  return {
    credentialSummaries: !!p.credentialSummaries,
    credentialUsernames: !!p.credentialUsernames,
    embeddedCredentials: !!p.embeddedCredentials,
    scrubSecrets: p.scrubSecrets === false ? false : true,
  };
}

const looksSecretish = (v) => {
  const s = str(v);
  if (s.length < 6) return false;
  if (/^(see|ref|refer|none|n\/?a|tbd|unknown|redacted|\[redacted\])/i.test(s)) return false;
  if (/:\/\//.test(s)) return false;
  return /[0-9!@#$%^&*()_+\-=[\]{};':",.<>/?\\|`~]/.test(s) || /[a-z][A-Z]|[A-Z][a-z]/.test(s);
};

// Scrub secret material out of a block of free text. Returns { text, hits }.
export function scrubText(input) {
  let text = String(input == null ? "" : input);
  let hits = 0;
  const replace = (re, repl) => {
    text = text.replace(re, (...args) => {
      hits += 1;
      return typeof repl === "function" ? repl(...args) : repl;
    });
  };
  // PEM private keys (RSA/EC/OpenSSH/PGP and friends).
  replace(/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g, "[redacted private key]");
  // otpauth enrolment URIs carry the raw TOTP secret in the query string.
  replace(/(otpauth:\/\/[^\s?#]*\?[^\s]*?\bsecret=)[A-Za-z2-7=]+/gi, (_m, prefix) => prefix + "[redacted]");
  // Labelled secrets in prose: "password: hunter2", "api key = …". The label
  // may sit anywhere on a line ("Login: password: hunter2"); the boundary keeps
  // it from matching mid-word.
  replace(
    /(^|[^A-Za-z0-9_])((?:password|passphrase|secret|private key|api[ _-]?key|token)\s*[:=]\s*)(\S{6,})(\s*)$/gim,
    (m, lead, label, value, tail) => (looksSecretish(value) ? lead + label + "[redacted]" + tail : m),
  );
  return { text, hits };
}

// Recursively scrub every string in a value (in place on a copy). Returns the
// number of scrubbed spots.
function scrubStrings(value) {
  let hits = 0;
  const walk = (node) => {
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        if (typeof node[i] === "string") {
          const r = scrubText(node[i]);
          node[i] = r.text;
          hits += r.hits;
        } else walk(node[i]);
      }
    } else if (isObj(node)) {
      for (const k of Object.keys(node)) {
        if (typeof node[k] === "string") {
          const r = scrubText(node[k]);
          node[k] = r.text;
          hits += r.hits;
        } else walk(node[k]);
      }
    }
  };
  walk(value);
  return hits;
}

// Redact ONE record. Returns { record, redactions } when kept or
// { omitted: reason } when withheld. Never mutates the input.
export function redactRecord(type, record, policy) {
  const p = normalizeRedaction(policy);
  if (!record || typeof record !== "object") return { omitted: "malformed" };

  if (type === "passwords") {
    if (!p.credentialSummaries) return { omitted: "credential" };
    if (record.scope === "embedded" && !p.embeddedCredentials) return { omitted: "embedded-credential" };
    const out = {
      id: record.id,
      type: record.type || "passwords",
      name: record.name,
      category: record.category || "",
      scope: record.scope || "general",
      informationModel: record.informationModel || "core-asset",
      provenance: record.provenance || "authored",
      rotation: record.rotation || "",
    };
    if (p.credentialUsernames && record.username) out.username = record.username;
    return { record: out, redactions: ["credential-summary"] };
  }

  const out = clone(record);
  const redactions = [];
  if (type === "certificates" && out.privateKeyRef) {
    delete out.privateKeyRef;
    redactions.push("private-key-ref");
  }
  // Strip any inline secret fields defensively (password records are handled
  // above, but a shape could carry them elsewhere).
  for (const f of SECRET_FIELDS) {
    if (out[f] != null && out[f] !== "") {
      delete out[f];
      redactions.push("secret-field");
    }
  }
  if (p.scrubSecrets) {
    const hits = scrubStrings(out);
    if (hits) redactions.push("scrubbed-text");
  }
  return { record: out, redactions };
}

// Redact a whole documentation set. `opts.include` (optional) is a Set of
// "type::id" keys limiting which records participate (used by the deployment
// bundle); relationships are kept only when BOTH endpoints survive.
export function redactForPublication(set, policy, opts = {}) {
  const p = normalizeRedaction(policy);
  const include = opts.include && typeof opts.include.has === "function" ? opts.include : null;
  const records = {};
  const omitted = [];
  const keptKeys = new Set();

  for (const type of RECORD_TYPES) {
    if (type === "relationships") continue;
    const list = Array.isArray(set && set.records && set.records[type]) ? set.records[type] : [];
    const kept = [];
    for (const rec of list) {
      const key = type + "::" + (rec && rec.id);
      if (include && !include.has(key)) continue;
      const res = redactRecord(type, rec, p);
      if (res.record) {
        kept.push(res.record);
        keptKeys.add(key);
      } else if (res.omitted) {
        omitted.push({ type, id: rec && rec.id, name: rec && rec.name, reason: res.omitted });
      }
    }
    if (kept.length) records[type] = kept;
  }

  const relationships = [];
  for (const rel of (set && set.records && set.records.relationships) || []) {
    const from = rel && rel.from;
    const to = rel && rel.to;
    if (!from || !to) continue;
    if (!keptKeys.has(from.type + "::" + from.id) || !keptKeys.has(to.type + "::" + to.id)) {
      omitted.push({ type: "relationships", id: rel.id, name: from.name + " → " + to.name, reason: "endpoint-withheld" });
      continue;
    }
    const copy = clone(rel);
    if (p.scrubSecrets) scrubStrings(copy);
    relationships.push(copy);
  }

  // Aggregate what was withheld (no names — the bundle is a public artifact).
  const agg = new Map();
  for (const o of omitted) {
    const k = o.type + "|" + o.reason;
    agg.set(k, (agg.get(k) || 0) + 1);
  }
  const withheld = [...agg.entries()].map(([k, count]) => {
    const [type, reason] = k.split("|");
    return { type, reason, count };
  });

  return { records, relationships, omitted, withheld };
}

// ---- section building -------------------------------------------------------

function neighborRefs(set, ref) {
  const out = [];
  if (!ref) return out;
  for (const rel of (set && set.records && set.records.relationships) || []) {
    if (rel.from && rel.from.type === ref.type && rel.from.id === ref.id) out.push(rel.to);
    else if (rel.to && rel.to.type === ref.type && rel.to.id === ref.id) out.push(rel.from);
  }
  return out.filter(Boolean);
}

const keyOf = (ref) => (ref && ref.type && ref.id ? ref.type + "::" + ref.id : null);

function inventoryText(records) {
  const lines = [];
  for (const type of RECORD_TYPES) {
    if (type === "relationships") continue;
    const list = records[type];
    if (!list || !list.length) continue;
    lines.push("### " + typeLabel(type) + " (" + list.length + ")");
    lines.push("");
    for (const r of list) lines.push("- " + (r.name || r.id));
    lines.push("");
  }
  return lines.join("\n").trim();
}

function clientSummaryText(set, records, policy) {
  const lines = [];
  lines.push("**Client:** " + (set.name || set.id));
  const org = (records.organizations || [])[0];
  if (org) {
    if (org.website) lines.push("**Website:** " + org.website);
    if (org.phone) lines.push("**Phone:** " + org.phone);
    if (org.address) lines.push("**Address:** " + org.address);
  }
  const counts = RECORD_TYPES.filter((t) => t !== "relationships" && records[t] && records[t].length).map((t) => (records[t].length + " " + typeLabel(t).toLowerCase() + (records[t].length === 1 ? "" : "s")));
  lines.push("");
  lines.push("**Contents:** " + (counts.length ? counts.join(", ") : "no records"));
  if (!policy.credentialSummaries) {
    lines.push("");
    lines.push("_Credential material is withheld from this bundle by default-deny publication rules._");
  }
  return lines.join("\n");
}

function documentSections(records) {
  const sections = [];
  for (const doc of records.documents || []) {
    if (!str(doc.body)) continue;
    sections.push({ id: "document-" + doc.id, heading: doc.name, kind: "document", refType: "documents", refId: doc.id, docType: doc.docType || "", text: scrubText(doc.body).text });
  }
  for (const rb of records.runbooks || []) {
    if (!str(rb.body)) continue;
    sections.push({ id: "runbook-" + rb.id, heading: rb.name, kind: "runbook", refType: "runbooks", refId: rb.id, runbookType: rb.runbookType || "", text: scrubText(rb.body).text });
  }
  for (const cl of records.checklists || []) {
    const steps = (cl.items || []).map((it, i) => (i + 1) + ". [" + (it.done ? "x" : " ") + "] " + (it.text || "")).join("\n");
    if (!steps) continue;
    sections.push({ id: "checklist-" + cl.id, heading: cl.name, kind: "checklist", refType: "checklists", refId: cl.id, text: steps });
  }
  return sections;
}

// ---- envelope assembly ------------------------------------------------------

function makeEnvelope({ set, bundleType: bt, title, summary, target, policy, red, records, relationships, sections, createdBy, now, generatorName, extraClient }) {
  const counts = {
    records: CLASSIFIED_TYPES.reduce((n, t) => n + ((records[t] || []).length), 0),
    relationships: relationships.length,
    documents: (records.documents || []).length,
    runbooks: (records.runbooks || []).length,
    checklists: (records.checklists || []).length,
    sections: sections.length,
  };
  const includedTypes = RECORD_TYPES.filter((t) => t !== "relationships" && records[t] && records[t].length);
  return {
    schema: PUBLICATION_SCHEMA,
    kind: PUBLICATION_KIND,
    bundleType: bt,
    title,
    summary,
    generatedAt: now,
    createdBy,
    app: { name: "IT-U", generator: generatorName || null },
    client: extraClient || { id: set.id, name: set.name || set.id },
    target: target || DEFAULT_PUBLICATION_TARGET,
    redaction: {
      policy: { ...policy },
      enforced: ["never-secrets", "never-private-keys"],
      includedTypes,
      withheld: red.withheld,
      withheldTotal: red.omitted.length,
    },
    counts,
    records,
    relationships,
    sections,
  };
}

// Build a DOCUMENTATION bundle: one client's whole set.
export function buildDocumentationBundle(set, opts = {}) {
  const policy = normalizeRedaction(opts.policy);
  const red = redactForPublication(set, policy);
  const sections = [];
  sections.push({ id: "overview", heading: "Client overview", kind: "summary", refType: null, refId: null, text: clientSummaryText(set, red.records, policy) });
  const inv = inventoryText(red.records);
  if (inv) sections.push({ id: "inventory", heading: "Inventory", kind: "inventory", refType: null, refId: null, text: inv });
  sections.push(...documentSections(red.records));
  return makeEnvelope({
    set,
    bundleType: "documentation",
    title: opts.title || (set.name || set.id) + " — documentation bundle",
    summary: opts.summary || ("Documentation bundle for " + (set.name || set.id) + "."),
    target: opts.target,
    policy,
    red,
    records: red.records,
    relationships: red.relationships,
    sections,
    createdBy: opts.createdBy || "system",
    now: opts.now != null ? opts.now : Date.now(),
    generatorName: opts.generatorName,
  });
}

// Build a DEPLOYMENT bundle: the runbooks, checklists and related records for
// one service or site. `opts.serviceRef` / `opts.siteRef` select by matching a
// runbook's service/site (and the checklists linked to them); `opts.runbookIds`
// / `opts.checklistIds` select explicitly.
export function buildDeploymentBundle(set, opts = {}) {
  const policy = normalizeRedaction(opts.policy);
  const serviceRef = opts.serviceRef || null;
  const siteRef = opts.siteRef || null;
  const runbookIds = new Set((opts.runbookIds || []).filter(Boolean));
  const checklistIds = new Set((opts.checklistIds || []).filter(Boolean));

  const matches = (rb) => {
    if (runbookIds.has(rb.id)) return true;
    if (serviceRef && rb.service && rb.service.type === serviceRef.type && rb.service.id === serviceRef.id) return true;
    if (siteRef && rb.site && rb.site.type === siteRef.type && rb.site.id === siteRef.id) return true;
    return false;
  };
  const runbooks = (((set && set.records && set.records.runbooks) || []).filter(matches));

  // The relationship graph around the chosen anchors decides which records the
  // deployment bundle carries.
  const include = new Set();
  const anchors = [];
  if (serviceRef) anchors.push(serviceRef);
  if (siteRef) anchors.push(siteRef);
  for (const a of anchors) include.add(keyOf(a));
  for (const a of anchors) for (const n of neighborRefs(set, a)) if (keyOf(n)) include.add(keyOf(n));
  for (const rb of runbooks) {
    include.add(keyOf({ type: "runbooks", id: rb.id }));
    for (const n of neighborRefs(set, { type: "runbooks", id: rb.id })) if (keyOf(n)) include.add(keyOf(n));
    if (rb.service) include.add(keyOf(rb.service));
    if (rb.site) include.add(keyOf(rb.site));
  }
  // Checklists: explicit ids, or linked to an anchor.
  const checklists = ((set && set.records && set.records.checklists) || []).filter((cl) => {
    if (checklistIds.has(cl.id)) return true;
    return anchors.some((a) => neighborRefs(set, a).some((n) => n.type === "checklists" && n.id === cl.id));
  });
  for (const cl of checklists) {
    include.add(keyOf({ type: "checklists", id: cl.id }));
    for (const n of neighborRefs(set, { type: "checklists", id: cl.id })) if (keyOf(n)) include.add(keyOf(n));
  }
  // Always carry the client organization for context.
  for (const org of (set && set.records && set.records.organizations) || []) include.add(keyOf({ type: "organizations", id: org.id }));

  // Redact only the included records, then drop the ones that were omitted
  // anyway (so an unselected credential never appears).
  const red = redactForPublication(set, policy, { include });
  const sections = [];
  const service = serviceRef ? (((set.records || {})[serviceRef.type] || []).find((r) => r.id === serviceRef.id)) : null;
  const scopeLine = service
    ? "**Service:** " + (service.name || serviceRef.id)
    : siteRef
      ? "**Site:** " + ((siteRef.name || siteRef.id) || siteRef.id)
      : "**Deployment bundle**";
  sections.push({ id: "overview", heading: "Deployment overview", kind: "summary", refType: null, refId: null, text: [scopeLine, "", "**Runbooks:** " + (runbooks.length || "none"), "**Checklists:** " + (checklists.length || "none")].join("\n") });
  for (const rb of runbooks) {
    if (!str(rb.body)) continue;
    sections.push({ id: "runbook-" + rb.id, heading: rb.name, kind: "runbook", refType: "runbooks", refId: rb.id, runbookType: rb.runbookType || "", text: scrubText(rb.body).text });
  }
  for (const cl of checklists) {
    const steps = (cl.items || []).map((it, i) => (i + 1) + ". [" + (it.done ? "x" : " ") + "] " + (it.text || "")).join("\n");
    sections.push({ id: "checklist-" + cl.id, heading: cl.name, kind: "checklist", refType: "checklists", refId: cl.id, text: steps });
  }
  const inv = inventoryText(red.records);
  if (inv) sections.push({ id: "related", heading: "Related records", kind: "inventory", refType: null, refId: null, text: inv });

  const label = service ? service.name : siteRef && siteRef.name ? siteRef.name : "deployment";
  return makeEnvelope({
    set,
    bundleType: "deployment",
    title: opts.title || (set.name || set.id) + " — " + label + " deployment bundle",
    summary: opts.summary || ("Deployment bundle for " + label + " at " + (set.name || set.id) + "."),
    target: opts.target,
    policy,
    red,
    records: red.records,
    relationships: red.relationships,
    sections,
    createdBy: opts.createdBy || "system",
    now: opts.now != null ? opts.now : Date.now(),
    generatorName: opts.generatorName,
  });
}

// ---- serialize / validate ---------------------------------------------------

export function serializePublication(envelope) {
  return JSON.stringify(envelope, null, 2);
}

// Walk a value looking for secret fields and private-key material. Returns a
// list of { path, reason } leaks.
export function findLeakedSecrets(value, path = "") {
  const out = [];
  if (Array.isArray(value)) {
    value.forEach((v, i) => out.push(...findLeakedSecrets(v, path + "[" + i + "]")));
  } else if (isObj(value)) {
    for (const [k, v] of Object.entries(value)) {
      if (SECRET_FIELDS.includes(k) && v != null && v !== "") out.push({ path: path + "." + k, reason: "secret-field" });
      out.push(...findLeakedSecrets(v, path + "." + k));
    }
  } else if (typeof value === "string") {
    if (/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/.test(value)) out.push({ path, reason: "private-key" });
    if (/otpauth:\/\/[^\s?#]*\?[^\s]*?\bsecret=[A-Za-z2-7=]{4,}/i.test(value)) out.push({ path, reason: "otp-secret-uri" });
  }
  return out;
}

const parse = (input) => {
  if (typeof input === "string") {
    try {
      return { value: JSON.parse(input), error: null };
    } catch {
      return { value: null, error: "This does not look like a publication bundle — it could not be parsed as JSON." };
    }
  }
  if (isObj(input)) return { value: input, error: null };
  return { value: null, error: "A publication bundle must be a JSON object or a JSON string." };
};

// Validate a bundle BEFORE it is published. Never throws. The secret scan is
// the default-deny guarantee: a bundle carrying secret fields or private-key
// material is refused, whatever built it.
export function validatePublication(input) {
  const errors = [];
  const warnings = [];
  const { value, error } = parse(input);
  if (error) return { ok: false, errors: [error], warnings, summary: null, leaks: [] };
  const env = value;
  if (!isObj(env)) return { ok: false, errors: ["A publication bundle must be a JSON object."], warnings, summary: null, leaks: [] };
  if (env.schema !== PUBLICATION_SCHEMA) errors.push(`Unsupported publication schema “${env.schema || "(missing)"}” — expected “${PUBLICATION_SCHEMA}”.`);
  if (env.kind !== PUBLICATION_KIND) errors.push(`Unsupported bundle kind “${env.kind || "(missing)"}” — expected “${PUBLICATION_KIND}”.`);
  if (!bundleType(env.bundleType)) errors.push(`Unknown bundle type “${env.bundleType || "(missing)"}”.`);
  if (!isObj(env.client)) warnings.push("The bundle has no `client` block.");
  if (!Array.isArray(env.sections)) warnings.push("The bundle has no `sections` array.");
  const leaks = findLeakedSecrets(env);
  if (leaks.length) errors.push(`${leaks.length} secret field(s) or private-key material found — the bundle is refused. First: ${leaks[0].path} (${leaks[0].reason}).`);
  const counts = isObj(env.counts) ? env.counts : {};
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    leaks,
    summary: { bundleType: env.bundleType, client: isObj(env.client) ? env.client.name : null, records: counts.records || 0, relationships: counts.relationships || 0, sections: (env.sections || []).length, target: env.target || null },
  };
}

const slugify = (s) =>
  str(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "bundle";

export function publicationFilename(envelope, extension = "json") {
  const at = new Date((envelope && envelope.generatedAt) || Date.now());
  const stamp = (Number.isNaN(at.getTime()) ? new Date() : at).toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const who = envelope && envelope.client && envelope.client.name;
  return "itu-" + ((envelope && envelope.bundleType) || "bundle") + "-" + slugify(who || (envelope && envelope.title)) + "-" + stamp + "." + extension;
}

export function bundleSummaryLine(envelope) {
  const c = (envelope && envelope.counts) || {};
  const plural = (n, w) => n + " " + w + (n === 1 ? "" : "s");
  const client = envelope && envelope.client && envelope.client.name ? " — " + envelope.client.name : "";
  return (bundleType(envelope && envelope.bundleType) || { label: "Bundle" }).label + client + ": " + plural(c.records || 0, "record") + ", " + plural(c.relationships || 0, "relationship") + ", " + plural(c.sections || 0, "section");
}

// A human list of what the redaction withheld (for the operator preview only —
// never part of the published envelope).
export function withheldSummary(withheld) {
  const list = Array.isArray(withheld) ? withheld : [];
  if (!list.length) return "Nothing withheld — the bundle contains no credential records.";
  return list.map((w) => w.count + " × " + typeLabel(w.type) + " (" + w.reason.replace(/-/g, " ") + ")").join("; ");
}

// ---- the service (hosted upload + export log) -------------------------------

export const PUBLICATION_LOG_KEY = "publication::log";

export function createPublicationService({
  store,
  cache,
  upload = null,
  generatorName = null,
  now = () => Date.now(),
  prefix = "docset-",
  logKey = PUBLICATION_LOG_KEY,
  maxLog = 50,
} = {}) {
  const cacheGet = async (k) => {
    try {
      return await cache.get(k);
    } catch {
      return undefined;
    }
  };
  const cacheSet = async (k, v) => {
    try {
      await cache.set(k, v);
    } catch {}
  };

  const isSetId = (id) => typeof id === "string" && id.startsWith(prefix);

  async function loadSet(clientId) {
    if (!isSetId(clientId)) throw new StoreError(CODES.INVALID_DATA, `“${clientId}” is not a documentation set id.`);
    const doc = await store.readDocument(clientId, { force: true }).catch(() => null);
    if (!doc) throw new StoreError(CODES.UNKNOWN_RECORD, `The documentation set “${clientId}” could not be loaded.`);
    return doc.data;
  }

  // Build (but do not publish) a documentation bundle for one client.
  async function buildDocumentation({ clientId, title, summary, target, policy, createdBy = "system" } = {}) {
    const set = await loadSet(clientId);
    const envelope = buildDocumentationBundle(set, { title, summary, target, policy, createdBy, now: now(), generatorName });
    return { envelope, omitted: withheldSummary(envelope.redaction.withheld), warnings: validatePublication(envelope).warnings };
  }

  // Build (but do not publish) a deployment bundle.
  async function buildDeployment({ clientId, serviceRef, siteRef, runbookIds, checklistIds, title, summary, target, policy, createdBy = "system" } = {}) {
    const set = await loadSet(clientId);
    const envelope = buildDeploymentBundle(set, { serviceRef, siteRef, runbookIds, checklistIds, title, summary, target, policy, createdBy, now: now(), generatorName });
    return { envelope, omitted: withheldSummary(envelope.redaction.withheld), warnings: validatePublication(envelope).warnings };
  }

  // Publish a built envelope: validate, upload, and record the export log.
  async function publish(envelope, { createdBy = "system", note = "", target = null, expires = null } = {}) {
    const report = validatePublication(envelope);
    if (!report.ok) {
      const err = new StoreError(CODES.INVALID_DATA, "This bundle was refused and not published: " + report.errors.slice(0, 2).join(" "));
      err.errors = report.errors;
      err.leaks = report.leaks;
      throw err;
    }
    if (!upload) {
      throw new StoreError(CODES.STORAGE_UNAVAILABLE, "Publishing needs the generator to be saved (upload plugin unavailable).");
    }
    if (target) envelope.target = target;
    const text = serializePublication(envelope);
    const res = await upload(text, expires ? { expires } : {});
    if (!res || !res.url) {
      throw new StoreError(CODES.STORAGE_UNAVAILABLE, res && res.error ? `Publish failed: ${res.error}` : "Publish failed.");
    }
    const entry = {
      id: "pub_" + Math.random().toString(36).slice(2, 10) + now().toString(36),
      at: now(),
      bundleType: envelope.bundleType,
      title: envelope.title,
      clientId: envelope.client && envelope.client.id,
      clientName: envelope.client && envelope.client.name,
      target: envelope.target || DEFAULT_PUBLICATION_TARGET,
      url: res.url,
      bytes: new TextEncoder().encode(text).length,
      counts: envelope.counts || {},
      redaction: { policy: envelope.redaction.policy, withheldTotal: envelope.redaction.withheldTotal, withheld: envelope.redaction.withheld },
      schema: envelope.schema,
      kind: envelope.kind,
      createdBy: createdBy || envelope.createdBy,
      note,
    };
    const list = (await cacheGet(logKey)) || [];
    list.unshift(entry);
    await cacheSet(logKey, list.slice(0, maxLog));
    return entry;
  }

  async function listLog() {
    const list = (await cacheGet(logKey)) || [];
    return Array.isArray(list) ? list : [];
  }

  async function removeLogEntry(id) {
    const list = (await cacheGet(logKey)) || [];
    const next = list.filter((e) => e.id !== id);
    await cacheSet(logKey, next);
    return next;
  }

  async function clearLog() {
    await cacheSet(logKey, []);
    return [];
  }

  return {
    buildDocumentation,
    buildDeployment,
    publish,
    listLog,
    removeLogEntry,
    clearLog,
    loadSet,
  };
}
