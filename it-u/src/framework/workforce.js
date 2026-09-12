// src/framework/workforce.js — the workforce catalogs (roadmap task 14).
//
// Task 14 asks IT-U to support organization-specific structured types such as
// user roles (role name, typical tasks, associated software configurations,
// members, typical workstation tier) and software configurations/builds. The
// "workstation tier" and "operating system" axes are the vocabulary those
// templates share, so the provider defines them ONCE here rather than
// re-typing a free-text device spec into every role and build. Both catalogs
// are deliberately small and stable; the templates reference them by id, and a
// report can group roles/builds by tier without parsing text.

export const WORKSTATION_TIERS = [
  { id: "standard", label: "Standard office", description: "Everyday productivity — email, documents, browser." },
  { id: "power", label: "Power / high-spec", description: "CAD, engineering, media or data-heavy workloads." },
  { id: "mobile", label: "Mobile / laptop-first", description: "Primarily a laptop, used on and off site." },
  { id: "thin-client", label: "Thin client / VDI", description: "A session on a shared host rather than a full desktop." },
  { id: "kiosk", label: "Kiosk / shared device", description: "A locked-down shared station or shop-floor terminal." },
  { id: "executive", label: "Executive", description: "Senior user with elevated mobility and support needs." },
  { id: "virtual", label: "Virtual desktop", description: "A published desktop or app delivered virtually." },
];

export const WORKSTATION_TIER_IDS = WORKSTATION_TIERS.map((t) => t.id);
export const workstationTier = (id) => WORKSTATION_TIERS.find((t) => t.id === id) || null;
export const workstationTierLabel = (id) => (workstationTier(id) || {}).label || "";

export const OPERATING_SYSTEMS = [
  { id: "windows-11", label: "Windows 11" },
  { id: "windows-10", label: "Windows 10" },
  { id: "windows-server", label: "Windows Server" },
  { id: "macos", label: "macOS" },
  { id: "ubuntu", label: "Ubuntu" },
  { id: "linux-other", label: "Other Linux" },
  { id: "chromeos", label: "ChromeOS" },
];

export const OPERATING_SYSTEM_IDS = OPERATING_SYSTEMS.map((o) => o.id);
export const operatingSystem = (id) => OPERATING_SYSTEMS.find((o) => o.id === id) || null;
export const operatingSystemLabel = (id) => (operatingSystem(id) || {}).label || "";

// The choice options for a template's select/multiselect, shaped exactly as
// ./flexible.js's normalizeField expects.
export const tierOptions = () => WORKSTATION_TIERS.map((t) => ({ id: t.id, label: t.label }));
export const osOptions = () => OPERATING_SYSTEMS.map((o) => ({ id: o.id, label: o.label }));
