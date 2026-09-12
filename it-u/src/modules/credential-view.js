// src/modules/credential-view.js — the credential profile & editor (roadmap
// Phase 4, tasks 17–19).
//
// One modal owns the whole credential story:
//
//   • TASK 17 — the general/embedded distinction. A general credential carries
//     its own permission set; an embedded credential is created in an owner's
//     context and shows the permissions it INHERITS from that owner.
//   • TASK 18 — the OTP secret is validated on entry and, when it is usable,
//     the live six-digit one-time code is generated and counts down.
//   • TASK 19 — the password can be generated here, its strength is shown, and
//     the rotation path (manual, or a named connected product) is recorded with
//     the honest disclaimer that rotation itself depends on that product.
//
// It is opened from a password record row in the Organizations station and from
// an asset's "Credentials" group, where `embeddedIn` pre-fills the owner.

import { h, clear } from "../framework/dom.js";
import { icons } from "../framework/icons.js";
import { openModal } from "./shared.js";
import {
  PASSWORD_SCOPES,
  PASSWORD_CATEGORIES,
  PASSWORD_PERMISSIONS,
  DEFAULT_PASSWORD_PERMISSIONS,
  DEFAULT_INHERITED_PERMISSIONS,
  effectivePermissions,
  isEmbedded,
  ownerRef,
} from "../framework/password.js";
import {
  generatePassword,
  passwordStrength,
  ROTATION_METHODS,
  ROTATION_PRODUCTS,
  ROTATION_DISCLAIMER,
  DEFAULT_ROTATION_DAYS,
} from "../framework/credentialTools.js";
import { generateOtp, validateOtpSecret, randomOtpSecret } from "../framework/otp.js";
import { RECORD_TYPE_META } from "../framework/docsets.js";

const whoami = (ctx) => (ctx.hub && ctx.hub.username) || "owner";
const collectionLabel = (c) => (RECORD_TYPE_META[c] ? RECORD_TYPE_META[c].singular : c);

export async function openCredentialDialog(ctx, { setId, record = null, reload, embeddedIn = null } = {}) {
  const set = await ctx.docs.get(setId, { force: true }).catch(() => null);
  if (!set) {
    ctx.toast("That documentation set could not be loaded.", "error");
    return;
  }
  const live = record ? (set.records.passwords || []).find((r) => r.id === record.id) || record : null;
  const initial = live || {
    scope: embeddedIn ? "embedded" : "general",
    category: "user-account",
    rotationMethod: "manual",
    permissions: DEFAULT_PASSWORD_PERMISSIONS.slice(),
    embeddedIn: embeddedIn || null,
  };

  // Access (task 20): a viewer may see that a credential exists but must not be
  // able to reveal it. The descriptor is per credential action, resolved
  // through the owning asset for an embedded credential.
  const actor = whoami(ctx);
  const accessInfo = ctx.access ? ctx.access.describe(actor, { record: live || null, set }) : null;
  const effAccess = accessInfo && accessInfo.access ? accessInfo.access : null;
  const canView = !accessInfo || accessInfo.view !== false;
  const canEdit = !accessInfo || !live || accessInfo.edit !== false;
  const accessBanner = h("div", { class: "kb-access-note", hidden: !accessInfo || (effAccess && effAccess.owner) });
  if (accessInfo && !(effAccess && effAccess.owner)) {
    const lines = [];
    if (!canView) lines.push("You may see that this credential exists, but not reveal its secret.");
    if (!canEdit) lines.push("Editing and rotation are restricted.");
    if (!lines.length) lines.push("You may reveal and use this credential.");
    accessBanner.append(
      h("span", { class: "kb-access-note-icon", html: icons.shield }),
      h(
        "div",
        { class: "kb-access-note-text" },
        h("strong", null, "Access: " + (effAccess ? effAccess.roleLabel : "your role") + ". "),
        lines.join(" ") + (effAccess && effAccess.groups.length ? " Groups: " + effAccess.groups.map((g) => g.name).join(", ") + "." : ""),
      ),
    );
  }

  const m = openModal({
    title: live ? live.name : "New credential",
    description: live ? "Credential record" : "A password, token or service-account record for this client.",
    wide: true,
    children: [],
  });
  const box = m.overlay.querySelector(".kb-modal");
  if (box) box.classList.add("kb-modal-credential");

  const state = { scope: initial.scope || "general" };

  // ---- credential identity -------------------------------------------------
  const nameInput = text(initial.name || "", "e.g. Domain admin, M365 global admin");
  const scopeSel = selectFrom(PASSWORD_SCOPES, initial.scope || "general");
  const catSel = selectFrom(PASSWORD_CATEGORIES, initial.category || "user-account");

  // ---- login ---------------------------------------------------------------
  const userInput = text(initial.username || "", "name@example.com or DOMAIN\\user");
  const secretInput = h("input", { class: "kb-input kb-secret-input", type: "password", placeholder: "Stored in the documentation set" });
  if (live && !canView) {
    secretInput.value = "";
    secretInput.disabled = true;
    secretInput.placeholder = "You don’t have permission to view this secret";
  } else {
    secretInput.value = initial.secret || "";
  }
  const revealBtn = h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button", title: "Show / hide" }, "Reveal");
  if (live && !canView) {
    revealBtn.disabled = true;
    revealBtn.title = "Your role does not allow viewing this secret";
  }
  revealBtn.addEventListener("click", () => {
    const shown = secretInput.type === "text";
    secretInput.type = shown ? "password" : "text";
    revealBtn.textContent = shown ? "Reveal" : "Hide";
  });
  const genBtn = h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button" }, "Generate");
  if (live && !canEdit) genBtn.disabled = true;
  const strength = h("div", { class: "kb-strength" });
  const renderStrength = () => {
    const s = passwordStrength(secretInput.value);
    clear(strength);
    if (!secretInput.value) return;
    strength.append(
      h("div", { class: "kb-strength-bar" }, h("div", { class: "kb-strength-fill kb-strength-fill--" + s.score, style: "width:" + (s.score / 4) * 100 + "%" })),
      h("span", { class: "kb-strength-label" }, s.label + " · ~" + s.entropyBits + " bits"),
    );
  };
  secretInput.addEventListener("input", renderStrength);
  genBtn.addEventListener("click", () => {
    secretInput.value = generatePassword({ length: 20 });
    secretInput.type = "text";
    revealBtn.textContent = "Hide";
    renderStrength();
  });
  renderStrength();
  const urlInput = text(initial.url || "", "https://…");

  // ---- second factor (task 18) --------------------------------------------
  const otpInput = text(initial.otpSecret || "", "Base32 secret (A–Z, 2–7)");
  const otpBox = h("div", { class: "kb-otp-box" });
  const newOtpBtn = h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button" }, "New secret");
  if (live && !canEdit) newOtpBtn.disabled = true;
  newOtpBtn.addEventListener("click", () => {
    otpInput.value = randomOtpSecret(20);
    tickOtp();
  });
  function tickOtp() {
    clear(otpBox);
    if (live && !canView) {
      otpBox.append(h("p", { class: "kb-muted" }, "You don’t have permission to view this credential’s second factor."));
      return;
    }
    const s = otpInput.value.trim();
    if (!s) {
      otpBox.append(h("p", { class: "kb-muted" }, "No one-time-password secret stored for this credential."));
      return;
    }
    const v = validateOtpSecret(s);
    if (!v.ok) {
      otpBox.append(h("div", { class: "kb-otp-error" }, v.errors.join(" ")));
      return;
    }
    try {
      const t = generateOtp(s);
      otpBox.append(
        h("div", { class: "kb-otp-code" }, ...t.code.split("").map((c) => h("span", { class: "kb-otp-digit" }, c))),
        h("div", { class: "kb-otp-meta" }, h("span", { class: "kb-otp-countdown" }, "valid for " + t.secondsRemaining + "s"), h("span", { class: "kb-muted" }, "six-digit code, " + t.period + "s period")),
      );
    } catch (e) {
      otpBox.append(h("div", { class: "kb-otp-error" }, String((e && e.message) || e)));
    }
  }
  otpInput.addEventListener("input", tickOtp);
  const otpTimer = setInterval(() => {
    if (!document.body.contains(otpBox)) {
      clearInterval(otpTimer);
      return;
    }
    tickOtp();
  }, 1000);
  tickOtp();

  // ---- permissions (task 17) ----------------------------------------------
  const permBox = h("div", { class: "kb-perm-box" });
  let permChecks = [];
  function renderPermissions() {
    clear(permBox);
    permChecks = [];
    if (state.scope === "embedded") {
      const owner = ownerSel && ownerSel.value ? refFrom(ownerSel.value) : ownerRef(initial);
      const eff = effectivePermissions({ ...initial, scope: "embedded", embeddedIn: owner }, set);
      const inherited = eff.source === "owner";
      permBox.append(
        h("p", { class: "kb-muted kb-perm-note" }, inherited ? "Inherited from the owning record." : "This credential inherits its owner's permissions. Until the owner declares a credential permission set, the safe minimum applies."),
        h("div", { class: "kb-perm-chips" }, ...(eff.permissions.length ? eff.permissions : DEFAULT_INHERITED_PERMISSIONS).map((p) => h("span", { class: "kb-badge kb-badge-perm" }, permLabel(p)))),
      );
      return;
    }
    const chosen = new Set(Array.isArray(initial.permissions) ? initial.permissions : DEFAULT_PASSWORD_PERMISSIONS);
    for (const p of PASSWORD_PERMISSIONS) {
      const cb = h("input", { type: "checkbox", class: "kb-check", dataset: { perm: p.id } });
      cb.checked = chosen.has(p.id);
      permChecks.push({ id: p.id, cb });
      permBox.append(h("label", { class: "kb-perm-opt", title: p.description || "" }, cb, h("span", null, p.label)));
    }
  }

  // ---- owner (embedded) ----------------------------------------------------
  const ownerRow = h("div", { class: "kb-field", hidden: state.scope !== "embedded" });
  const ownerSel = h("select", { class: "kb-input" });
  ownerSel.append(h("option", { value: "" }, "— select the owning asset —"));
  for (const coll of ["configurations", "flexibleAssets", "organizations", "locations", "documents", "checklists", "trackers", "runbooks"]) {
    for (const r of set.records[coll] || []) ownerSel.append(h("option", { value: coll + ":" + r.id }, collectionLabel(coll) + " — " + r.name));
  }
  const curOwner = ownerRef(initial);
  ownerSel.value = curOwner ? curOwner.type + ":" + curOwner.id : embeddedIn ? embeddedIn.type + ":" + embeddedIn.id : "";
  ownerRow.append(h("span", { class: "kb-field-label" }, "Embedded in"), ownerSel, h("span", { class: "kb-field-help" }, "The asset this credential belongs to — it inherits that record's permissions."));
  ownerSel.addEventListener("change", renderPermissions);

  scopeSel.addEventListener("change", () => {
    state.scope = scopeSel.value;
    ownerRow.hidden = state.scope !== "embedded";
    renderPermissions();
  });

  // ---- rotation (task 19) --------------------------------------------------
  const methodSel = selectFrom(ROTATION_METHODS, initial.rotationMethod || "manual");
  const productSel = selectFrom(ROTATION_PRODUCTS, initial.rotationProduct || "", { none: "— select a product —" });
  const productRow = h("div", { class: "kb-field", hidden: methodSel.value !== "connected-product" });
  productRow.append(h("span", { class: "kb-field-label" }, "Connected product"), productSel);
  methodSel.addEventListener("change", () => {
    productRow.hidden = methodSel.value !== "connected-product";
  });
  const daysInput = h("input", { class: "kb-input", type: "number", min: "1", placeholder: String(DEFAULT_ROTATION_DAYS) });
  daysInput.value = initial.rotateEveryDays != null && initial.rotateEveryDays !== "" ? String(initial.rotateEveryDays) : "";
  const rotatedInput = h("input", { class: "kb-input", type: "date" });
  rotatedInput.value = initial.rotatedAt || "";
  const notesEl = textarea(initial.notes || "");
  const rotationHelp = h("p", { class: "kb-rotation-note" }, ROTATION_DISCLAIMER);

  // ---- assemble ------------------------------------------------------------
  const body = h(
    "div",
    { class: "kb-credential-body" },
    accessBanner,
    section("Credential", icons.shield, [
      fieldRow(field("Name *", nameInput), field("Scope", scopeSel)),
      ownerRow,
      fieldRow(field("Category *", catSel)),
    ]),
    section("Login", icons.eye, [
      fieldRow(field("Username / email", userInput)),
      field("Password", h("div", { class: "kb-secret-row" }, secretInput, revealBtn, genBtn), "Generated passwords use mixed case, digits and symbols; avoid ambiguous characters."),
      strength,
      fieldRow(field("URL", urlInput)),
    ]),
    section("Second factor", icons.hash, [field("One-time-password secret", h("div", { class: "kb-secret-row" }, otpInput, newOtpBtn)), otpBox]),
    section("Permissions", icons.shield, [permBox]),
    section("Rotation", icons.history, [
      fieldRow(field("Rotation path", methodSel), productRow),
      fieldRow(field("Rotate every (days)", daysInput), field("Last rotated", rotatedInput)),
      rotationHelp,
    ]),
    section("Notes", icons.article, [field("Notes", notesEl)]),
  );
  box.insertBefore(body, box.querySelector(".kb-form-error"));

  renderPermissions();

  const saveBtn = h("button", { class: "kb-btn kb-btn-primary", type: "button", id: "kbCredSave" }, live ? "Save credential" : "Create credential");
  if (live && !canEdit) {
    saveBtn.disabled = true;
    saveBtn.title = "Your role does not allow editing this credential";
  }
  m.actions.append(
    h("button", { class: "kb-btn kb-btn-ghost", type: "button", onClick: m.close }, "Cancel"),
    saveBtn,
  );
  saveBtn.addEventListener("click", async (ev) => {
    m.clearError();
    const btn = ev.currentTarget;
    const input = collect();
    if (!input.name) {
      m.showError("Give the credential a name.");
      return;
    }
    btn.disabled = true;
    try {
      if (live) {
        await ctx.docs.updateRecord(setId, { type: "passwords", id: live.id }, input, { updatedBy: whoami(ctx), actor });
        ctx.toast("Saved “" + input.name + "”", "success");
      } else {
        if (input.scope === "embedded" && input.embeddedIn) {
          await ctx.docs.addEmbeddedCredential(setId, input.embeddedIn, input, { updatedBy: whoami(ctx), actor });
        } else {
          await ctx.docs.addRecord(setId, { type: "passwords", ...input }, { updatedBy: whoami(ctx), actor });
        }
        ctx.toast("Created “" + input.name + "”", "success");
      }
      m.close();
      reload && reload();
    } catch (e) {
      m.showError(String((e && e.message) || e));
    } finally {
      btn.disabled = false;
    }
  });

  function collect() {
    const scope = scopeSel.value;
    const embedded = scope === "embedded";
    const out = {
      name: nameInput.value.trim(),
      scope,
      category: catSel.value,
      username: userInput.value.trim(),
      secret: secretInput.value,
      otpSecret: otpInput.value.trim().toUpperCase(),
      url: urlInput.value.trim(),
      rotationMethod: methodSel.value,
      rotationProduct: methodSel.value === "connected-product" ? productSel.value : "",
      rotateEveryDays: daysInput.value.trim(),
      rotatedAt: rotatedInput.value,
      notes: notesEl.value.trim(),
      allowExport: false,
      embeddedIn: embedded ? refFrom(ownerSel.value) : null,
      permissions: embedded ? [] : permChecks.filter((p) => p.cb.checked).map((p) => p.id),
    };
    if (live) {
      out.informationModel = live.informationModel;
      out.provenance = live.provenance;
      out.origin = live.origin || {};
    } else {
      out.informationModel = "core-asset";
      out.provenance = "authored";
      out.origin = {};
    }
    return out;
  }
}

// ---- small builders --------------------------------------------------------

const permLabel = (id) => (PASSWORD_PERMISSIONS.find((p) => p.id === id) || {}).label || id;

function text(value, placeholder) {
  const el = h("input", { class: "kb-input", type: "text", placeholder: placeholder || "" });
  el.value = value == null ? "" : String(value);
  return el;
}

function textarea(value) {
  const el = h("textarea", { class: "kb-input", rows: 3 });
  el.value = value == null ? "" : String(value);
  return el;
}

function selectFrom(options, value, { none = null } = {}) {
  const sel = h("select", { class: "kb-input" });
  if (none) sel.append(h("option", { value: "" }, none));
  for (const o of options || []) sel.append(h("option", { value: o.id }, o.label || o.id));
  sel.value = value == null ? "" : value;
  return sel;
}

function field(label, control, help) {
  return h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, label), control, help ? h("span", { class: "kb-field-help" }, help) : null);
}

function fieldRow(...fields) {
  return h("div", { class: "kb-field-row" }, ...fields);
}

function section(title, icon, children) {
  return h(
    "section",
    { class: "kb-cred-section" },
    h("div", { class: "kb-cred-section-head" }, h("span", { class: "kb-section-icon", html: icon }), h("h3", { class: "kb-cred-section-name" }, title)),
    h("div", { class: "kb-cred-section-body" }, ...children),
  );
}

function refFrom(value) {
  const s = String(value || "");
  const i = s.indexOf(":");
  if (i <= 0) return null;
  return { type: s.slice(0, i), id: s.slice(i + 1) };
}
