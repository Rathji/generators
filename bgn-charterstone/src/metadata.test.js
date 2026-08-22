// src/metadata.test.js — Task 80 publish metadata & discovery polish validation.
// Run in-page via ?test=metadata, or via window.__loadMetadataTests().
// Task 80: $meta title/description/tags/hero image are set; the listing page
// and share cards render the branded hero and copy. The platform listing page
// isn't reachable from inside the iframe, so this suite validates the facts
// that feed it: the $meta mirror (DISCOVERY), a live branded hero image, the
// landing page's rendered hero + copy, and a fully ticked roadmap.

import { META_VERSION, DISCOVERY } from "./metadata.js";

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(img);
    img.src = src;
  });
}

export async function runMetadataTests() {
  const results = [];
  const ok = (name, cond, detail = "") => results.push({ name, pass: !!cond, detail });

  // ── discovery mirror ──
  ok("metadata exposes version + discovery facts",
    META_VERSION === 1 && !!DISCOVERY && typeof DISCOVERY.title === "string");

  ok("title is present and concise", DISCOVERY.title.trim().length > 3 && DISCOVERY.title.length <= 100,
    DISCOVERY.title.length + " chars");
  ok("title carries the brand", DISCOVERY.title.startsWith(root.gameTitle || "Charterstone"));

  ok("description is present and sized for a listing card",
    DISCOVERY.description.trim().length >= 40 && DISCOVERY.description.length <= 320,
    DISCOVERY.description.length + " chars");
  ok("description names the campaign", /12-game|twelve games/i.test(DISCOVERY.description));

  ok("tags are a non-empty array of lowercase words",
    Array.isArray(DISCOVERY.tags) && DISCOVERY.tags.length >= 5 &&
    DISCOVERY.tags.every(t => /^[a-z0-9][a-z0-9 -]*$/.test(t)),
    DISCOVERY.tags.length + " tags");

  ok("hero image is a hosted https URL",
    /^https:\/\/user\.uploads\.dev\/file\/.+\.jpg$/.test(DISCOVERY.image));

  const img = await loadImage(DISCOVERY.image);
  ok("hero image resolves to a real image", img.complete && img.naturalWidth > 0,
    img.naturalWidth + "px wide");

  // ── the landing page renders the branded hero ──
  const heroImg = document.getElementById("heroBgImg");
  ok("the landing hero uses the branded image", !!heroImg && heroImg.src === DISCOVERY.image);
  ok("the branded hero actually loaded", !!heroImg && heroImg.complete && heroImg.naturalWidth > 0,
    heroImg ? heroImg.naturalWidth + "px wide" : "missing");
  ok("the branded hero matches the game's own heroImage", !!heroImg && heroImg.src === root.heroImage);

  const titleEl = document.querySelector(".hero-title");
  ok("hero title renders the game title",
    !!titleEl && titleEl.textContent.trim() === root.gameTitle,
    titleEl ? titleEl.textContent.trim() : "missing");
  ok("hero kicker renders", (document.querySelector(".hero-kicker")?.textContent || "").trim().length > 0);
  ok("hero kicker matches the brand", (document.querySelector(".hero-kicker")?.textContent || "").trim() === root.gameKicker);
  ok("hero tagline renders", (document.querySelector(".hero-tagline")?.textContent || "").trim().length > 0);
  ok("hero tagline matches the brand", (document.querySelector(".hero-tagline")?.textContent || "").trim() === root.gameTagline);

  const tags = [...document.querySelectorAll(".hero-meta .tag")].map(t => t.textContent.trim());
  ok("genre tag renders", tags.some(t => t === root.gameGenre));
  ok("players tag renders the player range", tags.some(t => t === root.gamePlayers && /1–6/.test(t)));

  // ── the landing copy ──
  const facts = [...document.querySelectorAll(".fact")].map(f => f.textContent.trim());
  ok("all four founding facts render non-empty", facts.length === 4 && facts.every(f => f.length > 10), facts.length + " facts");

  const cards = [...document.querySelectorAll(".cards .card")];
  ok("the three campaign cards render with headings",
    cards.length === 3 && cards.every(c => (c.querySelector("h3")?.textContent || "").trim().length > 0),
    cards.length + " cards");

  const footer = document.querySelector("footer p")?.textContent || "";
  ok("the footer carries the fan-made credit", /fan-made/i.test(footer));

  const status = document.querySelector(".statusbar")?.textContent || "";
  ok("the statusbar reports a complete build", status.includes("80 of 80") && /complete/i.test(status));

  ok("$meta header mode is minimal", !!root.$meta && root.$meta.header.mode === "minimal");

  // ── the roadmap is fully ticked ──
  let roadmapText = "";
  try {
    roadmapText = await (await fetch("src/roadmap.pjs")).text();
  } catch (e) { roadmapText = ""; }
  const taskLines = roadmapText.split("\n").filter(l => /^\d+\. \*\*\[( |x)\]/.test(l));
  const doneLines = taskLines.filter(l => /^\d+\. \*\*\[x\]/.test(l));
  ok("roadmap has exactly 80 tasks", taskLines.length === 80, taskLines.length + " found");
  ok("all 80 tasks are ticked done", doneLines.length === 80, doneLines.length + "/" + taskLines.length);

  return { suite: "metadata", version: META_VERSION, pass: results.filter(r => r.pass).length, fail: results.length - results.filter(r => r.pass).length, results };
}
