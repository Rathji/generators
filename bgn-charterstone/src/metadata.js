// src/metadata.js — Task 80 publish metadata & discovery polish.
// Mirrors the $meta block in main.pjs (title/description/tags/image) — the
// platform reads THAT for the generator listing page and social share cards,
// while this module makes the same facts verifiable at runtime. Keep the two
// in sync; the metadata test suite is the guard.

export const META_VERSION = 1;

export const DISCOVERY = {
  title: "Charterstone — Build Your Legacy",
  description:
    "A faithful Perchance recreation of Charterstone, the 12-game legacy board game. Found a village, place workers, construct buildings, unlock crates and stickers as twelve games permanently reshape the board. 1–6 players at the table, online with friends, or solo vs the Automa.",
  tags: [
    "board game",
    "legacy",
    "worker placement",
    "campaign",
    "multiplayer",
    "online",
    "solo",
    "automa",
    "building",
    "stonemaier",
  ],
  image: "https://user.uploads.dev/file/95b42b398dedb399141e07015172aea4.jpg",
};
