// ============================================================================
//  Project U — identity validation suite (Phase 1, task 1)
//  Guards the generator name/slug and the `pu` identity config block that the
//  shell reads on boot.
// ============================================================================

import { createSuite, assert, assertEqual } from "./harness.js";

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function readNode(node) {
  if (node == null) return undefined;
  try {
    const raw = typeof node === "object" && typeof node.evaluateItem === "string" ? node.evaluateItem : node;
    const text = String(raw).trim();
    return text || undefined;
  } catch (_) {
    return undefined;
  }
}

function config() {
  return globalThis.root && globalThis.root.pu ? globalThis.root.pu : null;
}

export function identitySuite() {
  return createSuite("identity · Project-U setup")
    .test("generator name is a kebab-case slug", () => {
      assert(typeof window.generatorName === "string" && window.generatorName.length > 0, "window.generatorName is empty");
      assert(KEBAB.test(window.generatorName), `"${window.generatorName}" is not kebab-case`);
    })
    .test("config block exposes the Project-U identity", () => {
      const pu = config();
      assert(pu, "root.pu config block is missing from main.pjs");
      assertEqual(readNode(pu.appTitle), "Project-U");
      assertEqual(readNode(pu.logoMark), "PU");
      assert(readNode(pu.tagline), "pu.tagline is missing");
      assertEqual(readNode(pu.companyName), "Project U");
    })
    .test("slug is set and kebab-case", () => {
      const slug = readNode(config().slug);
      assert(slug, "pu.slug is missing");
      assert(KEBAB.test(slug), `slug "${slug}" is not kebab-case`);
    })
    .test("storage namespace is set and namespaced", () => {
      const ns = readNode(config().storageNamespace);
      assert(ns, "pu.storageNamespace is missing");
      assert(KEBAB.test(ns), `storage namespace "${ns}" is not kebab-case`);
    })
    .test("version is a semver string", () => {
      const version = readNode(config().version);
      assert(/^\d+\.\d+\.\d+$/.test(version || ""), `version "${version}" should look like 1.2.3`);
    });
}
