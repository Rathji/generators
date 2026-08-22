import { GameState } from "./engine/state.js";
import { PartyManager } from "./engine/party.js";
import { Inventory } from "./engine/inventory.js";
import { Character } from "./engine/character.js";
import { EquipSystem } from "./engine/equipment.js";
import { DialogueEngine, createDialogueWorld } from "./engine/dialogue.js";
import { CombatResolver } from "./engine/combat.js";
import { MapRenderer } from "./engine/renderer.js";
import { TileMap, DIRS } from "./engine/grid.js";
import { GridEntity, MovementSystem } from "./engine/movement.js";
import { TriggerSystem } from "./engine/interactions.js";
import { QuestTracker } from "./engine/quests.js";
import { QUESTS } from "./data/quests.js";
import { GateSystem } from "./engine/gates.js";
import { MapManager, TransitionManager } from "./engine/transitions.js";
import { MAPS } from "./data/maps.js";
import { SaveManager } from "./engine/save.js";
import { ShopSystem } from "./engine/shop.js";
import { SHOPS } from "./data/shops.js";
import { InnSystem } from "./engine/inn.js";
import { INNS } from "./data/inns.js";
import { FogOfWar, MiniMap } from "./engine/fog-of-war.js";
import { EnemyTemplateSystem } from "./engine/enemies.js";
import { EncounterGenerator } from "./engine/encounters.js";
import { SpellCastingSystem } from "./engine/spellcasting.js";
import { TargetResolver } from "./engine/targets.js";
import { SpellLearningSystem } from "./engine/spell-learning.js";
import { applyElemental, elementalMultiplier, isImmune, isResistantTo, isWeakTo } from "./engine/affinity.js";
import { ELEMENTS, ELEMENT_NAMES } from "./data/elements.js";
import { ENEMIES, ENEMY_GROUPS } from "./data/enemies.js";
import { ENCOUNTERS } from "./data/encounters.js";
import { ITEMS } from "./data/items.js";
import { SPELLS } from "./data/spells.js";
import { EnemyAI } from "./engine/enemy-ai.js";
import { BossPhaseController } from "./engine/boss.js";
import { CombatRewardResolver } from "./engine/rewards.js";
import { TerrainRules, terrainRulesFor, TRAVEL_MODES, TERRAIN_TYPES } from "./engine/terrain.js";
import { SideQuestSystem } from "./engine/side-quests.js";
import { SIDE_QUESTS } from "./data/side-quests.js";
import { CinematicSystem } from "./engine/cinematic.js";
import { MAIN_STORY } from "./data/story.js";
import { StoryDirector } from "./engine/events.js";
import { QuestLogSystem } from "./engine/quest-log.js";
import { ConsumableSystem } from "./engine/consumables.js";
import { EquipmentStatSystem } from "./engine/equip-stats.js";
import { ItemTriggerSystem } from "./engine/item-triggers.js";
import { ItemRaritySystem } from "./engine/rarity.js";
import { MenuSystem } from "./engine/menus.js";
import { SoundTriggerSystem, SynthAudio } from "./engine/sounds.js";
import { GameOverSystem } from "./engine/gameover.js";
import { NpcPlacementSystem } from "./engine/npcs.js";
import { NPC_PLACEMENTS } from "./data/npcs.js";
import { BuildingSystem } from "./engine/buildings.js";
import { BUILDINGS } from "./data/buildings.js";
import { RARITY } from "./data/rarity.js";
import { TownEventSystem } from "./engine/town-events.js";
import { TOWN_EVENTS } from "./data/town-events.js";
import { AmbientNpcSystem } from "./engine/ambient.js";
import { DungeonSystem } from "./engine/dungeons.js";
import { DUNGEONS } from "./data/dungeons.js";
import { ChestSystem } from "./engine/chests.js";
import { CHESTS } from "./data/chests.js";
import { NpcRewardSystem } from "./engine/npc-rewards.js";
import { NPC_REWARDS } from "./data/npc-rewards.js";
import { HintSystem } from "./engine/hints.js";
import { HINTS } from "./data/hints.js";
import { GearTierSystem } from "./engine/gear-tiers.js";
import { WEAPON_TIERS, ARMOR_TIERS } from "./data/gear-tiers.js";
import { MonsterArchetypeSystem } from "./engine/archetypes.js";
import { ENEMY_ARCHETYPES, ENEMY_ARCHETYPE_ASSIGN } from "./data/archetypes.js";
import { MonsterGroupingSystem } from "./engine/grouping.js";
import { MonsterAbilitySystem } from "./engine/monster-abilities.js";
import { MONSTER_ABILITIES, MONSTER_ABILITY_ASSIGN } from "./data/monster-abilities.js";
import { MonsterRewardTable } from "./engine/monster-rewards.js";
import { MONSTER_REWARDS, REWARD_TOTALS } from "./data/monster-rewards.js";
import { EnvironmentObjectSystem } from "./engine/environment.js";
import { ENVIRONMENT_OBJECTS } from "./data/environment-objects.js";
import { MAP_SONGS } from "./data/map-songs.js";
import { RegionTransitionSystem } from "./engine/region-transitions.js";
import { BoundarySystem } from "./engine/boundaries.js";
import { BOUNDARIES } from "./data/boundaries.js";
import { BalanceSystem } from "./engine/balance.js";
import { BALANCE } from "./data/balance.js";
import { SaveCompatibilitySystem } from "./engine/save-compat.js";
import { TurnOrderQueue } from "./engine/turn-order.js";
import { CombatStateMachine } from "./engine/combat-states.js";
import { BuffSystem } from "./engine/buffs.js";
import { BUFF_DEFS } from "./data/buffs.js";
import { MultiTargetResolver } from "./engine/multi-target.js";
import { SpellAnimationSyncSystem } from "./engine/spell-animation-sync.js";
import { MagicStatusInflictionSystem } from "./engine/magic-status.js";
import { ClassPassiveSystem } from "./engine/class-passives.js";
import { CLASS_PASSIVES } from "./data/class-passives.js";
import { ShortcutSystem } from "./engine/shortcuts.js";
import { SHORTCUTS } from "./data/shortcuts.js";
import { RandomEventSystem } from "./engine/random-events.js";
import { RANDOM_EVENTS } from "./data/random-events.js";
import { PuzzleSystem } from "./engine/puzzles.js";
import { PUZZLES } from "./data/puzzles.js";
import { PlotSequenceSystem } from "./engine/plot.js";
import { PLOT } from "./data/plot.js";
import { CrystalSystem } from "./engine/crystals.js";
import { CRYSTALS } from "./data/crystals.js";
import { WorldStateSystem } from "./engine/world-state.js";
import { WORLD_BRIDGES, WORLD_GATES } from "./data/world-state.js";
import { EndingSystem } from "./engine/ending.js";
import { ENDING_SCENES, CREDITS } from "./data/ending.js";
import { GameCompletionSystem } from "./engine/completion.js";
import { FlavorSystem } from "./engine/flavor.js";
import { FLAVOR_TEXTS } from "./data/flavor.js";
import { StatusEffectSystem, STATUS_DEFS } from "./engine/status.js";
import { CriticalHitSystem } from "./engine/criticals.js";
import { SynergySystem, SYNERGY_DEFS } from "./engine/synergy.js";
import { TargetPrioritySystem } from "./engine/target-priority.js";
import { SpellEffectSystem } from "./engine/spell-effects.js";
import { SpellLevelingSystem } from "./engine/spell-levels.js";
import { SpellVisualCueSystem, SPELL_VISUALS } from "./engine/spell-visuals.js";
import { ManaRegenSystem } from "./engine/mana-regen.js";
import { WeaponScalingSystem } from "./engine/weapon-scaling.js";
import { ArmorMitigationSystem } from "./engine/armor-mitigation.js";
import { AccessorySystem } from "./engine/accessories.js";
import { ConsumableUseCaseMapper } from "./engine/consumables.js";
import { LandmarkMarkerSystem } from "./engine/landmarks.js";
import { LANDMARKS } from "./data/landmarks.js";
import { WorldEventSystem } from "./engine/world-events.js";
import { WORLD_EVENTS } from "./data/world-events.js";
import { TrialSystem } from "./engine/trials.js";
import { TRIALS, TRIAL_REWARDS } from "./data/trials.js";
import { BestiarySystem } from "./engine/bestiary.js";
import { BESTIARY } from "./data/bestiary.js";
import { CraftingSystem } from "./engine/crafting.js";
import { RECIPES } from "./data/recipes.js";
import { EnchantingSystem } from "./engine/enchanting.js";
import { ENCHANTS } from "./data/enchants.js";
import { WaystoneSystem } from "./engine/waystones.js";
import { WAYSTONES } from "./data/waystones.js";
import { NgPlusSystem } from "./engine/ngplus.js";
import { NGPLUS } from "./data/ngplus.js";
import { GameBootSystem } from "./engine/boot.js";
import { SaveSlotSystem } from "./engine/save-slots.js";
import { TitleController } from "./engine/title.js";
import { CommandMenuSystem } from "./engine/command-menu.js";
import { NEW_GAME } from "./data/new-game.js";
import { setExtraItemMods } from "./engine/stats.js";
import { setExtraBuffMods } from "./engine/stats.js";
import { setExtraStatHook } from "./engine/stats.js";
import { setBrokenItems } from "./engine/stats.js";
import { TravelAccessSystem, TRAVEL_ACCESS } from "./engine/travel.js";
import { WorldMapTerrainSystem, TERRAIN_COSTS, TERRAIN_LABELS } from "./engine/world-terrain.js";
import { ScreenTransitionSystem } from "./engine/screen-transitions.js";
import { TextScroller } from "./engine/text-scroller.js";
import { ChipTune } from "./engine/music-engine.js";
import { MusicController } from "./engine/music-controller.js";
import { SONGS } from "./data/songs.js";
import { classifyMap, REGION_SONGS } from "./data/music-regions.js";
import { InputManager } from "./engine/input.js";
// Task #136-#145: terrain-speed, overworld fog, the game clock + NPC
// schedules, group conversations, NPC exchanges, proximity barks, gear-set
// bonuses, use-case validation, and gear durability.
import { TerrainSpeedSystem, TERRAIN_SPEED, SPEED_LABELS } from "./engine/terrain-speed.js";
import { WorldMapFogSystem } from "./engine/world-fog.js";
import { GameClock, HOURS_PER_DAY, PERIODS } from "./engine/game-clock.js";
import { NpcScheduleSystem } from "./engine/npc-schedules.js";
import { NPC_SCHEDULES } from "./data/npc-schedules.js";
import { GroupConversationSystem } from "./engine/group-conversation.js";
import { NpcExchangeSystem } from "./engine/npc-exchanges.js";
import { NPC_EXCHANGES } from "./data/npc-exchanges.js";
import { NpcBarkSystem } from "./engine/npc-barks.js";
import { NPC_BARKS } from "./data/npc-barks.js";
import { GearSetBonusSystem } from "./engine/gear-sets.js";
import { GEAR_SETS } from "./data/gear-sets.js";
import { UseCaseValidator } from "./engine/use-case-validator.js";
import { GearDurabilitySystem } from "./engine/gear-durability.js";
import { GEAR_DURABILITY } from "./data/gear-durability.js";

function createDefaultParty() {
  const party = new PartyManager({ gold: 150 });
  party.add(new Character({ id: "hero", name: "Hero", classId: "warrior" }));
  party.add(new Character({ id: "mage", name: "Mage", classId: "blackMage" }));
  party.add(new Character({ id: "healer", name: "Healer", classId: "whiteMage" }));
  return party;
}

function createGame() {
  const inventory = new Inventory({ maxSlots: 30, maxWeight: 100 });
  inventory.add("potion", 5);
  inventory.add("crystalKey", 1);
  const party = createDefaultParty();
  const state = new GameState();
  state.setParty(party);
  state.setInventory(inventory);
  state.setLocation("cornelia", 7, 5, "S");
  state.setFlag("intro_seen", true);
  return { state, party, inventory };
}

const game = createGame();
const dialogueWorld = createDialogueWorld(game);
// Task #138: the game clock — day/hour advances with overworld steps and
// battles; NPC schedules consume it. Persists as raw flags on GameState.
const gameClock = new GameClock({ state: game.state });
// Task #102/#103/#105: the four crystals, the bridges/gates they reveal,
// and the end-of-game completion (Free Roam) state. All read live state, so
// restoring a crystal instantly opens its bridge across the world map.
const crystals = new CrystalSystem(CRYSTALS, { state: game.state });
const worldState = new WorldStateSystem(WORLD_BRIDGES, WORLD_GATES, { state: game.state });
const completion = new GameCompletionSystem({ state: game.state });

const maps = new MapManager();
for (const def of MAPS) maps.register(def);
const transitions = new TransitionManager(maps);
transitions.addLink({ fromMap: "overworld", fromX: 7, fromY: 9, toMap: "cornelia", toX: 6, toY: 6, facing: "N" });
transitions.addLink({ fromMap: "cornelia", fromX: 6, fromY: 7, toMap: "overworld", toX: 7, toY: 9, facing: "S" });
transitions.addLink({ fromMap: "cornelia", fromX: 5, fromY: 6, toMap: "cornelia_inn", toX: 4, toY: 4, facing: "N" });
transitions.addLink({ fromMap: "cornelia_inn", fromX: 4, fromY: 5, toMap: "cornelia", toX: 5, toY: 6, facing: "N" });
transitions.addLink({ fromMap: "overworld", fromX: 10, fromY: 4, toMap: "caves_of_cornelia", toX: 9, toY: 4, facing: "N" });
transitions.addLink({ fromMap: "caves_of_cornelia", fromX: 9, fromY: 5, toMap: "overworld", toX: 10, toY: 4, facing: "S" });
transitions.addLink({ fromMap: "overworld", fromX: 2, fromY: 8, toMap: "pravog", toX: 6, toY: 8, facing: "N" });
transitions.addLink({ fromMap: "pravog", fromX: 7, fromY: 8, toMap: "overworld", toX: 2, toY: 8, facing: "S" });
transitions.addLink({ fromMap: "overworld", fromX: 1, fromY: 6, toMap: "marsh_cave", toX: 7, toY: 7, facing: "N" });
transitions.addLink({ fromMap: "overworld", fromX: 16, fromY: 13, toMap: "elfheim", toX: 7, toY: 4, facing: "N" });
transitions.addLink({ fromMap: "elfheim", fromX: 7, fromY: 7, toMap: "overworld", toX: 16, toY: 13, facing: "S" });
transitions.addLink({ fromMap: "overworld", fromX: 5, fromY: 5, toMap: "mount_gulg", toX: 7, toY: 7, facing: "N" });
  transitions.addLink({ fromMap: "overworld", fromX: 13, fromY: 2, toMap: "chaos_shrine", toX: 7, toY: 5, facing: "N" });
  transitions.addLink({ fromMap: "overworld", fromX: 14, fromY: 13, toMap: "gnome_tunnels", toX: 7, toY: 5, facing: "N" });
  transitions.addLink({ fromMap: "overworld", fromX: 6, fromY: 2, toMap: "wind_shrine", toX: 7, toY: 5, facing: "N" });
  transitions.addLink({ fromMap: "overworld", fromX: 20, fromY: 11, toMap: "windfall", toX: 7, toY: 6, facing: "N" });
  transitions.addLink({ fromMap: "windfall", fromX: 7, fromY: 7, toMap: "overworld", toX: 20, toY: 11, facing: "S" });
  transitions.addLink({ fromMap: "windfall", fromX: 10, fromY: 1, toMap: "sea_shrine", toX: 7, toY: 5, facing: "N" });
  transitions.addLink({ fromMap: "overworld", fromX: 2, fromY: 10, toMap: "lighthouse", toX: 7, toY: 5, facing: "N" });
  // Task #121: the Ember Sanctum in the north-east peaks — airship-only.
  transitions.addLink({ fromMap: "overworld", fromX: 18, fromY: 2, toMap: "ember_sanctum", toX: 7, toY: 5, facing: "N" });
  // Task #131: the forge-depths door leads down into Dwarfholm.
  transitions.addLink({ fromMap: "mount_gulg_b2", fromX: 1, fromY: 1, toMap: "dwarfholm", toX: 7, toY: 6, facing: "N" });
  transitions.addLink({ fromMap: "dwarfholm", fromX: 7, fromY: 7, toMap: "mount_gulg_b2", toX: 1, toY: 1, facing: "S" });
  // Task #132: Dwarfholm's Forge front leads into the Dwarven Forge.
  transitions.addLink({ fromMap: "dwarfholm", fromX: 10, fromY: 1, toMap: "forge_upper", toX: 7, toY: 5, facing: "N" });
  // Task #142: the Glacier Isle's frozen port, reached only by ship through
  // the channel east of Windfall. Its cavern door leads into the Frozen
  // Caverns.
  transitions.addLink({ fromMap: "overworld", fromX: 24, fromY: 11, toMap: "glacierport", toX: 7, toY: 6, facing: "N" });
  transitions.addLink({ fromMap: "glacierport", fromX: 7, fromY: 7, toMap: "overworld", toX: 24, toY: 11, facing: "S" });
  transitions.addLink({ fromMap: "glacierport", fromX: 10, fromY: 1, toMap: "frozen_upper", toX: 7, toY: 5, facing: "N" });
  // Task #151: the rift beneath the Chaos Shrine's Dark Altar leads into the
  // Labyrinth of Time — opened only when every fiend of the realm is dead.
  transitions.addLink({ fromMap: "chaos_shrine_b2", fromX: 1, fromY: 5, toMap: "time_rift", toX: 7, toY: 5, facing: "N" });
  // Task #198: two more gated doors — the Drowned Vault's tide-door in the
  // Sunken Sanctum, and the Hall of Trials beneath Castle Cornelia. Both are
  // blocked by gates (checked on step in the demo) until their requirements
  // are met.
  transitions.addLink({ fromMap: "sea_shrine_b2", fromX: 1, fromY: 5, toMap: "sea_vault", toX: 7, toY: 5, facing: "N" });
  transitions.addLink({ fromMap: "cornelia", fromX: 13, fromY: 1, toMap: "trial_hall", toX: 7, toY: 5, facing: "N" });

const triggers = new TriggerSystem(dialogueWorld);
triggers
  .add({ id: "guard_talk", mapId: "cornelia", x: 8, y: 3, on: "interact", action: { type: "dialogue", dialogueId: "cornelia.guard" } })
  .add({ id: "inn_sign", mapId: "cornelia", x: 4, y: 1, on: "interact", action: { type: "dialogue", dialogueId: "sign.inn" } })
  .add({ id: "bandit_ambush", mapId: "overworld", x: 12, y: 2, on: "step", action: { type: "battle", group: "bandits" } })
  .add({ id: "cave_entrance", mapId: "overworld", x: 3, y: 2, on: "interact", action: { type: "transition", mapId: "cornelia_inn", x: 4, y: 4, facing: "N" } });

const gates = new GateSystem(dialogueWorld);
gates.add({
  id: "elfheim_gate",
  mapId: "overworld",
  x: 14,
  y: 9,
  require: { item: "crystalKey" },
  deniedDialogue: "A heavy iron gate blocks the mountain pass. You need something to unlock it.",
});
// Task #116: the Drowned Vault's tide-sealed door in the Sunken Sanctum.
gates.add({
  id: "vault_gate",
  mapId: "sea_shrine_b2",
  x: 1,
  y: 5,
  require: { item: "tideKey" },
  deniedDialogue: "The vault door is sealed by coral and salt — only the Tide Key can open it.",
});
// Task #142: the Frozen Caverns' permafrost door, thawed only by the
// embers of the Forge Colossus's defeat.
gates.add({
  id: "frozen_cavern_gate",
  mapId: "glacierport",
  x: 10,
  y: 1,
  require: { flag: "story_forge_colossus_defeated" },
  deniedDialogue: "The cavern mouth is sealed in permafrost — only embers hot as the Forge Colossus could thaw it.",
});
// Task #151: the rift under the Dark Altar — torn open only once the realm's
// every fiend (up to the Ember Fiend) has fallen.
gates.add({
  id: "chrono_rift_gate",
  mapId: "chaos_shrine_b2",
  x: 1,
  y: 5,
  require: { flag: "story_ember_fiend_defeated" },
  deniedDialogue: "The altar floor is cold and seamless here — no door. Only the fall of every fiend in the realm could tear the rift open.",
});
// Task #161: the Hall of Trials' door beneath Castle Cornelia — sealed until
// the Keeper of Time himself falls and the age of darkness truly ends.
gates.add({
  id: "trial_hall_gate",
  mapId: "cornelia",
  x: 13,
  y: 1,
  require: { flag: "story_chrono_defeated" },
  deniedDialogue: "The hall beneath the castle is sealed in stillness. Only the fall of the Keeper of Time could open it.",
});

const quests = new QuestTracker(QUESTS, game.state);
const saves = new SaveManager({ storage: (typeof localStorage !== "undefined" ? localStorage : null) });

const enemySystem = new EnemyTemplateSystem();
const trials = new TrialSystem(TRIALS, {
  state: game.state,
  party: game.party,
  inventory: game.inventory,
  enemySystem,
  rewards: TRIAL_REWARDS,
});
const bestiary = new BestiarySystem(BESTIARY, { state: game.state });
const crafting = new CraftingSystem(RECIPES, { inventory: game.inventory, party: game.party, state: game.state });
const enchanting = new EnchantingSystem(ENCHANTS, { inventory: game.inventory, party: game.party, state: game.state });
const waystones = new WaystoneSystem(WAYSTONES, { state: game.state });
const ngplus = new NgPlusSystem({ state: game.state, party: game.party, inventory: game.inventory, enemySystem });
setExtraItemMods((itemId) => enchanting.enchantMods(itemId));
// Task #122/#116/#117: global balance config, monster signature abilities
// and the consolidated reward table — all pure data/logic over enemySystem.
const balance = new BalanceSystem(BALANCE);
const abilitySystem = new MonsterAbilitySystem({ enemySystem });
const monsterRewards = new MonsterRewardTable(MONSTER_REWARDS);
const encounters = new EncounterGenerator({ enemySystem, scaler: (enemies) => ngplus.scaleEncounter(enemies), balance });
const accessories = new AccessorySystem();
const status = new StatusEffectSystem({ immunityHook: (target, statusId) => accessories.immunityFor(target, statusId) });
const criticals = new CriticalHitSystem();
const synergy = new SynergySystem({ status });
const targeting = new TargetPrioritySystem();
const spellEffects = new SpellEffectSystem();
const spellLevels = new SpellLevelingSystem();
const spellVisuals = new SpellVisualCueSystem();
const manaRegen = new ManaRegenSystem();
const weaponScaling = new WeaponScalingSystem();
const armor = new ArmorMitigationSystem();
// Task #133: magic-status infliction mapping (per-spell status + turns).
const magicStatus = new MagicStatusInflictionSystem();
const spellcasting = new SpellCastingSystem({ statusSystem: status, synergy, levelSystem: spellLevels, effects: spellEffects, visuals: spellVisuals, magicStatus, useCaseValidator: new UseCaseValidator() });
const spellLearning = new SpellLearningSystem();
const fog = new FogOfWar({ radius: 2 });
// Task #137: the overworld has its own fog of war — revealed only as the
// player explores, persisted to a world flag across map transitions/saves.
const worldFog = new WorldMapFogSystem(fog, { state: game.state });
const shops = {
  weapon: new ShopSystem(SHOPS.cornelia_weapon, game.party, game.inventory),
  item: new ShopSystem(SHOPS.cornelia_item, game.party, game.inventory),
};
const inn = new InnSystem({ party: game.party, cost: INNS.cornelia_inn.cost, freeIfFlag: INNS.cornelia_inn.freeIfFlag, state: game.state });

const director = new StoryDirector({ state: game.state, party: game.party, inventory: game.inventory });
director.registerMilestones(MAIN_STORY);
const enemyAI = new EnemyAI({ targeting, status, abilities: abilitySystem });
const bossPhases = new BossPhaseController();
const rewards = new CombatRewardResolver({ party: game.party, inventory: game.inventory, enemySystem, balance, itemFind: () => classPassives.itemFindForParty(game.party) });
const sideQuests = new SideQuestSystem(SIDE_QUESTS, { state: game.state, party: game.party, inventory: game.inventory });
const cinematic = new CinematicSystem({ state: game.state });
// Task #104: the victory ending — plays once the light is restored, then
// marks the save complete and unlocks Free Roam.
const ending = new EndingSystem({ state: game.state, cinematic, completion });
const questLog = new QuestLogSystem({ quests, director, sideQuests });
const consumables = new ConsumableSystem({ inventory: game.inventory, party: game.party });
const equipStats = new EquipmentStatSystem(enchanting.decoratedItemDb());
const commandMenu = new CommandMenuSystem({
  party: game.party,
  inventory: game.inventory,
  consumables,
  spells: spellcasting,
  state: game.state,
  equip: new EquipSystem(game.inventory),
});
const rarity = new ItemRaritySystem();
const itemTriggers = new ItemTriggerSystem(dialogueWorld);
itemTriggers
  .add({ id: "unlock_crystal_chamber", item: "crystalKey", flag: "crystal_chamber_unlocked", condition: null, once: true, event: "crystal_chamber_unlocked" })
  .add({ id: "enter_elfheim", item: "crystalKey", flag: "elfheim_unlocked", condition: null, once: true, event: "elfheim_unlocked" })
  .add({ id: "offer_crystal_key", item: "crystalKey", consume: true, flags: ["crystal_key_given"], event: "crystal_key_given" })
  .add({ id: "airship_ready", item: "airshipEngine", flag: "airship_obtained", condition: null, once: true, event: "airship_ready" });
const menu = new MenuSystem({ rememberRoot: true });
const sounds = new SoundTriggerSystem({ engine: new SynthAudio({ volume: 0.18 }) });
// Task #222/#223: the procedural chiptune soundtrack. No audio files — the
// engine synthesizes everything; region/state changes pick the song.
const musicEngine = new ChipTune({ volume: 0.22 });
const music = new MusicController({
  engine: musicEngine,
  songs: SONGS,
  regionSongs: REGION_SONGS,
  classify: classifyMap,
  mapSongs: MAP_SONGS,
  baseVolume: 0.22,
});
const gameOver = new GameOverSystem({ party: game.party, state: game.state });
// Task #203/#208: the three-slot save system and the boot controller that
// drives New Game / Continue / Return-to-Title on the live game objects.
const slots = new SaveSlotSystem({ manager: saves });
const boot = new GameBootSystem({ state: game.state, party: game.party, inventory: game.inventory, slots, gameOver });
const titleCtl = new TitleController({ slots });
const npcs = new NpcPlacementSystem(NPC_PLACEMENTS, maps, { state: game.state });
// Task #138: NPC schedules — timer-based movement keyed to the game clock
// (only when no quest state pins the NPC). Quest states still win.
const npcSchedules = new NpcScheduleSystem(NPC_SCHEDULES, gameClock);
npcs.bindSchedules(npcSchedules).bindClock(gameClock);
const buildings = new BuildingSystem(BUILDINGS);
buildings.registerTransitions(transitions);
const dialogue = new DialogueEngine({ world: dialogueWorld, state: game.state });
// Task #139/#140/#141: group conversations (multi-NPC dialogue pages),
// NPC inventory exchanges (give items for rewards), and proximity barks.
const groupConversation = new GroupConversationSystem({ engine: dialogue, placements: npcs });
const npcExchanges = new NpcExchangeSystem(NPC_EXCHANGES, { state: game.state, party: game.party, inventory: game.inventory });
const npcBarks = new NpcBarkSystem(NPC_BARKS, { state: game.state });
npcBarks.bindPlacements(npcs);
const townEvents = new TownEventSystem(TOWN_EVENTS, {
  state: game.state,
  world: dialogueWorld,
  handlers: { dialogue: (id) => dialogue.start(id) },
});
const ambient = new AmbientNpcSystem({ placements: npcs, maps });
const dungeons = new DungeonSystem(DUNGEONS, { transitions, maps });
dungeons.registerTransitions(transitions);
const chests = new ChestSystem(CHESTS, { state: game.state, inventory: game.inventory, party: game.party });
const puzzles = new PuzzleSystem(PUZZLES, { state: game.state });
const plot = new PlotSequenceSystem(PLOT, {
  state: game.state,
  handlers: {
    dialogue: (id) => dialogue.start(id),
    // Task #104: the final chapter's `ending` event kicks off the victory
    // ending the moment the light is restored.
    event: (name) => {
      if (name === "ending") ending.begin();
    },
  },
});
const flavor = new FlavorSystem();
const terrainFor = (mapId) => {
  const def = maps.get(mapId);
  if (!def) return null;
  const opts = {};
  if (mapId === "overworld") {
    opts.terrainOverride = (x, y, t) => worldState.terrainOverride(mapId, x, y, t);
  }
  return new TerrainRules(def, opts);
};
// Task #136: per-map TerrainSpeedSystem (cached) — world-map moves spend
// their scale as a terrain-cost budget, so forests/mountains slow travel.
const terrainSpeeds = new Map();
const terrainSpeedFor = (mapId) => {
  if (!terrainSpeeds.has(mapId)) {
    const rules = terrainFor(mapId);
    terrainSpeeds.set(mapId, rules ? new TerrainSpeedSystem(rules) : null);
  }
  return terrainSpeeds.get(mapId);
};
const landmarks = new LandmarkMarkerSystem(LANDMARKS, { state: game.state });
const worldEvents = new WorldEventSystem(WORLD_EVENTS, { world: dialogueWorld, state: game.state });
const travel = new TravelAccessSystem(TRAVEL_ACCESS, { state: game.state, world: dialogueWorld });
const worldTerrain = new WorldMapTerrainSystem(terrainFor("overworld"));
const screenTransitions = new ScreenTransitionSystem();
const textScroller = new TextScroller({ cps: 120 });
const input = new InputManager();
const consumableUseCases = new ConsumableUseCaseMapper();
// Task #107/#109/#110-#115: NPC rewards, story hints, gear-tier progression,
// monster archetypes and encounter grouping — pure logic over the state,
// party, inventory and enemy-template systems above.
const npcRewards = new NpcRewardSystem(NPC_REWARDS, { state: game.state, party: game.party, inventory: game.inventory });
const hints = new HintSystem({ director, plot, state: game.state });
const gearTiers = new GearTierSystem();
const archetypes = new MonsterArchetypeSystem({ enemySystem });
const monsterGroups = new MonsterGroupingSystem({ enemySystem });
// Task #118/#119/#120/#121/#124: environment objects, region-fade visuals,
// invisible walls, and save-file compatibility/versioning.
const environmentObjects = new EnvironmentObjectSystem(ENVIRONMENT_OBJECTS, {
  state: game.state,
  inventory: game.inventory,
  party: game.party,
  maps,
  handlers: { dialogue: (id) => dialogue.start(id) },
});
const regionTransitions = new RegionTransitionSystem({ screen: screenTransitions });
const boundaries = new BoundarySystem(BOUNDARIES, { maps });
const saveCompat = new SaveCompatibilitySystem();
// Task #126-#135: turn-order queue, combat state machine, party-wide
// buffs/debuffs, multi-target attacks, spell-casting animation sync,
// magic status infliction, class passives, overworld shortcuts, and random
// world-map events.
const buffs = new BuffSystem();
const turnQueue = new TurnOrderQueue({ random: Math.random, buffs });
const multiTarget = new MultiTargetResolver({ weaponScaling });
const spellAnimationSync = new SpellAnimationSyncSystem({ visuals: spellVisuals });
const classPassives = new ClassPassiveSystem();
const shortcuts = new ShortcutSystem(SHORTCUTS, { state: game.state, hasItem: (id) => game.inventory.has(id) });
const randomEvents = new RandomEventSystem({
  random: Math.random,
  events: RANDOM_EVENTS,
  maps: ["overworld"],
  inventory: game.inventory,
  party: game.party,
  items: ITEMS,
});
// Task #143/#145: gear-set bonus detection and the durability/break ledger.
const gearSets = new GearSetBonusSystem(GEAR_SETS);
const gearDurability = new GearDurabilitySystem(GEAR_DURABILITY, { party: game.party });
// Task #138: keep the game clock in sync across New Game / Continue resets
// (its hour/day persist on the state flags, which boot rewrites).
{
  const prev = boot.onAfterReset;
  boot.onAfterReset = () => {
    if (prev) prev();
    gameClock.restore();
  };
}
// Task #128/#132: buff stat deltas and class passive modifiers layer onto
// the effective-stats calculation (same pattern as enchant mods above).
setExtraBuffMods((char) => buffs.statMods(char));
// Task #143: gear-set bonuses compose onto the stats AFTER class passives;
// Task #145: broken gear (durability 0) is skipped by the stat pipeline.
setExtraStatHook((stats, char) => {
  let s = classPassives.adjustStats(char, stats);
  return gearSets.applyMods(char, s);
});
setBrokenItems((char) => gearDurability.brokenSet(char));

const systems = {
  GameState,
  PartyManager,
  Inventory,
  Character,
  EquipSystem,
  DialogueEngine,
  CombatResolver,
  MapRenderer,
  TileMap,
  GridEntity,
  MovementSystem,
  DIRS,
  TriggerSystem,
  QuestTracker,
  GateSystem,
  MapManager,
  TransitionManager,
  SaveManager,
  ShopSystem,
  InnSystem,
  FogOfWar,
  MiniMap,
  EnemyTemplateSystem,
  EncounterGenerator,
  SpellCastingSystem,
  TargetResolver,
  SpellLearningSystem,
  applyElemental,
  elementalMultiplier,
  isImmune,
  isResistantTo,
  isWeakTo,
  EnemyAI,
  BossPhaseController,
  CombatRewardResolver,
  TerrainRules,
  terrainRulesFor,
  TRAVEL_MODES,
  TERRAIN_TYPES,
  SideQuestSystem,
  CinematicSystem,
  StoryDirector,
  QuestLogSystem,
  ConsumableSystem,
  EquipmentStatSystem,
  ItemTriggerSystem,
  ItemRaritySystem,
  MenuSystem,
  SoundTriggerSystem,
  SynthAudio,
  GameOverSystem,
  NpcPlacementSystem,
  BuildingSystem,
  TownEventSystem,
  AmbientNpcSystem,
  DungeonSystem,
  ChestSystem,
  PuzzleSystem,
  PlotSequenceSystem,
  CrystalSystem,
  WorldStateSystem,
  EndingSystem,
  GameCompletionSystem,
  FlavorSystem,
  StatusEffectSystem,
  CriticalHitSystem,
  SynergySystem,
  TargetPrioritySystem,
  SpellEffectSystem,
  SpellLevelingSystem,
  SpellVisualCueSystem,
  ManaRegenSystem,
  WeaponScalingSystem,
  ArmorMitigationSystem,
  AccessorySystem,
  ConsumableUseCaseMapper,
  LandmarkMarkerSystem,
  WorldEventSystem,
  TravelAccessSystem,
  WorldMapTerrainSystem,
  ScreenTransitionSystem,
  TextScroller,
  InputManager,
  TrialSystem,
  BestiarySystem,
  CraftingSystem,
  EnchantingSystem,
  WaystoneSystem,
  NgPlusSystem,
  GameBootSystem,
  SaveSlotSystem,
  TitleController,
  CommandMenuSystem,
  ChipTune,
  MusicController,
  NpcRewardSystem,
  HintSystem,
  GearTierSystem,
  MonsterArchetypeSystem,
  MonsterGroupingSystem,
  MonsterAbilitySystem,
  MonsterRewardTable,
  EnvironmentObjectSystem,
  RegionTransitionSystem,
  BoundarySystem,
  BalanceSystem,
  SaveCompatibilitySystem,
  TurnOrderQueue,
  CombatStateMachine,
  BuffSystem,
  MultiTargetResolver,
  SpellAnimationSyncSystem,
  MagicStatusInflictionSystem,
  ClassPassiveSystem,
  ShortcutSystem,
  RandomEventSystem,
  TerrainSpeedSystem,
  WorldMapFogSystem,
  GameClock,
  NpcScheduleSystem,
  GroupConversationSystem,
  NpcExchangeSystem,
  NpcBarkSystem,
  GearSetBonusSystem,
  UseCaseValidator,
  GearDurabilitySystem,
};

window.game = game;
window.systems = systems;
window.ff = {
  maps,
  transitions,
  triggers,
  gates,
  quests,
  saves,
  dialogueWorld,
  shops,
  inn,
  fog,
  enemySystem,
  encounters,
  spellcasting,
  spellLearning,
  director,
  enemyAI,
  bossPhases,
  rewards,
  sideQuests,
  cinematic,
  ending,
  completion,
  questLog,
  consumables,
  equipStats,
  commandMenu,
  rarity,
  itemTriggers,
  menu,
  sounds,
  music,
  musicEngine,
  gameOver,
  npcs,
  buildings,
  dialogue,
  townEvents,
  ambient,
  dungeons,
  chests,
  puzzles,
  plot,
  crystals,
  worldState,
  flavor,
  status,
  criticals,
  synergy,
  targeting,
  spellEffects,
  spellLevels,
  spellVisuals,
  manaRegen,
  weaponScaling,
  armor,
  accessories,
  landmarks,
  worldEvents,
  travel,
  worldTerrain,
  trials,
  bestiary,
  crafting,
  enchanting,
  waystones,
  ngplus,
  slots,
  boot,
  title: titleCtl,
  screenTransitions,
  textScroller,
  input,
  consumableUseCases,
  npcRewards,
  hints,
  gearTiers,
  archetypes,
  monsterGroups,
  abilitySystem,
  monsterRewards,
  environmentObjects,
  regionTransitions,
  boundaries,
  balance,
  saveCompat,
  buffs,
  turnQueue,
  multiTarget,
  spellAnimationSync,
  magicStatus,
  classPassives,
  shortcuts,
  randomEvents,
  terrainFor,
  terrainSpeedFor,
  gameClock,
  worldFog,
  npcSchedules,
  groupConversation,
  npcExchanges,
  npcBarks,
  gearSets,
  gearDurability,
  data: {
    ELEMENTS,
    ELEMENT_NAMES,
    ENEMIES,
    ENEMY_GROUPS,
    ENCOUNTERS,
    SPELLS,
    SHOPS,
    INNS,
    SIDE_QUESTS,
    MAIN_STORY,
    NPC_PLACEMENTS,
    BUILDINGS,
    RARITY,
    TOWN_EVENTS,
    DUNGEONS,
    CHESTS,
    PUZZLES,
    PLOT,
    CRYSTALS,
    WORLD_BRIDGES,
    WORLD_GATES,
    ENDING_SCENES,
    CREDITS,
    FLAVOR_TEXTS,
    STATUS_DEFS,
    SYNERGY_DEFS,
    SPELL_VISUALS,
    LANDMARKS,
    WORLD_EVENTS,
    TRAVEL_ACCESS,
    TERRAIN_COSTS,
    TERRAIN_LABELS,
    TRIALS,
    TRIAL_REWARDS,
    BESTIARY,
    RECIPES,
    ENCHANTS,
    WAYSTONES,
    NGPLUS,
    NEW_GAME,
    NPC_REWARDS,
    HINTS,
    WEAPON_TIERS,
    ARMOR_TIERS,
    ENEMY_ARCHETYPES,
    ENEMY_ARCHETYPE_ASSIGN,
    MONSTER_ABILITIES,
    MONSTER_ABILITY_ASSIGN,
    MONSTER_REWARDS,
    REWARD_TOTALS,
    ENVIRONMENT_OBJECTS,
    MAP_SONGS,
    BOUNDARIES,
    BALANCE,
    BUFF_DEFS,
    CLASS_PASSIVES,
    SHORTCUTS,
    RANDOM_EVENTS,
    TERRAIN_SPEED,
    SPEED_LABELS,
    HOURS_PER_DAY,
    PERIODS,
    NPC_SCHEDULES,
    NPC_EXCHANGES,
    NPC_BARKS,
    GEAR_SETS,
    GEAR_DURABILITY,
  },
};

// Task #226/#227: unlock the audio engines on the first user gesture anywhere
// (title screen included), per browser autoplay rules. Audio stays muted
// until the player turns it on with the Audio button.
{
  const bootAudio = () => {
    music.unlock();
    sounds.unlock();
  };
  document.addEventListener("pointerdown", bootAudio, { once: true });
  document.addEventListener("keydown", bootAudio, { once: true });
}
