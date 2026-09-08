// src/framework/account.js — account button + login/register modal (Phase 9).
// The modal handles register / login / change-password / logout, shows the
// signed-in user + their highest role, and links admins to Users & roles.
// Everything degrades gracefully when the hub is unavailable (local mode).

import { h } from "./dom.js";

const ROLE_LABELS = { viewer: "Viewer", editor: "Editor", reviewer: "Reviewer", admin: "Admin" };

function highestRole(hub) {
  if (!hub.user) return "viewer";
  if (hub.isAdmin) return "admin";
  const names = ["viewer", "editor", "reviewer", "admin"];
  let best = 0;
  for (const r of hub.user.roles || []) {
    const idx = names.indexOf(hub.roleFor(r.cat));
    if (idx > best) best = idx;
  }
  return names[best];
}

// Update the header account button label + title from hub state.
export function renderAccountButton(hub, btn) {
  if (!btn) return;
  if (hub.authenticated && hub.username) {
    btn.textContent = hub.username;
    const role = highestRole(hub);
    btn.title = `Signed in as ${hub.username} (${ROLE_LABELS[role]}) — account`;
    btn.classList.add("authed");
  } else {
    btn.textContent = "Sign in";
    btn.title = "Account / sign in";
    btn.classList.remove("authed");
  }
}

function field(label, placeholder, type = "text", opts = {}) {
  const wrap = h("label", { class: "kb-acct-field" });
  wrap.append(h("span", { class: "kb-acct-label" }, label), h("input", { class: "kb-input", type, placeholder, autocomplete: opts.autocomplete || "off", ...(opts.id ? { id: opts.id } : {}) }));
  return wrap;
}

export function openAccountModal({ hub, toast, router }) {
  const overlay = h("div", { class: "kb-modal-overlay" });
  const box = h("div", { class: "kb-modal kb-acct-modal", role: "dialog", "aria-modal": "true" });
  const err = h("p", { class: "kb-form-error", hidden: true });
  const showErr = (m) => {
    err.textContent = m;
    err.hidden = false;
  };

  const renderAuthed = () => {
    const u = hub.user || {};
    const role = highestRole(hub);
    const roleEl = h("span", { class: "kb-role-badge kb-role-" + role }, ROLE_LABELS[role]);
    const info = h("div", { class: "kb-acct-info" },
      h("span", { class: "kb-avatar" }, (u.username || "?").slice(0, 2).toUpperCase()),
      h("div", null, h("div", { class: "kb-acct-name" }, u.username), h("div", { class: "kb-acct-meta" }, "Role: ")),
    );
    info.querySelector(".kb-acct-meta").append(roleEl);

    const newPwd = field("New password", "8+ characters", "password");
    const changeBtn = h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button" }, "Change password");
    changeBtn.addEventListener("click", async () => {
      const p = newPwd.querySelector("input").value;
      if (p.length < 8) return showErr("Password must be at least 8 characters.");
      try {
        await hub.changePassword(p);
        toast("Password updated", "success");
        newPwd.querySelector("input").value = "";
      } catch (e) {
        showErr(String((e && e.message) || e));
      }
    });

    const actions = h("div", { class: "kb-modal-actions" });
    const close = h("button", { class: "kb-btn kb-btn-ghost", type: "button" }, "Close");
    close.addEventListener("click", () => overlay.remove());
    const signOut = h("button", { class: "kb-btn kb-btn-danger kb-btn-sm", type: "button" }, "Sign out");
    signOut.addEventListener("click", async () => {
      await hub.logout().catch(() => {});
      toast("Signed out", "success");
      overlay.remove();
    });
    actions.append(close, signOut);

    box.replaceChildren(
      h("h3", { class: "kb-modal-title" }, "Account"),
      info,
      hub.connected ? h("p", { class: "kb-acct-hint" }, `Connected to the shared hub · ${ROLE_LABELS[role]} in ${role === "viewer" ? "all categories (read-only)" : "your granted categories"}.`) : h("p", { class: "kb-acct-hint" }, "Hub offline — acting in local mode."),
      newPwd, changeBtn, err, actions,
    );
  };

  const renderAuth = () => {
    const tabWrap = h("div", { class: "kb-acct-tabs" });
    const mkTab = (label, active) => {
      const b = h("button", { class: "kb-tab" + (active ? " active" : ""), type: "button" }, label);
      return b;
    };
    let loginTab, regTab;
    const formWrap = h("div", { class: "kb-acct-form" });

    const renderLogin = () => {
      const uname = field("Username", "e.g. jordan");
      const pwd = field("Password", "••••••••", "password");
      const submit = h("button", { class: "kb-btn kb-btn-primary kb-btn-sm", type: "button" }, "Sign in");
      const busy = h("span", { class: "kb-acct-busy", hidden: true }, "Signing in…");
      submit.addEventListener("click", async () => {
        const u = uname.querySelector("input").value.trim();
        const p = pwd.querySelector("input").value;
        if (!u || !p) return showErr("Enter a username and password.");
        busy.hidden = false;
        try {
          await hub.login(u, p);
          toast("Signed in as " + u, "success");
          renderAuthed();
        } catch (e) {
          showErr(String((e && e.message) || e));
        } finally {
          busy.hidden = true;
        }
      });
      formWrap.replaceChildren(h("div", { class: "kb-acct-fields" }, uname, pwd), h("div", { class: "kb-acct-row" }, submit, busy));
    };
    const renderRegister = () => {
      const uname = field("Username", "e.g. jordan", "text", { id: "acctRegUser" });
      const pwd = field("Password", "8+ characters", "password", { id: "acctRegPass" });
      const confirm = field("Confirm password", "Repeat password", "password");
      const submit = h("button", { class: "kb-btn kb-btn-primary kb-btn-sm", type: "button" }, "Create account");
      const busy = h("span", { class: "kb-acct-busy", hidden: true }, "Creating…");
      submit.addEventListener("click", async () => {
        const u = uname.querySelector("input").value.trim();
        const p = pwd.querySelector("input").value;
        const c = confirm.querySelector("input").value;
        if (!u || !p) return showErr("Enter a username and password.");
        if (p !== c) return showErr("Passwords do not match.");
        busy.hidden = false;
        try {
          await hub.register(u, p);
          toast("Account created — signed in as " + u, "success");
          renderAuthed();
        } catch (e) {
          showErr(String((e && e.message) || e));
        } finally {
          busy.hidden = true;
        }
      });
      formWrap.replaceChildren(h("div", { class: "kb-acct-fields" }, uname, pwd, confirm), h("div", { class: "kb-acct-row" }, submit, busy));
    };

    loginTab = mkTab("Sign in", true);
    regTab = mkTab("Create account", false);
    loginTab.addEventListener("click", () => { loginTab.classList.add("active"); regTab.classList.remove("active"); renderLogin(); });
    regTab.addEventListener("click", () => { regTab.classList.add("active"); loginTab.classList.remove("active"); renderRegister(); });
    tabWrap.append(loginTab, regTab);
    renderLogin();

    const close = h("button", { class: "kb-btn kb-btn-ghost", type: "button" }, "Close");
    close.addEventListener("click", () => overlay.remove());
    const actions = h("div", { class: "kb-modal-actions" }, close);
    box.replaceChildren(
      h("h3", { class: "kb-modal-title" }, "Account"),
      h("p", { class: "kb-acct-hint" }, "Sign in to collaborate: your role (viewer / editor / reviewer / admin, scoped per category) is enforced by the server."),
      tabWrap, formWrap, err, actions,
    );
  };

  if (hub.authenticated) renderAuthed();
  else renderAuth();

  overlay.append(box);
  document.body.append(overlay);
  const first = box.querySelector("input");
  if (first) setTimeout(() => first.focus(), 30);
  return overlay;
}
