// src/tests/library.test.js — validation tests for Phase 8 task 35 (the
// in-application library of service processes and operational topics). Run in
// the live page:
//   await import("./src/tests/library.test.js").then((m) => m.run())
//
// Covers: the catalog's integrity (unique ids, valid topics/audiences,
// resolvable related links, real document types, shipped asset templates); the
// topic/audience lookups; the filtering and free-text search; the cross-link
// reads the asset profile and document editor use (libraryForAssetType /
// libraryForDocType); the "usable as written or adapted" half — adapting an
// article into a real document via articleToDocumentInput, which must satisfy
// validateDocument and land in a client's set through addDocument; and the
// Library station's registration in the module registry.

import { runTests, assert, assertEq } from "./harness.js";
import { makeWorld } from "./testFixtures.js";
import { BUILTIN_ASSET_TYPE_IDS } from "../framework/assetLibrary.js";
import { documentType, validateDocument } from "../framework/document.js";
import modules from "../modules/index.js";
import {
  LIBRARY_TOPICS,
  LIBRARY_TOPIC_IDS,
  LIBRARY_AUDIENCES,
  LIBRARY_ARTICLES,
  LIBRARY_ARTICLE_IDS,
  libraryTopic,
  libraryTopicLabel,
  libraryAudience,
  libraryArticle,
  libraryArticleExists,
  libraryArticles,
  libraryForAssetType,
  libraryForDocType,
  searchLibrary,
  relatedLibraryArticles,
  libraryStats,
  libraryAssetTypeIds,
  articleDocumentType,
  articleToDocumentInput,
  articleInsertionText,
} from "../framework/library.js";

const iso = (v) => JSON.stringify(v == null ? null : v);

export async function run() {
  return runTests([
    {
      name: "the library catalog is well formed — unique ids, valid topics, audiences, doc types and asset links",
      fn: () => {
        assert(LIBRARY_TOPICS.length >= 8, "the library has a broad set of topics");
        assert(LIBRARY_ARTICLES.length >= 20, "the library has a substantial set of articles");

        assertEq(new Set(LIBRARY_TOPIC_IDS).size, LIBRARY_TOPIC_IDS.length, "topic ids are unique");
        assertEq(new Set(LIBRARY_ARTICLE_IDS).size, LIBRARY_ARTICLE_IDS.length, "article ids are unique");
        assert(LIBRARY_TOPICS.every((t) => t.id && t.label && t.description), "every topic is labelled");
        assert(LIBRARY_AUDIENCES.every((a) => a.id && a.label && a.description), "every audience is labelled");

        const audiencesUsed = new Set();
        for (const a of LIBRARY_ARTICLES) {
          assert(typeof a.title === "string" && a.title.length > 3, "article " + a.id + " has a title");
          assert(typeof a.summary === "string" && a.summary.length > 10, "article " + a.id + " has a summary");
          assert(LIBRARY_TOPIC_IDS.includes(a.topic), "article " + a.id + " has a valid topic");
          assert(LIBRARY_AUDIENCES.some((x) => x.id === a.audience), "article " + a.id + " has a valid audience");
          audiencesUsed.add(a.audience);
          assert(Array.isArray(a.tags) && a.tags.length >= 1, "article " + a.id + " is tagged");
          assert(typeof a.body === "string" && a.body.length > 40, "article " + a.id + " has a body");
          assert(Array.isArray(a.assetTypeIds) && Array.isArray(a.docTypes) && Array.isArray(a.related), "article " + a.id + " has well-formed cross-links");
          for (const tid of a.assetTypeIds) assert(BUILTIN_ASSET_TYPE_IDS.includes(tid), "article " + a.id + " links only shipped asset templates (" + tid + ")");
          for (const d of a.docTypes) assert(!!documentType(d), "article " + a.id + " reads as a real document type (" + d + ")");
          for (const r of a.related) {
            assert(libraryArticleExists(r), "article " + a.id + " related link resolves (" + r + ")");
            assert(r !== a.id, "article " + a.id + " is not related to itself");
          }
        }
        assertEq(audiencesUsed.size, LIBRARY_AUDIENCES.length, "every audience has at least one article");

        const stats = libraryStats();
        for (const tid of LIBRARY_TOPIC_IDS) assert(stats.byTopic[tid] >= 1, "topic “" + tid + "” has at least one article");
      },
    },
    {
      name: "topic and audience lookups resolve, and unknown ids are handled",
      fn: () => {
        assertEq(libraryTopic("voice").label, "Voice & telephony", "topic lookup");
        assertEq(libraryTopic("bogus"), null, "an unknown topic is null");
        assertEq(libraryTopicLabel("voice"), "Voice & telephony", "topic label");
        assertEq(libraryTopicLabel("bogus"), "bogus", "an unknown topic falls back to its id");
        assertEq(libraryAudience("client").label, "Client-facing", "audience lookup");
        assertEq(libraryArticle("voip-deployment").title, "VoIP deployment process", "article lookup");
        assertEq(libraryArticle("nope"), null, "an unknown article is null");
        assert(libraryArticleExists("voip-deployment"), "an existing article is found");
        assert(!libraryArticleExists("nope"), "an unknown article is not found");
      },
    },
    {
      name: "libraryArticles filters by topic, audience, asset template, document type and query",
      fn: () => {
        const stats = libraryStats();
        const voice = libraryArticles({ topic: "voice" });
        assertEq(voice.length, stats.byTopic.voice, "topic filter matches the topic count");
        assert(voice.every((a) => a.topic === "voice"), "every topic-filtered article has the topic");

        const tech = libraryArticles({ audience: "technician" });
        assert(tech.length >= 5 && tech.every((a) => a.audience === "technician"), "audience filter works");

        const backup = libraryForAssetType("atype-backup-service");
        assert(backup.length >= 3, "several articles support the backup service template");
        assert(backup.every((a) => a.assetTypeIds.includes("atype-backup-service")), "the asset cross-link is exact");
        assertEq(iso(backup), iso(libraryArticles({ assetTypeId: "atype-backup-service" })), "libraryForAssetType mirrors libraryArticles");

        const sops = libraryForDocType("sop");
        assert(sops.length >= 5 && sops.every((a) => a.docTypes.includes("sop")), "the document cross-link is exact");

        const two = libraryArticles({ ids: ["backup-design", "restore-test"] });
        assertEq(two.length, 2, "the id filter restricts to the named articles");
        assertEq(libraryArticles({ ids: "backup-design" }).length, 1, "a single id string is accepted");

        const combo = libraryArticles({ topic: "voice", assetTypeId: "atype-voice-pbx" });
        assert(combo.length >= 3 && combo.every((a) => a.topic === "voice"), "filters combine");
      },
    },
    {
      name: "free-text search matches titles, summaries and tags",
      fn: () => {
        assert(searchLibrary("porting").some((a) => a.id === "number-porting"), "search finds an article by title/summary");
        assert(searchLibrary("  MFA  ").some((a) => a.id === "mfa-rollout"), "search trims and is case-insensitive");
        const dr = searchLibrary("disaster");
        assert(dr.every((a) => (a.title + " " + a.summary + " " + a.tags.join(" ")).toLowerCase().includes("disaster")), "every result actually matches");
        assertEq(searchLibrary("zzzznotathing").length, 0, "a non-match returns nothing");
        assert(searchLibrary("voip", { topic: "voice" }).every((a) => a.topic === "voice"), "search combines with other filters");
      },
    },
    {
      name: "related articles resolve and the stats describe the catalog",
      fn: () => {
        const art = libraryArticle("backup-design");
        const related = relatedLibraryArticles(art);
        assert(related.some((a) => a.id === "restore-test"), "a declared related article resolves to its record");
        assertEq(relatedLibraryArticles(null).length, 0, "no article, no related list");

        const stats = libraryStats();
        assertEq(stats.articles, LIBRARY_ARTICLES.length, "article count");
        assertEq(stats.topics, LIBRARY_TOPICS.length, "topic count");
        const assetLinks = LIBRARY_ARTICLES.reduce((n, a) => n + a.assetTypeIds.length, 0);
        const docLinks = LIBRARY_ARTICLES.reduce((n, a) => n + a.docTypes.length, 0);
        assertEq(stats.assetTypeLinks, assetLinks, "asset-link count");
        assertEq(stats.docTypeLinks, docLinks, "document-link count");

        const used = libraryAssetTypeIds();
        assertEq(new Set(used).size, used.length, "the asset-link set is unique");
        assert(used.every((id) => BUILTIN_ASSET_TYPE_IDS.includes(id)), "every linked template exists");
        assert(used.every((id) => libraryForAssetType(id).length >= 1), "every listed template has articles");
      },
    },
    {
      name: "an article adapts into a valid document — the “as written or adapted” path",
      fn: () => {
        for (const a of LIBRARY_ARTICLES) {
          assert(!!documentType(articleDocumentType(a)), "article " + a.id + " picks a real default document type");
        }
        const a = libraryArticle("voip-deployment");
        const input = articleToDocumentInput(a);
        assertEq(input.name, a.title, "the document keeps the article's title");
        assertEq(input.body, a.body, "the document starts from the article's body");
        assertEq(input.docType, "deployment", "the default type is the article's first real document type");
        assertEq(input.summary, a.summary, "the summary carries over");
        assertEq(iso(input.tags), iso(a.tags), "the tags carry over");
        assertEq(input.provenance, "authored", "the adapted document is authored");
        assertEq(input.informationModel, "document", "the adapted document is classified as a document");
        const type = documentType(input.docType);
        assert(validateDocument({ ...input, reviewIntervalDays: type.reviewIntervalDays }).ok, "the adapted input satisfies validateDocument");

        const overridden = articleToDocumentInput(a, { name: "Acme cutover", docType: "sop", body: "# Custom", tags: ["x"] });
        assertEq(overridden.name, "Acme cutover", "the title can be overridden");
        assertEq(overridden.docType, "sop", "the type can be overridden");
        assertEq(overridden.body, "# Custom", "the body can be overridden");
        assertEq(iso(overridden.tags), iso(["x"]), "the tags can be overridden");
        assertEq(articleToDocumentInput(null), null, "no article, no input");

        const insert = articleInsertionText(a);
        assert(insert.includes(a.title) && insert.includes(a.body), "the insertion text carries the article's title and body");
        assert(insert.includes("library"), "the insertion text records its provenance");
      },
    },
    {
      name: "an adapted article lands in a client's documentation set as a real document",
      fn: async () => {
        const world = makeWorld({ namespace: "kb-library" });
        const { docs } = world;
        const set = await docs.create({ name: "Acme" });
        const a = libraryArticle("voip-deployment");
        const res = await docs.addDocument(set.id, articleToDocumentInput(a), { updatedBy: "tester" });
        assertEq(res.record.docType, "deployment", "the document got the article's type");
        assertEq(res.record.body, a.body, "the document got the article's body verbatim");
        assertEq(iso(res.record.tags), iso(a.tags), "the document got the article's tags");
        assertEq(res.record.revision, 1, "it starts at revision 1");
        const stored = await docs.get(set.id, { force: true });
        assertEq(stored.records.documents.length, 1, "the document is stored in the set");
      },
    },
    {
      name: "the Library station is registered in the right place in the shell",
      fn: () => {
        const lib = modules.find((m) => m.id === "library");
        assert(lib, "a library station exists");
        assertEq(lib.label, "Library", "the station is labelled Library");
        assert(typeof lib.render === "function", "the station renders a list");
        assert(typeof lib.renderDetail === "function", "the station renders a detail route");
        const ids = modules.map((m) => m.id);
        assertEq(ids.indexOf("library"), ids.indexOf("services") + 1, "the library sits after Services, before Deployments");
        assertEq(ids.indexOf("library"), ids.indexOf("deployments") - 1, "…and immediately before Deployments");
      },
    },
  ]);
}
