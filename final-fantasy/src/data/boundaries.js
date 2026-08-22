// Task #121: Boundary Collision Mapping — invisible-wall rectangles per map
// that prevent the party from leaving the playable area even where the tile
// grid is technically walkable (e.g. the far edge of the overworld sea).

export const BOUNDARIES = {
  overworld: [
    {
      id: "ow_north_mountain_wall",
      x0: 24,
      y0: 1,
      x1: 26,
      y1: 9,
      label: "The far mountain wall rises impassably.",
    },
    {
      id: "ow_glacier_east_void",
      x0: 26,
      y0: 10,
      x1: 26,
      y1: 13,
      label: "Beyond the frozen isle lies open sea.",
    },
  ],
};
