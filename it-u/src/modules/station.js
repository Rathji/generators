// src/modules/station.js — the IT-U station scaffold.
//
// IT-U is organised as a set of *stations* (Organizations, Assets, Documents,
// Trackers, Services, Deployments, Search, Linter, Exports, Settings). Each
// station is a module registered with the router. Until a station's content
// model is built, it renders this shared scaffold: a consistent station header
// (title + description), a "Planned capabilities" panel describing what the
// station will hold, and the shared empty state.
//
// Later roadmap tasks replace a station's thin file with its real render()
// (or extend this factory); the nav, routing, responsive layout and
// empty/loading/error conventions stay the same.

import { h } from "../framework/dom.js";
import { emptyState } from "../framework/states.js";
import { viewPanel } from "./shared.js";

export function createStation({ id, label, desc, icon, capabilities = [], emptyTitle, emptyDesc }) {
  return {
    id,
    label,
    desc,
    icon,
    render(ctx) {
      const body = h(
        "div",
        { class: "kb-station" },
        capabilities.length
          ? h(
              "section",
              { class: "kb-station-capabilities", "aria-label": "Planned capabilities" },
              h("h2", { class: "kb-station-cap-h" }, "Planned capabilities"),
              h(
                "ul",
                { class: "kb-station-cap-list" },
                capabilities.map((c) => h("li", { class: "kb-station-cap-item" }, h("span", { class: "kb-station-tick", html: "" }), c)),
              ),
            )
          : null,
        emptyState({
          icon,
          title: emptyTitle || "No " + label.toLowerCase() + " yet",
          description: emptyDesc || "",
        }),
      );
      ctx.container.append(viewPanel({ crumb: "IT-U", title: label, desc, body }));
    },
  };
}
