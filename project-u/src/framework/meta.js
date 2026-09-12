// ============================================================================
//  Project U — framework metadata + dependency tracking
//  Machine-readable description of the hub: version, family, the plugins it
//  expects, and its roadmap provenance.
// ============================================================================

export const TEMPLATE_META = {
  name: "project-u",
  displayName: "Project-U",
  family: "Project U",
  kind: "hub",
  version: "0.1.0",
  description:
    "The central dashboard hub for the Project U family of small-business generators.",
  reference: "template-u",
  phases: 7,
  tasks: 34,
  dependencies: [],
};

// Reports which expected imports are present on `root`, so the hub can warn
// early when a required plugin is missing.
export function dependencyReport(root) {
  const available = root || {};
  return TEMPLATE_META.dependencies.map((dep) => {
    const key = dep.name.replace(/-plugin$/, "").replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const present = Boolean(available[key]) || Boolean(available[dep.name]);
    return { ...dep, present };
  });
}

export function describe() {
  return {
    ...TEMPLATE_META,
    summary: `${TEMPLATE_META.displayName} v${TEMPLATE_META.version} — ${TEMPLATE_META.description}`,
  };
}

export function compareVersions(a, b) {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff) return diff > 0 ? 1 : -1;
  }
  return 0;
}
