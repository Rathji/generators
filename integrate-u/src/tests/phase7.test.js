import { suite, test, assert } from "./harness.js";
import { createHub } from "../core/hub.js";
import { loadDoc } from "./docs.test.js";

const MANAGERS = [
  "registry",
  "permissions",
  "identity",
  "log",
  "bus",
  "subscriptions",
  "linker",
  "references",
  "search",
  "reconciler",
  "jobs",
  "conflicts",
  "alerts",
  "drift",
  "bundles",
  "audit",
  "monitor",
];

suite("Phase 7 integration", () => {
  test("the API reference covers the whole hub surface", async () => {
    const api = await loadDoc("API.md");
    const hub = createHub({ kv: null });
    for (const name of MANAGERS) {
      assert(hub[name], `hub.${name} should exist`);
      assert(api.includes(`hub.${name}`), `API.md should document the hub.${name} subsystem`);
    }
  });

  test("the README presents the project status and a documentation index", async () => {
    const readme = await loadDoc("README.md");
    assert(readme.includes("## Documentation"), "README should have a Documentation section");
    assert(readme.includes("Status:"), "README should carry a status line");
    assert(readme.includes("## Purpose"), "README should explain the project's purpose");
  });

  test("every documentation link in the README resolves", async () => {
    const readme = await loadDoc("README.md");
    const links = Array.from(readme.matchAll(/\]\(\.\/([A-Za-z0-9._-]+)\)/g)).map((match) => match[1]);
    assert(links.length >= 3, "README should link out to its companion guides");
    for (const link of links) {
      const text = await loadDoc(link);
      assert(text.length > 0, `${link} should be reachable`);
    }
  });
});
