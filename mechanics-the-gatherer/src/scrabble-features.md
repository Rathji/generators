# Scrabble — Feature Reference

A system-level reference of Scrabble's features (no content specifics). Useful as a checklist for designing word games with tile placement and letter scoring.

## Word Placement Core
- Players form words on a shared 15x15 letter grid
- Words must connect to existing letters (crosswords style)
- Every played word must be valid per the word list

## Letter Tile Economy
- Letters are drawn from a shared bag with set distributions
- Each letter has a frequency and a point value
- Rack management (7 tiles) drives what you can play

## Premium Squares
- The board has bonus squares (double/triple letter and word)
- Premium placement multiplies scores dramatically
- Controlling premium squares is a spatial goal

## Rack & Bag Management
- Exchanging tiles costs a turn
- High-value letters (Q, Z, X, J) are rare and risky to hold
- Drawing luck is mitigated by rack planning

## Turn Structure & Scoring
- Play a word, score it, draw to refill the rack
- The game ends when the bag empties and racks are played out
- Highest total score wins

## Player Interaction
- Words build on each other — open letters invite plays
- Blocking premium squares and tight spaces is tactical
- Scales 2–4 players (2 is standard); high skill ceiling
