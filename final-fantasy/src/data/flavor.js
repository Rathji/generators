// Flavor text data (Task #60) — a library of non-essential ambient NPC
// dialogue for lore. Strings are plain text; entries may also carry a
// speaker and an id for "no repeats" tracking.

export const FLAVOR_TEXTS = {
  town: [
    { id: "town1", text: "The king keeps the castle doors barred since the crystal dimmed." },
    { id: "town2", text: "Have you seen the cave to the west? They say it moans at night." },
    { id: "town3", text: "The blacksmith's forge is the warmest place in Cornelia." },
    { id: "town4", text: "My grandfather spoke of the four crystals as if they were gods." },
    { id: "town5", text: "Rumor says the garrison was overrun a week ago. No one believes it." },
  ],
  inn: [
    { id: "inn1", text: "The beds upstairs are feather-soft. Worth every coin." },
    { id: "inn2", text: "Keep your coin purse close — not every traveler is honest." },
    { id: "inn3", text: "The innkeeper's stew has kept me alive through three winters." },
  ],
  cave: [
    { id: "cave1", text: "The dripping water sounds like footsteps behind you..." },
    { id: "cave2", text: "A faded torch mark points deeper into the dark." },
    { id: "cave3", text: "Something glitters in the rubble over there." },
  ],
  castle: [
    { id: "castle1", text: "The knights train at dawn. Their shields shine like the sea." },
    { id: "castle2", text: "The throne hall ceiling is painted with the four crystals." },
  ],
  forest: [
    { id: "forest1", text: "The trees here grow in rings around old stone circles." },
    { id: "forest2", text: "Birdsong echoes oddly between the hills. You feel watched." },
  ],
  marsh: [
    { id: "marsh1", text: "The water is dark and still, like a held breath." },
    { id: "marsh2", text: "Something large moved beneath the reeds a moment ago." },
    { id: "marsh3", text: "A frayed rope marks a path the drowned used to take." },
  ],
  sea: [
    { id: "sea1", text: "The gulls circle the Dawnbreaker, hungry for scraps." },
    { id: "sea2", text: "A sailor hums an old chantey about the Sea Shrine." },
  ],
  rumor: [
    { id: "rumor1", text: "They say Garland stole the Wind Crystal from the shrine." },
    { id: "rumor2", text: "An old witch in the mountains can restore shattered crystals." },
    { id: "rumor3", text: "The ship to the north only sails when the sea is calm." },
  ],
  weather: [
    { id: "weather1", text: "A storm is brewing beyond the mountains." },
    { id: "weather2", text: "The air is thick today. The crystals' light feels weaker." },
  ],
};
