# Connect 4 — Feature Reference

A system-level reference of Connect 4's features (no content specifics). Useful as a checklist for designing abstract alignment games with vertical gravity and perfect information.

## Board & Gravity
- Vertical 7×6 grid (columns × rows) standing frame
- Discs drop into a chosen column and settle in the lowest empty cell
- A full column cannot receive more discs

## Turn Structure
- Two players alternate placing one disc per turn
- The only choice is which open column to drop into
- No movement, removal, or re-placement after a drop

## Win Condition
- First player to align 4 discs in a row (horizontal, vertical, or diagonal) wins
- Board completely filled with no alignment is a draw

## Perfect-Information Strategy
- Zero randomness, no hidden information, zero-sum
- Threat creation: two simultaneous winning lines force an unresolvable response
- Forcing moves and zugzwang pressure
- Center-column control as the key opening advantage

## Theory & Variants
- Game is solved: first player can force a win with optimal play
- Variants alter grid size or required alignment length
- Handicap options (extra moves for the weaker player) balance skill gaps
