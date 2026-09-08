# BattleTech Mercenary Manager — project notes

A fan-made "manager" game (Perchance generator): the player runs the business &
personnel side of a BattleTech mercenary company; combat is AI-simulated and
narrated via generated reports and images. **All 21 roadmap tasks (7 phases)
are implemented and verified** — full spec: `src/ROADMAP.md`.

## Gameplay loop

Dashboard → Mission board (contracts) → Brief & deploy a lance (≤4 mechs) →
AI battle simulation → After-action report (narrated + scene image) →
Salvage/repairs/payroll → Advance the week (events, market refresh, injuries
heal) → repeat. Watch morale, funds, reputation with factions, and the
emergency loan (8%/week; creditors seize you below −120k).

Systems: personnel generation/hiring/firing/assigning with traits & AI
portraits; mechbay (repair/rush/cancel/refit/strip/install/sell); market
(mechs + weapon parts, refreshes every 2 weeks); 8 mission types incl.
assassination (kill the commander), defense/garrison (reinforcement waves),
recon & objective raids; LosTech/Star League cache events; faction reputation
matrix; 5 eras (Succession Wars 3025 → Dark Age 3150) gating mechs, weapons,
factions; kv-plugin + localStorage autosaves; difficulty (recruit/regular/
veteran/elite) scaling threat, enemy gunnery, pay.

## Architecture

Script load order (index.html): `framework.js` → `data.js` → `core.js` →
`ai.js` → `ui.js` → `game.js`. Boot lives in `game.js` (`window.BMG`).

- `main.pjs` — `$meta`, plugin imports (`generateText`, `generateImage`,
  `kv`), `config` (branding/theme/colors), `features` (roadmap checklist —
  all `done = true`; flip back to false to track new work).
- `index.html` — static shell: header/HUD strip, nav, 9 screen sections,
  new-game modal; inline event styles; loads `src/*.js` in order.
- `src/base.css` — design system: tokens + layout + components.
- `src/framework.js` — `window.BT`: config/theme loader, roadmap panel
  renderer, `$`/`esc`/`toast` helpers.
- `src/data.js` — `window.BTD`/`D` (exposed as `MGM.D`): ERAS[5], FACTIONS[16],
  WEAPONS[32]+WMAP, MECHS[47]+MECH_MAP, MISSION_TYPES[8], name pools, planets.
- `src/core.js` — `window.MGM`: BAL (battle constants), unit/person generation
  & power ratings, `newCompany`, `refreshMarket`/`refreshOffers` (threat scaling
  by company rating × difficulty), `battle` (round loop, both sides fire each
  round, pool-based routs, reinforcements, injuries), `applyBattle`,
  `advanceWeek`, loans, bankruptcy, events (COMPANY_EVENTS/CACHE_EVENTS),
  `sanitizeCompany` (guards saved state against NaN/corruption on load).
- `src/ai.js` — `window.BMGA`: `generateReport` (ai-text streaming with
  template fallback when the AI scribe is unavailable), `generateBattleImage`,
  `generatePortrait` (text-to-image, JPEG data URL, cached on the person) plus
  the portrait system: kv-backed cache preloaded at boot, a sequential
  generation queue (`queuePortrait`/`queuePortraitAll`) so bulk runs never
  hammer the API, per-person re-roll (`force`), and cleanup on firing,
  `templateReport`.
- `src/ui.js` — `window.BMUI`: `renderAll` + one renderer per screen
  (dashboard/contracts/personnel/mechbay/market/salvage/reports/company/
  roadmap) and modals (deploy, refit, dossier, event, battle report, bankrupt).
- `src/game.js` — `window.BMG`: nav/router (`data-bm` delegated clicks), all
  actions, deploy → `runContract` → report flow (events queue after the report
  closes), new-game/bankruptcy/wipe, save/load (kv then localStorage),
  `saveSoon` autosave. Company schema is versioned (`patchLoaded`, schema 4).
- `src/ROADMAP.md` — the atomic roadmap (spec + task list).

## Conventions

- Bare helper names only work in inline classic scripts. From `src/*.js` use
  the module namespaces: `window.BT` / `MGM` / `BMGA` / `BMUI` / `BMG`
  (aliased inside each module as `BT`, `M`, `AI`, `UI`, and `BMG` itself).
- IDs carry type suffixes (`Btn`, `El`, `Ctn`, `Input`, `Card`, `Row`).
- Money is C-bills; `UI.fmtC(n)` / `BT.fmtMoney(n)` for display.
- `hidden` attribute always wins over inline styles — use it for show/hide.
- Theme: `config.theme.mode` = `dark`|`light` (default dark, battle-amber /
  olive-drab palette); `background`/`surface`/`text`/`textMuted` tune the dark theme.

## Balance notes (locked after sim sweeps)
`BAL` in `src/core.js` = {enemyHpK:1.65, ourDmgK:1.5, enDmgK:1.25,
minRounds:10, maxRounds:18}. Offer threat = clamp(threatMult · rnd(0.8,1.22)
· tonF · rnd(0.85,1.15), 0.3, 3) where threatMult: recruit 0.62 / regular 0.9
/ veteran 1.18 / elite 1.5, tonF = 0.75 + avgTon/160. Verified outcomes
(fresh company, era 0): regular ≈ 60% vic / 10% partial / 30% defeat with
monotone difficulty gradient up to elite ≈ 41/8/51. Defense/garrison stays
near coin-flip by design. Sim harness pattern: page_eval → `MGM.newCompany`
then `MGM.battle(c, c.offers[0], units)`; count outcome/ourDeadCount/rounds.

## Post-launch polish pass (Sep 2026)

- Deploy modal: the "Estimated enemy" figure and pre-flight risk now scale from
  the **selected lance's** power × enemy multiplier (matching the sim), instead
  of the whole company rating — the risk readout is honest about what you
  actually bring.
- `MGM.unitSellValue(unit)` centralizes mech sell pricing; the sell confirm
  dialog shows the real value instead of a fixed 45% guess.
- `MGM.repairWeeksLeft(company, unit)` reports the "in the bays — N wk" estimate
  using the same tech-accelerated weekly progress as `advanceWeek` (previously
  it ignored the tech speed-up and overstated repair time).
- Battle results now feed back into **individual** morale: injured pilots drop
  12, victory survivors +3 / defeat −3 / partial +1 (company morale was already
  handled by the sim).
- After-action narrative summaries include pilot injury lines.
- `sanitizeCompany` hardened: tolerates missing/partial `armor`, `structure`,
  `weapons` arrays and missing per-person `morale` on older saves without
  throwing during load.

