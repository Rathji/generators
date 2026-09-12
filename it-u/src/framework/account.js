// src/framework/account.js — account button + login/register modal (Phase 9).
// The modal handles register / login / change-password / logout, shows the
// signed-in user + their highest role, and links admins to Users & roles.
// Everything degrades gracefully when the hub is unavailable (local mode).

import { h } from "./dom.js";
import { icons } from "./icons.js";
import { ROLE_LABELS as ITU_ROLE_LABELS, highestRole as highestITURole, scopeLabel as scopeLabelOf } from "./roles.js";

// The account modal speaks the IT-U role vocabulary (task 54): viewer /
// technician / administrator, scoped per client and per service.
const ROLE_LABELS = ITU_ROLE_LABELS;

function highestRole(hub) {
  if (!hub.user) return "viewer";
  if (hub.isAdmin) return "administrator";
  let best = "viewer";
  for (const r of hub.user.roles || []) best = highestITURole(best, r.role);
  return best;
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

// The "sign in with your directory" block. Hidden entirely when no identity
// provider is configured (or the hub is offline), so the plain username /
// password form remains the default experience.
function ssoBlock({ sso, toast, showSimulator, onSignedIn, onError }) {
  const wrap = h("div", { class: "kb-sso-block", hidden: true });
  if (!sso || !sso.available) return wrap;
  (async () => {
    let cfg;
    try {
      cfg = await sso.loadConfig(true);
    } catch {
      return;
    }
    const providers = (cfg.providers || []).filter((p) => p.kind !== "simulator");
    const sim = showSimulator === false ? null : cfg.simulator;
    if (!providers.length && !sim) return;

    const btns = h("div", { class: "kb-sso-buttons" });
    for (const p of providers) {
      const b = h("button", { class: "kb-btn kb-btn-ghost kb-sso-btn", type: "button" },
        h("span", { class: "kb-sso-btn-icon", html: icons.key }),
        h("span", { class: "kb-sso-btn-label" }, "Sign in with " + (p.name || p.id)),
      );
      b.addEventListener("click", async () => {
        b.disabled = true;
        try {
          await sso.begin(p.id);
        } catch (e) {
          onError(String((e && e.message) || e));
        } finally {
          b.disabled = false;
        }
      });
      btns.append(b);
    }

    if (sim) {
      const personas = sso.personas ? sso.personas() : [];
      const row = h("div", { class: "kb-sso-sim" });
      const sel = h("select", { class: "kb-input kb-input-sm", id: "ssoSimPersona" });
      for (const p of personas) sel.append(h("option", { value: p.id }, p.label));
      const simBtn = h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button", id: "ssoSimBtn" }, "Try the simulator");
      simBtn.addEventListener("click", async () => {
        simBtn.disabled = true;
        try {
          const res = await sso.simulate(sel.value);
          toast(`Signed in as ${res.username} (simulator, demo)`, "success", 5200);
          onSignedIn();
        } catch (e) {
          onError(String((e && e.message) || e));
        } finally {
          simBtn.disabled = false;
        }
      });
      row.append(sel, simBtn);
      btns.append(
        h("div", { class: "kb-sso-sim-wrap" },
          h("p", { class: "kb-acct-hint kb-sso-note" }, "Demo only — the simulator signs with a key that ships in public source and grants no roles by itself."),
          row,
        ),
      );
    }

    wrap.replaceChildren(
      h("div", { class: "kb-sso-divider" }, h("span", null, "or sign in with your directory")),
      btns,
    );
    wrap.hidden = false;
  })();
  return wrap;
}

export function openAccountModal({ hub, toast, router, sso, showSimulator }) {
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

    const rolesWrap = h("div", { class: "kb-acct-scopes" });
    const roles = u.roles || [];
    if (roles.length) {
      for (const r of roles) {
        rolesWrap.append(
          h("span", { class: "kb-scope-chip kb-scope-" + r.role },
            h("span", { class: "kb-scope-role" }, ROLE_LABELS[r.role] || r.role),
            h("span", { class: "kb-scope-where" }, scopeLabelOf(r.scope)),
          ),
        );
      }
    } else {
      rolesWrap.append(h("span", { class: "kb-muted" }, hub.isAdmin ? "Server administrator — full access everywhere." : "No roles assigned yet."));
    }

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
      hub.connected ? h("p", { class: "kb-acct-hint" }, `Connected to the shared hub · your role is ${ROLE_LABELS[role]} — enforced by the server at each client and service you are assigned.`) : h("p", { class: "kb-acct-hint" }, "Hub offline — acting in local mode."),
      rolesWrap,
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
    const block = hub.authenticated ? null : ssoBlock({ sso, toast, showSimulator, onSignedIn: () => renderAuthed(), onError: showErr });
    box.replaceChildren(
      ...[
        h("h3", { class: "kb-modal-title" }, "Account"),
        h("p", { class: "kb-acct-hint" }, "Sign in to collaborate: your role (viewer / technician / administrator, scoped per client and per service) is enforced by the server."),
        block,
        tabWrap,
        formWrap,
        err,
        actions,
      ].filter(Boolean),
    );
  };

  if (hub.authenticated) renderAuthed();
  else {
    renderAuth();
    if (sso && sso.onResult) {
      const off = sso.onResult((res) => {
        if (!overlay.isConnected) {
          off();
          return;
        }
        if (res && res.ok) {
          if (res.adjusted) toast(`Signed in as ${res.username} — “${res.naturalUsername}” is taken by a local account, so SSO keeps a separate account.`, "warning", 7000);
          renderAuthed();
        } else if (res && res.error) showErr(res.error);
      });
    }
  }

  overlay.append(box);
  document.body.append(overlay);
  const first = box.querySelector("input");
  if (first) setTimeout(() => first.focus(), 30);
  return overlay;
}
