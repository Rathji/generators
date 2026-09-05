# Deluxe Poker Rummy Game — Feature Reference

A system-level reference of a deluxe poker/rummy card-game box (no content specifics). Useful as a checklist for designing multi-variant card games bundled around poker and rummy families.

## Multi-Variant Box
- One product bundling several card games (poker variants + rummy variants)
- Shared component set: deck(s) of cards, scoring chips, rules for each variant
- Rulebook organization: common conventions first, per-game deltas after

## Card Deck Core
- Standard 52-card deck (sometimes double deck or with jokers)
- Card ranks and suits as the base state
- Shuffling, dealing, and discard mechanics shared across variants

## Poker Hand Rankings
- Hand hierarchy: straight flush, four of a kind, full house, flush, straight, three of a kind, two pair, one pair, high card
- Hand evaluation is the shared scoring backbone
- Variants layer betting, drawing, or shared cards onto the same ranking

## Rummy Melding
- Melds of sets (same rank) and runs (sequential ranks, same suit)
- Drawing and discarding to build melds
- Scoring by deadwood or meld value; going out triggers settlement

## Chips & Betting Core
- Chip-based scoring or wagering
- Buy-in, pot, and payout flows
- Chip denominations support both poker betting and rummy point scoring

## Variant Separation
- Rules that differ per game (blind vs. open hands, draw piles, wild cards)
- Difficulty/progression options for mixed-skill groups
