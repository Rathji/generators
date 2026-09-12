// ============================================================================
//  Project U — skeleton placeholders (Phase 6, task 27)
//  Reusable shimmer blocks shown while a region waits on its data: the
//  launcher grid while the member directory loads, the quick-stats row and the
//  activity feed while the activity source fetches. Purely decorative — each
//  wrapper carries role="status" so assistive tech announces the wait once and
//  every block is aria-hidden.
// ============================================================================

import { h } from "../framework/dom.js";
import { cx } from "../framework/utils.js";

export function skeletonBlock({ width = "100%", height = null, radius = null, className = "" } = {}) {
  const el = h("span", { class: cx("pu-skel-block", className), "aria-hidden": "true" });
  el.style.width = typeof width === "number" ? `${width}px` : width;
  if (height != null) el.style.height = typeof height === "number" ? `${height}px` : height;
  if (radius != null) el.style.borderRadius = typeof radius === "number" ? `${radius}px` : radius;
  return el;
}

// Wraps a group of shimmer blocks in a single polite status region. `delay`
// staggers each child's pulse so the placeholder reads as a wave, not a flash.
export function skeletonRegion(children, { label = "Loading…", className = "", stagger = 0 } = {}) {
  const region = h("div", { class: cx("pu-skel-region", className), role: "status", "aria-live": "polite", "aria-busy": "true" }, h("span", { class: "pu-sr-only" }, label), children);
  if (stagger) {
    const blocks = region.querySelectorAll(".pu-skel-block");
    blocks.forEach((block, index) => block.style.setProperty("--pu-skel-delay", `${(index % stagger) * 80}ms`));
  }
  return region;
}

// ------------------------------------------------------- activity feed rows --

export function skeletonFeedItem() {
  return h(
    "div",
    { class: "pu-skel pu-skel-feed-item", "aria-hidden": "true" },
    skeletonBlock({ className: "pu-skel-avatar", width: 30, height: 30, radius: 6 }),
    h(
      "div",
      { class: "pu-skel-lines" },
      skeletonBlock({ width: "34%", height: "0.6rem" }),
      skeletonBlock({ width: "76%", height: "0.72rem" }),
      skeletonBlock({ width: "52%", height: "0.6rem" })
    )
  );
}

export function skeletonFeed({ count = 5 } = {}) {
  return skeletonRegion(
    h("div", { class: "pu-skel-feed" }, Array.from({ length: count }, () => skeletonFeedItem())),
    { label: "Loading activity…", stagger: 4 }
  );
}

// ----------------------------------------------------------- launcher cards --

export function skeletonLaunchCard() {
  return h(
    "article",
    { class: "pu-skel pu-skel-launch", "aria-hidden": "true" },
    h(
      "div",
      { class: "pu-skel-launch-head" },
      skeletonBlock({ className: "pu-skel-launch-icon", width: 42, height: 42, radius: 10 }),
      h(
        "div",
        { class: "pu-skel-lines" },
        skeletonBlock({ width: "52%", height: "0.9rem" }),
        skeletonBlock({ width: "32%", height: "0.55rem" })
      )
    ),
    h(
      "div",
      { class: "pu-skel-lines" },
      skeletonBlock({ width: "94%", height: "0.62rem" }),
      skeletonBlock({ width: "68%", height: "0.62rem" })
    ),
    skeletonBlock({ width: 84, height: 30, radius: 10, className: "pu-skel-launch-btn" })
  );
}

export function skeletonLaunchGrid({ count = 6 } = {}) {
  return skeletonRegion(
    h("div", { class: "pu-launch-grid pu-skel-launch-grid" }, Array.from({ length: count }, () => skeletonLaunchCard())),
    { label: "Loading generators…", stagger: 6 }
  );
}

// ------------------------------------------------- stats row + source panel --

export function skeletonStatTiles({ count = 5 } = {}) {
  return skeletonRegion(
    h(
      "div",
      { class: "pu-stats-row pu-skel-stats" },
      Array.from({ length: count }, () =>
        h(
          "div",
          { class: "pu-skel pu-skel-stat", "aria-hidden": "true" },
          skeletonBlock({ width: "58%", height: "0.6rem" }),
          skeletonBlock({ width: "34%", height: "1.5rem" }),
          skeletonBlock({ width: "72%", height: "0.6rem" })
        )
      )
    ),
    { label: "Loading summary…", stagger: 5 }
  );
}

export function skeletonSourceRows({ count = 4 } = {}) {
  return skeletonRegion(
    h(
      "div",
      { class: "pu-source-list", "aria-hidden": "true" },
      Array.from({ length: count }, () =>
        h(
          "div",
          { class: "pu-source-row" },
          skeletonBlock({ width: 9, height: 9, radius: "50%" }),
          skeletonBlock({ width: 72, height: "0.7rem" }),
          skeletonBlock({ width: "100%", height: 6, radius: 99 }),
          skeletonBlock({ width: 18, height: "0.7rem" })
        )
      )
    ),
    { label: "Loading sources…", stagger: 4 }
  );
}
