// src/tests/site-diagrams.test.js — validation tests for roadmap task 23
// (site summaries, diagrams, site maps & editable source files). Run in the
// live page:
//   await import("./src/tests/site-diagrams.test.js").then((m) => m.run())
//
// Covers: the site-type and diagram-type catalogs and their groupings; site
// validation (a site must declare a type) and its detail line; the diagram
// record's dual obligation — an editable source AND rendered renditions — with
// the rendition transforms and the audit rules that flag a flattened picture
// with no source (and a source that was never rendered); the new site/diagram
// relationship kinds and their enforced directions; the standardized-field
// wiring (schema, validation, detail line, unified audit); and the full flow
// through the docs service (create a site, create a diagram from an editable
// source, link them, and see the link from both ends).

import { runTests, assert, assertEq } from "./harness.js";
import { makeWorld, assertThrowsCode } from "./testFixtures.js";
import {
  SITE_TYPES,
  SITE_GROUPS,
  siteType,
  siteTypeLabel,
  sitesOfGroup,
  SITE_FIELDS,
  siteDetailLine,
  validateSite,
  requireSite,
  siteIssues,
} from "../framework/site.js";
import {
  DIAGRAM_TYPES,
  DIAGRAM_GROUPS,
  diagramType,
  diagramTypeLabel,
  diagramsOfGroup,
  RENDITION_FORMATS,
  SOURCE_FORMATS,
  renditionFormat,
  sourceFormat,
  isImageFormat,
  DIAGRAM_FIELDS,
  normalizeRenditions,
  makeRendition,
  diagramRenditions,
  addRendition,
  removeRendition,
  renditionLabel,
  primaryRendition,
  hasEditableSource,
  diagramDetailLine,
  validateDiagram,
  requireDiagram,
  diagramIssues,
} from "../framework/diagram.js";
import { validateLink, relationsOf, RELATIONSHIP_KINDS, relationshipKind } from "../framework/relationships.js";
import {
  RECORD_FIELD_SCHEMAS,
  STANDARDIZED_TYPES,
  validateRecordFields,
  recordDetailLine,
  standardizedIssues,
} from "../framework/standardized.js";

const C = { informationModel: "core-asset", provenance: "authored" };

function makeDocset(records) {
  return { records };
}

export async function run() {
  return runTests([
    {
      name: "the site-type catalog ships the TSP's facility types, grouped",
      fn: () => {
        const ids = SITE_TYPES.map((s) => s.id);
        for (const id of ["datacentre", "comms-room", "colo", "office", "branch", "warehouse", "other"]) {
          assert(ids.includes(id), "ships site type " + id);
        }
        assertEq(SITE_TYPES.length, 7, "seven site types");
        assertEq(SITE_GROUPS.join(","), "Facility,Premises,Other", "three groups, in order");
        assertEq(sitesOfGroup("Facility").length, 3, "three facility types");
        assertEq(sitesOfGroup("Premises").length, 3, "three premises types");
        assertEq(siteTypeLabel("datacentre"), "Data centre", "type label");
        assertEq(siteType("nope"), null, "unknown type is null");
        assertEq(siteTypeLabel("nope"), null, "unknown type has no label");
        // The location reference and the practical notes exist on the schema.
        const keys = SITE_FIELDS.map((f) => f.key);
        assert(keys.includes("siteType"), "schema declares the type");
        assert(keys.includes("locationId"), "schema declares the location reference");
        assertEq(SITE_FIELDS.find((f) => f.key === "siteType").required, true, "site type is required");
        assert(SITE_FIELDS.filter((f) => f.type === "textarea").length >= 5, "several practical note fields");
      },
    },
    {
      name: "a site summary must declare a valid type; requireSite throws INVALID_DATA",
      fn: () => {
        assert(!validateSite({ name: "X" }).ok, "missing type refused");
        assert(!validateSite({ siteType: "nope" }).ok, "unknown type refused");
        assert(validateSite({ siteType: "office" }).ok, "a valid type passes");
        let threw = null;
        try {
          requireSite({ id: "site_1", siteType: "nope" });
        } catch (e) {
          threw = e;
        }
        assert(threw && threw.code === "INVALID_DATA", "requireSite throws INVALID_DATA");
        assert(requireSite({ siteType: "comms-room" }).siteType === "comms-room", "requireSite returns the record");
      },
    },
    {
      name: "siteDetailLine summarises the type, its location and its notes",
      fn: () => {
        const set = makeDocset({ locations: [{ id: "loc_1", type: "locations", name: "HQ" }] });
        assertEq(siteDetailLine({ siteType: "datacentre", locationId: "loc_1" }, set), "Data centre · HQ", "type + location");
        assertEq(siteDetailLine({ siteType: "office" }, set), "Office", "no location, no notes");
        const noted = siteDetailLine({ siteType: "office", accessNotes: "door code", powerNotes: "  ", securityNotes: "CCTV" }, set);
        assert(noted.includes("2 notes"), "counts the populated notes");
        assertEq(siteDetailLine(null, set), "", "null is blank");
      },
    },
    {
      name: "the diagram-type catalog covers network and site drawings, grouped",
      fn: () => {
        const ids = DIAGRAM_TYPES.map((d) => d.id);
        for (const id of ["network-diagram", "rack-diagram", "logical-diagram", "site-map", "floor-plan", "infrastructure-image", "other"]) {
          assert(ids.includes(id), "ships diagram type " + id);
        }
        assertEq(DIAGRAM_TYPES.length, 7, "seven diagram types");
        assertEq(DIAGRAM_GROUPS.join(","), "Network,Site,Other", "three groups");
        assertEq(diagramsOfGroup("Network").length, 3, "three network types");
        assertEq(diagramsOfGroup("Site").length, 3, "three site types");
        assertEq(diagramTypeLabel("site-map"), "Site map", "type label");
        assertEq(diagramType("nope"), null, "unknown type is null");
        // Rendition and source formats, and the image predicate.
        assertEq(renditionFormat("png").image, true, "png is an image");
        assertEq(renditionFormat("pdf").image, false, "pdf is not an image");
        assertEq(isImageFormat("svg"), true, "svg is an image");
        assertEq(isImageFormat("weird"), false, "unknown format is not an image");
        assert(SOURCE_FORMATS.some((f) => f.id === "drawio"), "draw.io is a source format");
        assert(SOURCE_FORMATS.some((f) => f.id === "vsdx"), "Visio is a source format");
        assertEq(sourceFormat("nope"), null, "unknown source is null");
        const keys = DIAGRAM_FIELDS.map((f) => f.key);
        assert(keys.includes("sourceFileName"), "schema declares the editable source file name");
        assert(keys.includes("sourceUrl"), "schema declares the source URL");
        assert(keys.includes("diagramType"), "schema declares the type");
      },
    },
    {
      name: "renditions normalize, transform and select a primary image",
      fn: () => {
        const r = makeRendition({ label: "Client PNG", format: "png", url: "https://x/y.png", bytes: 1234, width: 800, height: 600 });
        assert(r.id.startsWith("rnd_"), "rendition gets an id");
        assertEq(r.format, "png", "format kept");
        assertEq(renditionLabel(r), "Client PNG (PNG)", "label reads naturally");
        const record = { renditions: [r] };
        assertEq(diagramRenditions(record).length, 1, "rendition round-trips");
        assertEq(primaryRendition(record).id, r.id, "the only rendition is primary");
        // addRendition appends, and a PDF is skipped when an image is present.
        const pdf = makeRendition({ format: "pdf", url: "https://x/y.pdf" });
        const svg = makeRendition({ format: "svg", url: "https://x/y.svg" });
        const withTwo = { renditions: [pdf, svg] };
        assertEq(addRendition({ renditions: [pdf] }, svg).length, 2, "addRendition appends");
        assertEq(primaryRendition(withTwo).format, "svg", "the image is preferred over the pdf");
        const removed = removeRendition(withTwo, pdf.id);
        assertEq(removed.length, 1, "removeRendition drops one");
        assertEq(removed[0].format, "svg", "the right one was dropped");
        // An unknown format is coerced to "other"; a missing URL yields no rendition.
        const coerced = normalizeRenditions([{ format: "psd", url: "x" }]);
        assertEq(coerced[0].format, "other", "unknown format coerced");
        assertEq(normalizeRenditions(null).length, 0, "non-list yields nothing");
      },
    },
    {
      name: "a diagram must declare a type and every rendition needs a URL",
      fn: () => {
        assert(!validateDiagram({ name: "X" }).ok, "missing type refused");
        assert(!validateDiagram({ diagramType: "nope" }).ok, "unknown type refused");
        assert(validateDiagram({ diagramType: "network-diagram" }).ok, "a type alone is enough");
        assert(!validateDiagram({ diagramType: "network-diagram", renditions: [{ format: "png", url: "" }] }).ok, "a rendition with no URL refused");
        assert(validateDiagram({ diagramType: "network-diagram", renditions: [makeRendition({ format: "png", url: "https://x/y.png" })] }).ok, "a valid rendition passes");
        let threw = null;
        try {
          requireDiagram({ id: "dia_1", diagramType: "nope" });
        } catch (e) {
          threw = e;
        }
        assert(threw && threw.code === "INVALID_DATA", "requireDiagram throws INVALID_DATA");
      },
    },
    {
      name: "diagramDetailLine reports type, renditions and whether the source is kept",
      fn: () => {
        assertEq(diagramDetailLine({ diagramType: "site-map" }), "Site map · no rendition · no editable source", "bare diagram");
        const withSource = diagramDetailLine({ diagramType: "network-diagram", sourceFileName: "acme.drawio", sourceFormat: "drawio", renditions: [makeRendition({ url: "https://x/y.png" })] });
        assert(withSource.includes("1 rendition"), "counts renditions");
        assert(withSource.includes("acme.drawio"), "names the source file");
        assert(hasEditableSource({ sourceUrl: "https://x/y" }), "a URL is an editable source");
        assert(hasEditableSource({ sourceFileName: "x.drawio" }), "a file name is an editable source");
        assert(!hasEditableSource({}), "no source fields means no source");
      },
    },
    {
      name: "the site and diagram audits flag unknown types, missing locations and lost sources",
      fn: () => {
        const set = makeDocset({
          locations: [{ id: "loc_1", type: "locations", name: "HQ" }],
          sites: [
            { id: "site_1", type: "sites", name: "Unknown", siteType: "nope" },
            { id: "site_2", type: "sites", name: "No location", siteType: "office" },
            { id: "site_3", type: "sites", name: "Bad location", siteType: "office", locationId: "loc_missing" },
            { id: "site_4", type: "sites", name: "Fine", siteType: "datacentre", locationId: "loc_1" },
          ],
          diagrams: [
            { id: "dia_1", type: "diagrams", name: "Unknown", diagramType: "nope" },
            { id: "dia_2", type: "diagrams", name: "Flattened", diagramType: "network-diagram", renditions: [makeRendition({ url: "https://x/y.png" })] },
            { id: "dia_3", type: "diagrams", name: "Unrendered", diagramType: "network-diagram", sourceFileName: "a.drawio" },
            { id: "dia_4", type: "diagrams", name: "Fine", diagramType: "network-diagram", sourceFileName: "a.drawio", renditions: [makeRendition({ url: "https://x/y.png" })] },
          ],
        });
        const si = siteIssues(set);
        assert(si.some((i) => i.code === "unknown-site-type" && i.recordId === "site_1" && i.level === "error"), "unknown site type flagged");
        assert(si.some((i) => i.code === "site-without-location" && i.recordId === "site_2" && i.level === "warning"), "site with no location flagged");
        assert(si.some((i) => i.code === "missing-site-location" && i.recordId === "site_3" && i.level === "error"), "dangling location flagged");
        assert(!si.some((i) => i.recordId === "site_4"), "a fine site is not flagged");
        const di = diagramIssues(set);
        assert(di.some((i) => i.code === "unknown-diagram-type" && i.recordId === "dia_1" && i.level === "error"), "unknown diagram type flagged");
        assert(di.some((i) => i.code === "rendition-without-source" && i.recordId === "dia_2" && i.level === "warning"), "rendition with no source flagged");
        assert(di.some((i) => i.code === "source-without-rendition" && i.recordId === "dia_3" && i.level === "info"), "source with no rendition noted");
        assert(!di.some((i) => i.recordId === "dia_4"), "a complete diagram is not flagged");
      },
    },
    {
      name: "the site & diagram relationship kinds exist and enforce their direction",
      fn: () => {
        for (const kind of ["site-location", "site-contact", "site-diagram", "site-asset", "diagram-location", "diagram-asset", "diagram-document"]) {
          assert(relationshipKind(kind), "kind exists: " + kind);
        }
        assertEq(relationshipKind("site-diagram").from.join(","), "sites", "site-diagram starts at a site");
        assertEq(relationshipKind("site-diagram").to.join(","), "diagrams", "site-diagram points at a diagram");
        const set = makeDocset({
          sites: [{ id: "site_1", type: "sites", name: "HQ" }],
          diagrams: [{ id: "dia_1", type: "diagrams", name: "Net" }],
          locations: [{ id: "loc_1", type: "locations", name: "HQ loc" }],
        });
        assert(validateLink(set, { from: { type: "sites", id: "site_1" }, to: { type: "diagrams", id: "dia_1" }, kind: "site-diagram" }).ok, "site → diagram allowed");
        const backwards = validateLink(set, { from: { type: "diagrams", id: "dia_1" }, to: { type: "sites", id: "site_1" }, kind: "site-diagram" });
        assert(!backwards.ok, "diagram → site refused (wrong direction)");
        assert(validateLink(set, { from: { type: "diagrams", id: "dia_1" }, to: { type: "locations", id: "loc_1" }, kind: "diagram-location" }).ok, "diagram → location allowed");
        assert(!validateLink(set, { from: { type: "sites", id: "site_1" }, to: { type: "sites", id: "site_1" }, kind: "site-diagram" }).ok, "self-link refused");
        const dupSet = { records: { ...set.records, relationships: [{ id: "r1", kind: "site-diagram", from: { type: "sites", id: "site_1" }, to: { type: "diagrams", id: "dia_1" } }] } };
        assert(!validateLink(dupSet, { from: { type: "sites", id: "site_1" }, to: { type: "diagrams", id: "dia_1" }, kind: "site-diagram" }).ok, "duplicate link refused");
      },
    },
    {
      name: "the standardized registry validates and summarises sites and diagrams",
      fn: () => {
        assert(RECORD_FIELD_SCHEMAS.sites, "sites has a field schema");
        assert(RECORD_FIELD_SCHEMAS.diagrams, "diagrams has a field schema");
        assert(STANDARDIZED_TYPES.includes("sites"), "sites is standardized");
        assert(STANDARDIZED_TYPES.includes("diagrams"), "diagrams is standardized");
        assert(!validateRecordFields("sites", { name: "X" }).ok, "site validation wired in");
        assert(validateRecordFields("sites", { name: "X", siteType: "office" }).ok, "valid site passes");
        assert(!validateRecordFields("diagrams", { name: "X" }).ok, "diagram validation wired in");
        assert(validateRecordFields("diagrams", { name: "X", diagramType: "site-map" }).ok, "valid diagram passes");
        assertEq(recordDetailLine({ type: "sites", siteType: "office" }, null), "Office", "site detail line wired");
        assertEq(recordDetailLine({ type: "diagrams", diagramType: "site-map" }), "Site map · no rendition · no editable source", "diagram detail line wired");
        const issues = standardizedIssues(makeDocset({ sites: [{ id: "s1", type: "sites", name: "Bad", siteType: "nope" }], diagrams: [{ id: "d1", type: "diagrams", name: "Bad", diagramType: "nope" }] }));
        assert(issues.some((i) => i.code === "unknown-site-type"), "unified audit includes sites");
        assert(issues.some((i) => i.code === "unknown-diagram-type"), "unified audit includes diagrams");
      },
    },
    {
      name: "a site and a diagram are created, linked and seen from both ends through the docs service",
      fn: async () => {
        const { docs } = await makeWorld("kb-site-flow");
        const set = await docs.create({ name: "Acme" });
        const loc = (await docs.addRecord(set.id, { type: "locations", name: "HQ Ground Floor", locationType: "office", ...C })).record;
        const site = (await docs.addRecord(set.id, { type: "sites", name: "HQ Data Centre", siteType: "datacentre", locationId: loc.id, accessNotes: "Door code 4417", ...C })).record;
        assert(site.id.startsWith("site_"), "site id prefix");
        const dia = (await docs.addRecord(set.id, {
          type: "diagrams",
          name: "HQ network",
          diagramType: "network-diagram",
          sourceFileName: "hq-network.drawio",
          sourceFormat: "drawio",
          renditions: [makeRendition({ format: "png", url: "https://x/hq.png" })],
          ...C,
        })).record;
        assert(dia.id.startsWith("dia_"), "diagram id prefix");
        await docs.linkRecords(set.id, { from: { type: "sites", id: site.id }, to: { type: "diagrams", id: dia.id }, kind: "site-diagram" });
        const live = await docs.get(set.id);
        assertEq(live.records.sites.length, 1, "site persisted");
        assertEq(live.records.diagrams.length, 1, "diagram persisted");
        assertEq(live.records.diagrams[0].renditions.length, 1, "rendition persisted");
        const siteLinks = relationsOf(live, { type: "sites", id: site.id });
        assertEq(siteLinks.length, 1, "site reports one link");
        assertEq(siteLinks[0].direction, "out", "site is the link's source");
        assertEq(siteLinks[0].other.id, dia.id, "the far end is the diagram");
        const diaLinks = relationsOf(live, { type: "diagrams", id: dia.id });
        assertEq(diaLinks.length, 1, "diagram reports the same link");
        assertEq(diaLinks[0].direction, "in", "diagram is the link's target");
        assertEq(diaLinks[0].other.id, site.id, "the far end is the site");
        // A location may not be linked as a site.
        await assertThrowsCode(() => docs.linkRecords(set.id, { from: { type: "diagrams", id: dia.id }, to: { type: "sites", id: site.id }, kind: "site-diagram" }), "INVALID_DATA", "wrong direction refused");
        // Removing the site cascades the link away.
        const res = await docs.removeRecord(set.id, { type: "sites", id: site.id });
        assertEq(res.cascaded, 1, "the site-diagram link was cascaded");
        assertEq(res.removed.id, site.id, "the right record was removed");
      },
    },
    {
      name: "all seven new relationship kinds are registered with unique ids",
      fn: () => {
        const ids = RELATIONSHIP_KINDS.map((k) => k.id);
        assertEq(new Set(ids).size, ids.length, "no duplicate relationship-kind ids");
        for (const kind of RELATIONSHIP_KINDS) {
          assert(Array.isArray(kind.from) && kind.from.length, kind.id + " has a from list");
          assert(Array.isArray(kind.to) && kind.to.length, kind.id + " has a to list");
        }
      },
    },
  ]);
}

