# Codenames — Feature Reference

A system-level reference of Codenames' features (no content specifics). Useful as a checklist for designing word-association games with hidden team identities.

## Team vs. Team Word Grid
- Players split into two teams with one clue-giver each
- A shared word grid (e.g. 25 words) is the entire playing field
- Each word secretly belongs to a team, a neutral, or the assassin

## One-Word Clues
- Clue-givers give a single word plus a number
- The number tells their team how many words the clue covers
- The team guesses words they believe are linked to the clue

## Information Asymmetry
- Clue-givers see the full secret color map; guessers don't
- Clue-givers may not speak beyond the one word + number
- Guessing wrong colors (opponent/neutral/assassin) has escalating costs

## Associative Reasoning
- The skill is choosing clues that link multiple target words
- Clues must avoid words that would steer the team to the assassin
- Opponents' clues are public and readable for information leaks

## Win & Loss Conditions
- A team wins by revealing all of its own words first
- Hitting the assassin word loses instantly
- Neutral words end the turn; opponent words hand a free turn

## Turn Structure & Player Scaling
- Alternating clue-giver turns; any number of guesses per turn
- Scales 2–8+ players via team sizes and multiple roles
- Very fast setup, replayable via word-card shuffle
