# BattleTech Mercenary Manager — project notes

A fan-made "manager" game (Perchance generator): the player runs the business &
personnel side of a BattleTech mercenary company; combat is AI-simulated and
narrated via generated reports and images. **All 21 original roadmap tasks (7
phases) and all 31 Phase 8–14 expansion features (`f22`–`f52`) are implemented
and verified** — personnel development, expanded combat depth, economy and
logistics, the living map/eras/factions, the Phase 12 interface &
characterisation work (`f42`–`f46`), the Phase 13 meta layer (achievements,
scenario starts & New Game+, share card, multiple company slots, difficulty &
Ironman) and the Phase 14 `f52 Solaris Arena Mode` (a separate gladiator-stable
career with its own save). Full spec: `src/ROADMAP.md`.

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
`ai.js` → `sound.js` → `ui.js` → `game.js`. Boot lives in `game.js` (`window.BMG`).

- `main.pjs` — `$meta`, plugin imports (`generateText`, `generateImage`,
  `kv`), `config` (branding/theme/colors), `features` (roadmap checklist —
  delivered items `done = true`; flip to true as new work is verified).
- `index.html` — static shell: header/HUD strip, nav, 11 screen sections,
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
  achievements/milestones (`ACHIEVEMENTS`, `checkAchievements`), scenario
  starts (`SCENARIOS`, `scenarioById`/`scenariosFor`), difficulty modifiers
  (`DIFFICULTIES`, `difficultyByKey`/`difficultyTable`), Ironman flag,
  the Solaris arena career (`ARENA_CLASSES`/`ARENA_VENUES`/`ARENA_SPONSORS`/
  `ARENA_UPGRADES`/`ARENA_RANKS`, `newStable`, `refreshArenaMarket`,
  `refreshBouts`, `arenaBout`/`applyBout`, `arenaRepair`, `arenaBuyUpgrade`,
  `arenaSetSponsor`, `arenaBuyMech`/`arenaHirePilot`/`arenaSellUnit`,
  `arenaWeek`/`arenaCap`),
  `sanitizeCompany` (guards saved state against NaN/corruption on load).
- `src/ai.js` — `window.BMGA`: `generateReport` (ai-text streaming with
  template fallback when the AI scribe is unavailable), `generateBattleImage`,
  `generatePortrait` (text-to-image, JPEG data URL, cached on the person) plus
  the portrait system: kv-backed cache preloaded at boot, a sequential
  generation queue (`queuePortrait`/`queuePortraitAll`) so bulk runs never
  hammer the API, per-person re-roll (`force`), and cleanup on firing,
  `templateReport`; `exportPortraits`/`importPortraits` bundle the whole
  portrait cache for save export/import.
- `src/ui.js` — `window.BMUI`: `renderAll` + one renderer per screen
  (dashboard/contracts/personnel/mechbay/market/salvage/reports/company/
  roadmap, plus the arena screen `renderArena`/`arenaNoStable`) and modals
  (deploy, refit, dossier, event, battle report, arena bout report, bankrupt);
  plus the achievements card/grid and the share-card poster renderer
  (`buildRosterCard`, `rosterSummary`, `shareCard`).
- `src/sound.js` — `window.BMS`: the music manager (crossfade `play`,
  `stinger`, mute `toggle`, autoplay unlock, persisted preferences) built on
  four fixed hosted MP3s; wired from `game.js`.
- `src/game.js` — `window.BMG`: nav/router (`data-bm` delegated clicks), all
  actions, deploy → `runContract` → report flow (events queue after the report
  closes), new-game/bankruptcy/wipe, save/load (kv then localStorage),
  `saveSoon` autosave, the multi-slot save system (registry, per-slot saves,
  portraits and backups — see below), the arena career (`BMG.stable`, its own
  `kv.saves/"arena"` save with `saveStableSoon`, found/week/fight/repair/buy/
  hire/sell/upgrade/sponsor actions and the bout report modal), and
  export/import/restore + rolling backups. Company schema is versioned
  (`patchLoaded`, schema 4).
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
- Motion: `config.theme.reduceMotion` toggles `html.reduce-motion`; OS
  `prefers-reduced-motion` is honoured on its own. Modals are `role="dialog"`
  (`aria-modal`, `aria-labelledby` when titled); `UI.showModalEl` moves focus in
  and `UI.closeModalEl`/`BT.restoreFocus` return it. One topmost-close handler
  (`BT.closeModal` via `topModal`) owns Escape/backdrop; nav sets `aria-current`.

## Balance notes (locked after sim sweeps)
`BAL` in `src/core.js` = {enemyHpK:1.65, ourDmgK:1.5, enDmgK:1.25,
minRounds:10, maxRounds:18}. Offer threat = clamp(threatMult · rnd(0.8,1.22)
· tonF · rnd(0.85,1.15), 0.3, 3) where threatMult: recruit 0.62 / regular 0.9
/ veteran 1.18 / elite 1.5, tonF = 0.75 + avgTon/160. Verified outcomes
(fresh company, era 0): regular ≈ 60% vic / 10% partial / 30% defeat with
monotone difficulty gradient up to elite ≈ 41/8/51. Defense/garrison stays
near coin-flip by design. Sim harness pattern: page_eval → `MGM.newCompany`
then `MGM.battle(c, c.offers[0], units)`; count outcome/ourDeadCount/rounds.

> **Ammo/heat re-sweep (f30):** `f30`'s finite ammo and heat holding add
> per-battle attrition (energy boats stagger fire; heavy ammo weapons run dry
> late in long fights). A fresh-company sweep (200 trials per difficulty,
> regenerating the company each trial) gives a shallower but still monotone
> gradient — recruit ≈ 83% / regular ≈ 80% / veteran ≈ 64% / elite ≈ 57%
> victories. Enemy machines carry a 1.6× ammo reserve (they defend prepared
> positions), which is what keeps the top end honest.

> **Overhead re-sweep (f35):** itemising overhead adds transport
> (`3000 + 1400 × machines`), ammo resupply (per non-energy weapon, more for
> LosTech/Clan) and medical bills (`1200 + 2600 × injured + 700 × on leave`)
> on top of maintenance. On a typical 4-mech company this lifts weekly burn by
> roughly 35–45% (e.g. maintenance ~17k → total ~28k/wk), a deliberate squeeze
> that makes the contract loop and the new salvage/credit/investment systems
> matter. Contract pay and difficulty multipliers were left unchanged.

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

## Personnel development: XP, wounds & fatigue (Sep 2026)

Roadmap Phase 8 partially delivered — `f22 Pilot XP & Skills`,
`f23 Rivalries & Bonds`, `f24 Recruitment Market`, `f25 Training & Sim Pods`
and `f26 Morale & Fatigue` (see `main.pjs → features`).

- **XP & skills:** `p.xp` is progress toward the next skill-up (`MGM.SKILL_XP`
  = 6); `p.xpTotal` is career XP. Pilots improve gunnery (55%) or piloting,
  staff improve skill, each level recalibrates salary and posts to the log.
  `MGM.xpInfo(p)` / `MGM.pilotTier(p)` drive the roster card and dossier
  (Green → Regular → Veteran → Elite). XP accrues from every battle.
- **Wounds reduce skill:** `MGM.injuryPenalty(p)` = +1 wounded, +2 if the
  injury runs 3+ weeks; `MGM.effGunnery/effPiloting` add that penalty and are
  used by `unitPower` and the sim's `hitChance`, so a hurt pilot genuinely
  shoots worse. Dossiers show `G 5→6` while wounded.
- **Fatigue:** new `p.fatigue` (0–100) accrues per deployment in `applyBattle`
  (≈10 + 0.7·rounds, +8 ejected, +6 injured) and recovers 16/week on the ground
  (30/week on leave). High fatigue cuts accuracy (`MGM.fatiguePenalty`, up to
  −12%) and mech power. The Command screen warns when pilots are "running hot".
- **Leave Request event:** added to `COMPANY_EVENTS` (id `leave`) and
  prioritized by `startCompanyEvents` when any active pilot is ≥70 fatigue.
  Approve → `status:"leave"` for a week (fatigue clears), rotate to a desk for
  −6k, or deny for morale/pilot-morale hits and a walkout risk.
- **Walkouts:** `advanceWeek` can make a low-morale / high-fatigue pilot quit
  outright (returns `quits`); `doAdvanceWeek` in `game.js` clears their cached
  portrait and toasts the departure.
- **UI:** roster cards and dossiers show tier, XP bar, fatigue bar and wounded
  skill markers (`skillCell` / `fatigueChip`); `pStatus` understands `leave`.
  New CSS: `.bar-fill.xp`, `.skill-hurt`, `.dev-block/.dev-bars/.dev-label`.
  `sanitizeCompany` backfills `xp`/`xpTotal`/`fatigue`/`leaveWeeks` on old saves.
- **Rivalries & bonds (`f23`):** relationship records carry a `drops` counter
  that grows each time the pair deploys together; `MGM.lanceBonds(company,
  persons)` returns per-pilot cohesion modifiers (bonded pairs +up to 7%
  accuracy, feuds −up to 9%) used by the sim's `hitChance` and our damage.
  `MGM.evolveBonds` runs in `applyBattle`: it ages existing bonds (buddies can
  become shipmates at 4+ drops), forges new friendships on victories and fresh
  feuds after defeats/losses, and nudges pilot morale by cohesion. The deploy
  brief shows a live lance-cohesion line, dossiers list each bond's drop count
  and effect, the dashboard flags active feuds, and the after-action report
  lists cohesion pairs plus any new feuds/bonds. The `rivalry` event gained a
  paid joint simulator program that can bury the hatchet. New CSS:
  `.rep-bond`, `.deploy-cohesion`, `.alert.ok`.
- **Recruitment market (`f24`):** `MGM.refreshRecruits(company)` fills
  `company.recruits` with candidates whose asking fee derives from company
  reputation (`MGM.recruitReputation` / `recruitAsking`); `advanceWeek`
  refreshes the board weekly and rolls a poaching risk into
  `company.poachPing`, surfaced by the `poach` company event. `MGM.hireRecruit`
  signs a candidate (paying the fee), `MGM.poachTarget` picks the rival's mark.
  The Personnel screen renders the board (`renderRecruits`) with Sign buttons
  and a paid refresh; `sanitizeCompany` repopulates the pool on old saves.
- **Training & sim pods (`f25`):** `MGM.COURSES` + `coursesFor(role)` define
  pilot/tech/support courses; `trainingCost` scales tuition with the target
  skill and `trainingBlocked` validates eligibility. `startTraining` charges
  tuition, sets `status:"training"` and `p.training = {courseId, weeksLeft,
  cost}`; `advanceWeek` decrements `weeksLeft` and `finishTraining` applies the
  skill-up (plus career XP for pilots) and restores `active`; `cancelTraining`
  refunds 50%. The dossier renders the enrollment/cancel UI (`renderTraining`)
  and `pStatus` understands `training`. New CSS: `.train-block/.train-list/
  .train-row/.train-name/.train-cost`. `sanitizeCompany` validates training
  records on load.

## Lance composition & roles (Sep 2026)

Roadmap `f27 Lance Composition Tactics` (Phase 9). Every chassis derives a
battlefield role from its tonnage and weapon mix — the derivation lives in
`core.js` (`MGM.mechRole` via `weaponReach`), with the role definitions in
`MGM.ROLE_INFO` (Scout / Trooper / Fire Support / Brawler).

- **Roles:** Scout = fast light frames (≤35t) with no long-range battery;
  Fire Support = LRM-dominant or long-range direct-fire loadouts under 60t;
  Brawler = 60t+ anchors and close-assault specialists (SRM/AC-20/short-range);
  Trooper = the dependable remainder. Exposed through `MGM.ROLE_INFO`,
  `MGM.mechRole(chassisId)`.
- **Composition:** `MGM.lanceComposition(units)` returns per-role counts plus
  the derived modifiers — scouts grant up to +8% gunnery (spotting), fire
  support +6% damage each, brawlers +5% protection each. A combined-arms mix
  (scout + fire + brawler present) adds a synergy bonus; a one-dimensional
  lance is flagged **Specialized** and takes a −5% damage penalty; missing
  roles raise advisory notes.
- **Weight of metal:** `battle()` compares our total tonnage to the generated
  opfor. Out-mass the enemy and the lance gains damage/protection (brawling);
  field a lighter force and it gains gunnery (mobility). Folded into the same
  `lanceAcc` / `lanceDmg` / `lanceDef` values.
- **Simulation wiring:** `battle()` applies `lanceAcc` in `hitChance` (our
  attacks only), `lanceDmg` to our damage, and `lanceDef` to incoming enemy
  damage, and logs a composition line plus any synergy/penalty notes. The
  battle result carries a `composition` block.
- **UI:** `roleBadge()` chips on mechbay cards and deploy-brief lance rows; the
  deploy modal shows a live composition readout (`#deployComp`, updated by
  `updateDeployPower` in `game.js`); the after-action report renders a
  "Lance composition" block with the role list, applied modifiers and weight
  note. New CSS: `.chip.role-scout/.role-trooper/.role-fire/.role-brawler`,
  `.deploy-comp`.

## Terrain, biomes & weather (Sep 2026)

Roadmap `f28 Terrain & Weather Effects` (Phase 9). Every contract now rolls a
weather report on top of its terrain, and both feed a single combined
conditions model shared by the sim and the UI.

- **Biomes:** each `MGM.TERRAINS` entry now carries a `biome` label plus a
  `temp` (ambient heat contribution) and `sensor` (terrain sensor penalty) —
  e.g. Desert is hot and open, Polar is frigid, Urban is a heat island that
  blocks sensors, Jungle is hot and cluttered.
- **Weather:** `MGM.WEATHERS` (clear, overcast, rain, electrical storm, fog,
  snowfall, blizzard, heat wave, sandstorm, night operation) each define
  `acc`, `heat` and `sensors` modifiers plus a `biomes` allow-list.
  `MGM.pickWeather(terrain)` draws a biome-appropriate condition (weighted), so
  a desert never sees a blizzard and a polar field never sees a sandstorm.
- **Combined conditions:** `MGM.conditionsFor(offer)` merges terrain and
  weather into `{ acc, sensors, heat }`. `battle()` folds these into a single
  `condAcc = acc + sensors*0.7 + heat*-0.06` applied symmetrically in
  `hitChance`, and `heatDmgMult()` scales energy-weapon damage by the lance's
  energy fraction — heat stress penalises, cold air grants a small bonus.
  Degraded sensors (`sensors < -0.02`) can trigger an enemy opening ambush
  before round 1, logged and flagged in the result.
- **Offers & reports:** `refreshOffers` stamps `weather` onto each offer beside
  its `terrain`; the board cards and deploy brief show a weather chip and a
  live conditions readout (`.deploy-cond`), and the after-action report renders
  a "Conditions" block. The battle result carries a `conditions` block. Old
  saves are patched by `sanitizeCompany` (missing weather/terrain is filled in).
- **UI/CSS:** `.chip.wx-chip` weather chip and `.deploy-cond` conditions line.

## Enemy commander doctrines (Sep 2026)

Roadmap `f29 Enemy Commander Doctrines` (Phase 9). Every contract names the
opposing force's commander and the doctrine they fight by, and the sim reacts
to it.

- **Data:** `MGM.DOCTRINES` (Aggressive, Cautious, Attritional, Berserker and
  Clan Zellbrigen) each carry `gun`/`dmg` (enemy accuracy & damage), `taken`
  (how vulnerable they are to our fire), `breakFrac`/`poolBreak`/`withdrawFrac`
  (when they break off or pull back) and a `target` mode. `MGM.pickDoctrine`
  weights the pool by faction type and mission (Clan Trials always fight
  Zellbrigen; pirates lean Berserker; defence/garrison lean Cautious/Attritional);
  `MGM.doctrineOf(offer)` resolves an offer's doctrine.
- **Commanders:** `MGM.pickEnemyCommander` generates a name and a faction-
  appropriate rank (House officer, Clan Star Colonel, ComStar Precentor, pirate
  Captain, periphery Colonel). Stored on the offer as `enemyCommander`.
- **Simulation wiring:** `battle()` adds `doctrine.gun` to enemy gunnery, scales
  enemy damage by `doctrine.dmg` and our damage by `doctrine.taken`, uses the
  doctrine's break/withdraw thresholds in the round loop, and selects enemy
  targets by mode — `finish` (focus the most damaged), `threat` (kill the
  biggest gun), `duel` (each enemy engages its assigned opponent, zellbrigen),
  or `focus` (default). Duel assignments are made per enemy at battle start.
  The result carries a `doctrine` block beside `conditions`/`composition`.
- **Offers & reports:** `refreshOffers` stamps `doctrineId` and
  `enemyCommander`; `sanitizeCompany` backfills both for old saves. The board
  card shows the commander line and a doctrine chip (`.doc-chip` +
  `.doc-<id>`), the deploy brief adds an "Enemy commander" line, and the
  after-action report renders an "Opposing commander" block.

## Ammo, heat & armour detail (Sep 2026)

Roadmap `f30 Ammo, Heat & Armor Detail` (Phase 9). Weapons now have a heat
cost and finite ammunition, and the simulation tracks both round by round.

- **Weapon data:** helpers in `core.js` derive per-weapon figures from the
  weapon class — `MGM.weaponHeat` (energy > missile > ballistic heat per point
  of damage), `MGM.weaponAmmo` (energy = infinite; ballistic/missile = fewer
  volleys the heavier the gun, and LosTech/Clan types carry ~28% less), and
  `MGM.ordnanceProfile(unit)` / `heatDissipation` / `heatCapacity` for the UI
  readouts.
- **Fire plans:** `makeFireProfile(ton, weapons)` builds per-unit fire records
  (`ammoLeft`, `heat`), and `planFire(x, isOk)` resolves one machine's volley:
  it holds back the hottest weapons (energy first, by heat-per-damage) whenever
  the alpha would exceed the machine's heat capacity, consumes a volley of ammo
  per ammo weapon fired (logging when a bin runs dry), raises heat by the fired
  alpha minus the sinks' dissipation, and flags an overheat when heat passes
  capacity — venting back down and risking an ammo cook-off. Enemy machines are
  spawned with a 1.6× ammo reserve (they defend prepared positions), and enemy
  `planFire` runs the same rules.
- **Simulation wiring:** `battle()` replaces the flat `sumWeaponDmg` /
  `wSum` terms in `ourAttackRound` / `enemyAttackRound` with each machine's
  `planFire().dmg`, and logs "runs dry", "holds fire" and "redlines" beats.
  The result carries an `ordnance` block (per machine: salvoes fired, weapons
  dry, peak heat vs capacity, overheat count, peak weapons held) and an
  `enemyOrdnance` summary.
- **UI/CSS:** the deploy brief shows a live `#deployOrdnance` readout (alpha
  heat vs dissipation, ammo-dependent weapon count, which machines must
  stagger fire) and a per-row heat/ammo line; the after-action report renders an
  "Ordnance & armour" block with each machine's ammunition expenditure, dry
  weapons, heat peaks, overheat events and a per-location armour/structure
  breakdown (plus breached locations). New CSS: `.deploy-ordnance`.

## Turn-by-turn highlight reel (Sep 2026)

Roadmap `f31 Turn-by-Turn Highlight Reel` (Phase 9). `battle()`'s `logE` now
stamps every log entry with its round via a `curRound` counter, so the full
engagement can be replayed in order.

- `reportShell` (in `game.js`) groups the battle log by round and renders a
  collapsible `<details class="reel">` "Round-by-round highlight reel" under the
  narrative. Each round lists up to three of its most telling entries —
  prioritising kills and battle-end beats, then injuries, component failures,
  dry weapons and overheat events, then trait moments, quotes, doctrine and
  cohesion lines — in the order they occurred.
- New CSS: `.reel`, `.reel-round`, `.reel-head`, `.reel-item` (with
  `.pos`/`.neg` tones). The reel only appears when a battle spans two or more
  rounds.

## Economy & logistics — Phase 10 (Sep 2026)

Phase 10 (`f32`–`f36`) fills out the business layer: repairs tied to real stock,
a salvage market that rewards patience, a proper credit system, itemised weekly
overhead and a passive-income sink for late-game capital.

### Repair queue & parts inventory (`f32`)

Repairs in `core.js` now consume **repair crates** (`company.supplies.repair`)
and the exact weapon part for every destroyed weapon, and are queued through a
limited number of bays.

- `repairSupplyNeed(unit)` — crates needed: `ceil(missingArmor/50) +
  ceil(missingStructure/12) + destroyedComponents×2 + damagedComponents`.
- `repairWeaponsNeeded(company, unit)` / `repairReadiness(company, unit)` —
  the weapon parts (with `have`/`ok`) and crates a job requires, plus a
  `{ok, missing[]}` verdict. `startRepair` returns `{error:"parts", missing}`
  when stock is short.
- `repairBays(company) = max(1, activeTechs) + 1`. A job started past capacity
  sets `unit.repairQueued`; `advanceWeek` only ticks jobs that hold a bay, so
  waiting jobs sit until one frees up (they show as "queued").
- `repairQuality(company)` derives a flaw chance from the best active tech's
  skill; `completeRepair` restores the machine and, on a bad roll, leaves one
  internal component `"damaged"` with a `repairNote` ("field patch").
  `startRepair` draws down crates/parts at start and `cancelRepair` refunds both
  (labour is only 50% refunded, as before).
- Market: `refreshMarket` adds 1–2 `kind:"supply"` crate lots and the market
  screen adds a **Repair depot** card (`buySupplies`, `supplyPrice`, route
  `buy-supplies`). `buyMarketItem` handles `kind:"supply"`.
- UI: the mechbay head shows crates in stock, a live **Repair queue** panel
  lists each job (bay vs queued, weeks left, cancel), and each mech card shows
  the crate count, per-weapon part requirements and any lingering field-patch
  note. New CSS: `.repair-queue`, `.rq-row`, `.repair-parts`, `.repair-missing`,
  `.repair-note`, `.repair-depot`.

### Salvage market & brokers (`f33`)

Salvage values are now scaled by a weekly **salvage index** and lots can be held
for a better price.

- `company.salvageIndex` (0.7–1.4) drifts each `advanceWeek`;
  `salvageBaseValue(item)` and `salvageInstantValue(company, item)` centralise
  valuation (the instant sell paths in `game.js` use them).
- `listSalvage(company, svId, mode)` moves a lot into
  `company.salvageListings` (cap 6). `mode:"market"` = ×1.35 over 2 weeks
  (scrap 3); `mode:"broker"` (mech hulls only) = ×1.5 over 2 weeks with a 15%
  chance a buyer haggles the multiplier down by 0.25. `salvageListQuote` powers
  the UI previews; `cancelSalvageListing` returns the lot to the bay.
- `processSalvageListings(company)` drifts the index, ticks listings, pays out
  on completion (logged under `sale`) and returns the sales in the `advanceWeek`
  result (`salvageSales`).
- UI: the salvage screen shows the index, an instant-vs-listed readout per lot,
  list/broker buttons and a live **Salvage market** board with weeks left and
  withdraw buttons.

### Loans & credit (`f34`)

Replaced the single `company.loan` with `company.loans[]` and a credit rating
(`company.credit`). Legacy saves with `company.loan > 0` are migrated to a loan
record in `sanitizeCompany`.

- `LENDERS` × `loanOffers(company)` produce 3 offers (ComStar 3%/wk, House 5%,
  Loan Shark 9%) with principal scaled by `creditScore` and company rating, and
  locked entries when the score is below their minimum.
- `takeCredit`, `loanPayment` (partial/clear) and `repayLoan` (specific loan, or
  highest-rate when unspecified) move money via `logTx`. `takeLoan` remains the
  emergency 8%/wk line (dashboard button and bankruptcy modal).
- `advanceWeek` capitalises interest, auto-draws a minimum payment, and on a
  shortfall increments `missed`, cuts credit (−8) and reputation (−1 with the
  lender's faction). Three misses → default: the lender seizes the cheapest
  machine and the loan is written off (credit −15). Returns `loanEvents`.
- UI: dashboard debt alert → "Manage credit"; the company screen adds
  `renderCredit` (balances, per-week interest, Pay/Clear buttons, live offers,
  rating chip).

### Overhead itemization (`f35`)

`upkeepBreakdown` (base maintenance) is wrapped by `overheadBreakdown(company)`,
which splits weekly cost into four distinct lines and sums them:

- **maintenance** — as before (tech discount, damaged-internals multiplier);
- **transport** — `3000 + 1400 × machines under maintenance`;
- **ammo** — scaled by the non-energy weapons on the roster (LosTech/Clan cost
  ×1.4);
- **medical** — `1200 + 2600 × injured + 700 × on-leave` (zero when nobody is
  hurt).

`weeklyUpkeep` now returns the total, so `totalWeeklyBurn` and
`ledgerSummary.burn` include everything. `advanceWeek` posts each line under its
own ledger category (`upkeep`/`transport`/`ammo`/`medical`), and `logBanner`
itemises them in the Company logistics banner. The new categories are in the
Company ledger `catOrder`/`catCls` maps.

### Investments (`f36`)

A passive-income sink exposed on the market as the **Investment exchange**.

- `INVESTMENT_TYPES` — ComStar bonds, agri-combine landholds, defense/shipping
  stocks and high-risk LosTech/Solaris ventures, each with `price`, weekly
  `yield` and `vol` (risk). `refreshInvestments` stocks 3–5 offers, refreshed
  every 4 weeks.
- `buyInvestment` / `sellInvestment` (2% brokerage) manage
  `company.investments[]` (cap 8), logging under the `investment` category;
  `investmentValue` and `weeklyInvestmentIncome` power the summary.
- `processInvestments(company)` runs each `advanceWeek`: price drifts by
  `yield×0.4 ± vol` (slight positive bias), a dividend is paid, and a
  risk-scaled chance triggers a surge/slump event (logged to company news).
- UI: `renderInvestments` (in the market screen) shows portfolio value, passive
  income, per-holding P/L and a sell button, plus the current offers.

## World, era & factions — Phase 11 (Sep 2026)

Phase 11 (`f37`–`f41`) makes Known Space a live board: the company is stationed
at a real world, borders drift, employers rank you, the campaign delivers
scripted milestones, and a rival outfit competes for the same contracts.

### Dynamic faction map (`f37`)

`WORLD_SYSTEMS` in `core.js` is a hand-built map of ~51 named worlds with grid
coordinates, baseline owners (House/Clan/ComStar/Periphery) and an `INVASION`
table carving the historical Clan corridors. `worldInit(era)` / `ensureWorld`
seed `company.world.systems` (owner + control %), and only Era 1+ reveals Clan
space. `processWorld(company)` runs each `advanceWeek`: hostile neighbours probe
undefended worlds, opening capped **flashpoint fronts** (`worldHotspots`) that
carry a heat value; a front resolves after a few weeks — the attacker can seize
the world (`worldSeize`, ownership/colour change logged to news) or be thrown
back. `worldSystemById`, `worldControlLabel`, `factionStr` and
`pickOfferSystem` support the rest of the game. The Known Space screen
(`renderWorld` / `renderWorldSystem`) draws the map, colour-codes ownership,
marks the current station, badges worlds with open work and opens a world
dossier.

### Travel & transit (`f38`)

The company lives at one world at a time (`company.location`, `company.fuel`
with a 100-unit tank, `company.transit`). `systemDistance` / `travelQuote`
price a leg (1–4 weeks + fuel); `startTravel` commits the DropShip and
`processTransit` ticks the journey down each week, posting the arrival to news.
Contracts are bound to a system (`offer.systemId`), so `launchBattle` refuses
to deploy off-station and the market sells fuel lots. The transit banner and
per-offer transit chips surface the commitment cost.

### Reputation tiers & House contracts (`f39`)

`REP_TIERS` maps standing (-10..+10) to named ranks (Sworn enemy → Trusted
ally) with glyphs (`repTier` / `repLabel`). At **Honored** or better a faction
offers exclusive **House/Clan Contracts** in `refreshOffers` — ~1.5× pay, 60%
salvage, longer term, heavier opposition (gold ★ badge). `standingDiscount`
grants a capped maintenance/ammo rebate from Respected employers, shown as the
"House logistics discount" line in `overheadBreakdown`.

### Story arcs & campaign events (`f40`)

`STORY_EVENTS` holds seven one-shot milestone beats — one per era
(succession offensive, Clan invasion, civil war, Jihad, Dark Age) plus the
era-agnostic defectors and MRB audit — fired by `startStoryEvents` and tracked
in `company.story.seen`. Each pauses the clock and offers three choices
(`worldOpenFront`, `worldSeize`, `relocateCompany`, cash/morale/rep/personnel
effects) with a Campaign card on the company screen.

### Rival merc company (`f41`)

`makeRival` / `ensureRival` create a persistent rival outfit (name, colours,
temperament, power rating tracking yours). `processRival` grows it weekly and
lets it snatch contracts off the board (`rivalMult` undercuts your pay; stolen
offers show a red ◆ chip), while `resolveRivalContract` / `rivalRating` /
`rivalTrait` handle winning jobs back and the recurring `rival-clash` Company
Event. `applyBattle` resolves the rivalry when a contested offer completes, and
the Rival outfit card reports power, record and latest activity.

## Pilot dossiers & career logs — Phase 12 (Sep 2026)

Roadmap `f42 Pilot Dossiers & Career Log`. Each person now carries a persistent
service history, rendered on the dossier.

- **Data:** `genPerson` seeds `p.service` (`drops`, `missions`, `kills`,
  `wounds`, `victories`, `defeats`) and `p.serviceLog` (week-stamped entries,
  capped at 40). `careerOf(p)` normalises the record, `careerStats(p)` derives
  totals + win rate + log, and `logService(company, p, text, kind)` appends.
- **Accrual:** `applyBattle` updates every deployed pilot's tallies from the
  battle result (`killsByPilot`, `injuries`, `outcome`, losses) and logs a
  deployment line; field skill-ups (`improved`) log too. `finishTraining` /
  `cancelTraining` log completions/washouts, `startTraining` logs enrollment,
  and `hireRecruit` logs the signing.
- **UI:** `renderDossier` gained `serviceRecord` — a six-cell `career-grid`, a
  narrative `careerBio`, the win-rate line and the `serviceLog` timeline
  (`serviceLogHtml`). The dossier modal opens `wide`. New CSS: `.dossier-service`,
  `.service-head`, `.career-grid`/`.career-stat`, `.service-log`/`.slog-row`.
- **Saves:** `sanitizeCompany` backfills and validates `service`/`serviceLog`
  on older saves.

## Mechbay hardpoint refit — Phase 12 (Sep 2026)

Roadmap `f43 Mechbay Refit UI`. `installPart` no longer drops weapons into a
random location.

- **Hardpoint model (core):** `HARDPOINT_LOCS` (LT/CT/RT/LA/RA) with
  `HARDPOINT_SLOTS` capacities; `weaponSlots(w)` costs 1 (energy) / 2 (missile)
  / 3 (ballistic). `hardpointMap(unit)`, `hardpointFit`, `freeHardpoints` and
  `refitPreview(unit, wid)` (before/after firepower, alpha heat vs sinks, power)
  power the UI. `installPart(company, unitId, wid, loc)` validates the chosen
  mount (`error:"space"` with `free`/`need`), and `moveWeapon` relocates a
  mounted weapon under the same slot rules.
- **UI:** `renderRefit` draws the hardpoint map (each cell shows mounted weapons,
  used/cap, over-capacity flag), per-weapon move selects + strip, and inventory
  rows with a location picker, live before→after preview and Install button.
  `refitPreviewText` updates the preview on select `change` (`refitloc`).
- **game.js:** `installAction` reads the row's chosen location; `moveRefitAction`
  handles `refitmove`; both re-open the wide refit modal. New CSS:
  `.refit-stats`, `.hardpoint-grid`/`.hp-cell`/`.hp-wep`, `.refit-loc`,
  `.refit-preview`.

## Dashboard almanac — Phase 12 (Sep 2026)

Roadmap `f44 Dashboard & Almanac`.

- **History (core):** `recordHistory(company)` runs at the end of every
  `advanceWeek`, summing that week's ledger lines and pushing a snapshot
  (`week`, `funds`, `income`, `expense`, `net`, `debt`, `morale`, `headcount`,
  `units`, `wins`, `kills`) into `company.history` (capped at 120). `applyBattle`
  appends a compact record to `company.contractHistory` (`week`, mission,
  planet, employer, outcome, pay, kills, losses, salvage, rival flag; cap 100).
  `almanacStats(company)` derives totals, win rate, payout, best contract and
  lifetime kills. Both arrays are backfilled by `sanitizeCompany`.
- **UI:** `almanacCard` on the Command screen renders a KPI strip, the best
  contract, a funds line chart and a weekly net-cash bar chart (`svgLine` /
  `svgBars`, hand-built inline SVG), and a contract-history table. New CSS:
  `.almanac-charts`, `.chart`/`.chart-line`/`.chart-area`/`.chart-bar`,
  `.hist-list`/`.hist-row`.

## Voice lines & banter — Phase 12 (Sep 2026)

Roadmap `f45 Voice Lines & Banter`.

- **Voice engine (core):** `VOICE_GENERIC` now carries eighteen situation pools
  — `deploy`, `brief`, `kill`, `hurt`, `injury`, `loss`, `dry`, `overheat`,
  `extraction`, `victory`, `partial`, `defeat`, `payday`, `salvage`, `camp`,
  `training`, `recruit`, `event` — and `VOICE_SPECIAL` gives every one of the 28
  traits its own lines; `voiceLine(person, scenario, vars)` picks a trait line
  with a 55% override. Unknown `{enemyMech}` placeholders fall back to "enemy
  machine" so no raw braces ever surface.
- **Banter helpers (core):** `banterLines(persons, scenario, count, vars)`
  produces distinct per-pilot quotes for a group; `eventVoice(company,
  scenario)` picks one active member for an event; `barracksBanter(company,
  count)` returns a weekly-stable set (seeded by company name + week) for the
  dashboard.
- **Battles:** `battle()` composes a stored `battle.banter` array from the
  survivors, the wounded and anyone who lost a machine (deduped by text, cap 5),
  so quotes persist in the archive and are stable on re-open.
- **Reports:** `reportShell` (`game.js`) renders a **Voices from the lance**
  block of comms-style quotes (`.rep-voice`/`.rep-voice-call`/`.rep-voice-line`);
  `templateReport` adds a "Comms chatter" paragraph and `narrativePrompt` feeds
  the quotes to the AI so each pilot keeps a distinct voice.
- **Events:** the event modal (`showNextEvent`) prints a personality quote from
  an active member (`.event-voice`/`.ev-voice-call`) — `brief` for story beats,
  `salvage` for LosTech caches, `camp` otherwise.
- **Dashboard:** `banterCard` (`ui.js`) shows a **Barracks chatter** card
  (`.banter-card`/`.banter-list`/`.banter-row`/`.banter-call`/`.banter-line`).

## Music & sound — Phase 12 (Sep 2026)

Roadmap `f46 Music & Sound`. Four fixed hosted MP3s (menu ambience, battle theme,
victory sting, defeat sting) driven by `src/sound.js`, exposed as `window.BMS`:

- **Audio manager `BMS`:** `play(key, {rate})` crossfades to a looping track,
  `stinger(key)` plays a one-shot while ducking the music and restores it on
  `ended`, `stop`/`toggle`/`setEnabled`/`setMusicVolume` round out the API. The
  mute preference (and volumes) persist in `localStorage` (`bmg-sound-*`).
- **Autoplay-safe:** nothing plays until the first `pointerdown`/`keydown`
  (`unlock()`), which then starts whatever `play()` last requested. A header ♪
  button (`#soundToggle`, `.icon-btn.sound-off`) mutes/unmutes at any time, and
  `visibilitychange` pauses/resumes when the tab is hidden.
- **Wiring (`game.js`):** `playMenuMusic()` starts the menu theme (pitch-tempered
  by `company.eraIdx`) on boot, after founding a company and when a report
  closes; `launchBattle` switches to the battle theme; `showBattleReport` fires
  the victory or defeat sting by outcome.
- **Shell:** `index.html` loads `src/sound.js` before `ui.js`/`game.js` and adds
  the header toggle; `.icon-btn` gained `position: relative` for the muted
  slash.

## Achievements & milestones — Phase 13 (Sep 2026)

Roadmap `f47 Achievements & Milestones`. A goal system layered over the existing
simulation: 24 achievements in `MGM.ACHIEVEMENTS`, grouped into **Combat**,
**Command**, **Finance**, **Logistics** and **Campaign**.

- **Definitions:** each entry is `{id, cat, glyph, name, desc, goal, flavor,
  title?, metric}`. `metric(company)` reads a live sim value — wins, best win
  streak, kills, machines lost, salvage recovered, contract count, week, roster
  size, bonded pairs, best pilot skill, peak reputation, treasury peak, credit
  score, lifetime payout, best single contract, operational machines, era index
  and rival losses.
- **New counters:** `applyBattle` maintains `company.stats.streak`,
  `bestStreak`, `flawless` (a victory with no injuries and no losses) and
  `salvageTaken`; `sanitizeCompany` backfills all counters plus
  `company.achievements` (`{id: {week}}`) and `company.titles` (unlocked
  epithets) for older saves.
- **Evaluation:** `MGM.checkAchievements(company)` grants any newly-satisfied
  goal, records the week, pushes a flavour title onto `company.titles`, writes a
  `Milestone unlocked — …` line to company news, and returns the newly-earned
  achievements. `achievementsSummary` / `achievementProgress` drive the UI.
  `game.js` calls `grantAchievements` (which toasts, summarising if four or more
  land at once) from `afterAction`, `advanceWeek` and `runContract`, and
  `afterLoad` evaluates silently so returning campaigns are honoured.
- **Rewards:** twelve milestones grant a working title (Blooded, The Undefeated,
  Warlord, Iron Rain, House Favourite, Scavenger Lord, …) shown beside the
  company name in the HUD (`#companyTitleEl`).
- **UI:** the Command screen gains a **Milestones** card
  (`achievementsCard`) listing recently earned goals and the next three in
  progress; the Company screen gains a full commendation grid
  (`achievementsFull`, `.ach-grid`/`.ach-cell`) grouped by category with progress
  bars and unlocked-week chips.

## Scenario starts & New Game+ — Phase 13 (Sep 2026)

Roadmap `f48 Scenario Starts & New Game+`. Company founding is driven by
`MGM.SCENARIOS` (helpers `scenarioById`, `scenariosFor`) rather than a single
template.

- **Scenarios:** `standard`, `bondsman`, `noble`, `broke`, `newgameplus`, each
  `{id, name, glyph, title, desc, detail, apply?, requires?}`. `newCompany` builds
  the base crew and light lance, sets `company.funds = difficulty.funds`, then
  runs `scen.apply(company, {difficulty, dk, legacy})` to reshape funds, lance
  (`genUnit`), pilot skills, reputation, loans and morale. The grant is written
  once via `logTx` (funds are zeroed first and re-added, so the ledger and
  balance agree).
- **New Game+:** `game.js` `computeLegacy(company)` returns a carry-over record
  once a real campaign exists (≥1 contract or ≥8 weeks); `scenariosFor(legacy)`
  only then offers `newgameplus`. It inherits a scaled treasury bonus
  (`weeks*6k + victories*15k`, capped at 1.2M), +4 reputation with the old
  company's best employer, two veteran pilots (two ranks better) and a
  `company.legacy` record shown on the Company screen.
- **UI:** the new-game modal gained a **Founding scenario** `<select>`
  (`#ngScenario`) with a live description (`#ngScenarioDesc`); the HUD shows the
  scenario's title beside achievement titles; the Company lede names the
  founding scenario.
- **Save guard:** `sanitizeCompany` backfills `company.scenario` (default
  `"standard"`) and validates `company.legacy`.

## Share company — Phase 13 (Sep 2026)

Roadmap `f49 Share Company`. The Company screen's **Share the company** card
(`shareCard`) renders the whole outfit as a downloadable poster.

- **Roster card:** `UI.buildRosterCard(company)` (in `ui.js`) draws a 1080px-wide
  canvas poster: the crest badge, name/callsign, era, difficulty, founding
  scenario and worn titles; four KPI tiles (rating, contracts, win rate, kills);
  a service-record grid; a three-employer standing chart with reputation tiers;
  the pilot roster (callsign, name, `G#/P#`, career kills and W/L, readiness);
  and the operational lance (chassis, tonnage, tech, pilot, condition). It
  renders onto a tall canvas and crops to the final content height, so it
  auto-sizes to the roster without clipping or trailing whitespace.
- **Modal & download:** `game.js` `shareAction()` converts the canvas to a PNG
  data URL, opens it in a modal (`.share-card`) with a download link named
  `<slug>-roster.png`, a **Copy summary** button and Close.
- **Text summary:** `UI.rosterSummary(company)` builds the plain-text blurb
  (name, titles, rating, era, difficulty, week, record, personnel, milestones,
  generator link); `shareCopyAction()` writes it via `navigator.clipboard` and
  falls back to displaying it in `#shareNote` when the clipboard is blocked.
- **Styling:** `.share-wrap` / `.share-card` / `#shareNote` in `base.css` keep
  the poster responsive (full-width, scrollable) inside the modal.

## Difficulty & Ironman — Phase 13 (Sep 2026)

Roadmap `f51 Difficulty & Ironman`.

- **Difficulty table:** `MGM.DIFFICULTIES` (helpers `difficultyByKey`,
  `difficultyTable`) holds the four settings as one object each:
  `{key, label, blurb, bonus, payMult, threatMult, funds, repairMult,
  injuryMult, salvageMult, upkeepMult}`. `newCompany` copies the chosen row onto
  `company.difficulty`; `sanitizeCompany` backfills any missing fields (and
  `company.ironman`) for older saves.
- **Where the modifiers bite:** `repairEstimate` multiplies labour cost by
  `repairMult`; `overheadBreakdown` scales maintenance/transport/ammo by
  `upkeepMult`; the battle loop rolls cockpit wounds at
  `0.04 × injuryMult`; `refreshOffers` scales `salvagePct` by `salvageMult`;
  `payMult`, `threatMult` and `bonus` already drove pay, threat and enemy
  gunnery.
- **UI:** the new-game modal lists every multiplier live under the difficulty
  picker (`#ngDiffDesc`), and `UI.difficultyCard` on the Company screen spells
  out the active modifiers as chips.
- **Ironman:** `company.ironman` is set at founding (`#ngIronman` checkbox) or
  by `enableIronmanAction` (one-way, from the Difficulty card). `makeBackup`
  returns `null` when ironman, so no snapshots ever accumulate; `restoreAction`
  and `importFileChosen` refuse; the Save card hides snapshots and the import
  button and explains the rules; `saveAction` still writes the slot. An
  `IRONMAN` badge shows in the HUD (`#ironmanEl`).

## Multiple company slots — Phase 13 (Sep 2026)

Roadmap `f50 Multiple Company Slots`. Instead of a single save, the player can
keep several companies side by side.

- **Registry:** `kv.saves/“slots”` holds `{active, slots:[meta]}` where each
  meta is `{id, name, callsign, week, funds, era, eraIdx, difficulty, pilots,
  units, updated}` (`slotMeta`). Helpers: `slotsLoad`/`slotsSave`,
  `refreshSlotMeta` (called from `persistCompany`, i.e. every autosave).
- **Keys:** `saveKeyFor(id)` is `"main"` for the legacy slot, else `"slot-<id>"`;
  `portsKeyFor(id)` stores that slot's portrait bundle in `kv.saves`;
  `backupKeyFor(id)` scopes the snapshot timeline per company. The
  `PORTS_MARKER_KEY` (`"ports-active"`) records which slot the global portrait
  cache belongs to, so boot only re-imports a slot's portraits when needed.
- **Switching (`switchSlot` / `loadSlot`):** saves the outgoing company and its
  portraits, loads the target (sanitized), imports its portraits into the AI
  cache, reloads its backups, re-renders. An old single-save game is adopted as
  the `"main"` slot on first boot.
- **Founding (`newGameSubmit`):** always creates a *new* slot (the first-ever
  company keeps `"main"`), snapshotting the current company first — so founding
  never overwrites an existing outfit.
- **Deleting (`deleteSlotAction` / `wipeActiveSlot`):** removes a slot's save,
  portraits and backups; if it was active, command switches to the most
  recently played remaining slot (or the new-game modal when none are left).
- **UI:** `UI.companiesCard` (Company screen) lists every outfit with era,
  difficulty, week, funds, roster size and last-played time, badges the active
  one, and offers **Take command** / **Forget** / **Found a new company**
  (`data-bm="slot-switch" | "slot-delete" | "newgame"`). Styled by `.slot-*` in
  `base.css`.

## Solaris arena mode — Phase 14 (Sep 2026)

Roadmap `f52 Solaris Arena Mode`. A whole second career, deliberately separate
from the mercenary company: a gladiator **stable** fighting the circuits of
Solaris VII. It lives in its own kv save (`kv.saves/\"arena\"`) with its own
C-bills and never reads or writes the company save.

- **Data (`core.js`):** `ARENA_CLASSES` (Light/Medium/Heavy/Assault circuits,
  each with purse/power multipliers), `ARENA_VENUES` (The Factory → Boreal
  Reach → The Reaches → Ishiyama → Steiner Coliseum, fame-gated, each with a
  purse multiplier), `ARENA_SPONSORS` (five tiers, weekly stipend + win fame,
  fame-gated), `ARENA_UPGRADES` (six one-off purchases) and `ARENA_RANKS`
  (Unknown → Contender → Crowd Favourite → Ranked → Arena Star → Solaris
  Champion).
- **Stable lifecycle:** `newStable({name, callsign, cls, eraIdx})` builds a
  stable with two gladiator 'Mechs (reusing `genUnit`) and their pilots plus a
  stable tech (`genPerson`), then `refreshArenaMarket` (four used machines
  weighted light/light/medium/heavy + three free-agent pilots, refreshed
  weekly) and `refreshBouts` (one bout per circuit that has a live machine,
  opponent power scaled by circuit × venue × fame, venue chosen by
  fame-weight).
- **Bout engine:** `arenaBout(stable, boutId, unitId)` is self-contained — its
  own seeded RNG, round-by-round relative-power to-hit rolls, damage, crowd
  beats, a `voiceLine` pilot quote, and an outcome with hull damage, machine
  loss and injury rolls (the Pilot Harness Bay and difficulty `injuryMult`
  soften wounds). `applyBout` writes the result back: hull/components/weapons
  damage (`damageArenaUnit`), pilot XP/wounds/fatigue (career service too),
  purse, fame, circuit win, record, `history` and `log`.
- **Economy & loop:** cash repairs (`arenaRepairCost` reuses `repairEstimate`,
  the Repair Cradle halves it), `arenaBuyMech`/`arenaHirePilot`/`arenaSellUnit`
  (capacity from `arenaCap`), `arenaBuyUpgrade`, `arenaSetSponsor`, and
  `arenaWeek` (stipend − tonnage upkeep, healing, fame decay, forced
  liquidation of a machine when funds go negative, then market + card refresh).
- **Wiring:** the **Solaris** nav tab (`data-screen=\"arena\"`), a
  `#screen-arena` section in `index.html`, `BMG.stable` loaded from and
  autosaved to `kv.saves/\"arena\"` (debounced `saveStableSoon`, flushed on
  `beforeunload`), `UI.renderArena` plus `arenaNoStable`, route cases
  `arena-*` in `game.js`, and the `.arena-*` / `.bout-*` / `.glad-*` styles in
  `base.css`.

## Save, export & backups (Sep 2026)

The Company → **Save & backups** card (`renderCompany` in `ui.js`, actions in
`game.js`) gives the player full control over their save:

- **Autosave** — every action calls `saveSoon()` (debounced 300 ms) which runs
  `persistCompany()`: it writes the active company to its slot save key
  (`kv.saves/"main"` for the legacy slot, else `kv.saves/"slot-<id>"`) and
  refreshes that slot's registry entry (localStorage fallback throughout). A
  `beforeunload` handler flushes the latest state.
- **Rolling snapshots** — up to `BACKUP_LIMIT` (8) snapshots per company live in
  `kv.backups/"list"` (or `"list-<id>"` for other slots; localStorage fallback
  `bmg-backups`). Each snapshot stores
  the company *and* the current portrait bundle, plus display fields (label,
  name, week, funds, timestamp). They are created by **Save now**, at the start
  of each `advanceWeek`, after every battle (`runContract`), and before
  import / restore / founding-a-new-company, so a bad week or a mistaken action
  can always be rewound. Restoring loads the snapshot via `patchLoaded` and
  re-imports its portraits.
- **Export** — builds a JSON bundle `{format:"btmm-save", version:1, savedAt,
  generator, company, portraits}` and downloads it as
  `<company>-wk<N>.btmm.json`. Portraits are base64 data URLs, so the file is
  self-contained.
- **Import** — reads a `.btmm.json` (also accepts a bare company object),
  snapshots the current company first, then `patchLoaded`s the imported company,
  replaces the portrait cache, persists, and renders. `parseBundle` validates
  the shape before touching live state.
- **Erase save / Disband** clear both the main save and all snapshots (the
  dialogs say so). Founding a *new* company keeps prior snapshots, so the old
  company is still recoverable by restoring its "Before new company" snapshot.

Renderer helper `renderBackups()` reads the cached `BMG._backups` (loaded at
boot), so the list is synchronous; actions refresh it and re-render.

## Layout note

`.grid-2col` items get `min-width: 0` (base.css) — without it a grid track's
auto min-content could exceed the container on phones (~360px) and introduce a
horizontal scroll on the Company screen.

