import { suite, test, assert } from "./harness.js";
import { createHub } from "../core/hub.js";
import { DEFAULT_CONFIG } from "../framework/config.js";

const DOCS = ["README.md", "CUSTOMIZATION.md", "CLONING.md", "API.md"];

export async function loadDoc(name) {
  const candidates = [];
  try {
    candidates.push(new URL(`../${name}`, import.meta.url).href);
  } catch (error) {}
  candidates.push(`src/${name}`, name);
  let lastError = null;
  for (const url of candidates) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.text();
      lastError = new Error(`${url} responded with HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error(`Could not load ${name}`);
}

suite("Documentation", () => {
  test("every handoff document exists and is substantive", async () => {
    for (const name of DOCS) {
      const text = await loadDoc(name);
      assert(text.length > 400, `${name} should be substantive (got ${text.length} characters)`);
    }
  });

  test("the README covers purpose, architecture, conventions and links the guides", async () => {
    const readme = await loadDoc("README.md");
    for (const heading of ["## Purpose", "## Architecture", "## Conventions", "## Documentation"]) {
      assert(readme.includes(heading), `README should contain the "${heading}" heading`);
    }
    for (const name of DOCS.filter((entry) => entry !== "README.md")) {
      assert(readme.includes(`(./${name})`), `README should link to ${name}`);
    }
  });

  test("the customization guide documents every configuration key", async () => {
    const guide = await loadDoc("CUSTOMIZATION.md");
    const keys = Object.keys(DEFAULT_CONFIG).filter((key) => key !== "branding");
    for (const key of keys) {
      assert(guide.includes(key), `CUSTOMIZATION.md should document the "${key}" config key`);
    }
    for (const key of Object.keys(DEFAULT_CONFIG.branding)) {
      assert(guide.includes(key), `CUSTOMIZATION.md should document the "branding.${key}" config key`);
    }
  });

  test("the customization guide covers the catalog and storage naming", async () => {
    const guide = await loadDoc("CUSTOMIZATION.md");
    for (const token of ["CONNECTORS", "ENTITY_TYPES", "FIELD_MODEL", "TOOL_ROLE_MAPS", "storageNamespace", "registry.validate()"]) {
      assert(guide.includes(token), `CUSTOMIZATION.md should mention "${token}"`);
    }
  });

  test("the cloning guide walks through instantiation and hub wiring", async () => {
    const guide = await loadDoc("CLONING.md");
    for (const token of ["Part A", "Part B", "Part C", "storageNamespace", "registry.validate()", "publish", "subscribe"]) {
      assert(guide.includes(token), `CLONING.md should cover "${token}"`);
    }
  });

  test("the API reference documents every event bus member", async () => {
    const api = await loadDoc("API.md");
    const hub = createHub({ kv: null });
    for (const key of Object.keys(hub.bus)) {
      assert(api.includes(`hub.bus.${key}`), `API.md should document hub.bus.${key}`);
    }
  });

  test("the API reference documents every integration registry member", async () => {
    const api = await loadDoc("API.md");
    const hub = createHub({ kv: null });
    for (const key of Object.keys(hub.registry)) {
      assert(api.includes(`hub.registry.${key}`), `API.md should document hub.registry.${key}`);
    }
  });
});
