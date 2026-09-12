// src/tests/packet.test.js — validation tests for Phase 12 task 50
// ("Exports & printable packets"). Run in the live page:
//   await import("./src/tests/packet.test.js").then((m) => m.run())
//
// Covers the documentation and deployment packet builders, the default-deny
// inheritance from the publication engine (no secrets / private keys anywhere),
// the field tables (standardized labels, record references, flexible-asset
// templates), the markdown / HTML / standalone renderers (with a matching TOC),
// the filename + summary helpers, and the packet service's build + host + log.

import { runTests, assert, assertEq } from "./harness.js";
import { createMemoryCache } from "../framework/store/backends.js";
import {
  PACKET_SCHEMA,
  PACKET_KINDS,
  buildDocumentationPacket,
  buildDeploymentPacket,
  deploymentScopeLabel,
  packetToMarkdown,
  packetToHtml,
  packetToStandaloneHtml,
  packetFilename,
  packetSummaryLine,
  formatPacketDate,
  createPacketService,
} from "../framework/packet.js";

const CL = { informationModel: "core-asset", provenance: "authored" };
const DOC = { informationModel: "document", provenance: "authored" };

const ASSET_TYPES = [
  {
    id: "atype-voice",
    name: "Voice platform",
    fields: [
      { key: "vendor", label: "Vendor", type: "text" },
      { key: "seats", label: "Seats", type: "number" },
      { key: "managed", label: "Managed", type: "checkbox" },
    ],
  },
];

function makeSet() {
  return {
    id: "docset-acme",
    name: "Acme Corp",
    records: {
      organizations: [{ id: "org1", type: "organizations", name: "Acme Corp", website: "https://acme.example", legalName: "Acme Corp Pty Ltd", ...CL }],
      locations: [{ id: "loc1", type: "locations", name: "HQ", city: "Brisbane", region: "QLD", ...CL }],
      contacts: [{ id: "ct1", type: "contacts", name: "Dana Lee", role: "IT Manager", email: "dana@acme.example", ...CL }],
      configurations: [{ id: "cfg1", type: "configurations", name: "FW-01", manufacturer: "Fortinet", model: "60F", serial: "FG60F001", ...CL }],
      passwords: [
        { id: "pw1", type: "passwords", name: "FW admin", scope: "general", category: "network-device", username: "admin", secret: "Sup3rSecret!", otpSecret: "JBSWY3DPEHPK3PXP", ...CL },
      ],
      documents: [
        {
          id: "doc1",
          type: "documents",
          name: "Firewall notes",
          docType: "operational-notes",
          summary: "How the edge firewall is set up.",
          body: "# Edge firewall\n\nLogin: password: Sup3rSecret!\n\n-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----\n\n## Rules\n\n- allow 443",
          ...DOC,
        },
      ],
      certificates: [{ id: "cert1", type: "certificates", name: "acme.example TLS", privateKeyRef: { type: "passwords", id: "pw1" }, ...CL }],
      flexibleAssets: [
        { id: "voice1", type: "flexibleAssets", name: "Voice platform", assetTypeId: "atype-voice", assetFields: { vendor: "3CX", seats: 40, managed: true }, informationModel: "flexible-asset", provenance: "authored" },
      ],
      runbooks: [
        {
          id: "rb1",
          type: "runbooks",
          name: "VoIP deployment — voice1",
          runbookType: "voip-deployment",
          status: "ready",
          body: "# VoIP build\n\nsecret: hunter2\n\n1. Rack the PBX",
          service: { type: "flexibleAssets", id: "voice1", name: "Voice platform" },
          site: { type: "locations", id: "loc1", name: "HQ" },
          ...DOC,
        },
      ],
      checklists: [
        { id: "cl1", type: "checklists", name: "VoIP cutover", items: [{ id: "i1", text: "Confirm dial tone", done: true }, { id: "i2", text: "Test failover", done: false }], ...DOC },
      ],
      domains: [{ id: "dom1", type: "domains", name: "acme.example", registrar: "Cloudflare", ...CL }],
      relationships: [
        { id: "rel1", type: "relationships", kind: "document-asset", from: { type: "documents", id: "doc1", name: "Firewall notes" }, to: { type: "configurations", id: "cfg1", name: "FW-01" } },
        { id: "rel2", type: "relationships", kind: "configuration-credential", from: { type: "configurations", id: "cfg1", name: "FW-01" }, to: { type: "passwords", id: "pw1", name: "FW admin" } },
        { id: "rel3", type: "relationships", kind: "asset-checklist", from: { type: "flexibleAssets", id: "voice1", name: "Voice platform" }, to: { type: "checklists", id: "cl1", name: "VoIP cutover" } },
        { id: "rel4", type: "relationships", kind: "document-asset", from: { type: "flexibleAssets", id: "voice1", name: "Voice platform" }, to: { type: "configurations", id: "cfg1", name: "FW-01" } },
      ],
    },
  };
}

const block = (packet, id) => (packet.blocks || []).find((b) => b.id === id);

export async function run() {
  return runTests([
    {
      name: "a documentation packet has a cover, overview, inventory, per-type sections and a relationship map",
      fn: () => {
        const packet = buildDocumentationPacket(makeSet(), { now: 1000, createdBy: "alice", generatorName: "itu", assetTypes: ASSET_TYPES });
        assertEq(packet.schema, PACKET_SCHEMA, "schema");
        assertEq(packet.kind, "documentation", "kind");
        assertEq(packet.title, "Acme Corp — documentation packet", "title");
        assertEq(packet.generatedAt, 1000, "timestamp");
        assertEq(packet.createdBy, "alice", "author");
        assert(block(packet, "overview"), "an overview section exists");
        assert(block(packet, "inventory"), "an inventory section exists");
        assert(block(packet, "records-organizations"), "organizations section");
        assert(block(packet, "records-documents"), "documents section");
        assert(block(packet, "records-runbooks"), "runbooks section");
        assert(block(packet, "records-checklists"), "checklists section");
        assert(block(packet, "relationships"), "a relationship map exists");
        assert(packet.counts.records > 0 && packet.counts.sections === packet.blocks.length, "counts are coherent");
        assertEq(packet.counts.checklists, 1, "checklist count");
      },
    },
    {
      name: "packets inherit the default-deny posture: no secrets, no private keys, in markdown or HTML",
      fn: () => {
        const packet = buildDocumentationPacket(makeSet(), { now: 1000, assetTypes: ASSET_TYPES });
        const md = packetToMarkdown(packet);
        const html = packetToHtml(packet).html;
        for (const [name, text] of [["markdown", md], ["html", html]]) {
          assert(!/Sup3rSecret/.test(text), `${name} carries no password secret`);
          assert(!/JBSWY3DPEHPK3PXP/.test(text), `${name} carries no otp secret`);
          assert(!/hunter2/.test(text), `${name} scrubs a labelled secret`);
          assert(!/PRIVATE KEY/.test(text), `${name} carries no private key`);
          assert(!/"secret"\s*:/.test(text), `${name} has no secret field`);
        }
        assert(/Withheld from this packet/.test(md), "the withheld note names what was left out");
        assert(/never included in a published packet/.test(md), "the default-deny note is present");
        assert(/password: \[redacted\]/.test(md), "a labelled secret in a body is redacted");
      },
    },
    {
      name: "a record section renders standardized labels, a resolved record reference and the record body with demoted headings",
      fn: () => {
        const packet = buildDocumentationPacket(makeSet(), { assetTypes: ASSET_TYPES });
        const runbooks = block(packet, "records-runbooks").markdown;
        assert(/### VoIP deployment — voice1/.test(runbooks), "the runbook heading is present");
        assert(/\| Field \| Value \|/.test(runbooks), "the runbook has a field table");
        assert(/Service \/ asset \| Voice platform/.test(runbooks), "the service reference resolves to its name");
        assert(/Site \| HQ/.test(runbooks), "the site reference resolves to its name");
        assert(/Status \| Ready/.test(runbooks), "a select field renders its option label");
        assert(/secret: \[redacted\]/.test(runbooks), "the labelled secret is redacted in the body");
        assert(!/hunter2/.test(runbooks), "the raw secret value does not leak into the runbook section");

        const docs = block(packet, "records-documents").markdown;
        assert(/### Edge firewall/.test(docs), "the document body heading is included");
        assert(!/^# Edge firewall/m.test(docs), "the body's own h1 is demoted");
      },
    },
    {
      name: "flexible assets render their template's field labels and the checklist renders a task list",
      fn: () => {
        const packet = buildDocumentationPacket(makeSet(), { assetTypes: ASSET_TYPES });
        const assets = block(packet, "records-flexibleAssets").markdown;
        assert(/Vendor \| 3CX/.test(assets), "the template field label is used");
        assert(/Seats \| 40/.test(assets), "a numeric field renders");
        assert(/Managed \| Yes/.test(assets), "a checkbox field renders Yes");
        const checklist = block(packet, "records-checklists").markdown;
        assert(/\*\*1 \/ 2 complete\*\*/.test(checklist), "the checklist shows its completion");
        assert(/- \[x\] Confirm dial tone/.test(checklist), "a done step renders checked");
        assert(/- \[ \] Test failover/.test(checklist), "an undone step renders unchecked");
      },
    },
    {
      name: "a deployment packet is scoped to the service and carries only its related records",
      fn: () => {
        const set = makeSet();
        const serviceRef = { type: "flexibleAssets", id: "voice1" };
        assertEq(deploymentScopeLabel(set, { serviceRef }), "Voice platform", "the scope label resolves to the service name");
        const packet = buildDeploymentPacket(set, { serviceRef, now: 2000, assetTypes: ASSET_TYPES });
        assertEq(packet.kind, "deployment", "kind");
        assertEq(packet.scope && packet.scope.name, "Voice platform", "the scope is recorded");
        assert(/Voice platform/.test(packet.title), "the title names the scope");
        assert(block(packet, "records-runbooks"), "the runbook section is present");
        assert(block(packet, "records-checklists"), "the checklist section is present");
        assert(block(packet, "records-flexibleAssets"), "the service is included");
        assert(block(packet, "records-configurations"), "a related configuration comes along");
        assert(!block(packet, "records-organizations") || !/Firewall notes/.test(block(packet, "records-organizations").markdown), "sanity");
        const md = packetToMarkdown(packet);
        assert(!/Firewall notes/.test(md), "an unrelated document is excluded");
        assert(!/Sup3rSecret/.test(md), "a linked credential is still withheld");
      },
    },
    {
      name: "packetToMarkdown emits a titled document with a linked table of contents and section separators",
      fn: () => {
        const packet = buildDocumentationPacket(makeSet(), { now: Date.parse("2026-08-01T10:00:00Z"), assetTypes: ASSET_TYPES });
        const md = packetToMarkdown(packet);
        assert(md.startsWith("# Acme Corp — documentation packet\n"), "the title is the first heading");
        assert(/## Contents\n- \[Overview\]\(#overview\)/.test(md), "the TOC links the first block");
        assert(/\n---\n\n## Overview\n/.test(md), "sections are separated by a rule");
        assert(/prepared August 1, 2026/.test(md) || /prepared August/.test(md), "the cover names the date");
      },
    },
    {
      name: "packetToHtml returns rendered HTML plus a table of contents whose anchors match the heading ids",
      fn: () => {
        const packet = buildDocumentationPacket(makeSet(), { assetTypes: ASSET_TYPES });
        const { html, toc } = packetToHtml(packet);
        assert(/<h2[^>]*>Overview<\/h2>/.test(html), "the overview heading renders");
        assert(/<table/.test(html), "field tables render");
        assert(toc.length >= packet.blocks.length, "the toc covers the blocks");
        const overviewEntry = toc.find((t) => t.text === "Overview");
        assert(overviewEntry && html.includes(`id="${overviewEntry.id}"`), "the toc id matches the rendered heading");
        assert(!/Sup3rSecret/.test(html), "no secret in the html");
      },
    },
    {
      name: "packetToStandaloneHtml wraps the packet in a printable, self-contained document",
      fn: () => {
        const packet = buildDocumentationPacket(makeSet(), { assetTypes: ASSET_TYPES });
        packet.title = 'Acme <script>alert(1)</script>';
        const html = packetToStandaloneHtml(packet);
        assert(/^<!doctype html>/.test(html), "a full document");
        assert(/@media print/.test(html), "print styles are embedded");
        assert(/class="toolbar"/.test(html), "the print toolbar");
        assert(/window\.print\(\)/.test(html), "a print action");
        assert(!/<script>alert/.test(html), "the title is escaped");
        assert(/&lt;script&gt;/.test(html), "the escaped title is present");
        const bare = packetToStandaloneHtml(packet, { print: false });
        assert(!/class="toolbar"/.test(bare), "the toolbar can be omitted");
      },
    },
    {
      name: "packetFilename and packetSummaryLine name and describe a packet",
      fn: () => {
        const packet = buildDocumentationPacket(makeSet(), { now: Date.parse("2026-08-01T10:00:00Z"), assetTypes: ASSET_TYPES });
        assert(packetFilename(packet).startsWith("itu-documentation-packet-acme-corp-"), "the filename names kind + client");
        assert(packetFilename(packet).endsWith(".html"), "default extension");
        assert(packetFilename(packet, "md").endsWith(".md"), "explicit extension");
        assertEq(formatPacketDate(Date.parse("2026-08-01T10:00:00Z")).includes("2026"), true, "a date is formatted");
        const line = packetSummaryLine(packet);
        assert(line.includes("Documentation packet"), "the summary names the kind");
        assert(line.includes("Acme Corp"), "the summary names the client");
        assert(line.includes("record"), "the summary counts records");
        assertEq(PACKET_KINDS.map((k) => k.id).join(","), "documentation,deployment", "the two packet kinds");
      },
    },
    {
      name: "the packet service builds a packet, hosts its HTML and records a packet log entry",
      fn: async () => {
        const set = makeSet();
        const store = { readDocument: async () => ({ data: set }) };
        const cache = createMemoryCache();
        let uploaded = null;
        const upload = async (text) => {
          uploaded = text;
          return { url: "https://uploads.example/packet.html" };
        };
        const svc = createPacketService({ store, cache, upload, now: () => 3000, getAssetTypes: async () => ASSET_TYPES });
        const { packet } = await svc.buildDocumentation({ clientId: "docset-acme", createdBy: "alice" });
        assertEq(packet.counts.records > 0, true, "the built packet has records");
        const entry = await svc.host(packet, { createdBy: "alice", note: "site visit" });
        assertEq(entry.url, "https://uploads.example/packet.html", "the hosted url is logged");
        assertEq(entry.at, 3000, "the log timestamp");
        assertEq(entry.clientName, "Acme Corp", "the client is logged");
        assertEq(entry.note, "site visit", "the note is logged");
        assert(entry.bytes > 0, "the size is measured");
        assert(/<!doctype html>/.test(uploaded), "the standalone html is what gets hosted");
        assert(!/Sup3rSecret/.test(uploaded), "the hosted html carries no secret");
        assertEq((await svc.listLog()).length, 1, "one log entry");
        assertEq((await svc.removeLogEntry(entry.id)).length, 0, "the entry can be removed");
        await svc.host(packet, { createdBy: "alice" });
        assertEq((await svc.clearLog()).length, 0, "the log can be cleared");
      },
    },
    {
      name: "the packet service refuses unknown clients and hosting without an upload channel",
      fn: async () => {
        const set = makeSet();
        const store = { readDocument: async () => ({ data: set }) };
        const cache = createMemoryCache();
        const svc = createPacketService({ store, cache, upload: async () => ({ url: "https://x/y" }), now: () => 1 });
        const { packet } = await svc.buildDocumentation({ clientId: "docset-acme" });
        const offline = createPacketService({ store, cache, upload: null, now: () => 1 });
        let threw = false;
        try {
          await offline.host(packet);
        } catch {
          threw = true;
        }
        assert(threw, "hosting without an upload channel fails loudly");
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
