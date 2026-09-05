# Photosynthesis — Feature Reference

A system-level reference of Photosynthesis' features (no content specifics). Useful as a checklist for designing grid-area games with sunlight rotation and growth.

## Sun Rotation Core
- The sun token orbits the board, rotating each turn
- Trees capture light from the direction the sun faces
- Sunlight direction changes which cells are in shadow

## Shadow & Light Capture
- Taller trees cast shadows that block light for smaller trees
- Trees only collect light when the sun is on their open side
- Board positioning is a race for light exposure

## Growth & Tree Lifecycle
- Trees grow through stages (seed → small → medium → large)
- Seeds are planted, mature, and can be harvested for points
- Harvesting a tree gives a new seed — a cycle of renewal
- Energy (light points) is both the currency and the score

## Hex Grid & Area Control
- The forest is a hex board; cells are claimed by owning a tree there
- Trees at the board edge block or feed each other based on position
- The center cells are most contested for light value

## Asymmetric Timing
- Each player acts in turn order which rotates with the sun
- The sun's position determines whose trees are in sunlight
- Strategic waiting: planting early vs. harvesting at the right moment

## Win Condition
- Score comes from harvesting mature trees and completing growth cycles
- Efficient light use across the session determines the winner
- Zero randomness: pure spatial optimization and timing
