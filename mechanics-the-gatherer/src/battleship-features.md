# Battleship — Feature Reference

A system-level reference of Battleship's features (no content specifics). Useful as a checklist for designing hidden-placement grid-attack games with asymmetric information.

## Fleet Placement
- Each player secretly places a fleet of ships on their own grid
- Ships occupy contiguous cells in straight lines (varied lengths)
- Placement restrictions (e.g. no adjacency or grid-edge rules per variant)

## Targeting & Resolution
- Players alternate calling a grid coordinate on the opponent's board
- Response is binary: hit (a ship cell) or miss (empty water)
- No information beyond hit/miss is revealed to the attacker

## Sinking & Fleet Destruction
- A ship is sunk once every cell it occupies has been hit
- Sunk ships are announced, revealing their location and size
- Win condition: first player to sink the entire opposing fleet

## Hidden Information & Deduction
- Opponent's fleet is invisible; position must be inferred
- Hit patterns, spacing, and sunk-ship reveals feed deduction
- Purely adversarial choice — no dice, no hidden randomness

## Tracking Systems
- Two grids per player: own fleet (with hits marked) and a shots-fired grid
- Double-grid bookkeeping is the core record-keeping mechanic
- Variants: salvo (multiple shots per turn), different fleets, larger grids

## Player Interaction
- Strictly sequential, zero-sum, perfect-information-free duel
- Player count is fixed at two; variants add team play
