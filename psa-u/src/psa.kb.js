/* ============================================================
   PSA-U — knowledge base (Phase 10 · Task 46)

   The practice's shared memory: articles that capture how a
   problem was solved, so the next technician (or the client)
   finds the answer instead of re-deriving it.

     • kbCategory  — a light hierarchy for filing articles.
     • kbArticle   — a versioned article with a body, tags, a
                     visibility (internal / public) and a lifecycle
                     (draft → published → archived). Every content
                     edit keeps the previous version, and any past
                     version can be restored.

   Articles surface where the work happens: `suggestForTicket`
   ranks the published articles most relevant to a ticket (by tag
   overlap, category and title/body tokens) so the service desk can
   offer them while the ticket is open; `fromTicket` turns a
   resolved ticket into a draft article; `linkText` builds the
   snippet a technician can drop into a customer reply; and
   `publicArticles` is the strictly-public feed the client portal
   reads.

   Storage: provider-document records (kinds "kbCategory" /
   "kbArticle"). No record here is required at runtime.
   ============================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  const ui = ERP.ui;
  const KB = (ERP.kb = {});

  function ten() {
    if (!ERP.tenancy) throw new Error("kb requires the tenancy service");
    return ERP.tenancy;
  }
  const nowIso = () => new Date().toISOString();
  function actor() { return ERP.security ? ERP.security.actor() : { role: ERP.role, memberId: null, member: null }; }
  function actorName() {
    const a = actor();
    return a.member ? a.member.name : (ERP.ROLE_LABELS && ERP.ROLE_LABELS[a.role]) || ERP.role || "—";
  }
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const providerRecords = (pid, kind) => ten().records("provider", pid, kind);

  /* ─────────────────────────── vocabulary ─────────────────────────── */

  KB.VISIBILITIES = [
    { id: "internal", label: "Internal", tone: "warn" },
    { id: "public", label: "Public", tone: "success" },
  ];
  KB.STATUSES = [
    { id: "draft", label: "Draft", tone: "muted" },
    { id: "published", label: "Published", tone: "success" },
    { id: "archived", label: "Archived", tone: "muted" },
  ];
  KB.visibilityLabel = (id) => (KB.VISIBILITIES.find((v) => v.id === id) || {}).label || id || "—";
  KB.visibilityTone = (id) => (KB.VISIBILITIES.find((v) => v.id === id) || {}).tone || "muted";
  KB.statusLabel = (id) => (KB.STATUSES.find((s) => s.id === id) || {}).label || id || "—";
  KB.statusTone = (id) => (KB.STATUSES.find((s) => s.id === id) || {}).tone || "muted";

  /* ─────────────────────────── factories & helpers ─────────────────────────── */

  KB.newCategory = (over) => Object.assign({
    kind: "kbCategory", id: null, providerId: null,
    name: "", description: "", parentId: null, order: 0,
    createdAt: null, updatedAt: null,
  }, over || {});

  KB.newArticle = (over) => Object.assign({
    kind: "kbArticle", id: null, providerId: null,
    number: "", slug: "", title: "", summary: "", body: "",
    categoryId: null, tags: [], visibility: "internal", status: "draft",
    version: 1, versions: [],
    sourceTicketId: null, sourceCompanyId: null,
    views: 0, helpful: 0, notHelpful: 0,
    createdBy: "", updatedBy: "", createdAt: null, updatedAt: null, publishedAt: null,
  }, over || {});

  function slugify(s) {
    return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  }
  KB.slugify = slugify;

  function normTags(t) {
    const list = Array.isArray(t) ? t : String(t == null ? "" : t).split(",");
    const out = [];
    list.forEach((x) => { const v = String(x || "").trim().toLowerCase(); if (v && out.indexOf(v) === -1) out.push(v); });
    return out;
  }
  KB.normTags = normTags;

  function tokenize(s) {
    return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").split(/\s+/).filter((w) => w.length > 2);
  }

  async function nextArticleNumber(pid) {
    let max = 0;
    (await providerRecords(pid, "kbArticle")).forEach((a) => {
      const m = /(\d+)\s*$/.exec(String(a.number || ""));
      if (m) max = Math.max(max, Number(m[1]));
    });
    return "KB-" + String(max + 1).padStart(4, "0");
  }

  function snapshot(a) {
    return {
      version: a.version || 1, title: a.title || "", summary: a.summary || "", body: a.body || "",
      categoryId: a.categoryId == null ? null : a.categoryId, tags: (a.tags || []).slice(),
      visibility: a.visibility || "internal", at: a.updatedAt || a.createdAt || nowIso(), by: a.updatedBy || a.createdBy || "",
    };
  }
  const CONTENT_FIELDS = ["title", "summary", "body", "categoryId", "tags", "visibility"];
  function contentChanged(a, b) {
    return CONTENT_FIELDS.some((f) => JSON.stringify(a[f] == null ? null : a[f]) !== JSON.stringify(b[f] == null ? null : b[f]));
  }

  function emit(pid, event, ctx) {
    if (!ERP.workflow) return Promise.resolve();
    try { return ERP.workflow.emit(event, Object.assign({ providerId: pid }, ctx || {})); } catch (e) { return Promise.resolve(); }
  }

  KB.ensure = async function (pid) {
    if (pid == null) return { skipped: "no_provider" };
    const seeded = { categories: 0, articles: 0 };
    if (!(await providerRecords(pid, "kbCategory")).length) {
      const cats = [
        { name: "How-to", description: "Step-by-step procedures." },
        { name: "Troubleshooting", description: "Diagnosing and fixing faults." },
        { name: "Networking", description: "Firewalls, switches, Wi-Fi." },
        { name: "Onboarding", description: "Getting a new client running." },
      ];
      let id = 0;
      for (const c of cats) {
        id += 1;
        await ten().upsert("provider", pid, Object.assign(KB.newCategory(c), { id: id, providerId: pid, createdAt: nowIso(), updatedAt: nowIso() }));
        seeded.categories += 1;
      }
    }
    if (!(await providerRecords(pid, "kbArticle")).length) {
      const cats = await KB.categories(pid);
      const netCat = cats.find((c) => c.name === "Networking");
      const trCat = cats.find((c) => c.name === "Troubleshooting");
      const seed = [
        {
          title: "Restarting a managed switch safely", categoryId: netCat ? netCat.id : null, visibility: "internal",
          tags: ["switch", "network", "outage"], summary: "How to power-cycle a managed switch without dropping the whole site.",
          body: "1. Confirm which ports carry the uplink and any PoE phones.\n2. Notify the site contact.\n3. Save the running configuration.\n4. Power-cycle, then watch the uplink come back before declaring it fixed.",
        },
        {
          title: "A user cannot reach an internal site", categoryId: trCat ? trCat.id : null, visibility: "public",
          tags: ["vpn", "dns", "network"], summary: "First checks when a single user loses access to an internal resource.",
          body: "Ask the user to confirm other sites load. If they do, it is name resolution or the VPN tunnel.\nReconnect the VPN and flush DNS. If it persists, check the tunnel's assigned route.",
        },
      ];
      let id = 0;
      for (const a of seed) {
        id += 1;
        const rec = Object.assign(KB.newArticle(a), {
          id: id, providerId: pid, number: "KB-" + String(id).padStart(4, "0"), slug: slugify(a.title),
          status: "published", publishedAt: nowIso(), createdBy: "PSA-U", updatedBy: "PSA-U",
          createdAt: nowIso(), updatedAt: nowIso(),
        });
        await ten().upsert("provider", pid, rec);
        seeded.articles += 1;
      }
    }
    return seeded;
  };

  /* ─────────────────────────── categories ─────────────────────────── */

  KB.categories = async function (pid) {
    const list = (await providerRecords(pid, "kbCategory")).slice();
    list.sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0) || String(a.name).localeCompare(String(b.name)));
    return list;
  };
  KB.category = async function (pid, id) {
    return (await KB.categories(pid)).find((c) => String(c.id) === String(id)) || null;
  };

  KB.saveCategory = async function (pid, rec) {
    if (!ERP.security.enforce("kb.edit")) return { error: "forbidden" };
    const list = await providerRecords(pid, "kbCategory");
    const existing = rec.id != null ? list.find((c) => String(c.id) === String(rec.id)) : null;
    const out = Object.assign(KB.newCategory(), existing || {}, rec);
    if (!out.name || !String(out.name).trim()) return { error: "name_required", message: "Give the category a name." };
    out.name = String(out.name).trim();
    const clash = list.some((c) => String(c.id) !== String(out.id) && String(c.name).toLowerCase() === out.name.toLowerCase());
    if (clash) return { error: "name_taken", message: "Another category already uses that name." };
    out.providerId = pid;
    if (!existing) { out.id = ten().nextId(list); out.createdAt = nowIso(); }
    out.updatedAt = nowIso();
    await ten().upsert("provider", pid, out);
    return { record: out, created: !existing };
  };

  KB.removeCategory = async function (pid, id) {
    if (!ERP.security.enforce("kb.edit")) return { error: "forbidden" };
    const inUse = (await providerRecords(pid, "kbArticle")).some((a) => String(a.categoryId) === String(id));
    if (inUse) return { error: "category_in_use", message: "Move its articles to another category first." };
    await ten().remove("provider", pid, (r) => r.kind === "kbCategory" && String(r.id) === String(id));
    return { ok: true, id: id };
  };

  function categoryNameMap(cats) {
    const m = {};
    (cats || []).forEach((c) => { m[String(c.id)] = c.name; });
    return m;
  }
  KB.categoryNameMap = categoryNameMap;

  /* ─────────────────────────── articles ─────────────────────────── */

  KB.articles = async function (pid, query) {
    query = query || {};
    let list = (await providerRecords(pid, "kbArticle")).slice();
    if (query.status) list = list.filter((a) => a.status === query.status);
    if (query.visibility) list = list.filter((a) => a.visibility === query.visibility);
    if (query.categoryId) list = list.filter((a) => String(a.categoryId) === String(query.categoryId));
    if (query.tag) { const t = String(query.tag).toLowerCase(); list = list.filter((a) => (a.tags || []).indexOf(t) !== -1); }
    if (query.q) {
      const ts = tokenize(query.q);
      if (ts.length) list = list.filter((a) => {
        const hay = tokenize([a.title, a.summary, a.body, (a.tags || []).join(" "), a.number].join(" "));
        return ts.every((t) => hay.indexOf(t) !== -1);
      });
    }
    list.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
    return list;
  };

  KB.article = async function (pid, id) {
    return (await providerRecords(pid, "kbArticle")).find((a) => String(a.id) === String(id)) || null;
  };
  KB.articleByNumber = async function (pid, number) {
    return (await providerRecords(pid, "kbArticle")).find((a) => String(a.number) === String(number)) || null;
  };
  KB.articleBySlug = async function (pid, slug) {
    return (await providerRecords(pid, "kbArticle")).find((a) => a.slug === slug) || null;
  };

  KB.publicArticles = async function (pid, query) {
    return (await KB.articles(pid, Object.assign({}, query || {}, { status: "published", visibility: "public" })));
  };

  KB.saveArticle = async function (pid, article, opts) {
    opts = opts || {};
    if (!opts.system && !ERP.security.enforce("kb.edit")) return { error: "forbidden" };
    const list = await providerRecords(pid, "kbArticle");
    const existing = article.id != null ? list.find((a) => String(a.id) === String(article.id)) : null;
    const rec = Object.assign(KB.newArticle(), existing || {}, article);
    rec.tags = normTags(rec.tags);
    rec.visibility = rec.visibility === "public" ? "public" : "internal";
    rec.status = KB.STATUSES.some((s) => s.id === rec.status) ? rec.status : "draft";
    if (!rec.title || !String(rec.title).trim()) return { error: "title_required", message: "Give the article a title." };
    rec.title = String(rec.title).trim();
    if (rec.categoryId === "" || rec.categoryId == null) rec.categoryId = null;

    let base = slugify(rec.title) || "article";
    let slug = base, n = 2;
    while (list.some((a) => String(a.id) !== String(rec.id) && a.slug === slug)) slug = base + "-" + (n++);
    rec.slug = slug;

    const now = nowIso();
    const isNew = !existing;
    if (isNew) {
      rec.id = ten().nextId(list);
      rec.number = await nextArticleNumber(pid);
      rec.version = 1; rec.versions = [];
      rec.createdAt = now; rec.createdBy = actorName();
    } else if (contentChanged(existing, rec)) {
      rec.versions = [snapshot(existing)].concat(existing.versions || []).slice(0, 20);
      rec.version = (Number(existing.version) || 1) + 1;
    } else {
      rec.version = Number(existing.version) || 1;
      rec.versions = existing.versions || [];
    }
    if (rec.status === "published" && !rec.publishedAt) rec.publishedAt = now;
    rec.providerId = pid;
    rec.updatedAt = now; rec.updatedBy = actorName();
    await ten().upsert("provider", pid, rec);
    if (isNew) await emit(pid, "kb.article_created", { article: rec });
    else await emit(pid, "kb.article_updated", { article: rec });
    return { record: rec, created: isNew };
  };

  KB.setStatus = async function (pid, id, status) {
    if (!ERP.security.enforce("kb.edit")) return { error: "forbidden" };
    const a = await KB.article(pid, id);
    if (!a) return { error: "not_found" };
    const now = nowIso();
    const rec = Object.assign({}, a, { status: status, updatedAt: now, updatedBy: actorName() });
    if (status === "published" && !rec.publishedAt) rec.publishedAt = now;
    await ten().upsert("provider", pid, rec);
    if (status === "published") await emit(pid, "kb.article_published", { article: rec });
    else if (status === "archived") await emit(pid, "kb.article_archived", { article: rec });
    return { record: rec };
  };
  KB.publish = (pid, id) => KB.setStatus(pid, id, "published");
  KB.unpublish = (pid, id) => KB.setStatus(pid, id, "draft");
  KB.archive = (pid, id) => KB.setStatus(pid, id, "archived");

  KB.removeArticle = async function (pid, id) {
    if (!ERP.security.enforce("kb.edit")) return { error: "forbidden" };
    await ten().remove("provider", pid, (r) => r.kind === "kbArticle" && String(r.id) === String(id));
    return { ok: true, id: id };
  };

  KB.markViewed = async function (pid, id) {
    const a = await KB.article(pid, id);
    if (!a) return { error: "not_found" };
    const rec = Object.assign({}, a, { views: (Number(a.views) || 0) + 1 });
    await ten().upsert("provider", pid, rec);
    return { record: rec };
  };

  KB.rate = async function (pid, id, helpful) {
    const a = await KB.article(pid, id);
    if (!a) return { error: "not_found" };
    const rec = Object.assign({}, a);
    if (helpful) rec.helpful = (Number(a.helpful) || 0) + 1;
    else rec.notHelpful = (Number(a.notHelpful) || 0) + 1;
    await ten().upsert("provider", pid, rec);
    return { record: rec };
  };

  /* ─────────────────────────── version history ─────────────────────────── */

  KB.versionList = async function (pid, id) {
    const a = await KB.article(pid, id);
    if (!a) return [];
    return [{ version: Number(a.version) || 1, title: a.title, at: a.updatedAt, by: a.updatedBy, current: true }]
      .concat((a.versions || []).map((v) => ({ version: v.version, title: v.title, at: v.at, by: v.by, current: false })));
  };

  KB.restoreVersion = async function (pid, id, versionNo) {
    if (!ERP.security.enforce("kb.edit")) return { error: "forbidden" };
    const a = await KB.article(pid, id);
    if (!a) return { error: "not_found" };
    const target = (a.versions || []).find((v) => String(v.version) === String(versionNo));
    if (!target) return { error: "version_not_found" };
    const now = nowIso();
    const rec = Object.assign({}, a, {
      title: target.title, summary: target.summary, body: target.body,
      categoryId: target.categoryId == null ? null : target.categoryId, tags: (target.tags || []).slice(), visibility: target.visibility,
      versions: [snapshot(a)].concat(a.versions || []).slice(0, 20),
      version: (Number(a.version) || 1) + 1,
      updatedAt: now, updatedBy: actorName(),
    });
    await ten().upsert("provider", pid, rec);
    await emit(pid, "kb.article_updated", { article: rec });
    return { record: rec, restored: Number(versionNo) };
  };

  /* ─────────────────────────── search & ticket integration ─────────────────────────── */

  KB.search = async function (pid, text, opts) {
    opts = opts || {};
    const list = opts.publicOnly
      ? await KB.publicArticles(pid)
      : (await KB.articles(pid, { status: "published" }));
    const ts = tokenize(text);
    if (!ts.length) return list.slice(0, opts.limit || 20);
    const scored = list.map((a) => ({ a: a, score: KB.scoreArticle(a, ts) })).filter((r) => r.score > 0);
    scored.sort((x, y) => y.score - x.score);
    return scored.slice(0, opts.limit || 20).map((r) => r.a);
  };

  KB.scoreArticle = function (article, tokens) {
    const title = tokenize(article.title);
    const body = tokenize([article.summary, article.body, (article.tags || []).join(" ")].join(" "));
    let score = 0;
    (tokens || []).forEach((t) => {
      if (title.indexOf(t) !== -1) score += 3;
      else if (body.indexOf(t) !== -1) score += 1;
    });
    return score;
  };

  KB.suggestForTicket = async function (pid, ticket, opts) {
    opts = opts || {};
    const t = ticket || {};
    const tags = normTags(t.tags || []);
    const tokens = tokenize([t.summary, t.detail, t.type, t.subtype, t.item, tags.join(" ")].join(" "));
    const pool = await KB.articles(pid, { status: "published" });
    const scored = [];
    for (const a of pool) {
      let score = KB.scoreArticle(a, tokens);
      const atags = (a.tags || []).map((x) => String(x).toLowerCase());
      tags.forEach((tg) => { if (atags.indexOf(tg) !== -1) score += 5; });
      if (score > 0) scored.push({ article: a, score: score });
    }
    scored.sort((x, y) => y.score - x.score || String(y.article.updatedAt).localeCompare(String(x.article.updatedAt)));
    return scored.slice(0, opts.limit || 5);
  };

  KB.fromTicket = async function (pid, companyId, ticket, opts) {
    opts = opts || {};
    const t = typeof ticket === "object" && ticket ? ticket : await ERP.tickets.get(companyId, ticket);
    if (!t) return { error: "ticket_not_found" };
    const body =
      "## Issue\n" + (t.detail || t.summary || "") +
      "\n\n## Resolution\n" + (opts.resolution || "Describe what fixed it here.") +
      "\n\n## Notes\nResolved on ticket #" + (t.number || t.id) + ".";
    const rec = Object.assign(KB.newArticle(opts.over || {}), {
      title: opts.title || t.summary || ("Ticket #" + (t.number || t.id) + " resolution"),
      summary: opts.summary || ("Resolution captured from ticket #" + (t.number || t.id) + "."),
      body: body,
      tags: normTags([opts.tags || ""].concat(t.tags || []).join(",")),
      categoryId: opts.categoryId != null ? opts.categoryId : null,
      visibility: opts.visibility || "internal",
      status: "draft",
      sourceTicketId: t.id,
      sourceCompanyId: t.companyId != null ? t.companyId : companyId,
    });
    const res = await KB.saveArticle(pid, rec);
    if (!res.error) await emit(pid, "kb.ticket_drafted", { article: res.record, ticket: t });
    return res;
  };

  KB.linkText = function (article, opts) {
    opts = opts || {};
    const title = article && article.title ? article.title : "Knowledge article";
    const number = article && article.number ? article.number : "";
    if (opts.format === "plain") return title + (number ? " (" + number + ")" : "");
    return '<a class="erp-kb-link" href="#/knowledge:articles" data-kb="' + ui.esc(article && article.id) + '">' + ui.esc(title) + "</a>" + (number ? " <span class=\"erp-sub\">" + ui.esc(number) + "</span>" : "");
  };

  /* ═══════════════════════════ station tabs ═══════════════════════════ */

  function esc(s) { return ui.esc(s); }

  KB.renderArticles = async function (panel, pid, refresh) {
    if (!ERP.security.enforce("kb.view")) { panel.innerHTML = ui.alert("Your role cannot view the knowledge base.", "warn"); return; }
    const state = panel.__kbState || (panel.__kbState = { q: "", status: "", visibility: "", categoryId: "" });
    const [articles, cats] = await Promise.all([KB.articles(pid, state), KB.categories(pid)]);
    const catName = categoryNameMap(cats);
    const canEdit = ERP.security.can("kb.edit");
    const published = articles.filter((a) => a.status === "published").length;
    const drafts = articles.filter((a) => a.status === "draft").length;
    const publicCount = articles.filter((a) => a.visibility === "public" && a.status === "published").length;

    const rows = articles.map((a) => ({
      number: esc(a.number || ""),
      title: esc(a.title) + (a.tags && a.tags.length ? ' <span class="erp-sub">' + esc(a.tags.slice(0, 4).join(", ")) + "</span>" : ""),
      category: esc(a.categoryId != null ? (catName[String(a.categoryId)] || "—") : "—"),
      visibility: ui.badge(KB.visibilityLabel(a.visibility), KB.visibilityTone(a.visibility)),
      status: ui.badge(KB.statusLabel(a.status), KB.statusTone(a.status)),
      version: "v" + (a.version || 1),
      updated: esc(ui.date(a.updatedAt)),
      actions: canEdit
        ? ui.btn("Open", { small: true, act: "kb-open", arg: a.id }) + " " +
          (a.status === "published" ? ui.btn("Archive", { small: true, act: "kb-archive", arg: a.id }) : ui.btn("Publish", { small: true, primary: true, act: "kb-publish", arg: a.id }))
        : ui.btn("Open", { small: true, act: "kb-open", arg: a.id }),
    }));

    panel.innerHTML =
      '<div class="erp-summary">' +
        '<div class="erp-summary-item"><span>Articles</span><b>' + articles.length + "</b></div>" +
        '<div class="erp-summary-item"><span>Published</span><b>' + published + "</b></div>" +
        '<div class="erp-summary-item"><span>Drafts</span><b>' + drafts + "</b></div>" +
        '<div class="erp-summary-item"><span>Client-visible</span><b>' + publicCount + "</b></div>" +
      "</div>" +
      '<div class="erp-toolbar">' +
        '<input type="search" data-kb-q placeholder="Search articles…" value="' + esc(state.q) + '">' +
        ui.select("kb-status", "", [{ value: "", label: "Any status" }].concat(KB.STATUSES.map((s) => ({ value: s.id, label: s.label }))), state.status, null, "Filter by status") +
        ui.select("kb-vis", "", [{ value: "", label: "Any visibility" }].concat(KB.VISIBILITIES.map((v) => ({ value: v.id, label: v.label }))), state.visibility, null, "Filter by visibility") +
        ui.select("kb-cat", "", [{ value: "", label: "Any category" }].concat(cats.map((c) => ({ value: c.id, label: c.name }))), state.categoryId, null, "Filter by category") +
        (canEdit ? ui.btn("New article", { primary: true, act: "kb-new" }) : "") +
      "</div>" +
      ui.table([
        { key: "number", label: "Ref", width: "80px" },
        { key: "title", label: "Article" },
        { key: "category", label: "Category" },
        { key: "visibility", label: "Visibility" },
        { key: "status", label: "Status" },
        { key: "version", label: "Ver", width: "60px" },
        { key: "updated", label: "Updated" },
        { key: "actions", label: "", align: "right" },
      ], rows, { emptyText: "No articles match these filters." });

    const q = panel.querySelector("[data-kb-q]");
    if (q) q.addEventListener("input", () => { state.q = q.value; clearTimeout(panel.__kbT); panel.__kbT = setTimeout(() => refresh(), 250); });
    const onSel = (sel, key) => { const el = panel.querySelector(sel); if (el) el.addEventListener("change", () => { state[key] = el.value; refresh(); }); };
    onSel("[name=kb-status]", "status"); onSel("[name=kb-vis]", "visibility"); onSel("[name=kb-cat]", "categoryId");
    ui.bind(panel, "click", "[data-act]", async (el, e, act, arg) => {
      if (act === "kb-new") return openArticleModal(pid, null, refresh);
      if (act === "kb-open") return openArticleView(pid, arg, refresh);
      if (act === "kb-publish") { const r = await KB.publish(pid, arg); if (r.error) return ERP.toast(r.message || r.error, "error"); ERP.toast("Article published.", "success"); refresh(); }
      if (act === "kb-archive") { const r = await KB.archive(pid, arg); if (r.error) return ERP.toast(r.message || r.error, "error"); ERP.toast("Article archived.", "success"); refresh(); }
    });
  };

  KB.renderCategories = async function (panel, pid, refresh) {
    if (!ERP.security.enforce("kb.view")) { panel.innerHTML = ui.alert("Your role cannot view the knowledge base.", "warn"); return; }
    const [cats, articles] = await Promise.all([KB.categories(pid), KB.articles(pid, {})]);
    const canEdit = ERP.security.can("kb.edit");
    const counts = {};
    articles.forEach((a) => { if (a.categoryId != null) counts[String(a.categoryId)] = (counts[String(a.categoryId)] || 0) + 1; });
    const rows = cats.map((c) => ({
      name: esc(c.name),
      description: esc(c.description || "—"),
      count: String(counts[String(c.id)] || 0),
      actions: canEdit ? ui.btn("Edit", { small: true, act: "kc-edit", arg: c.id }) + " " + ui.btn("Delete", { small: true, danger: true, act: "kc-del", arg: c.id }) : "",
    }));
    panel.innerHTML =
      (canEdit ? '<div class="erp-toolbar">' + ui.btn("New category", { primary: true, act: "kc-new" }) + "</div>" : "") +
      ui.table([
        { key: "name", label: "Category" },
        { key: "description", label: "Description" },
        { key: "count", label: "Articles", align: "right", width: "90px" },
        { key: "actions", label: "", align: "right" },
      ], rows, { emptyText: "No categories yet." });
    ui.bind(panel, "click", "[data-act]", async (el, e, act, arg) => {
      if (act === "kc-new") return openCategoryModal(pid, null, refresh);
      if (act === "kc-edit") return openCategoryModal(pid, await KB.category(pid, arg), refresh);
      if (act === "kc-del") {
        const ok = await ui.confirm({ title: "Delete category", message: "Delete this category? Its articles are kept but unfiled.", danger: true });
        if (!ok) return;
        const r = await KB.removeCategory(pid, arg);
        if (r.error) return ERP.toast(r.message || r.error, "error");
        ERP.toast("Category deleted.", "success"); refresh();
      }
    });
  };

  /* ─────────────────────────── modals ─────────────────────────── */

  async function openCategoryModal(pid, rec, refresh) {
    if (!ERP.security.enforce("kb.edit")) return;
    const c = rec || KB.newCategory();
    const m = ui.modal({
      title: rec ? "Edit category" : "New category",
      body: ui.form(ui.text("name", "Name", c.name) + ui.textarea("description", "Description", c.description, 3)),
      foot: ui.btn("Cancel", { small: true, act: "kcm-cancel" }) + " " + ui.btn("Save", { small: true, primary: true, act: "kcm-save" }),
    });
    const f = m.querySelector("[data-ui-form]");
    m.querySelector("[data-act=kcm-cancel]").onclick = () => ui.closeModal();
    m.querySelector("[data-act=kcm-save]").onclick = async () => {
      const v = ui.collect(f, ["name", "description"]);
      const r = await KB.saveCategory(pid, Object.assign({}, c, v));
      if (r.error) return ERP.toast(r.message || r.error, "error");
      ui.closeModal(); ERP.toast("Category saved.", "success"); refresh();
    };
  }

  async function openArticleModal(pid, rec, refresh, presets) {
    if (!ERP.security.enforce("kb.edit")) return;
    const a = Object.assign(KB.newArticle(), presets || {}, rec || {});
    const cats = await KB.categories(pid);
    const m = ui.modal({
      title: rec ? "Edit article " + (a.number || "") : "New article",
      size: "lg",
      body: ui.form(
        ui.text("title", "Title", a.title) +
        ui.textarea("summary", "Summary", a.summary, 2) +
        '<div class="erp-form-row">' +
          ui.select("categoryId", "Category", [{ value: "", label: "— unfiled —" }].concat(cats.map((c) => ({ value: c.id, label: c.name }))), a.categoryId) +
          ui.select("visibility", "Visibility", KB.VISIBILITIES.map((v) => ({ value: v.id, label: v.label })), a.visibility) +
        "</div>" +
        ui.text("tags", "Tags", (a.tags || []).join(", "), "comma, separated") +
        ui.textarea("body", "Body", a.body, 12)
      ),
      foot: ui.btn("Cancel", { small: true, act: "kam-cancel" }) + " " + ui.btn("Save draft", { small: true, act: "kam-draft" }) + " " + ui.btn("Save & publish", { small: true, primary: true, act: "kam-pub" }),
    });
    const f = m.querySelector("[data-ui-form]");
    const collect = () => {
      const v = ui.collect(f, ["title", "summary", "body", "categoryId", "visibility", "tags"]);
      return Object.assign({}, a, v, { categoryId: v.categoryId === "" ? null : v.categoryId, tags: KB.normTags(v.tags) });
    };
    const doSave = async (publish) => {
      const rec2 = collect();
      if (publish) rec2.status = "published";
      const r = await KB.saveArticle(pid, rec2);
      if (r.error) return ERP.toast(r.message || r.error, "error");
      ui.closeModal(); ERP.toast(publish ? "Article published." : "Article saved.", "success"); refresh();
    };
    m.querySelector("[data-act=kam-cancel]").onclick = () => ui.closeModal();
    m.querySelector("[data-act=kam-draft]").onclick = () => doSave(false);
    m.querySelector("[data-act=kam-pub]").onclick = () => doSave(true);
  }

  async function openArticleView(pid, id, refresh) {
    const a = await KB.article(pid, id);
    if (!a) { ERP.toast("Article not found.", "error"); return; }
    const cats = await KB.categories(pid);
    const catName = categoryNameMap(cats)[String(a.categoryId)] || "—";
    const canEdit = ERP.security.can("kb.edit");
    const versions = await KB.versionList(pid, id);
    const verRows = versions.map((v) => ({
      ver: "v" + v.version + (v.current ? ' <span class="erp-sub">current</span>' : ""),
      title: esc(v.title),
      by: esc(v.by || "—"),
      at: esc(ui.dateTime(v.at)),
      actions: !v.current && canEdit ? ui.btn("Restore", { small: true, act: "kav-restore", arg: v.version }) : "",
    }));
    const m = ui.modal({
      title: (a.number ? a.number + " · " : "") + a.title,
      size: "lg",
      body:
        '<div class="erp-kb-meta">' + ui.badge(KB.visibilityLabel(a.visibility), KB.visibilityTone(a.visibility)) + " " +
          ui.badge(KB.statusLabel(a.status), KB.statusTone(a.status)) + ' <span class="erp-sub">' + esc(catName) + " · v" + (a.version || 1) + " · " + esc(ui.dateTime(a.updatedAt)) + "</span></div>" +
        (a.tags && a.tags.length ? '<div class="erp-kb-tags">' + a.tags.map((t) => ui.badge(t, "muted")).join(" ") + "</div>" : "") +
        (a.summary ? '<p class="erp-kb-summary">' + esc(a.summary) + "</p>" : "") +
        '<div class="erp-kb-body">' + esc(a.body || "").replace(/\n/g, "<br>") + "</div>" +
        '<div class="erp-sep"></div><h4>Version history</h4>' +
        ui.table([{ key: "ver", label: "Version" }, { key: "title", label: "Title" }, { key: "by", label: "By" }, { key: "at", label: "When" }, { key: "actions", label: "", align: "right" }], verRows, { emptyText: "No previous versions." }) +
        (canEdit ? '<div class="erp-btn-row">' + ui.btn("Edit", { small: true, act: "kav-edit" }) + "</div>" : ""),
      foot: ui.btn("Close", { small: true, act: "kav-close" }),
    });
    await KB.markViewed(pid, id);
    m.querySelector("[data-act=kav-close]").onclick = () => ui.closeModal();
    const edit = m.querySelector("[data-act=kav-edit]");
    if (edit) edit.onclick = () => openArticleModal(pid, a, refresh);
    ui.bind(m, "click", "[data-act=kav-restore]", async (el, e, act, arg) => {
      const r = await KB.restoreVersion(pid, id, arg);
      if (r.error) return ERP.toast(r.message || r.error, "error");
      ERP.toast("Version restored.", "success"); refresh(); openArticleView(pid, id, refresh);
    });
  }

  /* exported for the ticket detail modal */
  KB.openArticleModal = openArticleModal;
  KB.openArticleView = openArticleView;
})();
