(function () {
  "use strict";
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const pickN = (arr, n) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a.slice(0, n); };

  const LOCS = ["HEAD", "LT", "CT", "RT", "LA", "RA", "LL", "RL"];

  const ERAS = [
    { id: "succession", name: "Succession Wars", years: "3025", tech: 1, desc: "LosTech. Lost technologies, brutal grinding wars of the Great Houses. IntroTech only — no double heat sinks, no XL engines.", losTech: 0.02, clans: false, techScarcity: "Succession Wars scarcity — intro-tech dominates, and even a working medium laser is worth its weight in gold." },
    { id: "invasion", name: "Clan Invasion", years: "3050", tech: 2, desc: "The Clans return from the deep periphery with Star League-era machines — and their own terrifying omnimechs.", losTech: 0.12, clans: true, techScarcity: "Clan salvage has flooded some markets, but recovered Star League hardware still commands a premium." },
    { id: "civilwar", name: "FedCom Civil War", years: "3063", tech: 3, desc: "The Federated Commonwealth tears itself apart. Advanced IS tech spreads while the Clans consolidate the Occupation Zones.", losTech: 0.18, clans: true, techScarcity: "Advanced IS tech is spreading — the premium on new hardware is softening, but demand is relentless." },
    { id: "jihad", name: "Jihad", years: "3068", tech: 4, desc: "Word of Blake unleashes chaos across the Sphere. Every contract is desperate; every drop is dangerous.", losTech: 0.24, clans: true, techScarcity: "Jihad chaos — military hardware is in brutal demand on every world that still has a functioning market." },
    { id: "darkage", name: "Dark Age", years: "3135", tech: 5, desc: "The Republic collapses. Fortress worlds, fractured states, and mercenaries richer than nations.", losTech: 0.3, clans: true, techScarcity: "Post-Clan abundance — even cutting-edge gear moves cheap on the open market." }
  ];

  const FACTIONS = [
    { id: "steiner", name: "Lyran Commonwealth", glyph: "♛", color: "#3d6fa9", type: "house", eraMin: 0, desc: "Proud, wealthy, and generous with contracts — they pay on time." },
    { id: "davion", name: "Federated Suns", glyph: "☀", color: "#c9a227", type: "house", eraMin: 0, desc: "The Suns fight with conviction and pay their mercenaries well." },
    { id: "kurita", name: "Draconis Combine", glyph: "☯", color: "#b03a48", type: "house", eraMin: 0, desc: "The Dragon is harsh, honor-bound, and slow to forgive betrayal." },
    { id: "liao", name: "Capellan Confederation", glyph: "✪", color: "#3f9e63", type: "house", eraMin: 0, desc: "Cunning and patient. Contracts are precise, payment grudging." },
    { id: "marik", name: "Free Worlds League", glyph: "◈", color: "#7a5fa8", type: "house", eraMin: 0, desc: "A squabbling parliament that nonetheless honors its treaties." },
    { id: "taurian", name: "Taurian Concordat", glyph: "♉", color: "#8a8f98", type: "periphery", eraMin: 0, desc: "Bull-headed periphery defenders with chips on both shoulders." },
    { id: "canopus", name: "Magistracy of Canopus", glyph: "✦", color: "#c77ba0", type: "periphery", eraMin: 0, desc: "Pleasure circuses, advanced medicine, and sharp business sense." },
    { id: "pirate", name: "Pirates & Outlaws", glyph: "☠", color: "#9a9a9a", type: "pirate", eraMin: 0, desc: "No honor, no contract law. They pay in blood and salvage." },
    { id: "comstar", name: "ComStar", glyph: "☸", color: "#d8d8d8", type: "comstar", eraMin: 0, eraMax: 0, desc: "The mystical order of HPG communication — and so much more." },
    { id: "wob", name: "Word of Blake", glyph: "☩", color: "#c8b25a", type: "comstar", eraMin: 3, desc: "The fanatical splinter of ComStar. Their contracts hide agendas." },
    { id: "jade-falcon", name: "Clan Jade Falcon", glyph: "☓", color: "#4f9e5a", type: "clan", eraMin: 1, desc: "Proud, aggressive, obsessed with honor and dezgra." },
    { id: "wolf", name: "Clan Wolf", glyph: "▲", color: "#5d7d8f", type: "clan", eraMin: 1, desc: "The ilKhan's clan. Pragmatic predators in a warrior society." },
    { id: "ghost-bear", name: "Clan Ghost Bear", glyph: "♊", color: "#7a8bb0", type: "clan", eraMin: 1, desc: "Deliberate and implacable; they honor bonds of blood." },
    { id: "smoke-jaguar", name: "Clan Smoke Jaguar", glyph: "⚡", color: "#b0703a", type: "clan", eraMin: 1, eraMax: 1, desc: "Fierce, arrogant predators — annihilated by 3060 for their crimes." },
    { id: "nova-cat", name: "Clan Nova Cat", glyph: "⌘", color: "#b0516a", type: "clan", eraMin: 1, desc: "Mystics who read omens before every batchall." },
    { id: "diamond-shark", name: "Clan Diamond Shark", glyph: "◇", color: "#3f9ea8", type: "clan", eraMin: 2, desc: "Merchant-warriors who trade more than they fight." }
  ];

  const WEAPONS = [
    { id: "mlaser", name: "Medium Laser", cls: "energy", dmg: 5, cost: 40000, eraMin: 0, tech: "IS" },
    { id: "slaser", name: "Small Laser", cls: "energy", dmg: 3, cost: 11250, eraMin: 0, tech: "IS" },
    { id: "llaser", name: "Large Laser", cls: "energy", dmg: 8, cost: 100000, eraMin: 0, tech: "IS" },
    { id: "ppc", name: "Particle Projector Cannon", cls: "energy", dmg: 10, cost: 200000, eraMin: 0, tech: "IS" },
    { id: "flamer", name: "Flamer", cls: "energy", dmg: 2, cost: 7500, eraMin: 0, tech: "IS" },
    { id: "ac2", name: "AC/2", cls: "ballistic", dmg: 2, cost: 75000, eraMin: 0, tech: "IS" },
    { id: "ac5", name: "AC/5", cls: "ballistic", dmg: 5, cost: 125000, eraMin: 0, tech: "IS" },
    { id: "ac10", name: "AC/10", cls: "ballistic", dmg: 10, cost: 200000, eraMin: 0, tech: "IS" },
    { id: "ac20", name: "AC/20", cls: "ballistic", dmg: 20, cost: 300000, eraMin: 0, tech: "IS" },
    { id: "mg", name: "Machine Gun", cls: "ballistic", dmg: 2, cost: 5000, eraMin: 0, tech: "IS" },
    { id: "srm2", name: "SRM-2", cls: "missile", dmg: 4, cost: 10000, eraMin: 0, tech: "IS" },
    { id: "srm4", name: "SRM-4", cls: "missile", dmg: 8, cost: 20000, eraMin: 0, tech: "IS" },
    { id: "srm6", name: "SRM-6", cls: "missile", dmg: 12, cost: 30000, eraMin: 0, tech: "IS" },
    { id: "lrm5", name: "LRM-5", cls: "missile", dmg: 5, cost: 30000, eraMin: 0, tech: "IS" },
    { id: "lrm10", name: "LRM-10", cls: "missile", dmg: 10, cost: 100000, eraMin: 0, tech: "IS" },
    { id: "lrm15", name: "LRM-15", cls: "missile", dmg: 15, cost: 175000, eraMin: 0, tech: "IS" },
    { id: "lrm20", name: "LRM-20", cls: "missile", dmg: 20, cost: 250000, eraMin: 0, tech: "IS" },
    { id: "gauss", name: "Gauss Rifle", cls: "ballistic", dmg: 15, cost: 550000, eraMin: 2, tech: "IS" },
    { id: "erppc", name: "ER PPC", cls: "energy", dmg: 12, cost: 450000, eraMin: 1, tech: "IS" },
    { id: "erll", name: "ER Large Laser", cls: "energy", dmg: 10, cost: 300000, eraMin: 1, tech: "IS" },
    { id: "erml", name: "ER Medium Laser", cls: "energy", dmg: 6, cost: 100000, eraMin: 1, tech: "IS" },
    { id: "uac5", name: "Ultra AC/5", cls: "ballistic", dmg: 10, cost: 300000, eraMin: 1, tech: "IS" },
    { id: "uac10", name: "Ultra AC/10", cls: "ballistic", dmg: 20, cost: 550000, eraMin: 2, tech: "IS" },
    { id: "lbx10", name: "LB 10-X AC", cls: "ballistic", dmg: 10, cost: 400000, eraMin: 2, tech: "IS" },
    { id: "ssrm2", name: "Streak SRM-2", cls: "missile", dmg: 6, cost: 30000, eraMin: 1, tech: "IS" },
    { id: "c-erml", name: "Clan ER Medium Laser", cls: "energy", dmg: 7, cost: 200000, eraMin: 1, tech: "Clan" },
    { id: "c-erll", name: "Clan ER Large Laser", cls: "energy", dmg: 12, cost: 600000, eraMin: 1, tech: "Clan" },
    { id: "c-erppc", name: "Clan ER PPC", cls: "energy", dmg: 15, cost: 800000, eraMin: 1, tech: "Clan" },
    { id: "c-lrm20", name: "Clan LRM-20", cls: "missile", dmg: 24, cost: 600000, eraMin: 1, tech: "Clan" },
    { id: "c-srm6", name: "Clan SRM-6", cls: "missile", dmg: 16, cost: 120000, eraMin: 1, tech: "Clan" },
    { id: "c-gauss", name: "Clan Gauss Rifle", cls: "ballistic", dmg: 20, cost: 900000, eraMin: 1, tech: "Clan" },
    { id: "c-ubac20", name: "Clan Ultra AC/20", cls: "ballistic", dmg: 28, cost: 900000, eraMin: 1, tech: "Clan" }
  ];
  const WMAP = Object.fromEntries(WEAPONS.map((w) => [w.id, w]));

  const MECHS = [
    { id: "locust", name: "Locust LCT-1V", ton: 20, cls: "light", cost: 1500000, weapons: ["mg", "mg"], armor: 384, eraMin: 0, tech: "IS", fac: ["steiner", "davion", "kurita", "liao", "marik", "taurian", "canopus", "pirate"], desc: "Fast, fragile, and everywhere. The Locust is the scout mech of the Inner Sphere." },
    { id: "wasp", name: "Wasp WSP-1A", ton: 20, cls: "light", cost: 1560000, weapons: ["mlaser", "srm2", "mg"], armor: 352, eraMin: 0, tech: "IS", fac: ["steiner", "davion", "kurita", "liao", "marik", "pirate", "taurian"], desc: "A classic recon bug mech with jump jets and a sting." },
    { id: "stinger", name: "Stinger STG-3R", ton: 20, cls: "light", cost: 1480000, weapons: ["mlaser", "mg"], armor: 368, eraMin: 0, tech: "IS", fac: ["steiner", "davion", "kurita", "liao", "marik", "pirate"], desc: "The most common BattleMech ever built — a jumpy nuisance." },
    { id: "commando", name: "Commando COM-2D", ton: 25, cls: "light", cost: 1870000, weapons: ["srm6", "mlaser"], armor: 384, eraMin: 0, tech: "IS", fac: ["steiner"], desc: "Lyran close-assault light packing a disproportionate punch." },
    { id: "jenner", name: "Jenner JR7-D", ton: 35, cls: "light", cost: 2750000, weapons: ["srm4", "mlaser", "mlaser", "mlaser", "mlaser"], armor: 400, eraMin: 0, tech: "IS", fac: ["kurita"], desc: "The Combine's raider: four medium lasers and a jump-jet bite." },
    { id: "panther", name: "Panther PNT-9R", ton: 35, cls: "light", cost: 2400000, weapons: ["ppc", "srm4"], armor: 480, eraMin: 0, tech: "IS", fac: ["kurita", "liao"], desc: "A light with an assault mech's gun. Snipers love it." },
    { id: "spider", name: "Spider SDR-5V", ton: 30, cls: "light", cost: 1900000, weapons: ["mlaser", "mlaser"], armor: 288, eraMin: 0, tech: "IS", fac: ["liao", "marik", "davion"], desc: "Ultra-mobile, nearly armor-less, and infuriating to catch." },
    { id: "urbanmech", name: "UrbanMech UM-R60", ton: 30, cls: "light", cost: 1600000, weapons: ["ac10", "slaser"], armor: 480, eraMin: 0, tech: "IS", fac: ["pirate", "liao", "taurian"], desc: "A trash-can with an AC/10. Ridiculed — until it kills you." },
    { id: "valkyrie", name: "Valkyrie VLK-QA", ton: 30, cls: "light", cost: 2050000, weapons: ["lrm10", "mlaser"], armor: 384, eraMin: 0, tech: "IS", fac: ["davion", "steiner"], desc: "The first Davion 'mech, a reliable LRM-support light." },
    { id: "kitfox", name: "Kit Fox (Clan)", ton: 30, cls: "light", cost: 5200000, weapons: ["c-erml", "c-lrm20", "c-erml"], armor: 384, eraMin: 1, tech: "Clan", fac: ["jade-falcon", "wolf"], desc: "A Clan light omnimech with an embarrassment of pod space." },
    { id: "centurion", name: "Centurion CN9-A", ton: 50, cls: "medium", cost: 4100000, weapons: ["ac10", "lrm10", "mlaser"], armor: 544, eraMin: 0, tech: "IS", fac: ["davion", "taurian"], desc: "The workhorse trooper of the Suns — tough, reliable, grim." },
    { id: "enforcer", name: "Enforcer ENF-4R", ton: 50, cls: "medium", cost: 4300000, weapons: ["ac10", "llaser", "srm2"], armor: 480, eraMin: 0, tech: "IS", fac: ["davion", "steiner"], desc: "A Davion brawler built for close work with big guns." },
    { id: "hunchback", name: "Hunchback HBK-4G", ton: 50, cls: "medium", cost: 3500000, weapons: ["ac20", "mlaser", "mlaser", "slaser"], armor: 512, eraMin: 0, tech: "IS", fac: ["marik", "pirate", "kurita"], desc: "One giant AC/20 in a shoulder pod. Do not get close." },
    { id: "shadowhawk", name: "Shadow Hawk SHD-2H", ton: 55, cls: "medium", cost: 4200000, weapons: ["ac5", "lrm5", "srm2", "mlaser"], armor: 464, eraMin: 0, tech: "IS", fac: ["steiner", "davion", "kurita", "marik", "taurian"], desc: "An old reliable generalist, present on every front of every war." },
    { id: "wolverine", name: "Wolverine WVR-6R", ton: 55, cls: "medium", cost: 4600000, weapons: ["ac5", "srm6", "mlaser"], armor: 480, eraMin: 0, tech: "IS", fac: ["kurita", "davion", "steiner", "pirate"], desc: "A fierce medium raider that punches far above its weight." },
    { id: "griffin", name: "Griffin GRF-1N", ton: 55, cls: "medium", cost: 4700000, weapons: ["ppc", "lrm10"], armor: 496, eraMin: 0, tech: "IS", fac: ["steiner", "kurita", "liao", "davion"], desc: "A fire-support skirmisher; the PPC is its calling card." },
    { id: "phoenixhawk", name: "Phoenix Hawk PXH-1", ton: 45, cls: "medium", cost: 4000000, weapons: ["mlaser", "mlaser", "mlaser", "mlaser", "mg", "mg"], armor: 416, eraMin: 0, tech: "IS", fac: ["marik", "steiner", "davion", "pirate"], desc: "A graceful jumper whose lasers rain death from the sky." },
    { id: "vindicator", name: "Vindicator VND-1R", ton: 45, cls: "medium", cost: 3800000, weapons: ["ppc", "lrm5", "mlaser"], armor: 448, eraMin: 0, tech: "IS", fac: ["liao", "marik"], desc: "The Capellan workhorse: a PPC, a missile rack, and stubborn pride." },
    { id: "trebuchet", name: "Trebuchet TBT-5N", ton: 50, cls: "medium", cost: 3800000, weapons: ["lrm15", "lrm15", "mlaser", "mlaser"], armor: 352, eraMin: 0, tech: "IS", fac: ["marik", "steiner", "davion"], desc: "A missile boat that can gut a lance from the treeline." },
    { id: "crab", name: "Crab CRB-27", ton: 50, cls: "medium", cost: 5800000, weapons: ["llaser", "llaser", "mlaser", "mlaser"], armor: 512, eraMin: 0, tech: "IS", fac: ["comstar", "marik"], desc: "A rare Star League survivor. Legend says it never overheats." },
    { id: "bushwacker", name: "Bushwacker BSW-X1", ton: 55, cls: "medium", cost: 5200000, weapons: ["uac5", "lrm10", "erml", "erml"], armor: 512, eraMin: 1, tech: "IS", fac: ["davion", "steiner", "marik"], desc: "An ugly, angular FedCom machine that refuses to die." },
    { id: "stormcrow", name: "Stormcrow (Clan)", ton: 55, cls: "medium", cost: 9800000, weapons: ["c-erml", "c-erml", "c-erml", "c-lrm20", "c-srm6"], armor: 528, eraMin: 1, tech: "Clan", fac: ["wolf", "ghost-bear", "nova-cat"], desc: "A Clan medium omnimech that outguns many Inner Sphere heavies." },
    { id: "marauder", name: "Marauder MAD-3R", ton: 75, cls: "heavy", cost: 6800000, weapons: ["ppc", "ppc", "ac5", "mlaser", "mlaser"], armor: 520, eraMin: 0, tech: "IS", fac: ["davion", "marik", "kurita", "pirate"], desc: "The classic walking gun turret. Ninety years of loyal service." },
    { id: "warhammer", name: "Warhammer WHM-6R", ton: 70, cls: "heavy", cost: 6400000, weapons: ["ppc", "ppc", "srm6", "mlaser", "mlaser", "mlaser", "mlaser"], armor: 480, eraMin: 0, tech: "IS", fac: ["steiner", "kurita", "marik", "pirate"], desc: "Twin shoulder PPCs and enough heat sinks to almost cope." },
    { id: "archer", name: "Archer ARC-2R", ton: 70, cls: "heavy", cost: 6200000, weapons: ["lrm20", "lrm20", "mlaser", "mlaser", "slaser", "slaser"], armor: 432, eraMin: 0, tech: "IS", fac: ["steiner", "kurita", "liao", "davion"], desc: "The definitive missile boat of the Succession Wars." },
    { id: "rifleman", name: "Rifleman RFL-3N", ton: 60, cls: "heavy", cost: 5000000, weapons: ["ac5", "ac5", "llaser", "llaser", "mlaser"], armor: 352, eraMin: 0, tech: "IS", fac: ["davion", "steiner", "liao"], desc: "An anti-air platform with thin armor. Keep it in the rear." },
    { id: "thunderbolt", name: "Thunderbolt TDR-5S", ton: 65, cls: "heavy", cost: 5800000, weapons: ["lrm15", "llaser", "mlaser", "mlaser", "srm2", "mg"], armor: 512, eraMin: 0, tech: "IS", fac: ["steiner", "kurita", "davion", "marik"], desc: "A walking arsenal that can handle any engagement envelope." },
    { id: "grasshopper", name: "Grasshopper GHR-5H", ton: 70, cls: "heavy", cost: 6200000, weapons: ["ppc", "mlaser", "mlaser", "mlaser", "mlaser", "mlaser"], armor: 544, eraMin: 0, tech: "IS", fac: ["kurita", "liao", "marik"], desc: "A jumping heavy with a laser battery and real armor." },
    { id: "catapult", name: "Catapult CPLT-C1", ton: 65, cls: "heavy", cost: 5800000, weapons: ["lrm15", "lrm15", "mlaser", "mlaser"], armor: 416, eraMin: 0, tech: "IS", fac: ["liao", "marik", "davion", "pirate"], desc: "Boxy launchers on a jump-capable frame. Rain from above." },
    { id: "orion", name: "Orion ON1-K", ton: 75, cls: "heavy", cost: 6600000, weapons: ["ac10", "lrm15", "srm4", "mlaser"], armor: 576, eraMin: 0, tech: "IS", fac: ["marik", "kurita", "pirate"], desc: "The assault mech's trusted older brother. Always moving forward." },
    { id: "crusader", name: "Crusader CRD-3R", ton: 65, cls: "heavy", cost: 5600000, weapons: ["lrm15", "lrm15", "srm4", "srm4", "mlaser", "mlaser", "mg", "mg"], armor: 400, eraMin: 0, tech: "IS", fac: ["steiner", "kurita", "marik"], desc: "A missile-heavy trooper with ammo bombs strapped to its hips." },
    { id: "dragon", name: "Dragon DRG-1N", ton: 60, cls: "heavy", cost: 5200000, weapons: ["ac5", "lrm10", "mlaser"], armor: 480, eraMin: 0, tech: "IS", fac: ["kurita"], desc: "The Combine's symbol of the samurai spirit, waddling into battle." },
    { id: "blackknight", name: "Black Knight BL-6-KNT", ton: 75, cls: "heavy", cost: 7200000, weapons: ["ppc", "ppc", "llaser", "mlaser", "mlaser", "slaser", "slaser"], armor: 560, eraMin: 0, tech: "IS", fac: ["davion", "steiner", "comstar"], desc: "A noble's machine of lasers and energy — and a big cockpit hatch." },
    { id: "jagermech", name: "JagerMech JM6-S", ton: 65, cls: "heavy", cost: 5400000, weapons: ["ac5", "ac5", "ac2", "ac2", "mlaser"], armor: 320, eraMin: 0, tech: "IS", fac: ["steiner", "davion", "liao"], desc: "A walking anti-air battery that crumples if anything looks at it." },
    { id: "madog", name: "Mad Dog (Clan)", ton: 60, cls: "heavy", cost: 10600000, weapons: ["c-lrm20", "c-lrm20", "c-erml", "c-erml"], armor: 448, eraMin: 1, tech: "Clan", fac: ["ghost-bear", "nova-cat", "wolf"], desc: "Clan Ghost Bear's fire-support omnimech, heavy on missiles." },
    { id: "summoner", name: "Summoner (Clan)", ton: 70, cls: "heavy", cost: 12400000, weapons: ["c-erppc", "c-erml", "c-erml", "c-srm6", "c-ubac20"], armor: 480, eraMin: 1, tech: "Clan", fac: ["jade-falcon", "wolf", "smoke-jaguar"], desc: "A jumping Clan heavy that carries an oversized punch." },
    { id: "timberwolf", name: "Timber Wolf (Clan)", ton: 75, cls: "heavy", cost: 14200000, weapons: ["c-erll", "c-erppc", "c-lrm20", "c-srm6", "c-erml", "c-erml"], armor: 560, eraMin: 1, tech: "Clan", fac: ["wolf", "jade-falcon", "nova-cat", "diamond-shark", "smoke-jaguar"], desc: "The Mad Cat. The most feared war machine of the Clan Invasion." },
    { id: "atlas", name: "Atlas AS7-D", ton: 100, cls: "assault", cost: 9800000, weapons: ["ac20", "lrm20", "srm6", "llaser", "mlaser", "mlaser"], armor: 608, eraMin: 0, tech: "IS", fac: ["steiner", "davion", "kurita"], desc: "The skull-faced king of the battlefield. Enough said." },
    { id: "awesome", name: "Awesome AWS-8Q", ton: 80, cls: "assault", cost: 8200000, weapons: ["ppc", "ppc", "ppc", "slaser", "slaser"], armor: 608, eraMin: 0, tech: "IS", fac: ["marik", "steiner", "kurita"], desc: "Three PPCs and a coolant system that begs for mercy." },
    { id: "battlemaster", name: "BattleMaster BLR-1G", ton: 85, cls: "assault", cost: 8900000, weapons: ["ppc", "srm6", "mlaser", "mlaser", "mlaser", "mlaser", "mg"], armor: 560, eraMin: 0, tech: "IS", fac: ["steiner", "davion", "marik"], desc: "The command mech of the Succession Wars. Leads from the front." },
    { id: "stalker", name: "Stalker STK-3F", ton: 85, cls: "assault", cost: 8400000, weapons: ["lrm20", "lrm20", "srm6", "srm6", "llaser", "llaser", "mlaser", "mlaser"], armor: 528, eraMin: 0, tech: "IS", fac: ["liao", "kurita", "marik", "comstar"], desc: "A blocky missile-and-laser fortress that never stops shooting." },
    { id: "zeus", name: "Zeus ZEU-6S", ton: 80, cls: "assault", cost: 8000000, weapons: ["ppc", "lrm15", "ac5", "mlaser"], armor: 512, eraMin: 0, tech: "IS", fac: ["steiner", "davion"], desc: "A Lyran aristocrat's assault mech — long-range and stately." },
    { id: "victor", name: "Victor VTR-9B", ton: 80, cls: "assault", cost: 7800000, weapons: ["ac20", "srm4", "mlaser", "mlaser"], armor: 464, eraMin: 0, tech: "IS", fac: ["davion", "steiner", "marik"], desc: "A jumping assault brawler with a jawbreaker of an autocannon." },
    { id: "highlander", name: "Highlander HGN-733", ton: 90, cls: "assault", cost: 9400000, weapons: ["gauss", "lrm20", "srm6", "llaser", "mlaser"], armor: 640, eraMin: 1, tech: "IS", fac: ["steiner", "davion", "comstar"], desc: "The Steiner Highlander: a Legend Killer that falls from heaven." },
    { id: "kingcrab", name: "King Crab KGC-0000", ton: 100, cls: "assault", cost: 11200000, weapons: ["ac20", "ac20", "llaser", "mlaser", "mlaser"], armor: 640, eraMin: 0, tech: "IS", fac: ["comstar", "marik", "pirate"], desc: "Rare Star League treasure. Twin shoulder AC/20s end arguments." },
    { id: "banshee", name: "Banshee BNC-3E", ton: 95, cls: "assault", cost: 8800000, weapons: ["ppc", "ac5", "mlaser"], armor: 512, eraMin: 0, tech: "IS", fac: ["steiner", "liao", "marik"], desc: "A failed assassin turned reluctant — but brutal — brawler." },
    { id: "direwolf", name: "Dire Wolf (Clan)", ton: 100, cls: "assault", cost: 26000000, weapons: ["c-ubac20", "c-ubac20", "c-erll", "c-erll", "c-lrm20", "c-srm6"], armor: 608, eraMin: 1, tech: "Clan", fac: ["wolf", "ghost-bear", "nova-cat", "diamond-shark", "smoke-jaguar", "jade-falcon"], desc: "The Daishi. A rolling fortress that eats assault lances for lunch." },
    { id: "executioner", name: "Executioner (Clan)", ton: 95, cls: "assault", cost: 21000000, weapons: ["c-ubac20", "c-erppc", "c-lrm15", "c-srm6", "c-erml"], armor: 560, eraMin: 1, tech: "Clan", fac: ["ghost-bear", "jade-falcon", "nova-cat"], desc: "A 95-ton monster that can somehow still jump across a battlefield." },
    { id: "warhawk", name: "Warhawk (Clan)", ton: 85, cls: "assault", cost: 18000000, weapons: ["c-erppc", "c-erppc", "c-erppc", "c-erppc", "c-erml"], armor: 480, eraMin: 1, tech: "Clan", fac: ["smoke-jaguar", "wolf", "diamond-shark"], desc: "The Masakari. Four Clan ER PPCs: a flashbulb of annihilation." }
  ];
  const MECH_MAP = Object.fromEntries(MECHS.map((m) => [m.id, m]));

  const MISSION_TYPES = [
    { id: "raid", name: "Raid", desc: "Strike a facility, wreck what matters, and get out before reinforcements arrive.", obj: "Destroy your target, then withdraw in good order.", diff: 0.95, payMult: 1.05, salvageMult: 1.15, repMin: 0, favor: ["kurita", "liao", "pirate", "marik", "smoke-jaguar"] },
    { id: "recon", name: "Recon", desc: "Probe enemy positions and bring back the intel. Speed over glory.", obj: "Complete the sweep with minimal losses.", diff: 0.8, payMult: 0.9, salvageMult: 0.7, repMin: 0, favor: ["davion", "steiner", "wolf", "nova-cat"] },
    { id: "defense", name: "Base Defense", desc: "Hold the line while the garrison evacuates. They will come in waves.", obj: "Survive until the defenders are away.", diff: 1.2, payMult: 1.2, salvageMult: 1.0, repMin: 1, favor: ["steiner", "davion", "taurian", "canopus", "ghost-bear"] },
    { id: "assassination", name: "Assassination", desc: "A high-value target must die. Everything else is negotiable.", obj: "Kill the target commander.", diff: 1.25, payMult: 1.4, salvageMult: 1.1, repMin: 3, favor: ["liao", "kurita", "wob", "comstar", "smoke-jaguar"] },
    { id: "capture", name: "Capture / Escort", desc: "Guard a VIP, a prototype, or a defector from one place to another.", obj: "Deliver your charge intact.", diff: 1.05, payMult: 1.1, salvageMult: 0.9, repMin: 1, favor: ["davion", "steiner", "canopus", "diamond-shark"] },
    { id: "garrison", name: "Garrison", desc: "Occupied duty: hold ground, show the flag, discourage trouble.", obj: "Hold position until relieved.", diff: 0.85, payMult: 1.0, salvageMult: 0.85, repMin: 0, favor: ["marik", "liao", "taurian", "jade-falcon"] },
    { id: "objraid", name: "Objective Raid", desc: "A surgical strike on a specific installation: factory, depot, or lab.", obj: "Destroy the primary objective.", diff: 1.15, payMult: 1.25, salvageMult: 1.3, repMin: 4, favor: ["kurita", "liao", "wolf", "pirate"] },
    { id: "clantrial", name: "Clan Trial", desc: "Face a Clan warrior in a formal Trial of Possession. Honor rules apply.", obj: "Win the Trial, take the spoils.", diff: 1.3, payMult: 1.5, salvageMult: 1.6, repMin: 6, favor: ["jade-falcon", "wolf", "ghost-bear", "nova-cat", "smoke-jaguar", "diamond-shark"], clanOnly: true }
  ];

  const PERSON_FIRST = ["Ana", "Bekka", "Caleb", "Dana", "Elias", "Fen", "Greta", "Harlan", "Ines", "Juno", "Kade", "Lena", "Miko", "Nadia", "Oren", "Petra", "Quinn", "Rhea", "Satoshi", "Talia", "Ursa", "Vance", "Wren", "Xander", "Yara", "Zane", "Abel", "Briar", "Ciro", "Delia", "Erika", "Farid", "Gus", "Hiro", "Iva", "Jett", "Keiko", "Ludo", "Marit", "Nils", "Oda", "Paz", "Rook", "Sigrid", "Tomas", "Ulric", "Vega", "Willa", "Yuki", "Aiko", "Bea", "Claude", "Dasha", "Emil", "Faust", "Gina", "Hugo", "Irina", "Jae", "Kurtz"];
  const PERSON_LAST = ["Abernathy", "Blackwood", "Castro", "DeVries", "Echevarria", "Falk", "Grayson", "Harrow", "Ishida", "Janssen", "Kessler", "Lindqvist", "Moreau", "Nakamura", "Okafor", "Pavlov", "Quispe", "Reyes", "Sokolov", "Tanaka", "Ueda", "Vasquez", "Wolfe", "Yamada", "Zetterberg", "Al-Hassan", "Bianchi", "Costas", "Drummond", "Eliasson", "Ferreira", "Garcia", "Holt", "Ivankov", "Jovanovic", "Kowalski", "Larsen", "Mercer", "Novak", "Ortega", "Petrov", "Quintero", "Rahman", "Sato", "Thorn", "Ulfsson", "Volkov", "Whitfield", "Zhou", "Marchetti", "Dubois", "Kaur", "Lindgren", "Mbeki", "Osei"];
  const CALLSIGNS = ["Viper", "Mongoose", "Grendel", "Widow", "Rook", "Hammer", "Sable", "Gryphon", "Talon", "Basilisk", "Manticore", "Coyote", "Raven", "Vulture", "Jackal", "Osprey", "Wolverine", "Banshee", "Chimera", "Dragonfly", "Echo", "Firebrand", "Ghost", "Havoc", "Ironhide", "Jinx", "Kestrel", "Longshot", "Mamba", "Nightjar", "Onslaught", "Pyre", "Quickdraw", "Razor", "Sidhe", "Talisman", "Umbra", "Valkyrie", "Whiplash", "Xiphos", "Yojimbo", "Zephyr", "Bloodhound", "Cinder", "Dagger", "Falconer", "Gatling", "Hardcase", "Ironside", "Kraken", "Lynx", "Minotaur", "Nighthawk", "Ogre", "Powderkeg", "Quicksilver", "Reaper", "Steeltoe", "Twinblade", "Vandal"];
  const QUIRKS = ["keeps a pet rock named after a dead DropShip captain", "humms the same Lyran folk tune during every pre-flight check", "refuses to pilot any 'mech painted anything but olive drab", "collects salvage plating and haggles for it like a merchant prince", "talks to the 'mech and swears it answers back", "sleeps in the cockpit during transit, every single time", "has never lost a game of solitaire in the mess hall", "names every autocannon after an ex-spouse", "eats nothing but protein bars and black coffee on deployment", "has a standing bet with the techs about armor penetration angles", "claims to have once seen Kerensky's ghost", "counts every shell casing after a battle, by hand", "writes poetry about jump-ship Lagrange points", "keeps a diary of every 'mech they have ever faced", "insists on polishing the canopy glass before every sortie", "thinks neurohelmets give people 'bad vibes' and wears a lucky bandana instead"];
  const CAREERS = ["former House regular", "arena fighter", "academy washout", "family scion", "periphery militia veteran", "ComStar adept", "ex-pirate", "solaris gladiator", "border-world rancher", "corporate security chief", "freebirth laborer", "military historian", "salvage crew boss", "HPG station brat", "navy castoff", "dueling instructor", "lostech prospector", "military police officer", "drop-port tug jockey", "holovid stunt pilot"];
  const HOME_WORLDS = ["Tamarind", "Donegal", "New Avalon", "Luthien", "Sian", "Atreus", "Terra", "Tukayyid", "Solaris VII", "Hesperus II", "Outreach", "Canopus IV", "Taurus", "Huntress", "Strana Mechty", "Skye", "Katherine", "Alarion", "Twycross", "Wotan", "Icar", "Nox", "Glengarry", "Sudeten", "Lone Star", "Helm", "New Dallas", "Coventry", "Tharkad", "Robinson", "Port Moseby", "Herotitus", "Hachiman", "Benjamin", "Dieron", "Kentares", "Marduk", "Galedon", "Pesht", "Wolcott", "Gan Singh", "Menke", "St. Ives", "Victoria", "Ares", "Tikonov", "Capella", "Sarna", "Andurien", "Oriente", "Stewart", "Gibson", "Procyon", "Keid", "Zion", "Eden", "Circe", "Dagda", "Barcelona", "New Oslo", "Tamaron", "York"];

  const BUILDS = ["whipcord-lean", "broad-shouldered", "stocky", "rangy", "wiry", "powerfully built", "slender", "heavy-set", "sinewy", "compact"];
  const HAIR = ["short-cropped", "long", "shaved", "buzz-cut", "braided", "salt-and-pepper", "graying", "tied back", "wild", "close-cropped", "pony-tailed"];
  const FEATURES = ["a scarred left cheek", "tattooed forearms", "a prominent jaw", "steel-grey eyes", "a crooked nose", "faint burn scarring along one arm", "a weathered face", "sharp, watchful eyes", "a lopsided grin", "a faint limp", "goggles pushed up on the brow", "a patch over one eye"];
  const MOTIVATIONS = [
    "fleeing a blood debt owed to a pirate cartel",
    "buying their way out of an inherited house debt",
    "treating the regiment as the only family left after the war",
    "chasing a missing sibling across the Inner Sphere",
    "owing nothing to anyone and meaning to keep it that way",
    "wanting a stake big enough to buy a world of their own",
    "running from a court-martial that never stuck",
    "fighting because the pay is better than the mines",
    "hunting the mercenary who sold out their old unit",
    "dreaming of piloting an assault 'mech before the body gives out",
    "quietly saving for a medical debt back home",
    "enjoying the work, and saying so loudly",
    "having been conscripted into mercenary life and never leaving",
    "writing a book about the Succession Wars, one contract at a time",
    "owing a life-debt to the commander who pulled them from a burning cockpit"
  ];

  const FIRST = PERSON_FIRST, LAST = PERSON_LAST;

  window.BTD = {
    LOCS, ERAS, FACTIONS, WEAPONS, WMAP, MECHS, MECH_MAP, MISSION_TYPES,
    CALLSIGNS, QUIRKS, CAREERS, HOME_WORLDS, FIRST, LAST,
    BUILDS, HAIR, FEATURES, MOTIVATIONS,
    pick, pickN
  };
})();
