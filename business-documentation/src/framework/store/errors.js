// src/framework/store/errors.js — typed errors for the document store.
// Every failure the store can raise carries a stable `code` so callers can
// react programmatically (and later show plain-language recovery copy).

export class StoreError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.name = "StoreError";
    this.code = code;
    Object.assign(this, extra);
  }
}

export const CODES = {
  STORAGE_UNAVAILABLE: "STORAGE_UNAVAILABLE",
  EDIT_KEY_REQUIRED: "EDIT_KEY_REQUIRED",
  CHUNK_WRITE_FAILED: "CHUNK_WRITE_FAILED",
  REGISTRY_WRITE_FAILED: "REGISTRY_WRITE_FAILED",
  CONCURRENT_WRITE: "CONCURRENT_WRITE",
  MISSING_CHUNK: "MISSING_CHUNK",
  INTEGRITY: "INTEGRITY",
  INVALID_DATA: "INVALID_DATA",
};
