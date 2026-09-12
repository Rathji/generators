// src/modules/record-links.js — the shared "Linked records" block.
//
// The rich editor modules (documents, diagrams, site summaries, domain and
// certificate trackers) all show the same thing: the typed links that touch the
// record being edited, with an easy way to add a new one. This module is that
// block, so each editor does not re-implement the picker.
//
// Every link is stored once and shown from BOTH ends. The picker only offers
// records of the far-side types a listed kind allows, so an invalid link cannot
// be built here. A kind entry is:
//   { kind, label, types:[collectionId,…], side:"from"|"to" }
// where `side` is which end the record being edited is; `types` is the allowed
// collections on the OTHER end.

import { h, clear } from "../framework/dom.js";
import { icons } from "../framework/icons.js";
import { findRecord, relationshipKind, relationsOf } from "../framework/relationships.js";
import { RECORD_TYPE_META } from "../framework/docsets.js";
import { openModal } from "./shared.js";

const whoami = (ctx) => (ctx.hub && ctx.hub.username) || "owner";

export function linksSection(ctx, { setId, set, record, kinds, readonly = false, onChange }) {
  const ref = { type: record.type, id: record.id };
  const linked = relationsOf(set, ref);
  const section = h(
    "section",
    { class: "kb-card kb-profile-section" },
    h(
      "div",
      { class: "kb-section-head" },
      h("span", { class: "kb-section-icon", html: icons.link }),
      h("h2", { class: "kb-section-name" }, "Linked records"),
      h("span", { class: "kb-count-pill" }, String(linked.length)),
      readonly
        ? null
        : h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button", onClick: () => openLinkPicker(ctx, setId, record, set, kinds, onChange) }, "+ Link"),
    ),
  );
  if (!linked.length) {
    section.append(h("p", { class: "kb-muted" }, "Not linked to anything yet. Link this record to the sites, locations, assets and documents it concerns, so the same fact is never duplicated."));
    return section;
  }
  const list = h("ul", { class: "kb-rel-list" });
  for (const { relationship, direction, other } of linked) {
    const rec = findRecord(set, other);
    const k = relationshipKind(relationship.kind);
    const coll = rec ? (RECORD_TYPE_META[rec.type] ? RECORD_TYPE_META[rec.type].singular : rec.type) : "missing";
    list.append(
      h(
        "li",
        { class: "kb-rel-item" + (rec ? "" : " kb-rel-item--dangling") },
        h("span", { class: "kb-rel-item-dir", title: direction === "out" ? "This record → the other" : "The other → this record" }, direction === "out" ? "→" : "←"),
        h("span", { class: "kb-rel-item-name" }, rec ? rec.name : "(missing record)"),
        h("span", { class: "kb-rel-item-meta" }, coll),
        k ? h("span", { class: "kb-badge kb-rel-kind" }, k.label) : null,
        readonly
          ? null
          : h(
              "button",
              {
                class: "kb-btn kb-btn-ghost kb-btn-sm kb-btn-danger-text",
                type: "button",
                onClick: async () => {
                  try {
                    await ctx.docs.unlinkRecords(setId, relationship.id, { updatedBy: whoami(ctx) });
                    ctx.toast("Unlinked", "success");
                    onChange && (await onChange());
                  } catch (e) {
                    ctx.toast(String((e && e.message) || e), "error", 5200);
                  }
                },
              },
              "Unlink",
            ),
      ),
    );
  }
  section.append(list);
  return section;
}

function openLinkPicker(ctx, setId, record, set, kinds, onChange) {
  const groups = kinds.map((k) => {
    const side = k.side === "to" ? "to" : "from";
    const candidates = [];
    for (const t of k.types) {
      for (const r of set.records[t] || []) {
        if (t === record.type && r.id === record.id) continue;
        candidates.push(r);
      }
    }
    return { ...k, side, candidates };
  });
  const kindSel = h("select", { class: "kb-input" });
  groups.forEach((g, i) => kindSel.append(h("option", { value: String(i) }, g.label)));
  const recSel = h("select", { class: "kb-input" });
  const renderRecords = () => {
    const g = groups[Number(kindSel.value)] || groups[0];
    clear(recSel);
    const already = new Set(
      (set.records.relationships || [])
        .filter((r) => r.kind === g.kind && (r.from.id === record.id || r.to.id === record.id))
        .map((r) => (r.from.id === record.id ? r.to.id : r.from.id)),
    );
    const avail = g.candidates.filter((r) => !already.has(r.id));
    if (!avail.length) recSel.append(h("option", { value: "" }, "Nothing available to link"));
    else
      avail.forEach((r, i) => {
        const coll = RECORD_TYPE_META[r.type] ? RECORD_TYPE_META[r.type].singular : r.type;
        recSel.append(h("option", { value: String(i) }, r.name + "  —  " + coll));
      });
    recSel._avail = avail;
  };
  kindSel.addEventListener("change", renderRecords);
  renderRecords();

  const m = openModal({
    title: "Link — " + record.name,
    description: "Link this record to the records it concerns. The link is typed, so the relationship is reusable from both ends.",
    children: [
      h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Link to a"), kindSel),
      h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Record"), recSel),
    ],
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
          const g = groups[Number(kindSel.value)] || groups[0];
          const other = (recSel._avail || [])[Number(recSel.value)];
          if (!other) {
            m.showError("Pick a record to link.");
            return;
          }
          const ref = { type: record.type, id: record.id };
          const otherRef = { type: other.type, id: other.id };
          const from = g.side === "to" ? otherRef : ref;
          const to = g.side === "to" ? ref : otherRef;
          try {
            await ctx.docs.linkRecords(setId, { from, to, kind: g.kind, createdBy: whoami(ctx) });
            m.close();
            ctx.toast("Linked “" + other.name + "”", "success");
            onChange && (await onChange());
          } catch (e) {
            m.showError(String((e && e.message) || e));
          }
        },
      },
      "Link",
    ),
  );
}
