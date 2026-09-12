// src/tests/testFixtures.js — shared fixtures & helpers for the test suites.
//
// The suites all build the same in-memory world: a document store over a memory
// channel + memory cache, wrapped by the doc-set service, sometimes with extra
// services (access, flexible asset types, templates, archive, sync). This module
// owns that construction so a suite only names its namespace and the services it
// needs.
//
//   import { makeWorld, assertThrowsCode } from "./testFixtures.js";
//   const { docs } = makeWorld({ namespace: "kb-xyz" });
//
// `makeWorld` also accepts a bare namespace string (`makeWorld("kb-xyz")`) and
// returns the FULL world object; callers destructure only what they use.

import { createDocumentStore } from "../framework/store/index.js";
import { createMemoryChannel, createMemoryCache } from "../framework/store/backends.js";
import { createDocSetService } from "../framework/docsets.js";
import { createAccessService } from "../framework/access.js";
import { createFlexibleTypeService } from "../framework/flexibleTypes.js";
import { createTemplateService } from "../framework/templates.js";
import { createArchiveService, DEFAULT_STORAGE_CEILING } from "../framework/archive.js";
import { createSyncEngine } from "../framework/store/sync.js";
import { assert, assertEq } from "./harness.js";

/** A fresh pair of memory-backed store backends (no cross-test bleed). */
export function makeBackends() {
  return { channel: createMemoryChannel(), cache: createMemoryCache() };
}

/**
 * Build an isolated test world.
 *
 * @param {string|object} [opts] namespace string, or an options object:
 *   namespace      — store namespace prefix (default "kb-test")
 *   ceiling        — store chunk ceiling in bytes (default: the store's own)
 *   getRole        — when given, compose an access service with this getRole
 *                    and wire it into the doc-set service (`world.access`)
 *   assetTypes     — also compose a flexible-type service (`world.assetTypes`)
 *   templates      — also compose a template service (`world.templates`)
 *   archive        — also compose an archive service (`world.archive`)
 *   archiveCeiling — override the archive ceiling (used with `archive`)
 *   sync           — also compose a sync engine (`world.sync`)
 * @returns {{channel, cache, store, docs, access?, assetTypes?, templates?, archive?, sync?}}
 */
export function makeWorld(opts = {}) {
  const o = typeof opts === "string" ? { namespace: opts } : opts || {};
  const {
    namespace = "kb-test",
    ceiling,
    getRole = null,
    assetTypes = false,
    templates = false,
    archive = false,
    archiveCeiling,
    sync = false,
  } = o;

  const { channel, cache } = makeBackends();
  const store = createDocumentStore(ceiling == null ? { namespace, channel, cache } : { namespace, channel, cache, ceiling });
  const access = getRole ? createAccessService({ store, cache, getRole }) : null;
  const docs = createDocSetService(access ? { store, cache, access } : { store, cache });

  const world = { channel, cache, store, docs };
  if (access) world.access = access;
  if (assetTypes) world.assetTypes = createFlexibleTypeService({ store, cache });
  if (templates) world.templates = createTemplateService({ store, docs });
  if (archive) world.archive = createArchiveService({ store, docs, ceiling: archiveCeiling == null ? DEFAULT_STORAGE_CEILING : archiveCeiling });
  if (sync) world.sync = createSyncEngine({ store, cache });
  return world;
}

/** Build a world whose access service is already loaded (returns `world.access`). */
export async function makeAccessWorld(namespace = "kb-access", getRole) {
  const world = makeWorld({ namespace, getRole });
  await world.access.load();
  return world;
}

/**
 * Assert that `fn` rejects with an error carrying `code`. Returns the error so a
 * caller can make further assertions about it.
 */
export async function assertThrowsCode(fn, code, label) {
  const tag = label || "expected a throw";
  let threw = null;
  try {
    await fn();
  } catch (e) {
    threw = e;
  }
  assert(threw, tag + " — expected a throw");
  assertEq(threw.code, code, tag + " — wrong error code");
  return threw;
}
