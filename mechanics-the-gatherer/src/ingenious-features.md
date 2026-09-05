# Ingenious — Feature Reference

A system-level reference of Ingenious's features (no content specifics). Useful as a checklist for designing abstract tile-placement games with multi-color scoring.

## Tile Placement Core
- Players place hexagonal tiles with two colored symbols each
- Tiles must fit the shared board adjacency rules
- Placement scores all symbols of a matching color in line

## Multi-Color Scoring
- Each of the six colors scores independently
- A player's score is their weakest color (bottleneck rule)
- Balanced placement beats single-color dominance

## Symbol Lines
- Matching symbols in connected lines score per tile
- Lines of 3+ symbols escalate point values
- Blocking opponent lines is as important as building your own

## Hand Management
- Players draw a hand of tiles from a shared bag
- Tile draw luck requires flexible placement
- Choice of which tile to play and where is the puzzle

## Interaction & Blocking
- The board is shared; tiles border everyone
- Filling spaces denies opponents their preferred placements
- Zero randomness beyond the draw

## Endgame
- The game ends when no player can place
- Highest minimum-color score wins
- Scales 1–4 players; solo mode exists
