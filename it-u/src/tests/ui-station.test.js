// src/tests/ui-station.test.js — DOM tests for the station scaffold
// (src/modules/station.js), the shared shell every not-yet-built station renders.
// Run in the live page:
//   await import("./src/tests/ui-station.test.js").then((m) => m.run())

import { runTests, assert, assertEq } from "./harness.js";
import { createStation } from "../modules/station.js";

export async function run() {
  return runTests([
    {
      name: "createStation exposes the station descriptor",
      fn: async () => {
        const st = createStation({ id: "assets", label: "Assets", desc: "The estate", icon: "<svg/>" });
        assertEq(st.id, "assets");
        assertEq(st.label, "Assets");
        assertEq(st.desc, "The estate");
        assertEq(st.icon, "<svg/>");
        assertEq(typeof st.render, "function");
      },
    },
    {
      name: "render mounts a view panel with the station title and description",
      fn: async () => {
        const st = createStation({ id: "assets", label: "Assets", desc: "The estate", icon: "" });
        const container = document.createElement("div");
        st.render({ container });
        const view = container.querySelector(".kb-view");
        assert(view, "a kb-view was mounted");
        assertEq(view.querySelector(".kb-view-title").textContent, "Assets");
        assertEq(view.querySelector(".kb-view-desc").textContent, "The estate");
        assertEq(view.querySelector(".kb-breadcrumb").textContent, "IT-U");
      },
    },
    {
      name: "render lists the planned capabilities when given",
      fn: async () => {
        const st = createStation({
          id: "assets",
          label: "Assets",
          desc: "",
          icon: "",
          capabilities: ["Inventories", "Warranties", "Renewals"],
        });
        const container = document.createElement("div");
        st.render({ container });
        const panel = container.querySelector(".kb-station-capabilities");
        assert(panel, "capabilities panel present");
        assertEq(panel.getAttribute("aria-label"), "Planned capabilities");
        assertEq(panel.querySelectorAll(".kb-station-cap-item").length, 3);
        assertEq(container.querySelectorAll(".kb-state").length, 1, "the empty state is still shown");
      },
    },
    {
      name: "render falls back to a default empty state without a custom title",
      fn: async () => {
        const st = createStation({ id: "assets", label: "Assets", desc: "", icon: "" });
        const container = document.createElement("div");
        st.render({ container });
        assertEq(container.querySelector(".kb-station-capabilities"), null, "no capabilities panel");
        assertEq(container.querySelector(".kb-state-title").textContent, "No assets yet");
      },
    },
    {
      name: "render honours a custom empty title and description",
      fn: async () => {
        const st = createStation({
          id: "assets",
          label: "Assets",
          desc: "",
          icon: "",
          emptyTitle: "Nothing catalogued",
          emptyDesc: "Add the first asset to begin.",
        });
        const container = document.createElement("div");
        st.render({ container });
        assertEq(container.querySelector(".kb-state-title").textContent, "Nothing catalogued");
        assertEq(container.querySelector(".kb-state-desc").textContent, "Add the first asset to begin.");
      },
    },
  ]);
}
