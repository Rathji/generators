// Task #104: the ending sequence data — the closing scenes shown once the
// light is restored (story_crystals_restored), and the rolling credits that
// follow. The final scene sets `ending_seen` so the ending only ever plays
// once per save.

export const ENDING_SCENES = [
  {
    speaker: "Narrator",
    text: "The darkness is no more. The four crystals blaze as one, and light floods the world anew.",
  },
  {
    speaker: "King Cornelia",
    text: "Warriors of Light... the age of chaos has ended. History will sing of what you did this day.",
  },
  {
    speaker: "Princess Sarah",
    text: "Garland, Chaos, the doom of the world... all swept away. Thank you — thank you with all my heart.",
  },
  {
    speaker: "Narrator",
    text: "The land remembers its own: the fields of Cornelia green again, the marsh quiet, the forges warm, the winds free.",
  },
  {
    speaker: "King Cornelia",
    text: "Wherever your road leads, our gates stand open to you. This kingdom is yours, now and always.",
  },
  {
    speaker: "Narrator",
    text: "And so the Warriors of Light crossed the crystal bridge into the fading sun — their tale told, their legend born.",
  },
  {
    speaker: "Narrator",
    text: "The End — the light endures.",
    flag: "ending_seen",
  },
];

export const CREDITS = [
  "FINAL FANTASY",
  "— A Tribute —",
  "",
  "The Warriors of Light",
  "",
  "The Fire Crystal blazes in the ruined altar.",
  "The Water Crystal sings through the murk.",
  "The Earth Crystal rumbles awake in the forges.",
  "The Wind Crystal howls free of the altar.",
  "",
  "Chaos is fallen. The age of darkness is over.",
  "The world is whole, and the light endures.",
  "",
  "Thank you for playing.",
];
