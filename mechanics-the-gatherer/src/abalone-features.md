# Abalone — Feature Reference

A system-level reference of Abalone's features (no content specifics). Useful as a checklist for designing abstract strategy games built on line movement and pushing mechanics.

## Board & Components
- Hexagonal grid of 61 cells; regular hexagonal adjacency
- Two armies of 14 marbles each (black vs white)
- Marbles occupy single cells; adjacency defines lines

## Line Movement
- A move selects a line of 1–3 own marbles (straight or diagonal axis)
- The line slides along its own axis as a unit
- Lines move without leaving gaps in formation

## Sumito (Pushing)
- A moving line may push an adjacent opponent line
- Push only allowed when the moving line is strictly longer (3>2, 3>1, 2>1)
- Equal-length contact cannot be pushed and blocks the move
- Pushing displaces the opponent's line along the same axis

## Edge Ejection
- Marbles pushed off the board edge are removed permanently
- Ejection is the only way to reduce the opponent's army

## Win Condition
- First player to eject 6 opponent marbles wins

## Strategy & Depth
- Perfect information, no randomness, zero-sum
- Formation shape matters: compact clusters resist pushes; spread lines invite sumito
- Offense vs defense tradeoffs; mobility and tempo
- Rich tactical play from a small ruleset
