export const OPENRPA_OWNERSHIP_VERSION = 1;

export const OWNERSHIP_PRIORITIES = {
  openrpa: 60,
  "rmm-u": 50,
  "it-u": 40,
  "psa-u": 30,
  "crm-u": 20,
  ru: 10,
};

export const OPENRPA_FIELD_MODEL = {
  company: [
    { key: "automationStatus", label: "Automation status", owner: "openrpa", authoritative: true, direction: "push", automation: true, priority: OWNERSHIP_PRIORITIES.openrpa },
    { key: "automationWorkflow", label: "Automation workflow", owner: "openrpa", authoritative: true, direction: "bidirectional", automation: true, priority: OWNERSHIP_PRIORITIES.openrpa },
    { key: "automationQueue", label: "Automation queue", owner: "openrpa", authoritative: true, direction: "bidirectional", automation: true, priority: OWNERSHIP_PRIORITIES.openrpa },
    { key: "lastAutomationRun", label: "Last automation run", owner: "openrpa", authoritative: true, direction: "pull", computed: true, automation: true, priority: OWNERSHIP_PRIORITIES.openrpa },
  ],
  customer: [
    { key: "automationStatus", label: "Automation status", owner: "openrpa", authoritative: true, direction: "push", automation: true, priority: OWNERSHIP_PRIORITIES.openrpa },
    { key: "automationWorkflow", label: "Automation workflow", owner: "openrpa", authoritative: true, direction: "bidirectional", automation: true, priority: OWNERSHIP_PRIORITIES.openrpa },
    { key: "lastAutomationRun", label: "Last automation run", owner: "openrpa", authoritative: true, direction: "pull", computed: true, automation: true, priority: OWNERSHIP_PRIORITIES.openrpa },
  ],
  device: [
    { key: "automationStatus", label: "Automation status", owner: "openrpa", authoritative: true, direction: "push", automation: true, priority: OWNERSHIP_PRIORITIES.openrpa },
    { key: "automationWorkflow", label: "Automation workflow", owner: "openrpa", authoritative: true, direction: "bidirectional", automation: true, priority: OWNERSHIP_PRIORITIES.openrpa },
    { key: "automationRunbook", label: "Automation runbook", owner: "openrpa", authoritative: false, direction: "none", automation: true, priority: OWNERSHIP_PRIORITIES.openrpa },
    { key: "lastAutomationRun", label: "Last automation run", owner: "openrpa", authoritative: true, direction: "pull", computed: true, automation: true, priority: OWNERSHIP_PRIORITIES.openrpa },
  ],
  ticket: [
    { key: "automationStatus", label: "Automation status", owner: "openrpa", authoritative: true, direction: "push", automation: true, priority: OWNERSHIP_PRIORITIES.openrpa },
    { key: "automationWorkflow", label: "Automation workflow", owner: "openrpa", authoritative: true, direction: "bidirectional", automation: true, priority: OWNERSHIP_PRIORITIES.openrpa },
    { key: "automationQueue", label: "Automation queue", owner: "openrpa", authoritative: true, direction: "bidirectional", automation: true, priority: OWNERSHIP_PRIORITIES.openrpa },
    { key: "lastAutomationRun", label: "Last automation run", owner: "openrpa", authoritative: true, direction: "pull", computed: true, automation: true, priority: OWNERSHIP_PRIORITIES.openrpa },
  ],
  invoice: [
    { key: "automationStatus", label: "Automation status", owner: "openrpa", authoritative: true, direction: "push", automation: true, priority: OWNERSHIP_PRIORITIES.openrpa },
    { key: "automationWorkflow", label: "Automation workflow", owner: "openrpa", authoritative: true, direction: "bidirectional", automation: true, priority: OWNERSHIP_PRIORITIES.openrpa },
    { key: "lastAutomationRun", label: "Last automation run", owner: "openrpa", authoritative: true, direction: "pull", computed: true, automation: true, priority: OWNERSHIP_PRIORITIES.openrpa },
  ],
};

export const OPENRPA_OWNED_TYPES = Object.keys(OPENRPA_FIELD_MODEL);

export const OPENRPA_REMOTE_FIELDS = {
  automationStatus: {
    label: "Automation status",
    read: (doc) => (doc && doc.values ? doc.values.state : null),
    write: (value) => ({ state: value }),
    note: "The work item's lifecycle state.",
  },
  automationWorkflow: {
    label: "Automation workflow",
    read: (doc) => (doc && doc.payloadValue ? doc.payloadValue("workflowId") : null),
    write: (value) => ({ payload: { workflowId: value } }),
    note: "The workflow id bound to the work item's payload.",
  },
  automationQueue: {
    label: "Automation queue",
    read: (doc) => (doc && doc.values ? doc.values.wiqid || doc.values.wiq || null : null),
    write: (value) => ({ wiqid: value }),
    note: "The queue id the work item is bound to.",
  },
  lastAutomationRun: {
    label: "Last automation run",
    read: (doc) => (doc && doc.values ? doc.values.lastrun || null : null),
    write: () => ({}),
    note: "The work item's last-run timestamp.",
  },
};

export function priorityOf(connectorId) {
  const value = OWNERSHIP_PRIORITIES[connectorId];
  return typeof value === "number" ? value : 0;
}

export function isAutomationField(field) {
  return !!(field && field.automation);
}

export function automationFieldsFor(typeId, registry = null) {
  if (registry) return registry.fieldsFor(typeId).filter((field) => field.owner === "openrpa" || field.automation);
  return (OPENRPA_FIELD_MODEL[typeId] || []).map((field) => ({ ...field }));
}

export function ownershipTable({ registry, connectors = null } = {}) {
  if (!registry) return [];
  const connectorList = connectors || registry.connectors;
  const nameOf = (id) => {
    const found = connectorList.find((entry) => entry.id === id);
    return found ? found.name : id;
  };
  return registry.entityTypes.map((type) => ({
    typeId: type.id,
    label: type.plural || type.label,
    fields: registry.fieldsFor(type.id).map((field) => ({
      key: field.key,
      label: field.label,
      owner: field.owner,
      ownerName: nameOf(field.owner),
      direction: field.direction,
      computed: !!field.computed,
      sensitive: !!field.sensitive,
      automation: !!field.automation,
      priority: priorityOf(field.owner),
    })),
  }));
}

export function registerOwnership({ registry, connectors = null, fieldModel = OPENRPA_FIELD_MODEL } = {}) {
  const issues = [];
  const add = (level, code, message, ref) => issues.push({ level, code, message, ref });
  const connectorList = connectors || (registry ? registry.connectors : []);
  const openrpa = connectorList.find((entry) => entry.id === "openrpa") || null;
  const seenPriorities = new Map();
  for (const [id, priority] of Object.entries(OWNERSHIP_PRIORITIES)) {
    if (seenPriorities.has(priority)) {
      add("error", "duplicate-priority", `Connector "${id}" shares priority ${priority} with "${seenPriorities.get(priority)}".`, id);
    }
    seenPriorities.set(priority, id);
  }

  const fields = [];
  for (const [typeId, list] of Object.entries(fieldModel)) {
    for (const field of list) {
      const ref = `${typeId}.${field.key}`;
      fields.push({ entityType: typeId, ...field });
      if (field.owner !== "openrpa") {
        add("error", "foreign-owner", `OpenRPA ownership declares "${ref}" but its owner is "${field.owner}".`, ref);
      }
      if (registry) {
        const declared = registry.field(typeId, field.key);
        if (!declared) add("error", "missing-field", `Registry is missing the OpenRPA field "${ref}".`, ref);
        else if (declared.owner !== field.owner) add("error", "owner-mismatch", `Registry says "${ref}" is owned by "${declared.owner}".`, ref);
      }
      if (!openrpa) {
        add("error", "missing-connector", "The OpenRPA connector is not registered.", "openrpa");
      } else if (!(openrpa.entityTypes || []).includes(typeId)) {
        add("warn", "undeclared-type", `OpenRPA owns "${ref}" but does not declare the ${typeId} entity type.`, ref);
      }
      if (priorityOf(field.owner) <= 0) add("error", "missing-priority", `"${ref}" has no conflict priority.`, ref);
      if (field.computed && field.direction !== "pull") add("warn", "computed-direction", `Computed field "${ref}" should use the pull direction.`, ref);
    }
  }

  const counts = { error: 0, warn: 0, info: 0 };
  for (const issue of issues) counts[issue.level] = (counts[issue.level] || 0) + 1;
  return { ok: counts.error === 0, version: OPENRPA_OWNERSHIP_VERSION, fields, priorities: { ...OWNERSHIP_PRIORITIES }, issues, counts };
}
