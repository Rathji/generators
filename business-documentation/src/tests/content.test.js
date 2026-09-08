// src/tests/content.test.js — validation tests for the content layer
// (roadmap tasks 4-36: backup/restore, capacity, articles & versioning,
// categories, templates, snippets, SOP blocks, review workflow, search,
// related/backlinks, stale review scheduling, integrity + consistency checks,
// bundles, feedback, audit). Runs against an ISOLATED in-memory store so it
// never touches the live KB's data. Run in the live page:
//   await import("./src/tests/content.test.js").then((m) => m.run())

import { runTests, assert, assertEq } from "./harness.js";
import { createDocumentStore } from "../framework/store/index.js";
import { createMemoryChannel, createMemoryCache } from "../framework/store/backends.js";
import { createContentService } from "../framework/content.js";

async function freshContent() {
  const cache = createMemoryCache();
  cache._deviceId = "test-device";
  const channel = createMemoryChannel();
  const store = createDocumentStore({ namespace: "kb-test", channel, cache });
  const content = createContentService({ store, cache, activity: null, uploadPlugin: null, generatorName: "test-kb" });
  const seedCats = () => [
    { id: "ops", label: "Operations", children: [{ id: "ops-it", label: "IT Ops", children: [] }] },
    { id: "hr", label: "People & HR", children: [] },
  ];
  await store.ensureMany({
    categories: seedCats,
    templates: { items: [] },
    snippets: { items: [] },
    articles: { items: [] },
    reviewLog: { entries: [] },
    auditLog: { entries: [] },
    settings: {},
  });
  await content.seedDefaultTemplates();
  return { store, cache, channel, content };
}

const mkBody = (title) => `# ${title}\n\nBody text about ${title.toLowerCase()}.\n\n## Procedure\n\nStep one.\nStep two.\n`;
const DAY = 86400000;

export async function run() {
  const { store, cache, channel, content } = await freshContent();
  const T = [];

  // ---- articles + versioning (task 6) -------------------------------------
  T.push({
    name: "createArticle seeds body from template and saves v1",
    fn: async () => {
      const a = await content.createArticle({ docType: "how-to", categoryId: "ops", owner: "Mia", by: "Mia" });
      assert(a.id, "has id");
      assertEq(a.status, "draft", "starts as draft");
      assert(a.body.length > 0, "template body seeded");
      assertEq(a.versions.length, 1, "v1 recorded");
      const art = await content.getArticle(a.id);
      assertEq(art.title, "Untitled", "template title fallback");
    },
  });

  T.push({
    name: "saveArticle appends a version only when content changes",
    fn: async () => {
      const a = await content.createArticle({ docType: "policy", by: "Mia" });
      const v1 = a.versions.length;
      const same = await content.saveArticle({ ...a, title: a.title }, { by: "Mia" });
      assertEq(same.versions.length, v1, "no-op save adds no version");
      const changed = await content.saveArticle({ ...a, title: "Updated Policy Title" }, { by: "Mia" });
      assertEq(changed.versions.length, v1 + 1, "content change appends version");
      const latest = changed.versions[changed.versions.length - 1];
      assert(latest.summary && latest.summary.length > 0, "version has a summary");
    },
  });

  // ---- review workflow (task 13) -------------------------------------------
  T.push({
    name: "full review lifecycle: submit -> approve -> published with publishedVersion",
    fn: async () => {
      const a = await content.createArticle({ docType: "sop", by: "Mia" });
      await content.submitForReview(a.id, "Mia");
      let rec = await content.getArticle(a.id);
      assertEq(rec.status, "in_review", "submitted");
      const out = await content.approveArticle(a.id, "Ravi", "Looks good");
      assertEq(out.to, "published", "approved");
      rec = await content.getArticle(a.id);
      assertEq(rec.publishedVersion, 2, "publishedVersion is the approved (transitioned) version");
      assert(rec.reviewedAt, "reviewedAt stamped on approval");
      const log = await content.reviewHistory(a.id);
      assert(log.some((e) => e.action === "approve"), "review log records approval");
    },
  });

  T.push({
    name: "return sends an in-review article back to draft",
    fn: async () => {
      const a = await content.createArticle({ by: "Mia" });
      await content.submitForReview(a.id, "Mia");
      await content.returnArticle(a.id, "Ravi", "Needs more detail");
      const rec = await content.getArticle(a.id);
      assertEq(rec.status, "draft", "returned to draft");
    },
  });

  T.push({
    name: "invalid transitions are rejected",
    fn: async () => {
      const a = await content.createArticle({ by: "Mia" });
      let threw = false;
      try {
        await content.approveArticle(a.id, "Ravi");
      } catch {
        threw = true;
      }
      assert(threw, "approving a draft throws");
    },
  });

  T.push({
    name: "editing a published article becomes an in_review revision; live content stays at approved version",
    fn: async () => {
      const a = await content.createArticle({ docType: "reference", by: "Mia" });
      await content.submitForReview(a.id, "Mia");
      await content.approveArticle(a.id, "Ravi");
      const published = await content.getArticle(a.id);
      const approvedVersion = published.publishedVersion;
      const edited = await content.saveArticle(
        { ...published, title: published.title + " (rev 2)" },
        { by: "Mia" },
      );
      assertEq(edited.status, "in_review", "revision routed through review");
      assertEq(edited.publishedVersion, approvedVersion, "publishedVersion preserved");
      const live = content.liveContent(edited);
      assertEq(live.pendingRevision, true, "reader sees pending-revision state");
      assertEq(live.data.title, published.title, "live content stays at the approved version");
      const snap = edited.versions.find((v) => v.n === approvedVersion);
      assert(snap && snap.data.title === published.title, "approved version snapshot intact");
    },
  });

  // ---- archive / restore (task 4/6) -----------------------------------------
  T.push({
    name: "archive a published article, then restore as draft",
    fn: async () => {
      const a = await content.createArticle({ by: "Mia" });
      await content.submitForReview(a.id, "Mia");
      await content.approveArticle(a.id, "Ravi");
      await content.archiveArticle(a.id, "Mia");
      let rec = await content.getArticle(a.id);
      assertEq(rec.status, "archived", "archived");
      await content.restoreArticle(a.id, "Mia");
      rec = await content.getArticle(a.id);
      assertEq(rec.status, "draft", "restored as draft");
    },
  });

  T.push({
    name: "restoreVersion creates a new draft without overwriting live content",
    fn: async () => {
      const a = await content.createArticle({ by: "Mia" });
      await content.submitForReview(a.id, "Mia");
      await content.approveArticle(a.id, "Ravi");
      const pub = await content.getArticle(a.id);
      await content.saveArticle({ ...pub, title: pub.title + " v3" }, { by: "Mia" }); // -> in_review
      const rec = await content.getArticle(a.id);
      const target = rec.versions[1].n;
      const restored = await content.restoreVersion(a.id, target, "Mia");
      assertEq(restored.status, "in_review", "restoring a published doc routes a revision");
      assert(restored.title === rec.versions[1].data.title, "title from target version");
      assert(restored.publishedVersion === rec.publishedVersion, "live content untouched");
      assertEq(restored.versions.length, rec.versions.length + 1, "restore appends a version");
    },
  });

  // ---- categories (task 7) ----------------------------------------------------
  T.push({
    name: "category add / rename / move / path works",
    fn: async () => {
      await content.addCategory({ id: "fin", label: "Finance", parentId: "" });
      await content.renameCategory("fin", "Finance & Billing");
      await content.addCategory({ id: "fin-tax", label: "Tax", parentId: "fin" });
      const tree = await content.getCategoryTree();
      const fin = tree.find((n) => n.id === "fin");
      assert(fin, "finance category added");
      assertEq(fin.label, "Finance & Billing", "renamed");
      assertEq(fin.children[0].id, "fin-tax", "nested child");
      assertEq((await content.categoryPath("fin-tax")).join(" / "), "Finance & Billing / Tax", "path");
      await content.moveCategory("fin-tax", "ops");
      const t2 = await content.getCategoryTree();
      const ops = t2.find((n) => n.id === "ops");
      assert(ops.children.some((c) => c.id === "fin-tax"), "moved under ops");
      const newId = "fin-" + Date.now().toString(36);
      await content.addCategory({ id: newId, label: "Empty", parentId: "" });
      await content.deleteCategory(newId);
      const t3 = await content.getCategoryTree();
      assert(!t3.some((n) => n.id === newId), "empty category deleted");
    },
  });

  T.push({
    name: "deleting a category that has articles is blocked",
    fn: async () => {
      const a = await content.createArticle({ categoryId: "hr", by: "Mia" });
      let threw = false;
      try {
        await content.deleteCategory("hr");
      } catch {
        threw = true;
      }
      assert(threw, "delete blocked when articles reference it");
      const tree = await content.getCategoryTree();
      assert(tree.some((n) => n.id === "hr"), "category still present");
      await content.deleteArticle(a.id);
    },
  });

  // ---- templates (task 8) -------------------------------------------------------
  T.push({
    name: "default templates seed per doc type and can be overridden",
    fn: async () => {
      const tpl = await content.getTemplate("sop");
      assert(tpl && tpl.body.includes("# Purpose"), "sop template has structure");
      assert(await content.getTemplate("faq"), "faq template exists");
      await content.saveTemplate({ id: "tpl-how-to", docType: "how-to", body: "# Custom", updatedAt: Date.now() });
      const custom = await content.getTemplate("how-to");
      assertEq(custom.body, "# Custom", "template overridden");
    },
  });

  // ---- snippets (task 12) ----------------------------------------------------------
  T.push({
    name: "snippet CRUD",
    fn: async () => {
      await content.saveSnippet({ id: "sn-1", title: "Greeting", text: "Hello world" });
      await content.saveSnippet({ id: "sn-2", title: "Sign-off", text: "Regards, KB team" });
      let all = await content.listSnippets();
      assertEq(all.length, 2, "two snippets");
      await content.deleteSnippet("sn-1");
      all = await content.listSnippets();
      assertEq(all.length, 1, "deleted one");
      assertEq(all[0].id, "sn-2", "remaining snippet");
    },
  });

  // ---- search (task 18) --------------------------------------------------------------
  T.push({
    name: "search ranks title matches above body matches and applies filters",
    fn: async () => {
      await content.saveArticle({ id: "art-s1", title: "VPN Access Request", docType: "how-to", categoryId: "ops", tags: ["vpn"], summary: "Requesting VPN access", body: "Fill the form and wait.", status: "published", publishedVersion: 1, versions: [{ n: 1, at: Date.now(), data: {} }] }, { by: "system" });
      await content.saveArticle({ id: "art-s2", title: "Laptop Setup", docType: "how-to", categoryId: "ops", tags: ["hardware"], summary: "Setting up a laptop", body: "VPN is installed during laptop setup. The VPN client must be configured.", status: "published", publishedVersion: 1, versions: [{ n: 1, at: Date.now(), data: {} }] }, { by: "system" });
      const res = await content.searchArticles("VPN", { articles: await content.listArticles(), categoryTree: await content.getCategoryTree() });
      assert(res.length >= 2, "both match");
      assertEq(res[0].article.id, "art-s1", "title match ranks first");
      const onlySop = await content.searchArticles("laptop", { articles: await content.listArticles(), docType: "sop" });
      assertEq(onlySop.length, 0, "docType filter excludes how-to");
      const inOps = await content.searchArticles("vpn", { articles: await content.listArticles(), categoryId: "ops", categoryTree: await content.getCategoryTree() });
      assertEq(inOps.length, 2, "category filter includes descendants of ops");
      assertEq(inOps[0].article.id, "art-s1", "title match ranks first within category");
      const inIt = await content.searchArticles("vpn", { articles: await content.listArticles(), categoryId: "ops-it", categoryTree: await content.getCategoryTree() });
      assertEq(inIt.length, 0, "subcategory filter does not include ancestors");
    },
  });

  // ---- related / backlinks (tasks 20, 11) ---------------------------------------------
  T.push({
    name: "relatedArticles finds shared-tag articles; backlinks detects explicit links",
    fn: async () => {
      // art-r1 links to art-s1 → shows as a backlink
      await content.saveArticle({ id: "art-r1", title: "Security Policies", docType: "policy", tags: ["security"], body: "See [[VPN Access Request|art-s1]] for access details.", status: "published", publishedVersion: 1, versions: [{ n: 1, at: Date.now(), data: {} }] }, { by: "system" });
      // art-r2 shares the vpn tag with art-s1 → related
      await content.saveArticle({ id: "art-r2", title: "VPN Troubleshooting", docType: "reference", tags: ["vpn"], body: "Common VPN issues.", status: "published", publishedVersion: 1, versions: [{ n: 1, at: Date.now(), data: {} }] }, { by: "system" });
      const rel = await content.relatedArticles("art-s1", { articles: await content.listArticles() });
      assert(rel.some((a) => a.id === "art-r2"), "related finds shared-tag article");
      assert(!rel.some((a) => a.id === "art-r1"), "plain link is not auto-related — backlinks covers it");
      const back = await content.backlinks("art-s1", { articles: await content.listArticles() });
      assert(back.some((a) => a.id === "art-r1"), "backlink detected");
    },
  });

  // ---- stale review schedule (task 16) ------------------------------------------------
  T.push({
    name: "staleArticles flags past-due published docs; daysOverdue counts days",
    fn: async () => {
      // Use a content service whose clock is 500 days in the past, so an
      // article approved on it becomes overdue once real time is considered.
      const past = Date.now() - 500 * DAY;
      const cacheS = createMemoryCache();
      const storeS = createDocumentStore({ namespace: "kb-stale", channel: createMemoryChannel(), cache: cacheS });
      const contentS = createContentService({ store: storeS, cache: cacheS, activity: null, uploadPlugin: null, now: () => past });
      await storeS.ensureMany({
        categories: () => [{ id: "ops", children: [] }],
        templates: { items: [] },
        snippets: { items: [] },
        articles: { items: [] },
        reviewLog: { entries: [] },
        auditLog: { entries: [] },
        settings: {},
      });
      const old = await contentS.createArticle({ by: "Mia" });
      old.reviewIntervalDays = 365;
      await contentS.saveArticle(old, { by: "Mia" });
      await contentS.submitForReview(old.id, "Mia");
      await contentS.approveArticle(old.id, "Ravi");
      // a fresh article on a real-clock store must NOT be flagged stale
      const cacheR = createMemoryCache();
      const storeR = createDocumentStore({ namespace: "kb-fresh", channel: createMemoryChannel(), cache: cacheR });
      const contentR = createContentService({ store: storeR, cache: cacheR, activity: null, uploadPlugin: null });
      await storeR.ensureMany({
        categories: () => [{ id: "ops", children: [] }],
        templates: { items: [] },
        snippets: { items: [] },
        articles: { items: [] },
        reviewLog: { entries: [] },
        auditLog: { entries: [] },
        settings: {},
      });
      const fresh = await contentR.createArticle({ by: "Mia" });
      await contentR.submitForReview(fresh.id, "Mia");
      await contentR.approveArticle(fresh.id, "Ravi");
      const combined = [...(await contentS.listArticles()), ...(await contentR.listArticles())];
      const stale = await contentS.staleArticles(combined);
      assert(stale.some((a) => a.id === old.id), "old article flagged stale");
      assert(!stale.some((a) => a.id === fresh.id), "fresh article not flagged");
      const od = await contentS.daysOverdue(old);
      assert(od >= 135, "overdue days computed (" + od + ")");
    },
  });

  T.push({
    name: "markReviewed refreshes the review date & clears staleness; sendForReReview re-enters the workflow",
    fn: async () => {
      // Create a published article with a PAST clock so it's overdue; then a
      // real-clock service (same store) marks it reviewed / re-reviews it.
      const past = Date.now() - 500 * DAY;
      const cacheS = createMemoryCache();
      const storeS = createDocumentStore({ namespace: "kb-rev", channel: createMemoryChannel(), cache: cacheS });
      const contentS = createContentService({ store: storeS, cache: cacheS, activity: null, uploadPlugin: null, now: () => past });
      await storeS.ensureMany({
        categories: () => [{ id: "ops", children: [] }],
        templates: { items: [] },
        snippets: { items: [] },
        articles: { items: [] },
        reviewLog: { entries: [] },
        auditLog: { entries: [] },
        settings: {},
      });
      const a = await contentS.createArticle({ by: "Mia" });
      await contentS.saveArticle({ ...a, reviewIntervalDays: 30 }, { by: "Mia" });
      await contentS.submitForReview(a.id, "Mia");
      await contentS.approveArticle(a.id, "Ravi");
      const pv = (await contentS.getArticle(a.id)).publishedVersion;
      let rec = await contentS.getArticle(a.id);
      assert(rec.reviewedAt < Date.now() - 100 * DAY, "aged for staleness (approved in the past)");
      assert((await contentS.staleArticles([rec])).some((x) => x.id === a.id), "flagged stale");
      const contentReal = createContentService({ store: storeS, cache: cacheS, activity: null, uploadPlugin: null });
      await contentReal.markReviewed(a.id, "Ravi");
      rec = await contentReal.getArticle(a.id);
      assert(Date.now() - rec.reviewedAt < 60000, "review date refreshed to now");
      assert(!(await contentReal.staleArticles([rec])).some((x) => x.id === a.id), "no longer stale");
      await contentReal.sendForReReview(a.id, "Mia");
      rec = await contentReal.getArticle(a.id);
      assertEq(rec.status, "in_review", "re-entered the workflow");
      assertEq(rec.flags && rec.flags.revisionOf, pv, "revision flagged against published v" + pv);
      const log = await contentReal.listAudit();
      assert(log.some((x) => x.action === "reviewed-no-change"), "audited reviewed-no-change");
      assert(log.some((x) => x.action === "sent-for-review"), "audited sent-for-review");
    },
  });

  // ---- integrity checks (task 34) ----------------------------------------------------------
  T.push({
    name: "runIntegrityChecks catches broken links and missing categories",
    fn: async () => {
      await content.saveArticle({ id: "art-bad", title: "Bad Links", categoryId: "ghost-cat", body: "See [[Missing Article|nope]] for details.", status: "published", publishedVersion: 1, versions: [{ n: 1, at: Date.now(), data: {} }], reviewedAt: Date.now(), reviewIntervalDays: 365 }, { by: "system" });
      const r = await content.runIntegrityChecks();
      assert(r.issues.some((i) => i.level === "error" && i.message.includes("missing category")), "missing category reported");
      assert(r.issues.some((i) => i.level === "error" && i.message.includes("missing article")), "broken link reported");
      assertEq(r.ok, false, "integrity fails with errors");
    },
  });

  // ---- consistency check (task 25) ------------------------------------------------------------
  T.push({
    name: "consistencyCheck flags no-title, dead links and SOP issues",
    fn: async () => {
      const c1 = await content.consistencyCheck({ title: "", body: "x" });
      assert(c1.issues.some((i) => i.code === "no-title"), "no-title flagged");
      const c2 = await content.consistencyCheck({
        title: "Onboarding",
        summary: "s",
        body: "Step 1: TODO fill in.",
        blocks: [{ step: "Do the thing", ownerRole: "" }, { step: "Do the thing" }],
        docType: "sop",
        tags: ["x"],
        reviewIntervalDays: 90,
      });
      assert(c2.issues.some((i) => i.code === "duplicate-step"), "duplicate steps flagged");
      assert(c2.issues.some((i) => i.code === "placeholder"), "placeholder flagged");
      assert(c2.issues.some((i) => i.code === "no-owner"), "missing owner flagged");
      const c3 = await content.consistencyCheck({ title: "Good", summary: "s", body: "See [[missing|nope]]", tags: ["x"], reviewIntervalDays: 90 });
      assert(c3.issues.some((i) => i.code === "dead-link"), "dead link flagged");
      assertEq(c3.ok, false, "not ok when errors present");
    },
  });

  // ---- backup / restore (task 4) ------------------------------------------------------------------
  T.push({
    name: "backup snapshot -> publish -> list -> validate -> restore round-trip",
    fn: async () => {
      const a = await content.createArticle({ docType: "faq", by: "Mia" });
      await content.submitForReview(a.id, "Mia");
      await content.approveArticle(a.id, "Ravi");
      const snap = await content.buildSnapshot("Mia");
      assertEq(snap.schema, "kb-backup/1", "backup schema");
      assert(snap.docs.articles, "snapshot includes articles");
      const pub = await content.publishBackup(snap, "Mia");
      assert(pub.id, "backup id");
      const list = await content.listBackups();
      assertEq(list[0].id, pub.id, "backup listed");
      const text = await content.buildSnapshot("Mia").then(() => JSON.stringify(snap));
      const v = content.validateBackup(text);
      assertEq(v.ok, true, "string backup validates");
      const bad = content.validateBackup("{nope");
      assertEq(bad.ok, false, "garbage rejected");
      // restore into a fresh store
      const cache2 = createMemoryCache();
      const store2 = createDocumentStore({ namespace: "kb-test2", channel: createMemoryChannel(), cache: cache2 });
      const content2 = createContentService({ store: store2, cache: cache2, activity: null, uploadPlugin: null });
      await content2.restoreFromBackup(text, { by: "Ravi" });
      const arts = await content2.listArticles();
      assert(arts.some((x) => x.id === a.id && x.status === "published"), "article restored with status");
    },
  });

  // ---- capacity (task 5) --------------------------------------------------------------------------
  T.push({
    name: "capacityReport returns per-document rows and totals",
    fn: async () => {
      const cap = await content.capacityReport();
      assert(Array.isArray(cap.rows) && cap.rows.length > 0, "rows present");
      assert(cap.total > 0, "total bytes > 0");
      assert(cap.rows.every((r) => typeof r.bytes === "number" && r.bytes >= 0), "bytes numeric");
      assert(cap.rows.every((r) => r.chunks >= 1), "chunk counts present");
    },
  });

  // ---- bundles (tasks 26, 27) ------------------------------------------------------------------------
  T.push({
    name: "refreshBundles builds published-only retrieval bundle with category index",
    fn: async () => {
      const b = await content.refreshBundles();
      assertEq(b.schema, "kb-bundles/1", "bundle schema");
      assert(b.manifest.format === "kb-bundle/1", "manifest format");
      const art = b.articles[Object.keys(b.articles)[0]];
      assert(art && art.body !== undefined && art.permalink.startsWith("#/article/"), "bundle article shape");
      assert(b.categoryIndex && typeof b.categoryIndex === "object", "category index present");
      const gotten = await content.getBundles();
      assertEq(gotten.count, b.count, "getBundles returns same payload");
    },
  });

  // ---- feedback (task 30) ----------------------------------------------------------------------------
  T.push({
    name: "rateArticle records one vote per device; myRating reflects it",
    fn: async () => {
      const a = await content.createArticle({ by: "Mia" });
      await content.submitForReview(a.id, "Mia");
      await content.approveArticle(a.id, "Ravi");
      await content.rateArticle(a.id, { helpful: true, comment: "Great doc" });
      await content.rateArticle(a.id, { helpful: false });
      const rec = await content.getArticle(a.id);
      assertEq(rec.feedback.length, 1, "later vote replaces earlier device vote");
      assertEq(rec.feedback[0].helpful, false, "kept the latest");
      const mine = await content.myRating(a.id);
      assertEq(mine.helpful, false, "myRating matches latest");
      assertEq(mine.deviceId, "test-device", "vote keyed by device");
    },
  });

  // ---- audit (task 17) ----------------------------------------------------------------------------
  T.push({
    name: "audit log records actions and filters",
    fn: async () => {
      const a = await content.createArticle({ by: "Mia" });
      await content.submitForReview(a.id, "Mia");
      await content.approveArticle(a.id, "Ravi");
      const all = await content.listAudit({ target: a.id });
      assert(all.some((e) => e.action === "approve"), "approve audited");
      assert(all.every((e) => e.target === a.id), "target filter");
      const actors = await content.listAudit({ actor: "Ravi" });
      assert(actors.some((e) => e.actor === "Ravi"), "actor filter");
    },
  });

  const results = await runTests(T);
  return { ...results, suite: "content" };
}
