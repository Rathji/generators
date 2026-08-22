export const DIALOGUE = {
  "cornelia.guard": {
    speaker: "Town Guard",
    branches: [
      { when: { flag: "king_met" }, id: "cornelia.guard.after" },
      // Task #151: affinity-gated branches — frequent visitors are recognized.
      { when: (w) => { const aw = w?.world ?? w; return !!(aw?.getAffinity && aw.getAffinity("cornelia_guard") >= 4); }, id: "cornelia.guard.affinity2" },
      { when: (w) => { const aw = w?.world ?? w; return !!(aw?.getAffinity && aw.getAffinity("cornelia_guard") >= 2); }, id: "cornelia.guard.affinity1" },
      { when: { item: "crystalKey" }, id: "cornelia.guard.key" },
      { id: "cornelia.guard.before" },
    ],
  },
  "cornelia.guard.before": { speaker: "Town Guard", pages: ["Welcome to Cornelia, traveler.", "The king is worried about the dimming light of the crystals."] },
  "cornelia.guard.key": { speaker: "Town Guard", pages: ["Ah, you carry the Crystal Key. The castle doors are open to you."] },
  "cornelia.guard.after": { speaker: "Town Guard", pages: ["The king is awaiting you in the throne room. Do not keep him waiting."] },
  "cornelia.guard.affinity1": { speaker: "Town Guard", pages: ["Good to see you again, friend — few walk these streets as often as you.", "The caves stir with goblin fangs. The smith pays well for them."] },
  "cornelia.guard.affinity2": { speaker: "Town Guard", pages: ["You've earned this town's trust, hero of the crystal.", "If ever the castle gates close to you, seek the old road by the fountain — the traveler there knows more than she lets on."] },
  "cornelia.elder": {
    speaker: "Village Elder",
    branches: [
      // Task #151: the elder shares his wisdom once the hero proves their loyalty.
      { when: (w) => { const aw = w?.world ?? w; return !!(aw?.getAffinity && aw.getAffinity("cornelia_elder") >= 3); }, id: "cornelia.elder.affinity" },
      { id: "cornelia.elder.before" },
    ],
  },
  "cornelia.elder.before": { speaker: "Village Elder", pages: ["Long ago, four crystals kept the balance of this world.", "Now their light is fading. Only a chosen party can restore them."] },
  "cornelia.elder.affinity": { speaker: "Village Elder", pages: ["You return again and again — the mark of a true champion.", "Take this ether. The road ahead will thirst for magic."] },
  "elfheim.elder.affinity": { speaker: "Elf Elder", pages: ["You have walked among us often, human — the forest remembers your steps.", "Mount Gulg's forges burn for the Earth Crystal. Your aid is honored here."] },
  "cornelia.woman": "I heard a strange sound from the caves to the west...",
  "cornelia.child": "I'm going to be a hero like you someday!",
  "cornelia.innkeeper": { speaker: "Innkeeper", pages: ["Welcome to the Crystal Springs Inn. Rest your weary feet here.", "The beds are soft and the ale is cold — just ask to stay the night."] },
  "inn.innkeeper": { speaker: "Innkeeper", pages: ["A warm bed awaits. Sleep well, travelers.", "Return when you need to recover your strength."] },
  // Task #108: the Mysterious Traveler, revealed on the castle road.
  "cornelia.traveler": { speaker: "Mysterious Traveler", pages: ["You found me. Few notice the old road by the fountain.", "Walk it thrice in the age's dark hour and it becomes a road to somewhere... else."] },
  "caves.hermit": { speaker: "Hermit", pages: ["You found my little hideaway in the caves.", "Be careful deeper in — the guardians do not take kindly to strangers."] },
  "pravo.harbormaster": {
    speaker: "Harbor Master",
    branches: [
      { when: { flag: "ship_obtained" }, id: "pravo.harbormaster.after" },
      { id: "pravo.harbormaster.default" },
    ],
  },
  "pravo.harbormaster.default": { speaker: "Harbor Master", pages: ["The ship to the north only sails when the sea is calm.", "Bring back the wind crystal and the waters will settle."] },
  "pravo.sailor": "The sea is harsh. Only a captain with a brave crew survives it.",
  "elfheim.merchant": {
    speaker: "Merchant",
    branches: [
      { when: { item: "mythrilSword" }, id: "elfheim.merchant.deal" },
      { id: "elfheim.merchant.none" },
    ],
  },
  "elfheim.merchant.deal": { speaker: "Merchant", pages: ["Ah, a blade of mythril! A fair trade awaits you, friend.", "Take a goblin fang or two — the forge-men pay well for them."] },
  "elfheim.merchant.none": { speaker: "Merchant", pages: ["The elves trade in pure mythril. You'll find no better blade.", "For a finer edge, speak to the dwarf smiths at Mount Gulg."] },
  "elfheim.guard": {
    speaker: "Elf Guard",
    branches: [
      { when: { flag: "elfheim_unlocked" }, id: "elfheim.guard.open" },
      { when: { item: "crystalKey" }, id: "elfheim.guard.key" },
      { id: "elfheim.guard.before" },
    ],
  },
  "elfheim.guard.before": { speaker: "Elf Guard", pages: ["Beyond this gate lies the elven realm.", "Only travelers bearing a key may pass the mountain gate."] },
  "elfheim.guard.key": { speaker: "Elf Guard", pages: ["You carry the Crystal Key — the gate opens to you, friend.", "The prince's hall stands at the town's heart. He speaks often of old debts."] },
  "elfheim.guard.open": { speaker: "Elf Guard", pages: ["Welcome to Elfheim, hero of the crystals.", "The forges sing day and night since the marsh waters calmed."] },
  "elfheim.elder": {
    speaker: "Elf Elder",
    branches: [
      { when: { flag: "story_marsh_guardian_defeated" }, id: "elfheim.elder.after_marsh" },
      { id: "elfheim.elder.before" },
    ],
  },
  "elfheim.elder.before": { speaker: "Elf Elder", pages: ["Our elders remember the age before the crystals dimmed.", "The Marsh Cave swallowed a relic of the elves long ago.", "Whoever quiets the Guardian could mend the mythril roads."] },
  "elfheim.elder.after_marsh": { speaker: "Elf Elder", pages: ["The Marsh Guardian is quiet at last — the relic's curse has lifted.", "The dwarf forges of Mount Gulg burn hottest of all. The Earth Crystal rests in their deeps."] },
  "elfheim.child": "I'll sneak a peek at the royal hall when the prince sleeps!",
  "elfheim.villager": {
    speaker: "Elf",
    branches: [
      { when: { flag: "crystal_earth" }, id: "elfheim.villager.earth" },
      { id: "elfheim.villager.default" },
    ],
  },
  "elfheim.villager.default": "Mythril from our forges is the finest in the realm. The merchant sells it — if you can afford it.",
  "elfheim.villager.earth": "The earth shudders with the crystal's song now. The darkness in the mine is broken.",
  "elfheim.prince": {
    speaker: "Elf Prince",
    branches: [
      { when: { item: "mythrilSword" }, id: "elfheim.prince.blade" },
      { when: { flag: "story_marsh_guardian_defeated" }, id: "elfheim.prince.after_marsh" },
      { id: "elfheim.prince.greeting" },
    ],
  },
  "elfheim.prince.greeting": { speaker: "Elf Prince", pages: ["Welcome to Elfheim, hero.", "The dwarven smiths of Mount Gulg fashion mythril for our forges — a rare trade, and a brave road."] },
  "elfheim.prince.blade": { speaker: "Elf Prince", pages: ["A mythril blade — you've walked the brave road.", "May its light cut through the darkness ahead."] },
  "elfheim.prince.after_marsh": { speaker: "Elf Prince", pages: ["The Marsh Guardian is no more? Then the old paths are safe again.", "Seek Mount Gulg to the west — the dwarf smiths there owe our house a debt of mythril.", "Their forges burn hot enough to wake the Earth Crystal."] },
  "elfheim.palace_guard": {
    speaker: "Royal Guard",
    branches: [
      { when: { flag: "story_marsh_guardian_defeated" }, id: "elfheim.palace_guard.calm" },
      { id: "elfheim.palace_guard.default" },
    ],
  },
  "elfheim.palace_guard.default": { speaker: "Royal Guard", pages: ["The prince receives visitors at the throne.", "Do not disturb the court with idle talk."] },
  "elfheim.palace_guard.calm": { speaker: "Royal Guard", pages: ["The court is at ease since the marsh road opened.", "The prince will speak with you now."] },
  "elfheim.inventor": {
    speaker: "Gnome Inventor",
    branches: [
      { when: { item: "airshipEngine" }, id: "elfheim.inventor.after" },
      { when: { flag: "story_marsh_guardian_defeated" }, id: "elfheim.inventor.engine" },
      { id: "elfheim.inventor.default" },
    ],
  },
  "elfheim.inventor.default": { speaker: "Gnome Inventor", pages: ["A dwarf by trade, a tinkerer by heart — welcome to my little forge beneath the elven town.", "Before the marsh fell quiet, my airship engine was lost in the tunnels below. Only a brave soul could fetch it back."] },
  "elfheim.inventor.engine": { speaker: "Gnome Inventor", pages: ["You quelled the Marsh Guardian? Then the tunnels may be open again!", "My airship engine lies somewhere in the depths beneath Elfheim. Recover it, and the airship will fly once more.", "Follow the tunnel stairs behind the inn — that is the way down."] },
  "elfheim.inventor.after": { speaker: "Gnome Inventor", pages: ["The engine! Gears turn true again!", "I shall re-fit the airship at once. The winds will carry you north, beyond the mountains.", "The Wind Shrine lies that way — the only path the airship can cross."] },
  "wind_shrine.keeper": {
    speaker: "Wind Shrine Keeper",
    branches: [
      { when: { flag: "story_wind_fiend_defeated" }, id: "wind_shrine.keeper.after" },
      { when: { item: "airshipEngine" }, id: "wind_shrine.keeper.welcome" },
      { when: { flag: "airship_obtained" }, id: "wind_shrine.keeper.welcome" },
      { id: "wind_shrine.keeper.before" },
    ],
  },
  "wind_shrine.keeper.before": { speaker: "Wind Shrine Keeper", pages: ["This shrine stands beyond the mountains, where only the airship dare tread.", "Few have walked these halls. The Wind Fiend below brooks no company."] },
  "wind_shrine.keeper.welcome": { speaker: "Wind Shrine Keeper", pages: ["An airship traveler — the skies have opened to you.", "The Wind Fiend stirs in the altar depths. Face it only if you have mastered the elements."] },
  "wind_shrine.keeper.after": { speaker: "Wind Shrine Keeper", pages: ["The Wind Fiend is quiet at last, and the storms have stilled.", "The wind itself thanks you, true hero of the sky."] },
  "wind_shrine.pilgrim": { speaker: "Pilgrim", pages: ["I flew here on a smuggler's skiff years ago, and stayed to listen to the shrine's song.", "The altar's music changes when the winds shift. Hear it once and you'll never forget it."] },
  "wind_shrine.acolyte": { speaker: "Acolyte", pages: ["The Wind Fiend commands the storms that ring this peak.", "They say its only fear is the crack of thunder — lightning cuts the wind itself."] },
  "wind_shrine.chorister": { speaker: "Chorister", pages: ["Every step in this shrine sings. Even now the stone hums with the lost crystal's hymn.", "When the light returns, the shrine's song will ring across the whole world."] },
  "windfall.elder": {
    speaker: "Village Elder",
    branches: [
      { when: { item: "sunkenIdol" }, id: "windfall.elder.offering" },
      { when: { flag: "story_tide_serpent_defeated" }, id: "windfall.elder.after" },
      { id: "windfall.elder.default" },
    ],
  },
  "windfall.elder.default": { speaker: "Village Elder", pages: ["Welcome to Windfall, landfall for the brave and the lost alike.", "The Sea Shrine has slept since the tides turned strange — a great serpent coils in its depths.", "Quiet it, and the shrine's blessing will return to our nets."] },
  "windfall.elder.after": { speaker: "Village Elder", pages: ["You quieted the serpent! The Sea Shrine breathes easy once more.", "Our nets have come up heavy all week, and the shrine's keepers sing of you.", "Stay as long as you like — Windfall owes you a debt of tides."] },
  "windfall.elder.offering": { speaker: "Village Elder", pages: ["The Sunken Idol — so it was true, the shrine's oldest altar still guards its treasure.", "It has blessed Windfall's tides since before my grandmother's nets were first cast.", "Return it home, and the sea will remember this kindness. Windfall thanks you, hero."] },
  "windfall.fisher": { speaker: "Fisher", pages: ["The Sea Shrine drinks the moonlight — the old folk swear it hums at high tide.", "Cast your eyes east of the isle at dawn and you'll see its spires above the mist."] },
  "windfall.shipwright": { speaker: "Shipwright", pages: ["Dock right here — my sloops ride the channel better than any Pravog hull.", "Keep the sea at your back among these isles and you'll never lose your way."] },
  "windfall.child": { speaker: "Child", pages: ["I found a shell that sings! The grown-ups say it comes from the shrine."] },
  "windfall.merchant": { speaker: "Merchant", pages: ["Shells, dried kelp, and tide-touched trinkets — all plucked from the shrine's own waters.", "Bring back a relic from the depths and I'll pay you handsomely for it."] },
  "dwarfholm.king": {
    speaker: "Dwarf King",
    branches: [
      { when: { flag: "sq_the_hearthstone_done" }, id: "dwarfholm.king.after" },
      { when: { item: "hearthstone" }, id: "dwarfholm.king.hearth" },
      { id: "dwarfholm.king.default" },
    ],
  },
  "dwarfholm.king.default": { speaker: "Dwarf King", pages: ["Welcome to Dwarfholm, hero of the surface.", "Our halls were dug before the crystals dimmed, and our forge has outlived three kings.", "The Forge at our heart has gone cold since the golem stirred — only a true smith of the surface can wake it."] },
  "dwarfholm.king.hearth": { speaker: "Dwarf King", pages: ["The Hearthstone — so the forge's heart yet beats!", "Place it in the great anvil and the Halls will warm again.", "Every dwarf in Dwarfholm will owe you their forge-fire, hero."] },
  "dwarfholm.king.after": { speaker: "Dwarf King", pages: ["The Hearthstone glows on the great anvil — the forge burns hot as the first age!", "Dwarfholm's hammers ring day and night in your honor.", "Whatever you need forged, it shall be forged."] },
  "dwarfholm.smith": { speaker: "Dwarven Smith", pages: ["The Forge Colossus guards the adamantite — the rarest ore beneath the mountain.", "Slay it, and the deepest veins are ours once more.", "But mind you: it drinks lightning like a dwarf drinks ale."] },
  "dwarfholm.elder": { speaker: "Elder", pages: ["The old kings say the Forge was built to temper a blade that could banish shadow itself.", "No surface forge has ever matched our embers. Then again, no surface smith has ever tried."] },
  "dwarfholm.child": { speaker: "Child", pages: ["I heard the Forge snore! Mother says it's the Colossus dreaming of hammers.", "When I grow up I'll swing a hammer so big the mountains feel it."] },
  "dwarfholm.miner": { speaker: "Miner", pages: ["We dig deep for mythril and adamantite, but the Forge swallows our lantern-light.", "The Colossus guards the best seams. Fair trade, I suppose — ore for courage."] },
  // Task #174: the forge-masters — recipes and enchantments.
  "dwarfholm.artificer": {
    speaker: "Artificer",
    branches: [
      { when: { flag: "sq_the_artificers_whetstone_done" }, id: "dwarfholm.artificer.after" },
      { when: { flag: "story_forge_colossus_defeated" }, id: "dwarfholm.artificer.forge" },
      { id: "dwarfholm.artificer.default" },
    ],
  },
  "dwarfholm.artificer.default": { speaker: "Artificer", pages: ["The Forge stands cold while the Colossus holds the deep seams.", "Wake the Forge, and I will teach you the old smithing — how to fold ember and frost and void into steel.", "Until then, I can only point at my anvil and sigh."] },
  "dwarfholm.artificer.forge": {
    speaker: "Artificer",
    pages: ["The Forge burns hot as the first age now!", "Bring me raw materials — embers, frost, runes, scales, pearls, spirits, void — and I will smith them into gear no merchant could sell.", "Weapons, armor, charms, and tonics — the recipes are mine, and now they are yours."],
    choices: [
      { text: "What can you forge?", next: "dwarfholm.artificer.recipes" },
      { text: "What should I gather?", next: "dwarfholm.artificer.materials" },
      { text: "Farewell." },
    ],
  },
  "dwarfholm.artificer.recipes": { speaker: "Artificer", pages: ["Fangs, shards, scales, pearls, embers, essences, void — each has its purpose.", "A few are obvious: embers rebirth, essence distills to ether, frost and fang steep into a strong tonic.", "For arms: rune, scale, and void yield sabre, edge, and brand. Pearl and rune make the cuirass; pearl and scale the tide-mail; frost and essence the cloak.", "And for charms: ember-and-essence strike the Sigil, while plain pearl works the Charm."] },
  "dwarfholm.artificer.materials": { speaker: "Artificer", pages: ["Embers come from the fire-born. Frost from the glacier's creatures.", "Runes from the Forge's own sentinels; scales from sky serpents; pearls from the Sunken Sanctum's reefs.", "Spirits linger in haunted places, and void only falls from the rift's creatures.", "Kill, gather, and return — the anvil will remember."] },
  "dwarfholm.artificer.after": { speaker: "Artificer", pages: ["The Whetstone rests on my bench, and my eye is keen again.", "The forge is yours as long as you bring the materials.", "Smith well, hero — the realm's finest steel now bears your mark."] },
  "dwarfholm.gemcutter": {
    speaker: "Gem Cutter",
    branches: [
      { when: { flag: "story_forge_colossus_defeated" }, id: "dwarfholm.gemcutter.ready" },
      { id: "dwarfholm.gemcutter.default" },
    ],
  },
  "dwarfholm.gemcutter.default": { speaker: "Gem Cutter", pages: ["A gem-cutter needs a steady forge to set stones properly.", "Wake the Forge and I will set any gem you find into the metal of your choosing — a blade or plate that carries the stone's essence."] },
  "dwarfholm.gemcutter.ready": { speaker: "Gem Cutter", pages: ["The Forge's heat is perfect for setting gems.", "Bring me a gem and a piece of gear — weapon, armor, or charm — and I will weave the stone's essence into it.", "One gem, one piece, one enchantment. Choose wisely; the bond is permanent."] },
  "glacierport.elder": {
    speaker: "Village Elder",
    branches: [
      { when: { flag: "sq_the_sunstone_done" }, id: "glacierport.elder.after" },
      { when: { item: "sunstone" }, id: "glacierport.elder.sunstone" },
      { id: "glacierport.elder.default" },
    ],
  },
  "glacierport.elder.default": { speaker: "Village Elder", pages: ["Glacierport was hewn from the permafrost before the crystals dimmed.", "The Frozen Caverns beneath the isle swallow our bravest hunters.", "Only embers hot as the Dwarven Forge could ever thaw that door."] },
  "glacierport.elder.sunstone": { speaker: "Village Elder", pages: ["The Sunstone — a shard of the dawn itself!", "Our braziers have guttered all winter; its warmth could relight them.", "Leave it with me, and Glacierport will never freeze again."] },
  "glacierport.elder.after": { speaker: "Village Elder", pages: ["The Sunstone blazes on the great brazier — the whole isle feels its warmth.", "Glacierport owes you its fire, hero. The ice will remember your name."] },
  "glacierport.captain": {
    speaker: "Harbor Captain",
    branches: [
      { when: { flag: "story_frost_wyrm_defeated" }, id: "glacierport.captain.task" },
      { id: "glacierport.captain.default" },
    ],
  },
  "glacierport.captain.default": { speaker: "Harbor Captain", pages: ["The Frost Wyrm coils in the cavern heart — no ship's wake is safe while it lives.", "The old sagas say its hoard holds a blade of living ice.", "Slay it, and the hoard is yours."] },
  "glacierport.captain.task": { speaker: "Harbor Captain", pages: ["You slew the Frost Wyrm! I saw the ice crack and the isle breathe.", "The saga-blade lies in its hoard — claim it, and my crew will sing of you."] },
  "glacierport.child": { speaker: "Child", pages: ["I heard the caverns growl! Mother says it's the Frost Wyrm snoring.", "When I grow up I'll hunt it, just like you."] },
  "glacierport.fisher": { speaker: "Fisher", pages: ["The channel east of Windfall runs cold and clear — my lines come up heavy here.", "Mind the ice floes at the isle's north edge; the mountain shadows are hungry."] },
  "glacierport.merchant": { speaker: "Merchant", pages: ["Furs, smoked fish, and frozen pearls from the shrine's own waters.", "Bring back a wyrm-scale and I'll pay its weight in gold."] },
  "timekeeper": {
    speaker: "Timekeeper",
    branches: [
      { when: { flag: "story_chrono_defeated" }, id: "timekeeper.after" },
      { when: { flag: "story_ember_fiend_defeated" }, id: "timekeeper.rift" },
      { id: "timekeeper.default" },
    ],
  },
  "timekeeper.default": { speaker: "Timekeeper", pages: ["I tend the shrine's clock, though the hands have stood still since Chaos fell.", "The altar below thrums with an old power — older than the crystals, older than the fiends.", "Somewhere beneath the Dark Altar, time itself runs thin."] },
  "timekeeper.rift": { speaker: "Timekeeper", pages: ["The Dark Altar cracks — a rift torn through time itself!", "Every fiend you laid low was an echo of the same wound.", "Enter the rift and face the Keeper of Time. Only the light of the crystals can guide you through."] },
  "timekeeper.after": { speaker: "Timekeeper", pages: ["The rift has closed, and the clock's hands turn true again.", "Time flows as it should — and it remembers you, hero of the crystals."] },
  // Task #162: the Hall of Trials — the arena's keeper, and its chronicler.
  "trial_master": {
    speaker: "Trial Master",
    branches: [
      { when: { flag: "trial_apex_cleared" }, id: "trial_master.apex_done" },
      { when: { flag: "any_trial_cleared" }, id: "trial_master.progress" },
      { when: { flag: "story_chrono_defeated" }, id: "trial_master.ready" },
      { id: "trial_master.sealed" },
    ],
  },
  "trial_master.ready": {
    speaker: "Trial Master",
    pages: ["Welcome to the Hall of Trials.", "Every fiend you laid low leaves an echo — and echoes may be called back to the circle.", "Step onto the gate and face them again, each stronger than before.", "Beat a trial and you earn a Keeper Token. Trade them with me for rewards."],
    choices: [
      { text: "How do the trials work?", next: "trial_master.rules" },
      { text: "What can I trade for?", next: "trial_master.tokens" },
      { text: "Speak of the Codex", next: "trial_master.codex" },
      { text: "Farewell." },
    ],
  },
  "trial_master.rules": { speaker: "Trial Master", pages: ["The gate calls back the fiends in the order you slew them, each echo more terrible than the last.", "Twelve trials stand between you and the Apex — a final echo beyond even the Keeper.", "The hall remembers every victory. Return to the gate whenever you are ready."] },
  "trial_master.tokens": { speaker: "Trial Master", pages: ["Every trial won earns Keeper Tokens — the coin of this hall.", "Bring me enough and I will open the vault: the Timeweaver, the Oath Ring, Megalixirs, and more.", "The last and greatest trial alone grants five."] },
  "trial_master.codex": { speaker: "Trial Master", pages: ["The Chronicler beside me keeps the Codex of Fiends — every foe the realm has faced.", "Speak to her to hear the tales. When the Apex falls, the Codex will be complete.", "Until then, the last page stays blank, waiting for a name."] },
  "trial_master.progress": { speaker: "Trial Master", pages: ["The echoes of your victories grow restless in the circle.", "The gate will call the next one when you step upon it.", "Hold fast, hero — the Apex waits at the end of all trials."] },
  "trial_master.apex_done": { speaker: "Trial Master", pages: ["The Apex has fallen, and with it the last echo.", "The hall stands silent now, its work complete.", "You have conquered time itself — there is no greater legend."] },
  "trial_master.sealed": { speaker: "Trial Master", pages: ["The hall is sealed in stillness, and I may not speak of its trials.", "Only the fall of the Keeper of Time would open this door — and the age of darkness with it."] },
  "trial_chronicler": {
    speaker: "Chronicler",
    pages: ["I keep the Codex of Fiends — the names of every shadow that has walked this land.", "Slay a fiend and its tale is written; face its echo in the trials and the tale is told twice.", "When the Apex falls, the Codex closes, complete."],
  },
  "sign.cornelia": "Cornelia — capital of the eastern lands.",
  "sign.inn": "Crystal Springs Inn — rest your weary feet.",
  "sign.shop": "General Store — the finest goods in the realm.",

  "cornelia.blacksmith": {
    speaker: "Blacksmith",
    branches: [
      { when: { flag: "sq_the_legendary_blade_done" }, id: "cornelia.blacksmith.blade.after" },
      { when: { item: "adamantiteOre" }, id: "cornelia.blacksmith.blade" },
      { when: { flag: "sq_the_ember_core_done" }, id: "cornelia.blacksmith.ember.after" },
      { when: { item: "emberCore" }, id: "cornelia.blacksmith.ember" },
      { id: "cornelia.blacksmith.default" },
    ],
  },
  "cornelia.blacksmith.default": { speaker: "Blacksmith", pages: ["I forge the blades the heroes carry.", "When the crystals shine again, I'll cast a sword worthy of a legend."] },
  "cornelia.blacksmith.ember": { speaker: "Blacksmith", pages: ["An Ember Core — live embers of the Sanctum's heart!", "With this I can re-light the town forge for a generation.", "Bring it to me when you're ready, and I'll make it worth your while."] },
  "cornelia.blacksmith.ember.after": { speaker: "Blacksmith", pages: ["The forge burns bright on your ember, hero.", "Every blade I cast from now on carries a spark of your courage."] },
  "cornelia.blacksmith.blade": { speaker: "Blacksmith", pages: ["Adamantite Ore — a mountain's worth of legend in your hands!", "The dwarves said its seams were lost ages ago.", "Leave it with me. The forge is hot, and the blade of legend is nearly yours."] },
  "cornelia.blacksmith.blade.after": { speaker: "Blacksmith", pages: ["The Luminary — it drinks shadow and sings when it strikes.", "No blade of the old kings ever shone so true.", "Carry it well, hero. The legend is yours now."] },
  "cornelia.mayor": {
    speaker: "Mayor",
    branches: [
      { when: { flag: "story_ember_fiend_defeated" }, id: "cornelia.mayor.fiend.after" },
      { when: { flag: "sq_the_fiend_slayer_started" }, id: "cornelia.mayor.fiend" },
      { id: "cornelia.mayor.default" },
    ],
  },
  "cornelia.mayor.default": { speaker: "Mayor", pages: ["The town council has pledged supplies to any party that seeks the crystals.", "Speak with the king first — he holds the key to the castle gates."] },
  "cornelia.mayor.fiend": { speaker: "Mayor", pages: ["The Ember Fiend is said to slumber beneath the northern volcano.", "If she wakes, no hearth in Cornelia will ever burn warm again."] },
  "cornelia.mayor.fiend.after": { speaker: "Mayor", pages: ["The Ember Fiend is gone, and every hearth in the realm burns warm again.", "Cornelia honors its heroes — the Fiend Slayer's name will be sung for ages."] },
  "cornelia.townsman": "If you're bound for the caves, buy rope. The hermit deep inside sells wisdom for potions.",
  // Task #139: a group conversation — interacting with one NPC (the guard)
  // pulls the mayor and the smith into the exchange. The `with` array names
  // the participants; per-page { speaker, text } objects pass the dialogue
  // between them.
  "cornelia.group": {
    with: ["cornelia_guard", "cornelia_mayor"],
    pages: [
      { speaker: "Town Guard", text: "Hold a moment, hero — the mayor has been looking for you." },
      { speaker: "Mayor", text: "Indeed! The council meets at dusk. Maps of the northern wastes, and a purse for whoever braves them." },
      { speaker: "Town Guard", text: "We'll keep the gate watch until then. Don't keep her waiting." },
    ],
  },
  "cornelia.castle_guard": {
    speaker: "Castle Guard",
    branches: [
      { when: { item: "crystalKey" }, id: "cornelia.castle_guard.open" },
      { id: "cornelia.castle_guard.closed" },
    ],
  },
  "cornelia.castle_guard.closed": { speaker: "Castle Guard", pages: ["The castle is barred to all but the king's chosen.", "Prove your worth by finding the Crystal Key."] },
  "cornelia.castle_guard.open": { speaker: "Castle Guard", pages: ["You carry the Crystal Key — the throne room is yours, hero."] },

  "overworld.garland_rumor": { speaker: "Wayfarer", pages: ["I saw a knight in dark armor riding west toward the shrine.", "They say Garland seeks the crystals' power for himself."] },
  "overworld.pravog_seen": { speaker: "Herald", pages: ["Port of Pravog — ships sail from its docks to the northern isles.", "The harbor master hires crews, if you can pay the fare."] },

  "pravo.merchant": { speaker: "Merchant", pages: ["Spices, silks, and seashell trinkets — all bound for the capital.", "Take a shell; they say the ocean hears your wishes in them."] },
  "pravo.mayor": {
    speaker: "Mayor of Pravog",
    branches: [
      { when: { flag: "story_phantom_light_defeated" }, id: "pravo.mayor.after" },
      { when: { flag: "sq_the_lighthouse_flame_started" }, id: "pravo.mayor.task" },
      { id: "pravo.mayor.default" },
    ],
  },
  "pravo.mayor.default": { speaker: "Mayor of Pravog", pages: ["The sea lanes have grown treacherous since the crystals dimmed.", "My own son was lost sailing for the Wind Crystal. Bring light back to the waves."] },
  "pravo.mayor.task": { speaker: "Mayor of Pravog", pages: ["The lighthouse has shown no true light in years — only that false, cold beacon.", "Quench it, and the keeper's flame will guide our ships home again."] },
  "pravo.mayor.after": { speaker: "Mayor of Pravog", pages: ["The Phantom Light is gone — the true lamp burns over the headland once more!", "Every sailor off Pravog will sleep easier for what you've done.", "Pravog honors you, heroes. May the light always find you."] },
  "pravo.housewife": "The fishermen pray to the Sea Shrine each dawn. Lately, the sea answers with storms.",
  "pravo.ship_offer": { speaker: "Harbor Master", pages: ["You seek the northern isles? My ship, the Dawnbreaker, is yours — its captain owes the king a debt.", "The tides are calm. The seas will carry you north."] },
  "pravo.ship_grant": { speaker: "Harbor Master", pages: ["The Dawnbreaker awaits at the dock. She answers the sea breeze, not the oar.", "May the currents favor you, heroes of Cornelia."] },
  // Task #168: the harbor's new voices — dock hands, fishers, and the priest.
  "pravo.dockworker": "Load the crates, lads — the Dawnbreaker sails for the wastes at dusk!",
  "pravo.fisherman": "The east coast runs thick with reef serpents since the storms. Every line comes up gnawed.",
  "pravo.fisherwife": "My man swears he saw lights off the north headland — sea-foam spirits, he says. The priest tells him to pray harder.",
  "pravo.dockchild": "I'm going to be a sailor one day! I already know every knot — watch: clove hitch, bowline, sheet bend...",
  "pravo.resident": "The whole town smells of salt and fish, but I wouldn't trade it. The docks are our heartbeat.",
  "pravo.armorer": "Forged on the coast, tempered by the salt wind. A blade worth its weight in gold — and priced about the same.",
  "pravo.priest": "We pray to the Sea Shrine for calm waters. The tide has been cruel of late, but the light always finds the faithful.",
  "pravo.harbormaster.after": { speaker: "Harbor Master", pages: ["The Dawnbreaker knows the northern route now — charted by brave souls.", "She'll carry you to the wastes whenever the wind is willing."] },

  "marsh.trapper": { speaker: "Trapper", pages: ["Beyond this marsh, the waters deepen and the mud swallows the careless.", "The Guardian below feeds on the drowned. Do not linger in the depths."] },
  "marsh.warning": { speaker: "Wanderer", pages: ["This place is cursed. The water here does not reflect the sky — only shadows."] },
  // Task #173: the Northern Wastes and Northwind Village — the frozen north
  // beyond Pravog's docks.
  "northwastes.scout": { speaker: "Wastes Scout", pages: ["The pass through the ridges is narrow — one misstep on the ice and the wolves find you.", "Northwind's folk trade warm furs for iron. They'll know more than I do."] },
  "northwastes.hunter": { speaker: "Snow Hunter", pages: ["I tracked a frost serpent to the cave mouth, then thought better of it.", "They say the ice inside glows with a crystal light — colder than any winter."] },
  "northwind.elder": {
    speaker: "Village Elder",
    branches: [
      { when: { flag: "story_frost_crystal_taken" }, id: "northwind.elder.after" },
      { id: "northwind.elder.default" },
    ],
  },
  "northwind.elder.default": { speaker: "Village Elder", pages: ["We are the last hearth between the wastes and the world.", "Beyond our village stands the Ice Cave. Its deepest chamber sleeps behind a wall of living crystal — only a crystal of equal light may pass."] },
  "northwind.elder.after": { speaker: "Village Elder", pages: ["You hold the Frost Crystal — the cave's heart beats for you now.", "Take what lies beneath the ice, and let the wastes remember your name."] },
  "northwind.huntress": { speaker: "Huntress", pages: ["A frost wyrm once nested in those caverns. The cave's beasts keep its cold ways.", "Watch the ice floors — they shine fair and bite hard."] },
  "northwind.trapper": { speaker: "Trapper", pages: ["Set a line on the ice and the catch comes frozen already.", "The wastes take a careless man whole — boots, pack, and all."] },
  "northwind.child": { speaker: "Child", pages: ["I found a pretty rock in the cave that glows blue! The elder took it away...", "Said it was a 'crystal of the deep.' I want it back someday."] },
  "northwind.villager": "Every winter the village shrinks a little more. The warm lands forget us — until the monsters crawl south.",
  "northwind.shopkeep": { speaker: "Shopkeeper", pages: ["Furs, frost salves, and blades that hold an edge in the cold.", "Take what you need — the wastes don't wait for second trips."] },
  "plot.frost_crystal_taken": { speaker: "Village Elder", pages: ["You took the Frost Crystal from the cave's mouth? The ice will quiet now.", "The deep chamber is yours to claim, hero."] },

  "plot.garland_defeated": { speaker: "King Cornelia", pages: ["Garland has fallen! The princess is safe, and the road to the four crystals lies open.", "Take the ship from Pravog and seek the marshlands to the south."] },
  "plot.marsh_guardian_defeated": { speaker: "King Cornelia", pages: ["The Marsh Guardian is slain — a second crystal's light is within reach.", "The Wind Crystal lies north, beyond the mountains. Only the airship can cross."] },
  "plot.engine_obtained": { speaker: "King Cornelia", pages: ["The airship engine is restored? Then the skies are ours once more.", "Fly north, beyond the mountains — the Wind Shrine awaits, and with it the Wind Crystal.", "No other road can cross that ridge. The airship is your only way."] },
  "plot.wind_fiend_defeated": { speaker: "King Cornelia", pages: ["The Wind Fiend has fallen! The sky's own terror is quiet.", "The winds that howl across the world have turned gentle.", "The airship's sails catch a calm breeze now — the realm is truly at peace."] },
  "plot.tide_serpent_defeated": { speaker: "King Cornelia", pages: ["The Tide Serpent has fallen — the sea lanes are safe at last.", "With the ship and the shrine calm, every shore of the realm rests easy.", "Sail where you will, heroes. The ocean is yours."] },
  "plot.phantom_light_defeated": { speaker: "King Cornelia", pages: ["The Phantom Light is quenched — the true lamp burns over Pravog once more.", "No false beacon will lure another ship onto the rocks.", "The lighthouse keeper's spirit can finally rest."] },
  "plot.ember_fiend_defeated": { speaker: "King Cornelia", pages: ["The Ember Fiend has fallen — the volcano sleeps at last!", "With the Wind Fiend and the Ember Fiend both laid low, no darkness remains in the realm.", "The four crystals shine, and every flame now warms instead of burns. You have done the impossible."] },
  "plot.forge_colossus_defeated": { speaker: "Dwarf King", pages: ["The Forge Colossus is quiet — the adamantite veins are ours once more!", "Every anvil in Dwarfholm rings with the news.", "Take the ore it guarded, surface hero. The deepest forge-fires are yours to command."] },
  "plot.frost_wyrm_defeated": { speaker: "King Cornelia", pages: ["The Frost Wyrm has fallen — the Glacier Isle breathes warm at last!", "The eastern seas run clear, and the sagas of the frozen isle are told anew.", "Nothing in the realm is beyond you now, true heroes of Cornelia."] },
  "plot.chrono_defeated": { speaker: "King Cornelia", pages: ["The Keeper of Time has fallen — the rift is sealed, and the age of darkness truly ends.", "Every clock in the realm ticks true again.", "This is the end of the tale, heroes — and the beginning of legend."] },
  "plot.gulg_guardian_defeated": { speaker: "King Cornelia", pages: ["The Forge Golem has crumbled to dust — the Earth Crystal's flame is yours.", "Three crystals restored. One remains: the Wind Crystal, held by Chaos himself in the shrine.", "Return to the Chaos Shrine when you are ready. The final battle awaits."] },
  "plot.chaos_awaits": { speaker: "King Cornelia", pages: ["The Wind Crystal rests in the shrine's dark altar, and Chaos himself guards it.", "Rest, arm, and return to the shrine when the land is quiet. This is the last road."] },
  "plot.chaos_defeated": { speaker: "King Cornelia", pages: ["Chaos has fallen! The Wind Crystal blazes anew.", "The four crystals shine together, and the darkness is broken at last.", "The world breathes free once more — thanks to you, true heroes of Cornelia."] },
  // Task #150: the mid-game plot twist — the Mysterious Traveler unmasks the
  // conspiracy behind the throne after Garland's fall and the Marsh Guardian's.
  "plot.twist_king": { speaker: "Mysterious Traveler", pages: ["You felled Garland... and the King smiled. Did you not find that strange?", "The knight was a puppet, hero. The fiends answer to a darker voice — one that wears a crown.", "Trust nothing the throne tells you now. The truth lies beyond the eastern sea, where the wind crystal is held."] },

  "plot.king_plea": {
    speaker: "King Cornelia",
    byClass: {
      warrior: "plot.king_plea.warrior",
      default: "plot.king_plea.default",
    },
  },
  "plot.king_plea.warrior": {
    speaker: "King Cornelia",
    pages: ["A warrior's blade is exactly what we need. The crystals fade, hero — reclaim them from the dark.", "Will you take up the quest?"],
    choices: [
      { text: "I will restore the light.", flag: "plot_accept", next: "plot.king_plea.accept" },
      { text: "I must prepare first.", flag: "plot_decline", next: "plot.king_plea.decline" },
    ],
  },
  "plot.king_plea.default": {
    speaker: "King Cornelia",
    pages: ["The crystals fade, traveler. We need you to reclaim them from the dark.", "Will you take up the quest?"],
    choices: [
      { text: "I will restore the light.", flag: "plot_accept", next: "plot.king_plea.accept" },
      { text: "I must prepare first.", flag: "plot_decline", next: "plot.king_plea.decline" },
    ],
  },
  "plot.king_plea.accept": { speaker: "King Cornelia", pages: ["Blessings of the crystals be with you."] },
  "plot.king_plea.decline": { speaker: "King Cornelia", pages: ["The light will not wait forever, traveler."] },
  "plot.garland_warning": { speaker: "Elder Hermit", pages: ["Garland has taken the princess to the Chaos Shrine.", "He feeds on the crystals' fading light. Find the Crystal Key and stop him."] },
  "plot.crystals_restored": { speaker: "King Cornelia", pages: ["The four crystals shine again!", "The darkness recedes, and the land breathes free. You are the true heroes of Cornelia."] },
  "cornelia.festival": { speaker: "Town Crier", pages: ["The Festival of Light begins tonight, in honor of the recovered crystal!"] },
  "cornelia.guard_warn": { speaker: "Town Guard", pages: ["Bandits have been seen on the western roads. Travel armed, friend."] },
  // Task #185: the Waystone Keeper of Cornelia — guardian of the network,
  // who sends the party to light every stone.
  "cornelia.waystone_keeper": {
    speaker: "Waystone Keeper",
    branches: [
      { when: { flag: "sq_the_waystone_pilgrim_done" }, id: "cornelia.waystone_keeper.after" },
      { when: { flag: "sq_waystone_pilgrim_all" }, id: "cornelia.waystone_keeper.done" },
      { when: { flag: "sq_the_waystone_pilgrim_started" }, id: "cornelia.waystone_keeper.progress" },
      { id: "cornelia.waystone_keeper.default" },
    ],
  },
  "cornelia.waystone_keeper.default": {
    speaker: "Waystone Keeper",
    pages: ["Welcome, traveler. These stones are older than the town itself — the smiths of the first age set them so no road would ever be walked twice.", "Touch a stone and it lights. Touch two, and the network will carry you between them in a single breath.", "Six stones lie scattered across the realm — in Cornelia, Pravog, Elfheim, Windfall, Dwarfholm, and Glacierport. Light them all, and the wayfarer's blessing is yours."],
    choices: [
      { text: "I will light them all.", flag: "sq_the_waystone_pilgrim_started", next: "cornelia.waystone_keeper.accepted" },
      { text: "I only came to listen.", next: "cornelia.waystone_keeper.farewell" },
    ],
  },
  "cornelia.waystone_keeper.accepted": { speaker: "Waystone Keeper", pages: ["Then walk the network, hero. Every stone you light makes the realm a little smaller.", "Return to me when all six burn, and the wayfarer's blessing will be yours to keep."] },
  "cornelia.waystone_keeper.farewell": { speaker: "Waystone Keeper", pages: ["The stones will be here when you are ready. Safe roads, traveler."] },
  "cornelia.waystone_keeper.progress": { speaker: "Waystone Keeper", pages: ["The network stirs — I can feel the stones waking one by one.", "Find every stone you can. Cornelia burns always; the others await a traveler's touch."] },
  "cornelia.waystone_keeper.done": { speaker: "Waystone Keeper", pages: ["All six stones burn bright as the first age!", "The network is whole again. Take the wayfarer's blessing — it steadies the road beneath your feet."] },
  "cornelia.waystone_keeper.after": { speaker: "Waystone Keeper", pages: ["The wayfarer's blessing hums on your charm.", "Travel well, hero — every road in the realm answers to you now."] },
  // Task #197: the Remembrance Sage of Castle Cornelia — the keeper of the
  // broken age, who can turn the world again once the Keeper of Time falls.
  "cornelia.sage": {
    speaker: "Remembrance Sage",
    branches: [
      { when: { flag: "ngplus_echo_defeated" }, id: "cornelia.sage.after_echo" },
      { when: { flag: "ngplus_cycle" }, id: "cornelia.sage.cycle" },
      { when: { flag: "story_chrono_defeated" }, id: "cornelia.sage.offer" },
      { id: "cornelia.sage.before" },
    ],
  },
  "cornelia.sage.before": { speaker: "Remembrance Sage", pages: ["I remember the age before this one, and the age before that, and the first silence after the crystals woke.", "Every ending I have lived, I have also watched begin again.", "When the Keeper of Time falls and the age truly ends, come to me — and I will turn the world for you."] },
  "cornelia.sage.offer": {
    speaker: "Remembrance Sage",
    pages: ["The Keeper of Time is dead. This age has ended.", "I can turn the world again — the same realm, reborn, with every foe it ever knew grown terrible.", "Your party would carry its strength into the new age; only the keys of the story must be found anew.", "The hollow at the Hall of Trials would also drink the light, and something before the crystals would wake."],
    choices: [
      { text: "Turn the world. Begin the next cycle.", flag: "ngplus_begin_requested", next: "cornelia.sage.begin" },
      { text: "The age is not yet finished with me.", next: "cornelia.sage.wait" },
    ],
  },
  "cornelia.sage.begin": { speaker: "Remembrance Sage", pages: ["Then let the age shatter, and let it re-form around you.", "Keep your strength. Keep your gold. Keep what your hands can carry — but find every door anew.", "Travel well in the second age, hero. And when that age ends too, I will be here."] },
  "cornelia.sage.wait": { speaker: "Remembrance Sage", pages: ["The world will wait for your decision, hero — it has waited before.", "Return when you are ready."] },
  "cornelia.sage.cycle": { speaker: "Remembrance Sage", pages: ["This is not the first age I have seen you walk, hero — and your steps fall lighter in it.", "Your strength carried over, your stones stayed lit, and every foe of the realm rose to meet you.", "Should the Keeper of Time fall again, I can turn the world once more. And the hollow at the Hall of Trials still holds its hunger for you."] },
  "cornelia.sage.after_echo": { speaker: "Remembrance Sage", pages: ["You silenced the Echo of Creation — the cry of the world before the crystals.", "No foe the ages can raise will ever frighten you again.", "Rest, hero of every age. When the next cycle ends, I will turn the world a final time."] },
  // Task #176/#178: the Southern Jungles — the guide who meets the ship and
  // the hunter who knows every green trail.
  "jungleguide.greeting": { speaker: "Jungle Guide", pages: ["Welcome to the Southern Jungles, heroes. The river mouth is safe — the deep green is not.", "Follow the lanterns to the village. And mind the ruins: the Old Ones' stones still hold their grudges."] },
  "jungle.hunter": { speaker: "Jungle Hunter", pages: ["The beasts here hunt in packs, and the ruins echo with things that should stay buried.", "If you seek the Old Ones' hoard, find the Sun-Moss Relic first — the shaman knows its resting place."] },
  "jungle.elder": {
    speaker: "Village Elder",
    pages: [
      "The jungle has always been. Before the crystals dimmed, before the kingdoms rose — the green was here.",
      "We are its keepers, as our mothers' mothers were. And the ruins at the river bend are its oldest wound.",
    ],
  },
  "jungle.shaman": { speaker: "Shaman", pages: ["The Old Ones built their halls beneath the temple mound, and walled the deep door with stone that remembers.", "Only the Sun-Moss Relic can part it — a relic our elders hid in the ruins above, where the light still falls.", "Find it in the moss-lit hall beyond the broken stairs. The stones will test you; the relic will answer."] },
  "jungle.herbalist": { speaker: "Herbalist", pages: ["Vine-bark for fever, moss-spore for aches, and a pinch of sun-leaf to keep the dark at bay.", "The ruins' air is thick with old spores — a care for the lungs is worth more than gold down there."] },
  "jungle.child": { speaker: "Child", pages: ["I saw the big-eyed beetle march in a line all the way to the ruins! It knew the way, I swear!", "When I'm big I'll be a Ruin Diver, like the stories. The Old Ones' gold will buy the whole village new roofs!"] },
  "jungle.villager": "The vines grow over everything given half a season. That is the jungle's way — it forgives nothing, forgets nothing.",
  "jungle.housewife": "The shaman says the ruins stirred last new moon. We light the village lanterns a little brighter since.",
  "jungle.shopkeep": { speaker: "Trader", pages: ["Vine cord, jungle herbs, and blades that hold an edge in the damp.", "Take what you need — the jungle doesn't wait for second trips."] },
  "plot.ruins_relic_found": { speaker: "Shaman", pages: ["You hold the Sun-Moss Relic — the Old Ones' light answers you now.", "The deep door of the Sunken Hall beneath the ruins will part for its bearer. Claim what the stones have kept, hero."] },
  // Task #181/#183: the Western Highlands — Stormhold's roads and court.
  "highlands.scout": { speaker: "Highlands Scout", pages: ["The passes above the treeline are clear today, but the wind bites hard on the peak.", "Stormhold's banner flies high — but even the Duke's best could not tame the storm at the summit."] },
  "highlands.guard": { speaker: "Castle Patrol", pages: ["Halt! ...Ah, travelers from the south. The Duke welcomes any who brave the jungle road.", "The storm at the peak has grown worse this season — the old wind-cages on the climb are the only safe footing."] },
  "highlands.herald": { speaker: "Herald", pages: ["Duke Aldric of Stormhold receives you, heroes of the south.", "The Duke's line has held the highlands since before the crystals faded — and the storm summit has never bowed to any throne."] },
  "highlands.duke": {
    speaker: "Duke Aldric",
    pages: [
      "You come from the green lands beyond the treeline. The jungle has claimed many brave souls; that you stand here speaks well of you.",
      "The storm at the Highland Peak is my white whale. It crowns the tallest crag in the realm, and no wind-cage holds at its heart.",
      "A Gale Cloak will keep your party whole on the climb — my armorer will sell you one. Tame the summit, and the highlands will sing your name forever.",
    ],
  },
  "highlands.duchess": { speaker: "Duchess Seraphine", pages: ["My husband speaks of nothing but that storm.", "Take the cloak, brave the climb, and bring back the still air from the summit — and this court will owe you its finest favor."] },
  "highlands.captain": { speaker: "Captain Voss", pages: ["My patrols lose men to the peak's wind every winter. Climb with a Gale Cloak and heavy hearts.", "The storm has a voice, they say. Those who hear it and come back down speak of a light at the summit's eye."] },
};
