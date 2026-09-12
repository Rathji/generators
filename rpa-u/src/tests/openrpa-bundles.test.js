import { suite, test, assert, assertEquals } from "./harness.js";
import { createHub } from "../core/hub.js";
import {
  OPENRPA_BUNDLE_FORMAT,
  OPENRPA_BUNDLE_VERSION,
  OPENRPA_BUNDLE_MIN_VERSION,
  OPENRPA_BUNDLE_SECTIONS,
  OPENRPA_BUNDLE_DOCUMENT_COLLECTIONS,
  OPENRPA_PROFILE_FIELDS,
  sectionLabel,
  isSecretKey,
  sanitizeProfile,
  parseBundle,
} from "../core/openrpa/bundles.js";
import { OPENRPA_BUNDLES_COLLECTION, OPENRPA_COLLECTIONS } from "../core/openrpa/constants.js";

async function connectedHub() {
  const hub = await createHub({ kv: null }).ready();
  const or = hub.openrpa;
  await or.connect({ announce: false });
  await or.linking.refreshTargets();
  return { hub, or };
}

function northwind(hub) {
  return hub.identity.search("northwinddental.com", { type: "company" })[0] || hub.identity.all("company")[0];
}

suite("OpenRPA bundle schema", () => {
  test("declares its format, version, sections and document collections", () => {
    assertEquals(OPENRPA_BUNDLE_FORMAT, "rpa-u/openrpa-bundle");
    assertEquals(OPENRPA_BUNDLE_VERSION, 1);
    assertEquals(OPENRPA_BUNDLE_MIN_VERSION, 1);
    assertEquals(OPENRPA_BUNDLE_SECTIONS, ["profiles", "ownership", "links", "documents", "assets"]);
    for (const name of ["workflows", "openrpa_queue", "openrpa_workitem", "openrpa_robot", "nodered", "companies"]) {
      assert(OPENRPA_BUNDLE_DOCUMENT_COLLECTIONS.includes(name), `${name} should be an exported collection`);
    }
    assertEquals(sectionLabel("profiles"), "Connection profiles");
    assertEquals(sectionLabel("assets"), "Workflow assets");
    assertEquals(sectionLabel("mystery"), "mystery");
  });

  test("recognises credential-shaped keys and ignores ordinary ones", () => {
    for (const key of ["password", "passphrase", "clientSecret", "refresh_token", "jwt", "apiKey", "api_key", "privateKey", "bearer", "passwordHash"]) {
      assert(isSecretKey(key), `"${key}" should be treated as a secret`);
    }
    for (const key of ["name", "host", "port", "path", "url", "organization", "insecure", "restBase", "createdAt"]) {
      assert(!isSecretKey(key), `"${key}" should not be treated as a secret`);
    }
  });

  test("sanitises a profile down to the allow-list and reports what it stripped", () => {
    const report = sanitizeProfile({
      id: "orp_1",
      name: "Prod",
      host: "openflow.example.com",
      port: 443,
      path: "/",
      url: "wss://openflow.example.com:443/",
      organization: "acme",
      insecure: false,
      restBase: "",
      createdAt: "2030-01-01T00:00:00.000Z",
      updatedAt: "2030-01-01T00:00:00.000Z",
      password: "hunter2",
      jwt: "abc.def.ghi",
      apiKey: "sk-live",
      note: "keep me out",
    });
    assertEquals(report.profile.password, undefined);
    assertEquals(report.profile.jwt, undefined);
    assertEquals(report.profile.apiKey, undefined);
    assertEquals(report.profile.note, undefined);
    assertEquals(report.profile.name, "Prod");
    assertEquals(report.profile.host, "openflow.example.com");
    assert(Object.keys(report.profile).every((key) => OPENRPA_PROFILE_FIELDS.includes(key)), "only allow-listed fields survive");
    for (const key of ["password", "jwt", "apiKey"]) {
      assert(report.excluded.includes(key), `${key} should be reported as excluded`);
      assert(report.secrets.includes(key), `${key} should be reported as a stripped secret`);
    }
    assert(report.excluded.includes("note"));
    assert(!report.secrets.includes("note"));
  });

  test("parses JSON text and reports empty or malformed input", () => {
    const empty = parseBundle("");
    assertEquals(empty.ok, false);
    assertEquals(empty.error.code, "empty");
    const malformed = parseBundle("{not json");
    assertEquals(malformed.ok, false);
    assertEquals(malformed.error.code, "invalid-json");
    const good = parseBundle('{"format":"x"}');
    assert(good.ok);
    assertEquals(good.bundle.format, "x");
  });
});

suite("OpenRPA bundle build & export", () => {
  test("snapshots profiles, ownership, links, documents and assets with a manifest", async () => {
    const { hub, or } = await connectedHub();
    await or.profiles.create({ name: "Prod OpenFlow", url: "wss://openflow.example.com:443/" });
    const company = northwind(hub);
    await or.linking.link({ entityType: "company", entityId: company.id, targetType: "workflow", targetId: "wf_invoice" });
    await or.files.upload({ filename: "bundle-asset.json", content: "{\"k\":1}", refId: "wf_invoice", ref: "workflow" });

    const built = await or.bundles.build({ name: "Nightly", description: "captured" });
    assert(built.ok, JSON.stringify(built));
    const bundle = built.bundle;
    assertEquals(bundle.format, OPENRPA_BUNDLE_FORMAT);
    assertEquals(bundle.version, OPENRPA_BUNDLE_VERSION);
    assertEquals(bundle.kind, "openrpa");
    assertEquals(bundle.name, "Nightly");
    assertEquals(bundle.include.assets, true);
    assert(bundle.counts.profiles >= 1, "expected the profile to be captured");
    assert(bundle.counts.ownershipFields >= 18, `expected the ownership model, got ${bundle.counts.ownershipFields}`);
    assert(bundle.counts.links >= 1, "expected the entity link to be captured");
    assert(bundle.counts.documents >= 1, "expected document snapshots");
    assert(bundle.counts.assets >= 1, "expected workflow assets");
    assertEquals(bundle.counts.excludedSecrets, 0);
    assert(bundle.fingerprint && bundle.fingerprint.startsWith("ofp_"));
    const expected = bundle.counts.profiles + bundle.counts.ownershipFields + bundle.counts.links + bundle.counts.documents + bundle.counts.assets;
    assertEquals(bundle.manifest.length, expected);
    assert(bundle.manifest.every((entry) => entry.section && entry.key && entry.checksum));
    assert(bundle.profiles.every((profile) => Object.keys(profile).every((key) => OPENRPA_PROFILE_FIELDS.includes(key))));
    or.disconnect();
  });

  test("honours the section toggles and exports downloadable JSON", async () => {
    const { or } = await connectedHub();
    const lean = await or.bundles.build({ includeDocuments: false, includeAssets: false, includeOwnership: false, includeLinks: false, includeProfiles: false });
    assert(lean.ok);
    assertEquals(lean.bundle.counts.profiles, 0);
    assertEquals(lean.bundle.counts.links, 0);
    assertEquals(lean.bundle.counts.documents, 0);
    assertEquals(lean.bundle.counts.assets, 0);
    assertEquals(lean.bundle.counts.ownershipFields, 0);
    assertEquals(lean.bundle.ownership, null);

    const exported = await or.bundles.export({ name: "Download me", publish: false });
    assert(exported.ok);
    assert(exported.filename.endsWith(".json"));
    const parsed = JSON.parse(exported.json);
    assertEquals(parsed.fingerprint, exported.bundle.fingerprint);
    assertEquals(or.bundles.list().length, 0, "an unpublished export should not be stored");
    or.disconnect();
  });

  test("validates a built bundle and rejects bad format, versions and section shapes", async () => {
    const { or } = await connectedHub();
    const built = await or.bundles.build({ includeDocuments: false, includeAssets: false });
    const bundle = built.bundle;
    const good = or.bundles.validate(bundle);
    assert(good.ok, JSON.stringify(good.errors));
    assertEquals(good.version, OPENRPA_BUNDLE_VERSION);
    assertEquals(good.counts.ownershipFields, bundle.counts.ownershipFields);
    assert(or.bundles.validate(JSON.stringify(bundle)).ok);

    const badFormat = or.bundles.validate({ ...bundle, format: "something-else" });
    assert(!badFormat.ok);
    assert(badFormat.errors.some((error) => error.code === "unknown-format"));

    const newer = or.bundles.validate({ ...bundle, version: OPENRPA_BUNDLE_VERSION + 1 });
    assert(!newer.ok);
    assert(newer.errors.some((error) => error.code === "newer-version"));

    const malformed = or.bundles.validate({ ...bundle, profiles: {}, documents: { workflows: {} } });
    assert(!malformed.ok);
    assert(malformed.errors.some((error) => error.code === "invalid-section" && error.ref === "profiles"));
    assert(malformed.errors.some((error) => error.code === "invalid-documents" && error.ref === "workflows"));

    const empty = or.bundles.validate("");
    assert(!empty.ok);
    assertEquals(empty.errors[0].code, "empty");
    or.disconnect();
  });
});

suite("OpenRPA bundle preview & import", () => {
  test("round-trips a bundle into a fresh hub", async () => {
    const source = await connectedHub();
    await source.or.profiles.create({ name: "Prod OpenFlow", url: "wss://openflow.example.com:443/" });
    const company = northwind(source.hub);
    await source.or.linking.link({ entityType: "company", entityId: company.id, targetType: "workflow", targetId: "wf_invoice" });
    await source.or.files.upload({ filename: "round-trip.json", content: "{\"steps\":3}", refId: "wf_invoice", ref: "workflow" });
    const exported = await source.or.bundles.export({ name: "Round trip", publish: false });
    assert(exported.ok, JSON.stringify(exported));

    const target = await connectedHub();
    const dryRun = await target.or.bundles.import(exported.json, { dryRun: true });
    assert(dryRun.ok, JSON.stringify(dryRun.errors));
    assertEquals(dryRun.dryRun, true);
    assertEquals(target.or.profiles.list().length, 0, "a dry run must not create profiles");

    const preview = await target.or.bundles.preview(exported.json);
    assert(preview.ok, JSON.stringify(preview.errors || preview));
    assert(preview.summary.profiles.create >= 1);
    assert(preview.summary.links.create >= 1);
    assert(preview.summary.assets.create >= 1);
    assert(preview.summary.documents.create + preview.summary.documents.update >= 1);

    const imported = await target.or.bundles.import(exported.json);
    assert(imported.ok, JSON.stringify(imported.failed));
    assert(imported.applied.profiles >= 1, "expected a profile to be created");
    assert(imported.applied.links >= 1, "expected a link to be created");
    assert(imported.applied.documents >= 1, "expected documents to be written");
    assert(imported.applied.assets >= 1, "expected an asset to be uploaded");

    assertEquals(target.or.profiles.list().filter((profile) => profile.name === "Prod OpenFlow").length, 1);
    assert(target.or.linking.linksFor("company", company.id).length >= 1, "expected the link to be recreated");
    const doc = await target.or.documents.get("workflows", "wf_invoice");
    assert(doc.ok && doc.document, "expected the workflow document to be present");
    const listed = await target.or.files.list({ search: "round-trip.json" });
    assert(listed.ok);
    assertEquals(listed.files.length, 1);
    const content = await target.or.files.content(listed.files[0].id);
    assertEquals(content.content, "{\"steps\":3}");
    assertEquals(target.hub.registry.validate().counts.error, 0);

    source.or.disconnect();
    target.or.disconnect();
  });

  test("plans around unknown targets and missing entities", async () => {
    const { hub, or } = await connectedHub();
    const built = await or.bundles.build({ includeDocuments: false, includeAssets: false });
    const bundle = JSON.parse(JSON.stringify(built.bundle));
    bundle.links = [
      { id: "lnk_bogus", entityType: "company", entityId: northwind(hub).id, targetType: "nope", targetId: "x" },
      { id: "lnk_missing", entityType: "company", entityId: "co_missing", targetType: "workflow", targetId: "wf_invoice" },
    ];
    const planned = await or.bundles.plan(bundle);
    assert(planned.ok, JSON.stringify(planned.errors));
    assertEquals(planned.plan.links[0].action, "skip");
    assertEquals(planned.plan.links[1].action, "skip");
    assert(planned.warnings.some((warning) => warning.code === "link-entity-missing"));
    assertEquals(planned.summary.links.create, 0);
    or.disconnect();
  });

  test("skips items that already exist in the target hub", async () => {
    const { or } = await connectedHub();
    await or.profiles.create({ name: "Existing", url: "wss://existing.example.com:443/" });
    const exported = await or.bundles.export({ name: "Existing", publish: false });
    assert(exported.ok);
    const preview = await or.bundles.preview(exported.json);
    assert(preview.ok, JSON.stringify(preview.errors || preview));
    assertEquals(preview.summary.profiles.create, 0);
    assertEquals(preview.summary.profiles.skip, preview.summary.profiles.total);
    or.disconnect();
  });
});

suite("OpenRPA bundle hub integration", () => {
  test("the ready hub exposes the bundle store", async () => {
    const hub = await createHub({ kv: null }).ready();
    const or = hub.openrpa;
    assert(or.bundles, "hub.openrpa.bundles should exist");
    assert(or.status().bundles, "status() should report the bundle store");
    assertEquals(typeof or.stats().bundles, "number");
    assert(OPENRPA_COLLECTIONS.includes(OPENRPA_BUNDLES_COLLECTION));
    assert(hub.db.collections().includes(OPENRPA_BUNDLES_COLLECTION));
    assertEquals(hub.registry.validate().counts.error, 0);
  });

  test("published bundles survive a hydrate and are cleared by a reset", async () => {
    const hub = await createHub({ kv: null }).ready();
    const or = hub.openrpa;
    await or.connect({ announce: false });
    const exported = await or.bundles.export({ name: "Persist me" });
    assert(exported.ok);
    assertEquals(or.bundles.list().length, 1);
    await or.bundles.hydrate();
    assertEquals(or.bundles.list().length, 1);
    assertEquals(or.bundles.get(exported.bundle.id).name, "Persist me");
    await hub.resetData();
    assertEquals(or.bundles.list().length, 0);
  });
});
