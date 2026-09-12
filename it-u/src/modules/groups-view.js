// src/modules/groups-view.js — the Groups & access working surface (roadmap
// Phase 4, task 20).
//
// The Settings station hosts this card. It renders the group library from the
// access service (./src/framework/access.js): the groups IT-U ships, the
// permissions each one holds, and the identities in it. The editor is the
// permission matrix — levels down the left, the actions grantable at each level
// across the top — plus name, description and membership.
//
// It also spells out the two rules the model enforces, because they are the
// ones that surprise people: an embedded credential is governed by the asset it
// belongs to (it has no grant of its own), and the owner of a single-user
// repository always holds every permission.

import { h } from "../framework/dom.js";
import { icons } from "../framework/icons.js";
import { openModal, confirmDialog } from "./shared.js";

const whoami = (ctx) => (ctx.hub && ctx.hub.username) || "owner";

function cardHead(icon, title, badge) {
  return h(
    "div",
    { class: "kb-section-head" },
    h("span", { class: "kb-section-icon", html: icon }),
    h("h2", { class: "kb-section-name" }, title),
    badge ? h("span", { class: "kb-count-pill" }, badge) : null,
  );
}

export function renderGroupsCard(ctx, { groups = [], accessMeta = null } = {}, reload) {
  const list = h("div", { class: "kb-group-list" });
  if (!groups.length) {
    list.append(h("p", { class: "kb-muted" }, "No groups yet. Create one to grant a set of permissions to a team or an identity."));
  } else {
    for (const g of groups) list.append(groupRow(ctx, g, reload));
  }

  const actions = h(
    "div",
    { class: "kb-actions-row" },
    h("button", { class: "kb-btn kb-btn-primary", type: "button", id: "kbNewGroupBtn", onClick: () => openGroupEditor(ctx, { reload }) }, "New group"),
  );

  return h(
    "section",
    { class: "kb-card kb-settings-card", dataset: { card: "access" } },
    cardHead(icons.shield, "Groups & access", accessMeta ? String(accessMeta.count) : String(groups.length)),
    h(
      "p",
      { class: "kb-muted" },
      "A group grants a set of permissions; identities are put into groups. Permissions apply at five levels — organization, asset, document, general password and administrative — and an embedded credential is governed by the asset it belongs to rather than by a grant of its own. A single-user repository is owned by you and is never restricted.",
    ),
    list,
    actions,
  );
}

function groupRow(ctx, group, reload) {
  const perms = group.permissions || [];
  const members = group.members || [];
  return h(
    "div",
    { class: "kb-group-item" + (group.builtin ? " kb-group-item--builtin" : ""), dataset: { id: group.id } },
    h("span", { class: "kb-group-icon", html: icons.shield }),
    h(
      "div",
      { class: "kb-group-main" },
      h(
        "div",
        { class: "kb-group-name-row" },
        h("span", { class: "kb-group-name" }, group.name),
        group.builtin ? h("span", { class: "kb-badge kb-badge-builtin" }, "Shipped") : null,
      ),
      group.description ? h("span", { class: "kb-group-desc" }, group.description) : null,
      h("span", { class: "kb-group-meta" }, perms.length + " permission" + (perms.length === 1 ? "" : "s") + (members.length ? " · " + members.length + " member" + (members.length === 1 ? "" : "s") : " · no members")),
      members.length ? h("span", { class: "kb-group-members" }, members.join(", ")) : null,
    ),
    h(
      "div",
      { class: "kb-group-actions" },
      h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button", onClick: () => openGroupEditor(ctx, { group, reload }) }, "Edit"),
      h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button", onClick: () => cloneGroup(ctx, group, reload) }, "Clone"),
      group.builtin
        ? h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button", onClick: () => resetGroup(ctx, group, reload) }, "Reset")
        : h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm kb-btn-danger-text", type: "button", onClick: () => deleteGroup(ctx, group, reload) }, "Delete"),
    ),
  );
}

async function cloneGroup(ctx, group, reload) {
  try {
    const res = await ctx.access.clone(group.id, { createdBy: whoami(ctx) });
    ctx.toast("Cloned to “" + res.group.name + "”", "success");
    reload();
  } catch (e) {
    ctx.toast(String((e && e.message) || e), "error", 5200);
  }
}

async function resetGroup(ctx, group, reload) {
  const ok = await confirmDialog({
    title: "Reset “" + group.name + "”?",
    message: "This restores the shipped permissions for this group. Your membership list is kept.",
    confirmLabel: "Reset",
  });
  if (!ok) return;
  try {
    await ctx.access.reset(group.id, { updatedBy: whoami(ctx) });
    ctx.toast("“" + group.name + "” reset to its defaults", "success");
    reload();
  } catch (e) {
    ctx.toast(String((e && e.message) || e), "error", 5200);
  }
}

async function deleteGroup(ctx, group, reload) {
  const ok = await confirmDialog({
    title: "Delete “" + group.name + "”?",
    message: "Members lose the permissions this group granted. Records and credentials are not affected.",
    confirmLabel: "Delete",
    danger: true,
  });
  if (!ok) return;
  try {
    await ctx.access.remove(group.id, { updatedBy: whoami(ctx) });
    ctx.toast("Deleted “" + group.name + "”", "success");
    reload();
  } catch (e) {
    ctx.toast(String((e && e.message) || e), "error", 5200);
  }
}

export function openGroupEditor(ctx, { group = null, reload } = {}) {
  const { ACCESS_LEVELS, ACCESS_ACTIONS, ACCESS_MATRIX } = ctx.access;
  const actionLabel = (id) => (ACCESS_ACTIONS.find((a) => a.id === id) || {}).label || id;
  const actionDesc = (id) => (ACCESS_ACTIONS.find((a) => a.id === id) || {}).description || "";
  const selected = new Set(group && Array.isArray(group.permissions) ? group.permissions : []);

  const nameInput = h("input", { class: "kb-input", type: "text", placeholder: "e.g. Field technicians — North" });
  nameInput.value = group ? group.name : "";
  const descInput = h("textarea", { class: "kb-input", rows: 2, placeholder: "What this group is for" });
  descInput.value = group ? group.description || "" : "";
  const membersInput = h("textarea", { class: "kb-input", rows: 2, placeholder: "One identity per line, or comma-separated" });
  membersInput.value = group && group.members ? group.members.join("\n") : "";

  const checkboxes = [];
  const matrix = h("div", { class: "kb-permmatrix" });
  for (const level of ACCESS_LEVELS) {
    const actions = ACCESS_MATRIX[level.id] || [];
    const opts = actions.map((a) => {
      const token = level.id + "." + a;
      const cb = h("input", { type: "checkbox", class: "kb-check", dataset: { token } });
      cb.checked = selected.has(token);
      checkboxes.push(cb);
      return h("label", { class: "kb-perm-opt", title: actionDesc(a) }, cb, h("span", null, actionLabel(a)));
    });
    matrix.append(
      h(
        "div",
        { class: "kb-permmatrix-row" },
        h("div", { class: "kb-permmatrix-level" }, h("span", { class: "kb-permmatrix-level-name" }, level.label), h("span", { class: "kb-permmatrix-level-desc" }, level.description)),
        h("div", { class: "kb-permmatrix-actions" }, ...opts),
      ),
    );
  }
  const readPermissions = () => checkboxes.filter((c) => c.checked).map((c) => c.dataset.token);

  const m = openModal({
    title: group ? "Edit “" + group.name + "”" : "New group",
    description: "A group grants a set of permissions. Put identities into it, and every change they make in this repository is checked against them.",
    wide: true,
    children: [
      h("div", { class: "kb-field-row" }, field("Name *", nameInput), field("Members", membersInput)),
      field("Description", descInput),
      h("div", { class: "kb-subhead" }, "Permissions"),
      h("p", { class: "kb-muted kb-perm-note" }, "Permissions apply at five levels. An embedded credential has no grant of its own — it is governed by the asset it belongs to, so editing that asset also governs its credential."),
      matrix,
    ],
  });

  m.actions.append(
    h("button", { class: "kb-btn kb-btn-ghost", type: "button", onClick: m.close }, "Cancel"),
    h("button", { class: "kb-btn kb-btn-primary", type: "button", id: "kbGroupSave" }, group ? "Save group" : "Create group"),
  );
  m.actions.querySelector("#kbGroupSave").addEventListener("click", async (ev) => {
    m.clearError();
    const name = nameInput.value.trim();
    if (!name) {
      m.showError("Give the group a name.");
      return;
    }
    const members = membersInput.value
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const input = { name, description: descInput.value.trim(), permissions: readPermissions(), members };
    const btn = ev.currentTarget;
    btn.disabled = true;
    try {
      if (group) {
        await ctx.access.update(group.id, input, { updatedBy: whoami(ctx) });
        ctx.toast("Saved “" + name + "”", "success");
      } else {
        await ctx.access.create({ ...input, createdBy: whoami(ctx) });
        ctx.toast("Created “" + name + "”", "success");
      }
      m.close();
      reload && reload();
    } catch (e) {
      m.showError(String((e && e.message) || e));
    } finally {
      btn.disabled = false;
    }
  });
  return m;
}

function field(label, control) {
  return h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, label), control);
}
