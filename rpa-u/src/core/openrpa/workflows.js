export const OPENRPA_PARAM_DIRECTIONS = ["in", "out", "inout"];

const DIRECTION_ALIASES = { input: "in", output: "out", inout: "inout", in: "in", out: "out", bidirectional: "inout" };

function sourceOf(raw) {
  if (!raw) return {};
  if (raw.raw && typeof raw.raw === "object") return raw.raw;
  if (raw.document && typeof raw.document === "object") return raw.document.document || raw.document;
  return raw;
}

export function normalizeParameter(raw, index = 0) {
  const parameter = raw && typeof raw === "object" ? raw : { name: raw };
  const directionRaw = parameter.direction != null ? parameter.direction : parameter.mode;
  const direction = directionRaw == null ? "in" : DIRECTION_ALIASES[String(directionRaw).toLowerCase()] || String(directionRaw).toLowerCase();
  return {
    index,
    name: parameter.name != null ? String(parameter.name) : null,
    type: parameter.type != null ? String(parameter.type) : "string",
    direction,
    required: parameter.required === true || parameter.isrequired === true,
    default: parameter.default !== undefined ? parameter.default : null,
    hasDefault: parameter.default !== undefined,
    valid: !!parameter.name,
    knownDirection: OPENRPA_PARAM_DIRECTIONS.includes(direction),
  };
}

export function normalizeWorkflow(raw) {
  const doc = sourceOf(raw);
  const parameters = Array.isArray(doc.parameters) ? doc.parameters.map((entry, index) => normalizeParameter(entry, index)) : [];
  const source = typeof doc.xaml === "string" ? doc.xaml : typeof doc.source === "string" ? doc.source : null;
  return {
    id: doc._id || null,
    name: doc.name || null,
    filename: doc.filename || (doc.name ? `${doc.name}.xaml` : null),
    filenameDerived: !doc.filename,
    queue: doc.queue == null ? null : doc.queue,
    rpa: !!doc.rpa,
    web: !!doc.web,
    background: !!doc.background,
    serializable: !!(doc.Serializable != null ? doc.Serializable : doc.serializable),
    priority: doc.priority || null,
    parameters,
    parameterCount: parameters.length,
    inputCount: parameters.filter((entry) => entry.direction !== "out").length,
    outputCount: parameters.filter((entry) => entry.direction !== "in").length,
    hasSource: source != null && source.length > 0,
    sourceLength: source ? source.length : 0,
    version: Number(doc._version) || 1,
    created: doc._created || null,
    modified: doc._modified || null,
    createdBy: doc._createdby || null,
    modifiedBy: doc._modifiedby || null,
  };
}

export function workflowIssues(workflow, { queueIds = null } = {}) {
  const issues = [];
  const add = (level, code, message) => issues.push({ level, code, message });
  if (!workflow.id) add("error", "missing-id", "The workflow has no document id.");
  if (!workflow.filename) add("warn", "missing-filename", "The workflow has no file name, so it cannot be packaged.");
  if (!workflow.rpa && !workflow.web) add("warn", "no-execution-mode", "Neither the RPA agent nor the web/headless flag is set — the workflow cannot run.");
  if (workflow.rpa && workflow.web) add("info", "dual-mode", "The workflow can run both on an RPA agent and headless on the server.");
  if (!workflow.queue) add("info", "no-queue", "No queue binding: the workflow can only be invoked directly by id.");
  if (workflow.queue && Array.isArray(queueIds) && queueIds.length && !queueIds.includes(workflow.queue)) {
    add("warn", "missing-queue", `The queue binding “${workflow.queue}” does not exist in this tenant.`);
  }
  const seen = new Set();
  for (const parameter of workflow.parameters) {
    if (!parameter.name) add("error", "unnamed-parameter", `Parameter ${parameter.index + 1} has no name.`);
    else if (seen.has(parameter.name)) add("error", "duplicate-parameter", `Parameter “${parameter.name}” is declared more than once.`);
    else seen.add(parameter.name);
    if (!parameter.knownDirection) add("warn", "unknown-direction", `Parameter “${parameter.name || parameter.index + 1}” has direction “${parameter.direction}”.`);
    if (parameter.required && parameter.hasDefault) add("warn", "required-with-default", `Parameter “${parameter.name}” is required but also has a default value.`);
  }
  if (!workflow.hasSource) add("info", "no-source", "No workflow source (XAML) is stored for this document.");
  return issues;
}

export function workflowSummary(workflow) {
  const bits = [];
  bits.push(workflow.rpa ? "RPA" : "no RPA");
  bits.push(workflow.web ? "web" : "no web");
  bits.push(workflow.background ? "background" : "foreground");
  bits.push(workflow.serializable ? "serializable" : "not serializable");
  bits.push(workflow.queue ? `queue ${workflow.queue}` : "no queue");
  return `${bits.join(" · ")} · ${workflow.parameterCount} parameter(s)`;
}

export function workflowParameterRows(workflow) {
  return workflow.parameters.map((parameter) => ({
    name: parameter.name || "—",
    type: parameter.type,
    direction: parameter.direction,
    required: parameter.required,
    display: parameter.hasDefault ? String(parameter.default) : "—",
    issues: parameter.valid && parameter.knownDirection ? [] : ["check"],
  }));
}

export function presentWorkflow(raw, options = {}) {
  const workflow = normalizeWorkflow(raw);
  const issues = workflowIssues(workflow, options);
  return {
    ok: issues.every((issue) => issue.level !== "error"),
    workflow,
    issues,
    errors: issues.filter((issue) => issue.level === "error"),
    warnings: issues.filter((issue) => issue.level === "warn"),
    summary: workflowSummary(workflow),
    parameters: workflowParameterRows(workflow),
  };
}
