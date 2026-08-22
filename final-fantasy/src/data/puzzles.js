// Puzzle data (Task #55) — switches/pressure plates that open door tiles
// once enough presses are made. Door tiles are drawn with a non-solid char
// (e.g. 'D'); the PuzzleSystem blocks them until solved.

export const PUZZLES = [
  {
    id: "cave_lower_gate",
    mapId: "caves_of_cornelia_b2",
    flag: "puzzle_cave_lower_solved",
    switches: [{ id: "plate_a", x: 11, y: 1 }],
    doors: [{ id: "gate", x: 2, y: 1 }],
    required: 1,
  },
];
