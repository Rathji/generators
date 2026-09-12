import { DEFAULT_IDENTITY_CONFIG, normalizeIdentityConfig } from "../core/identity/config.js";

export const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const DEFAULT_CONFIG = {
  appId: "rpa-u",
  appTitle: "RPA-U",
  appShortTitle: "RU",
  tagline: "Project U integration hub",
  companyName: "Project U",
  version: "0.0.0",
  storageNamespace: "pu-rpa",
  defaultTheme: "navy",
  logoMark: "RU",
  copyright: "Project U",
  docsUrl: "",
  identity: DEFAULT_IDENTITY_CONFIG,
  branding: {
    primary: "#1e3a8a",
    accent: "#0d9488",
    fontSans: "Inter",
    logoUrl: "",
    footer: "",
  },
};

export function isKebabCase(value) {
  return typeof value === "string" && KEBAB_CASE.test(value);
}

function toStr(value, fallback) {
  if (value == null) return fallback;
  let out;
  try {
    out = String(value);
  } catch (e) {
    return fallback;
  }
  out = out.trim();
  return out.length ? out : fallback;
}

function pick(raw, key, fallback) {
  if (!raw || typeof raw !== "object") return fallback;
  return toStr(raw[key], fallback);
}

export function normalizeConfig(raw) {
  const branding = (raw && raw.branding) || {};
  const appId = pick(raw, "appId", DEFAULT_CONFIG.appId);
  const config = {
    appId: isKebabCase(appId) ? appId : DEFAULT_CONFIG.appId,
    appTitle: pick(raw, "appTitle", DEFAULT_CONFIG.appTitle),
    appShortTitle: pick(raw, "appShortTitle", DEFAULT_CONFIG.appShortTitle),
    tagline: pick(raw, "tagline", DEFAULT_CONFIG.tagline),
    companyName: pick(raw, "companyName", DEFAULT_CONFIG.companyName),
    version: pick(raw, "version", DEFAULT_CONFIG.version),
    storageNamespace: pick(raw, "storageNamespace", DEFAULT_CONFIG.storageNamespace),
    defaultTheme: pick(raw, "defaultTheme", DEFAULT_CONFIG.defaultTheme),
    logoMark: pick(raw, "logoMark", DEFAULT_CONFIG.logoMark),
    copyright: pick(raw, "copyright", DEFAULT_CONFIG.copyright),
    docsUrl: pick(raw, "docsUrl", DEFAULT_CONFIG.docsUrl),
    identity: normalizeIdentityConfig(raw && raw.identity),
    branding: {
      primary: pick(branding, "primary", DEFAULT_CONFIG.branding.primary),
      accent: pick(branding, "accent", DEFAULT_CONFIG.branding.accent),
      fontSans: pick(branding, "fontSans", DEFAULT_CONFIG.branding.fontSans),
      logoUrl: pick(branding, "logoUrl", DEFAULT_CONFIG.branding.logoUrl),
      footer: pick(branding, "footer", DEFAULT_CONFIG.branding.footer),
    },
  };
  return config;
}

export function rawConfig() {
  try {
    const root = typeof window !== "undefined" ? window.root : null;
    if (root && root.pu) return root.pu;
  } catch (e) {}
  return null;
}

let cached = null;

export function getConfig() {
  if (!cached) cached = normalizeConfig(rawConfig());
  return cached;
}

export function readMeta() {
  const out = { title: "", description: "", tags: "" };
  try {
    const root = typeof window !== "undefined" ? window.root : null;
    const meta = root && (root.$meta || root.meta);
    if (meta) {
      out.title = toStr(meta.title, "");
      out.description = toStr(meta.description, "");
      out.tags = toStr(meta.tags, "");
    }
  } catch (e) {}
  if (!out.title && typeof document !== "undefined") out.title = document.title || "";
  return out;
}

export function storageKey(config, suffix) {
  return `${config.storageNamespace}:${suffix}`;
}
