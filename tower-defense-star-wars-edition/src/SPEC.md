# SPEC — Tower Defense: Star Wars Edition

Human-readable specification of what the generator is and must do. Update this whenever the user
adds or changes requirements.

## Concept

A complete top-down tower-defense game set in the Star Wars universe. The player defends a base at
the end of a winding path from waves of Imperial / Separatist forces, building and upgrading turrets,
using Force powers, and commanding a Jedi hero. Four planets, escalating difficulty, boss waves, and
an endless survival mode.

## Functional requirements

### Phase 1 — Core foundation
- Grid map (16×10, 62px cells) with a defined non-linear path enemies follow from spawn to base.
- Global state machine: MENU, SELECT, BRIEF, RUNNING, PAUSED, VICTORY, GAME_OVER.
- Real-time loop with fixed 1/60s timestep and a global speed multiplier (1×/2×/3×).
- Credit economy: kills add credits; build/upgrade subtract; balance never goes negative.
- Wave spawner that emits composition-defined batches on a schedule.
- Difficulty scaling of enemy HP and spawn rate per wave, and by Easy/Normal/Hard.

### Phase 2 — Towers
- Placement validates cell buildability (off-path, undecorated, unoccupied) and affordability.
- Four tower families: **Blaster Emplacement**, **Laser Turret**, **Missile Launcher**, **Ion Cannon**.
- Targeting priorities: First / Closest / Strongest, switchable per tower.
- Projectiles travel to targets and apply damage on impact.
- 4 upgrade tiers per tower, each raising damage/range/rate; costs scale per tier.
- Sell returns 70% of total invested credits.

### Phase 3 — Enemies
- Base attributes: HP, speed, armour, shield, bounty, radius, flying, boss.
- Variants: Stormtrooper, Scout Trooper, Battle Droid, Super Battle Droid, Droideka, AT-ST, AT-AT,
  TIE Fighter, TIE Interceptor, Dark Trooper, Royal Guard, Darth Vader, Emperor Palpatine.
- Path-following movement with per-enemy progress along the path.
- Dynamic health bars + shield bars; slow/stun status pips.
- Death awards bounty and removes the entity; leaks at the base cost lives.
- Boss flag for the final wave (or every 5th in endless) with a castable ability.

### Phase 4 — Weapons, abilities, effects
- Projectile types: single-target, splash, chain, ion.
- Status effects: slow (speed multiplier), stun (freeze), armour break (extra damage taken).
- Shields must be depleted (ion is efficient) before HP is damaged.
- Cooldown Force abilities: **Force Lightning** (AoE damage + stun), **Force Push** (AoE knockback),
  **Orbital Strike** (heavy AoE).
- Impact particles/rings/flashes per projectile type, plus damage floaters.
- Controllable **Jedi hero**: deploy, reposition by clicking the map, auto-attack, **Saber Sweep**.

### Phase 5 — UI, controls, HUD
- Main menu, planet select with difficulty, and a mission brief listing that planet's enemies + boss.
- Build dock cards showing icon, name, cost and stats; ability bar with cooldown fills.
- Placement preview: ghost turret + green/red cell highlight before placement.
- Contextual tower panel: upgrade, sell, targeting mode, live per-tower stats (kills, damage, range).
- Persistent HUD: Credits, Lives, Wave n/N, Score; low-lives warning pulse.
- Pause menu and speed toggle that scales the game clock.
- Victory / game-over overlays with a statistics grid, star rating, and next/retry/select actions.
- Non-blocking tutorial overlay; keyboard shortcuts (1-4 towers, H hero, Q/W/E abilities, R saber,
  N next wave, Space pause, Esc cancel).

### Phase 6 — Content & progression
- Four planets — **Tatooine**, **Hoth**, **Endor**, **Death Star** — each with its own terrain palette,
  decoration type, path, enemy pool and boss; later planets unlock as earlier ones are cleared.
- Star ratings by remaining lives; best score stored per planet.
- Endless Survival mode with unbounded escalating waves.

### Presentation
- Cohesive dark "hologram" theme (Orbitron / Rajdhani / Share Tech Mono), starfield + planet menu
  background, scanline + vignette over the canvas, animated toasts.
- Light theme and accent-colour options; reduce-motion option; volume sliders; quality setting.
- Responsive: desktop, tablet and phone (dock scrolls horizontally on narrow screens).
- Procedural sprite art (no image assets) with strong silhouettes and separation halos.

### Settings & persistence
- Theme (dark/light), holo accent colour, master/music/SFX volume, visual quality, default speed,
  reduce motion — all persisted to localStorage.
- Progress (unlocked planets, stars, best scores, lifetime totals) persisted to localStorage and
  resettable from Settings.

## Non-goals / constraints
- No external game libraries or imports; all code ships in `src/`.
- No server/multiplayer.
- Must run entirely client-side on the Perchance platform.
