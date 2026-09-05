# Chaos Board Game — Feature Reference

A system-level reference of Chaos Board Game's features (a chaotic hot-seat/vs-bots digital board game inspired by Board Game Online). Useful as a checklist for designing chaotic multiplayer roll-and-move games driven by absurd item effects, global random events, and comeback mechanics.

## Core Loop & Turn Structure
- Hot-seat multiplayer (2–4 human players) plus bot opponents; each game is a fixed number of turns (default 45)
- Sequential turns: start-of-turn upkeep → roll → move → resolve landing space → optional actions (use items, buy/sell, challenge, bet, rally, skip) → end turn
- Turn phases are enforced by a state machine (rolling → resolved → ended); a 30-second timeout auto-skips stalled bot turns
- Skip action (forfeits the roll) with a small consolation reward via feat
- Turn pacing supports "Auto mode" — human players are driven by the bot AI so the game can be watched hands-off
- Seeded RNG per game (deterministic replay of a session's random stream)

## Movement & Dice
- Roll two d6 plus modifiers: base roll + speed bonus + doubles bonus + class bonuses + weather + crowd favor + item/status effects (drunk penalizes, dehydrated −1)
- Doubles grant +2 bonus movement; snake-eyes (1+1) cost 2 Rupees
- Roll streaks: a chance to roll again immediately, chaining up to a cap
- Movement can be pushed forward or backward by items, knockback, warp, and events; landing on START collects Rupees (class-scaled)
- Laps tracked; completing a lap wraps around the 100-space board and counts toward advance/standing
- Item and status effects can force odd dice, guarantee high rolls, absorb rolls, or add flat speed; movement modifiers stack and are recomputed each roll

## Board & Spaces
- Procedurally generated 100-space track each game: space types shuffled into randomized positions each session
- Space types: Start, Shop, Battle, Treasure, Event, Trap, Duel, Slot, Warp, Bank, Star, Arena, Golden
- A single Golden Space relocates every few turns — landing grants a Rupee/XP bonus
- Slot spaces run a progressive jackpot that grows each spin and pays out on matching triples (class-modified payouts)
- Warp portals teleport the player to a random destination (no re-trigger on arrival)
- Traps randomize between damage, money loss, and turn-skip; evasion via class ability or items
- Stars collected on Star spaces; collecting three pays a bonus (Rupees + random item)
- The Arena is a multi-wave monster gauntlet with per-wave loot and a completion trophy
- Players may also place board hazards (traps, TNT, glue, card fields) that affect later landings

## Items & Inventory
- Large database of bizarre one-shot/charged/passive items, each with name, tooltip, price, charges, and cooldown
- Rarity tiers (common → legendary/gold) color-coded; tier affects availability and pricing
- Inventory cap enforces decisions: drop/sell/use management under a hard slot limit
- Items are auto-classified into categories (weapon, armor, gadget, tool, container, jewelry, magical, living, food, drink, metal, book…) via a name-keyword classifier with explicit overrides; category drives archetype behavior and specialist items (e.g. a magnet that yanks metal)
- Use effects cover movement, healing, damage, stealing, knockback, statuses, summoning, and board manipulation; per-item cooldowns gate reuse
- Combo system: chaining multiple item uses on one turn builds a streak with bonus Rupee payouts
- Enchantment system modifies items (gilded, sparkling, mechanical, frozen, cursed, glitched, fused, blessed) — some are beneficial, some debuffs that must be removed
- Passive items trigger each turn (income, cleansing, planting traps, immunity); some feature charge-meter items that build toward an enhanced "ultimate" activation
- Lifecycle items (e.g. dragon eggs that hatch → grow → ascend → leave an orb; books that teach feats) give long-term item investment
- Item economy includes stealing, freezing (unusable for N turns), glitching (mutates into a random item then fades), and crafting

## Resource & Market Economy
- Dual wealth: pocket Rupees (spendable cash) + Bank (savings with interest and bonuses)
- Rotating market: a sale category (−25%, better for merchants) and a hot category (+50% sell price) refresh every few turns
- Shops offer a small randomized stock; buy/sell with tiered pricing, discount feats, and class perks (e.g. BOGO coupons, loyalty bonuses)
- Sell values scale with enchantments and market conditions; a Bull Market tide raises all sell prices
- Bank spaces support deposit/withdraw, savings accounts/CDs that mature, and risk/reward options (bank errors, heists requiring a gun, insurance)
- Progressive gambling economies: slot jackpot, a persistent Grand Lottery pot (grows each turn, ticket purchase on event, match-tier payouts, mega-jackpot escalation), and coin-flip/double-or-nothing events
- Pity mechanics: a player who fails to earn for many turns receives a consolation payout (scaled on difficulty)

## Combat & Conflict
- Battle spaces: turn-scaled monster duels (monster HP/attack scale with turn number and difficulty); victory pays Rupees/loot/XP, defeat damages or kills
- Duel spaces and class challenge abilities: head-to-head 2d6 contests with class modifiers, damage, and Rupee stakes
- Arena: a 3-wave boss gauntlet with escalating enemies, per-wave loot, and a completion trophy (dying midway forfeits half the winnings)
- Player kills are credited properly (killer, XP, bounties, trophies, quests); statuses with damage-over-time can score kills
- Death/respawn: killed players are dead for a fixed number of turns, then resurrect at START at partial HP
- Bounties: periodically posted on a player, the value rises if unclaimed, and is collected by whoever kills them
- Player-vs-player items and statuses: knockback, stealing, freezing, curses, and board hazards

## Character Progression
- Classes with asymmetric passives and signature actions: shop/market specialist, bloodrage combatant, speedster/dodge runner, gambler with hot-streak and betting
- XP and levels: leveling raises max HP, heals, and pays small Rupees; milestone trophies
- Feats: permanent learnable perks (shopping discounts, trap evasion, spell deflection, bonus movement options) acquired from books and divine cards
- Quests: a rotating set of per-player objectives (use items, visit shops, win battles, gain Rupees, complete a lap, win duels, spin slots…) that pay Rupees + XP on completion
- Trophy/achievement system spanning combat, economy, survival, and milestone goals
- Persistent cross-game records (wins, kills, jackpots, class wins) feeding a Hall of Legends with prestige ranks

## Comeback & Global Systems
- Crowd Favor: players trailing the leader build favor passively; spending it via RALLY triggers escalating rewards (heal, speed, roll bonus, crowd boos against a rival)
- Chaos Tides: a global event every few turns (meteor damage, market surge, mass poison, underdog feast, monster empowerment, jackpot carnival) — some persist for several turns with board-wide effects
- Weather system that shifts each turn with per-player effects (speed, douse fire, freeze item, catch fire, poison, meteor damage, windfall)
- Rotating event deck on Event spaces covering loot, hazards, social interactions, gambling, and themed sub-systems (snake encounters, witches, fortune tellers, taxes, wishing wells)
- Persistent divine-favor economy at an Altar: offering Rupees earns god boons and favor, culminating in a powerful Avatar state
- Underdog and pity systems keep trailing players engaged without granting free snowball power

## Win Condition & Endgame
- Winner = highest net worth (Rupees + bank) at the end of the fixed turn count
- Overtime: if the top two are within a narrow net-worth margin at the finish, the game extends a few extra turns to decide it
- Full end-of-game recap: final standings, per-player stats, match highlights, MVP, and trophy/quest summaries
- Game results persist to a local record (win rate, best wealth, kill/monster/jackpot counts, class-specific wins) and award prestige ranks
