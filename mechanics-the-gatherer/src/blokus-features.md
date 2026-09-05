# Blokus — Feature Reference

A system-level reference of Blokus's features (no content specifics). Useful as a checklist for designing abstract area-placement games.

## Piece Set
- Each player receives a full set of polyomino pieces (every shape from 1 to 5 squares)
- Fixed, identical inventory for all players
- All pieces are placed over the game (pure spatial play, no randomness)

## Placement Rules
- Grid board; first piece must cover a corner square
- New pieces must touch a corner of an existing same-color piece
- Pieces may NOT touch the edge of any same-color piece
- Corner-touch/edge-block creates both connection and denial mechanics

## Spatial Strategy
- Blocking: occupying space denies it to opponents
- Corner exploitation: using corner-touches to snake through gaps
- Piece conservation: managing large pieces vs. filling tight spaces

## Game End & Scoring
- Game ends when no player can place a piece
- Each unplaced square costs −1 point
- Fewest negative points wins (4-player free-for-all)

## Modes & Scaling
- 2–4 players; two-player variants use two colors each
- Deterministic, no dice, no hidden information — pure spatial deduction
