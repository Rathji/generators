# vgn-rom-plugin

A retro console ROM analysis tool (disassembler + heuristic pseudo-C decompiler + tile/palette
extraction) for NES (6502), SNES (65C816), Master System (Z80) and Mega Drive (68000).
Booted from `index.html`, which imports `main.js` (the UI glue). Load a ROM by dropping it in,
or use the bundled demo ROM.

## Files
- `main.js` — UI glue (tabs, disassembly, decompilation, graphics, scene, export).
- `loaders.js` + `memory.js` — ROM format detection and CPU address-space mapping.
- `cpus/` — 6502 / 65C816 / Z80 / 68000 decoders.
- `analyze.js` / `decompile.js` / `symbols.js` — code walking + pseudo-C reconstruction.
- `extract.js` / `snesgfx.js` / `genesisgfx.js` / `lz.js` / `scene.js` — tile/palette/map extraction.
- `demo.nes` — bundled 24 KB NES demo ROM (hand-assembled 6502 program + 64 patterned 8x8 tiles).

## Rebuilding demo.nes
`demo.nes` is a small hand-assembled iNES ROM generated programmatically (a minimal 6502
program at $C000 with JSR functions, a PPU palette, a CHR table of generated tile patterns,
plus an iNES header). It is a build artifact; to regenerate it, re-assemble the source with a 6502
assembler or regenerate procedurally from the script used to create it (a two-pass mini-assembler
over an opcode table + a `setTile()` pattern generator producing the 0x2000-byte CHR bank).
