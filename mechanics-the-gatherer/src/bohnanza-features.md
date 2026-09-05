# Bohnanza — Feature Reference

A system-level reference of Bohnanza's features (no content specifics). Useful as a checklist for designing trading games with hand-order constraints.

## Hand-Order Constraint Core
- Cards (beans) must be played in the order they're drawn
- You may never rearrange your hand — the order is sacred
- This forces constant trading to dump unwanted beans

## Bean Field Management
- Each player has a small number of bean fields
- Fields can hold one bean type; planting a different type closes one
- Closing a field scores based on the number of beans (set collection)

## Trading & Negotiation
- Trading happens between turns — the core social mechanic
- You must trade away beans you don't want to plant
- Deals are binding; negotiation drives everything

## Deck & Draw Economy
- Cards are drawn in fixed order; the deck is shared
- Flipped cards offer public information for trades
- Declining a flip forces a draw from the face-down deck

## Bean Type Asymmetry
- Different beans have different scoring thresholds and counts
- Rare beans are valuable but hard to collect
- Bean variety defines the trading market

## Endgame & Player Scaling
- The deck ends the game; most coins from fields wins
- Scales 3–7 players; scales smoothly by card distribution
- Fast, social, negotiation-heavy play
