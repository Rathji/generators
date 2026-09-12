export const LINK_TYPES = [
  {
    id: "device.company",
    fromType: "device",
    field: "company",
    toType: "company",
    label: "Managed company",
    inverseLabel: "Devices",
    cardinality: "one",
    required: true,
    description: "The company whose fleet the device belongs to.",
  },
  {
    id: "device.assignedTo",
    fromType: "device",
    field: "assignedTo",
    toType: "customer",
    label: "Assigned user",
    inverseLabel: "Devices",
    cardinality: "one",
    required: false,
    description: "The person who uses the device day to day.",
  },
  {
    id: "ticket.company",
    fromType: "ticket",
    field: "company",
    toType: "company",
    label: "Raised for",
    inverseLabel: "Tickets",
    cardinality: "one",
    required: true,
    description: "The company the ticket was opened for.",
  },
  {
    id: "ticket.linkedDevice",
    fromType: "ticket",
    field: "linkedDevice",
    toType: "device",
    label: "About device",
    inverseLabel: "Tickets",
    cardinality: "one",
    required: false,
    description: "The managed device the work concerns.",
  },
  {
    id: "invoice.company",
    fromType: "invoice",
    field: "company",
    toType: "company",
    label: "Billed to",
    inverseLabel: "Invoices",
    cardinality: "one",
    required: true,
    description: "The company responsible for the invoice.",
  },
  {
    id: "customer.company",
    fromType: "customer",
    field: "company",
    toType: "company",
    label: "Works at",
    inverseLabel: "People",
    cardinality: "one",
    required: false,
    description: "The company the person belongs to.",
  },
];

export const LINK_TYPE_MAP = new Map(LINK_TYPES.map((entry) => [entry.id, entry]));

export const LINK_STATUSES = ["linked", "manual", "ambiguous", "dangling", "empty", "missing", "orphan"];

export const RESOLVED_STATUSES = ["linked", "manual"];

export function linkType(id) {
  return LINK_TYPE_MAP.get(id) || null;
}

export function linkTypesFor(typeId) {
  return LINK_TYPES.filter((entry) => entry.fromType === typeId);
}

export function linkTypesTo(typeId) {
  return LINK_TYPES.filter((entry) => entry.toType === typeId);
}

export function linkTypeForField(typeId, field) {
  return LINK_TYPES.find((entry) => entry.fromType === typeId && entry.field === field) || null;
}

export function isResolved(status) {
  return RESOLVED_STATUSES.includes(status);
}
