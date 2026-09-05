# Hey, That's My Fish! — Feature Reference

A system-level reference of Hey, That's My Fish!'s features (no content specifics). Useful as a checklist for designing abstract tile-removal games with penguin movement.

## Penguin Movement Core
- Players move penguins across a hex grid of ice floes
- Penguins slide in straight lines until blocked by a hole or edge
- The moving penguin collects the tile it leaves behind

## Tile Removal Economy
- Every move removes the vacated tile — the board shrinks
- Tiles hold fish values (1–3); collected fish are points
- The shrinking board constrains future movement

## Multiple Penguins
- Each player controls a team of penguins (e.g. 4)
- Penguins must be distributed across the map at start
- Splitting penguins trades coverage for mobility

## Blocking & Trapping
- Penguins can be trapped by holes and other penguins
- Trapping opponents' penguins cuts off their future fish
- Isolation is both a defense and an offense

## Movement Rules & Strategy
- Line-of-sight sliding rewards long open corridors
- First-mover chooses the best starting tiles
- Scales 2–4 players; quick abstract play

## Endgame
- The game ends when no penguin can move
- Most collected fish wins
- Zero randomness after setup — pure spatial planning
