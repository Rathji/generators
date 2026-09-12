// ============================================================================
//  View — Settings (appearance · branding · preferences · components · data)
//  A tabbed control centre. Each tab is built from the same card helpers the
//  rest of the hub uses; the active tab is remembered in storage so reopening
//  Settings returns you where you left off.
// ============================================================================

import { h, svgIcon, mount } from "../framework/dom.js";
import { PU } from "../framework/pu.js";
import { pageHeader, card, grid, badge, demoRow } from "./helpers.js";
import { textField, selectField, toggleField } from "../components/inputs.js";
import { dependencyReport } from "../framework/meta.js";
import { formatBytes, formatRelativeTime } from "../framework/utils.js";

function colorField({ name, label, hint, value }) {
  const swatch = h("input", {
    type: "color",
    class: "pu-color-input",
    value: /^#[0-9a-f]{6}$/i.test(value) ? value : "#1e3a8a",
    "aria-label": `${label} colour picker`,
    tabindex: "-1",
  });
  const field = textField({ name, label, hint, value, placeholder: "#1e3a8a", prefix: swatch });
  swatch.addEventListener("input", () => {
    field.input.value = swatch.value;
  });
  field.input.addEventListener("input", () => {
    if (/^#[0-9a-f]{6}$/i.test(field.input.value.trim())) swatch.value = field.input.value.trim();
  });
  field.swatch = swatch;
  return field;
}

export function render(outlet, ctx) {
  const { app } = ctx;
  const { theme, branding, registry, storage, toaster, config, state, preferences } = app;

  // ------------------------------------------------------------------ theme --
  const themeCards = new Map();
  const modeBtn = h("button", {
    class: "pu-btn pu-btn--secondary pu-btn--sm",
    type: "button",
    onclick: () => {
      theme.toggleMode();
      syncThemeState();
      toaster.success(`${theme.get().label} theme applied.`, { duration: 2000 });
    },
  });

  function syncThemeState() {
    const active = theme.get();
    for (const [id, el] of themeCards) {
      const isActive = id === active.themeId;
      el.classList.toggle("is-active", isActive);
      el.setAttribute("aria-pressed", isActive ? "true" : "false");
    }
    modeBtn.textContent = `Switch to ${active.mode === "dark" ? "light" : "dark"} mode`;
  }

  const themeGrid = h(
    "div",
    { class: "pu-theme-grid" },
    theme.list().map((item) => {
      const el = h(
        "button",
        {
          class: "pu-theme-card",
          type: "button",
          onclick: () => {
            theme.set(item.id);
            syncThemeState();
            toaster.success(`${item.label} theme applied.`, { duration: 2000 });
          },
        },
        h("span", { class: "pu-theme-swatches" }, item.swatch.map((color) => h("span", { class: "pu-theme-swatch", style: { background: color } }))),
        h("span", { class: "pu-theme-meta" }, h("span", { class: "pu-theme-name" }, item.label), badge(item.mode, item.mode === "dark" ? "neutral" : "info")),
        h("span", { class: "pu-theme-desc" }, item.description),
        item.id === "navy" ? h("span", { class: "pu-theme-default" }, "Default") : null
      );
      themeCards.set(item.id, el);
      return el;
    })
  );

  const appearance = card({
    title: "Appearance",
    subtitle: "Theme and colour mode. Light mode is the default; the light navy palette (“Navy”) ships as the Project U default.",
    actions: modeBtn,
    body: themeGrid,
  });

  // --------------------------------------------------------------- branding --
  const brandFields = {
    appTitle: textField({ name: "appTitle", label: "Application title" }),
    tagline: textField({ name: "tagline", label: "Tagline" }),
    logoMark: textField({ name: "logoMark", label: "Logo mark", hint: "1–3 characters, or a logo image URL below.", maxlength: 3 }),
    fontSans: textField({ name: "fontSans", label: "Interface font", hint: "Load the font via a <link> in index.html." }),
    primary: colorField({ name: "primary", label: "Primary colour", hint: "Brand colour, applied to both modes." }),
    accent: colorField({ name: "accent", label: "Accent colour", hint: "Secondary highlight colour." }),
    footer: textField({ name: "footer", label: "Sidebar footer" }),
  };

  function fillBrandingForm(data) {
    for (const [key, field] of Object.entries(brandFields)) {
      if (data[key] != null) field.input.value = data[key];
      if (field.swatch && /^#[0-9a-f]{6}$/i.test(field.input.value.trim())) field.swatch.value = field.input.value.trim();
    }
  }

  function readBrandingForm() {
    const patch = {};
    for (const [key, field] of Object.entries(brandFields)) patch[key] = field.value;
    return patch;
  }

  const applyBranding = () => {
    const patch = readBrandingForm();
    branding.update(patch);
    theme.apply();
    fillBrandingForm(branding.get());
    toaster.success("Branding applied.");
  };

  const resetBranding = () => {
    branding.update({
      appTitle: config.appTitle,
      appShortTitle: config.appShortTitle,
      tagline: config.tagline,
      logoMark: config.logoMark,
      companyName: config.companyName,
      footer: config.copyright || config.companyName,
      primary: config.branding?.primary || "#1e3a8a",
      accent: config.branding?.accent || "#0d9488",
      fontSans: config.branding?.fontSans || "Inter",
      logoUrl: "",
    });
    theme.apply();
    fillBrandingForm(branding.get());
    toaster.info("Branding reset to the Project U defaults.");
  };

  const brandingCard = card({
    title: "Branding",
    subtitle: "Member generators override colours, naming and logo here — no CSS edits needed.",
    actions: h(
      "div",
      { class: "pu-btn-row" },
      h("button", { class: "pu-btn pu-btn--ghost pu-btn--sm", type: "button", onclick: resetBranding }, "Reset"),
      h("button", { class: "pu-btn pu-btn--primary pu-btn--sm", type: "button", onclick: applyBranding }, "Apply branding")
    ),
    body: h(
      "div",
      { class: "pu-form-grid" },
      brandFields.appTitle.el,
      brandFields.tagline.el,
      brandFields.logoMark.el,
      brandFields.fontSans.el,
      brandFields.primary.el,
      brandFields.accent.el,
      h("div", { class: "pu-form-span" }, brandFields.footer.el),
      h(
        "div",
        { class: "pu-brand-preview pu-form-span" },
        h("span", { class: "pu-brand-preview-label" }, "Live preview"),
        h(
          "div",
          { class: "pu-brand-bar" },
          h("span", { class: "pu-brand-dot" }),
          h("span", { class: "pu-brand-pill" }, "Primary"),
          h("span", { class: "pu-brand-pill pu-brand-pill--accent" }, "Accent")
        ),
        h("p", { class: "pu-muted" }, "The preview above uses the current theme tokens. Press Apply to commit colour changes to the whole app.")
      )
    ),
  });

  // ---------------------------------------------------- account & preferences --
  const user = state.get().user;
  const accountFields = {
    name: textField({ name: "accountName", label: "Display name", value: user.name, autocomplete: "name" }),
    email: textField({ name: "accountEmail", label: "Email", type: "email", value: user.email, autocomplete: "email" }),
    role: textField({ name: "accountRole", label: "Role", value: user.role, hint: "Shown on the account menu in the header." }),
  };

  function saveAccount() {
    const name = accountFields.name.value.trim();
    const email = accountFields.email.value.trim();
    let valid = true;
    if (!name) {
      accountFields.name.setError("A display name is required.");
      valid = false;
    } else accountFields.name.clearError();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      accountFields.email.setError("Enter a valid email address.");
      valid = false;
    } else accountFields.email.clearError();
    if (!valid) return;
    state.setUser({ name, email, role: accountFields.role.value.trim() });
    toaster.success("Account details updated.");
  }

  const accountCard = card({
    title: "Account",
    subtitle: "Your details drive the header account menu and are shared with every member tool.",
    actions: h("button", { class: "pu-btn pu-btn--primary pu-btn--sm", type: "button", onclick: saveAccount }, "Save details"),
    body: h("div", { class: "pu-form-grid" }, accountFields.name.el, accountFields.email.el, accountFields.role.el),
  });

  const trackToggle = toggleField({
    name: "trackRecents",
    label: "Track recently used generators",
    hint: "Keeps a short, local history of the generators you open.",
    checked: preferences.trackRecents,
  });
  trackToggle.input.addEventListener("change", () => {
    preferences.setTrackRecents(trackToggle.input.checked);
    toaster.info(trackToggle.input.checked ? "Recent history is on." : "Recent history is off.", { duration: 1600 });
  });

  const limitField = selectField({
    name: "maxRecents",
    label: "History length",
    hint: "How many generators the Recently used row keeps.",
    value: String(preferences.maxRecents),
    options: [3, 5, 8, 10].map((n) => ({ value: String(n), label: `${n} generators` })),
  });
  limitField.input.addEventListener("change", () => {
    preferences.setMaxRecents(Number(limitField.input.value));
    toaster.info(`Showing the last ${preferences.maxRecents} launches.`, { duration: 1600 });
  });

  const pinFirstToggle = toggleField({
    name: "pinFirst",
    label: "Float pinned generators to the top",
    hint: "When off, pins are just a marker and the grid keeps registry order.",
    checked: preferences.pinFirst,
  });
  pinFirstToggle.input.addEventListener("change", () => {
    preferences.setPinFirst(pinFirstToggle.input.checked);
    toaster.info(pinFirstToggle.input.checked ? "Pinned generators float to the top." : "Launcher keeps registry order.", { duration: 1800 });
  });

  const launcherPrefsCard = card({
    title: "Launcher & history",
    subtitle: "How the home launcher orders and remembers your generators. Stored locally in this browser.",
    body: h("div", { class: "pu-stack-2" }, trackToggle.el, limitField.el, pinFirstToggle.el),
  });

  const pinned = app.pinnedMembers();
  const pinnedCard = card({
    title: "Pinned generators",
    subtitle: "Pins sort to the top of the launcher and the command palette.",
    actions: pinned.length
      ? h(
          "button",
          {
            class: "pu-btn pu-btn--ghost pu-btn--sm",
            type: "button",
            onclick: () => {
              preferences.clearPins();
              toaster.info("All pins cleared.", { duration: 1600 });
            },
          },
          "Clear pins"
        )
      : null,
    body: pinned.length
      ? h(
          "div",
          { class: "pu-pref-list" },
          pinned.map((member) =>
            h(
              "div",
              { class: "pu-pref-row", dataset: { member: member.id } },
              h("span", { class: "pu-pref-dot", style: { background: member.accent } }),
              h("a", { class: "pu-pref-name", href: app.memberLink(member), target: "_blank", rel: "noopener noreferrer" }, member.name),
              badge(member.category, "neutral"),
              h(
                "button",
                {
                  class: "pu-pref-action",
                  type: "button",
                  title: `Unpin ${member.name}`,
                  "aria-label": `Unpin ${member.name}`,
                  onclick: () => {
                    preferences.unpin(member.id);
                    toaster.info(`${member.name} unpinned.`, { duration: 1600 });
                  },
                },
                svgIcon("pin", { size: 14 }),
                "Unpin"
              )
            )
          )
        )
      : h("p", { class: "pu-muted" }, "No generators pinned yet — use the pin button on any launcher card to float it to the top."),
  });

  const recents = app.recentMembers();
  const recentsCard = card({
    title: "Recent history",
    subtitle: preferences.trackRecents ? `The last ${preferences.maxRecents} generators you opened.` : "History tracking is off.",
    actions: recents.length
      ? h(
          "button",
          {
            class: "pu-btn pu-btn--ghost pu-btn--sm",
            type: "button",
            onclick: () => {
              preferences.clearRecents();
              toaster.info("Recent history cleared.", { duration: 1600 });
            },
          },
          "Clear"
        )
      : null,
    body: recents.length
      ? h(
          "div",
          { class: "pu-pref-list" },
          recents.map((entry) =>
            h(
              "div",
              { class: "pu-pref-row", dataset: { member: entry.id } },
              h("span", { class: "pu-pref-dot", style: { background: entry.member.accent } }),
              h("a", { class: "pu-pref-name", href: app.memberLink(entry.member), target: "_blank", rel: "noopener noreferrer" }, entry.member.name),
              h("span", { class: "pu-pref-time" }, entry.at ? formatRelativeTime(entry.at) : "recently")
            )
          )
        )
      : h(
          "p",
          { class: "pu-muted" },
          preferences.trackRecents ? "Nothing here yet — launch a generator and it will show up." : "Turn tracking on to keep a short history of recent launches."
        ),
  });

  // ----------------------------------------------------------------- registry --
  const registryCard = card({
    title: "Component registry",
    subtitle: "Enable or disable optional components per member generator. Disabled components are hidden from navigation and routing.",
    body: h(
      "div",
      { class: "pu-reg-list" },
      registry.list().map((component) =>
        h(
          "div",
          { class: "pu-reg-row" },
          h("div", { class: "pu-reg-text" }, h("span", { class: "pu-reg-name" }, component.label), h("span", { class: "pu-reg-desc" }, component.description || "")),
          component.optional
            ? h(
                "label",
                { class: "pu-reg-toggle" },
                h("input", {
                  type: "checkbox",
                  checked: registry.isEnabled(component.id) || undefined,
                  onchange: (event) => {
                    registry.setEnabled(component.id, event.target.checked);
                    app.renderNav();
                    toaster.info(`${component.label} ${event.target.checked ? "enabled" : "disabled"}.`);
                  },
                }),
                h("span", { class: "pu-toggle-track pu-toggle-track--sm" }, h("span", { class: "pu-toggle-thumb" }))
              )
            : badge("Required", "neutral")
        )
      )
    ),
  });

  // ------------------------------------------------------------------ storage --
  const keys = storage.keys();
  const storageCard = card({
    title: "Persistence",
    subtitle: `Namespaced ${storage.namespace}:* — stored via ${storage.isPersistent ? "localStorage" : "an in-memory fallback"}.`,
    body: h(
      "div",
      { class: "pu-stack-2" },
      demoRow({
        label: "Stored keys",
        control: h("div", { class: "pu-btn-row pu-btn-row--wrap" }, keys.length ? keys.map((k) => badge(k, "neutral")) : badge("none yet", "neutral")),
      }),
      demoRow({
        label: "Export settings",
        hint: "Download theme, branding, launcher preferences and the registry as JSON.",
        control: h("button", { class: "pu-btn pu-btn--secondary pu-btn--sm", type: "button", onclick: () => exportSettings(app) }, "Download JSON"),
      }),
      demoRow({
        label: "Reset preferences",
        hint: "Restores the default theme, clears pins and history, and re-enables every component.",
        control: h(
          "button",
          {
            class: "pu-btn pu-btn--danger pu-btn--sm",
            type: "button",
            onclick: () => {
              theme.reset();
              registry.reset();
              preferences.reset();
              storage.clear();
              toaster.warning("Preferences cleared — reloading…", { duration: 1600 });
              setTimeout(() => location.reload(), 900);
            },
          },
          "Clear & reload"
        ),
      })
    ),
  });

  // ----------------------------------------------------------------- metadata --
  const deps = dependencyReport(globalThis.root || {});
  const metaCard = card({
    title: "Framework metadata",
    subtitle: "Version and dependency tracking for the Project U family.",
    body: h(
      "div",
      { class: "pu-stack-2" },
      demoRow({ label: "Framework", control: h("div", { class: "pu-btn-row" }, badge(PU.name, "info"), badge(`v${PU.version}`, "neutral")) }),
      demoRow({ label: "Family", control: badge(PU.family, "neutral") }),
      demoRow({
        label: "Plugins",
        control: h(
          "div",
          { class: "pu-btn-row pu-btn-row--wrap" },
          deps.length
            ? deps.map((dep) => badge(`${dep.name}${dep.required ? "" : " (optional)"}`, dep.present ? "success" : "neutral", { icon: dep.present ? "check" : "info" }))
            : badge("none required", "success", { icon: "check" })
        ),
      }),
      demoRow({ label: "Docs", control: h("span", { class: "pu-muted" }, "src/README.md") })
    ),
  });

  // --------------------------------------------------------------------- tabs --
  const tabs = [
    { id: "appearance", label: "Appearance", icon: "palette", panels: [appearance] },
    { id: "branding", label: "Branding", icon: "sparkle", panels: [brandingCard] },
    { id: "preferences", label: "Preferences", icon: "sliders", panels: [accountCard, launcherPrefsCard, grid([pinnedCard, recentsCard], { cols: 2 })] },
    { id: "components", label: "Components", icon: "layout", panels: [registryCard] },
    { id: "data", label: "Data", icon: "lock", panels: [storageCard] },
    { id: "about", label: "About", icon: "info", panels: [metaCard] },
  ];
  const tabIndex = new Map(tabs.map((tab) => [tab.id, tab]));
  const storedTab = storage.get("settings:tab", tabs[0].id);
  const initialTab = tabIndex.has(storedTab) ? storedTab : tabs[0].id;

  const tabButtons = new Map();
  const panelCtn = h("div", { class: "pu-settings-panel", id: "puSettingsPanel", role: "tabpanel" });
  const tabStrip = h("div", { class: "pu-tabs", role: "tablist", "aria-label": "Settings sections" });

  function setTab(id) {
    const key = tabIndex.has(id) ? id : tabs[0].id;
    for (const [tabId, btn] of tabButtons) {
      const isActive = tabId === key;
      btn.classList.toggle("is-active", isActive);
      btn.setAttribute("aria-selected", isActive ? "true" : "false");
      btn.setAttribute("tabindex", isActive ? "0" : "-1");
      if (isActive) panelCtn.setAttribute("aria-labelledby", btn.id);
    }
    mount(panelCtn, ...tabIndex.get(key).panels);
    if (storage.get("settings:tab", null) !== key) storage.set("settings:tab", key);
  }

  for (const tab of tabs) {
    const btn = h(
      "button",
      { class: "pu-tab", type: "button", role: "tab", id: `puTab-${tab.id}`, onclick: () => setTab(tab.id) },
      svgIcon(tab.icon, { size: 15 }),
      h("span", {}, tab.label)
    );
    tabButtons.set(tab.id, btn);
    tabStrip.appendChild(btn);
  }

  tabStrip.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    const ids = tabs.map((tab) => tab.id);
    const activeIndex = Math.max(
      0,
      ids.findIndex((id) => tabButtons.get(id).classList.contains("is-active"))
    );
    const delta = event.key === "ArrowRight" ? 1 : -1;
    const nextId = ids[(activeIndex + delta + ids.length) % ids.length];
    setTab(nextId);
    tabButtons.get(nextId).focus();
    event.preventDefault();
  });

  outlet.replaceChildren(
    pageHeader({
      title: "Settings",
      subtitle: "Appearance, branding, account preferences, components and stored data.",
      icon: "settings",
    }),
    tabStrip,
    panelCtn
  );

  fillBrandingForm(branding.get());
  syncThemeState();
  setTab(initialTab);
}

function exportSettings(app) {
  const payload = {
    template: PU.name,
    version: PU.version,
    exportedAt: new Date().toISOString(),
    theme: app.storage.get("theme:v1", null),
    registry: app.storage.get("registry:v1", null),
    preferences: app.preferences.get(),
    branding: app.branding.get(),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = h("a", { href: url, download: `${PU.name}-settings.json` });
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  app.toaster.success(`Exported ${formatBytes(blob.size)} of settings.`);
}
