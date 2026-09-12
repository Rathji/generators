You are building Tower Defense Star Wars Edition. Focus entirely on delivering robust, modular, and testable features based on the functional requirements provided.

### Workflow & Execution Rules
1. Initialize a `.pjs` file in the project root containing the structured TODO checklist of the tasks detailed below.
2. **STRICT HOLD - DO NOT START IMPLEMENTATION:** Do NOT write any implementation code, create source files, or execute any task yet. Wait until I explicitly instruct you that the backlog is complete.
3. Once I give you the signal to proceed, pick ONLY the first uncompleted task from `.pjs`.
4. Implement that single task, write corresponding validation tests, update `.pjs` to mark it complete, and stop to await review before proceeding to the next task.

---

### Core Framework Tasks for `.pjs`


#### Phase 1: Core Game Foundation
1. **[ ] Grid & Path System:** Implement a grid-based map with a defined, non-linear path that enemies must follow from start to finish.
2. **[ ] Game State Machine:** Implement a global state manager to handle transitions between `MENU`, `RUNNING`, `PAUSED`, `VICTORY`, and `GAME_OVER`.
3. **[ ] Game Loop Execution:** Create the main real-time update loop that manages timing, entity updates, and state transitions.
4. **[ ] Player Economy:** Implement a credit system that handles adding credits (per kill) and subtracting credits (build/upgrade/sell costs), preventing negative balances.
5. **[ ] Wave Spawner:** Implement a wave system that spawns enemies in batches based on a predefined sequence.
6. **[ ] Difficulty Scaling:** Implement a scaling multiplier that increases enemy HP and spawn rates as wave numbers increase.


#### Phase 2: Tower System
7. **[ ] Tower Placement Logic:** Implement a placement system that validates cell availability (is it a buildable grid cell?) and player affordability.
8. **[ ] Tower Type Definitions:** Implement the functional attributes for Laser Turret, Missile Launcher, Ion Cannon, and Blaster Emplacement.
9. **[ ] Targeting Priority:** Implement logic for towers to select targets based on three modes: `First` (furthest along path), `Closest` (nearest to tower), and `Strongest` (highest HP).
10. **[ ] Projectile Mechanics:** Implement the firing system where towers instantiate projectiles that travel to targets and apply damage on impact.
11. **[ ] Upgrade Tiers:** Implement a multi-tier upgrade system for each tower type that increases damage/range and scales the cost per level.
12. **[ ] Sell & Refund Logic:** Implement the ability to dismantle towers and return a percentage of the original build cost to the player economy.


#### Phase 3: Enemy System
13. **[ ] Enemy Attribute Framework:** Implement a base enemy class with variables for HP, speed, armor, shield, and credit bounty.
14. **[ ] Faction-Based Variants:** Implement specific stats for Stormtroopers, Battle Droids, Scouts, AT-STs, AT-ATs, and TIE Fighters (flying).
15. **[ ] Path-Following Movement:** Implement the movement logic that forces enemies to follow the defined path nodes sequentially.
16. **[ ] Health & Shield Visuals:** Implement dynamic health bars and shield indicators that track and display enemy remaining HP in real-time.
17. **[ ] Destruction & Bounty Logic:** Implement the trigger for enemy death, including the removal of the entity and the awarding of credits to the player.
18. **[ ] Boss Wave Logic:** Implement a "Boss" flag for specific enemies that grants them significantly higher HP and unique scale/visuals.

#### Phase 4: Weapons, Abilities & Effects
19. **[ ] Projectile Logic System:** Implement a system to handle various projectile types (single target, splash, chain) that calculates damage based on projectile type and target armor upon collision.
20. **[ ] Status Effect Engine:** Create a mechanism to apply and track temporary state modifiers on enemies, specifically slow (movement speed reduction), stun (complete freeze), and armor break (increased damage taken).
21. **[ ] Shield & Ion Mechanics:** Implement a shield layer for specific enemies that must be depleted by ion-type projectiles before the primary health pool can be damaged.
22. **[ ] Force Ability Trigger:** Implement a cooldown-based system for active player abilities (e.g., Force Lightning) that applies area-of-effect stun and damage to all enemies within a defined radius.
23. **[ ] Splash & Chain Calculation:** Define the logic for "splash" damage (circular area of effect) and "chain" damage (jumping from one enemy to the nearest neighbor within a set distance).
24. **[ ] Visual Feedback System:** Create a trigger system for impact particles, where specific projectile types spawn corresponding visual effects (laser flashes, explosions) upon target collision.


#### Phase 5: UI, Controls & HUD
25. **[ ] Game State Navigation:** Implement a main menu and level selection screen that allows the user to initialize specific map configurations and difficulty settings.
26. **[ ] Tower Build Menu:** Create a build interface containing tower selection cards that display the tower's cost, attack type, and base stats.
27. **[ ] Placement Preview System:** Implement a cursor-follow ghost image of the selected tower that highlights the target cell in green (valid) or red (invalid/blocked) before placement.
28. **[ ] Tower Management Interface:** Build a contextual UI that appears upon clicking an existing tower, providing options to upgrade (cost vs. benefit) or sell (partial credit return).
29. **[ ] Real-time HUD:** Implement a persistent overlay tracking current credits, remaining lives, current wave number, and cumulative score.
30. **[ ] Session Controls:** Add a pause menu and a game-speed toggle (1x, 2x, 3x) that scales the global game clock.
31. **[ ] End-Game State Screens:** Implement victory and game-over overlays that trigger based on wave completion or lives reaching zero, displaying final statistics.
32. **[ ] Tutorial Overlay:** Create a non-blocking help overlay that introduces basic mechanics and control schemes to new players.

#### Phase 6: Content & Progression
33. **[ ] Planet Level Mapping:** Implement a level selection system mapping specific planetary themes (Tatooine, Hoth, Endor, Death Star) to unique terrain visual sets and predefined enemy spawn compositions.
34. **[ ] Progression Gating:** Create a level unlock system where subsequent planets remain locked until the previous planet's final stage is completed.
35. **[ ] Difficulty Scaling:** Implement a difficulty modifier (Easy, Normal, Hard) that applies multipliers to enemy health, damage, and spawn frequency.
36. **[ ] Hero Unit Integration:** Implement a "Hero" entity class that allows for a single, controllable unit with a cooldown-based active ability and movement capability.
37. **[ ] Star Rating Calculation:** Develop a post-game scoring system that assigns a 1-3 star rating based on remaining health and time elapsed.
38. **[ ] Level State Persistence:** Implement a save/load system to track unlocked levels and high scores across different game sessions.


#### Phase 7: Audio, Visual Polish & Performance
39. **[ ] SFX Trigger System:** Implement a sound manager that triggers specific audio clips (lasers, explosions, UI clicks) based on game event hooks.
40. **[ ] Dynamic Music Controller:** Create a background music system that handles looping tracks and transitions between menu and combat states.
41. **[ ] Star Wars UI Skinning:** Apply a themed visual layer to all UI elements, including holographic borders and Star Wars-style typography.
42. **[ ] Combat Visual Feedback:** Implement floating damage numbers and hit-flash animations on enemies upon receiving damage.
43. **[ ] Entity Object Pooling:** Implement a recycling system for projectiles and enemies to eliminate runtime instantiation overhead.
44. **[ ] Performance Capping:** Establish a maximum entity count limit and implement an automated cleanup for off-screen or expired game objects.

#### Phase 8: Settings, Persistence & Meta-Game
45. **[ ] In-Game Settings Menu:** Provide a UI overlay to adjust master audio volume, default game speed (1x, 1.5x, 2x), and visual quality presets, ensuring changes apply immediately to the active game state.
46. **[ ] Persistent Save System:** Implement a local storage mechanism to save and retrieve unlocked levels, star ratings, high scores, credits balance, and user settings across page reloads.
47. **[ ] Post-Game Statistics Summary:** Generate a results screen upon game completion or failure displaying total kills, credits earned, total damage dealt, and accuracy percentage.
48. **[ ] Endless Survival Mode:** Implement a game mode where waves continue indefinitely with a scaling difficulty multiplier applied to enemy health and spawn rates every 5 waves.
49. **[ ] Responsive Layout Adaptation:** Implement dynamic scaling and UI repositioning to ensure the game canvas and menu elements are fully functional and accessible on both desktop and mobile screen dimensions.
