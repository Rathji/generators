// src/framework/playbook.js — the IT-U playbook (roadmap task 53).
//
// Documentation is code-adjacent here: the content model lives in catalogs
// spread across `src/framework`, and a contributor who adds an asset type, a
// template, a service runbook or an export has to touch a known set of them.
// This module is the single source for that guidance. It is:
//
//   • rendered in the app (the Settings → Playbook & reference card);
//   • rendered as a human document (`playbookToMarkdown()` is the generator for
//     `src/PLAYBOOK.md` — regenerate that file whenever this one changes);
//   • checked against the live catalogs by `src/tests/playbook.test.js`, so the
//     documentation cannot silently drift away from the code it describes.
//
// The catalog-derived parts read the real engines (`classification.js`,
// `docsets.js`, `relationships.js`, `runbook.js`, `publication.js`,
// `packet.js`) rather than restating them, so a rename in code surfaces here as
// a test failure instead of a stale sentence.

import { INFORMATION_MODELS, PROVENANCE } from "./classification.js";
import { RECORD_TYPES, RECORD_TYPE_META } from "./docsets.js";
import { RELATIONSHIP_KINDS } from "./relationships.js";
import { RUNBOOK_TYPES } from "./runbook.js";
import { BUNDLE_TYPES } from "./publication.js";
import { PACKET_KINDS } from "./packet.js";

export const PLAYBOOK_SCHEMA = "itu-playbook/1";

// ---------------------------------------------------------------------------
// The information model
// ---------------------------------------------------------------------------
// Which model a record belongs to decides how it is authored: a Core Asset is
// a fixed, IT-U-defined shape (a form the user fills in); a Flexible Asset is a
// structured record shaped by a template from the shared library; a Document is
// long-form authoring; an integration-managed record is kept in step by an
// external system of record. The curated `recordTypes` list is what the README
// teaches; the `label`/`description` are read live from classification.js.
const INFORMATION_MODEL_RECORD_TYPES = {
  "core-asset": ["organizations", "locations", "contacts", "configurations", "passwords", "trackers", "domains", "certificates"],
  "flexible-asset": ["flexibleAssets"],
  document: ["documents", "checklists", "sites", "diagrams", "runbooks"],
  integration: ["flexibleAssets", "configurations", "domains", "certificates"],
};

export function contentModelReference() {
  return INFORMATION_MODELS.map((m) => ({
    id: m.id,
    label: m.label,
    short: m.short,
    description: m.description,
    recordTypes: (INFORMATION_MODEL_RECORD_TYPES[m.id] || []).slice(),
    recordLabels: (INFORMATION_MODEL_RECORD_TYPES[m.id] || []).map((t) => (RECORD_TYPE_META[t] || {}).label || t),
  }));
}

export function provenanceReference() {
  return PROVENANCE.map((p) => ({
    id: p.id,
    label: p.label,
    short: p.short,
    description: p.description,
    requires: (p.requires || []).slice(),
    requireLabel: p.requireLabel || "",
  }));
}

// ---------------------------------------------------------------------------
// Relationship conventions
// ---------------------------------------------------------------------------
export function relationshipReference() {
  const kinds = RELATIONSHIP_KINDS.map((k) => ({ id: k.id, label: k.label, from: k.from.slice(), to: k.to.slice() }));
  const collections = new Set();
  for (const k of kinds) for (const c of [...k.from, ...k.to]) collections.add(c);
  return { kinds, kindCount: kinds.length, collectionCount: collections.size, collections: [...collections].sort() };
}

export const RELATIONSHIP_CONVENTIONS = [
  {
    title: "Express a fact once, as a link",
    detail:
      "Relationship records are first-class typed links stored in `records.relationships` as `{ id, type: \"relationships\", kind, from: { type, id }, to: { type, id } }`. Never re-type the same fact into two records — link them.",
  },
  {
    title: "Every kind declares its endpoints",
    detail:
      "`RELATIONSHIP_KINDS` in `relationships.js` lists, per kind, the collections a link may start from and point at. A link is refused unless both ends match a known kind, which is what keeps the graph queryable and the exports meaningful.",
  },
  {
    title: "Read both directions, store one",
    detail:
      "`relationsOf(record)` reports a record's links in both directions, so \"server → its applications\" and \"application → its server\" are the same single link read two ways.",
  },
  {
    title: "One link, no duplicates, no self-links",
    detail:
      "The engine refuses duplicate links and self-links, cascades a record's links away when it is deleted, and audits the whole graph (`checkIntegrity`) for dangling endpoints, unknown kinds and duplicates.",
  },
  {
    title: "Labels for humans, kinds for code",
    detail:
      "A Flexible Asset shares one record collection, so `assetRelations.js` declares labelled GROUPS (backed by one or more kinds) that the asset profile renders as \"Servers & workstations\", \"Credentials\", \"Vendor\" and so on.",
  },
];

// ---------------------------------------------------------------------------
// Deployment documentation
// ---------------------------------------------------------------------------
// How a service's deployment documentation is assembled end to end, from the
// structured service record a technician authors, to the runbook that a
// different technician can execute, to the packet/bundle a consumer reads.
export const DEPLOYMENT_FLOW = [
  {
    title: "1. Model the service as a structured record",
    detail:
      "A VoIP/PBX deployment starts from a Voice/PBX service record; a resold internet service starts from an Internet/WAN circuit record. Both are Flexible Assets with a curated field set (platform, transport, capacity, addressing, SLA) plus relationship buckets for the configurations, credentials, vendor, licensing and people around them.",
    files: ["./framework/voice.js", "./framework/circuit.js", "./framework/assetLibrary.js"],
  },
  {
    title: "2. Assemble the deployment runbook",
    detail:
      "`RUNBOOK_TYPES` declares the runbooks (grouped VoIP / Internet / General) and `generateVoipRunbook` seeds a full draft from the service record — section by section — so a technician who did not design the deployment can execute it. Each runbook carries revisions and a review status.",
    files: ["./framework/runbook.js"],
  },
  {
    title: "3. Pair it with a cutover checklist",
    detail:
      "`cutover.js` defines the phased pre-deployment / cutover / post-cutover checklist (port verification, test calls, failover, emergency-call test, rollback) with per-item completion, assignment and a recorded acceptance/sign-off.",
    files: ["./framework/cutover.js"],
  },
  {
    title: "4. Cover the links and the lifecycle",
    detail:
      "`voipCoverage.js` (and the circuit equivalents) audits that every handset, credential, trunk, subscription, vendor and date is captured and linked, and the trackers/`lifecycle.js` keep the expiry and renewal dates visible.",
    files: ["./framework/voipCoverage.js", "./framework/lifecycle.js"],
  },
  {
    title: "5. Publish it",
    detail:
      "`packet.js` renders the deployment packet (the runbooks, checklists and related records for one site/service) as markdown, HTML and a self-contained printable HTML; `publication.js` emits the machine-readable deployment bundle for the AI assistants and knowledge base. Both inherit the same default-deny redaction.",
    files: ["./framework/packet.js", "./framework/publication.js"],
  },
];

// ---------------------------------------------------------------------------
// Publication envelope & redaction
// ---------------------------------------------------------------------------
export const REDACTION_RULES = [
  {
    title: "One shared envelope",
    detail:
      "`publication.js` defines `PUBLICATION_SCHEMA` (`itu-publication/1`, kind `itu-knowledge-bundle`) holding `records`, `relationships` and `sections`, so a downstream assistant reads a bundle without knowing anything about the store.",
  },
  {
    title: "Default-deny credentials",
    detail:
      "`redactRecord` OMITS credential records entirely unless the operator explicitly opts into a metadata-only summary; even then `secret` / `otpSecret` are never written and usernames are withheld unless requested. Embedded credentials stay out unless opted in.",
  },
  {
    title: "Scrub prose",
    detail:
      "`scrubText` removes PEM blocks, `otpauth://…secret=…` parameters and labelled secrets from free text, while leaving genuine cross-references (\"password: see the credential record\") alone. Private-key references on certificates are stripped.",
  },
  {
    title: "Links only survive whole",
    detail:
      "`redactForPublication` works on deep copies, keeps a relationship only when BOTH endpoints survive, and aggregates what was withheld by type and reason (never by name).",
  },
  {
    title: "Refuse a leaky bundle",
    detail:
      "`validatePublication` re-scans any envelope for secret fields and private-key material and REFUSES a leaky bundle whatever built it; `findLeakedSecrets` is the same scan the integrity suite runs on every export.",
  },
];

// ---------------------------------------------------------------------------
// Extension guides — the playbook proper
// ---------------------------------------------------------------------------
// Each guide is an ordered checklist for one extension point. Steps reference
// the real files a contributor must touch, so this doubles as the review
// checklist for a change.

export const EXTENSION_KINDS = [
  { id: "asset-type", label: "A new asset type (Core Asset)", oneLine: "A fixed, standardized record type with its own station collection, field schema and audit rule." },
  { id: "template", label: "A new template (Flexible Asset)", oneLine: "A customizable structured record defined by a template in the shared library." },
  { id: "runbook", label: "A new service runbook", oneLine: "A deployment runbook (VoIP / Internet / General) with its checklist and lifecycle coverage." },
  { id: "export", label: "A new export", oneLine: "A publication bundle or printable packet kind for the assistants, knowledge base and clients." },
];

const EXTENSION_GUIDES = {
  "asset-type": {
    id: "asset-type",
    label: "A new asset type (Core Asset)",
    intro:
      "A Core Asset is a standardized record type: IT-U fixes its shape, the user fills in a form, and every export and audit knows the fields by name. Add one only for a concept the whole product should understand identically (a configuration, a domain, an SSL certificate, a runbook).",
    steps: [
      { title: "Declare the collection", detail: "Add the record type to `RECORD_TYPES` and give it a `RECORD_TYPE_META` entry (label, singular, icon). It is thereby classified (all types except `relationships` are).", files: ["./framework/docsets.js"] },
      { title: "Define the field schema", detail: "Add a `<TYPE>_FIELDS` schema in its own vocabulary module and register it in `RECORD_FIELD_SCHEMAS`; `STANDARDIZED_TYPES` then includes it automatically.", files: ["./framework/standardized.js"] },
      { title: "Write the validation rule", detail: "Add the type's branch to `validateRecordFields` (required fields, catalog membership) and an `*Issues(set)` audit that the Linter unions in.", files: ["./framework/standardized.js", "./framework/linter.js"] },
      { title: "Add relationships", detail: "Add any new typed links to `RELATIONSHIP_KINDS` (declaring their `from`/`to` collections) so the type can be linked rather than duplicated.", files: ["./framework/relationships.js"] },
      { title: "Surface it", detail: "The Assets station renders schema-driven forms via `asset-fields.js`/`asset-profile.js`; add a dedicated view only if the type needs bespoke interaction (as sites, diagrams and trackers do).", files: ["./modules/asset-fields.js", "./modules/asset-profile.js"] },
      { title: "Export & fixture it", detail: "Confirm the type appears in the documentation bundle/packet inventory and add it to the integrity fixtures if it carries special rules.", files: ["./framework/publication.js", "./framework/packet.js", "./framework/fixtures.js"] },
      { title: "Test it", detail: "Add a suite under `src/tests/` covering the schema, the required-field rule, the relationship kinds and a round-trip through the store.", files: ["./tests/docsets.test.js"] },
    ],
  },
  template: {
    id: "template",
    label: "A new template (Flexible Asset)",
    intro:
      "A Flexible Asset is a structured record shaped by a template from the ONE shared library (`flexibleTypes.js`), so a house standard is defined once and reused across every client. Most new asset concepts arriving in a phase should be a template, not a Core Asset.",
    steps: [
      { title: "Author the template", detail: "Add a `tpl(id, name, category, icon, description, references, fields)` entry to `BUILTIN_ASSET_TYPES`. Keep field keys stable — records, exports and tests depend on them; field types and options come from `flexible.js`.", files: ["./framework/assetLibrary.js", "./framework/flexible.js"] },
      { title: "Add any option catalogs", detail: "If the template selects from a domain vocabulary (platforms, protocols, deployment models), add the `<domain>.js` options module rather than inlining labels in the template.", files: ["./framework/email.js", "./framework/network.js", "./framework/voice.js"] },
      { title: "Declare relationship groups", detail: "Add a `RELATION_GROUPS[\"atype-…\"]` entry so the asset profile shows labelled buckets (Servers, Credentials, Vendor, Licensing, Documents, People) instead of one flat link list; add any new kinds to `RELATIONSHIP_KINDS`.", files: ["./framework/assetRelations.js", "./framework/relationships.js"] },
      { title: "Wire the lifecycle", detail: "Mark expiry-bearing fields `expiry: true` so `renewals.js`/`lifecycle.js` surface them on the renewals board and the expiry workflow.", files: ["./framework/renewals.js", "./framework/lifecycle.js"] },
      { title: "Add a coverage audit", detail: "If the template is a *service* (email, backup, network, security, voice, circuit), add a `*Coverage.js` auditor that checks the client documented it fully — that it is what turns a pile of records into an audited deployment.", files: ["./framework/voipCoverage.js", "./framework/serviceAssets.js"] },
      { title: "Check the library", detail: "The library re-adds any missing builtin on load (`restoreLibrary`); bump nothing by hand. Verify the template appears in the designer/library and can be cloned and reset.", files: ["./framework/flexibleTypes.js", "./modules/templates-view.js"] },
      { title: "Test it", detail: "Add a suite covering the template's fields/references, its relationship groups and its coverage audit; re-run the full sweep.", files: ["./tests/flexible.test.js", "./tests/structured-assets.test.js"] },
    ],
  },
  runbook: {
    id: "runbook",
    label: "A new service runbook",
    intro:
      "A runbook is the executable form of a service deployment — written so a technician who did not design it can run it. It is a Document whose sections, statuses and revisions are managed by `runbook.js`, paired with a cutover checklist and lifecycle coverage.",
    steps: [
      { title: "Declare the runbook type", detail: "Add a `RUNBOOK_TYPES` entry with its `group` (VoIP / Internet / General) and section list; reuse `VOIP_RUNBOOK_SECTIONS` as the pattern for a new group's sections.", files: ["./framework/runbook.js"] },
      { title: "Write the generator", detail: "Add a `generate*Runbook({ … })` that seeds the draft section by section from the service record (platform, transport, addressing, failover, tests), so the draft is never empty.", files: ["./framework/runbook.js"] },
      { title: "Define the cutover checklist", detail: "Add the phased checklist definition (pre-deployment / cutover / post-cutover), its acceptance and its sign-off, so the runbook has a matching execution record.", files: ["./framework/cutover.js"] },
      { title: "Cover the links & lifecycle", detail: "Add or extend the `*Coverage.js` audit so every device, credential, trunk, subscription, vendor and date the runbook relies on is linked and lifecycle-aware.", files: ["./framework/voipCoverage.js"] },
      { title: "Make it issuable", detail: "Confirm the runbook is included by `buildDeploymentBundle`/`buildDeploymentPacket` for its service/site scope and renders in the printable packet.", files: ["./framework/publication.js", "./framework/packet.js"] },
      { title: "Give it an editor", detail: "The runbook editor modal (`runbook-view.js`) is generic over `RUNBOOK_TYPES`; verify the new type opens, edits, revises and reviews.", files: ["./modules/runbook-view.js"] },
      { title: "Test it", detail: "Add a suite covering generator output, the cutover phases, coverage and the issues audit.", files: ["./tests/runbook.test.js", "./tests/cutover.test.js"] },
    ],
  },
  export: {
    id: "export",
    label: "A new export",
    intro:
      "An export is either a machine-readable publication bundle for the assistants/knowledge base, or a human-facing packet/printable for a client or field technician. Both are built on the same redaction so a new export cannot leak credentials.",
    steps: [
      { title: "Declare the kind", detail: "Add to `BUNDLE_TYPES` (publication.js) and/or `PACKET_KINDS` (packet.js) with a label and description; the existing builders switch on the kind.", files: ["./framework/publication.js", "./framework/packet.js"] },
      { title: "Assemble the content", detail: "Add a `build*Bundle` / `build*Packet` that selects the records, relationships and sections for the kind, built on `redactForPublication` so it inherits default-deny.", files: ["./framework/publication.js", "./framework/packet.js"] },
      { title: "Render it", detail: "Provide markdown, HTML, and (for a printable) a self-contained HTML via `packetToStandaloneHtml`, with a `packetFilename`; keep the contents list anchored to the renderer's heading ids.", files: ["./framework/packet.js", "./framework/markdown.js"] },
      { title: "Guard it", detail: "Confirm `validatePublication` and the integrity suite's `exports` check cover the new kind, and that any new secret-bearing field is registered in `SECRET_FIELDS`.", files: ["./framework/publication.js", "./framework/password.js", "./framework/integrity.js"] },
      { title: "Log & surface it", detail: "Add the kind to the Exports station (choose, preview, download, publish/host) and to the bounded export log so what was published when is recorded.", files: ["./modules/exports.js"] },
      { title: "Test it", detail: "Add a suite proving the new export builds, renders, and REFUSES a leaky bundle; re-run the full sweep.", files: ["./tests/publication.test.js", "./tests/packet.test.js"] },
    ],
  },
};

export const extensionGuides = () => EXTENSION_KINDS.map((k) => EXTENSION_GUIDES[k.id]);
export const extensionGuide = (id) => EXTENSION_GUIDES[id] || null;

// ---------------------------------------------------------------------------
// Coverage — what the playbook is expected to reference
// ---------------------------------------------------------------------------
export function playbookCoverage() {
  return {
    informationModels: INFORMATION_MODELS.map((m) => m.id),
    provenance: PROVENANCE.map((p) => p.id),
    recordTypes: RECORD_TYPES.slice(),
    relationshipKinds: RELATIONSHIP_KINDS.length,
    runbookTypes: RUNBOOK_TYPES.map((t) => t.id),
    bundleTypes: BUNDLE_TYPES.map((b) => b.id),
    packetKinds: PACKET_KINDS.map((k) => k.id),
    extensionKinds: EXTENSION_KINDS.map((k) => k.id),
  };
}

// The file paths an extension guide may cite, so the test can prove each guide
// points at real modules rather than inventing them.
export const PLAYBOOK_FILES = [
  "./framework/docsets.js",
  "./framework/classification.js",
  "./framework/relationships.js",
  "./framework/standardized.js",
  "./framework/linter.js",
  "./framework/assetLibrary.js",
  "./framework/flexible.js",
  "./framework/flexibleTypes.js",
  "./framework/assetRelations.js",
  "./framework/renewals.js",
  "./framework/lifecycle.js",
  "./framework/voipCoverage.js",
  "./framework/serviceAssets.js",
  "./framework/email.js",
  "./framework/network.js",
  "./framework/voice.js",
  "./framework/circuit.js",
  "./framework/runbook.js",
  "./framework/cutover.js",
  "./framework/publication.js",
  "./framework/packet.js",
  "./framework/password.js",
  "./framework/integrity.js",
  "./framework/fixtures.js",
  "./framework/markdown.js",
  "./modules/asset-fields.js",
  "./modules/asset-profile.js",
  "./modules/templates-view.js",
  "./modules/runbook-view.js",
  "./modules/exports.js",
  "./tests/docsets.test.js",
  "./tests/flexible.test.js",
  "./tests/structured-assets.test.js",
  "./tests/runbook.test.js",
  "./tests/cutover.test.js",
  "./tests/publication.test.js",
  "./tests/packet.test.js",
];

// ---------------------------------------------------------------------------
// Markdown rendering (the generator for src/PLAYBOOK.md)
// ---------------------------------------------------------------------------
const bullets = (items) => items.map((s) => "- " + s).join("\n");

export function extensionGuideMarkdown(guide) {
  const lines = [];
  lines.push("### " + guide.label);
  lines.push("");
  lines.push(guide.intro);
  lines.push("");
  guide.steps.forEach((s, i) => {
    lines.push(`${i + 1}. **${s.title}.** ${s.detail}`);
    if (s.files && s.files.length) lines.push(`   Files: ${s.files.map((f) => "`" + f.replace("./", "src/") + "`").join(", ")}`);
  });
  lines.push("");
  return lines.join("\n");
}

export function playbookToMarkdown() {
  const lines = [];
  const L = (s = "") => lines.push(s);

  L("# IT-U — Playbook");
  L("");
  L("> Generated by `playbookToMarkdown()` in `src/framework/playbook.js` — do not edit by hand. Regenerate after changing that file.");
  L("");
  L("This is the contributor and operator playbook for IT-U: the content model the");
  L("app implements, the conventions every record follows, how deployment");
  L("documentation is assembled, the publication envelope and its redaction rules,");
  L("and the checklists for adding a new asset type, template, service runbook or");
  L("export. The in-app copy lives under **Settings → Playbook & reference**.");
  L("");

  L("## 1. The information model");
  L("");
  L("Every entity record belongs to one of four information models, and (except a");
  L("relationship link) must be classified before it can be saved:");
  L("");
  for (const m of contentModelReference()) {
    L(`- **${m.label}** (\`${m.id}\`) — ${m.description}`);
    L(`  Record types: ${m.recordTypes.map((t) => "`" + t + "`").join(", ")}`);
  }
  L("");

  L("## 2. Provenance classifications");
  L("");
  L("Where a record's content came from and how it is kept. A provenance may require");
  L("extra origin detail on save:");
  L("");
  for (const p of provenanceReference()) {
    const req = p.requires.length ? ` Requires: ${p.requires.map((r) => "`" + r + "`").join(", ")}.` : "";
    L(`- **${p.label}** (\`${p.id}\`) — ${p.description}${req}`);
  }
  L("");

  L("## 3. Relationship conventions");
  L("");
  for (const c of RELATIONSHIP_CONVENTIONS) L(`- **${c.title}.** ${c.detail}`);
  L("");
  const rel = relationshipReference();
  L(`The catalog currently declares **${rel.kindCount} kinds** over ${rel.collectionCount} collections, validated, deduplicated and audited by \`checkIntegrity\`.`);
  L("");

  L("## 4. How deployment documentation is assembled");
  L("");
  for (const s of DEPLOYMENT_FLOW) {
    L(`- **${s.title}** ${s.detail}`);
    if (s.files && s.files.length) L(`  Files: ${s.files.map((f) => "`" + f.replace("./", "src/") + "`").join(", ")}`);
  }
  L("");

  L("## 5. The publication envelope & redaction");
  L("");
  for (const r of REDACTION_RULES) L(`- **${r.title}.** ${r.detail}`);
  L("");

  L("## 6. Extension playbooks");
  L("");
  L("Work an extension top to bottom; each step names the file it touches. Run the");
  L("full test sweep and update this playbook's generator before declaring it done.");
  L("");
  for (const g of extensionGuides()) L(extensionGuideMarkdown(g).trimEnd());
  L("");
  const cov = playbookCoverage();
  L("## 7. Coverage");
  L("");
  L(`- Information models: ${cov.informationModels.join(", ")}`);
  L(`- Provenance: ${cov.provenance.join(", ")}`);
  L(`- Record types: ${cov.recordTypes.length} (${cov.recordTypes.join(", ")})`);
  L(`- Relationship kinds: ${cov.relationshipKinds}`);
  L(`- Runbook types: ${cov.runbookTypes.join(", ")}`);
  L(`- Bundle types: ${cov.bundleTypes.join(", ")}`);
  L(`- Packet kinds: ${cov.packetKinds.join(", ")}`);
  L("");
  L("See `src/README.md` for the architecture and the per-task history.");
  return lines.join("\n") + "\n";
}
