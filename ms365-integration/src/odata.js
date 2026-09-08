// src/odata.js
// Small shared helpers for building Microsoft Graph OData query syntax
// ($filter expressions, $select lists, date/time values).

// Escape a string literal for use inside an OData $filter expression.
// OData single-quotes string literals; an embedded quote is escaped by doubling it.
export function escapeODataStr(s) {
  return String(s).replace(/'/g, "''");
}

// Convert a Date / epoch-ms / ISO string into the "YYYY-MM-DDTHH:mm:ssZ" format
// that Graph accepts in filter literals (milliseconds dropped).
export function toODataDate(v) {
  if (v === undefined || v === null || v === "") return null;
  const d = v instanceof Date ? v : new Date(typeof v === "string" ? v : Number(v));
  if (isNaN(d.getTime())) throw new Error("ms365.odata: invalid date value " + v);
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

// Build a Graph "dateTimeTimeZone" object { dateTime, timeZone } from a Date /
// epoch-ms / ISO string, or pass through an existing { dateTime, timeZone }.
export function toGraphDateTime(v, timeZone) {
  if (v && typeof v === "object" && "dateTime" in v) {
    return { dateTime: v.dateTime, timeZone: timeZone || v.timeZone || "UTC" };
  }
  const iso = toODataDate(v);
  return { dateTime: iso, timeZone: timeZone || "UTC" };
}

// Normalize a filter value that may be a single item or an array (any-of).
export function anyOf(values) {
  const arr = Array.isArray(values) ? values : (values === undefined || values === null ? [] : [values]);
  return arr.filter((v) => v !== undefined && v !== null && v !== "");
}
