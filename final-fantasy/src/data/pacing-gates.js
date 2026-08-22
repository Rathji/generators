// Narrative pacing-gate data (Task #153) — "Wait" gates that bar the road
// to a major area until mid-game flags are checked. The gate sits on a
// passable tile; stepping on it before its flags are met yields a "Wait"
// message instead of the transition that tile would normally carry.

export const PACING_GATES = [
  {
    id: "chaos_shrine_seal",
    mapId: "overworld",
    x: 13,
    y: 2,
    require: { flags: ["crystal_fire", "crystal_water"] },
    deny:
      "The shrine's outer seal holds fast. Its keeper's voice whispers on the wind: \"Wait. Two crystals must burn before the way to Chaos opens.\"",
    unlockFlag: "pacing_chaos_shrine_open",
    name: "The Shrine's Seal",
  },
  {
    id: "eastern_peaks_seal",
    mapId: "overworld",
    x: 18,
    y: 2,
    require: { flags: ["crystal_water"] },
    deny:
      "The eastern peaks are wreathed in storm-cloud. Wait — the waters of the Marsh Guardian must be stilled before the airship may pass.",
    unlockFlag: "pacing_eastern_peaks_open",
    name: "The Storm Wreath",
  },
];
