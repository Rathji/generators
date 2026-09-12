import { el, mount } from "../framework/dom.js";
import { pageHead } from "../framework/shell.js";
import { toast } from "../framework/toast.js";
import { OPENRPA_CAPABILITIES, OPENRPA_CONNECTION_FIELDS, OPENRPA_MODES, OPENRPA_SCHEMES } from "../core/openrpa/constants.js";

const STATE_TONE = { connected: "ok", connecting: "warn", reconnecting: "warn", error: "fail", disconnected: "" };

function statCard(label, value, hint) {
  const card = el("article.pu-card.pu-stat");
  card.appendChild(el("span.pu-stat-label", { text: label }));
  card.appendChild(el("span.pu-stat-value", { text: String(value) }));
  if (hint) card.appendChild(el("span.pu-small.pu-muted", { text: hint }));
  return card;
}

function field(label, control, hint) {
  const wrap = el("label.pu-field");
  wrap.appendChild(el("span.pu-small.pu-muted", { text: label }));
  wrap.appendChild(control);
  if (hint) wrap.appendChild(el("span.pu-small.pu-muted", { text: hint }));
  return wrap;
}

function chip(text, tone) {
  return el("span.pu-chip", { class: tone || "", text });
}

function listItem(label, value) {
  const li = el("li");
  li.appendChild(el("span.pu-small.pu-muted", { text: label }));
  li.appendChild(el("span.pu-small", { text: value }));
  return li;
}

async function withBusy(button, busyLabel, task) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = busyLabel;
  try {
    return await task();
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

export const openrpaView = {
  id: "openrpa",
  title: "OpenRPA",
  group: "OpenRPA",
  icon: "rpa",
  nav: true,
  render({ hub, onDestroy }) {
    const or = hub.openrpa;
    const root = el("div");
    const statsCtn = el("div.pu-grid.cols-4", { style: { "margin-bottom": "1rem" } });
    const profilesCtn = el("div");
    const connectionCtn = el("div");
    const authCtn = el("div");
    const emulatorCtn = el("div");
    const state = { editingId: null };

    function rerender() {
      renderStats();
      mount(profilesCtn, buildProfiles());
      mount(connectionCtn, buildConnection());
      mount(authCtn, buildAuth());
      mount(emulatorCtn, buildEmulator());
    }

    function renderStats() {
      const s = or.stats();
      const st = or.status();
      mount(
        statsCtn,
        statCard("Connection", st.connected ? "connected" : st.state, st.endpoint),
        statCard("Mode", st.mode, st.mode === "emulator" ? "offline fixtures" : st.profile ? st.profile.name : "no profile selected"),
        statCard("Profiles", st.profiles.total, st.profiles.activeName ? `active: ${st.profiles.activeName}` : "none active"),
        statCard("Session", st.session.signedIn ? st.session.user.name : "signed out", st.session.signedIn ? `${st.session.roles.length} OpenFlow role(s)` : "no token user"),
        statCard("Collections", s.collections, `${s.documents} documents · ${s.commands} commands`)
      );
    }

    function readForm() {
      return {
        name: form.name.value,
        url: form.url.value,
        scheme: form.scheme.value,
        host: form.host.value,
        port: form.port.value,
        path: form.path.value,
        organization: form.organization.value,
        insecure: form.insecure.checked,
        restBase: form.restBase.value,
      };
    }

    function fillForm(profile) {
      form.name.value = profile ? profile.name : "";
      form.url.value = profile ? profile.url : "";
      form.scheme.value = profile ? profile.scheme : "wss";
      form.host.value = profile ? profile.host : "";
      form.port.value = profile ? String(profile.port) : "";
      form.path.value = profile ? profile.path : "/";
      form.organization.value = profile ? profile.organization : "";
      form.insecure.checked = profile ? !!profile.insecure : false;
      form.restBase.value = profile ? profile.restBase : "";
      state.editingId = profile ? profile.id : null;
      if (currentSaveBtn) currentSaveBtn.textContent = profile ? "Save changes" : "Add profile";
      if (form.name.focus) form.name.focus();
    }

    const form = {
      name: el("input.pu-input", { type: "text", placeholder: "Head office OpenFlow", "aria-label": "Profile name" }),
      url: el("input.pu-input", { type: "text", placeholder: "wss://openflow.example.com:443", "aria-label": "WebSocket URL" }),
      scheme: el("select.pu-select", { "aria-label": "Scheme" }, ...OPENRPA_SCHEMES.map((scheme) => el("option", { value: scheme, text: scheme }))),
      host: el("input.pu-input", { type: "text", placeholder: "openflow.example.com", "aria-label": "Host" }),
      port: el("input.pu-input", { type: "number", min: "1", max: "65535", placeholder: "443", "aria-label": "Port" }),
      path: el("input.pu-input", { type: "text", placeholder: "/", "aria-label": "Path" }),
      organization: el("input.pu-input", { type: "text", placeholder: "Northwind (optional)", "aria-label": "Organization" }),
      insecure: el("input", { type: "checkbox", "aria-label": "Allow insecure TLS" }),
      restBase: el("input.pu-input", { type: "text", placeholder: "https://openflow.example.com (optional)", "aria-label": "REST base URL" }),
    };
    const validationCtn = el("div", { style: { "margin-top": "0.75rem" } });
    const saveBtn = el("button.pu-btn", { type: "button", text: "Add profile", "data-permission": "openrpa.manage", "data-mutating": "" });
    saveBtn.addEventListener("click", () => saveProfile());

    async function saveProfile() {
      const input = readForm();
      await withBusy(saveBtn, "Saving…", async () => {
        const result = state.editingId ? await or.profiles.update(state.editingId, input) : await or.profiles.create(input);
        if (!result.ok) {
          showValidation(state.editingId ? "The profile could not be updated:" : "The profile could not be added:", result);
          toast("Profile not saved", { tone: "error" });
          return;
        }
        showValidation(`Saved “${result.profile.name}”.`, { ok: true, errors: [] });
        fillForm(null);
        toast(`Profile “${result.profile.name}” saved`, { tone: "success" });
        rerender();
      });
    }

    function showValidation(title, report) {
      mount(validationCtn);
      if (!report || !report.errors || !report.errors.length) {
        validationCtn.appendChild(el("div.pu-alert.ok", { text: title }));
        return;
      }
      const alert = el("div.pu-alert.fail");
      alert.appendChild(el("div", { text: title }));
      const ul = el("ul.pu-list", { style: { "margin-top": "0.35rem" } });
      for (const error of report.errors) ul.appendChild(el("li", {}, el("span.pu-chip.fail", { text: error.field }), el("span.pu-small", { text: error.message })));
      alert.appendChild(ul);
      validationCtn.appendChild(alert);
    }

    function buildProfiles() {
      const card = el("section.pu-card");
      card.appendChild(el("h2", { text: "Connection profiles" }));
      card.appendChild(
        el("p.pu-small", {
          text: "Describe one or more OpenFlow endpoints. A profile keeps the WebSocket URL, scheme, host, port, path, tenant and TLS choice together; secrets are never stored here — you sign in separately. Give a full ws:// or wss:// URL, or a scheme plus host.",
        })
      );

      const grid = el("div.pu-form-grid", { style: { "margin-top": "0.75rem" } });
      const row1 = el("div.pu-form-row");
      row1.appendChild(field("Profile name", form.name));
      row1.appendChild(field("WebSocket URL (optional)", form.url));
      const row2 = el("div.pu-form-row");
      row2.appendChild(field("Scheme", form.scheme));
      row2.appendChild(field("Host", form.host));
      row2.appendChild(field("Port", form.port));
      row2.appendChild(field("Path", form.path));
      const row3 = el("div.pu-form-row");
      row3.appendChild(field("Organization / tenant", form.organization));
      row3.appendChild(field("REST base URL (optional)", form.restBase));
      const insecureWrap = el("label.pu-field");
      insecureWrap.appendChild(el("span.pu-small.pu-muted", { text: "Allow insecure TLS" }));
      insecureWrap.appendChild(form.insecure);
      row3.appendChild(insecureWrap);
      grid.appendChild(row1);
      grid.appendChild(row2);
      grid.appendChild(row3);

      const validateBtn = el("button.pu-btn.secondary", { type: "button", text: "Validate" });
      validateBtn.addEventListener("click", () => {
        const report = or.validateProfile(readForm());
        showValidation(report.ok ? "The profile is valid." : "The profile has problems:", report);
      });
      const clearBtn = el("button.pu-btn.secondary", { type: "button", text: "Clear" });
      clearBtn.addEventListener("click", () => {
        fillForm(null);
        mount(validationCtn);
      });
      grid.appendChild(el("div.pu-toolbar", { style: { "margin-top": "0.5rem" } }, saveBtn, validateBtn, clearBtn));
      card.appendChild(grid);
      card.appendChild(validationCtn);

      const profiles = or.profiles.list();
      if (!profiles.length) {
        card.appendChild(el("div.pu-empty", { style: { "margin-top": "1rem" }, text: "No profiles yet. Add one above to describe an OpenFlow endpoint." }));
        return card;
      }

      const wrap = el("div.pu-table-scroll", { style: { "margin-top": "1rem" } });
      const table = el("table.pu-table");
      const headRow = el("tr");
      for (const label of ["Name", "Endpoint", "Tenant", "TLS", "State", "Actions"]) headRow.appendChild(el("th", { text: label }));
      const thead = el("thead");
      thead.appendChild(headRow);
      table.appendChild(thead);
      const tbody = el("tbody");
      const st = or.status();
      for (const profile of profiles) {
        const isActive = st.profile && st.profile.id === profile.id;
        const tr = el("tr");
        tr.appendChild(el("td", {}, el("div.pu-entity-name", { text: profile.name }), isActive ? chip("active", "ok") : null));
        tr.appendChild(el("td", {}, el("span.pu-ref", { text: or.endpointOf(profile) })));
        tr.appendChild(el("td", { text: profile.organization || "—" }));
        tr.appendChild(el("td", {}, chip(profile.scheme, ""), profile.insecure ? chip("insecure", "fail") : null));
        tr.appendChild(el("td", {}, chip(isActive ? st.state : "not selected", isActive ? STATE_TONE[st.state] : "")));

        const actions = el("div", { style: { display: "flex", gap: "0.35rem", "flex-wrap": "wrap" } });
        const useBtn = el("button.pu-btn.secondary", { type: "button", text: isActive ? "Reconnect" : "Connect" });
        useBtn.addEventListener("click", async () => {
          await withBusy(useBtn, "Connecting…", async () => {
            const result = await or.connect({ profileId: profile.id, mode: "live", announce: true });
            if (!result.ok) {
              toast(result.error || "The connection failed.", { tone: "error" });
              return;
            }
            toast(`Connected to ${profile.name}`, { tone: "success" });
            rerender();
          });
        });
        const editBtn = el("button.pu-btn.secondary", { type: "button", text: "Edit" });
        editBtn.addEventListener("click", () => fillForm(profile));
        const delBtn = el("button.pu-btn.secondary", { type: "button", text: "Remove" });
        delBtn.addEventListener("click", async () => {
          await withBusy(delBtn, "Removing…", async () => {
            await or.profiles.remove(profile.id);
            if (state.editingId === profile.id) fillForm(null);
            toast(`Removed “${profile.name}”`, { tone: "info" });
            rerender();
          });
        });
        actions.appendChild(useBtn);
        actions.appendChild(editBtn);
        actions.appendChild(delBtn);
        tr.appendChild(el("td", {}, actions));
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      wrap.appendChild(table);
      card.appendChild(wrap);
      return card;
    }

    const modeSelect = el("select.pu-select", { "aria-label": "Connection mode" }, ...OPENRPA_MODES.map((mode) => el("option", { value: mode, text: mode === "emulator" ? "Offline emulator" : "Live OpenFlow endpoint" })));
    modeSelect.addEventListener("change", () => {
      const result = or.setMode(modeSelect.value);
      if (!result.ok) {
        toast(result.error, { tone: "error" });
        modeSelect.value = or.mode();
        return;
      }
      toast(`Mode: ${result.mode}`, { tone: "info" });
      rerender();
    });

    function buildConnection() {
      modeSelect.value = or.mode();
      const card = el("section.pu-card");
      const head = el("div", { style: { display: "flex", gap: "0.5rem", "align-items": "center", "flex-wrap": "wrap" } });
      head.appendChild(el("h2", { style: { margin: "0" }, text: "Connection" }));
      const st = or.status();
      head.appendChild(chip(st.state, STATE_TONE[st.state]));
      head.appendChild(chip(st.mode, ""));
      card.appendChild(head);
      card.appendChild(
        el("p.pu-small", {
          text: "The offline emulator answers the OpenRPA wire protocol from an in-browser fixture set, so every connector feature is demonstrable without a robot. A live connection opens a real WebSocket to the selected profile.",
        })
      );

      modeSelect.value = or.mode();
      const connectBtn = el("button.pu-btn", { type: "button", text: st.connected ? "Disconnect" : "Connect", "data-permission": "openrpa.manage", "data-mutating": "" });
      connectBtn.addEventListener("click", async () => {
        await withBusy(connectBtn, st.connected ? "Closing…" : "Connecting…", async () => {
          if (or.protocol.connected()) {
            or.disconnect();
            toast("Disconnected", { tone: "info" });
          } else {
            const result = await or.connect({ mode: modeSelect.value, announce: true });
            if (!result.ok) toast(result.error || "The connection failed.", { tone: "error" });
            else toast(`Connected via ${result.mode}`, { tone: "success" });
          }
          rerender();
        });
      });
      const pingBtn = el("button.pu-btn.secondary", { type: "button", text: "Ping" });
      pingBtn.addEventListener("click", async () => {
        await withBusy(pingBtn, "Pinging…", async () => {
          const result = await or.probe();
          if (result.ok) toast(`Pong in ${result.latencyMs} ms`, { tone: "success" });
          else toast(result.error || "No reply", { tone: "error" });
          rerender();
        });
      });

      const controls = el("div.pu-form-row", { style: { "margin-top": "0.75rem" } });
      controls.appendChild(field("Mode", modeSelect));
      controls.appendChild(el("div", { style: { display: "flex", gap: "0.5rem", "flex-wrap": "wrap", "align-items": "flex-end" } }, connectBtn, pingBtn));
      card.appendChild(controls);

      const protocol = or.protocol.stats();
      const facts = el("ul.pu-list", { style: { "margin-top": "0.75rem" } });
      facts.appendChild(listItem("Endpoint", st.endpoint));
      facts.appendChild(listItem("Transport", protocol.transport || "none"));
      facts.appendChild(listItem("Messages", `${protocol.sent} sent · ${protocol.received} received · ${protocol.pending} awaiting reply`));
      facts.appendChild(listItem("Resilience", `${protocol.retried} retried · ${protocol.timeouts} timed out · ${protocol.errors} errors`));
      facts.appendChild(listItem("Last reply", protocol.lastLatencyMs == null ? "—" : `${protocol.lastLatencyMs} ms`));
      card.appendChild(facts);
      return card;
    }

    const usernameInput = el("input.pu-input", { type: "text", placeholder: "ada", autocomplete: "username", "aria-label": "OpenFlow username" });
    const passwordInput = el("input.pu-input", { type: "password", placeholder: "password", autocomplete: "current-password", "aria-label": "OpenFlow password" });
    const jwtInput = el("textarea.pu-textarea", { placeholder: "Paste a JWT (three base64url parts, separated by dots)", "aria-label": "JWT", spellcheck: "false", style: { "min-height": "4.5rem" } });

    function buildAuth() {
      const card = el("section.pu-card");
      const head = el("div", { style: { display: "flex", gap: "0.5rem", "align-items": "center", "flex-wrap": "wrap" } });
      head.appendChild(el("h2", { style: { margin: "0" }, text: "Authentication & session" }));
      const st = or.status();
      head.appendChild(chip(st.session.signedIn ? (st.session.expired ? "expired" : "signed in") : "signed out", st.session.signedIn ? (st.session.expired ? "fail" : "ok") : ""));
      card.appendChild(head);
      card.appendChild(
        el("p.pu-small", {
          text: "Sign in to OpenFlow with a username and password, or paste a JWT your identity provider issued. The returned token user's OpenFlow roles are mapped onto the hub's canonical permission model. Passwords are sent only to the endpoint and are never stored.",
        })
      );

      const credRow = el("div.pu-form-row", { style: { "margin-top": "0.75rem" } });
      credRow.appendChild(field("Username", usernameInput));
      credRow.appendChild(field("Password", passwordInput));
      card.appendChild(credRow);

      const signInBtn = el("button.pu-btn", { type: "button", text: "Sign in", "data-permission": "openrpa.manage", "data-mutating": "" });
      signInBtn.addEventListener("click", async () => {
        await withBusy(signInBtn, "Signing in…", async () => {
          const result = await or.signIn({ username: usernameInput.value.trim(), password: passwordInput.value });
          if (!result.ok) {
            toast(result.error || "Sign-in failed.", { tone: "error" });
            return;
          }
          passwordInput.value = "";
          toast(`Signed in as ${result.info.user.name}`, { tone: "success" });
          rerender();
        });
      });
      const jwtRow = el("div", { style: { "margin-top": "0.6rem" } });
      jwtRow.appendChild(field("JWT", jwtInput, "The token is decoded in your browser so expiry can be tracked; nothing is verified locally."));
      const jwtBtn = el("button.pu-btn.secondary", { type: "button", text: "Sign in with JWT" });
      jwtBtn.addEventListener("click", async () => {
        await withBusy(jwtBtn, "Verifying…", async () => {
          const result = await or.signIn({ jwt: jwtInput.value.trim() });
          if (!result.ok) {
            toast(result.error || "The token was rejected.", { tone: "error" });
            return;
          }
          jwtInput.value = "";
          toast(`Signed in as ${result.info.user.name}`, { tone: "success" });
          rerender();
        });
      });
      jwtRow.appendChild(el("div", { style: { "margin-top": "0.5rem" } }, signInBtn, " ", jwtBtn));
      card.appendChild(jwtRow);

      const session = st.session;
      if (!session.signedIn) {
        card.appendChild(el("div.pu-empty", { style: { "margin-top": "0.75rem" }, text: "Not signed in. Connect and sign in to load the token user and its roles." }));
        return card;
      }

      const refreshBtn = el("button.pu-btn.secondary", { type: "button", text: "Refresh session" });
      refreshBtn.addEventListener("click", async () => {
        await withBusy(refreshBtn, "Refreshing…", async () => {
          const result = await or.session.refresh();
          if (!result.ok) toast(result.error || "Refresh failed.", { tone: "error" });
          else toast("Session refreshed", { tone: "success" });
          rerender();
        });
      });
      const signOutBtn = el("button.pu-btn.secondary", { type: "button", text: "Sign out" });
      signOutBtn.addEventListener("click", async () => {
        await withBusy(signOutBtn, "Signing out…", async () => {
          await or.signOut();
          toast("Signed out", { tone: "info" });
          rerender();
        });
      });

      const facts = el("ul.pu-list", { style: { "margin-top": "0.75rem" } });
      facts.appendChild(listItem("Token user", `${session.user.name}${session.username ? ` (${session.username})` : ""}`));
      facts.appendChild(listItem("OpenFlow roles", session.roles.join(", ") || "none"));
      facts.appendChild(listItem("Canonical roles", session.canonicalRoles.join(", ") || "unmapped"));
      facts.appendChild(listItem("Expiry", session.expiresAt ? `${new Date(session.expiresAt).toLocaleString()}${session.secondsRemaining != null ? ` · ${Math.round(session.secondsRemaining / 60)} min left` : ""}` : "no expiry"));
      facts.appendChild(listItem("Signed in via", session.source));
      card.appendChild(facts);

      const capsWrap = el("div", { style: { display: "flex", gap: "0.3rem", "flex-wrap": "wrap", "margin-top": "0.5rem" } });
      for (const capability of session.capabilities) capsWrap.appendChild(chip(capability, ""));
      if (!session.capabilities.length) capsWrap.appendChild(el("span.pu-small.pu-muted", { text: "No canonical capabilities — this role map has no match." }));
      card.appendChild(capsWrap);
      card.appendChild(el("div", { style: { "margin-top": "0.75rem" } }, refreshBtn, " ", signOutBtn));
      return card;
    }

    const probeCtn = el("div", { style: { "margin-top": "0.75rem" } });
    const delayInput = el("input.pu-input", { type: "number", min: "0", max: "5000", value: "0", "aria-label": "Emulator latency in ms", style: { "max-width": "8rem" } });

    function buildEmulator() {
      const card = el("section.pu-card");
      const head = el("div", { style: { display: "flex", gap: "0.5rem", "align-items": "center", "flex-wrap": "wrap" } });
      head.appendChild(el("h2", { style: { margin: "0" }, text: "Offline emulator" }));
      const s = or.emulator.stats();
      head.appendChild(chip(or.mode() === "emulator" ? "in use" : "idle", or.mode() === "emulator" ? "ok" : ""));
      card.appendChild(head);
      card.appendChild(
        el("p.pu-small", {
          text: "A faithful in-browser stand-in for an OpenFlow endpoint: the same envelope, command set and document model, seeded with demo workflows, queues, work items, robots and Node-RED instances. Use it to explore every feature while the generator is previewed or the real robot is unreachable.",
        })
      );

      const facts = el("ul.pu-list", { style: { "margin-top": "0.5rem" } });
      facts.appendChild(listItem("Endpoint state", s.online ? "reachable" : "unreachable (simulated)"));
      facts.appendChild(listItem("Fixture set", `${s.commands} commands · ${s.users} users · ${s.roles} roles`));
      facts.appendChild(listItem("Documents", `${s.total} across ${s.collections} collections`));
      facts.appendChild(listItem("Commands served", String(s.calls)));
      card.appendChild(facts);

      const table = el("table.pu-table");
      const thead = el("thead");
      const headRow = el("tr");
      for (const label of ["Collection", "Documents"]) headRow.appendChild(el("th", { text: label }));
      thead.appendChild(headRow);
      table.appendChild(thead);
      const tbody = el("tbody");
      for (const [name, count] of Object.entries(s.documents)) {
        const tr = el("tr");
        tr.appendChild(el("td", {}, el("span.pu-ref", { text: name })));
        tr.appendChild(el("td", { text: String(count) }));
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      const scroll = el("div.pu-table-scroll", { style: { "margin-top": "0.6rem" } });
      scroll.appendChild(table);
      card.appendChild(scroll);

      const probeBtn = el("button.pu-btn.secondary", { type: "button", text: "Probe collections" });
      probeBtn.addEventListener("click", async () => {
        await withBusy(probeBtn, "Probing…", async () => {
          mount(probeCtn);
          try {
            const names = await or.request("listcollections", {});
            const lines = [];
            for (const name of names) {
              const result = await or.request("count", { collection: name });
              lines.push(`${name}: ${result.count}`);
            }
            probeCtn.appendChild(el("div.pu-alert.ok", { text: `Listed ${names.length} collections — ${lines.join(" · ")}` }));
          } catch (error) {
            probeCtn.appendChild(el("div.pu-alert.fail", { text: error && error.message ? error.message : "The probe failed." }));
          }
          rerender();
        });
      });
      const offlineBtn = el("button.pu-btn.secondary", { type: "button", text: s.online ? "Simulate endpoint down" : "Bring endpoint back" });
      offlineBtn.addEventListener("click", () => {
        or.emulator.setOnline(!or.emulator.online());
        toast(or.emulator.online() ? "Emulator reachable again" : "Emulator unreachable (retries will be exercised)", { tone: or.emulator.online() ? "success" : "info" });
        rerender();
      });
      const failBtn = el("button.pu-btn.secondary", { type: "button", text: "Inject a failing command" });
      failBtn.addEventListener("click", () => {
        or.emulator.injectFailure("ping", "Simulated OpenFlow error for ping.");
        toast("The next ping will return a protocol error", { tone: "info" });
      });
      const delayBtn = el("button.pu-btn.secondary", { type: "button", text: "Apply latency" });
      delayBtn.addEventListener("click", () => {
        const ms = or.emulator.setDelay(Number(delayInput.value) || 0);
        toast(`Emulator latency set to ${ms} ms (reconnect to apply)`, { tone: "info" });
      });
      const resetBtn = el("button.pu-btn.secondary", { type: "button", text: "Reset fixtures" });
      resetBtn.addEventListener("click", () => {
        or.emulator.reset();
        mount(probeCtn);
        toast("Emulator fixtures restored", { tone: "success" });
        rerender();
      });
      const toolbar = el("div.pu-toolbar", { style: { "margin-top": "0.75rem" } }, probeBtn, offlineBtn, failBtn, resetBtn, delayInput, delayBtn);
      card.appendChild(toolbar);
      card.appendChild(probeCtn);
      return card;
    }

    function capabilityCard() {
      const card = el("section.pu-card");
      card.appendChild(el("h2", { text: "Declared connector capability" }));
      card.appendChild(el("p.pu-small", { text: "OpenRPA registers with the hub's integration registry as a first-class connector. Its capability set and required connection fields are declared once, in src/core/openrpa/constants.js." }));
      const caps = el("div", { style: { display: "flex", gap: "0.3rem", "flex-wrap": "wrap", "margin-top": "0.5rem" } });
      for (const capability of OPENRPA_CAPABILITIES) caps.appendChild(chip(capability.label, ""));
      card.appendChild(caps);
      const dl = el("dl.pu-kv", { style: { "margin-top": "0.75rem" } });
      for (const entry of OPENRPA_CONNECTION_FIELDS) {
        dl.appendChild(el("dt", { text: entry.label }));
        dl.appendChild(el("dd", {}, el("span.pu-small", { text: entry.hint })));
      }
      card.appendChild(dl);
      card.appendChild(el("p.pu-small.pu-muted", { style: { "margin-top": "0.5rem" }, text: "Connection profiles are persisted under the hub's storage namespace; the connector monitor picks OpenRPA up alongside the Project U members." }));
      return card;
    }

    root.appendChild(
      pageHead({
        eyebrow: "OpenRPA",
        title: "OpenRPA / OpenFlow connector",
        subtitle: "Connect RPA-U to OpenRPA and OpenFlow: manage connection profiles, sign in and map roles, speak the OpenRPA wire protocol with retries and state tracking, and explore every feature against an offline emulator.",
      })
    );
    root.appendChild(statsCtn);
    root.appendChild(profilesCtn);
    root.appendChild(connectionCtn);
    root.appendChild(authCtn);
    root.appendChild(emulatorCtn);
    root.appendChild(capabilityCard());

    if (onDestroy) {
      onDestroy(() => {
        modeSelect.value = or.mode();
      });
    }

    rerender();
    return root;
  },
};
