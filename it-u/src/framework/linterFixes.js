// src/framework/linterFixes.js — one-click application of the linter's
// suggested fixes (roadmap task 48).
//
// Every finding the linter produces carries a `fix` descriptor (see
// ./linter.js). This module turns that descriptor into an action against the
// documentation set: fill a missing field, create the relationship the finding
// proposes, extract prose into a Document, or convert a note / free-text
// document into a structured Flexible Asset. It is the write half of the
// Linter; the station (src/modules/linter.js) calls `fixPlan` to decide what a
// row's Fix button should do and `applyLintFix` to do it, then re-runs the
// audit.
//
// The relationship catalog is strict (each kind names the collections it may
// join), so a proposed link is only auto-appliable when a matching kind exists;
// `pickLink` finds it, trying the natural direction and then the reverse. When
// no kind exists the plan says so and the UI falls back to a guided action.

import { RELATIONSHIP_KINDS } from "./relationships.js";
import { RECORD_TYPE_META } from "./docsets.js";
import { noteFieldPairs } from "./linter.js";

// The template every converted note/free-text record lands in until it is
// re-templated (./assetLibrary.js, category "custom").
export const CUSTOM_ASSET_TYPE_ID = "atype-custom";

const typeLabel = (t) => (RECORD_TYPE_META[t] || {}).singular || t;

// ---- relationship selection -------------------------------------------------
// Every catalog kind that could join `fromType` → `toType`.
export function linkKindsFor(fromType, toType) {
  return RELATIONSHIP_KINDS.filter((k) => k.from.includes(fromType) && k.to.includes(toType)).map((k) => k.id);
}

// Kinds that are the most natural home for a proposed link, in preference order.
const PREFERRED_LINK_KINDS = [
  "certificate-service",
  "domain-asset",
  "configuration-credential",
  "document-asset",
  "document-service",
  "document-organization",
  "document-location",
  "asset-reference",
  "password-embedded-in",
];

// The link to create between two records, or null when the catalog has no kind
// that can join them (in either direction).
export function pickLink(fromRef, toRef) {
  if (!fromRef || !toRef || !fromRef.type || !toRef.type || !fromRef.id || !toRef.id) return null;
  const forward = linkKindsFor(fromRef.type, toRef.type);
  if (forward.length) {
    const kind = PREFERRED_LINK_KINDS.find((k) => forward.includes(k)) || forward[0];
    return { from: { type: fromRef.type, id: fromRef.id }, to: { type: toRef.type, id: toRef.id }, kind };
  }
  const reverse = linkKindsFor(toRef.type, fromRef.type);
  if (reverse.length) {
    const kind = PREFERRED_LINK_KINDS.find((k) => reverse.includes(k)) || reverse[0];
    return { from: { type: toRef.type, id: toRef.id }, to: { type: fromRef.type, id: fromRef.id }, kind };
  }
  return null;
}

// ---- fix planning -----------------------------------------------------------
// Describe what a finding's fix would do, without doing it. `auto` means it can
// be applied with no further input; `needs` lists what is missing (“value” or
// “target”); `destructive` warns that an existing record is replaced.
export function fixPlan(finding) {
  const fix = finding && finding.fix;
  if (!fix) return null;
  const ref = fix.ref || (finding && finding.ref) || null;
  switch (fix.kind) {
    case "fill-field": {
      if (fix.field) {
        return { kind: "fill-field", label: "Fill in “" + (fix.label || fix.field) + "”", auto: false, needs: ["value"], destructive: false, ref, field: fix.field };
      }
      // A relationship rule (e.g. "at least one associated credential") needs a
      // record to point at, not a value.
      return { kind: "link-records", label: "Link a credential", auto: false, needs: ["target"], targetType: "passwords", destructive: false, ref, ruleKey: fix.ruleKey };
    }
    case "link-records": {
      const link = fix.target ? pickLink(ref, fix.target) : null;
      if (link) {
        return {
          kind: "link-records",
          label: "Create the link",
          auto: true,
          needs: [],
          destructive: false,
          ref,
          target: fix.target,
          link,
        };
      }
      return { kind: "link-records", label: "Link to a record…", auto: false, needs: ["target"], destructive: false, ref };
    }
    case "extract-document": {
      const link = ref ? pickLink({ type: "documents", id: "pending" }, ref) : null;
      return {
        kind: "extract-document",
        label: "Move the prose into a document",
        auto: true,
        needs: [],
        destructive: false,
        ref,
        field: fix.field,
        fieldLabel: fix.label,
        // Whether the new document can be linked back to the record.
        link: link ? link.kind : null,
        unlinkable: !link,
      };
    }
    case "convert-to-asset":
      return { kind: "convert-to-asset", label: "Create a structured asset", auto: true, needs: [], destructive: false, ref, values: fix.values || [], link: "document-asset" };
    case "convert-note-to-asset":
      return { kind: "convert-note-to-asset", label: "Convert the note into an asset", auto: true, needs: [], destructive: true, ref, link: "document-asset" };
    case "open-record":
      return { kind: "open-record", label: "Open the record", auto: false, needs: [], destructive: false, ref, navigational: true };
    default:
      return null;
  }
}

// Whether a finding can be applied with a single click (no further input).
export const canAutoFix = (finding) => {
  const plan = fixPlan(finding);
  return !!(plan && plan.auto && !plan.navigational);
};

// ---- applying a fix ---------------------------------------------------------
const refOf = (record, type) => ({ type: record.type || type, id: record.id, name: record.name });

function findInSet(set, ref) {
  if (!set || !set.records || !ref) return null;
  return (set.records[ref.type] || []).find((r) => r.id === ref.id) || null;
}

// Apply one finding's fix. `ctx` = { docs, setId, actor, typeOf }; `opts` may
// carry the value a `fill-field` fix should set, or the `target` ref/record a
// link fix should point at. Returns { ok, action, detail, created, removed,
// link } or { ok:false, needs|error }.
export async function applyLintFix(ctx, finding, opts = {}) {
  const { docs, setId } = ctx || {};
  if (!docs || !setId) return { ok: false, error: "No documentation set to fix." };
  const actor = opts.actor || ctx.actor || "system";
  const plan = fixPlan(finding);
  if (!plan) return { ok: false, error: "This finding has no suggested fix." };
  const set = await docs.get(setId, { force: true });
  if (!set) return { ok: false, error: "The documentation set could not be loaded." };

  try {
    if (plan.kind === "fill-field") {
      const value = String(opts.value == null ? "" : opts.value).trim();
      if (!value) return { ok: false, needs: ["value"] };
      const rec = findInSet(set, plan.ref);
      await docs.updateRecord(setId, plan.ref, { [plan.field]: value }, { updatedBy: actor });
      return { ok: true, action: "fill-field", detail: "Filled “" + (plan.field || "") + "” on “" + ((rec && rec.name) || plan.ref.name || "") + "”." };
    }

    if (plan.kind === "link-records") {
      const rawTarget = opts.target || plan.target;
      const target = rawTarget && rawTarget.type ? { type: rawTarget.type, id: rawTarget.id } : null;
      if (!target) return { ok: false, needs: ["target"], targetType: plan.targetType || null };
      const link = plan.link || pickLink(plan.ref, target);
      if (!link) return { ok: false, error: "No relationship kind in the catalog can join those two records." };
      const res = await docs.linkRecords(setId, { ...link, createdBy: actor }, {});
      return { ok: true, action: "link-records", detail: "Linked the records.", link: res.relationship };
    }

    if (plan.kind === "extract-document") {
      const rec = findInSet(set, plan.ref);
      if (!rec) return { ok: false, error: "The record no longer exists." };
      const text = String(rec[plan.field] || "").trim();
      if (!text) return { ok: false, error: "The field is already empty." };
      const created = await docs.addDocument(
        setId,
        {
          name: rec.name + " — " + (plan.fieldLabel || "notes"),
          docType: "operational-notes",
          summary: "Extracted from the " + (plan.fieldLabel || "notes") + " field of “" + rec.name + "”.",
          body: text,
          informationModel: "document",
          provenance: "authored",
        },
        { updatedBy: actor },
      );
      const docRef = refOf(created.record, "documents");
      const link = plan.link ? pickLink(docRef, plan.ref) : null;
      let linked = false;
      if (link) {
        await docs.linkRecords(setId, { ...link, createdBy: actor });
        linked = true;
      }
      await docs.updateRecord(setId, plan.ref, { [plan.field]: "See the linked document." }, { updatedBy: actor });
      return { ok: true, action: "extract-document", detail: "Moved the prose into “" + created.record.name + "”.", created: docRef, link: link ? link.kind : null, linked };
    }

    if (plan.kind === "convert-to-asset") {
      const doc = findInSet(set, plan.ref);
      if (!doc) return { ok: false, error: "The document no longer exists." };
      const values = (plan.values || []).slice();
      const created = await docs.addRecord(
        setId,
        {
          type: "flexibleAssets",
          name: doc.name + " (structured)",
          assetTypeId: CUSTOM_ASSET_TYPE_ID,
          assetFields: { summary: "Structured data extracted from “" + doc.name + "”.", details: values.join("\n"), source: doc.name },
          informationModel: "flexible-asset",
          provenance: "authored",
        },
        { updatedBy: actor },
      );
      const assetRef = refOf(created.record, "flexibleAssets");
      let linked = false;
      const link = pickLink(plan.ref, assetRef);
      if (link) {
        await docs.linkRecords(setId, { ...link, createdBy: actor });
        linked = true;
      }
      return { ok: true, action: "convert-to-asset", detail: "Created structured asset “" + created.record.name + "”.", created: assetRef, linked };
    }

    if (plan.kind === "convert-note-to-asset") {
      const doc = findInSet(set, plan.ref);
      if (!doc) return { ok: false, error: "The document no longer exists." };
      const pairs = noteFieldPairs(doc.body || "");
      const created = await docs.addRecord(
        setId,
        {
          type: "flexibleAssets",
          name: doc.name,
          assetTypeId: CUSTOM_ASSET_TYPE_ID,
          assetFields: {
            summary: pairs.labels.length ? pairs.labels.join(", ") : doc.name,
            details: String(doc.body || ""),
            source: doc.name + " (note converted)",
          },
          informationModel: "flexible-asset",
          provenance: "authored",
        },
        { updatedBy: actor },
      );
      const assetRef = refOf(created.record, "flexibleAssets");
      // Remember who the note was linked to, then remove it (which cascades its
      // links away) and re-point each survivable link at the new asset.
      const neighbours = (set.records.relationships || [])
        .filter((rel) => (rel.from && rel.from.type === plan.ref.type && rel.from.id === plan.ref.id) || (rel.to && rel.to.type === plan.ref.type && rel.to.id === plan.ref.id))
        .map((rel) => (rel.from.id === plan.ref.id ? rel.to : rel.from))
        .filter(Boolean);
      await docs.removeRecord(setId, plan.ref, { updatedBy: actor });
      let relinked = 0;
      for (const other of neighbours) {
        const link = pickLink(other, assetRef);
        if (!link) continue;
        try {
          await docs.linkRecords(setId, { ...link, createdBy: actor });
          relinked += 1;
        } catch {
          // A kind that no longer validates after the swap is simply skipped.
        }
      }
      return { ok: true, action: "convert-note-to-asset", detail: "Converted “" + doc.name + "” into a structured asset.", created: assetRef, removed: plan.ref, relinked };
    }

    return { ok: false, error: "This fix cannot be applied automatically." };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}
