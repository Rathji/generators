// src/modules/asset-profile.js — the Flexible Asset PROFILE (roadmap tasks
// 14–16).
//
// A record row shows a one-line summary; the profile is where an asset's whole
// story lives: its template, its fields, its renewal status and — the point of
// tasks 15/16 — its relationships, grouped and labelled ("Runs on",
// "Credentials", "Vendor", "Licensing", "Supporting documents", "Members" …)
// rather than a flat list of links. Each group links to the right relationship
// kind and offers a picker of the records that could be linked next, so the
// graph is built from the asset itself.

import { h, clear } from "../framework/dom.js";
import { icons } from "../framework/icons.js";
import { loadingState } from "../framework/states.js";
import { openModal, relTime } from "./shared.js";
import { openInstanceDialog } from "./assets.js";
import { openCredentialDialog } from "./credential-view.js";
import { assetFieldsOf, assetCategory, referenceType } from "../framework/flexible.js";
import { relationGroupsFor, groupLinks, relationCandidates, linkParamsFor } from "../framework/assetRelations.js";
import { expiryFieldOf, renewalStatus, renewalStateDef, renewalPhrase } from "../framework/renewals.js";
import { provenanceDef } from "../framework/classification.js";
import { libraryForAssetType, libraryTopicLabel } from "../framework/library.js";

const whoami = (ctx) => (ctx.hub && ctx.hub.username) || "owner";
const typeIcon = (t) => icons[(t && t.icon) || "layers"] || icons.layers;

export async function openAssetProfile(ctx, { setId, record, type, reload } = {}) {
  if (!setId || !record) return;
  const body = h("div", { class: "kb-profile-body" }, loadingState({ label: "Loading asset…" }));
  const m = openModal({
    title: record.name,
    description: type ? type.name : "Flexible asset",
    wide: true,
    children: [body],
  });
  const box = m.overlay.querySelector(".kb-modal");
  if (box) box.classList.add("kb-modal-designer");

  async function rerender() {
    clear(body);
    body.append(loadingState({ label: "Loading asset…" }));
    let set = await ctx.docs.get(setId, { force: true }).catch(() => null);
    clear(body);
    if (!set) {
      body.append(h("p", { class: "kb-muted" }, "This documentation set could not be loaded."));
      return;
    }
    const live = (set.records.flexibleAssets || []).find((r) => r.id === record.id) || record;
    body.append(headerBlock(live, type));
    body.append(fieldsBlock(live, type, set));
    const renewal = renewalBlock(live, type);
    if (renewal) body.append(renewal);
    body.append(relationsBlock(ctx, setId, live, type, set, rerender));
    const library = libraryBlock(type, (articleId) => {
      m.close();
      ctx.go("#/library/" + encodeURIComponent(articleId));
    });
    if (library) body.append(library);
  }

  m.actions.append(
    h("button", { class: "kb-btn kb-btn-ghost", type: "button", onClick: m.close }, "Close"),
    h(
      "button",
      {
        class: "kb-btn kb-btn-primary",
        type: "button",
        id: "kbProfileEditBtn",
        onClick: () => {
          if (!type) return;
          openInstanceDialog(ctx, type, {
            setId,
            record,
            reload: () => {
              rerender();
              reload && reload();
            },
          });
        },
      },
      "Edit fields",
    ),
  );

  await rerender();
}

function headerBlock(record, type) {
  const cat = type ? assetCategory(type.category) : null;
  const prov = provenanceDef(record.provenance);
  const badges = h(
    "div",
    { class: "kb-profile-badges" },
    type ? h("span", { class: "kb-badge kb-badge-custom" }, type.name) : h("span", { class: "kb-badge kb-badge-incomplete" }, "No template"),
    cat ? h("span", { class: "kb-badge kb-badge-model" }, cat.label) : null,
    prov ? h("span", { class: "kb-badge kb-badge-prov kb-badge-prov--" + (record.provenance || "none"), title: prov.description }, prov.label) : null,
    record.origin && record.origin.source ? h("span", { class: "kb-badge kb-badge-archived" }, record.origin.source) : null,
  );
  return h(
    "div",
    { class: "kb-profile-head" },
    h("span", { class: "kb-profile-icon", html: typeIcon(type) }),
    h("div", { class: "kb-profile-head-text" }, h("div", { class: "kb-profile-name" }, record.name), badges),
  );
}

function fieldValue(f, value, set) {
  if (f.type === "checkbox") return value === true ? "Yes" : "No";
  if (value == null || value === "" || (Array.isArray(value) && !value.length)) return "—";
  if (f.type === "select") return ((f.options || []).find((o) => o.id === value) || {}).label || String(value);
  if (f.type === "multiselect") {
    const arr = Array.isArray(value) ? value : String(value).split(",").map((s) => s.trim()).filter(Boolean);
    return arr.map((x) => ((f.options || []).find((o) => o.id === x) || {}).label || x).join(", ");
  }
  if (f.type === "record") {
    const rec = set && set.records && set.records[f.of] ? set.records[f.of].find((r) => r.id === value) : null;
    return rec ? rec.name : "(missing: " + value + ")";
  }
  return String(value);
}

function fieldsBlock(record, type, set) {
  const fields = (type && type.fields) || [];
  const values = assetFieldsOf(record);
  const rows = fields.map((f) =>
    h(
      "tr",
      { class: f.expiry ? "kb-profile-expiry-row" : null },
      h("th", { scope: "row" }, f.label, f.expiry ? h("span", { class: "kb-badge kb-badge-required" }, "renewal") : null),
      h("td", null, fieldValue(f, values[f.key], set)),
    ),
  );
  return h(
    "section",
    { class: "kb-card kb-profile-section" },
    h("div", { class: "kb-section-head" }, h("span", { class: "kb-section-icon", html: icons.clipboard }), h("h2", { class: "kb-section-name" }, "Fields"), h("span", { class: "kb-count-pill" }, String(fields.length))),
    rows.length
      ? h("table", { class: "kb-table kb-profile-table" }, h("tbody", null, rows))
      : h("p", { class: "kb-muted" }, "This template defines no fields."),
  );
}

function renewalBlock(record, type) {
  const field = expiryFieldOf(type);
  if (!field) return null;
  const status = renewalStatus(record, type);
  const def = renewalStateDef(status.state);
  const value = status.iso || "not set";
  return h(
    "section",
    { class: "kb-card kb-profile-section kb-renewal kb-renewal--" + status.state },
    h(
      "div",
      { class: "kb-section-head" },
      h("span", { class: "kb-section-icon", html: icons.clock }),
      h("h2", { class: "kb-section-name" }, "Renewal"),
      def ? h("span", { class: "kb-badge kb-renewal-badge kb-renewal-badge--" + def.tone }, def.label) : null,
    ),
    h(
      "div",
      { class: "kb-renewal-line" },
      h("span", { class: "kb-renewal-date" }, field.label + ": " + value),
      status.daysUntil != null ? h("span", { class: "kb-muted" }, "· " + renewalPhrase(status) + " (alert " + status.alert + " days before)") : h("span", { class: "kb-muted" }, "· no date recorded"),
    ),
  );
}

function relationsBlock(ctx, setId, record, type, set, rerender) {
  if (!type) return h("section", { class: "kb-card kb-profile-section" }, h("p", { class: "kb-muted" }, "This asset has no template, so relationships cannot be grouped."));
  const grouped = groupLinks(record, set, type);
  const section = h(
    "section",
    { class: "kb-card kb-profile-section" },
    h(
      "div",
      { class: "kb-section-head" },
      h("span", { class: "kb-section-icon", html: icons.link }),
      h("h2", { class: "kb-section-name" }, "Relationships"),
      h("span", { class: "kb-count-pill" }, String(grouped.total)),
    ),
  );

  if (!grouped.groups.length && !grouped.leftovers.length) {
    section.append(h("p", { class: "kb-muted" }, "No relationships yet. Use the groups below to link this asset to its configurations, credentials, vendor, licensing, documents and people."));
  }

  for (const group of grouped.groups) {
    const block = h("div", { class: "kb-rel-group", dataset: { group: group.id } });
    block.append(
      h(
        "div",
        { class: "kb-rel-group-head" },
        h("span", { class: "kb-rel-group-label" }, group.label),
        h("span", { class: "kb-rel-group-count" }, group.links.length ? String(group.links.length) : ""),
        group.collections.includes("passwords")
          ? h(
              "button",
              {
                class: "kb-btn kb-btn-ghost kb-btn-sm",
                type: "button",
                title: "Create a credential embedded in this asset (it inherits this asset's permissions).",
                onClick: () => openCredentialDialog(ctx, { setId, reload: rerender, embeddedIn: { type: record.type, id: record.id } }),
              },
              "+ Add credential",
            )
          : null,
        h(
          "button",
          {
            class: "kb-btn kb-btn-ghost kb-btn-sm",
            type: "button",
            onClick: () => openLinkPicker(ctx, setId, record, type, group, set, rerender),
          },
          "+ Link",
        ),
      ),
    );
    if (group.hint) block.append(h("p", { class: "kb-rel-group-hint" }, group.hint));
    if (group.links.length) {
      const list = h("ul", { class: "kb-rel-list" });
      for (const link of group.links) list.append(relationRow(ctx, setId, record, type, link, rerender));
      block.append(list);
    } else {
      block.append(h("p", { class: "kb-muted kb-rel-empty" }, "Nothing linked yet."));
    }
    section.append(block);
  }

  if (grouped.leftovers.length) {
    const block = h("div", { class: "kb-rel-group kb-rel-group--other" });
    block.append(h("div", { class: "kb-rel-group-head" }, h("span", { class: "kb-rel-group-label" }, "Other links"), h("span", { class: "kb-rel-group-count" }, String(grouped.leftovers.length))));
    const list = h("ul", { class: "kb-rel-list" });
    for (const link of grouped.leftovers) list.append(relationRow(ctx, setId, record, type, link, rerender));
    block.append(list);
    section.append(block);
  }
  return section;
}

// The library block (roadmap task 35): the service processes and runbooks that
// cover this asset's template, offered from the asset itself. Opening an article
// closes the profile and navigates to it in the Library station.
function libraryBlock(type, onOpen) {
  if (!type) return null;
  const articles = libraryForAssetType(type.id);
  if (!articles.length) return null;
  return h(
    "section",
    { class: "kb-card kb-profile-section", dataset: { block: "library" } },
    h(
      "div",
      { class: "kb-section-head" },
      h("span", { class: "kb-section-icon", html: icons.browse }),
      h("h2", { class: "kb-section-name" }, "How-to from the library"),
      h("span", { class: "kb-count-pill" }, String(articles.length)),
    ),
    h("p", { class: "kb-muted" }, "Service processes and runbooks from the library that cover this asset. Follow them as written, or adapt them to this client."),
    h(
      "div",
      { class: "kb-library-linklist" },
      articles.map((a) =>
        h(
          "button",
          { class: "kb-library-linkitem", type: "button", dataset: { id: a.id }, onClick: () => onOpen(a.id) },
          h("span", { class: "kb-library-linkitem-title" }, a.title),
          h("span", { class: "kb-library-linkitem-meta" }, libraryTopicLabel(a.topic)),
        ),
      ),
    ),
  );
}

function relationRow(ctx, setId, record, type, link, rerender) {
  const other = link.other;
  const label = other ? other.name : "(missing record)";
  const coll = other ? referenceType(other.type) : null;
  const kind = (ctx.docs.relationshipKind && ctx.docs.relationshipKind(link.relationship.kind)) || null;
  const node = h(
    "li",
    { class: "kb-rel-item" + (other ? "" : " kb-rel-item--dangling") },
    h("span", { class: "kb-rel-item-name" }, label),
    h("span", { class: "kb-rel-item-meta" }, coll ? coll.label : (other ? other.type : "missing")),
    kind ? h("span", { class: "kb-badge kb-rel-kind" }, kind.label) : null,
    h(
      "button",
      {
        class: "kb-btn kb-btn-ghost kb-btn-sm kb-btn-danger-text",
        type: "button",
        onClick: async () => {
          try {
            await ctx.docs.unlinkRecords(setId, link.relationship.id, { updatedBy: whoami(ctx) });
            ctx.toast("Unlinked", "success");
            rerender();
          } catch (e) {
            ctx.toast(String((e && e.message) || e), "error", 5200);
          }
        },
      },
      "Unlink",
    ),
  );
  return node;
}

function openLinkPicker(ctx, setId, record, type, group, set, done) {
  const candidates = relationCandidates(record, set, group);
  if (!candidates.length) {
    ctx.toast("No unlinked records available for “" + group.label + "”.", "warning", 5200);
    return;
  }
  const sel = h("select", { class: "kb-input" });
  candidates.forEach((r, i) => {
    const coll = referenceType(r.type);
    const typeName = r.type === "flexibleAssets" ? (r.assetTypeId || "asset") : coll ? coll.label : r.type;
    sel.append(h("option", { value: String(i) }, r.name + "  —  " + (r.type === "flexibleAssets" ? "flexible asset" : typeName)));
  });
  const m = openModal({
    title: "Link — " + group.label,
    description: group.hint || "",
    children: [h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Link to"), sel)],
  });
  m.actions.append(
    h("button", { class: "kb-btn kb-btn-ghost", type: "button", onClick: m.close }, "Cancel"),
    h(
      "button",
      {
        class: "kb-btn kb-btn-primary",
        type: "button",
        onClick: async () => {
          m.clearError();
          const other = candidates[Number(sel.value)];
          if (!other) return;
          try {
            const params = linkParamsFor(record, group, other);
            await ctx.docs.linkRecords(setId, { ...params, createdBy: whoami(ctx) });
            m.close();
            ctx.toast("Linked “" + other.name + "”", "success");
            done();
          } catch (e) {
            m.showError(String((e && e.message) || e));
          }
        },
      },
      "Link",
    ),
  );
}
