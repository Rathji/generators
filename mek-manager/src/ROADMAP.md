# Atomic Roadmap — BattleTech Mercenary Manager

> **Status: COMPLETE** — all 21 tasks (7 phases) are implemented and verified.
> The live checklist in `main.pjs` → `features` (keys `f1`–`f21`) has every
> item at `done = true`; the page's Roadmap panel renders from that list via
> `src/framework.js` (Command → Roadmap). To track new work, flip the relevant
> item back to `false` and re-verify.
> Development notes, architecture map and balance notes: see `src/README.md`.

**Project:** A "Manager" game for a BattleTech mercenary squad. The player runs the **business and personnel** side of a mercenary company; **battle is simulated by AI**, and the game narrates it with detailed reports and generated images.

**Core pillars:**
- **Business & personnel:** hire/fire pilots, techs, support staff; buy/sell/refit/maintain mechs; manage C-bills (contracts, payroll, monthly overhead, repairs); choose contracts from a mission market
- **AI-simulated battle:** no manual tactics — resolve combat from unit stats, terrain, and mission type; output a detailed after-action report
- **Full mission & era scope:** classic mission types (assassination, base defense, capture/escort, raid, recon, garrison, objective raid…) vs. Inner Sphere *and* Clan factions, across any typical era (Succession Wars → Clan Invasion → Civil War → Jihad → Dark Age), which gates available tech, units, and opponents
- **Characterization:** every mech, pilot, and tech has its own generated image (portrait/unit art) and a distinct personality (traits, quirks, voice lines, relationships) surfacing in reports and events
- **Salvage & LosTech:** post-battle salvage (parts, weapons, armor, whole mechs) with utilization choices — sell, scrap, repair/refit, or rebuild in the mechbay; special Star League cache discovery events (rare LosTech extraction/security/use)

**Method:** Built with the Atomic Roadmap process — end-result-only, atomic granularity, sequential task numbering. Target agent: Perchance AI Helper.

---

### Delivered scope (tasks below are all complete and verified)

#### Phase 1: Personnel & Unit Foundation
1. **[x] Pilot & Staff Generation:** Create a system to generate personnel (Pilots, Techs, Support) with unique IDs, randomized personality traits, quirks, and associated portrait image prompts.
2. **[x] Mech Data Model:** Implement a data structure for Mechs containing chassis type, faction origin, current condition (HP/Armor), and equipped components.
3. **[x] Personnel Mapping:** Establish a relationship system linking Pilots to Mechs and Techs to the company payroll.
4. **[x] Personnel Interaction System:** Develop a dialogue/event trigger system that surfaces pilot personalities and relationships within narrative reports and company events.

#### Phase 2: Financial & Resource Management
5. **[x] Company Ledger:** Implement a financial tracker for C-bills (cash), handling income from contracts and deductions for payroll, monthly overhead, and repair costs.
6. **[x] Market Logic:** Create a marketplace for buying and selling Mechs, parts, and equipment with fluctuating prices based on the selected Era.
7. **[x] Payroll & Logistics Loop:** Build a recurring billing cycle that calculates total company maintenance and personnel salaries based on staff count and equipment quality.

#### Phase 3: Era & World Setting
8. **[x] Era Configuration:** Implement a setting selector (Succession Wars through Dark Age) that filters available technology, available Mechs, and enemy faction types.
9. **[x] Faction Relationship Matrix:** Create a system to track the company's standing with Inner Sphere and Clan factions, affecting contract availability and pricing.

#### Phase 4: Mission Market & Contract Logic
10. **[x] Contract Generator:** Create a system to generate missions of varying types (Assassination, Base Defense, Capture/Escort, Raid, Recon, Garrison, Objective Raid).
11. **[x] Mission Parameters:** Define mission-specific constraints: target strength, terrain modifiers, victory conditions, and payout amounts.
12. **[x] Contract Acceptance Flow:** Implement the workflow for selecting a contract, assigning a lance of Mechs/Pilots, and triggering the simulation.

#### Phase 5: AI Battle Simulation & Reporting
13. **[x] Combat Resolver:** Build a simulation engine that calculates battle outcomes based on unit stats, terrain, and mission type without manual user input.
14. **[x] Damage Calculation:** Implement a system to track component-level damage and pilot injuries during the simulation.
15. **[x] Narrative Report Generator:** Create a system that transforms simulation logs into multi-paragraph narrative after-action reports, incorporating pilot personalities and specific battle events.
16. **[x] Visual Asset Integration:** Implement a trigger for generating battle-scene and damage-report images based on the simulation results.

#### Phase 6: Salvage & Discovery
17. **[x] Salvage Calculation:** Develop a post-battle loot system that determines which parts or Mechs are recoverable based on simulation damage.
18. **[x] Salvage Processing:** Implement a choice-based menu for salvaged items: Sell, Scrap, Repair/Refit, or Add to Mechbay.
19. **[x] Star League Cache Events:** Create a random encounter system for discovering LosTech caches, including the logic for extracting and securing rare hardware.

#### Phase 7: Company Growth & Loop
20. **[x] Mechbay Management:** Create a functional interface for refitting Mechs using purchased or salvaged parts.
21. **[x] Game Loop Integration:** Connect the Mission -> Battle -> Salvage -> Finance -> Refit cycle into a cohesive gameplay loop.
