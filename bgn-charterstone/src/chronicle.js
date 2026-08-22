// src/chronicle.js — the in-app Chronicle / active ruleset (Tasks 35 & 38).
// Task 38 encodes the starting rulebook (setup, personal/general supply, turn
// actions, The Commons, tracks, crates) as structured ruleset data with a
// version field — sections of entries, each carrying the mechanics terms it
// covers, so "every mechanic referenced by a rules task has a matching data
// entry" is checkable. The chronicle also owns the ACTIVE RULE FLAGS that
// rule stickers (Task 35) flip permanently: incomeEnabled (landing on an
// income space triggers income for all), dropPlayers (the add/drop-player
// ruleset, unlocked later in the campaign), and the four Phase-9 campaign
// flags — advancedActions, guideposts, minions, campaignEnd — flipped by
// their crate rule stickers (Task 42). enabledActions() derives the
// ruleset's legal action set from those flags, so applying a rule sticker
// visibly changes the set of legal actions.
//
// The section text below is transcribed from the starting rulebook (mirrored
// at scratch/rules/rules-jina.txt). Task 43 extends it with the campaign
// unlock schedule; the entries are structured so the Phase-15 in-app
// Chronicle can render and search them.

export const CHRONICLE_VERSION = 1;

export const CHRONICLE_FLAG_DEFAULTS = Object.freeze({
  incomeEnabled: false,
  dropPlayers: false,
  advancedActions: false,
  guideposts: false,
  minions: false,
  campaignEnd: false,
});

export const CHRONICLE_SECTIONS = [
  {
    id: "setup", title: "Setup",
    entries: [
      { id: "setup-roll", title: "Choose the first player", mechanics: ["charter", "charterstone-die", "first-player"], text: "Roll the Charterstone die and re-roll until it lands on an active charter; that charter's player takes the first turn." },
      { id: "setup-supplies", title: "Personal and general supply", mechanics: ["supply", "personal-supply", "general-supply", "coins", "resources", "player"], text: "Each player takes a charter, its color, and a personal supply. Coins and resources form the shared, finite general supply." },
      { id: "setup-tracks", title: "Starting tracks", mechanics: ["progress", "reputation", "influence", "capacity", "vp"], text: "The progress token starts on the space matching the player count; each player has 12 influence tokens; capacity and VP start at 0." },
    ],
  },
  {
    id: "supply", title: "Supply",
    entries: [
      { id: "supply-personal", title: "The personal supply", mechanics: ["supply", "personal-supply", "player", "worker", "capacity", "influence", "vp"], text: "Your personal supply holds your workers, influence tokens, coins, resources, capacity, VP, and held cards. Cards stay face-up." },
      { id: "supply-general", title: "The general supply", mechanics: ["supply", "general-supply", "coins", "resources", "economy"], text: "Coins and resources are finite: a gain that exceeds the pool grants only what remains." },
      { id: "supply-starting", title: "Game 1 starting coins", mechanics: ["supply", "coins", "player"], text: "In Game 1 each player begins with $4 in their personal supply." },
    ],
  },
  {
    id: "turns", title: "Turn & Round",
    entries: [
      { id: "turns-actions", title: "The two turn actions", mechanics: ["turn", "round", "place", "retrieve", "worker"], text: "On your turn you must either place a worker from your personal supply onto any building, or retrieve all of your workers from the board." },
      { id: "turns-bump", title: "Occupied buildings", mechanics: ["place", "bump", "worker"], text: "If you place onto an occupied building, bump (return) the occupant to its owner first." },
      { id: "turns-cost-benefit", title: "Cost and benefit", mechanics: ["cost", "benefit", "coins", "resources"], text: "Pay the building's bottom-left cost from your personal supply to the general supply; then you may gain all or part of its upper-right benefit." },
      { id: "turns-round", title: "Ending a round", mechanics: ["round", "turn"], text: "A round ends when every player has taken the same number of turns; play then returns to the first player." },
      { id: "turns-no-influence", title: "Forced progress advance", mechanics: ["turn", "influence", "progress"], text: "A player who begins their turn with 0 influence tokens must advance the progress token 1 space before taking their turn." },
    ],
  },
  {
    id: "commons", title: "The Commons",
    entries: [
      { id: "commons-zeppelin", title: "Zeppelin — construct a building", mechanics: ["zeppelin", "construct", "construction-cost", "influence", "building-tile", "charter"], text: "Pay 3 influence tokens plus the 4 resources on the building card to construct 1 building in your charter; gain 5 VP and advance the progress token." },
      { id: "commons-charterstone", title: "Charterstone — unlock a crate", mechanics: ["charterstone-building", "crate", "influence", "archive"], text: "Pay $4 and 2 influence tokens to unlock a crate on one of your constructed building cards; gain 5 VP, advance the progress token, and archive the card." },
      { id: "commons-grandstand", title: "Grandstand — score an objective", mechanics: ["grandstand", "objective", "score", "influence-placement", "progress"], text: "Place 1 influence token on a completed objective you have not yet scored to gain 5 VP and advance the progress token. Each player may score each objective once." },
      { id: "commons-treasury", title: "Treasury", mechanics: ["treasury", "cost", "benefit", "coins", "resources"], text: "Pay any 1 resource to gain $1." },
      { id: "commons-market", title: "Market", mechanics: ["market", "advancement-mat", "advancement-card", "deck", "cost", "benefit"], text: "Pay any 1 resource and $1 to gain 1 face-up advancement card of the type the Market provides; replenish the mat from the deck." },
      { id: "commons-cloudport", title: "Cloud Port — quota", mechanics: ["cloud-port", "quota", "commodity"], text: "Sell a commodity to the general supply on any open quota space to gain 3 VP plus the space's optional bonus (+1 VP or 1 reputation)." },
    ],
  },
  {
    id: "tracks", title: "Tracks",
    entries: [
      { id: "tracks-progress", title: "Progress track", mechanics: ["progress", "construct", "crate", "objective", "income", "end-game", "reputation"], text: "The progress token is the game's timer: it advances 1 per construction, crate unlock, and objective score (plus the forced 0-influence advance). Bonus spaces grant 1 reputation or trigger income for all; the final space ends the game." },
      { id: "tracks-reputation", title: "Reputation track", mechanics: ["reputation", "influence-placement", "end-game", "vp"], text: "Placing reputation costs 1 influence token: the first token lands on the space matching the player count, later tokens toward the ocean. At game end the highest token counts gain 10/7/4 VP (ties share)." },
      { id: "tracks-quota", title: "Quota track", mechanics: ["quota", "commodity", "influence-placement", "reputation", "vp"], text: "Pick an open quota space, pay its commodity type and quantity to the general supply, place 1 influence token on it, and gain 3 VP plus the optional bonus." },
      { id: "tracks-influence", title: "Influence tokens", mechanics: ["influence", "influence-placement", "supply"], text: "Each player has exactly 12 influence tokens per game. Placements are static; spending discards the token to the general supply." },
    ],
  },
  {
    id: "cards", title: "Advancement Cards",
    entries: [
      { id: "cards-mat", title: "The advancement mat", mechanics: ["advancement-mat", "advancement-card", "deck", "discard"], text: "The mat shows 5 face-up advancement cards. Gaining one replaces it from the deck; when the deck is empty or new cards are unlocked, shuffle the discard pile into the deck." },
      { id: "cards-types", title: "Card types", mechanics: ["advancement-card", "assistant", "persona", "objective", "construct"], text: "Advancement cards come as constructed building, unconstructed building, assistant, persona, objective, and special cards." },
      { id: "cards-assistants", title: "Assistant cards", mechanics: ["assistant", "construct", "score"], text: "Assistants grant a bonus when you perform a listed core function. Unnamed assistants may be given a name by writing it on the card." },
      { id: "cards-constructed", title: "Constructed building cards", mechanics: ["construct", "crate", "archive", "building-tile"], text: "When you construct a building, its card becomes a constructed building card: keep it in your supply if it has a crate, otherwise place it in the Archive tuckbox." },
      { id: "cards-archive", title: "The Archive", mechanics: ["archive"], text: "The Archive is a depository for components no longer needed. Archived components never re-enter the game." },
    ],
  },
  {
    id: "crates", title: "Crates",
    entries: [
      { id: "crates-unlock", title: "Unlocking a crate", mechanics: ["crate", "charterstone-building", "index-guide", "archive", "influence"], text: "Use the Charterstone building to access a crate on one of your constructed building cards. Pay the indicated cost, then extract the components listed in the Index Guide; gain 5 VP, advance the progress token, and archive the card." },
      { id: "crates-persona", title: "Personas from crates", mechanics: ["crate", "persona"], text: "Many crates contain a new persona card. Place it in your Charter Chest to use in later games." },
      { id: "crates-sticker", title: "Rule and content stickers", mechanics: ["sticker", "crate", "legacy"], text: "Some crates contain rule or content stickers that apply permanently to the Chronicle and board, mutating the active ruleset for the rest of the campaign." },
    ],
  },
  {
    id: "endgame", title: "End of Game",
    entries: [
      { id: "endgame-trigger", title: "Reaching the end space", mechanics: ["end-game", "progress", "round"], text: "When the progress token advances to the final space, finish the round (each player takes the same number of turns), then the game ends." },
      { id: "endgame-scoring", title: "End-game scoring", mechanics: ["end-game", "reputation", "objective", "building-tile", "crate", "vp"], text: "Sum reputation VP (10/7/4), scored-objective VP, constructed-building VP, and crate VP. The most VP wins." },
      { id: "endgame-legacy", title: "Legacy persistence", mechanics: ["legacy", "sticker", "construct"], text: "Constructed buildings, applied stickers, and unlocked crates persist in campaign state and appear in the next game's setup." },
    ],
  },
  {
    id: "players", title: "Players & Charters",
    entries: [
      { id: "players-add-drop", title: "Adding and dropping players", mechanics: ["add-player", "drop-player", "charter", "legacy"], text: "Mid-campaign, a new player may join an inactive charter: they gain that charter's color and an equitable share of glory and capacity, plus 1 random constructed or unconstructed building card. A player who leaves frees their charter; the charter then sits inactive until claimed or the campaign ends." },
    ],
  },
  {
    id: "campaign", title: "The Campaign",
    entries: [
      { id: "campaign-advanced", title: "Advanced Actions", mechanics: ["advanced-actions"], text: "Advanced Actions unlock with the Advanced Actions rule sticker (crate 3). They add extra legal actions and building options to the active ruleset." },
      { id: "campaign-guideposts", title: "Guideposts", mechanics: ["guidepost"], text: "Guideposts are special advancement cards that unlock with their rule sticker (crate 6) and grant a one-time lasting bonus when revealed." },
      { id: "campaign-minions", title: "Minions", mechanics: ["minion"], text: "Minions are special advancement cards that unlock late in the campaign (crate 11). They perform tasks for your charter for the rest of the campaign." },
      { id: "campaign-end", title: "End of Campaign", mechanics: ["campaign-end", "glory", "victory", "capacity"], text: "After game 12 the campaign is scored: 1-3 VP per filled capacity space, 5-7 VP per persona used across the campaign, 6-8 VP per game won, 10 VP to the player with the most glory, plus the printed value of each constructed building. The highest total is crowned the campaign winner." },
    ],
  },
];

export const CHRONICLE_MECHANICS = Object.freeze(
  [...new Set(CHRONICLE_SECTIONS.flatMap(s => s.entries.flatMap(e => e.mechanics)))].sort()
);

// Maps every active rule flag to the Chronicle entries that document it. The
// in-app Chronicle (Task 56) uses this to render each applied rule sticker as
// a link into the searchable ruleset.
export const CHRONICLE_FLAG_ENTRIES = Object.freeze({
  incomeEnabled: ["tracks-progress"],
  dropPlayers: ["players-add-drop"],
  advancedActions: ["campaign-advanced"],
  guideposts: ["campaign-guideposts"],
  minions: ["campaign-minions"],
  campaignEnd: ["campaign-end"],
});

function cloneSections() {
  return CHRONICLE_SECTIONS.map(s => ({
    id: s.id,
    title: s.title,
    entries: s.entries.map(e => ({ id: e.id, title: e.title, mechanics: [...e.mechanics], text: e.text })),
  }));
}

export function createChronicle(config = {}) {
  const flags = { ...CHRONICLE_FLAG_DEFAULTS, ...(config.flags ?? {}) };
  const chronicle = {
    version: CHRONICLE_VERSION,
    flag(id) {
      return flags[id] ?? false;
    },
    setFlag(id, value) {
      if (!(id in CHRONICLE_FLAG_DEFAULTS)) throw new Error("chronicle: unknown rule flag '" + id + "'");
      flags[id] = !!value;
      return flags[id];
    },
    enabledActions() {
      const actions = ["place", "retrieve"];
      if (flags.dropPlayers) actions.push("dropPlayer");
      return actions;
    },
    sections() {
      return cloneSections();
    },
    entries() {
      return cloneSections().flatMap(s => s.entries);
    },
    section(id) {
      return CHRONICLE_SECTIONS.find(s => s.id === id) ?? null;
    },
    entry(id) {
      return CHRONICLE_SECTIONS.flatMap(s => s.entries).find(e => e.id === id) ?? null;
    },
    mechanics() {
      return [...CHRONICLE_MECHANICS];
    },
    search(term) {
      const q = String(term).toLowerCase();
      const hits = [];
      for (const s of CHRONICLE_SECTIONS) {
        for (const e of s.entries) {
          const hay = (e.title + " " + e.text + " " + e.mechanics.join(" ")).toLowerCase();
          if (e.mechanics.some(m => m === term) || hay.includes(q)) {
            hits.push({ sectionId: s.id, entryId: e.id, title: e.title, mechanics: [...e.mechanics] });
          }
        }
      }
      return hits;
    },
    toJSON() {
      return { kind: "chronicle", version: CHRONICLE_VERSION, flags: { ...flags } };
    },
    fromJSON(data) {
      if (!data || typeof data !== "object") throw new Error("chronicle: bad fromJSON payload");
      for (const k of Object.keys(flags)) delete flags[k];
      Object.assign(flags, CHRONICLE_FLAG_DEFAULTS, data.flags ?? {});
      return chronicle;
    },
  };
  return chronicle;
}
