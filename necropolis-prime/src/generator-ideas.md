# High-Complexity Perchance Generator Ideas

Twenty concepts that sit at the top end of what's buildable on Perchance. Each leans on multiple hard subsystems at once (real-time netcode, GPU rendering, procedural simulation, AI, large persistent state, etc.).

## Set A — Original Ten

1. **Deterministic-netcode RTS ("puppet armies")** — server-plugin reflector + lockstep tick simulation, client-side prediction, resync on join. Hard because: fixed-timestep determinism, command queues, lag compensation, 50 MiB durable match state.

2. **WebGPU position-based fluid / SPH sandbox** — particles in a compute shader, screen-space fluid rendering, mouse forces. Hard: WebGPU buffer ping-pong, GPU readback for verification, no simple fallback.

3. **Voxel world with chunk streaming + greedy meshing** — infinite terrain, occlusion culling, AO baked into vertex colors, persistence via kv-plugin. Hard: meshing cost, draw-call batching, edit reconciliation.

4. **Townscaper-style irregular-grid city builder with a full rules engine** — procedurally solved adjacency grammar, animated building assembly, undo/redo. Hard: constraint solving per cell, geometry generation, state serialization.

5. **Persistent MMO-lite overworld** — shared world state on the server, NPC economy, player presence, day/night tick, chat. Hard: authoritative sim + reconciliation + durability + reconnect.

6. **AI game-master sandbox (LLM-driven world)** — `generateText` narrates, parses structured world deltas, renders them as a live map/stat sheet. Hard: prefix-cache-friendly prompting, structured output parsing, state mutation from text.

7. **Full-feature rigid-body + fluid physics sandbox** — verlet/impulse solver, broadphase, constraints, joints. Hard: stability, tunneling, determinism, perf in a single JS thread.

8. **Procedural galaxy / civilization simulator** — seeded star systems, emergent faction/diplomacy AI over ticks, queryable lore export. Hard: simulation depth that stays interesting, perf over thousands of entities.

9. **Binary-tree + constraint city generator ("real roads")** — L-system road networks, block subdivision, zoning, traffic microsim. Hard: graph algorithms, tens of thousands of entities, LOD.

10. **Collaborative realtime pixel-art / shader playground** — server-plugin pub/sub, CRDT-ish conflict resolution, live cursors, undo history. Hard: concurrency, conflict merge, bandwidth throttling.

## Set B — Ten More

11. **Procedural creature evolution lab ("darwin world")** — genomes encode body morphology + neural net brains; physics-simulated creatures compete for food across generations, with a phylogeny viewer and mutation browser. Hard: genotype→phenotype assembly, soft-body/joint physics, evolutionary selection pressure, rendering hundreds of bodies.

12. **Chess/go engine + analysis board** — bitboard move generation, alpha-beta search with transposition tables, opening book, eval bar, PGN import/export, play vs. engine or another human over server-plugin. Hard: search correctness, perf budgets, UCI-ish plumbing, matchmaking.

13. **Raymarched/SDF shader studio** — WebGL fragment-shader raymarcher with a node-based SDF editor, CSG operations, lighting modes, and shareable URL-encoded scenes. Hard: GLSL codegen from a graph, compile-error surfacing, performance at high step counts.

14. **Evolutionary ecosystems terrarium** — agents with genomes forage, reproduce, and speciate in a shared world; population graphs, food webs, and mutation drift tracked over time. Hard: emergent balance, spatial hashing, long-run stability without extinction collapse.

15. **Procedural music / generative DAW** — step-sequencer + synth engine (Web Audio), pattern algebra, live-coding language, per-track effects, seed-based songs and export. Hard: audio-timing scheduling, custom DSL parsing, polyphony and mixing.

16. **Multiplayer battle-royale party game (server-authoritative)** — 20+ players, authoritative hit detection, shrinking arena, spectator mode, matchmaking, and reconnect. Hard: bandwidth at player count, cheat resistance (server authority), tick sync, lobby lifecycle.

17. **Factorio-lite automation sandbox** — conveyor/belt physics, item routing, a factory graph that persists, blueprints, and a production/throughput analyzer. Hard: belt simulation at scale, save/load serialization, graph analysis for throughput.

18. **Procedural roguelike dungeon ecosystem** — wave-function-collapse level gen, FOV/lighting, AI factions that fight each other, item economy, and meta-progression. Hard: WFC constraint solving, FOV perf, faction AI, deterministic seeds.

19. **Realistic orbital/kerbal-style space program** — n-body or patched-conic orbital mechanics, rocket staging builder, delta-v planner, launch→orbit→transfer sim. Hard: numerical integration stability, 3D orbital rendering, trajectory prediction.

20. **Deep-learning playground in the browser** — tiny autograd/tensor library, editable network architecture, trained live on toy datasets with loss curves, and visualizations of activations. Hard: backprop correctness, WebGPU/WASM compute, numerical stability.

## Complexity axes cheat-sheet

- **Rendering**: WebGPU/WebGL, shaders, particles, voxels, SDF raymarching.
- **Simulation**: physics solvers, cellular automata, evolution, agents.
- **Networking**: server-plugin authority, lockstep/rollback, CRDTs, presence.
- **AI**: LLM game masters, pathfinding, genetic algorithms, game engines.
- **Persistence**: kv-plugin world saves, serialization, blueprints, replay logs.
- **Scale**: thousands of entities, chunk streaming, throughput analysis.

## Existing generators already near this bar

`webgpu-position-based-fluids`, `simple-townscraper-clone`, `lowpoly-procedural-island`, `minimal-animal-crossing`.
