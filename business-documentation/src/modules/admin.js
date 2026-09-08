// src/modules/admin.js — admin console (hidden module, route #/admin). Tabs:
// Backup & restore (task 4), Capacity & archival (task 5), Categories (task 7),
// Templates (task 8), Snippets (task 12), Identity, Audit log (task 17) and
// Integrations / consumer guide (task 29).

import { h, esc } from "../framework/dom.js";
import { icons } from "../framework/icons.js";
import { loadingState, emptyState } from "../framework/states.js";
import { renderMarkdown } from "../framework/markdown.js";
import { viewPanel, fmtDate, fmtBytes, catPathStr, findCat, flattenTree, confirmDialog, promptPanel } from "./shared.js";

export default {
  id: "admin",
  label: "Admin",
  desc: "Backup, capacity, categories, templates, snippets, audit & integrations",
  icon: icons.gear,
  hidden: true,
  async render(ctx) {
    ctx.container.append(loadingState({ label: "Loading admin…" }));
    const content = ctx.content;

    // Phase 9 (task 38): the hub is server-authoritative — when it's live and
    // the signed-in user isn't an admin, this console is read-only-restricted.
    // Offline/single-user mode keeps full local admin access (backwards compat).
    if (ctx.hub && ctx.hub.connected && ctx.hub.authenticated && !ctx.hub.isAdmin) {
      ctx.container.replaceChildren(
        emptyState({
          title: "Admins only",
          description: "Signed in as " + (ctx.hub.username || "you") + " — managing users, roles and system settings is restricted to admins.",
          icon: icons.shield,
        }),
      );
      return;
    }

    const tabs = h("div", { class: "kb-tabs kb-tabs-lg" });
    const tabDefs = [
      ["backup", "Backup & restore"],
      ["capacity", "Capacity & archive"],
      ["categories", "Categories"],
      ["templates", "Templates"],
      ["snippets", "Snippets"],
      ["identity", "Identity"],
      ["audit", "Audit log"],
      ["users", "Users & roles"],
      ["integrations", "Integrations"],
    ];
    const boxes = {};
    const tabBtns = {};
    for (const [k, label] of tabDefs) {
      const box = h("div", { class: "kb-admin-tab", id: "adm-" + k });
      boxes[k] = box;
      const b = h("button", { class: "kb-tab", type: "button", onClick: () => showTab(k) }, label);
      tabBtns[k] = b;
      tabs.append(b);
    }
    const showTab = (k) => {
      for (const [id] of tabDefs) {
        boxes[id].hidden = id !== k;
        tabBtns[id].classList.toggle("active", id === k);
      }
    };

    // ---- backup & restore ----------------------------------------------------
    const renderBackup = async () => {
      const box = boxes.backup;
      const backups = await content.listBackups().catch(() => []);
      box.replaceChildren(
        h("p", { class: "kb-admin-desc" }, "Take a full snapshot of every KB document (downloadable file and/or published manifest), or restore from one — always validated before anything is replaced."),
        h("div", { class: "kb-admin-row" },
          h("button", { class: "kb-btn kb-btn-primary kb-btn-sm", id: "admBackupDownload", type: "button" }, "Download full backup"),
          h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", id: "admBackupPublish", type: "button" }, "Publish backup"),
          h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", id: "admBackupRestore", type: "button" }, "Restore from file…"),
          h("input", { type: "file", id: "admBackupFile", accept: ".json,.txt", hidden: true }),
        ),
        h("div", { class: "kb-section-title" }, h("h3", null, "Published backups")),
        backups.length
          ? table(["When", "By", "Docs", "Size"], backups.map((b) => [fmtDate(b.at), b.by || "—", String(b.docCount || "—"), fmtBytes(b.bytes || 0)]))
          : h("p", { class: "kb-muted" }, "No published backups yet."),
      );
      box.querySelector("#admBackupDownload").addEventListener("click", async () => {
        const snap = await content.buildSnapshot("admin");
        const blob = new Blob([JSON.stringify(snap, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = h("a", { href: url, download: "kb-backup-" + new Date().toISOString().slice(0, 10) + ".json" });
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        ctx.toast("Backup downloaded (" + fmtBytes(snap.totalBytes) + ")", "success");
      });
      box.querySelector("#admBackupPublish").addEventListener("click", async () => {
        const snap = await content.buildSnapshot("admin");
        const res = await content.publishBackup(snap, "admin");
        ctx.toast("Backup published (" + fmtBytes(res.snapshot.totalBytes) + ")", "success");
        renderBackup();
      });
      box.querySelector("#admBackupRestore").addEventListener("click", () => box.querySelector("#admBackupFile").click());
      box.querySelector("#admBackupFile").addEventListener("change", async () => {
        const f = box.querySelector("#admBackupFile").files && box.querySelector("#admBackupFile").files[0];
        if (!f) return;
        const text = await f.text();
        const v = content.validateBackup(text);
        if (!v.ok) {
          ctx.toast("Backup invalid: " + v.errors.join(" "), "error", 6000);
          return;
        }
        const summary = v.summary.map((s) => s.id + " (v" + s.version + ", " + fmtBytes(s.bytes) + ")").join(", ");
        const ok = await confirmDialog({
          title: "Restore from backup?",
          message: `This replaces the current versions of: ${summary}. Documents not in the backup are untouched. Created ${fmtDate(v.createdAt)} by ${v.by || "?"}.`,
          confirmLabel: "Restore",
          danger: true,
        });
        if (!ok) return;
        try {
          const res = await content.restoreFromBackup(text, { by: "admin" });
          ctx.toast("Restored " + res.restored.length + " document(s)", "success");
          if (window.__kb && window.__kb.refreshCategories) window.__kb.refreshCategories();
        } catch (e) {
          ctx.toast(String((e && e.message) || e), "error", 6000);
        }
      });
    };

    // ---- capacity & archive ----------------------------------------------------
    const renderCapacity = async () => {
      const box = boxes.capacity;
      box.replaceChildren(
        h("p", { class: "kb-admin-desc" }, "Each document's size against the storage ceiling. Archived articles live in a clearly labeled read-only archive and stay retrievable."),
        h("div", { class: "kb-section-title" }, h("h3", null, "Document store capacity")),
      );
      const cap = await content.capacityReport().catch(() => ({ rows: [], total: 0, ceiling: 0 }));
      box.append(
        table(["Document", "Size", "Parts", "v", "% of ceiling"], cap.rows.map((r) => [
          r.id, fmtBytes(r.bytes), String(r.chunks), String(r.version),
          h("div", { class: "kb-capbar" }, h("div", { class: "kb-capbar-fill", style: { width: Math.min(100, r.pct) + "%" } }), h("span", null, r.pct + "%")),
        ])),
        h("p", { class: "kb-muted" }, "Total " + fmtBytes(cap.total) + " across " + cap.rows.length + " documents · ceiling " + fmtBytes(cap.ceiling) + " per part."),
      );
      const archived = (await content.listArticles().catch(() => [])).filter((a) => a.status === "archived");
      const tree = await content.getCategoryTree().catch(() => []);
      const archBox = h("div", { class: "kb-archive" });
      archBox.append(h("div", { class: "kb-section-title" }, h("h3", null, "Archive (" + archived.length + " read-only articles)"), h("span", { class: "kb-section-note" }, "Restore to bring one back as a draft.")));
      for (const a of archived) {
        const restore = h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button" }, "Restore");
        restore.addEventListener("click", async () => {
          try { await content.restoreArticle(a.id, "admin"); ctx.toast("Restored as draft", "success"); renderCapacity(); }
          catch (e) { ctx.toast(String((e && e.message) || e), "error", 5200); }
        });
        archBox.append(h("div", { class: "kb-arch-row" },
          h("a", { href: "#/article/" + a.id }, a.title),
          h("span", { class: "kb-arch-meta" }, catPathStr(tree, a.categoryId) + " · archived " + fmtDate(a.updated && a.updated.at)),
          restore,
        ));
      }
      if (!archived.length) archBox.append(h("p", { class: "kb-muted" }, "The archive is empty."));
      box.append(archBox);
    };

    // ---- categories --------------------------------------------------------------
    const renderCategories = async () => {
      const box = boxes.categories;
      const tree = await content.getCategoryTree().catch(() => []);
      const articles = await content.listArticles().catch(() => []);
      box.replaceChildren(
        h("p", { class: "kb-admin-desc" }, "The category tree articles live under. Renaming updates every breadcrumb; moving re-homes the subtree; deleting is blocked while articles still reference it."),
        h("div", { class: "kb-admin-row" },
          h("input", { class: "kb-input", id: "admCatNew", placeholder: "New top-level category", style: { maxWidth: "280px" } }),
          h("button", { class: "kb-btn kb-btn-primary kb-btn-sm", type: "button", id: "admCatAdd" }, "Add category"),
        ),
      );
      const addNode = (label, parentId) => content.addCategory({ parentId, label }).then(() => renderCategories());
      const build = (nodes, depth) => {
        const ul = h("ul", { class: "kb-admin-tree" });
        for (const n of nodes) {
          const li = h("li", { class: "kb-admin-tree-node" });
          const row = h("div", { class: "kb-admin-tree-row" });
          row.append(h("span", { class: "kb-admin-tree-indent" }, "—".repeat(depth) + (depth ? " " : "")), h("strong", null, n.label), h("span", { class: "kb-arch-meta" }, n.id));
          const count = articles.filter((a) => a.categoryId === n.id && a.status !== "archived").length;
          row.append(h("span", { class: "kb-cat-count" }, String(count)));
          const childBtn = h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button" }, "+ child");
          childBtn.addEventListener("click", async () => {
            const label = await promptPanel({ title: "New subcategory under “" + n.label + "”", placeholder: "Category name", confirmLabel: "Add" });
            if (label) await addNode(label, n.id);
          });
          const renameBtn = h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button" }, "Rename");
          renameBtn.addEventListener("click", async () => {
            const label = await promptPanel({ title: "Rename “" + n.label + "”", placeholder: "New name", confirmLabel: "Rename", initial: n.label });
            if (label) { await content.renameCategory(n.id, label); renderCategories(); }
          });
          const moveBtn = h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button" }, "Move…");
          moveBtn.addEventListener("click", async () => {
            const sel = h("select", { class: "kb-input" }, h("option", { value: "" }, "Top level"));
            for (const f of flattenTree(tree)) if (f.id !== n.id) sel.append(h("option", { value: f.id }, f.label));
            const overlay = h("div", { class: "kb-modal-overlay" });
            overlay.append(h("div", { class: "kb-modal" },
              h("h3", { class: "kb-modal-title" }, "Move “" + n.label + "” under…"), sel,
              h("div", { class: "kb-modal-actions" }, h("button", { class: "kb-btn kb-btn-ghost", type: "button" }, "Cancel"), h("button", { class: "kb-btn kb-btn-primary", type: "button" }, "Move"))));
            const [cancel, ok] = overlay.querySelectorAll("button");
            cancel.addEventListener("click", () => overlay.remove());
            ok.addEventListener("click", async () => {
              overlay.remove();
              try { await content.moveCategory(n.id, sel.value); renderCategories(); }
              catch (e) { ctx.toast(String((e && e.message) || e), "error", 5200); }
            });
            document.body.append(overlay);
          });
          const delBtn = h("button", { class: "kb-btn kb-btn-danger kb-btn-sm", type: "button" }, "Delete");
          delBtn.addEventListener("click", async () => {
            if (!(await confirmDialog({ title: "Delete category “" + n.label + "”?", message: "Deleted only if no article references it.", confirmLabel: "Delete", danger: true }))) return;
            try { await content.deleteCategory(n.id); renderCategories(); }
            catch (e) { ctx.toast(String((e && e.message) || e), "error", 5200); }
          });
          row.append(childBtn, renameBtn, moveBtn, delBtn);
          li.append(row);
          if (n.children && n.children.length) li.append(build(n.children, depth + 1));
          ul.append(li);
        }
        return ul;
      };
      if (tree.length) box.append(build(tree, 0));
      box.querySelector("#admCatAdd").addEventListener("click", async () => {
        const label = box.querySelector("#admCatNew").value.trim();
        if (!label) return;
        await addNode(label, "");
        box.querySelector("#admCatNew").value = "";
      });
    };

    // ---- templates ----------------------------------------------------------------
    const renderTemplates = async () => {
      const box = boxes.templates;
      const templates = await content.listTemplates().catch(() => []);
      box.replaceChildren(
        h("p", { class: "kb-admin-desc" }, "Reusable templates that pre-structure new articles per document type."),
      );
      for (const t of templates) {
        const wrap = h("details", { class: "kb-review-card" },
          h("summary", { class: "kb-review-summary" }, h("strong", null, (t.name || t.docType) + " (" + t.docType.toUpperCase() + ")"), h("span", { class: "kb-review-meta" }, t.desc || "")),
        );
        const name = h("input", { class: "kb-input", value: t.name || "", placeholder: "Template name" });
        const desc = h("input", { class: "kb-input", value: t.desc || "", placeholder: "Short description" });
        const body = h("textarea", { class: "kb-input", rows: 14, style: { fontFamily: "var(--font-mono)", fontSize: "13px" } });
        body.value = t.body || "";
        const save = h("button", { class: "kb-btn kb-btn-primary kb-btn-sm", type: "button" }, "Save template");
        const reset = h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button" }, "Reset to default");
        const preview = h("div", { class: "kb-editor-preview kb-prose" });
        preview.innerHTML = renderPreview(t.body);
        const toggle = h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button" }, "Preview");
        toggle.addEventListener("click", () => {
          preview.hidden = !preview.hidden;
          body.hidden = !preview.hidden;
          toggle.textContent = preview.hidden ? "Preview" : "Edit";
          if (!preview.hidden) preview.innerHTML = renderPreview(body.value);
        });
        body.addEventListener("input", () => { if (!preview.hidden) preview.innerHTML = renderPreview(body.value); });
        save.addEventListener("click", async () => {
          await content.saveTemplate({ id: t.id, docType: t.docType, name: name.value, desc: desc.value, body: body.value });
          ctx.toast("Template saved", "success");
        });
        reset.addEventListener("click", async () => {
          const def = content.defaultTemplates().find((d) => d.docType === t.docType);
          if (def) { await content.saveTemplate(def); ctx.toast("Template reset to default", "success"); renderTemplates(); }
        });
        wrap.append(h("div", { class: "kb-review-body" },
          h("div", { class: "kb-field-row" }, h("label", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Name"), name), h("label", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Description"), desc)),
          h("div", { class: "kb-field-row" }, toggle),
          body, preview,
          h("div", { class: "kb-review-actions" }, save, reset),
        ));
        box.append(wrap);
      }
    };
    const renderPreview = (mdSrc) => renderMarkdown(mdSrc).html;

    // ---- snippets -------------------------------------------------------------------
    const renderSnippets = async () => {
      const box = boxes.snippets;
      const snippets = await content.listSnippets().catch(() => []);
      box.replaceChildren(
        h("p", { class: "kb-admin-desc" }, "Reusable text (boilerplate compliance text, standard disclaimers, common definitions) insertable into any article from the editor."),
        h("div", { class: "kb-admin-row" },
          h("button", { class: "kb-btn kb-btn-primary kb-btn-sm", type: "button", id: "admSnipNew" }, "+ New snippet"),
        ),
      );
      const list = h("div", { class: "kb-blocks-list" });
      for (const sn of snippets) {
        const row = h("div", { class: "kb-block-row kb-snippet-row" });
        const title = h("input", { class: "kb-input", value: sn.title || "", placeholder: "Snippet title" });
        const text = h("textarea", { class: "kb-input", rows: 3, placeholder: "Snippet text (markdown)" });
        text.value = sn.text || "";
        const save = h("button", { class: "kb-btn kb-btn-primary kb-btn-sm", type: "button" }, "Save");
        const del = h("button", { class: "kb-btn kb-btn-danger kb-btn-sm", type: "button" }, "Delete");
        save.addEventListener("click", async () => {
          await content.saveSnippet({ id: sn.id, title: title.value.trim(), text: text.value });
          ctx.toast("Snippet saved", "success");
        });
        del.addEventListener("click", async () => {
          await content.deleteSnippet(sn.id);
          renderSnippets();
        });
        row.append(h("div", { class: "kb-block-fields" }, title, text), h("div", { class: "kb-block-actions" }, save, del));
        list.append(row);
      }
      box.append(list);
      box.querySelector("#admSnipNew").addEventListener("click", async () => {
        const res = await promptPanel({ title: "New snippet", placeholder: "Snippet title", confirmLabel: "Create" });
        if (!res) return;
        const sn = await content.saveSnippet({ id: "snip-" + Date.now().toString(36), title: res, text: "" });
        renderSnippets();
        ctx.toast("Snippet created", "success");
      });
    };

    // ---- identity -----------------------------------------------------------------------
    const renderIdentity = async () => {
      const box = boxes.identity;
      const identity = await content.getIdentity().catch(() => "");
      const input = h("input", { class: "kb-input", value: identity, placeholder: "Your name, e.g. Jordan (Finance)" , style: { maxWidth: "320px" }});
      const save = h("button", { class: "kb-btn kb-btn-primary kb-btn-sm", type: "button" }, "Save identity");
      save.addEventListener("click", async () => {
        await content.setIdentity(input.value.trim());
        ctx.toast("Identity saved — your edits are attributed to “" + (input.value.trim() || "system") + "”", "success");
      });
      box.replaceChildren(
        h("p", { class: "kb-admin-desc" }, "Used as the actor for everything you create, edit, submit and approve."),
        h("div", { class: "kb-admin-row" }, input, save),
      );
    };

    // ---- audit log ------------------------------------------------------------------------
    const renderAudit = async () => {
      const box = boxes.audit;
      const actions = await content.listAudit({ limit: 4000 }).catch(() => []);
      const actionFilter = h("select", { class: "kb-input" }, h("option", { value: "" }, "All actions"));
      const known = [...new Set(actions.map((a) => a.action))].sort();
      for (const k of known) actionFilter.append(h("option", { value: k }, k));
      const actorFilter = h("input", { class: "kb-input", placeholder: "Filter by actor…", value: "" });
      const tableBox = h("div", { class: "kb-audit-table" });
      const render = () => {
        const act = actionFilter.value;
        const actorQ = actorFilter.value.trim().toLowerCase();
        let rows = actions;
        if (act) rows = rows.filter((e) => e.action === act);
        if (actorQ) rows = rows.filter((e) => (e.actor || "").toLowerCase().includes(actorQ));
        tableBox.replaceChildren(table(
          ["Time", "Action", "Actor", "Target", "Detail"],
          rows.slice(0, 200).map((e) => [
            fmtDate(e.at), String(e.action || ""), esc(e.actor || "system"),
            e.target ? h("a", { href: "#/article/" + e.target }, e.target) : "—",
            esc(JSON.stringify(e.detail || {}).slice(0, 120)),
          ]),
        ));
        if (!rows.length) tableBox.append(h("p", { class: "kb-muted" }, "No entries match."));
      };
      actionFilter.addEventListener("change", render);
      actorFilter.addEventListener("input", render);
      render();
      box.replaceChildren(
        h("p", { class: "kb-admin-desc" }, "Read-only trail of every state-changing action — reconstruct the full documentation trail."),
        h("div", { class: "kb-admin-row" }, actionFilter, actorFilter),
        tableBox,
      );
    };

    // ---- users & roles (Phase 9, task 38) ------------------------------------
    const renderUsers = async () => {
      const box = boxes.users;
      const hub = ctx.hub;
      if (!hub || !hub.connected || !hub.authenticated || !hub.isAdmin) {
        box.replaceChildren(
          h("p", { class: "kb-admin-desc" }, "Users and roles are managed on the shared hub. This tab is available when the hub is connected and you're signed in as an admin."),
        );
        return;
      }
      const ROLE_NAMES = ["viewer", "editor", "reviewer", "admin"];
      const refresh = async () => {
        const users = await hub.listUsers().catch(() => []);
        const wrap = h("div", { class: "kb-users" });
        if (!users.length) wrap.append(h("p", { class: "kb-muted" }, "No accounts yet — visitors can create one from the account menu."));
        for (const u of users) {
          const roleRows = (u.roles || []).map((r) => {
            const cat = r.cat;
            const sel = h("select", { class: "kb-input kb-input-sm kb-role-sel" },
              ROLE_NAMES.map((name) => h("option", { value: name, selected: name === ROLE_NAMES[r.role] ? true : null }, name + (cat === "*" ? " · all categories" : ""))));
            sel.addEventListener("change", async () => {
              try { await hub.grantRole(u.username, cat, sel.value); ctx.toast("Role updated", "success"); refresh(); }
              catch (e) { ctx.toast(String((e && e.message) || e), "error", 5200); }
            });
            const rm = h("button", { class: "kb-icon-btn kb-btn-sm", type: "button", title: "Remove role" }, "×");
            rm.addEventListener("click", async () => {
              try { await hub.revokeRole(u.username, cat); refresh(); } catch (e) { ctx.toast(String((e && e.message) || e), "error", 5200); }
            });
            return h("span", { class: "kb-role-grant" }, sel, rm);
          });
          const catInput = h("input", { class: "kb-input kb-input-sm", placeholder: "category id" });
          const addRole = h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button", title: "Grant role in category" }, "+");
          addRole.addEventListener("click", async () => {
            const cat = catInput.value.trim();
            if (!cat) return;
            try { await hub.grantRole(u.username, cat, "viewer"); ctx.toast("Role added in " + cat, "success"); refresh(); }
            catch (e) { ctx.toast(String((e && e.message) || e), "error", 5200); }
          });
          const banBtn = h("button", { class: "kb-btn " + (u.banned ? "kb-btn-ghost" : "kb-btn-danger") + " kb-btn-sm", type: "button" }, u.banned ? "Unban" : "Ban");
          banBtn.addEventListener("click", async () => {
            try { await hub.setBanned(u.username, !u.banned); ctx.toast(u.banned ? "Unbanned " + u.username : "Banned " + u.username, "success"); refresh(); }
            catch (e) { ctx.toast(String((e && e.message) || e), "error", 5200); }
          });
          wrap.append(
            h("div", { class: "kb-user-card" },
              h("div", { class: "kb-user-head" },
                h("span", { class: "kb-avatar" }, (u.username || "?").slice(0, 2).toUpperCase()),
                h("strong", null, u.username),
                u.isAdmin ? h("span", { class: "kb-role-badge kb-role-admin" }, "admin") : null,
                u.banned ? h("span", { class: "kb-role-badge kb-role-banned" }, "banned") : null,
              ),
              h("div", { class: "kb-user-meta" }, "Created " + fmtDate(u.createdAt) + " · last seen " + (u.lastSeen ? fmtDate(u.lastSeen) : "never")),
              h("div", { class: "kb-user-roles" }, roleRows.length ? roleRows : h("span", { class: "kb-muted" }, "no roles — viewer everywhere")),
              h("div", { class: "kb-user-actions" }, catInput, addRole, banBtn),
            ),
          );
        }
        box.replaceChildren(
          h("p", { class: "kb-admin-desc" }, "Accounts, per-category roles and ban status — enforced by the server on every write. Add a role with the + button (category id, or * for all categories)."),
          h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button", onClick: refresh }, "Refresh"),
          wrap,
        );
      };
      refresh();
    };

    // ---- integrations (task 29) ------------------------------------------------------------------
    const renderIntegrations = async () => {
      const box = boxes.integrations;
      const bundles = await content.getBundles().catch(() => null);
      const gn = window.generatorName || "";
      const editableName = (ctx.kb.storageNamespace || "kb-system").replace(/[^a-z0-9-]/g, "").toLowerCase() + "-bundles";
      const pubUrl = "https://editable.uploads.dev/file/" + gn + "/" + editableName;
      const refresh = async () => {
        const b = await content.getBundles().catch(() => null);
        if (b) bundleLine.textContent = b.count + " published articles · bundle updated " + new Date(b.updatedAt || Date.now()).toLocaleString();
        else bundleLine.textContent = "No bundles yet — publish an article first.";
      };
      const bundleLine = h("p", { class: "kb-muted" });
      box.replaceChildren(
        h("p", { class: "kb-admin-desc" }, "The KB publishes a retrieval-ready bundle per article plus a category index, so the AI assistant, AI voice assistant and any other tool can consume the KB without re-fetching everything."),
        h("div", { class: "kb-admin-row" },
          h("button", { class: "kb-btn kb-btn-primary kb-btn-sm", type: "button", id: "admPubBundles" }, "Publish bundles"),
          h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button", id: "admConsumer" }, "Download example consumer"),
        ),
        bundleLine,
        h("div", { class: "kb-section-title" }, h("h3", null, "Single-file URL (after publishing)")),
        h("code", { class: "kb-code-inline" }, bundles ? pubUrl : "(publish bundles to expose the URL)"),
        h("div", { class: "kb-section-title" }, h("h3", null, "Retrieval pattern")),
        h("pre", { class: "kb-code-block" }, `// AI assistant / voice assistant retrieval
const KB_URL = "${pubUrl}";          // the published bundle file
const res  = await fetch(KB_URL);
const kb   = await res.json();        // { schema, updatedAt, count, manifest, articles, categoryIndex }

// fetch one article's current version by id
function getArticle(id) { return kb.articles[id] || null; }

// category-level index: which ids are current, without re-fetching bodies
const currentIds = Object.keys(kb.categoryIndex['operations'] || {});

// caching rule: refetch only when kb.updatedAt changes (or on a schedule)
`),
        h("div", { class: "kb-section-title" }, h("h3", null, "Bundle entry format")),
        h("pre", { class: "kb-code-block" }, `{
  "schema": "kb-bundle/1",
  "id": "art-…", "title": "…", "summary": "…",
  "categoryId": "operations", "categoryPath": ["Operations"],
  "tags": ["…"], "docType": "sop",
  "body": "# Purpose\n…", "version": 4,
  "publishedVersion": 3, "updatedAt": 1710000000000,
  "permalink": "#/article/art-…", "status": "published"
}`),
      );
      bundleLine.hidden = false;
      refresh();
      box.querySelector("#admPubBundles").addEventListener("click", async () => {
        const btn = box.querySelector("#admPubBundles");
        btn.disabled = true;
        btn.textContent = "Publishing…";
        try {
          const res = await content.publishBundlesPublic();
          if (res.ok) {
            ctx.toast("Bundles published — " + res.payload.count + " articles", "success");
            refresh();
          } else {
            ctx.toast("Published in-store; public file: " + (res.reason || "unknown"), "warning", 5200);
            refresh();
          }
        } catch (e) {
          ctx.toast(String((e && e.message) || e), "error", 6000);
        } finally {
          btn.disabled = false;
          btn.textContent = "Publish bundles";
        }
      });
      box.querySelector("#admConsumer").addEventListener("click", () => {
        const html = `<!doctype html><html><head><meta charset="utf-8"><title>KB example consumer</title></head><body>
<h1>Knowledge Base — example consumer</h1>
<p>This tiny consumer fetches the published KB bundle and lists current articles.</p>
<pre id="out">Loading…</pre>
<script>
const KB_URL = "${pubUrl}";
(async () => {
  try {
    const res = await fetch(KB_URL);
    const kb = await res.json();
    const out = [];
    out.push('schema: ' + kb.schema + '  ·  updatedAt: ' + new Date(kb.updatedAt).toISOString() + '  ·  ' + kb.count + ' articles');
    for (const [id, a] of Object.entries(kb.articles)) {
      out.push('— ' + a.title + '  [v' + a.version + ']  (' + a.docType + ' · ' + a.status + ' · updated ' + new Date(a.updatedAt).toISOString() + ')');
    }
    document.getElementById('out').textContent = out.join('\\n');
  } catch (e) {
    document.getElementById('out').textContent = 'Could not fetch: ' + e;
  }
})();
<\/script>
</body></html>`;
        const blob = new Blob([html], { type: "text/html" });
        const url = URL.createObjectURL(blob);
        const a = h("a", { href: url, download: "kb-consumer.html" });
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
      });
    };

    renderBackup();
    renderCapacity();
    renderCategories();
    renderTemplates();
    renderSnippets();
    renderIdentity();
    renderAudit();
    renderUsers();
    renderIntegrations();
    showTab("backup");

    const panel = viewPanel({
      crumb: "Knowledge base / Admin",
      title: "Admin",
      desc: "Backup, restore, capacity, categories, templates, snippets, identity, audit, users & roles, and integrations.",
      body: h("div", { class: "kb-admin" }, tabs, ...tabDefs.map(([k]) => boxes[k])),
    });
    ctx.container.replaceChildren(panel);
  },
};

function table(headers, rows) {
  return h("table", { class: "kb-table" },
    h("thead", null, h("tr", null, headers.map((hdr) => h("th", null, hdr)))),
    h("tbody", null, rows.map((r) => h("tr", null, r.map((c) => h("td", null, c))))),
  );
}
