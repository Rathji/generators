// src/tests/publication.test.js — validation tests for Phase 12 task 49
// ("Bundle publication to shared bus and knowledge base"). Run in the live page:
//   await import("./src/tests/publication.test.js").then((m) => m.run())
//
// Covers the default-deny redaction posture (credentials withheld, secret and
// private-key material never present), the prose scrubber, the documentation and
// deployment envelope builders, the pre-publish validator (which refuses a
// bundle carrying secrets), and the publication service's upload + export log.

import { runTests, assert, assertEq } from "./harness.js";
import { createMemoryCache } from "../framework/store/backends.js";
import {
  PUBLICATION_SCHEMA,
  PUBLICATION_KIND,
  DEFAULT_REDACTION,
  normalizeRedaction,
  redactRecord,
  redactForPublication,
  scrubText,
  findLeakedSecrets,
  buildDocumentationBundle,
  buildDeploymentBundle,
  serializePublication,
  validatePublication,
  publicationFilename,
  bundleSummaryLine,
  withheldSummary,
  createPublicationService,
} from "../framework/publication.js";

const CL = { informationModel: "core-asset", provenance: "authored" };
const DOC = { informationModel: "document", provenance: "authored" };

function makeSet() {
  return {
    id: "docset-acme",
    name: "Acme Corp",
    records: {
      organizations: [{ id: "org1", type: "organizations", name: "Acme Corp", website: "https://acme.example", ...CL }],
      locations: [{ id: "loc1", type: "locations", name: "HQ", ...CL }],
      configurations: [{ id: "cfg1", type: "configurations", name: "FW-01", ...CL }],
      passwords: [
        { id: "pw1", type: "passwords", name: "FW admin", scope: "general", category: "network-device", username: "admin", secret: "Sup3rSecret!", otpSecret: "JBSWY3DPEHPK3PXP", ...CL },
        { id: "pw2", type: "passwords", name: "FW-01 local admin", scope: "embedded", category: "local-admin", embeddedIn: { type: "configurations", id: "cfg1" }, secret: "Loc4l!", ...CL },
      ],
      documents: [{ id: "doc1", type: "documents", name: "Firewall notes", docType: "operational-notes", body: "Login: password: Sup3rSecret!\n\n-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----", ...DOC }],
      certificates: [{ id: "cert1", type: "certificates", name: "acme.example TLS", privateKeyRef: { type: "passwords", id: "pw1" }, ...CL }],
      flexibleAssets: [{ id: "voice1", type: "flexibleAssets", name: "Voice platform", informationModel: "flexible-asset", provenance: "authored" }],
      runbooks: [{ id: "rb1", type: "runbooks", name: "VoIP deployment — voice1", runbookType: "voip-deployment", body: "Step 1. Rack the PBX.\nsecret: hunter2", service: { type: "flexibleAssets", id: "voice1", name: "Voice platform" }, site: { type: "locations", id: "loc1", name: "HQ" }, ...DOC }],
      checklists: [{ id: "cl1", type: "checklists", name: "VoIP cutover", items: [{ id: "i1", text: "Confirm dial tone", done: false }], ...DOC }],
      relationships: [
        { id: "rel1", type: "relationships", kind: "document-asset", from: { type: "documents", id: "doc1", name: "Firewall notes" }, to: { type: "configurations", id: "cfg1", name: "FW-01" } },
        { id: "rel2", type: "relationships", kind: "configuration-credential", from: { type: "configurations", id: "cfg1", name: "FW-01" }, to: { type: "passwords", id: "pw1", name: "FW admin" } },
        { id: "rel3", type: "relationships", kind: "asset-checklist", from: { type: "flexibleAssets", id: "voice1", name: "Voice platform" }, to: { type: "checklists", id: "cl1", name: "VoIP cutover" } },
        { id: "rel4", type: "relationships", kind: "document-asset", from: { type: "flexibleAssets", id: "voice1", name: "Voice platform" }, to: { type: "configurations", id: "cfg1", name: "FW-01" } },
      ],
    },
  };
}

const hasOmitted = (red, type, reason) => red.omitted.some((o) => o.type === type && o.reason === reason);

export async function run() {
  return runTests([
    {
      name: "default redaction withholds every credential and never mutates the source set",
      fn: () => {
        const set = makeSet();
        const red = redactForPublication(set, DEFAULT_REDACTION);
        assert(!red.records.passwords, "credential records are omitted by default");
        assert(hasOmitted(red, "passwords", "credential"), "the omission is recorded");
        assertEq(red.records.configurations.length, 1, "non-credential records are kept");
        assertEq(red.relationships.length, 3, "only relationships whose endpoints both survive are kept");
        assert(hasOmitted(red, "relationships", "endpoint-withheld"), "the credential relationship is dropped");
        assertEq(set.records.passwords[0].secret, "Sup3rSecret!", "the source set is untouched");
        assertEq(findLeakedSecrets(red.records).length, 0, "no secret material survives");
      },
    },
    {
      name: "an explicit credential summary carries metadata only — no secret values, usernames only on request",
      fn: () => {
        const set = makeSet();
        const strict = redactForPublication(set, { credentialSummaries: true });
        const pw = (strict.records.passwords || []).find((p) => p.id === "pw1");
        assert(pw, "the general credential is summarised");
        assertEq(pw.name, "FW admin", "the name is kept");
        assertEq("secret" in pw, false, "the secret is never written");
        assertEq("otpSecret" in pw, false, "the OTP secret is never written");
        assertEq("username" in pw, false, "the username is withheld unless requested");
        assert(!(strict.records.passwords || []).some((p) => p.id === "pw2"), "embedded credentials stay out unless opted in");
        assert(hasOmitted(strict, "passwords", "embedded-credential"), "the embedded omission is recorded");

        const withUser = redactForPublication(set, { credentialSummaries: true, credentialUsernames: true, embeddedCredentials: true });
        assertEq((withUser.records.passwords || []).find((p) => p.id === "pw1").username, "admin", "the username appears when requested");
        assert((withUser.records.passwords || []).some((p) => p.id === "pw2"), "embedded credentials appear when requested");
        assertEq(findLeakedSecrets(withUser.records).length, 0, "even the opt-in bundle carries no secrets");
      },
    },
    {
      name: "redactRecord strips a certificate's private-key reference",
      fn: () => {
        const set = makeSet();
        const res = redactRecord("certificates", set.records.certificates[0], DEFAULT_REDACTION);
        assert(res.record, "the certificate is kept");
        assertEq("privateKeyRef" in res.record, false, "the private-key reference is stripped");
        assert(res.redactions.includes("private-key-ref"), "the redaction is reported");
      },
    },
    {
      name: "scrubText removes PEM keys, otpauth secrets and labelled secrets, but leaves references alone",
      fn: () => {
        const pem = scrubText("-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----");
        assert(!/PRIVATE KEY/.test(pem.text), "the PEM block is gone");
        assert(pem.hits >= 1, "the scrub is counted");

        const otp = scrubText("Enrol at otpauth://totp/Acme?secret=JBSWY3DPEHPK3PXP&issuer=Acme now");
        assert(!/JBSWY3DPEHPK3PXP/.test(otp.text), "the TOTP secret is gone");

        assertEq(scrubText("password: hunter2").text, "password: [redacted]", "a labelled secret is redacted");
        assertEq(scrubText("password: see the credential record").text, "password: see the credential record", "a cross-reference is left alone");
        assertEq(scrubText("Rack B — Level 2").text, "Rack B — Level 2", "ordinary text is untouched");
      },
    },
    {
      name: "buildDocumentationBundle produces a valid shared envelope with scrubbed sections",
      fn: () => {
        const env = buildDocumentationBundle(makeSet(), { now: 1000, createdBy: "alice", generatorName: "itu" });
        assertEq(env.schema, PUBLICATION_SCHEMA, "schema");
        assertEq(env.kind, PUBLICATION_KIND, "kind");
        assertEq(env.bundleType, "documentation", "bundle type");
        assertEq(env.client.name, "Acme Corp", "client name");
        assertEq(env.generatedAt, 1000, "generated timestamp");
        assertEq(env.createdBy, "alice", "author");
        assert(env.counts.records > 0 && env.counts.sections > 0, "counts are present");
        assert(env.sections.some((s) => s.kind === "document"), "the document becomes a section");
        assert(!env.sections.some((s) => /PRIVATE KEY/.test(s.text)), "section prose is scrubbed");
        assertEq(findLeakedSecrets(env).length, 0, "no secrets anywhere in the envelope");
        assert(validatePublication(env).ok, "the envelope validates");
      },
    },
    {
      name: "buildDeploymentBundle carries the scoped runbooks, checklists and related records only",
      fn: () => {
        const set = makeSet();
        const env = buildDeploymentBundle(set, { serviceRef: { type: "flexibleAssets", id: "voice1" }, now: 2000 });
        assertEq(env.bundleType, "deployment", "bundle type");
        assert(env.sections.some((s) => s.kind === "runbook"), "the runbook section is present");
        assert(env.sections.some((s) => s.kind === "checklist"), "the checklist section is present");
        assert((env.records.flexibleAssets || []).some((r) => r.id === "voice1"), "the service is included");
        assert((env.records.configurations || []).some((r) => r.id === "cfg1"), "a related configuration comes along");
        assert(!(env.records.documents || []).some((r) => r.id === "doc1"), "an unrelated document is excluded");
        assert(!env.records.passwords, "a linked credential is still withheld");
        assertEq(findLeakedSecrets(env).length, 0, "no secrets");
        assert(validatePublication(env).ok, "the deployment envelope validates");
      },
    },
    {
      name: "validatePublication refuses a bundle carrying a secret field or private-key material",
      fn: () => {
        const set = makeSet();
        const base = buildDocumentationBundle(set, { now: 1000 });
        const leaky = { ...base, records: { ...base.records, passwords: [{ id: "p9", type: "passwords", name: "leak", secret: "oops" }] } };
        const r = validatePublication(leaky);
        assert(!r.ok, "the leaky bundle is refused");
        assert(r.leaks.some((l) => l.reason === "secret-field"), "the secret field is identified");

        const pem = { ...base, sections: [{ id: "x", heading: "x", text: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----" }] };
        assert(!validatePublication(pem).ok, "PEM material in a section is refused");
        assert(!validatePublication('{"not":"json').ok, "unparseable input is refused");
        assert(!validatePublication({ schema: "nope" }).ok, "an unknown schema is refused");
      },
    },
    {
      name: "serialize / filename / summary helpers name and describe the bundle",
      fn: () => {
        const env = buildDocumentationBundle(makeSet(), { now: Date.parse("2026-08-01T10:00:00Z"), createdBy: "alice" });
        assert(serializePublication(env).includes(PUBLICATION_SCHEMA), "the serialized bundle carries its schema");
        const name = publicationFilename(env);
        assert(name.startsWith("itu-documentation-acme-corp-"), "the filename names the client: " + name);
        assert(name.endsWith(".json"), "the filename has an extension");
        assert(bundleSummaryLine(env).includes("Acme Corp"), "the summary names the client");
        assert(bundleSummaryLine(env).includes("record"), "the summary counts records");
        assert(withheldSummary(env.redaction.withheld).includes("Password"), "the withheld summary names the record type");
      },
    },
    {
      name: "normalizeRedaction defaults every opt-in to off",
      fn: () => {
        const p = normalizeRedaction(null);
        assertEq(p.credentialSummaries, false, "no summaries by default");
        assertEq(p.credentialUsernames, false, "no usernames by default");
        assertEq(p.embeddedCredentials, false, "no embedded credentials by default");
        assertEq(p.scrubSecrets, true, "prose scrubbing is on by default");
      },
    },
    {
      name: "the publication service publishes a bundle and records an export log entry",
      fn: async () => {
        const set = makeSet();
        const store = { readDocument: async () => ({ data: set }) };
        const cache = createMemoryCache();
        let uploaded = null;
        const upload = async (text) => {
          uploaded = text;
          return { url: "https://uploads.example/bundle.json" };
        };
        const svc = createPublicationService({ store, cache, upload, now: () => 3000 });
        const { envelope } = await svc.buildDocumentation({ clientId: "docset-acme" });
        assertEq(validatePublication(envelope).ok, true, "the built bundle validates");
        const entry = await svc.publish(envelope, { createdBy: "alice", note: "nightly" });
        assertEq(entry.url, "https://uploads.example/bundle.json", "the uploaded url is logged");
        assertEq(entry.at, 3000, "the log timestamp is recorded");
        assertEq(entry.clientName, "Acme Corp", "the client is logged");
        assertEq(entry.note, "nightly", "the note is logged");
        assert(entry.bytes > 0, "the size is measured");
        assert(uploaded.includes(PUBLICATION_SCHEMA), "the shared envelope is what gets uploaded");
        const log = await svc.listLog();
        assertEq(log.length, 1, "one entry in the log");
        assertEq((await svc.removeLogEntry(entry.id)).length, 0, "the entry can be removed");
        await svc.publish(envelope, { createdBy: "alice" });
        assertEq((await svc.clearLog()).length, 0, "the log can be cleared");
      },
    },
    {
      name: "the publication service refuses a leaky bundle and publishing without an upload channel",
      fn: async () => {
        const set = makeSet();
        const store = { readDocument: async () => ({ data: set }) };
        const cache = createMemoryCache();
        const svc = createPublicationService({ store, cache, upload: async () => ({ url: "https://x/y" }), now: () => 1 });
        const { envelope } = await svc.buildDocumentation({ clientId: "docset-acme" });
        let refused = false;
        try {
          await svc.publish({ ...envelope, records: { ...envelope.records, passwords: [{ id: "p", secret: "x" }] } });
        } catch (e) {
          refused = true;
        }
        assert(refused, "a bundle carrying secrets is refused at publish time");

        const offline = createPublicationService({ store, cache, upload: null, now: () => 1 });
        let threw = false;
        try {
          await offline.publish(envelope);
        } catch (e) {
          threw = true;
        }
        assert(threw, "publishing without an upload channel fails loudly");

        let bad = false;
        try {
          await svc.buildDocumentation({ clientId: "not-a-set" });
        } catch {
          bad = true;
        }
        assert(bad, "an unknown client id is rejected");
      },
    },
  ]);
}
