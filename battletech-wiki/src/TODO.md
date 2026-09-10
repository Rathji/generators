# BattleTech Wiki — planned / considered work

Companion to `README.md`. Items are roughly ordered by value. None are started unless marked.

## Done in the "HUD polish pass"
- [x] Animated header status bar — blinking green "HPG Link" dot + live local clock (Share Tech Mono).
- [x] "⟳ Random" button in the header toolbar (jumps to a random non-namespace page).
- [x] Amber grid baked into the wiki panel (subtle, 5% amber lines on a 40px lattice) so the HUD reads as one grid surface instead of a solid box floating on a grid.
- [x] BattleTech infobox support + stat-block styling: registered `Infobox mech`, `Infobox faction`, `Infobox character` templates (in addition to the plugin's `Infobox person`), styled as amber-titled HUD panels.

## Planned — UX / function
- [ ] **Recent-changes affordance.** The plugin supports `Special:RecentChanges` (reachable via the Tools list / search), but there's no obvious header link. Add a small "Recent" button next to "⟳ Random".
- [ ] **Mobile table overflow.** Wide `.wiki-table`s currently squeeze on phones. Wrap tables in a horizontal-scroll container under 640px (`.wiki-content-body .wiki-table { display:block; overflow-x:auto; }` or a JS wrapper).
- [ ] **Category filtering.** Confirm whether the in-content `.wiki-cat` chips filter (the plugin's delegated `data-act="cat"` sets the search query — verify the content chips carry it). If not, wire them to filter the page list / run a category search.
- [ ] **Faction color-coded chips.** The wiki has 37 `#category` chips; give Great Houses / Clans / Periphery each an accent hue so the sidebar and content chips are visually grouped.

## Planned — content depth
- [ ] **Portal-style Home.** Replace/augment the plain Home article with a "main page" of topic tiles (Eras, Great Houses, Clans, 'Mechs, Organizations, Game System) linking to the key pages.
- [ ] **Headline pages.** Only ~119 seed pages exist. Add the obvious missing anchors: individual Great Houses (Federated Suns, Lyran Commonwealth, Draconis Combine, Capellan Confederation, Free Worlds League), major Clans, the Succession Wars, the Clan Invasion, notable characters (Hanse Daviout, etc.), and a handful of iconic 'Mechs.
- [ ] **Add infoboxes to key pages.** The `Infobox mech` / `Infobox faction` / `Infobox character` templates now exist — use them on the 'Mech, faction, and character pages.

> Note on seed content: `window.BATTLE_WIKI_PAGES` in `index.html` is only written on a first-ever load (when the shared wiki file is empty). Editing the seed does **not** change already-stored pages — the shared file wins. To push a content change to the live wiki, edit the page in-app (or clear the channel to force a re-seed).

## Considered — nice-to-have
- [ ] Per-faction accent theming on faction pages (subtle header tint).
- [ ] A subtle "stardate"/era indicator in the header HUD (e.g. current BattleTech year) alongside the clock.
- [ ] Client-side search-result highlighting / snippets polish.
- [ ] Keyboard shortcut for random page (e.g. press `R` when not typing).
