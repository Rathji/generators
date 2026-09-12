export const EXPORT_FORMATS = ["json", "csv"];
export const CSV_TABLES = ["entities", "links"];

export function csvCell(value) {
  if (value == null) return "";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function csvRow(cells) {
  return cells.map(csvCell).join(",");
}

export function entityColumns(bundle) {
  const keys = new Set();
  for (const entity of bundle.entities || []) {
    for (const key of Object.keys(entity.fields || {})) keys.add(key);
  }
  return ["type", "id", "name", ...Array.from(keys).sort()];
}

export function linkColumns() {
  return ["type", "fromType", "fromId", "fromName", "toType", "toId", "toName", "field", "origin", "confidence"];
}

export function entitiesToCsv(bundle) {
  const columns = entityColumns(bundle);
  const lines = [csvRow(columns)];
  for (const entity of bundle.entities || []) {
    lines.push(csvRow(columns.map((column) => {
      if (column === "type") return entity.typeId;
      if (column === "id") return entity.id;
      if (column === "name") return entity.name;
      return entity.fields?.[column];
    })));
  }
  return lines.join("\n");
}

export function linksToCsv(bundle) {
  const columns = linkColumns();
  const lines = [csvRow(columns)];
  for (const link of bundle.links || []) {
    lines.push(csvRow(columns.map((column) => link[column])));
  }
  return lines.join("\n");
}

export function toJson(bundle) {
  return JSON.stringify(bundle, null, 2);
}

export function toCsv(bundle, { table = "entities" } = {}) {
  const which = CSV_TABLES.includes(table) ? table : CSV_TABLES[0];
  if (which === "links") return linksToCsv(bundle);
  return entitiesToCsv(bundle);
}

export function serialize(bundle, format = "json", options = {}) {
  const requested = String(format || "json").toLowerCase();
  const normalized = EXPORT_FORMATS.includes(requested) ? requested : EXPORT_FORMATS[0];
  if (normalized === "csv") return toCsv(bundle, options);
  return toJson(bundle);
}

export function extensionFor(format) {
  return String(format || "json").toLowerCase() === "csv" ? "csv" : "json";
}

export function filenameFor(bundle, format = "json", { table = "entities" } = {}) {
  const slug = String(bundle?.name || bundle?.id || "bundle")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "bundle";
  const ext = extensionFor(format);
  const suffix = ext === "csv" ? `-${table}` : "";
  return `${slug}-${bundle?.id || "bundle"}${suffix}.${ext}`;
}

export function preview(bundle, { format = "json", table = "entities", maxLines = 60 } = {}) {
  const text = serialize(bundle, format, { table });
  const lines = text.split("\n");
  const truncated = lines.length > maxLines;
  return {
    format: String(format).toLowerCase() === "csv" ? "csv" : "json",
    table,
    text: truncated ? `${lines.slice(0, maxLines).join("\n")}\n… ${lines.length - maxLines} more line${lines.length - maxLines === 1 ? "" : "s"}` : text,
    lines: lines.length,
    truncated,
    bytes: text.length,
  };
}

export function summary(bundle) {
  return {
    id: bundle.id,
    name: bundle.name,
    target: bundle.target,
    scope: bundle.scope,
    createdAt: bundle.createdAt,
    records: bundle.counts?.entities ?? (bundle.entities || []).length,
    links: bundle.counts?.links ?? (bundle.links || []).length,
    redactions: bundle.counts?.redactions ?? 0,
    format: bundle.format || "json",
  };
}
